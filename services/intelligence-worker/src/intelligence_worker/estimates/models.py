"""Value objects for estimate proposal generation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ConfidenceLevel = Literal["high", "medium", "low"]
SourceAuthority = Literal["official", "industry", "community", "unknown"]


@dataclass(frozen=True)
class Range:
    """Numeric range value object."""

    min: float | None = None
    max: float | None = None

    @property
    def is_empty(self) -> bool:
        return self.min is None and self.max is None

    def to_dict(self) -> dict[str, float]:
        payload: dict[str, float] = {}
        if self.min is not None:
            payload["min"] = self.min
        if self.max is not None:
            payload["max"] = self.max
        return payload


@dataclass(frozen=True)
class Citation:
    """Citation payload for market benchmark evidence."""

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
class EstimateQuery:
    """Input for ThreeWayProposal generation."""

    tenant_id: str
    estimate_id: str
    case_id: str | None = None

    def __post_init__(self) -> None:
        if not self.tenant_id:
            raise ValueError("tenant_id is required")
        if not self.estimate_id:
            raise ValueError("estimate_id is required")

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> EstimateQuery:
        nested = payload.get("payload")
        merged = dict(nested) if isinstance(nested, dict) else dict(payload)
        for name in ("tenant_id", "case_id", "estimate_id"):
            value = payload.get(name)
            if (name not in merged or not merged[name]) and isinstance(value, str) and value:
                merged[name] = value

        case_id = merged.get("case_id")
        return cls(
            tenant_id=str(merged.get("tenant_id") or ""),
            estimate_id=str(merged.get("estimate_id") or merged.get("id") or ""),
            case_id=str(case_id) if isinstance(case_id, str) and case_id else None,
        )


@dataclass(frozen=True)
class SimilarProject:
    """Historical project that resembles the current estimate request."""

    name: str
    actual_hours: float
    similarity_score: float

    def to_dict(self) -> dict[str, float | str]:
        return {
            "name": self.name,
            "actual_hours": self.actual_hours,
            "similarity_score": self.similarity_score,
        }


@dataclass(frozen=True)
class OurTrackRecord:
    """Internal historical performance axis."""

    similar_projects: list[SimilarProject] = field(default_factory=list)
    median_hours: float | None = None
    velocity_score: float | None = None

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "similar_projects": [item.to_dict() for item in self.similar_projects],
        }
        if self.median_hours is not None:
            payload["median_hours"] = self.median_hours
        if self.velocity_score is not None:
            payload["velocity_score"] = self.velocity_score
        return payload


@dataclass(frozen=True)
class MarketBenchmark:
    """Validated market benchmark axis."""

    consensus_hours: Range = field(default_factory=Range)
    consensus_rate: Range = field(default_factory=Range)
    confidence: ConfidenceLevel = "low"
    provider_count: int = 0
    citations: list[Citation] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return {
            "consensus_hours": self.consensus_hours.to_dict(),
            "consensus_rate": self.consensus_rate.to_dict(),
            "confidence": self.confidence,
            "provider_count": self.provider_count,
            "citations": [citation.to_dict() for citation in self.citations],
        }


@dataclass(frozen=True)
class OurProposal:
    """Final proposal axis shown to the user."""

    proposed_hours: float | None = None
    proposed_rate: float | None = None
    proposed_total: float | None = None
    savings_vs_market_percent: float | None = None
    competitive_advantages: list[str] = field(default_factory=list)
    calibration_note: str = ""

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "competitive_advantages": self.competitive_advantages,
            "calibration_note": self.calibration_note,
        }
        if self.proposed_hours is not None:
            payload["proposed_hours"] = self.proposed_hours
        if self.proposed_rate is not None:
            payload["proposed_rate"] = self.proposed_rate
        if self.proposed_total is not None:
            payload["proposed_total"] = self.proposed_total
        if self.savings_vs_market_percent is not None:
            payload["savings_vs_market_percent"] = self.savings_vs_market_percent
        return payload


@dataclass(frozen=True)
class ThreeWayProposal:
    """Three-way proposal object persisted on estimates."""

    our_track_record: OurTrackRecord
    market_benchmark: MarketBenchmark
    our_proposal: OurProposal

    def to_dict(self) -> dict[str, object]:
        return {
            "our_track_record": self.our_track_record.to_dict(),
            "market_benchmark": self.market_benchmark.to_dict(),
            "our_proposal": self.our_proposal.to_dict(),
        }
