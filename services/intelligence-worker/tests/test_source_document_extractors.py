"""Tests for PDF/URL/ZIP extraction and file guardrails."""

from __future__ import annotations

import io
import zipfile

import pytest

from intelligence_worker.source_document_extractors import SourceDocumentExtractor


class _FakeResponse:
    def __init__(self, text: str, status_code: int = 200) -> None:
        self.text = text
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError("bad status")


class _FakeHttpClient:
    def __init__(self, html: str) -> None:
        self._html = html

    def get(self, _url: str, *, timeout: float) -> _FakeResponse:
        _ = timeout
        return _FakeResponse(self._html)


def test_extract_url_removes_script_and_style() -> None:
    html = """
    <html><head><title>Doc</title><style>.x{}</style></head>
    <body><script>alert(1)</script><h1>Hello</h1><p>World</p></body></html>
    """
    extractor = SourceDocumentExtractor(http_client=_FakeHttpClient(html))

    extracted = extractor.extract_url("https://example.com")

    assert extracted.text == "Hello World"
    assert extracted.metadata["title"] == "Doc"


def test_extract_zip_reads_supported_text_files() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w") as archive:
        archive.writestr("a.txt", "alpha")
        archive.writestr("nested/b.md", "beta")
        archive.writestr("ignored.bin", b"\x00\x01")

    extractor = SourceDocumentExtractor()
    extracted = extractor.extract_zip(buf.getvalue())

    assert "alpha" in extracted.text
    assert "beta" in extracted.text


def test_extract_pdf_uses_pdfplumber_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakePage:
        def __init__(self, text: str) -> None:
            self._text = text

        def extract_text(self) -> str:
            return self._text

    class _FakePDF:
        def __init__(self) -> None:
            self.pages = [_FakePage("first"), _FakePage("second")]

        def __enter__(self) -> _FakePDF:
            return self

        def __exit__(self, *_: object) -> None:
            return None

    monkeypatch.setattr(
        "intelligence_worker.source_document_extractors.pdfplumber.open",
        lambda _stream: _FakePDF(),
    )

    extractor = SourceDocumentExtractor()
    extracted = extractor.extract_pdf(b"%PDF-fake")

    assert extracted.text == "first\n\nsecond"


def test_extract_plain_text_rejects_empty() -> None:
    extractor = SourceDocumentExtractor()
    with pytest.raises(ValueError, match="empty file"):
        extractor.extract_plain_text(b"   ")


def test_extract_rejects_large_file() -> None:
    extractor = SourceDocumentExtractor(max_source_bytes=4)
    with pytest.raises(ValueError, match="too large"):
        extractor.extract_plain_text(b"12345")
