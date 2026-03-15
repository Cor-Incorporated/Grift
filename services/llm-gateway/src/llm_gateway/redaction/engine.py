"""PII redaction for outbound prompt content."""

from __future__ import annotations

from dataclasses import dataclass

from llm_gateway.redaction.patterns import PII_PATTERNS


@dataclass(slots=True)
class RedactionResult:
    """Result of applying redaction patterns to a text payload."""

    text: str
    redacted_count: int
    redacted_types: list[str]


def redact(text: str) -> RedactionResult:
    """Apply all PII patterns and replace with typed placeholders."""
    current = text
    redacted_count = 0
    redacted_types: list[str] = []

    for pii_type, pattern in PII_PATTERNS:
        current, count = pattern.subn(f"[REDACTED_{pii_type}]", current)
        if count:
            redacted_count += count
            redacted_types.append(pii_type)

    return RedactionResult(
        text=current,
        redacted_count=redacted_count,
        redacted_types=redacted_types,
    )


def should_redact(classification: str) -> bool:
    """Return True when outbound content must be redacted."""
    return classification == "confidential"
