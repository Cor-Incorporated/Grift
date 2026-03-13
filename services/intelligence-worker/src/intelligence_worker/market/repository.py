"""Database persistence for market evidence."""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import TYPE_CHECKING, Any

from psycopg2.extras import Json  # type: ignore[import-untyped]

if TYPE_CHECKING:
    from intelligence_worker.db import RLSConnectionManager
    from intelligence_worker.market.models import (
        AggregatedEvidence,
        EvidenceFragment,
        MarketQuery,
    )


class MarketEvidenceRepository:
    """Persist market evidence fragments and aggregate rows."""

    def __init__(self, conn_manager: RLSConnectionManager) -> None:
        self._conn_manager = conn_manager

    def save(self, *, query: MarketQuery, aggregate: AggregatedEvidence) -> None:
        with (
            self._conn_manager.get_connection(query.tenant_id) as conn,
            conn,
            conn.cursor() as cur,
        ):
            cur.execute(
                """
                SELECT fragment_ids
                FROM aggregated_evidences
                WHERE tenant_id = %s AND id = %s
                """,
                (query.tenant_id, query.evidence_id),
            )
            row = cur.fetchone()
            if row is not None and row[0]:
                cur.execute(
                    """
                    DELETE FROM evidence_fragments
                    WHERE tenant_id = %s AND id = ANY(%s::uuid[])
                    """,
                    (query.tenant_id, list(row[0])),
                )

            fragment_ids: list[str] = []
            for fragment in aggregate.fragments:
                cur.execute(
                    """
                    INSERT INTO evidence_fragments (
                        tenant_id,
                        case_id,
                        provider,
                        case_type,
                        query,
                        hourly_rate_min,
                        hourly_rate_max,
                        total_hours_min,
                        total_hours_max,
                        team_size_min,
                        team_size_max,
                        duration_weeks_min,
                        duration_weeks_max,
                        citations,
                        provider_confidence,
                        raw_response,
                        retrieved_at
                    )
                    VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s
                    )
                    RETURNING id
                    """,
                    (
                        query.tenant_id,
                        query.case_id,
                        fragment.provider,
                        query.case_type,
                        query.context,
                        fragment.hourly_rate_range.min,
                        fragment.hourly_rate_range.max,
                        fragment.total_hours_range.min,
                        fragment.total_hours_range.max,
                        _as_int(fragment.team_size_range.min),
                        _as_int(fragment.team_size_range.max),
                        _as_int(fragment.duration_range.min),
                        _as_int(fragment.duration_range.max),
                        Json([citation.to_dict() for citation in fragment.citations]),
                        fragment.provider_confidence,
                        fragment.raw_response,
                        fragment.retrieved_at,
                    ),
                )
                fragment_ids.append(str(cur.fetchone()[0]))

            cur.execute(
                """
                INSERT INTO aggregated_evidences (
                    id,
                    tenant_id,
                    case_id,
                    fragment_ids,
                    consensus_hours_min,
                    consensus_hours_max,
                    consensus_rate_min,
                    consensus_rate_max,
                    overall_confidence,
                    contradictions,
                    requires_human_review,
                    aggregated_at
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                ON CONFLICT (id) DO UPDATE SET
                    fragment_ids = EXCLUDED.fragment_ids,
                    consensus_hours_min = EXCLUDED.consensus_hours_min,
                    consensus_hours_max = EXCLUDED.consensus_hours_max,
                    consensus_rate_min = EXCLUDED.consensus_rate_min,
                    consensus_rate_max = EXCLUDED.consensus_rate_max,
                    overall_confidence = EXCLUDED.overall_confidence,
                    contradictions = EXCLUDED.contradictions,
                    requires_human_review = EXCLUDED.requires_human_review,
                    aggregated_at = EXCLUDED.aggregated_at
                """,
                (
                    query.evidence_id,
                    query.tenant_id,
                    query.case_id,
                    fragment_ids,
                    aggregate.consensus_hours_range.min,
                    aggregate.consensus_hours_range.max,
                    aggregate.consensus_rate_range.min,
                    aggregate.consensus_rate_range.max,
                    aggregate.overall_confidence,
                    Json([item.to_dict() for item in aggregate.contradictions]),
                    aggregate.requires_human_review,
                    aggregate.aggregated_at,
                ),
            )


def serialize_aggregate(evidence: AggregatedEvidence) -> str:
    """Utility for tests."""

    return json.dumps(evidence.to_dict(), default=str, ensure_ascii=False)


def serialize_fragment(fragment: EvidenceFragment) -> dict[str, Any]:
    """Utility for tests."""

    return asdict(fragment)


def _as_int(value: float | None) -> int | None:
    if value is None:
        return None
    return int(value)
