"""HTTP layer of the ATS (decision 0030). It checks each request and hands the PDF to `analyze`.

Nothing here reads, logs or keeps the PDF's contents.
"""

import logging
import math
import os
from collections.abc import Callable
from typing import Any

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
from ats.errors import error_response
from ats.extract import EncryptedPdfError, UnreadablePdfError
from ats.ratelimit import RateLimiter, RateLimitMiddleware
from ats.timelimit import (
    AnalysisCrashedError,
    AnalysisTimeoutError,
    ServerBusyError,
    run_with_time_limit,
)

logger = logging.getLogger(__name__)

DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
DEFAULT_ALLOWED_ORIGINS = "http://localhost:5173"
DEFAULT_ANALYZE_RATE_LIMIT_PER_MINUTE = 10
DEFAULT_RATE_LIMIT_MAX_CLIENTS = 10_000
DEFAULT_TRUSTED_PROXY_HOPS = 0
DEFAULT_ANALYSIS_TIMEOUT_SECONDS = 10.0
MAX_ANALYSIS_TIMEOUT_SECONDS = 3600.0
DEFAULT_SLOT_WAIT_SECONDS = 5.0
BUSY_RETRY_AFTER_SECONDS = 5

# Room for the multipart boundaries and headers around the file in a request body.
MULTIPART_OVERHEAD_BYTES = 64 * 1024

NOT_A_PDF = "This file is not a PDF. Export your resume as a PDF and try again."
PDF_ENCRYPTED = (
    "This PDF is protected, so it cannot be read. Export it again without a password or other "
    "protection and try again."
)
PDF_UNREADABLE = "This PDF could not be read. It may be damaged; export it again and try again."
INVALID_REQUEST = "The request must include a PDF in the `file` field."
ANALYSIS_TIMEOUT = (
    "This PDF took too long to analyse. It may be unusually complex; export it again, or "
    "simplify it, and try again."
)
SERVER_BUSY = "The service is busy right now. Please try again in a few seconds."
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


def env_number(name: str, default: float, cast: Callable[[str], Any], minimum: float) -> Any:
    """Read a number from the environment, refusing one below `minimum` (or not a number)."""
    raw = os.environ.get(name)
    try:
        value = default if raw is None else cast(raw)
    except ValueError:
        raise ValueError(f"{name} must be a number, not {raw!r}") from None
    if not math.isfinite(value) or not value >= minimum:
        raise ValueError(f"{name} must be a finite number of at least {minimum:g}, not {raw!r}")
    return value


def create_app(
    max_upload_bytes: int | None = None,
    allowed_origins: list[str] | None = None,
    *,
    analyze_rate_limit_per_minute: int | None = None,
    rate_limit_max_clients: int | None = None,
    trusted_proxy_hops: int | None = None,
    analysis_timeout_seconds: float | None = None,
    slot_wait_seconds: float | None = None,
    analyser: Callable[[bytes], dict[str, Any]] = analyze,
) -> FastAPI:
    """Build the service. Settings not passed in are read from the environment.

    `analyser` is a seam for tests; it must be importable by name from another process.
    """
    if analyze_rate_limit_per_minute is None:
        analyze_rate_limit_per_minute = env_number(
            "ATS_ANALYZE_RATE_LIMIT_PER_MINUTE", DEFAULT_ANALYZE_RATE_LIMIT_PER_MINUTE, int, 0
        )
    if rate_limit_max_clients is None:
        rate_limit_max_clients = env_number(
            "ATS_RATE_LIMIT_MAX_CLIENTS", DEFAULT_RATE_LIMIT_MAX_CLIENTS, int, 1
        )
    if trusted_proxy_hops is None:
        trusted_proxy_hops = env_number(
            "ATS_TRUSTED_PROXY_HOPS", DEFAULT_TRUSTED_PROXY_HOPS, int, 0
        )
    if analysis_timeout_seconds is None:
        analysis_timeout_seconds = env_number(
            "ATS_ANALYSIS_TIMEOUT_SECONDS", DEFAULT_ANALYSIS_TIMEOUT_SECONDS, float, 0
        )
    if slot_wait_seconds is None:
        slot_wait_seconds = env_number("ATS_SLOT_WAIT_SECONDS", DEFAULT_SLOT_WAIT_SECONDS, float, 0)
    if not 0 < analysis_timeout_seconds <= MAX_ANALYSIS_TIMEOUT_SECONDS:
        raise ValueError(
            "ATS_ANALYSIS_TIMEOUT_SECONDS must be greater than 0 and at most "
            f"{MAX_ANALYSIS_TIMEOUT_SECONDS:g}, not {analysis_timeout_seconds!r}"
        )
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

    limits: dict[str, RateLimiter] = {}
    if analyze_rate_limit_per_minute > 0:
        limits["/v1/analyze"] = RateLimiter(analyze_rate_limit_per_minute, rate_limit_max_clients)

    # Each middleware added wraps the ones before it: errors, then the body limit, then the rate
    # limit, then CORS. The rate limit sits inside CORS so a 429 carries CORS headers, and
    # outside the body reading so a refused client's body is never read.
    app.add_middleware(UnexpectedErrorMiddleware)
    app.add_middleware(BodyLimitMiddleware, max_upload_bytes=max_upload_bytes)
    app.add_middleware(RateLimitMiddleware, limits=limits, trusted_proxy_hops=trusted_proxy_hops)
    # Added last so it is outermost, and every error response carries CORS headers too.
    # A preflight it refuses gets its own plain-text 400, which error.schema.json excludes.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        expose_headers=["Retry-After"],
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
            return await run_in_threadpool(
                run_with_time_limit, analyser, pdf, analysis_timeout_seconds, slot_wait_seconds
            )
        except NotAPdfError:
            raise ServiceError(415, "not-a-pdf", NOT_A_PDF) from None
        except EncryptedPdfError:
            raise ServiceError(422, "pdf-encrypted", PDF_ENCRYPTED) from None
        except UnreadablePdfError:
            raise ServiceError(422, "pdf-unreadable", PDF_UNREADABLE) from None
        except AnalysisTimeoutError:
            # A 422: the time depends on the file, and the same file would time out again.
            raise ServiceError(422, "analysis-timeout", ANALYSIS_TIMEOUT) from None
        except ServerBusyError:
            error = ServiceError(503, "server-busy", SERVER_BUSY)
            error.headers = {"Retry-After": str(BUSY_RETRY_AFTER_SECONDS)}
            raise error from None
        except AnalysisCrashedError as error:
            # Its message is an exception type name or an exit code, never content. The error then
            # reaches UnexpectedErrorMiddleware, which answers 500 internal-error.
            logger.error("Analysis process failed: %s", error)
            raise

    return app


app = create_app()
