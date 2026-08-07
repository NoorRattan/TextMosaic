"""Randomly initialized joint BiLSTM model for NER and relation extraction."""

from __future__ import annotations

from collections.abc import Sequence

import torch
from torch import Tensor, nn
from torch.nn.utils.rnn import pack_padded_sequence, pad_packed_sequence

from backend.data.dataset import BIO_TAGS, RELATION_LABELS
from backend.model.tiers import TierConfig


class JointNERRE(nn.Module):
    """One shared BiLSTM with CRF NER decoding and directed-relation heads.

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
        self.crf_start_transitions = nn.Parameter(torch.empty(len(BIO_TAGS)))
        self.crf_end_transitions = nn.Parameter(torch.empty(len(BIO_TAGS)))
        self.crf_transitions = nn.Parameter(torch.empty(len(BIO_TAGS), len(BIO_TAGS)))
        transition_allowed, start_allowed = _bio_crf_constraints()
        self.register_buffer("_crf_transition_allowed", transition_allowed)
        self.register_buffer("_crf_start_allowed", start_allowed)
        nn.init.uniform_(self.crf_start_transitions, -0.1, 0.1)
        nn.init.uniform_(self.crf_end_transitions, -0.1, 0.1)
        nn.init.uniform_(self.crf_transitions, -0.1, 0.1)
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
        """Return shared representations and NER emission scores for one padded batch."""
        encoded = self.encode(token_ids, lengths)
        return encoded, self.ner_classifier(encoded)

    def ner_neg_log_likelihood(self, emissions: Tensor, tag_ids: Tensor, lengths: Tensor) -> Tensor:
        """Return mean constrained CRF negative log-likelihood for a padded batch."""
        if emissions.ndim != 3 or emissions.size(-1) != len(BIO_TAGS):
            raise ValueError("emissions must have shape [batch, sequence, tag_count].")
        if tag_ids.shape != emissions.shape[:2]:
            raise ValueError("tag_ids must have shape [batch, sequence].")
        if lengths.ndim != 1 or lengths.size(0) != emissions.size(0):
            raise ValueError("lengths must have one value per batch item.")
        if torch.any(lengths <= 0) or torch.any(lengths > emissions.size(1)):
            raise ValueError("lengths must be within the padded sequence bounds.")

        batch_size = emissions.size(0)
        batch_indices = torch.arange(batch_size, device=emissions.device)
        start_scores = self._constrained_start_transitions()
        transition_scores = self._constrained_transitions()
        safe_tag_ids = tag_ids.masked_fill(tag_ids < 0, 0)

        gold_score = start_scores[safe_tag_ids[:, 0]] + emissions[batch_indices, 0, safe_tag_ids[:, 0]]
        alpha = start_scores.unsqueeze(0) + emissions[:, 0]
        for token_index in range(1, emissions.size(1)):
            active = lengths > token_index
            current_tags = safe_tag_ids[:, token_index]
            previous_tags = safe_tag_ids[:, token_index - 1]
            gold_step = (
                transition_scores[previous_tags, current_tags] + emissions[batch_indices, token_index, current_tags]
            )
            gold_score = gold_score + gold_step * active

            next_alpha = (
                torch.logsumexp(alpha.unsqueeze(2) + transition_scores.unsqueeze(0), dim=1) + emissions[:, token_index]
            )
            alpha = torch.where(active.unsqueeze(1), next_alpha, alpha)

        last_tag_ids = safe_tag_ids[batch_indices, lengths - 1]
        gold_score = gold_score + self.crf_end_transitions[last_tag_ids]
        log_partition = torch.logsumexp(alpha + self.crf_end_transitions.unsqueeze(0), dim=1)
        return (log_partition - gold_score).mean()

    def decode_ner(self, emissions: Tensor, lengths: Tensor) -> list[list[int]]:
        """Viterbi decode valid BIO paths from CRF emission scores."""
        if emissions.ndim != 3 or emissions.size(-1) != len(BIO_TAGS):
            raise ValueError("emissions must have shape [batch, sequence, tag_count].")
        if lengths.ndim != 1 or lengths.size(0) != emissions.size(0):
            raise ValueError("lengths must have one value per batch item.")

        transition_scores = self._constrained_transitions()
        start_scores = self._constrained_start_transitions()
        decoded: list[list[int]] = []
        for row, raw_length in enumerate(lengths.tolist()):
            length = int(raw_length)
            if length <= 0 or length > emissions.size(1):
                raise ValueError("lengths must be within the padded sequence bounds.")
            scores = start_scores + emissions[row, 0]
            backpointers: list[Tensor] = []
            for token_index in range(1, length):
                best_scores, best_previous_tags = torch.max(
                    scores.unsqueeze(1) + transition_scores,
                    dim=0,
                )
                scores = best_scores + emissions[row, token_index]
                backpointers.append(best_previous_tags)

            current_tag = int(torch.argmax(scores + self.crf_end_transitions).item())
            path = [current_tag]
            for best_previous_tags in reversed(backpointers):
                current_tag = int(best_previous_tags[current_tag].item())
                path.append(current_tag)
            decoded.append(list(reversed(path)))
        return decoded

    def _constrained_start_transitions(self) -> Tensor:
        return self.crf_start_transitions.masked_fill(~self._crf_start_allowed, -10_000.0)

    def _constrained_transitions(self) -> Tensor:
        return self.crf_transitions.masked_fill(~self._crf_transition_allowed, -10_000.0)

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


def _bio_crf_constraints() -> tuple[Tensor, Tensor]:
    """Disallow malformed I-tags at sentence starts and entity-type boundaries."""
    tag_count = len(BIO_TAGS)
    allowed = torch.ones((tag_count, tag_count), dtype=torch.bool)
    start_allowed = torch.ones(tag_count, dtype=torch.bool)
    for next_index, next_tag in enumerate(BIO_TAGS):
        if not next_tag.startswith("I-"):
            continue
        entity_type = next_tag.removeprefix("I-")
        start_allowed[next_index] = False
        for previous_index, previous_tag in enumerate(BIO_TAGS):
            if previous_tag not in {f"B-{entity_type}", f"I-{entity_type}"}:
                allowed[previous_index, next_index] = False
    return allowed, start_allowed
