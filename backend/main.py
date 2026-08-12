"""FastAPI application entry point for the TextMosaic JSON API."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.api.routes import ExtractionService, create_router
from backend.config import ALLOWED_HOSTS, ALLOWED_ORIGINS, MAX_REQUEST_BODY_BYTES, TRUST_PROXY_HEADERS


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": {"code": code, "message": message}})


class RequestBodyLimitMiddleware:
    """Bound request buffering before FastAPI parses a JSON payload."""

    def __init__(self, app: ASGIApp, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            await self.app(scope, receive, send)
            return

        content_length = next(
            (value for name, value in scope.get("headers", []) if name.lower() == b"content-length"),
            None,
        )
        if content_length is not None:
            try:
                declared_size = int(content_length)
            except ValueError:
                declared_size = 0
            if declared_size > self.max_body_bytes:
                await _error_response(
                    413,
                    "request_too_large",
                    "Request body is too large.",
                )(scope, receive, send)
                return

        chunks: list[bytes] = []
        received_size = 0
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] == "http.disconnect":
                await self.app(scope, receive, send)
                return
            if message["type"] != "http.request":
                continue
            chunk = message.get("body", b"")
            received_size += len(chunk)
            if received_size > self.max_body_bytes:
                await _error_response(
                    413,
                    "request_too_large",
                    "Request body is too large.",
                )(scope, receive, send)
                return
            chunks.append(chunk)
            more_body = message.get("more_body", False)

        body = b"".join(chunks)
        consumed = False

        async def receive_buffered() -> Message:
            nonlocal consumed
            if consumed:
                return {"type": "http.disconnect"}
            consumed = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, receive_buffered, send)


def create_app(
    service: ExtractionService | None = None,
    trust_proxy_headers: bool = TRUST_PROXY_HEADERS,
) -> FastAPI:
    """Create the application with test-injectable extraction behavior."""
    app = FastAPI(title="TextMosaic", version="1.0.0", docs_url=None, redoc_url=None)
    origins = [origin.strip() for origin in ALLOWED_ORIGINS.split(",") if origin.strip()]
    hosts = [host.strip() for host in ALLOWED_HOSTS.split(",") if host.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.add_middleware(RequestBodyLimitMiddleware, max_body_bytes=MAX_REQUEST_BODY_BYTES)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)

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

    app.include_router(create_router(service, trust_proxy_headers=trust_proxy_headers))
    return app


app = create_app()
