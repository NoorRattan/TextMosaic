"""Shared BIO decoding and deterministic text tokenization for model inference."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import cast

from backend.data.dataset import BIO_TAGS, EntitySpan, EntityType

_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9]+(?:[.'-][A-Za-z0-9]+)*|[^\w\s]", re.UNICODE)


def tokenize_text(text: str) -> list[str]:
    """Split user text without fetching a tokenizer or pretrained vocabulary."""
    return _TOKEN_PATTERN.findall(text)


def decode_bio_tag_ids(tag_ids: Sequence[int]) -> tuple[EntitySpan, ...]:
    """Decode greedy BIO predictions, treating malformed I-tags as a new span."""
    entities: list[EntitySpan] = []
    active_type: EntityType | None = None
    active_start = 0
    for index, tag_id in enumerate(tag_ids):
        tag = BIO_TAGS[tag_id]
        if tag == "O":
            if active_type is not None:
                entities.append(EntitySpan(type=active_type, start=active_start, end=index))
                active_type = None
            continue

        prefix, raw_entity_type = tag.split("-", maxsplit=1)
        entity_type = cast(EntityType, raw_entity_type)
        if prefix == "B" or active_type != entity_type:
            if active_type is not None:
                entities.append(EntitySpan(type=active_type, start=active_start, end=index))
            active_type = entity_type
            active_start = index
    if active_type is not None:
        entities.append(EntitySpan(type=active_type, start=active_start, end=len(tag_ids)))
    return tuple(entities)
