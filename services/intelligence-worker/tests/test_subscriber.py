"""Tests for conversation turn completed subscriber."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from intelligence_worker.subscriber import ConversationTurnCompletedSubscriber

if TYPE_CHECKING:
    from collections.abc import Callable


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
class _FakeClient:
    subscription: str | None = None
    callback: Callable[[_FakeMessage], None] | None = None
    future: _FakeFuture = field(default_factory=_FakeFuture)

    def subscribe(
        self, subscription: str, callback: Callable[[_FakeMessage], None]
    ) -> _FakeFuture:
        self.subscription = subscription
        self.callback = callback
        return self.future


def test_subscriber_starts_without_blocking() -> None:
    client = _FakeClient()
    called: list[dict[str, object]] = []
    subscriber = ConversationTurnCompletedSubscriber(
        client=client,
        project_id="proj",
        subscription_id="sub",
        handler=lambda payload: called.append(payload),
    )

    future = subscriber.start()

    assert future is client.future
    assert client.subscription == "projects/proj/subscriptions/sub"
    assert called == []


def test_subscriber_acks_after_successful_handler() -> None:
    client = _FakeClient()
    handled: list[dict[str, object]] = []
    subscriber = ConversationTurnCompletedSubscriber(
        client=client,
        project_id="proj",
        subscription_id="sub",
        handler=lambda payload: handled.append(payload),
    )
    subscriber.start()
    assert client.callback is not None

    msg = _FakeMessage(payload={"event_name": "conversation.turn.completed", "id": 1})
    client.callback(msg)

    assert len(handled) == 1
    assert msg.acked is True
    assert msg.nacked is False


def test_subscriber_nacks_when_handler_raises() -> None:
    client = _FakeClient()

    def _raise(_: dict[str, object]) -> None:
        raise RuntimeError("boom")

    subscriber = ConversationTurnCompletedSubscriber(
        client=client,
        project_id="proj",
        subscription_id="sub",
        handler=_raise,
    )
    subscriber.start()
    assert client.callback is not None

    msg = _FakeMessage(payload={"eventName": "conversation.turn.completed", "id": 1})
    client.callback(msg)

    assert msg.acked is False
    assert msg.nacked is True


def test_subscriber_acks_and_skips_other_events() -> None:
    client = _FakeClient()
    handled: list[dict[str, object]] = []
    subscriber = ConversationTurnCompletedSubscriber(
        client=client,
        project_id="proj",
        subscription_id="sub",
        handler=lambda payload: handled.append(payload),
    )
    subscriber.start()
    assert client.callback is not None

    msg = _FakeMessage(payload={"event_name": "conversation.session.started", "id": 2})
    client.callback(msg)

    assert handled == []
    assert msg.acked is True
    assert msg.nacked is False


def test_subscriber_nacks_invalid_json_payload() -> None:
    client = _FakeClient()
    subscriber = ConversationTurnCompletedSubscriber(
        client=client,
        project_id="proj",
        subscription_id="sub",
        handler=lambda _: None,
    )
    subscriber.start()
    assert client.callback is not None

    @dataclass
    class _BadMessage:
        acked: bool = False
        nacked: bool = False
        data: bytes = b"{invalid-json"

        def ack(self) -> None:
            self.acked = True

        def nack(self) -> None:
            self.nacked = True

    bad_message = _BadMessage()
    client.callback(bad_message)
    assert bad_message.acked is False
    assert bad_message.nacked is True
