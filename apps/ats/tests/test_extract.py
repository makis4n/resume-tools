import threading
import time
from pathlib import Path

import pytest

from ats.extract import (
    Document,
    EncryptedPdfError,
    UnreadablePdfError,
    _is_symbol_font,
    extract,
)
from tests.pdfs import (
    build_pdf,
    form_wrapped_image_pdf,
    glyph_case_pdf,
    icon_font_pua_pdf,
    image_only_pdf,
    malformed_page_tree_pdf,
    malformed_producer_metadata_pdf,
    minimal_pdf,
    symbol_font_bullet_pdf,
    text_as_outlines_pdf,
    text_resume_with_form_wrapped_graphic_page_pdf,
    zero_page_pdf,
)

FIXTURES = Path(__file__).parent / "fixtures"


def test_extracts_text_per_page_with_page_numbers_and_sizes() -> None:
    pdf = build_pdf(
        [[("Page One Text", 72, 700)], [("Page Two Text", 72, 700)]],
        width=612,
        height=792,
    )
    document = extract(pdf)
    assert [page.number for page in document.pages] == [1, 2]
    assert all(page.width == 612 and page.height == 792 for page in document.pages)
    assert document.pages[0].text == "Page One Text"
    assert document.pages[1].text == "Page Two Text"


def test_a_page_with_no_text_yields_empty_text() -> None:
    pdf = build_pdf([[]])
    (page,) = extract(pdf).pages
    assert page.text == ""


def test_text_outside_the_media_box_still_appears() -> None:
    # 700 is off the right edge of a 612-wide page: get_text_bounded()'s default bounds (the
    # page's displayed box) would silently drop it, which is exactly where hidden or
    # keyword-stuffed text would be placed.
    pdf = build_pdf([[("OnPage", 72, 700), ("OffPage", 700, 700)]], width=612, height=792)
    (page,) = extract(pdf).pages
    assert "OnPage" in page.text
    assert "OffPage" in page.text


def test_text_clipped_by_a_smaller_crop_box_still_appears() -> None:
    pdf = build_pdf([[("Cropped", 500, 700)]], width=612, height=792, crop_box=(0, 0, 400, 792))
    (page,) = extract(pdf).pages
    assert "Cropped" in page.text
    # The displayed size still reflects the crop box, even though the text itself is not clipped.
    assert page.width == 400


def test_the_committed_minimal_fixture_matches_its_builder() -> None:
    # The smoke-test script cannot import tests.pdfs, so it posts this committed file instead;
    # this guards against the file drifting from what minimal_pdf() actually builds.
    assert (FIXTURES / "minimal.pdf").read_bytes() == minimal_pdf()


def test_damaged_bytes_raise_unreadable() -> None:
    truncated = minimal_pdf()[:40]
    with pytest.raises(UnreadablePdfError):
        extract(truncated)


def test_a_pdf_signature_followed_by_junk_raises_unreadable() -> None:
    with pytest.raises(UnreadablePdfError):
        extract(b"%PDF-1.4\n" + b"not a real pdf body" * 20)


def test_a_document_that_opens_but_has_an_unloadable_page_raises_unreadable() -> None:
    with pytest.raises(UnreadablePdfError):
        extract(malformed_page_tree_pdf())


def test_a_document_with_zero_pages_raises_unreadable() -> None:
    with pytest.raises(UnreadablePdfError):
        extract(zero_page_pdf())


def test_an_encrypted_pdf_raises_encrypted() -> None:
    data = (FIXTURES / "encrypted.pdf").read_bytes()
    with pytest.raises(EncryptedPdfError):
        extract(data)


