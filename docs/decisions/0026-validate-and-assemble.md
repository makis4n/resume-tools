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
  by their keys, or by their names where no macro of the request has the key (decision 0028), as a
  fork that rewrote one of a list's two macros keeps the other's; one the cache holds but refuses
  for the macro, another kind's or naming a partner the request has no macro of by either, is no
  answer, and the macro stays as the probe left it. A command's closer is of its opener's kind,
  whatever kind its own answer gives it.

### The package

- **Its id** is `import-` and 12 hex digits of the SHA-256 of the rest of the package as JSON, so
  that two uploads of one template whose preambles agree share a package and its formats: the body's
  text never reaches a snippet (below), and the preamble keeps only what the answer does not name as
  the header's. **Its name** is the family's (`Jake's Resume`, `Awesome-CV`, `AltaCV`, `moderncv`,
  `europecv`) or the class's; **its source** `main.tex`, with no licence, whatever the upload's main
  file is called, since that name is the person's as often as the template's, and belongs to item
  12's record of the upload, not to the package (`MAIN_FILE`); **its files** the upload's classes,
  styles and their kin (`.cls .sty .clo .def .fd .cfg`) and the `.tex` files the preamble inputs, as
  text, and the configurations the reference compile gave pdfTeX's DVI (decision 0019).
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
  to 1 inch in tenths; `fontSize` over the class's size option, a format control (decision 0012),
  offering only the sizes from 9 to 12 points in half points the class declares, the document's own
  among them (`sizes`): the signatures step is asked of `\ds@8pt` to `\ds@14pt` in half points
  besides the body's names (`SIZE_OPTIONS`), and a size is declared where the engine finds its
  option's code defined, as `article`'s 10, 11 and 12 points are, where any other it ignores with a
  warning and sets 10 points, so that the slider and the page disagreed; a class that declares none,
  or not the document's size, or that size alone, which leaves nothing to choose, and a caller that
  did not ask, offer no control; the side panel's slider and the fit to one page offer the sizes
  declared alone (The editor, below); `dateFormat` where a date with a month is set from the model,
  since years alone read the same in every format. The answer's preamble parameters give `accent` (a
  colour `\definecolor` defines), `density` (`\linespread`) and, on pdfTeX, `font` (the document's
  own and three of the tree's families); the seed has none, so the corpus shows none yet. Each is
  kept only if the fourth check proves it.
- **Its snippets are the template's code, read from the body where the answer places the model.**
  A section's head, a list's opener and closer, an entry's call and its bullets' list, a list's
  items, a labelled item's call, the header's calls, and the document's code around the header and
  the sections, each copied from the source with its comments out (`templateText`) and a `{{` that
  would begin a tag broken. In a call, each argument whose answer gives it a slot of the place is
  a typeset slot, beside an extras slot that holds an instance's original bytes when the checks
  lock it (`{{title}}{{&x.title}}`); an address is `{{&href}}`; a date a date slot. Every unit of a
  list must read as the first does (`comparable`, TeX's reading of spaces and line ends), and every
  gap between two units alike, or the list is kept as the upload wrote it (below). A snippet may
  differ by section role (`ByRole`), as Jake's education entries swap their dates and place. A name
  in one argument is `{{first}}{{#last}} {{last}}{{/last}}`, the document's split at its last
  space, whether its answer maps it to the first name alone or, as the seed's AltaCV `\name` does,
  to the first name and the last a space apart (`parts`).
- **The body's text never reaches a snippet**, whatever the answer says (the item's review round).
  An argument the answer gives no slot is the template's own text only where every call gives it
  alike and it is code: its meaning a key, a length, an icon or a colour, as the header's calls
  judged it already; its call one the answer calls layout, showing no word of three letters or
  more; or holding no letter or digit at all, as a star, an empty group or an argument no call
  gives, the seed's `\cvhonor` #5 and #6 among them. Anything else each unit keeps in an extras
  slot of its own, `{{&x.a<n>}}`, with a locked part (`unmapped`) that counts its words, however
  many calls agree, so that an entry's note called once, which an answer gives no slot, is neither
  copied into the package and its id nor into every entry the user adds; a node that keeps no
  extras, a bullet's, an item's or a link's, cannot keep one, and its list is kept whole. A call the
  answer calls layout that shows a word, or the header's call with no field of the header's that
  does, is no code: a locked section where it stands, or the header's extra.
- **What a unit the user adds writes** where each unit of the upload keeps an argument in its
  extras: an argument with no slot, as a length each call gives its own, and a field's slot locked
  in every instance, which the entry's snippet sets through its extra alone. The package's
  `snippets.defaults` gives it, by the entry's or the section's role, always as a default and a
  variant for each role whose own differ, from the answer's blank rule (decision 0024): `kept`, the
  first call's bytes; `empty`, the argument's delimiters with nothing inside, or nothing inside the
  ones the snippet writes itself; `absent`, nothing. Where the answer says nothing, a code-like
  argument is kept, an optional one or a star is left out, and anything else is empty, so that no
  text of the person's, a date among them, reaches a new unit or the package: an entry of a class
  that cannot take an empty date is one the third check finds cannot be added. Every unit of the
  upload has the key, empty or not, so that its own writes itself. On the engine, an entry the
  editor adds to the reviewers' shape of a length each call gives its own, and to the shape of a
  class that reads its date's two ends apart whose answer says kept, compiles.
- **Every entry's snippet sets the bullets a user adds** (the item's review round). A role whose
  upload's entries set no bullets takes the list another role's entries of the same macro set
  theirs in, with that role's bullet and separator where it has none of its own; else the list the
  answer pairs, a bullets' opener and its closer or an environment, that take no argument; else it
  sets none, and the package says so, `snippets.entryBullets` false for the role (`ByRole`), which
  the editor reads to refuse a bullet there. Education before experience, as Jake's upstream
  sample has it, gave education's entries, and every role's that took the default, a snippet that
  set no bullet a user added.
