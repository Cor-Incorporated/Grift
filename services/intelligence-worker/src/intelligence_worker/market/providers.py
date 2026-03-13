"""Market intelligence provider adapters."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol, cast

import httpx

from intelligence_worker.market.models import (
    Citation,
    EvidenceFragment,
    MarketQuery,
    ProviderName,
    Range,
    SourceAuthority,
)

_JSON_PROMPT = """\
You are collecting market benchmark evidence for software delivery estimation.
Return JSON only with this schema:
{
  "hourly_rate_range": {"min": number|null, "max": number|null},
  "total_hours_range": {"min": number|null, "max": number|null},
  "team_size_range": {"min": number|null, "max": number|null},
  "duration_range": {"min": number|null, "max": number|null},
  "citations": [
    {
      "url": "https://example.com",
      "title": "source title",
      "source_authority": "official|industry|community|unknown",
      "snippet": "relevant excerpt"
    }
  ],
  "provider_confidence": 0.0
}
Use null when data is unavailable.
"""

_NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?")


class MarketProvider(Protocol):
    async def search(self, query: MarketQuery) -> list[EvidenceFragment]: ...

    def provider_name(self) -> str: ...


class AsyncHTTPResponse(Protocol):
    @property
    def text(self) -> str: ...

    def json(self) -> Any: ...

    def raise_for_status(self) -> None: ...


class AsyncHTTPClient(Protocol):
    async def get(self, url: str, **kwargs: Any) -> AsyncHTTPResponse: ...

    async def post(self, url: str, **kwargs: Any) -> AsyncHTTPResponse: ...

    async def aclose(self) -> None: ...


class HTTPProviderSearchClient:
    """Default reusable async HTTP client wrapper for providers."""

    def __init__(self, *, timeout_seconds: float = 30.0) -> None:
        self._client = httpx.AsyncClient(timeout=timeout_seconds)

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self._client.get(url, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self._client.post(url, **kwargs)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> HTTPProviderSearchClient:
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.aclose()


@dataclass(slots=True)
class _BaseProvider:
    api_key: str
    client: AsyncHTTPClient | None = None
    _owns_client: bool = field(init=False, default=False, repr=False)

    def _client(self) -> AsyncHTTPClient:
        if self.client is None:
            self.client = HTTPProviderSearchClient()
            self._owns_client = True
        return cast("AsyncHTTPClient", self.client)

    async def aclose(self) -> None:
        if self._owns_client and self.client is not None:
            await self.client.aclose()
            self.client = None
            self._owns_client = False

    def _json_headers(self) -> dict[str, str]:
        return {"Content-Type": "application/json"}

    def _coerce_fragment(
        self,
        *,
        provider: ProviderName,
        query: MarketQuery,
        raw_payload: Any,
        raw_response: str,
        citations: list[Citation] | None = None,
    ) -> EvidenceFragment:
        del query
        payload = _extract_payload(raw_payload)
        parsed_citations = (
            citations if citations is not None else _parse_citations(payload)
        )
        return EvidenceFragment(
            provider=provider,
            hourly_rate_range=_parse_range(payload.get("hourly_rate_range")),
            total_hours_range=_parse_range(payload.get("total_hours_range")),
            team_size_range=_parse_range(payload.get("team_size_range")),
            duration_range=_parse_range(payload.get("duration_range")),
            citations=parsed_citations,
            provider_confidence=_coerce_confidence(payload.get("provider_confidence")),
            retrieved_at=datetime.now(UTC),
            raw_response=raw_response,
        )


@dataclass(slots=True)
class GrokMarketProvider(_BaseProvider):
    endpoint: str = "https://api.x.ai/v1/chat/completions"
    model: str = "grok-3-beta"

    def provider_name(self) -> str:
        return "grok"

    async def search(self, query: MarketQuery) -> list[EvidenceFragment]:
        response = await self._client().post(
            self.endpoint,
            headers={
                **self._json_headers(),
                "Authorization": f"Bearer {self.api_key}",
            },
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": _JSON_PROMPT},
                    {"role": "user", "content": _build_prompt(query, "grok")},
                ],
                "stream": False,
            },
        )
        response.raise_for_status()
        body = response.json()
        content = _extract_chat_content(body)
        return [
            self._coerce_fragment(
                provider="grok",
                query=query,
                raw_payload=content,
                raw_response=response.text,
            )
        ]


@dataclass(slots=True)
class BraveMarketProvider(_BaseProvider):
    endpoint: str = "https://api.search.brave.com/res/v1/web/search"

    def provider_name(self) -> str:
        return "brave"

    async def search(self, query: MarketQuery) -> list[EvidenceFragment]:
        response = await self._client().get(
            self.endpoint,
            headers={
                "Accept": "application/json",
                "X-Subscription-Token": self.api_key,
            },
            params={"q": _build_prompt(query, "brave"), "count": 5},
        )
        response.raise_for_status()
        body = response.json()
        citations = _parse_brave_citations(body)
        return [
            self._coerce_fragment(
                provider="brave",
                query=query,
                raw_payload=_extract_payload(body),
                raw_response=response.text,
                citations=citations,
            )
        ]


@dataclass(slots=True)
class PerplexityMarketProvider(_BaseProvider):
    endpoint: str = "https://api.perplexity.ai/chat/completions"
    model: str = "sonar-pro"

    def provider_name(self) -> str:
        return "perplexity"

    async def search(self, query: MarketQuery) -> list[EvidenceFragment]:
        response = await self._client().post(
            self.endpoint,
            headers={
                **self._json_headers(),
                "Authorization": f"Bearer {self.api_key}",
            },
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": _JSON_PROMPT},
                    {"role": "user", "content": _build_prompt(query, "perplexity")},
                ],
            },
        )
        response.raise_for_status()
        body = response.json()
        content = _extract_chat_content(body)
        return [
            self._coerce_fragment(
                provider="perplexity",
                query=query,
                raw_payload=content,
                raw_response=response.text,
            )
        ]


@dataclass(slots=True)
class GeminiMarketProvider(_BaseProvider):
    endpoint: str = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-2.0-flash:generateContent"
    )

    def provider_name(self) -> str:
        return "gemini"

    async def search(self, query: MarketQuery) -> list[EvidenceFragment]:
        response = await self._client().post(
            self.endpoint,
            headers={
                **self._json_headers(),
                "x-goog-api-key": self.api_key,
            },
            json={
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {
                                "text": (
                                    f"{_JSON_PROMPT}\n\n"
                                    f"{_build_prompt(query, 'gemini')}"
                                )
                            }
                        ],
                    }
                ]
            },
        )
        response.raise_for_status()
        body = response.json()
        content = _extract_gemini_text(body)
        return [
            self._coerce_fragment(
                provider="gemini",
                query=query,
                raw_payload=content,
                raw_response=response.text,
            )
        ]


def build_default_providers(
    *, client: AsyncHTTPClient | None = None
) -> list[MarketProvider]:
    return [
        GrokMarketProvider(api_key=_env("GROK_API_KEY", "XAI_API_KEY"), client=client),
        BraveMarketProvider(
            api_key=_env("BRAVE_API_KEY", "BRAVE_SEARCH_API_KEY"),
            client=client,
        ),
        PerplexityMarketProvider(
            api_key=_env("PERPLEXITY_API_KEY"),
            client=client,
        ),
        GeminiMarketProvider(api_key=_env("GEMINI_API_KEY"), client=client),
    ]


def _env(primary: str, alias: str | None = None) -> str:
    value = os.environ.get(primary)
    if value:
        return value
    if alias:
        alias_value = os.environ.get(alias)
        if alias_value:
            return alias_value
    raise ValueError(f"Missing required environment variable: {primary}")


def _build_prompt(query: MarketQuery, provider: str) -> str:
    providers = ", ".join(query.providers)
    return (
        f"Provider: {provider}\n"
        f"Case type: {query.case_type}\n"
        f"Region: {query.region}\n"
        f"Requested providers: {providers}\n"
        f"Project context:\n{query.context}"
    )


def _extract_chat_content(body: Any) -> Any:
    if isinstance(body, dict):
        choices = body.get("choices")
        if isinstance(choices, list) and choices:
            return choices[0].get("message", {}).get("content", body)
    return body


def _extract_gemini_text(body: Any) -> Any:
    if isinstance(body, dict):
        candidates = body.get("candidates")
        if isinstance(candidates, list) and candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            if isinstance(parts, list):
                text = "".join(
                    part.get("text", "") for part in parts if isinstance(part, dict)
                )
                if text:
                    return text
    return body


def _extract_payload(raw_payload: Any) -> dict[str, Any]:
    if isinstance(raw_payload, str):
        try:
            decoded = json.loads(raw_payload)
        except json.JSONDecodeError:
            return _parse_ranges_from_text(raw_payload)
        if isinstance(decoded, dict):
            return decoded
        return {}
    if isinstance(raw_payload, dict):
        if "result" in raw_payload and isinstance(raw_payload["result"], dict):
            return raw_payload["result"]
        return raw_payload
    return {}


def _parse_ranges_from_text(text: str) -> dict[str, Any]:
    numbers = [float(match.group()) for match in _NUMBER_RE.finditer(text)]
    if len(numbers) < 2:
        return {"provider_confidence": 0.2}
    return {
        "hourly_rate_range": {"min": numbers[0], "max": numbers[1]},
        "total_hours_range": (
            {"min": numbers[2], "max": numbers[3]} if len(numbers) >= 4 else {}
        ),
        "provider_confidence": 0.3,
    }


def _parse_range(payload: Any) -> Range:
    if not isinstance(payload, dict):
        return Range()
    return Range.from_values(payload.get("min"), payload.get("max"))


def _parse_citations(payload: dict[str, Any]) -> list[Citation]:
    raw_citations = payload.get("citations")
    if not isinstance(raw_citations, list):
        return []
    citations: list[Citation] = []
    for item in raw_citations:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        title = item.get("title")
        if not isinstance(url, str) or not isinstance(title, str):
            continue
        authority = item.get("source_authority")
        if authority not in ("official", "industry", "community", "unknown"):
            authority = "unknown"
        snippet = item.get("snippet") if isinstance(item.get("snippet"), str) else ""
        citations.append(
            Citation(
                url=url,
                title=title,
                source_authority=cast("SourceAuthority", authority),
                snippet=str(snippet),
            )
        )
    return citations


def _parse_brave_citations(body: Any) -> list[Citation]:
    if not isinstance(body, dict):
        return []
    results = body.get("web", {}).get("results", [])
    citations: list[Citation] = []
    if not isinstance(results, list):
        return citations
    for result in results[:5]:
        if not isinstance(result, dict):
            continue
        url = result.get("url")
        title = result.get("title")
        if not isinstance(url, str) or not isinstance(title, str):
            continue
        citations.append(
            Citation(
                url=url,
                title=title,
                source_authority="industry",
                snippet=result.get("description", "")
                if isinstance(result.get("description"), str)
                else "",
            )
        )
    return citations


def _coerce_confidence(value: object) -> float:
    if isinstance(value, (int, float)):
        value = float(value)
        return min(max(value, 0.0), 1.0)
    return 0.0
