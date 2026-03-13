"""Integration tests for intent classification + missing info extraction.

Verifies the full pipeline: conversation turns -> intent classification
-> missing info extraction -> case type update through TurnCompletedHandler.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from intelligence_worker.classification.intent_classifier import (
    ClassificationResult,
    IntentClassifier,
)
from intelligence_worker.classification.missing_info import (
    MissingInfoExtractor,
    MissingInfoResult,
)
from intelligence_worker.main import TurnCompletedHandler
from intelligence_worker.qa_extraction import ConversationTurn, QAPair

# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------


class _StubConversationRepo:
    """Return pre-loaded turns for a given case_id."""

    def __init__(self, turns: list[ConversationTurn]) -> None:
        self._turns = turns

    def load_turns(self, *, tenant_id: str, case_id: str) -> list[ConversationTurn]:
        del tenant_id, case_id
        return list(self._turns)


class _StubExtractor:
    """No-op QA pair extractor."""

    def extract_and_persist(self, **kwargs: Any) -> list[QAPair]:
        return []


@dataclass
class _StubCaseTypeClient:
    """Record case type patches."""

    patched: list[dict[str, str]] = field(default_factory=list)

    def patch_case_type(self, *, tenant_id: str, case_id: str, intent: str) -> str:
        self.patched.append(
            {
                "tenant_id": tenant_id,
                "case_id": case_id,
                "intent": intent,
            }
        )
        return intent


class _StubIntentGateway:
    """Return a fixed ClassificationResult."""

    def __init__(self, result: ClassificationResult) -> None:
        self._result = result
        self.calls: list[str] = []

    def classify_intent(self, raw_text: str) -> ClassificationResult:
        self.calls.append(raw_text)
        return self._result


class _StubMissingInfoGateway:
    """Return a fixed MissingInfoResult."""

    def __init__(self, result: MissingInfoResult) -> None:
        self._result = result
        self.calls: list[tuple[str, str | None]] = []

    def extract_missing(
        self, raw_text: str, *, intent: str | None = None
    ) -> MissingInfoResult:
        self.calls.append((raw_text, intent))
        return self._result


def _make_payload(
    tenant_id: str = "t-1",
    session_id: str = "s-1",
    source_domain: str = "estimation",
) -> dict[str, object]:
    return {
        "tenant_id": tenant_id,
        "aggregate_id": session_id,
        "source_domain": source_domain,
        "payload": {"session_id": session_id},
    }


def _make_turns(
    messages: list[tuple[str, str]],
) -> list[ConversationTurn]:
    return [
        ConversationTurn(role=role, content=content, turn_number=i + 1)
        for i, (role, content) in enumerate(messages)
    ]


# ---------------------------------------------------------------------------
# Integration tests
# ---------------------------------------------------------------------------


class TestIntentAndMissingInfoPipeline:
    """Full pipeline: turns -> classify -> missing info -> case type."""

    def test_full_pipeline_new_project(self) -> None:
        """New project intent with missing budget and timeline."""
        turns = _make_turns(
            [
                ("user", "新規でECサイトを作りたい"),
                ("assistant", "詳細を教えてください"),
                ("user", "Reactで開発したい。チームは5人"),
            ]
        )

        intent_gateway = _StubIntentGateway(
            ClassificationResult(
                intent="new_project",
                confidence=0.92,
                keywords=["新規", "ECサイト"],
                rationale="new project request",
            )
        )
        missing_gateway = _StubMissingInfoGateway(
            MissingInfoResult(
                missing_topics=("budget", "timeline"),
                follow_up_questions=("予算は？", "納期は？"),
                confidence=0.87,
            )
        )
        case_type_client = _StubCaseTypeClient()

        handler = TurnCompletedHandler(
            conversation_repo=_StubConversationRepo(turns),
            extractor=_StubExtractor(),
            intent_classifier=IntentClassifier(gateway_client=intent_gateway),
            missing_info_extractor=MissingInfoExtractor(gateway_client=missing_gateway),
            case_type_client=case_type_client,
        )

        handler(_make_payload())

        # Intent classified correctly
        assert len(intent_gateway.calls) == 1
        assert "新規" in intent_gateway.calls[0]

        # Missing info extracted with intent context
        assert len(missing_gateway.calls) == 1
        _, intent_arg = missing_gateway.calls[0]
        assert intent_arg == "new_project"

        # Case type synced
        assert len(case_type_client.patched) == 1
        assert case_type_client.patched[0]["intent"] == "new_project"

    def test_full_pipeline_bug_report(self) -> None:
        """Bug report intent with most info already provided."""
        turns = _make_turns(
            [
                ("user", "決済モジュールにバグがあります"),
                ("assistant", "詳細を教えてください"),
                ("user", "Stripeの決済処理でエラーが出ます。要件としては修正のみ"),
            ]
        )

        intent_gateway = _StubIntentGateway(
            ClassificationResult(
                intent="bug_report",
                confidence=0.95,
                keywords=["バグ"],
            )
        )
        missing_gateway = _StubMissingInfoGateway(
            MissingInfoResult(
                missing_topics=("timeline",),
                follow_up_questions=("修正はいつまでに必要ですか？",),
                confidence=0.91,
            )
        )
        case_type_client = _StubCaseTypeClient()

        handler = TurnCompletedHandler(
            conversation_repo=_StubConversationRepo(turns),
            extractor=_StubExtractor(),
            intent_classifier=IntentClassifier(gateway_client=intent_gateway),
            missing_info_extractor=MissingInfoExtractor(gateway_client=missing_gateway),
            case_type_client=case_type_client,
        )

        handler(_make_payload())

        assert case_type_client.patched[0]["intent"] == "bug_report"
        _, intent_arg = missing_gateway.calls[0]
        assert intent_arg == "bug_report"

    def test_missing_info_runs_without_intent_classifier(self) -> None:
        """Missing info extraction should still work if intent is None."""
        turns = _make_turns([("user", "何か作りたい")])
        missing_gateway = _StubMissingInfoGateway(
            MissingInfoResult(
                missing_topics=("project_scope", "budget"),
                follow_up_questions=("何を作りますか？", "予算は？"),
                confidence=0.7,
            )
        )

        handler = TurnCompletedHandler(
            conversation_repo=_StubConversationRepo(turns),
            extractor=_StubExtractor(),
            missing_info_extractor=MissingInfoExtractor(gateway_client=missing_gateway),
        )

        handler(_make_payload())

        assert len(missing_gateway.calls) == 1
        _, intent_arg = missing_gateway.calls[0]
        assert intent_arg is None

    def test_missing_info_gateway_failure_falls_back(self) -> None:
        """Gateway failure should silently fall back to rule-based."""
        turns = _make_turns([("user", "予算500万円でECサイトを作りたい")])

        failing_gateway = _StubMissingInfoGateway(MissingInfoResult(confidence=0.0))
        failing_gateway.extract_missing = _raise_runtime_error  # type: ignore[assignment]

        handler = TurnCompletedHandler(
            conversation_repo=_StubConversationRepo(turns),
            extractor=_StubExtractor(),
            missing_info_extractor=MissingInfoExtractor(gateway_client=failing_gateway),
        )

        # Should not raise even though gateway fails
        handler(_make_payload())

    def test_no_turns_skips_entire_pipeline(self) -> None:
        """Empty conversation should skip classification and extraction."""
        intent_gateway = _StubIntentGateway(
            ClassificationResult(intent="new_project", confidence=0.9)
        )
        missing_gateway = _StubMissingInfoGateway(MissingInfoResult(confidence=0.9))

        handler = TurnCompletedHandler(
            conversation_repo=_StubConversationRepo([]),
            extractor=_StubExtractor(),
            intent_classifier=IntentClassifier(gateway_client=intent_gateway),
            missing_info_extractor=MissingInfoExtractor(gateway_client=missing_gateway),
        )

        handler(_make_payload())

        assert intent_gateway.calls == []
        assert missing_gateway.calls == []


class TestIntentClassifierFallbackIntegration:
    """Verify rule-based fallback integrates correctly."""

    @pytest.mark.parametrize(
        ("user_text", "expected_intent"),
        [
            ("新規でWebアプリを作りたい", "new_project"),
            ("There is a bug in the system", "bug_report"),
            ("機能追加をお願いしたい", "feature_addition"),
            ("この部分を修正してほしい", "fix_request"),
            ("相談したいことがあります", "consultation"),
        ],
    )
    def test_rule_based_intent_with_missing_info(
        self,
        user_text: str,
        expected_intent: str,
    ) -> None:
        """Rule-based classify then extract missing info."""
        classifier = IntentClassifier()
        result = classifier.classify(user_text)
        assert result.intent == expected_intent

        extractor = MissingInfoExtractor()
        missing = extractor.extract_missing(user_text, intent=result.intent)
        assert isinstance(missing, MissingInfoResult)
        assert missing.confidence >= 0.0


class TestHandlerWithoutOptionalComponents:
    """Handler should work with minimal configuration."""

    def test_handler_without_intent_or_missing_info(self) -> None:
        turns = _make_turns([("user", "テスト")])
        handler = TurnCompletedHandler(
            conversation_repo=_StubConversationRepo(turns),
            extractor=_StubExtractor(),
        )
        # Should not raise
        handler(_make_payload())

    def test_handler_with_intent_but_no_missing_info(self) -> None:
        turns = _make_turns([("user", "テスト")])
        case_type_client = _StubCaseTypeClient()
        handler = TurnCompletedHandler(
            conversation_repo=_StubConversationRepo(turns),
            extractor=_StubExtractor(),
            intent_classifier=IntentClassifier(),
            case_type_client=case_type_client,
        )
        handler(_make_payload())
        assert len(case_type_client.patched) == 1


def _raise_runtime_error(
    raw_text: str, *, intent: str | None = None
) -> MissingInfoResult:
    raise RuntimeError("gateway down")