def test_extract_serialises_calls_from_several_threads(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every call into pypdfium2 -- opening a document and reading each page -- must be mutually
    exclusive; this fails if the lock is removed, or narrowed to cover only part of that work."""
    import ats.extract as extract_module

    active = 0
    max_active = 0
    guard = threading.Lock()

    def instrument(real):
        def wrapped(*args, **kwargs):
            nonlocal active, max_active
            with guard:
                active += 1
                max_active = max(max_active, active)
            try:
                # Long enough that a second thread would overlap if unsynchronised.
                time.sleep(0.02)
                return real(*args, **kwargs)
            finally:
                with guard:
                    active -= 1

        return wrapped

    monkeypatch.setattr(extract_module, "_open_document", instrument(extract_module._open_document))
    monkeypatch.setattr(extract_module, "_read_page", instrument(extract_module._read_page))

    pdf = minimal_pdf("Invented Concurrent Person")
    results: list[Document | None] = [None] * 8

    def run(index: int) -> None:
        results[index] = extract(pdf)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(results))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert max_active == 1, "more than one thread was inside pypdfium2 at once"
    assert all(
        result is not None and result.pages[0].text == "Invented Concurrent Person"
        for result in results
    )


def test_a_zero_page_document_closes_the_native_handle(monkeypatch: pytest.MonkeyPatch) -> None:
    """Guards the pypdfium2 5.13.0 leak workaround in `_open_document`: opening a zero-page PDF
    must close the raw handle itself, since pypdfium2's own opener never does on that path."""
    import ats.extract as extract_module

    real_close = extract_module.pdfium.raw.FPDF_CloseDocument
    calls = []

    def tracking_close(raw):
        calls.append(raw)
        return real_close(raw)

    monkeypatch.setattr(extract_module.pdfium.raw, "FPDF_CloseDocument", tracking_close)

    with pytest.raises(UnreadablePdfError):
        extract(zero_page_pdf())

    assert len(calls) == 1


def test_a_plain_text_page_has_one_text_object_and_no_images_or_paths() -> None:
    (page,) = extract(minimal_pdf()).pages
    assert page.char_count == len("InventedPerson")
    assert page.unmapped_count == 0
    assert page.private_use_count == 0
    assert page.ligature_count == 0
    assert page.text_objects == 1
    assert page.image_objects == 0
    assert page.path_objects == 0


def test_char_count_excludes_a_pdfium_generated_space() -> None:
    # Two separate show-text operators with a horizontal gap and no explicit space character:
    # PDFium inserts a generated space between them (verified experimentally against pypdfium2
    # 5.13.0), which must not inflate `char_count` or any of the counts derived from it.
    pdf = build_pdf([[("One", 72, 700), ("Two", 112, 700)]])
    (page,) = extract(pdf).pages
    assert page.text == "One Two"
    assert page.char_count == len("OneTwo")


def test_image_only_page_reports_an_image_object_and_no_text() -> None:
    (page,) = extract(image_only_pdf()).pages
    assert page.char_count == 0
    assert page.text_objects == 0
    assert page.image_objects == 1
    assert page.path_objects == 0


def test_text_as_outlines_page_reports_only_path_objects() -> None:
    (page,) = extract(text_as_outlines_pdf(rectangles=15)).pages
    assert page.char_count == 0
    assert page.text_objects == 0
    assert page.image_objects == 0
    assert page.path_objects == 15


def test_glyph_case_pdf_reports_a_private_use_and_an_unmapped_character() -> None:
    # Built by tests.pdfs.glyph_case_pdf(): see its docstring for what was verified about each
    # code, and why no fixture here can make `ligature_count` positive.
    (page,) = extract(glyph_case_pdf()).pages
    assert page.char_count == 2
    assert page.private_use_count == 1
    assert page.unmapped_count == 1
    assert page.ligature_count == 0
    assert "" in page.text


def test_document_reads_producer_and_creator_metadata() -> None:
    pdf = build_pdf(
        [[("Invented Text", 72, 700)]],
        producer="pdfTeX-1.40.26",
        creator="Invented Template with LaTeX",
    )
    document = extract(pdf)
    assert document.producer == "pdfTeX-1.40.26"
    assert document.creator == "Invented Template with LaTeX"


def test_document_metadata_with_a_non_ascii_value_round_trips() -> None:
    # Written as UTF-16BE with a byte-order mark (tests.pdfs._text_string); this guards against
    # that encoding choice being wrong.
    pdf = build_pdf([[("Invented Text", 72, 700)]], producer="Microsoft® Word for Microsoft 365")
    document = extract(pdf)
    assert document.producer == "Microsoft® Word for Microsoft 365"


def test_document_metadata_is_none_when_absent() -> None:
    document = extract(minimal_pdf())
    assert document.producer is None
    assert document.creator is None


def test_malformed_metadata_reads_as_none_rather_than_failing_the_whole_page() -> None:
    # The page's own text is perfectly fine; only the untrusted /Producer metadata is broken.
    document = extract(malformed_producer_metadata_pdf())
    assert document.producer is None
    assert document.pages[0].text == "Invented Text"


def test_ligature_count_classifies_a_raw_ligature_codepoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No real PDF can make pypdfium2 report a raw ligature codepoint at all: see
    `tests.pdfs.glyph_case_pdf`'s docstring for what was verified -- PDFium always expands one of
    U+FB00-FB06 into its plain-letter equivalent before `FPDFText_GetUnicode` ever returns it, no
    matter how the character's Unicode value was derived. This drives that one call directly
    instead, to prove `ats.extract._char_stats` classifies U+FB01 as a ligature when it is
    actually given one.

    `_char_stats` normally trusts `text[i]` to line up with character-list index `i` rather than
    calling `FPDFText_GetUnicode` (see its docstring), so this also has to force that assumption
    false -- passing a `text` argument that cannot possibly match `count_chars()` -- rather than
    querying an out-of-range character index, whose behaviour PDFium does not document.
    """
    import ats.extract as extract_module

    real_get_unicode = extract_module.pdfium.raw.FPDFText_GetUnicode

    def fake_get_unicode(text_page: object, index: int) -> int:
        return 0xFB01 if index == 0 else real_get_unicode(text_page, index)

    monkeypatch.setattr(extract_module.pdfium.raw, "FPDFText_GetUnicode", fake_get_unicode)

    pdf = minimal_pdf("A")
    with extract_module._PDFIUM_LOCK:
        document = extract_module._open_document(pdf)
        try:
            pdf_page = document.get_page(0)
            try:
                text_page = pdf_page.get_textpage()
                try:
                    stats = extract_module._char_stats(text_page, text="")
                finally:
                    text_page.close()
            finally:
                pdf_page.close()
        finally:
            document.close()

    char_count, unmapped_count, private_use_count, ligature_count = stats
    assert char_count == 1
    assert ligature_count == 1
    assert unmapped_count == 0
    assert private_use_count == 0


def test_a_form_wrapped_image_is_counted_as_an_image() -> None:
    (page,) = extract(form_wrapped_image_pdf()).pages
    assert (page.text_objects, page.image_objects, page.path_objects) == (0, 1, 0)


def test_a_form_wrapped_graphic_is_counted_as_a_path() -> None:
    _, graphic_page = extract(text_resume_with_form_wrapped_graphic_page_pdf()).pages
    assert (graphic_page.text_objects, graphic_page.image_objects) == (0, 0)
    assert graphic_page.path_objects == 1


def test_a_symbol_font_bullet_is_not_an_icon_font_glyph() -> None:
    (page,) = extract(symbol_font_bullet_pdf()).pages
    assert page.char_count == 1
    assert page.private_use_count == 0


def test_an_icon_font_private_use_glyph_is_still_counted() -> None:
    (page,) = extract(icon_font_pua_pdf()).pages
    assert page.private_use_count == 1


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Symbol", True),
        ("ABCDEF+Symbol", True),
        ("Wingdings 2", True),
        ("ABCDEF+Wingdings3", True),
        ("webdings", True),
        ("FontAwesome", False),
        ("", False),
        (None, False),
    ],
)
def test_is_symbol_font(name: str | None, expected: bool) -> None:
    assert _is_symbol_font(name) is expected
