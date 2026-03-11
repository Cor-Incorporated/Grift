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


class NDJSONDoneChunk(BaseModel):
    type: str = "done"
    done: bool = True
    event_type: str = "conversation.turn.completed"
    data_classification: str


async def _ndjson_chunks(classification: str) -> AsyncGenerator[str, None]:
    content = NDJSONContentChunk(
        content="This is a stub response from llm-gateway.",
        data_classification=classification,
    )
    done = NDJSONDoneChunk(data_classification=classification)
    yield json.dumps(content.model_dump(), ensure_ascii=False) + "\n"
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
    """Return a mock OpenAI-compatible chat completion response.

    Args:
        request: The chat completion request body.

    Returns:
        A dict matching the OpenAI chat completion response format.
    """
    classification = resolve_classification(x_data_classification)

    if request.stream:
        return StreamingResponse(
            _ndjson_chunks(classification),
            media_type="application/x-ndjson",
        )

    debug_fail_stages = {
        item.strip() for item in (x_debug_fail_stages or "").split(",") if item.strip()
    }

    try:
        engine = load_fallback_engine(os.getenv("LLM_GATEWAY_FALLBACK_CHAIN_CONFIG"))
        primary_prompt = request.messages[-1].content if request.messages else ""
        result = engine.complete(
            prompt=primary_prompt,
            classification=classification,
            fail_stages=debug_fail_stages,
        )
    except Exception as exc:  # noqa: BLE001 - surface unified gateway failure.
        raise HTTPException(
            status_code=503, detail=f"llm backend unavailable: {exc}"
        ) from exc

    response.headers["X-Fallback-Used"] = "true" if result.fallback_used else "false"

    return {
        "id": "chatcmpl-stub",
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
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        },
    }


@router.get("/metrics/fallbacks")
async def fallback_metrics() -> dict[str, Any]:
    """Return fallback counters for observability."""
    return metrics.snapshot()
