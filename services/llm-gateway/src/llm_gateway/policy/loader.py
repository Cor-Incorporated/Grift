"""Load tenant classification policy from YAML."""

from __future__ import annotations

import os
from pathlib import Path

import yaml

from llm_gateway.policy.models import (
    ClassificationPolicyConfig,
    TenantClassificationPolicy,
)

DEFAULT_POLICY_PATH = "packages/config/tenant-data-classification-policy.stub.yaml"

_cached_policy: ClassificationPolicyConfig | None = None
_cached_path: Path | None = None


def load_policy(path: Path | None = None) -> ClassificationPolicyConfig:
    """Load and cache tenant classification policy from YAML."""
    global _cached_path, _cached_policy

    source = _resolve_policy_path(path)
    if _cached_policy is not None and _cached_path == source:
        return _cached_policy

    payload = yaml.safe_load(source.read_text(encoding="utf-8")) or {}
    _cached_policy = ClassificationPolicyConfig.model_validate(payload)
    _cached_path = source
    return _cached_policy


def get_tenant_policy(tenant_id: str) -> TenantClassificationPolicy:
    """Return policy for tenant, falling back to default."""
    config = load_policy()
    if tenant_id:
        return config.tenants.get(tenant_id, config.default)
    return config.default


def reset_policy() -> None:
    """Clear cached tenant policy for tests and reloads."""
    global _cached_path, _cached_policy
    _cached_policy = None
    _cached_path = None


def _resolve_policy_path(path: Path | None) -> Path:
    if path is not None:
        return path

    raw = os.getenv("CLASSIFICATION_POLICY_PATH", "")
    candidates: list[Path] = []
    if raw:
        candidates.append(Path(raw))

    repo_root = Path(__file__).resolve().parents[4]
    candidates.append(repo_root / DEFAULT_POLICY_PATH)
    candidates.append(Path.cwd() / DEFAULT_POLICY_PATH)

    for candidate in candidates:
        if candidate.exists():
            return candidate

    raise FileNotFoundError(
        f"classification policy not found. tried: {[str(c) for c in candidates]}"
    )
