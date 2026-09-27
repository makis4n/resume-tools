# 0034. The skills taxonomy

Date: 2026-09-27 · Status: accepted

## Context

`docs/ats-prd.md` §16 left "the first skills taxonomy and its licence" open. §8.4's rule-based
requirement extractor and §8.5's requirement-to-resume matching both need a shared vocabulary of
skills, tools and qualifications with their common aliases before either can be built. Adopting a
published taxonomy would bring its own licence and its own judgement calls about scope and naming
baked in; the product owner chose to write and own a small one instead, sized to the role families
this product targets rather than to any single external standard.

## Decision

- **Ownership and licence.** The taxonomy is hand-curated and repository-owned. No external
  taxonomy is imported; nothing about a person is invented, so no licence question arises. It
  lives at `apps/ats/src/ats/data/skills.json` and is loaded by `apps/ats/src/ats/taxonomy.py`;
  this pull request adds only the data, the loader and its lookup and mention-finding API. Rule-
  based extraction and requirement matching are later work that will call it.
- **File format.** `{"entries": [...]}`, each entry `{id, name, kind, aliases, case_sensitive?}`.
  `kind` is `skill`, `tool` or `qualification`. `id` is a stable kebab-case identifier; entries are
  sorted by `id` for a readable diff when one is added or changed. 333 entries at this pull
  request (184 `skill`, 120 `tool`, 29 `qualification`), across software engineering, data and
  analytics, design, product, marketing, sales, finance and accounting, HR, operations and supply
  chain, customer support, healthcare, education, and general office work. Coverage favours common,
  unambiguous entries over exhaustive ones; it grows by pull request as later milestones find gaps.
- **Normalisation (`taxonomy.normalise()`).** NFKC, casefold, collapse whitespace, then strip
  leading and trailing punctuation -- except `+ # . / & -`, which our data uses to mean something
  ("C++", "C#", ".NET", "Node.js", "CI/CD", "e-learning") and which are therefore never stripped,
  even when they are not meaningful in a particular case (a trailing sentence period survives
  normalisation too; see the function's docstring). Every alias is unique after normalisation
  across the whole file, and no alias equals another entry's name; both are enforced by `load()`
  and by a test over the raw file.
- **Ambiguity.** A handful of short names are also ordinary English words, abbreviations or bare
  letters. Handled per name, not by one rule:
  - **Dropped entirely** (no bare form anywhere in the file, only an unambiguous alias): "Go"
    (collides with the imperative verb -- "go the extra mile" -- which not even exact-case
    matching filters, since a sentence can start with a capital letter too), "R" (collides with
    "R&D", where the "&" is not alphanumeric so a boundary check alone does not save it), "C"
    (collides with "C-suite" the same way), "Excel", "Word" and "Access" (all three collide with
    common capitalised phrasing in ordinary job-description prose -- "Excel in a fast-paced
    environment", "Word of mouth", "Access to the office" -- badly enough that even exact-case
    matching would still misfire). Their canonical entries instead use an unambiguous name or
    alias: `go-programming-language` is named "Go (programming language)" with alias "Golang";
    similarly `r-programming-language` ("R (programming language)"), `c-programming-language` ("C
    programming language"), `excel-spreadsheets` ("Microsoft Excel"), `microsoft-word` and
    `microsoft-access`.
  - **Kept, but only under `case_sensitive`:** "Swift", "Rust", "Spark" (alias of `apache-spark`,
    whose canonical name is the unambiguous "Apache Spark"), "Chef", "SAP" (alias of `sap-erp`)
    and "PM" (alias of `product-management`). These are judged to collide with ordinary prose only
    rarely in exactly this case (lower-case "rust", "spark" and "chef" are common; the capitalised
    forms much less so outside their tool or product sense), so the taxonomy keeps the short name
    rather than losing it. This is a judgement call, not a guarantee: `Taxonomy.mentions()` will
    still tag "Chef" in a professional chef's resume as the configuration-management tool, and a
    sentence-initial "Spark innovation..." or a written-out "5 PM" meeting time can still match.
    None of the role families this taxonomy targets (§1 of this record) is culinary or otherwise
    depends on "chef" as a job title, so this is accepted rather than engineered around.
  - Everything else with a common-word or generic-abbreviation collision risk (`Word`, `Java`,
    `PHP`, `Ruby`, `SQL`, `SAS`) is matched case-insensitively as normal: none of those is an
    ordinary English word or a plausible sentence-initial capitalisation the way the entries above
    are.
- **Mention-finding (`Taxonomy.mentions()`).** One regular expression, compiled once per loaded
  taxonomy, alternating every name and alias, longest text first, so a longer alias wins over a
  shorter one that also matches at the same starting position ("machine learning engineer" finds
  "machine learning", not "machine"). A match cannot be immediately preceded or followed by an
  ASCII letter or digit -- deliberately narrower than `\b`, which would let "C++" match inside
  "C++11" -- so "Java" cannot match inside "JavaScript" and "C++" cannot match the "C++" prefix of
  "C++11". A term listed under an entry's `case_sensitive` matches only in that exact case (via a
  per-alternative scoped `(?i:...)` group, so the rest of the alternation still matches
  case-insensitively); every other term matches regardless of case. `re.finditer` over one such
  pattern gives every match in one linear left-to-right pass, already ordered by start offset and
  never overlapping, without a second data structure or an overlap-resolution pass. The haystack
  text itself is never run through `normalise()` -- doing so could change its length (casefold and
  NFKC are not always length-preserving) and would drift the character offsets `mentions()`
  promises against the original text.
- **`Taxonomy.version`.** The first 12 hex characters of the SHA-256 of `skills.json`'s exact
  bytes, computed once when `load()` reads the file. A later cache or matcher keyed on it is
  invalidated automatically by any content change, including just adding one alias, without a
  manually bumped version number.
- **Location and packaging.** `apps/ats/src/ats/data/skills.json`, read with
  `importlib.resources.files("ats") / "data" / "skills.json"` so it works from the installed wheel
  as well as a source checkout. `pyproject.toml`'s `[tool.hatch.build.targets.wheel]` lists only
  `packages = ["src/ats"]` with no `include` or `exclude` pattern, and hatchling includes every
  file under a listed package by default; a wheel build was checked by hand to confirm
  `ats/data/skills.json` is actually present in it, and a test guards the configuration.

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
- The ambiguity calls above are documented, not proven safe. "Chef" in a culinary resume and "PM"
  in a written-out "5 PM" are known, accepted false positives, not oversights; revisiting them
  needs either a new decision or a disambiguation mechanism this pull request does not build.
