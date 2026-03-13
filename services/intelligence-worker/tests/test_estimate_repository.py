from __future__ import annotations

from unittest.mock import MagicMock

from intelligence_worker.estimates.models import (
    EstimateQuery,
    MarketBenchmark,
    OurProposal,
    OurTrackRecord,
    Range,
    ThreeWayProposal,
)
from intelligence_worker.estimates.repository import (
    EstimateRepository,
    serialize_proposal,
)


def test_estimate_repository_loads_context_with_market_evidence() -> None:
    mock_cursor = MagicMock()
    mock_cursor.fetchone.side_effect = [
        (
            "estimate-1",
            "tenant-1",
            "case-1",
            "Build analytics dashboard",
            "new_project",
            "SaaS",
            "Billing summary dashboard",
            "Implementation 120h / test 30h",
            12000,
            180,
            2160000,
            15000,
            210,
            3150000,
            1.1,
            "agg-1",
        ),
        (80.5,),
        (
            ["fragment-1", "fragment-2"],
            200,
            240,
            14000,
            16000,
            "medium",
        ),
    ]
    mock_cursor.fetchall.side_effect = [
        [
            (
                "Analytics dashboard revamp",
                "new_project",
                "SaaS",
                "Billing and analytics portal",
                190,
            )
        ],
        [
            (
                [
                    {
                        "url": "https://example.com",
                        "title": "Benchmark",
                        "source_authority": "industry",
                        "snippet": "evidence",
                    }
                ],
            )
        ],
    ]

    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    mock_conn.cursor.return_value.__exit__.return_value = False

    mock_manager = MagicMock()
    mock_manager.get_connection.return_value.__enter__.return_value = mock_conn
    mock_manager.get_connection.return_value.__exit__.return_value = False

    repository = EstimateRepository(mock_manager)
    context = repository.load_context(
        EstimateQuery(tenant_id="tenant-1", estimate_id="estimate-1")
    )

    assert context.estimate.case_title == "Build analytics dashboard"
    assert context.velocity_score == 80.5
    assert len(context.historical_projects) == 1
    assert context.market_evidence is not None
    assert context.market_evidence.provider_count == 2
    assert context.market_evidence.consensus_hours == Range(min=200.0, max=240.0)
    assert context.market_evidence.citations[0].title == "Benchmark"


def test_estimate_repository_saves_three_way_proposal_and_ready_status() -> None:
    mock_cursor = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    mock_conn.cursor.return_value.__exit__.return_value = False
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.__exit__.return_value = False

    mock_manager = MagicMock()
    mock_manager.get_connection.return_value.__enter__.return_value = mock_conn
    mock_manager.get_connection.return_value.__exit__.return_value = False

    repository = EstimateRepository(mock_manager)
    proposal = ThreeWayProposal(
        our_track_record=OurTrackRecord(median_hours=180.0),
        market_benchmark=MarketBenchmark(consensus_hours=Range(min=200.0, max=240.0)),
        our_proposal=OurProposal(
            proposed_hours=180.0,
            proposed_rate=12000.0,
            proposed_total=2160000.0,
            savings_vs_market_percent=31.4,
            competitive_advantages=["実績ベース"],
            calibration_note="実績ベースで調整しました。",
        ),
    )

    repository.save(
        query=EstimateQuery(tenant_id="tenant-1", estimate_id="estimate-1"),
        proposal=proposal,
    )

    sql = mock_cursor.execute.call_args.args[0]
    params = mock_cursor.execute.call_args.args[1]
    assert "status = 'ready'" in sql
    assert params[1:] == ("estimate-1", "tenant-1")
    assert '"proposed_total": 2160000.0' in serialize_proposal(proposal)
