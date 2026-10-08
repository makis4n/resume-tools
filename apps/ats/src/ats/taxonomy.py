"""The hand-curated skills taxonomy (decision 0084): data, loading, normalisation and lookup.

`data/skills.json` is vocabulary we wrote and own: canonical skill, tool and qualification names
with their common aliases. The rubric and requirement-matching code that
come after this pull request use `load()`, `Taxonomy.lookup()` and `Taxonomy.mentions()` to turn
free text -- a job description or a resume -- into taxonomy entries. This module has no HTTP
surface and does not change the contract; it is data plus a small loader.

Normalisation and matching, in brief:

- `normalise()` folds a *standalone* term (a canonical name, an alias, or a term passed to
  `lookup()`) to a comparable form: NFKC, casefold, collapsed whitespace, and punctuation
  stripped from the edges -- except the symbols a handful of our terms use to mean something
  ("C++", "C#", ".NET", "Node.js", "CI/CD", "A/B testing", "e-learning"), which are left alone
  wherever they sit in the term.
- `mentions()` does fold each haystack character on its own with NFKC (`_compat_fold()`), mapping
  offsets back to the original text, so ligatures and fullwidth letters in extracted PDF text
  match as `lookup()` does.
- `Taxonomy.mentions()` does **not** run `normalise()` over the haystack text, and does not
  re-derive a lookup key from whatever the regex matched. Both would be unsound: normalising the
  haystack could change its length (casefold and NFKC are not always length-preserving) and would
  drift the character offsets `mentions()` promises to return; and re-normalising the *matched*
  text to find its skill assumes `str.casefold()` and `re.IGNORECASE` agree on what counts as the
  same letter, which they do not -- `re.IGNORECASE` matches the pattern "i" against U+0130 (İ) and
  U+0131 (ı), Turkish's dotted and dotless capital/lower-case I, but `str.casefold()` does not fold
  either of them to plain "i", so looking the matched text back up by its casefold used to raise
  `KeyError` on input like "JAVASCRİPT". Instead, each alternative in the compiled pattern is its
  own capturing group, and the group that matched (`match.lastindex`) is looked up directly in a
  `group number -> Skill` table built alongside the pattern -- no re-deriving anything from the
  matched substring, so no disagreement between two case-folding schemes can bite.
- The pattern is one compiled regular expression, built once per loaded taxonomy from every
  skill's name and aliases, with alternatives ordered longest-first so that a longer alias wins
  over a shorter one that also matches at the same starting position ("machine learning engineer"
  finds "machine learning", not just "machine"). A multi-word term's literal spaces become `\\s+`
  in the pattern, so a line break or repeated space in extracted PDF text still counts as a match
  (`"Microsoft\\nExcel"`, `"machine  learning"`); the *offsets* returned are still plain indices
  into the original text, since nothing about the haystack itself was touched. Terms not listed
  under an entry's `case_sensitive` match case-insensitively, through a per-alternative scoped
  `(?i:...)` group (Python's `re` has supported scoped inline flags since 3.6); terms that are
  listed match only in the exact case given, which is how ambiguous short names ("Spark", "Chef"...)
  are kept out of ordinary prose without also losing every other alias's normal
  case-insensitive matching. `re.finditer` walks the text left to right and its matches never
  overlap, which is exactly "every non-overlapping mention, ordered by start offset" for free, in
  one linear pass. To keep that pass cheap, the alternatives are bucketed by first character
  (see `_build_pattern()`), so a position tries only the dozens that could start there instead of
  every alternative in the file.
- The boundary rule a match must satisfy: it cannot be immediately preceded by a Unicode letter,
  digit or underscore (`(?<!\\w)`), or immediately followed by a Unicode letter or underscore
  (`(?![^\\W\\d])`), so "éPython" and "Pythoné" do not match. This is deliberately narrower on the
  left than `\\b` (which treats `+`, `#`, `.` and `/` as already being boundaries) and deliberately
  looser on the right than a plain "no adjacent alphanumeric" rule, so that a version suffix still
  counts as the same term: "C++17" matches "C++" (nothing forbids the "1" that follows), "Python3"
  matches "Python", "Angular2+" matches "Angular" (a digit run and a trailing "+" are both fine,
  since neither is a letter) -- but "Java" still never matches inside "JavaScript" (the "S" right
  after "Java" *is* a letter, so the match cannot end there), and "C++" still never matches inside
  "CSS" or preceded by a letter. See `test_taxonomy.py` for the executable version of each case.
- `not_followed_by`: an entry may list a small set of words (only ever applied to its
  `case_sensitive` aliases, since those are exactly the ones ambiguous enough to need it) that must
  not immediately follow a match, as a plain space-separated word -- `excel-spreadsheets` uses
  `["in", "at"]` so "Excel in a fast-paced environment" does not tag the spreadsheet tool, while
  "Proficient in Excel (pivot tables)" still does. The guard applies only when the match starts a
  sentence, line or list item, which is the only place the capitalised verb "Excel" occurs, so a
  mid-sentence "Built models in Excel at Acme" or "Advanced Excel at an expert level" still
  matches. `mentions()` applies it after the regex match rather than inside the pattern, because
  the sentence-start test needs the text before the match.
- Why a regex alternation rather than a token trie: the taxonomy is a few hundred entries with a
  handful of aliases each, matched against job-description- and resume-sized text (tens of
  kilobytes, not books). A single compiled `re` pattern is one call into `re`'s C implementation
  per document, needs no tokeniser of our own to keep in step with the boundary rule above, and is
  easy to read and audit for the catastrophic-backtracking and non-determinism risks a hand-rolled
  matcher could introduce. Every alternative is a fixed, `re.escape`d literal (plus, at most, the
  fixed-width lookahead above) with no nested quantifiers, so there is no exponential-backtracking
  risk to audit for.

Ambiguity: a handful of short names are also ordinary English words or bare letters ("Excel",
"Word", "Access", "Go", "R", "C", "Spring", "React"...). Decision 0084 records, entry by entry,
which are kept case-sensitive (with or without `not_followed_by`), which get an unambiguous alias
instead, and which are dropped outright because even an exact-case match would still be noisy.

Data file location: `data/skills.json`, read with `importlib.resources` so this works from the
installed wheel, not just a source checkout. `load()` (cached, no arguments) reads the package's
own copy; `load_from_bytes()` and `load_from_path()` build a `Taxonomy` from anyone else's bytes
or file, which is how tests exercise validation failures without touching the real data file.
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
from pathlib import Path
from typing import Any, NoReturn


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
    """A skills-taxonomy data file is missing, unreadable, or fails validation."""


_PACKAGE = "ats"
_DATA_DIR = "data"
_FILE_NAME = "skills.json"
_VALID_KINDS = {kind.value for kind in SkillKind}
_ID_PATTERN = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
_NOT_FOLLOWED_BY_WORD = re.compile(r"[A-Za-z]+")
_ENTRY_KEYS = frozenset({"id", "name", "kind", "aliases", "case_sensitive", "not_followed_by"})

# Punctuation `normalise()` strips from the edges of a term. Deliberately excludes the symbols a
# handful of our terms carry meaning with -- + # . / & and the hyphen -- so "C++", "C#", ".NET",
# "Node.js", "CI/CD" and "e-learning" survive normalisation with those symbols intact, wherever
# they sit in the term, not just in the middle.
_MEANINGFUL_SYMBOLS = set("+#./&-")
_EDGE_PUNCTUATION = "".join(c for c in string.punctuation if c not in _MEANINGFUL_SYMBOLS) + (
    "“”‘’—–…"  # curly quotes, em/en dash, ellipsis
)

# Typographic apostrophes fold to ASCII "'" (length-preserving), so "Bachelor\u2019s degree" from
# LaTeX or Word output matches "Bachelor's degree". Trademark and registered signs are dropped
# from a looked-up term, since NFKC would otherwise turn U+2122 into the letters "TM".
_APOSTROPHES = {0x2018: "'", 0x2019: "'", 0x02BC: "'"}
_TRADEMARK_SIGNS = {0x2122: None, 0x2120: None, 0x00AE: None}
_LOOKUP_PRE_FOLD = {**_APOSTROPHES, **_TRADEMARK_SIGNS}

# A match cannot be immediately preceded by a Unicode word character, or immediately followed by a
# Unicode letter or underscore (a word character that is not a digit). See the module docstring for
# why the right-hand side deliberately tolerates a following digit or "+" (a version suffix:
# "C++17", "Python3", "Angular2+") while the left-hand side still forbids one (so a match cannot
# start mid-word either).
_BOUNDARY_BEFORE = r"(?<!\w)"
_BOUNDARY_AFTER = r"(?![^\W\d])"


def _fold_whitespace_and_edges(text: str) -> str:
    """NFKC-normalise `text`, collapse internal whitespace to single spaces, and strip edge
    punctuation (see `_EDGE_PUNCTUATION`) -- everything `normalise()` does except casefolding.

    Used both by `normalise()` and, without the casefold, to compare a term against a
    `case_sensitive` alias's exact spelling while still tolerating incidental whitespace and
    surrounding punctuation such as "(Python)," or a trailing sentence period.
    """
    text = unicodedata.normalize("NFKC", text.translate(_LOOKUP_PRE_FOLD))
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
       "e-learning". These six are kept unconditionally, not just when they look meaningful, so
       "Python." (a trailing sentence period) normalises to "python." rather than "python": this
       function folds a standalone alias, name or `lookup()` term, never an arbitrary sentence
       fragment, and telling a meaningful "." from a stray one would need to know which term it
       is looking at before it has finished stripping punctuation from it.

    This is deterministic: the same input always normalises to the same output, and normalising
    an already-normalised string is a no-op.
    """
    return _fold_whitespace_and_edges(term).casefold()


