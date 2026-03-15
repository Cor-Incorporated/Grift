from __future__ import annotations

import pytest

from llm_gateway.policy.loader import reset_policy


@pytest.fixture(autouse=True)
def reset_classification_policy() -> None:
    reset_policy()
    yield
    reset_policy()
