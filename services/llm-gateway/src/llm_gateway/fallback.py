"""Fallback chain engine for LLM provider availability."""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_CLASSIFICATION = "restricted"
ALLOWED_CLASSIFICATIONS = ("public", "internal", "confidential", "restricted")
DEFAULT_CONFIG_PATH = "packages/config/llm-gateway-fallback-chain.stub.json"


@dataclass(slots=True)
class FallbackStage:
    name: str
    provider: str
    model: str
    timeout_seconds: int
    enabled: bool
    allowed_classifications: tuple[str, ...]


@dataclass(slots=True)
class FallbackResult:
    stage: FallbackStage
    content: str
    attempts: list[str]
    fallback_used: bool


class FallbackMetrics:
    """In-memory metrics registry for fallback behavior."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._attempt_total = 0
        self._fallback_triggered_total = 0
        self._stage_success_total: dict[str, int] = {}
        self._stage_failure_total: dict[str, int] = {}
        self._cloud_escape_blocked_total = 0

    def record_attempt(self) -> None:
        with self._lock:
            self._attempt_total += 1

    def record_stage_success(self, stage: str) -> None:
        with self._lock:
            self._stage_success_total[stage] = (
                self._stage_success_total.get(stage, 0) + 1
            )

    def record_stage_failure(self, stage: str) -> None:
        with self._lock:
            self._stage_failure_total[stage] = (
                self._stage_failure_total.get(stage, 0) + 1
            )

    def record_fallback_triggered(self) -> None:
        with self._lock:
            self._fallback_triggered_total += 1

    def record_cloud_escape_blocked(self) -> None:
        with self._lock:
            self._cloud_escape_blocked_total += 1

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "attempt_total": self._attempt_total,
                "fallback_triggered_total": self._fallback_triggered_total,
                "stage_success_total": dict(self._stage_success_total),
                "stage_failure_total": dict(self._stage_failure_total),
                "cloud_escape_blocked_total": self._cloud_escape_blocked_total,
            }

    def reset(self) -> None:
        with self._lock:
            self._attempt_total = 0
            self._fallback_triggered_total = 0
            self._stage_success_total = {}
            self._stage_failure_total = {}
            self._cloud_escape_blocked_total = 0


metrics = FallbackMetrics()


class FallbackEngine:
    """Executes fallback stages according to configured chain order."""

    def __init__(self, stages: list[FallbackStage]) -> None:
        self.stages = [stage for stage in stages if stage.enabled]
        if not self.stages:
            raise ValueError("fallback chain has no enabled stages")

    def complete(
        self,
        prompt: str,
        classification: str,
        fail_stages: set[str] | None = None,
    ) -> FallbackResult:
        metrics.record_attempt()
        fail_stages = fail_stages or set()
        attempts: list[str] = []

        for index, stage in enumerate(self.stages):
            attempts.append(stage.name)

            if classification not in stage.allowed_classifications:
                if stage.name == "last_resort":
                    metrics.record_cloud_escape_blocked()
                continue

            if stage.name in fail_stages:
                metrics.record_stage_failure(stage.name)
                continue

            metrics.record_stage_success(stage.name)
            if index > 0:
                metrics.record_fallback_triggered()

            return FallbackResult(
                stage=stage,
                content=f"[{stage.provider}/{stage.model}] {prompt}",
                attempts=attempts,
                fallback_used=index > 0,
            )

        raise RuntimeError("all fallback stages failed")


def resolve_classification(raw: str | None) -> str:
    if raw in ALLOWED_CLASSIFICATIONS:
        return raw
    return DEFAULT_CLASSIFICATION


def load_fallback_engine(config_path: str | None = None) -> FallbackEngine:
    source = _resolve_config_path(
        config_path or os.getenv("LLM_GATEWAY_FALLBACK_CHAIN_CONFIG", "")
    )
    payload = json.loads(source.read_text(encoding="utf-8"))
    chain = payload.get("chain", [])
    stages = [
        FallbackStage(
            name=item["name"],
            provider=item["provider"],
            model=item["model"],
            timeout_seconds=int(item.get("timeout_seconds", 30)),
            enabled=bool(item.get("enabled", True)),
            allowed_classifications=tuple(
                item.get("allowed_classifications", ALLOWED_CLASSIFICATIONS)
            ),
        )
        for item in chain
    ]
    return FallbackEngine(stages)


def _resolve_config_path(raw: str) -> Path:
    candidates: list[Path] = []
    if raw:
        candidates.append(Path(raw))

    repo_root = Path(__file__).resolve().parents[4]
    candidates.append(repo_root / DEFAULT_CONFIG_PATH)
    candidates.append(Path.cwd() / DEFAULT_CONFIG_PATH)

    for candidate in candidates:
        if candidate.exists():
            return candidate

    raise FileNotFoundError(
        f"fallback config not found. tried: {[str(c) for c in candidates]}"
    )
