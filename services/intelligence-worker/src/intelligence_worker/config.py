"""Configuration loaded from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    """Immutable configuration for the intelligence worker.

    Attributes:
        pubsub_project_id: GCP project ID for Pub/Sub.
        pubsub_subscription_id: Pub/Sub subscription to consume from.
        database_url: PostgreSQL connection string.
        extractor_plugins: Enabled extractor plugins.
    """

    pubsub_project_id: str
    pubsub_subscription_id: str
    database_url: str
    extractor_plugins: tuple[str, ...]


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
        "PUBSUB_SUBSCRIPTION_ID": os.environ.get("PUBSUB_SUBSCRIPTION_ID"),
        "DATABASE_URL": os.environ.get("DATABASE_URL"),
    }
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
        pubsub_subscription_id=env_vars["PUBSUB_SUBSCRIPTION_ID"],  # type: ignore[arg-type]
        database_url=env_vars["DATABASE_URL"],  # type: ignore[arg-type]
        extractor_plugins=extractor_plugins,
    )
