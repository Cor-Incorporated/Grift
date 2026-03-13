"""Tests for market research Pub/Sub subscriber."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from intelligence_worker.market.subscriber import MarketResearchRequestedSubscriber

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


def test_market_subscriber_accepts_canonical_event() -> None:
    client = _FakeClient()
    handled: list[dict[str, object]] = []
    subscriber = MarketResearchRequestedSubscriber(
        client=client,
        project_id="proj",
        subscription_id="sub",
        handler=lambda payload: handled.append(payload),
    )
    subscriber.start()
    assert client.callback is not None

    message = _FakeMessage(
        payload={
            "event_type": "market.research.requested",
            "payload": {"evidence_id": "e-1", "tenant_id": "t-1"},
        }
    )
    client.callback(message)

    assert handled == [{"evidence_id": "e-1", "tenant_id": "t-1"}]
    assert message.acked is True
    assert message.nacked is False


def test_market_subscriber_accepts_legacy_alias() -> None:
    client = _FakeClient()
    handled: list[dict[str, object]] = []
    subscriber = MarketResearchRequestedSubscriber(
        client=client,
        project_id="proj",
        subscription_id="sub",
        handler=lambda payload: handled.append(payload),
    )
    subscriber.start()
    assert client.callback is not None

    message = _FakeMessage(
        payload={
            "event_name": "MarketResearchRequested",
            "payload": {"evidence_id": "e-2", "tenant_id": "t-2"},
        }
    )
    client.callback(message)

    assert handled == [{"evidence_id": "e-2", "tenant_id": "t-2"}]
    assert message.acked is True
    assert message.nacked is False
