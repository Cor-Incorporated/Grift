"""Requirement artifact generation, persistence, and event triggers."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from string import Template
from threading import Lock
from typing import TYPE_CHECKING, Any, Protocol

import structlog
from psycopg2 import errors as psycopg_errors  # type: ignore[import-untyped]
from pydantic import BaseModel, Field

from intelligence_worker.citations import (
    RequirementArtifactCitation,
    SourceContextChunk,
    _merge_citations,
    _rank_source_chunks,
    _render_cited_bullets,
    _render_cited_text,
    _select_citations,
)
from intelligence_worker.completeness_tracker import COMPLETENESS_THRESHOLD

if TYPE_CHECKING:
    from intelligence_worker.qa_extraction import ConversationTurn

logger = structlog.get_logger()


@dataclass(frozen=True)
class RequirementArtifactDraft:
    """Version-ready artifact content."""

    markdown: str
    source_chunks: tuple[str, ...]
    citations: tuple[RequirementArtifactCitation, ...]


class StructuredLLMClient(Protocol):
    """LLM abstraction compatible with the worker gateway adapter."""

    def extract_structured(
        self, *, prompt: str, response_schema: dict[str, Any]
    ) -> str: ...


class ConversationRepository(Protocol):
    """Load persisted conversation turns for requirement artifact generation."""

    def load_turns(self, *, tenant_id: str, case_id: str) -> list[ConversationTurn]: ...


class RequirementArtifactSection(BaseModel):
    title: str = Field(min_length=1)
    bullets: list[str] = Field(default_factory=list)


class RequirementArtifactOutline(BaseModel):
    summary: str = Field(min_length=1)
    functional_requirements: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


_PROMPT_TEMPLATE = Template("""\
You generate a requirement artifact outline for an estimation case.

Conversation:
$conversation

Retrieved source context:
$source_context

Requirements:
- prioritize concrete scope, constraints, and unresolved questions
- prefer details supported by retrieved context when available
- keep each bullet short and decision-oriented

