"""Builds small, valid PDFs for tests, with invented text only (never real resume content)."""

from collections.abc import Sequence

Line = tuple[str, float, float]  # (text, x, y) of a text-showing operator's Td position


def _escape(text: str) -> bytes:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return escaped.encode("ascii")


def _escape_bytes(raw: bytes) -> bytes:
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def _content_stream(lines: Sequence[Line]) -> bytes:
    parts = [b"BT /F1 12 Tf %g %g Td (%s) Tj ET" % (x, y, _escape(text)) for text, x, y in lines]
    return b" ".join(parts)


def _text_string(text: str) -> bytes:
    """A PDF text string literal encoding `text` as UTF-16BE with a leading byte-order mark, so a
    metadata value outside ASCII (e.g. "Microsoft® Word") round-trips correctly. Verified
    experimentally against pypdfium2 5.13.0's `PdfDocument.get_metadata_value`."""
    raw = b"\xfe\xff" + text.encode("utf-16-be")
    return b"(" + _escape_bytes(raw) + b")"


def _assemble(objects: Sequence[bytes], info: bytes | None = None) -> bytes:
    """Wrap numbered object bodies with a correct xref, trailer and startxref.

    `info`, if given, is appended as one more numbered object and referenced from the trailer's
    `/Info`. Omitted, the trailer is byte-identical to before this parameter existed.
    """
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    info_ref = b""
    if info is not None:
        info_number = len(objects) + 1
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (info_number, info)
        info_ref = b" /Info %d 0 R" % info_number
    xref = len(out)
    size = len(offsets) + 1
    out += b"xref\n0 %d\n0000000000 65535 f \n" % size
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R%s >>\n" % (size, info_ref)
    out += b"startxref\n%d\n%%%%EOF\n" % xref
    return bytes(out)


def build_pdf(
    pages: Sequence[Sequence[Line]],
    *,
    width: float = 612,
    height: float = 792,
    crop_box: tuple[float, float, float, float] | None = None,
    producer: str | None = None,
    creator: str | None = None,
) -> bytes:
    """A valid PDF with one page per entry in `pages`, in a standard-14 font (Helvetica).

    Each page is a sequence of `(text, x, y)` lines, drawn with a `Td` move to `(x, y)` and a `Tj`
    showing `text`; an empty sequence gives a page with no text layer at all. Built by hand with a
    correct xref so tests need no PDF-writing library. Positions are in PDF points, origin at the
    page's bottom-left.

    `crop_box`, as `(left, bottom, right, top)`, sets every page's `/CropBox`; omitted, a page has
    none and its displayed box is the full `MediaBox`.

    `producer` and `creator`, if given, are written into an `/Info` dictionary referenced from the
    trailer, matching what `ats.extract.Document.producer`/`.creator` then reads back.
    """
    n_pages = len(pages)
    font_obj = 3
    first_page_obj = 4  # each page then takes two objects: the page, then its content stream
    crop_box_entry = b" /CropBox [%g %g %g %g]" % crop_box if crop_box else b""

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
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %g %g]%s "
            b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
            % (width, height, crop_box_entry, font_obj, content_obj_number)
        )
        objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content))

    info = None
    if producer is not None or creator is not None:
        parts = []
        if producer is not None:
            parts.append(b"/Producer " + _text_string(producer))
        if creator is not None:
            parts.append(b"/Creator " + _text_string(creator))
        info = b"<< " + b" ".join(parts) + b" >>"

    return _assemble(objects, info=info)


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


