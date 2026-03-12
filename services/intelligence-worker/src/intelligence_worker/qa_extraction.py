"""QA pair extraction pipeline."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol

from pydantic import BaseModel, Field


@dataclass(frozen=True)
class ConversationTurn:
    """A single conversation turn for extraction input."""

    role: str
    content: str
    turn_number: int
    system_prompt_version: str | None = None


@dataclass(frozen=True)
class QAPair:
    """Extracted QA pair contract."""

    question_text: str
    answer_text: str
    turn_range: list[int]
    confidence: float
    source_domain: str


class LLMClient(Protocol):
    def extract_structured(
        self, *, prompt: str, response_schema: dict[str, Any]
    ) -> str: ...


class QAPairRepository(Protocol):
    def save_qa_pairs(
        self,
        *,
        tenant_id: str,
        case_id: str,
        session_id: str,
        pairs: list[QAPair],
    ) -> None: ...


class DeadLetterPublisher(Protocol):
    def publish(self, *, reason: str, payload: dict[str, Any]) -> None: ...


class QAPairModel(BaseModel):
    question_text: str = Field(min_length=1)
    answer_text: str = Field(min_length=1)
    turn_range: list[int] = Field(min_length=2, max_length=2)
    confidence: float = Field(ge=0.0, le=1.0)
    source_domain: str = Field(min_length=1)


class QAPairExtractionOutput(BaseModel):
    qa_pairs: list[QAPairModel]


QAPAIR_EXTRACTION_PROMPT_TEMPLATE = """\
You are an extraction engine.
Input conversation:
{conversation_text}

Return JSON with this schema:
{{
  "qa_pairs": [
    {{
      "question_text": "string",
      "answer_text": "string",
      "turn_range": [int, int],
      "confidence": float (0.0-1.0),
      "source_domain": "string"
    }}
  ]
}}
"""


class QAPairExtractor:
    """Extract QA pairs via LLM and persist to repository."""

    def __init__(
        self,
        *,
        llm_client: LLMClient,
        repository: QAPairRepository,
        dead_letter_publisher: DeadLetterPublisher,
    ) -> None:
        self._llm_client = llm_client
        self._repository = repository
        self._dead_letter = dead_letter_publisher

    def extract_and_persist(
        self,
        *,
        tenant_id: str,
        case_id: str,
        session_id: str,
        source_domain: str,
        turns: list[ConversationTurn],
    ) -> list[QAPair]:
        prompt = self._build_prompt(turns, source_domain)
        try:
            raw = self._llm_client.extract_structured(
                prompt=prompt,
                response_schema=QAPairExtractionOutput.model_json_schema(),
            )
            parsed = QAPairExtractionOutput.model_validate_json(raw)
        except Exception as exc:  # noqa: BLE001
            self._dead_letter.publish(
                reason="qa_extraction_failed",
                payload={
                    "tenant_id": tenant_id,
                    "case_id": case_id,
                    "session_id": session_id,
                    "source_domain": source_domain,
                    "error": str(exc),
                },
            )
            return []

        pairs = [self._to_dataclass(item) for item in parsed.qa_pairs]
        self._repository.save_qa_pairs(
            tenant_id=tenant_id,
            case_id=case_id,
            session_id=session_id,
            pairs=pairs,
        )
        return pairs

    def _build_prompt(self, turns: list[ConversationTurn], source_domain: str) -> str:
        conversation_text = "\n".join(
            f"[turn={turn.turn_number}] {turn.role}: {turn.content}" for turn in turns
        )
        return QAPAIR_EXTRACTION_PROMPT_TEMPLATE.format(
            conversation_text=conversation_text + f"\nsource_domain={source_domain}"
        )

    @staticmethod
    def _to_dataclass(model: QAPairModel) -> QAPair:
        return QAPair(
            question_text=model.question_text,
            answer_text=model.answer_text,
            turn_range=list(model.turn_range),
            confidence=float(model.confidence),
            source_domain=model.source_domain,
        )


def parse_structured_output(raw_json: str) -> dict[str, Any]:
    """Utility for direct JSON parsing in integration tests."""
    return json.loads(raw_json)
