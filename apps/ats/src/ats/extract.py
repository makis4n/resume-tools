"""Reads text and layout facts from a PDF using pypdfium2 (decision 0032). `ats.analyze` calls
`extract`, and `ats.readiness` turns its per-page facts into findings.

Extraction never logs, or puts into an exception message, any text taken from the PDF: the service
must never leak resume content. `Document.producer` and `Document.creator` are the PDF's raw
metadata strings; they exist only so `ats.producer.classify` can turn them into a `Producer`, and
no caller may return or log them.

The hidden-text facts (decision 0087) are counts only; nothing new reads or stores text.
"""

import ctypes
import threading
from codecs import decode
from dataclasses import dataclass

import pypdfium2 as pdfium

# PDFium is not thread-safe: a single process must not call into it from two threads at once. The
# service (decision 0030) runs `analyze` in a thread pool, so every call that touches a document,
# page or text page anywhere in this module is serialised behind this lock.
_PDFIUM_LOCK = threading.Lock()

# `get_text_bounded()` called with no bounds clips to the page's displayed box (MediaBox
# intersect CropBox, the same box `get_size()` reports), silently dropping any text placed
# outside it -- exactly where keyword-stuffed or otherwise hidden text would be, which an ATS
# readiness check must still see. Passing bounds this large instead captures the whole content
# stream regardless of the page's declared boxes (checked empirically against pypdfium2 5.13.0:
# FPDFText_GetBoundedText takes C doubles and returns correctly with bounds up to the high 1e38
# range; this is far beyond any plausible PDF content placement, with headroom to spare).
_UNBOUNDED = 1_000_000.0

# Codepoints classified as icon-font glyphs with no real Unicode mapping behind them: the BMP
# Private Use Area, and Supplementary Private Use Areas A and B (decision 0083).
_PRIVATE_USE_RANGES = ((0xE000, 0xF8FF), (0xF0000, 0xFFFFD), (0x100000, 0x10FFFD))

# Latin small-letter ligatures (ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ) that keyword search on the extracted text misses,
# because e.g. "ﬁle" does not contain the substring "file" (decision 0083).
_LIGATURE_RANGE = (0xFB00, 0xFB06)

# A character extracted as one of these stands in for "no real mapping was found", the same as a
# character PDFium itself flags with `FPDFText_HasUnicodeMapError`.
_UNMAPPED_CODEPOINTS = (0xFFFD, 0x0000)

# Word and other Office tools draw a bulleted list item's bullet glyph as an ordinary, readable
# character in the Private Use Area, in one of a handful of dingbat fonts -- never as an icon font
# with no real text behind it. Matched against `_font_name_at`'s result with any subset-embedding
# prefix stripped and spaces removed, case-insensitively, since real font names appear as both
# "Wingdings2" and "Wingdings 2" (decision 0083).
_SYMBOL_FONT_NAMES = frozenset({"symbol", "wingdings", "wingdings2", "wingdings3", "webdings"})

# Recursion into Form XObjects (`_count_objects`) is bounded two ways, since the objects it walks
# come from an untrusted upload (PRD §11): a depth limit, so a form nested inside a form inside a
# form cannot recurse arbitrarily deep, and a total budget on how many objects are ever visited
# (at any depth), so a wide fan-out at any single level -- which the depth limit alone does not
# bound -- cannot make one page's counting combinatorially expensive. 100,000 comfortably covers a
# single very dense resume page (tens of thousands of text runs) while still bounding a
# pathologically nested or wide upload to a small, fast amount of work.
_FORM_RECURSION_LIMIT = 8
_OBJECT_BUDGET = 100_000

# `_char_stats` makes several PDFium calls per character from Python while `_PDFIUM_LOCK` is held,
# and a tiny compressed upload can hold millions of characters. Across one document it classifies
# at most this many characters (a dense resume page has a few thousand); any page beyond the
# budget gets only a cheap non-whitespace `char_count` and zero for every other per-character
# count, so a hostile upload cannot stall every other request behind the lock.
_CHAR_BUDGET = 200_000

# Hidden-text signals (decision 0087). A character whose loose box (`FPDFText_GetLooseCharBox`, in
# page space with every text, form and page matrix already applied) has `max(width, height)` under
# this many points is unreadably small; `max` rather than height so rotated text is not mistaken
# for tiny text.
_TINY_TEXT_POINTS = 3.0
# Text squashed along one axis (a tiny `Tz`, or a flat text matrix) is unreadable even when its
# other side is long: a box under this many points on either side is a sliver. No real glyph is
# this thin (a full stop at 8 pt has a loose box about 2 pt wide).
_SLIVER_POINTS = 1.0

# A painting colour with every channel at or above `255 - _BACKGROUND_TOLERANCE` counts as
# near-white, the colour of an unpainted page.
_BACKGROUND_TOLERANCE = 16

