"""HTTP layer of the ATS (decision 0006). It checks each request and hands the PDF to `analyze`.

Nothing here reads, logs or keeps the PDF's contents.
"""

import os
from typing import Any

import uvicorn
from fastapi import FastAPI, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ats.analyze import NotAPdfError, analyze

DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
DEFAULT_ALLOWED_ORIGINS = "http://localhost:5173"

# Room for the multipart boundaries and headers around the file when checking Content-Length.
MULTIPART_OVERHEAD_BYTES = 64 * 1024

NOT_A_PDF = "This file is not a PDF. Export your resume as a PDF and try again."
INVALID_REQUEST = "The request must include a PDF in the `file` field."
INTERNAL_ERROR = "Something went wrong while analysing the resume. Please try again."


class ServiceError(Exception):
    """An error the client is told about, with a stable code from error.schema.json."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def too_large(max_upload_bytes: int) -> ServiceError:
    megabytes = max_upload_bytes / (1024 * 1024)
    return ServiceError(413, "file-too-large", f"The PDF must be smaller than {megabytes:g} MB.")


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

    @app.exception_handler(ServiceError)
    async def service_error(_: Request, error: ServiceError) -> JSONResponse:
        return error_response(error.status, error.code, error.message)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, __: RequestValidationError) -> JSONResponse:
        return error_response(422, "invalid-request", INVALID_REQUEST)

    @app.exception_handler(Exception)
    async def internal_error(_: Request, __: Exception) -> JSONResponse:
        return error_response(500, "internal-error", INTERNAL_ERROR)

    # Refuse an oversized upload from its headers, before the multipart body is parsed.
    @app.middleware("http")
    async def limit_body(request: Request, call_next: Any) -> Any:
        length = request.headers.get("content-length", "")
        if length.isdigit() and int(length) > max_upload_bytes + MULTIPART_OVERHEAD_BYTES:
            error = too_large(max_upload_bytes)
            return error_response(error.status, error.code, error.message)
        return await call_next(request)

    # Added last so it is outermost, and error responses carry CORS headers too.
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
        if file.content_type != "application/pdf":
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
