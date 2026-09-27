import pytest

from ats.analyze import CONTRACT, analyze
from ats.extract import UnreadablePdfError
from tests.pdfs import minimal_pdf


def test_returns_contract_shape() -> None:
    result = analyze(minimal_pdf())
    assert result["contract"] == CONTRACT
    assert set(result) == {"contract", "score", "findings"}


def test_rejects_non_pdf() -> None:
    with pytest.raises(ValueError):
        analyze(b"hello")


def test_rejects_a_pdf_signature_with_an_unreadable_body() -> None:
    with pytest.raises(UnreadablePdfError):
        analyze(b"%PDF-1.7 minimal")