# The most shapes (`_covers`) a page keeps as possible backgrounds, and the rectangle-containment
# tests allowed across one document. Once the test budget is spent every later lookup answers
# "covered", which fails open (no hidden count), so a hostile upload cannot make cover lookups
# quadratic in its character and shape counts.
_MAX_COVERS = 500
# An image counts as a cover only at this resolution or better (see `_is_scan_like`).
_MIN_IMAGE_PIXELS_PER_POINT = 0.5
# The longest side, in pixels, of the page render `_HiddenReader` samples colours from.
_RENDER_MAX_SIDE = 600
_COVER_TEST_BUDGET = 100_000
# The page renders one document may make for `_HiddenReader._inked`. A render decodes the page's
# images and builds a table in Python, all under `_PDFIUM_LOCK`, so a document of many one-word
# white pages must not buy one per page. Once spent, `_inked` answers "inked" (fails open).
_RENDER_BUDGET = 10


class ExtractError(ValueError):
    """Base class for a PDF that pypdfium2 could not turn into text."""


class EncryptedPdfError(ExtractError):
    """The PDF is password-protected, or protected by a security handler PDFium cannot open."""


class UnreadablePdfError(ExtractError):
    """The PDF, or a page in it, could not be read for a reason other than a password."""


@dataclass(frozen=True)
class Page:
    """One page: its 1-based number, its displayed size, its full text and the per-page facts the
    readiness checks (`ats.readiness`) need.

    `width` and `height`, in PDF points, are the page's displayed size (`PdfPage.get_size()`):
    its MediaBox with rotation and the CropBox already applied, not necessarily the raw MediaBox.

    `char_count`, `unmapped_count`, `private_use_count` and `ligature_count` all count characters
    from the same single pass over the page's text (see `_char_stats`), and all exclude whitespace
    (which also covers the spaces and line breaks PDFium generates itself, that are not really in
    the page's content stream) -- so `unmapped_count`, `private_use_count` and `ligature_count`
    are always counts within `char_count`, keeping any fraction of them well-formed.

    - `char_count`: non-whitespace characters on the page.
    - `unmapped_count`: characters with no usable Unicode mapping -- PDFium flags these directly
      (`FPDFText_HasUnicodeMapError`), or they decode as the replacement character U+FFFD or as
      NUL.
    - `private_use_count`: characters in a Private Use Area, i.e. an icon font with no real text
      behind it -- except a character in one of the handful of dingbat fonts (Symbol, Wingdings,
      Webdings) Word and other Office tools draw an ordinary bullet glyph with, which is real,
      readable list-bullet content and is not counted here (`_is_symbol_font`, decision 0083).
    - `ligature_count`: characters that are a single Latin ligature glyph (ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ), which
      breaks plain keyword search on the extracted text.

    `hidden_count` and its four reasons (decision 0087) are also counts within `char_count`, from
    the same pass: `hidden_count` is the non-whitespace characters hidden for any reason (the
    union, so a character with several reasons counts once), and each reason counts the characters
    it applies to, so a character can be in several of them.

    - `invisible_count`: drawn with an invisible or clip text render mode, or painted fully
      transparent -- unless it sits over an image (an OCR text layer over a scan hides nothing).
    - `background_colour_count`: painted near-white with no shape or image drawn under it to make
      that colour visible.
    - `tiny_count`: under `_TINY_TEXT_POINTS` points wide and high, or under `_SLIVER_POINTS` on
      either side, once every matrix is applied.
    - `off_page_count`: entirely outside the page's crop box.

    All five are 0 on a page past `_CHAR_BUDGET`, for a character whose text object PDFium cannot
    resolve, and whenever the cover-test budget is spent (they fail open).

    `text_objects`, `image_objects` and `path_objects` count every TEXT, IMAGE and PATH object on
    the page, recursing into any Form XObject to reach objects nested inside it (common in scanner
    and print-driver output): see `_count_objects`. A Form XObject itself is not tallied into any
    of the three counts.
    """

    number: int
    width: float
    height: float
    text: str
    char_count: int
    unmapped_count: int
    private_use_count: int
    ligature_count: int
    text_objects: int
    image_objects: int
    path_objects: int
    hidden_count: int = 0
    invisible_count: int = 0
    background_colour_count: int = 0
    tiny_count: int = 0
    off_page_count: int = 0


@dataclass(frozen=True)
class Document:
    """The pages read from a PDF, in order, and the raw producer/creator metadata used only to
    classify the tool that made it (`ats.producer.classify`). Neither string is ever returned to a
    client or logged."""

    pages: tuple[Page, ...]
    producer: str | None
    creator: str | None


