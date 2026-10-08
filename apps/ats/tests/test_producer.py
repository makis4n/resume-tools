import pytest

from ats.producer import Producer, classify


@pytest.mark.parametrize(
    ("producer", "creator"),
    [
        ("pdfTeX-1.40.26", None),
        ("xdvipdfmx (20240305)", None),
        (None, "LaTeX with hyperref"),
        ("XeTeX 3.141592653-2.6-0.999996", None),
        ("LuaTeX-1.17.0", None),
        ("dvipdfm 0.13.2d", None),
    ],
)
def test_classifies_latex(producer: str | None, creator: str | None) -> None:
    assert classify(producer, creator) is Producer.LATEX


@pytest.mark.parametrize(
    ("producer", "creator"),
    [
        ("Microsoft® Word for Microsoft 365", None),
        ("Microsoft: Word 2019", None),
        (None, "Microsoft Word"),
    ],
)
def test_classifies_word(producer: str | None, creator: str | None) -> None:
    assert classify(producer, creator) is Producer.WORD


def test_classifies_google_docs() -> None:
    assert classify("Skia/PDF m128 Google Docs Renderer", None) is Producer.GOOGLE_DOCS


def test_classifies_canva() -> None:
    assert classify("Canva", None) is Producer.CANVA


def test_classifies_missing_metadata_as_other() -> None:
    assert classify(None, None) is Producer.OTHER


def test_classifies_unrecognised_tool_as_other() -> None:
    assert classify("Invented Resume Tool 3.0", "Invented Resume Tool") is Producer.OTHER


def test_matching_is_case_insensitive() -> None:
    assert classify("CANVA", None) is Producer.CANVA
    assert classify("PDFTEX-1.40.26", None) is Producer.LATEX


def test_word_needs_both_tokens() -> None:
    # "Word" alone, with no mention of Microsoft, is not enough to call it Word.
    assert classify("Word Processor Pro", None) is Producer.OTHER


def test_a_word_filename_mentioning_latex_still_classifies_as_word() -> None:
    # Word writes a Creator like "Microsoft Word - <filename>"; a job seeker naming their own
    # file "latex_style_resume.docx" must not turn a Word export into a LaTeX one.
    assert classify(None, "Microsoft Word - latex_style_resume.docx") is Producer.WORD


def test_producer_wins_even_when_creator_suggests_something_else() -> None:
    # Producer is written by the tool itself, not a user-editable field; it is trusted first and
    # Creator is not even consulted once Producer gives an answer.
    assert classify("Canva", "Microsoft Word") is Producer.CANVA


def test_creator_is_only_consulted_when_producer_is_other() -> None:
    assert classify("Some Unrecognised Producer String", "Canva") is Producer.CANVA


def test_creator_with_no_filename_suffix_still_classifies() -> None:
    assert classify(None, "Google Docs") is Producer.GOOGLE_DOCS
