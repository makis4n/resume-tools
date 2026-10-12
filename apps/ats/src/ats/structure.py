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
SKILLS_CONTAINS = ("skills", "skillset", "competencies")
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
# A heading line, before it is cleaned: room for letter spacing, padding and a section number.
_MAX_HEADING_LINE_CHARS = 4 * _MAX_HEADING_CHARS

_MIN_PHONE_DIGITS = 8
_MAX_PHONE_DIGITS = 15

_EMAIL = re.compile(
    r"[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}"
)
# An unreadable email attempt: (a) letters either side of '@' with no whitespace, such as a
# domain with no TLD; (b) spaces around '@' or '.' before a lowercase TLD; (c) "[at]"/"(at)".
_EMAIL_NO_TLD = re.compile(r"[A-Za-z0-9._%+-]{0,64}[A-Za-z]@[A-Za-z][A-Za-z0-9.-]{0,63}")
# Lowercase only, so a job title such as "Intern @ Grab.com" is not taken for an email attempt.
_EMAIL_SPACED = re.compile(
    r"(?<![A-Za-z0-9._%+-])[a-z0-9._%+-]{1,64}[ \t]{0,3}@[ \t]{0,3}[a-z0-9-]{1,63}"
    r"([ \t]{0,3}\.[ \t]{0,3}[a-z0-9-]{1,63}){0,8}"
    r"[ \t]{0,3}\.[ \t]{0,3}[a-z]{2,6}"
)
_EMAIL_AT_WORD = re.compile(
    r"[A-Za-z0-9][ \t]{0,3}[\[(][ \t]{0,3}at[ \t]{0,3}[\])][ \t]{0,3}[A-Za-z0-9]", re.IGNORECASE
)
# The whole "name [at] domain.tld" attempt, so its domain is not taken for a profile link.
_EMAIL_AT_FULL = re.compile(
    r"[A-Za-z0-9._%+-]{0,64}[ \t]{0,3}[\[(][ \t]{0,3}at[ \t]{0,3}[\])]"
    r"[ \t]{0,3}[A-Za-z0-9.-]{1,80}",
    re.IGNORECASE,
)

_PHONE = re.compile(r"\+?\(?\d[\d \t().-]{6,30}\d")
_PHONE_LABEL = re.compile(r"(?:phone|mobile|tel|cell|whatsapp)[ \t]*:?[ \t]*$", re.IGNORECASE)
_YEAR = re.compile(r"(?:19|20)\d\d")
_DATE = re.compile(r"\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}")
_PHONE_SEPARATORS = re.compile(r"[ \t().-]+")
_WHITESPACE_RUN = re.compile(r"[ \t]+")

_LINK = re.compile(
    r"https?://|www\.|(?:linkedin|github|gitlab|behance|dribbble)\.(?:com|net)/",
    re.IGNORECASE,
)
# A bare domain such as "ada.dev" counts only in lowercase, so ASP.NET, Socket.IO and an employer
# written "Booking.com" are not taken for links.
# Common TLDs plus any two-letter country code; file-extension-like names (Node.js) are excluded.
_BARE_DOMAIN = re.compile(
    r"(?<![A-Za-z0-9-])(?!asp\.net)(?![a-z0-9-]{1,63}\.(?:js|ts|py|rb|rs|md|sh|cs|go)(?![a-z0-9-]))"
    r"[a-z0-9-]{1,63}\.(?:com|net|edu|io|dev|me|org|co|app|page|site|ai|xyz|[a-z]{2})"
    r"(?![A-Za-z0-9-])"
)

_ODD_SPACES = re.compile(r"[   -   　]")
_ZERO_WIDTH = re.compile(r"[​-‍⁠﻿]")
_LINE_BREAKS = re.compile(r"\r\n|\n|\r")
_EDGE_PUNCTUATION = re.compile(r"^[\W_]+|[\W_]+$")
_SECTION_NUMBER = re.compile(r"^\s*\d{1,2}[.):]?\s+(?=[A-Za-z])")


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


def _has_profile_link(text: str) -> bool:
    text = _EMAIL_AT_FULL.sub(" ", _EMAIL_SPACED.sub(" ", _EMAIL.sub(" ", text)))
    return bool(_LINK.search(text) or _BARE_DOMAIN.search(text))