def _escape_with_flexible_whitespace(text: str) -> str:
    """`re.escape(text)`, except a run of whitespace in `text` becomes `\\s+` in the pattern, so
    a multi-word term still matches text from a PDF where the words landed on different lines or
    with doubled spacing."""
    return r"\s+".join(re.escape(part) for part in text.split())


class Taxonomy:
    """The loaded, validated skills taxonomy: lookup by exact term, and mention-finding in text."""

    def __init__(
        self,
        skills: tuple[Skill, ...],
        version: str,
        case_sensitive_terms: dict[str, frozenset[str]],
        not_followed_by: dict[str, tuple[str, ...]],
    ) -> None:
        self.skills = skills
        self.version = version

        # normalised term -> (skill, exact-case string required, or None if any case will do).
        # Used by `lookup()` only; `mentions()` resolves a match to its skill through the
        # pattern's own group numbers instead (see the module docstring for why).
        index: dict[str, tuple[Skill, str | None]] = {}
        # One (text, requires_exact_case, skill) per name/alias, across every skill, used to build
        # the mention-finding pattern below.
        specs: list[tuple[str, bool, Skill]] = []
        # group-number-independent: skill id -> pattern for the words that must not follow a
        # sentence-initial match (see `mentions()`).
        self._guards: dict[str, re.Pattern[str]] = {}

        for skill in skills:
            exact_terms = case_sensitive_terms.get(skill.id, frozenset())
            extra_words = not_followed_by.get(skill.id, ())
            if extra_words:
                words = "|".join(re.escape(w) for w in extra_words)
                self._guards[skill.id] = re.compile(rf"\s+(?:{words})\b", re.IGNORECASE)
            for term in (skill.name, *skill.aliases):
                requires_exact = term in exact_terms
                key = normalise(term)
                exact_value = _fold_whitespace_and_edges(term) if requires_exact else None
                index[key] = (skill, exact_value)
                specs.append((term, requires_exact, skill))

        self._index = index
        # (skill id, term) pairs whose guard applies: only `case_sensitive` aliases.
        self._guarded_groups: dict[int, re.Pattern[str]] = {}
        self._pattern, self._group_to_skill, group_to_spec = _build_pattern(specs)
        for group, (_term, requires_exact, spec_skill) in group_to_spec.items():
            if requires_exact and spec_skill.id in self._guards:
                self._guarded_groups[group] = self._guards[spec_skill.id]

    def lookup(self, term: str) -> Skill | None:
        """The skill whose normalised name or alias equals `term`, or `None`.

        A `case_sensitive` alias matches `term` only in the case it was declared with, exactly as
        `mentions()` does; other terms match regardless of case. If nothing matches, the lookup is
        retried once without trailing periods (and the edge punctuation they were shielding, as in
        "(Python)."), so a sentence-final "Python." still finds Python, while ".NET" and "Node.js"
        keep theirs.
        """
        folded = _fold_whitespace_and_edges(term)
        skill = self._lookup_folded(folded)
        if skill is None and folded.endswith("."):
            skill = self._lookup_folded(_fold_whitespace_and_edges(folded.rstrip(".")))
        return skill

    def _lookup_folded(self, folded: str) -> Skill | None:
        entry = self._index.get(folded.casefold())
        if entry is None:
            return None
        skill, exact_value = entry
        if exact_value is not None and folded != exact_value:
            return None
        return skill

    def mentions(self, text: str) -> list[Mention]:
        """Every non-overlapping mention of a taxonomy term in `text`, ordered by start offset.

        Longest match wins at a given starting position, and a match cannot start mid-word or end
        before a letter that continues the word (see the module docstring for the exact boundary
        rule, including the version-suffix and `not_followed_by` exceptions).
        """
        folded, starts, ends = _compat_fold(text)
        results = []
        for match in self._pattern.finditer(folded):
            guard = self._guarded_groups.get(match.lastindex)
            if (
                guard is not None
                and guard.match(folded, match.end())
                and _starts_sentence(folded, match.start())
            ):
                continue
            skill = self._group_to_skill[match.lastindex]
            start, end = match.start(), match.end()
            if starts is not None and ends is not None:
                start, end = starts[start], ends[end - 1]
            results.append(Mention(skill=skill, start=start, end=end))
        return results


