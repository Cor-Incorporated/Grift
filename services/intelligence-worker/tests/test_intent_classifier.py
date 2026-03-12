"""Tests for intent classification integration and fallback policy."""

from __future__ import annotations

import json
import urllib.error
from unittest.mock import patch

import pytest

from intelligence_worker.classification.case_type_client import (
    ControlAPICaseTypeClient,
)
from intelligence_worker.classification.intent_classifier import (
    DEFAULT_QWEN_MODEL,
    VALID_INTENTS,
    ClassificationResult,
    GatewayIntentClassifier,
    IntentClassifier,
    RuleBasedIntentClassifier,
    normalize_case_type,
)


@pytest.fixture()
def fallback_classifier() -> RuleBasedIntentClassifier:
    return RuleBasedIntentClassifier()


class TestRuleBasedIntentClassifier:
    def test_japanese_new_project(
        self,
        fallback_classifier: RuleBasedIntentClassifier,
    ) -> None:
        result = fallback_classifier.classify("新規でWebアプリを作りたい")
        assert result.intent == "new_project"
        assert result.confidence >= 0.4

    def test_english_bug_report(
        self,
        fallback_classifier: RuleBasedIntentClassifier,
    ) -> None:
        result = fallback_classifier.classify("There is a bug in the payment module")
        assert result.intent == "bug_report"
        assert result.confidence >= 0.4

    def test_empty_string_returns_consultation(
        self, fallback_classifier: RuleBasedIntentClassifier
    ) -> None:
        result = fallback_classifier.classify("")
        assert result.intent == "consultation"
        assert result.confidence == 0.1
        assert result.keywords == []

    def test_no_keywords_returns_consultation(
        self, fallback_classifier: RuleBasedIntentClassifier
    ) -> None:
        result = fallback_classifier.classify("Hello world")
        assert result.intent == "consultation"
        assert result.confidence == 0.2
        assert result.keywords == []

    def test_result_intent_is_valid(
        self, fallback_classifier: RuleBasedIntentClassifier
    ) -> None:
        result = fallback_classifier.classify("新規プロジェクト")
        assert result.intent in VALID_INTENTS


class TestGatewayIntentClassifier:
    def test_gateway_success_returns_structured_result(self) -> None:
        client = GatewayIntentClassifier(base_url="http://gateway:8081")

        with patch(
            "intelligence_worker.classification.intent_classifier.urllib.request.urlopen"
        ) as post:
            post.return_value = _urlopen_response(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "intent": "feature_addition",
                                        "confidence": 0.82,
                                        "keywords": ["add feature", "export"],
                                        "rationale": "feature expansion",
                                    }
                                )
                            }
                        }
                    ]
                }
            )

            result = client.classify_intent("We need to add export support")

        assert result == ClassificationResult(
            intent="feature_addition",
            confidence=0.82,
            keywords=["add feature", "export"],
            rationale="feature expansion",
        )
        call = post.call_args
        request = call.args[0]
        assert request.full_url == "http://gateway:8081/v1/chat/completions"
        assert json.loads(request.data.decode("utf-8"))["model"] == DEFAULT_QWEN_MODEL
        assert request.headers["X-data-classification"] == "restricted"

    def test_gateway_rejects_invalid_intent_label(self) -> None:
        client = GatewayIntentClassifier(base_url="http://gateway:8081")

        with patch(
            "intelligence_worker.classification.intent_classifier.urllib.request.urlopen"
        ) as post:
            post.return_value = _urlopen_response(
                {
                    "choices": [
                        {"message": {"content": '{"intent":"other","confidence":0.5}'}}
                    ]
                }
            )

            with pytest.raises(ValueError, match="invalid intent label"):
                client.classify_intent("random")


