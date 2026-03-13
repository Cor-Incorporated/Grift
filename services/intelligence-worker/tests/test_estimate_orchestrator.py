from __future__ import annotations

import urllib.error
from dataclasses import dataclass, field

from intelligence_worker.estimates.models import (
    Citation,
    EstimateQuery,
    OurProposal,
    Range,
)
from intelligence_worker.estimates.orchestrator import EstimateOrchestrator
from intelligence_worker.estimates.repository import (
    EstimateGenerationContext,
    EstimateSnapshot,
    HistoricalProject,
    MarketEvidenceSnapshot,
)


def _query() -> EstimateQuery:
    return EstimateQuery(
        tenant_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        estimate_id="11111111-1111-1111-1111-111111111111",
        case_id="22222222-2222-2222-2222-222222222222",
    )


def _context() -> EstimateGenerationContext:
    return EstimateGenerationContext(
        estimate=EstimateSnapshot(
            estimate_id="11111111-1111-1111-1111-111111111111",
            tenant_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            case_id="22222222-2222-2222-2222-222222222222",
            case_title="Build analytics dashboard",
            case_type="new_project",
            business_line="SaaS",
            spec_markdown="Admin analytics dashboard with billing summary",
            hours_breakdown_report="Implementation, testing, launch support",
            your_hourly_rate=12000.0,
            your_estimated_hours=180.0,
            total_your_cost=2160000.0,
            market_hourly_rate=15000.0,
            market_estimated_hours=210.0,
            total_market_cost=3150000.0,
            calibration_ratio=1.1,
            aggregated_evidence_id="33333333-3333-3333-3333-333333333333",
        ),
        historical_projects=[
            HistoricalProject(
                name="Analytics dashboard revamp",
                case_type="new_project",
                business_line="SaaS",
                spec_markdown="Billing and analytics portal",
                actual_hours=190.0,
            ),
            HistoricalProject(
                name="Legacy ERP migration",
                case_type="feature_addition",
                business_line="Manufacturing",
                spec_markdown="ERP module migration",
                actual_hours=420.0,
            ),
            HistoricalProject(
                name="Admin metrics board",
                case_type="new_project",
                business_line="SaaS",
                spec_markdown="Internal KPI dashboard",
                actual_hours=170.0,
            ),
        ],
        market_evidence=MarketEvidenceSnapshot(
            consensus_hours=Range(min=200.0, max=240.0),
            consensus_rate=Range(min=14000.0, max=16000.0),
            confidence="medium",
            provider_count=3,
            citations=[
                Citation(
                    url="https://example.com/rate",
                    title="Rate benchmark",
                    source_authority="industry",
                    snippet="14000-16000 JPY / hour",
                )
            ],
        ),
        velocity_score=82.0,
    )


@dataclass
class _FakeRepository:
    context: EstimateGenerationContext
    saved: list[tuple[EstimateQuery, object]] = field(default_factory=list)

    def load_context(self, query: EstimateQuery) -> EstimateGenerationContext:
        assert query.estimate_id == self.context.estimate.estimate_id
        return self.context

    def save(self, *, query: EstimateQuery, proposal: object) -> None:
        self.saved.append((query, proposal))


@dataclass
class _FakeGateway:
    response: OurProposal | Exception

    def generate_proposal(self, **_: object) -> OurProposal:
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def test_generate_builds_three_way_proposal_and_persists() -> None:
    repository = _FakeRepository(context=_context())
    orchestrator = EstimateOrchestrator(
        repository=repository,
        gateway_client=_FakeGateway(
            OurProposal(
                proposed_hours=175.0,
                proposed_rate=12000.0,
                proposed_total=2100000.0,
                savings_vs_market_percent=33.3,
                competitive_advantages=[
                    "類似案件の実績に基づく提案です",
                    "市場価格帯より競争力を保っています",
                ],
                calibration_note="過去実績と市場相場の両方を踏まえて調整しました。",
            )
        ),
    )

    proposal = orchestrator.generate(_query())

    assert len(repository.saved) == 1
    assert (
        proposal.our_track_record.similar_projects[0].name
        == "Analytics dashboard revamp"
    )
    assert proposal.our_track_record.median_hours == 180.0
    assert proposal.market_benchmark.provider_count == 3
    assert proposal.our_proposal.proposed_total == 2100000.0
    assert (
        proposal.our_proposal.competitive_advantages[0]
        == "類似案件の実績に基づく提案です"
    )


def test_generate_falls_back_to_baseline_when_gateway_fails() -> None:
    repository = _FakeRepository(context=_context())
    orchestrator = EstimateOrchestrator(
        repository=repository,
        gateway_client=_FakeGateway(urllib.error.URLError("boom")),
    )

    proposal = orchestrator.generate(_query())

    assert len(repository.saved) == 1
    assert proposal.our_proposal.proposed_hours == 180.0
    assert proposal.our_proposal.proposed_rate == 12000.0
    assert proposal.our_proposal.proposed_total == 2160000.0
    assert proposal.our_proposal.savings_vs_market_percent == 31.4
    assert "市場ソース" in proposal.our_proposal.competitive_advantages[1]


def test_generate_uses_calibrated_history_when_current_hours_missing() -> None:
    context = _context()
    estimate = context.estimate
    repository = _FakeRepository(
        context=EstimateGenerationContext(
            estimate=EstimateSnapshot(
                estimate_id=estimate.estimate_id,
                tenant_id=estimate.tenant_id,
                case_id=estimate.case_id,
                case_title=estimate.case_title,
                case_type=estimate.case_type,
                business_line=estimate.business_line,
                spec_markdown=estimate.spec_markdown,
                hours_breakdown_report=estimate.hours_breakdown_report,
                your_hourly_rate=estimate.your_hourly_rate,
                your_estimated_hours=None,
                total_your_cost=None,
                market_hourly_rate=estimate.market_hourly_rate,
                market_estimated_hours=estimate.market_estimated_hours,
                total_market_cost=estimate.total_market_cost,
                calibration_ratio=1.1,
                aggregated_evidence_id=estimate.aggregated_evidence_id,
            ),
            historical_projects=context.historical_projects,
            market_evidence=context.market_evidence,
            velocity_score=context.velocity_score,
        )
    )
    orchestrator = EstimateOrchestrator(repository=repository)

    proposal = orchestrator.generate(_query())

    assert proposal.our_track_record.median_hours == 180.0
    assert proposal.our_proposal.proposed_hours == 198.0
    assert "補正係数 1.10" in proposal.our_proposal.calibration_note
