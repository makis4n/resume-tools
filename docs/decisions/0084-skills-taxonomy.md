# 0084. The skills taxonomy

Date: 2026-09-27 · Status: accepted

## Context

`docs/ats-prd.md` §16 left "the first skills taxonomy and its licence" open. §8.4's rule-based
requirement extractor and §8.5's requirement-to-resume matching both need a shared vocabulary of
skills, tools and qualifications with their common aliases before either can be built. Adopting a
published taxonomy would bring its own licence and its own judgement calls about scope and naming
baked in; the product owner chose to write and own a small one instead, sized to the role families
this taxonomy targets -- software engineering, data and analytics, design, product, marketing,
sales, finance and accounting, HR, operations and supply chain, customer support, healthcare,
education, and general office work -- rather than to any single external standard.

A review pass against the real data found a crash and several matching gaps before this was
merged; this record already reflects the fixed version, and the "Consequences" section says what
changed and why.

## Decision

- **Ownership and licence.** The taxonomy is hand-curated and repository-owned. No external
  taxonomy is imported; nothing about a person is invented, so no licence question arises. It
  lives at `apps/ats/src/ats/data/skills.json` and is loaded by `apps/ats/src/ats/taxonomy.py`;
  this pull request adds only the data, the loader and its lookup and mention-finding API. Rule-
  based extraction and requirement matching are later work that will call it.
- **File format.** `{"entries": [...]}`, each entry `{id, name, kind, aliases, case_sensitive?,
  not_followed_by?}`. `kind` is `skill`, `tool` or `qualification`. `id` is a stable kebab-case
  identifier (`^[a-z0-9]+(-[a-z0-9]+)*$`, checked by the loader, not just by convention); entries
  are sorted by `id` for a readable diff when one is added or changed. 336 entries at this pull
  request (across the role families listed above). Coverage favours common, unambiguous entries
  over exhaustive ones; it grows by pull request as later milestones find gaps -- this pass added
  `HTML`, `CSS` and `Linux`, previously missing despite being some of the most common terms a
  software job description would use.
