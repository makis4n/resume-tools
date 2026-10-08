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


def test_a_critical_alone_deducts_sixty_leaving_forty() -> None:
    assert score([_finding("no-text-layer", Severity.CRITICAL)]) == 40


def test_a_critical_and_a_warning_deductions_add() -> None:
    # There is no separate cap on top of the deduction: a critical (-60) plus a warning (-10) is
    # -70, not capped at -60, so a resume that is both unreadable and has another problem scores
    # lower than one that is only unreadable.
    findings = [
        _finding("no-text-layer", Severity.CRITICAL),
        _finding("ligature-characters", Severity.WARNING),
    ]
    assert score(findings) == 30


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


def test_a_repeated_id_with_mixed_severities_deducts_at_its_worst_severity() -> None:
    # Same id at WARNING first, then INFO: the critical cap cannot mask a wrong answer here (there
    # is no critical finding at all), so this only passes if the worst severity seen for the id
    # (WARNING, -10) wins, rather than whichever occurrence a naive last-write-wins
    # implementation would keep (the later INFO, -0, which would wrongly score 100).
    findings = [
        _finding("page-count", Severity.WARNING, page=1),
        _finding("page-count", Severity.INFO, page=None),
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
