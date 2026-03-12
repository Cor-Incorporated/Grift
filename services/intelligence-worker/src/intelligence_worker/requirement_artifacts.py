"""Requirement artifact generation and persistence helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

import structlog
from psycopg2 import errors as psycopg_errors  # type: ignore[import-untyped]
from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from intelligence_worker.qa_extraction import ConversationTurn

logger = structlog.get_logger()


@dataclass(frozen=True)
class SourceContextChunk:
    """Chunk retrieved from case-related source documents."""

    chunk_id: str
    content: str
    source_document_id: str | None = None
    chunk_index: int | None = None


@dataclass(frozen=True)
class RequirementArtifactDraft:
    """Version-ready artifact content."""

    markdown: str
    source_chunks: tuple[str, ...]


class StructuredLLMClient(Protocol):
    """LLM abstraction compatible with the worker gateway adapter."""

    def extract_structured(
        self, *, prompt: str, response_schema: dict[str, Any]
    ) -> str: ...


class RequirementArtifactSection(BaseModel):
    title: str = Field(min_length=1)
    bullets: list[str] = Field(default_factory=list)


class RequirementArtifactOutline(BaseModel):
    summary: str = Field(min_length=1)
    functional_requirements: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


_PROMPT_TEMPLATE = """\
You generate a requirement artifact outline for an estimation case.

Conversation:
{conversation}

Retrieved source context:
{source_context}