- **Normalisation (`taxonomy.normalise()`).** NFKC, casefold, collapse whitespace, then strip
  leading and trailing punctuation -- except `+ # . / & -`, which our data uses to mean something
  ("C++", "C#", ".NET", "Node.js", "CI/CD", "e-learning") and which are therefore never stripped,
  even when they are not meaningful in a particular case (a trailing sentence period survives
  normalisation too; see the function's docstring). Every alias is unique after normalisation
  across the whole file, and no alias equals another entry's name; both are enforced by the loader
  and by a test over the raw file. `Taxonomy.lookup()` additionally accepts the all-caps form of a
  `case_sensitive` alias ("REACT" for "React") and, when nothing matches, retries once without
  trailing periods, so a sentence-final "Python." resolves while ".NET" and "Node.js" keep theirs. An alias that normalises to nothing (whitespace or punctuation
  only) is rejected by the loader.
- **Ambiguity.** A handful of short names are also ordinary English words, abbreviations or bare
  letters. Handled per name, not by one rule, and swept for repeatedly as new collisions turned up
  in review rather than decided once and left alone:
  - **Dropped entirely** (no bare form anywhere in the file, only an unambiguous alias or name),
    because even exact-case matching still collides with ordinary prose:
    - "Go", "R" and "C": "go the extra mile", "R&D" (the "&" is not alphanumeric, so a boundary
      check alone does not save it), "C-suite", the same way.
    - "Word" and "Access": "Word of mouth", "Access to the office".
    - "Rails" (`ruby-on-rails`'s only alias; its name, "Ruby on Rails", is unambiguous on its own):
      "on the rails", "guard rails".
    - "Outreach" (`outreach-io`, the sales-engagement tool): "community outreach" is common enough,
      including capitalised as a section heading, that the entry's canonical name was changed to
      the unambiguous "Outreach.io" rather than keeping bare "Outreach" under `case_sensitive`.
    - "Premiere" (an alias of `adobe-premiere-pro`, whose name is already the unambiguous "Adobe
      Premiere Pro"): "the premiere event of the year" is ordinary marketing/events copy.
    - Organisation/organisational skills: "organisation" and "organization" bare were dropped as
      aliases of `organisational-skills`; only the multi-word "organizational skills" remains,
      since the bare noun is ordinary English on its own ("a confluence of factors" for a
      *different* entry is the same shape of problem, handled below instead, since `Confluence`
      the tool has no natural multi-word substitute).
    - "PR" and "ts": dropped from `public-relations` and `typescript` outright. Both are common
      enough as bare two-and-three-letter abbreviations (pull request, ahead-of-time abbreviation
      of almost anything) that even exact case does not help, and neither has an obvious
      unambiguous long alias worth adding in their place.
    - "Excel", too, was dropped in the taxonomy's first version, then brought back -- see
      `not_followed_by`, below.
  - **Kept, but only under `case_sensitive`:** "Swift", "Rust", "Spark" (alias of `apache-spark`),
    "Chef", "SAP" (alias of `sap-erp`), "PM" (alias of `product-management`), "Express" (alias of
    `express-js`, whose bare form collided with the ordinary verb "express interest"), "Spring
    Boot" is kept but bare "Spring" was *dropped instead* (see below -- it is listed here to
    explain why it is not simply case-sensitive), "Outlook" (`microsoft-outlook`), "Slack",
    "Zoom", "Notion", "Sketch", "Workday" (`hris-workday`: "a flexible workday" is ordinary office
    prose, almost always lower case), "Illustration" ("for illustration purposes" is almost always
    lower case too), "Confluence" ("a confluence of skills and experience"), "Puppet" and
    "Salesforce" ("our salesforce grew 20%", the one-word spelling of "sales force"). "Angular" is
    included here too, on the same judgement (an "angular" logo or face is ordinary design/general
    prose, almost never capitalised mid-sentence). These are judged to collide with ordinary prose
    only rarely in exactly this case -- the lower-case common-word or idiomatic sense is usually
    written lower case, so requiring the exact declared case filters most of it -- so the taxonomy
    keeps the short name rather than losing it. This is a judgement call, not a guarantee:
    `Taxonomy.mentions()` will still tag "Chef" in a professional chef's resume as the
    configuration-management tool, and a sentence-initial "Spark innovation..." or a written-out
    "5 PM" meeting time can still match. None of the role families this taxonomy targets is
    culinary or otherwise depends on "chef" as a job title, so that particular one is accepted
    rather than engineered around.
  - **`not_followed_by`:** even exact case is not enough when the ordinary sense can be
    sentence-initial, which capitalises it the same way English capitalises anything at the start
    of a sentence. Two entries need this:
    - `excel-spreadsheets`: `"Excel"` is `case_sensitive`, with `"not_followed_by": ["in", "at"]`,
      compiling to a negative lookahead on that one alias, `(?!\s+(?:in|at)\b)`. "Proficient in
      Excel (pivot tables)" still matches; "Excel in a fast-paced environment" and "Ready to excel
      at any challenge" do not.
    - `react`: `"React"` is `case_sensitive`, with `"not_followed_by": ["quickly", "to"]`. Review
      caught this one directly: "React quickly." is a plausible sentence on its own (capitalised
      because it starts the sentence, not because it means the framework), and `case_sensitive`
      alone does not filter a capital letter that is there only because of where the sentence
      starts. `react-router` and `reactjs`/`react.js` are unaffected (those aliases are not
      `case_sensitive`, or are not "React" followed by "quickly"/"to"), and "React experience
      required" still matches. This is the same mechanism as Excel's, applied to a second entry;
      it was not judged worth adding to every other `case_sensitive` entry pre-emptively, since
      the others do not have a similarly common, plausible sentence-initial reading and no probe
      against real data has found one yet.
  - Everything else with a common-word or generic-abbreviation collision risk (`Java`, `PHP`,
    `Ruby`, `SQL`, `SAS`) is matched case-insensitively as normal: none of those is an ordinary
    English word or a plausible sentence-initial capitalisation the way the entries above are.
- **Mention-finding (`Taxonomy.mentions()`).** One regular expression, compiled once per loaded
  taxonomy, alternating every name and alias, longest text first, so a longer alias wins over a
  shorter one that also matches at the same starting position ("machine learning engineer" finds
  "machine learning", not "machine"). Each alternative is its own capturing group; `mentions()`
  resolves a match to its skill by which group number matched (`match.lastindex`), through a table
  built once alongside the pattern, never by re-normalising the matched text (see "Group-based
  match resolution" below for why that matters). A run of whitespace inside a multi-word term
  becomes `\s+` in the pattern, so a line break or doubled space in PDF-extracted text still
  counts as a match ("machine\\nlearning", "Microsoft   Excel"); the returned offsets still index
  the original, untouched text. A match cannot be immediately preceded by an ASCII letter or
  digit, and cannot be immediately followed by an ASCII letter -- but *can* be immediately followed
  by a digit or a "+", so a version suffix still counts as the same term ("C++17" matches "C++",
  "Python3" matches "Python", "Angular2+" matches "Angular"), while "Java" still cannot match
  inside "JavaScript" (the following "S" is a letter) and "C++" still cannot match inside "CSS". A
  term listed under an entry's `case_sensitive` matches only in that exact case (via a
  per-alternative scoped `(?i:...)` group, so the rest of the alternation still matches
  case-insensitively); every other term matches regardless of case. `re.finditer` over one such
  pattern gives every match in one linear left-to-right pass, already ordered by start offset and
  never overlapping, without a second data structure or an overlap-resolution pass. The haystack
  text itself is never run through `normalise()` -- doing so could change its length (casefold and
  NFKC are not always length-preserving) and would drift the character offsets `mentions()`
  promises against the original text.
- **Group-based match resolution (not re-normalising the matched text).** The first version of
  this taxonomy resolved a match by calling `normalise()` on the matched substring and looking
  that up. This is unsound: `re.IGNORECASE` and `str.casefold()` do not agree on every code point.
  `re.IGNORECASE` matches the pattern `"i"` against U+0130 (İ, Turkish dotted capital I) and U+0131
  (ı, Turkish dotless lower-case i), but `str.casefold()` does not fold either of them to plain
  `"i"` -- so `mentions("JAVASCRİPT")` matched the whole string against the "javascript"
  alternative, then raised `KeyError` trying to look up `normalise("JAVASCRİPT")`, which is not the
  same string `normalise("javascript")` produces. The fix removes the re-derivation instead of
  patching around it: each alternative is wrapped in its own capturing group when the pattern is
  built, and a `group number -> Skill` table is built at the same time, so resolving a match is a
  dictionary lookup by `match.lastindex`, never a re-normalisation of what was actually matched.
  `mentions("JAVASCRİPT")` now returns one mention of `javascript`, deterministically, rather than
  raising.
- **`Taxonomy.version`.** The first 12 hex characters of the SHA-256 of the data file's exact
  bytes, computed once when it is loaded. A later cache or matcher keyed on it is invalidated
  automatically by any content change, including just adding one alias, without a manually bumped
  version number.
- **Location and packaging.** `apps/ats/src/ats/data/skills.json`, read with
  `importlib.resources.files("ats") / "data" / "skills.json"` so it works from the installed wheel
  as well as a source checkout. `pyproject.toml`'s `[tool.hatch.build.targets.wheel]` lists only
  `packages = ["src/ats"]` with no `include` or `exclude` pattern, and hatchling includes every
  file under a listed package by default; a wheel build was checked by hand to confirm
  `ats/data/skills.json` is actually present in it, and a test guards the configuration.
- **Validation.** `load()` (the package's own data, cached) and `load_from_bytes()`/
  `load_from_path()` (anyone else's bytes or file -- what the tests use, so they never have to
  touch or fake-corrupt the real data file) share one validation pass. It rejects: an entry with a key other than the six above (a misspelt
  `case_sensitve` would otherwise silently disable its rule); a duplicate or
  non-kebab-case id; ids out of alphabetical order; a missing, empty or non-string `name`; a
  missing or non-string `kind`, or one that is not `skill`/`tool`/`qualification` (a non-string
  `kind` is rejected as `TaxonomyError`, not left to raise a bare `TypeError` from a set-membership
  check); a non-string or empty alias, or one that normalises to nothing; a `case_sensitive` entry
  that is not the name or an alias; a `not_followed_by` that is not a list of plain words, or that
  is present without any `case_sensitive` alias for it to guard; and a name or alias that collides
  with another entry's after normalisation. Invalid JSON, including bytes that cannot be decoded as
  text at all (`json.loads` raises `UnicodeDecodeError` for some malformed byte sequences, not
  `JSONDecodeError`), and an unreadable path (missing file, a directory, permissions) are all
  wrapped in `TaxonomyError` rather than left as `json.JSONDecodeError`, `UnicodeDecodeError` or
  `OSError`.

## Consequences

- Coverage is narrow by design and will visibly show gaps once rule-based extraction and matching
  are built against it; growing it is an ordinary, low-risk pull request (append an entry, keep
  `id` order, rerun the tests).
- The taxonomy is English only. A non-English job description or resume will not match well; this
  is not addressed here.
- There is no hierarchy or relatedness between entries -- no "Python implies programming", no
  synonym ranking beyond exact alias equality. Semantic matching, which is where that kind of
  relationship would live, is milestone 4 and explicitly out of scope for this pull request.
- Every alias is a lever on real matches: adding one can change which requirements a resume is
  found to satisfy. Because `version` is derived from the file's content, that change is always
  visible to anything that caches by version, rather than silently reusing a stale result.
- The ambiguity calls above are documented, not proven safe. "Chef" in a culinary resume, "PM" in
  a written-out "5 PM", and an "angular" design description are known, accepted false positives,
  not oversights; revisiting them needs either a new decision or a disambiguation mechanism this
  pull request does not build.
- Making an entry `case_sensitive` after it already shipped is a matching-behaviour change for
  anyone who was relying on the lower-case form matching too (nobody yet, at this pull request).
  `React`, `Workday`, `Illustration`, `Confluence`, `Puppet`, `Salesforce` and `Angular` all lost
  their lower-case match in this pass for exactly that reason: recall traded for precision on
  words that read as ordinary English at least as often as they read as the tool or skill.
- `not_followed_by` is deliberately narrow and enumerable, not a general disambiguator: it blocks
  the *specific* continuations review found (Excel "in"/"at", React "quickly"/"to"), not every way
  a word could be used as an ordinary verb. A new idiom found later needs a new word added to the
  list, or a new decision if the mechanism itself needs to change.
- `Taxonomy.mentions()` no longer needs the matched substring to look anything up -- only its
  span -- which also means a future caller cannot accidentally rely on the matched text being
  case-normalised in a particular way; the group-to-skill table is the only place that knowledge
  lives.
