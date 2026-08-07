"""API contract tests independent of heavyweight checkpoint files."""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.api.routes import InMemoryRateLimiter
from backend.main import create_app


class FakeExtractionService:
    """Predictable model substitute for HTTP contract coverage."""

    def extract(self, text: str, tier: str) -> dict[str, object]:
        return {
            "tokens": ["Ada", "joined", "Acme", "."],
            "entities": [
                {"type": "Peop", "start": 0, "end": 1},
                {"type": "Org", "start": 2, "end": 3},
            ],
            "relations": [{"type": "Work_For", "head": 0, "tail": 1}],
        }


def test_health_and_tiers_expose_the_documented_contract() -> None:
    client = TestClient(create_app(FakeExtractionService()))

    health = client.get("/health")
    tiers = client.get("/tiers")

    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    assert health.headers["x-content-type-options"] == "nosniff"
    assert [tier["name"] for tier in tiers.json()["tiers"]] == ["speed", "balanced", "accuracy"]


def test_extract_accepts_each_tier_and_returns_source_schema() -> None:
    client = TestClient(create_app(FakeExtractionService()))

    for tier in ("speed", "balanced", "accuracy"):
        response = client.post("/extract", json={"text": "Ada joined Acme.", "tier": tier})
        assert response.status_code == 200
        assert response.json()["relations"] == [{"type": "Work_For", "head": 0, "tail": 1}]


def test_extract_returns_a_stable_validation_error() -> None:
    client = TestClient(create_app(FakeExtractionService()))

    empty = client.post("/extract", json={"text": "   "})
    invalid_tier = client.post("/extract", json={"text": "Ada joined Acme.", "tier": "slow"})
    too_long = client.post("/extract", json={"text": "a" * 2_001})

    for response in (empty, invalid_tier, too_long):
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"


def test_extract_rejects_an_oversized_request_before_processing() -> None:
    client = TestClient(create_app(FakeExtractionService()))

    response = client.post("/extract", json={"text": "a" * 20_000})

    assert response.status_code == 413
    assert response.json() == {
        "error": {
            "code": "request_too_large",
            "message": "Request body is too large.",
        }
    }


def test_rate_limiter_blocks_the_next_request_after_its_limit() -> None:
    limiter = InMemoryRateLimiter(limit=2, window_seconds=60)

    assert limiter.allow("127.0.0.1")
    assert limiter.allow("127.0.0.1")
    assert not limiter.allow("127.0.0.1")
