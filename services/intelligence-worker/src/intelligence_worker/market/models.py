"""Market intelligence value objects."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

ProviderName = Literal["grok", "brave", "perplexity", "gemini"]
DEFAULT_MARKET_PROVIDERS: tuple[ProviderName, ...] = (
    "grok",
    "brave",
    "perplexity",
    "gemini",
)
ConfidenceLevel = Literal["high", "medium", "low"]
SourceAuthority = Literal["official", "industry", "community", "unknown"]


@dataclass(frozen=True)
class Range:
    """Numeric range value object."""

    min: float | None = None
    max: float | None = None

    def __post_init__(self) -> None:
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("range min must be <= max")

    @property
    def is_empty(self) -> bool:
        return self.min is None and self.max is None

    def overlap_ratio(self, other: Range) -> float:
        """Return overlap ratio against the smaller available span."""
        if self.is_empty or other.is_empty:
            return 0.0
        if self.min is None or self.max is None:
            return 0.0
        if other.min is None or other.max is None:
            return 0.0

        overlap_min = max(self.min, other.min)
        overlap_max = min(self.max, other.max)
        if overlap_max <= overlap_min:
            return 0.0

        smaller_span = min(self.max - self.min, other.max - other.min)
        if smaller_span <= 0:
            return 0.0
        return (overlap_max - overlap_min) / smaller_span

    def overlaps(self, other: Range, *, threshold: float = 0.3) -> bool:
        return self.overlap_ratio(other) >= threshold

    @classmethod
    def from_values(cls, minimum: object, maximum: object) -> Range:
        return cls(min=_coerce_number(minimum), max=_coerce_number(maximum))

    def to_dict(self) -> dict[str, float]:
        payload: dict[str, float] = {}
        if self.min is not None:
            payload["min"] = self.min
        if self.max is not None:
            payload["max"] = self.max
        return payload


@dataclass(frozen=True)
class Citation:
    """Citation payload for a provider fragment."""

    url: str
    title: str
    source_authority: SourceAuthority = "unknown"
    snippet: str = ""

    def to_dict(self) -> dict[str, str]:
        return {
            "url": self.url,
            "title": self.title,
            "source_authority": self.source_authority,
            "snippet": self.snippet,
        }


@dataclass(frozen=True)
class EvidenceFragment:
    """Provider-specific evidence fragment."""

    provider: ProviderName
    hourly_rate_range: Range = field(default_factory=Range)
    total_hours_range: Range = field(default_factory=Range)
    team_size_range: Range = field(default_factory=Range)
    duration_range: Range = field(default_factory=Range)
    citations: list[Citation] = field(default_factory=list)
    provider_confidence: float = 0.0
    retrieved_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    raw_response: str = ""

    def __post_init__(self) -> None:
        if not 0.0 <= self.provider_confidence <= 1.0:
            raise ValueError("provider_confidence must be between 0 and 1")

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "provider": self.provider,
            "hourly_rate_range": self.hourly_rate_range.to_dict(),
            "total_hours_range": self.total_hours_range.to_dict(),
            "team_size_range": self.team_size_range.to_dict(),
            "duration_range": self.duration_range.to_dict(),
            "citations": [citation.to_dict() for citation in self.citations],
            "provider_confidence": self.provider_confidence,
            "retrieved_at": self.retrieved_at.isoformat(),
        }
        if self.raw_response:
            payload["raw_response"] = self.raw_response
        return payload


@dataclass(frozen=True)
class Contradiction:
    """Conflict between two providers on a single field."""

    provider_a: ProviderName
    provider_b: ProviderName
    field: str
    description: str

    def to_dict(self) -> dict[str, str]:
        return {
            "provider_a": self.provider_a,
            "provider_b": self.provider_b,
            "field": self.field,
            "description": self.description,
        }


@dataclass(frozen=True)
class AggregatedEvidence:
    """Aggregated evidence row persisted for market intelligence."""

    evidence_id: str
    tenant_id: str
    case_id: str | None
    fragments: list[EvidenceFragment]
    consensus_hours_range: Range = field(default_factory=Range)
    consensus_rate_range: Range = field(default_factory=Range)
    overall_confidence: ConfidenceLevel = "low"
    contradictions: list[Contradiction] = field(default_factory=list)
    requires_human_review: bool = False
    aggregated_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def id(self) -> str:
        return self.evidence_id

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.evidence_id,
            "fragments": [fragment.to_dict() for fragment in self.fragments],
            "consensus_hours_range": self.consensus_hours_range.to_dict(),
            "consensus_rate_range": self.consensus_rate_range.to_dict(),
            "overall_confidence": self.overall_confidence,
            "contradictions": [
                contradiction.to_dict() for contradiction in self.contradictions
            ],
            "requires_human_review": self.requires_human_review,
            "aggregated_at": self.aggregated_at.isoformat(),
        }


@dataclass(frozen=True)
class MarketQuery:
    """Input for a market intelligence collection run."""

    evidence_id: str
    tenant_id: str
    case_type: str
    context: str
    region: str = "japan"
    case_id: str | None = None
    providers: tuple[ProviderName, ...] = DEFAULT_MARKET_PROVIDERS

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> MarketQuery:
        return cls(
            tenant_id=str(payload.get("tenant_id") or ""),
            evidence_id=str(payload.get("evidence_id") or payload.get("job_id") or ""),
            case_id=(
                str(payload["case_id"])
                if isinstance(payload.get("case_id"), str) and payload.get("case_id")
                else None
            ),
            case_type=str(payload.get("case_type") or ""),
            context=str(payload.get("context") or ""),
            region=str(payload.get("region") or "japan"),
            providers=_coerce_providers(payload.get("providers")),
        )


def _coerce_number(value: object) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(",", ""))
        except ValueError:
            return None
    return None


def _coerce_providers(value: object) -> tuple[ProviderName, ...]:
    if not isinstance(value, (list, tuple)):
        return DEFAULT_MARKET_PROVIDERS

    normalized: list[ProviderName] = []
    for item in value:
        if item in DEFAULT_MARKET_PROVIDERS:
            normalized.append(item)
    return tuple(normalized) or DEFAULT_MARKET_PROVIDERS
