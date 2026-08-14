"""Stateless extraction routes and a conservative in-memory request limiter."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from pathlib import Path
from threading import Lock
from typing import Any, Final, Protocol, cast

from fastapi import APIRouter, HTTPException, Request, status

from backend.api.schemas import (
    AnalysisMetadata,
    Concept,
    Evidence,
    ExtractRequest,
    ExtractResponse,
    GraphRelation,
    HealthResponse,
    TierInfo,
    TierResponse,
)
from backend.config import MODEL_TIER_DEFAULT as _DEFAULT_TIER_VALUE
from backend.config import TRUST_PROXY_HEADERS as _TRUST_PROXY_HEADERS
from backend.model.document_graph import LocalDocumentGraphExtractor, LocalModelUnavailableError
from backend.model.tiers import TIER_CONFIGS, TierName

_VALID_TIERS: Final[set[str]] = set(TIER_CONFIGS)
if _DEFAULT_TIER_VALUE not in _VALID_TIERS:
    raise ValueError("MODEL_TIER_DEFAULT must be speed, balanced, or accuracy.")
MODEL_TIER_DEFAULT: Final[TierName] = cast(TierName, _DEFAULT_TIER_VALUE)


class ExtractionService(Protocol):
    """Minimal service interface that keeps routes independent of checkpoint storage."""

    def extract(self, text: str, tier: TierName) -> dict[str, object]:
        """Extract the API schema using a selected tier."""


class CheckpointExtractionService:
    """Lazy checkpoint loader for the three locally baked model tiers."""

    def __init__(self, checkpoint_directory: Path | None = None) -> None:
        self._checkpoint_directory = checkpoint_directory or Path(__file__).resolve().parents[1] / "checkpoints"
        self._engines: dict[TierName, Any] = {}
        self._lock = Lock()

    def extract(self, text: str, tier: TierName) -> dict[str, object]:
        try:
            from backend.model.inference import CheckpointError, InferenceEngine
        except ImportError as error:
            raise LocalModelUnavailableError("The local relation model is unavailable.") from error

        with self._lock:
            engine = self._engines.get(tier)
            if engine is None:
                try:
                    engine = InferenceEngine(self._checkpoint_directory / f"{tier}.pt")
                except CheckpointError as error:
                    raise LocalModelUnavailableError("The local relation model is unavailable.") from error
                self._engines[tier] = engine
        return engine.extract(text)


def _extractor_map(result: dict[str, object]) -> tuple[list[Concept], list[GraphRelation], AnalysisMetadata]:
    """Give the narrow local model useful, source-anchored node details.

    The fallback deliberately names its limitations instead of pretending to be a
    general document reader.
    """
    tokens = result.get("tokens")
    entities = result.get("entities")
    relations = result.get("relations")
    if not isinstance(tokens, list) or not isinstance(entities, list) or not isinstance(relations, list):
        return (
            [],
            [],
            AnalysisMetadata(
                mode="extractor",
                coverage="targeted",
                notice="The local extractor could not build a source-grounded map for this text.",
            ),
        )
    concepts: list[Concept] = []
    for index, raw_entity in enumerate(entities):
        if not isinstance(raw_entity, dict):
            continue
        start, end = raw_entity.get("start"), raw_entity.get("end")
        kind = raw_entity.get("type")
        if not isinstance(start, int) or not isinstance(end, int) or not isinstance(kind, str):
            continue
        words = tokens[start:end]
        if not all(isinstance(word, str) for word in words) or not words:
            continue
        label = " ".join(words)
        readable_kind = {
            "Peop": "person",
            "Org": "organization",
            "Loc": "location",
            "Other": "named concept",
        }.get(kind, "concept")
        concepts.append(
            Concept(
                id=f"entity-{index}",
                label=label,
                kind=readable_kind,
                explanation=f"{label} is identified in this text as a {readable_kind}.",
                evidence=[Evidence(quote=label)],
                confidence=0.5,
            )
        )
    graph_relations: list[GraphRelation] = []
    relation_labels = {
        "Located_In": "is located in",
        "Work_For": "works for",
        "OrgBased_In": "is based in",
        "Live_In": "lives in",
        "Kill": "is linked to the death of",
    }
    for raw_relation in relations:
        if not isinstance(raw_relation, dict):
            continue
        head, tail, relation_type = raw_relation.get("head"), raw_relation.get("tail"), raw_relation.get("type")
        if not isinstance(head, int) or not isinstance(tail, int) or not isinstance(relation_type, str):
            continue
        if not (0 <= head < len(concepts) and 0 <= tail < len(concepts)):
            continue
        label = relation_labels.get(relation_type, relation_type.replace("_", " ").lower())
        source = concepts[head]
        target = concepts[tail]
        graph_relations.append(
            GraphRelation(
                source=source.id,
                target=target.id,
                label=label,
                explanation=f"The local extractor predicts that {source.label} {label} {target.label}.",
                evidence=[Evidence(quote=source.label)],
                confidence=0.5,
            )
        )
    return (
        concepts,
        graph_relations,
        AnalysisMetadata(
            mode="extractor",
            coverage="targeted",
            notice=(
                "Local extraction is limited to people, organizations, locations, and a small set of "
                "news-style relations. Use the local document model for broad text maps."
            ),
        ),
    )


class InMemoryRateLimiter:
    """Small fixed-window limiter suitable for a single personal deployment process."""

    def __init__(self, limit: int = 30, window_seconds: float = 60.0) -> None:
        self._limit = limit
        self._window_seconds = window_seconds
        self._requests: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, client_id: str) -> bool:
        """Return whether a request fits the client window, consuming one on success."""
        now = time.monotonic()
        with self._lock:
            timestamps = self._requests[client_id]
            while timestamps and timestamps[0] <= now - self._window_seconds:
                timestamps.popleft()
            if len(timestamps) >= self._limit:
                return False
            timestamps.append(now)
            return True


def _client_id(request: Request, trust_proxy_headers: bool = False) -> str:
    """Resolve the visitor address when a trusted reverse proxy preserves it."""
    if trust_proxy_headers:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        client_ip = forwarded_for.split(",", maxsplit=1)[0].strip()
        if client_ip:
            return client_ip
    return request.client.host if request.client is not None else "unknown"


def create_router(
    service: ExtractionService | None = None,
    limiter: InMemoryRateLimiter | None = None,
    document_extractor: LocalDocumentGraphExtractor | None = None,
    trust_proxy_headers: bool = _TRUST_PROXY_HEADERS,
) -> APIRouter:
    """Create an injectable router for production and endpoint tests."""
    extraction_service = service or CheckpointExtractionService()
    local_document_extractor = document_extractor or LocalDocumentGraphExtractor()
    request_limiter = limiter or InMemoryRateLimiter()
    router = APIRouter()

    @router.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @router.get("/tiers", response_model=TierResponse)
    def tiers() -> TierResponse:
        return TierResponse(
            tiers=[TierInfo(name=config.name, description=config.description) for config in TIER_CONFIGS.values()]
        )

    @router.post("/extract", response_model=ExtractResponse)
    def extract(payload: ExtractRequest, request: Request) -> ExtractResponse:
        if not request_limiter.allow(_client_id(request, trust_proxy_headers)):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"code": "rate_limited", "message": "Too many extraction requests."},
            )
        try:
            if payload.mode == "document":
                document_graph = local_document_extractor.extract(payload.text)
                return ExtractResponse(
                    tokens=[],
                    entities=[],
                    relations=[],
                    concepts=document_graph.concepts,
                    graph_relations=document_graph.relations,
                    analysis=document_graph.analysis,
                )
            result = extraction_service.extract(payload.text, payload.tier or MODEL_TIER_DEFAULT)
            concepts, graph_relations, analysis = _extractor_map(result)
            return ExtractResponse.model_validate(
                {
                    **result,
                    "concepts": concepts,
                    "graph_relations": graph_relations,
                    "analysis": analysis,
                }
            )
        except LocalModelUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"code": "model_unavailable", "message": str(error)},
            ) from error
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"code": "inference_error", "message": "Extraction could not be completed."},
            ) from error

    return router
