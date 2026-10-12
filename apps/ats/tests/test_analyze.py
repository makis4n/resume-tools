import pytest

from ats.analyze import CONTRACT, analyze
from ats.extract import UnreadablePdfError
from ats.rubric import RUBRIC_VERSION
from tests.pdfs import (
    build_pdf,
    hidden_stuffing_resume_pdf,
    image_only_pdf,
    minimal_pdf,
    normal_resume_pdf,
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


def test_a_resume_with_hidden_keywords_gets_a_critical_content_finding() -> None:
    result = analyze(hidden_stuffing_resume_pdf())
    (finding,) = [f for f in result["findings"] if f["id"] == "hidden-text"]
    assert finding["severity"] == "critical"
    assert finding["origin"] == "content"
    assert result["score"] <= 40


def test_a_normal_resume_still_scores_100_under_the_same_rubric() -> None:
    result = analyze(normal_resume_pdf())
    assert result["score"] == 100
    assert result["findings"] == []
    assert result["rubric_version"] == "readiness-1"
    assert analyze(minimal_pdf())["score"] == 100


def test_the_analyser_version_is_0_2_0() -> None:
    assert analyze(minimal_pdf())["analyser_version"] == "0.2.0"
