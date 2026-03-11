"""Tests for extractor plugins."""

from __future__ import annotations

import pytest

from intelligence_worker.extractors import (
    ConversationTurn,
    EstimationExtractor,
    ExtractorRegistry,
    QAPair,
    discover_extractors,
)


def test_estimation_extractor_extracts_budget_qa_pair() -> None:
    extractor = EstimationExtractor()
    turns = [
        ConversationTurn(role="user", content="概算見積を教えてください", turn_number=1),
        ConversationTurn(role="assistant", content="概算は120万円です", turn_number=2),
    ]

    pairs = extractor.extract(turns)

    assert pairs == [
        QAPair(
            question_text="概算見積を教えてください",
            answer_text="概算は120万円です",
            turn_range=(1, 2),
            source_domain="estimation",
        )
    ]


def test_estimation_extractor_skips_non_estimation_questions() -> None:
    extractor = EstimationExtractor()
    turns = [
        ConversationTurn(role="user", content="納期はいつですか？", turn_number=1),
        ConversationTurn(role="assistant", content="来月を予定しています", turn_number=2),
    ]

    assert extractor.extract(turns) == []


def test_registry_register_and_create() -> None:
    registry = ExtractorRegistry()
    registry.register("estimation", EstimationExtractor)

    created = registry.create("estimation")

    assert isinstance(created, EstimationExtractor)


def test_discover_extractors_from_config_names() -> None:
    extractors = discover_extractors(["estimation"])
    assert isinstance(extractors["estimation"], EstimationExtractor)


def test_discover_unknown_extractor_raises() -> None:
    with pytest.raises(KeyError, match="Extractor not registered: unknown"):
        discover_extractors(["unknown"])