def malformed_producer_metadata_pdf() -> bytes:
    """An otherwise perfectly readable one-page PDF whose `/Producer` metadata string is not
    valid UTF-16: a byte-order mark followed by a lone UTF-16 high surrogate with no matching low
    surrogate.

    Verified experimentally against pypdfium2 5.13.0: reading this value with
    `PdfDocument.get_metadata_value` raises `UnicodeDecodeError`, which
    `ats.extract._metadata_value` must not let escape and fail the analysis of a page that reads
    just fine otherwise.
    """
    content = b"BT /F1 12 Tf 72 700 Td (Invented Text) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
    ]
    bad_bytes = b"\xfe\xff" + bytes([0xD8, 0x00, 0x00, 0x41])
    info = b"<< /Producer (" + _escape_bytes(bad_bytes) + b") >>"
    return _assemble(objects, info=info)


def image_only_pdf(*, width: float = 612, height: float = 792) -> bytes:
    """A one-page PDF with a single small image and no text at all, e.g. a scanned resume.

    The image is a 1x1 DeviceGray XObject with one uncompressed sample byte, drawn once with `Do`.
    Verified experimentally against pypdfium2 5.13.0: the page's object counts come back as
    `(text=0, image=1, path=0)`, and `count_chars()` as 0.
    """
    image_stream = (
        b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray "
        b"/BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream"
    )
    content = b"q %g 0 0 %g 0 0 cm /Im1 Do Q" % (width, height)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %g %g] "
        b"/Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>" % (width, height),
        image_stream,
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
    ]
    return _assemble(objects)


def text_as_outlines_pdf(*, width: float = 612, height: float = 792, rectangles: int = 15) -> bytes:
    """A one-page PDF with no text at all, only filled rectangles -- standing in for a PDF where
    every glyph was exported as a drawn shape (e.g. Canva's flattened export), rather than real
    text.

    Verified experimentally against pypdfium2 5.13.0: with `rectangles=15` and no text or image
    objects, the page's object counts come back as `(text=0, image=0, path=15)`.
    """
    rects = b" ".join(b"%d 10 20 20 re f" % (10 + 30 * i) for i in range(rectangles))
    content = b"0 0 0 rg " + rects
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %g %g] /Contents 4 0 R >>" % (width, height),
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
    ]
    return _assemble(objects)


def glyph_case_pdf() -> bytes:
    """A one-page PDF whose one line of text has an icon-font (PUA) glyph and an unmapped glyph,
    via a standard-14 font with a custom `/Encoding << /Differences [...] >>` array.

    Two character codes are remapped by name: one to `/uniE001` (the "uniXXXX" glyph-name
    convention pypdfium2/PDFium resolves directly to that Unicode codepoint, U+E001, inside the
    Private Use Area), and one to `/g0042` (a made-up name PDFium cannot resolve at all).

    Verified experimentally against pypdfium2 5.13.0: `/uniE001` extracts as U+E001 with
    `FPDFText_HasUnicodeMapError` false, so it counts as a private-use character but not an
    unmapped one; `/g0042` extracts as *some* fallback codepoint from the font's base encoding
    (not U+FFFD or U+0000), but with `FPDFText_HasUnicodeMapError` true, which is what
    `ats.extract._char_stats` actually keys `unmapped_count` off -- the specific fallback
    codepoint does not matter and is not asserted on.

    No fixture here exercises `ligature_count` with a real PDF. Every standard-14 ligature glyph
    name (`/fi`, `/ff`, `/fl`, `/ffi`, `/ffl`) and every explicit `/ToUnicode` mapping to one of
    U+FB00-FB06 that this module tried -- including through a Type0/CID font, bypassing glyph-name
    resolution entirely -- came back from pypdfium2 5.13.0 already split into its plain-letter
    expansion (e.g. "fi" as two separate, fully-mapped characters, `f` then `i`), never as the
    single ligature codepoint. PDFium normalises these ligatures away unconditionally, regardless
    of how the character's Unicode value was derived, so a PDF that would make `ligature_count`
    positive could not be built for this test; `tests/test_extract.py` covers the classification
    logic itself by controlling `FPDFText_GetUnicode`'s return value directly instead.
    """
    codes = bytes([34, 35])  # '"' and '#'; neither needs string-literal escaping
    content = b"BT /F1 12 Tf 72 700 Td (" + codes + b") Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
        b"/Encoding << /Differences [34 /uniE001 /g0042] >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
    ]
    return _assemble(objects)


