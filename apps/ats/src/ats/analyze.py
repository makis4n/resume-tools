"""Entry point of the analysis. The HTTP layer, once chosen, calls this."""

from typing import Any

CONTRACT = "ats/v1"


def analyze(pdf: bytes) -> dict[str, Any]:
    """Analyse a resume PDF and return a result matching packages/contracts/ats/v1.

    Placeholder: returns an empty analysis until the real analyser exists.
    """
    if not pdf.startswith(b"%PDF"):
        raise ValueError("not a PDF")
    return {"contract": CONTRACT, "score": None, "findings": []}
