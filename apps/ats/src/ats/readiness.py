"""Deterministic readiness checks for one extracted PDF (decision 0083); `ats.rubric` scores their
output. `check` covers milestone 1's checks only: text layer, page count, glyph mapping, and the
two reading-order checks read from text positions (decision 0086): lines of side-by-side columns
drawn alternately, and words split across lines by hyphenation. Contact/section checks, hidden text
and rate limits are later milestones.

Every message and suggestion string these checks use lives here or in `ats.suggestions`; nothing
here quotes resume text, and no message asserts a specific ATS behaviour this product cannot back
up.
"""

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
LIGATURE_MESSAGE = (
    'This page contains ligature characters (letter pairs like "fi" or "fl" joined into a single '
    'glyph), so a word like "profile" may not be found by a keyword search that only looks for '
    "plain letters."
)

COLUMN_INTERLEAVING_MESSAGE = (
    "Text on this page appears to be read across side-by-side columns line by line, so lines from "
    "different columns may run together when an ATS extracts it."
)
HYPHENATED_LINE_BREAKS_MESSAGE = (
    "Some words on this page are split across lines at a hyphen (automatic hyphenation, or a "
    "hyphenated compound such as user-facing), so an ATS may read them as two fragments and miss "
    "them in a keyword search."
)

# --- Reading-order geometry (decision 0086) ---
# A text rect is (left, bottom, right, top) in PDF points, in extraction order.
Rect = tuple[float, float, float, float]

# Two consecutive rects join into one line segment when their vertical ranges overlap by at least
# this fraction of the smaller height: same line, tolerating baseline and font-size differences.
_SEGMENT_MIN_VERTICAL_OVERLAP = 0.5
# ...and the horizontal gap between them is at most this multiple of the larger height (a word
# space is about a quarter of the height; a column gutter is well over it), and at least
# -0.5 * height (a little overlap from kerning or italic slant, but not a rect drawn over another).
_SEGMENT_JOIN_FACTOR = 1.0
_SEGMENT_MAX_OVERLAP_FACTOR = 0.5
# A step between consecutive segments is lateral (left one, then one across a gutter) when the
# gap is at least this many points: wider than any word space at ordinary resume sizes, narrower
# than a real column gutter.
_MIN_GUTTER_PT = 18.0
# ...and their vertical centres differ by at most this multiple of the larger height: same line,
# allowing for the offset baselines of two columns set independently.
_LATERAL_CENTRE_FACTOR = 1.5
# A left segment must sit lower than the previous one by at least this multiple of its height for
# the chain to be moving down the page, one line at a time.
_MIN_DESCENT_FACTOR = 0.5
# A left segment is "filled" when its right edge reaches into the right quarter of the chain's
# left segments' extent (a tight band: wrapped prose is ragged by a few words, a row of table cells
# of unrelated text by more): wrapped prose fills its column, a skills grid's cells do not.
_FILL_FRACTION = 0.12
# At least this fraction of a chain's left segments must be filled for it to count, and the same
# for its right segments.
_MIN_FILLED_RATIO = 0.75
# Wrapped prose columns are wide; a date, a label, a city or a short table cell is not. A chain
# counts only if the median width of its left segments, and of its right segments, is at least
# this many points. This tells columns of prose from table rows (dates, key/value lists, school
# and city) whose cells merely have similar widths.
_MIN_COLUMN_WIDTH_PT = 150.0
# Wrapped prose in a column starts every line at the same x. A right-aligned cell (a date, a city)
# starts each line at a different x. A chain's segments on each side count only if at least
# `_MIN_FILLED_RATIO` of them start within this many points of the side's median start.
_LEFT_EDGE_TOLERANCE_PT = 3.0
# Alternating lateral steps needed to call a page interleaved. Four consecutive lines read
# across a gutter is not a table row or a date: it is columns of prose read line by line.
_MIN_INTERLEAVED_LINES = 4

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
    "column-interleaving",
    "hyphenated-line-breaks",
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


def _segments(rects: tuple[Rect, ...]) -> list[Rect]:
    """Merge consecutive rects that sit on one line into segments, so a producer that draws one
    rect per glyph and one that draws one per line give the same segments. A rect joins the
    previous segment when their vertical ranges overlap enough and the gap is small
    (`_SEGMENT_JOIN_FACTOR`)."""
    segments: list[Rect] = []
    for left, bottom, right, top in rects:
        if segments:
            p_left, p_bottom, p_right, p_top = segments[-1]
            height = top - bottom
            p_height = p_top - p_bottom
            overlap = min(top, p_top) - max(bottom, p_bottom)
            gap = left - p_right
            max_height = max(height, p_height)
            if (
                overlap >= _SEGMENT_MIN_VERTICAL_OVERLAP * min(height, p_height)
                and -_SEGMENT_MAX_OVERLAP_FACTOR * max_height
                <= gap
                <= _SEGMENT_JOIN_FACTOR * max_height
            ):
                segments[-1] = (
                    min(p_left, left),
                    min(p_bottom, bottom),
                    max(p_right, right),
                    max(p_top, top),
                )
                continue
        segments.append((left, bottom, right, top))
    return segments


def _is_lateral(a: Rect, b: Rect) -> bool:
    """Whether `b` follows `a` across a gutter on the same line."""
    height = max(a[3] - a[1], b[3] - b[1])
    centre_a = (a[1] + a[3]) / 2
    centre_b = (b[1] + b[3]) / 2
    return b[0] - a[2] >= _MIN_GUTTER_PT and abs(centre_a - centre_b) <= (
        _LATERAL_CENTRE_FACTOR * height
    )


