"""The hand-curated skills taxonomy (decision 0034): data, loading, normalisation and lookup.

`data/skills.json` is vocabulary we wrote and own: canonical skill, tool and qualification names
with their common aliases. `apps/ats/src/ats/rubric.py` and the requirement-matching code that
come after this pull request use `load()`, `Taxonomy.lookup()` and `Taxonomy.mentions()` to turn
free text -- a job description or a resume -- into taxonomy entries. This module has no HTTP
surface and does not change the contract; it is data plus a small loader.

Normalisation and matching, in brief:

- `normalise()` folds a *standalone* term (a canonical name, an alias, or a term passed to
  `lookup()`) to a comparable form: NFKC, casefold, collapsed whitespace, and punctuation
  stripped from the edges -- except the symbols a handful of our terms use to mean something
  ("C++", "C#", ".NET", "Node.js", "CI/CD", "A/B testing", "e-learning"), which are left alone
  wherever they sit in the term.
- `Taxonomy.mentions()` does **not** run `normalise()` over the haystack text. Doing so could
  change the text's length (casefold turns German "straße" into "strasse"; NFKC decomposes some
  ligatures and compatibility characters) and would drift the character offsets `mentions()`
  promises to return. Instead it matches the *raw* text directly with one compiled regular
  expression, built once per loaded taxonomy from every skill's name and aliases. Alternatives are
  ordered longest-first, so that at a given starting position a longer alias wins over a shorter
  one that also matches there ("machine learning engineer" finds "machine learning", not just
  "machine"). Terms not listed under an entry's `case_sensitive` match case-insensitively, through
  a per-alternative scoped `(?i:...)` group (Python's `re` has supported scoped inline flags since
  3.6); terms that are listed match only in the exact case given, which is how ambiguous short
  names ("Spark", "Chef", "PM"...) are kept out of ordinary prose without also losing every other
  alias's normal case-insensitive matching. `re.finditer` walks the text left to right and its
  matches never overlap, which is exactly "every non-overlapping mention, ordered by start offset"
  for free, in one linear pass.
- The boundary rule a match must satisfy: it cannot be immediately preceded or followed by an
  ASCII letter or digit. This is deliberately narrower than `\\b`, which treats `+`, `#`, `.` and
  `/` as already being boundaries -- plain `\\b` would let "C++" match inside "C++11" (there is a
  `\\b` right after the "C", before the first "+", and nothing about `\\b` stops "11" from
  following). Concretely, and see `test_taxonomy.py` for the executable version of each: "C++"
  matches in "C++ developer" (followed by a space) but not in "C++11" (followed by "1", which is
  alphanumeric); "Node.js" matches in "Uses Node.js daily" but not if immediately followed by
  another alphanumeric character; "Java" never matches inside "JavaScript" (the "S" right after
  "Java" is alphanumeric, so the match cannot end there).
- Why a regex alternation rather than a token trie: the taxonomy is a few hundred entries with a
  handful of aliases each, matched against job-description- and resume-sized text (tens of
  kilobytes, not books). A single compiled `re` pattern is one call into `re`'s C implementation
  per document, needs no tokeniser of our own to keep in step with the boundary rule above, and is
  easy to read and audit for the catastrophic-backtracking and non-determinism risks a hand-rolled
  matcher could introduce. Every alternative is a fixed, `re.escape`d literal with no nested
  quantifiers, so there is no exponential-backtracking risk to audit for.

Ambiguity: a handful of short names are also ordinary English words or bare letters ("Excel",
"Word", "Access", "Go", "R", "C"...). Decision 0034 records, entry by entry, which are kept
case-sensitive, which get an unambiguous alias instead, and which are dropped outright because
even an exact-case match would still be noisy.

Data file location: `data/skills.json`, read with `importlib.resources` so this works from the
installed wheel, not just a source checkout.
"""

from __future__ import annotations

import functools
import hashlib
import importlib.resources
import json
import re
import string
import unicodedata
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class SkillKind(StrEnum):
    SKILL = "skill"
    TOOL = "tool"
    QUALIFICATION = "qualification"


@dataclass(frozen=True)
class Skill:
    """One taxonomy entry: a stable id, its canonical display name, its kind and its aliases."""

    id: str
    name: str
    kind: SkillKind
    aliases: tuple[str, ...]


@dataclass(frozen=True)
class Mention:
    """One occurrence of `skill` in a piece of text, as offsets into that same text.

    `text[start:end]` is the exact substring that matched, in the text's original casing and
    spacing.
    """

    skill: Skill
    start: int
    end: int


class TaxonomyError(ValueError):
    """`data/skills.json` is missing, unreadable, or fails validation."""


_PACKAGE = "ats"
_DATA_DIR = "data"
_FILE_NAME = "skills.json"
_VALID_KINDS = {kind.value for kind in SkillKind}

