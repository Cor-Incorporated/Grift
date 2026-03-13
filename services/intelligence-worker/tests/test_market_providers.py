"""Tests for market intelligence provider adapters."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from intelligence_worker.market.models import MarketQuery
from intelligence_worker.market.providers import (
    BraveMarketProvider,
    GeminiMarketProvider,
    GrokMarketProvider,
    PerplexityMarketProvider,
)


@dataclass
class _FakeResponse:
    payload: dict[str, Any]

    @property
    def text(self) -> str:
        return json.dumps(self.payload)

    def json(self) -> dict[str, Any]:
        return self.payload

    def raise_for_status(self) -> None:
        return None


@dataclass
class _FakeClient:
    response: _FakeResponse
    last_url: str | None = None
    last_kwargs: dict[str, Any] | None = None
    closed: bool = False

    async def get(self, url: str, **kwargs: Any) -> _FakeResponse:
        self.last_url = url
        self.last_kwargs = kwargs
        return self.response

    async def post(self, url: str, **kwargs: Any) -> _FakeResponse:
        self.last_url = url
        self.last_kwargs = kwargs
        return self.response

    async def aclose(self) -> None:
        self.closed = True


def _query() -> MarketQuery:
    return MarketQuery(
        evidence_id="11111111-1111-1111-1111-111111111111",
        tenant_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        case_id="22222222-2222-2222-2222-222222222222",
        case_type="new_project",
        context="Build a CRM integration portal for SMB sales teams.",
    )


def test_grok_provider_normalizes_chat_completion() -> None:
    client = _FakeClient(
        response=_FakeResponse(
            {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "hourly_rate_range": {"min": 80, "max": 120},
                                    "total_hours_range": {"min": 200, "max": 320},
                                    "provider_confidence": 0.8,
                                    "citations": [
                                        {
                                            "url": "https://example.com/report",
                                            "title": "Report",
                                            "source_authority": "industry",
                                            "snippet": "Quoted benchmark",
                                        }
                                    ],
                                }
                            )
                        }
                    }
                ]
            }
        )
    )
    provider = GrokMarketProvider(api_key="secret", client=client)

    fragments = __import__("asyncio").run(provider.search(_query()))

    assert len(fragments) == 1
    assert fragments[0].provider == "grok"
    assert fragments[0].hourly_rate_range.min == 80
    assert fragments[0].total_hours_range.max == 320
    assert fragments[0].provider_confidence == 0.8
    assert client.last_kwargs is not None
    assert client.last_kwargs["headers"]["Authorization"] == "Bearer secret"


def test_brave_provider_converts_search_results_to_citations() -> None:
    client = _FakeClient(
        response=_FakeResponse(
            {
                "web": {
                    "results": [
                        {
                            "url": "https://example.com/blog",
                            "title": "Market blog",
                            "description": "A useful benchmark post.",
                        }
                    ]
                }
            }
        )
    )
    provider = BraveMarketProvider(api_key="secret", client=client)

    fragments = __import__("asyncio").run(provider.search(_query()))

    assert len(fragments) == 1
    assert fragments[0].provider == "brave"
    assert len(fragments[0].citations) == 1
    assert fragments[0].citations[0].url == "https://example.com/blog"
    assert client.last_kwargs is not None
    assert client.last_kwargs["headers"]["X-Subscription-Token"] == "secret"


def test_perplexity_provider_normalizes_chat_completion() -> None:
    client = _FakeClient(
        response=_FakeResponse(
            {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "hourly_rate_range": {"min": 100, "max": 140},
                                    "team_size_range": {"min": 2, "max": 4},
                                    "duration_range": {"min": 6, "max": 10},
                                    "provider_confidence": 0.7,
                                }
                            )
                        }
                    }
                ]
            }
        )
    )
    provider = PerplexityMarketProvider(api_key="secret", client=client)

    fragments = __import__("asyncio").run(provider.search(_query()))

    assert len(fragments) == 1
    assert fragments[0].provider == "perplexity"
    assert fragments[0].team_size_range.max == 4
    assert fragments[0].duration_range.min == 6


def test_gemini_provider_normalizes_candidates() -> None:
    client = _FakeClient(
        response=_FakeResponse(
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": json.dumps(
                                        {
                                            "hourly_rate_range": {
                                                "min": 90,
                                                "max": 130,
                                            },
                                            "total_hours_range": {
                                                "min": 150,
                                                "max": 260,
                                            },
                                            "provider_confidence": 0.75,
                                        }
                                    )
                                }
                            ]
                        }
                    }
                ]
            }
        )
    )
    provider = GeminiMarketProvider(api_key="secret", client=client)

    fragments = __import__("asyncio").run(provider.search(_query()))

    assert len(fragments) == 1
    assert fragments[0].provider == "gemini"
    assert fragments[0].hourly_rate_range.max == 130
    assert fragments[0].total_hours_range.min == 150
    assert client.last_url is not None
    assert client.last_url == provider.endpoint
    assert client.last_kwargs is not None
    assert client.last_kwargs["headers"]["x-goog-api-key"] == "secret"
    assert "params" not in client.last_kwargs


def test_provider_aclose_closes_owned_http_client(monkeypatch: Any) -> None:
    class _OwnedClient(_FakeClient):
        def __init__(self) -> None:
            super().__init__(response=_FakeResponse({"choices": []}))

    owned_clients: list[_OwnedClient] = []

    def _factory(*, timeout_seconds: float = 30.0) -> _OwnedClient:
        del timeout_seconds
        client = _OwnedClient()
        owned_clients.append(client)
        return client

    monkeypatch.setattr(
        "intelligence_worker.market.providers.HTTPProviderSearchClient",
        _factory,
    )
    provider = GrokMarketProvider(api_key="secret")

    provider._client()
    __import__("asyncio").run(provider.aclose())

    assert len(owned_clients) == 1
    assert owned_clients[0].closed is True
    assert provider.client is None
