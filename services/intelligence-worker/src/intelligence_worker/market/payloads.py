"""Helpers for market Pub/Sub payload normalization."""

from __future__ import annotations

from typing import Any


def extract_market_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Flatten nested event payloads while preserving top-level identifiers."""
    nested = payload.get("payload")
    if not isinstance(nested, dict):
        return payload

    merged = dict(nested)
    for field in ("tenant_id", "case_id", "evidence_id", "job_id"):
        if field not in merged and isinstance(payload.get(field), str):
            merged[field] = payload[field]
    return merged


def normalize_market_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Backward-compatible alias for extracted market payloads."""
    return extract_market_payload(payload)
