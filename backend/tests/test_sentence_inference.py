"""Regression coverage for sentence-scoped relation extraction."""

from __future__ import annotations

from backend.data.dataset import EntitySpan
from backend.model.inference import InferenceEngine


def test_extract_offsets_sentence_local_relations_without_cross_sentence_pairs() -> None:
    """Each sentence gets its own candidates before their offsets are merged."""
    engine = object.__new__(InferenceEngine)
    calls: list[tuple[str, ...]] = []

    def extract_sentence(tokens: tuple[str, ...]) -> tuple[tuple[EntitySpan, ...], list[tuple[str, int, int]]]:
        calls.append(tokens)
        return (
            (
                EntitySpan("Peop", 0, 1),
                EntitySpan("Org", len(tokens) - 2, len(tokens) - 1),
            ),
            [("Work_For", 0, 1)],
        )

    engine._extract_sentence = extract_sentence  # type: ignore[method-assign]

    result = engine.extract("Ada joined Acme. Noor leads TextMosaic.")

    assert calls == [
        ("Ada", "joined", "Acme", "."),
        ("Noor", "leads", "TextMosaic", "."),
    ]
    assert result["relations"] == [
        {"type": "Work_For", "head": 0, "tail": 1},
        {"type": "Work_For", "head": 2, "tail": 3},
    ]
