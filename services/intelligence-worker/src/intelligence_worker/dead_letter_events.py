"""Dead-letter persistence and retry control helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, Protocol

import structlog
from psycopg2 import errors as psycopg_errors  # type: ignore[import-untyped]

if TYPE_CHECKING:
    import threading
    from collections.abc import Callable

logger = structlog.get_logger()

_LOAD_DUE_WITH_TENANT_SQL = """\
SELECT
    id::text,
    tenant_id::text,
    event_id::text,
    event_type,
    reason,
    retry_count,
    max_retries,
    last_retried_at,
    original_payload
FROM dead_letter_events
WHERE tenant_id = %s
  AND resolved_at IS NULL
  AND retry_count < max_retries
  AND (last_retried_at IS NULL
       OR last_retried_at + (
          CASE retry_count
              WHEN 0 THEN interval '1 minute'
              WHEN 1 THEN interval '5 minutes'
              WHEN 2 THEN interval '30 minutes'
              ELSE interval '30 minutes'
          END
       ) < %s)
ORDER BY created_at ASC
LIMIT %s
"""

_LOAD_DUE_ALL_SQL = """\
SELECT
    id::text,
    tenant_id::text,
    event_id::text,
    event_type,
    reason,
    retry_count,
    max_retries,
    last_retried_at,
    original_payload
FROM dead_letter_events
WHERE resolved_at IS NULL
  AND retry_count < max_retries
  AND (last_retried_at IS NULL
       OR last_retried_at + (
          CASE retry_count
              WHEN 0 THEN interval '1 minute'
              WHEN 1 THEN interval '5 minutes'
              WHEN 2 THEN interval '30 minutes'
              ELSE interval '30 minutes'
          END
       ) < %s)