def _open_document(pdf: bytes) -> pdfium.PdfDocument:
    """Open `pdf`, working around a native-memory leak in pypdfium2 5.13.0's own opener.

    `pdfium.PdfDocument(bytes)` calls `FPDF_LoadMemDocument64` itself, then raises `PdfiumError`
    whenever the resulting page count is under 1 -- which is also how it reports a real open
    failure, since a failed load returns a null handle and a null handle's page count reads as
    under 1 too. But for a document that truly opened with zero pages, that handle is never
    closed on that path (`pypdfium2/_helpers/document.py::_open_pdf`, checked in 5.13.0's
    source): every such upload leaks a native PDFium document. Calling the raw API ourselves lets
    us tell the two cases apart and close a handle we are not keeping.

    `pdf` must stay referenced by the caller for as long as the returned document is open:
    PDFium reads directly from this buffer rather than copying it, and the wrapped
    `pdfium.PdfDocument` returned here does not hold its own reference the way one built from
    bytes normally would.
    """
    raw = pdfium.raw.FPDF_LoadMemDocument64(pdf, len(pdf), None)
    if not raw:
        err_code = pdfium.raw.FPDF_GetLastError()
        if err_code in (pdfium.raw.FPDF_ERR_PASSWORD, pdfium.raw.FPDF_ERR_SECURITY):
            raise EncryptedPdfError("the PDF is password-protected") from None
        raise UnreadablePdfError("the PDF could not be opened") from None
    if pdfium.raw.FPDF_GetPageCount(raw) < 1:
        pdfium.raw.FPDF_CloseDocument(raw)
        raise UnreadablePdfError("the PDF has no pages") from None
    return pdfium.PdfDocument(raw)


def _metadata_value(document: pdfium.PdfDocument, key: str) -> str | None:
    """`document`'s metadata value for `key`, or `None` when it is absent, empty, or too broken
    to decode.

    Metadata is untrusted input like the rest of the PDF: pypdfium2's `get_metadata_value` decodes
    it as strict UTF-16LE and raises `UnicodeDecodeError` on a malformed value (checked
    experimentally against pypdfium2 5.13.0, with a `/Producer` string containing an unpaired
    UTF-16 surrogate). Producer/creator detection is best-effort, so a value that cannot be
    decoded is treated the same as a missing one, rather than failing the whole analysis of an
    otherwise perfectly readable PDF.
    """
    try:
        value = document.get_metadata_value(key)
    except UnicodeError:
        return None
    return value or None


def _is_private_use(codepoint: int) -> bool:
    return any(low <= codepoint <= high for low, high in _PRIVATE_USE_RANGES)


def _is_symbol_font(font_name: str | None) -> bool:
    """Whether `font_name` (as `_font_name_at` reports it) is one of the dingbat/bullet fonts
    Word and other Office tools use for a Private Use Area bullet glyph, per `_SYMBOL_FONT_NAMES`.

    A subset-embedded font's name carries a 6-letter subset tag and a "+" (e.g. "ABCDEF+Symbol",
    PDF 32000-1:2008 §9.6.4); that prefix is stripped before matching. Matching also drops spaces
    and ignores case, since real font names appear as both "Wingdings2" and "Wingdings 2". A
    ",Style" or "-Style" suffix and a trailing "MT" are dropped too, so the PostScript names Word
    writes ("SymbolMT", "Wingdings-Regular", "Symbol,Bold") match.
    """
    if not font_name:
        return False
    _, _, unprefixed = font_name.rpartition("+")
    name = unprefixed.replace(" ", "").lower()
    # Style suffixes: "Symbol,Bold" (comma form) and "Wingdings-Regular" (PostScript form).
    name = name.split(",", 1)[0].split("-", 1)[0]
    # Office's PostScript names for Symbol: "SymbolMT".
    name = name.removesuffix("mt")
    return name in _SYMBOL_FONT_NAMES


def _font_name_at(text_page: pdfium.PdfTextPage, index: int) -> str | None:
    """The font name PDFium reports for the character at `index` on `text_page`, or `None` if it
    could not resolve one.

    There is no pypdfium2 helper for `FPDFText_GetFontInfo` itself; the buffer-sizing pattern
    (call once with no buffer to size it, then again to fill it) is the same one pypdfium2's own
    `PdfFont._get_name_impl` uses for `FPDFFont_GetBaseFontName`, verified against pypdfium2 5.13.0.
    """
    flags = ctypes.c_int()
    size = pdfium.raw.FPDFText_GetFontInfo(text_page, index, None, 0, flags)
    if size == 0:
        return None
    buffer = ctypes.create_string_buffer(size)
    pdfium.raw.FPDFText_GetFontInfo(text_page, index, buffer, size, flags)
    return decode(memoryview(buffer)[: size - 1], "utf-8", errors="replace")


