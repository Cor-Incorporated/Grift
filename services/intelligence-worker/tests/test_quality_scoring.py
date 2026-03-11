"""Tests for quality scoring module."""

from __future__ import annotations

from intelligence_worker.quality_scoring import (
    COMPLETENESS_DONE_THRESHOLD,
    CONFIDENCE_REASK_THRESHOLD,
    build_cloudsql_row,
    score_from_llm_output,
)


def test_score_from_llm_output_flags() -> None:
    score = score_from_llm_output(
        {
            "confidence": 0.42,
            "completeness": 0.81,
            "coherence": 0.77,
            "rationale": "budget answer is ambiguous",
        }
    )

    assert score.confidence == 0.42
    assert score.completeness == 0.81
    assert score.coherence == 0.77
    assert score.rationale == "budget answer is ambiguous"
    assert score.should_reask is True
    assert score.is_complete is True
    assert score.confidence < CONFIDENCE_REASK_THRESHOLD
    assert score.completeness >= COMPLETENESS_DONE_THRESHOLD


def test_score_from_llm_output_clamps_out_of_range() -> None:
    score = score_from_llm_output(
        {
            "confidence": -1,
            "completeness": 2,
            "coherence": 5,
        }
    )
    assert score.confidence == 0.0
    assert score.completeness == 1.0
    assert score.coherence == 1.0


def test_build_cloudsql_row_contains_scores_and_flags() -> None:
    score = score_from_llm_output(
        {
            "confidence": 0.49,
            "completeness": 0.45,
            "coherence": 0.90,
            "rationale": "insufficient budget details",
        }
    )

    row = build_cloudsql_row(
        tenant_id="t1",
        case_id="c1",
        session_id="s1",
        question_text="予算はいくらですか？",
        answer_text="まだ決まっていないです",
        score=score,
    )

    assert row["confidence"] == 0.49
    assert row["completeness"] == 0.45
    assert row["coherence"] == 0.9
    assert row["quality_rationale"] == "insufficient budget details"
    assert row["needs_followup"] is True
    assert row["is_complete"] is False
    assert "scored_at" in row
