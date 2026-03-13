"""Integration-style tests for DLQ persistence and retry orchestration."""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast
from unittest.mock import MagicMock, patch

import pytest

import intelligence_worker.main as main_module
from intelligence_worker.dead_letter_events import (
    DatabaseDeadLetterPublisher,
    DeadLetterEventStore,
    DeadLetterRetryLoop,
    DeadLetterRetryProcessor,
    retry_backoff_for,
)
from intelligence_worker.main import TurnCompletedHandler
from intelligence_worker.qa_extraction import (
    ConversationTurn,
    QAPair,
    QAPairExtractor,
)
from intelligence_worker.subscriber import ConversationTurnCompletedSubscriber

TENANT_A = "tenant-a"
TENANT_B = "tenant-b"
EVENT_TYPE = "conversation.turn.completed"
BASE_TIME = datetime(2026, 3, 13, 9, 0, tzinfo=UTC)


@dataclass
class _DeadLetterRow:
    id: str
    tenant_id: str | None
    event_id: str
    event_type: str
    reason: str
    retry_count: int
    max_retries: int
    last_retried_at: datetime | None
    resolved_at: datetime | None
    original_payload: dict[str, Any]
    created_at: datetime

    def as_tuple(self) -> tuple[Any, ...]:
        return (
            self.id,
            self.tenant_id,
            self.event_id,
            self.event_type,
            self.reason,
            self.retry_count,
            self.max_retries,
            self.last_retried_at,
            self.original_payload,
        )


@dataclass
class _InMemoryDeadLetterDB:
    rows: list[_DeadLetterRow] = field(default_factory=list)
    current_time: datetime = BASE_TIME
    next_id: int = 1

    def seed_event(
        self,
        *,
        tenant_id: str | None,
        event_id: str,
        event_type: str = EVENT_TYPE,
        reason: str = "qa_extraction_failed",
        retry_count: int = 0,
        max_retries: int = 3,
        last_retried_at: datetime | None = None,
        resolved_at: datetime | None = None,
        original_payload: dict[str, Any] | None = None,
        created_at: datetime | None = None,
    ) -> _DeadLetterRow:
        row = _DeadLetterRow(
            id=f"dlq-{self.next_id}",
            tenant_id=tenant_id,
            event_id=event_id,
            event_type=event_type,
            reason=reason,
            retry_count=retry_count,
            max_retries=max_retries,
            last_retried_at=last_retried_at,
            resolved_at=resolved_at,
            original_payload=original_payload or {"event_id": event_id},
            created_at=created_at or self.current_time,
        )
        self.next_id += 1
        self.rows.append(row)
        return row

    def find_row(self, event_id: str) -> _DeadLetterRow:
        for row in self.rows:
            if row.event_id == event_id:
                return row
        raise AssertionError(f"event_id not found: {event_id}")

    def insert_or_update_failure(
        self,
        *,
        tenant_id: str | None,
        event_id: str,
        event_type: str,
        reason: str,
        max_retries: int,
        original_payload: dict[str, Any],
    ) -> None:
        existing = next(
            (
                row
                for row in self.rows
                if row.event_id == event_id and row.resolved_at is None
            ),
            None,
        )
        if existing is None:
            self.seed_event(
                tenant_id=tenant_id,
                event_id=event_id,
                event_type=event_type,
                reason=reason,
                retry_count=0,
                max_retries=max_retries,
                last_retried_at=None,
                original_payload=original_payload,
                created_at=self.current_time,
            )
            return

        existing.retry_count += 1
        existing.reason = reason
        existing.last_retried_at = self.current_time

    def load_due(
        self,
        *,
        tenant_id: str | None,
        now: datetime,
        limit: int,
    ) -> list[tuple[Any, ...]]:
        def _is_due(row: _DeadLetterRow) -> bool:
            if row.resolved_at is not None:
                return False
            if row.retry_count >= row.max_retries:
                return False
            if row.last_retried_at is None:
                return True

            due_at = row.last_retried_at + retry_backoff_for(row.retry_count)
            # Always inclusive (<=) — matches production SQL behaviour
            # after the off-by-one fix.
            return due_at <= now

        due_rows = [
            row
            for row in self.rows
            if (tenant_id is None or row.tenant_id == tenant_id) and _is_due(row)
        ]
        due_rows.sort(key=lambda row: row.created_at)
        return [row.as_tuple() for row in due_rows[:limit]]

    def mark_retry_failure(
        self,
        *,
        entry_id: str,
        reason: str,
        occurred_at: datetime,
    ) -> None:
        row = self._find_by_id(entry_id)
        row.retry_count += 1
        row.last_retried_at = occurred_at
        if row.retry_count >= row.max_retries:
            row.reason = f"{reason}:max_retries_exceeded"
            row.resolved_at = occurred_at
            return
        row.reason = reason

    def mark_resolved(self, *, entry_id: str, resolved_at: datetime) -> None:
        row = self._find_by_id(entry_id)
        row.resolved_at = resolved_at

    def _find_by_id(self, entry_id: str) -> _DeadLetterRow:
        for row in self.rows:
            if row.id == entry_id:
                return row
        raise AssertionError(f"entry id not found: {entry_id}")


