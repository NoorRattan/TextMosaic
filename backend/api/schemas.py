"""Public contract for evidence-grounded knowledge maps."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

EntityType = Literal["Peop", "Org", "Loc", "Other"]
TierName = Literal["speed", "balanced", "accuracy"]


class ExtractRequest(BaseModel):
    """User text and an optional selected model tier."""

    text: str = Field(max_length=12_000)
    tier: TierName | None = None
    mode: Literal["document", "extractor"] = "document"

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        """Reject blank input after retaining meaningful surrounding punctuation."""
        if not value.strip():
            raise ValueError("text must not be empty")
        return value


class Entity(BaseModel):
    """One end-exclusive entity span over response tokens.

    These fields are retained for compatibility with the self-trained CoNLL04
    extractor. Richer, document-level information lives in ``concepts``.
    """

    type: EntityType
    start: int = Field(ge=0)
    end: int = Field(gt=0)


class Relation(BaseModel):
    """A directed relation between indices in the response entities array."""

    type: str
    head: int = Field(ge=0)
    tail: int = Field(ge=0)


class Evidence(BaseModel):
    """Verbatim source evidence supporting a concept or relationship."""

    quote: str = Field(min_length=1, max_length=500)


class Concept(BaseModel):
    """A clickable, plain-English concept in a knowledge map."""

    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=240)
    kind: str = Field(min_length=1, max_length=80)
    explanation: str = Field(min_length=1, max_length=800)
    evidence: list[Evidence] = Field(min_length=1, max_length=3)
    confidence: float = Field(ge=0, le=1)


class GraphRelation(BaseModel):
    """An evidence-backed, directed relationship between two concepts."""

    source: str = Field(min_length=1, max_length=80)
    target: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=120)
    explanation: str = Field(min_length=1, max_length=500)
    evidence: list[Evidence] = Field(min_length=1, max_length=3)
    confidence: float = Field(ge=0, le=1)


class AnalysisMetadata(BaseModel):
    """Makes analysis capability and limitations visible to the person reading it."""

    mode: Literal["document", "extractor"]
    coverage: Literal["document", "targeted"]
    notice: str = Field(min_length=1, max_length=500)


class ExtractResponse(BaseModel):
    """CoNLL04-compatible extraction data plus an explorable knowledge map."""

    tokens: list[str]
    entities: list[Entity]
    relations: list[Relation]
    concepts: list[Concept] = Field(default_factory=list)
    graph_relations: list[GraphRelation] = Field(default_factory=list)
    analysis: AnalysisMetadata


class TierInfo(BaseModel):
    """One selectable tier exposed from the backend source of truth."""

    name: TierName
    description: str


class TierResponse(BaseModel):
    """Response body for the live tier list."""

    tiers: list[TierInfo]


class HealthResponse(BaseModel):
    """Minimal process-readiness response."""

    status: Literal["ok"]


class ErrorDetail(BaseModel):
    """Stable client-safe error payload."""

    code: str
    message: str


class ErrorResponse(BaseModel):
    """Envelope used by validation, rate-limit, and inference failures."""

    error: ErrorDetail
