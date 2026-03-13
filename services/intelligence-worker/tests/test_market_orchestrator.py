from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from intelligence_worker.market.models import (
    AggregatedEvidence,
    EvidenceFragment,
    MarketQuery,
    Range,
)
from intelligence_worker.market.orchestrator import MarketIntelligenceOrchestrator
from intelligence_worker.market.runtime import MarketResearchRequestedHandler
from intelligence_worker.market.subscriber import MarketResearchRequestedSubscriber


def _query() -> MarketQuery:
    return MarketQuery(
        evidence_id="11111111-1111-1111-1111-111111111111",
        tenant_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        case_id="22222222-2222-2222-2222-222222222222",
        case_type="new_project",
        context="Build a multi-tenant SaaS platform",
        providers=("grok", "brave", "perplexity", "gemini"),
    )


def _fragment(
    provider: str,
    *,
    rate: tuple[float, float],
    hours: tuple[float, float],
) -> EvidenceFragment:
    return EvidenceFragment(
        provider=provider,  # type: ignore[arg-type]
        hourly_rate_range=Range(min=rate[0], max=rate[1]),
        total_hours_range=Range(min=hours[0], max=hours[1]),
        provider_confidence=0.7,
        retrieved_at=datetime.now(UTC),
        raw_response=provider,
    )


@dataclass
class _FakeRepository:
    calls: list[tuple[MarketQuery, AggregatedEvidence]] = field(default_factory=list)

    def save(self, *, query: MarketQuery, aggregate: AggregatedEvidence) -> None:
        self.calls.append((query, aggregate))


@dataclass
class _Provider:
    name: str
    delay: float = 0.0
    error: Exception | None = None
    tracker: dict[str, int] | None = None
    closed: bool = False

    def provider_name(self) -> str:
        return self.name

    async def search(self, query: MarketQuery) -> list[EvidenceFragment]:
        del query
        if self.tracker is not None:
            self.tracker["current"] += 1
            self.tracker["max"] = max(self.tracker["max"], self.tracker["current"])
        try:
            if self.delay:
                await asyncio.sleep(self.delay)
            if self.error is not None:
                raise self.error
            base = 100 + (len(self.name) * 5)
            return [
                _fragment(
                    self.name,
                    rate=(base, base + 40),
                    hours=(200, 320),
                )
            ]
        finally:
            if self.tracker is not None:
                self.tracker["current"] -= 1

    async def aclose(self) -> None:
        self.closed = True


@dataclass
class _FakeFuture:
    canceled: bool = False

    def cancel(self) -> None:
        self.canceled = True

    def result(self) -> None:
        return None


@dataclass
class _FakeClient:
    callback: Any = None
    subscription: str | None = None
    future: _FakeFuture = field(default_factory=_FakeFuture)

    def subscribe(self, subscription: str, callback: Any) -> _FakeFuture:
        self.subscription = subscription
        self.callback = callback
        return self.future


@dataclass
class _FakeMessage:
    payload: dict[str, Any]
    acked: bool = False
    nacked: bool = False

    @property
    def data(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")

    def ack(self) -> None:
        self.acked = True

    def nack(self) -> None:
        self.nacked = True


def test_orchestrator_runs_providers_in_parallel() -> None:
    tracker = {"current": 0, "max": 0}
    repository = _FakeRepository()
    orchestrator = MarketIntelligenceOrchestrator(
        providers=[
            _Provider("grok", delay=0.05, tracker=tracker),
            _Provider("brave", delay=0.05, tracker=tracker),
            _Provider("perplexity", delay=0.05, tracker=tracker),
            _Provider("gemini", delay=0.05, tracker=tracker),
        ],
        repository=repository,
        timeout_seconds=1.0,
        max_retries=0,
    )

    aggregate = asyncio.run(orchestrator.collect(_query()))

    assert tracker["max"] == 4
    assert len(aggregate.fragments) == 4
    assert len(repository.calls) == 1


def test_orchestrator_gracefully_degrades_when_one_provider_fails() -> None:
    orchestrator = MarketIntelligenceOrchestrator(
        providers=[
            _Provider("grok"),
            _Provider("brave", error=RuntimeError("boom")),
            _Provider("perplexity"),
            _Provider("gemini"),
        ],
        repository=_FakeRepository(),
        timeout_seconds=1.0,
        max_retries=0,
    )

    aggregate = asyncio.run(orchestrator.collect(_query()))

    assert [fragment.provider for fragment in aggregate.fragments] == [
        "grok",
        "perplexity",
        "gemini",
    ]


def test_orchestrator_gracefully_degrades_on_timeout() -> None:
    orchestrator = MarketIntelligenceOrchestrator(
        providers=[
            _Provider("grok", delay=0.05),
            _Provider("brave"),
            _Provider("perplexity"),
            _Provider("gemini"),
        ],
        repository=_FakeRepository(),
        timeout_seconds=0.01,
        max_retries=0,
    )

    aggregate = asyncio.run(orchestrator.collect(_query()))

    assert [fragment.provider for fragment in aggregate.fragments] == [
        "brave",
        "perplexity",
        "gemini",
    ]


def test_orchestrator_closes_providers_after_collection() -> None:
    providers = [_Provider("grok"), _Provider("brave")]
    orchestrator = MarketIntelligenceOrchestrator(
        providers=providers,
        repository=_FakeRepository(),
        timeout_seconds=1.0,
        max_retries=0,
    )

    asyncio.run(
        orchestrator.collect(
            MarketQuery(
                evidence_id="11111111-1111-1111-1111-111111111111",
                tenant_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                case_type="new_project",
                context="Build a multi-tenant SaaS platform",
                providers=("grok", "brave"),
            )
        )
    )

    assert [provider.closed for provider in providers] == [True, True]


def test_market_subscriber_accepts_legacy_alias() -> None:
    client = _FakeClient()
    handled: list[dict[str, Any]] = []
    subscriber = MarketResearchRequestedSubscriber(
        client=client,
        project_id="proj",
        subscription_id="market-sub",
        handler=lambda payload: handled.append(payload),
    )

    subscriber.start()
    assert client.callback is not None
    message = _FakeMessage(
        payload={
            "event_type": "MarketResearchRequested",
            "payload": {"evidence_id": "e-1"},
        }
    )
    client.callback(message)

    assert handled == [{"evidence_id": "e-1"}]
    assert message.acked is True
    assert message.nacked is False


def test_market_handler_uses_nested_payload_evidence_id() -> None:
    seen: list[MarketQuery] = []

    class _Orchestrator:
        async def collect(self, query: MarketQuery) -> AggregatedEvidence:
            seen.append(query)
            return AggregatedEvidence(
                evidence_id=query.evidence_id,
                tenant_id=query.tenant_id,
                case_id=query.case_id,
                fragments=[],
            )

    handler = MarketResearchRequestedHandler(orchestrator=_Orchestrator())  # type: ignore[arg-type]
    handler(
        {
            "event_type": "market.research.requested",
            "tenant_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "payload": {
                "evidence_id": "33333333-3333-3333-3333-333333333333",
                "case_id": "22222222-2222-2222-2222-222222222222",
                "case_type": "new_project",
                "context": "Build a platform",
                "region": "japan",
                "providers": ["grok", "brave"],
            },
        }
    )

    assert len(seen) == 1
    assert seen[0].evidence_id == "33333333-3333-3333-3333-333333333333"
    assert seen[0].tenant_id == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    assert seen[0].providers == ("grok", "brave")
