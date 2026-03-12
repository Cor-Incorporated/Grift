"""Chat completions endpoint with configurable fallback chain."""

from __future__ import annotations

import json
import os
import time
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Header, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from llm_gateway.fallback import load_fallback_engine, metrics, resolve_classification

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

router = APIRouter()


class ChatMessage(BaseModel):
    """A single message in the chat conversation."""

    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    """OpenAI-compatible chat completion request."""

    model: str = "stub"
    messages: list[ChatMessage]
    temperature: float = 0.7
    max_tokens: int | None = None
    stream: bool = False


class NDJSONContentChunk(BaseModel):
    type: str = "content"
    content: str
    data_classification: str


class NDJSONErrorChunk(BaseModel):
    type: str = "error"
    error: str
    data_classification: str


class NDJSONDoneChunk(BaseModel):
    type: str = "done"
    done: bool = True
    event_type: str = "conversation.turn.completed"
    data_classification: str


async def _ndjson_stream(
    engine: Any,
    messages: list[dict[str, str]],
    *,
    classification: str,
    temperature: float,
    max_tokens: int | None,
    fail_stages: set[str],
) -> AsyncGenerator[str, None]:
    """Stream NDJSON chunks from the fallback engine."""
    try:
        stage, chunk_iter = await engine.astream(
            messages,
            classification=classification,
            temperature=temperature,
            max_tokens=max_tokens,
            fail_stages=fail_stages,
        )
        async for chunk in chunk_iter:
            if chunk.content:
                ndjson = NDJSONContentChunk(
                    content=chunk.content,
                    data_classification=classification,
                )
                yield json.dumps(ndjson.model_dump(), ensure_ascii=False) + "\n"
    except Exception as exc:
        error = NDJSONErrorChunk(
            error=str(exc),
            data_classification=classification,
        )
        yield json.dumps(error.model_dump(), ensure_ascii=False) + "\n"

    done = NDJSONDoneChunk(data_classification=classification)
    yield json.dumps(done.model_dump(), ensure_ascii=False) + "\n"


@router.post("/v1/chat/completions", response_model=None)
async def chat_completions(
    request: ChatCompletionRequest,
    response: Response,
    x_data_classification: str | None = Header(
        default=None, alias="X-Data-Classification"
    ),
    x_debug_fail_stages: str | None = Header(default=None, alias="X-Debug-Fail-Stages"),
) -> Any:
    """Return an OpenAI-compatible chat completion response.

    Supports both streaming (NDJSON) and non-streaming modes.
    Uses the fallback chain to route to available providers.
    """
    classification = resolve_classification(x_data_classification)
    debug_fail_stages = {
        item.strip() for item in (x_debug_fail_stages or "").split(",") if item.strip()
    }

    try:
        engine = load_fallback_engine(os.getenv("LLM_GATEWAY_FALLBACK_CHAIN_CONFIG"))
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail=f"llm backend unavailable: {exc}"
        ) from exc

    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    if request.stream:
        return StreamingResponse(
            _ndjson_stream(
                engine,
                messages,
                classification=classification,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                fail_stages=debug_fail_stages,
            ),
            media_type="application/x-ndjson",
        )

    try:
        result = await engine.acomplete(
            messages,
            classification=classification,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            fail_stages=debug_fail_stages,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail=f"llm backend unavailable: {exc}"
        ) from exc

    response.headers["X-Fallback-Used"] = "true" if result.fallback_used else "false"

    return {
        "id": f"chatcmpl-{int(time.time())}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": result.stage.model,
        "data_classification": classification,
        "fallback": {
            "used": result.fallback_used,
            "stage": result.stage.name,
            "provider": result.stage.provider,
            "attempts": result.attempts,
            "classification": classification,
        },
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": result.content,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": result.usage,
    }


@router.get("/metrics/fallbacks")
async def fallback_metrics() -> dict[str, Any]:
    """Return fallback counters for observability."""
    return metrics.snapshot()