def _compat_fold(text: str) -> tuple[str, list[int] | None, list[int] | None]:
    """`text` with each character NFKC-folded on its own (so "\ufb03" becomes "ffi", fullwidth
    letters become plain ones), plus tables mapping a folded index back to the start and end
    offsets of the original character it came from. ASCII text, and text with nothing to fold,
    comes back unchanged with no tables, so the common case costs one scan.

    This keeps `mentions()` in step with `lookup()`, which applies NFKC, on extracted PDF text
    where pdflatex maps fi, ffi and fl glyphs to ligature code points. Offsets stay valid against
    the original text. Folding per character (not the whole string) is what makes the mapping
    exact; it skips only compositions across characters, such as "e" plus a combining accent.
    """
    if text.isascii():
        return text, None, None
    pieces: list[str] = []
    starts: list[int] = []
    ends: list[int] = []
    changed = False
    for i, char in enumerate(text):
        code = ord(char)
        if code in _APOSTROPHES:
            piece = "'"
        elif code in _TRADEMARK_SIGNS:
            piece = char  # keep as a non-letter; NFKC would make letters ("TM") that block a match
        else:
            piece = unicodedata.normalize("NFKC", char) if code > 127 else char
        if piece != char:
            changed = True
        pieces.append(piece)
        starts.extend([i] * len(piece))
        ends.extend([i + 1] * len(piece))
    if not changed:
        return text, None, None
    return "".join(pieces), starts, ends


