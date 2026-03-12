"""Tests for intelligence_worker.source_document_repository module."""

from __future__ import annotations

import hashlib
import uuid
from unittest.mock import MagicMock

import pytest

from intelligence_worker.chunking import TextChunk
from intelligence_worker.source_document_repository import (
    PsycopgSourceDocumentRepository,
)

TENANT_ID = str(uuid.uuid4())
SOURCE_DOC_ID = str(uuid.uuid4())


def _make_chunk(index: int, content: str) -> TextChunk:
    """Create a TextChunk with deterministic sha256."""
    return TextChunk(
        chunk_index=index,
        content=content,
        token_count=len(content.split()),
        content_sha256=hashlib.sha256(content.encode("utf-8")).hexdigest(),
    )


class TestStoreChunksAndEmbeddings:
    """Tests for chunk and embedding persistence."""

    def test_raises_on_length_mismatch(self) -> None:
        """Mismatched chunks and vectors lengths raise ValueError."""
        repo = PsycopgSourceDocumentRepository(connection=MagicMock())

        with pytest.raises(ValueError, match="length mismatch"):
            repo.store_chunks_and_embeddings(
                tenant_id=TENANT_ID,
                source_document_id=SOURCE_DOC_ID,
                chunks=[_make_chunk(0, "hello world")],
                vectors=[],
                embedding_model_version="v1",
                embedding_dimensions=3,
                namespace="test",
            )

    def test_inserts_chunk_and_embedding_rows(self) -> None:
        """Each chunk produces one document_chunks + one chunk_embeddings INSERT."""
        mock_cursor = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

        repo = PsycopgSourceDocumentRepository(connection=mock_conn)
        chunks = [_make_chunk(0, "hello world"), _make_chunk(1, "foo bar")]
        vectors = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]

        repo.store_chunks_and_embeddings(
            tenant_id=TENANT_ID,
            source_document_id=SOURCE_DOC_ID,
            chunks=chunks,
            vectors=vectors,
            embedding_model_version="text-embedding-3-small",
            embedding_dimensions=3,
            namespace="customer_docs",
        )

        # 2 chunks * 2 inserts each = 4 execute calls
        assert mock_cursor.execute.call_count == 4
        mock_conn.commit.assert_called_once()

    def test_vector_literal_format(self) -> None:
        """Vector is formatted as '[0.1,0.2,0.3]' string for pgvector."""
        mock_cursor = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

        repo = PsycopgSourceDocumentRepository(connection=mock_conn)

        repo.store_chunks_and_embeddings(
            tenant_id=TENANT_ID,
            source_document_id=SOURCE_DOC_ID,
            chunks=[_make_chunk(0, "test")],
            vectors=[[0.1, 0.2, 0.3]],
            embedding_model_version="v1",
            embedding_dimensions=3,
            namespace="ns",
        )

        # The second execute call is the embedding insert
        embedding_call = mock_cursor.execute.call_args_list[1]
        params = embedding_call[0][1]
        # The vector_literal is the 7th param (index 6)
        vector_literal = params[6]
        assert vector_literal == "[0.1,0.2,0.3]"


class TestUpdateSourceDocumentStatus:
    """Tests for status update persistence."""

    def test_updates_status_to_completed(self) -> None:
        """Status update executes UPDATE with correct parameters."""
        mock_cursor = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

        repo = PsycopgSourceDocumentRepository(connection=mock_conn)

        repo.update_source_document_status(
            tenant_id=TENANT_ID,
            source_document_id=SOURCE_DOC_ID,
            status="completed",
            analysis_error=None,
        )

        mock_cursor.execute.assert_called_once()
        params = mock_cursor.execute.call_args[0][1]
        assert params[0] == "completed"
        assert params[1] is None
        mock_conn.commit.assert_called_once()

    def test_updates_status_to_failed_with_error(self) -> None:
        """Failed status includes analysis_error string."""
        mock_cursor = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

        repo = PsycopgSourceDocumentRepository(connection=mock_conn)

        repo.update_source_document_status(
            tenant_id=TENANT_ID,
            source_document_id=SOURCE_DOC_ID,
            status="failed",
            analysis_error="extraction timeout",
        )

        params = mock_cursor.execute.call_args[0][1]
        assert params[0] == "failed"
        assert params[1] == "extraction timeout"