def form_wrapped_image_pdf(*, width: float = 612, height: float = 792) -> bytes:
    """A one-page PDF with a single small image and no text at all, like `image_only_pdf`, but
    with the image drawn inside a Form XObject rather than directly on the page -- as scanner and
    print-driver output commonly does.

    Verified experimentally against pypdfium2 5.13.0: a page-object count that only looks at the
    page's own top-level objects comes back `(text=0, image=0, path=0)` for this fixture -- the
    image is invisible to it, entirely because of the wrapping form, not because it is missing --
    while one that recurses into the Form XObject finds it, at `(text=0, image=1, path=0)`.
    """
    image_stream = (
        b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray "
        b"/BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream"
    )
    form_content = b"q %g 0 0 %g 0 0 cm /Im1 Do Q" % (width, height)
    form_stream = (
        b"<< /Type /XObject /Subtype /Form /BBox [0 0 %g %g] "
        b"/Resources << /XObject << /Im1 4 0 R >> >> /Length %d >>\nstream\n%s\nendstream"
    ) % (width, height, len(form_content), form_content)
    page_content = b"q 1 0 0 1 0 0 cm /Fm1 Do Q"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %g %g] "
        b"/Resources << /XObject << /Fm1 5 0 R >> >> /Contents 6 0 R >>" % (width, height),
        image_stream,
        form_stream,
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(page_content), page_content),
    ]
    return _assemble(objects)


def text_resume_with_form_wrapped_graphic_page_pdf() -> bytes:
    """A two-page PDF: page 1 has ordinary extractable text; page 2 has no text at all, only a
    single filled rectangle -- a decorative graphic, say -- drawn inside a Form XObject, so it has
    no top-level path object of its own either.

    Regression fixture for the `blank-page` check: a page-object count that does not recurse into
    the Form XObject sees page 2 as `(text=0, image=0, path=0)`, indistinguishable from a page
    that is genuinely blank; recursing finds the rectangle, at `(text=0, image=0, path=1)`.
    """
    text_content = b"BT /F1 12 Tf 72 700 Td (Invented Text) Tj ET"
    rect_content = b"0 0 0 rg 10 10 50 50 re f"
    page2_content = b"q 1 0 0 1 0 0 cm /Fm1 Do Q"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 8 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(text_content), text_content),
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /XObject << /Fm1 6 0 R >> >> /Contents 7 0 R >>",
        b"<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] /Length %d >>\nstream\n%s\nendstream"
        % (len(rect_content), rect_content),
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(page2_content), page2_content),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    return _assemble(objects)


def _pua_char_pdf(base_font: bytes, code: int, unicode_hex: str) -> bytes:
    """A one-page PDF whose one character is drawn in a font named `base_font`, with its Unicode
    value set to `unicode_hex` (a 4-hex-digit codepoint) by an explicit `/ToUnicode` CMap.

    A CMap is used rather than `/Encoding << /Differences [...] >>` (as `glyph_case_pdf` uses)
    because a font literally named "Symbol" is treated as an inherently symbolic font: verified
    experimentally against pypdfium2 5.13.0, PDFium ignores `/Differences` glyph-name overrides
    for it entirely (the character extracts as U+0000 with no font name resolved at all), but
    correctly reports both the intended Unicode value and the font name once a `/ToUnicode` CMap
    is present instead.
    """
    tounicode = (
        b"/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n"
        b"1 begincodespacerange\n<00> <ff>\nendcodespacerange\n"
        b"1 beginbfchar\n<%02x> <%s>\nendbfchar\nendcmap\nend\nend\n" % (code, unicode_hex.encode())
    )
    content = b"BT /F1 12 Tf 72 700 Td (" + bytes([code]) + b") Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /" + base_font + b" /ToUnicode 5 0 R >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(tounicode), tounicode),
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
    ]
    return _assemble(objects)


