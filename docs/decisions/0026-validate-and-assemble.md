# 0026. Validate and assemble

Date: 2026-09-27 · Status: proposed

## Context

Milestone 3 item 7 is plan section 6 steps 5 and 6: from a resume the intake took in and the
reference compile set (decision 0019), the tree the parser read (decision 0020), the probe's
verdicts (decision 0022) and the naming answer (decision 0024), make a template package (decision
0006) and a document in the model, check them with plan section 6's four checks and the harness, and
say what came of it for item 13's report. The code is `apps/editor/src/import/assemble.ts` and
`validate.ts`, browser-safe, with `templating.ts` for the source a snippet may hold; `corpus
assemble` runs it over the corpus and `corpus oracle` over the three launch templates' upstream
samples. The item's other half, decision 0025, gives the model what this one fills: the `locked`
section kind, extras of kept LaTeX under their keys, the extras slots `{{&x.<key>}}`, and the
generator's writing of both, which every compile of the checks and the harness goes through.

## Decision

### The answers

- **Each of the document's macros is asked for by its key, as the document's macro**
  (`answerFor(cache, key, macro)`, decision 0024), from the request built as items 7 and 11 build
  it: with the upload's sources, so that the macros it defines are its own, and with the header's
  values its calls give, found by the answers the request without them finds. An answer comes
  named as the document names the macro, and its list's partners as the request names them, found
  by their keys; one the cache holds but refuses for the macro, another kind's or naming a partner
  the request has no macro of, is no answer, and the macro stays as the probe left it. A command's
  closer is of its opener's kind, whatever kind its own answer gives it.

### The package

- **Its id** is `import-` and 12 hex digits of the SHA-256 of the rest of the package as JSON, so
  that two uploads of one template whose preambles agree share a package and its formats: the body's
  text never reaches a snippet, and the preamble keeps only what the answer does not name as the
  header's. **Its name** is the family's (`Jake's Resume`, `Awesome-CV`, `AltaCV`, `moderncv`,
  `europecv`) or the class's; **its source** the upload's main file's name, with no licence; **its
  files** the upload's classes, styles and their kin (`.cls .sty .clo .def .fd .cfg`) and the `.tex`
  files the preamble inputs, as text, and the configurations the reference compile gave pdfTeX's DVI
  (decision 0019).
- **Its preamble is the document's, rewritten only as far as the loop needs.** Before
  `\documentclass`, `\PassOptionsToPackage{dvipdfmx,bookmarks=false}{hyperref}` on pdfTeX, and
  `bookmarks=false` on XeTeX (decision 0008). After the preamble, hyperref with `hidelinks` where
  the reference compile's log shows the document never loads it, so that a link a user types links;
  where it does, however late, nothing, since moderncv's class loads it at the preamble's end with
  options of its own, which an earlier load clashes with. The preamble's calls that store the
  header's text, which the answer says are the header's, a contact's, a link's or other, are taken
  out, and set from the model before `\begin{document}`. The class's size option becomes the font
  size control's slot. The reviewed answers' redefinitions go right after `\documentclass`, or,
  where a compile after the class stops, as it does for a macro a package or the preamble defines,
  at the preamble's end, right before `\begin{document}` (`withRedefinitions`, `class` and then
  `preamble`, decision 0024), each once. Where the preamble ends in `\makeatletter`, `@`'s category
  is kept for the body. A XeTeX document's preamble is item 8's rewrite of it, its fonts declared by
  file, the rewrite's style files among the package's files and its families the package's
  `fonts`, and the rewrite's own check has passed before the assembly starts (decision 0023), so
  that its format dumps. Nothing else changes: **no T1, no Latin Modern, no font of the editor's,
  no geometry**. Decision 0009 is for ports, whose output the editor defines; an import's output is
  its reference, which the first check holds the package to glyph for glyph, and a font changed is
  every glyph changed. The plan's item text asks for the port's rewrite, T1 and Latin Modern for a
  pdfTeX document in Computer Modern, EC or TS1, as decisions 0008 and 0009 have every port;
  **this record does not do it yet, and the item owes it**: the rewrite is to be made, and the
  reference compiled with the same rewrite, so that the first check holds against it and the page
  can draw every glyph, in the item's review round. Until then such a document keeps its fonts,
  and one whose fonts the page cannot draw is refused (below).
