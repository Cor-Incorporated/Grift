"""Chat completions endpoint with configurable fallback chain."""

from __future__ import annotations

import json
import os
import time
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Header, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from llm_gateway.audit.logger import log_classification_decision
from llm_gateway.fallback import DEFAULT_CLASSIFICATION, load_fallback_engine, metrics
from llm_gateway.redaction import redact, should_redact

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
    http_request: Request,
    request: ChatCompletionRequest,
    response: Response,
    x_debug_fail_stages: str | None = Header(default=None, alias="X-Debug-Fail-Stages"),
) -> Any:
    """Return an OpenAI-compatible chat completion response.

    Supports both streaming (NDJSON) and non-streaming modes.
    Uses the fallback chain to route to available providers.
    """
    classification, tenant_id = _request_context(http_request)
    debug_fail_stages = {
        item.strip() for item in (x_debug_fail_stages or "").split(",") if item.strip()
    }
    messages = _prepare_messages(request.messages, classification, tenant_id)
    engine = _load_engine_or_503()

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
    return _build_completion_payload(result, classification)


@router.get("/metrics/fallbacks")
async def fallback_metrics() -> dict[str, Any]:
    """Return fallback counters for observability."""
    return metrics.snapshot()


def _request_context(http_request: Request) -> tuple[str, str]:
    classification = getattr(
        http_request.state, "classification", DEFAULT_CLASSIFICATION
    )
    tenant_id = getattr(http_request.state, "tenant_id", "") or "default"
    return classification, tenant_id


def _prepare_messages(
    messages: list[ChatMessage],
    classification: str,
    tenant_id: str,
) -> list[dict[str, str]]:
    payload = _serialize_messages(messages)
    if not should_redact(classification):
        log_classification_decision(tenant_id, classification, "allow")
        return payload

    redacted_messages, redacted_count, redacted_types = _redact_messages(payload)
    log_classification_decision(
        tenant_id,
        classification,
        "redact",
        redacted_count=redacted_count,
        redacted_types=redacted_types,
    )
    return redacted_messages


def _load_engine_or_503() -> Any:
    try:
        return load_fallback_engine(os.getenv("LLM_GATEWAY_FALLBACK_CHAIN_CONFIG"))
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail=f"llm backend unavailable: {exc}"
        ) from exc


def _build_completion_payload(result: Any, classification: str) -> dict[str, Any]:
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
                "message": {"role": "assistant", "content": result.content},
                "finish_reason": "stop",
            }
        ],
        "usage": result.usage,
    }


def _serialize_messages(messages: list[ChatMessage]) -> list[dict[str, str]]:
    return [{"role": message.role, "content": message.content} for message in messages]


def _redact_messages(
    messages: list[dict[str, str]],
) -> tuple[list[dict[str, str]], int, list[str]]:
    redacted_messages: list[dict[str, str]] = []
    redacted_count = 0
    redacted_types: list[str] = []

    for message in messages:
        result = redact(message["content"])
        redacted_messages.append({"role": message["role"], "content": result.text})
        redacted_count += result.redacted_count
        for pii_type in result.redacted_types:
            if pii_type not in redacted_types:
                redacted_types.append(pii_type)

    return redacted_messages, redacted_count, redacted_types
