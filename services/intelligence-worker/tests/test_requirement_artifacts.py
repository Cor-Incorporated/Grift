"""Tests for requirement artifact generation and trigger helpers."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import MagicMock, patch

from psycopg2 import errors as psycopg_errors

from intelligence_worker.citations import _resolve_offsets
from intelligence_worker.qa_extraction import ConversationTurn
from intelligence_worker.requirement_artifacts import (
    CompletenessUpdatedRequirementArtifactHandler,
    RequirementArtifactCitation,
    RequirementArtifactDraft,
    RequirementArtifactGenerator,
    RequirementArtifactRepository,
    RequirementArtifactService,
    SourceContextChunk,
)


@dataclass
class _FakeLLM:
    response_text: str
    should_fail: bool = False

    def extract_structured(
        self, *, prompt: str, response_schema: dict[str, Any]
    ) -> str:
        assert "summary" in response_schema.get("properties", {})
        assert "Retrieved source context" in prompt
        if self.should_fail:
            raise RuntimeError("gateway unavailable")
        return self.response_text


@dataclass
class _FakeConversationRepository:
    turns: list[ConversationTurn]

    def load_turns(self, *, tenant_id: str, case_id: str) -> list[ConversationTurn]:
        assert tenant_id == "t1"
        assert case_id == "c1"
        return self.turns


@dataclass
class _FakeArtifactRepository:
    loaded: list[dict[str, Any]] = field(default_factory=list)
    saved: list[dict[str, Any]] = field(default_factory=list)
    version: int | None = 1

    def load_source_chunks(self, **kwargs: Any) -> list[SourceContextChunk]:
        self.loaded.append(kwargs)
        return _sample_chunks()

    def save_artifact(self, **kwargs: Any) -> int | None:
        self.saved.append(kwargs)
        return self.version


@dataclass
class _FakeArtifactGenerator:
    calls: list[dict[str, Any]] = field(default_factory=list)

    def generate(self, **kwargs: Any) -> RequirementArtifactDraft:
        self.calls.append(kwargs)
        return RequirementArtifactDraft(
            markdown="# Requirement Artifact\n",
            source_chunks=("11111111-1111-1111-1111-111111111111",),
            citations=(
                RequirementArtifactCitation(
                    chunk_id="11111111-1111-1111-1111-111111111111",
                    source_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    chunk_index=0,
                    offset_start=0,
                    offset_end=10,
                    content_sha256=_sha256(
                        "既存システムは Shopify を使っている。決済連携も必要。"
                    ),
                ),
            ),
        )


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sample_turns() -> list[ConversationTurn]:
    return [
        ConversationTurn(role="user", content="ECサイトを作りたい", turn_number=1),
        ConversationTurn(
            role="assistant",
            content="予算と希望納期を教えてください",
            turn_number=2,
        ),
        ConversationTurn(
            role="user",
            content="予算は300万円で、Shopifyの継続利用を希望します",
            turn_number=3,
        ),
    ]


def _sample_chunks() -> list[SourceContextChunk]:
    first = "既存システムは Shopify を使っている。決済連携も必要。"
    second = "社内では React と TypeScript が標準技術。"
    return [
        SourceContextChunk(
            chunk_id="11111111-1111-1111-1111-111111111111",
            content=first,
            source_document_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            chunk_index=0,
            content_sha256=_sha256(first),
        ),
        SourceContextChunk(
            chunk_id="22222222-2222-2222-2222-222222222222",
            content=second,
            source_document_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            chunk_index=1,
            content_sha256=_sha256(second),
        ),
    ]


def test_generator_produces_markdown_smoke_with_citations() -> None:
    generator = RequirementArtifactGenerator(
        llm_client=_FakeLLM(
            response_text=(
                '{"summary":"Shopify 連携のEC案件。",'
                '"functional_requirements":["商品一覧","決済連携"],'
                '"constraints":["React 継続利用"],'
                '"open_questions":["正式リリース日"]}'
            )
        )
    )

    draft = generator.generate(turns=_sample_turns(), source_chunks=_sample_chunks())

    assert "## Functional Requirements" in draft.markdown
    assert "- 商品一覧" in draft.markdown
    assert "## Citation Index" in draft.markdown
    assert "[chunk:11111111-1111-1111-1111-111111111111]" in draft.markdown
    assert draft.source_chunks
    assert draft.citations


def test_generator_tracks_only_existing_chunk_citations() -> None:
    generator = RequirementArtifactGenerator(
        llm_client=_FakeLLM(
            response_text=(
                '{"summary":"Shopify 継続の案件。",'
                '"functional_requirements":["Shopify 継続利用","React 管理画面"],'
                '"constraints":["既存技術を優先"],'
                '"open_questions":["納期"]}'
            )
        )
    )
    chunks = _sample_chunks()

    draft = generator.generate(turns=_sample_turns(), source_chunks=chunks)

    by_chunk_id = {chunk.chunk_id: chunk for chunk in chunks}
    assert draft.citations
    for citation in draft.citations:
        chunk = by_chunk_id[citation.chunk_id]
        assert citation.source_id == chunk.source_document_id
        assert citation.chunk_index == chunk.chunk_index
        assert citation.content_sha256 == chunk.content_sha256
        assert 0 <= citation.offset_start <= citation.offset_end <= len(chunk.content)


def test_resolve_offsets_returns_empty_range_when_hint_does_not_match() -> None:
    assert _resolve_offsets("Shopify 継続利用", "納期未定") == (0, 0)


def test_generator_falls_back_when_llm_fails() -> None:
    generator = RequirementArtifactGenerator(
        llm_client=_FakeLLM(response_text="{}", should_fail=True)
    )

    draft = generator.generate(turns=_sample_turns(), source_chunks=_sample_chunks())

    assert "ECサイトを作りたい" in draft.markdown
    assert "Target timeline still needs confirmation." in draft.markdown
    assert draft.citations


def test_repository_load_source_chunks_reads_embedded_case_related_chunks() -> None:
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = [
        (
            "22222222-2222-2222-2222-222222222222",
            "React と TypeScript",
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            1,
            _sha256("React と TypeScript"),
        ),
        (
            "11111111-1111-1111-1111-111111111111",
            "Shopify 継続利用",
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            0,
            _sha256("Shopify 継続利用"),
        ),
    ]
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    mock_conn_manager = MagicMock()
    mock_conn_manager.get_connection.return_value.__enter__ = MagicMock(
        return_value=mock_conn
    )
    mock_conn_manager.get_connection.return_value.__exit__ = MagicMock(
        return_value=False
    )

    repo = RequirementArtifactRepository(mock_conn_manager)
    chunks = repo.load_source_chunks(
        tenant_id="t1",
        case_id="c1",
        query_text="Shopify を継続したい",
        limit=1,
    )

    assert chunks == [
        SourceContextChunk(
            chunk_id="11111111-1111-1111-1111-111111111111",
            content="Shopify 継続利用",
            source_document_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            chunk_index=0,
            content_sha256=_sha256("Shopify 継続利用"),
        )
    ]
    executed_sql = mock_cursor.execute.call_args.args[0]
    assert "FROM chunk_embeddings ce" in executed_sql


def test_repository_save_artifact_increments_version_and_persists_citations() -> None:
    mock_cursor = MagicMock()
    mock_cursor.fetchone.side_effect = [(1,), (2,)]
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    mock_conn_manager = MagicMock()
    mock_conn_manager.get_connection.return_value.__enter__ = MagicMock(
        return_value=mock_conn
    )
    mock_conn_manager.get_connection.return_value.__exit__ = MagicMock(
        return_value=False
    )

    repo = RequirementArtifactRepository(mock_conn_manager)
    version = repo.save_artifact(
        tenant_id="t1",
        case_id="c1",
        draft=RequirementArtifactDraft(
            markdown="# Requirement Artifact\n",
            source_chunks=("11111111-1111-1111-1111-111111111111",),
            citations=(
                RequirementArtifactCitation(
                    chunk_id="11111111-1111-1111-1111-111111111111",
                    source_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    chunk_index=0,
                    offset_start=0,
                    offset_end=12,
                    content_sha256=_sha256("Shopify 継続利用"),
                ),
            ),
        ),
        created_by_uid="worker",
    )

    assert version == 2
    assert mock_cursor.execute.call_count == 2
    insert_call = mock_cursor.execute.call_args_list[1]
    assert "citations" in insert_call.args[0]
    assert insert_call.args[1][4] == ["11111111-1111-1111-1111-111111111111"]
    assert (
        '"chunk_id": "11111111-1111-1111-1111-111111111111"' in insert_call.args[1][5]
    )


def test_repository_save_artifact_returns_none_on_duplicate_version() -> None:
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = (1,)
    mock_cursor.execute.side_effect = [None, psycopg_errors.UniqueViolation()]
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    mock_conn_manager = MagicMock()
    mock_conn_manager.get_connection.return_value.__enter__ = MagicMock(
        return_value=mock_conn
    )
    mock_conn_manager.get_connection.return_value.__exit__ = MagicMock(
        return_value=False
    )

    repo = RequirementArtifactRepository(mock_conn_manager)
    version = repo.save_artifact(
        tenant_id="t1",
        case_id="c1",
        draft=RequirementArtifactDraft(
            markdown="# Requirement Artifact\n",
            source_chunks=("11111111-1111-1111-1111-111111111111",),
            citations=(),
        ),
        created_by_uid="worker",
    )

    assert version is None


def test_service_generates_and_persists_artifact_from_turns_and_chunks() -> None:
    artifact_repository = _FakeArtifactRepository()
    artifact_generator = _FakeArtifactGenerator()
    service = RequirementArtifactService(
        conversation_repository=_FakeConversationRepository(turns=_sample_turns()),
        artifact_repository=artifact_repository,
        artifact_generator=artifact_generator,
    )

    version = service.generate_for_case(
        tenant_id="t1",
        case_id="c1",
        created_by_uid="intelligence-worker",
    )

    assert version == 1
    assert artifact_repository.loaded[0]["query_text"]
    assert artifact_repository.saved[0]["created_by_uid"] == "intelligence-worker"
    assert len(artifact_generator.calls) == 1


def test_completeness_trigger_generates_artifact_at_threshold() -> None:
    artifact_repository = _FakeArtifactRepository(version=3)
    handler = CompletenessUpdatedRequirementArtifactHandler(
        service=RequirementArtifactService(
            conversation_repository=_FakeConversationRepository(turns=_sample_turns()),
            artifact_repository=artifact_repository,
            artifact_generator=_FakeArtifactGenerator(),
        )
    )

    handler(
        {
            "tenant_id": "t1",
            "aggregate_id": "c1",
            "source_domain": "estimation",
            "payload": {
                "session_id": "c1",
                "overall_completeness": 0.8,
                "checklist": {},
                "suggested_next_topics": [],
            },
        }
    )

    assert len(artifact_repository.saved) == 1


def test_completeness_trigger_skips_when_threshold_not_met() -> None:
    artifact_repository = _FakeArtifactRepository(version=3)
    handler = CompletenessUpdatedRequirementArtifactHandler(
        service=RequirementArtifactService(
            conversation_repository=_FakeConversationRepository(turns=_sample_turns()),
            artifact_repository=artifact_repository,
            artifact_generator=_FakeArtifactGenerator(),
        )
    )

    handler(
        {
            "tenant_id": "t1",
            "aggregate_id": "c1",
            "source_domain": "estimation",
            "payload": {
                "session_id": "c1",
                "overall_completeness": 0.79,
                "checklist": {},
                "suggested_next_topics": [],
            },
        }
    )

    assert artifact_repository.saved == []


def test_completeness_trigger_skips_out_of_range_completeness() -> None:
    artifact_repository = _FakeArtifactRepository(version=3)
    handler = CompletenessUpdatedRequirementArtifactHandler(
        service=RequirementArtifactService(
            conversation_repository=_FakeConversationRepository(turns=_sample_turns()),
            artifact_repository=artifact_repository,
            artifact_generator=_FakeArtifactGenerator(),
        )
    )

    with patch("intelligence_worker.requirement_artifacts.logger.warning") as warning:
        handler(
            {
                "tenant_id": "t1",
                "aggregate_id": "c1",
                "source_domain": "estimation",
                "payload": {
                    "session_id": "c1",
                    "overall_completeness": 1.2,
                    "checklist": {},
                    "suggested_next_topics": [],
                },
            }
        )

    assert artifact_repository.saved == []
    warning.assert_called_once()
    assert warning.call_args.args[0] == "requirement_artifact_invalid_completeness"


def test_completeness_trigger_skips_duplicate_idempotency_key() -> None:
    artifact_repository = _FakeArtifactRepository(version=3)
    handler = CompletenessUpdatedRequirementArtifactHandler(
        service=RequirementArtifactService(
            conversation_repository=_FakeConversationRepository(turns=_sample_turns()),
            artifact_repository=artifact_repository,
            artifact_generator=_FakeArtifactGenerator(),
        )
    )
    payload = {
        "tenant_id": "t1",
        "aggregate_id": "c1",
        "event_id": "evt-1",
        "idempotency_key": "c1:6:completeness",
        "source_domain": "estimation",
        "payload": {
            "session_id": "c1",
            "overall_completeness": 0.8,
            "checklist": {},
            "suggested_next_topics": [],
        },
    }

    handler(payload)
    handler(payload)

    assert len(artifact_repository.saved) == 1