@dataclass
class _Budget:
    """What is left of `_COVER_TEST_BUDGET` (`remaining`) and of `_RENDER_BUDGET` (`renders`) for
    one document, shared by every page."""

    remaining: int
    renders: int = 0


@dataclass
class _CharStats:
    """The per-character counts `_char_stats` returns, documented on `Page`."""

    char_count: int = 0
    unmapped_count: int = 0
    private_use_count: int = 0
    ligature_count: int = 0
    hidden_count: int = 0
    invisible_count: int = 0
    background_colour_count: int = 0
    tiny_count: int = 0
    off_page_count: int = 0


_Colour = tuple[int, int, int, int]
_Cover = tuple[float, float, float, float, bool]  # (left, bottom, right, top, is_image)


def _paint(obj: object, getter: object) -> tuple[int, int, int, int] | None:
    """`(r, g, b, a)` from `FPDFPageObj_GetFillColor`/`GetStrokeColor`, or `None` if unresolved."""
    red, green, blue, alpha = (ctypes.c_uint() for _ in range(4))
    if not getter(obj, red, green, blue, alpha):  # type: ignore[operator]
        return None
    return red.value, green.value, blue.value, alpha.value


def _near_white(paint: tuple[int, int, int, int]) -> bool:
    return all(channel >= 255 - _BACKGROUND_TOLERANCE for channel in paint[:3])


def _bounds(obj: object) -> tuple[float, float, float, float] | None:
    left, bottom, right, top = (ctypes.c_float() for _ in range(4))
    if not pdfium.raw.FPDFPageObj_GetBounds(obj, left, bottom, right, top):
        return None
    return left.value, bottom.value, right.value, top.value


def _through_matrix(
    obj: object, rect: tuple[float, float, float, float]
) -> tuple[float, float, float, float]:
    """`rect` (in the space inside Form XObject `obj`) as the bounding box of its corners after
    `obj`'s own matrix, which takes it one level out (towards page space)."""
    matrix = pdfium.raw.FS_MATRIX()
    if not pdfium.raw.FPDFPageObj_GetMatrix(obj, matrix):
        return rect
    xs, ys = [], []
    for x in (rect[0], rect[2]):
        for y in (rect[1], rect[3]):
            xs.append(matrix.a * x + matrix.c * y + matrix.e)
            ys.append(matrix.b * x + matrix.d * y + matrix.f)
    return min(xs), min(ys), max(xs), max(ys)


def _form_image_covers(
    form: object, depth: int, budget: int
) -> tuple[list[tuple[float, float, float, float]], int]:
    """The scan-like images inside Form XObject `form`, each as its own bounds in the space the
    form is drawn in (the form's matrix applied), so a small photo inside a page-wrapping form
    covers the photo, not the whole form. Recurses into nested forms like `_count_objects_in`,
    with the same depth limit and a shared object `budget`; returns `(rects, budget_remaining)`."""
    raw = pdfium.raw
    rects: list[tuple[float, float, float, float]] = []
    for index in range(raw.FPDFFormObj_CountObjects(form)):
        if budget <= 0:
            break
        obj = raw.FPDFFormObj_GetObject(form, index)
        if not obj:
            continue
        budget -= 1
        obj_type = raw.FPDFPageObj_GetType(obj)
        if obj_type == raw.FPDF_PAGEOBJ_IMAGE:
            box = _bounds(obj)
            if box is not None and _is_scan_like(obj, box[2] - box[0], box[3] - box[1]):
                rects.append(_through_matrix(form, box))
        elif obj_type == raw.FPDF_PAGEOBJ_FORM and depth < _FORM_RECURSION_LIMIT:
            inner, budget = _form_image_covers(obj, depth + 1, budget)
            rects.extend(_through_matrix(form, rect) for rect in inner)
    return rects, budget


def _covers(pdf_page: pdfium.PdfPage) -> list[_Cover]:
    """Images on `pdf_page` that invisible text could be an OCR layer over: a picture or scan of
    real resolution (`_is_scan_like`), or the same inside a Form XObject (a scanner's wrapped
    image; the cover is that image, not the whole form). At most `_MAX_COVERS`, from at most
    `_OBJECT_BUDGET` top-level objects, each as `(left, bottom, right, top, True)` in page space.
    Colour covers (panels, gradients) are not listed: `_inked` reads those from a render.
    """
    covers: list[_Cover] = []
    raw = pdfium.raw
    count = min(raw.FPDFPage_CountObjects(pdf_page), _OBJECT_BUDGET)
    walk_budget = _OBJECT_BUDGET  # shared by every form's inner walk
    for index in range(count):
        if len(covers) >= _MAX_COVERS:
            break
        obj = raw.FPDFPage_GetObject(pdf_page, index)
        if not obj:
            continue
        obj_type = raw.FPDFPageObj_GetType(obj)
        if obj_type == raw.FPDF_PAGEOBJ_FORM:
            rects, walk_budget = _form_image_covers(obj, 1, walk_budget)
            covers.extend((*rect, True) for rect in rects[: _MAX_COVERS - len(covers)])
        elif obj_type == raw.FPDF_PAGEOBJ_IMAGE:
            box = _bounds(obj)
            if box is not None and _is_scan_like(obj, box[2] - box[0], box[3] - box[1]):
                covers.append((*box, True))
    return covers


