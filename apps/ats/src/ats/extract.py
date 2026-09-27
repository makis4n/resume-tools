"""Reads text and layout from a PDF using pypdfium2 (decision 0032). `ats.analyze` calls `extract`.

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

# PDFium's own error code for "this document needs a password", from FPDF_ERR_PASSWORD.
_FPDF_ERR_PASSWORD = 4


class ExtractError(ValueError):
    """Base class for a PDF that pypdfium2 could not turn into text."""


class EncryptedPdfError(ExtractError):
    """The PDF needs a password pypdfium2 was not given."""


class UnreadablePdfError(ExtractError):
    """The PDF, or a page in it, could not be read for a reason other than a password."""


@dataclass(frozen=True)
class TextBox:
    """One of a text page's rectangles, in PDF points, with the text it bounds."""

    left: float
    bottom: float
    right: float
    top: float
    text: str


@dataclass(frozen=True)
class Page:
    """One page: its 1-based number, its size in PDF points, its full text and its text boxes."""

    number: int
    width: float
    height: float
    text: str
    boxes: tuple[TextBox, ...]


@dataclass(frozen=True)
class Document:
    """The pages read from a PDF, in order."""

    pages: tuple[Page, ...]


def _read_page(pdf_page: pdfium.PdfPage, number: int) -> Page:
    width, height = pdf_page.get_size()
    text_page = pdf_page.get_textpage()
    try:
        text = text_page.get_text_range()
        rect_count = text_page.count_rects()
        boxes = tuple(
            TextBox(left, bottom, right, top, text_page.get_text_bounded(left, bottom, right, top))
            for left, bottom, right, top in (
                text_page.get_rect(index) for index in range(rect_count)
            )
        )
    finally:
        text_page.close()
    return Page(number=number, width=width, height=height, text=text, boxes=boxes)


def extract(pdf: bytes) -> Document:
    """Extract text and layout from every page of `pdf`.

    Raises:
        EncryptedPdfError: the PDF needs a password.
        UnreadablePdfError: the PDF, or one of its pages, could not be read for any other reason
            (damaged, or not really a PDF once pypdfium2 looks past the signature).
    """
    with _PDFIUM_LOCK:
        try:
            document = pdfium.PdfDocument(pdf)
        except pdfium.PdfiumError as error:
            if error.err_code == _FPDF_ERR_PASSWORD:
                raise EncryptedPdfError("the PDF is password-protected") from None
            raise UnreadablePdfError("the PDF could not be opened") from None

        try:
            pages = []
            try:
                for number in range(1, len(document) + 1):
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
