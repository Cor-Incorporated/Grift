"""Tests for dead-letter persistence and retry helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

from intelligence_worker.dead_letter_events import (
    DatabaseDeadLetterPublisher,
    DeadLetterEvent,
    DeadLetterEventStore,
    DeadLetterRetryProcessor,
    retry_backoff_for,
)


def test_retry_backoff_for_progresses_to_30_minutes() -> None:
    assert retry_backoff_for(0) == timedelta(minutes=1)
    assert retry_backoff_for(1) == timedelta(minutes=5)
    assert retry_backoff_for(2) == timedelta(minutes=30)
    assert retry_backoff_for(9) == timedelta(minutes=30)


def test_dead_letter_event_due_logic() -> None:
    event = DeadLetterEvent(
        id="row-1",
        tenant_id="t1",
        event_id="e1",
        event_type="conversation.turn.completed",
        reason="qa_extraction_failed",
        retry_count=1,
        max_retries=3,
        last_retried_at=datetime(2026, 3, 12, 9, 0, tzinfo=UTC),
        original_payload={},
    )

    assert event.is_due(datetime(2026, 3, 12, 9, 4, tzinfo=UTC)) is False
    assert event.is_due(datetime(2026, 3, 12, 9, 5, tzinfo=UTC)) is True


def test_dead_letter_event_third_retry_waits_30_minutes() -> None:
    event = DeadLetterEvent(
        id="row-1",
        tenant_id="t1",
        event_id="e1",
        event_type="conversation.turn.completed",
        reason="qa_extraction_failed",
        retry_count=2,
        max_retries=3,
        last_retried_at=datetime(2026, 3, 12, 9, 0, tzinfo=UTC),
        original_payload={},
    )

    assert event.is_due(datetime(2026, 3, 12, 9, 29, tzinfo=UTC)) is False
    assert event.is_due(datetime(2026, 3, 12, 9, 30, tzinfo=UTC)) is True


def test_publisher_records_failure_with_defaults() -> None:
    store = MagicMock()
    publisher = DatabaseDeadLetterPublisher(store)

    publisher.publish(
        reason="qa_extraction_failed",
        payload={"tenant_id": "t1", "event_id": "e1"},
    )

    store.record_failure.assert_called_once()
    kwargs = store.record_failure.call_args.kwargs
    assert kwargs["tenant_id"] == "t1"
    assert kwargs["event_id"] == "e1"
    assert kwargs["event_type"] == "conversation.turn.completed"


def test_store_record_failure_inserts_new_row() -> None:
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = None
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn_manager = MagicMock()
    mock_conn_manager.get_connection.return_value.__enter__ = MagicMock(
        return_value=mock_conn
    )
    mock_conn_manager.get_connection.return_value.__exit__ = MagicMock(
        return_value=False
    )

    store = DeadLetterEventStore(mock_conn_manager)
    occurred_at = datetime(2026, 3, 12, 10, 0, tzinfo=UTC)
    store.record_failure(
        tenant_id="t1",
        event_id="e1",
        event_type="conversation.turn.completed",
        reason="qa_extraction_failed",
        original_payload={"tenant_id": "t1"},
        occurred_at=occurred_at,
    )

    # Single INSERT ... ON CONFLICT — only one execute call
    assert mock_cursor.execute.call_count == 1
    insert_call = mock_cursor.execute.call_args_list[0]
    assert "ON CONFLICT" in insert_call.args[0]
    assert "DO UPDATE SET" in insert_call.args[0]
    assert insert_call.args[1][0] == "t1"
    assert insert_call.args[1][1] == "e1"
    assert insert_call.args[1][2] == "conversation.turn.completed"
    assert insert_call.args[1][3] == "qa_extraction_failed"


def test_retry_processor_marks_resolution_on_success() -> None:
    store = MagicMock()
    store.load_due_events.return_value = [
        DeadLetterEvent(
            id="row-1",
            tenant_id="t1",
            event_id="e1",
            event_type="conversation.turn.completed",
            reason="qa_extraction_failed",
            retry_count=0,
            max_retries=3,
            last_retried_at=None,
            original_payload={"event_id": "e1"},
        )
    ]
    handled: list[dict[str, object]] = []
    processor = DeadLetterRetryProcessor(
        store=store,
        retry_handler=lambda payload: handled.append(payload),
    )

    processed = processor.run_once(tenant_id="t1")

    assert processed == 1
    assert handled == [{"event_id": "e1"}]
    store.mark_resolved.assert_called_once_with(
        tenant_id="t1",
        entry_id="row-1",
        resolved_at=None,
    )


def test_retry_processor_marks_failure_after_retry_error() -> None:
    store = MagicMock()
    store.load_due_events.return_value = [
        DeadLetterEvent(
            id="row-1",
            tenant_id="t1",
            event_id="e1",
            event_type="conversation.turn.completed",
            reason="qa_extraction_failed",
            retry_count=3,
            max_retries=3,
            last_retried_at=None,
            original_payload={"event_id": "e1"},
        )
    ]

    def _boom(_: dict[str, object]) -> None:
        raise RuntimeError("llm unavailable")

    processor = DeadLetterRetryProcessor(store=store, retry_handler=_boom)
    now = datetime(2026, 3, 12, 11, 0, tzinfo=UTC)

    processed = processor.run_once(now=now)

    assert processed == 1
    store.mark_retry_failure.assert_called_once_with(
        tenant_id="t1",
        entry_id="row-1",
        reason="llm unavailable",
        occurred_at=now,
    )