def _is_scan_like(image: object, width_points: float, height_points: float) -> bool:
    """Whether an image has the resolution of a real picture or scan (at least 0.5 pixel per
    point, 36 dpi, each way). A 1x1 image stretched across the page is a colour wash, not a cover
    an OCR layer or a coloured panel could sit on."""
    pixel_width, pixel_height = ctypes.c_uint(), ctypes.c_uint()
    if not pdfium.raw.FPDFImageObj_GetImagePixelSize(image, pixel_width, pixel_height):
        return True
    return (
        pixel_width.value >= _MIN_IMAGE_PIXELS_PER_POINT * width_points
        and pixel_height.value >= _MIN_IMAGE_PIXELS_PER_POINT * height_points
    )


_INKED_TABLE = bytes(1 if value < 255 - _BACKGROUND_TOLERANCE else 0 for value in range(256))


def _displayed_box(pdf_page: pdfium.PdfPage) -> tuple[float, float, float, float]:
    """`(left, bottom, right, top)` of the box PDFium displays and renders: the CropBox clipped
    to the MediaBox, in unrotated page space. A PDF rectangle may name any two opposite corners,
    so each is ordered first."""

    def ordered(box: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
        return min(box[0], box[2]), min(box[1], box[3]), max(box[0], box[2]), max(box[1], box[3])

    media = ordered(pdf_page.get_mediabox())
    crop = pdf_page.get_cropbox()
    crop_box = ordered(crop)
    clipped = (
        max(media[0], crop_box[0]),
        max(media[1], crop_box[1]),
        min(media[2], crop_box[2]),
        min(media[3], crop_box[3]),
    )
    if clipped[2] <= clipped[0] or clipped[3] <= clipped[1]:
        return media
    return clipped


def _inked_table(
    data: bytes, width: int, height: int, stride: int, channels: int
) -> list[list[int]]:
    """A summed-area table of the render's inked pixels (any colour channel below the background
    tolerance): `table[y][x]` counts the inked pixels above row `y` and left of column `x`. Built
    once per page with whole-row byte operations, so its cost is bounded by the render size."""
    from itertools import accumulate
    from operator import add

    table = [[0] * (width + 1)]
    for row in range(height):
        pixels = data[row * stride : row * stride + width * channels]
        merged = 0
        for channel in range(min(3, channels)):
            merged |= int.from_bytes(pixels[channel::channels].translate(_INKED_TABLE), "big")
        mask = merged.to_bytes(width, "big")
        table.append(list(map(add, table[-1], (0, *accumulate(mask)))))
    return table


class _HiddenReader:
    """Decides, per character, whether text is hidden from a reader (decision 0087). One per
    page; it holds the page's lazily read covers and per-text-object caches."""

    def __init__(
        self,
        pdf_page: pdfium.PdfPage,
        text_page: pdfium.PdfTextPage,
        budget: _Budget,
    ) -> None:
        self._pdf_page = pdf_page
        self._text_page = text_page
        self._budget = budget
        # (left, bottom, right, top), unrotated page space. A PDF rectangle may name any two
        # opposite corners, so order them.
        self._crop = _displayed_box(pdf_page)
        self._covers: list[_Cover] | None = None
        self._objects: dict[int, tuple[int, tuple[_Colour | None, ...]]] = {}
        self._rect = pdfium.raw.FS_RECTF()
        self._render: tuple[list[list[int]], int, int, float] | None = None
        self._render_failed = False

    def _covered(self, centre: tuple[float, float]) -> bool:
        """Whether `centre` lies inside an image cover, checked per character. Fails open (True)
        once the document's budget cannot pay for the lookup."""
        if self._covers is None:
            self._covers = _covers(self._pdf_page)
        covers = self._covers
        if self._budget.remaining <= 0 or self._budget.remaining < len(covers):
            self._budget.remaining = 0
            return True
        self._budget.remaining -= len(covers)
        x, y = centre
        return any(cover[0] <= x <= cover[2] and cover[1] <= y <= cover[3] for cover in covers)

    def _inked(self, box: tuple[float, float, float, float]) -> bool:
        """Whether the page, as PDFium draws it, shows something other than near-white inside
        `box`. A low-resolution render is the ground truth for what a reader sees: it covers
        gradients and other patterns, stroked bars and images, whose paint the object API cannot
        report. Fails open (True) if the render cannot be made."""
        if self._render is None and not self._render_failed:
            if self._budget.renders <= 0:
                self._render_failed = True
                return True
            self._budget.renders -= 1
            self._render = self._make_render()
            self._render_failed = self._render is None
        if self._render is None:
            return True
        sat, width, height, scale = self._render
        left, bottom, right, top = self._crop
        x0 = max(0, int((box[0] - left) * scale))
        x1 = min(width, int((box[2] - left) * scale) + 1)
        y0 = max(0, int((top - box[3]) * scale))
        y1 = min(height, int((top - box[1]) * scale) + 1)
        if x0 >= x1 or y0 >= y1:
            return False
        # Inked pixels in the rectangle from the summed-area table: constant time per character
        # however large the box, so a hostile page of huge glyphs costs no more than a normal one.
        row_end, row_start = sat[y1], sat[y0]
        return row_end[x1] - row_end[x0] - row_start[x1] + row_start[x0] > 0

    def _make_render(self) -> tuple[list[list[int]], int, int, float] | None:
        left, bottom, right, top = self._crop
        longest = max(right - left, top - bottom)
        if longest <= 0:
            return None
        scale = min(0.5, _RENDER_MAX_SIDE / longest)
        try:
            bitmap = self._pdf_page.render(
                scale=scale,
                rotation=(360 - self._pdf_page.get_rotation()) % 360,
                may_draw_forms=False,
            )
            return (
                _inked_table(
                    bytes(bitmap.buffer),
                    bitmap.width,
                    bitmap.height,
                    bitmap.stride,
                    bitmap.n_channels,
                ),
                bitmap.width,
                bitmap.height,
                scale,
            )
        except Exception:
            return None

    def read(self, index: int) -> tuple[bool, bool, bool, bool]:
        """`(invisible, background_colour, tiny, off_page)` for the character at `index`."""
        raw = pdfium.raw
        obj = raw.FPDFText_GetTextObject(self._text_page, index)
        if not obj:
            return False, False, False, False
        key = ctypes.cast(obj, ctypes.c_void_p).value or 0
        info = self._objects.get(key)
        if info is None:
            mode = raw.FPDFTextObj_GetTextRenderMode(obj)
            fill = _paint(obj, raw.FPDFPageObj_GetFillColor)
            stroke = _paint(obj, raw.FPDFPageObj_GetStrokeColor)
            if mode in (raw.FPDF_TEXTRENDERMODE_STROKE, raw.FPDF_TEXTRENDERMODE_STROKE_CLIP):
                paints = (stroke,)
            elif mode in (
                raw.FPDF_TEXTRENDERMODE_FILL_STROKE,
                raw.FPDF_TEXTRENDERMODE_FILL_STROKE_CLIP,
            ):
                # Outlined text is readable if either the fill or the stroke can be seen.
                paints = (fill, stroke)
            else:
                paints = (fill,)
            info = (mode, paints)
            self._objects[key] = info
        mode, paints = info
        if not raw.FPDFText_GetLooseCharBox(self._text_page, index, self._rect):
            box = None
        else:
            rect = self._rect
            box = (rect.left, rect.bottom, rect.right, rect.top)
        centre = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2) if box else None

        clip = mode == raw.FPDF_TEXTRENDERMODE_CLIP
        invisible = (
            clip
            or mode == raw.FPDF_TEXTRENDERMODE_INVISIBLE
            or all(paint is not None and paint[3] == 0 for paint in paints)
        )
        if invisible and centre is not None and box is not None:
            # An OCR layer over an image hides nothing. Text used as a clipping path shows
            # whatever is painted through it, which the render reveals.
            if self._covered(centre) or (clip and self._inked(box)):
                invisible = False
        background = (
            not invisible
            and all(paint is not None and (paint[3] == 0 or _near_white(paint)) for paint in paints)
            and box is not None
            and not self._inked(box)
        )
        width_points, height_points = (box[2] - box[0], box[3] - box[1]) if box else (0.0, 0.0)
        tiny = box is not None and (
            max(width_points, height_points) < _TINY_TEXT_POINTS
            or min(width_points, height_points) < _SLIVER_POINTS
        )
        left, bottom, right, top = self._crop
        off_page = box is not None and (
            box[2] < left or box[0] > right or box[3] < bottom or box[1] > top
        )
        return invisible, background, tiny, off_page


