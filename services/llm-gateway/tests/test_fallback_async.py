from __future__ import annotations

import asyncio

import pytest

from llm_gateway import fallback
from llm_gateway.fallback import FallbackEngine, FallbackStage, metrics
from llm_gateway.providers.base import ProviderResponse, StreamChunk


def _run(coro):
    return asyncio.run(coro)


async def _collect(stream):
    return [chunk async for chunk in stream]


def _stage(
    name: str,
    *,
    base_url: str = "",
    allowed_classifications: tuple[str, ...] = ("restricted",),
) -> FallbackStage:
    return FallbackStage(
        name=name,
        provider=f"{name}-provider",
        model=f"{name}-model",
        timeout_seconds=5,
        enabled=True,
        allowed_classifications=allowed_classifications,
        base_url=base_url,
        api_key="token",
    )


@pytest.fixture(autouse=True)
def reset_metrics() -> None:
    metrics.reset()
    yield
    metrics.reset()


class StubProvider:
    def __init__(
        self,
        *,
        response: ProviderResponse | None = None,
        complete_exc: Exception | None = None,
        stream_chunks: list[StreamChunk] | None = None,
    ) -> None:
        self._response = response
        self._complete_exc = complete_exc
        self._stream_chunks = stream_chunks or []

    async def complete(self, *args, **kwargs) -> ProviderResponse:
        if self._complete_exc is not None:
            raise self._complete_exc
        assert self._response is not None
        return self._response

    async def stream(self, *args, **kwargs):
        for chunk in self._stream_chunks:
            yield chunk


def test_acomplete_returns_stub_fallback() -> None:
    engine = FallbackEngine([_stage("primary"), _stage("secondary")])

    result = _run(
        engine.acomplete(
            [{"role": "user", "content": "hello"}],
            classification="restricted",
            fail_stages={"primary"},
        )
    )

    assert result.stage.name == "secondary"
    assert result.content == "[secondary-provider/secondary-model] hello"
    assert result.attempts == ["secondary"]
    assert result.fallback_used is True
    snapshot = metrics.snapshot()
    assert snapshot["stage_failure_total"]["primary"] == 1
    assert snapshot["fallback_triggered_total"] == 1


def test_acomplete_falls_back_to_real_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = FallbackEngine(
        [
            _stage("primary", base_url="https://primary.test"),
            _stage("secondary", base_url="https://secondary.test"),
        ]
    )

    def build_provider(stage: FallbackStage) -> StubProvider:
        if stage.name == "primary":
            return StubProvider(complete_exc=RuntimeError("primary failed"))
        return StubProvider(
            response=ProviderResponse(
                content="secondary response",
                model=stage.model,
                prompt_tokens=9,
                completion_tokens=3,
            )
        )

    monkeypatch.setattr(fallback, "_build_provider", build_provider)

    result = _run(
        engine.acomplete(
            [{"role": "user", "content": "hello"}],
            classification="restricted",
        )
    )

    assert result.stage.name == "secondary"
    assert result.content == "secondary response"
    assert result.attempts == ["primary", "secondary"]
    assert result.fallback_used is True
    assert result.usage == {
        "prompt_tokens": 9,
        "completion_tokens": 3,
        "total_tokens": 12,
    }
    snapshot = metrics.snapshot()
    assert snapshot["fallback_triggered_total"] == 1
    assert snapshot["stage_failure_total"]["primary"] == 1
    assert snapshot["stage_success_total"]["secondary"] == 1


def test_acomplete_raises_when_all_stages_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = FallbackEngine(
        [
            _stage("primary", base_url="https://primary.test"),
            _stage("secondary", base_url="https://secondary.test"),
        ]
    )
    monkeypatch.setattr(
        fallback,
        "_build_provider",
        lambda stage: StubProvider(complete_exc=RuntimeError(f"{stage.name} failed")),
    )

    with pytest.raises(RuntimeError, match="all fallback stages failed"):
        _run(
            engine.acomplete(
                [{"role": "user", "content": "hello"}],
                classification="restricted",
            )
        )


def test_astream_returns_stub_stream() -> None:
    engine = FallbackEngine([_stage("primary")])

    stage, stream = _run(
        engine.astream(
            [{"role": "user", "content": "hello"}],
            classification="restricted",
        )
    )
    chunks = _run(_collect(stream))

    assert stage.name == "primary"
    assert chunks == [
        StreamChunk(
            content="[primary-provider/primary-model] hello",
            finish_reason="stop",
        )
    ]


def test_astream_enforces_classification_restrictions() -> None:
    engine = FallbackEngine(
        [_stage("last_resort", allowed_classifications=("public",))]
    )

    with pytest.raises(RuntimeError, match="all fallback stages failed"):
        _run(
            engine.astream(
                [{"role": "user", "content": "hello"}],
                classification="restricted",
            )
        )

    snapshot = metrics.snapshot()
    assert snapshot["cloud_escape_blocked_total"] == 1


def test_resolve_env_reads_placeholders(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "secret")

    assert fallback._resolve_env("${OPENAI_API_KEY}") == "secret"
    assert fallback._resolve_env("${MISSING_ENV}") == ""
    assert fallback._resolve_env("https://plain.example") == "https://plain.example"
