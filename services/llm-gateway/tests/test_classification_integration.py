from __future__ import annotations

import json
import logging

from fastapi.testclient import TestClient

from llm_gateway.fallback import FallbackResult, FallbackStage
from llm_gateway.main import create_app

TENANT_ID = "00000000-0000-0000-0000-000000000000"


def _base_payload(content: str) -> dict[str, object]:
    return {
        "model": "stub",
        "messages": [{"role": "user", "content": content}],
    }


class RecordingEngine:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def acomplete(
        self,
        messages: list[dict[str, str]],
        *,
        classification: str,
        temperature: float,
        max_tokens: int | None,
        fail_stages: set[str],
    ) -> FallbackResult:
        self.calls.append(
            {
                "messages": messages,
                "classification": classification,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "fail_stages": fail_stages,
            }
        )
        return FallbackResult(
            stage=FallbackStage(
                name="primary",
                provider="stub-provider",
                model="stub-model",
                timeout_seconds=5,
                enabled=True,
                allowed_classifications=("confidential", "restricted"),
            ),
            content="redacted ok",
            attempts=["primary"],
            fallback_used=False,
        )


def test_confidential_requests_are_redacted_and_audited(monkeypatch, caplog) -> None:
    engine = RecordingEngine()
    monkeypatch.setattr(
        "llm_gateway.routes.chat.load_fallback_engine",
        lambda _: engine,
    )
    client = TestClient(create_app())

    with caplog.at_level(logging.INFO, logger="llm_gateway.audit"):
        response = client.post(
            "/v1/chat/completions",
            headers={
                "X-Tenant-ID": TENANT_ID,
                "X-Data-Classification": "confidential",
            },
            json=_base_payload("reach me at user@example.com"),
        )

    assert response.status_code == 200
    assert response.json()["data_classification"] == "confidential"
    assert engine.calls[0]["messages"] == [
        {"role": "user", "content": "reach me at [REDACTED_EMAIL]"}
    ]
    payload = json.loads(caplog.records[0].message)
    assert payload["action"] == "redact"
    assert payload["redacted_count"] == 1
    assert payload["redacted_types"] == ["EMAIL"]


def test_disallowed_classification_is_blocked_and_audited(caplog) -> None:
    client = TestClient(create_app())

    with caplog.at_level(logging.INFO, logger="llm_gateway.audit"):
        response = client.post(
            "/v1/chat/completions",
            headers={
                "X-Tenant-ID": TENANT_ID,
                "X-Data-Classification": "public",
            },
            json=_base_payload("hello"),
        )

    assert response.status_code == 403
    payload = json.loads(caplog.records[0].message)
    assert payload["action"] == "block"
    assert payload["classification"] == "public"
    assert payload["tenant_id"] == TENANT_ID
