"""Pydantic models for tenant data-classification policy."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from llm_gateway.fallback import ALLOWED_CLASSIFICATIONS


class TenantClassificationPolicy(BaseModel):
    """Allowed classifications for a tenant."""

    allowed_levels: list[str]

    @field_validator("allowed_levels")
    @classmethod
    def validate_allowed_levels(cls, value: list[str]) -> list[str]:
        invalid = [level for level in value if level not in ALLOWED_CLASSIFICATIONS]
        if invalid:
            raise ValueError(f"unsupported classification levels: {invalid}")
        if not value:
            raise ValueError("allowed_levels must not be empty")
        return value


class ClassificationPolicyConfig(BaseModel):
    """Top-level tenant policy configuration."""

    default: TenantClassificationPolicy
    tenants: dict[str, TenantClassificationPolicy] = Field(default_factory=dict)
