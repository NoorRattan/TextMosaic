"""Focused correctness coverage for constrained CRF NER decoding."""

from __future__ import annotations

import torch

from backend.data.dataset import BIO_TAG_TO_ID, BIO_TAGS
from backend.model.architecture import JointNERRE
from backend.model.tiers import get_tier_config


def _model() -> JointNERRE:
    return JointNERRE(vocabulary_size=32, pad_token_id=0, tier=get_tier_config("speed"))


def test_crf_viterbi_rejects_an_invalid_initial_i_tag() -> None:
    model = _model()
    with torch.no_grad():
        model.crf_start_transitions.zero_()
        model.crf_end_transitions.zero_()
        model.crf_transitions.zero_()

    emissions = torch.full((1, 2, len(BIO_TAGS)), -5.0)
    emissions[0, 0, BIO_TAG_TO_ID["I-Peop"]] = 10.0
    emissions[0, 0, BIO_TAG_TO_ID["B-Peop"]] = 9.0
    emissions[0, 1, BIO_TAG_TO_ID["I-Peop"]] = 10.0

    assert model.decode_ner(emissions, torch.tensor([2])) == [[BIO_TAG_TO_ID["B-Peop"], BIO_TAG_TO_ID["I-Peop"]]]


def test_crf_negative_log_likelihood_is_finite_for_padded_sequences() -> None:
    model = _model()
    emissions = torch.randn(2, 3, len(BIO_TAGS), requires_grad=True)
    tag_ids = torch.tensor(
        [
            [BIO_TAG_TO_ID["B-Peop"], BIO_TAG_TO_ID["I-Peop"], BIO_TAG_TO_ID["O"]],
            [BIO_TAG_TO_ID["B-Org"], BIO_TAG_TO_ID["O"], -100],
        ]
    )

    loss = model.ner_neg_log_likelihood(emissions, tag_ids, torch.tensor([3, 2]))
    loss.backward()

    assert torch.isfinite(loss)
    assert emissions.grad is not None
