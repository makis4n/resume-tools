"""Deterministic readiness checks for one extracted PDF (decision 0083); `ats.rubric` scores their
output. `check` covers milestone 1's checks so far: text layer, page count, glyph mapping,
contact details and conventional sections (decision 0085), the two reading-order checks read from
text positions (decision 0086: lines of side-by-side columns drawn alternately, and words split
across lines by hyphenation), and hidden text and keyword repetition (decision 0087). Rate limits
are a later milestone.

Every message and suggestion string these checks use lives here or in `ats.suggestions`; nothing
here quotes resume text, and no message asserts a specific ATS behaviour this product cannot back
up.
"""

import re
from bisect import bisect_left, bisect_right

from ats.extract import Document
from ats.findings import Finding, Origin, Severity
from ats.producer import Producer
from ats.structure import detect
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

# `structure.detect` is pure-Python regex work that holds the GIL, about ten times slower per
# character than extraction, and a tiny upload can hold millions of characters. It reads at most
# this many (a resume is a few thousand), so one upload cannot stall every other request.
_DETECT_CHAR_LIMIT = 100_000

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
NO_EMAIL_MESSAGE = (
    "No email address was found in this resume's text. ATSs and recruiters use it to contact you."
)
UNRECOGNISED_EMAIL_MESSAGE = (
    "Something in this resume looks like an email address but could not be read as one, so an "
    "ATS may not find it."
)
NO_PHONE_MESSAGE = (
    "No phone number was found in this resume's text. Recruiters often use it to reach you."
)
NO_PROFILE_LINK_MESSAGE = (
    "No link was found in this resume's text. If you have a LinkedIn profile, portfolio or "
    "website, write its address out in full as plain text, since a clickable word alone may not "
    "be read."
)
_MISSING_SECTION_MESSAGE = (
    'No heading such as "{name}" was found. Many ATSs look for conventional section headings to '
    "sort a resume's content."
)
MISSING_EXPERIENCE_MESSAGE = _MISSING_SECTION_MESSAGE.format(name="Experience")
MISSING_EDUCATION_MESSAGE = _MISSING_SECTION_MESSAGE.format(name="Education")
MISSING_SKILLS_MESSAGE = _MISSING_SECTION_MESSAGE.format(name="Skills")

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
# A segment is "filled" when its right edge reaches into the right 12 percent of its side's extent
# (a tight band: wrapped prose is ragged by a few words, a row of table cells of unrelated text by
# more): wrapped prose fills its column, a skills grid's cells do not.
_FILL_FRACTION = 0.12
# At least this fraction of a chain's left segments must be filled for it to count, and the same
# for its right segments. Below 3/4 on purpose: the last line of each paragraph or bullet is short,
# so a column of 3-line items is only 2/3 filled. Two unfilled segments in a row never count (see
# `_filled`), which keeps a table of ragged one-line cells out.
_MIN_FILLED_RATIO = 0.6
# At least this fraction of a side's segments must start at one of its two commonest x positions
# (the bullet and the hanging indent of a list), each within `_LEFT_EDGE_TOLERANCE_PT`.
_MIN_ALIGNED_RATIO = 0.75
# A bullet or a number is drawn as a small mark apart from its text. A segment no wider than this
# multiple of the line height, followed on the same line by another segment within
# `_MARKER_JOIN_FACTOR` times the height, is merged into it (see `_join_markers`).
_MARKER_MAX_WIDTH_FACTOR = 1.0
_MARKER_JOIN_FACTOR = 2.0
# Wrapped prose columns are wide; a date, a label, a city or a short table cell is not. A chain
# counts only if the median width of its left segments, and of its right segments, is at least
# this many points. This tells columns of prose from table rows (dates, key/value lists, school
# and city) whose cells merely have similar widths.
_MIN_COLUMN_WIDTH_PT = 150.0
# Wrapped prose in a column starts every line at the same x. A right-aligned cell (a date, a city)
# starts each line at a different x. Starts within this many points of an anchor x count as one
# position (see `_aligned`, which needs `_MIN_ALIGNED_RATIO` of a side's starts at two of them).
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
    "missing-contact-email",
    "unrecognised-contact-email",
    "missing-contact-phone",
    "missing-profile-link",
    "missing-section-experience",
    "missing-section-education",
    "missing-section-skills",
    "blank-page",
    "unmapped-glyphs",
    "icon-font-glyphs",
    "ligature-characters",
    "column-interleaving",
    "hyphenated-line-breaks",
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


def _join_markers(segments: list[Rect]) -> list[Rect]:
    """Merge a bullet or number mark into the text that follows it on its line, so a list item is
    one segment however far the text is indented."""
    joined: list[Rect] = []
    index = 0
    while index < len(segments):
        seg = segments[index]
        if index + 1 < len(segments):
            nxt = segments[index + 1]
            height = max(seg[3] - seg[1], nxt[3] - nxt[1])
            gap = nxt[0] - seg[2]
            same_line = abs((seg[1] + seg[3]) / 2 - (nxt[1] + nxt[3]) / 2) <= 0.5 * height
            if (
                seg[2] - seg[0] <= _MARKER_MAX_WIDTH_FACTOR * height
                and same_line
                and 0 <= gap <= _MARKER_JOIN_FACTOR * height
            ):
                joined.append((seg[0], min(seg[1], nxt[1]), nxt[2], max(seg[3], nxt[3])))
                index += 2
                continue
        joined.append(seg)
        index += 1
    return joined


