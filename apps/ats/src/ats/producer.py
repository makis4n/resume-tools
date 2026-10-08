"""Classifies the tool that produced a PDF from its raw `Producer`/`Creator` metadata strings
(PRD §8.3, decision 0083).

Callers pass in `ats.extract.Document.producer` and `.creator` here for classification only; the
raw strings themselves are never returned to a client or logged, only the resulting `Producer`.
"""

from collections.abc import Callable
from enum import StrEnum


class Producer(StrEnum):
    """The tool that most likely produced a PDF, or `OTHER` when it could not be told apart."""

    LATEX = "latex"
    WORD = "word"
    GOOGLE_DOCS = "google-docs"
    CANVA = "canva"
    OTHER = "other"


def _matches_latex(text: str) -> bool:
    return any(
        needle in text
        for needle in ("pdftex", "xetex", "luatex", "dvipdfm", "xdvipdfmx", "latex", "tex live")
    )


def _matches_word(text: str) -> bool:
    # "Microsoft" and "Word" both appearing covers plain exports; "Microsoft® Word" is matched by
    # the same check once lower-cased, since the registered-trademark sign is not stripped.
    return "microsoft" in text and "word" in text


def _matches_google_docs(text: str) -> bool:
    return "google docs" in text


def _matches_canva(text: str) -> bool:
    return "canva" in text


_MATCHERS: dict[Producer, Callable[[str], bool]] = {
    Producer.LATEX: _matches_latex,
    Producer.WORD: _matches_word,
    Producer.GOOGLE_DOCS: _matches_google_docs,
    Producer.CANVA: _matches_canva,
}

# `Producer` is a tool-authored string; a rule set that starts with LaTeX is safe against it.
_PRODUCER_ORDER = (Producer.LATEX, Producer.WORD, Producer.GOOGLE_DOCS, Producer.CANVA)

# `Creator` often carries a user-chosen filename after the tool's own name (e.g. Word writes
# "Microsoft Word - resume_latex_style.docx"), which can accidentally contain another tool's
# name. Word/Google Docs/Canva are checked before LaTeX here, and `_strip_creator_suffix` removes
# the filename first, so a filename mentioning "latex" cannot misclassify a Word document.
_CREATOR_ORDER = (Producer.WORD, Producer.GOOGLE_DOCS, Producer.CANVA, Producer.LATEX)


def _strip_creator_suffix(creator: str | None) -> str | None:
    """Drop a " - <anything>" suffix from `creator`, such as the filename Word appends after its
    own name. Returns `creator` unchanged when there is no " - "."""
    if creator is None:
        return None
    before, separator, _ = creator.partition(" - ")
    return before if separator else creator


def _classify_string(text: str | None, order: tuple[Producer, ...]) -> Producer:
    if not text:
        return Producer.OTHER
    haystack = text.lower()
    for kind in order:
        if _MATCHERS[kind](haystack):
            return kind
    return Producer.OTHER


def classify(producer: str | None, creator: str | None) -> Producer:
    """Classify the tool that produced a PDF from its `Producer` and `Creator` metadata strings.

    `Producer` is classified alone first, since it is a string the producing tool itself writes,
    not one a user can put arbitrary text into. Only when that gives `Producer.OTHER` is
    `Creator` considered too, with its own rule order and its trailing " - <filename>" (if any)
    stripped first: see `_CREATOR_ORDER` and `_strip_creator_suffix`. Matching is
    case-insensitive throughout. Returns `Producer.OTHER` when neither string is present, or
    neither matches a known tool.
    """
    from_producer = _classify_string(producer, _PRODUCER_ORDER)
    if from_producer is not Producer.OTHER:
        return from_producer
    return _classify_string(_strip_creator_suffix(creator), _CREATOR_ORDER)
