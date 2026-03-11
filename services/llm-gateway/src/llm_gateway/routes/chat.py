"""Chat completions endpoint (OpenAI-compatible stub)."""

from __future__ import annotations

import json
import time
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

router = APIRouter()

DATA_CLASSIFICATIONS = ("public", "internal", "confidential", "restricted")


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


def _resolve_classification(raw: str | None) -> str:
    # ADR-0014 fail-closed: missing/invalid header falls back to restricted.
    if raw in DATA_CLASSIFICATIONS:
        return raw
    return "restricted"


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
    x_data_classification: str | None = Header(
        default=None, alias="X-Data-Classification"
    ),
) -> Any:
    """Return a mock OpenAI-compatible chat completion response.

    Args:
        request: The chat completion request body.

    Returns:
        A dict matching the OpenAI chat completion response format.
    """
    classification = _resolve_classification(x_data_classification)

    if request.stream:
        return StreamingResponse(
            _ndjson_chunks(classification),
            media_type="application/x-ndjson",
        )

    return {
        "id": "chatcmpl-stub",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": request.model,
        "data_classification": classification,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "This is a stub response from llm-gateway.",
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
