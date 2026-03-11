"""Tests for completeness tracking helpers."""

from __future__ import annotations

import pytest

from intelligence_worker.completeness_tracker import (
    COMPLETENESS_THRESHOLD,
    build_prompt_feedback,
    calculate_completeness,
)


def test_calculate_completeness_estimation_incomplete() -> None:
    result = calculate_completeness("estimation", {"tech_stack", "scope"})

    assert result.completeness == 0.5
    assert result.is_complete is False
    assert result.missing_items == ("budget_range", "deadline")
    assert (
        build_prompt_feedback(result.missing_items)
        == "未収集項目: [budget_range, deadline]"
    )


def test_calculate_completeness_estimation_complete_threshold() -> None:
    result = calculate_completeness(
        "estimation",
        {"tech_stack", "budget_range", "deadline", "scope"},
    )

    assert result.completeness == 1.0
    assert result.is_complete is True
    assert result.completeness >= COMPLETENESS_THRESHOLD
    assert build_prompt_feedback(result.missing_items) == "未収集項目: []"


def test_calculate_completeness_unsupported_domain() -> None:
    with pytest.raises(ValueError, match="unsupported domain"):
        calculate_completeness("unknown", set())
