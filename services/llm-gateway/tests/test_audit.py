from __future__ import annotations

import json
import logging

from llm_gateway.audit.logger import log_classification_decision


def test_log_classification_decision_emits_structured_json(caplog) -> None:
    with caplog.at_level(logging.INFO, logger="llm_gateway.audit"):
        log_classification_decision(
            tenant_id="tenant-123",
            classification="confidential",
            action="redact",
            redacted_count=2,
            redacted_types=["EMAIL", "PHONE_JP"],
        )

    assert len(caplog.records) == 1
    payload = json.loads(caplog.records[0].message)
    assert payload["event"] == "classification_decision"
    assert payload["tenant_id"] == "tenant-123"
    assert payload["classification"] == "confidential"
    assert payload["action"] == "redact"
    assert payload["redacted_count"] == 2
    assert payload["redacted_types"] == ["EMAIL", "PHONE_JP"]
    assert payload["timestamp"].endswith("+00:00")
