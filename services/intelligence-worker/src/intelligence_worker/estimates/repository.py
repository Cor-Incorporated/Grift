"""Database access for estimate proposal generation."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, cast

from psycopg2.extras import Json  # type: ignore[import-untyped]

from intelligence_worker.estimates.models import (
    Citation,
    ConfidenceLevel,
    Range,
    SourceAuthority,
)

if TYPE_CHECKING:
    from intelligence_worker.db import RLSConnectionManager
    from intelligence_worker.estimates.models import EstimateQuery, ThreeWayProposal


@dataclass(frozen=True)
class EstimateSnapshot:
    """Current estimate and case context."""

    estimate_id: str
    tenant_id: str
    case_id: str
    case_title: str
    case_type: str
    business_line: str | None
    spec_markdown: str | None
    hours_breakdown_report: str | None
    your_hourly_rate: float | None
    your_estimated_hours: float | None
    total_your_cost: float | None
    market_hourly_rate: float | None
    market_estimated_hours: float | None
    total_market_cost: float | None
    calibration_ratio: float | None
    aggregated_evidence_id: str | None

    @property
    def context_text(self) -> str:
        return "\n".join(
            part
            for part in (
                self.case_title,
                self.business_line,
                self.spec_markdown,
                self.hours_breakdown_report,
            )
            if part
        )


@dataclass(frozen=True)
class HistoricalProject:
    """Historical project outcome used for similarity matching."""

    name: str
    case_type: str
    business_line: str | None
    spec_markdown: str | None
    actual_hours: float

    @property
    def context_text(self) -> str:
        return "\n".join(
            part for part in (self.name, self.business_line, self.spec_markdown) if part
        )


@dataclass(frozen=True)
class MarketEvidenceSnapshot:
    """Aggregated market benchmark context."""

    consensus_hours: Range = field(default_factory=Range)
    consensus_rate: Range = field(default_factory=Range)
    confidence: ConfidenceLevel = "low"
    provider_count: int = 0
    citations: list[Citation] = field(default_factory=list)


@dataclass(frozen=True)
class EstimateGenerationContext:
    """All data required to produce a ThreeWayProposal."""

    estimate: EstimateSnapshot
    historical_projects: list[HistoricalProject]
    market_evidence: MarketEvidenceSnapshot | None
    velocity_score: float | None


class EstimateRepository:
    """Load estimate inputs and persist generated proposal JSON."""

    def __init__(self, conn_manager: RLSConnectionManager) -> None:
        self._conn_manager = conn_manager

    def load_context(self, query: EstimateQuery) -> EstimateGenerationContext:
        with (
            self._conn_manager.get_connection(query.tenant_id) as conn,
            conn.cursor() as cur,
        ):
            cur.execute(
                """
                SELECT
                    e.id,
                    e.tenant_id,
                    e.case_id,
                    c.title,
                    c.type,
                    c.business_line,
                    c.spec_markdown,
                    e.hours_breakdown_report,
                    e.your_hourly_rate,
                    e.your_estimated_hours,
                    e.total_your_cost,
                    e.market_hourly_rate,
                    e.market_estimated_hours,
                    e.total_market_cost,
                    e.calibration_ratio,
                    e.aggregated_evidence_id
                FROM estimates AS e
                JOIN cases AS c
                  ON c.id = e.case_id
                 AND c.tenant_id = e.tenant_id
                WHERE e.tenant_id = %s
                  AND e.id = %s
                """,
                (query.tenant_id, query.estimate_id),
            )
            estimate_row = cur.fetchone()
            if estimate_row is None:
                raise LookupError(
                    "estimate "
                    f"{query.estimate_id} not found for tenant {query.tenant_id}"
                )

            estimate = EstimateSnapshot(
                estimate_id=str(estimate_row[0]),
                tenant_id=str(estimate_row[1]),
                case_id=str(estimate_row[2]),
                case_title=str(estimate_row[3]),
                case_type=str(estimate_row[4]),
                business_line=_as_optional_str(estimate_row[5]),
                spec_markdown=_as_optional_str(estimate_row[6]),
                hours_breakdown_report=_as_optional_str(estimate_row[7]),
                your_hourly_rate=_to_float(estimate_row[8]),
                your_estimated_hours=_to_float(estimate_row[9]),
                total_your_cost=_to_float(estimate_row[10]),
                market_hourly_rate=_to_float(estimate_row[11]),
                market_estimated_hours=_to_float(estimate_row[12]),
                total_market_cost=_to_float(estimate_row[13]),
                calibration_ratio=_to_float(estimate_row[14]),
                aggregated_evidence_id=_as_optional_str(estimate_row[15]),
            )

            cur.execute(
                """
                SELECT
                    c.title,
                    c.type,
                    c.business_line,
                    c.spec_markdown,
                    po.actual_hours
                FROM project_outcomes AS po
                JOIN cases AS c
                  ON c.id = po.case_id
                 AND c.tenant_id = po.tenant_id
                WHERE po.tenant_id = %s
                  AND po.case_id <> %s
                ORDER BY po.completed_at DESC NULLS LAST, po.created_at DESC
                LIMIT 20
                """,
                (query.tenant_id, estimate.case_id),
            )
            historical_rows = cur.fetchall()

            cur.execute(
                """
                SELECT AVG(recent.velocity_score)
                FROM (
                    SELECT velocity_score
                    FROM velocity_metrics
                    WHERE tenant_id = %s
                      AND velocity_score IS NOT NULL
                    ORDER BY analyzed_at DESC
                    LIMIT 20
                ) AS recent
                """,
                (query.tenant_id,),
            )
            velocity_row = cur.fetchone()
            velocity_score = _to_float(velocity_row[0] if velocity_row else None)

            market_evidence = None
            if estimate.aggregated_evidence_id:
                market_evidence = self._load_market_evidence(
                    cur,
                    tenant_id=query.tenant_id,
                    evidence_id=estimate.aggregated_evidence_id,
                )

        return EstimateGenerationContext(
            estimate=estimate,
            historical_projects=[
                HistoricalProject(
                    name=str(row[0]),
                    case_type=str(row[1]),
                    business_line=_as_optional_str(row[2]),
                    spec_markdown=_as_optional_str(row[3]),
                    actual_hours=_to_float(row[4]) or 0.0,
                )
                for row in historical_rows
            ],
            market_evidence=market_evidence,
            velocity_score=velocity_score,
        )

    def save(self, *, query: EstimateQuery, proposal: ThreeWayProposal) -> None:
        with (
            self._conn_manager.get_connection(query.tenant_id) as conn,
            conn,
            conn.cursor() as cur,
        ):
            cur.execute(
                """
                UPDATE estimates
                SET three_way_proposal = %s,
                    status = 'ready'
                WHERE id = %s
                  AND tenant_id = %s
                """,
                (
                    Json(proposal.to_dict()),
                    query.estimate_id,
                    query.tenant_id,
                ),
            )
            if cur.rowcount == 0:
                raise LookupError(
                    f"UPDATE matched no rows for estimate {query.estimate_id} "
                    f"tenant {query.tenant_id}"
                )

    def _load_market_evidence(
        self,
        cur: Any,
        *,
        tenant_id: str,
        evidence_id: str,
    ) -> MarketEvidenceSnapshot | None:
        cur.execute(
            """
            SELECT
                fragment_ids,
                consensus_hours_min,
                consensus_hours_max,
                consensus_rate_min,
                consensus_rate_max,
                overall_confidence
            FROM aggregated_evidences
            WHERE tenant_id = %s
              AND id = %s
            """,
            (tenant_id, evidence_id),
        )
        row = cur.fetchone()
        if row is None:
            return None

        fragment_ids = list(row[0] or [])
        citations: list[Citation] = []
        if fragment_ids:
            cur.execute(
                """
                SELECT citations
                FROM evidence_fragments
                WHERE tenant_id = %s
                  AND id = ANY(%s::uuid[])
                """,
                (tenant_id, fragment_ids),
            )
            for fragment_row in cur.fetchall():
                citations.extend(_parse_citations(fragment_row[0]))

        return MarketEvidenceSnapshot(
            consensus_hours=Range(
                min=_to_float(row[1]),
                max=_to_float(row[2]),
            ),
            consensus_rate=Range(
                min=_to_float(row[3]),
                max=_to_float(row[4]),
            ),
            confidence=_coerce_confidence(row[5]),
            provider_count=len(fragment_ids),
            citations=citations[:8],
        )


def serialize_proposal(proposal: ThreeWayProposal) -> str:
    """Utility for tests."""

    return json.dumps(proposal.to_dict(), ensure_ascii=False)


def _parse_citations(value: object) -> list[Citation]:
    if not isinstance(value, list):
        return []
    citations: list[Citation] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        title = item.get("title")
        if not isinstance(url, str) or not isinstance(title, str):
            continue
        citations.append(
            Citation(
                url=url,
                title=title,
                source_authority=_coerce_source_authority(item.get("source_authority")),
                snippet=str(item.get("snippet") or ""),
            )
        )
    return citations


def _coerce_confidence(value: object) -> ConfidenceLevel:
    if value in {"high", "medium", "low"}:
        return cast("ConfidenceLevel", value)
    return "low"


def _coerce_source_authority(value: object) -> SourceAuthority:
    if value in {"official", "industry", "community", "unknown"}:
        return cast("SourceAuthority", value)
    return "unknown"


def _to_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value))
    except ValueError:
        return None


def _as_optional_str(value: object) -> str | None:
    if isinstance(value, str) and value:
        return value
    return None
