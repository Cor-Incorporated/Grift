"""QA pair extraction pipeline."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol

import structlog
from pydantic import BaseModel, Field

from intelligence_worker.completeness_tracker import (
    build_extraction_prompt_feedback,
    build_tracking_snapshot,
    infer_collected_items_from_texts,
)

logger = structlog.get_logger()


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
        self,
        *,
        prompt: str,
        response_schema: dict[str, Any],
        system_prompt: str | None = None,
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
        dead_letter_context: dict[str, Any] | None = None,
        re_raise_errors: bool = False,
    ) -> list[QAPair]:
        prompt = self._build_prompt(turns, source_domain)
        system_prompt = self._build_system_prompt(turns, source_domain)
        try:
            raw = self._llm_client.extract_structured(
                prompt=prompt,
                response_schema=QAPairExtractionOutput.model_json_schema(),
                system_prompt=system_prompt,
            )
            parsed = QAPairExtractionOutput.model_validate_json(raw)
        except Exception as exc:  # noqa: BLE001
            self._dead_letter.publish(
                reason="qa_extraction_failed",
                payload={
                    **(dead_letter_context or {}),
                    "tenant_id": tenant_id,
                    "case_id": case_id,
                    "session_id": session_id,
                    "source_domain": source_domain,
                    "error": str(exc),
                },
            )
            if re_raise_errors:
                raise
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
            conversation_text=conversation_text + f"\nsource_domain={source_domain}",
        )

    @staticmethod
    def _build_system_prompt(
        turns: list[ConversationTurn],
        source_domain: str,
    ) -> str | None:
        source_texts = [turn.content for turn in turns if turn.role == "user"]
        if not source_texts:
            source_texts = [turn.content for turn in turns]
        try:
            snapshot = build_tracking_snapshot(
                domain=source_domain,
                collected_items=infer_collected_items_from_texts(
                    source_domain,
                    source_texts,
                ),
                turn_count=len(turns),
            )
        except ValueError as exc:  # Unknown domain — no completeness signal available
            logger.warning("build_system_prompt_skipped", error=str(exc))
            return None
        return build_extraction_prompt_feedback(snapshot)

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
