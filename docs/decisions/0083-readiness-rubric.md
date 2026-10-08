# 0083. The readiness rubric

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
  critical 60, warning 10, info 0. There is no separate cap: a single critical finding, alone,
  already leaves 40, so a cap on top of the deduction would either do nothing or silently forgive
  whatever else is wrong on a resume that already has a critical problem, which this rubric has no
  use for. The floor is 0, and the result is always an int (`ats/rubric.py::score`).
- **Deduplication by id.** A finding id that repeats on several pages deducts once, at its worst
  severity, not once per page: one layout problem present on every page of a resume is still one
  problem, and should not multiply with the page count.
- **Rubric version.** `RUBRIC_VERSION = "readiness-1"` (`ats/rubric.py`). Bump it whenever a
  check's threshold, severity or deduction changes; the version string is the contract's promise
  that the same findings score the same way. Not bumped for a change that adds a new, previously
  silent check with no effect on existing fixtures.
- **Analyser version.** `apps/ats/pyproject.toml`'s version, read via `importlib.metadata`, is
  bumped in every pull request that changes what an analysis returns for some input (a new check,
  a changed threshold, a changed message, a changed object count) -- everything `RUBRIC_VERSION`
  covers, and also changes (message wording, extraction fixes) that do not warrant a rubric-version
  bump on their own but still change the response body.
- **Producer classification** (`ats/producer.py::classify`). Reads the PDF's raw `Producer` and
  `Creator` metadata strings and classifies the tool as `latex`, `word`, `google-docs`, `canva` or
  `other`, matching case-insensitively. The raw strings themselves are read only for this
  classification (`ats.extract.Document.producer`/`.creator`) and are never returned to a client or
  logged; only the classified value crosses the contract.
  - `Producer` is classified alone first, against an ordered rule table starting with LaTeX: it is
    written by the tool itself, not a user-editable field, so there is nothing in it a job seeker's
    own filename could confuse.
  - `Creator` is considered only when `Producer` gives `other`. Word, Google Docs and Canva are
    checked before LaTeX for `Creator`, and a trailing " - <anything>" (such as the filename Word
    appends: "Microsoft Word - resume_latex_style.docx") is stripped first, so a job seeker's own
    filename mentioning another tool's name cannot misclassify the document.
- **Finding ids are a stable API.** Every finding's `id` (e.g. `no-text-layer`, `unmapped-glyphs`)
  is a name other code, tests and, once the panel reads them, clients may rely on. Changing what an
  id means, rather than adding a new one, is a rubric-version bump.
- **Milestone-1 checks and thresholds** (`ats/readiness.py`):
  - `no-text-layer` / `text-as-outlines` / `image-only` (critical, layout): no page has any
    characters. Chosen from the document's total page-object counts: over half of all objects
    being paths (`_MOSTLY_PATHS_THRESHOLD = 0.5`) reads as text exported as outlines; otherwise any
    image object reads as scanned/image-only; otherwise plain `no-text-layer`. Object counts
    recurse into Form XObjects (`ats/extract.py::_count_objects`, common in scanner and
    print-driver output, which often wrap a scanned page's image in one), bounded by a recursion
    depth limit (`_FORM_RECURSION_LIMIT = 8`) and a total-object budget across the whole recursion
    (`_OBJECT_BUDGET = 100,000`), since the page objects walked here come from an untrusted upload
    (PRD §11) and an unbounded walk of a maliciously deep or wide form nesting could be made
    arbitrarily expensive.
  - Outlines versus image-only: a text-less document is `text-as-outlines` only when over half of
    its page objects are paths and either it has no images or it has at least 10 paths
    (`_MIN_OUTLINE_PATHS`); a scan with a border or rule is `image-only`.
  - Extraction classifies at most 200,000 characters per document (`_CHAR_BUDGET`); pages past that
    get only a non-whitespace `char_count`, so an untrusted upload cannot hold the PDFium lock.
  - `blank-page` (warning, layout): a page with no characters, text objects, images or paths, only
    reported when some other page in the document does have text. Requiring `text_objects == 0` as
    well as `char_count == 0` matters: a page can have a text-drawing operation that produced no
    extractable characters, which is not the same as a page with nothing on it at all.
  - `page-count` (info, content): more than 2 pages (`_MAX_EXPECTED_PAGES`), phrased as an
    observation, not an assertion that it is wrong.
  - `unmapped-glyphs` (layout): unmapped characters over 2% of a page's characters
    (`_UNMAPPED_WARNING_THRESHOLD`) warn; over 20% (`_UNMAPPED_CRITICAL_THRESHOLD`) is critical.
  - `icon-font-glyphs` (warning, layout): any Private Use Area character on a page, except one
    drawn in a font Word and other Office tools use for an ordinary bulleted list item -- Symbol,
    Wingdings, Wingdings 2/3 or Webdings, including PostScript-style names such as `SymbolMT`,
    `Wingdings-Regular` and `Symbol,Bold` (`ats.extract._is_symbol_font`) -- which is real, readable
    list content, not an icon font with nothing behind it. A range-based exclusion does not work
    here: FontAwesome and other real icon fonts also sit in the same code-point range Word's
    bullets do, so the font actually drawing the character is what is checked, not just its code
    point.
  - `ligature-characters` (warning, layout): any Latin ligature character (U+FB00–U+FB06) on a
    page. Known limit: this check is currently inert on real PDFs. PDFium expands U+FB00–FB06 into
    plain letters before any text API returns them, so `ligature_count` is always 0; only a unit
    test that patches `FPDFText_GetUnicode` makes it fire. Detecting ligatures needs another
    signal (a font's raw ToUnicode map or glyph names) and is later work.
  - The whole-document text-layer check short-circuits the per-page glyph checks: once nothing on
    a page could be read at all, its individual unmapped glyphs are noise on top of the one finding
    that matters.
- **Suggestions.** Suggestion text is chosen by `(finding id, producer)` in `ats/suggestions.py`,
  with a producer-neutral default. A LaTeX layout finding always gets the neutral "This comes from
  the template's design", never a LaTeX command name, so the panel never shows LaTeX to a user
  (PRD §7.4).
- **Messages state what this product can back up.** A finding's message says what many ATS
  products are likely to do ("many ATSs cannot read...", "may read as garbled text..."), never that
  ATS software in general behaves one way as settled fact: this analyser reads a PDF the way
  PDFium does (decision 0032), not the way any particular vendor's parser does, and the product
  must not claim more certainty about other software's behaviour than that lets it back up.

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
- The symbol-font exclusion is a fixed, curated list of font names, not a general "is this font a
  real typeface" test; an Office tool that ships a differently-named dingbat font in the future
  needs its name added here.
- `producer` and `finding.origin` are closed enums in v1, and the editor rejects a reply with a
  value outside them. Adding a producer (for example `libreoffice`) or an origin is therefore a
  breaking change that needs `ats/v2/`; until then an unrecognised tool is classified `other`.
- Per-page image-only detection is deliberately out of scope for milestone 1: a page that is only a
  scanned image, in a document where another page has text, produces no finding (`no-text-layer`
  and `image-only` fire only when no page has characters, and `blank-page` excludes pages with an
  image). Reporting it needs a new per-page finding id and rubric weight, left to a later milestone.