class TestIntentClassifier:
    def test_uses_gateway_when_available(self) -> None:
        gateway = _GatewayStub(
            result=ClassificationResult(
                intent="fix_request",
                confidence=0.74,
                keywords=["fix"],
                rationale="gateway",
            )
        )
        classifier = IntentClassifier(gateway_client=gateway)

        result = classifier.classify("Please fix the layout issue")

        assert result.intent == "fix_request"
        assert gateway.calls == ["Please fix the layout issue"]

    def test_falls_back_when_gateway_raises(self) -> None:
        gateway = _GatewayStub(error=RuntimeError("gateway down"))
        classifier = IntentClassifier(gateway_client=gateway)

        result = classifier.classify("新規でWebアプリを作りたい")

        assert result.intent == "new_project"
        assert result.rationale == "rule-based fallback"

    def test_blank_input_skips_gateway(self) -> None:
        gateway = _GatewayStub(
            result=ClassificationResult(intent="bug_report", confidence=0.9)
        )
        classifier = IntentClassifier(gateway_client=gateway)

        result = classifier.classify("   ")

        assert result.intent == "consultation"
        assert gateway.calls == []


class TestNormalizeCaseType:
    @pytest.mark.parametrize(
        ("intent", "expected"),
        [
            ("new_project", "new_project"),
            ("fix_request", "fix_request"),
            ("consultation", "undetermined"),
            ("OTHER", "undetermined"),
        ],
    )
    def test_normalize_case_type(self, intent: str, expected: str) -> None:
        assert normalize_case_type(intent) == expected


class TestControlAPICaseTypeClient:
    def test_patch_case_type_sends_expected_headers_and_payload(self) -> None:
        client = ControlAPICaseTypeClient(
            base_url="http://control-api:8080",
            bearer_token="service-token",
        )

        with patch(
            "intelligence_worker.classification.case_type_client.urllib.request.urlopen"
        ) as patch_call:
            patch_call.return_value = _urlopen_response(
                {"data": {"type": "new_project"}}
            )

            result = client.patch_case_type(
                tenant_id="tenant-123",
                case_id="case-456",
                intent="new_project",
            )

        assert result == "new_project"
        call = patch_call.call_args
        request = call.args[0]
        assert request.full_url == "http://control-api:8080/v1/cases/case-456"
        assert json.loads(request.data.decode("utf-8")) == {"type": "new_project"}
        assert request.headers["X-tenant-id"] == "tenant-123"
        assert request.headers["Authorization"] == "Bearer service-token"

    def test_patch_case_type_maps_consultation_to_undetermined(self) -> None:
        client = ControlAPICaseTypeClient(base_url="http://control-api:8080")

        with patch(
            "intelligence_worker.classification.case_type_client.urllib.request.urlopen"
        ) as patch_call:
            patch_call.return_value = _urlopen_response(
                {"data": {"type": "undetermined"}}
            )

            result = client.patch_case_type(
                tenant_id="tenant-123",
                case_id="case-456",
                intent="consultation",
            )

        assert result == "undetermined"
        request = patch_call.call_args.args[0]
        assert json.loads(request.data.decode("utf-8")) == {"type": "undetermined"}
        assert "Authorization" not in request.headers

    def test_patch_case_type_propagates_http_errors(self) -> None:
        client = ControlAPICaseTypeClient(base_url="http://control-api:8080")

        with patch(
            "intelligence_worker.classification.case_type_client.urllib.request.urlopen"
        ) as patch_call:
            patch_call.side_effect = urllib.error.HTTPError(
                url="http://control-api:8080/v1/cases/case-456",
                code=401,
                msg="unauthorized",
                hdrs=None,
                fp=None,
            )

            with pytest.raises(urllib.error.HTTPError):
                client.patch_case_type(
                    tenant_id="tenant-123",
                    case_id="case-456",
                    intent="new_project",
                )


class _GatewayStub:
    def __init__(
        self,
        *,
        result: ClassificationResult | None = None,
        error: Exception | None = None,
    ) -> None:
        self._result = result
        self._error = error
        self.calls: list[str] = []

    def classify_intent(self, raw_text: str) -> ClassificationResult:
        self.calls.append(raw_text)
        if self._error is not None:
            raise self._error
        assert self._result is not None
        return self._result


def _urlopen_response(payload: dict[str, object]) -> object:
    class _Response:
        def read(self) -> bytes:
            return json.dumps(payload).encode("utf-8")

        def __enter__(self) -> _Response:
            return self

        def __exit__(self, *_args: object) -> bool:
            return False

    return _Response()
