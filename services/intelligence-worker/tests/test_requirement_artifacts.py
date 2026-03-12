"""Tests for requirement artifact helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock

from intelligence_worker.qa_extraction import ConversationTurn
from intelligence_worker.requirement_artifacts import (
    RequirementArtifactDraft,
    RequirementArtifactGenerator,
    RequirementArtifactRepository,
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


def _sample_turns() -> list[ConversationTurn]:
    return [
        ConversationTurn(role="user", content="ECサイトを作りたい", turn_number=1),
        ConversationTurn(
            role="assistant",
            content="予算と希望納期を教えてください",
            turn_number=2,
        ),
        ConversationTurn(role="user", content="予算は300万円です", turn_number=3),
    ]


def _sample_chunks() -> list[SourceContextChunk]:
    return [
        SourceContextChunk(
            chunk_id="11111111-1111-1111-1111-111111111111",
            content="既存システムは Shopify を使っている。",
            source_document_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            chunk_index=0,
        ),
        SourceContextChunk(
            chunk_id="22222222-2222-2222-2222-222222222222",
            content="社内では React と TypeScript が標準技術。",
            source_document_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            chunk_index=1,
        ),
    ]


def test_generator_uses_llm_and_embeds_chunk_citations() -> None:
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
    assert "[chunk:11111111-1111-1111-1111-111111111111]" in draft.markdown
    assert draft.source_chunks == (
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
    )


def test_generator_falls_back_when_llm_fails() -> None:
    generator = RequirementArtifactGenerator(
        llm_client=_FakeLLM(response_text="{}", should_fail=True)
    )

    draft = generator.generate(turns=_sample_turns(), source_chunks=_sample_chunks())

    assert "ECサイトを作りたい" in draft.markdown
    assert "Target timeline still needs confirmation." in draft.markdown
    assert "[chunk:22222222-2222-2222-2222-222222222222]" in draft.markdown


def test_repository_load_source_chunks_reads_case_related_chunks() -> None:
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = [
        (
            "11111111-1111-1111-1111-111111111111",
            "Chunk A",
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            0,
        )
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
    chunks = repo.load_source_chunks(tenant_id="t1", case_id="c1")

    assert chunks == [
        SourceContextChunk(
            chunk_id="11111111-1111-1111-1111-111111111111",
            content="Chunk A",
            source_document_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            chunk_index=0,
        )
    ]


def test_repository_save_artifact_increments_version() -> None:
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = (2,)
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
        ),
        created_by_uid="worker",
    )

    assert version == 2
    insert_call = mock_cursor.execute.call_args_list[1]
    assert insert_call.args[1][2] == 2
    assert insert_call.args[1][4] == ["11111111-1111-1111-1111-111111111111"]
