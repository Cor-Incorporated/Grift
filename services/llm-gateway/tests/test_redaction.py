from __future__ import annotations

from llm_gateway.redaction import redact, should_redact


def test_redact_replaces_multiple_pii_types() -> None:
    result = redact(
        "mail me at user@example.com or call 090-1234-5678 with "
        "card 4111-1111-1111-1111 and key ghp_12345678901234567890"
    )

    assert "[REDACTED_EMAIL]" in result.text
    assert "[REDACTED_PHONE_JP]" in result.text
    assert "[REDACTED_CREDIT_CARD]" in result.text
    assert "[REDACTED_API_KEY]" in result.text
    assert result.redacted_count == 4
    assert result.redacted_types == ["API_KEY", "EMAIL", "PHONE_JP", "CREDIT_CARD"]


def test_redact_returns_original_text_when_no_match() -> None:
    result = redact("plain text with no pii")

    assert result.text == "plain text with no pii"
    assert result.redacted_count == 0
    assert result.redacted_types == []


def test_should_redact_only_confidential() -> None:
    assert should_redact("public") is False
    assert should_redact("internal") is False
    assert should_redact("restricted") is False
    assert should_redact("confidential") is True
