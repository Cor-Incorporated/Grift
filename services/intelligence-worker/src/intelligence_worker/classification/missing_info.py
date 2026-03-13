"""Missing information extractor for incoming requests.

Identifies which fields are absent from a request so the system can
prompt the user for additional details.  Supports an LLM-backed path
via llm-gateway with a deterministic rule-based fallback.
"""

from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

DEFAULT_DATA_CLASSIFICATION = "restricted"
DEFAULT_QWEN_MODEL = "qwen3.5-9b"

_EXTRACTION_PROMPT = """\
You are an intake assistant that identifies missing information in a \
software development request.

Required fields (check if present):
- project_scope: what the project or feature is about
- budget: approximate budget or cost expectation
- timeline: desired deadline or schedule
- tech_stack: programming languages, frameworks, or infrastructure
- team_size: team composition or headcount

Given the conversation so far, identify which fields are STILL MISSING
and generate a targeted follow-up question for each.

Return JSON only:
{
  "missing_topics": ["field_name", ...],
  "follow_up_questions": ["question text", ...],
  "confidence": 0.0
}
"""


@dataclass(frozen=True)
class MissingField:
    """A field that is missing from the request.

    Attributes:
        field_name: Canonical name of the missing field.
        question: Suggested follow-up question for the user.
        priority: ``high``, ``medium``, or ``low``.
    """

    field_name: str
    question: str
    priority: str


@dataclass(frozen=True)
class MissingInfoResult:
    """Result of missing info extraction.

    Attributes:
        missing_topics: Canonical field names that are still absent.
        follow_up_questions: Targeted questions to ask the user.
        confidence: Model confidence in the extraction (0.0-1.0).
    """

    missing_topics: list[str] = field(default_factory=list)
    follow_up_questions: list[str] = field(default_factory=list)
    confidence: float = 0.0


# Each detector returns ``True`` when the field is *present* in the
# text so the extractor can skip it.
_FIELD_DETECTORS: list[tuple[str, re.Pattern[str], str, str]] = [
    (
        "project_scope",
        re.compile(
            r"(スコープ|scope|要件|requirement|仕様|spec"
            r"|やりたいこと|目的|目標|ゴール|goal)",
            re.IGNORECASE,
        ),
        "プロジェクトのスコープや要件を教えてください。",
        "high",
    ),
    (
        "budget",
        re.compile(
            r"(予算|budget|費用|コスト|cost|金額|万円|百万|億)",
            re.IGNORECASE,
        ),
        "予算感を教えてください。",
        "high",
    ),
    (
        "timeline",
        re.compile(
            r"(期限|deadline|納期|スケジュール|schedule"
            r"|いつまで|timeline|月末|年末|quarter)",
            re.IGNORECASE,
        ),
        "希望する納期やスケジュールを教えてください。",
        "medium",
    ),
    (
        "tech_stack",
        re.compile(
            r"(技術|tech|stack|言語|language|framework"
            r"|フレームワーク|react|python|go|java|ruby|node)",
            re.IGNORECASE,
        ),
        "使用する技術スタックや制約はありますか？",
        "medium",
    ),
    (
        "team_size",
        re.compile(
            r"(チーム|team|人数|人員|メンバー|member|体制"
            r"|エンジニア|developer|人月)",
            re.IGNORECASE,
        ),
        "チーム体制やリソースの想定はありますか？",
        "low",
    ),
]

_FIELD_DEFAULT_QUESTIONS: dict[str, str] = {
    name: question for name, _, question, _ in _FIELD_DETECTORS
}

_FIELD_PRIORITIES: dict[str, str] = {
    name: priority for name, _, _, priority in _FIELD_DETECTORS
}


@dataclass(frozen=True)
class GatewayMissingInfoExtractor:
    """Extract missing info via llm-gateway / Qwen3.5.

    Sends the conversation text to llm-gateway and parses a structured
    JSON response identifying missing topics and follow-up questions.
    """

    base_url: str
    model: str = DEFAULT_QWEN_MODEL
    timeout_seconds: float = 10.0
    data_classification: str = DEFAULT_DATA_CLASSIFICATION

    def __post_init__(self) -> None:
        """Validate base_url on construction."""
        parsed = urllib.parse.urlparse(self.base_url)
        if parsed.scheme not in ("http", "https"):
            msg = f"base_url scheme must be http/https, got: {parsed.scheme!r}"
            raise ValueError(msg)
        if not parsed.hostname:
            raise ValueError("base_url must include a hostname")

    def extract_missing(
        self, raw_text: str, *, intent: str | None = None
    ) -> MissingInfoResult:
        """Call llm-gateway to identify missing information.

        Args:
            raw_text: Combined conversation text.
            intent: Classified intent label for additional context.

        Returns:
            Parsed MissingInfoResult from the LLM response.

        Raises:
            urllib.error.URLError: On network failure.
            ValueError: On malformed LLM response.
        """
        user_content = raw_text
        if intent:
            user_content = f"[Intent: {intent}]\n\n{raw_text}"

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": _EXTRACTION_PROMPT},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0.1,
            "max_tokens": 400,
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
            logger.error("llm_gateway_missing_info_failed", error=str(exc))
            raise
        with response:
            body = json.loads(response.read(1_048_576).decode("utf-8"))

        content = body.get("choices", [{}])[0].get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("llm-gateway response missing message content")

        return _parse_missing_info_json(content)

    @property
    def _endpoint(self) -> str:
        return self.base_url.rstrip("/") + "/v1/chat/completions"


