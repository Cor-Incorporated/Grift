"""FastAPI application for the LLM Gateway."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from llm_gateway.middleware.classification import ClassificationMiddleware
from llm_gateway.routes.chat import router as chat_router
from llm_gateway.routes.health import router as health_router


def create_app() -> FastAPI:
    """Create and configure the FastAPI application.

    Returns:
        A fully configured FastAPI instance.
    """
    app = FastAPI(
        title="LLM Gateway",
        version="0.0.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(ClassificationMiddleware)

    app.include_router(health_router)
    app.include_router(chat_router)

    return app


app = create_app()
