import json
import logging
import multiprocessing
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from ats.service import create_app, readable_size
from tests import slow
from tests.pdfs import image_only_pdf, malformed_page_tree_pdf, minimal_pdf, zero_page_pdf

CONTRACTS = Path(__file__).parents[3] / "packages" / "contracts" / "ats" / "v1"
FIXTURES = Path(__file__).parent / "fixtures"
EDITOR_ORIGIN = "http://localhost:5173"
MAX_UPLOAD_BYTES = 4096


def load_schema(name: str) -> Draft202012Validator:
    return Draft202012Validator(json.loads((CONTRACTS / name).read_text()))


ANALYSIS = load_schema("analysis.schema.json")
ERROR = load_schema("error.schema.json")


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


def test_sizes_read_naturally() -> None:
    sizes = (5 * 1024**2, 1572864, 4096, 5 * 1024**2 - 1, 1024**2 - 1)
    assert [readable_size(size) for size in sizes] == [
        "5 MB",
        "1.5 MB",
        "4 KB",
        "4.9 MB",
        "1023.9 KB",
    ]


def test_analyze_returns_a_schema_valid_analysis(client: TestClient) -> None:
    response = upload(client, minimal_pdf())
    assert response.status_code == 200
    ANALYSIS.validate(response.json())


def test_a_clean_one_page_pdf_scores_100_with_no_findings(client: TestClient) -> None:
    response = upload(client, minimal_pdf())
    body = response.json()
    ANALYSIS.validate(body)
    assert body["score"] == 100
    assert body["findings"] == []


def test_a_text_less_pdf_returns_a_critical_finding(client: TestClient) -> None:
    response = upload(client, image_only_pdf())
    assert response.status_code == 200
    body = response.json()
    ANALYSIS.validate(body)
    assert any(f["severity"] == "critical" for f in body["findings"])


def test_accepts_a_pdf_declared_with_a_generic_type(client: TestClient) -> None:
    response = upload(client, minimal_pdf(), "application/octet-stream")
    assert response.status_code == 200
    ANALYSIS.validate(response.json())


@pytest.mark.parametrize("content_type", ["application/pdf; charset=binary", "Application/PDF"])
def test_accepts_a_pdf_type_with_parameters_or_capitals(
    client: TestClient, content_type: str
) -> None:
    assert upload(client, minimal_pdf(), content_type).status_code == 200


def test_the_contract_tolerates_properties_it_does_not_know() -> None:
    ANALYSIS.validate({"contract": "ats/v1", "score": None, "findings": [], "added_later": 1})


def test_rejects_a_declared_type_other_than_pdf(client: TestClient) -> None:
    assert_error(upload(client, minimal_pdf(), "text/plain"), 415, "not-a-pdf")


def test_rejects_bytes_without_a_pdf_signature(client: TestClient) -> None:
    assert_error(upload(client, b"just some text"), 415, "not-a-pdf")


def test_rejects_an_empty_file(client: TestClient) -> None:
    assert_error(upload(client, b""), 415, "not-a-pdf")


def test_rejects_an_encrypted_pdf(client: TestClient) -> None:
    encrypted = (FIXTURES / "encrypted.pdf").read_bytes()
    assert_error(upload(client, encrypted), 422, "pdf-encrypted")


def test_rejects_a_damaged_pdf(client: TestClient) -> None:
    damaged = b"%PDF-1.4\n" + b"not a real pdf body" * 20
    assert_error(upload(client, damaged), 422, "pdf-unreadable")


def test_rejects_a_pdf_whose_document_opens_but_whose_page_does_not(client: TestClient) -> None:
    assert_error(upload(client, malformed_page_tree_pdf()), 422, "pdf-unreadable")


def test_rejects_a_pdf_with_zero_pages(client: TestClient) -> None:
    assert_error(upload(client, zero_page_pdf()), 422, "pdf-unreadable")


def test_rejects_a_file_over_the_limit_after_reading(client: TestClient) -> None:
    oversized = minimal_pdf() + b" " * MAX_UPLOAD_BYTES
    response = upload(client, oversized)
    assert_error(response, 413, "file-too-large")
    assert response.json()["error"]["message"] == "The PDF must be 4 KB or smaller."


