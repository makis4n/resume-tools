"""Deterministic readiness checks for one extracted PDF (decision 0083); `ats.rubric` scores their
output. `check` covers milestone 1's checks so far: text layer, page count, glyph mapping, and
contact details and conventional sections (decision 0085). Reading order and hidden text, and rate
limits are later milestones.

Every message and suggestion string these checks use lives here or in `ats.suggestions`; nothing
here quotes resume text, and no message asserts a specific ATS behaviour this product cannot back
up.
"""

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


def _content_findings(document: Document, producer: Producer) -> list[Finding]:
    """Document-level contact and section findings (decision 0085). Only called when the document
    has text. `structure.detect` returns booleans only, so no resume text reaches a message."""
    facts = detect("\n".join(page.text for page in document.pages))

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


def check(document: Document, producer: Producer) -> list[Finding]:
    """Run every milestone-1 readiness check against `document`, deterministically ordered by
    page (a document-level finding sorts first) and then by a fixed id order (`_ID_ORDER`).

    If no page in the document has any characters at all, the single whole-document text-layer
    finding (`no-text-layer`, `text-as-outlines` or `image-only`) fires and the per-page glyph
    and contact/section findings do not: once nothing on the page could be read at all, reporting
    its individual unmapped glyphs would just be noise on top of the one finding that matters.
    """
    has_text = any(page.char_count > 0 for page in document.pages)

    findings: list[Finding] = []
    if not has_text:
        findings.append(_no_text_layer_finding(document, producer))
    else:
        findings.extend(_glyph_findings(document, producer))
        findings.extend(_content_findings(document, producer))
    findings.extend(_page_count_findings(document))
    findings.extend(_blank_page_findings(document, has_text))

    return sorted(
        findings,
        key=lambda finding: (finding.page or 0, _ID_ORDER_INDEX.get(finding.id, len(_ID_ORDER))),
    )
