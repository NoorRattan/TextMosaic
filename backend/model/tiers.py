"""Single source of truth for TextMosaic model-tier configurations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

TierName = Literal["speed", "balanced", "accuracy"]


@dataclass(frozen=True)
class TierConfig:
    """Architecture and presentation details for one trained model tier."""

    name: TierName
    embedding_dim: int
    hidden_dim: int
    layers: int
    description: str


TIER_CONFIGS: Final[dict[TierName, TierConfig]] = {
    "speed": TierConfig(
        name="speed",
        embedding_dim=100,
        hidden_dim=64,
        layers=1,
        description="Fastest, lowest accuracy",
    ),
    "balanced": TierConfig(
        name="balanced",
        embedding_dim=200,
        hidden_dim=128,
        layers=1,
        description="Default — a middle ground",
    ),
    "accuracy": TierConfig(
        name="accuracy",
        embedding_dim=300,
        hidden_dim=256,
        layers=2,
        description="Slowest, highest accuracy",
    ),
}


def get_tier_config(tier: TierName) -> TierConfig:
    """Return a tier configuration while preserving a narrow typed interface."""
    return TIER_CONFIGS[tier]