Return JSON with this schema:
{schema}
"""


class RequirementArtifactGenerator:
    """Build requirement artifact markdown from turns and related source chunks."""

    def __init__(self, llm_client: StructuredLLMClient | None = None) -> None:
        self._llm_client = llm_client

    def generate(
        self,
        *,
        turns: list[ConversationTurn],
        source_chunks: list[SourceContextChunk],
    ) -> RequirementArtifactDraft:
        if self._llm_client is not None:
            try:
                return self._generate_with_llm(turns=turns, source_chunks=source_chunks)
            except Exception as exc:  # noqa: BLE001
                logger.warning("requirement_artifact_llm_failed", error=str(exc))

        return self._generate_fallback(turns=turns, source_chunks=source_chunks)

    def _generate_with_llm(
        self,
        *,
        turns: list[ConversationTurn],
        source_chunks: list[SourceContextChunk],
    ) -> RequirementArtifactDraft:
        llm_client = self._llm_client
        if llm_client is None:
            raise RuntimeError("llm client is required for structured generation")
        prompt = _PROMPT_TEMPLATE.format(
            conversation=_render_turns(turns),
            source_context=_render_source_context(source_chunks),
            schema=json.dumps(
                RequirementArtifactOutline.model_json_schema(),
                ensure_ascii=False,
            ),
        )
        raw = llm_client.extract_structured(
            prompt=prompt,
            response_schema=RequirementArtifactOutline.model_json_schema(),
        )
        outline = RequirementArtifactOutline.model_validate_json(raw)
        markdown = _render_markdown(
            outline=outline,
            turns=turns,
            source_chunks=source_chunks,
        )
        return RequirementArtifactDraft(
            markdown=markdown,
            source_chunks=_ordered_chunk_ids(source_chunks),
        )

    def _generate_fallback(
        self,
        *,
        turns: list[ConversationTurn],
        source_chunks: list[SourceContextChunk],
    ) -> RequirementArtifactDraft:
        user_turns = [turn.content.strip() for turn in turns if turn.role == "user"]
        assistant_turns = [
            turn.content.strip() for turn in turns if turn.role == "assistant"
        ]
        outline = RequirementArtifactOutline(
            summary=(
                user_turns[-1]
                if user_turns
                else "No user requirements captured yet."
            ),
            functional_requirements=_limit_items(user_turns, 4),
            constraints=_limit_items(assistant_turns, 3),
            open_questions=_infer_open_questions(turns),
        )
        markdown = _render_markdown(
            outline=outline,
            turns=turns,
            source_chunks=source_chunks,
        )
        return RequirementArtifactDraft(
            markdown=markdown,
            source_chunks=_ordered_chunk_ids(source_chunks),
        )


class RequirementArtifactRepository:
    """Persist versioned requirement artifacts."""

    def __init__(self, conn_manager: ConnectionManager) -> None:
        self._conn_manager = conn_manager

    def load_source_chunks(
        self,
        *,
        tenant_id: str,
        case_id: str,
        limit: int = 6,
    ) -> list[SourceContextChunk]:
        try:
            with (
                self._conn_manager.get_connection(tenant_id) as conn,
                conn,
                conn.cursor() as cur,
            ):
                cur.execute(
                    """
                        SELECT
                            dc.id::text,
                            dc.content,
                            dc.source_id::text,
                            dc.chunk_index
                        FROM source_documents sd
                        JOIN document_chunks dc
                          ON dc.tenant_id = sd.tenant_id
                         AND dc.source_id = sd.id
                        WHERE sd.tenant_id = %s
                          AND sd.case_id = %s
                          AND dc.namespace = 'customer_docs'
                        ORDER BY sd.created_at DESC, dc.chunk_index ASC
                        LIMIT %s
                        """,
                    (tenant_id, case_id, limit),
                )
                return [
                    SourceContextChunk(
                        chunk_id=chunk_id,
                        content=content,
                        source_document_id=source_document_id,
                        chunk_index=chunk_index,
                    )
                    for (
                        chunk_id,
                        content,
                        source_document_id,
                        chunk_index,
                    ) in cur.fetchall()
                ]
        except psycopg_errors.UndefinedTable:
            logger.warning("requirement_artifact_context_missing_tables")
            return []

    def save_artifact(
        self,
        *,
        tenant_id: str,
        case_id: str,
        draft: RequirementArtifactDraft,
        created_by_uid: str | None = None,
    ) -> int | None:
        try:
            with (
                self._conn_manager.get_connection(tenant_id) as conn,
                conn,
                conn.cursor() as cur,
            ):
                cur.execute(
                    """
                        SELECT COALESCE(MAX(version), 0) + 1
                        FROM requirement_artifacts
                        WHERE tenant_id = %s AND case_id = %s
                        """,
                    (tenant_id, case_id),
                )
                next_version = int(cur.fetchone()[0])
                cur.execute(
                    """
                        INSERT INTO requirement_artifacts (
                            tenant_id,
                            case_id,
                            version,
                            markdown,
                            source_chunks,
                            status,
                            created_by_uid
                        )
                        VALUES (%s, %s, %s, %s, %s::uuid[], 'draft', %s)
                        """,
                    (
                        tenant_id,
                        case_id,
                        next_version,
                        draft.markdown,
                        list(draft.source_chunks),
                        created_by_uid,
                    ),
                )
                return next_version
        except psycopg_errors.UndefinedTable:
            logger.warning("requirement_artifacts_table_missing_skip_persist")
            return None


def _render_turns(turns: list[ConversationTurn]) -> str:
    if not turns:
        return "(no conversation history)"
    return "\n".join(
        f"[turn={turn.turn_number}] {turn.role}: {turn.content}" for turn in turns
    )


def _render_source_context(source_chunks: list[SourceContextChunk]) -> str:
    if not source_chunks:
        return "(no retrieved source chunks)"
    return "\n".join(
        f"[chunk:{chunk.chunk_id}] {chunk.content}" for chunk in source_chunks
    )


def _ordered_chunk_ids(source_chunks: list[SourceContextChunk]) -> tuple[str, ...]:
    seen: set[str] = set()
    ordered: list[str] = []
    for chunk in source_chunks:
        if chunk.chunk_id not in seen:
            seen.add(chunk.chunk_id)
            ordered.append(chunk.chunk_id)
    return tuple(ordered)


def _limit_items(items: list[str], limit: int) -> list[str]:
    cleaned = [item for item in items if item]
    return cleaned[:limit] or ["No explicit requirement captured."]


def _infer_open_questions(turns: list[ConversationTurn]) -> list[str]:
    transcript = "\n".join(turn.content for turn in turns)
    questions: list[str] = []
    if "予算" not in transcript and "budget" not in transcript.lower():
        questions.append("Budget range is still unclear.")
    if "期限" not in transcript and "deadline" not in transcript.lower():
        questions.append("Target timeline still needs confirmation.")
    if "チーム" not in transcript and "team" not in transcript.lower():
        questions.append("Required team composition is still unclear.")
    return questions or ["No major open questions inferred from current transcript."]


def _render_markdown(
    *,
    outline: RequirementArtifactOutline,
    turns: list[ConversationTurn],
    source_chunks: list[SourceContextChunk],
) -> str:
    sections = [
        "# Requirement Artifact",
        "",
        "## Summary",
        outline.summary.strip(),
        "",
        "## Functional Requirements",
        *_render_bullets(outline.functional_requirements),
        "",
        "## Constraints",
        *_render_bullets(outline.constraints),
        "",
        "## Open Questions",
        *_render_bullets(outline.open_questions),
        "",
        "## Conversation Highlights",
        *_render_bullets(
            [f"[turn:{turn.turn_number}] {turn.role}: {turn.content}" for turn in turns]
            or ["No conversation highlights available."]
        ),
        "",
        "## Retrieved Context",
        *_render_bullets(
            [
                f"[chunk:{chunk.chunk_id}] {chunk.content}"
                for chunk in source_chunks
            ]
            or ["No retrieved source context available."]
        ),
    ]
    return "\n".join(sections).strip() + "\n"


def _render_bullets(items: list[str]) -> list[str]:
    return [f"- {item}" for item in items]


class ConnectionManager(Protocol):
    """Minimal RLS connection manager contract."""

    def get_connection(self, tenant_id: str) -> Any: ...