# Punctuation `normalise()` strips from the edges of a term. Deliberately excludes the symbols a
# handful of our terms carry meaning with -- + # . / & and the hyphen -- so "C++", "C#", ".NET",
# "Node.js", "CI/CD" and "e-learning" survive normalisation with those symbols intact, wherever
# they sit in the term, not just in the middle.
_MEANINGFUL_SYMBOLS = set("+#./&-")
_EDGE_PUNCTUATION = "".join(c for c in string.punctuation if c not in _MEANINGFUL_SYMBOLS) + (
    "“”‘’—–…"  # curly quotes, em/en dash, ellipsis
)

# A match cannot be immediately preceded or followed by an ASCII letter or digit. See the module
# docstring for why this, and not `\b`, is the boundary rule.
_BOUNDARY_BEFORE = r"(?<![A-Za-z0-9])"
_BOUNDARY_AFTER = r"(?![A-Za-z0-9])"


def _fold_whitespace_and_edges(text: str) -> str:
    """NFKC-normalise `text`, collapse internal whitespace to single spaces, and strip edge
    punctuation (see `_EDGE_PUNCTUATION`) -- everything `normalise()` does except casefolding.

    Used both by `normalise()` and, without the casefold, to compare a term against a
    `case_sensitive` alias's exact spelling while still tolerating incidental whitespace and
    surrounding punctuation such as "(Python)," or a trailing sentence period.
    """
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\s+", " ", text).strip()
    while True:
        stripped = text.strip(_EDGE_PUNCTUATION).strip()
        if stripped == text:
            return text
        text = stripped


def normalise(term: str) -> str:
    """Fold `term` to a form comparable across spelling, case and incidental punctuation.

    Rules, applied in order:

    1. Unicode NFKC normalisation (compatibility characters and ligatures fold to their plain
       form, e.g. the single-character "ﬁ" ligature becomes "fi").
    2. Casefold (Unicode's more thorough lowercasing, used for caseless comparison).
    3. Runs of whitespace collapse to a single space, and leading/trailing whitespace is dropped.
    4. Leading and trailing punctuation is stripped, repeatedly, until nothing more comes off --
       except `+ # . / & -`, which are kept wherever they sit, since our data uses them inside
       terms that mean something different without them: "C++", "C#", ".NET", "Node.js", "CI/CD",
       "e-learning". These five are kept unconditionally, not just when they look meaningful, so
       "Python." (a trailing sentence period) normalises to "python." rather than "python": this
       function folds a standalone alias, name or `lookup()` term, never an arbitrary sentence
       fragment, and telling a meaningful "." from a stray one would need to know which term it
       is looking at before it has finished stripping punctuation from it.

    This is deterministic: the same input always normalises to the same output, and normalising
    an already-normalised string is a no-op.
    """
    return _fold_whitespace_and_edges(term).casefold()


class Taxonomy:
    """The loaded, validated skills taxonomy: lookup by exact term, and mention-finding in text."""

    def __init__(
        self, skills: tuple[Skill, ...], version: str, case_sensitive_terms: dict[str, set[str]]
    ):
        self.skills = skills
        self.version = version

        # normalised term -> (skill, exact-case string required, or None if any case will do).
        index: dict[str, tuple[Skill, str | None]] = {}
        # (raw term text, whether it must match in exactly that case) for every name and alias,
        # across every skill, used to build the mention-finding pattern below.
        terms: list[tuple[str, bool]] = []

        for skill in skills:
            exact_terms = case_sensitive_terms.get(skill.id, set())
            for term in (skill.name, *skill.aliases):
                key = normalise(term)
                requires_exact = term in exact_terms
                exact_value = _fold_whitespace_and_edges(term) if requires_exact else None
                index[key] = (skill, exact_value)
                terms.append((term, requires_exact))

        self._index = index
        self._pattern = _build_pattern(terms)

    def lookup(self, term: str) -> Skill | None:
        """The skill whose normalised name or alias equals `term`, or `None`.

        A `case_sensitive` alias only matches `term` in exactly the case (and, as with any term,
        the whitespace and edge punctuation) it was declared with; other terms match regardless
        of case.
        """
        entry = self._index.get(normalise(term))
        if entry is None:
            return None
        skill, exact_value = entry
        if exact_value is not None and _fold_whitespace_and_edges(term) != exact_value:
            return None
        return skill

    def mentions(self, text: str) -> list[Mention]:
        """Every non-overlapping mention of a taxonomy term in `text`, ordered by start offset.

        Longest match wins at a given starting position, and a match cannot start or end inside a
        longer word (see the module docstring for the exact boundary rule).
        """
        results = []
        for match in self._pattern.finditer(text):
            skill, _ = self._index[normalise(match.group(0))]
            results.append(Mention(skill=skill, start=match.start(), end=match.end()))
        return results


