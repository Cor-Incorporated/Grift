"""Source document chunking + embedding pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from intelligence_worker.chunking import build_chunks

if TYPE_CHECKING:
    from intelligence_worker.embedding import EmbeddingProvider
    from intelligence_worker.source_document_extractors import SourceDocumentExtractor
    from intelligence_worker.source_document_repository import SourceDocumentRepository


class BlobReader(Protocol):
    """Object storage read contract for uploaded source documents."""

    def read_bytes(self, path: str) -> bytes: ...


@dataclass(frozen=True)
class SourceDocumentEvent:
    """Normalized event payload for source document ingestion."""

    event_type: str
    tenant_id: str
    case_id: str
    source_document_id: str
    source_kind: str
    file_name: str | None
    file_type: str | None
    source_url: str | None
    gcs_path: str | None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> SourceDocumentEvent:
        event_type = _extract_event_type(payload)
        body = payload.get("payload")
        if not isinstance(body, dict):
            body = payload

        return cls(
            event_type=event_type,
            tenant_id=_required_str(body, "tenant_id"),
            case_id=_required_str(body, "case_id"),
            source_document_id=_required_str(body, "source_document_id"),
            source_kind=_required_str(body, "source_kind"),
            file_name=_optional_str(body, "file_name"),
            file_type=_optional_str(body, "file_type"),
            source_url=_optional_str(body, "source_url"),
            gcs_path=_optional_str(body, "gcs_path"),
        )


class SourceDocumentIngestionPipeline:
    """Orchestrates extraction, chunking, embedding, and persistence."""

    NAMESPACE = "customer_docs"

    def __init__(
        self,
        *,
        extractor: SourceDocumentExtractor,
        embedding_provider: EmbeddingProvider,
        repository: SourceDocumentRepository,
        blob_reader: BlobReader | None = None,
        chunk_tokens: int = 512,
        overlap_tokens: int = 64,
    ) -> None:
        self._extractor = extractor
        self._embedding_provider = embedding_provider
        self._repository = repository
        self._blob_reader = blob_reader
        self._chunk_tokens = chunk_tokens
        self._overlap_tokens = overlap_tokens

    def process(self, payload: dict[str, Any]) -> None:
        event = SourceDocumentEvent.from_payload(payload)
        text = self._extract_text(event)
        chunks = build_chunks(
            text,
            chunk_tokens=self._chunk_tokens,
            overlap_tokens=self._overlap_tokens,
        )
        vectors = self._embedding_provider.embed(
            [chunk.content for chunk in chunks],
            namespace=self.NAMESPACE,
        )
        if len(vectors) != len(chunks):
            raise ValueError("chunks and vectors length mismatch")
        for vector in vectors:
            if len(vector) != self._embedding_provider.embedding_dimensions:
                raise ValueError(
                    "embedding dimension mismatch: "
                    f"expected={self._embedding_provider.embedding_dimensions} "
                    f"got={len(vector)}"
                )

        self._repository.store_chunks_and_embeddings(
            tenant_id=event.tenant_id,
            source_document_id=event.source_document_id,
            chunks=chunks,
            vectors=vectors,
            embedding_model_version=self._embedding_provider.embedding_model_version,
            embedding_dimensions=self._embedding_provider.embedding_dimensions,
            namespace=self.NAMESPACE,
        )
        self._repository.update_source_document_status(
            tenant_id=event.tenant_id,
            source_document_id=event.source_document_id,
            status="completed",
            analysis_error=None,
        )

    def process_safely(self, payload: dict[str, Any]) -> None:
        event = SourceDocumentEvent.from_payload(payload)
        try:
            self.process(payload)
        except Exception as exc:
            self._repository.update_source_document_status(
                tenant_id=event.tenant_id,
                source_document_id=event.source_document_id,
                status="failed",
                analysis_error=str(exc),
            )
            raise

    def _extract_text(self, event: SourceDocumentEvent) -> str:
        if event.source_kind in {"repository_url", "website_url"}:
            if not event.source_url:
                raise ValueError("source_url is required")
            return self._extractor.extract_url(event.source_url).text

        if event.source_kind == "file_upload":
            if not self._blob_reader:
                raise ValueError("blob reader not configured")
            if not event.gcs_path:
                raise ValueError("gcs_path is required")
            raw = self._blob_reader.read_bytes(event.gcs_path)

            suffix = ""
            if event.file_name:
                suffix = Path(event.file_name).suffix.lower()
            content_type = (event.file_type or "").lower()

            if suffix == ".pdf" or "pdf" in content_type:
                return self._extractor.extract_pdf(raw).text
            if suffix == ".zip" or "zip" in content_type:
                return self._extractor.extract_zip(raw).text
            return self._extractor.extract_plain_text(raw).text

        raise ValueError(f"unsupported source_kind: {event.source_kind}")


def _extract_event_type(payload: dict[str, Any]) -> str:
    value = payload.get("event_type")
    if isinstance(value, str):
        return value
    value = payload.get("event_name")
    if isinstance(value, str):
        return value
    return ""


def _required_str(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"missing required field: {key}")
    return value.strip()


def _optional_str(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None
