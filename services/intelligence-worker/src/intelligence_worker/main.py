"""Intelligence Worker entrypoint with graceful shutdown."""

from __future__ import annotations

import json
import signal
import sys
import threading
import urllib.error
import urllib.request
from typing import NoReturn

import psycopg2
import structlog
from google.cloud import pubsub_v1
from psycopg2 import errors as psycopg_errors
from psycopg2 import pool as psycopg_pool

from intelligence_worker.completeness_tracker import calculate_completeness
from intelligence_worker.config import load_config
from intelligence_worker.qa_extraction import (
    ConversationTurn,
    QAPair,
    QAPairExtractor,
)
from intelligence_worker.quality_scoring import score_from_llm_output
from intelligence_worker.subscriber import ConversationTurnCompletedSubscriber

logger = structlog.get_logger()

_shutdown_event = threading.Event()


def _handle_signal(signum: int, _frame: object) -> None:
    """Handle termination signals for graceful shutdown.

    Args:
        signum: The signal number received.
        _frame: The current stack frame (unused).
    """
    sig_name = signal.Signals(signum).name
    logger.info("signal_received", signal=sig_name)
    _shutdown_event.set()


class GatewayLLMClient:
    """Best-effort adapter from llm-gateway chat completions to extractor JSON."""

    def __init__(self, base_url: str) -> None:
        self._url = base_url.rstrip("/") + "/v1/chat/completions"

    def extract_structured(
        self, *, prompt: str, response_schema: dict[str, object]
    ) -> str:
        del response_schema
        return self._request(prompt)

    def _request(self, prompt: str) -> str:
        payload = json.dumps(
            {
                "model": "stub",
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            self._url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = json.loads(response.read().decode("utf-8"))
        except (TimeoutError, urllib.error.URLError, json.JSONDecodeError) as exc:
            logger.warning("llm_gateway_request_failed", error=str(exc))
            return json.dumps({"qa_pairs": []}, ensure_ascii=False)

        content = (
            body.get("choices", [{}])[0]
            .get("message", {})
            .get("content", '{"qa_pairs": []}')
        )
        try:
            json.loads(content)
            return content
        except json.JSONDecodeError:
            logger.info("llm_gateway_returned_non_json_stub")
            return json.dumps({"qa_pairs": []}, ensure_ascii=False)


class LoggingDeadLetterPublisher:
    """DLQ placeholder until dedicated topic wiring is added."""

    def publish(self, *, reason: str, payload: dict[str, object]) -> None:
        logger.warning("qa_extraction_dlq", reason=reason, payload=payload)


class PostgresQAPairRepository:
    """Persist extracted QA pairs with derived quality scores."""

    def __init__(self, pool: psycopg_pool.SimpleConnectionPool) -> None:
        self._pool = pool

    def save_qa_pairs(
        self,
        *,
        tenant_id: str,
        case_id: str,
        session_id: str,
        pairs: list[QAPair],
    ) -> None:
        if not pairs:
            return
        self._save_sync(
            tenant_id,
            case_id,
            session_id,
            pairs,
        )

    def _save_sync(
        self,
        tenant_id: str,
        case_id: str,
        session_id: str,
        pairs: list[QAPair],
    ) -> None:
        del case_id
        conn: psycopg2.extensions.connection | None = None
        try:
            conn = self._pool.getconn()
            with conn, conn.cursor() as cur:
                for pair in pairs:
                    completeness = calculate_completeness(pair.source_domain, set())
                    score = score_from_llm_output(
                        {
                            "confidence": pair.confidence,
                            "completeness": completeness.completeness,
                            "coherence": pair.confidence,
                            "rationale": "derived from conversation.turn.completed",
                        }
                    )
                    cur.execute(
                        """
                        INSERT INTO qa_pairs (
                            tenant_id,
                            session_id,
                            turn_range,
                            question_text,
                            answer_text,
                            source_domain,
                            training_eligible,
                            confidence,
                            completeness,
                            coherence
                        )
                        VALUES (
                            %s, %s, int4range(%s, %s, '[]'), %s, %s,
                            %s, false, %s, %s, %s
                        )
                        """,
                        (
                            tenant_id,
                            session_id,
                            pair.turn_range[0],
                            pair.turn_range[1],
                            pair.question_text,
                            pair.answer_text,
                            pair.source_domain,
                            score.confidence,
                            score.completeness,
                            score.coherence,
                        ),
                    )
        except psycopg_errors.UndefinedTable:
            logger.warning("qa_pairs_table_missing_skip_persist")
        finally:
            if conn is not None:
                self._pool.putconn(conn)


class ConversationTurnRepository:
    """Load conversation turns for extraction."""

    def __init__(self, pool: psycopg_pool.SimpleConnectionPool) -> None:
        self._pool = pool

    def load_turns(self, *, tenant_id: str, case_id: str) -> list[ConversationTurn]:
        return self._load_sync(tenant_id, case_id)

    def _load_sync(self, tenant_id: str, case_id: str) -> list[ConversationTurn]:
        conn = self._pool.getconn()
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT role, content
                    FROM conversation_turns
                    WHERE tenant_id = %s AND case_id = %s
                    ORDER BY created_at ASC, id ASC
                    """,
                    (tenant_id, case_id),
                )
                return [
                    ConversationTurn(
                        role=role,
                        content=content,
                        turn_number=index,
                    )
                    for index, (role, content) in enumerate(cur.fetchall(), start=1)
                ]
        finally:
            self._pool.putconn(conn)


class TurnCompletedHandler:
    """Sync Pub/Sub callback for the QA pipeline."""

    def __init__(
        self,
        *,
        conversation_repo: ConversationTurnRepository,
        extractor: QAPairExtractor,
    ) -> None:
        self._conversation_repo = conversation_repo
        self._extractor = extractor

    def __call__(self, payload: dict[str, object]) -> None:
        self._handle(payload)

    def _handle(self, payload: dict[str, object]) -> None:
        tenant_id = str(payload.get("tenant_id") or "")
        envelope_payload = payload.get("payload")
        if not isinstance(envelope_payload, dict):
            logger.warning("turn_completed_missing_payload")
            return

        session_id = str(
            envelope_payload.get("session_id") or payload.get("aggregate_id") or ""
        )
        source_domain = str(payload.get("source_domain") or "estimation")
        if not tenant_id or not session_id:
            logger.warning(
                "turn_completed_missing_ids",
                tenant_id=tenant_id,
                session_id=session_id,
            )
            return

        turns = self._conversation_repo.load_turns(
            tenant_id=tenant_id,
            case_id=session_id,
        )
        if not turns:
            logger.info("turn_completed_no_turns", session_id=session_id)
            return

        self._extractor.extract_and_persist(
            tenant_id=tenant_id,
            case_id=session_id,
            session_id=session_id,
            source_domain=source_domain,
            turns=turns,
        )


def run() -> None:
    """Start the worker runtime and block until shutdown."""
    config = load_config()
    pool = psycopg_pool.SimpleConnectionPool(1, 5, dsn=config.database_url)
    llm_client = GatewayLLMClient(config.llm_gateway_url)
    repository = PostgresQAPairRepository(pool)
    conversation_repo = ConversationTurnRepository(pool)
    extractor = QAPairExtractor(
        llm_client=llm_client,
        repository=repository,
        dead_letter_publisher=LoggingDeadLetterPublisher(),
    )
    subscriber_client = pubsub_v1.SubscriberClient()
    subscriber = ConversationTurnCompletedSubscriber(
        client=subscriber_client,
        project_id=config.pubsub_project_id,
        subscription_id=config.pubsub_subscription,
        handler=TurnCompletedHandler(
            conversation_repo=conversation_repo,
            extractor=extractor,
        ),
    )

    future = subscriber.start()
    logger.info(
        "subscriber_started",
        project_id=config.pubsub_project_id,
        subscription=config.pubsub_subscription,
    )

    try:
        _shutdown_event.wait()
    finally:
        future.cancel()
        subscriber_client.close()
        pool.closeall()


def main() -> NoReturn:
    """Start the intelligence worker and block until shutdown signal."""
    structlog.configure(
        processors=[
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.add_log_level,
            structlog.dev.ConsoleRenderer(),
        ],
    )

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    logger.info("intelligence-worker starting")

    run()

    logger.info("intelligence-worker shutting down")
    sys.exit(0)


if __name__ == "__main__":
    main()
