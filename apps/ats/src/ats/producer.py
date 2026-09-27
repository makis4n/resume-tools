"""Classifies the tool that produced a PDF from its raw `Producer`/`Creator` metadata strings
(PRD §8.3, decision 0033).

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


# One ordered table: the first matching rule wins. Case-insensitive, and checked against whichever
# of Producer/Creator is present, joined together.
_RULES: tuple[tuple[Producer, Callable[[str], bool]], ...] = (
    (Producer.LATEX, _matches_latex),
    (Producer.WORD, _matches_word),
    (Producer.GOOGLE_DOCS, _matches_google_docs),
    (Producer.CANVA, _matches_canva),
)


def classify(producer: str | None, creator: str | None) -> Producer:
    """Classify the tool that produced a PDF from its `Producer` and `Creator` metadata strings.

    Matches case-insensitively against whichever of `producer` and `creator` is present. Returns
    `Producer.OTHER` when neither string is present, or neither matches a known tool.
    """
    haystack = " ".join(value for value in (producer, creator) if value).lower()
    for kind, matches in _RULES:
        if matches(haystack):
            return kind
    return Producer.OTHER