def test_rejects_a_body_over_the_limit_from_its_headers(client: TestClient) -> None:
    oversized = minimal_pdf() + b" " * (MAX_UPLOAD_BYTES + 128 * 1024)
    response = upload(client, oversized)
    assert_error(response, 413, "file-too-large")
    assert response.headers["access-control-allow-origin"] == EDITOR_ORIGIN


def test_rejects_an_undeclared_body_over_the_limit(client: TestClient) -> None:
    boundary = "invented-boundary"
    head = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="resume.pdf"\r\n'
        "Content-Type: application/pdf\r\n\r\n"
    ).encode()

    def body() -> Iterator[bytes]:
        yield head + minimal_pdf()
        for _ in range(200):
            yield b" " * 1024
        yield f"\r\n--{boundary}--\r\n".encode()

    response = client.post(
        "/v1/analyze",
        content=body(),
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Origin": EDITOR_ORIGIN,
        },
    )
    assert "content-length" not in response.request.headers
    assert_error(response, 413, "file-too-large")
    assert response.headers["access-control-allow-origin"] == EDITOR_ORIGIN


def test_rejects_a_request_without_a_file(client: TestClient) -> None:
    assert_error(client.post("/v1/analyze"), 422, "invalid-request")


def test_unknown_paths_and_methods_follow_the_error_contract(client: TestClient) -> None:
    assert_error(client.get("/v1/nothing"), 404, "not-found")
    response = client.get("/v1/analyze")
    assert_error(response, 405, "method-not-allowed")
    assert response.headers["allow"] == "POST"


