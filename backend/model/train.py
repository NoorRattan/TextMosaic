"""Train and export the three self-initialized TextMosaic model tiers."""

from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Final

import torch
from torch import Tensor, nn

from backend.config import TEXTMOSAIC_DATA_DIR
from backend.data.conll04_loader import load_conll04
from backend.data.dataset import (
    BIO_TAGS,
    RELATION_LABELS,
    CoNLL04Dataset,
    SentenceSample,
)
from backend.data.vocab import PAD_TOKEN, build_vocab
from backend.model.architecture import JointNERRE
from backend.model.decoding import decode_bio_tag_ids
from backend.model.tiers import TIER_CONFIGS, TierName, get_tier_config

NER_PAD_LABEL: Final[int] = -100
DEFAULT_EPOCHS: Final[int] = 30
DEFAULT_BATCH_SIZE: Final[int] = 16
DEFAULT_LEARNING_RATE: Final[float] = 2e-3
DEFAULT_SEED: Final[int] = 29


@dataclass(frozen=True)
class TrainingSettings:
    """Repeatable settings shared by every tier-training run."""

    epochs: int = DEFAULT_EPOCHS
    batch_size: int = DEFAULT_BATCH_SIZE
    learning_rate: float = DEFAULT_LEARNING_RATE
    seed: int = DEFAULT_SEED
    device: str = "cpu"


@dataclass(frozen=True)
class Batch:
    """A padded NER batch retaining each sentence's independent RE candidates."""

    token_ids: Tensor
    lengths: Tensor
    bio_tag_ids: Tensor
    samples: tuple[SentenceSample, ...]


@dataclass(frozen=True)
class Metrics:
    """Validation metrics with explicit gold-span and end-to-end RE distinctions."""

    ner_entity_f1: float
    gold_span_relation_f1: float
    end_to_end_relation_f1: float

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


def set_seed(seed: int) -> None:
    """Make random initialization and shuffled batches repeatable on CPU."""
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _batches(samples: Sequence[SentenceSample], batch_size: int) -> Iterable[tuple[SentenceSample, ...]]:
    indices = list(range(len(samples)))
    random.shuffle(indices)
    for start in range(0, len(indices), batch_size):
        yield tuple(samples[index] for index in indices[start : start + batch_size])


def collate_samples(samples: Sequence[SentenceSample], pad_token_id: int, device: torch.device) -> Batch:
    """Pad token and BIO sequences while leaving relation pairs sentence-scoped."""
    if not samples:
        raise ValueError("Cannot collate an empty batch.")
    lengths = torch.tensor([len(sample.token_ids) for sample in samples], dtype=torch.long)
    max_length = int(lengths.max().item())
    token_ids = torch.full((len(samples), max_length), pad_token_id, dtype=torch.long)
    bio_tag_ids = torch.full((len(samples), max_length), NER_PAD_LABEL, dtype=torch.long)
    for row, sample in enumerate(samples):
        length = len(sample.token_ids)
        token_ids[row, :length] = torch.tensor(sample.token_ids, dtype=torch.long)
        bio_tag_ids[row, :length] = torch.tensor(sample.bio_tag_ids, dtype=torch.long)
    return Batch(
        token_ids=token_ids.to(device),
        lengths=lengths.to(device),
        bio_tag_ids=bio_tag_ids.to(device),
        samples=tuple(samples),
    )


def _relation_class_weights(samples: Sequence[SentenceSample], device: torch.device) -> Tensor:
    """Use square-root inverse frequency to soften the dominant no_relation class.

    Candidate enumeration remains complete and per-sentence; this only prevents
    the relation cross-entropy from being dominated by the observed negatives.
    """
    counts = Counter(pair.relation_label_id for sample in samples for pair in sample.relation_pairs)
    total = sum(counts.values())
    weights = []
    for label_id in range(len(RELATION_LABELS)):
        count = counts.get(label_id, 0)
        if count == 0:
            weights.append(1.0)
        else:
            weights.append((total / count) ** 0.5)
    mean_weight = sum(weights) / len(weights)
    return torch.tensor([weight / mean_weight for weight in weights], device=device)


def _ner_class_weights(samples: Sequence[SentenceSample], device: torch.device) -> Tensor:
    """Prevent O tokens from overwhelming the token-level NER cross-entropy."""
    counts = Counter(tag_id for sample in samples for tag_id in sample.bio_tag_ids)
    total = sum(counts.values())
    weights = [(total / counts[tag_id]) ** 0.5 if counts.get(tag_id, 0) else 1.0 for tag_id in range(len(BIO_TAGS))]
    mean_weight = sum(weights) / len(weights)
    return torch.tensor([weight / mean_weight for weight in weights], device=device)


