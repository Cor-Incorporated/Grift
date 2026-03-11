"""Extractor plugin interfaces and built-in implementations."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Protocol


@dataclass(frozen=True)
class ConversationTurn:
    """Single turn in a conversation transcript."""

    role: str
    content: str
    turn_number: int


@dataclass(frozen=True)
class QAPair:
    """Question/answer pair extracted from conversation turns."""

    question_text: str
    answer_text: str
    turn_range: tuple[int, int]
    source_domain: str


class Extractor(Protocol):
    """Plugin contract for domain-specific QA extraction."""

    name: str

    def extract(self, turns: list[ConversationTurn]) -> list[QAPair]:
        """Extract QA pairs from conversation turns."""


class EstimationExtractor:
    """Extractor for estimate/budget related discussions."""

    name = "estimation"
    _QUESTION_HINT = re.compile(r"(見積|見積もり|予算|金額|費用)")

    def extract(self, turns: list[ConversationTurn]) -> list[QAPair]:
        pairs: list[QAPair] = []
        for idx, turn in enumerate(turns):
            if turn.role != "user":
                continue
            if not self._QUESTION_HINT.search(turn.content):
                continue

            answer_turn = self._find_next_assistant_turn(turns, start_index=idx + 1)
            if answer_turn is None:
                continue

            pairs.append(
                QAPair(
                    question_text=turn.content,
                    answer_text=answer_turn.content,
                    turn_range=(turn.turn_number, answer_turn.turn_number),
                    source_domain=self.name,
                )
            )
        return pairs

    @staticmethod
    def _find_next_assistant_turn(
        turns: list[ConversationTurn], *, start_index: int
    ) -> ConversationTurn | None:
        for turn in turns[start_index:]:
            if turn.role == "assistant":
                return turn
        return None


ExtractorFactory = Callable[[], Extractor]


class ExtractorRegistry:
    """Configuration-based extractor registration and discovery."""

    def __init__(self, factories: dict[str, ExtractorFactory] | None = None) -> None:
        self._factories: dict[str, ExtractorFactory] = dict(factories or {})

    def register(self, name: str, factory: ExtractorFactory) -> None:
        self._factories[name] = factory

    def create(self, name: str) -> Extractor:
        try:
            return self._factories[name]()
        except KeyError as exc:
            raise KeyError(f"Extractor not registered: {name}") from exc

    def discover(self, names: list[str]) -> dict[str, Extractor]:
        return {name: self.create(name) for name in names}


DEFAULT_EXTRACTOR_FACTORIES: dict[str, ExtractorFactory] = {
    "estimation": EstimationExtractor,
}


def discover_extractors(names: list[str]) -> dict[str, Extractor]:
    """Load extractors from configured plugin names."""
    registry = ExtractorRegistry(DEFAULT_EXTRACTOR_FACTORIES)
    return registry.discover(names)
