"""Estimate orchestration and proposal generation."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from difflib import SequenceMatcher
from statistics import median
from typing import TYPE_CHECKING, Protocol

import structlog

from intelligence_worker.estimates.models import (
    EstimateQuery,
    MarketBenchmark,
    OurProposal,
    OurTrackRecord,
    Range,
    SimilarProject,
    ThreeWayProposal,
)
from intelligence_worker.estimates.prompts import (
    THREE_WAY_PROPOSAL_SYSTEM_PROMPT,
    build_three_way_proposal_prompt,
)

if TYPE_CHECKING:
    from intelligence_worker.estimates.repository import (
        EstimateGenerationContext,
        EstimateSnapshot,
        HistoricalProject,
    )

logger = structlog.get_logger()

DEFAULT_DATA_CLASSIFICATION = "restricted"


class EstimateProposalRepository(Protocol):
    """Persistence contract used by the orchestrator."""

    def load_context(self, query: EstimateQuery) -> EstimateGenerationContext: ...

    def save(self, *, query: EstimateQuery, proposal: ThreeWayProposal) -> None: ...


class ThreeWayProposalGateway(Protocol):
    """LLM client contract for proposal generation."""

    def generate_proposal(
        self,
        *,
        context: EstimateGenerationContext,
        track_record: OurTrackRecord,
        market_benchmark: MarketBenchmark,
        baseline_proposal: OurProposal,
    ) -> OurProposal: ...


@dataclass(frozen=True)
class GatewayThreeWayProposalClient:
    """OpenAI-compatible llm-gateway client for proposal generation."""

    base_url: str
    model: str
    timeout_seconds: float = 30.0
    data_classification: str = DEFAULT_DATA_CLASSIFICATION

    def __post_init__(self) -> None:
        parsed = urllib.parse.urlparse(self.base_url)
        if parsed.scheme not in ("http", "https"):
            raise ValueError(
                f"base_url scheme must be http/https, got: {parsed.scheme!r}"
            )
        if not parsed.hostname:
            raise ValueError("base_url must include a hostname")

    def generate_proposal(
        self,
        *,
        context: EstimateGenerationContext,
        track_record: OurTrackRecord,
        market_benchmark: MarketBenchmark,
        baseline_proposal: OurProposal,
    ) -> OurProposal:
        payload = {
            "estimate": {
                "estimate_id": context.estimate.estimate_id,
                "case_id": context.estimate.case_id,
                "case_title": context.estimate.case_title,
                "case_type": context.estimate.case_type,
                "business_line": context.estimate.business_line,
                "spec_markdown": context.estimate.spec_markdown,
                "hours_breakdown_report": context.estimate.hours_breakdown_report,
                "your_hourly_rate": context.estimate.your_hourly_rate,
                "your_estimated_hours": context.estimate.your_estimated_hours,
                "total_your_cost": context.estimate.total_your_cost,
                "market_hourly_rate": context.estimate.market_hourly_rate,
                "market_estimated_hours": context.estimate.market_estimated_hours,
                "total_market_cost": context.estimate.total_market_cost,
                "calibration_ratio": context.estimate.calibration_ratio,
            },
            "our_track_record": track_record.to_dict(),
            "market_benchmark": market_benchmark.to_dict(),
            "baseline_proposal": baseline_proposal.to_dict(),
        }
        request_payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": THREE_WAY_PROPOSAL_SYSTEM_PROMPT,
                },
                {
                    "role": "user",
                    "content": build_three_way_proposal_prompt(payload=payload),
                },
            ],
            "temperature": 0.3,
            "max_tokens": 800,
            "stream": False,
        }
        request = urllib.request.Request(
            self._endpoint,
            data=json.dumps(request_payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-Data-Classification": self.data_classification,
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
            body = json.loads(response.read(1_048_576).decode("utf-8"))

        content = body.get("choices", [{}])[0].get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("llm-gateway response missing message content")
        return _parse_generated_proposal(content, default=baseline_proposal)

    @property
    def _endpoint(self) -> str:
        return self.base_url.rstrip("/") + "/v1/chat/completions"


@dataclass(slots=True)
class EstimateOrchestrator:
    """Generate ThreeWayProposal objects from tenant data and market evidence."""

    repository: EstimateProposalRepository
    gateway_client: ThreeWayProposalGateway | None = None

    def generate(self, query: EstimateQuery) -> ThreeWayProposal:
        context = self.repository.load_context(query)
        track_record = _build_track_record(context)
        market_benchmark = _build_market_benchmark(context)
        baseline_proposal = _build_baseline_proposal(
            context.estimate,
            track_record,
            market_benchmark,
        )

        generated_proposal = baseline_proposal
        if self.gateway_client is not None:
            try:
                generated_proposal = self.gateway_client.generate_proposal(
                    context=context,
                    track_record=track_record,
                    market_benchmark=market_benchmark,
                    baseline_proposal=baseline_proposal,
                )
            except (
                TimeoutError,
                urllib.error.URLError,
                json.JSONDecodeError,
                ValueError,
            ) as exc:
                logger.warning(
                    "estimate_proposal_gateway_failed",
                    estimate_id=query.estimate_id,
                    tenant_id=query.tenant_id,
                    error=str(exc),
                )

        proposal = ThreeWayProposal(
            our_track_record=track_record,
            market_benchmark=market_benchmark,
            our_proposal=generated_proposal,
        )
        self.repository.save(query=query, proposal=proposal)
        return proposal


def _build_track_record(context: EstimateGenerationContext) -> OurTrackRecord:
    ranked_projects = [
        SimilarProject(
            name=project.name,
            actual_hours=project.actual_hours,
            similarity_score=_similarity_score(context.estimate, project),
        )
        for project in context.historical_projects
    ]
    ranked_projects.sort(key=lambda item: item.similarity_score, reverse=True)
    similar_projects = [
        item for item in ranked_projects[:3] if item.similarity_score >= 0.2
    ]
    if not similar_projects and ranked_projects:
        similar_projects = ranked_projects[:1]

    median_hours = None
    if similar_projects:
        median_hours = float(median(item.actual_hours for item in similar_projects))

    return OurTrackRecord(
        similar_projects=similar_projects,
        median_hours=median_hours,
        velocity_score=context.velocity_score,
    )


def _build_market_benchmark(context: EstimateGenerationContext) -> MarketBenchmark:
    if context.market_evidence is None:
        return MarketBenchmark()
    return MarketBenchmark(
        consensus_hours=context.market_evidence.consensus_hours,
        consensus_rate=context.market_evidence.consensus_rate,
        confidence=context.market_evidence.confidence,
        provider_count=context.market_evidence.provider_count,
        citations=context.market_evidence.citations,
    )


def _build_baseline_proposal(
    estimate: EstimateSnapshot,
    track_record: OurTrackRecord,
    market_benchmark: MarketBenchmark,
) -> OurProposal:
    proposed_hours = _round1(
        _first_number(
            estimate.your_estimated_hours,
            _apply_calibration(track_record.median_hours, estimate.calibration_ratio),
            _range_midpoint(market_benchmark.consensus_hours),
        )
    )
    proposed_rate = _round1(
        _first_number(
            estimate.your_hourly_rate,
            estimate.market_hourly_rate,
            _range_midpoint(market_benchmark.consensus_rate),
        )
    )

    proposed_total = None
    if proposed_hours is not None and proposed_rate is not None:
        proposed_total = _round1(proposed_hours * proposed_rate)

    market_total = _round1(
        _first_number(
            estimate.total_market_cost,
            _market_total_from_ranges(
                market_benchmark=market_benchmark,
                hours=estimate.market_estimated_hours,
                rate=estimate.market_hourly_rate,
            ),
        )
    )
    savings = _savings_percent(market_total=market_total, proposed_total=proposed_total)

    return OurProposal(
        proposed_hours=proposed_hours,
        proposed_rate=proposed_rate,
        proposed_total=proposed_total,
        savings_vs_market_percent=savings,
        competitive_advantages=_default_advantages(
            track_record=track_record,
            market_benchmark=market_benchmark,
        ),
        calibration_note=_build_calibration_note(
            estimate=estimate,
            track_record=track_record,
            market_benchmark=market_benchmark,
        ),
    )


def _similarity_score(estimate: EstimateSnapshot, project: HistoricalProject) -> float:
    estimate_text = _normalize_text(estimate.context_text)
    project_text = _normalize_text(project.context_text)
    text_ratio = 0.0
    if estimate_text and project_text:
        text_ratio = SequenceMatcher(a=estimate_text, b=project_text).ratio()

    case_type_bonus = 0.25 if estimate.case_type == project.case_type else 0.0
    business_line_bonus = (
        0.15
        if estimate.business_line
        and project.business_line
        and _normalize_text(estimate.business_line)
        == _normalize_text(project.business_line)
        else 0.0
    )
    return min(
        1.0,
        round((text_ratio * 0.6) + case_type_bonus + business_line_bonus, 3),
    )


def _normalize_text(value: str) -> str:
    compact = re.sub(r"\s+", " ", value).strip().lower()
    return re.sub(r"[^0-9a-zA-Zぁ-んァ-ヶ一-龠ー ]+", " ", compact)


def _apply_calibration(hours: float | None, ratio: float | None) -> float | None:
    if hours is None:
        return None
    if ratio is None:
        return hours
    return hours * ratio


def _range_midpoint(value: Range) -> float | None:
    if value.min is None or value.max is None:
        return None
    return (float(value.min) + float(value.max)) / 2.0


def _market_total_from_ranges(
    *,
    market_benchmark: MarketBenchmark,
    hours: float | None,
    rate: float | None,
) -> float | None:
    benchmark_hours = _first_number(
        hours,
        _range_midpoint(market_benchmark.consensus_hours),
    )
    benchmark_rate = _first_number(
        rate,
        _range_midpoint(market_benchmark.consensus_rate),
    )
    if benchmark_hours is None or benchmark_rate is None:
        return None
    return benchmark_hours * benchmark_rate


def _default_advantages(
    *,
    track_record: OurTrackRecord,
    market_benchmark: MarketBenchmark,
) -> list[str]:
    advantages = ["類似案件の実績工数を基準に提案しています"]
    if market_benchmark.provider_count >= 2:
        advantages.append("複数の市場ソースで検証した相場帯を踏まえています")
    if track_record.velocity_score is not None and track_record.velocity_score >= 70:
        advantages.append("直近の開発速度が高く、短納期でも進行計画を立てやすいです")
    return advantages[:4]


def _build_calibration_note(
    *,
    estimate: EstimateSnapshot,
    track_record: OurTrackRecord,
    market_benchmark: MarketBenchmark,
) -> str:
    if estimate.calibration_ratio is not None:
        return (
            "過去実績に基づく補正係数 "
            f"{estimate.calibration_ratio:.2f} を反映しました。"
        )
    if track_record.median_hours is not None:
        return (
            "類似案件の実績中央値 "
            f"{track_record.median_hours:.1f} 時間を基準に調整しました。"
        )
    if not market_benchmark.consensus_hours.is_empty:
        return "市場相場の工数帯と現在の見積を比較して提案を調整しました。"
    return "現在の見積値をベースに提案を構成しました。"


def _savings_percent(
    *,
    market_total: float | None,
    proposed_total: float | None,
) -> float | None:
    if market_total is None or proposed_total is None or market_total <= 0:
        return None
    return _round1(((market_total - proposed_total) / market_total) * 100.0)


def _round1(value: float | None) -> float | None:
    if value is None:
        return None
    return round(float(value), 1)


def _parse_generated_proposal(content: str, *, default: OurProposal) -> OurProposal:
    raw = json.loads(_strip_markdown_fences(content))
    if not isinstance(raw, dict):
        raise ValueError("proposal response must be a JSON object")
    proposal = raw.get("our_proposal", raw)
    if not isinstance(proposal, dict):
        raise ValueError("proposal response missing our_proposal object")

    calibration_note = proposal.get("calibration_note")
    return OurProposal(
        proposed_hours=_first_number(
            _coerce_number(proposal.get("proposed_hours")),
            default.proposed_hours,
        ),
        proposed_rate=_first_number(
            _coerce_number(proposal.get("proposed_rate")),
            default.proposed_rate,
        ),
        proposed_total=_first_number(
            _coerce_number(proposal.get("proposed_total")),
            default.proposed_total,
        ),
        savings_vs_market_percent=_first_number(
            _coerce_number(proposal.get("savings_vs_market_percent")),
            default.savings_vs_market_percent,
        ),
        competitive_advantages=_coerce_advantages(
            proposal.get("competitive_advantages"),
            default=default.competitive_advantages,
        ),
        calibration_note=(
            calibration_note.strip()
            if isinstance(calibration_note, str) and calibration_note.strip()
            else default.calibration_note
        ),
    )


def _strip_markdown_fences(content: str) -> str:
    text = content.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline == -1:
            text = re.sub(r"^```\w*", "", text)
        else:
            text = text[first_newline + 1 :]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _coerce_number(value: object) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value))
    except ValueError:
        return None


def _coerce_advantages(value: object, *, default: list[str]) -> list[str]:
    if not isinstance(value, list):
        return default
    items = [item.strip()[:500] for item in value if isinstance(item, str) and item.strip()]
    return items[:4] or default


def _first_number(*values: float | None) -> float | None:
    for value in values:
        if value is not None:
            return value
    return None