def _relation_loss(
    model: JointNERRE,
    encoded: Tensor,
    batch: Batch,
    criterion: nn.CrossEntropyLoss,
) -> Tensor:
    losses: list[Tensor] = []
    for row, sample in enumerate(batch.samples):
        candidates = [(pair.head, pair.tail) for pair in sample.relation_pairs]
        if not candidates:
            continue
        spans = [(entity.start, entity.end) for entity in sample.entities]
        sentence_length = len(sample.tokens)
        logits = model.relation_logits(encoded[row, :sentence_length], spans, candidates)
        labels = torch.tensor(
            [pair.relation_label_id for pair in sample.relation_pairs],
            dtype=torch.long,
            device=encoded.device,
        )
        losses.append(criterion(logits, labels))
    if not losses:
        return encoded.new_zeros(())
    return torch.stack(losses).mean()


def _f1(predicted: Counter[object], expected: Counter[object]) -> float:
    true_positive = sum((predicted & expected).values())
    predicted_total = sum(predicted.values())
    expected_total = sum(expected.values())
    if predicted_total == 0 or expected_total == 0:
        return 0.0
    precision = true_positive / predicted_total
    recall = true_positive / expected_total
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def evaluate(
    model: JointNERRE,
    samples: Sequence[SentenceSample],
    pad_token_id: int,
    device: torch.device,
) -> Metrics:
    """Measure NER, gold-span RE, and the actual predicted-span RE pipeline."""
    model.eval()
    predicted_entities: Counter[object] = Counter()
    gold_entities: Counter[object] = Counter()
    predicted_gold_span_relations: Counter[object] = Counter()
    gold_relations: Counter[object] = Counter()
    predicted_pipeline_relations: Counter[object] = Counter()

    with torch.no_grad():
        for sentence_index, sample in enumerate(samples):
            batch = collate_samples((sample,), pad_token_id, device)
            encoded, ner_logits = model(batch.token_ids, batch.lengths)
            length = len(sample.tokens)
            decoded = decode_bio_tag_ids(ner_logits[0, :length].argmax(dim=-1).tolist())
            for entity in decoded:
                predicted_entities[(sentence_index, entity)] += 1
            for entity in sample.entities:
                gold_entities[(sentence_index, entity)] += 1

            gold_spans = [(entity.start, entity.end) for entity in sample.entities]
            gold_candidates = [(pair.head, pair.tail) for pair in sample.relation_pairs]
            if gold_candidates:
                gold_logits = model.relation_logits(encoded[0, :length], gold_spans, gold_candidates)
                gold_predictions = gold_logits.argmax(dim=-1).tolist()
                for pair, prediction in zip(sample.relation_pairs, gold_predictions, strict=True):
                    if prediction != RELATION_LABELS.index("no_relation"):
                        predicted_gold_span_relations[
                            (sentence_index, pair.head, pair.tail, RELATION_LABELS[prediction])
                        ] += 1
                    if pair.relation_label != "no_relation":
                        gold_relations[(sentence_index, pair.head, pair.tail, pair.relation_label)] += 1

            predicted_spans = [(entity.start, entity.end) for entity in decoded]
            predicted_candidates = [
                (head, tail)
                for head in range(len(predicted_spans))
                for tail in range(len(predicted_spans))
                if head != tail
            ]
            if predicted_candidates:
                pipeline_logits = model.relation_logits(encoded[0, :length], predicted_spans, predicted_candidates)
                for (head, tail), prediction in zip(
                    predicted_candidates, pipeline_logits.argmax(dim=-1).tolist(), strict=True
                ):
                    if prediction != RELATION_LABELS.index("no_relation"):
                        predicted_pipeline_relations[
                            (
                                sentence_index,
                                decoded[head],
                                decoded[tail],
                                RELATION_LABELS[prediction],
                            )
                        ] += 1

    gold_pipeline_relations: Counter[object] = Counter()
    for key, count in gold_relations.items():
        sentence_index, head, tail, relation_type = key
        sample = samples[int(sentence_index)]
        gold_pipeline_relations[
            (sentence_index, sample.entities[int(head)], sample.entities[int(tail)], relation_type)
        ] += count

    return Metrics(
        ner_entity_f1=_f1(predicted_entities, gold_entities),
        gold_span_relation_f1=_f1(predicted_gold_span_relations, gold_relations),
        end_to_end_relation_f1=_f1(predicted_pipeline_relations, gold_pipeline_relations),
    )


