"""FastAPI application entry point for the TextMosaic JSON API."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from backend.api.routes import ExtractionService, create_router
from backend.config import ALLOWED_ORIGINS


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": {"code": code, "message": message}})


def create_app(service: ExtractionService | None = None) -> FastAPI:
    """Create the application with test-injectable extraction behavior."""
    app = FastAPI(title="TextMosaic", version="1.0.0", docs_url=None, redoc_url=None)
    origins = [origin.strip() for origin in ALLOWED_ORIGINS.split(",") if origin.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        if "server" in response.headers:
            del response.headers["server"]
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
        return _error_response(422, "validation_error", "Request validation failed.")

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, error: HTTPException) -> JSONResponse:
        if isinstance(error.detail, dict):
            code = str(error.detail.get("code", "request_error"))
            message = str(error.detail.get("message", "Request could not be completed."))
        else:
            code = "request_error"
            message = str(error.detail)
        return _error_response(error.status_code, code, message)

    app.include_router(create_router(service))
    return app


app = create_app()