_SENTENCE_BREAKS = ".!?;\u2022\u00b7|*" + "-\u2013\u2014"
_DASHES = "-\u2013\u2014"
# Bullet glyphs exported by word processors, beyond the ones in `_SENTENCE_BREAKS`. Private-use
# code points (Word's Symbol-font bullet is U+F0B7) are accepted too, by category.
_BULLETS = (
    "\u25cf\u25aa\u25ab\u2219\u25e6\u25a0\u2023\u2043\u2024"
    "\u27a2\u27a4\u2794\u25ba\u25b6\u25b8\u2713\u2714\u2756"
)
# Opening quotes and brackets that may sit between a sentence break and the first word.
_OPENERS = "\"'\u201c\u201d\u2018\u2019\u00ab\u00bb([{"
# Lower-case abbreviations whose trailing period does not end a sentence ("incl. Excel at ...").
_ABBREVIATIONS = frozenset({"incl", "e.g", "i.e", "eg", "ie", "approx", "esp", "vs", "inc"})
_LAST_WORD = re.compile(r"[\w.]+$")


_WINDOW = 64
_LIST_NUMBER = re.compile(r"(?:^|\s)(?:\d{1,2}|[A-Za-z])\)$")


def _starts_sentence(text: str, start: int) -> bool:
    """Whether the match at `start` begins the text, a line, a list item or a sentence.

    Only a bounded window before the match is inspected, so the cost does not grow with the
    length of the text.
    """
    lo = max(0, start - _WINDOW)
    prefix = text[lo:start]
    stripped = prefix.rstrip()
    gap = prefix[len(stripped) :]
    if not stripped:
        # An all-whitespace window is a start only when it reaches the true start of the text.
        return lo == 0
    if stripped[-1] in _OPENERS:
        # A line that starts with an opening quote or bracket: look through it to the whitespace
        # before it, so "Values\n\"Excel in ...\"" is read as a line start.
        head = stripped.rstrip(_OPENERS)
        head_core = head.rstrip()
        head_gap = head[len(head_core) :]
        if head_core and ("\n" in head_gap or "\r" in head_gap):
            stripped, gap = head_core, head_gap
    if "\n" in gap or "\r" in gap:
        # A hard-wrapped line ("... models in\nExcel at Acme") continues the sentence when the
        # previous line stops on a lower-case word or a comma; a capitalised word (a heading such
        # as "Skills") or any other ending starts a line.
        if stripped[-1] == ",":
            return False
        if stripped[-1] in "!?":
            return True
        if stripped[-1] == ".":
            word = _LAST_WORD.search(stripped, max(0, len(stripped) - 32), len(stripped) - 1)
            return word is None or word.group().lower() not in _ABBREVIATIONS
        word = _LAST_WORD.search(stripped, max(0, len(stripped) - 32))
        return word is None or not word.group()[:1].islower()
    core = stripped.rstrip(_OPENERS).rstrip()
    if not core:
        return True
    last = core[-1]
    if last in _DASHES:
        # "MS-Excel": a dash glued to the word on both sides is a hyphen, not a list marker.
        glued = len(core) == len(prefix) and len(core) > 1 and not core[-2].isspace()
        return not glued
    if last == ".":
        word = _LAST_WORD.search(core, max(0, len(core) - 32), len(core) - 1)
        return word is None or word.group().lower() not in _ABBREVIATIONS
    if last == ")" and _LIST_NUMBER.search(core):
        return True
    return last in _SENTENCE_BREAKS or last in _BULLETS or unicodedata.category(last) == "Co"