class RuleBasedMissingInfoExtractor:
    """Deterministic fallback that scans text for field indicators."""

    def extract_missing(
        self, raw_text: str, *, intent: str | None = None
    ) -> MissingInfoResult:
        """Identify missing fields using regex patterns.

        Args:
            raw_text: Unstructured request text from the user.
            intent: Classified intent (unused in rule-based path).

        Returns:
            MissingInfoResult with detected gaps.
        """
        del intent  # unused in rule-based path
        fields = _extract_fields_rule_based(raw_text)
        return MissingInfoResult(
            missing_topics=[f.field_name for f in fields],
            follow_up_questions=[f.question for f in fields],
            confidence=0.4 if fields else 1.0,
        )


class MissingInfoExtractor:
    """Detect missing information fields in a request.

    Uses an LLM-backed primary path with a deterministic rule-based
    fallback when the gateway is unavailable or fails.
    """

    def __init__(
        self,
        *,
        gateway_client: GatewayMissingInfoExtractor | None = None,
        fallback: RuleBasedMissingInfoExtractor | None = None,
    ) -> None:
        self._gateway_client = gateway_client
        self._fallback = fallback or RuleBasedMissingInfoExtractor()

    def extract(self, raw_text: str) -> list[MissingField]:
        """Identify missing fields in the given text.

        Args:
            raw_text: Unstructured request text from the user.

        Returns:
            List of MissingField objects for fields not detected
            in the text, ordered by priority (high first).
        """
        return _extract_fields_rule_based(raw_text)

    def extract_missing(
        self, raw_text: str, *, intent: str | None = None
    ) -> MissingInfoResult:
        """Extract missing info with LLM primary and rule-based fallback.

        Args:
            raw_text: Combined conversation text.
            intent: Classified intent label for additional context.

        Returns:
            MissingInfoResult from the best available source.
        """
        if not raw_text or not raw_text.strip():
            return self._fallback.extract_missing(raw_text, intent=intent)

        if self._gateway_client is not None:
            try:
                result = self._gateway_client.extract_missing(raw_text, intent=intent)
                logger.info(
                    "missing_info_extracted_via_gateway",
                    extra={
                        "missing_count": len(result.missing_topics),
                        "confidence": result.confidence,
                    },
                )
                return result
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "missing_info_gateway_failed_using_fallback",
                    extra={"error": str(exc)},
                )

        return self._fallback.extract_missing(raw_text, intent=intent)


def _extract_fields_rule_based(raw_text: str) -> list[MissingField]:
    """Scan text for field indicators and return missing fields."""
    if not raw_text or not raw_text.strip():
        logger.warning("Empty text received for missing info extraction")
        return [
            MissingField(field_name=name, question=question, priority=priority)
            for name, _, question, priority in _FIELD_DETECTORS
        ]

    missing: list[MissingField] = []
    for name, pattern, question, priority in _FIELD_DETECTORS:
        if not pattern.search(raw_text):
            missing.append(
                MissingField(field_name=name, question=question, priority=priority)
            )

    priority_order = {"high": 0, "medium": 1, "low": 2}
    missing.sort(key=lambda f: priority_order.get(f.priority, 9))

    logger.info(
        "Missing info extraction complete",
        extra={
            "missing_count": len(missing),
            "fields": [f.field_name for f in missing],
        },
    )
    return missing


def _strip_markdown_fences(content: str) -> str:
    """Strip markdown code fences that LLMs frequently wrap around JSON."""
    text = content.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline == -1:
            text = re.sub(r"^```\w*", "", text)
        else:
            text = text[first_newline + 1 :]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _parse_missing_info_json(content: str) -> MissingInfoResult:
    """Parse LLM JSON output into a MissingInfoResult.

    Args:
        content: Raw JSON string from LLM response.

    Returns:
        Validated MissingInfoResult.

    Raises:
        ValueError: If the JSON structure is invalid.
    """
    raw = json.loads(_strip_markdown_fences(content))
    if not isinstance(raw, dict):
        raise ValueError("missing info response must be a JSON object")

    missing_topics = _coerce_string_list(raw.get("missing_topics"))
    follow_up_questions = _coerce_string_list(raw.get("follow_up_questions"))
    confidence = _clamp01(raw.get("confidence", 0.0))

    return MissingInfoResult(
        missing_topics=missing_topics,
        follow_up_questions=follow_up_questions,
        confidence=confidence,
    )


def _coerce_string_list(value: object) -> list[str]:
    """Coerce a value to a list of non-empty strings."""
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _clamp01(value: object) -> float:
    """Clamp a numeric value to [0.0, 1.0]."""
    try:
        numeric = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, numeric))
