from ats.findings import Finding, Origin, Severity
from ats.rubric import score


def _finding(id: str, severity: Severity, page: int | None = None) -> Finding:
    return Finding(id=id, severity=severity, origin=Origin.LAYOUT, message="invented", page=page)


def test_no_findings_scores_100() -> None:
    assert score([]) == 100


def test_info_findings_deduct_nothing() -> None:
    assert score([_finding("page-count", Severity.INFO)]) == 100


def test_a_warning_deducts_ten() -> None:
    assert score([_finding("ligature-characters", Severity.WARNING)]) == 90


def test_a_critical_deducts_forty_and_caps_at_forty() -> None:
    assert score([_finding("no-text-layer", Severity.CRITICAL)]) == 40


def test_a_critical_caps_the_score_even_with_few_other_deductions() -> None:
    # One critical (-40, capped at 40) plus one warning (-10) would otherwise total 50, but the
    # cap means a critical problem is never hidden behind a higher number.
    findings = [
        _finding("no-text-layer", Severity.CRITICAL),
        _finding("ligature-characters", Severity.WARNING),
    ]
    assert score(findings) == 40


def test_many_warnings_floor_at_zero() -> None:
    findings = [_finding(f"warning-{i}", Severity.WARNING) for i in range(15)]
    assert score(findings) == 0


def test_a_repeated_id_across_pages_deducts_once() -> None:
    findings = [
        _finding("unmapped-glyphs", Severity.WARNING, page=1),
        _finding("unmapped-glyphs", Severity.WARNING, page=2),
        _finding("unmapped-glyphs", Severity.WARNING, page=3),
    ]
    assert score(findings) == 90


def test_distinct_ids_each_deduct() -> None:
    findings = [
        _finding("blank-page", Severity.WARNING, page=1),
        _finding("icon-font-glyphs", Severity.WARNING, page=1),
    ]
    assert score(findings) == 80


def test_score_is_always_an_int() -> None:
    assert isinstance(score([]), int)
    assert isinstance(score([_finding("no-text-layer", Severity.CRITICAL)]), int)