- **A document whose reference sets a font the page cannot draw is refused**, naming the font, as
  the reference's fonts are the package's: TeX fonts only, a font the upload ships aside.
- **Its controls** are the generic ones the preamble proves it has, each with the document's own
  value as its default, so that the first compile is the original: `pageSize` where the class or
  geometry names the paper, or the reference's size is Letter or A4 (geometry loaded by the other
  value's snippet where the document has none); `margins` where geometry sets one margin, from 0.4
  to 1 inch in tenths; `fontSize` over the class's size option, from 9 to 12 points, a format
  control (decision 0012); `dateFormat` where a date with a month is set from the model, since
  years alone read the same in every format. The answer's preamble
  parameters give `accent` (a colour `\definecolor` defines), `density` (`\linespread`) and, on
  pdfTeX, `font` (the document's own and three of the tree's families); the seed has none, so the
  corpus shows none yet. Each is kept only if the fourth check proves it.
- **Its snippets are the template's code, read from the body where the answer places the model.**
  A section's head, a list's opener and closer, an entry's call and its bullets' list, a list's
  items, a labelled item's call, the header's calls, and the document's code around the header and
  the sections, each copied from the source with its comments out (`templateText`) and a `{{` that
  would begin a tag broken. In a call, each argument whose answer gives it a slot of the place is
  a typeset slot, beside an extras slot that holds an instance's original bytes when the checks
  lock it (`{{title}}{{&x.title}}`); an address is `{{&href}}`; a date a date slot; an argument
  with no slot the same bytes in every call (a key, a length, an icon) or an extras slot of its own.
  Every unit of a list must read as the first does (`comparable`, TeX's reading of spaces and line
  ends), and every gap between two units alike, or the list is kept as the upload wrote it
  (below). A snippet may differ by section role (`ByRole`), as Jake's education entries swap their
  dates and place. A name in one argument is `{{first}}{{#last}} {{last}}{{/last}}`, the document's
  split at its last space, whether its answer maps it to the first name alone or, as the seed's
  AltaCV `\name` does, to the first name and the last a space apart (`parts`).

### The document

- **The header.** The preamble's storing calls are issued again by the header's snippet, which the
  document snippet sets before `\begin{document}`; a body's header calls, from the first to the
  last before the sections, are the header's snippet where they stand. A header or contact call's
  fields go to the header's slots, each once, a second kept in the extras; link calls in a run are
  `{{links}}`, each through its kind's snippet, the separator between them the run's; the calls
  the answer gives the header's contacts to are read through; the template's own code stays; and
  anything else is kept in the header's extras. A contact, link or header argument the probe found
  `twice`, as a contact whose address is built from its text, is set raw (`{{&email}}`), so that
  the panel still edits it (plan section 5.4).
- **The sections.** Their heads are the answer's section calls, or LaTeX's sectioning commands at
  the level most of them are at, in the body or in the one environment that holds them all, as
  AltaCV's `paracol` does. A section's kind is its content's: entries after an opener or in an
  environment the answer says holds them, or entry calls one after another, each with the bullet
  list after it or in its argument; items of a standard list, of an environment or of the answer's
  item calls, labelled or not; or one paragraph of rich text. Its role is the answer's hint or its
  title's words.
- **Dates** are read in the one format the generator writes most of the body's dates in, of its
  four; years alone read the same in every format and count for each. A date spelled otherwise is
  kept as the upload wrote it (`date`).
- **Ids** are minted from where each node stands in the source (FNV-1a, six base-36 digits), so the
  same resume gives the same ids, and a second assembly with the checks' decisions matches the
  first node for node.
- **What a snippet cannot hold is kept, in place.** An instance a verdict or a check locks keeps its
  bytes in its node's extras, under its slot's key, and its field is left out of the model; a bullet
  or an item keeps no extras, so its list is kept whole in its entry's or section's (`x.bullets`,
  `x.items`), as are the links in the header's (`h.links`); the gap before each section is its
  extras' `lead`, so that the sections' separator is nothing and every gap stays as TeX read it. A
  part of the body no snippet can express, a raw chunk or a call no answer places, is a locked
  section where it stands, written as `\rtlocked{<id>}{<latex>\n}` (decision 0025); a part
  `\rtlocked` cannot take as an argument, `\verb`, a catcode change, a verbatim environment, is kept
  in the extras of the section before it (`after`), outside any argument, and one before any section
  refuses the import (`keep`).
