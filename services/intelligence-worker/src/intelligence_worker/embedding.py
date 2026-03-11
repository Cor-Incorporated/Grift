"""Embedding provider abstractions and OpenAI implementation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import httpx


class EmbeddingProvider(Protocol):
    """Provider abstraction from ADR-0008."""

    embedding_model_version: str
    embedding_dimensions: int

    def embed(self, texts: list[str], *, namespace: str) -> list[list[float]]: ...


@dataclass(frozen=True)
class OpenAIEmbeddingProvider:
    """OpenAI embedding provider using `text-embedding-3-small` by default."""

    api_key: str
    embedding_model_version: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    endpoint: str = "https://api.openai.com/v1/embeddings"
    timeout_seconds: float = 30.0

    def embed(self, texts: list[str], *, namespace: str) -> list[list[float]]:
        if not texts:
            return []

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.embedding_model_version,
            "input": texts,
            # Namespace is persisted at DB-layer; this call remains model-only.
            "encoding_format": "float",
        }

        response = httpx.post(
            self.endpoint,
            json=payload,
            headers=headers,
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        body = response.json()

        raw_items = body.get("data")
        if not isinstance(raw_items, list):
            raise ValueError("invalid embedding response: missing data")

        sorted_items = sorted(raw_items, key=lambda item: item.get("index", 0))
        vectors: list[list[float]] = []
        for item in sorted_items:
            embedding = item.get("embedding")
            if not isinstance(embedding, list) or not embedding:
                raise ValueError("invalid embedding response: missing embedding")
            vector = [float(x) for x in embedding]
            vectors.append(vector)

        self.validate_dimensions(vectors)
        return vectors

    def validate_dimensions(self, vectors: list[list[float]]) -> None:
        for vector in vectors:
            if len(vector) != self.embedding_dimensions:
                raise ValueError(
                    "embedding dimension mismatch: "
                    f"expected={self.embedding_dimensions} got={len(vector)}"
                )
