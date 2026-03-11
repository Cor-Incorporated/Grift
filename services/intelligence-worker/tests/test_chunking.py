"""Tests for chunking behavior."""

from __future__ import annotations

import pytest

from intelligence_worker.chunking import build_chunks


def test_build_chunks_uses_overlap() -> None:
    words = [f"w{i}" for i in range(20)]
    text = " ".join(words)

    chunks = build_chunks(text, chunk_tokens=8, overlap_tokens=2)

    assert len(chunks) == 3
    assert chunks[0].token_count == 8
    assert chunks[1].token_count == 8
    assert chunks[2].token_count == 8
    assert chunks[0].content.split()[6:] == chunks[1].content.split()[:2]


def test_build_chunks_rejects_empty_text() -> None:
    with pytest.raises(ValueError, match="empty text"):
        build_chunks("   ", chunk_tokens=8, overlap_tokens=2)


def test_build_chunks_rejects_invalid_overlap() -> None:
    with pytest.raises(ValueError, match="smaller"):
        build_chunks("hello world", chunk_tokens=4, overlap_tokens=4)
