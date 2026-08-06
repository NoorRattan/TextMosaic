"""PyTorch Dataset utilities for CoNLL04 BIO labels and gold relation pairs."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final, Literal, Protocol, TypeAlias, cast

from torch.utils.data import Dataset

from backend.data.vocab import UNK_TOKEN

EntityType: TypeAlias = Literal["Peop", "Org", "Loc", "Other"]
RelationLabel: TypeAlias = Literal[
    "Located_In",
    "Work_For",
    "OrgBased_In",
    "Live_In",
    "Kill",
    "no_relation",
]

BIO_TAGS: Final[tuple[str, ...]] = (
    "B-Peop",
    "I-Peop",
    "B-Org",
    "I-Org",
    "B-Loc",
    "I-Loc",
    "B-Other",
    "I-Other",
    "O",
)
BIO_TAG_TO_ID: Final[dict[str, int]] = {tag: index for index, tag in enumerate(BIO_TAGS)}
RELATION_LABELS: Final[tuple[RelationLabel, ...]] = (
    "Located_In",
    "Work_For",
    "OrgBased_In",
    "Live_In",
    "Kill",
    "no_relation",
)
RELATION_TO_ID: Final[dict[RelationLabel, int]] = {label: index for index, label in enumerate(RELATION_LABELS)}


class RecordCollection(Protocol):
    """Minimal interface shared by in-memory records and a Hugging Face split."""

    def __len__(self) -> int:
        """Return the number of sentence records."""

    def __getitem__(self, index: int) -> Mapping[str, object]:
        """Return one record using the documented CoNLL04 schema."""


@dataclass(frozen=True)
class EntitySpan:
    """An end-exclusive entity span over one sentence's token sequence."""

    type: EntityType
    start: int
    end: int


@dataclass(frozen=True)
class GoldEntityPair:
    """One directed, per-sentence candidate pair for relation training."""

    head: int
    tail: int
    head_span: EntitySpan
    tail_span: EntitySpan
    relation_label: RelationLabel
    relation_label_id: int


@dataclass(frozen=True)
class SentenceSample:
    """Model-ready values that preserve all relation pairs within one sentence."""

    tokens: tuple[str, ...]
    token_ids: tuple[int, ...]
    bio_tags: tuple[str, ...]
    bio_tag_ids: tuple[int, ...]
    entities: tuple[EntitySpan, ...]
    relation_pairs: tuple[GoldEntityPair, ...]


def _require_sequence(value: object, field_name: str) -> Sequence[object]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise TypeError(f"{field_name} must be a sequence.")
    return value


def _require_int(value: object, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{field_name} must be an integer.")
    return value


def _parse_entity(value: object, token_count: int, entity_index: int) -> EntitySpan:
    if not isinstance(value, Mapping):
        raise TypeError(f"entities[{entity_index}] must be an object.")

    raw_type = value.get("type")
    if raw_type not in {"Peop", "Org", "Loc", "Other"}:
        raise ValueError(f"entities[{entity_index}].type is not a supported entity type.")

    start = _require_int(value.get("start"), f"entities[{entity_index}].start")
    end = _require_int(value.get("end"), f"entities[{entity_index}].end")
    if start < 0 or end <= start or end > token_count:
        raise ValueError(f"entities[{entity_index}] has an invalid token span.")
    return EntitySpan(type=cast(EntityType, raw_type), start=start, end=end)


def encode_bio_tags(tokens: Sequence[str], entities: Sequence[EntitySpan]) -> tuple[str, ...]:
    """Encode non-overlapping, end-exclusive entity spans into the locked BIO tags."""
    tags = ["O"] * len(tokens)
    for entity_index, entity in enumerate(entities):
        for token_index in range(entity.start, entity.end):
            if tags[token_index] != "O":
                raise ValueError(
                    f"CoNLL04 entity spans must not overlap; entity {entity_index} collides at token {token_index}."
                )
            prefix = "B" if token_index == entity.start else "I"
            tags[token_index] = f"{prefix}-{entity.type}"
    return tuple(tags)


def build_gold_entity_pairs(entities: Sequence[EntitySpan], relations: Sequence[object]) -> tuple[GoldEntityPair, ...]:
    """Enumerate directed non-self gold pairs and label missing edges no_relation."""
    labels_by_pair: dict[tuple[int, int], RelationLabel] = {}
    for relation_index, relation in enumerate(relations):
        if not isinstance(relation, Mapping):
            raise TypeError(f"relations[{relation_index}] must be an object.")

        # head/tail are indices into the entities array — not token indices.
        head = _require_int(relation.get("head"), f"relations[{relation_index}].head")
        tail = _require_int(relation.get("tail"), f"relations[{relation_index}].tail")
        if not 0 <= head < len(entities) or not 0 <= tail < len(entities):
            raise ValueError(f"relations[{relation_index}] references an unknown entity.")
        if head == tail:
            raise ValueError(f"relations[{relation_index}] must not be a self-relation.")

        raw_type = relation.get("type")
        if raw_type not in RELATION_TO_ID or raw_type == "no_relation":
            raise ValueError(f"relations[{relation_index}].type is not a source relation type.")
        pair = (head, tail)
        if pair in labels_by_pair:
            raise ValueError(f"relations[{relation_index}] duplicates directed pair {pair}.")
        labels_by_pair[pair] = cast(RelationLabel, raw_type)

    pairs: list[GoldEntityPair] = []
    for head, head_span in enumerate(entities):
        for tail, tail_span in enumerate(entities):
            if head == tail:
                continue
            relation_label = labels_by_pair.get((head, tail), "no_relation")
            pairs.append(
                GoldEntityPair(
                    head=head,
                    tail=tail,
                    head_span=head_span,
                    tail_span=tail_span,
                    relation_label=relation_label,
                    relation_label_id=RELATION_TO_ID[relation_label],
                )
            )
    return tuple(pairs)


class CoNLL04Dataset(Dataset[SentenceSample]):
    """Expose one sentence at a time for BIO tagging and per-sentence RE training."""

    def __init__(self, records: RecordCollection, vocabulary: Mapping[str, int]) -> None:
        if UNK_TOKEN not in vocabulary:
            raise ValueError(f"Vocabulary must contain {UNK_TOKEN}.")
        self._records = records
        self._vocabulary = dict(vocabulary)
        self._unknown_token_id = vocabulary[UNK_TOKEN]

    def __len__(self) -> int:
        return len(self._records)

    def __getitem__(self, index: int) -> SentenceSample:
        record = self._records[index]
        raw_tokens = _require_sequence(record.get("tokens"), "tokens")
        if not all(isinstance(token, str) for token in raw_tokens):
            raise TypeError("tokens must contain only strings.")
        tokens = tuple(cast(str, token) for token in raw_tokens)

        raw_entities = _require_sequence(record.get("entities"), "entities")
        entities = tuple(
            _parse_entity(entity, len(tokens), entity_index) for entity_index, entity in enumerate(raw_entities)
        )
        bio_tags = encode_bio_tags(tokens, entities)

        raw_relations = _require_sequence(record.get("relations"), "relations")
        relation_pairs = build_gold_entity_pairs(entities, raw_relations)

        return SentenceSample(
            tokens=tokens,
            token_ids=tuple(self._vocabulary.get(token, self._unknown_token_id) for token in tokens),
            bio_tags=bio_tags,
            bio_tag_ids=tuple(BIO_TAG_TO_ID[tag] for tag in bio_tags),
            entities=entities,
            relation_pairs=relation_pairs,
        )
