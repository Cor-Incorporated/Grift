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
            "DATABASE_URL": "postgresql://localhost/db",
        }
        with patch.dict(os.environ, env, clear=False):
            cfg = load_config()

        assert cfg.pubsub_project_id == "my-project"
        assert cfg.pubsub_subscription == "conversation-turn-completed-sub"
        assert cfg.market_pubsub_subscription == "market-research-requested-sub"
        assert cfg.pubsub_topic == "conversation-turns"
        assert cfg.database_url == "postgresql://localhost/db"
        assert cfg.llm_gateway_url == "http://localhost:8081"
        assert cfg.control_api_url == "http://localhost:8080"
        assert cfg.control_api_token is None
        assert cfg.grok_api_key is None
        assert cfg.brave_api_key is None
        assert cfg.perplexity_api_key is None
        assert cfg.gemini_api_key is None
        assert cfg.market_provider_timeout_seconds == 30.0
        assert cfg.market_provider_max_retries == 2
        assert cfg.structured_output_model == "qwen3.5-7b"
        assert cfg.intent_classifier_model == "qwen3.5-9b"
        assert cfg.dead_letter_max_retries == 3
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
            pubsub_subscription="s",
            market_pubsub_subscription="market-sub",
            pubsub_topic="conversation-turns",
            database_url="d",
            llm_gateway_url="http://localhost:8081",
            control_api_url="http://localhost:8080",
            control_api_token=None,
            grok_api_key=None,
            brave_api_key=None,
            perplexity_api_key=None,
            gemini_api_key=None,
            market_provider_timeout_seconds=30.0,
            market_provider_max_retries=2,
            structured_output_model="qwen3.5-7b",
            intent_classifier_model="qwen3.5-9b",
            dead_letter_max_retries=3,
            extractor_plugins=("estimation",),
        )
        with pytest.raises(AttributeError):
            cfg.pubsub_project_id = "new"  # type: ignore[misc]

    def test_parses_extractor_plugins_from_env(self) -> None:
        """Extractor plugin config is parsed from comma separated env var."""
        env = {
            "PUBSUB_PROJECT_ID": "my-project",
            "DATABASE_URL": "postgresql://localhost/db",
            "EXTRACTOR_PLUGINS": "estimation, custom_plugin",
            "PUBSUB_SUBSCRIPTION": "custom-sub",
            "MARKET_PUBSUB_SUBSCRIPTION": "market-sub",
            "PUBSUB_TOPIC": "observation-events",
            "LLM_GATEWAY_URL": "http://gateway:8081",
            "CONTROL_API_URL": "http://control-api:8080",
            "CONTROL_API_TOKEN": "secret-token",
            "GROK_API_KEY": "grok-secret",
            "BRAVE_API_KEY": "brave-secret",
            "PERPLEXITY_API_KEY": "perplexity-secret",
            "GEMINI_API_KEY": "gemini-secret",
            "MARKET_PROVIDER_TIMEOUT_SECONDS": "12.5",
            "MARKET_PROVIDER_MAX_RETRIES": "4",
            "STRUCTURED_OUTPUT_MODEL": "qwen3.5-14b",
            "INTENT_CLASSIFIER_MODEL": "qwen3.5-9b",
            "DEAD_LETTER_MAX_RETRIES": "5",
        }
        with patch.dict(os.environ, env, clear=False):
            cfg = load_config()

        assert cfg.extractor_plugins == ("estimation", "custom_plugin")
        assert cfg.pubsub_subscription == "custom-sub"
        assert cfg.market_pubsub_subscription == "market-sub"
        assert cfg.pubsub_topic == "observation-events"
        assert cfg.llm_gateway_url == "http://gateway:8081"
        assert cfg.control_api_url == "http://control-api:8080"
        assert cfg.control_api_token == "secret-token"
        assert cfg.grok_api_key == "grok-secret"
        assert cfg.brave_api_key == "brave-secret"
        assert cfg.perplexity_api_key == "perplexity-secret"
        assert cfg.gemini_api_key == "gemini-secret"
        assert cfg.market_provider_timeout_seconds == 12.5
        assert cfg.market_provider_max_retries == 4
        assert cfg.structured_output_model == "qwen3.5-14b"
        assert cfg.intent_classifier_model == "qwen3.5-9b"
        assert cfg.dead_letter_max_retries == 5

    def test_supports_legacy_market_api_key_aliases(self) -> None:
        env = {
            "PUBSUB_PROJECT_ID": "my-project",
            "DATABASE_URL": "postgresql://localhost/db",
            "XAI_API_KEY": "legacy-grok",
            "BRAVE_SEARCH_API_KEY": "legacy-brave",
        }
        with patch.dict(os.environ, env, clear=False):
            cfg = load_config()

        assert cfg.grok_api_key == "legacy-grok"
        assert cfg.brave_api_key == "legacy-brave"
