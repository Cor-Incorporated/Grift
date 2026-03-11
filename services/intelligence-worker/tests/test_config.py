"""Tests for intelligence_worker.config."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from intelligence_worker.config import Config, load_config


class TestLoadConfig:
    """Tests for the load_config function."""

    def test_loads_all_env_vars(self) -> None:
        """All required env vars are read into a frozen Config."""
        env = {
            "PUBSUB_PROJECT_ID": "my-project",
            "PUBSUB_SUBSCRIPTION_ID": "my-sub",
            "DATABASE_URL": "postgresql://localhost/db",
        }
        with patch.dict(os.environ, env, clear=False):
            cfg = load_config()

        assert cfg.pubsub_project_id == "my-project"
        assert cfg.pubsub_subscription_id == "my-sub"
        assert cfg.database_url == "postgresql://localhost/db"
        assert cfg.extractor_plugins == ("estimation",)

    def test_raises_when_env_vars_missing(self) -> None:
        """ValueError is raised listing all missing variables."""
        with (
            patch.dict(os.environ, {}, clear=True),
            pytest.raises(ValueError, match="PUBSUB_PROJECT_ID"),
        ):
            load_config()

    def test_config_is_immutable(self) -> None:
        """Config dataclass is frozen and rejects attribute assignment."""
        cfg = Config(
            pubsub_project_id="p",
            pubsub_subscription_id="s",
            database_url="d",
            extractor_plugins=("estimation",),
        )
        with pytest.raises(AttributeError):
            cfg.pubsub_project_id = "new"  # type: ignore[misc]

    def test_parses_extractor_plugins_from_env(self) -> None:
        """Extractor plugin config is parsed from comma separated env var."""
        env = {
            "PUBSUB_PROJECT_ID": "my-project",
            "PUBSUB_SUBSCRIPTION_ID": "my-sub",
            "DATABASE_URL": "postgresql://localhost/db",
            "EXTRACTOR_PLUGINS": "estimation, custom_plugin",
        }
        with patch.dict(os.environ, env, clear=False):
            cfg = load_config()

        assert cfg.extractor_plugins == ("estimation", "custom_plugin")
