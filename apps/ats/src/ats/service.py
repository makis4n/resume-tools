"""HTTP layer of the ATS (decision 0018). It checks each request and hands the PDF to `analyze`.

Nothing here reads, logs or keeps the PDF's contents.
"""

import logging
import math
import os
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from python_multipart.multipart import parse_options_header
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ats.analyze import NotAPdfError, analyze

logger = logging.getLogger(__name__)

DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
DEFAULT_ALLOWED_ORIGINS = "http://localhost:5173"

# Room for the multipart boundaries and headers around the file in a request body.
MULTIPART_OVERHEAD_BYTES = 64 * 1024

NOT_A_PDF = "This file is not a PDF. Export your resume as a PDF and try again."
INVALID_REQUEST = "The request must include a PDF in the `file` field."
INTERNAL_ERROR = "Something went wrong while analysing the resume. Please try again."

# Declared types a PDF may arrive with. The signature is checked as well, so a generic type is
# accepted and a PDF-shaped type on something that is not a PDF is still refused.
PDF_CONTENT_TYPES = {"application/pdf", "application/x-pdf", "application/octet-stream"}

# Codes for HTTP errors raised by the framework rather than by this module.
HTTP_ERROR_CODES = {400: "invalid-request", 404: "not-found", 405: "method-not-allowed"}
HTTP_ERROR_MESSAGE = "The request could not be handled."

# Headers an HTTP error may carry onto its reply; framing headers such as Content-Type stay the
# reply's own.
PASSED_ERROR_HEADERS = {"allow", "retry-after", "www-authenticate"}


class ServiceError(HTTPException):
    """An error the client is told about, with a stable code from error.schema.json.

    It is FastAPI's HTTPException, not only Starlette's, so that FastAPI passes it through
    unchanged when it is raised while the request body is being read, instead of turning it into
    a generic 400.
    """

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(status_code=status, detail=message)
        self.code = code
        self.message = message


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def readable_size(size: int) -> str:
    """4194304 -> "4 MB", 1572864 -> "1.5 MB", 4096 -> "4 KB".

    Rounds down, so the size stated as a limit is never more than the real one.
    """
    value, unit = (size / 1024**2, "MB") if size >= 1024**2 else (size / 1024, "KB")
    return f"{math.floor(value * 10) / 10:.1f}".removesuffix(".0") + f" {unit}"


def too_large(max_upload_bytes: int) -> ServiceError:
    limit = readable_size(max_upload_bytes)
    return ServiceError(413, "file-too-large", f"The PDF must be {limit} or smaller.")


class UnexpectedErrorMiddleware:
    """Answers any unhandled error with the contract's internal-error reply.

    Starlette's own handler for unexpected errors sits outside every middleware, so its reply
    would carry no CORS headers and a browser would see a network failure; this one is added
    inside CORS. It is plain ASGI because Starlette's decorator middleware reads the request in a
    task group, which wraps errors raised while reading the body. It logs the error's type only:
    a message could quote the resume.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = False

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception as error:
            name = type(error).__name__
            logger.error("Unhandled %s on %s %s", name, scope["method"], scope["path"])
            if started:
                raise
            reply = error_response(500, "internal-error", INTERNAL_ERROR)
            await reply(scope, receive, send)


class BodyLimitMiddleware:
    """Refuses a request body bigger than an upload plus its multipart framing.

    A declared Content-Length is checked before anything is read. A body sent without one is
    counted as it streams, and reading stops as soon as it passes the limit, so an undeclared
    upload cannot fill the disk the multipart parser spools to.
    """

    def __init__(self, app: ASGIApp, max_upload_bytes: int) -> None:
        self.app = app
        self.max_upload_bytes = max_upload_bytes
        self.max_body_bytes = max_upload_bytes + MULTIPART_OVERHEAD_BYTES

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = Headers(scope=scope).get("content-length", "")
        if declared.isdigit() and int(declared) > self.max_body_bytes:
            error = too_large(self.max_upload_bytes)
            await error_response(error.status_code, error.code, error.message)(scope, receive, send)
            return

        received = 0

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    raise too_large(self.max_upload_bytes)
            return message

        await self.app(scope, counting_receive, send)


def create_app(
    max_upload_bytes: int | None = None, allowed_origins: list[str] | None = None
) -> FastAPI:
    """Build the service. Settings not passed in are read from the environment."""
    if max_upload_bytes is None:
        max_upload_bytes = int(os.environ.get("ATS_MAX_UPLOAD_BYTES", DEFAULT_MAX_UPLOAD_BYTES))
    if allowed_origins is None:
        origins = os.environ.get("ATS_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
        allowed_origins = [origin.strip() for origin in origins.split(",") if origin.strip()]

    app = FastAPI(title="ATS")

    # Registered on Starlette's base class so it also answers the 404s and 405s Starlette raises.
    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, error: StarletteHTTPException) -> JSONResponse:
        if isinstance(error, ServiceError):
            reply = error_response(error.status_code, error.code, error.message)
        else:
            code = HTTP_ERROR_CODES.get(error.status_code, "http-error")
            reply = error_response(error.status_code, code, HTTP_ERROR_MESSAGE)
        for name, value in (error.headers or {}).items():
            if name.lower() in PASSED_ERROR_HEADERS:
                reply.headers[name] = value
        return reply

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, __: RequestValidationError) -> JSONResponse:
        return error_response(422, "invalid-request", INVALID_REQUEST)

    # Each middleware added wraps the ones before it: errors, then the body limit, then CORS.
    app.add_middleware(UnexpectedErrorMiddleware)
    app.add_middleware(BodyLimitMiddleware, max_upload_bytes=max_upload_bytes)
    # Added last so it is outermost, and every error response carries CORS headers too.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/analyze")
    async def analyze_resume(file: UploadFile) -> dict[str, Any]:
        media_type, _ = parse_options_header(file.content_type or "")
        if media_type.decode("latin-1").lower() not in PDF_CONTENT_TYPES:
            raise ServiceError(415, "not-a-pdf", NOT_A_PDF)
        pdf = await file.read(max_upload_bytes + 1)
        if len(pdf) > max_upload_bytes:
            raise too_large(max_upload_bytes)
        try:
            return await run_in_threadpool(analyze, pdf)
        except NotAPdfError:
            raise ServiceError(415, "not-a-pdf", NOT_A_PDF) from None

    return app


app = create_app()


def main() -> None:
    """Run the service locally: `uv run ats-serve`."""
    uvicorn.run(
        "ats.service:app",
        host=os.environ.get("ATS_HOST", "127.0.0.1"),
        port=int(os.environ.get("ATS_PORT", "8000")),
    )
