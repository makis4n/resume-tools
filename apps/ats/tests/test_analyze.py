import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from ats.analyze import CONTRACT, analyze
from ats.extract import UnreadablePdfError
from ats.rubric import RUBRIC_VERSION
from tests.pdfs import (
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
    result = analyze(minimal_pdf())
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


def test_an_interleaved_two_column_pdf_gets_one_finding_and_scores_90() -> None:
    for offset in (0.0, 4.0):
        result = analyze(interleaved_two_column_pdf(offset))
        assert [f["id"] for f in result["findings"]] == ["column-interleaving"]
        assert result["score"] == 90
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
def test_layouts_that_read_in_order_have_no_findings(build) -> None:  # type: ignore[no-untyped-def]
    result = analyze(build())
    assert result["findings"] == []
    assert result["score"] == 100


def test_a_hyphenated_line_break_is_flagged() -> None:
    result = analyze(hyphenated_pdf())
    assert [f["id"] for f in result["findings"]] == ["hyphenated-line-breaks"]
    SCHEMA.validate(result)
