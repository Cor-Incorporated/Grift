"""Intelligence Worker entrypoint with graceful shutdown."""

from __future__ import annotations

import json
import signal
import sys
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, NoReturn, Protocol

import structlog
from google.cloud import pubsub_v1
from psycopg2 import errors as psycopg_errors

from intelligence_worker.classification import (
    ControlAPICaseTypeClient,
    GatewayIntentClassifier,
    GatewayMissingInfoExtractor,
    IntentClassifier,
    MissingInfoExtractor,
    MissingInfoResult,
)
from intelligence_worker.classification.missing_info import (
    DEFAULT_QWEN_MODEL as _MISSING_INFO_DEFAULT_MODEL,
)
from intelligence_worker.completeness_tracker import (
    CompletenessTrackingRepository,
    build_tracking_snapshot,
    calculate_completeness,
    infer_collected_items_from_texts,
    infer_item_coverage_from_pairs,
)
from intelligence_worker.config import load_config
from intelligence_worker.db import RLSConnectionManager
from intelligence_worker.dead_letter_events import (
    DatabaseDeadLetterPublisher,
    DeadLetterEventStore,
    DeadLetterRetryLoop,
    DeadLetterRetryProcessor,
)
from intelligence_worker.observation_events import CompletenessUpdatedPublisher
from intelligence_worker.qa_extraction import (
    ConversationTurn,
    QAPair,
    QAPairExtractor,
)
from intelligence_worker.quality_scoring import score_from_llm_output
from intelligence_worker.requirement_artifacts import (
    CompletenessUpdatedRequirementArtifactHandler,
    RequirementArtifactGenerator,
    RequirementArtifactRepository,
    RequirementArtifactService,
)
from intelligence_worker.subscriber import EventSubscriber

logger = structlog.get_logger()

_shutdown_event = threading.Event()


def _handle_signal(signum: int, _frame: object) -> None:
    """Handle termination signals for graceful shutdown."""
    sig_name = signal.Signals(signum).name
    logger.info("signal_received", signal=sig_name)
    _shutdown_event.set()


