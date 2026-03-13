"""Async market intelligence orchestrator."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol

import structlog

from intelligence_worker.market.models import (
    AggregatedEvidence,
    ConfidenceLevel,
    Contradiction,
    EvidenceFragment,
    MarketQuery,
    Range,
)

if TYPE_CHECKING:
    from intelligence_worker.market.providers import MarketProvider

logger = structlog.get_logger()


class MarketEvidenceRepository(Protocol):
    def save(self, *, query: MarketQuery, aggregate: AggregatedEvidence) -> None: ...


@dataclass(slots=True)
class MarketIntelligenceOrchestrator:
    """Collect provider evidence in parallel and persist aggregate output."""

    providers: list[MarketProvider]
    repository: MarketEvidenceRepository | None = None
    timeout_seconds: float = 30.0
    max_retries: int = 2

    async def collect(self, query: MarketQuery) -> AggregatedEvidence:
        selected = self._select_providers(query)
        if not selected:
            raise RuntimeError("no market providers available for query")
        try:
            tasks = [
                asyncio.create_task(self._collect_from_provider(provider, query))
                for provider in selected
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            fragments: list[EvidenceFragment] = []
            for result in results:
                if isinstance(result, BaseException):
                    logger.warning("market_provider_failed", error=str(result))
                    continue
                fragments.extend(result)

            if not fragments and selected:
                raise RuntimeError("all market providers failed")

            aggregate = self._aggregate(query, fragments)
            if self.repository is not None:
                self.repository.save(query=query, aggregate=aggregate)
            return aggregate
        finally:
            await asyncio.gather(
                *(_close_provider(provider) for provider in selected),
                return_exceptions=True,
            )

    def _select_providers(self, query: MarketQuery) -> list[MarketProvider]:
        requested = set(query.providers)
        return [
            provider
            for provider in self.providers
            if provider.provider_name() in requested
        ]

    async def _collect_from_provider(
        self,
        provider: MarketProvider,
        query: MarketQuery,
    ) -> list[EvidenceFragment]:
        attempts = self.max_retries + 1
        for attempt in range(1, attempts + 1):
            try:
                return await asyncio.wait_for(
                    provider.search(query),
                    timeout=self.timeout_seconds,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "market_provider_attempt_failed",
                    provider=provider.provider_name(),
                    attempt=attempt,
                    max_attempts=attempts,
                    error=str(exc),
                )
                if attempt >= attempts:
                    return []
        return []

    def _aggregate(
        self,
        query: MarketQuery,
        fragments: list[EvidenceFragment],
    ) -> AggregatedEvidence:
        contradictions = _find_contradictions(fragments)
        consensus_hours = _consensus_range(
            [fragment.total_hours_range for fragment in fragments]
        )
        consensus_rate = _consensus_range(
            [fragment.hourly_rate_range for fragment in fragments]
        )
        confidence = _confidence_level(fragments, contradictions)
        requires_human_review = confidence == "low" or len(contradictions) > 0
        return AggregatedEvidence(
            evidence_id=query.evidence_id,
            tenant_id=query.tenant_id,
            case_id=query.case_id,
            fragments=fragments,
            consensus_hours_range=consensus_hours,
            consensus_rate_range=consensus_rate,
            overall_confidence=confidence,
            contradictions=contradictions,
            requires_human_review=requires_human_review,
            aggregated_at=datetime.now(UTC),
        )


async def _close_provider(provider: MarketProvider) -> None:
    close = getattr(provider, "aclose", None)
    if callable(close):
        await close()


def _consensus_range(ranges: list[Range]) -> Range:
    populated = [
        value
        for value in ranges
        if not value.is_empty and value.min is not None and value.max is not None
    ]
    if not populated:
        return Range()
    best_group: list[Range] = []
    for candidate in populated:
        group = [item for item in populated if candidate.overlaps(item)]
        if len(group) > len(best_group):
            best_group = group
    if not best_group:
        return Range()
    return Range(
        min=max(item.min for item in best_group if item.min is not None),
        max=min(item.max for item in best_group if item.max is not None),
    )


def _find_contradictions(fragments: list[EvidenceFragment]) -> list[Contradiction]:
    contradictions: list[Contradiction] = []
    fields = {
        "hourly_rate_range": lambda fragment: fragment.hourly_rate_range,
        "total_hours_range": lambda fragment: fragment.total_hours_range,
    }
    for index, left in enumerate(fragments):
        for right in fragments[index + 1 :]:
            for field, accessor in fields.items():
                left_range = accessor(left)
                right_range = accessor(right)
                if (
                    left_range.is_empty
                    or right_range.is_empty
                    or left_range.overlaps(right_range)
                ):
                    continue
                contradictions.append(
                    Contradiction(
                        provider_a=left.provider,
                        provider_b=right.provider,
                        field=field,
                        description=(
                            f"{left.provider} and {right.provider} disagree on {field}"
                        ),
                    )
                )
    return contradictions


def _confidence_level(
    fragments: list[EvidenceFragment],
    contradictions: list[Contradiction],
) -> ConfidenceLevel:
    agreeing = _largest_agreement_group(fragments)
    if agreeing >= 3 and not contradictions:
        return "high"
    if agreeing >= 2:
        return "medium"
    return "low"


def _largest_agreement_group(fragments: list[EvidenceFragment]) -> int:
    best = 0
    for base in fragments:
        group = 1
        for other in fragments:
            if base is other:
                continue
            if base.total_hours_range.overlaps(
                other.total_hours_range
            ) or base.hourly_rate_range.overlaps(other.hourly_rate_range):
                group += 1
        best = max(best, group)
    return best