def symbol_font_bullet_pdf() -> bytes:
    """A one-page PDF whose only character is U+F0B7 (a filled square, Word's default bullet
    glyph) drawn in a font literally named "Symbol" -- exactly how Word encodes a bulleted list
    item.

    Verified experimentally against pypdfium2 5.13.0: `FPDFText_GetFontInfo` reports the font
    name back as `"Symbol"` for this character. A subset-embedded font's `"ABCDEF+Symbol"`-style
    prefix could not be exercised this way -- pypdfium2 could not resolve *any* character in a
    subset-prefixed "Symbol" font with no embedded font program at all, which no synthetic
    fixture without a real embedded TrueType/Type1 font program can avoid. The prefix-stripping
    itself is a pure string operation, so `test_extract.py` tests `ats.extract._is_symbol_font`
    directly with a plain string instead of via a built PDF.
    """
    return _pua_char_pdf(b"Symbol", 34, "F0B7")


def postscript_named_symbol_bullet_pdf() -> bytes:
    """Like `symbol_font_bullet_pdf`, but the font's BaseFont is the PostScript name Office
    writes ("Wingdings-Regular") rather than the bare family name."""
    return _pua_char_pdf(b"Wingdings-Regular", 34, "F0A7")


def icon_font_pua_pdf() -> bytes:
    """A one-page PDF whose only character is U+F0FC, drawn in a font named "FontAwesome" -- an
    icon font with no real text behind its glyphs, which sits in the same Private Use Area range
    Word's Symbol-font bullets do (decision 0083's `icon-font-glyphs` check must still catch it).

    Verified experimentally against pypdfium2 5.13.0: `FPDFText_GetFontInfo` reports the font
    name back as `"FontAwesome"`, which is not one of `ats.extract._SYMBOL_FONT_NAMES`.
    """
    return _pua_char_pdf(b"FontAwesome", 34, "F0FC")


def supplementary_icon_font_pdf() -> bytes:
    """A one-page PDF whose only character is U+F0001 (Supplementary Private Use Area-A, where
    Material Design Icons and Nerd Fonts sit), drawn in a font named "MaterialDesignIcons". The
    ToUnicode value is the UTF-16 surrogate pair DB80 DC01."""
    return _pua_char_pdf(b"MaterialDesignIcons", 34, "DB80DC01")


def build_raw_pdf(
    content: bytes,
    *,
    resources: bytes = b"",
    extra_objects: Sequence[bytes] = (),
    width: float = 612,
    height: float = 792,
    crop_box: tuple[float, float, float, float] | None = None,
) -> bytes:
    """A one-page PDF drawing `content` (a raw content stream) with Helvetica as `/F1`.

    `resources` is extra entries for the page's `/Resources` dictionary (e.g. `/XObject << ... >>`
    or `/ExtGState << ... >>`). `extra_objects` are further numbered objects, starting at object
    5, which `resources` can reference (4 is the font; 1-3 the catalog, page tree and page, with
    the content stream last).
    """
    crop_box_entry = b" /CropBox [%g %g %g %g]" % crop_box if crop_box else b""
    first_extra = 5
    content_number = first_extra + len(extra_objects)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %g %g]%s "
        b"/Resources << /Font << /F1 4 0 R >> %s >> /Contents %d 0 R >>"
        % (width, height, crop_box_entry, resources, content_number),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        *extra_objects,
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
    ]
    return _assemble(objects)


_GRAY_IMAGE = (
    b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray "
    b"/BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream"
)


def _scan_image(gray: int, *, pixels: int = 306) -> bytes:
    """A DeviceGray image of `pixels` x `pixels` (0.5 pixel per point on a 612 pt page, the least
    that counts as a scan), all one gray level."""
    import zlib

    data = zlib.compress(bytes([gray]) * (pixels * pixels))
    return (
        b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray "
        b"/BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n%s\nendstream"
        % (pixels, pixels, len(data), data)
    )


