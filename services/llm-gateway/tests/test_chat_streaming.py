from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

import httpx

from llm_gateway.main import create_app
from llm_gateway.providers.base import StreamChunk

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    import pytest


def _run(coro):
    return asyncio.run(coro)


class RecordingEngine:
    def __init__(
        self,
        *,
        chunks: list[StreamChunk] | None = None,
        exc: Exception | None = None,
    ) -> None:
        self._chunks = chunks or []
        self._exc = exc
        self.calls: list[dict] = []

    async def astream(
        self,
        messages: list[dict[str, str]],
        *,
        classification: str,
        temperature: float,
        max_tokens: int | None,
        fail_stages: set[str],
    ) -> tuple[object, AsyncIterator[StreamChunk]]:
        self.calls.append(
            {
                "messages": messages,
                "classification": classification,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "fail_stages": fail_stages,
            }
        )
        if self._exc is not None:
            raise self._exc

        async def _stream() -> AsyncIterator[StreamChunk]:
            for chunk in self._chunks:
                yield chunk

        return object(), _stream()


async def _stream_lines(
    client: httpx.AsyncClient, payload: dict, headers: dict[str, str] | None = None
) -> tuple[httpx.Response, list[str]]:
    async with client.stream(
        "POST",
        "/v1/chat/completions",
        json=payload,
        headers=headers,
    ) as response:
        lines = [line async for line in response.aiter_lines() if line]
    return response, lines


def test_chat_streaming_returns_ndjson_content_and_done(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = RecordingEngine(
        chunks=[
            StreamChunk(content="hello", finish_reason=None),
            StreamChunk(content="", finish_reason="stop"),
        ]
    )
    monkeypatch.setattr(
        "llm_gateway.routes.chat.load_fallback_engine", lambda _: engine
    )

    async def run_test() -> None:
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            response, lines = await _stream_lines(
                client,
                {
                    "model": "stub",
                    "messages": [{"role": "user", "content": "hello"}],
                    "stream": True,
                },
                headers={"X-Data-Classification": "internal"},
            )

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/x-ndjson")
        payloads = [json.loads(line) for line in lines]
        assert payloads == [
            {
                "type": "content",
                "content": "hello",
                "data_classification": "internal",
            },
            {
                "type": "done",
                "done": True,
                "event_type": "conversation.turn.completed",
                "data_classification": "internal",
            },
        ]
        assert engine.calls == [
            {
                "messages": [{"role": "user", "content": "hello"}],
                "classification": "internal",
                "temperature": 0.7,
                "max_tokens": None,
                "fail_stages": set(),
            }
        ]

    _run(run_test())


def test_chat_streaming_emits_error_chunk_then_done(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = RecordingEngine(exc=RuntimeError("provider offline"))
    monkeypatch.setattr(
        "llm_gateway.routes.chat.load_fallback_engine", lambda _: engine
    )

    async def run_test() -> None:
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            response, lines = await _stream_lines(
                client,
                {
                    "model": "stub",
                    "messages": [{"role": "user", "content": "hello"}],
                    "stream": True,
                },
            )

        assert response.status_code == 200
        payloads = [json.loads(line) for line in lines]
        assert payloads == [
            {
                "type": "error",
                "error": "provider offline",
                "data_classification": "restricted",
            },
            {
                "type": "done",
                "done": True,
                "event_type": "conversation.turn.completed",
                "data_classification": "restricted",
            },
        ]

    _run(run_test())
