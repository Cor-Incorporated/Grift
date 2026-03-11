"""Tests for QA pair extraction pipeline."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from intelligence_worker.qa_extraction import (
    ConversationTurn,
    QAPair,
    QAPairExtractor,
    parse_structured_output,
)


@dataclass
class _FakeLLM:
    response_text: str
    should_fail: bool = False

    async def extract_structured(
        self, *, prompt: str, response_schema: dict[str, Any]
    ) -> str:
        assert "qa_pairs" in response_schema.get("properties", {})
        assert "source_domain=" in prompt
        if self.should_fail:
            raise RuntimeError("llm unavailable")
        return self.response_text


@dataclass
class _FakeRepo:
    saved_pairs: list[QAPair] | None = None

    async def save_qa_pairs(
        self,
        *,
        tenant_id: str,
        case_id: str,
        session_id: str,
        pairs: list[QAPair],
    ) -> None:
        assert tenant_id and case_id and session_id
        self.saved_pairs = pairs


@dataclass
class _FakeDLQ:
    calls: list[dict[str, Any]]

    async def publish(self, *, reason: str, payload: dict[str, Any]) -> None:
        self.calls.append({"reason": reason, "payload": payload})


def _sample_turns() -> list[ConversationTurn]:
    return [
        ConversationTurn(role="user", content="予算を教えてください", turn_number=1),
        ConversationTurn(role="assistant", content="予算は100万円です", turn_number=2),
    ]


def test_extract_and_persist_success() -> None:
    llm = _FakeLLM(
        response_text=(
            '{"qa_pairs":[{"question_text":"予算は?","answer_text":"100万円",'
            '"turn_range":[1,2],"confidence":0.86,"source_domain":"estimation"}]}'
        )
    )
    repo = _FakeRepo()
    dlq = _FakeDLQ(calls=[])
    extractor = QAPairExtractor(
        llm_client=llm, repository=repo, dead_letter_publisher=dlq
    )

    pairs = asyncio.run(
        extractor.extract_and_persist(
            tenant_id="t1",
            case_id="c1",
            session_id="s1",
            source_domain="estimation",
            turns=_sample_turns(),
        )
    )

    assert len(pairs) == 1
    assert pairs[0].confidence == 0.86
    assert repo.saved_pairs is not None and len(repo.saved_pairs) == 1
    assert dlq.calls == []


def test_extract_and_persist_failure_goes_to_dlq() -> None:
    llm = _FakeLLM(response_text="{}", should_fail=True)
    repo = _FakeRepo()
    dlq = _FakeDLQ(calls=[])
    extractor = QAPairExtractor(
        llm_client=llm, repository=repo, dead_letter_publisher=dlq
    )

    pairs = asyncio.run(
        extractor.extract_and_persist(
            tenant_id="t1",
            case_id="c1",
            session_id="s1",
            source_domain="estimation",
            turns=_sample_turns(),
        )
    )

    assert pairs == []
    assert repo.saved_pairs is None
    assert len(dlq.calls) == 1
    assert dlq.calls[0]["reason"] == "qa_extraction_failed"


def test_parse_structured_output() -> None:
    parsed = parse_structured_output(
        '{"qa_pairs":[{"question_text":"q","answer_text":"a","turn_range":[1,2],'
        '"confidence":1.0,"source_domain":"estimation"}]}'
    )
    assert "qa_pairs" in parsed
