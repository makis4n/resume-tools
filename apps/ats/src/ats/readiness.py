"""Deterministic readiness checks for one extracted PDF (decision 0083); `ats.rubric` scores their
output. `check` covers milestone 1's checks so far: text layer, page count, glyph mapping, hidden
text and keyword repetition (decision 0087). Contact/section checks, reading order and rate limits
are later milestones.

Every message and suggestion string these checks use lives here or in `ats.suggestions`; nothing
here quotes resume text, and no message asserts a specific ATS behaviour this product cannot back
up.
"""

import re

from ats.extract import Document
from ats.findings import Finding, Origin, Severity
from ats.producer import Producer
from ats.suggestions import suggestion_for

# Above this fraction of a document's total page objects being paths, with no usable text anywhere,
# the text was very likely exported as vector outlines (as some PDF "flatten" options do) rather
# than simply missing -- e.g. Canva's text-as-outlines export (PRD §12.1).
_MOSTLY_PATHS_THRESHOLD = 0.5

# Outlined text is drawn as many glyph shapes, so a document with images needs at least this many
# path objects before it is called outlines: a scanned page with a border or rule has a couple of
# paths next to its one big image and is `image-only`, not outlined text.
_MIN_OUTLINE_PATHS = 10

# A page's unmapped glyphs above this fraction of its characters are enough to warn; above the
# second threshold the page is unreadable enough to call it critical (decision 0083).
_UNMAPPED_WARNING_THRESHOLD = 0.02
_UNMAPPED_CRITICAL_THRESHOLD = 0.20

# Hidden text (decision 0087): a page needs at least this many hidden characters to be reported,
# which ignores stray artifacts such as a white bullet or one invisible anchor.
_MIN_HIDDEN_CHARS = 20

# Keyword repetition (decision 0087). The text read is cut to this many characters before it is
# lowercased or tokenised, so a huge page cannot make the scan expensive.
_REPETITION_TEXT_BUDGET = 200_000
# Frequency rule: a word needs this many occurrences and this share of all words.
_REPEAT_MIN_COUNT = 25
_REPEAT_MIN_SHARE = 0.05
# Run rule: the same 1-3 word sequence back to back this many times.
_REPEAT_RUN = 5
_MAX_RUN_LENGTH = 3

# Words that repeat in any prose and say nothing about keyword stuffing.
_STOPWORDS = frozenset(
    """a an the of in on at to for from by with as into over under about between through during
    and or but nor so yet if than then that this these those it its he she they them his her their
    we our you your i me my us who whom which what when where while is was were be been are am
    not no""".split()
)
_TOKEN = re.compile(r"[^\W_][\w+#.]*[\w+#]|[^\W_]")

# More than this many pages triggers `page-count`; most resumes fit on one or two (PRD §8.3).
_MAX_EXPECTED_PAGES = 2

NO_TEXT_LAYER_MESSAGE = (
    "No selectable text was found in this PDF. Many ATSs cannot read a resume like this at all."
)
TEXT_AS_OUTLINES_MESSAGE = (
    "The text on this resume appears to be drawn as shapes rather than real characters. Many "
    "ATSs cannot read text like this."
)
IMAGE_ONLY_MESSAGE = (
    "This resume looks scanned or exported as an image. Many ATSs cannot read text from an image."
)
BLANK_PAGE_MESSAGE = "This page has no readable text, image or drawn content."
PAGE_COUNT_MESSAGE = (
    "This resume is {count} pages long. Most resumes fit on one or two pages, though longer can "
    "be appropriate for some careers."
)
UNMAPPED_GLYPHS_MESSAGE = (
    "Some characters on this page have no readable mapping to text, so this content may read as "
    "garbled text or be missed entirely when an ATS extracts it."
)
ICON_FONT_GLYPHS_MESSAGE = (
    "This page uses icon or symbol glyphs with no real text behind them, which many ATSs cannot "
    "read."
)
HIDDEN_TEXT_MESSAGE = (
    "Some text on this page cannot be seen by a reader ({reasons}). An ATS still reads it, and a "
    "recruiter who sees the extracted text may take it as an attempt to game keyword matching."
)
REPEATED_TERMS_MESSAGE = (
    "Some words or phrases on this resume are repeated far more often than resume text normally "
    "repeats them. A recruiter may read this as keyword stuffing, and some ATSs may discount it."
)
LIGATURE_MESSAGE = (
    'This page contains ligature characters (letter pairs like "fi" or "fl" joined into a single '
    'glyph), so a word like "profile" may not be found by a keyword search that only looks for '
    "plain letters."
)

