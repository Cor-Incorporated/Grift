"""Tests for intelligence_worker.main module."""

from __future__ import annotations

import json
import signal
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from intelligence_worker.main import (
    ConversationTurnRepository,
    GatewayLLMClient,
    LoggingDeadLetterPublisher,
    PostgresQAPairRepository,
    TurnCompletedHandler,
    _handle_signal,
    _shutdown_event,
)
from intelligence_worker.qa_extraction import ConversationTurn, QAPair

# ---------------------------------------------------------------------------
# _handle_signal
# ---------------------------------------------------------------------------


class TestHandleSignal:
    """Tests for the signal handler function."""

    def setup_method(self) -> None:
        _shutdown_event.clear()

    def test_sets_shutdown_event_on_sigint(self) -> None:
        """SIGINT triggers the shutdown event."""
        _handle_signal(signal.SIGINT, None)
        assert _shutdown_event.is_set()

    def test_sets_shutdown_event_on_sigterm(self) -> None:
        """SIGTERM triggers the shutdown event."""
        _shutdown_event.clear()
        _handle_signal(signal.SIGTERM, None)
        assert _shutdown_event.is_set()


# ---------------------------------------------------------------------------
# GatewayLLMClient
# ---------------------------------------------------------------------------


class TestGatewayLLMClient:
    """Tests for the LLM gateway HTTP adapter."""

    def test_url_construction_strips_trailing_slash(self) -> None:
        """Base URL trailing slash is normalised before appending path."""
        client = GatewayLLMClient("http://gw:8081/")
        assert client._url == "http://gw:8081/v1/chat/completions"

    def test_extract_structured_delegates_to_request(self) -> None:
        """extract_structured calls _request with the prompt."""
        client = GatewayLLMClient("http://gw:8081")
        with patch.object(client, "_request", return_value='{"qa_pairs":[]}') as m:
            result = client.extract_structured(
                prompt="test prompt",
                response_schema={"type": "object"},
            )
        m.assert_called_once_with("test prompt")
        assert result == '{"qa_pairs":[]}'

    def test_request_returns_content_on_success(self) -> None:
        """Valid gateway response returns message content."""
        client = GatewayLLMClient("http://gw:8081")
        response_body = json.dumps(
            {"choices": [{"message": {"content": '{"qa_pairs":[{"q":"a"}]}'}}]}
        ).encode("utf-8")

        fake_response = MagicMock()
        fake_response.read.return_value = response_body
        fake_response.__enter__ = MagicMock(return_value=fake_response)
        fake_response.__exit__ = MagicMock(return_value=False)

        with patch(
            "intelligence_worker.main.urllib.request.urlopen",
            return_value=fake_response,
        ):
            result = client._request("prompt")

        assert json.loads(result) == {"qa_pairs": [{"q": "a"}]}

    def test_request_returns_fallback_on_timeout(self) -> None:
        """Timeout returns empty qa_pairs fallback JSON."""
        client = GatewayLLMClient("http://gw:8081")
        with patch(
            "intelligence_worker.main.urllib.request.urlopen",
            side_effect=TimeoutError("connection timed out"),
        ):
            result = client._request("prompt")

        assert json.loads(result) == {"qa_pairs": []}

    def test_request_returns_fallback_on_url_error(self) -> None:
        """URLError returns empty qa_pairs fallback JSON."""
        import urllib.error

        client = GatewayLLMClient("http://gw:8081")
        with patch(
            "intelligence_worker.main.urllib.request.urlopen",
            side_effect=urllib.error.URLError("unreachable"),
        ):
            result = client._request("prompt")

        assert json.loads(result) == {"qa_pairs": []}

    def test_request_returns_fallback_on_non_json_content(self) -> None:
        """Non-JSON content from gateway returns fallback."""
        client = GatewayLLMClient("http://gw:8081")
        response_body = json.dumps(
            {"choices": [{"message": {"content": "this is not json"}}]}
        ).encode("utf-8")

        fake_response = MagicMock()
        fake_response.read.return_value = response_body
        fake_response.__enter__ = MagicMock(return_value=fake_response)
        fake_response.__exit__ = MagicMock(return_value=False)

        with patch(
            "intelligence_worker.main.urllib.request.urlopen",
            return_value=fake_response,
        ):
            result = client._request("prompt")

        assert json.loads(result) == {"qa_pairs": []}

    def test_request_raises_on_empty_choices(self) -> None:
        """Empty choices array raises IndexError (unhandled edge case)."""
        client = GatewayLLMClient("http://gw:8081")
        response_body = json.dumps({"choices": []}).encode("utf-8")

        fake_response = MagicMock()
        fake_response.read.return_value = response_body
        fake_response.__enter__ = MagicMock(return_value=fake_response)
        fake_response.__exit__ = MagicMock(return_value=False)

        with (
            patch(
                "intelligence_worker.main.urllib.request.urlopen",
                return_value=fake_response,
            ),
            pytest.raises(IndexError),
        ):
            client._request("prompt")

    def test_request_returns_fallback_on_json_decode_error(self) -> None:
        """Malformed JSON response body returns fallback."""
        client = GatewayLLMClient("http://gw:8081")

        fake_response = MagicMock()
        fake_response.read.return_value = b"not-json-at-all"
        fake_response.__enter__ = MagicMock(return_value=fake_response)
        fake_response.__exit__ = MagicMock(return_value=False)

        with patch(
            "intelligence_worker.main.urllib.request.urlopen",
            return_value=fake_response,
        ):
            result = client._request("prompt")

        assert json.loads(result) == {"qa_pairs": []}


