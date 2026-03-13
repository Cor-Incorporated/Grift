"""Completeness tracker and system prompt feedback helpers."""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

import structlog
from psycopg2 import errors as psycopg_errors  # type: ignore[import-untyped]

COMPLETENESS_THRESHOLD = 0.8
PARTIAL_COMPLETENESS_CONFIDENCE = 0.75
FOLLOW_UP_COMPLETENESS_THRESHOLD = 0.4

logger = structlog.get_logger()


def _quote_ident(name: str) -> str:
    """Quote a PostgreSQL identifier to prevent injection."""
    return '"' + name.replace('"', '""') + '"'


DOMAIN_CHECKLISTS: dict[str, tuple[str, ...]] = {
    "estimation": ("tech_stack", "scope", "timeline", "budget", "team"),
    "research": ("theme", "hypothesis", "segment", "insight"),
}

if TYPE_CHECKING:
    from collections.abc import Iterable

    from intelligence_worker.qa_extraction import QAPair

_ESTIMATION_ITEM_PATTERNS: dict[str, tuple[str, ...]] = {
    "tech_stack": (
        "tech stack",
        "technology stack",
        "技術",
        "技術スタック",
        "framework",
        "react",
        "next.js",
        "python",
        "go",
        "typescript",
    ),
    "scope": (
        "scope",
        "requirements",
        "feature",
        "deliverable",
        "要件",
        "仕様",
        "スコープ",
        "機能",
    ),
    "timeline": (
        "timeline",
        "schedule",
        "deadline",
        "milestone",
        "納期",
        "期限",
        "スケジュール",
    ),
    "budget": (
        "budget",
        "cost",
        "price",
        "quote",
        "予算",
        "費用",
        "金額",
    ),
    "team": (
        "team",
        "member",
        "staff",
        "engineer",
        "resource",
        "チーム",
        "体制",
        "人数",
        "担当",
    ),
}


@dataclass(frozen=True)
class CompletenessResult:
    """Completeness evaluation output."""

    domain: str
    collected_items: tuple[str, ...]
    missing_items: tuple[str, ...]
    completeness: float
    is_complete: bool


@dataclass(frozen=True)
class ChecklistItemStatus:
    """Checklist status payload for feedback-loop persistence."""

    status: str
    confidence: float


@dataclass(frozen=True)
class CompletenessTrackingSnapshot:
    """Persistable completeness state for a session."""

    domain: str
    checklist: dict[str, ChecklistItemStatus]
    suggested_next_topics: tuple[str, ...]
    overall_completeness: float
    turn_count: int


def calculate_completeness(
    domain: str, collected_items: set[str]
) -> CompletenessResult:
    """Calculate checklist coverage and completion signal for a domain."""
    checklist = DOMAIN_CHECKLISTS.get(domain)
    if checklist is None:
        raise ValueError(f"unsupported domain: {domain}")

    ordered_collected = tuple(item for item in checklist if item in collected_items)
    ordered_missing = tuple(item for item in checklist if item not in collected_items)
    completeness = len(ordered_collected) / len(checklist)
    is_complete = completeness >= COMPLETENESS_THRESHOLD

    return CompletenessResult(
        domain=domain,
        collected_items=ordered_collected,
        missing_items=ordered_missing,
        completeness=completeness,
        is_complete=is_complete,
    )


def build_checklist_status(
    domain: str, collected_items: set[str], *, partial_items: set[str] | None = None
) -> dict[str, ChecklistItemStatus]:
    """Build a per-item status map for persistence and prompt feedback."""
    checklist = DOMAIN_CHECKLISTS.get(domain)
    if checklist is None:
        raise ValueError(f"unsupported domain: {domain}")

    partial = partial_items or set()
    statuses: dict[str, ChecklistItemStatus] = {}
    for item in checklist:
        if item in collected_items:
            statuses[item] = ChecklistItemStatus(status="collected", confidence=1.0)
        elif item in partial:
            statuses[item] = ChecklistItemStatus(status="partial", confidence=0.5)
        else:
            statuses[item] = ChecklistItemStatus(status="missing", confidence=0.0)
    return statuses


def infer_collected_items_from_pairs(domain: str, pairs: Iterable[QAPair]) -> set[str]:
    """Infer covered checklist items from extracted QA pairs."""
    if domain != "estimation":
        return set()

    combined_text = " ".join(
        f"{pair.question_text} {pair.answer_text}" for pair in pairs
    ).lower()
    collected: set[str] = set()
    for item, patterns in _ESTIMATION_ITEM_PATTERNS.items():
        if any(pattern in combined_text for pattern in patterns):
            collected.add(item)
    return collected


