"""OpenAI-compatible provider adapter.

Works with any OpenAI-compatible API: vLLM, OpenRouter, OpenAI, etc.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

import httpx

from llm_gateway.providers.base import ProviderResponse, StreamChunk

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = logging.getLogger(__name__)


class OpenAICompatProvider:
    """Adapter for OpenAI-compatible chat completion APIs."""

    def __init__(self, base_url: str, api_key: str = "") -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        model: str,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout: float = 30.0,
    ) -> ProviderResponse:
        payload: dict = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "stream": False,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{self._base_url}/v1/chat/completions",
                json=payload,
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()

        choice = data["choices"][0]
        usage = data.get("usage", {})
        return ProviderResponse(
            content=choice["message"]["content"],
            model=data.get("model", model),
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            finish_reason=choice.get("finish_reason", "stop"),
            raw=data,
        )

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        model: str,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout: float = 30.0,
    ) -> AsyncIterator[StreamChunk]:
        payload: dict = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        async with (
            httpx.AsyncClient(timeout=timeout) as client,
            client.stream(
                "POST",
                f"{self._base_url}/v1/chat/completions",
                json=payload,
                headers=self._headers(),
            ) as resp,
        ):
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[len("data: ") :]
                if data_str.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                except json.JSONDecodeError:
                    logger.warning(
                        "skipping malformed SSE chunk: %s",
                        data_str[:80],
                    )
                    continue
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                finish = chunk.get("choices", [{}])[0].get("finish_reason")
                if content:
                    yield StreamChunk(content=content, finish_reason=finish)
                elif finish:
                    yield StreamChunk(content="", finish_reason=finish)