@dataclass
class _FakeCursor:
    db: _InMemoryDeadLetterDB
    rows: list[tuple[Any, ...]] = field(default_factory=list)

    def execute(self, sql: str, params: tuple[Any, ...]) -> None:
        sql_lower = sql.lower()

        if "insert into dead_letter_events" in sql_lower:
            # SQL positional params: tenant_id, event_id, event_type,
            #                        reason, max_retries, payload_json
            (
                tenant_id,  # %s 1: tenant_id
                event_id,  # %s 2: event_id
                event_type,  # %s 3: event_type
                reason,  # %s 4: reason
                max_retries,  # %s 5: max_retries
                payload_json,  # %s 6: original_payload (JSON)
            ) = params
            self.db.insert_or_update_failure(
                tenant_id=tenant_id,
                event_id=event_id,
                event_type=event_type,
                reason=reason,
                max_retries=max_retries,
                original_payload=json.loads(payload_json),
            )
            self.rows = []
            return

        if "from dead_letter_events" in sql_lower and "tenant_id = %s" in sql:
            # Tenant-scoped load_due query
            tenant_id, now, limit = params
            self.rows = self.db.load_due(
                tenant_id=tenant_id,
                now=now,
                limit=limit,
            )
            return

        if "from dead_letter_events" in sql_lower and "tenant_id = %s" not in sql:
            # System-wide load_due query (no tenant filter)
            now, limit = params
            self.rows = self.db.load_due(
                tenant_id=None,
                now=now,
                limit=limit,
            )
            return

        if "set retry_count = retry_count + 1" in sql_lower:
            # SQL positional params for retry failure UPDATE:
            (
                occurred_at,  # %s 1: last_retried_at
                _exceeded_reason,  # %s 2: exceeded reason (unused in fake)
                reason,  # %s 3: reason
                _resolved_at,  # %s 4: resolved_at (unused in fake)
                entry_id,  # %s 5: WHERE id = %s
            ) = params
            self.db.mark_retry_failure(
                entry_id=entry_id,
                reason=reason,
                occurred_at=occurred_at,
            )
            self.rows = []
            return

        if "set resolved_at = %s" in sql_lower:
            resolved_at, entry_id = params
            self.db.mark_resolved(entry_id=entry_id, resolved_at=resolved_at)
            self.rows = []
            return

        raise AssertionError(f"Unhandled SQL in fake cursor: {sql}")

    def fetchall(self) -> list[tuple[Any, ...]]:
        return list(self.rows)


@dataclass
class _FakeConnection:
    db: _InMemoryDeadLetterDB

    def __enter__(self) -> _FakeConnection:
        return self

    def __exit__(self, *_args: object) -> Literal[False]:
        return False

    def cursor(self) -> _FakeCursorContext:
        return _FakeCursorContext(_FakeCursor(self.db))


@dataclass
class _FakeCursorContext:
    cursor: _FakeCursor

    def __enter__(self) -> _FakeCursor:
        return self.cursor

    def __exit__(self, *_args: object) -> Literal[False]:
        return False


@dataclass
class _FakeConnectionManager:
    db: _InMemoryDeadLetterDB
    requested_tenants: list[str] = field(default_factory=list)

    def get_connection(self, tenant_id: str) -> _FakeConnection:
        self.requested_tenants.append(tenant_id)
        return _FakeConnection(self.db)