# The fixed order findings are sorted into within a page (see `check`'s docstring). Document-level
# findings carry no page, so they sort ahead of every per-page finding.
_ID_ORDER = (
    "no-text-layer",
    "text-as-outlines",
    "image-only",
    "page-count",
    "blank-page",
    "unmapped-glyphs",
    "icon-font-glyphs",
    "ligature-characters",
    "hidden-text",
    "repeated-terms",
)
# A lookup, not `_ID_ORDER.index(...)` at sort time: an id a future check forgets to add here
# then sorts after every listed one instead of crashing `check()` outright.
_ID_ORDER_INDEX = {finding_id: index for index, finding_id in enumerate(_ID_ORDER)}


def _no_text_layer_finding(document: Document, producer: Producer) -> Finding:
    """The single document-wide finding for when no page has any characters at all.

    Chooses among `text-as-outlines`, `image-only` and plain `no-text-layer` from the document's
    total page-object counts: see `_MOSTLY_PATHS_THRESHOLD`. Every choice builds the same
    `Finding` shape, so only the id and message need choosing before building it once.
    """
    total_paths = sum(page.path_objects for page in document.pages)
    total_images = sum(page.image_objects for page in document.pages)
    total_texts = sum(page.text_objects for page in document.pages)
    total_objects = total_paths + total_images + total_texts

    mostly_paths = total_objects > 0 and total_paths / total_objects > _MOSTLY_PATHS_THRESHOLD
    if mostly_paths and (total_images == 0 or total_paths >= _MIN_OUTLINE_PATHS):
        finding_id, message = "text-as-outlines", TEXT_AS_OUTLINES_MESSAGE
    elif total_images > 0:
        finding_id, message = "image-only", IMAGE_ONLY_MESSAGE
    else:
        finding_id, message = "no-text-layer", NO_TEXT_LAYER_MESSAGE

    return Finding(
        id=finding_id,
        severity=Severity.CRITICAL,
        origin=Origin.LAYOUT,
        message=message,
        suggestion=suggestion_for(finding_id, producer),
    )


def _page_count_findings(document: Document) -> list[Finding]:
    count = len(document.pages)
    if count <= _MAX_EXPECTED_PAGES:
        return []
    return [
        Finding(
            id="page-count",
            severity=Severity.INFO,
            origin=Origin.CONTENT,
            message=PAGE_COUNT_MESSAGE.format(count=count),
        )
    ]


def _blank_page_findings(document: Document, has_text: bool) -> list[Finding]:
    """A page with no characters, text objects, images or paths at all, but only when some other
    page in the document does have text -- otherwise every page is blank and `no-text-layer`
    already covers the whole document.

    `text_objects == 0` is required alongside `char_count == 0`: a page can have a text-drawing
    operation that produced no extractable characters (e.g. invisible text, or a font PDFium could
    not read at all), which is not the same as a page with nothing on it, and should not be called
    "blank"."""
    if not has_text:
        return []
    return [
        Finding(
            id="blank-page",
            severity=Severity.WARNING,
            origin=Origin.LAYOUT,
            message=BLANK_PAGE_MESSAGE,
            page=page.number,
        )
        for page in document.pages
        if page.char_count == 0
        and page.text_objects == 0
        and page.image_objects == 0
        and page.path_objects == 0
    ]


def _glyph_findings(document: Document, producer: Producer) -> list[Finding]:
    """Per-page glyph-mapping findings. Only called when the document has a text layer at all:
    see `check`'s short-circuit."""
    findings: list[Finding] = []
    for page in document.pages:
        if page.char_count == 0:
            continue

        unmapped_fraction = page.unmapped_count / page.char_count
        if unmapped_fraction > _UNMAPPED_CRITICAL_THRESHOLD:
            severity = Severity.CRITICAL
        elif unmapped_fraction > _UNMAPPED_WARNING_THRESHOLD:
            severity = Severity.WARNING
        else:
            severity = None
        if severity is not None:
            findings.append(
                Finding(
                    id="unmapped-glyphs",
                    severity=severity,
                    origin=Origin.LAYOUT,
                    message=UNMAPPED_GLYPHS_MESSAGE,
                    page=page.number,
                    suggestion=suggestion_for("unmapped-glyphs", producer),
                )
            )

        if page.private_use_count > 0:
            findings.append(
                Finding(
                    id="icon-font-glyphs",
                    severity=Severity.WARNING,
                    origin=Origin.LAYOUT,
                    message=ICON_FONT_GLYPHS_MESSAGE,
                    page=page.number,
                    suggestion=suggestion_for("icon-font-glyphs", producer),
                )
            )

        if page.ligature_count > 0:
            findings.append(
                Finding(
                    id="ligature-characters",
                    severity=Severity.WARNING,
                    origin=Origin.LAYOUT,
                    message=LIGATURE_MESSAGE,
                    page=page.number,
                    suggestion=suggestion_for("ligature-characters", producer),
                )
            )
    return findings


# (Page attribute, phrase) in the fixed order the reasons are listed in a hidden-text message.
_HIDDEN_REASONS = (
    ("invisible_count", "drawn invisibly"),
    ("background_colour_count", "coloured to match the background"),
    ("tiny_count", "too small to read"),
    ("off_page_count", "placed outside the page"),
)