def _build_pattern(terms: list[tuple[str, bool]]) -> re.Pattern[str]:
    """One compiled regex matching any of `terms`, longest text first.

    Each alternative is a fixed `re.escape`d literal, wrapped in a scoped `(?i:...)` group when it
    should match case-insensitively -- so there is exactly one alternative to try per term, no
    nested quantifiers, and nothing that can backtrack catastrophically.
    """
    ordered = sorted(terms, key=lambda pair: (-len(pair[0]), pair[0]))
    alternatives = []
    for text, requires_exact in ordered:
        escaped = re.escape(text)
        alternatives.append(escaped if requires_exact else f"(?i:{escaped})")
    body = "|".join(alternatives)
    return re.compile(f"{_BOUNDARY_BEFORE}(?:{body}){_BOUNDARY_AFTER}")


def _fail(message: str) -> None:
    raise TaxonomyError(f"data/skills.json: {message}")


def _validate_and_build(data: Any) -> tuple[tuple[Skill, ...], dict[str, set[str]]]:
    if not isinstance(data, dict) or "entries" not in data:
        _fail("expected a JSON object with an 'entries' array")
    raw_entries = data["entries"]
    if not isinstance(raw_entries, list) or not raw_entries:
        _fail("'entries' must be a non-empty array")

    skills: list[Skill] = []
    case_sensitive_terms: dict[str, set[str]] = {}
    seen_ids: set[str] = set()
    normalised_terms: dict[str, str] = {}  # normalised term -> owning id, across the whole file

    previous_id = ""
    for i, raw in enumerate(raw_entries):
        if not isinstance(raw, dict):
            _fail(f"entry {i} is not an object")

        entry_id = raw.get("id")
        name = raw.get("name")
        kind = raw.get("kind")
        aliases = raw.get("aliases", [])
        case_sensitive = raw.get("case_sensitive", [])

        if not isinstance(entry_id, str) or not entry_id:
            _fail(f"entry {i} has no string 'id'")
        if entry_id in seen_ids:
            _fail(f"duplicate id '{entry_id}'")
        if entry_id < previous_id:
            _fail(f"ids are not sorted alphabetically: '{entry_id}' comes after '{previous_id}'")
        seen_ids.add(entry_id)
        previous_id = entry_id

        if not isinstance(name, str) or not name.strip():
            _fail(f"'{entry_id}' has no non-empty 'name'")
        if kind not in _VALID_KINDS:
            _fail(
                f"'{entry_id}' has an unknown kind {kind!r}; expected one of {sorted(_VALID_KINDS)}"
            )
        if not isinstance(aliases, list) or not all(isinstance(a, str) and a for a in aliases):
            _fail(f"'{entry_id}' has a non-string or empty alias")
        if not isinstance(case_sensitive, list) or not all(
            isinstance(c, str) for c in case_sensitive
        ):
            _fail(f"'{entry_id}' has a non-string 'case_sensitive' entry")

        entry_terms = [name, *aliases]
        allowed_exact = set(entry_terms)
        for exact in case_sensitive:
            if exact not in allowed_exact:
                _fail(
                    f"'{entry_id}' lists '{exact}' under case_sensitive, but it is not the name "
                    "or an alias"
                )

        seen_within_entry: set[str] = set()
        for term in entry_terms:
            key = normalise(term)
            if key in seen_within_entry:
                _fail(f"'{entry_id}' has the same term twice after normalisation: '{term}'")
            seen_within_entry.add(key)
            owner = normalised_terms.get(key)
            if owner is not None and owner != entry_id:
                _fail(f"'{term}' in '{entry_id}' collides with '{owner}' after normalisation")
            normalised_terms[key] = entry_id

        skills.append(Skill(id=entry_id, name=name, kind=SkillKind(kind), aliases=tuple(aliases)))
        if case_sensitive:
            case_sensitive_terms[entry_id] = set(case_sensitive)

    return tuple(skills), case_sensitive_terms


@functools.cache
def load() -> Taxonomy:
    """Load, validate and return the skills taxonomy. Cached: later calls return the same object.

    Raises:
        TaxonomyError: `data/skills.json` is missing, not valid JSON, or fails validation (a
            duplicate id, an unknown kind, an empty name, an id out of alphabetical order, or a
            name or alias that collides with another entry's after normalisation).
    """
    resource = importlib.resources.files(_PACKAGE) / _DATA_DIR / _FILE_NAME
    try:
        raw_bytes = resource.read_bytes()
    except FileNotFoundError as exc:
        raise TaxonomyError(f"data/skills.json not found at {resource}") from exc

    try:
        data = json.loads(raw_bytes)
    except json.JSONDecodeError as exc:
        raise TaxonomyError(f"data/skills.json is not valid JSON: {exc}") from exc

    skills, case_sensitive_terms = _validate_and_build(data)
    return Taxonomy(
        skills=skills, version=version_for(raw_bytes), case_sensitive_terms=case_sensitive_terms
    )


def version_for(raw_bytes: bytes) -> str:
    """The taxonomy version derived from the data file's exact bytes: the first 12 hex
    characters of their SHA-256. A later cache or matcher keys on this, so any content change --
    even just adding one alias -- invalidates it without anyone bumping a version by hand."""
    return hashlib.sha256(raw_bytes).hexdigest()[:12]
