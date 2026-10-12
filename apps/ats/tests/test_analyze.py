import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from ats.analyze import CONTRACT, analyze
from ats.extract import UnreadablePdfError
from ats.rubric import RUBRIC_VERSION
from tests.pdfs import (
    RESUME_EMAIL,
    RESUME_LINK,
    RESUME_PHONE,
    build_pdf,
    clean_two_column_pdf,
    date_column_pdf,
    dated_list_pdf,
    education_rows_pdf,
    hyphenated_pdf,
    image_only_pdf,
    interleaved_two_column_pdf,
    label_value_table_pdf,
    minimal_pdf,
    resume_pdf,
    single_column_with_dates_pdf,
    skills_grid_pdf,
)

SCHEMA = Draft202012Validator(
    json.loads(
        (Path(__file__).parents[3] / "packages/contracts/ats/v1/analysis.schema.json").read_text()
    )
)


def test_returns_contract_shape() -> None:
    result = analyze(minimal_pdf())
    assert result["contract"] == CONTRACT
    assert set(result) == {
        "contract",
        "score",
        "findings",
        "producer",
        "rubric_version",
        "analyser_version",
    }


def test_a_clean_one_page_pdf_scores_100_with_no_findings() -> None:
    result = analyze(resume_pdf())
    assert result["score"] == 100
    assert result["findings"] == []
    assert result["producer"] == "other"
    assert result["rubric_version"] == RUBRIC_VERSION
    assert isinstance(result["analyser_version"], str) and result["analyser_version"]


def test_a_text_less_pdf_gets_a_critical_finding_and_a_low_score() -> None:
    result = analyze(image_only_pdf())
    assert result["score"] <= 40
    assert any(f["severity"] == "critical" for f in result["findings"])
    assert all(f["id"] != "unmapped-glyphs" for f in result["findings"])


def test_producer_is_classified_from_metadata() -> None:
    pdf = build_pdf([[("Invented Text", 72, 700)]], producer="Canva")
    assert analyze(pdf)["producer"] == "canva"


def test_analysis_is_deterministic() -> None:
    pdf = minimal_pdf()
    assert analyze(pdf) == analyze(pdf)


def test_findings_are_the_contract_shape() -> None:
    result = analyze(image_only_pdf())
    for finding in result["findings"]:
        assert set(finding) <= {"id", "severity", "origin", "message", "page", "suggestion"}
        assert {"id", "severity", "origin", "message"} <= set(finding)


def test_rejects_non_pdf() -> None:
    with pytest.raises(ValueError):
        analyze(b"hello")


def test_rejects_a_pdf_signature_with_an_unreadable_body() -> None:
    with pytest.raises(UnreadablePdfError):
        analyze(b"%PDF-1.7 minimal")


def _layout_ids(result: dict) -> list[str]:  # type: ignore[type-arg]
    # These fixtures carry no contact details or headings, so content findings (decision 0085)
    # fire too; the reading-order tests look at layout findings only.
    return [f["id"] for f in result["findings"] if f["origin"] == "layout"]


def test_an_interleaved_two_column_pdf_gets_one_layout_finding() -> None:
    for offset in (0.0, 4.0):
        result = analyze(interleaved_two_column_pdf(offset))
        assert _layout_ids(result) == ["column-interleaving"]
        assert result["rubric_version"] == RUBRIC_VERSION
        SCHEMA.validate(result)


@pytest.mark.parametrize(
    "build",
    [
        clean_two_column_pdf,
        single_column_with_dates_pdf,
        skills_grid_pdf,
        dated_list_pdf,
        label_value_table_pdf,
        education_rows_pdf,
        date_column_pdf,
    ],
)
def test_layouts_that_read_in_order_have_no_layout_findings(build) -> None:  # type: ignore[no-untyped-def]
    assert _layout_ids(analyze(build())) == []


def test_a_hyphenated_line_break_is_flagged() -> None:
    result = analyze(hyphenated_pdf())
    assert _layout_ids(result) == ["hyphenated-line-breaks"]
    SCHEMA.validate(result)


def test_a_pdf_with_no_contact_details_or_headings_gets_content_findings() -> None:
    result = analyze(minimal_pdf())
    ids = [f["id"] for f in result["findings"]]
    assert "missing-contact-email" in ids
    assert "missing-section-experience" in ids
    assert result["score"] == 80
    assert result["rubric_version"] == "readiness-1"
    assert result["analyser_version"] == "0.3.0"


def test_the_analysis_carries_none_of_the_detected_contact_details() -> None:
    dumped = json.dumps(analyze(resume_pdf()))
    assert RESUME_EMAIL not in dumped
    assert "555 010 0199" not in dumped and RESUME_PHONE not in dumped
    assert RESUME_LINK not in dumped