def _is_lateral(a: Rect, b: Rect) -> bool:
    """Whether `b` follows `a` across a gutter on the same line."""
    height = max(a[3] - a[1], b[3] - b[1])
    centre_a = (a[1] + a[3]) / 2
    centre_b = (b[1] + b[3]) / 2
    return b[0] - a[2] >= _MIN_GUTTER_PT and abs(centre_a - centre_b) <= (
        _LATERAL_CENTRE_FACTOR * height
    )


def _filled(segs: list[Rect]) -> bool:
    """Whether most of the segments reach into the right 12 percent (`_FILL_FRACTION`) of their own
    extent and no two unfilled ones sit side by side. The last line of a paragraph or bullet is
    short, so a lone unfilled segment is allowed; two in a row are a list of short cells."""
    min_left = min(seg[0] for seg in segs)
    max_right = max(seg[2] for seg in segs)
    threshold = max_right - _FILL_FRACTION * (max_right - min_left)
    flags = [seg[2] >= threshold for seg in segs]
    if any(not a and not b for a, b in zip(flags, flags[1:], strict=False)):
        return False
    return sum(flags) >= _MIN_FILLED_RATIO * len(segs)


def _densest(starts: list[float]) -> tuple[int, int, int]:
    """The anchor in sorted `starts` with the most starts within `_LEFT_EDGE_TOLERANCE_PT`, as
    (count, low index, high index) of that run. O(n log n) with bisect."""
    best = (0, 0, 0)
    for anchor in starts:
        low = bisect_left(starts, anchor - _LEFT_EDGE_TOLERANCE_PT)
        high = bisect_right(starts, anchor + _LEFT_EDGE_TOLERANCE_PT)
        if high - low > best[0]:
            best = (high - low, low, high)
    return best


def _aligned(segs: list[Rect]) -> bool:
    """Whether most of the segments start at one of two x positions, as the lines of a wrapped
    column or of a bulleted list with a hanging indent do and a right-aligned cell does not.
    Takes the densest cluster of starts, then the densest among the starts outside it."""
    starts = sorted(seg[0] for seg in segs)
    first, low, high = _densest(starts)
    second, _, _ = _densest(starts[:low] + starts[high:])
    return first + second >= _MIN_ALIGNED_RATIO * len(segs)


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
    row of labels and values. O(n log n) in the segment count: a chain that breaks its band
    restarts at the step that broke it, and alignment is counted on sorted starts.
    """
    segments = _join_markers(_segments(rects))
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


def _content_findings(document: Document, producer: Producer) -> list[Finding]:
    """Document-level contact and section findings (decision 0085). Only called when the document
    has text. `structure.detect` returns booleans only, so no resume text reaches a message."""
    text = "\n".join(page.text for page in document.pages)
    facts = detect(text[:_DETECT_CHAR_LIMIT])

    missing: list[tuple[str, Severity, str]] = []
    if not facts.has_email:
        if facts.has_email_candidate:
            missing.append(
                ("unrecognised-contact-email", Severity.WARNING, UNRECOGNISED_EMAIL_MESSAGE)
            )
        else:
            missing.append(("missing-contact-email", Severity.WARNING, NO_EMAIL_MESSAGE))
    if not facts.has_phone:
        missing.append(("missing-contact-phone", Severity.INFO, NO_PHONE_MESSAGE))
    if not facts.has_profile_link:
        missing.append(("missing-profile-link", Severity.INFO, NO_PROFILE_LINK_MESSAGE))
    if not facts.has_experience:
        missing.append(("missing-section-experience", Severity.WARNING, MISSING_EXPERIENCE_MESSAGE))
    if not facts.has_education:
        missing.append(("missing-section-education", Severity.INFO, MISSING_EDUCATION_MESSAGE))
    if not facts.has_skills:
        missing.append(("missing-section-skills", Severity.INFO, MISSING_SKILLS_MESSAGE))

    return [
        Finding(
            id=finding_id,
            severity=severity,
            origin=Origin.CONTENT,
            message=message,
            suggestion=suggestion_for(finding_id, producer),
        )
        for finding_id, severity, message in missing
    ]


def _mostly_unmapped(document: Document) -> bool:
    """True when the text is mostly unmapped glyphs: it is garbage, so contact and section
    checks would only add wrong advice on top of the `unmapped-glyphs` finding."""
    chars = sum(page.char_count for page in document.pages)
    unmapped = sum(page.unmapped_count for page in document.pages)
    return chars > 0 and unmapped / chars > _UNMAPPED_CRITICAL_THRESHOLD


def check(document: Document, producer: Producer) -> list[Finding]:
    """Run every milestone-1 readiness check against `document`, deterministically ordered by
    page (a document-level finding sorts first) and then by a fixed id order (`_ID_ORDER`).

    If no page in the document has any characters at all, the single whole-document text-layer
    finding (`no-text-layer`, `text-as-outlines` or `image-only`) fires and the per-page glyph
    and contact/section findings do not: once nothing on the page could be read at all, reporting
    its individual unmapped glyphs would just be noise on top of the one finding that matters. The
    same holds for the reading-order, hidden-text and repetition findings.
    """
    has_text = any(page.char_count > 0 for page in document.pages)

    findings: list[Finding] = []
    if not has_text:
        findings.append(_no_text_layer_finding(document, producer))
    else:
        findings.extend(_glyph_findings(document, producer))
        findings.extend(_reading_order_findings(document, producer))
        if not _mostly_unmapped(document):
            findings.extend(_content_findings(document, producer))
        findings.extend(_hidden_text_findings(document, producer))
        findings.extend(_repeated_terms_findings(document, producer))
    findings.extend(_page_count_findings(document))
    findings.extend(_blank_page_findings(document, has_text))

    return sorted(
        findings,
        key=lambda finding: (finding.page or 0, _ID_ORDER_INDEX.get(finding.id, len(_ID_ORDER))),
    )
