"""Quality scoring utilities for Observation Pipeline QA pairs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

CONFIDENCE_REASK_THRESHOLD = 0.5
COMPLETENESS_DONE_THRESHOLD = 0.8


@dataclass(frozen=True)
class QualityScore:
    """Three-axis quality score for a QA pair."""

    confidence: float
    completeness: float
    coherence: float
    rationale: str
    should_reask: bool
    is_complete: bool


def score_from_llm_output(structured_output: dict[str, Any]) -> QualityScore:
    """Build quality scores from LLM structured output.

    Expected shape:
    {
      "confidence": 0.0-1.0,
      "completeness": 0.0-1.0,
      "coherence": 0.0-1.0,
      "rationale": "..."
    }
    """
    confidence = _clamp01(float(structured_output.get("confidence", 0)))
    completeness = _clamp01(float(structured_output.get("completeness", 0)))
    coherence = _clamp01(float(structured_output.get("coherence", 0)))
    rationale = str(structured_output.get("rationale", "")).strip()

    should_reask = confidence < CONFIDENCE_REASK_THRESHOLD
    is_complete = completeness >= COMPLETENESS_DONE_THRESHOLD

    return QualityScore(
        confidence=confidence,
        completeness=completeness,
        coherence=coherence,
        rationale=rationale,
        should_reask=should_reask,
        is_complete=is_complete,
    )


def build_cloudsql_row(
    *,
    tenant_id: str,
    case_id: str,
    session_id: str,
    question_text: str,
    answer_text: str,
    score: QualityScore,
) -> dict[str, Any]:
    """Build an insert-ready row payload for Cloud SQL persistence."""
    return {
        "tenant_id": tenant_id,
        "case_id": case_id,
        "session_id": session_id,
        "question_text": question_text,
        "answer_text": answer_text,
        "confidence": score.confidence,
        "completeness": score.completeness,
        "coherence": score.coherence,
        "quality_rationale": score.rationale,
        "needs_followup": score.should_reask,
        "is_complete": score.is_complete,
        "scored_at": datetime.now(UTC).isoformat(),
    }


def _clamp01(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value