def _filled(segs: list[Rect]) -> bool:
    """Whether most of the segments reach into the right quarter (`_FILL_FRACTION`) of their own
    extent."""
    min_left = min(seg[0] for seg in segs)
    max_right = max(seg[2] for seg in segs)
    threshold = max_right - _FILL_FRACTION * (max_right - min_left)
    filled = sum(1 for seg in segs if seg[2] >= threshold)
    return filled >= _MIN_FILLED_RATIO * len(segs)


def _aligned(segs: list[Rect]) -> bool:
    """Whether most of the segments start at one x, as every line of a wrapped column does and a
    right-aligned cell does not."""
    starts = sorted(seg[0] for seg in segs)
    median = starts[len(starts) // 2]
    aligned = sum(1 for start in starts if abs(start - median) <= _LEFT_EDGE_TOLERANCE_PT)
    return aligned >= _MIN_FILLED_RATIO * len(segs)


def _wide(segs: list[Rect]) -> bool:
    """Whether the median segment width is at least `_MIN_COLUMN_WIDTH_PT`."""
    widths = sorted(seg[2] - seg[0] for seg in segs)
    return widths[len(widths) // 2] >= _MIN_COLUMN_WIDTH_PT


def _chain_length(lefts: list[Rect], rights: list[Rect]) -> int:
    """The chain's length if both columns look like prose (wide, filled, left-aligned), else 0."""
    columns_are_prose = all(
        _wide(segs) and _filled(segs) and _aligned(segs) for segs in (lefts, rights)
    )
    return len(lefts) if columns_are_prose else 0


def _interleaved_lines(rects: tuple[Rect, ...]) -> int:
    """The longest run of lines read left, right, left, right across a gutter, or 0 if none.

    After merging rects into segments, a chain is a run of lateral steps (`_is_lateral`) that
    alternate strictly (each step's left segment comes straight after the previous step's right
    one), whose left segments move down the page and whose gutters all share one x-band. It counts
    only if both its left and its right segments are wide, mostly filled and start at one x
    (`_chain_length`),
    which tells wrapped prose in two columns from a skills grid, a right-aligned date or a table
    row of labels and values. Linear in the segment count: a
    chain that breaks its band restarts at the step that broke it.
    """
    segments = _segments(rects)
    best = 0
    lefts: list[Rect] = []
    rights: list[Rect] = []
    band_low = band_high = 0.0
    index = 0
    while index + 1 < len(segments):
        a, b = segments[index], segments[index + 1]
        if not _is_lateral(a, b):
            if lefts:
                best = max(best, _chain_length(lefts, rights))
                lefts, rights = [], []
            index += 1
            continue
        if lefts:
            prev = lefts[-1]
            height = a[3] - a[1]
            descends = (prev[1] + prev[3]) / 2 - (a[1] + a[3]) / 2 >= _MIN_DESCENT_FACTOR * height
            low, high = max(band_low, a[2]), min(band_high, b[0])
            if not (descends and low < high):
                best = max(best, _chain_length(lefts, rights))
                lefts, rights = [], []
        if not lefts:
            band_low, band_high = a[2], b[0]
        else:
            band_low, band_high = max(band_low, a[2]), min(band_high, b[0])
        lefts.append(a)
        rights.append(b)
        index += 2
    if lefts:
        best = max(best, _chain_length(lefts, rights))
    return best


def _reading_order_findings(document: Document, producer: Producer) -> list[Finding]:
    """Per-page reading-order findings. Only called when the document has a text layer."""
    findings: list[Finding] = []
    for page in document.pages:
        if _interleaved_lines(page.text_rects) >= _MIN_INTERLEAVED_LINES:
            findings.append(
                Finding(
                    id="column-interleaving",
                    severity=Severity.WARNING,
                    origin=Origin.LAYOUT,
                    message=COLUMN_INTERLEAVING_MESSAGE,
                    page=page.number,
                    suggestion=suggestion_for("column-interleaving", producer),
                )
            )
        if page.hyphen_break_count > 0:
            findings.append(
                Finding(
                    id="hyphenated-line-breaks",
                    severity=Severity.WARNING,
                    origin=Origin.LAYOUT,
                    message=HYPHENATED_LINE_BREAKS_MESSAGE,
                    page=page.number,
                    suggestion=suggestion_for("hyphenated-line-breaks", producer),
                )
            )
    return findings


def check(document: Document, producer: Producer) -> list[Finding]:
    """Run every milestone-1 readiness check against `document`, deterministically ordered by
    page (a document-level finding sorts first) and then by a fixed id order (`_ID_ORDER`).

    If no page in the document has any characters at all, the single whole-document text-layer
    finding (`no-text-layer`, `text-as-outlines` or `image-only`) fires and the per-page glyph
    findings do not: once nothing on the page could be read at all, reporting its individual
    unmapped glyphs would just be noise on top of the one finding that matters. The same holds for
    the reading-order findings.
    """
    has_text = any(page.char_count > 0 for page in document.pages)

    findings: list[Finding] = []
    if not has_text:
        findings.append(_no_text_layer_finding(document, producer))
    else:
        findings.extend(_glyph_findings(document, producer))
        findings.extend(_reading_order_findings(document, producer))
    findings.extend(_page_count_findings(document))
    findings.extend(_blank_page_findings(document, has_text))

    return sorted(
        findings,
        key=lambda finding: (finding.page or 0, _ID_ORDER_INDEX.get(finding.id, len(_ID_ORDER))),
    )
