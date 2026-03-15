"""Request middleware for tenant classification enforcement."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from llm_gateway.audit.logger import log_classification_decision
from llm_gateway.fallback import resolve_classification
from llm_gateway.policy.loader import get_tenant_policy

if TYPE_CHECKING:
    from starlette.requests import Request


class ClassificationMiddleware(BaseHTTPMiddleware):
    """Validate request classification against tenant policy."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        if request.url.path == "/healthz":
            return await call_next(request)

        classification = resolve_classification(
            request.headers.get("X-Data-Classification")
        )
        tenant_id = request.headers.get("X-Tenant-ID", "").strip()
        policy = get_tenant_policy(tenant_id)

        if classification not in policy.allowed_levels:
            log_classification_decision(tenant_id or "default", classification, "block")
            return JSONResponse(
                status_code=403,
                content={"detail": "classification not allowed for tenant"},
            )

        request.state.classification = classification
        request.state.tenant_id = tenant_id
        return await call_next(request)
