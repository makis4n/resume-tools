# 0033. The readiness rubric

Date: 2026-09-27 · Status: accepted

## Context

Milestone 1 (`docs/ats-prd.md` §13) needs the first real, deterministic ATS-readiness score, not
the placeholder `analyze` returns today. The PRD leaves the score's dimensions, weights and
thresholds open (§16) for this milestone to settle, subject only to §5's rules: the score must be
reproducible, every finding must carry an origin the user can act on, and the analyser must detect
at least a missing or unusable text layer, page count and glyph-mapping problems (§8.3). The PRD
also asks for producer detection from the PDF's `Producer`/`Creator` metadata, used to choose
suggestion text and never returned raw (§8.3).

## Decision

- **Deduction model.** The score starts at 100. Each finding deducts a fixed amount by severity:
  critical 40, warning 10, info 0. Any critical finding also caps the total at 40, so a critical
  problem can never be hidden behind a high number built from unrelated deductions elsewhere. The
  floor is 0, and the result is always an int (`ats/rubric.py::score`).
- **Deduplication by id.** A finding id that repeats on several pages deducts once, not once per
  page: one layout problem present on every page of a resume is still one problem, and should not
  multiply with the page count.
- **Rubric version.** `RUBRIC_VERSION = "readiness-1"` (`ats/rubric.py`). Bump it whenever a
  check's threshold, severity or deduction changes; the version string is the contract's promise
  that the same findings score the same way. Not bumped for a change that adds a new, previously
  silent check with no effect on existing fixtures.
- **Producer classification.** `ats/producer.py::classify` reads the PDF's raw `Producer` and
  `Creator` metadata strings and classifies the tool as `latex`, `word`, `google-docs`, `canva` or
  `other`, matching case-insensitively against one ordered rule table. The raw strings themselves
  are read only for this classification (`ats.extract.Document.producer`/`.creator`) and are never
  returned to a client or logged; only the classified value crosses the contract.
- **Finding ids are a stable API.** Every finding's `id` (e.g. `no-text-layer`, `unmapped-glyphs`)
  is a name other code, tests and, once the panel reads them, clients may rely on. Changing what an
  id means, rather than adding a new one, is a rubric-version bump.
- **Milestone-1 checks and thresholds** (`ats/readiness.py`):
  - `no-text-layer` / `text-as-outlines` / `image-only` (critical, layout): no page has any
    characters. Chosen from the document's total page-object counts: over half of all objects
    being paths (`_MOSTLY_PATHS_THRESHOLD = 0.5`) reads as text exported as outlines; otherwise any
    image object reads as scanned/image-only; otherwise plain `no-text-layer`.
  - `blank-page` (warning, layout): a page with no characters, images or paths, only reported when
    some other page in the document does have text.
  - `page-count` (info, content): more than 2 pages (`_MAX_EXPECTED_PAGES`), phrased as a
    observation, not an assertion that it is wrong.
  - `unmapped-glyphs` (layout): unmapped characters over 2% of a page's characters
    (`_UNMAPPED_WARNING_THRESHOLD`) warn; over 20% (`_UNMAPPED_CRITICAL_THRESHOLD`) is critical.
  - `icon-font-glyphs` (warning, layout): any Private Use Area character on a page.
  - `ligature-characters` (warning, layout): any Latin ligature character (U+FB00–U+FB06) on a
    page.
  - The whole-document text-layer check short-circuits the per-page glyph checks: once nothing on
    a page could be read at all, its individual unmapped glyphs are noise on top of the one finding
    that matters.
- **Suggestions.** Suggestion text is chosen by `(finding id, producer)` in `ats/suggestions.py`,
  with a producer-neutral default. A LaTeX layout finding always gets the neutral "This comes from
  the template's design", never a LaTeX command name, so the panel never shows LaTeX to a user
  (PRD §7.4).

## Consequences

- Simple and explainable rather than calibrated: fixed deductions and round-number thresholds, not
  numbers tuned against real resumes. Tuning them against the fixture corpus (PRD §12.1) is later
  work, and that tuning bumps `RUBRIC_VERSION`.
- No per-dimension score breakdown yet (PRD §16's "score dimensions, weights and thresholds" is
  otherwise still open past what this record settles): the contract carries one readiness `score`
  plus its findings, not separate content/layout numbers.
- Producer classification is a heuristic on free-text metadata fields tools are not required to
  fill in consistently; `other` is the safe default when it cannot tell.
- Because finding ids are relied on as stable, adding a check is free but renaming or repurposing
  an existing id is a breaking change to reason about like any other contract change.
