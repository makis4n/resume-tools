"""Reads text from a PDF using pypdfium2 (decision 0032). `ats.analyze` calls `extract`.

Extraction never logs, or puts into an exception message, any text taken from the PDF: the service
must never leak resume content.
"""

import threading
from dataclasses import dataclass

import pypdfium2 as pdfium

# PDFium is not thread-safe: a single process must not call into it from two threads at once. The
# service (decision 0030) runs `analyze` in a thread pool, so every call that touches a document,
# page or text page anywhere in this module is serialised behind this lock.
_PDFIUM_LOCK = threading.Lock()


class ExtractError(ValueError):
    """Base class for a PDF that pypdfium2 could not turn into text."""


class EncryptedPdfError(ExtractError):
    """The PDF is password-protected, or protected by a security handler PDFium cannot open."""


class UnreadablePdfError(ExtractError):
    """The PDF, or a page in it, could not be read for a reason other than a password."""


@dataclass(frozen=True)
class Page:
    """One page: its 1-based number, its size in PDF points, and its full text."""

    number: int
    width: float
    height: float
    text: str


@dataclass(frozen=True)
class Document:
    """The pages read from a PDF, in order."""

    pages: tuple[Page, ...]


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


def _read_page(pdf_page: pdfium.PdfPage, number: int) -> Page:
    width, height = pdf_page.get_size()
    text_page = pdf_page.get_textpage()
    try:
        # Not `get_text_range`: pypdfium2 documents it as limited to UCS-2, while
        # `get_text_bounded` supports full Unicode. Called with no bounds, it returns the whole
        # page's text.
        text = text_page.get_text_bounded()
    finally:
        text_page.close()
    return Page(number=number, width=width, height=height, text=text)


def extract(pdf: bytes) -> Document:
    """Extract text from every page of `pdf`.

    Raises:
        EncryptedPdfError: the PDF needs a password, or uses a security handler PDFium does not
            support.
        UnreadablePdfError: the PDF, or one of its pages, could not be read for any other reason
            (damaged, no pages, or not really a PDF once pypdfium2 looks past the signature).
    """
    with _PDFIUM_LOCK:
        document = _open_document(pdf)
        try:
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

    return Document(pages=tuple(pages))
