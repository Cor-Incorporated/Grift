"""Tests for intelligence_worker.blob_reader module."""

from __future__ import annotations

import dataclasses
from unittest.mock import MagicMock

import pytest

from intelligence_worker.blob_reader import GCSBlobReader


class TestGCSBlobReader:
    """Tests for the GCS blob reader dataclass."""

    def test_read_bytes_downloads_from_correct_path(self) -> None:
        """read_bytes calls client.bucket().blob().download_as_bytes()."""
        mock_blob = MagicMock()
        mock_blob.download_as_bytes.return_value = b"pdf-content"

        mock_bucket = MagicMock()
        mock_bucket.blob.return_value = mock_blob

        mock_client = MagicMock()
        mock_client.bucket.return_value = mock_bucket

        reader = GCSBlobReader(bucket_name="my-bucket", client=mock_client)
        result = reader.read_bytes("tenant/case/doc.pdf")

        mock_client.bucket.assert_called_once_with("my-bucket")
        mock_bucket.blob.assert_called_once_with("tenant/case/doc.pdf")
        mock_blob.download_as_bytes.assert_called_once()
        assert result == b"pdf-content"

    def test_reader_is_frozen_dataclass(self) -> None:
        """GCSBlobReader is immutable (frozen=True)."""
        mock_client = MagicMock()
        reader = GCSBlobReader(bucket_name="b", client=mock_client)

        assert dataclasses.is_dataclass(reader)
        with pytest.raises(AttributeError):
            reader.bucket_name = "other"  # type: ignore[misc]

    def test_read_bytes_propagates_gcs_exceptions(self) -> None:
        """Exceptions from GCS client propagate to caller."""
        mock_blob = MagicMock()
        mock_blob.download_as_bytes.side_effect = RuntimeError("network error")

        mock_bucket = MagicMock()
        mock_bucket.blob.return_value = mock_blob

        mock_client = MagicMock()
        mock_client.bucket.return_value = mock_bucket

        reader = GCSBlobReader(bucket_name="b", client=mock_client)

        with pytest.raises(RuntimeError, match="network error"):
            reader.read_bytes("path/to/file")