class GatewayLLMClient:
    """Best-effort adapter from llm-gateway chat completions to extractor JSON."""

    def __init__(self, base_url: str, *, model: str = "qwen3.5-7b") -> None:
        self._url = base_url.rstrip("/") + "/v1/chat/completions"
        self._model = model

    def extract_structured(
        self,
        *,
        prompt: str,
        response_schema: dict[str, object],
        system_prompt: str | None = None,
    ) -> str:
        schema_json = json.dumps(response_schema, ensure_ascii=False)
        system_parts = []
        if system_prompt:
            system_parts.append(system_prompt)
        system_parts.append(
            f"Return a JSON object conforming to this schema: {schema_json}"
        )
        system_msg = "\n\n".join(system_parts)
        return self._request(prompt, system_message=system_msg)

    def _request(self, prompt: str, system_message: str | None = None) -> str:
        messages: list[dict[str, str]] = []
        if system_message:
            messages.append({"role": "system", "content": system_message})
        messages.append({"role": "user", "content": prompt})
        payload = json.dumps(
            {
                "model": self._model,
                "messages": messages,
                "stream": False,
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            self._url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "X-Data-Classification": "restricted",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = json.loads(response.read().decode("utf-8"))
        except (TimeoutError, urllib.error.URLError, json.JSONDecodeError) as exc:
            logger.warning("llm_gateway_request_failed", error=str(exc))
            raise RuntimeError("llm gateway request failed") from exc

        choices = body.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ValueError("llm gateway response missing choices")

        content = choices[0].get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("llm gateway response missing message content")

        try:
            json.loads(content)
        except json.JSONDecodeError as exc:
            raise ValueError("llm gateway response was not valid JSON") from exc
        return content


class LoggingDeadLetterPublisher:
    """Logging-only dead letter publisher for fallback scenarios."""

    def publish(self, *, reason: str, payload: dict[str, object]) -> None:
        logger.warning("qa_extraction_dlq", reason=reason, payload=payload)


class PostgresQAPairRepository:
    """Persist extracted QA pairs with derived quality scores."""

    def __init__(self, conn_manager: RLSConnectionManager) -> None:
        self._conn_manager = conn_manager

    def save_qa_pairs(
        self,
        *,
        tenant_id: str,
        case_id: str,
        session_id: str,
        pairs: list[QAPair],
    ) -> None:
        del case_id
        if not pairs:
            return
        try:
            with (
                self._conn_manager.get_connection(tenant_id) as conn,
                conn,
                conn.cursor() as cur,
            ):
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


class ConversationTurnRepository:
    """Load conversation turns for extraction."""

    def __init__(self, conn_manager: RLSConnectionManager) -> None:
        self._conn_manager = conn_manager

    def load_turns(self, *, tenant_id: str, case_id: str) -> list[ConversationTurn]:
        with (
            self._conn_manager.get_connection(tenant_id) as conn,
            conn,
            conn.cursor() as cur,
        ):
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


@dataclass(frozen=True)
class TurnCompletedContext:
    """Normalized event context for a conversation.turn.completed message."""

    tenant_id: str
    session_id: str
    source_domain: str
    payload: dict[str, Any]
    turns: list[ConversationTurn]


class CaseTypeSyncClient(Protocol):
    """PATCH cases.type contract."""

    def patch_case_type(self, *, tenant_id: str, case_id: str, intent: str) -> str: ...


def _build_raw_text(turns: list[ConversationTurn], *, user_only: bool = False) -> str:
    """Join turn contents into a single text block.

    Args:
        turns: Conversation turns to combine.
        user_only: If True, include only user-role turns; falls back to
            all turns when user-only yields an empty string.

    Returns:
        Combined text, or empty string when no content is available.
    """
    if user_only:
        text = "\n".join(
            turn.content.strip()
            for turn in turns
            if turn.role == "user" and turn.content.strip()
        )
        if text:
            return text
    return "\n".join(turn.content.strip() for turn in turns if turn.content.strip())


class TurnCompletedHandler:
    """Sync Pub/Sub callback for the QA pipeline."""

    def __init__(
        self,
        *,
        conversation_repo: ConversationTurnRepository,
        extractor: QAPairExtractor,
        intent_classifier: IntentClassifier | None = None,
        case_type_client: CaseTypeSyncClient | None = None,
        missing_info_extractor: MissingInfoExtractor | None = None,
        completeness_repository: CompletenessTrackingRepository | None = None,
        completeness_event_publisher: CompletenessUpdatedPublisher | None = None,
        retry_processor: DeadLetterRetryProcessor | None = None,
    ) -> None:
        self._conversation_repo = conversation_repo
        self._extractor = extractor
        self._intent_classifier = intent_classifier
        self._case_type_client = case_type_client
        self._missing_info_extractor = missing_info_extractor
        self._completeness_repository = completeness_repository
        self._completeness_event_publisher = completeness_event_publisher
        self._retry_processor = retry_processor

    def __call__(self, payload: dict[str, object]) -> None:
        context = self._load_context(payload)
        if context is None:
            return

        if self._retry_processor is not None:
            self._retry_processor.run_once(tenant_id=context.tenant_id)

        classification_result = self._classify_case_type(context)
        # TODO: persist/publish missing_info_result once downstream consumer is ready
        # TODO: add missing_info_extraction_enabled config flag to gate this step
        self._extract_missing_info(context, intent=classification_result)
        pairs = self._extract_current_turn(context, raise_on_failure=False)
        self._persist_completeness(context, pairs)

    def retry_dead_letter(self, payload: dict[str, Any]) -> None:
        context = self._load_context(payload)
        if context is None:
            return
        self._extract_current_turn(context, raise_on_failure=True)

    def set_retry_processor(self, retry_processor: DeadLetterRetryProcessor) -> None:
        """Attach a retry processor after handler construction."""
        self._retry_processor = retry_processor

    def _load_context(self, payload: dict[str, object]) -> TurnCompletedContext | None:
        tenant_id = str(payload.get("tenant_id") or "")
        envelope_payload = payload.get("payload")
        if not isinstance(envelope_payload, dict):
            logger.warning("turn_completed_missing_payload")
            return None

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
            return None

        turns = self._conversation_repo.load_turns(
            tenant_id=tenant_id,
            case_id=session_id,
        )
        if not turns:
            logger.info("turn_completed_no_turns", session_id=session_id)
            return None

        return TurnCompletedContext(
            tenant_id=tenant_id,
            session_id=session_id,
            source_domain=source_domain,
            payload=dict(payload),
            turns=turns,
        )

    def _classify_case_type(self, context: TurnCompletedContext) -> str | None:
        """Classify the intent and sync case type to control API.

        Args:
            context: Normalized event context.

        Returns:
            The classified intent label, or None if classification skipped.
        """
        intent = self._classify_intent(context)
        if intent is not None:
            self._sync_case_type(context, intent=intent)
        return intent

    def _classify_intent(self, context: TurnCompletedContext) -> str | None:
        """Run intent classification on conversation turns.

        Args:
            context: Normalized event context.

        Returns:
            The classified intent label, or None if classifier is unavailable.
        """
        if self._intent_classifier is None:
            return None

        raw_text = _build_raw_text(context.turns, user_only=True)
        if not raw_text:
            return None

        result = self._intent_classifier.classify(raw_text)
        return result.intent

    def _sync_case_type(self, context: TurnCompletedContext, *, intent: str) -> None:
        """Sync classified intent to control API as case type.

        Args:
            context: Normalized event context.
            intent: Classified intent label to sync.
        """
        if self._case_type_client is None:
            return

        try:
            patched_type = self._case_type_client.patch_case_type(
                tenant_id=context.tenant_id,
                case_id=context.session_id,
                intent=intent,
            )
            logger.info(
                "case_type_synced",
                case_id=context.session_id,
                tenant_id=context.tenant_id,
                intent=intent,
                case_type=patched_type,
                confidence="n/a",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "case_type_sync_failed",
                case_id=context.session_id,
                tenant_id=context.tenant_id,
                intent=intent,
                error=str(exc),
            )

    def _extract_missing_info(
        self,
        context: TurnCompletedContext,
        *,
        intent: str | None,
    ) -> MissingInfoResult | None:
        """Run missing info extraction after intent classification.

        Args:
            context: Normalized event context.
            intent: Classified intent label from the prior step.

        Returns:
            Extraction result, or None if skipped or failed.
        """
        if self._missing_info_extractor is None:
            return None

        raw_text = _build_raw_text(context.turns)
        if not raw_text:
            return None

        try:
            result = self._missing_info_extractor.extract_missing(
                raw_text, intent=intent
            )
            logger.info(
                "missing_info_extracted",
                case_id=context.session_id,
                tenant_id=context.tenant_id,
                missing_count=len(result.missing_topics),
                confidence=result.confidence,
                intent=intent,
            )
            return result
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "missing_info_extraction_failed",
                case_id=context.session_id,
                tenant_id=context.tenant_id,
                error=str(exc),
            )
            return None

    def _extract_current_turn(
        self,
        context: TurnCompletedContext,
        *,
        raise_on_failure: bool,
    ) -> list[QAPair]:
        dead_letter_context = dict(context.payload)
        dead_letter_context.update(
            {
                "tenant_id": context.tenant_id,
                "case_id": context.session_id,
                "session_id": context.session_id,
                "source_domain": context.source_domain,
                "event_type": str(
                    context.payload.get("event_type")
                    or context.payload.get("event_name")
                    or "conversation.turn.completed"
                ),
                "event_id": str(
                    context.payload.get("event_id")
                    or context.payload.get("id")
                    or context.payload.get("idempotency_key")
                    or (
                        f"{context.session_id}:"
                        f"{context.payload.get('aggregate_version') or ''}"
                    )
                ),
                "original_payload": context.payload,
            }
        )
        return self._extractor.extract_and_persist(
            tenant_id=context.tenant_id,
            case_id=context.session_id,
            session_id=context.session_id,
            source_domain=context.source_domain,
            turns=context.turns,
            dead_letter_context=dead_letter_context,
            re_raise_errors=raise_on_failure,
        )

    def _persist_completeness(
        self,
        context: TurnCompletedContext,
        pairs: list[QAPair],
    ) -> None:
        if self._completeness_repository is None:
            return
        try:
            collected_items, partial_items = infer_item_coverage_from_pairs(
                context.source_domain,
                pairs,
            )
            if not collected_items and not partial_items:
                source_texts = [
                    turn.content for turn in context.turns if turn.role == "user"
                ]
                if not source_texts:
                    source_texts = [turn.content for turn in context.turns]
                collected_items = infer_collected_items_from_texts(
                    context.source_domain,
                    source_texts,
                )
            snapshot = build_tracking_snapshot(
                domain=context.source_domain,
                collected_items=collected_items,
                turn_count=len(context.turns),
                partial_items=partial_items,
            )
            self._completeness_repository.save_snapshot(
                tenant_id=context.tenant_id,
                session_id=context.session_id,
                snapshot=snapshot,
            )
            if self._completeness_event_publisher is not None:
                try:
                    self._completeness_event_publisher.publish_snapshot(
                        tenant_id=context.tenant_id,
                        session_id=context.session_id,
                        source_domain=context.source_domain,
                        aggregate_version=len(context.turns),
                        snapshot=snapshot,
                        causation_id=str(context.payload.get("event_id") or "") or None,
                        correlation_id=str(context.payload.get("correlation_id") or "")
                        or None,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "completeness_event_publish_failed",
                        tenant_id=context.tenant_id,
                        case_id=context.session_id,
                        error=str(exc),
                    )
        except ValueError:
            logger.info(
                "completeness_tracking_skipped_for_domain",
                source_domain=context.source_domain,
            )


def run() -> None:
    """Start the worker runtime and block until shutdown."""
    config = load_config()
    conn_manager = RLSConnectionManager(
        dsn=config.database_url,
        min_conn=config.db_pool_min,
        max_conn=config.db_pool_max,
    )
    llm_client = GatewayLLMClient(
        config.llm_gateway_url,
        model=config.structured_output_model,
    )
    repository = PostgresQAPairRepository(conn_manager)
    conversation_repo = ConversationTurnRepository(conn_manager)
    completeness_repository = CompletenessTrackingRepository(conn_manager)
    artifact_repository = RequirementArtifactRepository(conn_manager)
    artifact_generator = RequirementArtifactGenerator(llm_client=llm_client)
    publisher_client = pubsub_v1.PublisherClient()
    completeness_publisher = CompletenessUpdatedPublisher(
        client=publisher_client,
        project_id=config.pubsub_project_id,
        topic_id=config.pubsub_topic,
    )
    artifact_service = RequirementArtifactService(
        conversation_repository=conversation_repo,
        artifact_repository=artifact_repository,
        artifact_generator=artifact_generator,
    )
    dead_letter_store = DeadLetterEventStore(
        conn_manager,
        max_retries=config.dead_letter_max_retries,
    )
    handler = TurnCompletedHandler(
        conversation_repo=conversation_repo,
        extractor=QAPairExtractor(
            llm_client=llm_client,
            repository=repository,
            dead_letter_publisher=DatabaseDeadLetterPublisher(dead_letter_store),
        ),
        intent_classifier=IntentClassifier(
            gateway_client=GatewayIntentClassifier(
                base_url=config.llm_gateway_url,
                model=config.intent_classifier_model,
            )
        ),
        # TODO: missing_info may need a separate config field if models diverge
        #       from intent classification.
        missing_info_extractor=MissingInfoExtractor(
            gateway_client=(
                GatewayMissingInfoExtractor(
                    base_url=config.llm_gateway_url,
                    model=config.intent_classifier_model or _MISSING_INFO_DEFAULT_MODEL,
                )
                if config.llm_gateway_url
                else None
            )
        ),
        case_type_client=ControlAPICaseTypeClient(
            base_url=config.control_api_url,
            bearer_token=config.control_api_token,
        ),
        completeness_repository=completeness_repository,
        completeness_event_publisher=completeness_publisher,
    )
    completeness_handler = CompletenessUpdatedRequirementArtifactHandler(
        service=artifact_service,
    )
    retry_processor = DeadLetterRetryProcessor(
        store=dead_letter_store,
        retry_handler=handler.retry_dead_letter,
    )
    handler.set_retry_processor(retry_processor)
    retry_loop = DeadLetterRetryLoop(
        processor=retry_processor,
    )
    retry_thread = threading.Thread(
        target=retry_loop.run,
        args=(_shutdown_event,),
        name="dead-letter-retry-loop",
        daemon=True,
    )
    retry_thread.start()

    subscriber_client = pubsub_v1.SubscriberClient()
    subscriber = EventSubscriber(
        client=subscriber_client,
        project_id=config.pubsub_project_id,
        subscription_id=config.pubsub_subscription,
        handlers={
            # Both event types currently share one subscription because
            # observation.completeness.updated is re-published onto the same
            # Pub/Sub stream that also carries conversation.turn.completed.
            # That self-trigger pattern is intentional for now, but we should
            # consider splitting subscriptions if routing or replay semantics
            # become harder to reason about.
            "conversation.turn.completed": handler,
            "observation.completeness.updated": completeness_handler,
        },
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
        retry_thread.join(timeout=1)
        subscriber_client.close()
        publisher_client.close()
        conn_manager.close_all()


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
