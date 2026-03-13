"""Runtime wiring for market intelligence collection."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

import structlog

from intelligence_worker.market.models import MarketQuery
from intelligence_worker.market.orchestrator import MarketIntelligenceOrchestrator
from intelligence_worker.market.payloads import extract_market_payload
from intelligence_worker.market.providers import (
    AsyncHTTPClient,
    BraveMarketProvider,
    GeminiMarketProvider,
    GrokMarketProvider,
    HTTPProviderSearchClient,
    MarketProvider,
    PerplexityMarketProvider,
)
from intelligence_worker.market.repository import MarketEvidenceRepository
from intelligence_worker.market.subscriber import (
    MarketResearchRequestedSubscriber,
    StreamingPullFuture,
    SubscriberClient,
)

if TYPE_CHECKING:
    from intelligence_worker.db import RLSConnectionManager

logger = structlog.get_logger()

PostgresMarketEvidenceRepository = MarketEvidenceRepository


class MarketRuntimeConfig(Protocol):
    pubsub_project_id: str
    market_pubsub_subscription: str
    grok_api_key: str | None
    brave_api_key: str | None
    perplexity_api_key: str | None
    gemini_api_key: str | None
    market_provider_timeout_seconds: float
    market_provider_max_retries: int


@dataclass(slots=True)
class MarketResearchRequestedHandler:
    """Sync Pub/Sub callback that runs async market orchestration."""

    orchestrator: MarketIntelligenceOrchestrator

    def __call__(self, payload: dict[str, Any]) -> None:
        query = MarketQuery.from_payload(extract_market_payload(payload))
        logger.info(
            "market_research_requested",
            evidence_id=query.evidence_id,
            tenant_id=query.tenant_id,
            case_id=query.case_id,
            providers=list(query.providers),
        )
        evidence = asyncio.run(self.orchestrator.collect(query))
        logger.info(
            "market_research_completed",
            evidence_id=evidence.id,
            tenant_id=evidence.tenant_id,
            fragment_count=len(evidence.fragments),
            overall_confidence=evidence.overall_confidence,
        )


@dataclass(slots=True)
class MarketRuntime:
    """Started market runtime resources owned by the worker process."""

    future: StreamingPullFuture
    subscription_id: str
    http_client: AsyncHTTPClient

    async def aclose(self) -> None:
        await self.http_client.aclose()

    def close(self) -> None:
        asyncio.run(self.aclose())


def build_market_providers(
    *,
    grok_api_key: str | None,
    brave_api_key: str | None,
    perplexity_api_key: str | None,
    gemini_api_key: str | None,
    client: AsyncHTTPClient | None = None,
) -> list[MarketProvider]:
    providers: list[MarketProvider] = []
    if grok_api_key:
        providers.append(GrokMarketProvider(api_key=grok_api_key, client=client))
    if brave_api_key:
        providers.append(BraveMarketProvider(api_key=brave_api_key, client=client))
    if perplexity_api_key:
        providers.append(
            PerplexityMarketProvider(api_key=perplexity_api_key, client=client)
        )
    if gemini_api_key:
        providers.append(GeminiMarketProvider(api_key=gemini_api_key, client=client))
    return providers


def market_feature_enabled(config: MarketRuntimeConfig) -> bool:
    return any(
        (
            config.grok_api_key,
            config.brave_api_key,
            config.perplexity_api_key,
            config.gemini_api_key,
        )
    )


def start_market_subscriber(
    *,
    config: MarketRuntimeConfig,
    subscriber_client: SubscriberClient,
    conn_manager: RLSConnectionManager,
    client: AsyncHTTPClient | None = None,
) -> MarketRuntime | None:
    if not market_feature_enabled(config):
        logger.warning(
            "market_subscriber_skipped_missing_credentials",
            has_grok=bool(config.grok_api_key),
            has_brave=bool(config.brave_api_key),
            has_perplexity=bool(config.perplexity_api_key),
            has_gemini=bool(config.gemini_api_key),
        )
        return None

    http_client = client or HTTPProviderSearchClient(
        timeout_seconds=config.market_provider_timeout_seconds
    )
    market_handler = MarketResearchRequestedHandler(
        orchestrator=MarketIntelligenceOrchestrator(
            providers=build_market_providers(
                grok_api_key=config.grok_api_key,
                brave_api_key=config.brave_api_key,
                perplexity_api_key=config.perplexity_api_key,
                gemini_api_key=config.gemini_api_key,
                client=http_client,
            ),
            repository=PostgresMarketEvidenceRepository(conn_manager),
            timeout_seconds=config.market_provider_timeout_seconds,
            max_retries=config.market_provider_max_retries,
        )
    )
    market_subscriber = MarketResearchRequestedSubscriber(
        client=subscriber_client,
        project_id=config.pubsub_project_id,
        subscription_id=config.market_pubsub_subscription,
        handler=market_handler,
    )
    future = market_subscriber.start()
    logger.info(
        "market_subscriber_started",
        project_id=config.pubsub_project_id,
        subscription=config.market_pubsub_subscription,
    )
    return MarketRuntime(
        future=future,
        subscription_id=config.market_pubsub_subscription,
        http_client=http_client,
    )