# ---------------------------------------------------------------------------
# LoggingDeadLetterPublisher
# ---------------------------------------------------------------------------


class TestLoggingDeadLetterPublisher:
    """Tests for the DLQ logging placeholder."""

    def test_publish_logs_without_raising(self) -> None:
        """publish does not raise and accepts arbitrary payloads."""
        publisher = LoggingDeadLetterPublisher()
        publisher.publish(reason="test_reason", payload={"key": "value"})

    def test_publish_with_empty_payload(self) -> None:
        """Empty payload is accepted without error."""
        publisher = LoggingDeadLetterPublisher()
        publisher.publish(reason="empty", payload={})


# ---------------------------------------------------------------------------
# PostgresQAPairRepository
# ---------------------------------------------------------------------------


class TestPostgresQAPairRepository:
    """Tests for QA pair persistence with RLS."""

    def test_save_qa_pairs_skips_empty_list(self) -> None:
        """Empty pairs list short-circuits without DB access."""
        mock_conn_manager = MagicMock()
        repo = PostgresQAPairRepository(mock_conn_manager)

        repo.save_qa_pairs(
            tenant_id="t1",
            case_id="c1",
            session_id="s1",
            pairs=[],
        )

        mock_conn_manager.get_connection.assert_not_called()

    def test_save_qa_pairs_inserts_records(self) -> None:
        """Non-empty pairs trigger INSERT with correct parameters."""
        mock_cursor = MagicMock()
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

        repo = PostgresQAPairRepository(mock_conn_manager)
        pairs = [
            QAPair(
                question_text="Q1",
                answer_text="A1",
                turn_range=[1, 2],
                confidence=0.9,
                source_domain="estimation",
            ),
        ]

        repo.save_qa_pairs(
            tenant_id="t1",
            case_id="c1",
            session_id="s1",
            pairs=pairs,
        )

        assert mock_cursor.execute.called

    def test_save_qa_pairs_handles_undefined_table(self) -> None:
        """UndefinedTable error is caught gracefully."""
        from psycopg2 import errors as psycopg_errors

        mock_conn_manager = MagicMock()
        mock_conn_manager.get_connection.return_value.__enter__ = MagicMock(
            side_effect=psycopg_errors.UndefinedTable("qa_pairs")
        )
        mock_conn_manager.get_connection.return_value.__exit__ = MagicMock(
            return_value=False
        )

        repo = PostgresQAPairRepository(mock_conn_manager)
        pairs = [
            QAPair(
                question_text="Q",
                answer_text="A",
                turn_range=[1, 2],
                confidence=0.5,
                source_domain="estimation",
            ),
        ]

        # Should not raise
        repo.save_qa_pairs(
            tenant_id="t1",
            case_id="c1",
            session_id="s1",
            pairs=pairs,
        )


# ---------------------------------------------------------------------------
# ConversationTurnRepository
# ---------------------------------------------------------------------------


