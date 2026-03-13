"""Control API client for syncing classified case types."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

import structlog

from intelligence_worker.classification.intent_classifier import normalize_case_type

logger = structlog.get_logger()


@dataclass(frozen=True)
class ControlAPICaseTypeClient:
    """PATCH cases.type through control-api."""

    base_url: str
    bearer_token: str | None = None
    timeout_seconds: float = 10.0

    def __post_init__(self) -> None:
        parsed = urllib.parse.urlparse(self.base_url)
        if parsed.scheme not in ("http", "https"):
            msg = f"base_url scheme must be http/https, got: {parsed.scheme!r}"
            raise ValueError(msg)
        if not parsed.hostname:
            raise ValueError("base_url must include a hostname")

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
        try:
            response = urllib.request.urlopen(request, timeout=self.timeout_seconds)
        except urllib.error.URLError as exc:
            logger.error(
                "control_api_patch_case_type_failed",
                case_id=case_id,
                error=str(exc),
            )
            raise
        close_fn = getattr(response, "close", None)
        if callable(close_fn):
            close_fn()
        return case_type

    def _endpoint(self, case_id: str) -> str:
        return self.base_url.rstrip("/") + f"/v1/cases/{case_id}"
