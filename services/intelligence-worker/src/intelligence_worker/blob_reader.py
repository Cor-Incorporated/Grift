"""Object storage readers for source document payloads."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from google.cloud import storage


@dataclass(frozen=True)
class GCSBlobReader:
    """Reads source document bytes from a configured GCS bucket."""

    bucket_name: str
    client: storage.Client

    def read_bytes(self, path: str) -> bytes:
        blob = self.client.bucket(self.bucket_name).blob(path)
        return blob.download_as_bytes()