def invisible_text_pdf(mode: int = 3) -> bytes:
    """Invented text drawn with text render mode `mode` (3 invisible, 7 clip). pypdfium2 5.13.0
    extracts it normally and reports the mode through `FPDFTextObj_GetTextRenderMode`."""
    return build_raw_pdf(b"BT /F1 12 Tf %d Tr 72 700 Td (Invented Keyword Block) Tj ET" % mode)


def transparent_text_pdf() -> bytes:
    """Invented text under an ExtGState with `/ca 0`; pypdfium2 5.13.0 reports a fill alpha of 0."""
    return build_raw_pdf(
        b"/GS1 gs BT /F1 12 Tf 72 700 Td (Invented Keyword Block) Tj ET",
        resources=b"/ExtGState << /GS1 << /ca 0 >> >>",
    )


def white_text_pdf(gray: float = 1.0) -> bytes:
    """Invented text filled with gray level `gray` on a bare page. pypdfium2 5.13.0 reports a fill
    of (255, 255, 255, 255) for 1.0; about (247, ...) for 0.97."""
    return build_raw_pdf(b"BT %g g /F1 12 Tf 72 700 Td (Invented Keyword Block) Tj ET" % gray)


def white_text_on_dark_panel_pdf() -> bytes:
    """A dark filled sidebar rectangle with white invented text inside it, as in a two-column
    template. The text's loose box lies inside the path's bounds, so it is not hidden."""
    return build_raw_pdf(
        b"0.1 0.1 0.3 rg 0 0 200 792 re f BT 1 g /F1 12 Tf 20 700 Td (Invented Sidebar Text) Tj ET"
    )


def white_text_over_image_pdf() -> bytes:
    """White invented text drawn over a full-page image, which is a cover."""
    return build_raw_pdf(
        b"q 612 0 0 792 0 0 cm /Im1 Do Q BT 1 g /F1 12 Tf 72 700 Td (Invented Overlay Text) Tj ET",
        resources=b"/XObject << /Im1 5 0 R >>",
        extra_objects=[_GRAY_IMAGE],
    )


def tiny_text_pdf(size: float = 1) -> bytes:
    """Invented text at `size` points; pypdfium2 5.13.0 reports a loose box about 1.1 high at 1."""
    return build_raw_pdf(b"BT /F1 %g Tf 72 700 Td (Invented Keyword Block) Tj ET" % size)


def matrix_scaled_text_pdf(*, use_cm: bool = False) -> bytes:
    """12 pt invented text scaled by a 0.05 text matrix (or a 0.05 `cm` when `use_cm`). The font
    size operand still says 12, but the loose box is about 0.67 high in page space."""
    if use_cm:
        return build_raw_pdf(
            b"q 0.05 0 0 0.05 0 0 cm BT /F1 12 Tf 1440 14000 Td (Invented Keyword Block) Tj ET Q"
        )
    return build_raw_pdf(b"BT /F1 12 Tf 0.05 0 0 0.05 72 700 Tm (Invented Keyword Block) Tj ET")


def off_page_text_pdf() -> bytes:
    """Invented text at x=900 on a 612 pt page; pypdfium2 5.13.0 keeps its true coordinates."""
    return build_raw_pdf(b"BT /F1 12 Tf 900 700 Td (Invented Keyword Block) Tj ET")


def text_outside_crop_box_pdf() -> bytes:
    """Invented text inside the MediaBox but outside a smaller CropBox."""
    return build_raw_pdf(
        b"BT /F1 12 Tf 72 700 Td (Visible Invented Line) Tj ET "
        b"BT /F1 12 Tf 400 100 Td (Invented Keyword Block) Tj ET",
        crop_box=(0, 400, 300, 792),
    )