def infer_collected_items_from_texts(domain: str, texts: Iterable[str]) -> set[str]:
    """Infer covered checklist items from raw transcript text."""
    if domain != "estimation":
        return set()

    combined_text = " ".join(texts).lower()
    collected: set[str] = set()
    for item, patterns in _ESTIMATION_ITEM_PATTERNS.items():
        if any(pattern in combined_text for pattern in patterns):
            collected.add(item)
    return collected


def build_tracking_snapshot(
    *,
    domain: str,
    collected_items: set[str],
    turn_count: int,
    partial_items: set[str] | None = None,
) -> CompletenessTrackingSnapshot:
    """Build a DB-friendly completeness snapshot."""
    result = calculate_completeness(domain, collected_items)
    checklist = build_checklist_status(
        domain,
        collected_items,
        partial_items=partial_items,
    )
    partial_topics = tuple(
        item for item, status in checklist.items() if status.status == "partial"
    )
    missing_topics = tuple(
        item for item, status in checklist.items() if status.status == "missing"
    )
    return CompletenessTrackingSnapshot(
        domain=domain,
        checklist=checklist,
        suggested_next_topics=partial_topics + missing_topics,
        overall_completeness=result.completeness,
        turn_count=turn_count,
    )


def build_prompt_feedback(missing_items: tuple[str, ...]) -> str:
    """Build system prompt feedback line in the required format."""
    if not missing_items:
        return "未収集項目: []"
    return f"未収集項目: [{', '.join(missing_items)}]"


def infer_item_coverage_from_pairs(
    domain: str,
    pairs: Iterable[QAPair],
) -> tuple[set[str], set[str]]:
    """Infer collected and partial checklist coverage from extracted QA pairs.

    Non-"estimation" domains return empty sets intentionally because pattern
    matching is only defined for the estimation checklist.  Callers should
    fall back to ``infer_collected_items_from_texts`` which also applies
    estimation-only patterns but works on raw transcript strings.
    """
    if domain != "estimation":
        return set(), set()

    collected: set[str] = set()
    partial: set[str] = set()
    for pair in pairs:
        text = f"{pair.question_text} {pair.answer_text}".lower()
        for item, patterns in _ESTIMATION_ITEM_PATTERNS.items():
            if not any(pattern in text for pattern in patterns):
                continue
            if pair.confidence >= PARTIAL_COMPLETENESS_CONFIDENCE:
                collected.add(item)
                partial.discard(item)
            elif item not in collected:
                partial.add(item)
    return collected, partial


def build_extraction_prompt_feedback(
    snapshot: CompletenessTrackingSnapshot,
) -> str:
    """Build dynamic extraction guidance from the latest completeness state."""
    if snapshot.overall_completeness >= COMPLETENESS_THRESHOLD:
        stage = "completion"
        guidance = (
            "Most checklist items are already covered. Avoid repeating settled facts "
            "and only surface unresolved or weakly-supported topics."
        )
    elif snapshot.overall_completeness >= FOLLOW_UP_COMPLETENESS_THRESHOLD:
        stage = "follow_up"
        guidance = (
            "The conversation is partially complete. Prioritize unresolved checklist "
            "topics and keep tentative answers distinguishable from confirmed facts."
        )
    else:
        stage = "discovery"
        guidance = (
            "The conversation is still early. Focus on extracting foundational "
            "requirements and preserve the biggest information gaps."
        )

    feedback_line = build_prompt_feedback(snapshot.suggested_next_topics)
    return "\n".join(
        (
            "Completeness feedback:",
            f"- completeness_score={snapshot.overall_completeness:.3f}",
            f"- feedback_stage={stage}",
            f"- {guidance}",
            f"- {feedback_line}",
        )
    )