- **Its required slots, and the units it cannot take.** The slots the second check finds stop the
  compile only when empty are the package's `required`, by the snippet that sets them and their
  slots there, `header`, `link`, `section`, `entry`, `bullet`, `item` and `labelledItem`, the same
  in every section, which the editor refuses to empty; and the kinds of unit the third check finds a
  new one of stops the compile are its `fixed`, in the order the editor names them (`UNIT_KINDS`:
  `entry`, `bullet`, `item`, `labelledItem`, `link` and `section.<kind>`), which the editor refuses
  to add (decision 0006's package gains both, additively; no curated package has either). Both are
  part of its id.
- **Everything kept is kept LaTeX.** Every extra, locked section and default the assembly copies
  from the upload, a list kept whole, the section's growing `after`, an argument's bytes, is held to
  the model's `KeptLatex`, a locked section's to `LockedLatex` (decision 0025): one past the cap, as
  a list of 74 KB kept whole, refuses the import as a part it cannot keep (`keep`), where the store
  would have refused the document at its end.

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
  bytes in its node's extras, under its slot's key, and its field is left out of the model, its node
  naming the slot kept (`kept`, decision 0025), so that it is no field: the editor opens nothing on
  it, and the generator writes the extra alone whatever the model holds there, where a date typed
  into a locked one set both; a bullet or an item keeps no extras, so its list is kept whole in its
  entry's or section's (`x.bullets`, `x.items`), as are the links in the header's (`h.links`), each
  named kept too; the gap before each section is its extras' `lead`, so that the sections'
  separator is nothing and every gap stays as TeX read it. A part of the body no snippet can
  express, a raw chunk or a call no answer places, is a locked section where it stands, written as
  `\rtlocked{<id>}{<latex>\n}` (decision 0025); a part `\rtlocked` cannot take as an argument,
  `\verb`, a catcode change, a verbatim environment, a `%` in an address the escape does not reach,
  is kept in the extras of the section before it (`after`), outside any argument, and one before any
  section refuses the import (`keep`).
- **What is kept is counted, and nothing else.** A part a snippet cannot hold is a locked part with
  its words wherever the assembly keeps it: a header call's argument with no header slot, as
  Awesome-CV's quote; a second value for a header slot another call filled; an entry's bullets that
  are not a clean list; a link after the header's run. A path that keeps a list whole takes its
  fields out of the checks' list, as the items', bullets' and entries' did and the header's and the
  preamble's link runs now do, so that no field is counted of a node the document does not hold, and
  it is locked for the reason the checks decided, or its first locked field's, else its `shape`; the
  oracle's comparison files a field of a node it cannot place under its id's own kind.
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
   preamble's end. Where it does not keep the page, **the redefinitions and the controls' defaults
   are proven as a set**: with none of them the page must be the original's; then each is tried
   alone, and those that keep it alone are tried together, since two can move the page together
   that each keep it alone; where together they move it, the shortest run of them that does, in
   their order, is found by halving and its last is dropped, as the probe's union does (decision
   0022), until the rest keep it. **Where the package with none of them does not keep the page
   either**, the page differs for another reason, and no compile can show that a redefinition
   keeps it: none is proven, every one is dropped, and the findings say so (`unproven`), since a
   reviewed answer's redefinition is applied only where it keeps upstream's output (decision
   0024). A XeTeX import's body, its fonts declared by file,
   compares with the original, whose fonts were found by name, as item 8's check compares them, a
   native font by its file and a colour special wherever it stands, since it sets nothing on the
   page (decision 0023). Then the body the generator makes of the document must set
   exactly what the original body sets, the markers aside; where it does not, the fields whose
   regeneration moves it are bisected out and locked (`differs`), their bytes in their node's
   extras. A difference that the document with every field locked shows too leaves the import
   `partial`, with its first difference, for item 13 to show; the rest of the checks still run.
   **A document that does not compile even with every field locked** tells them nothing: the
   checks stop there, every control offered is dropped as `unchecked`, since no compile tried it,
   and the findings say the checks stopped (`stopped`), so that nothing reads as proven that no
   compile showed.
