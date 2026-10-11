"""Scores a set of findings into the ATS-readiness score (decision 0083).

Bump `RUBRIC_VERSION` whenever a check's threshold, severity or deduction changes -- the version
string is the contract's promise that the same findings always score the same way.
"""

from ats.findings import Finding, Severity

RUBRIC_VERSION = "readiness-1"

# Deducted once per distinct finding id, never per occurrence (see `score`'s docstring). A single
# critical finding, alone, leaves a score of 40 (100 - 60): there is no separate cap on top of
# this, since one would either do nothing (once the critical deduction alone already reaches the
# cap) or silently forgive whatever else is wrong on the same resume once a critical is already
# present, which is not a distinction this rubric needs.
_DEDUCTION_BY_SEVERITY = {
    Severity.CRITICAL: 60,
    Severity.WARNING: 10,
    Severity.INFO: 0,
}


def score(findings: list[Finding]) -> int:
    """The ATS-readiness score from 0 to 100 for `findings`, under `RUBRIC_VERSION`.

    Starts at 100 and subtracts each finding's deduction once per distinct `id`, not once per
    occurrence: a finding id repeated on every page of a resume (e.g. one layout problem on ten
    pages) is still one problem, and should not multiply a deduction by page count. If the same id
    recurs at different severities (e.g. a warning-level glyph problem on one page and a
    critical-level one on another), the id deducts at its worst severity, not whichever occurrence
    the loop happened to see last. The result is floored at 0 and is always an int.
    """
    deduction_by_id: dict[str, int] = {}
    for finding in findings:
        deduction = _DEDUCTION_BY_SEVERITY[finding.severity]
        deduction_by_id[finding.id] = max(deduction_by_id.get(finding.id, 0), deduction)

    return max(0, 100 - sum(deduction_by_id.values()))