def _join_reasons(phrases: list[str]) -> str:
    if len(phrases) <= 1:
        return "".join(phrases)
    return ", ".join(phrases[:-1]) + " and " + phrases[-1]


def _hidden_text_findings(document: Document, producer: Producer) -> list[Finding]:
    """One `hidden-text` finding per page with enough hidden characters. Never names page text."""
    findings: list[Finding] = []
    for page in document.pages:
        if page.hidden_count < _MIN_HIDDEN_CHARS:
            continue
        reasons = [phrase for attr, phrase in _HIDDEN_REASONS if getattr(page, attr) > 0]
        findings.append(
            Finding(
                id="hidden-text",
                severity=Severity.CRITICAL,
                origin=Origin.CONTENT,
                message=HIDDEN_TEXT_MESSAGE.format(reasons=_join_reasons(reasons)),
                page=page.number,
                suggestion=suggestion_for("hidden-text", producer),
            )
        )
    return findings


def _repetition_text(document: Document) -> str:
    """The pages' text joined by newlines, cut to `_REPETITION_TEXT_BUDGET` characters while
    joining, so a page with millions of characters is never fully copied."""
    parts: list[str] = []
    remaining = _REPETITION_TEXT_BUDGET
    for page in document.pages:
        if remaining <= 0:
            break
        piece = page.text[:remaining]
        parts.append(piece)
        remaining -= len(piece) + 1
    return "\n".join(parts)


def _is_content_token(token: str) -> bool:
    return len(token) >= 2 and not token.isdigit() and token not in _STOPWORDS


def _is_repeated(tokens: list[str], lines: list[int] | None = None) -> bool:
    """`lines[i]` numbers the text line token `i` is on (counting only lines that hold a token)."""
    if not tokens:
        return False
    counts: dict[str, int] = {}
    for token in tokens:
        counts[token] = counts.get(token, 0) + 1
    total = len(tokens)
    for token, count in counts.items():
        if (
            count >= _REPEAT_MIN_COUNT
            and count / total >= _REPEAT_MIN_SHARE
            and _is_content_token(token)
        ):
            return True

    # Run rule: a sequence of `length` tokens repeated back to back `_REPEAT_RUN` times is
    # `(_REPEAT_RUN - 1) * length` consecutive tokens equal to the token `length` places earlier.
    for length in range(1, _MAX_RUN_LENGTH + 1):
        needed = (_REPEAT_RUN - 1) * length
        streak = 0
        for index in range(length, total):
            if tokens[index] == tokens[index - length]:
                streak += 1
            else:
                streak = 0
            if streak >= needed and any(
                _is_content_token(token) for token in tokens[index - length + 1 : index + 1]
            ):
                start = index - needed - length + 1
                if lines is not None and lines[index] - lines[start] == index - start:
                    # One token per line is a table column drawn on its own ("Advanced" down a
                    # skill-level column), not stuffing run together.
                    streak = 0
                    continue
                return True
    return False


def _repeated_terms_findings(document: Document, producer: Producer) -> list[Finding]:
    tokens: list[str] = []
    lines: list[int] = []
    line_number = 0
    for line in _repetition_text(document).lower().splitlines():
        found = _TOKEN.findall(line)
        if found:
            line_number += 1
            tokens.extend(found)
            lines.extend([line_number] * len(found))
    if not _is_repeated(tokens, lines):
        return []
    return [
        Finding(
            id="repeated-terms",
            severity=Severity.WARNING,
            origin=Origin.CONTENT,
            message=REPEATED_TERMS_MESSAGE,
            suggestion=suggestion_for("repeated-terms", producer),
        )
    ]


def check(document: Document, producer: Producer) -> list[Finding]:
    """Run every milestone-1 readiness check against `document`, deterministically ordered by
    page (a document-level finding sorts first) and then by a fixed id order (`_ID_ORDER`).

    If no page in the document has any characters at all, the single whole-document text-layer
    finding (`no-text-layer`, `text-as-outlines` or `image-only`) fires and the per-page glyph
    findings do not: once nothing on the page could be read at all, reporting its individual
    unmapped glyphs would just be noise on top of the one finding that matters.
    """
    has_text = any(page.char_count > 0 for page in document.pages)

    findings: list[Finding] = []
    if not has_text:
        findings.append(_no_text_layer_finding(document, producer))
    else:
        findings.extend(_glyph_findings(document, producer))
        findings.extend(_hidden_text_findings(document, producer))
        findings.extend(_repeated_terms_findings(document, producer))
    findings.extend(_page_count_findings(document))
    findings.extend(_blank_page_findings(document, has_text))

    return sorted(
        findings,
        key=lambda finding: (finding.page or 0, _ID_ORDER_INDEX.get(finding.id, len(_ID_ORDER))),
    )