def _is_phone_number(raw: str, prefix: str) -> bool:
    digits = sum(ch.isdigit() for ch in raw)
    if not _MIN_PHONE_DIGITS <= digits <= _MAX_PHONE_DIGITS:
        return False
    if _DATE.fullmatch(raw):
        return False
    groups = [group for group in _PHONE_SEPARATORS.split(raw.lstrip("+")) if group]
    if groups and all(_YEAR.fullmatch(group) for group in groups):
        return False
    if raw.startswith("+") or _PHONE_LABEL.search(prefix):
        return True
    # National formats such as "07911 123456" or "98765 43210" have 10-11 digits in groups of up
    # to six; any other number with a group over four digits is an identifier, not a phone.
    long_groups_ok = 10 <= digits <= 11 and all(len(group) <= 6 for group in groups)
    if len(groups) < 2 or (any(len(group) > 4 for group in groups) and not long_groups_ok):
        return False
    if any(_YEAR.fullmatch(group) for group in groups) and not any(len(g) == 3 for g in groups):
        return False  # a month-year or year-month range
    if len(groups[0]) <= 3 and all(len(group) == 3 for group in groups[1:]):
        return False  # a large number written with spaces, "10 000 000"
    return True


def _has_phone(lines: list[str]) -> bool:
    for line in lines:
        pos = 0
        while (match := _PHONE.search(line, pos)) is not None:
            if _is_phone_number(match.group(0), line[: match.start()]):
                return True
            # Rescan from the next group boundary, so a rejected ZIP code does not swallow the
            # phone number that follows it.
            sep = _WHITESPACE_RUN.search(match.group(0))
            pos = match.start() + sep.end() if sep else match.end()
    return False


def _vocabulary() -> frozenset[str]:
    words: set[str] = set(_HEADING_WORDS) | {"of", "and"}
    for entry in (
        EXPERIENCE_CONTAINS + EXPERIENCE_EXACT + EDUCATION_CONTAINS + EDUCATION_EXACT
        + SKILLS_CONTAINS + SKILLS_EXACT
    ):  # fmt: skip
        words.update(entry.split())
    return frozenset(words | {w + s for w in words for s in ("s", "al")})


def _segment(joined: str) -> list[str] | None:
    """Split `joined` into known heading words (fewest words), or None when it cannot be."""
    if not joined.isalpha() or len(joined) > _MAX_HEADING_CHARS:
        return None
    best: list[list[str] | None] = [None] * (len(joined) + 1)
    best[0] = []
    for end in range(1, len(joined) + 1):
        for start in range(end):
            prev = best[start]
            if prev is not None and joined[start:end] in _VOCABULARY:
                if best[end] is None or len(prev) + 1 < len(best[end]):
                    best[end] = [*prev, joined[start:end]]
    return best[-1]


def _heading(line: str) -> str | None:
    """The normalised heading `line` could be, or None when it is too long to be one."""
    if len(line) > _MAX_HEADING_LINE_CHARS:
        return None  # checked first so the regexes below never run over a huge line
    line = _SECTION_NUMBER.sub("", line)  # "01 Experience", "02. Education"
    if line.rstrip().endswith((".", ",", ";")) or any(ch.isdigit() for ch in line):
        return None  # a sentence or a dated line, not a heading
    line = line.casefold().replace("&", " and ")
    line = _EDGE_PUNCTUATION.sub("", line)
    tokens = line.split()
    if len(tokens) >= 2 and any(len(token) <= 3 for token in tokens):
        # Letter-spaced ("E X P E R I E N C E", "WO R K E X PERIENCE"): drop the spaces and read
        # the letters as known heading words.
        words = _segment("".join(tokens))
        if words is not None:
            line = " ".join(words)
    line = " ".join(line.split())
    if not line or len(line) > _MAX_HEADING_CHARS or len(line.split()) > _MAX_HEADING_WORDS:
        return None
    return line


# A "contains" keyword counts only when the words around it are ones a heading uses ("Work
# Experience", "Skills Summary"), so the end of a wrapped sentence or a job title such as "User
# Experience Designer" is not taken for a section heading.
_HEADING_WORDS = frozenset(
    "work professional relevant technical core key career related selected additional other "
    "industry research teaching leadership internship volunteer computer soft hard academic "
    "summary history employment and training projects certifications highlights overview "
    "experience education skills interests hobbies languages background profile of".split()
)
_VOCABULARY = _vocabulary()