Return JSON with this schema:
$schema
""")


class RequirementArtifactGenerator:
    """Build requirement artifact markdown from turns and retrieved chunks."""

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
        prompt = _PROMPT_TEMPLATE.safe_substitute(
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
        return _build_draft(
            outline=outline,
            turns=turns,
            source_chunks=source_chunks,
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
        source_signals = [
            chunk.content.strip() for chunk in source_chunks if chunk.content
        ]
        outline = RequirementArtifactOutline(
            summary=(
                source_signals[0]
                if source_signals
                else (
                    user_turns[-1]
                    if user_turns
                    else "No user requirements captured yet."
                )
            ),
            functional_requirements=_limit_items(user_turns + source_signals, 4),
            constraints=_limit_items(source_signals + assistant_turns, 3),
            open_questions=_infer_open_questions(turns),
        )
        return _build_draft(
            outline=outline,
            turns=turns,
            source_chunks=source_chunks,
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
        query_text: str = "",
        limit: int = 6,
        candidate_limit: int | None = None,
    ) -> list[SourceContextChunk]:
        effective_candidate_limit = max(candidate_limit or limit * 4, limit)
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
                            dc.chunk_index,
                            dc.content_sha256
                        FROM chunk_embeddings ce
                        JOIN document_chunks dc
                          ON dc.id = ce.chunk_id
                         AND dc.tenant_id = ce.tenant_id
                         AND dc.namespace = ce.namespace
                        JOIN source_documents sd
                          ON sd.id = dc.source_id
                         AND sd.tenant_id = dc.tenant_id
                        WHERE ce.tenant_id = %s
                          AND sd.case_id = %s
                          AND ce.namespace = 'customer_docs'
                          AND ce.is_active = true
                          AND dc.source_type = 'source_document'
                        ORDER BY ce.embedded_at DESC, sd.created_at DESC,
                                 dc.chunk_index ASC, dc.id ASC
                        LIMIT %s
                        """,
                    (tenant_id, case_id, effective_candidate_limit),
                )
                chunks = [
                    SourceContextChunk(
                        chunk_id=chunk_id,
                        content=content,
                        source_document_id=source_document_id,
                        chunk_index=chunk_index,
                        content_sha256=content_sha256,
                    )
                    for (
                        chunk_id,
                        content,
                        source_document_id,
                        chunk_index,
                        content_sha256,
                    ) in cur.fetchall()
                ]
        except psycopg_errors.UndefinedTable:
            logger.warning("requirement_artifact_context_missing_tables")
            return []

        return _rank_source_chunks(chunks, query_text=query_text, limit=limit)

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
                        SELECT COALESCE(MAX(version), 0)
                        FROM requirement_artifacts
                        WHERE tenant_id = %s AND case_id = %s
                        """,
                    (tenant_id, case_id),
                )
                max_row = cur.fetchone()
                next_version = (max_row[0] if max_row else 0) + 1
                cur.execute(
                    """
                        INSERT INTO requirement_artifacts (
                            tenant_id,
                            case_id,
                            version,
                            markdown,
                            source_chunks,
                            citations,
                            status,
                            created_by_uid
                        )
                        VALUES (%s, %s, %s, %s, %s::uuid[], %s::jsonb, 'draft', %s)
                        RETURNING version
                        """,
                    (
                        tenant_id,
                        case_id,
                        next_version,
                        draft.markdown,
                        list(draft.source_chunks),
                        json.dumps(
                            [asdict(citation) for citation in draft.citations],
                            ensure_ascii=False,
                        ),
                        created_by_uid,
                    ),
                )
                row = cur.fetchone()
                return int(row[0]) if row else None
        except psycopg_errors.UniqueViolation:
            logger.info(
                "requirement_artifact_duplicate_version_skipped",
                tenant_id=tenant_id,
                case_id=case_id,
            )
            return None
        except psycopg_errors.UndefinedTable:
            logger.warning("requirement_artifacts_table_missing_skip_persist")
            return None


class RequirementArtifactService:
    """Generate and persist artifacts for one tenant-scoped case."""

    def __init__(
        self,
        *,
        conversation_repository: ConversationRepository,
        artifact_repository: RequirementArtifactRepository,
        artifact_generator: RequirementArtifactGenerator,
    ) -> None:
        self._conversation_repository = conversation_repository
        self._artifact_repository = artifact_repository
        self._artifact_generator = artifact_generator

    def generate_for_case(
        self,
        *,
        tenant_id: str,
        case_id: str,
        created_by_uid: str | None = None,
    ) -> int | None:
        turns = self._conversation_repository.load_turns(
            tenant_id=tenant_id,
            case_id=case_id,
        )
        if not turns:
            logger.info("requirement_artifact_skipped_no_turns", case_id=case_id)
            return None

        source_chunks = self._artifact_repository.load_source_chunks(
            tenant_id=tenant_id,
            case_id=case_id,
            query_text=_build_query_text(turns),
        )
        artifact = self._artifact_generator.generate(
            turns=turns,
            source_chunks=source_chunks,
        )
        return self._artifact_repository.save_artifact(
            tenant_id=tenant_id,
            case_id=case_id,
            draft=artifact,
            created_by_uid=created_by_uid or "intelligence-worker",
        )


class CompletenessUpdatedRequirementArtifactHandler:
    """Generate a requirement artifact when completeness crosses the threshold."""

    def __init__(
        self,
        *,
        service: RequirementArtifactService,
        threshold: float = COMPLETENESS_THRESHOLD,
    ) -> None:
        self._service = service
        self._threshold = threshold
        self._idempotency_lock = Lock()
        self._processed_idempotency_keys: set[str] = set()
        self._inflight_idempotency_keys: set[str] = set()

    def _begin_generation(self, idempotency_key: str) -> bool:
        if not idempotency_key:
            return True
        with self._idempotency_lock:
            if (
                idempotency_key in self._processed_idempotency_keys
                or idempotency_key in self._inflight_idempotency_keys
            ):
                return False
            self._inflight_idempotency_keys.add(idempotency_key)
            return True

    def _finish_generation(self, idempotency_key: str, *, persisted: bool) -> None:
        if not idempotency_key:
            return
        with self._idempotency_lock:
            self._inflight_idempotency_keys.discard(idempotency_key)
            if persisted:
                self._processed_idempotency_keys.add(idempotency_key)

    def __call__(self, payload: dict[str, object]) -> None:
        tenant_id = str(payload.get("tenant_id") or "")
        source_domain = str(payload.get("source_domain") or "estimation")
        event_payload = payload.get("payload")
        if not isinstance(event_payload, dict):
            logger.warning("requirement_artifact_missing_payload")
            return

        case_id = str(
            event_payload.get("session_id") or payload.get("aggregate_id") or ""
        )
        raw_completeness = event_payload.get("overall_completeness")
        completeness = _coerce_float(
            raw_completeness,
            min_value=0.0,
            max_value=1.0,
        )
        if raw_completeness is not None and completeness is None:
            logger.warning(
                "requirement_artifact_invalid_completeness",
                tenant_id=tenant_id,
                case_id=case_id,
                completeness=raw_completeness,
            )
            return
        if not tenant_id or not case_id or completeness is None:
            logger.warning(
                "requirement_artifact_missing_ids",
                tenant_id=tenant_id,
                case_id=case_id,
                completeness=completeness,
            )
            return
        if source_domain != "estimation":
            logger.info(
                "requirement_artifact_skipped_for_domain",
                source_domain=source_domain,
                case_id=case_id,
            )
            return
        if completeness < self._threshold:
            logger.info(
                "requirement_artifact_threshold_not_met",
                case_id=case_id,
                completeness=completeness,
                threshold=self._threshold,
            )
            return

        idempotency_key = _artifact_idempotency_key(payload, case_id=case_id)
        if not self._begin_generation(idempotency_key):
            logger.info(
                "requirement_artifact_duplicate_event_skipped",
                tenant_id=tenant_id,
                case_id=case_id,
                idempotency_key=idempotency_key,
            )
            return

        version: int | None = None
        try:
            version = self._service.generate_for_case(
                tenant_id=tenant_id,
                case_id=case_id,
                created_by_uid="intelligence-worker",
            )
        finally:
            self._finish_generation(idempotency_key, persisted=version is not None)
        if version is None:
            return
        logger.info(
            "requirement_artifact_persisted",
            tenant_id=tenant_id,
            case_id=case_id,
            version=version,
            completeness=completeness,
        )


def _build_draft(
    *,
    outline: RequirementArtifactOutline,
    turns: list[ConversationTurn],
    source_chunks: list[SourceContextChunk],
) -> RequirementArtifactDraft:
    section_texts = _build_section_texts(outline)
    citation_map = {
        text: _select_citations(text=text, source_chunks=source_chunks)
        for text in section_texts
    }
    citations = _merge_citations(citation_map.values())
    markdown = _render_markdown(
        outline=outline,
        turns=turns,
        source_chunks=source_chunks,
        citation_map=citation_map,
        citations=citations,
    )
    return RequirementArtifactDraft(
        markdown=markdown,
        source_chunks=_ordered_chunk_ids(citations or source_chunks),
        citations=tuple(citations),
    )


def _build_section_texts(outline: RequirementArtifactOutline) -> list[str]:
    return [
        outline.summary.strip(),
        *outline.functional_requirements,
        *outline.constraints,
        *outline.open_questions,
    ]


def _build_query_text(turns: list[ConversationTurn]) -> str:
    user_text = "\n".join(
        turn.content.strip()
        for turn in turns
        if turn.role == "user" and turn.content.strip()
    )
    if user_text:
        return user_text
    return "\n".join(turn.content.strip() for turn in turns if turn.content.strip())


def _coerce_float(
    value: object,
    *,
    min_value: float | None = None,
    max_value: float | None = None,
) -> float | None:
    parsed: float | None = None
    if isinstance(value, (int, float)):
        parsed = float(value)
    elif isinstance(value, str):
        try:
            parsed = float(value)
        except ValueError:
            return None
    if parsed is None:
        return None
    if min_value is not None and parsed < min_value:
        return None
    if max_value is not None and parsed > max_value:
        return None
    return parsed


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


def _ordered_chunk_ids(
    citations_or_chunks: tuple[RequirementArtifactCitation, ...]
    | list[RequirementArtifactCitation]
    | list[SourceContextChunk],
) -> tuple[str, ...]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in citations_or_chunks:
        chunk_id = item.chunk_id
        if chunk_id in seen:
            continue
        seen.add(chunk_id)
        ordered.append(chunk_id)
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
    citation_map: dict[str, tuple[RequirementArtifactCitation, ...]],
    citations: list[RequirementArtifactCitation],
) -> str:
    summary_text = _render_cited_text(outline.summary.strip(), citation_map)
    sections = [
        "# Requirement Artifact",
        "",
        "## Summary",
        summary_text,
        "",
        "## Functional Requirements",
        *_render_cited_bullets(outline.functional_requirements, citation_map),
        "",
        "## Constraints",
        *_render_cited_bullets(outline.constraints, citation_map),
        "",
        "## Open Questions",
        *_render_cited_bullets(outline.open_questions, citation_map),
        "",
        "## Conversation Highlights",
        *_render_bullets(
            [f"[turn:{turn.turn_number}] {turn.role}: {turn.content}" for turn in turns]
            or ["No conversation highlights available."]
        ),
        "",
        "## Retrieved Context",
        *_render_bullets(
            [f"[chunk:{chunk.chunk_id}] {chunk.content}" for chunk in source_chunks]
            or ["No retrieved source context available."]
        ),
        "",
        "## Citation Index",
        *_render_bullets(
            [
                (
                    f"[chunk:{citation.chunk_id}] source_id={citation.source_id} "
                    f"chunk_index={citation.chunk_index} "
                    f"offsets={citation.offset_start}:{citation.offset_end} "
                    f"sha256={citation.content_sha256}"
                )
                for citation in citations
            ]
            or ["No supporting chunks available."]
        ),
    ]
    return "\n".join(sections).strip() + "\n"


def _render_bullets(items: list[str]) -> list[str]:
    return [f"- {item}" for item in items]


def _artifact_idempotency_key(payload: dict[str, object], *, case_id: str) -> str:
    raw_key = payload.get("idempotency_key") or payload.get("event_id")
    if raw_key:
        return str(raw_key)

    aggregate_version = payload.get("aggregate_version")
    if aggregate_version is not None:
        return f"{case_id}:{aggregate_version}:requirement-artifact"
    return ""


class ConnectionManager(Protocol):
    """Minimal RLS connection manager contract."""

    def get_connection(self, tenant_id: str) -> Any: ...
