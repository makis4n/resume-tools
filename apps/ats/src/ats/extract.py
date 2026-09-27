"""Reads text and layout facts from a PDF using pypdfium2 (decision 0032). `ats.analyze` calls
`extract`, and `ats.readiness` turns its per-page facts into findings.

Extraction never logs, or puts into an exception message, any text taken from the PDF: the service
must never leak resume content. `Document.producer` and `Document.creator` are the PDF's raw
metadata strings; they exist only so `ats.producer.classify` can turn them into a `Producer`, and
no caller may return or log them.
"""

import threading
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
# Private Use Area, and Supplementary Private Use Areas A and B (decision 0033).
_PRIVATE_USE_RANGES = ((0xE000, 0xF8FF), (0xF0000, 0xFFFFD), (0x100000, 0x10FFFD))

# Latin small-letter ligatures (ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ) that keyword search on the extracted text misses,
# because e.g. "ﬁle" does not contain the substring "file" (decision 0033).
_LIGATURE_RANGE = (0xFB00, 0xFB06)

# A character extracted as one of these stands in for "no real mapping was found", the same as a
# character PDFium itself flags with `FPDFText_HasUnicodeMapError`.
_UNMAPPED_CODEPOINTS = (0xFFFD, 0x0000)


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
    from the same single pass over the page's text (see `_char_stats`), and all exclude characters
    PDFium generated itself (inserted spaces and line breaks that are not really in the page's
    content stream) -- so `unmapped_count`, `private_use_count` and `ligature_count` are always
    counts within `char_count`, keeping any fraction of them well-formed.

    - `char_count`: non-generated characters on the page.
    - `unmapped_count`: characters with no usable Unicode mapping -- PDFium flags these directly
      (`FPDFText_HasUnicodeMapError`), or they decode as the replacement character U+FFFD or as
      NUL.
    - `private_use_count`: characters in a Private Use Area, i.e. an icon font with no real text
      behind it.
    - `ligature_count`: characters that are a single Latin ligature glyph (ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ), which
      breaks plain keyword search on the extracted text.

    `text_objects`, `image_objects` and `path_objects` count only the page's own, top-level
    objects (`FPDFPage_CountObjects` / `FPDFPage_GetObject`): a Form XObject is counted once, as
    its own object, and its contents are not recursed into.
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
    """`document`'s metadata value for `key`, or `None` when it is absent or empty."""
    value = document.get_metadata_value(key)
    return value or None


def _is_private_use(codepoint: int) -> bool:
    return any(low <= codepoint <= high for low, high in _PRIVATE_USE_RANGES)


def _char_stats(text_page: pdfium.PdfTextPage) -> tuple[int, int, int, int]:
    """Classify every character on `text_page` in one linear pass over its character list.

    Returns `(char_count, unmapped_count, private_use_count, ligature_count)`, as documented on
    `Page`. A character PDFium generated itself (`FPDFText_IsGenerated`) is skipped entirely, so
    an inserted space or line break can never be miscounted as an unmapped or private-use glyph.
    """
    char_count = 0
    unmapped_count = 0
    private_use_count = 0
    ligature_count = 0
    total = text_page.count_chars()
    for index in range(total):
        if pdfium.raw.FPDFText_IsGenerated(text_page, index) == 1:
            continue
        char_count += 1
        codepoint = pdfium.raw.FPDFText_GetUnicode(text_page, index)
        has_map_error = pdfium.raw.FPDFText_HasUnicodeMapError(text_page, index) == 1
        if has_map_error or codepoint in _UNMAPPED_CODEPOINTS:
            unmapped_count += 1
        if _is_private_use(codepoint):
            private_use_count += 1
        if _LIGATURE_RANGE[0] <= codepoint <= _LIGATURE_RANGE[1]:
            ligature_count += 1
    return char_count, unmapped_count, private_use_count, ligature_count


def _count_objects(pdf_page: pdfium.PdfPage) -> tuple[int, int, int]:
    """Count `pdf_page`'s own, top-level page objects by type: `(text, image, path)`.

    Only `FPDFPage_CountObjects` / `FPDFPage_GetObject` are used, so a Form XObject on the page is
    counted once, as its own object, and its contents are never recursed into.
    """
    text_objects = 0
    image_objects = 0
    path_objects = 0
    count = pdfium.raw.FPDFPage_CountObjects(pdf_page)
    for index in range(count):
        raw_obj = pdfium.raw.FPDFPage_GetObject(pdf_page, index)
        obj_type = pdfium.raw.FPDFPageObj_GetType(raw_obj)
        if obj_type == pdfium.raw.FPDF_PAGEOBJ_TEXT:
            text_objects += 1
        elif obj_type == pdfium.raw.FPDF_PAGEOBJ_IMAGE:
            image_objects += 1
        elif obj_type == pdfium.raw.FPDF_PAGEOBJ_PATH:
            path_objects += 1
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
        char_count, unmapped_count, private_use_count, ligature_count = _char_stats(text_page)
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
