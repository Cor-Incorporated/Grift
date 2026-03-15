"""Structured audit logging for classification decisions."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

audit_logger = logging.getLogger("llm_gateway.audit")


def log_classification_decision(
    tenant_id: str,
    classification: str,
    action: str,
    redacted_count: int = 0,
    redacted_types: list[str] | None = None,
) -> None:
    """Emit structured JSON audit log entry."""
    payload = {
        "event": "classification_decision",
        "tenant_id": tenant_id,
        "classification": classification,
        "action": action,
        "redacted_count": redacted_count,
        "redacted_types": redacted_types or [],
        "timestamp": datetime.now(UTC).isoformat(),
    }
    audit_logger.info(json.dumps(payload))
