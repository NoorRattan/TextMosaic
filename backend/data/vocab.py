"""Training-split token vocabulary construction without pretrained embeddings."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Final


# These IDs are a local batching convention, not a requirement imposed by File 00.
PAD_TOKEN: Final[str] = "<PAD>"
UNK_TOKEN: Final[str] = "<UNK>"


def build_vocab(train_tokens: Iterable[Sequence[str]]) -> dict[str, int]:
    """Assign token IDs from the training split only, preserving first-seen order."""
    vocabulary: dict[str, int] = {PAD_TOKEN: 0, UNK_TOKEN: 1}
    for sentence in train_tokens:
        for token in sentence:
            if token not in vocabulary:
                vocabulary[token] = len(vocabulary)
    return vocabulary
