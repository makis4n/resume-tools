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
    """Every call into pypdfium2 must be mutually exclusive; this fails if the lock is removed
    or narrowed to cover less than the whole open-read-close sequence."""
    import ats.extract as extract_module

    real_open_document = extract_module._open_document
    active = 0
    max_active = 0
    guard = threading.Lock()

    def tracking_open_document(pdf: bytes) -> extract_module.pdfium.PdfDocument:
        nonlocal active, max_active
        with guard:
            active += 1
            max_active = max(max_active, active)
        try:
            time.sleep(0.05)  # long enough that a second thread would overlap if unsynchronised
            return real_open_document(pdf)
        finally:
            with guard:
                active -= 1

    monkeypatch.setattr(extract_module, "_open_document", tracking_open_document)

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
