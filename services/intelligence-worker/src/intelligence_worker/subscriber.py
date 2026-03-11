"""Pub/Sub subscriber for conversation turn completion events."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any, Protocol


class ReceivedMessage(Protocol):
    """Minimal Pub/Sub message contract."""

    data: bytes

    def ack(self) -> None: ...

    def nack(self) -> None: ...


class StreamingPullFuture(Protocol):
    """Minimal streaming future contract."""

    def cancel(self) -> None: ...

    def result(self) -> Any: ...


class SubscriberClient(Protocol):
    """Minimal Pub/Sub subscriber client contract."""

    def subscribe(
        self, subscription: str, callback: Callable[[ReceivedMessage], None]
    ) -> StreamingPullFuture: ...


TurnCompletedHandler = Callable[[dict[str, Any]], None]


class ConversationTurnCompletedSubscriber:
    """Subscribe to `conversation.turn.completed` events and dispatch handler."""

    TARGET_EVENT_NAME = "conversation.turn.completed"

    def __init__(
        self,
        *,
        client: SubscriberClient,
        project_id: str,
        subscription_id: str,
        handler: TurnCompletedHandler,
    ) -> None:
        self._client = client
        self._subscription_path = (
            f"projects/{project_id}/subscriptions/{subscription_id}"
        )
        self._handler = handler

    def start(self) -> StreamingPullFuture:
        """Start subscription and return immediately."""
        return self._client.subscribe(self._subscription_path, self._on_message)

    def _on_message(self, message: ReceivedMessage) -> None:
        try:
            payload = json.loads(message.data.decode("utf-8"))
            event_name = _extract_event_name(payload)
            if event_name != self.TARGET_EVENT_NAME:
                message.ack()
                return
            self._handler(payload)
            message.ack()
        except Exception:  # noqa: BLE001
            message.nack()


def _extract_event_name(payload: dict[str, Any]) -> str | None:
    """Best-effort extraction for event name compatibility."""
    event_name = (
        payload.get("event_name")
        or payload.get("eventName")
        or payload.get("event_type")
    )
    if isinstance(event_name, str):
        return event_name

    envelope = payload.get("envelope")
    if isinstance(envelope, dict):
        env_event = (
            envelope.get("event_name")
            or envelope.get("eventName")
            or envelope.get("event_type")
        )
        if isinstance(env_event, str):
            return env_event

    return None
