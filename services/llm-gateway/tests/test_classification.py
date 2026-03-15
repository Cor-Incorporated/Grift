from __future__ import annotations

import json
from typing import TYPE_CHECKING

from llm_gateway.policy.loader import get_tenant_policy, load_policy

if TYPE_CHECKING:
    from pathlib import Path

TENANT_ID = "tenant-123"


def _base_payload() -> dict[str, object]:
    return {
        "model": "stub",
        "messages": [{"role": "user", "content": "hello"}],
    }


def _write_policy(path: Path) -> None:
    payload = {
        "default": {"allowed_levels": ["restricted"]},
        "tenants": {TENANT_ID: {"allowed_levels": ["internal", "confidential"]}},
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_load_policy_caches_config(monkeypatch, tmp_path: Path) -> None:
    policy_path = tmp_path / "policy.yaml"
    _write_policy(policy_path)
    monkeypatch.setenv("CLASSIFICATION_POLICY_PATH", str(policy_path))

    first = load_policy()
    policy_path.write_text(
        "default:\n  allowed_levels:\n    - public\n",
        encoding="utf-8",
    )
    second = load_policy()

    assert first is second
    assert second.default.allowed_levels == ["restricted"]


def test_get_tenant_policy_falls_back_to_default(monkeypatch, tmp_path: Path) -> None:
    policy_path = tmp_path / "policy.yaml"
    _write_policy(policy_path)
    monkeypatch.setenv("CLASSIFICATION_POLICY_PATH", str(policy_path))

    tenant_policy = get_tenant_policy(TENANT_ID)
    default_policy = get_tenant_policy("missing-tenant")

    assert tenant_policy.allowed_levels == ["internal", "confidential"]
    assert default_policy.allowed_levels == ["restricted"]


def test_load_policy_uses_repo_default_stub(monkeypatch) -> None:
    monkeypatch.delenv("CLASSIFICATION_POLICY_PATH", raising=False)

    policy = load_policy()

    assert policy.default.allowed_levels == ["restricted"]


def test_classification_middleware_blocks_disallowed_tenant_level(
    monkeypatch, tmp_path: Path
) -> None:
    from fastapi.testclient import TestClient

    from llm_gateway.main import create_app

    policy_path = tmp_path / "policy.yaml"
    _write_policy(policy_path)
    monkeypatch.setenv("CLASSIFICATION_POLICY_PATH", str(policy_path))
    client = TestClient(create_app())

    response = client.post(
        "/v1/chat/completions",
        headers={"X-Tenant-ID": TENANT_ID, "X-Data-Classification": "public"},
        json=_base_payload(),
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "classification not allowed for tenant"}


def test_classification_middleware_skips_healthz() -> None:
    from fastapi.testclient import TestClient

    from llm_gateway.main import create_app

    client = TestClient(create_app())

    response = client.get(
        "/healthz",
        headers={"X-Tenant-ID": TENANT_ID, "X-Data-Classification": "public"},
    )

    assert response.status_code == 200