2. **Mutations.** Every field the editor edits, typeset or raw, set to a 300-character text, then
   empty, then characters TeX reads (`\ { } $ & # ^ _ % ~ < > | [ ] * -- ' " é ß ø ω Ж ğ`), three
   compiles, each failing one bisected to the slot. A raw field, a contact or a link's label whose
   address the class builds from its text, takes what the panel sends as a typeset one does, and
   is mutated as one. A slot that stops on text is locked in every instance (`text`); one that
   stops only when empty is **required**: the package keeps it editable and lists it, the editor's
   commands refuse to empty it and the side panel marks it (below), as Awesome-CV's blank name
   stops the compile (decision 0015). A slot a bisection's budget leaves untried is **untested**:
   no compile showed it fail, so it is neither locked nor required, and the findings name it and
   the budget (`untested`).
3. **Repeatable units.** Of each kind of unit the editor adds, one added as the side panel adds it,
   through the editor's own commands under the package (`applyUnder`), with its placeholders and
   nothing else, no dates and no extras, and the first removed, each compiled: an entry in the first
   section of entries, a bullet in the first entry whose snippet shows bullets, an item of each kind
   of list, a link where the header has one, and a section of each kind, empty, at the end, with the
   role of the first of its kind; never in a list its node keeps whole, which takes no unit (The
   editor, below). A kind whose new unit stops the compile, as a class that takes no more entries
   than it has, is a limit of the template, not a field to lock: the package marks it (`fixed`), the
   editor's commands refuse it and the side panel disables its button (below), and `repeatable`
   reports it for item 13, as a later round does without trying it again.
4. **Controls.** Each control's every value but the document's compiled, the font size at the
   sizes its package offers: one that stops the compile at any value, or sets the same page at
   every one, is dropped.

Then **the harness** (`validatePackage`) runs on the package and the document, held to the
upload's own compile rather than to a curated sample's one page and two passes: to the pages the
reference set and the passes it took (`Expected`), so that an upload of two pages, or one that
takes three passes to settle, as AltaCV's `paracol` does, and then as many again, is no finding;
more pages or more passes than the upload's are. A `fields` or `alignment` finding on a field
locks it, or its list, once, and the checks run again, taking what the first round decided as
settled: the controls it dropped, with why, and the redefinitions it could not prove are reported
with the second round's. Every other finding is recorded for item 13. The bodies it compiles are
the generator's, as the checks' are, locked sections and extras among them.

What the validation returns reads back as the store and the loader will read it: the document
under the model's schema, its kept LaTeX within its cap and free of the editor's markers, and the
package under the package's; an import either refuses is refused (`keep`), as a list kept whole
past kept LaTeX's cap is.

The result is the package, the document, the locked parts with where each stands, why and how many
words, and the checks: the fields editable, raw, required and locked by reason, the words in each,
the sections mapped and locked, the controls offered, proven and dropped, with why, the
redefinitions applied and dropped, the repeatable units and the kinds the editor cannot add, the
harness's findings and the checks' own (`stopped`, `untested`, `unproven`), and the compiles and
time.

### The editor

- **An imported package's rules hold in the editor.** `applyUnder(pkg, document, command)`, which
  `History` applies with the document's package, refuses an edit that would leave a field the
  package requires blank, as the generator reads blank, where it was not: the field keeps its value,
  and the error says why. It refuses a unit of a kind the package cannot take (`fixed`), and a
  bullet for an entry whose role's snippet has no bullets slot, or whose role the package says sets
  none (`snippets.entryBullets`), since such a bullet would be in the document and never on the
  page. The side panel, given the package, marks a required field, whether it gives it an input or
  not, with a title that says why, and disables a button that would add what the template cannot
  take, saying why when pointed at, and offers a new section only of a kind it can take. A curated
  package carries none of these rules and takes every edit, as before; `apply` is `applyUnder` with
  the document's curated package.
