"""Sentence-boundary regression coverage for local inference tokenization."""

from __future__ import annotations

from backend.model.decoding import split_token_sentences, tokenize_text


def test_sentence_split_preserves_token_order_and_abbreviations() -> None:
    tokens = tokenize_text("Ada joined Acme. U.S. reporters followed! Dr. Noor agreed.")

    assert split_token_sentences(tokens) == (
        ("Ada", "joined", "Acme", "."),
        ("U.S.", "reporters", "followed", "!"),
        ("Dr", ".", "Noor", "agreed", "."),
    )