def _char_stats(
    pdf_page: pdfium.PdfPage,
    text_page: pdfium.PdfTextPage,
    text: str,
    budget: _Budget,
) -> _CharStats:
    """Classify every character on `text_page` in one linear pass over its character list.

    Returns the counts documented on `Page`. Whitespace is not counted at all, so an inserted
    space or line break can never be miscounted as an unmapped or private-use glyph.

    A character outside the Basic Multilingual Plane is one `str` character in `text` but two
    UTF-16 code units, and PDFium counts it as two entries in its character list, so `text` and the
    list no longer line up and the fallback runs: it joins a surrogate pair from `GetUnicode` back
    into one codepoint (so the supplementary Private Use Areas match) and skips the pair's second
    half, and skips whitespace, so it counts exactly what the aligned path does. A skipped half is
    never classified, so the hidden checks never run twice for one character.

    The glyph classification makes one PDFium call per character, `FPDFText_HasUnicodeMapError`.
    The Unicode value comes from `text` -- `get_text_bounded` already decoded it from this same
    character list -- and `text[i]` lines up with character-list index `i` (verified
    experimentally, including across a PDFium-generated space and a decomposed ligature). The
    characters PDFium generates itself are only inserted spaces and line breaks, so whitespace in
    `text` is skipped instead of asking `FPDFText_IsGenerated` per character; it can never be
    unmapped, private-use or a ligature. The per-character `IsGenerated` and `GetUnicode` calls
    remain only as a fallback for `len(text) != count_chars()`, which a non-BMP character causes.

    `FPDFText_GetFontInfo` is called only for a character already identified as Private Use Area,
    to tell an icon font's glyph (still counted) from a Symbol/Wingdings/Webdings bullet glyph
    (not counted): see `_is_symbol_font`. The hidden-text reads (`_HiddenReader`) add a text-object
    lookup and a loose-box read per character; `budget` bounds the cover lookups they need.
    """
    stats = _CharStats()
    hidden_reader = _HiddenReader(pdf_page, text_page, budget)
    total = text_page.count_chars()
    aligned = len(text) == total
    skip_until = 0
    for index in range(total):
        if index < skip_until:
            continue
        if aligned:
            char = text[index]
            if char.isspace():
                continue
            codepoint = ord(char)
        else:
            if pdfium.raw.FPDFText_IsGenerated(text_page, index) == 1:
                continue
            codepoint = pdfium.raw.FPDFText_GetUnicode(text_page, index)
            if 0xD800 <= codepoint <= 0xDBFF and index + 1 < total:
                low = pdfium.raw.FPDFText_GetUnicode(text_page, index + 1)
                if 0xDC00 <= low <= 0xDFFF:
                    codepoint = 0x10000 + ((codepoint - 0xD800) << 10) + (low - 0xDC00)
                    skip_until = index + 2
            if codepoint <= 0x10FFFF and chr(codepoint).isspace():
                continue
        stats.char_count += 1
        has_map_error = pdfium.raw.FPDFText_HasUnicodeMapError(text_page, index) == 1
        if has_map_error or codepoint in _UNMAPPED_CODEPOINTS:
            stats.unmapped_count += 1
        if _LIGATURE_RANGE[0] <= codepoint <= _LIGATURE_RANGE[1]:
            stats.ligature_count += 1
        if _is_private_use(codepoint) and not _is_symbol_font(_font_name_at(text_page, index)):
            stats.private_use_count += 1
        invisible, background, tiny, off_page = hidden_reader.read(index)
        stats.invisible_count += invisible
        stats.background_colour_count += background
        stats.tiny_count += tiny
        stats.off_page_count += off_page
        stats.hidden_count += invisible or background or tiny or off_page
    return stats