def _build_pattern(
    specs: list[tuple[str, bool, Skill]],
) -> tuple[re.Pattern[str], dict[int, Skill], dict[int, tuple[str, bool, Skill]]]:
    """One compiled regex matching any of `specs`, longest text first, plus the `group number ->
    Skill` table `mentions()` uses to resolve a match without re-deriving anything from the
    matched text, and the `group number -> spec` table it uses to find a group's guard.

    Each alternative is wrapped in its own capturing group and is otherwise a fixed `re.escape`d
    literal (with internal whitespace loosened to `\\s+`), wrapped in a scoped `(?i:...)` group
    when it should match case-insensitively. No alternative contains a nested quantifier, so there
    is nothing that can backtrack catastrophically; and because exactly one top-level group can
    participate in a match at a time, `match.lastindex` always names the alternative -- and so the
    skill -- that matched.

    Alternatives are bucketed by first character, each bucket behind a one-character
    case-insensitive lookahead, and the whole thing behind a lookahead over every such character.
    Without that the regex engine tries every alternative at every position, about 0.1 ms each,
    which made whitespace-heavy or punctuation-heavy text (common in PDF extraction) take seconds
    per 50 KB. The lookaheads only ever skip positions where no alternative could match, since
    `(?i:c)` accepts a superset of what a case-sensitive `c` does.
    """
    ordered = sorted(specs, key=lambda spec: (-len(spec[0]), spec[0]))
    buckets: dict[str, list[tuple[str, bool, Skill]]] = {}
    for spec in ordered:
        first = spec[0].lstrip()[0]
        key = first.lower() if len(first.lower()) == 1 else first
        buckets.setdefault(key, []).append(spec)

    group_to_skill: dict[int, Skill] = {}
    group_to_spec: dict[int, tuple[str, bool, Skill]] = {}
    group_number = 0
    bucket_patterns = []
    for key in sorted(buckets):
        alternatives = []
        for spec in buckets[key]:
            text, requires_exact, skill = spec
            group_number += 1
            body = _escape_with_flexible_whitespace(text)
            if not requires_exact:
                body = f"(?i:{body})"
            alternatives.append(f"({body})")
            group_to_skill[group_number] = skill
            group_to_spec[group_number] = spec
        bucket_patterns.append(f"(?=(?i:{re.escape(key)}))(?:{'|'.join(alternatives)})")
    any_first = "".join(re.escape(key) for key in sorted(buckets))
    combined = "|".join(bucket_patterns)
    pattern = re.compile(f"{_BOUNDARY_BEFORE}(?=(?i:[{any_first}]))(?:{combined}){_BOUNDARY_AFTER}")
    return pattern, group_to_skill, group_to_spec


