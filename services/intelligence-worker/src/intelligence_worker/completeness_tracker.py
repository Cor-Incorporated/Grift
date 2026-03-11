"""Completeness tracker and system prompt feedback helpers."""

from __future__ import annotations

from dataclasses import dataclass

COMPLETENESS_THRESHOLD = 0.8

DOMAIN_CHECKLISTS: dict[str, tuple[str, ...]] = {
    "estimation": ("tech_stack", "budget_range", "deadline", "scope"),
    "research": ("theme", "hypothesis", "segment", "insight"),
}


@dataclass(frozen=True)
class CompletenessResult:
    """Completeness evaluation output."""

    domain: str
    collected_items: tuple[str, ...]
    missing_items: tuple[str, ...]
    completeness: float
    is_complete: bool


def calculate_completeness(
    domain: str, collected_items: set[str]
) -> CompletenessResult:
    """Calculate checklist coverage and completion signal for a domain."""
    checklist = DOMAIN_CHECKLISTS.get(domain)
    if checklist is None:
        raise ValueError(f"unsupported domain: {domain}")

    ordered_collected = tuple(item for item in checklist if item in collected_items)
    ordered_missing = tuple(item for item in checklist if item not in collected_items)
    completeness = len(ordered_collected) / len(checklist)
    is_complete = completeness >= COMPLETENESS_THRESHOLD

    return CompletenessResult(
        domain=domain,
        collected_items=ordered_collected,
        missing_items=ordered_missing,
        completeness=completeness,
        is_complete=is_complete,
    )


def build_prompt_feedback(missing_items: tuple[str, ...]) -> str:
    """Build system prompt feedback line in the required format."""
    if not missing_items:
        return "未収集項目: []"
    return f"未収集項目: [{', '.join(missing_items)}]"