@dataclass
class _FakeMessage:
    payload: dict[str, object]
    acked: bool = False
    nacked: bool = False

    @property
    def data(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")

    def ack(self) -> None:
        self.acked = True

    def nack(self) -> None:
        self.nacked = True


@dataclass
class _FakeFuture:
    canceled: bool = False

    def cancel(self) -> None:
        self.canceled = True

    def result(self) -> None:
        return None


@dataclass
class _FakeSubscriberClient:
    subscription: str | None = None
    callback: Any = None
    future: _FakeFuture = field(default_factory=_FakeFuture)

    def subscribe(self, subscription: str, callback: Any) -> _FakeFuture:
        self.subscription = subscription
        self.callback = callback
        return self.future


@dataclass
class _FakeRuntimeSubscriber:
    init_kwargs: dict[str, Any] = field(default_factory=dict)
    future: _FakeFuture = field(default_factory=_FakeFuture)
    started: bool = False

    def start(self) -> _FakeFuture:
        self.started = True
        return self.future


@dataclass
class _FakeRuntimeSubscriberFactory:
    instances: list[_FakeRuntimeSubscriber] = field(default_factory=list)

    def __call__(self, **kwargs: Any) -> _FakeRuntimeSubscriber:
        instance = _FakeRuntimeSubscriber(init_kwargs=kwargs)
        self.instances.append(instance)
        return instance


@dataclass
class _FakeThread:
    target: Any
    args: tuple[Any, ...]
    name: str
    daemon: bool
    started: bool = False
    join_calls: list[float | None] = field(default_factory=list)

    def start(self) -> None:
        self.started = True

    def join(self, timeout: float | None = None) -> None:
        self.join_calls.append(timeout)


@dataclass
class _FakeThreadFactory:
    instances: list[_FakeThread] = field(default_factory=list)

    def __call__(
        self,
        *,
        target: Any,
        args: tuple[Any, ...],
        name: str,
        daemon: bool,
    ) -> _FakeThread:
        thread = _FakeThread(
            target=target,
            args=args,
            name=name,
            daemon=daemon,
        )
        self.instances.append(thread)
        return thread


@dataclass
class _FakePubSubClient:
    closed: bool = False
    published: list[dict[str, Any]] = field(default_factory=list)

    def topic_path(self, project_id: str, topic_id: str) -> str:
        return f"projects/{project_id}/topics/{topic_id}"

    def publish(
        self,
        topic: str,
        data: bytes,
        ordering_key: str = "",
    ) -> _FakeFuture:
        self.published.append(
            {"topic": topic, "data": data, "ordering_key": ordering_key}
        )
        return _FakeFuture()

    def close(self) -> None:
        self.closed = True


@dataclass
class _FakeStopEvent:
    flagged: bool = True
    wait_calls: list[float | None] = field(default_factory=list)

    def is_set(self) -> bool:
        return self.flagged

    def set(self) -> None:
        self.flagged = True

    def wait(self, timeout: float | None = None) -> bool:
        self.wait_calls.append(timeout)
        return self.flagged


@dataclass
class _FakeConversationRepo:
    """Fake conversation repository keyed by case_id.

    Stores turns per case_id so that a wrong case_id would return an empty
    list and cause assertion failures in tests.
    """

    _turns_by_case: dict[str, list[ConversationTurn]] = field(default_factory=dict)

    @classmethod
    def for_case(
        cls, *, case_id: str, turns: list[ConversationTurn]
    ) -> _FakeConversationRepo:
        repo = cls()
        repo._turns_by_case[case_id] = list(turns)
        return repo

    def load_turns(self, *, tenant_id: str, case_id: str) -> list[ConversationTurn]:
        assert tenant_id, "tenant_id must not be empty"
        assert case_id, "case_id must not be empty"
        return list(self._turns_by_case.get(case_id, []))


@dataclass
class _FakeLLM:
    response_text: str
    should_fail: bool = False

    def extract_structured(
        self,
        *,
        prompt: str,
        response_schema: dict[str, Any],
        system_prompt: str | None = None,
    ) -> str:
        assert "qa_pairs" in response_schema.get("properties", {})
        assert "source_domain=" in prompt
        del system_prompt
        if self.should_fail:
            raise RuntimeError("llm unavailable")
        return self.response_text


@dataclass
class _FakeQAPairRepository:
    saved_pairs: list[QAPair] = field(default_factory=list)

    def save_qa_pairs(
        self,
        *,
        tenant_id: str,
        case_id: str,
        session_id: str,
        pairs: list[QAPair],
    ) -> None:
        assert tenant_id
        assert case_id
        assert session_id
        self.saved_pairs.extend(pairs)


def _make_store(
    *,
    db: _InMemoryDeadLetterDB | None = None,
    max_retries: int = 3,
) -> tuple[DeadLetterEventStore, _InMemoryDeadLetterDB, _FakeConnectionManager]:
    backing = db or _InMemoryDeadLetterDB()
    manager = _FakeConnectionManager(backing)
    return DeadLetterEventStore(manager, max_retries=max_retries), backing, manager


@pytest.mark.parametrize(
    ("retry_count", "backoff"),
    [
        (0, timedelta(minutes=1)),
        (1, timedelta(minutes=5)),
        (2, timedelta(minutes=30)),
    ],
)
def test_load_due_events_includes_exact_backoff_boundary(
    retry_count: int,
    backoff: timedelta,
) -> None:
    store, db, _ = _make_store()
    db.seed_event(
        tenant_id=TENANT_A,
        event_id=f"event-{retry_count}",
        retry_count=retry_count,
        last_retried_at=BASE_TIME,
        created_at=BASE_TIME - timedelta(seconds=1),
    )

    not_yet_due = store.load_due_events(
        tenant_id=TENANT_A,
        now=BASE_TIME + backoff - timedelta(seconds=1),
    )
    due_events = store.load_due_events(
        tenant_id=TENANT_A,
        now=BASE_TIME + backoff,
    )

    assert not_yet_due == []
    assert [event.event_id for event in due_events] == [f"event-{retry_count}"]


def test_retry_processor_applies_backoff_and_stops_at_max_retries() -> None:
    store, db, _ = _make_store()
    publisher = DatabaseDeadLetterPublisher(store)
    original_payload = {
        "tenant_id": TENANT_A,
        "event_id": "evt-max",
        "event_type": EVENT_TYPE,
        "payload": {"session_id": "case-1"},
    }
    publisher.publish(reason="qa_extraction_failed", payload=original_payload)
    handled_payloads: list[dict[str, Any]] = []

    def _always_fail(payload: dict[str, Any]) -> None:
        handled_payloads.append(payload)
        raise RuntimeError("llm unavailable")

    processor = DeadLetterRetryProcessor(
        store=store,
        retry_handler=_always_fail,
    )

    assert processor.run_once(tenant_id=TENANT_A, now=BASE_TIME) == 1
    row = db.find_row("evt-max")
    assert row.retry_count == 1
    assert row.last_retried_at == BASE_TIME
    assert row.reason == "llm unavailable"
    assert row.resolved_at is None

    assert (
        store.load_due_events(
            tenant_id=TENANT_A,
            now=BASE_TIME + timedelta(minutes=4, seconds=59),
        )
        == []
    )

    second_retry_at = BASE_TIME + timedelta(minutes=5)
    assert processor.run_once(tenant_id=TENANT_A, now=second_retry_at) == 1
    assert row.retry_count == 2
    assert row.last_retried_at == second_retry_at
    assert row.resolved_at is None

    assert (
        store.load_due_events(
            tenant_id=TENANT_A,
            now=second_retry_at + timedelta(minutes=29, seconds=59),
        )
        == []
    )

    final_retry_at = second_retry_at + timedelta(minutes=30)
    assert processor.run_once(tenant_id=TENANT_A, now=final_retry_at) == 1
    assert row.retry_count == 3
    assert row.last_retried_at == final_retry_at
    assert row.reason == "llm unavailable:max_retries_exceeded"
    assert row.resolved_at == final_retry_at
    assert handled_payloads == [
        original_payload,
        original_payload,
        original_payload,
    ]
    assert (
        store.load_due_events(
            tenant_id=TENANT_A,
            now=final_retry_at + timedelta(hours=1),
        )
        == []
    )


def test_load_due_events_respects_tenant_isolation_and_system_scope() -> None:
    store, db, manager = _make_store()
    db.seed_event(
        tenant_id=TENANT_A,
        event_id="evt-a",
        created_at=BASE_TIME,
        original_payload={"tenant_id": TENANT_A},
    )
    db.seed_event(
        tenant_id=TENANT_B,
        event_id="evt-b",
        created_at=BASE_TIME + timedelta(seconds=1),
        original_payload={"tenant_id": TENANT_B},
    )
    db.seed_event(
        tenant_id=TENANT_A,
        event_id="evt-a-late",
        retry_count=1,
        last_retried_at=BASE_TIME + timedelta(minutes=1),
        created_at=BASE_TIME + timedelta(seconds=2),
    )

    tenant_a_due = store.load_due_events(
        tenant_id=TENANT_A,
        now=BASE_TIME + timedelta(hours=1),
    )
    tenant_b_due = store.load_due_events(
        tenant_id=TENANT_B,
        now=BASE_TIME + timedelta(hours=1),
    )
    system_due = store.load_due_events(now=BASE_TIME + timedelta(hours=1))

    assert [event.event_id for event in tenant_a_due] == ["evt-a", "evt-a-late"]
    assert [event.event_id for event in tenant_b_due] == ["evt-b"]
    assert [event.event_id for event in system_due] == [
        "evt-a",
        "evt-b",
        "evt-a-late",
    ]
    assert manager.requested_tenants == [TENANT_A, TENANT_B, ""]


def test_pubsub_handler_failure_is_acked_and_can_be_replayed_from_dlq() -> None:
    store, db, _ = _make_store()
    llm = _FakeLLM(response_text="{}", should_fail=True)
    repository = _FakeQAPairRepository()
    extractor = QAPairExtractor(
        llm_client=llm,
        repository=repository,
        dead_letter_publisher=DatabaseDeadLetterPublisher(store),
    )
    handler = TurnCompletedHandler(
        conversation_repo=cast(
            "Any",
            _FakeConversationRepo.for_case(
                case_id="case-1",
                turns=[
                    ConversationTurn(
                        role="user",
                        content="要件を整理したい",
                        turn_number=1,
                    ),
                    ConversationTurn(
                        role="assistant",
                        content="どの機能が必要ですか",
                        turn_number=2,
                    ),
                ],
            ),
        ),
        extractor=extractor,
    )
    client = _FakeSubscriberClient()
    subscriber = ConversationTurnCompletedSubscriber(
        client=client,
        project_id="proj",
        subscription_id="sub",
        handler=handler,
    )
    subscriber.start()
    assert client.callback is not None

    message = _FakeMessage(
        payload={
            "id": "evt-pubsub",
            "tenant_id": TENANT_A,
            "event_name": EVENT_TYPE,
            "aggregate_id": "case-1",
            "payload": {"session_id": "case-1"},
        }
    )
    client.callback(message)

    assert message.acked is True
    assert message.nacked is False
    row = db.find_row("evt-pubsub")
    assert row.reason == "qa_extraction_failed"
    assert row.original_payload["aggregate_id"] == "case-1"
    assert row.resolved_at is None
    assert repository.saved_pairs == []

    llm.should_fail = False
    llm.response_text = (
        '{"qa_pairs":[{"question_text":"対象機能は?","answer_text":"DLQ統合です",'
        '"turn_range":[1,2],"confidence":0.91,"source_domain":"estimation"}]}'
    )

    processor = DeadLetterRetryProcessor(
        store=store,
        retry_handler=handler.retry_dead_letter,
    )
    processed = processor.run_once(tenant_id=TENANT_A, now=BASE_TIME)

    assert processed == 1
    assert row.resolved_at == BASE_TIME
    assert [pair.question_text for pair in repository.saved_pairs] == ["対象機能は?"]


def test_handler_exception_nacks_message_for_redelivery() -> None:
    shutdown_event = _FakeStopEvent(flagged=True)
    processed: list[dict[str, Any]] = []
    client = _FakeSubscriberClient()

    def _handler(payload: dict[str, Any]) -> None:
        if shutdown_event.is_set():
            raise RuntimeError("shutdown in progress")
        processed.append(payload)

    subscriber = ConversationTurnCompletedSubscriber(
        client=client,
        project_id="proj",
        subscription_id="sub",
        handler=_handler,
    )
    subscriber.start()
    assert client.callback is not None

    message = _FakeMessage(
        payload={
            "id": "evt-shutdown",
            "tenant_id": TENANT_A,
            "event_name": EVENT_TYPE,
            "payload": {"session_id": "case-shutdown"},
        }
    )
    client.callback(message)

    assert processed == []
    assert message.acked is False
    assert message.nacked is True


def test_retry_loop_processes_due_event_before_stop() -> None:
    """Verify DeadLetterRetryLoop.run() actually invokes the processor."""
    store, db, _ = _make_store()
    db.seed_event(
        tenant_id=TENANT_A,
        event_id="evt-loop",
        created_at=BASE_TIME,
        original_payload={
            "tenant_id": TENANT_A,
            "event_id": "evt-loop",
            "event_type": EVENT_TYPE,
            "payload": {"session_id": "case-loop"},
        },
    )
    handled: list[dict[str, Any]] = []

    def _succeed(payload: dict[str, Any]) -> None:
        handled.append(payload)

    stop = threading.Event()
    processed = threading.Event()

    original_succeed = _succeed

    def _succeed_and_signal(payload: dict[str, Any]) -> None:
        original_succeed(payload)
        processed.set()

    processor = DeadLetterRetryProcessor(store=store, retry_handler=_succeed_and_signal)
    loop = DeadLetterRetryLoop(processor=processor, poll_interval_seconds=0.01)

    def _run_loop() -> None:
        loop.run(stop)

    t = threading.Thread(target=_run_loop, daemon=True)
    t.start()

    # Wait for the event to be processed, then signal stop.
    assert processed.wait(timeout=2.0), "retry loop did not process the event in time"
    stop.set()
    t.join(timeout=2.0)

    assert len(handled) >= 1
    assert handled[0]["event_id"] == "evt-loop"
    row = db.find_row("evt-loop")
    assert row.resolved_at is not None


def test_run_cancels_subscription_and_closes_resources_on_shutdown() -> None:
    fake_config = MagicMock(
        database_url="postgresql://example",
        db_pool_min=1,
        db_pool_max=2,
        llm_gateway_url="http://gw:8081",
        structured_output_model="qwen",
        dead_letter_max_retries=3,
        intent_classifier_model="qwen-intent",
        control_api_url="http://control-api:8080",
        control_api_token="token",
        pubsub_project_id="project-1",
        pubsub_subscription="conversation-turn-completed",
        market_pubsub_subscription="market-research-requested",
        grok_api_key=None,
        brave_api_key=None,
        perplexity_api_key=None,
        gemini_api_key=None,
        pubsub_topic="observation-events",
    )
    conn_manager = MagicMock()
    thread_factory = _FakeThreadFactory()
    subscriber_factory = _FakeRuntimeSubscriberFactory()
    subscriber_client = _FakePubSubClient()
    shutdown_event = _FakeStopEvent(flagged=True)

    with (
        patch.object(main_module, "_shutdown_event", shutdown_event),
        patch.object(main_module, "load_config", return_value=fake_config),
        patch.object(main_module, "RLSConnectionManager", return_value=conn_manager),
        patch.object(main_module.threading, "Thread", side_effect=thread_factory),
        patch.object(
            main_module.pubsub_v1,
            "SubscriberClient",
            return_value=subscriber_client,
        ),
        patch.object(
            main_module,
            "EventSubscriber",
            side_effect=subscriber_factory,
        ),
        patch.object(
            main_module.pubsub_v1,
            "PublisherClient",
            return_value=subscriber_client,
        ),
    ):
        main_module.run()

    assert len(thread_factory.instances) == 1
    retry_thread = thread_factory.instances[0]
    assert retry_thread.name == "dead-letter-retry-loop"
    assert retry_thread.daemon is True
    assert retry_thread.started is True
    assert retry_thread.join_calls == [1]

    assert len(subscriber_factory.instances) == 1
    subscriber = subscriber_factory.instances[0]
    assert subscriber.started is True
    assert subscriber.future.canceled is True
    assert subscriber.init_kwargs["project_id"] == "project-1"
    assert subscriber.init_kwargs["subscription_id"] == ("conversation-turn-completed")
    assert set(subscriber.init_kwargs["handlers"]) == {
        "conversation.turn.completed",
        "observation.completeness.updated",
    }
    assert shutdown_event.wait_calls == [None]
    assert subscriber_client.closed is True
    conn_manager.close_all.assert_called_once_with()
