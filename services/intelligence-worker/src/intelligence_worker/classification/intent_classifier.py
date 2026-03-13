"""Intent classification clients and deterministic fallback policy."""

from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Protocol

logger = logging.getLogger(__name__)

VALID_INTENTS: tuple[str, ...] = (
    "new_project",
    "feature_addition",
    "bug_report",
    "fix_request",
    "consultation",
)

VALID_CASE_TYPES: tuple[str, ...] = (
    "new_project",
    "feature_addition",
    "bug_report",
    "fix_request",
    "undetermined",
)

DEFAULT_QWEN_MODEL = "qwen3.5-9b"
DEFAULT_DATA_CLASSIFICATION = "restricted"

_INTENT_PATTERNS: dict[str, re.Pattern[str]] = {
    "new_project": re.compile(
        r"(新規|新しい|ゼロから|スクラッチ|build from scratch"
        r"|new project|new system|new app|start from)",
        re.IGNORECASE,
    ),
    "feature_addition": re.compile(
        r"(機能追加|追加機能|新機能|add feature|new feature"
        r"|enhance|拡張|improvement)",
        re.IGNORECASE,
    ),
    "bug_report": re.compile(
        r"(バグ|不具合|エラー|bug|defect|broken|crash"
        r"|動かない|壊れ|おかしい)",
        re.IGNORECASE,
    ),
    "fix_request": re.compile(
        r"(修正|直し|fix|repair|patch|hotfix|改修"
        r"|対応して|修復)",
        re.IGNORECASE,
    ),
    "consultation": re.compile(
        r"(相談|コンサル|アドバイス|consult|advice"
        r"|question|質問|教えて|検討)",
        re.IGNORECASE,
    ),
}

_BASE_CONFIDENCE = 0.4
_MATCH_BONUS = 0.15
_MAX_CONFIDENCE = 0.95

_CLASSIFICATION_PROMPT = """\
You are an intake request classifier.
Classify the user's request into exactly one intent label.

Allowed labels:
- new_project
- feature_addition
- bug_report
- fix_request
- consultation

Return JSON only:
{
  "intent": "one_of_allowed_labels",
  "confidence": 0.0,
  "keywords": ["matched phrase", "matched phrase"],
  "rationale": "short explanation"
}
"""


@dataclass(frozen=True)
class ClassificationResult:
    """Result of intent classification."""

    intent: str
    confidence: float
    keywords: list[str] = field(default_factory=list)
    rationale: str | None = None


class IntentGatewayClient(Protocol):
    """HTTP client contract for llm-gateway backed classification."""

    def classify_intent(self, raw_text: str) -> ClassificationResult: ...