def _count_objects_in(
    parent: object,
    count_fn: object,
    get_fn: object,
    depth: int,
    budget: int,
) -> tuple[int, int, int, int]:
    """One level of `_count_objects`'s walk: `parent`'s own objects, via `count_fn`/`get_fn`
    (`FPDFPage_CountObjects`/`FPDFPage_GetObject` at the top, `FPDFFormObj_CountObjects`/
    `FPDFFormObj_GetObject` inside a Form XObject), recursing into any nested Form XObject while
    `depth` stays under `_FORM_RECURSION_LIMIT` and `budget` (objects visited so far, at any
    depth) stays under `_OBJECT_BUDGET`.

    Returns `(text, image, path, budget_remaining)`.
    """
    text_objects = 0
    image_objects = 0
    path_objects = 0
    count = count_fn(parent)
    for index in range(count):
        if budget <= 0:
            break
        raw_obj = get_fn(parent, index)
        if not raw_obj:
            # A malformed content stream in an untrusted upload could in principle make an
            # in-range index fail to resolve; pypdfium2's own `get_objects()` helper guards the
            # same call the same way. Skipping rather than passing a null pointer on to
            # `FPDFPageObj_GetType` avoids handing PDFium's C API something it never expects.
            continue
        budget -= 1
        obj_type = pdfium.raw.FPDFPageObj_GetType(raw_obj)
        if obj_type == pdfium.raw.FPDF_PAGEOBJ_TEXT:
            text_objects += 1
        elif obj_type == pdfium.raw.FPDF_PAGEOBJ_IMAGE:
            image_objects += 1
        elif obj_type == pdfium.raw.FPDF_PAGEOBJ_PATH:
            path_objects += 1
        elif obj_type == pdfium.raw.FPDF_PAGEOBJ_FORM and depth < _FORM_RECURSION_LIMIT:
            sub_text, sub_image, sub_path, budget = _count_objects_in(
                raw_obj,
                pdfium.raw.FPDFFormObj_CountObjects,
                pdfium.raw.FPDFFormObj_GetObject,
                depth + 1,
                budget,
            )
            text_objects += sub_text
            image_objects += sub_image
            path_objects += sub_path
    return text_objects, image_objects, path_objects, budget