def ocr_layer_pdf() -> bytes:
    """A full-page image with invisible (3 Tr) invented text over it, as an OCR'd scan has."""
    return build_raw_pdf(
        b"q 612 0 0 792 0 0 cm /Im1 Do Q BT 3 Tr /F1 12 Tf 72 700 Td (Invented Scanned Line) Tj ET",
        resources=b"/XObject << /Im1 5 0 R >>",
        extra_objects=[_scan_image(0xF0, pixels=612)],
    )


def invisible_text_over_stretched_pixel_pdf() -> bytes:
    """Invisible invented keywords over a 1x1 white image stretched across the page: a colour
    wash, not a scan, so it excuses nothing."""
    return build_raw_pdf(
        b"q 612 0 0 792 0 0 cm /Im1 Do Q "
        b"BT 3 Tr /F1 12 Tf 72 700 Td (Invented Keyword Block) Tj ET",
        resources=b"/XObject << /Im1 5 0 R >>",
        extra_objects=[_GRAY_IMAGE.replace(b"\x80", b"\xff")],
    )


_SHADING_RESOURCES = (
    b"/Pattern << /P1 << /PatternType 2 /Shading << /ShadingType 2 /ColorSpace /DeviceRGB "
    b"/Coords [0 0 612 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [0.1 0.1 0.3] "
    b"/C1 [0.2 0.1 0.4] /N 1 >> >> >> >> "
    b"/Shading << /Sh1 << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 612 0] "
    b"/Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> >> >>"
)


def white_text_on_gradient_band_pdf() -> bytes:
    """White invented text on a band filled with an axial shading pattern. PDFium reports that
    path's fill colour as white, so only a render shows the band is dark."""
    return build_raw_pdf(
        b"/Pattern cs /P1 scn 0 680 612 60 re f "
        b"BT 1 g /F1 12 Tf 20 700 Td (Invented Header Text On Band) Tj ET",
        resources=_SHADING_RESOURCES,
    )


def white_text_on_stroked_bar_pdf() -> bytes:
    """White invented text on a thick stroked (not filled) dark bar."""
    return build_raw_pdf(
        b"0 0 0.4 RG 60 w 0 710 m 612 710 l S "
        b"BT 1 g /F1 12 Tf 20 704 Td (Invented Header Text On Band) Tj ET"
    )


def outlined_white_text_pdf() -> bytes:
    """Invented heading with a white fill and a dark stroke (render mode 2): readable."""
    return build_raw_pdf(
        b"BT 1 g 0 0 0 RG 1 w 2 Tr /F1 24 Tf 72 700 Td (Invented Outlined Heading) Tj ET"
    )


def white_text_over_a_dark_speck_pdf() -> bytes:
    """A run of white invented keywords with a small dark rectangle under only its first
    character; the rest of the run is on a bare page."""
    return build_raw_pdf(
        b"0 g 72 698 6 8 re f BT 1 g /F1 12 Tf 72 700 Td "
        b"(python java golang kubernetes docker terraform python java) Tj ET"
    )


def gradient_clip_text_pdf() -> bytes:
    """A heading drawn as a clipping path (7 Tr) with a shading painted through it: visible."""
    return build_raw_pdf(
        b"q BT 7 Tr /F1 24 Tf 72 700 Td (Invented Person Fullname Here) Tj ET /Sh1 sh Q",
        resources=_SHADING_RESOURCES,
    )


def reversed_media_box_pdf() -> bytes:
    """Ordinary invented text on a page whose MediaBox names its corners top-right first."""
    return build_raw_pdf(
        b"BT /F1 12 Tf 72 700 Td (Invented Normal Text Line Here) Tj ET", crop_box=(612, 792, 0, 0)
    )


