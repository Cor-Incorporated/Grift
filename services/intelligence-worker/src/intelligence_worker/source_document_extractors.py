"""Source document text extraction for PDF / URL / ZIP inputs."""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Protocol

import httpx
import pdfplumber
from bs4 import BeautifulSoup

DEFAULT_MAX_SOURCE_BYTES = 20 * 1024 * 1024


class HttpClient(Protocol):
    """Minimal HTTP client contract."""

    def get(self, url: str, *, timeout: float) -> httpx.Response: ...


@dataclass(frozen=True)
class ExtractedText:
    """Extracted text and metadata."""

    text: str
    metadata: dict[str, str]


class SourceDocumentExtractor:
    """Extract text from source documents with basic guardrails."""

    def __init__(
        self,
        *,
        http_client: HttpClient | None = None,
        max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES,
    ) -> None:
        self._http = http_client or httpx.Client(follow_redirects=True)
        self._max_source_bytes = max_source_bytes

    def extract_pdf(self, pdf_bytes: bytes) -> ExtractedText:
        """Extract concatenated text from a PDF byte stream."""
        self._guard_size(pdf_bytes)
        if not pdf_bytes:
            raise ValueError("empty file")

        pages: list[str] = []
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                if page_text.strip():
                    pages.append(page_text.strip())

        joined = "\n\n".join(pages).strip()
        if not joined:
            raise ValueError("empty file")

        return ExtractedText(text=joined, metadata={"source_type": "pdf"})

    def extract_url(self, source_url: str) -> ExtractedText:
        """Download and extract visible text from a URL."""
        response = self._http.get(source_url, timeout=20.0)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        title = (soup.title.string or "").strip() if soup.title else ""
        for tag in soup(["head", "script", "style", "noscript"]):
            tag.decompose()

        text = unescape(" ".join(soup.stripped_strings)).strip()
        if not text:
            raise ValueError("empty file")

        return ExtractedText(
            text=text,
            metadata={
                "source_type": "url",
                "source_url": source_url,
                "title": title,
            },
        )

    def extract_zip(self, zip_bytes: bytes) -> ExtractedText:
        """Extract text from supported files inside ZIP content."""
        self._guard_size(zip_bytes)
        if not zip_bytes:
            raise ValueError("empty file")

        extracted_parts: list[str] = []

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                filename = info.filename
                suffix = Path(filename).suffix.lower()

                with archive.open(info) as file_obj:
                    data = file_obj.read()

                self._guard_size(data)

                if suffix in {".txt", ".md", ".json", ".yaml", ".yml", ".csv"}:
                    text = data.decode("utf-8", errors="ignore").strip()
                    if text:
                        extracted_parts.append(text)
                    continue

                if suffix == ".pdf":
                    pdf_text = self.extract_pdf(data).text
                    if pdf_text:
                        extracted_parts.append(pdf_text)

        joined = "\n\n".join(extracted_parts).strip()
        if not joined:
            raise ValueError("empty file")

        return ExtractedText(text=joined, metadata={"source_type": "zip"})

    def extract_plain_text(self, raw_bytes: bytes) -> ExtractedText:
        """Decode plain text-like files."""
        self._guard_size(raw_bytes)
        text = raw_bytes.decode("utf-8", errors="ignore").strip()
        if not text:
            raise ValueError("empty file")
        return ExtractedText(text=text, metadata={"source_type": "plain_text"})

    def _guard_size(self, data: bytes) -> None:
        if len(data) > self._max_source_bytes:
            raise ValueError("file too large")
