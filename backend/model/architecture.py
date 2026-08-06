"""Randomly initialized joint BiLSTM model for NER and relation extraction."""

from __future__ import annotations

from collections.abc import Sequence

import torch
from torch import Tensor, nn
from torch.nn.utils.rnn import pack_padded_sequence, pad_packed_sequence

from backend.data.dataset import BIO_TAGS, RELATION_LABELS
from backend.model.tiers import TierConfig


class JointNERRE(nn.Module):
    """One shared BiLSTM with token-tagging and directed-relation heads.

    All parameters are created by PyTorch initializers at construction time.
    This class never loads a checkpoint or any pretrained embeddings.
    """

    def __init__(self, vocabulary_size: int, pad_token_id: int, tier: TierConfig) -> None:
        super().__init__()
        if vocabulary_size <= 2:
            raise ValueError("vocabulary_size must include more than special tokens.")
        if not 0 <= pad_token_id < vocabulary_size:
            raise ValueError("pad_token_id must index the vocabulary.")

        self.pad_token_id = pad_token_id
        self.tier = tier
        self.embedding = nn.Embedding(
            num_embeddings=vocabulary_size,
            embedding_dim=tier.embedding_dim,
            padding_idx=pad_token_id,
        )
        self.encoder = nn.LSTM(
            input_size=tier.embedding_dim,
            hidden_size=tier.hidden_dim,
            num_layers=tier.layers,
            batch_first=True,
            bidirectional=True,
            dropout=0.2 if tier.layers > 1 else 0.0,
        )
        encoder_dim = tier.hidden_dim * 2
        self.ner_classifier = nn.Linear(encoder_dim, len(BIO_TAGS))
        self.relation_classifier = nn.Sequential(
            nn.Linear(encoder_dim * 2, encoder_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(encoder_dim, len(RELATION_LABELS)),
        )

    def encode(self, token_ids: Tensor, lengths: Tensor) -> Tensor:
        """Return shared token representations for a padded batch of sentences."""
        if token_ids.ndim != 2:
            raise ValueError("token_ids must have shape [batch, sequence].")
        if lengths.ndim != 1 or lengths.size(0) != token_ids.size(0):
            raise ValueError("lengths must have one positive value per batch item.")
        if torch.any(lengths <= 0):
            raise ValueError("Every sentence must contain at least one token.")

        embedded = self.embedding(token_ids)
        packed = pack_padded_sequence(
            embedded,
            lengths.detach().to("cpu"),
            batch_first=True,
            enforce_sorted=False,
        )
        packed_output, _ = self.encoder(packed)
        encoded, _ = pad_packed_sequence(
            packed_output,
            batch_first=True,
            total_length=token_ids.size(1),
        )
        return encoded

    def forward(self, token_ids: Tensor, lengths: Tensor) -> tuple[Tensor, Tensor]:
        """Return shared representations and NER logits for one padded batch."""
        encoded = self.encode(token_ids, lengths)
        return encoded, self.ner_classifier(encoded)

    def relation_logits(
        self,
        sentence_representations: Tensor,
        spans: Sequence[tuple[int, int]],
        candidate_pairs: Sequence[tuple[int, int]],
    ) -> Tensor:
        """Classify directed entity pairs from span-mean pooled representations.

        Callers invoke this once per sentence, deliberately preserving the v1
        rule that relation candidates are never formed across sentences.
        """
        if sentence_representations.ndim != 2:
            raise ValueError("sentence_representations must have shape [sequence, features].")
        if not candidate_pairs:
            return sentence_representations.new_empty((0, len(RELATION_LABELS)))

        span_vectors: list[Tensor] = []
        for start, end in spans:
            if start < 0 or end <= start or end > sentence_representations.size(0):
                raise ValueError("Entity span is outside the encoded sentence.")
            span_vectors.append(sentence_representations[start:end].mean(dim=0))

        pair_vectors: list[Tensor] = []
        for head, tail in candidate_pairs:
            if not 0 <= head < len(span_vectors) or not 0 <= tail < len(span_vectors):
                raise ValueError("Relation candidate references an unknown span.")
            pair_vectors.append(torch.cat((span_vectors[head], span_vectors[tail]), dim=-1))
        return self.relation_classifier(torch.stack(pair_vectors))