def _fail(message: str) -> NoReturn:
    raise TaxonomyError(f"skills taxonomy data: {message}")


def _validate_and_build(
    data: Any,
) -> tuple[tuple[Skill, ...], dict[str, frozenset[str]], dict[str, tuple[str, ...]]]:
    if not isinstance(data, dict) or "entries" not in data:
        _fail("expected a JSON object with an 'entries' array")
    raw_entries = data["entries"]
    if not isinstance(raw_entries, list) or not raw_entries:
        _fail("'entries' must be a non-empty array")

    skills: list[Skill] = []
    case_sensitive_terms: dict[str, frozenset[str]] = {}
    not_followed_by: dict[str, tuple[str, ...]] = {}
    seen_ids: set[str] = set()
    normalised_terms: dict[str, str] = {}  # normalised term -> owning id, across the whole file

    previous_id = ""
    for i, raw in enumerate(raw_entries):
        if not isinstance(raw, dict):
            _fail(f"entry {i} is not an object")

        unknown_keys = sorted(set(raw) - _ENTRY_KEYS)
        if unknown_keys:
            _fail(f"entry {i} has unknown keys {unknown_keys}; expected only {sorted(_ENTRY_KEYS)}")

        entry_id = raw.get("id")
        name = raw.get("name")
        kind = raw.get("kind")
        aliases = raw.get("aliases", [])
        case_sensitive = raw.get("case_sensitive", [])
        entry_not_followed_by = raw.get("not_followed_by", [])

        if not isinstance(entry_id, str) or not entry_id:
            _fail(f"entry {i} has no string 'id'")
        if not _ID_PATTERN.fullmatch(entry_id):
            _fail(f"'{entry_id}' is not a kebab-case id (expected {_ID_PATTERN.pattern!r})")
        if entry_id in seen_ids:
            _fail(f"duplicate id '{entry_id}'")
        if entry_id < previous_id:
            _fail(f"ids are not sorted alphabetically: '{entry_id}' comes after '{previous_id}'")
        seen_ids.add(entry_id)
        previous_id = entry_id

        if not isinstance(name, str) or not name.strip():
            _fail(f"'{entry_id}' has no non-empty 'name'")
        if not isinstance(kind, str):
            _fail(f"'{entry_id}' has a non-string kind {kind!r}")
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
        if not isinstance(entry_not_followed_by, list) or not all(
            isinstance(w, str) and _NOT_FOLLOWED_BY_WORD.fullmatch(w) for w in entry_not_followed_by
        ):
            _fail(f"'{entry_id}' has an invalid 'not_followed_by' (expected a list of plain words)")
        if entry_not_followed_by and not case_sensitive:
            _fail(
                f"'{entry_id}' has 'not_followed_by' but no 'case_sensitive' aliases for it to "
                "apply to"
            )

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
            if not key:
                _fail(f"'{entry_id}' has a term that normalises to empty: '{term}'")
            if not any(c.isalnum() for c in key):
                _fail(f"'{entry_id}' has a term with no letter or digit in it: '{term}'")
            if key in seen_within_entry:
                _fail(f"'{entry_id}' has the same term twice after normalisation: '{term}'")
            seen_within_entry.add(key)
            owner = normalised_terms.get(key)
            if owner is not None and owner != entry_id:
                _fail(f"'{term}' in '{entry_id}' collides with '{owner}' after normalisation")
            normalised_terms[key] = entry_id

        skills.append(Skill(id=entry_id, name=name, kind=SkillKind(kind), aliases=tuple(aliases)))
        if case_sensitive:
            case_sensitive_terms[entry_id] = frozenset(case_sensitive)
        if entry_not_followed_by:
            not_followed_by[entry_id] = tuple(entry_not_followed_by)

    return tuple(skills), case_sensitive_terms, not_followed_by


