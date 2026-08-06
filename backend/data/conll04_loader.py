"""Load CoNLL04 data from Hugging Face Datasets, never model weights.

This is the sole backend exception for the Hugging Face ecosystem: it retrieves
the CoNLL04 dataset only. Each record includes token strings, end-exclusive
entity spans, and directed relations whose head and tail index the entities
array rather than the token sequence.
"""

from __future__ import annotations

from datasets import DatasetDict, load_dataset

from backend.config import TEXTMOSAIC_DATA_DIR


def load_conll04(cache_dir: str | None = None) -> DatasetDict:
    """Return every published CoNLL04 split without assuming split names."""
    dataset = load_dataset(
        "DFKI-SLT/conll04",
        cache_dir=cache_dir or TEXTMOSAIC_DATA_DIR,
    )
    if not isinstance(dataset, DatasetDict):
        raise TypeError("DFKI-SLT/conll04 must load as a DatasetDict.")
    return dataset
