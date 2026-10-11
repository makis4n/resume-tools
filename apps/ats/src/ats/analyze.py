"""Entry point of the analysis. The HTTP layer in `ats.service` calls this."""

from importlib.metadata import version
from typing import Any

from ats.extract import extract
from ats.producer import classify
from ats.readiness import check
from ats.rubric import RUBRIC_VERSION
from ats.rubric import score as score_findings

CONTRACT = "ats/v1"

# Read once at import: the installed package's own version cannot change during the process's
# lifetime, so there is no reason for every request to repeat the package-metadata lookup.
_ANALYSER_VERSION = version("ats")


class NotAPdfError(ValueError):
    """The bytes do not start with a PDF signature."""


def analyze(pdf: bytes) -> dict[str, Any]:
    """Analyse a resume PDF and return a result matching `packages/contracts/ats/v1`.

    Reads the PDF's text and layout facts with `ats.extract`, letting `EncryptedPdfError` and
    `UnreadablePdfError` propagate. Classifies the producing tool (`ats.producer`), runs the
    milestone-1 readiness checks (`ats.readiness`) and scores them (`ats.rubric`). Deterministic:
    the same bytes always give the same result, since nothing here calls a model provider.
    """
    if not pdf.startswith(b"%PDF"):
        raise NotAPdfError("not a PDF")
    document = extract(pdf)
    producer = classify(document.producer, document.creator)
    findings = check(document, producer)
    return {
        "contract": CONTRACT,
        "score": score_findings(findings),
        "findings": [finding.to_json() for finding in findings],
        "producer": producer.value,
        "rubric_version": RUBRIC_VERSION,
        "analyser_version": _ANALYSER_VERSION,
    }