def version_for(raw_bytes: bytes) -> str:
    """The taxonomy version derived from a data file's exact bytes: the first 12 hex characters
    of their SHA-256. A later cache or matcher keys on this, so any content change -- even just
    adding one alias -- invalidates it without anyone bumping a version by hand."""
    return hashlib.sha256(raw_bytes).hexdigest()[:12]


def load_from_bytes(raw_bytes: bytes) -> Taxonomy:
    """Build a `Taxonomy` from `raw_bytes`, the exact contents of a `skills.json`-shaped file.

    `load()` uses this for the package's own data file; tests use it directly, against bytes that
    never touch the real data file, to exercise validation failures.

    Raises:
        TaxonomyError: `raw_bytes` is not valid JSON (including text that cannot be decoded), or
            fails validation -- a duplicate or non-kebab-case id, an unknown or non-string kind,
            an empty name, an alias that normalises to nothing, an id out of alphabetical order,
            an invalid `case_sensitive` or `not_followed_by`, or a name or alias that collides
            with another entry's after normalisation.
    """
    try:
        data = json.loads(raw_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise TaxonomyError(f"skills taxonomy data is not valid JSON: {exc}") from exc

    skills, case_sensitive_terms, not_followed_by = _validate_and_build(data)
    return Taxonomy(
        skills=skills,
        version=version_for(raw_bytes),
        case_sensitive_terms=case_sensitive_terms,
        not_followed_by=not_followed_by,
    )


def load_from_path(path: str | Path) -> Taxonomy:
    """`load_from_bytes()` on the contents of the file at `path`.

    Raises:
        TaxonomyError: `path` cannot be read (missing, a directory, a permissions error, and so
            on), or its contents fail validation -- see `load_from_bytes()`.
    """
    try:
        raw_bytes = Path(path).read_bytes()
    except OSError as exc:
        raise TaxonomyError(f"could not read {path}: {exc}") from exc
    return load_from_bytes(raw_bytes)


@functools.cache
def load() -> Taxonomy:
    """Load, validate and return the skills taxonomy. Cached: later calls return the same object.

    Raises:
        TaxonomyError: see `load_from_bytes()`; also raised if `data/skills.json` cannot be read
            from the package at all.
    """
    resource = importlib.resources.files(_PACKAGE) / _DATA_DIR / _FILE_NAME
    try:
        raw_bytes = resource.read_bytes()
    except OSError as exc:
        raise TaxonomyError(f"data/skills.json not found at {resource}: {exc}") from exc
    return load_from_bytes(raw_bytes)
