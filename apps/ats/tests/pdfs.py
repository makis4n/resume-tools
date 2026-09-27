"""Builds small, valid PDFs for tests, with invented text only (never real resume content)."""

from collections.abc import Sequence

Line = tuple[str, float, float]  # (text, x, y) of a text-showing operator's Td position


def _escape(text: str) -> bytes:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return escaped.encode("ascii")


def _content_stream(lines: Sequence[Line]) -> bytes:
    parts = [b"BT /F1 12 Tf %g %g Td (%s) Tj ET" % (x, y, _escape(text)) for text, x, y in lines]
    return b" ".join(parts)


def _assemble(objects: Sequence[bytes]) -> bytes:
    """Wrap numbered object bodies with a correct xref, trailer and startxref."""
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\n" % (len(objects) + 1)
    out += b"startxref\n%d\n%%%%EOF\n" % xref
    return bytes(out)


def build_pdf(pages: Sequence[Sequence[Line]], *, width: float = 612, height: float = 792) -> bytes:
    """A valid PDF with one page per entry in `pages`, in a standard-14 font (Helvetica).

    Each page is a sequence of `(text, x, y)` lines, drawn with a `Td` move to `(x, y)` and a `Tj`
    showing `text`; an empty sequence gives a page with no text layer at all. Built by hand with a
    correct xref so tests need no PDF-writing library. Positions are in PDF points, origin at the
    page's bottom-left, matching the coordinates `ats.extract` reports.
    """
    n_pages = len(pages)
    font_obj = 3
    first_page_obj = 4  # each page then takes two objects: the page, then its content stream

    kids = b" ".join(b"%d 0 R" % (first_page_obj + 2 * i) for i in range(n_pages))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, n_pages),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for i, lines in enumerate(pages):
        content = _content_stream(lines)
        content_obj_number = first_page_obj + 2 * i + 1
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %g %g] "
            b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
            % (width, height, font_obj, content_obj_number)
        )
        objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content))

    return _assemble(objects)


def minimal_pdf(text: str = "Invented Person") -> bytes:
    """A one-page PDF with a single line of invented text, at a fixed position."""
    return build_pdf([[(text, 72, 720)]])


def malformed_page_tree_pdf() -> bytes:
    """A PDF whose document loads, but whose one page reference does not point at a page.

    The catalog and page tree parse fine, so `PdfDocument()` succeeds; the page tree's only Kid
    points at the font object instead of a page, so PDFium's `FPDF_LoadPage` fails once a page is
    actually requested. This is the "opens, but a page cannot be read" damaged-PDF case.
    """
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    return _assemble(objects)


def zero_page_pdf() -> bytes:
    """A structurally valid PDF whose page tree declares zero pages."""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [] /Count 0 >>",
    ]
    return _assemble(objects)
