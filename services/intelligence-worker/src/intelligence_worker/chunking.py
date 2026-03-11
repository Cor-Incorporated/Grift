"""Chunking utilities for source document ingestion."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

DEFAULT_CHUNK_TOKENS = 512
DEFAULT_CHUNK_OVERLAP_TOKENS = 64


@dataclass(frozen=True)
class TextChunk:
    """A token-window chunk derived from extracted source text."""

    chunk_index: int
    content: str
    token_count: int
    content_sha256: str


def tokenize(text: str) -> list[str]:
    """Tokenize text using a whitespace approximation."""
    cleaned = " ".join(text.split())
    if not cleaned:
        return []
    return cleaned.split(" ")


def build_chunks(
    text: str,
    *,
    chunk_tokens: int = DEFAULT_CHUNK_TOKENS,
    overlap_tokens: int = DEFAULT_CHUNK_OVERLAP_TOKENS,
) -> list[TextChunk]:
    """Build overlapping chunks from text.

    The implementation intentionally uses a deterministic whitespace-token window so
    chunk boundaries are stable across retries.
    """
    if chunk_tokens <= 0:
        raise ValueError("chunk_tokens must be > 0")
    if overlap_tokens < 0:
        raise ValueError("overlap_tokens must be >= 0")
    if overlap_tokens >= chunk_tokens:
        raise ValueError("overlap_tokens must be smaller than chunk_tokens")

    tokens = tokenize(text)
    if not tokens:
        raise ValueError("empty text")

    step = chunk_tokens - overlap_tokens
    chunks: list[TextChunk] = []
    start = 0
    index = 0

    while start < len(tokens):
        window = tokens[start : start + chunk_tokens]
        content = " ".join(window)
        chunks.append(
            TextChunk(
                chunk_index=index,
                content=content,
                token_count=len(window),
                content_sha256=hashlib.sha256(content.encode("utf-8")).hexdigest(),
            )
        )
        if start + chunk_tokens >= len(tokens):
            break
        start += step
        index += 1

    return chunks