- **The probe's verdicts** lock an argument in every call where whatever it holds fails the same way
  (`breaks`, `vanished`, `twice`, `misaligned`, `split`); an instance that moved the page or was
  never settled is locked alone. `case` is editable, since the aligner folds case (decision 0021).
  A macro whose answer carries redefinitions that are applied is trusted, since the probe saw the
  class unpatched, and the harness judges it instead.

### The checks

The first two are the import's own checks, in `validate.ts`, rather than a new check of the
harness's and its `edits` check grown, as the plan's item text has them: the first needs the
reference, which a curated package has none of, and both lock what they find and assemble again,
which the harness knows nothing of. Every compile is in the `import` job, from the package's format,
dumped once for each format a control's value names, a XeTeX package's with its fonts declared by
file, or whole from the stock format where it does not dump, or where the probe found the
document's own format does not set its reference's glyphs and compiled it whole (decision 0022);
with the job's files the reference compile had. The formats the checks and the harness dump are
dropped when the validation ends, as their maker drops them (`dropFormat`), so that a session
that validates one import after another does not keep them all. Each check that finds a failure
bisects it as the probe does (`settle`, decision 0022), 48 compiles a bisection at most.

1. **Same output.** The original, compiled as the reference was but with the rewrite's hyperref
   lines, must set the reference's glyphs and rules: the driver and the bookmarks move
   specials and nothing on the page. The original body, compiled from the package's format with
   the storing calls issued before it and the controls at their defaults, must then set that page
   exactly, specials and all. Where it stops with the redefinitions after the class, they go at the
   preamble's end, and where it does not keep the page, the redefinitions and controls that move
   it are found, one by one, and dropped. A XeTeX import's body, its fonts declared by file,
   compares with the original, whose fonts were found by name, as item 8's check compares them, a
   native font by its file and a colour special wherever it stands, since it sets nothing on the
   page (decision 0023). Then the body the generator makes of the document must set
   exactly what the original body sets, the markers aside; where it does not, the fields whose
   regeneration moves it are bisected out and locked (`differs`), their bytes in their node's
   extras. A difference that the document with every field locked shows too leaves the import
   `partial`, with its first difference, for item 13 to show; the rest of the checks still run,
   but for a document that does not compile as it stands, which tells them nothing.
2. **Mutations.** Every editable field set to a 300-character text, then empty, then characters
   TeX reads (`\ { } $ & # ^ _ % ~ < > | [ ] * -- ' " é ß ø ω Ж ğ`), three compiles, each failing
   one bisected to the slot. A slot that stops on text is locked in every instance (`text`); one
   that stops only when empty is **required**: the package keeps it editable and the editor
   refuses to empty it, as Awesome-CV's blank name stops the compile (decision 0015).
3. **Repeatable units.** Of each kind the document has, entry, bullet, item, labelled item and
   link, a copy of the first with the editor's placeholder texts added, and the first removed,
   each compiled; what stops is recorded for item 13, since a unit that cannot be added is a
   limit of the template, not a field to lock.
4. **Controls.** Each control's every value but the document's compiled: one that stops the compile
   at any value, or sets the same page at every one, is dropped.

Then **the harness** (`validatePackage`) runs on the package and the document: a `fields` or
`alignment` finding on a field locks it, or its list, once, and the checks run again; every other
finding is recorded for item 13. The bodies it compiles are the generator's, as the checks' are,
locked sections and extras among them.

The result is the package, the document, the locked parts with where each stands, why and how many
words, and the checks: the fields editable, raw, required and locked by reason, the words in each,
the sections mapped and locked, the controls offered, proven and dropped, the redefinitions applied
and dropped, the repeatable units, the harness's findings, and the compiles and time.

### The runner and the oracle

- `corpus assemble [--only <id>] [--json <file>]` takes each fetched document through the probe's
  pipeline in the reference runner's pool, 900 s a document, finds the answers the committed
  folder holds for its macros' keys (above), and, where it holds any, rewrites a XeTeX document's
  fonts by file and checks the rewrite, which refuses what it cannot reproduce (decision 0023),
  and assembles and validates it; it prints the table below, names and numbers only, and keeps
  each document's package and document under `.corpus/assemble/`.
- `corpus oracle` assembles and validates the three upstream samples from the seed after probing
  them, and prints, beside the probe's table, the model's places each port's snippets mark
  against how the assembly came out for each.