def train_tier(
    tier: TierName,
    train_samples: Sequence[SentenceSample],
    validation_samples: Sequence[SentenceSample],
    vocabulary: dict[str, int],
    settings: TrainingSettings,
    export_directory: Path,
) -> dict[str, object]:
    """Train one tier, select by validation NER plus gold-span relation F1, and export it."""
    if settings.epochs < 2:
        raise ValueError("At least two epochs are required to verify weight updates.")
    device = torch.device(settings.device)
    set_seed(settings.seed)
    tier_config = get_tier_config(tier)
    model = JointNERRE(len(vocabulary), vocabulary[PAD_TOKEN], tier_config).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=settings.learning_rate, weight_decay=1e-4)
    ner_criterion = nn.CrossEntropyLoss(weight=_ner_class_weights(train_samples, device), ignore_index=NER_PAD_LABEL)
    relation_criterion = nn.CrossEntropyLoss(weight=_relation_class_weights(train_samples, device))
    best_state: dict[str, Tensor] | None = None
    best_metrics: Metrics | None = None
    best_epoch = 0
    history: list[dict[str, float | int]] = []

    for epoch in range(1, settings.epochs + 1):
        model.train()
        running_loss = 0.0
        batch_count = 0
        for sample_batch in _batches(train_samples, settings.batch_size):
            batch = collate_samples(sample_batch, vocabulary[PAD_TOKEN], device)
            optimizer.zero_grad(set_to_none=True)
            encoded, ner_logits = model(batch.token_ids, batch.lengths)
            ner_loss = ner_criterion(ner_logits.flatten(0, 1), batch.bio_tag_ids.flatten())
            relation_loss = _relation_loss(model, encoded, batch, relation_criterion)
            loss = ner_loss + relation_loss
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
            optimizer.step()
            running_loss += float(loss.detach().cpu())
            batch_count += 1

        metrics = evaluate(model, validation_samples, vocabulary[PAD_TOKEN], device)
        history.append({"epoch": epoch, "loss": running_loss / batch_count, **metrics.to_dict()})
        current_quality = metrics.ner_entity_f1 + metrics.gold_span_relation_f1
        best_quality = -1.0 if best_metrics is None else best_metrics.ner_entity_f1 + best_metrics.gold_span_relation_f1
        if current_quality > best_quality:
            best_state = {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}
            best_metrics = metrics
            best_epoch = epoch

    if best_state is None or best_metrics is None:
        raise RuntimeError("Training produced no checkpoint candidate.")

    checkpoint = {
        "format_version": 1,
        "tier": tier,
        "tier_config": asdict(tier_config),
        "vocabulary": vocabulary,
        "model_state": best_state,
        "metrics": best_metrics.to_dict(),
        "best_epoch": best_epoch,
        "training_settings": asdict(settings),
        "relation_class_weights": relation_criterion.weight.detach().cpu().tolist(),
    }
    export_directory.mkdir(parents=True, exist_ok=True)
    checkpoint_path = export_directory / f"{tier}.pt"
    torch.save(checkpoint, checkpoint_path)
    return {
        "checkpoint_path": str(checkpoint_path),
        "best_epoch": best_epoch,
        "metrics": best_metrics.to_dict(),
        "history": history,
    }


def train_all(
    tiers: Sequence[TierName], settings: TrainingSettings, export_directory: Path
) -> dict[TierName, dict[str, object]]:
    """Load data once, build a train-only vocabulary, and train selected tiers."""
    dataset = load_conll04()
    train_split = dataset["train"]
    validation_split = dataset["validation"]
    vocabulary = build_vocab(train_split["tokens"])
    train_samples = tuple(CoNLL04Dataset(train_split, vocabulary)[index] for index in range(len(train_split)))
    validation_samples = tuple(
        CoNLL04Dataset(validation_split, vocabulary)[index] for index in range(len(validation_split))
    )
    results: dict[TierName, dict[str, object]] = {}
    for tier in tiers:
        results[tier] = train_tier(tier, train_samples, validation_samples, vocabulary, settings, export_directory)
    return results


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train self-initialized TextMosaic model tiers.")
    parser.add_argument("--tier", choices=tuple(TIER_CONFIGS), action="append")
    parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--learning-rate", type=float, default=DEFAULT_LEARNING_RATE)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--device", default="cpu")
    parser.add_argument(
        "--export-directory",
        type=Path,
        default=Path("backend") / "checkpoints",
        help="Tracked checkpoint directory copied into the backend image build context.",
    )
    return parser.parse_args()


def main() -> None:
    """Run the requested training tiers and write a machine-readable local summary."""
    arguments = _parse_args()
    tiers = tuple(arguments.tier) if arguments.tier else tuple(TIER_CONFIGS)
    settings = TrainingSettings(
        epochs=arguments.epochs,
        batch_size=arguments.batch_size,
        learning_rate=arguments.learning_rate,
        seed=arguments.seed,
        device=arguments.device,
    )
    results = train_all(tiers, settings, arguments.export_directory)
    log_directory = Path(TEXTMOSAIC_DATA_DIR) / "training-logs"
    log_directory.mkdir(parents=True, exist_ok=True)
    (log_directory / "latest.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