ORDER BY created_at ASC
LIMIT %s
"""

RETRY_BACKOFF_SCHEDULE = (
    timedelta(minutes=1),
    timedelta(minutes=5),
    timedelta(minutes=30),
)


@dataclass(frozen=True)
class DeadLetterEvent:
    """Dead-letter event row materialized for retry processing."""

    id: str
    tenant_id: str | None
    event_id: str
    event_type: str
    reason: str
    retry_count: int
    max_retries: int
    last_retried_at: datetime | None
    original_payload: dict[str, Any]

    def is_due(self, now: datetime) -> bool:
        if self.retry_count >= self.max_retries:
            return False
        if self.last_retried_at is None:
            return True
        return now >= self.last_retried_at + retry_backoff_for(self.retry_count)


def retry_backoff_for(retry_count: int) -> timedelta:
    """Return the configured backoff for the current retry count."""
    if retry_count < 0:
        raise ValueError("retry_count must be >= 0")
    if retry_count >= len(RETRY_BACKOFF_SCHEDULE):
        return RETRY_BACKOFF_SCHEDULE[-1]
    return RETRY_BACKOFF_SCHEDULE[retry_count]


class DeadLetterEventStore:
    """Store dead-letter rows and manage retry metadata."""

    def __init__(
        self,
        conn_manager: ConnectionManager,
        *,
        max_retries: int = 3,
    ) -> None:
        self._conn_manager = conn_manager
        self._max_retries = max_retries

    def record_failure(
        self,
        *,
        tenant_id: str | None,
        event_id: str,
        event_type: str,
        reason: str,
        original_payload: dict[str, Any],
        occurred_at: datetime | None = None,
    ) -> None:
        try:
            with (
                self._conn_manager.get_connection(tenant_id or "") as conn,
                conn,
                conn.cursor() as cur,
            ):
                cur.execute(
                    """
                        INSERT INTO dead_letter_events (
                            tenant_id,
                            event_id,
                            event_type,
                            reason,
                            retry_count,
                            max_retries,
                            last_retried_at,
                            original_payload
                        )
                        VALUES (%s, %s, %s, %s, 0, %s, NULL, %s::jsonb)
                        ON CONFLICT (event_id) WHERE resolved_at IS NULL
                        DO UPDATE SET
                            retry_count = dead_letter_events.retry_count + 1,
                            reason = EXCLUDED.reason,
                            last_retried_at = now()
                        """,
                    (
                        tenant_id,
                        event_id,
                        event_type,
                        reason,
                        self._max_retries,
                        json.dumps(original_payload, ensure_ascii=False),
                    ),
                )
        except psycopg_errors.UndefinedTable:
            logger.warning("dead_letter_events_table_missing_skip_persist")

    def load_due_events(
        self,
        *,
        tenant_id: str | None = None,
        now: datetime | None = None,
        limit: int = 10,
    ) -> list[DeadLetterEvent]:
        current_time = now or datetime.now(tz=UTC)
        try:
            # When tenant_id is None we pass "" to get_connection(); the
            # connection manager must treat empty-string as a system-role
            # connection (i.e. skip SET app.tenant_id) so the query can
            # scan across all tenants.
            with (
                self._conn_manager.get_connection(tenant_id or "") as conn,
                conn,
                conn.cursor() as cur,
            ):
                if tenant_id is not None:
                    cur.execute(
                        _LOAD_DUE_WITH_TENANT_SQL,
                        (tenant_id, current_time, limit),
                    )
                else:
                    cur.execute(
                        _LOAD_DUE_ALL_SQL,
                        (current_time, limit),
                    )
                rows = cur.fetchall()
        except psycopg_errors.UndefinedTable:
            logger.warning("dead_letter_events_table_missing_skip_load")
            return []

        return [
            DeadLetterEvent(
                id=row[0],
                tenant_id=row[1],
                event_id=row[2],
                event_type=row[3],
                reason=row[4],
                retry_count=row[5],
                max_retries=row[6],
                last_retried_at=row[7],
                original_payload=row[8],
            )
            for row in rows
        ]

    def mark_retry_failure(
        self,
        *,
        tenant_id: str | None,
        entry_id: str,
        reason: str,
        occurred_at: datetime | None = None,
    ) -> None:
        timestamp = occurred_at or datetime.now(tz=UTC)
        try:
            with (
                self._conn_manager.get_connection(tenant_id or "") as conn,
                conn,
                conn.cursor() as cur,
            ):
                cur.execute(
                    """
                            UPDATE dead_letter_events
                            SET retry_count = retry_count + 1,
                                last_retried_at = %s,
                                reason = CASE
                                WHEN retry_count + 1 >= max_retries
                                THEN %s
                                ELSE %s
                            END,
                            resolved_at = CASE
                                WHEN retry_count + 1 >= max_retries THEN %s
                                ELSE resolved_at
                            END
                        WHERE id = %s
                        """,
                    (
                        timestamp,
                        f"{reason}:max_retries_exceeded",
                        reason,
                        timestamp,
                        entry_id,
                    ),
                )
        except psycopg_errors.UndefinedTable:
            logger.warning("dead_letter_events_table_missing_skip_update")

    def mark_resolved(
        self,
        *,
        tenant_id: str | None,
        entry_id: str,
        resolved_at: datetime | None = None,
    ) -> None:
        timestamp = resolved_at or datetime.now(tz=UTC)
        try:
            with (
                self._conn_manager.get_connection(tenant_id or "") as conn,
                conn,
                conn.cursor() as cur,
            ):
                cur.execute(
                    """
                        UPDATE dead_letter_events
                        SET resolved_at = %s
                        WHERE id = %s
                        """,
                    (timestamp, entry_id),
                )
        except psycopg_errors.UndefinedTable:
            logger.warning("dead_letter_events_table_missing_skip_resolve")


class DatabaseDeadLetterPublisher:
    """Persist extraction failures to the dead-letter table."""

    def __init__(self, store: DeadLetterEventStore) -> None:
        self._store = store

    def publish(self, *, reason: str, payload: dict[str, Any]) -> None:
        original_payload = payload.get("original_payload")
        if not isinstance(original_payload, dict):
            original_payload = payload
        self._store.record_failure(
            tenant_id=_optional_str(payload.get("tenant_id")),
            event_id=_required_str(payload, "event_id", fallback="unknown-event"),
            event_type=_required_str(
                payload,
                "event_type",
                fallback="conversation.turn.completed",
            ),
            reason=reason,
            original_payload=original_payload,
        )


class DeadLetterRetryProcessor:
    """Replay due dead-letter events through a callback."""

    def __init__(
        self,
        *,
        store: DeadLetterEventStore,
        retry_handler: Callable[[dict[str, Any]], None],
    ) -> None:
        self._store = store
        self._retry_handler = retry_handler

    def run_once(
        self,
        *,
        tenant_id: str | None = None,
        now: datetime | None = None,
    ) -> int:
        events = self._store.load_due_events(tenant_id=tenant_id, now=now)
        processed = 0
        for event in events:
            try:
                self._retry_handler(event.original_payload)
            except Exception as exc:  # noqa: BLE001
                self._store.mark_retry_failure(
                    tenant_id=event.tenant_id,
                    entry_id=event.id,
                    reason=str(exc),
                    occurred_at=now,
                )
            else:
                self._store.mark_resolved(
                    tenant_id=event.tenant_id,
                    entry_id=event.id,
                    resolved_at=now,
                )
            processed += 1
        return processed


class DeadLetterRetryLoop:
    """Polling loop for replaying due dead-letter events."""

    def __init__(
        self,
        *,
        processor: DeadLetterRetryProcessor,
        poll_interval_seconds: float = 30.0,
    ) -> None:
        self._processor = processor
        self._poll_interval_seconds = poll_interval_seconds

    def run(self, stop_event: threading.Event) -> None:
        while not stop_event.is_set():
            self._processor.run_once()
            stop_event.wait(self._poll_interval_seconds)


def _optional_str(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _required_str(payload: dict[str, Any], key: str, *, fallback: str) -> str:
    value = payload.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


class ConnectionManager(Protocol):
    """Minimal RLS connection manager contract."""

    def get_connection(self, tenant_id: str) -> Any: ...