## The oracle

`corpus oracle` on 27 September 2026, the tree of layout 7, the M4 Pro: the three upstream samples
assemble from the seed and their first check holds, the original body and the body the generator
makes of the document setting the same glyph stream.

| Sample | Outcome | Fields editable | Words editable | Parts locked, by reason | Harness | Compiles |
|---|---|--:|--:|---|---|--:|
| Jake's Resume | assembled | 47 | 323 of 389 | `date` 3, `unmapped` 2 | no finding | 27 |
| AltaCV | assembled | 38 | 80 of 288 | `unmapped` 13, `date` 4, `differs` 3, `shape` 2, `moved` 1 | `converges` 2, `pages` 1 | 70 |
| Awesome-CV | assembled | 119, and 4 raw | 1023 of 1249 | `date` 9, `unmapped` 4, `differs` 1, `shape` 1, `text` 1 | `pages` 1, `pdf` 7 | 67 |

Against the places each port's snippets mark, what the import leaves out or locks, and why:

- **Jake's Resume.** The header's name, contacts and links are absent: the sample writes them as a
  centred block of text and `\href`s, with no macro to answer, and the block is a locked section
  (Consequences). So are its skills, an `itemize` whose one item holds `\textbf` labels and text
  broken by `\\` inside `\small{...}`, which no list reads: no item or labelled item. Three dates
  abbreviate their months with a stop, which the generator does not write (`date`). The three
  places the probe once saw move the page are editable since its fixes (decision 0022). The sample
  has no paragraph. Entries and bullets add and remove.
- **AltaCV.** Its name, one argument the seed maps to the first name and the last, is split at its
  last space, and its section titles, set in capitals, are editable, since the aligner folds case
  (decision 0021). The redefinitions of `\cvevent` and `\cvtag` change the page and are dropped by
  the first check, as decision 0024 expected, and `\printinfo`'s is kept. The name, the email and a
  paragraph moved the page when regenerated (`differs`). Its tags moved the page when the probe
  marked them, and with their redefinition dropped they are kept as the upload wrote them (`moved`),
  as are its achievements, skills, wheel chart and bibliography, which the seed answers `other`.
  Four dates are not dates the model holds (`date`), and an event's title and a part of the header
  are kept for their shape (`shape`). A section title stops the compile when empty: it is
  required. The template takes three passes to settle (`converges`) and its sample is two pages
  (`pages`).
- **Awesome-CV.** Its format dumps with its fonts declared by file (item 8's rewrite, decision
  0023), and its first check holds against the original compiled with its fonts found by name, a
  colour special's place aside, as the rewrite's own check compares them. Its entries' titles and
  its address are editable since item 8's reading of the page (decisions 0022 and 0023). Nine
  dates abbreviate their months with a stop and join their ends with a hyphen, which the generator
  writes otherwise (`date`); the position, whose separators are raw, is kept (`shape`), and the
  last name moved the page (`differs`); the mobile number, from which the class builds its address,
  stops the compile on the checks' text (`text`). The email and the three links are set raw, their
  addresses built from their text. Four redefinitions are applied and none dropped. The address
  and a section's title stop the compile when empty: they are required. The harness finds seven
  of the nine entries' titles, which the class sets in small capitals, absent from the PDF's text
  (`pdf`), and the sample is three pages (`pages`). Entries, bullets and links add and remove.

The probe's own table against the oracle is unchanged by this item: 3 disagreements of 75, each
explained in decision 0022.

## The corpus

`corpus assemble` on 27 September 2026, the tree of layout 7, the M4 Pro, four children beside
other work: 15.4 minutes.