- **A slot a node keeps is no field.** Where the assembly keeps an instance as the upload had it
  (`kept`, on the header, a section or an entry), `fieldsOf` leaves its field out: the page has no
  marker for it, the panel gives it no input, and no command reaches it; `setHeader` refuses a
  header slot kept so. A list the node keeps whole, `bullets`, `entries`, `items` or `links`, is
  set from its extras alone: none of its units is a field, and the commands refuse to add one and
  the panel disables the button, since a unit added would be in the document and never on the page.
- **The sizes a class declares.** The side panel's font size slider offers the package's sizes
  alone (`fontSizes`), stepping by the longest step that reaches each, a point for `article`'s 10,
  11 and 12, and reading what the browser gives as the nearest of them; and the fit to one page
  steps down through them. A curated package offers every half point from 9 to 12, as before.
- **The app opens a document with its package**, which its history, side panel, controls, retry
  and fit follow, a curated one's until item 12's store gives an import's; an edit the package
  refuses leaves the document as it was, and the panel's input shows its value again.

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
  of the nine entries' titles, which the class sets in small capitals, in the PDF's text only in
  capitals (`pdf`, Consequences), and the sample is three pages (`pages`). Entries, bullets and
  links add and remove.

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
  titles the PDF's text shows only in capitals, and `converges` on one; none of `fields` or
  `alignment` after the round that locks them, and no repeatable unit that stops. 18 documents
  have no finding.
- **Time**: the checks take 27 compiles at the median, 63 at most, and 9.8 s at the median, 16 s for
  an Awesome-CV fork compiled from its format, 38 s at most.

## Consequences

- **What items 12 to 15 take.** Item 12 stores the package, whose id is its content's hash, and runs
  `validate` on the editor's engine in the `import` job; the checks cannot stop a compile that never
  ends (below), which item 12's worker, terminated and started afresh, is the answer to. Item 13
  reads `checks`: the outcome and the first difference of a partial one, the fields and words
  editable, raw, required and locked by reason, the sections mapped and locked, the controls dropped
  with why, the redefinitions dropped, the units that cannot be added or removed and the harness's
  findings; its rate is the reference's glyphs', which the words here, counted in the source, stand
  in for until then. Item 14 grows the controls from the ones proven here: margins where geometry is
  absent or uneven, and the answer's accent, font and density once item 9 answers the preamble; the
  sizes a class declares it offers already. `checks.required` names the slots the package marks
  required (`required`), which the editor refuses to empty. Item 12 opens an imported document with
  its package from the store, as the app opens a curated one with its own (The editor, above), so
  that its rules hold: the slots it requires, the kinds of unit it cannot take, the lists it keeps
  whole and its entries' bullets; and its pipeline asks the signatures step of `SIZE_OPTIONS`
  besides the body's names, as `corpus assemble` does, or its imports offer no font size. Item 15
  draws the locked sections and the extras with decision 0025's lock markers; `extras` lists each
  locked part with where it stands, its node, its key, why and how many words.
- **The model takes what the assembly makes.** Every package and document the assembly's tests
  make parse under the package's and the model's schemas, extras slots only where their nodes keep
  extras, and every locked section and extra kept LaTeX (decision 0025), as the store will parse
  them, and so do the 42 the corpus run assembled; `isKept`, which decides what a locked section
  can hold, is the model's `KeptLatex`, and a locked section's LaTeX is `LockedLatex` besides. The
  assembly refuses what the model would refuse (`keep`) rather than hand the store a document it
  cannot read.
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
- **The harness holds an import to its upload.** A document of two pages, which a curated
  template's sample must not be and an upload may be, and a template that takes three passes to
  settle, as AltaCV's does, are no longer findings (`Expected`, The checks); more pages or passes
  than the upload's own compile are.
- **The PDF's text shows an import's small capitals as capitals, a limit the ATS would feel.** An
  import sets small capitals as its upload does, from the font loaded with `+smcp` (item 8's
  per-shape features, decision 0023), which the first check holds it to glyph for glyph. The page
  reads each small capital as the letter typed; xdvipdfmx's ToUnicode map reads the glyphs the
  feature substitutes as the capitals, so that the PDF's text holds such a title in capitals,
  `HARBOR` for `Harbor`, as the upload's own PDF from the same driver does. The curated Awesome-CV
  port passes the same check because its small-capital shape is the upright face (decision 0015),
  which the PDF reads as typed; an import cannot take that face without leaving its reference. An
  ATS that matches words in their case reads those titles otherwise: the Awesome-CV sample's seven
  entry titles and four Awesome-CV forks in the corpus. The harness reports each such field
  (`pdf`), saying it is in the text only in capitals; a ToUnicode map of the small capitals' own,
  from the letters the feature substitutes them for, is the ATS's reader's to take up, or the
  PDF driver's, not this milestone's (the milestone's owed table).
