"""Citation helpers for requirement artifact generation."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_TOKEN_PATTERN = re.compile(r"[0-9A-Za-z][0-9A-Za-z.+_-]*|[一-龯ぁ-んァ-ンー]{2,}")


@dataclass(frozen=True)
class SourceContextChunk:
    """Chunk retrieved from embedded case-related source documents."""

    chunk_id: str
    content: str
    source_document_id: str | None = None
    chunk_index: int | None = None
    content_sha256: str | None = None


@dataclass(frozen=True)
class RequirementArtifactCitation:
    """ADR-0008-compatible citation metadata for one referenced chunk."""

    chunk_id: str
    source_id: str
    chunk_index: int
    offset_start: int
    offset_end: int
    content_sha256: str


def _select_citations(
    *,
    text: str,
    source_chunks: list[SourceContextChunk],
    limit: int = 2,
) -> tuple[RequirementArtifactCitation, ...]:
    usable_chunks = [
        chunk
        for chunk in source_chunks
        if chunk.source_document_id
        and chunk.chunk_index is not None
        and chunk.content_sha256
    ]
    if not usable_chunks:
        return ()

    scored = [
        (_lexical_score(text, chunk.content), index, chunk)
        for index, chunk in enumerate(usable_chunks)
    ]
    scored.sort(key=lambda item: (-item[0], item[1]))
    positive = [chunk for score, _, chunk in scored if score > 0][:limit]
    selected = positive or [chunk for _, _, chunk in scored[: min(limit, len(scored))]]

    return tuple(_chunk_to_citation(chunk=chunk, hint=text) for chunk in selected)


def _chunk_to_citation(
    *,
    chunk: SourceContextChunk,
    hint: str,
) -> RequirementArtifactCitation:
    offset_start, offset_end = _resolve_offsets(chunk.content, hint)
    return RequirementArtifactCitation(
        chunk_id=chunk.chunk_id,
        source_id=chunk.source_document_id or "",
        chunk_index=chunk.chunk_index or 0,
        offset_start=offset_start,
        offset_end=offset_end,
        content_sha256=chunk.content_sha256 or "",
    )


def _resolve_offsets(content: str, hint: str) -> tuple[int, int]:
    if not content:
        return 0, 0

    hint_tokens = _tokenize(hint)
    lower_content = content.lower()
    for token in hint_tokens:
        if len(token) < 2:
            continue
        start = lower_content.find(token.lower())
        if start >= 0:
            return start, start + len(token)
    return 0, 0


def _merge_citations(
    citation_sets: Any,
) -> list[RequirementArtifactCitation]:
    merged: list[RequirementArtifactCitation] = []
    seen: set[tuple[str, int, int]] = set()
    for citations in citation_sets:
        for citation in citations:
            key = (citation.chunk_id, citation.offset_start, citation.offset_end)
            if key in seen:
                continue
            seen.add(key)
            merged.append(citation)
    return merged


def _rank_source_chunks(
    source_chunks: list[SourceContextChunk],
    *,
    query_text: str,
    limit: int,
) -> list[SourceContextChunk]:
    if not source_chunks:
        return []
    if not query_text.strip():
        return source_chunks[:limit]

    scored = [
        (_lexical_score(query_text, chunk.content), index, chunk)
        for index, chunk in enumerate(source_chunks)
    ]
    if all(score <= 0 for score, _, _ in scored):
        return source_chunks[:limit]

    scored.sort(key=lambda item: (-item[0], item[1]))
    return [chunk for _, _, chunk in scored[:limit]]


def _lexical_score(left: str, right: str) -> int:
    left_tokens = set(_tokenize(left))
    right_tokens = set(_tokenize(right))
    if not left_tokens or not right_tokens:
        return 0
    return len(left_tokens & right_tokens)


def _tokenize(text: str) -> tuple[str, ...]:
    return tuple(token.lower() for token in _TOKEN_PATTERN.findall(text))


def _render_cited_text(
    text: str,
    citation_map: dict[str, tuple[RequirementArtifactCitation, ...]],
) -> str:
    citations = citation_map.get(text, ())
    markers = " ".join(f"[chunk:{citation.chunk_id}]" for citation in citations)
    return f"{text} {markers}".strip()


def _render_cited_bullets(
    items: list[str],
    citation_map: dict[str, tuple[RequirementArtifactCitation, ...]],
) -> list[str]:
    return [f"- {item}" for item in _cited_items(items, citation_map)]


def _cited_items(
    items: list[str],
    citation_map: dict[str, tuple[RequirementArtifactCitation, ...]],
) -> list[str]:
    return [_render_cited_text(item, citation_map) for item in items] or [
        "No explicit requirement captured."
    ]


select_citations = _select_citations
chunk_to_citation = _chunk_to_citation
resolve_offsets = _resolve_offsets
merge_citations = _merge_citations
rank_source_chunks = _rank_source_chunks
lexical_score = _lexical_score
tokenize = _tokenize
render_cited_text = _render_cited_text
render_cited_bullets = _render_cited_bullets