|  | jake | awesome-cv | altacv | moderncv | europecv | other | all |
|---|--:|--:|--:|--:|--:|--:|--:|
| Documents whose body parsed | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Not probed: the body unmarked did not set the reference's glyphs | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| No answer for any macro the body calls | 3 | 0 | 0 | 1 | 6 | 33 | 43 |
| Assembled and checked | 14 | 14 | 6 | 8 | 0 | 0 | 42 |
| Assembled: the first check holds | 12 | 12 | 6 | 8 | 0 | 0 | 38 |
| Partial: the first check differs | 2 | 2 | 0 | 0 | 0 | 0 | 4 |
| Partial, the first difference: `position` | 2 | 2 | 0 | 0 | 0 | 0 | 4 |
| Refused | 18 | 4 | 3 | 5 | 0 | 1 | 31 |
| Refused: difference | 0 | 4 | 0 | 0 | 0 | 1 | 5 |
| Refused: font | 18 | 0 | 2 | 5 | 0 | 0 | 25 |
| Refused: font `ecbx0900` | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| Refused: font `ecbx1000` | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| Refused: font `ectt0900` | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| Refused: font `tcbx1000` | 3 | 0 | 0 | 0 | 0 | 0 | 3 |
| Refused: font `tcrm0900` | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| Refused: font `tcrm1000` | 9 | 0 | 0 | 0 | 0 | 0 | 9 |
| Refused: font `tcrm1095` | 3 | 0 | 0 | 0 | 0 | 0 | 3 |
| Refused: font `tcsl1000` | 0 | 0 | 0 | 3 | 0 | 0 | 3 |
| Refused: font `tcss1000` | 0 | 0 | 0 | 2 | 0 | 0 | 2 |
| Refused: keep | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| Timed out or died | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| Template macros with an answer | 114 | 209 | 77 | 26 | 0 | 11 | 437 |
| Template macros with none | 156 | 84 | 82 | 70 | 95 | 140 | 627 |
| Template macros with none: the answer held is another kind's, or its partner is not theirs | 23 | 0 | 0 | 0 | 0 | 1 | 24 |
| **Fields** |  |  |  |  |  |  |  |
| Editable | 299 | 357 | 137 | 41 | 0 | 0 | 834 |
| Raw: set, and edited in the panel alone | 0 | 48 | 0 | 12 | 0 | 0 | 60 |
| Required | 1 | 28 | 2 | 0 | 0 | 0 | 31 |
| Parts locked: `raw` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Parts locked: `breaks` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Parts locked: `vanished` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Parts locked: `twice` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Parts locked: `moved` | 1 | 0 | 1 | 0 | 0 | 0 | 2 |
| Parts locked: `misaligned` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Parts locked: `case` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Parts locked: `split` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Parts locked: `untested` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Parts locked: `date` | 16 | 31 | 6 | 0 | 0 | 0 | 53 |
| Parts locked: `shape` | 21 | 9 | 3 | 0 | 0 | 0 | 33 |
| Parts locked: `unmapped` | 84 | 31 | 46 | 33 | 0 | 0 | 194 |
| Parts locked: `differs` | 1 | 7 | 0 | 0 | 0 | 0 | 8 |
| Parts locked: `text` | 0 | 5 | 0 | 0 | 0 | 0 | 5 |
| Parts locked: `fields` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Parts locked: `alignment` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Words in editable fields | 31% | 28% | 21% | 6% |  |  | 26% |
| **Sections** |  |  |  |  |  |  |  |
| Mapped onto the model | 72 | 39 | 16 | 32 | 0 | 0 | 159 |
| Locked | 71 | 33 | 17 | 32 | 0 | 0 | 153 |
| **Controls, documents** |  |  |  |  |  |  |  |
| `pageSize` proven | 14 | 14 | 6 | 8 | 0 | 0 | 42 |
| `margins` proven | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `fontSize` proven | 13 | 14 | 6 | 8 | 0 | 0 | 41 |
| `font` proven | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `accent` proven | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `density` proven | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `pageSize` dropped | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `margins` dropped | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `fontSize` dropped | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `font` dropped | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `accent` dropped | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `density` dropped | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Redefinitions, documents** |  |  |  |  |  |  |  |
| Applied after `\documentclass` | 0 | 12 | 1 | 0 | 0 | 0 | 13 |
| Applied before `\begin{document}`: a compile after the class stopped | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Dropped: `\cvevent` | 0 | 0 | 3 | 0 | 0 | 0 | 3 |
| Dropped: `\cvhonors` | 0 | 1 | 0 | 0 | 0 | 0 | 1 |
| Dropped: `\cvtag` | 0 | 0 | 2 | 0 | 0 | 0 | 2 |
| **The harness's findings, documents** |  |  |  |  |  |  |  |
| `dump` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `compile` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `converges` | 0 | 1 | 0 | 0 | 0 | 0 | 1 |
| `controls` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `edits` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `pages` | 9 | 7 | 2 | 4 | 0 | 0 | 22 |
| `fields` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `alignment` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `fonts` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `special` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `pdf` | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| No finding | 5 | 5 | 4 | 4 | 0 | 0 | 18 |
| A repeatable unit stops the compile | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Compiles and time** |  |  |  |  |  |  |  |
| Compiles, median | 23 | 44 | 24 | 21 |  |  | 27 |
| Compiles, most | 54 | 63 | 41 | 23 |  |  | 63 |
| The probe, median | 899 ms | 42406 ms | 18519 ms | 10744 ms |  |  | 12124 ms |
| Assembly and checks, median | 5646 ms | 16062 ms | 14790 ms | 9334 ms |  |  | 9770 ms |
| Assembly and checks, slowest | 9644 ms | 37755 ms | 25890 ms | 9896 ms |  |  | 37755 ms |

