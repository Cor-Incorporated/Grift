"""Base protocol for LLM provider adapters."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


@dataclass(slots=True)
class StreamChunk:
    """A single chunk from a streaming LLM response."""

    content: str
    finish_reason: str | None = None


@dataclass(slots=True)
class ProviderResponse:
    """Complete (non-streaming) LLM response."""

    content: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    finish_reason: str = "stop"
    raw: dict = field(default_factory=dict)


@runtime_checkable
class LLMProvider(Protocol):
    """Protocol that all provider adapters must implement."""

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        model: str,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout: float = 30.0,
    ) -> ProviderResponse: ...

    def stream(
        self,
        messages: list[dict[str, str]],
        *,
        model: str,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout: float = 30.0,
    ) -> AsyncIterator[StreamChunk]: ...
