import pytest

from ats.analyze import CONTRACT, analyze


def test_returns_contract_shape() -> None:
    result = analyze(b"%PDF-1.7 minimal")
    assert result["contract"] == CONTRACT
    assert set(result) == {"contract", "score", "findings"}


def test_rejects_non_pdf() -> None:
    with pytest.raises(ValueError):
        analyze(b"hello")
