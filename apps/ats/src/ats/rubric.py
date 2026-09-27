"""Scores a set of findings into the ATS-readiness score (decision 0033).

Bump `RUBRIC_VERSION` whenever a check's threshold, severity or deduction changes -- the version
string is the contract's promise that the same findings always score the same way.
"""

from ats.findings import Finding, Severity

RUBRIC_VERSION = "readiness-1"

# Deducted once per distinct finding id, never per occurrence (see `score`'s docstring).
_DEDUCTION_BY_SEVERITY = {
    Severity.CRITICAL: 40,
    Severity.WARNING: 10,
    Severity.INFO: 0,
}

# Any critical finding caps the score here, so a critical problem can never be masked by a high
# number built from many small, unrelated deductions elsewhere.
_CRITICAL_CAP = 40


def score(findings: list[Finding]) -> int:
    """The ATS-readiness score from 0 to 100 for `findings`, under `RUBRIC_VERSION`.

    Starts at 100 and subtracts each finding's deduction once per distinct `id`, not once per
    occurrence: a finding id repeated on every page of a resume (e.g. one layout problem on ten
    pages) is still one problem, and should not multiply a deduction by page count. The result is
    floored at 0 and is always an int.
    """
    deduction_by_id: dict[str, int] = {}
    has_critical = False
    for finding in findings:
        if finding.severity is Severity.CRITICAL:
            has_critical = True
        deduction_by_id[finding.id] = _DEDUCTION_BY_SEVERITY[finding.severity]

    total = 100 - sum(deduction_by_id.values())
    if has_critical:
        total = min(total, _CRITICAL_CAP)
    return max(0, total)
