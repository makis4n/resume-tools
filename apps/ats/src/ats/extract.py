"""Reads text and layout facts from a PDF using pypdfium2 (decision 0032). `ats.analyze` calls
`extract`, and `ats.readiness` turns its per-page facts into findings.

Extraction never logs, or puts into an exception message, any text taken from the PDF: the service
must never leak resume content. `Document.producer` and `Document.creator` are the PDF's raw
metadata strings; they exist only so `ats.producer.classify` can turn them into a `Producer`, and
no caller may return or log them.
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


def _char_stats(text_page: pdfium.PdfTextPage, text: str) -> tuple[int, int, int, int]:
    """Classify every character on `text_page` in one linear pass over its character list.

    Returns `(char_count, unmapped_count, private_use_count, ligature_count)`, as documented on
    `Page`. Whitespace is not counted at all, so an inserted space or line break can never be
    miscounted as an unmapped or private-use glyph.

    The common case makes exactly one PDFium call per character, `FPDFText_HasUnicodeMapError`.
    The Unicode value comes from `text` -- `get_text_bounded` already decoded it from this same
    character list -- and `text[i]` lines up with character-list index `i` (verified
    experimentally, including across a PDFium-generated space and a decomposed ligature). The
    characters PDFium generates itself are only inserted spaces and line breaks, so whitespace in
    `text` is skipped instead of asking `FPDFText_IsGenerated` per character; it can never be
    unmapped, private-use or a ligature. The per-character `IsGenerated` and `GetUnicode` calls
    remain only as a fallback for `len(text) != count_chars()`, which nothing in testing produced.

    A third PDFium call, `FPDFText_GetFontInfo`, happens only for a character already identified as
    Private Use Area, to tell an icon font's glyph (still counted) from a Symbol/Wingdings/Webdings
    bullet glyph (not counted): see `_is_symbol_font`.
    """
    char_count = 0
    unmapped_count = 0
    private_use_count = 0
    ligature_count = 0
    total = text_page.count_chars()
    aligned = len(text) == total
    for index in range(total):
        if aligned:
            char = text[index]
            if char.isspace():
                continue
            codepoint = ord(char)
        else:
            if pdfium.raw.FPDFText_IsGenerated(text_page, index) == 1:
                continue
            codepoint = pdfium.raw.FPDFText_GetUnicode(text_page, index)
        char_count += 1
        has_map_error = pdfium.raw.FPDFText_HasUnicodeMapError(text_page, index) == 1
        if has_map_error or codepoint in _UNMAPPED_CODEPOINTS:
            unmapped_count += 1
        if _LIGATURE_RANGE[0] <= codepoint <= _LIGATURE_RANGE[1]:
            ligature_count += 1
        if _is_private_use(codepoint) and not _is_symbol_font(_font_name_at(text_page, index)):
            private_use_count += 1
    return char_count, unmapped_count, private_use_count, ligature_count


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


def _read_page(pdf_page: pdfium.PdfPage, number: int) -> Page:
    width, height = pdf_page.get_size()
    text_page = pdf_page.get_textpage()
    try:
        # Not `get_text_range`: pypdfium2 documents it as limited to UCS-2, while
        # `get_text_bounded` supports full Unicode. Not called with no bounds either: that clips
        # to the page's displayed box and would silently drop hidden or off-page text (see
        # `_UNBOUNDED`'s comment).
        text = text_page.get_text_bounded(-_UNBOUNDED, -_UNBOUNDED, _UNBOUNDED, _UNBOUNDED)
        char_count, unmapped_count, private_use_count, ligature_count = _char_stats(text_page, text)
    finally:
        text_page.close()
    text_objects, image_objects, path_objects = _count_objects(pdf_page)
    return Page(
        number=number,
        width=width,
        height=height,
        text=text,
        char_count=char_count,
        unmapped_count=unmapped_count,
        private_use_count=private_use_count,
        ligature_count=ligature_count,
        text_objects=text_objects,
        image_objects=image_objects,
        path_objects=path_objects,
    )


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
            try:
                for number in range(1, page_count + 1):
                    pdf_page = document.get_page(number - 1)
                    try:
                        pages.append(_read_page(pdf_page, number))
                    finally:
                        pdf_page.close()
            except pdfium.PdfiumError:
                # A document can open cleanly and still have a page PDFium cannot load or read,
                # such as a malformed page tree: still "damaged", not a new kind of failure.
                raise UnreadablePdfError("the PDF could not be read") from None
        finally:
            document.close()

    return Document(pages=tuple(pages), producer=producer, creator=creator)
