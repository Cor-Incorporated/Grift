"""Tests for embedding provider safeguards."""

from __future__ import annotations

import pytest

from intelligence_worker.embedding import OpenAIEmbeddingProvider


def test_validate_dimensions_raises_when_vector_length_differs() -> None:
    provider = OpenAIEmbeddingProvider(api_key="test", embedding_dimensions=3)
    with pytest.raises(ValueError, match="dimension mismatch"):
        provider.validate_dimensions([[0.1, 0.2]])


def test_validate_dimensions_accepts_matching_vectors() -> None:
    provider = OpenAIEmbeddingProvider(api_key="test", embedding_dimensions=2)
    provider.validate_dimensions([[0.1, 0.2], [0.3, 0.4]])
