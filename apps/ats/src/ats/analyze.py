"""Entry point of the analysis. The HTTP layer in `ats.service` calls this."""

from typing import Any

from ats.extract import extract

CONTRACT = "ats/v1"


class NotAPdfError(ValueError):
    """The bytes do not start with a PDF signature."""


def analyze(pdf: bytes) -> dict[str, Any]:
    """Analyse a resume PDF and return a result matching packages/contracts/ats/v1.

    Reads the PDF's text with `ats.extract`, letting `EncryptedPdfError` and `UnreadablePdfError`
    propagate. Scoring and findings are still a placeholder until the real analyser exists.
    """
    if not pdf.startswith(b"%PDF"):
        raise NotAPdfError("not a PDF")
    extract(pdf)
    return {"contract": CONTRACT, "score": None, "findings": []}
