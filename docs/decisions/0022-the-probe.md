# 0022. The probe

Date: 2026-09-27 · Status: proposed

## Context

Milestone 3 item 5 is plan section 6 step 3: for a resume the intake took in (decision 0019) and
the parser read into a tree (decision 0020), which of its parts the editor may mark as fields.
Decision 0006 made every typeset slot of a package marked and left the probe to check that the
markers survive; decision 0007 gave the marker macro, `\rtfield`, and the prelude it lives in. What
the probe finds per macro and argument is what item 6 describes to the naming step and item 7
assembles a package from. The code is `apps/editor/src/import/candidates.ts` and `probe.ts`,
browser-safe; `corpus probe` runs it over the corpus and `corpus oracle` over the three launch
templates' upstream samples, whose expected verdicts are `apps/editor/corpus/oracle.json`. The
aligner's case folding, the other half of item 5, is its own pull request; until it lands, a field
whose glyphs differ from its text in case alone is recorded `case`.

## Decision

### The candidates

- A candidate is a part of the body a package could mark: every argument of every call to a
  template macro and of every template environment, and every standard node an assembled package
  marks anyway, a section's title, a list item's text and its label, and a paragraph of rich
  text. Its text is its runs joined, a date as the document spells it, paragraphs apart by a
  space. Its id, which the markers carry, is lowercase letters, digits and dashes, from its place
  among its kind in the source and its argument's place in the signature, from 1, as TeX numbers
  parameters: `c12-3` is the twelfth call's third argument, `e2-1` an environment's, `s4` a
  section's title, `i7` and `i7-l` an item's text and label, `t9` a paragraph. The same tree gives
  the same ids.
- One that holds a raw chunk anywhere is not probed and is locked, `raw`; the paragraphs inside it
  are candidates of their own, as the title and the subtitle either side of a projects heading's
  `$|$` are, which is what Jake's port marks. One that holds structure, a call that is given
  arguments, an environment, a list, an item or a section, is a `container`, neither editable nor
  locked, as an entry's argument holding its bullets is; its parts are candidates of their own. A
  call that takes nothing, as an icon, may sit in a field, whose glyphs must then account for it.
  An empty argument is probed like any other.
- A preamble that sets its header through calls that store their arguments, as Awesome-CV's and
  moderncv's `\name{...}{...}`, `\position{...}` and `\email{...}` do, keeps the header out of the
  body, where the tree is. So a call at the preamble's top level to a template macro that stores
  each of its arguments with `\def` or `\gdef` before anything else, and names no parameter after,
  is a candidate's too (`isSetter`), its id `h` and the call's place among the preamble's:
  Awesome-CV's `\mobile`, which then makes the `tel:` address from the number it stored, is one.
  The engine is asked about the preamble's commands with the body's (`probeUses`), or by the probe
  itself when the caller did not.

### How an import is marked

- A candidate's span is wrapped in `\rtfield{<id>}{...}`, the prelude's macro unchanged: an
  argument's content from its first node to its last, so the spaces around it stay where TeX read
  them; inside a group that is all of it and past the group's first space, which TeX passes over in
  vertical mode and would set once the marker's `\leavevmode` had started a paragraph (a Jake
  fork's skills item moved so); an argument given as one token in braces with its markers; and
  where the span ends in a control word, the spaces TeX skipped after it inside. Spans never nest.
- The preamble's storing calls are issued again after the prelude, every one in order, with the
  arguments in the set in their markers, so that the macros they store hold the marked text; a
  call's second issue stores what its first did.
- The prelude is appended to the document's preamble as `generateFormat` appends it after a
  package's, with `@` given back the category it had where the preamble ended, since a preamble
  may end with `\makeatletter` in force and the prelude ends with `\makeatother`.

### The compiles

- On pdfTeX the preamble with the prelude is dumped once, in the `import` job's session, as
  `import-` and an FNV-1a hash of what is dumped and the job's files, and every probe compile is
  a body compile from it. The session's `dump` now takes files at paths in its folder, as a
  compile does, since a preamble may input a file of a folder of its own, and a preamble as bytes,
  in the encoding its file had.
- On XeTeX, whose preamble loads fontspec and cannot be dumped (decision 0003), every probe compile
  is a whole compile from the stock format, as the reference was, fontconfig given the tree's fonts
  for it: the one compile besides the reference that scans them (decision 0019), until item 8
  rewrites XeTeX's fonts. `Path` hides the two, and the result says which a document took.
