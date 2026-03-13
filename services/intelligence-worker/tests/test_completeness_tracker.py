"""Tests for completeness tracking helpers."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from intelligence_worker.completeness_tracker import (
    COMPLETENESS_THRESHOLD,
    CompletenessTrackingRepository,
    build_checklist_status,
    build_prompt_feedback,
    build_tracking_snapshot,
    calculate_completeness,
    infer_collected_items_from_pairs,
    infer_collected_items_from_texts,
)
from intelligence_worker.qa_extraction import QAPair


def test_calculate_completeness_estimation_incomplete() -> None:
    result = calculate_completeness("estimation", {"tech_stack", "scope"})

    assert result.completeness == 0.4
    assert result.is_complete is False
    assert result.missing_items == ("timeline", "budget", "team")
    assert (
        build_prompt_feedback(result.missing_items)
        == "未収集項目: [timeline, budget, team]"
    )


def test_calculate_completeness_estimation_complete_threshold() -> None:
    result = calculate_completeness(
        "estimation",
        {"tech_stack", "scope", "timeline", "budget", "team"},
    )

    assert result.completeness == 1.0
    assert result.is_complete is True
    assert result.completeness >= COMPLETENESS_THRESHOLD
    assert build_prompt_feedback(result.missing_items) == "未収集項目: []"


def test_calculate_completeness_unsupported_domain() -> None:
    with pytest.raises(ValueError, match="unsupported domain"):
        calculate_completeness("unknown", set())


def test_build_checklist_status_marks_partial_items() -> None:
    checklist = build_checklist_status(
        "estimation",
        {"tech_stack", "scope"},
        partial_items={"timeline"},
    )

    assert checklist["tech_stack"].status == "collected"
    assert checklist["timeline"].status == "partial"
    assert checklist["timeline"].confidence == 0.5
    assert checklist["budget"].status == "missing"


def test_infer_collected_items_from_pairs_estimation() -> None:
    pairs = [
        QAPair(
            question_text="使用する技術スタックは？",
            answer_text="React と TypeScript です",
            turn_range=[1, 2],
            confidence=0.9,
            source_domain="estimation",
        ),
        QAPair(
            question_text="予算感は？",
            answer_text="予算は 300 万円です",
            turn_range=[3, 4],
            confidence=0.9,
            source_domain="estimation",
        ),
        QAPair(
            question_text="チーム体制は？",
            answer_text="社内 2 人と外部 1 人です",
            turn_range=[5, 6],
            confidence=0.9,
            source_domain="estimation",
        ),
    ]

    assert infer_collected_items_from_pairs("estimation", pairs) == {
        "budget",
        "team",
        "tech_stack",
    }


def test_infer_collected_items_from_texts_estimation() -> None:
    collected = infer_collected_items_from_texts(
        "estimation",
        [
            "React と TypeScript を使います",
            "予算は 300 万円、納期は 6 月末です",
            "チームは 3 名です",
        ],
    )

    assert collected == {"budget", "team", "tech_stack", "timeline"}


def test_build_tracking_snapshot_sets_missing_topics() -> None:
    snapshot = build_tracking_snapshot(
        domain="estimation",
        collected_items={"tech_stack", "scope", "budget"},
        turn_count=6,
        partial_items={"timeline"},
    )

    assert snapshot.turn_count == 6
    assert snapshot.overall_completeness == 0.6
    assert snapshot.checklist["timeline"].status == "partial"
    assert snapshot.suggested_next_topics == ("timeline", "team")


def test_repository_save_snapshot_upserts_feedback_loop_state() -> None:
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = [
        ("tenant_id",),
        ("session_id",),
        ("source_domain",),
        ("checklist",),
        ("overall_completeness",),
        ("suggested_next_topics",),
        ("turn_count",),
    ]
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    mock_conn_manager = MagicMock()
    mock_conn_manager.get_connection.return_value.__enter__ = MagicMock(
        return_value=mock_conn
    )
    mock_conn_manager.get_connection.return_value.__exit__ = MagicMock(
        return_value=False
    )

    repo = CompletenessTrackingRepository(mock_conn_manager)
    snapshot = build_tracking_snapshot(
        domain="estimation",
        collected_items={"tech_stack", "scope"},
        turn_count=4,
    )

    repo.save_snapshot(tenant_id="t1", session_id="s1", snapshot=snapshot)

    execute_args = mock_cursor.execute.call_args.args[1]
    assert execute_args[0] == "t1"
    assert execute_args[1] == "s1"
    assert execute_args[2] == "estimation"
    assert execute_args[4] == 0.4
    assert execute_args[5] == ["timeline", "budget", "team"]
