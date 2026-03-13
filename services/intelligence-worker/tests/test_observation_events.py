"""Tests for observation event publishing."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from unittest.mock import patch

from intelligence_worker.completeness_tracker import (
    ChecklistItemStatus,
    CompletenessTrackingSnapshot,
)
from intelligence_worker.observation_events import CompletenessUpdatedPublisher


@dataclass
class _FakeFuture:
    message_id: str = "msg-1"

    def result(self, timeout: float | None = None) -> str:
        assert timeout == 5
        return self.message_id


@dataclass
class _FakePublisherClient:
    publishes: list[dict[str, object]] = field(default_factory=list)
    future: _FakeFuture = field(default_factory=_FakeFuture)

    def topic_path(self, project_id: str, topic_id: str) -> str:
        return f"projects/{project_id}/topics/{topic_id}"

    def publish(
        self,
        topic: str,
        data: bytes,
        ordering_key: str = "",
    ) -> _FakeFuture:
        self.publishes.append(
            {
                "topic": topic,
                "data": data,
                "ordering_key": ordering_key,
            }
        )
        return self.future


def _snapshot() -> CompletenessTrackingSnapshot:
    return CompletenessTrackingSnapshot(
        domain="estimation",
        checklist={
            "budget": ChecklistItemStatus(status="collected", confidence=1.0),
            "timeline": ChecklistItemStatus(status="partial", confidence=0.5),
        },
        suggested_next_topics=("timeline", "team"),
        overall_completeness=0.8,
        turn_count=6,
    )


def test_publish_snapshot_emits_required_envelope_fields() -> None:
    client = _FakePublisherClient()
    publisher = CompletenessUpdatedPublisher(
        client=client,
        project_id="proj-1",
        topic_id="observation-events",
    )

    with (
        patch(
            "intelligence_worker.observation_events.uuid.uuid4",
            return_value=uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
        ),
        patch(
            "intelligence_worker.observation_events.time.strftime",
            return_value="2026-03-13T00:00:00Z",
        ),
    ):
        message_id = publisher.publish_snapshot(
            tenant_id="tenant-1",
            session_id="session-1",
            source_domain="estimation",
            aggregate_version=6,
            snapshot=_snapshot(),
            causation_id="cause-1",
            correlation_id="corr-1",
        )

    assert message_id == "msg-1"
    assert len(client.publishes) == 1
    publish_call = client.publishes[0]
    assert publish_call["topic"] == "projects/proj-1/topics/observation-events"
    assert publish_call["ordering_key"] == "session-1"

    envelope = json.loads(publish_call["data"])
    for required_field in (
        "event_id",
        "event_type",
        "schema_version",
        "aggregate_type",
        "aggregate_id",
        "aggregate_version",
        "idempotency_key",
        "occurred_at",
        "producer",
        "tenant_id",
        "source_domain",
        "payload",
        "causation_id",
        "correlation_id",
    ):
        assert required_field in envelope

    assert envelope["event_id"] == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    assert envelope["event_type"] == "observation.completeness.updated"
    assert envelope["schema_version"] == "1.0.0"
    assert envelope["aggregate_type"] == "observation"
    assert envelope["aggregate_id"] == "session-1"
    assert envelope["aggregate_version"] == 6
    assert envelope["idempotency_key"] == "session-1:6:completeness"
    assert envelope["occurred_at"] == "2026-03-13T00:00:00Z"
    assert envelope["producer"] == "intelligence-worker"
    assert envelope["tenant_id"] == "tenant-1"
    assert envelope["source_domain"] == "estimation"
    assert envelope["causation_id"] == "cause-1"
    assert envelope["correlation_id"] == "corr-1"
    assert envelope["payload"] == {
        "session_id": "session-1",
        "checklist": {
            "budget": {"status": "collected", "confidence": 1.0},
            "timeline": {"status": "partial", "confidence": 0.5},
        },
        "overall_completeness": 0.8,
        "suggested_next_topics": ["timeline", "team"],
    }


def test_publish_snapshot_omits_optional_causation_fields_when_not_provided() -> None:
    client = _FakePublisherClient()
    publisher = CompletenessUpdatedPublisher(
        client=client,
        project_id="proj-1",
        topic_id="observation-events",
    )

    publisher.publish_snapshot(
        tenant_id="tenant-1",
        session_id="session-1",
        source_domain="estimation",
        aggregate_version=7,
        snapshot=_snapshot(),
    )

    envelope = json.loads(client.publishes[0]["data"])
    assert "causation_id" not in envelope
    assert "correlation_id" not in envelope
