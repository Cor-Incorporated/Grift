"""Integration coverage for the completeness feedback loop."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from intelligence_worker.main import TurnCompletedHandler
from intelligence_worker.qa_extraction import ConversationTurn, QAPair, QAPairExtractor


@dataclass
class _FakeConversationRepo:
    turns: list[ConversationTurn]

    def load_turns(self, *, tenant_id: str, case_id: str) -> list[ConversationTurn]:
        assert tenant_id == "t1"
        assert case_id == "s1"
        return self.turns


@dataclass
class _FakeLLM:
    response_text: str
    last_prompt: str = ""
    last_system_prompt: str | None = None

    def extract_structured(
        self,
        *,
        prompt: str,
        response_schema: dict[str, Any],
        system_prompt: str | None = None,
    ) -> str:
        self.last_prompt = prompt
        self.last_system_prompt = system_prompt
        assert "qa_pairs" in response_schema.get("properties", {})
        return self.response_text


@dataclass
class _FakeQAPairRepository:
    calls: list[dict[str, Any]] = field(default_factory=list)

    def save_qa_pairs(
        self,
        *,
        tenant_id: str,
        case_id: str,
        session_id: str,
        pairs: list[QAPair],
    ) -> None:
        self.calls.append(
            {
                "tenant_id": tenant_id,
                "case_id": case_id,
                "session_id": session_id,
                "pairs": pairs,
            }
        )


@dataclass
class _FakeDLQ:
    calls: list[dict[str, Any]] = field(default_factory=list)

    def publish(self, *, reason: str, payload: dict[str, Any]) -> None:
        self.calls.append({"reason": reason, "payload": payload})


@dataclass
class _FakeCompletenessRepository:
    calls: list[dict[str, Any]] = field(default_factory=list)

    def save_snapshot(self, **kwargs: Any) -> None:
        self.calls.append(kwargs)


def test_turn_completed_handler_persists_partial_completeness_feedback_loop() -> None:
    turns = [
        ConversationTurn(
            role="user",
            content=(
                "技術スタックは React と TypeScript です。予算は 300 万円くらいです。"
            ),
            turn_number=1,
        ),
        ConversationTurn(
            role="assistant",
            content="承知しました。詳細スコープと納期も教えてください。",
            turn_number=2,
        ),
    ]
    llm = _FakeLLM(
        response_text=(
            '{"qa_pairs":['
            '{"question_text":"技術スタックは?","answer_text":"React と TypeScript",'
            '"turn_range":[1,1],"confidence":0.91,"source_domain":"estimation"},'
            '{"question_text":"予算感は?","answer_text":"300万円くらい",'
            '"turn_range":[1,1],"confidence":0.55,"source_domain":"estimation"}'
            "]}"
        )
    )
    qa_repo = _FakeQAPairRepository()
    dlq = _FakeDLQ()
    completeness_repo = _FakeCompletenessRepository()
    extractor = QAPairExtractor(
        llm_client=llm,
        repository=qa_repo,
        dead_letter_publisher=dlq,
    )
    handler = TurnCompletedHandler(
        conversation_repo=_FakeConversationRepo(turns=turns),
        extractor=extractor,
        completeness_repository=completeness_repo,
    )

    handler(
        {
            "tenant_id": "t1",
            "aggregate_id": "s1",
            "source_domain": "estimation",
            "payload": {"session_id": "s1"},
        }
    )

    assert len(qa_repo.calls) == 1
    assert len(qa_repo.calls[0]["pairs"]) == 2
    assert dlq.calls == []
    assert llm.last_system_prompt is not None
    assert "Completeness feedback:" in llm.last_system_prompt
    assert "completeness_score=0.400" in llm.last_system_prompt
    assert "未収集項目: [scope, timeline, team]" in llm.last_system_prompt
    assert len(completeness_repo.calls) == 1
    snapshot = completeness_repo.calls[0]["snapshot"]
    assert snapshot.overall_completeness == 0.2
    assert snapshot.checklist["tech_stack"].status == "collected"
    assert snapshot.checklist["budget"].status == "partial"
    assert snapshot.checklist["scope"].status == "missing"
    assert sorted(snapshot.suggested_next_topics) == sorted(
        ("budget", "scope", "timeline", "team")
    )
