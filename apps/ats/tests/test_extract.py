import threading
import time
from pathlib import Path

import pytest

from ats.extract import Document, EncryptedPdfError, UnreadablePdfError, extract
from tests.pdfs import build_pdf, malformed_page_tree_pdf, minimal_pdf, zero_page_pdf

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