def invisible_text_in_form_pdf() -> bytes:
    """Invisible (3 Tr) invented text inside a Form XObject; PDFium resolves its text object."""
    form_content = b"BT /F1 12 Tf 3 Tr 72 700 Td (Invented Keyword Block) Tj ET"
    form = (
        b"<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Length %d >>\nstream\n%s\nendstream"
        % (len(form_content), form_content)
    )
    return build_raw_pdf(
        b"q 1 0 0 1 0 0 cm /Fm1 Do Q",
        resources=b"/XObject << /Fm1 5 0 R >>",
        extra_objects=[form],
    )


def white_and_tiny_text_pdf() -> bytes:
    """Invented text that is both white and 1 pt, to show one character counting once overall."""
    return build_raw_pdf(b"BT 1 g /F1 1 Tf 72 700 Td (Invented Keyword Block) Tj ET")


def hidden_stuffing_resume_pdf() -> bytes:
    """Normal visible invented resume lines plus a white 1 pt block of invented keywords."""
    visible = (
        b"BT /F1 12 Tf 72 740 Td (Invented Person) Tj "
        b"0 -20 Td (Software Engineer at Example Co) Tj "
        b"0 -20 Td (Built invented services and tools) Tj ET "
    )
    hidden = b"BT 1 g /F1 1 Tf 72 40 Td (python java golang kubernetes docker terraform) Tj ET"
    return build_raw_pdf(visible + hidden)


def normal_resume_pdf() -> bytes:
    """A plausible invented resume: black body text, a 7 pt footer, a dark sidebar with white
    text and a light-grey (0.6) date line. None of it is hidden."""
    content = (
        b"0.1 0.1 0.3 rg 0 0 180 792 re f "
        b"BT 1 g /F1 11 Tf 20 700 Td (Invented Contact) Tj 0 -16 Td (Skills Column) Tj ET "
        b"BT 0 g /F1 12 Tf 210 740 Td (Invented Person) Tj 0 -18 Td (Software Engineer) Tj "
        b"0 -18 Td (Built invented services and tools) Tj ET "
        b"BT 0.6 g /F1 10 Tf 210 660 Td (2020 to 2024) Tj ET "
        b"BT 0 g /F1 7 Tf 210 30 Td (Invented footer note) Tj ET"
    )
    return build_raw_pdf(content)


def squashed_text_pdf(kind: str) -> bytes:
    """Invented 12 pt keyword text squashed along one axis: "vertical" with a flat text matrix,
    "horizontal" with `Tz 1`. Each is a sliver the ATS still reads."""
    text = b"(Invented Keyword Block For Squashing Tests) Tj ET"
    if kind == "vertical":
        return build_raw_pdf(b"BT /F1 12 Tf 1 0 0 0.01 72 700 Tm " + text)
    return build_raw_pdf(b"BT /F1 12 Tf 1 Tz 72 700 Td " + text)


def invisible_text_beside_a_photo_in_a_form_pdf() -> bytes:
    """A page-wrapping Form XObject holding a small headshot image at the top right, drawn on
    the page; invisible invented keywords sit far from the photo, so no scan lies under them."""
    form_content = b"q 60 0 0 60 500 720 cm /Im1 Do Q 0 0 612 792 re S"
    form = (
        b"<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] "
        b"/Resources << /XObject << /Im1 6 0 R >> >> /Length %d >>\nstream\n%s\nendstream"
        % (len(form_content), form_content)
    )
    return build_raw_pdf(
        b"/Fm1 Do BT 3 Tr /F1 12 Tf 72 400 Td (Invented Keyword Block For Stuffing) Tj ET",
        resources=b"/XObject << /Fm1 5 0 R >>",
        extra_objects=[form, _scan_image(0x80, pixels=100)],
    )


def many_pages_of_white_text_pdf(pages: int) -> bytes:
    """`pages` pages sharing one content stream of a single white invented character."""
    content = b"BT 1 g /F1 10 Tf 72 700 Td (x) Tj ET"
    kids = b" ".join(b"%d 0 R" % (5 + number) for number in range(pages))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, pages),
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"",
    ]
    objects[4:] = [
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 3 0 R >>"
    ] * pages
    return _assemble(objects)
