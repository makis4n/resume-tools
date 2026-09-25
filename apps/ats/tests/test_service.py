import json
import logging
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from ats.service import create_app

CONTRACTS = Path(__file__).parents[3] / "packages" / "contracts" / "ats" / "v1"
EDITOR_ORIGIN = "http://localhost:5173"
MAX_UPLOAD_BYTES = 4096


def load_schema(name: str) -> Draft202012Validator:
    return Draft202012Validator(json.loads((CONTRACTS / name).read_text()))


ANALYSIS = load_schema("analysis.schema.json")
ERROR = load_schema("error.schema.json")


def minimal_pdf(text: str = "Invented Person") -> bytes:
    """A one-page PDF with one line of text, built by hand so the tests need no PDF library."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\n" % (len(objects) + 1)
    out += b"startxref\n%d\n%%%%EOF\n" % xref
    return bytes(out)


@pytest.fixture
def client() -> TestClient:
    app = create_app(max_upload_bytes=MAX_UPLOAD_BYTES, allowed_origins=[EDITOR_ORIGIN])
    return TestClient(app)


def upload(client: TestClient, data: bytes, content_type: str = "application/pdf") -> Any:
    return client.post(
        "/v1/analyze",
        files={"file": ("resume.pdf", data, content_type)},
        headers={"Origin": EDITOR_ORIGIN},
    )


def assert_error(response: Any, status: int, code: str) -> None:
    assert response.status_code == status
    body = response.json()
    ERROR.validate(body)
    assert body["error"]["code"] == code


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_analyze_returns_a_schema_valid_analysis(client: TestClient) -> None:
    response = upload(client, minimal_pdf())
    assert response.status_code == 200
    ANALYSIS.validate(response.json())


def test_rejects_a_declared_type_other_than_pdf(client: TestClient) -> None:
    assert_error(upload(client, minimal_pdf(), "text/plain"), 415, "not-a-pdf")


def test_rejects_bytes_without_a_pdf_signature(client: TestClient) -> None:
    assert_error(upload(client, b"just some text"), 415, "not-a-pdf")


def test_rejects_an_empty_file(client: TestClient) -> None:
    assert_error(upload(client, b""), 415, "not-a-pdf")


def test_rejects_a_file_over_the_limit_after_reading(client: TestClient) -> None:
    oversized = minimal_pdf() + b" " * MAX_UPLOAD_BYTES
    assert_error(upload(client, oversized), 413, "file-too-large")


def test_rejects_a_body_over_the_limit_from_its_headers(client: TestClient) -> None:
    oversized = minimal_pdf() + b" " * (MAX_UPLOAD_BYTES + 128 * 1024)
    response = upload(client, oversized)
    assert_error(response, 413, "file-too-large")
    assert response.headers["access-control-allow-origin"] == EDITOR_ORIGIN


def test_rejects_a_request_without_a_file(client: TestClient) -> None:
    assert_error(client.post("/v1/analyze"), 422, "invalid-request")


def test_allows_the_editor_origin(client: TestClient) -> None:
    response = client.options(
        "/v1/analyze",
        headers={"Origin": EDITOR_ORIGIN, "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == EDITOR_ORIGIN


def test_refuses_other_origins(client: TestClient) -> None:
    response = client.post(
        "/v1/analyze",
        files={"file": ("resume.pdf", minimal_pdf(), "application/pdf")},
        headers={"Origin": "https://elsewhere.example"},
    )
    assert "access-control-allow-origin" not in response.headers


def test_does_not_log_resume_contents(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    marker = "Invented Marker Person"
    with caplog.at_level(logging.DEBUG):
        upload(client, minimal_pdf(marker))
        upload(client, marker.encode())
    assert marker not in caplog.text
