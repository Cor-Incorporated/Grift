"""Tests for the missing info extractor (rule-based and LLM-backed)."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from intelligence_worker.classification.missing_info import (
    GatewayMissingInfoExtractor,
    MissingField,
    MissingInfoExtractor,
    MissingInfoResult,
    RuleBasedMissingInfoExtractor,
)


def _field_names(fields: list[MissingField]) -> list[str]:
    """Helper to extract field names from results."""
    return [f.field_name for f in fields]


# ---------------------------------------------------------------------------
# Rule-based extraction (legacy .extract() interface)
# ---------------------------------------------------------------------------


class TestMissingInfoExtraction:
    def test_all_fields_missing_for_vague_request(self) -> None:
        extractor = MissingInfoExtractor()
        result = extractor.extract("何かアプリを作りたい")
        names = _field_names(result)
        assert "project_scope" in names
        assert "budget" in names
        assert "timeline" in names
        assert "tech_stack" in names
        assert "team_size" in names

    def test_scope_present_reduces_missing(self) -> None:
        extractor = MissingInfoExtractor()
        result = extractor.extract("ECサイトの要件を整理したい")
        names = _field_names(result)
        assert "project_scope" not in names
        assert "budget" in names

    def test_budget_present_reduces_missing(self) -> None:
        extractor = MissingInfoExtractor()
        result = extractor.extract("予算は500万円です")
        names = _field_names(result)
        assert "budget" not in names

    def test_timeline_present_reduces_missing(self) -> None:
        extractor = MissingInfoExtractor()
        result = extractor.extract("納期は来月末です")
        names = _field_names(result)
        assert "timeline" not in names

    def test_tech_stack_present_reduces_missing(self) -> None:
        extractor = MissingInfoExtractor()
        result = extractor.extract("Reactで開発したい")
        names = _field_names(result)
        assert "tech_stack" not in names

    def test_team_size_present_reduces_missing(self) -> None:
        extractor = MissingInfoExtractor()
        result = extractor.extract("チーム3人で進めたい")
        names = _field_names(result)
        assert "team_size" not in names

    def test_complete_request_returns_empty(self) -> None:
        extractor = MissingInfoExtractor()
        result = extractor.extract(
            "ECサイトの要件: 予算500万円、納期は来月末、"
            "Reactフレームワークで、チーム5人体制"
        )
        assert result == []

    def test_empty_text_returns_all_fields(self) -> None:
        extractor = MissingInfoExtractor()
        result = extractor.extract("")
        assert len(result) == 5

    def test_whitespace_only_returns_all_fields(self) -> None:
        extractor = MissingInfoExtractor()
        result = extractor.extract("   ")
        assert len(result) == 5


class TestMissingFieldPriority:
    def test_results_sorted_by_priority(self) -> None:
        extractor = MissingInfoExtractor()
        result = extractor.extract("何かアプリを作りたい")
        priorities = [f.priority for f in result]
        expected_order = ["high", "high", "medium", "medium", "low"]
        assert priorities == expected_order

    def test_high_priority_fields(self) -> None:
        extractor = MissingInfoExtractor()
        result = extractor.extract("何かアプリを作りたい")
        high_fields = [f.field_name for f in result if f.priority == "high"]
        assert "project_scope" in high_fields
        assert "budget" in high_fields


class TestMissingFieldDataclass:
    def test_field_has_question(self) -> None:
        extractor = MissingInfoExtractor()
        result = extractor.extract("何かアプリを作りたい")
        for f in result:
            assert f.question
            assert len(f.question) > 0

    def test_field_is_frozen(self) -> None:
        field = MissingField(
            field_name="test",
            question="test?",
            priority="high",
        )
        try:
            field.field_name = "other"  # type: ignore[misc]
            assert False, "Should have raised"  # noqa: B011
        except AttributeError:
            pass


# ---------------------------------------------------------------------------
# MissingInfoResult dataclass
# ---------------------------------------------------------------------------


class TestMissingInfoResult:
    def test_default_values(self) -> None:
        result = MissingInfoResult()
        assert result.missing_topics == ()
        assert result.follow_up_questions == ()
        assert result.confidence == 0.0

    def test_frozen(self) -> None:
        result = MissingInfoResult(
            missing_topics=("budget",),
            follow_up_questions=("予算は？",),
            confidence=0.85,
        )
        with pytest.raises(AttributeError):
            result.confidence = 0.5  # type: ignore[misc]


# ---------------------------------------------------------------------------
# RuleBasedMissingInfoExtractor
# ---------------------------------------------------------------------------


class TestRuleBasedMissingInfoExtractor:
    def test_empty_text_returns_all_topics(self) -> None:
        extractor = RuleBasedMissingInfoExtractor()
        result = extractor.extract_missing("")
        assert len(result.missing_topics) == 5
        assert len(result.follow_up_questions) == 5
        assert result.confidence == 0.4

    def test_complete_text_returns_no_topics(self) -> None:
        extractor = RuleBasedMissingInfoExtractor()
        result = extractor.extract_missing(
            "ECサイトの要件: 予算500万円、納期は来月末、"
            "Reactフレームワークで、チーム5人体制"
        )
        assert result.missing_topics == ()
        assert result.follow_up_questions == ()
        assert result.confidence == 1.0

    def test_partial_text_returns_missing_only(self) -> None:
        extractor = RuleBasedMissingInfoExtractor()
        result = extractor.extract_missing("予算は500万円です")
        assert "budget" not in result.missing_topics
        assert "project_scope" in result.missing_topics

    def test_intent_parameter_is_ignored(self) -> None:
        extractor = RuleBasedMissingInfoExtractor()
        r1 = extractor.extract_missing("予算は500万円です", intent=None)
        r2 = extractor.extract_missing("予算は500万円です", intent="new_project")
        assert r1.missing_topics == r2.missing_topics


# ---------------------------------------------------------------------------
# GatewayMissingInfoExtractor
# ---------------------------------------------------------------------------


class TestGatewayMissingInfoExtractor:
    def test_success_returns_parsed_result(self) -> None:
        client = GatewayMissingInfoExtractor(base_url="http://gateway:8081")
        with patch(
            "intelligence_worker.classification.missing_info.urllib.request.urlopen"
        ) as urlopen:
            urlopen.return_value = _urlopen_response(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "missing_topics": [
                                            "budget",
                                            "timeline",
                                        ],
                                        "follow_up_questions": [
                                            "予算は？",
                                            "納期は？",
                                        ],
                                        "confidence": 0.88,
                                    }
                                )
                            }
                        }
                    ]
                }
            )
            result = client.extract_missing("新規アプリを作りたい")

        assert result == MissingInfoResult(
            missing_topics=("budget", "timeline"),
            follow_up_questions=("予算は？", "納期は？"),
            confidence=0.88,
        )
        request = urlopen.call_args.args[0]
        assert request.full_url == "http://gateway:8081/v1/chat/completions"
        assert request.headers["X-data-classification"] == "restricted"

    def test_includes_intent_in_user_content(self) -> None:
        client = GatewayMissingInfoExtractor(base_url="http://gateway:8081")
        with patch(
            "intelligence_worker.classification.missing_info.urllib.request.urlopen"
        ) as urlopen:
            urlopen.return_value = _urlopen_response(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "missing_topics": [],
                                        "follow_up_questions": [],
                                        "confidence": 0.95,
                                    }
                                )
                            }
                        }
                    ]
                }
            )
            client.extract_missing("test", intent="bug_report")

        request = urlopen.call_args.args[0]
        body = json.loads(request.data.decode("utf-8"))
        user_msg = body["messages"][-1]["content"]
        assert "[Intent: bug_report]" in user_msg

    def test_rejects_invalid_base_url(self) -> None:
        with pytest.raises(ValueError, match="scheme must be http/https"):
            GatewayMissingInfoExtractor(base_url="ftp://bad")

    def test_rejects_missing_hostname(self) -> None:
        with pytest.raises(ValueError, match="hostname"):
            GatewayMissingInfoExtractor(base_url="http://")

    def test_handles_markdown_fenced_response(self) -> None:
        client = GatewayMissingInfoExtractor(base_url="http://gateway:8081")
        fenced = (
            '```json\n{"missing_topics": ["scope"],'
            ' "follow_up_questions": ["スコープは？"],'
            ' "confidence": 0.7}\n```'
        )
        with patch(
            "intelligence_worker.classification.missing_info.urllib.request.urlopen"
        ) as urlopen:
            urlopen.return_value = _urlopen_response(
                {"choices": [{"message": {"content": fenced}}]}
            )
            result = client.extract_missing("test")

        assert result.missing_topics == ("scope",)
        assert result.confidence == 0.7


# ---------------------------------------------------------------------------
# MissingInfoExtractor (composite with fallback)
# ---------------------------------------------------------------------------


class TestMissingInfoExtractorComposite:
    def test_uses_gateway_when_available(self) -> None:
        gateway = _GatewayStub(
            result=MissingInfoResult(
                missing_topics=("budget",),
                follow_up_questions=("予算は？",),
                confidence=0.9,
            )
        )
        extractor = MissingInfoExtractor(gateway_client=gateway)
        result = extractor.extract_missing("新規アプリ", intent="new_project")
        assert result.missing_topics == ("budget",)
        assert gateway.calls == [("新規アプリ", "new_project")]

    def test_falls_back_when_gateway_raises(self) -> None:
        gateway = _GatewayStub(error=RuntimeError("down"))
        extractor = MissingInfoExtractor(gateway_client=gateway)
        result = extractor.extract_missing("予算は500万円です")
        assert "budget" not in result.missing_topics
        assert result.confidence == 0.4

    def test_empty_input_skips_gateway(self) -> None:
        gateway = _GatewayStub(result=MissingInfoResult(confidence=0.9))
        extractor = MissingInfoExtractor(gateway_client=gateway)
        result = extractor.extract_missing("  ")
        assert len(result.missing_topics) == 5
        assert gateway.calls == []

    def test_no_gateway_uses_rule_based(self) -> None:
        extractor = MissingInfoExtractor()
        result = extractor.extract_missing("予算は500万円です")
        assert "budget" not in result.missing_topics


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _GatewayStub:
    def __init__(
        self,
        *,
        result: MissingInfoResult | None = None,
        error: Exception | None = None,
    ) -> None:
        self._result = result
        self._error = error
        self.calls: list[tuple[str, str | None]] = []

    def extract_missing(
        self, raw_text: str, *, intent: str | None = None
    ) -> MissingInfoResult:
        self.calls.append((raw_text, intent))
        if self._error is not None:
            raise self._error
        assert self._result is not None
        return self._result


def _urlopen_response(payload: dict[str, object]) -> object:
    class _Response:
        def read(self, amt: int | None = None) -> bytes:
            data = json.dumps(payload).encode("utf-8")
            if amt is not None:
                return data[:amt]
            return data

        def __enter__(self) -> _Response:
            return self

        def __exit__(self, *_args: object) -> bool:
            return False

    return _Response()