@dataclass(frozen=True)
class GatewayIntentClassifier:
    """Classify case intent via llm-gateway / Qwen3.5."""

    base_url: str
    model: str = DEFAULT_QWEN_MODEL
    timeout_seconds: float = 10.0
    data_classification: str = DEFAULT_DATA_CLASSIFICATION

    def __post_init__(self) -> None:
        parsed = urllib.parse.urlparse(self.base_url)
        if parsed.scheme not in ("http", "https"):
            msg = f"base_url scheme must be http/https, got: {parsed.scheme!r}"
            raise ValueError(msg)
        if not parsed.hostname:
            raise ValueError("base_url must include a hostname")

    def classify_intent(self, raw_text: str) -> ClassificationResult:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": _CLASSIFICATION_PROMPT},
                {"role": "user", "content": raw_text},
            ],
            "temperature": 0.1,
            "max_tokens": 200,
            "stream": False,
        }
        headers = {
            "Content-Type": "application/json",
            "X-Data-Classification": self.data_classification,
        }

        request = urllib.request.Request(
            self._endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            response = urllib.request.urlopen(request, timeout=self.timeout_seconds)
        except urllib.error.URLError as exc:
            logger.error("llm_gateway_classify_intent_failed", error=str(exc))
            raise
        try:
            body = json.loads(response.read().decode("utf-8"))
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                close()
        content = body.get("choices", [{}])[0].get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("llm-gateway response missing message content")

        return _parse_classification_json(content)

    @property
    def _endpoint(self) -> str:
        return self.base_url.rstrip("/") + "/v1/chat/completions"


class RuleBasedIntentClassifier:
    """Deterministic fallback classifier based on keyword scoring."""

    def classify(self, raw_text: str) -> ClassificationResult:
        if not raw_text or not raw_text.strip():
            logger.warning("empty_text_received_for_classification")
            return ClassificationResult(
                intent="consultation",
                confidence=0.1,
                keywords=[],
                rationale="empty input",
            )

        scores = self._score_intents(raw_text)
        best_intent, best_score, best_keywords = self._pick_best(scores)

        logger.info(
            "classified_intent_via_fallback",
            extra={
                "intent": best_intent,
                "confidence": best_score,
                "keywords": best_keywords,
            },
        )
        return ClassificationResult(
            intent=best_intent,
            confidence=best_score,
            keywords=best_keywords,
            rationale="rule-based fallback",
        )

    def _score_intents(self, text: str) -> dict[str, tuple[float, list[str]]]:
        results: dict[str, tuple[float, list[str]]] = {}
        for intent, pattern in _INTENT_PATTERNS.items():
            matches = pattern.findall(text)
            if matches:
                score = min(
                    _BASE_CONFIDENCE + _MATCH_BONUS * (len(matches) - 1),
                    _MAX_CONFIDENCE,
                )
                results[intent] = (score, list(dict.fromkeys(matches)))
            else:
                results[intent] = (0.0, [])
        return results

    @staticmethod
    def _pick_best(
        scores: dict[str, tuple[float, list[str]]],
    ) -> tuple[str, float, list[str]]:
        best_intent = "consultation"
        best_score = 0.0
        best_keywords: list[str] = []

        for intent, (score, keywords) in scores.items():
            if score > best_score:
                best_intent = intent
                best_score = score
                best_keywords = keywords

        if best_score == 0.0:
            return "consultation", 0.2, []

        return best_intent, best_score, best_keywords


class IntentClassifier:
    """Intent classifier with llm-gateway primary path and safe fallback."""

    def __init__(
        self,
        *,
        gateway_client: IntentGatewayClient | None = None,
        fallback_classifier: RuleBasedIntentClassifier | None = None,
    ) -> None:
        self._gateway_client = gateway_client
        self._fallback_classifier = fallback_classifier or RuleBasedIntentClassifier()

    def classify(self, raw_text: str) -> ClassificationResult:
        if not raw_text or not raw_text.strip():
            return self._fallback_classifier.classify(raw_text)

        if self._gateway_client is not None:
            try:
                result = self._gateway_client.classify_intent(raw_text)
                logger.info(
                    "classified_intent_via_gateway",
                    extra={
                        "intent": result.intent,
                        "confidence": result.confidence,
                        "keywords": result.keywords,
                    },
                )
                return result
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "intent_classification_gateway_failed",
                    extra={"error": str(exc)},
                )

        return self._fallback_classifier.classify(raw_text)


def normalize_case_type(intent: str) -> str:
    """Map classifier intent labels onto valid cases.type values."""
    normalized = intent.strip().lower()
    if normalized in VALID_CASE_TYPES:
        return normalized
    if normalized == "consultation":
        return "undetermined"
    return "undetermined"


def _strip_markdown_fences(content: str) -> str:
    """Strip markdown code fences that LLMs frequently wrap around JSON."""
    text = content.strip()
    if text.startswith("```"):
        first_newline = text.index("\n")
        text = text[first_newline + 1 :]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _parse_classification_json(content: str) -> ClassificationResult:
    raw = json.loads(_strip_markdown_fences(content))
    if not isinstance(raw, dict):
        raise ValueError("classification response must be a JSON object")

    intent = str(raw.get("intent", "")).strip().lower()
    if intent not in VALID_INTENTS:
        raise ValueError(f"invalid intent label: {intent}")

    confidence = _clamp01(raw.get("confidence", 0.0))
    keywords = _coerce_keywords(raw.get("keywords"))
    rationale = raw.get("rationale")
    if rationale is not None and not isinstance(rationale, str):
        raise ValueError("rationale must be a string when provided")

    return ClassificationResult(
        intent=intent,
        confidence=confidence,
        keywords=keywords,
        rationale=rationale,
    )


def _coerce_keywords(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _clamp01(value: Any) -> float:
    numeric = float(value)
    if numeric < 0:
        return 0.0
    if numeric > 1:
        return 1.0
    return numeric
