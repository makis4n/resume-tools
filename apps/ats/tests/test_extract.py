import threading
from pathlib import Path

import pytest

from ats.extract import Document, EncryptedPdfError, UnreadablePdfError, extract
from tests.pdfs import build_pdf, malformed_page_tree_pdf, minimal_pdf

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


def test_boxes_carry_positions_and_their_text() -> None:
    document = extract(minimal_pdf("Invented Box Text"))
    (page,) = document.pages
    assert len(page.boxes) == 1
    box = page.boxes[0]
    assert box.text == "Invented Box Text"
    assert box.left < box.right
    assert box.bottom < box.top


def test_a_two_column_layout_has_boxes_with_distinct_x_positions() -> None:
    pdf = build_pdf([[("Left Column", 72, 700), ("Right Column", 320, 700)]])
    (page,) = extract(pdf).pages
    assert len(page.boxes) == 2
    lefts = sorted(box.left for box in page.boxes)
    assert lefts[1] - lefts[0] > 100


def test_a_page_with_no_text_yields_empty_text_and_no_boxes() -> None:
    pdf = build_pdf([[]])
    (page,) = extract(pdf).pages
    assert page.text == ""
    assert page.boxes == ()


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


def test_an_encrypted_pdf_raises_encrypted() -> None:
    data = (FIXTURES / "encrypted.pdf").read_bytes()
    with pytest.raises(EncryptedPdfError):
        extract(data)


def test_extract_is_safe_to_call_from_several_threads_at_once() -> None:
    pdf = minimal_pdf("Invented Concurrent Person")
    results: list[Document | Exception] = [None] * 8  # type: ignore[list-item]

    def run(index: int) -> None:
        try:
            results[index] = extract(pdf)
        except Exception as error:  # noqa: BLE001
            results[index] = error

    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(results))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert all(isinstance(result, Document) for result in results)
    assert all(result.pages[0].text == "Invented Concurrent Person" for result in results)
