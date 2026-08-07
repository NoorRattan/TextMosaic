"""Checkpoint-backed inference using the model's own predicted NER spans."""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any, cast

import torch

from backend.data.dataset import RELATION_LABELS, EntitySpan
from backend.data.vocab import PAD_TOKEN, UNK_TOKEN
from backend.model.architecture import JointNERRE
from backend.model.decoding import decode_bio_tag_ids, split_token_sentences, tokenize_text
from backend.model.tiers import TierConfig, TierName


class CheckpointError(RuntimeError):
    """Raised when a local checkpoint cannot safely reconstruct a model tier."""


class InferenceEngine:
    """A loaded self-trained tier that produces the public extraction schema."""

    def __init__(self, checkpoint_path: Path, device: str = "cpu") -> None:
        self._device = torch.device(device)
        try:
            payload = torch.load(checkpoint_path, map_location=self._device, weights_only=True)
        except (OSError, RuntimeError) as error:
            raise CheckpointError(f"Unable to load checkpoint: {checkpoint_path}") from error
        if not isinstance(payload, dict):
            raise CheckpointError("Checkpoint payload must be a dictionary.")

        raw_tier = payload.get("tier")
        raw_config = payload.get("tier_config")
        raw_vocabulary = payload.get("vocabulary")
        raw_state = payload.get("model_state")
        if (
            raw_tier not in {"speed", "balanced", "accuracy"}
            or not isinstance(raw_config, dict)
            or not isinstance(raw_vocabulary, dict)
            or not isinstance(raw_state, dict)
        ):
            raise CheckpointError("Checkpoint is missing a valid model configuration.")

        try:
            self.tier = cast(TierName, raw_tier)
            tier_config = TierConfig(**raw_config)
            self._vocabulary = {str(token): int(index) for token, index in raw_vocabulary.items()}
            pad_token_id = self._vocabulary[PAD_TOKEN]
            self._unknown_token_id = self._vocabulary[UNK_TOKEN]
        except (KeyError, TypeError, ValueError) as error:
            raise CheckpointError("Checkpoint vocabulary or tier configuration is malformed.") from error

        self._model = JointNERRE(len(self._vocabulary), pad_token_id, tier_config).to(self._device)
        try:
            self._model.load_state_dict(raw_state)
        except RuntimeError as error:
            raise CheckpointError("Checkpoint parameters do not match its model configuration.") from error
        self._model.eval()
        self.metadata: dict[str, Any] = {
            "tier": self.tier,
            "tier_config": asdict(tier_config),
            "metrics": payload.get("metrics", {}),
            "best_epoch": payload.get("best_epoch"),
        }

    def extract(self, text: str) -> dict[str, object]:
        """Extract sentence-scoped relations while preserving document token offsets."""
        tokens = tokenize_text(text)
        if not tokens:
            return {"tokens": [], "entities": [], "relations": []}

        entities: list[dict[str, object]] = []
        relations: list[dict[str, object]] = []
        token_offset = 0
        entity_offset = 0
        for sentence_tokens in split_token_sentences(tokens):
            sentence_entities, sentence_relations = self._extract_sentence(sentence_tokens)
            entities.extend(
                {
                    "type": entity.type,
                    "start": entity.start + token_offset,
                    "end": entity.end + token_offset,
                }
                for entity in sentence_entities
            )
            relations.extend(
                {
                    "type": relation_type,
                    "head": head + entity_offset,
                    "tail": tail + entity_offset,
                }
                for relation_type, head, tail in sentence_relations
            )
            token_offset += len(sentence_tokens)
            entity_offset += len(sentence_entities)

        return {"tokens": tokens, "entities": entities, "relations": relations}

    def _extract_sentence(self, tokens: tuple[str, ...]) -> tuple[tuple[EntitySpan, ...], list[tuple[str, int, int]]]:
        """Run both heads over exactly one sentence's token representations."""

        token_ids = torch.tensor(
            [[self._vocabulary.get(token, self._unknown_token_id) for token in tokens]],
            dtype=torch.long,
            device=self._device,
        )
        lengths = torch.tensor([len(tokens)], dtype=torch.long, device=self._device)
        with torch.no_grad():
            encoded, ner_logits = self._model(token_ids, lengths)
            entities = decode_bio_tag_ids(ner_logits[0].argmax(dim=-1).tolist())
            spans = [(entity.start, entity.end) for entity in entities]
            candidates = [
                (head, tail) for head in range(len(entities)) for tail in range(len(entities)) if head != tail
            ]
            relation_predictions: list[int] = []
            if candidates:
                relation_predictions = (
                    self._model.relation_logits(encoded[0], spans, candidates).argmax(dim=-1).tolist()
                )

        no_relation_id = RELATION_LABELS.index("no_relation")
        relations = [
            (RELATION_LABELS[prediction], head, tail)
            for (head, tail), prediction in zip(candidates, relation_predictions, strict=True)
            if prediction != no_relation_id
        ]
        return entities, relations