def test_an_unexpected_error_follows_the_contract_without_leaking(
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = create_app(
        max_upload_bytes=MAX_UPLOAD_BYTES,
        allowed_origins=[EDITOR_ORIGIN],
        analyser=slow.raise_invented_error,
    )
    with caplog.at_level(logging.DEBUG):
        response = upload(TestClient(app), minimal_pdf())
    assert_error(response, 500, "internal-error")
    assert response.headers["access-control-allow-origin"] == EDITOR_ORIGIN
    assert "Invented Street" not in response.text
    assert "Invented Street" not in caplog.text
    assert "RuntimeError" in caplog.text


def test_allows_the_editor_origin(client: TestClient) -> None:
    response = client.options(
        "/v1/analyze",
        headers={"Origin": EDITOR_ORIGIN, "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == EDITOR_ORIGIN


@pytest.mark.parametrize(
    ("origin", "method"),
    [(EDITOR_ORIGIN, "PUT"), ("https://elsewhere.example", "POST")],
)
def test_a_refused_preflight_is_plain_text(client: TestClient, origin: str, method: str) -> None:
    # error.schema.json excludes this reply; browsers never show it to page code.
    response = client.options(
        "/v1/analyze",
        headers={"Origin": origin, "Access-Control-Request-Method": method},
    )
    assert response.status_code == 400
    assert response.headers["content-type"].startswith("text/plain")


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


def test_an_error_keeps_safe_headers_but_not_framing_ones() -> None:
    app = create_app(max_upload_bytes=MAX_UPLOAD_BYTES, allowed_origins=[EDITOR_ORIGIN])

    @app.get("/limited")
    async def limited() -> None:
        raise HTTPException(429, headers={"Retry-After": "5", "Content-Type": "text/plain"})

    response = TestClient(app).get("/limited")
    assert_error(response, 429, "http-error")
    assert response.headers["retry-after"] == "5"
    assert response.headers["content-type"] == "application/json"


def limited_client(per_minute: int = 2, **kwargs: Any) -> TestClient:
    app = create_app(
        max_upload_bytes=MAX_UPLOAD_BYTES,
        allowed_origins=[EDITOR_ORIGIN],
        analyze_rate_limit_per_minute=per_minute,
        **kwargs,
    )
    return TestClient(app)


def test_the_request_after_the_budget_is_rate_limited_with_cors_headers() -> None:
    client = limited_client()
    assert upload(client, minimal_pdf()).status_code == 200
    assert upload(client, minimal_pdf()).status_code == 200
    response = upload(client, minimal_pdf())
    assert_error(response, 429, "rate-limited")
    assert response.headers["retry-after"].isdigit()
    assert int(response.headers["retry-after"]) >= 1
    assert response.headers["access-control-allow-origin"] == EDITOR_ORIGIN
    assert "retry-after" in response.headers["access-control-expose-headers"].lower()


def test_a_rate_limited_request_is_refused_before_its_body_is_read() -> None:
    client = limited_client(1)
    assert upload(client, minimal_pdf()).status_code == 200
    oversized = minimal_pdf() + b" " * (MAX_UPLOAD_BYTES + 128 * 1024)
    assert_error(upload(client, oversized), 429, "rate-limited")


def test_preflights_health_and_unknown_paths_do_not_use_the_budget() -> None:
    client = limited_client(1)
    for _ in range(3):
        client.options(
            "/v1/analyze",
            headers={"Origin": EDITOR_ORIGIN, "Access-Control-Request-Method": "POST"},
        )
        assert client.get("/health").status_code == 200
        assert client.post("/v1/nothing").status_code == 404
    assert upload(client, minimal_pdf()).status_code == 200


def test_a_limit_of_zero_turns_the_rate_limit_off() -> None:
    client = limited_client(0)
    assert all(upload(client, b"text").status_code == 415 for _ in range(15))


def test_settings_are_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ATS_ANALYZE_RATE_LIMIT_PER_MINUTE", "1")
    client = TestClient(create_app(allowed_origins=[EDITOR_ORIGIN]))
    assert upload(client, minimal_pdf()).status_code == 200
    assert_error(upload(client, minimal_pdf()), 429, "rate-limited")


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("ATS_ANALYZE_RATE_LIMIT_PER_MINUTE", "-1"),
        ("ATS_ANALYZE_RATE_LIMIT_PER_MINUTE", "lots"),
        ("ATS_RATE_LIMIT_MAX_CLIENTS", "0"),
        ("ATS_TRUSTED_PROXY_HOPS", "-1"),
        ("ATS_ANALYSIS_TIMEOUT_SECONDS", "0"),
        ("ATS_ANALYSIS_TIMEOUT_SECONDS", "-2"),
        ("ATS_ANALYSIS_TIMEOUT_SECONDS", "soon"),
        ("ATS_ANALYSIS_TIMEOUT_SECONDS", "inf"),
        ("ATS_ANALYSIS_TIMEOUT_SECONDS", "nan"),
        ("ATS_ANALYSIS_TIMEOUT_SECONDS", "1e9"),
        ("ATS_SLOT_WAIT_SECONDS", "-1"),
        ("ATS_SLOT_WAIT_SECONDS", "inf"),
        ("ATS_SLOT_WAIT_SECONDS", "1e30"),
    ],
)
def test_an_invalid_setting_is_refused_naming_the_variable(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=name):
        create_app()


def test_an_analysis_over_the_time_limit_is_killed() -> None:
    app = create_app(
        max_upload_bytes=MAX_UPLOAD_BYTES,
        allowed_origins=[EDITOR_ORIGIN],
        analysis_timeout_seconds=0.5,
        analyser=slow.sleep_forever,
    )
    started = time.monotonic()
    response = upload(TestClient(app), minimal_pdf())
    assert_error(response, 422, "analysis-timeout")
    assert time.monotonic() - started < 5
    assert multiprocessing.active_children() == []


def test_a_crashing_analysis_is_a_500_and_the_service_carries_on() -> None:
    app = create_app(
        max_upload_bytes=MAX_UPLOAD_BYTES,
        allowed_origins=[EDITOR_ORIGIN],
        analyser=slow.hard_exit,
    )
    client = TestClient(app)
    assert_error(upload(client, minimal_pdf()), 500, "internal-error")
    assert client.get("/health").status_code == 200
    assert_error(upload(client, minimal_pdf()), 500, "internal-error")


def test_a_request_that_finds_every_analysis_slot_taken_is_told_the_service_is_busy() -> None:
    from ats import timelimit

    app = create_app(
        max_upload_bytes=MAX_UPLOAD_BYTES,
        allowed_origins=[EDITOR_ORIGIN],
        analyze_rate_limit_per_minute=0,
        slot_wait_seconds=0.2,
    )
    held = 0
    try:
        while timelimit._SLOTS.acquire(blocking=False):
            held += 1
        started = time.monotonic()
        response = upload(TestClient(app), minimal_pdf())
    finally:
        for _ in range(held):
            timelimit._SLOTS.release()
    assert_error(response, 503, "server-busy")
    assert response.headers["Retry-After"] == "5"
    assert time.monotonic() - started < 3