class CompletenessTrackingRepository:
    """Persist completeness feedback loop state."""

    _columns_cache: dict[str, set[str]] | None = None
    _columns_cache_at: float = 0.0
    _CACHE_TTL_SECONDS: float = 300.0  # Re-query after 5 minutes
    _columns_lock = threading.Lock()

    def __init__(self, conn_manager: ConnectionManager) -> None:
        self._conn_manager = conn_manager

    def _cache_is_valid(self) -> bool:
        return (
            CompletenessTrackingRepository._columns_cache is not None
            and (time.monotonic() - CompletenessTrackingRepository._columns_cache_at)
            < CompletenessTrackingRepository._CACHE_TTL_SECONDS
        )

    def _get_columns(self, tenant_id: str) -> set[str] | None:
        """Return cached column names for completeness_tracking table."""
        if self._cache_is_valid():
            return CompletenessTrackingRepository._columns_cache.get(  # type: ignore[union-attr]
                "completeness_tracking"
            )

        with CompletenessTrackingRepository._columns_lock:
            # Double-check after acquiring the lock.
            if self._cache_is_valid():
                return CompletenessTrackingRepository._columns_cache.get(  # type: ignore[union-attr]
                    "completeness_tracking"
                )

            with (
                self._conn_manager.get_connection(tenant_id) as conn,
                conn,
                conn.cursor() as cur,
            ):
                cur.execute(
                    """
                        SELECT column_name
                        FROM information_schema.columns
                        WHERE table_schema = current_schema()
                          AND table_name = 'completeness_tracking'
                        """,
                )
                columns = {row[0] for row in cur.fetchall()}
                if not columns:
                    # Don't cache "table not found" — leave _columns_cache
                    # as None so the next call re-queries.
                    return None
                CompletenessTrackingRepository._columns_cache = {
                    "completeness_tracking": columns,
                }
                CompletenessTrackingRepository._columns_cache_at = time.monotonic()
                return columns

    def save_snapshot(
        self,
        *,
        tenant_id: str,
        session_id: str,
        snapshot: CompletenessTrackingSnapshot,
    ) -> None:
        try:
            columns = self._get_columns(tenant_id)
            if not columns:
                logger.warning("completeness_tracking_table_missing_skip_persist")
                return

            values = _resolve_tracking_values(
                columns=columns,
                tenant_id=tenant_id,
                session_id=session_id,
                snapshot=snapshot,
            )
            column_list = ", ".join(_quote_ident(k) for k in values)
            placeholders = ", ".join(["%s"] * len(values))

            # Resolve the actual column names used for the
            # unique constraint (tenant_id, session_id, source_domain).
            conflict_col_session = (
                "session_id" if "session_id" in columns else "case_id"
            )
            conflict_col_domain = (
                "source_domain" if "source_domain" in columns else "domain"
            )
            conflict_cols = ", ".join(
                _quote_ident(c)
                for c in ("tenant_id", conflict_col_session, conflict_col_domain)
            )

            # Build SET clause for upsert (exclude conflict keys).
            conflict_key_set = {
                "tenant_id",
                conflict_col_session,
                conflict_col_domain,
            }
            update_cols = [c for c in values if c not in conflict_key_set]
            update_clause = ", ".join(
                f"{_quote_ident(c)} = EXCLUDED.{_quote_ident(c)}" for c in update_cols
            )
            if update_clause:
                update_clause += ", updated_at = now()"
            else:
                update_clause = "updated_at = now()"

            with (
                self._conn_manager.get_connection(tenant_id) as conn,
                conn,
                conn.cursor() as cur,
            ):
                cur.execute(
                    (
                        "INSERT INTO completeness_tracking "
                        f"({column_list}) VALUES ({placeholders}) "
                        f"ON CONFLICT ({conflict_cols}) DO UPDATE SET "
                        f"{update_clause}"
                    ),
                    tuple(values.values()),
                )
        except psycopg_errors.UndefinedTable:
            logger.warning("completeness_tracking_table_missing_skip_persist")


def _resolve_tracking_values(
    *,
    columns: set[str],
    tenant_id: str,
    session_id: str,
    snapshot: CompletenessTrackingSnapshot,
) -> dict[str, object]:
    checklist_json = json.dumps(
        {
            key: {
                "status": value.status,
                "confidence": value.confidence,
            }
            for key, value in snapshot.checklist.items()
        },
        ensure_ascii=False,
    )
    candidates: tuple[tuple[tuple[str, ...], object], ...] = (
        (("tenant_id",), tenant_id),
        (("session_id", "case_id"), session_id),
        (("source_domain", "domain"), snapshot.domain),
        (("checklist", "checklist_json"), checklist_json),
        (
            ("overall_completeness", "completeness"),
            snapshot.overall_completeness,
        ),
        (
            ("suggested_next_topics", "missing_items"),
            list(snapshot.suggested_next_topics),
        ),
        (("turn_count",), snapshot.turn_count),
    )

    resolved: dict[str, object] = {}
    for aliases, value in candidates:
        for alias in aliases:
            if alias in columns and alias not in resolved:
                resolved[alias] = value
                break
    return resolved


class ConnectionManager(Protocol):
    """Minimal RLS connection manager contract."""

    def get_connection(self, tenant_id: str) -> Any: ...
