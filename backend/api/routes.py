"""Stateless extraction routes and a conservative in-memory request limiter."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from pathlib import Path
from threading import Lock
from typing import Final, Protocol, cast

from fastapi import APIRouter, HTTPException, Request, status

from backend.api.schemas import (
    ExtractRequest,
    ExtractResponse,
    HealthResponse,
    TierInfo,
    TierResponse,
)
from backend.config import MODEL_TIER_DEFAULT as _DEFAULT_TIER_VALUE
from backend.model.inference import CheckpointError, InferenceEngine
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
        self._engines: dict[TierName, InferenceEngine] = {}
        self._lock = Lock()

    def extract(self, text: str, tier: TierName) -> dict[str, object]:
        with self._lock:
            engine = self._engines.get(tier)
            if engine is None:
                engine = InferenceEngine(self._checkpoint_directory / f"{tier}.pt")
                self._engines[tier] = engine
        return engine.extract(text)


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


def _client_id(request: Request) -> str:
    """Use the direct peer address; proxy headers remain untrusted by default."""
    return request.client.host if request.client is not None else "unknown"


def create_router(
    service: ExtractionService | None = None,
    limiter: InMemoryRateLimiter | None = None,
) -> APIRouter:
    """Create an injectable router for production and endpoint tests."""
    extraction_service = service or CheckpointExtractionService()
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
        if not request_limiter.allow(_client_id(request)):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"code": "rate_limited", "message": "Too many extraction requests."},
            )
        try:
            result = extraction_service.extract(payload.text, payload.tier or MODEL_TIER_DEFAULT)
            return ExtractResponse.model_validate(result)
        except CheckpointError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"code": "model_unavailable", "message": "A model tier is unavailable."},
            ) from error
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"code": "inference_error", "message": "Extraction could not be completed."},
            ) from error

    return router
