"""Configuration loaded from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    """Immutable configuration for the intelligence worker.

    Attributes:
        pubsub_project_id: GCP project ID for Pub/Sub.
        pubsub_subscription: Pub/Sub subscription to consume from.
        database_url: PostgreSQL connection string.
        llm_gateway_url: llm-gateway base URL.
        extractor_plugins: Enabled extractor plugins.
        db_pool_min: Minimum idle connections in the pool.
        db_pool_max: Maximum connections the pool will open.
    """

    pubsub_project_id: str
    pubsub_subscription: str
    pubsub_topic: str
    database_url: str
    llm_gateway_url: str
    control_api_url: str
    control_api_token: str | None
    market_pubsub_subscription: str
    grok_api_key: str | None
    brave_api_key: str | None
    perplexity_api_key: str | None
    gemini_api_key: str | None
    market_provider_timeout_seconds: float
    market_provider_max_retries: int
    structured_output_model: str
    intent_classifier_model: str
    dead_letter_max_retries: int
    extractor_plugins: tuple[str, ...]
    db_pool_min: int = 1
    db_pool_max: int = 5


def load_config() -> Config:
    """Load configuration from environment variables.

    Returns:
        A frozen Config dataclass.

    Raises:
        ValueError: If any required environment variable is missing.
    """
    missing: list[str] = []
    env_vars = {
        "PUBSUB_PROJECT_ID": os.environ.get("PUBSUB_PROJECT_ID"),
        "DATABASE_URL": os.environ.get("DATABASE_URL"),
    }
    pubsub_subscription = os.environ.get(
        "PUBSUB_SUBSCRIPTION", "conversation-turn-completed-sub"
    )
    market_pubsub_subscription = os.environ.get(
        "MARKET_PUBSUB_SUBSCRIPTION",
        "market-research-requested-sub",
    )
    llm_gateway_url = os.environ.get("LLM_GATEWAY_URL", "http://localhost:8081")
    pubsub_topic = os.environ.get("PUBSUB_TOPIC", "conversation-turns")
    control_api_url = os.environ.get("CONTROL_API_URL", "http://localhost:8080")
    control_api_token = os.environ.get("CONTROL_API_TOKEN")
    grok_api_key = os.environ.get("GROK_API_KEY") or os.environ.get("XAI_API_KEY")
    brave_api_key = os.environ.get("BRAVE_API_KEY") or os.environ.get(
        "BRAVE_SEARCH_API_KEY"
    )
    perplexity_api_key = os.environ.get("PERPLEXITY_API_KEY")
    gemini_api_key = os.environ.get("GEMINI_API_KEY")
    market_provider_timeout_seconds = float(
        os.environ.get("MARKET_PROVIDER_TIMEOUT_SECONDS", "30")
    )
    market_provider_max_retries = int(
        os.environ.get("MARKET_PROVIDER_MAX_RETRIES", "2")
    )
    structured_output_model = os.environ.get(
        "STRUCTURED_OUTPUT_MODEL",
        "qwen3.5-7b",
    )
    intent_classifier_model = os.environ.get(
        "INTENT_CLASSIFIER_MODEL",
        "qwen3.5-9b",
    )
    dead_letter_max_retries = int(os.environ.get("DEAD_LETTER_MAX_RETRIES", "3"))
    db_pool_min = int(os.environ.get("DB_POOL_MIN", "1"))
    db_pool_max = int(os.environ.get("DB_POOL_MAX", "5"))
    extractor_plugins = tuple(
        plugin.strip()
        for plugin in os.environ.get("EXTRACTOR_PLUGINS", "estimation").split(",")
        if plugin.strip()
    )

    for name, value in env_vars.items():
        if not value:
            missing.append(name)

    if missing:
        raise ValueError(
            f"Missing required environment variables: {', '.join(missing)}"
        )

    return Config(
        pubsub_project_id=env_vars["PUBSUB_PROJECT_ID"],  # type: ignore[arg-type]
        pubsub_subscription=pubsub_subscription,
        pubsub_topic=pubsub_topic,
        database_url=env_vars["DATABASE_URL"],  # type: ignore[arg-type]
        llm_gateway_url=llm_gateway_url,
        control_api_url=control_api_url,
        control_api_token=control_api_token,
        market_pubsub_subscription=market_pubsub_subscription,
        grok_api_key=grok_api_key,
        brave_api_key=brave_api_key,
        perplexity_api_key=perplexity_api_key,
        gemini_api_key=gemini_api_key,
        market_provider_timeout_seconds=market_provider_timeout_seconds,
        market_provider_max_retries=market_provider_max_retries,
        structured_output_model=structured_output_model,
        intent_classifier_model=intent_classifier_model,
        dead_letter_max_retries=dead_letter_max_retries,
        extractor_plugins=extractor_plugins,
        db_pool_min=db_pool_min,
        db_pool_max=db_pool_max,
    )