### What the table says

- **The seed reaches the launch templates' documents, and little else.** Of 117 bodies that parse,
  43 call no macro the seed answers, 33 of the 34 `other` and all six europecv's; 42 are assembled
  and checked, and 38 of them keep their reference's glyph stream with the fields they have.
  Until item 9 answers the rest, 627 of the template macros the body calls have no answer. For 24
  of them, 23 in Jake's forks, the cache holds an answer it refuses for the document's macro: a
  fork that rewrote one of a list's two macros keeps the other's answer out too, since its partner
  is no longer the seed's by key (decision 0024), which leaves two forks with no answer at all.
- **What is locked is what nothing answers.** 26% of the words of the documents assembled are in
  editable fields (Jake's 31%, Awesome-CV's 28%, AltaCV's 21%, moderncv's 6%), and 93% of the
  locked words are `unmapped`: a fork's own macros, and Jake's header, a block of text and links
  with no macro to answer (Consequences). One document reaches item 13's 90%, an Awesome-CV fork
  at 94%, partial, and the next, another, 89%. What the checks lock beyond the probe is small: 8
  parts whose regeneration moved the page (`differs`), 5 slots whose text stops the compile
  (`text`), and 31 slots required, 28 of them Awesome-CV's.
- **Refusals are fonts.** 25 documents, 18 of Jake's forks and 5 of moderncv's, set a font the
  page cannot draw: TS1's bullet and symbols in Computer Modern (`tcrm`, `tcbx`, `tcsl`, `tcss`,
  22 documents) and EC's (3), which the T1 and Latin Modern rewrite this item owes would draw
  (Consequences). Item 8's check refuses 5 XeTeX documents, 4 of them Awesome-CV forks, whose
  fonts by file set their glyphs otherwise than the reference (`difference`, decision 0023). One
  AltaCV fork has a verbatim part before its first section (`keep`), and one's body at the font
  size control's 9 points never ends (`timeout`).
- **Four are partial**, each by a position: two of Jake's, by a tenth of a point near the top of
  the page and by a line broken otherwise near its foot, which the original compiled with the
  rewrite's hyperref lines alone shows already; and two of Awesome-CV's, on their second page,
  which the body with every field locked shows with no lock marker too. Item 15's lock markers and
  the hyperref lines are where to look again.
- **Controls**: the page size is proven on every document and the font size on all 41 whose
  `\documentclass` names a size; no document sets geometry's margins as one length in tenths of an
  inch, so `margins` is never offered, and the seed has no preamble settings, so neither are
  `accent`, `font` and `density`. Nothing is dropped.
- **Redefinitions** are applied after the class in 13 documents, and none needed the preamble's
  end. AltaCV's `\cvevent` and `\cvtag` change the page and are dropped, as on the upstream sample,
  in three and two of its six documents, and `\printinfo`'s is kept; one Awesome-CV fork drops
  `cvhonors`'s.
- **The harness** runs every check on the XeTeX documents too, whose formats now dump: it finds
  `pages` on the 22 of two pages or more, `pdf` on four Awesome-CV forks whose small-capital entry
  titles are absent from the PDF's text, and `converges` on one; none of `fields` or `alignment`
  after the round that locks them, and no repeatable unit that stops. 18 documents have no finding.
- **Time**: the checks take 27 compiles at the median, 63 at most, and 9.8 s at the median, 16 s for
  an Awesome-CV fork compiled from its format, 38 s at most.

## Consequences