- The unmarked body compiles first, the baseline, which must set the reference's glyph stream. A
  pdfTeX preamble that does not dump, or whose format's baseline does not set the reference's
  glyphs, takes whole compiles instead (`fallback`), and a document whose whole baseline does not
  either is not probed (`baseline`). Every probe compile starts from the auxiliary files the
  baseline wrote, so none reads what another's markers wrote; it takes two passes at most, and one
  that stops, or whose log still asks for a pass after them, is a failure of the whole set.

### The checks and the reasons

After a compile, the output is read as the harness reads one: parsed with the fonts' widths, its
glyphs named as the page names them, its fields collected case-insensitively (`collectFields`),
and its glyph stream compared with the reference's, the markers set aside (`difference`). A
candidate is `editable` when the compile succeeded; its begin and end markers came once, in order,
on one page; its glyphs spell its text (`alignField`), accounting for all of it that sets a glyph;
and the output sets the reference's glyph stream. Otherwise, in this order:

| Reason | What the probe saw |
|---|---|
| `raw` | The candidate holds a raw chunk; not probed |
| `breaks` | The compile stopped, or its log still asked for a pass, with the candidate alone |
| `vanished` | Its markers never reached the page: a length, a colour, a key, an address (detail `special` when its text reached another special alone) |
| `twice` | Its begin marker came twice (`page`), as a running head or a footer sets it, or once and its marker's text reached another special too (`special`), as a link's address built from the argument the macro also sets |
| `split` | It began on one page and ended on another, or never ended (`no end`), or ended before it began |
| `misaligned` | Its glyphs do not spell its text: a macro transforms it, sets text of its own inside it, or took its markers apart (`torn`: markers of ids no candidate has came instead) |
| `case` | Its glyphs spell its text in another case alone, as `\MakeUppercase` sets it; the aligner's folding makes it editable |
| `moved` | Its markers and glyphs passed, but the output's glyphs moved (the first difference's kind as detail), or it is set inside a transform the PDF applies and the page does not (`transform`, the harness's special check) |
| `untested` | The budget ran out before it was settled |

A link's address never runs the markers inside it: hyperref writes the argument into its special's
text, markers and all, so the probe reads a marker's id in another special's text as the second
copy milestone 3's plan expected of an argument used twice.

### Bisection and the budget

All the candidates are wrapped at once, first, in an order that keeps a kind together, a macro's
argument, empty or not, each kind in the source's order. What a candidate's own markers and glyphs
show is its own, whatever else the set holds, since the markers name it: twice, split, misaligned,
case, a transform, and a marker that never came when the output set the reference's glyphs. Only a
failure of the set as a whole needs splitting: a compile that stopped, or an output that moved when
no candidate's markers say why. Such a set is split until one candidate fails alone, the ones the
compile names tried first (`suspects`: the ids TeX's error context shows it reading, or the field
whose begin marker comes last before where the output first parts from the reference's), each
alone and then the rest without them; otherwise in two, at the edge between kinds nearest the
middle when there is one near it. When the output moved and some candidates failed on their own,
those that passed are tried again without them, and so are those whose markers never came, whose
loss the move may have caused. A candidate whose markers never came beside markers torn from ids
the set does not hold is tried alone, where the torn ones are its own (`misaligned`, `torn`). Once
a kind has a candidate that stopped a compile or moved the page alone, the others of it are tried
among themselves: a set of them that stops takes `breaks` whole (`like`), since an argument that
stops TeX, a length or a key, does whatever it holds; one that moves the page is split still,
since what moves it, a letter a margin kerns at a line's start, may be in one call and not another.
A document has 64 compiles, the baseline and the dump aside; what is left then is `untested`.

### What items 6 and 7 read

- The verdicts are gathered per macro and argument, per environment and argument, and per kind of
  standard node (`aggregate`): editable when every call probed was, the empty ones aside; else the
  verdict of the first that failed, in the source's order, with each verdict's count; `untested`
  when the budget left one. An empty call's failure is kept apart (`empty`), since the generator
  writes an absent value bare (decision 0007), so that a macro that tests its argument for being
  empty, as AltaCV's `\cvevent` and moderncv's `\cventry` do, keeps the slot; the milestone's rule
  that a field that breaks only when empty is required, not locked, reads the same. An argument
  none of whose calls was probed is a `container`, or `raw` with how many of its parts are
  editable.
- The reference's glyphs that no editable field covers are uncovered runs, each with its page and
  its first and last glyph's place, set down to what sets it: a locked candidate whose glyphs a
  compile that set the reference's showed there; otherwise, by the order of the page and the source,
  the first locked candidate that sets text between the fields either side of the run, or the first
  raw chunk that may; or, with neither, the template's own text, as a bullet, an icon or a label.
  Where the page's order and the source's part, as paracol sets its columns one after the other, a
  run may be set down to a node near the one that sets it.

### The runner and the oracle

- `corpus probe [--only <id>] [--json <file>]` runs the whole pipeline in the pool of decision 0019,
  600 s a document, and prints the table below: names of macros and counts, never text. Each
  document's whole probe, which holds its candidates' texts, goes under `.corpus/probe/` alone.
- `corpus oracle` fetches the samples `corpus/oracle.json` names into `.corpus/oracle/`, as `corpus
  fetch` fetches a document, with the same checks of sizes and hashes; exits 1, saying so, when
  GitHub cannot be reached; probes each; and prints the expected verdicts against the found ones,
  a line for each argument, with a line for each argument the probe found that the oracle does not
  list, and the number of disagreements. The oracle pins jakegut/resume at 3e64a93, AltaCV at
  9137353 (altacv.cls v1.7.4, the port's), and Awesome-CV at 964f99d, its last revision for Font
  Awesome 5 (the port's); expected verdicts name macros and arguments only. An expected verdict is
  what the probe should find with the upstream class as it is, worked out from the port's snippets
  and decisions 0008, 0013 and 0015: editable where the port marks the slot, and where the port
  patched the class the verdict the unpatched class gives, with the item that lifts it; for what
  the port leaves out of the model, the verdict its mechanics give, a length breaking and plain
  text editable (item 7 keeps it as an extra).

## The oracle

`corpus oracle` on 27 September 2026, the tree of layout 6, the M4 Pro: Jake's sample took 10
compiles from its format, AltaCV's 60, and Awesome-CV's 27 whole ones, 39 s. Three runs gave the
same verdicts.

| Template | Argument | Port | Expected | Found | |
|---|---|---|---|---|---|
| jake | `\resumeSubheading #1` | marks | editable | editable (5 of 5) | agrees |
| jake | `\resumeSubheading #2` | marks | editable | editable (5 of 5) | agrees |
| jake | `\resumeSubheading #3` | marks | editable | editable (5 of 5) | agrees |
| jake | `\resumeSubheading #4` | marks | editable | moved (5 of 5) | **disagrees** |
| jake | `\resumeItem #1` | marks | editable | editable (20 of 20) | agrees |
| jake | `\resumeProjectHeading #1` | marks | raw | raw (2 of 2); parts 4 of 4 editable | agrees |
| jake | `\resumeProjectHeading #2` | marks | editable | editable (2 of 2) | agrees |
| jake | `section (standard)` | marks | editable | editable (4 of 4 editable) | agrees |
| jake | `item (standard)` | marks | editable | editable (1 of 1 editable) | agrees |
| jake | `paragraph (standard)` | marks | editable | editable (5 of 5 editable) | agrees |
| altacv | `\name #1` | marks | case | case (1 of 1) | agrees |
| altacv | `\tagline #1` | marks | editable | editable (1 of 1) | agrees |
| altacv | `\photoR #1` | omits | breaks | breaks (1 of 1) | agrees |
| altacv | `\photoR #2` | omits | breaks | breaks (1 of 1) | agrees |
| altacv | `\personalinfo #1` | marks | container | container (1 of 1); parts 0 of 2 editable | agrees |
| altacv | `\email #1` | marks | twice | twice (1 of 1) | agrees |
| altacv | `\phone #1` | marks | twice | twice (1 of 1) | agrees |
| altacv | `\mailaddress #1` | marks | editable | editable (1 of 1) | agrees |
| altacv | `\location #1` | marks | editable | editable (1 of 1) | agrees |
| altacv | `\homepage #1` | marks | twice | twice (1 of 1) | agrees |
| altacv | `\xtwitter #1` | marks | twice | twice (1 of 1) | agrees |
| altacv | `\linkedin #1` | marks | twice | twice (1 of 1) | agrees |
| altacv | `\github #1` | marks | twice | twice (1 of 1) | agrees |
| altacv | `\orcid #1` | marks | twice | twice (1 of 1) | agrees |
| altacv | `\NewInfoField #2` | omits | locked | breaks (2 of 2) | agrees |
| altacv | `\NewInfoField #3` | omits | locked | misaligned (2 of 2) | agrees |
| altacv | `\NewInfoField #4` | omits | locked | vanished (1 of 1) | agrees |
| altacv | `\columnratio #1` | omits | breaks | breaks (1 of 1) | agrees |
| altacv | `\cvsection #2` | marks | case | case (10 of 10) | agrees |
| altacv | `\cvevent #1` | marks | editable | editable (4 of 7; 3 raw); parts 6 of 6 editable | agrees |
| altacv | `\cvevent #2` | marks | editable | editable (7 of 7) | agrees |
| altacv | `\cvevent #3` | marks | editable | editable (6 of 7; 1 moved); empty: moved | agrees |
| altacv | `\cvevent #4` | marks | editable | editable (2 of 7; 5 moved); empty: moved | agrees |
| altacv | `\wheelchart #2` | omits | breaks | breaks (1 of 1) | agrees |
| altacv | `\wheelchart #3` | omits | breaks | breaks (1 of 1) | agrees |
| altacv | `\wheelchart #4` | omits | breaks | breaks (1 of 1) | agrees |
| altacv | `\mynames #1` | omits | vanished | vanished (1 of 1) | agrees |
| altacv | `\cvachievement #1` | omits | locked | twice (3 of 3) | agrees |
| altacv | `\cvachievement #2` | omits | editable | editable (3 of 3) | agrees |
| altacv | `\cvachievement #3` | omits | editable | editable (3 of 3) | agrees |
| altacv | `\cvtag #1` | marks | moved | moved (6 of 6) | agrees |
| altacv | `\cvskill #1` | omits | editable | editable (3 of 3) | agrees |
| altacv | `\cvskill #2` | omits | locked | breaks (3 of 3) | agrees |
| altacv | `\cvref #1` | omits | raw | raw (2 of 2); parts 4 of 4 editable | agrees |
| altacv | `\cvref #2` | omits | editable | editable (2 of 2) | agrees |
| altacv | `\cvref #3` | omits | editable | editable (2 of 2) | agrees |
| altacv | `item (standard)` | marks | editable | editable (5 of 5 editable) | agrees |
| altacv | `paragraph (standard)` | marks | editable | breaks (5 of 7 editable) | **disagrees** |
| awesome-cv | `\name #1` | marks | editable | editable (1 of 1) | agrees |
| awesome-cv | `\name #2` | marks | editable | editable (1 of 1) | agrees |
| awesome-cv | `\position #1` | marks | misaligned | raw (1 of 1); parts 0 of 2 editable | **disagrees** |
| awesome-cv | `\address #1` | marks | editable | misaligned (1 of 1) | **disagrees** |
| awesome-cv | `\mobile #1` | marks | twice or vanished | twice (1 of 1) | agrees |
| awesome-cv | `\email #1` | marks | twice or vanished | twice (1 of 1) | agrees |
| awesome-cv | `\homepage #1` | marks | twice or vanished | twice (1 of 1) | agrees |
| awesome-cv | `\github #1` | marks | twice or vanished | twice (1 of 1) | agrees |
| awesome-cv | `\linkedin #1` | marks | twice or vanished | twice (1 of 1) | agrees |
| awesome-cv | `\quote #1` | omits | editable | editable (1 of 1) | agrees |
| awesome-cv | `\makecvheader #1` | omits | vanished | vanished (1 of 1) | agrees |
| awesome-cv | `\makecvfooter #1` | omits | raw | raw (1 of 1) | agrees |
| awesome-cv | `\makecvfooter #2` | omits | twice | twice (1 of 1) | agrees |
| awesome-cv | `\makecvfooter #3` | omits | raw | raw (1 of 1) | agrees |
| awesome-cv | `\cvsection #1` | marks | breaks | misaligned (5 of 5) | **disagrees** |
| awesome-cv | `\cventry #1` | marks | misaligned | misaligned (9 of 9) | agrees |
| awesome-cv | `\cventry #2` | marks | editable | editable (9 of 9) | agrees |
| awesome-cv | `\cventry #3` | marks | editable | editable (9 of 9) | agrees |
| awesome-cv | `\cventry #4` | marks | editable | editable (9 of 9) | agrees |
| awesome-cv | `\cventry #5` | marks | container | container (7 of 9; 2 moved); empty: moved | agrees |
| awesome-cv | `\cvsubsection #1` | omits | misaligned | misaligned (3 of 3) | agrees |
| awesome-cv | `\cvhonor #1` | marks | editable | absent | **disagrees** |
| awesome-cv | `\cvhonor #2` | marks | editable | absent | **disagrees** |
| awesome-cv | `\cvhonor #3` | marks | editable | absent | **disagrees** |
| awesome-cv | `\cvhonor #4` | marks | editable | absent | **disagrees** |
| awesome-cv | `item (standard)` | marks | editable | editable (29 of 29 editable) | agrees |
| awesome-cv | `paragraph (standard)` | marks | editable | editable (2 of 2 editable) | agrees |

Disagreements: 9 of 75.

What each disagreement means:

- **`\resumeSubheading #4`, moved: a finding, the marker's.** The argument is set in `\textit` in
  the table's right column, and `\rtfield`'s end marker, a whatsit, comes after the field's last
  glyph, where LaTeX's italic correction looks for a character (`\check@icr`, TeX's `\/`), so the
  correction is lost and the right-aligned text moves right by it, 1.36 pt here. The port marks
  the slot, and the editor shows it one correction off the original's page; the probe, which holds
  a slot to the original's page, locks it. `\textbf` corrects too, before anything but a period or
  a comma: `\textbf{elf}:` sets its colon 1.09 pt further right than with a marker after the `f`.
  An italic correction before the end marker in a slanted font, `\ifdim\fontdimen1\font>\z@\/\fi`,
  restores this sample's page (checked); but LaTeX leaves the correction out before a period or a
  comma, which the marker cannot see past its own group, and an upright letter with a correction,
  as `f` has, needs it too, so the change to decision 0007's prelude is its own item, measured on
  the corpus.
- **Paragraphs, breaks: not the probe's.** The engine reads paracol's environment as taking an
  optional argument alone, so `\begin{paracol}{2}` leaves `{2}` a paragraph, which the probe wraps
  and paracol cannot count; the sample's own paragraphs are editable, 5 of 7. A signature fault of
  the kind decision 0020 found in paracol's `\columnratio`.
- **`\position #1`, raw: the expectation missed a fact.** The example's position holds
  `{\enskip\cdotp\enskip}` between two positions, a raw chunk, so the argument is raw; its two parts
  are misaligned, as expected, since the class sets them in small capitals.
- **`\address #1`, misaligned: a finding, item 8's.** The header sets the address in Roboto, whose
  proportional figures, `+pnum` (decision 0015's second gap), put glyphs with no text the page can
  read in place of 7 of its 8 digits. Item 8's reading of a substitution's text makes it editable.
- **`\cvsection #1`, misaligned rather than breaks: a finding.** Upstream's `\@sectioncolor` takes
  the marker macro, the first characters of its id and the next as its three tokens, as decision
  0015 foresaw, and does not stop: markers of an id no candidate has come in place of the title's
  (`torn`). Locked either way until item 6's redefinition.
- **`\cvhonor #1` to `#4`, absent: not the probe's.** The parser keeps cvhonors' body raw as a
  table's cells (decision 0020), so the awards' calls are no calls; item 4's fix on `waikin/parse`
  places them, and the oracle compares them once it merges.

Of the port's other slots, the probe finds editable Jake's entries and bullets, AltaCV's events,
headline, location and mail address, and Awesome-CV's name, entries' organisation, place and
dates, and bullets; and locked as the ports' decisions say, AltaCV's name and section titles in
capitals (`case`), its contacts, whose links repeat their text (`twice`), and its tags, which a
PDF-only transform places (`moved`, `transform`), and Awesome-CV's positions in small capitals and
its contacts. What the ports leave out comes out locked where the class takes it as a length, a
key or an address, and editable where it is plain text.

## The corpus

`corpus probe` on 27 September 2026, the tree of layout 6, the M4 Pro, four children: 7.4 minutes.

|  | jake | awesome-cv | altacv | moderncv | europecv | other | all |
|---|--:|--:|--:|--:|--:|--:|--:|
| Documents whose body parsed | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Probed | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Not probed: the body unmarked did not set the reference's glyphs | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Timed out or died | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Path: from the document's format | 33 | 0 | 5 | 14 | 5 | 22 | 79 |
| Path: whole compiles, XeTeX | 0 | 18 | 1 | 0 | 0 | 7 | 26 |
| Path: whole compiles, the preamble did not dump | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Path: whole compiles, the format did not set the reference's glyphs | 2 | 0 | 4 | 0 | 1 | 5 | 12 |
| Compiles per document, median | 11 | 24 | 45 | 37 | 1 | 13 | 16 |
| Compiles per document, most | 43 | 64 | 64 | 64 | 13 | 64 | 64 |
| The budget ran out | 0 | 1 | 0 | 3 | 0 | 3 | 7 |
| **Candidates** |  |  |  |  |  |  |  |
| In all | 2681 | 1663 | 1777 | 1380 | 56 | 4080 | 11637 |
| Editable | 2219 | 1041 | 685 | 822 | 24 | 2063 | 6854 |
| `container` | 15 | 146 | 12 | 30 | 5 | 174 | 382 |
| `raw` | 153 | 47 | 60 | 57 | 8 | 304 | 629 |
| `breaks` | 11 | 43 | 114 | 2 | 4 | 317 | 491 |
| `vanished` | 20 | 19 | 481 | 23 | 5 | 34 | 582 |
| `twice` | 0 | 86 | 54 | 19 | 10 | 47 | 216 |
| `moved` | 160 | 45 | 237 | 123 | 0 | 160 | 725 |
| `misaligned` | 97 | 231 | 63 | 1 | 0 | 464 | 856 |
| `case` | 6 | 0 | 71 | 0 | 0 | 50 | 127 |
| `split` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| `untested` | 0 | 5 | 0 | 303 | 0 | 465 | 773 |
| **Macros' and environments' arguments, per document** |  |  |  |  |  |  |  |
| In all | 277 | 337 | 196 | 175 | 43 | 218 | 1246 |
| Editable | 195 | 124 | 73 | 110 | 22 | 124 | 648 |
| `container` | 0 | 25 | 10 | 6 | 5 | 9 | 55 |
| `raw` | 17 | 32 | 4 | 4 | 6 | 7 | 70 |
| `breaks` | 0 | 2 | 20 | 0 | 1 | 9 | 32 |
| `vanished` | 1 | 10 | 10 | 3 | 3 | 6 | 33 |
| `twice` | 0 | 86 | 41 | 19 | 6 | 13 | 165 |
| `moved` | 45 | 6 | 12 | 5 | 0 | 20 | 88 |
| `misaligned` | 19 | 49 | 11 | 1 | 0 | 20 | 100 |
| `case` | 0 | 0 | 15 | 0 | 0 | 5 | 20 |
| `split` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `untested` | 0 | 3 | 0 | 27 | 0 | 5 | 35 |
| Editable, but not when empty | 1 | 9 | 10 | 9 | 0 | 4 | 33 |
| Macros and environments every argument of which is editable | 36 of 106 | 42 of 195 | 36 of 142 | 43 of 85 | 20 of 39 | 35 of 104 | 212 of 671 |
| **Standard nodes, editable** |  |  |  |  |  |  |  |
| Section titles | 153 of 169 | 0 | 0 | 69 of 77 | 0 | 153 of 302 | 375 of 548 |
| List items' text | 127 of 155 | 476 of 489 | 214 of 333 | 68 of 96 | 0 | 419 of 923 | 1304 of 1996 |
| List items' labels | 0 | 0 | 0 | 0 | 0 | 72 of 77 | 72 of 77 |
| Paragraphs | 258 of 270 | 30 of 45 | 70 of 130 | 20 of 21 | 0 of 3 | 580 of 1156 | 958 of 1625 |
| **The reference's glyphs** |  |  |  |  |  |  |  |
| In all | 138202 | 78881 | 41818 | 43796 | 20643 | 215767 | 539107 |
| Covered by editable fields | 91% | 81% | 88% | 65% | 3% | 50% | 68% |
| Set by a locked candidate | 7% | 13% | 11% | 32% | 10% | 31% | 20% |
| Set by a raw chunk | 1% | 1% | 0% | 2% | 87% | 17% | 11% |
| Set by the template alone | 1% | 6% | 1% | 2% | 0% | 1% | 2% |
| **Time** |  |  |  |  |  |  |  |
| The dump, median | 280 ms |  | 487 ms | 352 ms | 301 ms | 272 ms | 282 ms |
| The dump, slowest | 370 ms |  | 688 ms | 387 ms | 401 ms | 475 ms | 688 ms |
| The probe, median | 1292 ms | 34626 ms | 18743 ms | 8571 ms | 657 ms | 2525 ms | 2781 ms |
| The probe, slowest | 4440 ms | 140848 ms | 71116 ms | 13867 ms | 1962 ms | 32724 ms | 140848 ms |
| **Locked arguments, by the argument and its verdict: documents** |  |  |  |  |  |  |  |
| `\email #1: twice` | 0 | 18 | 9 | 11 | 0 | 2 | 40 |
| `\resumeSubheading #4: moved` | 27 | 0 | 0 | 0 | 0 | 0 | 27 |
| `\linkedin #1: twice` | 0 | 16 | 9 | 0 | 0 | 1 | 26 |
| `\github #1: twice` | 0 | 16 | 7 | 0 | 0 | 1 | 24 |
| `\homepage #1: twice` | 0 | 8 | 5 | 5 | 0 | 1 | 19 |
| `\cvsection #1: misaligned` | 0 | 16 | 0 | 0 | 0 | 1 | 17 |
| `\cventry #1: misaligned` | 0 | 15 | 0 | 0 | 0 | 1 | 16 |
| `\makecvfooter #3: raw` | 0 | 12 | 0 | 0 | 0 | 1 | 13 |
| `\resumeProjectHeading #1: raw` | 13 | 0 | 0 | 0 | 0 | 0 | 13 |
| `\mobile #1: twice` | 0 | 12 | 0 | 0 | 0 | 0 | 12 |
| `\makecvfooter #1: raw` | 0 | 10 | 0 | 0 | 0 | 0 | 10 |
| `\makecvfooter #2: twice` | 0 | 9 | 0 | 0 | 0 | 1 | 10 |
| `\columnratio #1: breaks` | 0 | 0 | 9 | 0 | 0 | 0 | 9 |
| `\makecvheader #1: vanished` | 0 | 9 | 0 | 0 | 0 | 0 | 9 |
| `\name #1: case` | 0 | 0 | 7 | 0 | 0 | 2 | 9 |
| **Editable arguments, by the argument: documents** |  |  |  |  |  |  |  |
| `\resumeSubheading #2` | 34 | 0 | 0 | 0 | 0 | 0 | 34 |
| `\resumeSubheading #1` | 33 | 0 | 0 | 0 | 0 | 0 | 33 |
| `\resumeSubheading #3` | 31 | 0 | 0 | 0 | 0 | 0 | 31 |
| `\cventry #4` | 0 | 17 | 0 | 8 | 0 | 1 | 26 |
| `\cventry #2` | 0 | 16 | 0 | 8 | 0 | 1 | 25 |
| `\cventry #3` | 0 | 15 | 0 | 8 | 0 | 1 | 24 |
| `\name #1` | 0 | 16 | 1 | 6 | 0 | 1 | 24 |
| `\name #2` | 0 | 17 | 0 | 6 | 0 | 1 | 24 |
| `\resumeItem #1` | 18 | 0 | 0 | 0 | 0 | 0 | 18 |
| `\address #1` | 0 | 10 | 0 | 0 | 0 | 3 | 13 |
| `\resumeProjectHeading #2` | 12 | 0 | 0 | 0 | 0 | 0 | 12 |
| `\resumeItem #2` | 11 | 0 | 0 | 0 | 0 | 0 | 11 |
| `\location #1` | 0 | 0 | 8 | 0 | 0 | 1 | 9 |
| `\cventry #5` | 0 | 0 | 0 | 7 | 0 | 1 | 8 |
| `\cvevent #3` | 0 | 0 | 8 | 0 | 0 | 0 | 8 |

"Macros' and environments' arguments" counts each document's aggregates, so a macro called in 20
documents counts 20 times; the names below the table count documents. A candidate's text and a
document's name never reach the table.

### What the table says

- **Two thirds of what the references set is editable before naming**: 68% of the corpus's glyphs
  lie in editable fields, 91% of Jake's forks', 88% of AltaCV's, 81% of Awesome-CV's, 65% of
  moderncv's, 50% of the hand-rolled ones' and 3% of europecv's, whose body is one table (decision
  0020). By candidate, 6,854 of 11,637 are editable; by argument, 648 of 1,246 across the
  documents, and 212 of 671 macros are editable in every argument.
- **What locks the rest, by argument, is mostly what the ports patched**: `twice` (165), contacts
  whose macro builds its link from the text it sets, as `\email` does in 40 documents, AltaCV's,
  Awesome-CV's and moderncv's alike; `misaligned` (100), Awesome-CV's section titles taken apart
  (17 documents) and positions in small capitals (16); `moved` (88), Jake's `\resumeSubheading #4`
  in 27 of 35 forks, the italic correction; `case` (20), AltaCV's names and titles. Item 6's seeded
  redefinitions, Awesome-CV's contacts and section colour and AltaCV's contact text and tags, lift
  the largest of these; the aligner's folding the capitals; and item 8's small capitals and figures
  Awesome-CV's positions and addresses.
- **By candidate, a few documents weigh most**: 506 of the 856 misaligned are seven documents set
  in LaTeX's T1 Computer Modern, the EC fonts, which the tree has metrics for and no outlines
  (decision 0009), so the page names none of their glyphs; 479 of the 582 vanished are one AltaCV
  fork's parts inside a conditional the parser cannot decide, which the page does not show either;
  273 of the 491 that break are one document's `\code` arguments. `untested` (773) is seven
  documents whose budget ran out, three of them moderncv's.
- **microtype moves a field that starts a line.** pdfTeX protrudes a line's first character into
  the margin and stops looking at a whatsit, so a field whose begin marker starts a line with a
  letter that protrudes, A, T, V, W or Y, or a quote, loses the protrusion, and its line moves by a
  few tenths of a point: in moderncv's 14 documents, whose class loads microtype, and in 9 other
  documents that load it.
  Checked on an invented moderncv list, where turning protrusion off makes the two pages the same.
  Each such field is found alone, which is what spends moderncv's budget.
- **The format path holds for pdfTeX**: 79 of 91 pdfTeX documents compiled from their own format;
  12 took whole compiles because the format's baseline did not set the reference's glyphs, first
  in a place (5, among them hyperref's dvips link specials, which a Jake fork's format sets 0.7 pt
  from where its whole compile does), a special's text (4), the pages (2) or a glyph (1); none
  failed to dump. A dump took 282 ms at the median.
- **Time is XeTeX's**: a probe took 2.8 s at the median, 1.3 s for a Jake fork, 8.6 s for moderncv,
  and 35 s for an Awesome-CV fork, whose compiles are whole, 141 s at most; item 8's rewrite puts
  XeTeX on the format path. A document took 16 compiles at the median, and the budget ran out in 7.
- **Empty arguments**: 33 arguments are editable but moved the page when empty, as AltaCV's
  `\cvevent` and moderncv's `\cventry` test their arguments for being empty; the generator writes
  an absent value bare (decision 0007), which keeps them.

## Consequences

- Items 6 and 7 read `Probe.macros` and `Probe.standard`, per macro and argument, with every
  verdict's count, the empty calls' apart and the parts of a raw argument; the per-candidate
  verdicts and the uncovered runs are item 13's report's.
- A single call's failure locks its argument for the document, as the rule above has it: a Jake
  fork whose one bullet ends where an italic correction goes locks `\resumeItem`, 1 of 12. The
  counts are there for item 7 to weigh.
- Two things `\rtfield` does to a page, which no curated package's harness saw, since it compares
  no page without markers: its end marker hides a field's last glyph from the italic correction
  `\textit`, `\textbf` and `\emph` add, and its begin marker stops pdfTeX's protrusion of a line's
  first character. Each moves the page by a point or less. A prelude that applies the correction
  itself, and a way to keep the protrusion, are for their own items and change decision 0007;
  until then the probe locks such fields, and the corpus counts them.
- A preamble's calls that store their arguments are issued again after the prelude, which holds
  only for a macro whose second call does what its first did; the probe reads only macros that
  store every argument before anything else, and moderncv's `\phone`, with its optional argument,
  is not one.
- A pdfTeX document whose format does not reproduce the reference compiles whole, several times
  slower; XeTeX's probe is slow until item 8, and is the second compile that lets fontconfig scan
  the tree's fonts (decision 0019).
- The budget of 64 compiles holds for 110 of 117 documents. Isolating each field a margin kerns,
  or an italic correction moves, costs two compiles, and documents with many run out: what is left
  is `untested`, not guessed.
- The session's `dump` takes files at paths and a preamble as bytes; `readOutput` gives the parsed
  output with its glyph stream; `difference` says where the second stream parts from the first;
  the harness exports `SETS_NO_GLYPH`.
- The oracle's samples are fetched, never committed; `corpus/oracle.json` names them by repository,
  commit and hash, and their verdicts by macro and argument alone.
