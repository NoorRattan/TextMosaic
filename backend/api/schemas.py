"""Pydantic models matching the CoNLL04-aligned public API contract."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

EntityType = Literal["Peop", "Org", "Loc", "Other"]
RelationType = Literal["Located_In", "Work_For", "OrgBased_In", "Live_In", "Kill"]
TierName = Literal["speed", "balanced", "accuracy"]


class ExtractRequest(BaseModel):
    """User text and an optional selected model tier."""

    text: str = Field(max_length=2_000)
    tier: TierName | None = None

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        """Reject blank input after retaining meaningful surrounding punctuation."""
        if not value.strip():
            raise ValueError("text must not be empty")
        return value


class Entity(BaseModel):
    """One end-exclusive entity span over response tokens."""

    type: EntityType
    start: int = Field(ge=0)
    end: int = Field(gt=0)


class Relation(BaseModel):
    """A directed relation between indices in the response entities array."""

    type: RelationType
    head: int = Field(ge=0)
    tail: int = Field(ge=0)


class ExtractResponse(BaseModel):
    """CoNLL04-shaped extraction data returned to the frontend."""

    tokens: list[str]
    entities: list[Entity]
    relations: list[Relation]


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