- **What items 12 to 15 take.** Item 12 stores the package, whose id is its content's hash, and
  runs `validate` on the editor's engine in the `import` job; the checks cannot stop a compile
  that never ends (below), which item 12's worker, terminated and started afresh, is the answer
  to. Item 13 reads `checks`: the outcome and the first difference of a partial one, the fields
  and words editable, raw, required and locked by reason, the sections mapped and locked, the
  controls dropped with why, the redefinitions dropped, the units that cannot be added or removed
  and the harness's findings; its rate is the reference's glyphs', which the words here, counted
  in the source, stand in for until then. Item 14 grows the controls from the ones proven here:
  margins where geometry is absent or uneven, the sizes a class accepts, and the answer's accent,
  font and density once item 9 answers the preamble; `checks.required` names the slots the
  editor refuses to empty, which the model and decision 0006 have no place for yet. Item 15 draws
  the locked sections and the extras with decision 0025's lock markers; `extras` lists each locked
  part with where it stands, its node, its key, why and how many words.
- **The model takes what the assembly makes.** Every package and document the assembly's tests
  make parse under the package's and the model's schemas, extras slots only where their nodes keep
  extras, and every locked section and extra kept LaTeX (decision 0025), as the store will parse
  them, and so do the 42 the corpus run assembled; `isKept`, which decides what a locked section
  can hold, is the model's `KeptLatex`.
- **The lock markers break nothing.** The checks compile the generator's bodies, whose locked
  sections decision 0025's markers stand around, and a marker made the glue after it a page's or
  a column's breakpoint where it was none: the AltaCV sample, with every field locked, broke its
  right column elsewhere and was partial for it; and a marker after a formula must keep the break
  there, whose loss moved two Awesome-CV forks' lines by a point. The markers now add and take
  away no breakpoint (decision 0025).
- **The T1 and Latin Modern rewrite is owed** (above): a pdfTeX document in Computer Modern, EC or
  TS1 is to take the ports' fonts, against a reference compiled with the same rewrite, in the
  item's review round, which lifts the font refusals below.
- **Fonts the page cannot draw refuse an import**, until the rewrite above. Keeping the upload's
  fonts costs the documents set in a font the tree has no outline for: Computer Modern's EC and TC
  fonts (decision 0009), above all LaTeX 2023's first-level itemize bullet, TS1's `tcrm1000`, which
  every OT1 document with a bulleted list sets (decision 0008).
- **The seed answers only the launch templates' own macros.** A fork that redefined a macro, as
  many of Jake's did, has no answer for it until item 9, and what its macros set is kept whole:
  in the corpus, most of what is locked is `unmapped` for want of an answer.
- **A header written without the template's macros stays locked.** Jake's Resume sets its header
  as a centred block of text, rules and links; the plan's reading of such a header by pattern, the
  block before the first section with the most text, contacts by their shape and `\href`s as links
  of their address's kind, is not built here, and the block is a locked section. Item 11 needs the
  same reading for the header values it masks, so it lands with item 11 or before it. Links set by
  a macro that takes any address take their kind from it (`kindOfAddress`).
- **The comparison of glyph streams** (decision 0019) takes xcolor's first black in the rgb and
  cmyk models as it took the gray one, `color push rgb 0 0 0` at a whole compile's first shipout
  that nothing pops, as the probe's fixes made it (decision 0022): a Jake fork whose colours are
  rgb was partial for that alone.
- **The loader's side of the prefix** (owed from milestone 2): a curated package may not take an id
  under `import-` (`IMPORTED_PREFIX`), which `templates/curated.ts` refuses as it loads
  (`checkCuratedId`), and the store's loader, item 12's, refuses an imported package outside it.
- **A compile can run forever.** The engine has no time limit, and one AltaCV fork's body at the
  font size control's 9 points never ends; a watchdog on `\pdfelapsedtime` in TeX's paragraph and
  box hooks does not catch it. The runner's 900 s limit reports it as timed out, and the browser's
  worker is terminated (item 12).
- **The checks cost compiles.** A document takes about two dozen and up to a hundred where the
  harness locks a field and the checks run again, each from the package's format, a XeTeX one's
  too; the rewrite's own check adds a whole compile, a dump and a compile from it, before the
  assembly starts.
- **What the harness reports that is no fault of the import's**: a document of two pages
  (`pages`), which a curated template's sample must not be and an upload may be, and a template
  that takes three passes to settle (`converges`), as AltaCV's does. Its `pdf` finding on
  Awesome-CV's small-capital titles, absent from the PDF's text, is for item 8 to look at: the
  ATS reads that text.