def _count_objects(pdf_page: pdfium.PdfPage) -> tuple[int, int, int]:
    """Count every TEXT, IMAGE and PATH object on `pdf_page`: `(text, image, path)`.

    Recurses into any Form XObject to reach objects nested inside it, which scanner and
    print-driver output commonly wraps an image in, bounded by `_FORM_RECURSION_LIMIT` and
    `_OBJECT_BUDGET` (see their comments; the objects walked here come from an untrusted upload,
    PRD §11). A Form XObject itself is not tallied into any of the three counts, only what it
    (recursively) contains.
    """
    text_objects, image_objects, path_objects, _ = _count_objects_in(
        pdf_page,
        pdfium.raw.FPDFPage_CountObjects,
        pdfium.raw.FPDFPage_GetObject,
        0,
        _OBJECT_BUDGET,
    )
    return text_objects, image_objects, path_objects


def _read_page(
    pdf_page: pdfium.PdfPage, number: int, char_budget: int, cover_budget: _Budget
) -> tuple[Page, int]:
    """Read one page; returns it and how much of `char_budget` it used (see `_CHAR_BUDGET`).
    `cover_budget` is shared by the whole document (see `_COVER_TEST_BUDGET`)."""
    width, height = pdf_page.get_size()
    text_page = pdf_page.get_textpage()
    try:
        # Not `get_text_range`: pypdfium2 documents it as limited to UCS-2, while
        # `get_text_bounded` supports full Unicode. Not called with no bounds either: that clips
        # to the page's displayed box and would silently drop hidden or off-page text (see
        # `_UNBOUNDED`'s comment).
        text = text_page.get_text_bounded(-_UNBOUNDED, -_UNBOUNDED, _UNBOUNDED, _UNBOUNDED)
        total_chars = text_page.count_chars()
        if total_chars <= char_budget:
            stats = _char_stats(pdf_page, text_page, text, cover_budget)
            used = total_chars
        else:
            # Over budget: a C-speed count of non-whitespace characters, no per-character calls.
            stats = _CharStats(char_count=len("".join(text.split())))
            used = 0
    finally:
        text_page.close()
    text_objects, image_objects, path_objects = _count_objects(pdf_page)
    page = Page(
        number=number,
        width=width,
        height=height,
        text=text,
        char_count=stats.char_count,
        unmapped_count=stats.unmapped_count,
        private_use_count=stats.private_use_count,
        ligature_count=stats.ligature_count,
        text_objects=text_objects,
        image_objects=image_objects,
        path_objects=path_objects,
        hidden_count=stats.hidden_count,
        invisible_count=stats.invisible_count,
        background_colour_count=stats.background_colour_count,
        tiny_count=stats.tiny_count,
        off_page_count=stats.off_page_count,
    )
    return page, used


def extract(pdf: bytes) -> Document:
    """Extract text and layout facts from every page of `pdf`.

    Raises:
        EncryptedPdfError: the PDF needs a password, or uses a security handler PDFium does not
            support.
        UnreadablePdfError: the PDF, or one of its pages, could not be read for any other reason
            (damaged, no pages, or not really a PDF once pypdfium2 looks past the signature).
    """
    with _PDFIUM_LOCK:
        document = _open_document(pdf)
        try:
            producer = _metadata_value(document, "Producer")
            creator = _metadata_value(document, "Creator")
            page_count = len(document)
            pages = []
            char_budget = _CHAR_BUDGET
            cover_budget = _Budget(_COVER_TEST_BUDGET, _RENDER_BUDGET)
            try:
                for number in range(1, page_count + 1):
                    pdf_page = document.get_page(number - 1)
                    try:
                        page, used = _read_page(pdf_page, number, char_budget, cover_budget)
                        char_budget -= used
                        pages.append(page)
                    finally:
                        pdf_page.close()
            except pdfium.PdfiumError:
                # A document can open cleanly and still have a page PDFium cannot load or read,
                # such as a malformed page tree: still "damaged", not a new kind of failure.
                raise UnreadablePdfError("the PDF could not be read") from None
        finally:
            document.close()

    return Document(pages=tuple(pages), producer=producer, creator=creator)
