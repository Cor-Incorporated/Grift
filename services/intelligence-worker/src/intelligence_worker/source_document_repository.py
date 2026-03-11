"""Repository for document_chunks and chunk_embeddings persistence."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from intelligence_worker.chunking import TextChunk


class SourceDocumentRepository(Protocol):
    """Persistence contract for source document ingestion pipeline."""

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
    ) -> None: ...

    def update_source_document_status(
        self,
        *,
        tenant_id: str,
        source_document_id: str,
        status: str,
        analysis_error: str | None,
    ) -> None: ...


@dataclass
class PsycopgSourceDocumentRepository:
    """Psycopg-backed repository for chunk + embedding writes."""

    connection: object

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
        if len(chunks) != len(vectors):
            raise ValueError("chunks and vectors length mismatch")

        tenant = uuid.UUID(tenant_id)
        source_id = uuid.UUID(source_document_id)

        with self.connection.cursor() as cur:
            for chunk, vector in zip(chunks, vectors, strict=True):
                chunk_id = uuid.uuid4()
                cur.execute(
                    """
                    INSERT INTO document_chunks (
                      id, tenant_id, namespace, source_type, source_id,
                      chunk_index, content, content_sha256, token_count,
                      metadata_json, chunk_version
                    ) VALUES (
                      %s, %s, %s, %s, %s,
                      %s, %s, %s, %s,
                      %s::jsonb, %s
                    )
                    """,
                    (
                        str(chunk_id),
                        str(tenant),
                        namespace,
                        "source_document",
                        str(source_id),
                        chunk.chunk_index,
                        chunk.content,
                        chunk.content_sha256,
                        chunk.token_count,
                        json.dumps({"source_document_id": str(source_id)}),
                        1,
                    ),
                )

                vector_literal = "[" + ",".join(str(x) for x in vector) + "]"
                cur.execute(
                    """
                    INSERT INTO chunk_embeddings (
                      id, tenant_id, chunk_id, namespace,
                      embedding_model_version, embedding_dimensions,
                      vector, is_active
                    ) VALUES (
                      %s, %s, %s, %s,
                      %s, %s,
                      %s::vector, true
                    )
                    """,
                    (
                        str(uuid.uuid4()),
                        str(tenant),
                        str(chunk_id),
                        namespace,
                        embedding_model_version,
                        embedding_dimensions,
                        vector_literal,
                    ),
                )

        self.connection.commit()

    def update_source_document_status(
        self,
        *,
        tenant_id: str,
        source_document_id: str,
        status: str,
        analysis_error: str | None,
    ) -> None:
        with self.connection.cursor() as cur:
            cur.execute(
                """
                UPDATE source_documents
                SET status = %s,
                    analysis_error = %s,
                    analyzed_at = CASE
                      WHEN %s = 'completed' THEN now()
                      ELSE analyzed_at
                    END,
                    updated_at = now()
                WHERE tenant_id = %s AND id = %s
                """,
                (status, analysis_error, status, tenant_id, source_document_id),
            )
        self.connection.commit()
