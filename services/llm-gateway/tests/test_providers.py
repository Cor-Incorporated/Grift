from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from llm_gateway.providers.base import StreamChunk
from llm_gateway.providers.openai_compat import OpenAICompatProvider


def _run(coro):
    return asyncio.run(coro)


async def _collect(stream):
    return [chunk async for chunk in stream]


class StubResponse:
    def __init__(self, payload: dict, exc: Exception | None = None) -> None:
        self._payload = payload
        self._exc = exc

    def raise_for_status(self) -> None:
        if self._exc is not None:
            raise self._exc

    def json(self) -> dict:
        return self._payload


class StubStreamResponse:
    def __init__(self, lines: list[str], exc: Exception | None = None) -> None:
        self._lines = lines
        self._exc = exc

    async def __aenter__(self) -> StubStreamResponse:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    def raise_for_status(self) -> None:
        if self._exc is not None:
            raise self._exc

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class StubAsyncClient:
    def __init__(
        self,
        *,
        response: StubResponse | None = None,
        response_exc: Exception | None = None,
        stream_response: StubStreamResponse | None = None,
        timeout: float | None = None,
    ) -> None:
        self._response = response
        self._response_exc = response_exc
        self._stream_response = stream_response
        self.timeout = timeout
        self.post_calls: list[dict] = []
        self.stream_calls: list[dict] = []

    async def __aenter__(self) -> StubAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def post(self, url: str, *, json: dict, headers: dict[str, str]):
        self.post_calls.append({"url": url, "json": json, "headers": headers})
        if self._response_exc is not None:
            raise self._response_exc
        assert self._response is not None
        return self._response

    def stream(
        self, method: str, url: str, *, json: dict, headers: dict[str, str]
    ) -> StubStreamResponse:
        self.stream_calls.append(
            {"method": method, "url": url, "json": json, "headers": headers}
        )
        assert self._stream_response is not None
        return self._stream_response


def test_complete_returns_provider_response(monkeypatch: pytest.MonkeyPatch) -> None:
    client = StubAsyncClient(
        response=StubResponse(
            {
                "model": "gpt-test",
                "choices": [
                    {
                        "message": {"content": "hello from provider"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 11, "completion_tokens": 7},
            }
        ),
        timeout=12.5,
    )
    monkeypatch.setattr(
        "llm_gateway.providers.openai_compat.httpx.AsyncClient",
        lambda timeout: client,
    )

    provider = OpenAICompatProvider("https://example.test", api_key="secret")
    result = _run(
        provider.complete(
            [{"role": "user", "content": "hello"}],
            model="gpt-test",
            temperature=0.1,
            max_tokens=64,
            timeout=12.5,
        )
    )

    assert result.content == "hello from provider"
    assert result.model == "gpt-test"
    assert result.prompt_tokens == 11
    assert result.completion_tokens == 7
    assert client.post_calls == [
        {
            "url": "https://example.test/v1/chat/completions",
            "json": {
                "model": "gpt-test",
                "messages": [{"role": "user", "content": "hello"}],
                "temperature": 0.1,
                "stream": False,
                "max_tokens": 64,
            },
            "headers": {
                "Content-Type": "application/json",
                "Authorization": "Bearer secret",
            },
        }
    ]


def test_complete_raises_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    request = httpx.Request("POST", "https://example.test/v1/chat/completions")
    response = httpx.Response(503, request=request)
    client = StubAsyncClient(
        response=StubResponse(
            {},
            exc=httpx.HTTPStatusError(
                "upstream failed", request=request, response=response
            ),
        )
    )
    monkeypatch.setattr(
        "llm_gateway.providers.openai_compat.httpx.AsyncClient",
        lambda timeout: client,
    )

    provider = OpenAICompatProvider("https://example.test")

    with pytest.raises(httpx.HTTPStatusError):
        _run(
            provider.complete([{"role": "user", "content": "hello"}], model="gpt-test")
        )


def test_complete_raises_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    client = StubAsyncClient(response_exc=httpx.ReadTimeout("timed out"))
    monkeypatch.setattr(
        "llm_gateway.providers.openai_compat.httpx.AsyncClient",
        lambda timeout: client,
    )

    provider = OpenAICompatProvider("https://example.test")

    with pytest.raises(httpx.ReadTimeout):
        _run(
            provider.complete([{"role": "user", "content": "hello"}], model="gpt-test")
        )


def test_stream_parses_sse_chunks_until_done(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lines = [
        ": keep-alive",
        "data: "
        + json.dumps(
            {"choices": [{"delta": {"content": "hel"}, "finish_reason": None}]}
        ),
        "data: "
        + json.dumps(
            {"choices": [{"delta": {"content": "lo"}, "finish_reason": None}]}
        ),
        "data: " + json.dumps({"choices": [{"delta": {}, "finish_reason": "stop"}]}),
        "data: [DONE]",
        "data: "
        + json.dumps(
            {
                "choices": [
                    {"delta": {"content": "ignored after done"}, "finish_reason": None}
                ]
            }
        ),
    ]
    client = StubAsyncClient(stream_response=StubStreamResponse(lines))
    monkeypatch.setattr(
        "llm_gateway.providers.openai_compat.httpx.AsyncClient",
        lambda timeout: client,
    )

    provider = OpenAICompatProvider("https://example.test", api_key="secret")
    chunks = _run(
        _collect(
            provider.stream(
                [{"role": "user", "content": "hello"}],
                model="gpt-test",
                temperature=0.2,
                max_tokens=32,
                timeout=4.0,
            )
        )
    )

    assert chunks == [
        StreamChunk(content="hel", finish_reason=None),
        StreamChunk(content="lo", finish_reason=None),
        StreamChunk(content="", finish_reason="stop"),
    ]
    assert client.stream_calls == [
        {
            "method": "POST",
            "url": "https://example.test/v1/chat/completions",
            "json": {
                "model": "gpt-test",
                "messages": [{"role": "user", "content": "hello"}],
                "temperature": 0.2,
                "stream": True,
                "max_tokens": 32,
            },
            "headers": {
                "Content-Type": "application/json",
                "Authorization": "Bearer secret",
            },
        }
    ]


def test_stream_skips_malformed_chunks(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    client = StubAsyncClient(
        stream_response=StubStreamResponse(
            [
                "data: not-json",
                "data: "
                + json.dumps(
                    {"choices": [{"delta": {"content": "ok"}, "finish_reason": None}]}
                ),
                "data: [DONE]",
            ]
        )
    )
    monkeypatch.setattr(
        "llm_gateway.providers.openai_compat.httpx.AsyncClient",
        lambda timeout: client,
    )

    provider = OpenAICompatProvider("https://example.test")
    chunks = _run(_collect(provider.stream([], model="gpt-test")))

    assert chunks == [StreamChunk(content="ok", finish_reason=None)]
    assert "skipping malformed SSE chunk" in caplog.text
