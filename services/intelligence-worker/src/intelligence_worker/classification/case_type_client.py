"""Control API client for syncing classified case types."""

from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass

from intelligence_worker.classification.intent_classifier import normalize_case_type


@dataclass(frozen=True)
class ControlAPICaseTypeClient:
    """PATCH cases.type through control-api."""

    base_url: str
    bearer_token: str | None = None
    timeout_seconds: float = 10.0

    def patch_case_type(self, *, tenant_id: str, case_id: str, intent: str) -> str:
        case_type = normalize_case_type(intent)
        headers = {
            "Content-Type": "application/json",
            "X-Tenant-ID": tenant_id,
        }
        if self.bearer_token:
            headers["Authorization"] = f"Bearer {self.bearer_token}"

        request = urllib.request.Request(
            self._endpoint(case_id),
            data=json.dumps({"type": case_type}).encode("utf-8"),
            headers=headers,
            method="PATCH",
        )
        response = urllib.request.urlopen(request, timeout=self.timeout_seconds)
        close = getattr(response, "close", None)
        if callable(close):
            close()
        return case_type

    def _endpoint(self, case_id: str) -> str:
        return self.base_url.rstrip("/") + f"/v1/cases/{case_id}"
