"""Contact and section detection for one resume's text (PRD §6.1, §8.3; decision 0085).

`detect` is the only export. It returns a `StructureFacts` of booleans and nothing else: it never
keeps, returns, logs or puts into an exception any substring it matched, so an email address, a
phone number or a link in an uploaded resume cannot leave this module (PRD §11). Detection reads
the extracted text only; link annotations are not read, so a clickable word with no visible URL
is not seen.
"""

import re
import unicodedata
from dataclasses import dataclass

# Headings (decision 0085). A line counts as a heading only when it is short (see the limits
# below). "contains" entries match anywhere in the normalised heading; "exact" entries must equal
# the whole heading. English only.
EXPERIENCE_CONTAINS = ("experience", "employment", "work history", "career history")
EXPERIENCE_EXACT = ("internships", "work")
EDUCATION_CONTAINS = ("education",)
EDUCATION_EXACT = (
    "academic background",
    "academic history",
    "qualifications",
    "academic qualifications",
)
SKILLS_CONTAINS = ("skills", "competencies")
SKILLS_EXACT = (
    "areas of expertise",
    "expertise",
    "technologies",
    "technical proficiencies",
    "tools",
    "tools and technologies",
)

_MAX_HEADING_WORDS = 6
_MAX_HEADING_CHARS = 50

_MIN_PHONE_DIGITS = 8
_MAX_PHONE_DIGITS = 15

_EMAIL = re.compile(
    r"[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}"
)
# An unreadable email attempt: (a) letters either side of '@' with no whitespace, such as a
# domain with no TLD; (b) spaces around '@' or '.' before a lowercase TLD; (c) "[at]"/"(at)".
_EMAIL_NO_TLD = re.compile(r"[A-Za-z0-9._%+-]{0,64}[A-Za-z]@[A-Za-z][A-Za-z0-9.-]{0,63}")
_EMAIL_SPACED = re.compile(
    r"[A-Za-z0-9._%+-]{1,64}[ \t]{0,3}@[ \t]{0,3}[A-Za-z0-9-]{1,63}"
    r"([ \t]{0,3}\.[ \t]{0,3}[A-Za-z0-9-]{1,63}){0,8}"
    r"[ \t]{0,3}\.[ \t]{0,3}[a-z]{2,6}"
)
_EMAIL_AT_WORD = re.compile(
    r"[A-Za-z0-9][ \t]{0,3}[\[(][ \t]{0,3}at[ \t]{0,3}[\])][ \t]{0,3}[A-Za-z0-9]", re.IGNORECASE
)

_PHONE = re.compile(r"\+?\(?\d[\d \t().-]{6,30}\d")
_PHONE_LABEL = re.compile(r"(?:phone|mobile|tel|cell|whatsapp)[ \t]*:?[ \t]*$", re.IGNORECASE)
_YEAR = re.compile(r"(?:19|20)\d\d")
_DATE = re.compile(r"\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}")
_PHONE_SEPARATORS = re.compile(r"[ \t().-]+")

_LINK = re.compile(
    r"https?://|www\.|(?:linkedin|github|gitlab|behance|dribbble)\.(?:com|net)/"
    r"|\b[a-z0-9-]{1,63}\.(?:com|io|dev|me|net|org|co|app|page|site|ai|xyz)(?![a-z0-9-])",
    re.IGNORECASE,
)

_ODD_SPACES = re.compile(r"[   -   　]")
_ZERO_WIDTH = re.compile(r"[​-‍⁠﻿]")
_LINE_BREAKS = re.compile(r"\r\n|\n|\r")
_EDGE_PUNCTUATION = re.compile(r"^[\W_]+|[\W_]+$")


@dataclass(frozen=True)
class StructureFacts:
    """What `detect` found. Booleans only, so no matched text can be carried."""

    has_email: bool
    has_email_candidate: bool
    has_phone: bool
    has_profile_link: bool
    has_experience: bool
    has_education: bool
    has_skills: bool


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = _ZERO_WIDTH.sub("", text)
    return _ODD_SPACES.sub(" ", text)


def _has_email_candidate(text: str) -> bool:
    return bool(
        _EMAIL_NO_TLD.search(text) or _EMAIL_SPACED.search(text) or _EMAIL_AT_WORD.search(text)
    )


def _is_phone_number(raw: str, prefix: str) -> bool:
    digits = sum(ch.isdigit() for ch in raw)
    if not _MIN_PHONE_DIGITS <= digits <= _MAX_PHONE_DIGITS:
        return False
    if _DATE.fullmatch(raw):
        return False
    groups = [group for group in _PHONE_SEPARATORS.split(raw.lstrip("+")) if group]
    if groups and all(_YEAR.fullmatch(group) for group in groups):
        return False
    if raw.startswith("+"):
        return True
    if len(groups) >= 2:
        return True
    return bool(_PHONE_LABEL.search(prefix))


def _has_phone(lines: list[str]) -> bool:
    for line in lines:
        for match in _PHONE.finditer(line):
            if _is_phone_number(match.group(0), line[: match.start()]):
                return True
    return False


def _heading(line: str) -> str | None:
    """The normalised heading `line` could be, or None when it is too long to be one."""
    line = line.casefold().replace("&", " and ")
    line = _EDGE_PUNCTUATION.sub("", line)
    tokens = line.split()
    if len(tokens) >= 3 and all(len(token) == 1 for token in tokens):
        # Letter-spaced ("E X P E R I E N C E"); two or more spaces mark a word gap.
        words = re.split(r" {2,}", line)
        line = " ".join("".join(word.split()) for word in words)
    line = " ".join(line.split())
    if not line or len(line) > _MAX_HEADING_CHARS or len(line.split()) > _MAX_HEADING_WORDS:
        return None
    return line


def _matches(heading: str, contains: tuple[str, ...], exact: tuple[str, ...]) -> bool:
    return heading in exact or any(word in heading for word in contains)


def detect(text: str) -> StructureFacts:
    """Detect contact details and conventional section headings in `text`."""
    text = _normalise(text)
    has_email = bool(_EMAIL.search(text))
    lines = _LINE_BREAKS.split(text)

    experience = education = skills = False
    for line in lines:
        heading = _heading(line)
        if heading is None:
            continue
        experience = experience or _matches(heading, EXPERIENCE_CONTAINS, EXPERIENCE_EXACT)
        education = education or _matches(heading, EDUCATION_CONTAINS, EDUCATION_EXACT)
        skills = skills or _matches(heading, SKILLS_CONTAINS, SKILLS_EXACT)

    return StructureFacts(
        has_email=has_email,
        has_email_candidate=not has_email and _has_email_candidate(text),
        has_phone=_has_phone(lines),
        has_profile_link=bool(_LINK.search(_EMAIL.sub(" ", text))),
        has_experience=experience,
        has_education=education,
        has_skills=skills,
    )
