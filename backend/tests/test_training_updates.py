"""Integration coverage proving relation parameters learn from a held-out slice."""

from __future__ import annotations

from pathlib import Path

from backend.data.dataset import CoNLL04Dataset
from backend.data.vocab import PAD_TOKEN, build_vocab
from backend.model.architecture import JointNERRE
from backend.model.tiers import get_tier_config
from backend.model.train import TrainingSettings, evaluate, set_seed, train_tier


def _records(count: int) -> list[dict[str, object]]:
    return [
        {
            "tokens": ["Ada", "joined", "Acme", "."],
            "entities": [
                {"type": "Peop", "start": 0, "end": 1},
                {"type": "Org", "start": 2, "end": 3},
            ],
            "relations": [{"type": "Work_For", "head": 0, "tail": 1}],
        }
        for _ in range(count)
    ]


def test_relation_f1_improves_after_two_or_more_epochs(tmp_path: Path) -> None:
    """A fixed tiny corpus proves relation weights update instead of staying frozen."""
    train_records = _records(24)
    validation_records = _records(8)
    vocabulary = build_vocab(record["tokens"] for record in train_records)
    train_samples = tuple(CoNLL04Dataset(train_records, vocabulary)[index] for index in range(24))
    validation_samples = tuple(CoNLL04Dataset(validation_records, vocabulary)[index] for index in range(8))

    set_seed(17)
    untrained_model = JointNERRE(len(vocabulary), vocabulary[PAD_TOKEN], get_tier_config("speed"))
    before_training = evaluate(
        untrained_model, validation_samples, vocabulary[PAD_TOKEN], untrained_model.embedding.weight.device
    )

    result = train_tier(
        "speed",
        train_samples,
        validation_samples,
        vocabulary,
        TrainingSettings(epochs=2, batch_size=8, learning_rate=0.01, seed=17),
        tmp_path,
    )
    history = result["history"]
    assert isinstance(history, list)
    relation_f1 = [entry["gold_span_relation_f1"] for entry in history]
    assert len(relation_f1) == 2
    assert relation_f1[-1] > before_training.gold_span_relation_f1
    assert (tmp_path / "speed.pt").is_file()
