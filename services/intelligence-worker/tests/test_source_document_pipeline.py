"""Tests for source document ingestion pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import pytest

from intelligence_worker.source_document_extractors import ExtractedText
from intelligence_worker.source_document_pipeline import SourceDocumentIngestionPipeline

if TYPE_CHECKING:
    from intelligence_worker.chunking import TextChunk


@dataclass
class _FakeExtractor:
    text: str = "token " * 700

    def extract_url(self, _source_url: str) -> ExtractedText:
        return ExtractedText(text=self.text, metadata={})

    def extract_pdf(self, _raw: bytes) -> ExtractedText:
        return ExtractedText(text=self.text, metadata={})

    def extract_zip(self, _raw: bytes) -> ExtractedText:
        return ExtractedText(text=self.text, metadata={})

    def extract_plain_text(self, _raw: bytes) -> ExtractedText:
        return ExtractedText(text=self.text, metadata={})


@dataclass
class _FakeEmbeddingProvider:
    embedding_model_version: str = "text-embedding-3-small"
    embedding_dimensions: int = 3

    def embed(self, texts: list[str], *, namespace: str) -> list[list[float]]:
        _ = namespace
        return [[0.1, 0.2, 0.3] for _ in texts]


@dataclass
class _MismatchedEmbeddingProvider(_FakeEmbeddingProvider):
    def embed(self, texts: list[str], *, namespace: str) -> list[list[float]]:
        _ = namespace
        return [[0.1, 0.2] for _ in texts]


@dataclass
class _FakeBlobReader:
    payload: bytes = b"dummy"

    def read_bytes(self, _path: str) -> bytes:
        return self.payload


@dataclass
class _FakeRepository:
    stored_calls: list[tuple[str, str, int]] = field(default_factory=list)
    status_calls: list[tuple[str, str, str, str | None]] = field(default_factory=list)

    def store_chunks_and_embeddings(
        self,
        *,
        tenant_id: str,
        source_document_id: str,
        chunks: list[TextChunk],
        vectors: list[list[float]],
        embedding_model_version: str,
        embedding_dimensions: int,
        namespace: str,
    ) -> None:
        _ = vectors, embedding_model_version, embedding_dimensions, namespace
        self.stored_calls.append((tenant_id, source_document_id, len(chunks)))

    def update_source_document_status(
        self,
        *,
        tenant_id: str,
        source_document_id: str,
        status: str,
        analysis_error: str | None,
    ) -> None:
        self.status_calls.append(
            (tenant_id, source_document_id, status, analysis_error)
        )


def _event_payload(source_kind: str = "website_url") -> dict[str, object]:
    return {
        "event_type": "source.document.uploaded",
        "payload": {
            "tenant_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "case_id": "11111111-2222-3333-4444-555555555555",
            "source_document_id": "66666666-7777-8888-9999-000000000000",
            "source_kind": source_kind,
            "source_url": "https://example.com/doc",
            "gcs_path": "tenant/case/doc/file.pdf",
            "file_type": "application/pdf",
            "file_name": "file.pdf",
        },
    }


def test_pipeline_processes_url_and_marks_completed() -> None:
    repository = _FakeRepository()
    pipeline = SourceDocumentIngestionPipeline(
        extractor=_FakeExtractor(),
        embedding_provider=_FakeEmbeddingProvider(),
        repository=repository,
        blob_reader=_FakeBlobReader(),
    )

    pipeline.process(_event_payload("website_url"))

    assert len(repository.stored_calls) == 1
    tenant_id, source_document_id, chunk_count = repository.stored_calls[0]
    assert tenant_id == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    assert source_document_id == "66666666-7777-8888-9999-000000000000"
    assert chunk_count >= 2
    assert repository.status_calls[-1][2] == "completed"


def test_pipeline_process_safely_marks_failed_on_error() -> None:
    repository = _FakeRepository()
    pipeline = SourceDocumentIngestionPipeline(
        extractor=_FakeExtractor(text="too short"),
        embedding_provider=_MismatchedEmbeddingProvider(),
        repository=repository,
        blob_reader=_FakeBlobReader(),
    )

    with pytest.raises(ValueError, match="dimension mismatch"):
        pipeline.process_safely(_event_payload("website_url"))

    assert repository.status_calls[-1][2] == "failed"
    assert repository.status_calls[-1][3] is not None


def test_pipeline_requires_blob_reader_for_file_upload() -> None:
    pipeline = SourceDocumentIngestionPipeline(
        extractor=_FakeExtractor(),
        embedding_provider=_FakeEmbeddingProvider(),
        repository=_FakeRepository(),
        blob_reader=None,
    )

    with pytest.raises(ValueError, match="blob reader"):
        pipeline.process(_event_payload("file_upload"))
