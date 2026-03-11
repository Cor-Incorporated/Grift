from __future__ import annotations

import json

from fastapi.testclient import TestClient

from llm_gateway.main import create_app


def test_chat_completion_buffered_defaults_to_restricted() -> None:
    client = TestClient(create_app())

    response = client.post(
        "/v1/chat/completions",
        json={
            "model": "stub",
            "messages": [{"role": "user", "content": "hello"}],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "chat.completion"
    assert body["data_classification"] == "restricted"


def test_chat_completion_stream_returns_ndjson_chunks() -> None:
    client = TestClient(create_app())

    response = client.post(
        "/v1/chat/completions",
        headers={"X-Data-Classification": "internal"},
        json={
            "model": "stub",
            "messages": [{"role": "user", "content": "hello"}],
            "stream": True,
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")

    lines = [line for line in response.text.strip().splitlines() if line]
    assert len(lines) >= 2
    first = json.loads(lines[0])
    last = json.loads(lines[-1])

    assert first["type"] == "content"
    assert first["data_classification"] == "internal"
    assert last["type"] == "done"
    assert last["event_type"] == "conversation.turn.completed"
