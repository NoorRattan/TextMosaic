"""Regression coverage for the random-initialization model boundary."""

from __future__ import annotations

import inspect

import torch

from backend.model.architecture import JointNERRE
from backend.model.tiers import get_tier_config


def test_embedding_is_randomly_initialized_without_checkpoint_loading() -> None:
    """Construction creates nonzero random weights and has no loading path."""
    torch.manual_seed(17)
    model = JointNERRE(vocabulary_size=32, pad_token_id=0, tier=get_tier_config("speed"))

    assert torch.count_nonzero(model.embedding.weight[1:]).item() > 0
    assert torch.count_nonzero(model.embedding.weight[0]).item() == 0
    source = inspect.getsource(JointNERRE)
    assert "torch.load" not in source
    assert "from_pretrained" not in source
    assert "checkpoint" not in inspect.getsource(JointNERRE.__init__).lower()
