"""Tests for chat fallback behavior."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from llm_gateway.fallback import metrics
from llm_gateway.main import create_app


def _base_payload() -> dict[str, object]:
    return {
        "model": "stub",
        "messages": [{"role": "user", "content": "hello"}],
    }


def test_fallback_to_secondary_when_primary_fails() -> None:
    metrics.reset()
    client = TestClient(create_app())

    response = client.post(
        "/v1/chat/completions",
        headers={"X-Debug-Fail-Stages": "primary"},
        json=_base_payload(),
    )

    assert response.status_code == 200
    assert response.headers["X-Fallback-Used"] == "true"
    body = response.json()
    assert body["fallback"]["stage"] == "secondary"
    assert body["fallback"]["used"] is True


def test_restricted_blocks_last_resort_cloud_escape() -> None:
    metrics.reset()
    client = TestClient(create_app())

    response = client.post(
        "/v1/chat/completions",
        headers={"X-Debug-Fail-Stages": "primary,secondary,lightweight"},
        json=_base_payload(),
    )

    assert response.status_code == 503

    metric_res = client.get("/metrics/fallbacks")
    assert metric_res.status_code == 200
    snap = metric_res.json()
    assert snap["cloud_escape_blocked_total"] >= 1


def test_chain_order_can_be_changed_by_config_file(tmp_path: Path, monkeypatch) -> None:
    metrics.reset()
    override = {
        "chain": [
            {
                "name": "lightweight-first",
                "provider": "vllm-node-a",
                "model": "qwen3.5-7b",
                "timeout_seconds": 10,
                "enabled": True,
                "allowed_classifications": ["public", "internal", "confidential", "restricted"],
            },
            {
                "name": "last_resort",
                "provider": "openrouter",
                "model": "qwen/qwen-2.5-72b-instruct",
                "timeout_seconds": 60,
                "enabled": True,
                "allowed_classifications": ["public", "internal", "confidential"],
            },
        ]
    }
    cfg = tmp_path / "fallback.json"
    cfg.write_text(json.dumps(override), encoding="utf-8")
    monkeypatch.setenv("LLM_GATEWAY_FALLBACK_CHAIN_CONFIG", str(cfg))

    client = TestClient(create_app())
    response = client.post("/v1/chat/completions", json=_base_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["fallback"]["stage"] == "lightweight-first"