_KEYWORD_SUFFIXES = ("", "s", "al")  # "experiences", "educational"


def _matches(
    heading: str, contains: tuple[str, ...], exact: tuple[str, ...], part: bool = False
) -> bool:
    if heading in exact and not (part and heading in _AMBIGUOUS_EDGE):
        return True
    if not part and " and " in f" {heading} ":
        # "Education and Honors": either side may be the section heading.
        if any(
            _matches(side.strip(), contains, exact, True) for side in f" {heading} ".split(" and ")
        ):
            return True
    tokens = [_EDGE_PUNCTUATION.sub("", token) for token in heading.split()]
    tokens = [token for token in tokens if token]
    for word in contains:
        parts = word.split()
        for start in range(len(tokens) - len(parts) + 1):
            window = tokens[start : start + len(parts)]
            if window[:-1] != parts[:-1] or not any(
                window[-1] == parts[-1] + suffix for suffix in _KEYWORD_SUFFIXES
            ):
                continue
            around = tokens[:start] + tokens[start + len(parts) :]
            if all(token in _HEADING_WORDS for token in around):
                return True
    return False


# A word before a trailing section keyword that makes it a job title ("User Experience").
_TITLE_WORDS = frozenset("user customer patient player student learner client employee".split())


_MAX_EDGE_LINE_CHARS = 400
# Words that open ordinary lines ("Work Authorization: ...", "Tools Used: ...") and so are not
# taken for a heading when they only sit at the edge of a longer line.
_AMBIGUOUS_EDGE = frozenset(("work", "tools"))


def _is_contact_token(token: str) -> bool:
    return any(ch.isdigit() or ch in "@/" for ch in token)


def _edge_headings(line: str) -> list[str]:
    """Headings at either end of a line that is not a heading as a whole: a two-column layout puts
    a heading on the same line as the other column's text or another heading. The other column's
    text may hold a phone number, an email, a link or a date; the heading words themselves never
    contain a digit (`_heading` rejects those)."""
    if len(line) > _MAX_EDGE_LINE_CHARS:
        return []
    tokens = line.split()
    has_digit = any(ch.isdigit() for ch in line)
    found = []
    for count in range(1, 4):
        if len(tokens) <= count:
            break
        lead, rest = tokens[:count], tokens[count:]
        following = rest[0][:1]
        # A dated line that opens with a keyword and a word ("Experience Designer, Acme, 2019")
        # is a job line; a digit is allowed only when the text after the heading starts with
        # something that is not a word (a phone number, a year).
        if has_digit and following.isalpha():
            pass
        elif all(t[:1].isupper() for t in lead) and not (
            following.isalpha() and following.islower()
        ):
            heading = _heading(" ".join(lead))
            if heading is not None and heading not in _AMBIGUOUS_EDGE:
                found.append(heading)
        tail, before = tokens[-count:], tokens[-count - 1]
        if (
            all(t[:1].isupper() for t in tail)
            and (before[:1].isupper() or _is_contact_token(before))
            and before.casefold().strip(",:;|") not in _TITLE_WORDS
        ):
            heading = _heading(" ".join(tail))
            if heading is not None and heading not in _AMBIGUOUS_EDGE:
                found.append(heading)
    return found


def detect(text: str) -> StructureFacts:
    """Detect contact details and conventional section headings in `text`."""
    text = _normalise(text)
    has_email = bool(_EMAIL.search(text))
    lines = _LINE_BREAKS.split(text)

    experience = education = skills = False
    for line in lines:
        heading = _heading(line)
        headings = ([heading] if heading is not None else []) + _edge_headings(line)
        for heading in headings:
            experience = experience or _matches(heading, EXPERIENCE_CONTAINS, EXPERIENCE_EXACT)
            education = education or _matches(heading, EDUCATION_CONTAINS, EDUCATION_EXACT)
            skills = skills or _matches(heading, SKILLS_CONTAINS, SKILLS_EXACT)

    return StructureFacts(
        has_email=has_email,
        has_email_candidate=not has_email and _has_email_candidate(text),
        has_phone=_has_phone(lines),
        has_profile_link=_has_profile_link(text),
        has_experience=experience,
        has_education=education,
        has_skills=skills,
    )
