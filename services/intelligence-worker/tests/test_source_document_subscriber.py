"""Tests for source document uploaded subscriber."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from intelligence_worker.source_document_subscriber import (
    SourceDocumentUploadedSubscriber,
)

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
    callback: Callable[[_FakeMessage], None] | None = None
    future: _FakeFuture = field(default_factory=_FakeFuture)

    def subscribe(
        self, subscription: str, callback: Callable[[_FakeMessage], None]
    ) -> _FakeFuture:
        _ = subscription
        self.callback = callback
        return self.future


def test_subscriber_handles_dot_notation_event() -> None:
    client = _FakeClient()
    handled: list[dict[str, object]] = []
    subscriber = SourceDocumentUploadedSubscriber(
        client=client,
        project_id="proj",
        subscription_id="sub",
        handler=lambda payload: handled.append(payload),
    )

    subscriber.start()
    assert client.callback is not None

    msg = _FakeMessage(payload={"event_type": "source.document.uploaded", "x": 1})
    client.callback(msg)

    assert len(handled) == 1
    assert msg.acked is True
    assert msg.nacked is False


def test_subscriber_handles_legacy_pascal_case_event() -> None:
    client = _FakeClient()
    handled: list[dict[str, object]] = []
    subscriber = SourceDocumentUploadedSubscriber(
        client=client,
        project_id="proj",
        subscription_id="sub",
        handler=lambda payload: handled.append(payload),
    )

    subscriber.start()
    assert client.callback is not None

    msg = _FakeMessage(payload={"event_name": "SourceDocumentUploaded", "x": 1})
    client.callback(msg)

    assert len(handled) == 1
    assert msg.acked is True


def test_subscriber_nacks_when_handler_fails() -> None:
    client = _FakeClient()

    def _raise(_: dict[str, object]) -> None:
        raise RuntimeError("boom")

    subscriber = SourceDocumentUploadedSubscriber(
        client=client,
        project_id="proj",
        subscription_id="sub",
        handler=_raise,
    )

    subscriber.start()
    assert client.callback is not None

    msg = _FakeMessage(payload={"event_type": "source.document.uploaded"})
    client.callback(msg)

    assert msg.acked is False
    assert msg.nacked is True