class TestConversationTurnRepository:
    """Tests for conversation turn loading."""

    def test_load_turns_returns_ordered_turns(self) -> None:
        """Turns are returned in DB order with correct numbering."""
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = [
            ("user", "hello"),
            ("assistant", "hi there"),
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

        repo = ConversationTurnRepository(mock_conn_manager)
        turns = repo.load_turns(tenant_id="t1", case_id="c1")

        assert len(turns) == 2
        assert turns[0].role == "user"
        assert turns[0].content == "hello"
        assert turns[0].turn_number == 1
        assert turns[1].role == "assistant"
        assert turns[1].turn_number == 2

    def test_load_turns_returns_empty_list(self) -> None:
        """Empty result set returns empty list."""
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = []
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

        repo = ConversationTurnRepository(mock_conn_manager)
        turns = repo.load_turns(tenant_id="t1", case_id="c1")

        assert turns == []


# ---------------------------------------------------------------------------
# TurnCompletedHandler
# ---------------------------------------------------------------------------


@dataclass
class _FakeConversationRepo:
    turns: list[ConversationTurn] = field(default_factory=list)

    def load_turns(self, *, tenant_id: str, case_id: str) -> list[ConversationTurn]:
        return self.turns


@dataclass
class _FakeExtractorForHandler:
    called_with: list[dict[str, Any]] = field(default_factory=list)

    def extract_and_persist(self, **kwargs: Any) -> list[QAPair]:
        self.called_with.append(kwargs)
        return []


class TestTurnCompletedHandler:
    """Tests for the Pub/Sub event handler."""

    def test_dispatches_to_extractor_on_valid_payload(self) -> None:
        """Valid payload triggers extraction pipeline."""
        turns = [
            ConversationTurn(role="user", content="q", turn_number=1),
            ConversationTurn(role="assistant", content="a", turn_number=2),
        ]
        conv_repo = _FakeConversationRepo(turns=turns)
        extractor = _FakeExtractorForHandler()
        handler = TurnCompletedHandler(
            conversation_repo=conv_repo,
            extractor=extractor,
        )

        handler(
            {
                "tenant_id": "t1",
                "aggregate_id": "s1",
                "source_domain": "estimation",
                "payload": {"session_id": "s1"},
            }
        )

        assert len(extractor.called_with) == 1
        assert extractor.called_with[0]["tenant_id"] == "t1"
        assert extractor.called_with[0]["session_id"] == "s1"

    def test_skips_when_payload_field_missing(self) -> None:
        """Missing envelope payload results in early return."""
        conv_repo = _FakeConversationRepo()
        extractor = _FakeExtractorForHandler()
        handler = TurnCompletedHandler(
            conversation_repo=conv_repo,
            extractor=extractor,
        )

        handler({"tenant_id": "t1"})

        assert extractor.called_with == []

    def test_skips_when_tenant_id_missing(self) -> None:
        """Missing tenant_id results in early return."""
        conv_repo = _FakeConversationRepo()
        extractor = _FakeExtractorForHandler()
        handler = TurnCompletedHandler(
            conversation_repo=conv_repo,
            extractor=extractor,
        )

        handler({"payload": {"session_id": "s1"}})

        assert extractor.called_with == []

    def test_skips_when_session_id_missing(self) -> None:
        """Missing session_id results in early return."""
        conv_repo = _FakeConversationRepo()
        extractor = _FakeExtractorForHandler()
        handler = TurnCompletedHandler(
            conversation_repo=conv_repo,
            extractor=extractor,
        )

        handler({"tenant_id": "t1", "payload": {}})

        assert extractor.called_with == []

    def test_skips_when_no_turns_loaded(self) -> None:
        """Empty turn list results in early return without extraction."""
        conv_repo = _FakeConversationRepo(turns=[])
        extractor = _FakeExtractorForHandler()
        handler = TurnCompletedHandler(
            conversation_repo=conv_repo,
            extractor=extractor,
        )

        handler(
            {
                "tenant_id": "t1",
                "payload": {"session_id": "s1"},
            }
        )

        assert extractor.called_with == []

    def test_uses_aggregate_id_as_session_fallback(self) -> None:
        """aggregate_id is used when session_id is absent from payload."""
        turns = [ConversationTurn(role="user", content="q", turn_number=1)]
        conv_repo = _FakeConversationRepo(turns=turns)
        extractor = _FakeExtractorForHandler()
        handler = TurnCompletedHandler(
            conversation_repo=conv_repo,
            extractor=extractor,
        )

        handler(
            {
                "tenant_id": "t1",
                "aggregate_id": "agg-123",
                "payload": {},
            }
        )

        assert len(extractor.called_with) == 1
        assert extractor.called_with[0]["session_id"] == "agg-123"

    def test_defaults_source_domain_to_estimation(self) -> None:
        """Missing source_domain defaults to 'estimation'."""
        turns = [ConversationTurn(role="user", content="q", turn_number=1)]
        conv_repo = _FakeConversationRepo(turns=turns)
        extractor = _FakeExtractorForHandler()
        handler = TurnCompletedHandler(
            conversation_repo=conv_repo,
            extractor=extractor,
        )

        handler(
            {
                "tenant_id": "t1",
                "payload": {"session_id": "s1"},
            }
        )

        assert extractor.called_with[0]["source_domain"] == "estimation"
