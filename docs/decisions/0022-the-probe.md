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
aligner's case folding, the other half of item 5, is decision 0021, which landed first, so a field
set through `\MakeUppercase` is editable; a field is recorded `case` only where the aligner's fold,
once for each glyph and only where it changes a character the glyph spells, cannot match it and
folding the whole field, glyphs and text, to small letters can.

An adversarial review of the first version found that its compiles never took the pass that
reads what the first wrote, that it never compiled the editable candidates together, that it
settled a field a move had split or doubled without trying it again, that it set down what no
field covers by a guess at its neighbours, and a few smaller faults. What follows is the probe
with its fixes, and the tables are its runs with item 4's parser and decision 0021's folding
merged.

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

- A candidate's span is wrapped in `\rtfield{<id>}{...}`, the prelude's own macro, as a package's
  fields are: an
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
  baseline wrote, so none reads what another's markers wrote.
- A probe compile takes two passes at most, and the second whenever the first changed a file of
  the job's folder, which the session compares before and after each pass when asked
  (`rerunOnChange`): a title that a table of contents repeats comes back through the `.toc`, and
  a caption through the `.lof` or `.lot`, which LaTeX rewrites without its log asking for a pass,
  so a compile of one pass from the baseline's files never showed the markers the editor's own
  loop, whose new document takes two, would set twice. The markers are read on the last pass's
  output. One that stops, or whose log still asks for a pass after the second, is a failure of the
  whole set. A pass that changed nothing it could read would be the same again, so none follows
  it; the probe's result counts the passes (`Probe.passes`), and the table the share of compiles
  that took a second.
- The probe leaves a pdfTeX document's format in the session, since item 7 compiles the assembled
  package's first check from it, and whoever asked for the probe drops it with the session's
  `dropFormat` when done with it: `corpus probe`'s child after each document's row, so that a
  child's formats, 6 to 9 MB each, do not pile up over the documents it takes, and item 12's
  import when it ends. Forgetting a job leaves every format in place, as before; a probe that
  throws drops its own. A dropped name that is dumped again is a new format to the jobs compiled
  with the old one, which start again as new documents.

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
| `case` | Its glyphs spell its text only once both are folded whole to small letters, which the aligner's own fold, once for each glyph and only where it changes a character the glyph spells (decision 0021), does not reach: a case mapping other than Unicode's default ones, as German's `de-x-eszett` capitals set ß as ẞ, where the aligner takes ß's capitals for SS. A field set through `\MakeUppercase` is editable since decision 0021 |
| `moved` | Its markers and glyphs passed, but the output's glyphs moved (the first difference's kind as detail), or it is set inside a transform the PDF applies and the page does not (`transform`, the harness's special check) |
| `untested` | The budget ran out before it was settled |

A link's address never runs the markers inside it: hyperref writes the argument into its special's
text, markers and all, so the probe reads a marker's id in another special's text as the second
copy milestone 3's plan expected of an argument used twice.

A field in a slanted font inside a text command gets its italic correction before its end marker,
which the prelude now adds itself (decision 0007's update): a field in `\textit` sets the page as
its text does, and one set slanted by a declaration, `{\slshape ...}`, gets none, as in LaTeX.
Where LaTeX leaves the correction out although a text command ends, before a period or a comma,
or where the field is not the last of the command's argument, the field gains a correction
upstream lacks and is locked `moved`, the safe side; so is one that ends in an upright letter
`\textbf` corrects, as an `f`.

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

A field whose markers came on two pages, or twice on the page, in an output that moved is tried
again without the candidates that moved it before it is settled, as one whose markers never came
is: a move that adds a line can push a field across a page's end, or bring a running head's copy
of it onto the page, which the field alone never does. In an output that set the reference's
glyphs, both are the field's own.

Then every editable candidate is compiled together, as item 7 marks them (the union), since two
that passed apart may fail together, as two whose markers each take a little from one line would.
No compile is spent when a set the bisection compiled was just them and passed. When the union
fails, the shortest run of them, in the order they were probed, that fails is found by halving,
and its last candidate is locked (`settled: "union"`), with its own failure in that compile, or
`breaks` or `moved`; and so again until those left pass together. The bisection leaves the
budget's last compile to the union when there are editable candidates no compile has passed
together. When the budget runs out inside the union's check, the largest set of them some compile
passed stays editable and the rest are `untested`. A document has 64 compiles, the baseline and
the dump aside; what is left then is `untested`.

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
  its first and last glyph's place, set down by where in the source it comes from
  (`uncoveredRuns`). A glyph a compile showed a candidate setting is that candidate's: from a
  compile whose output set the reference's glyphs, or set them in the same order wherever it
  placed them (`SetResult.order`), as one a move shifted does, so that a locked candidate's glyphs
  are found as an editable one's are. The others come in stretches between such glyphs, and a
  stretch's source lies between the candidates either side of it, in the body's source, or the
  preamble's for a header's. A stretch whose source lies in a raw chunk is the chunk's, as a
  separator between two parts of one is; in a locked candidate, between two of its parts, the
  candidate's. In any other, what overlaps its source and may set glyphs no compile placed, a
  locked candidate or a raw chunk, is found by the pieces of text its part of the source sets,
  between its commands and braces, among the stretch's glyphs' texts, in the source's order, and
  holds what lies between the first piece and the last it finds, as a label its own command sets
  between them; a piece an argument sets nothing of, a length or an address, is not found and
  leaves the others be. For what none of them sets, the other arguments of the calls either side
  are looked for too, since a macro may set its arguments in another order than it takes them, as
  a Jake fork's `\resumeSubheading` sets its dates beside its first. What none of these sets is the
  template's own text, as a bullet, an icon, a label or a page's number (`chrome`); a stretch
  between the header's text and the body's is looked for in both. A run ends where what sets it
  changes, as between a raw chunk's text and a label after it. A stretch whose glyphs the page
  names none of, in a font it has no outlines for, is shared among what overlaps its source in
  proportion to its length.
  Where the page's order and the source's part, as paracol sets its columns one after the other,
  a stretch between the columns may be looked for in the wrong part of the source, and its text
  is then the template's.
- The result carries the engine's signatures the probe read the preamble with
  (`Probe.signatures`): the caller's, and what the engine said of the preamble's commands the
  caller did not ask of, so that item 6 can key and describe every macro the probe reports, a
  header's `\name` or `\email` among them, by its meaning and hash.

### The runner and the oracle

- `corpus probe [--only <id>] [--json <file>]` runs the whole pipeline in the pool of decision 0019,
  600 s a document, and prints the table below: names of macros and counts, never text. Each
  document's whole probe, which holds its candidates' texts, goes under `.corpus/probe/` alone. A
  document whose body parsed counts once the probe reached it, probed or not, and a timeout or a
  crash, which may never have reached the parser, does not; the candidates, arguments, names and
  glyphs the table and the JSON sum are of the documents probed alone.
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

`corpus oracle` on 27 September 2026, after the review's fixes, with item 4's parser and decision
0021's folding merged, the tree of layout 6, the M4 Pro: Jake's sample took 1 compile from its
format, every candidate at once, AltaCV's 61, and Awesome-CV's 30 whole ones, 43 s.

| Template | Argument | Port | Expected | Found | |
|---|---|---|---|---|---|
| jake | `\resumeSubheading #1` | marks | editable | editable (5 of 5) | agrees |
| jake | `\resumeSubheading #2` | marks | editable | editable (5 of 5) | agrees |
| jake | `\resumeSubheading #3` | marks | editable | editable (5 of 5) | agrees |
| jake | `\resumeSubheading #4` | marks | editable | editable (5 of 5) | agrees |
| jake | `\resumeItem #1` | marks | editable | editable (20 of 20) | agrees |
| jake | `\resumeProjectHeading #1` | marks | raw | raw (2 of 2); parts 4 of 4 editable | agrees |
| jake | `\resumeProjectHeading #2` | marks | editable | editable (2 of 2) | agrees |
| jake | `section (standard)` | marks | editable | editable (4 of 4 editable) | agrees |
| jake | `item (standard)` | marks | editable | editable (1 of 1 editable) | agrees |
| jake | `paragraph (standard)` | marks | editable | editable (5 of 5 editable) | agrees |
| altacv | `\name #1` | marks | editable | editable (1 of 1) | agrees |
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
| altacv | `\cvsection #2` | marks | editable | editable (10 of 10) | agrees |
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
| awesome-cv | `\address #1` | marks | editable | editable (1 of 1) | agrees |
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
| awesome-cv | `\cventry #1` | marks | editable | editable (9 of 9) | agrees |
| awesome-cv | `\cventry #2` | marks | editable | editable (9 of 9) | agrees |
| awesome-cv | `\cventry #3` | marks | editable | editable (9 of 9) | agrees |
| awesome-cv | `\cventry #4` | marks | editable | editable (9 of 9) | agrees |
| awesome-cv | `\cventry #5` | marks | container | container (7 of 9; 2 moved); empty: moved | agrees |
| awesome-cv | `\cvsubsection #1` | omits | editable | editable (3 of 3) | agrees |
| awesome-cv | `\cvhonor #1` | marks | editable | editable (21 of 21) | agrees |
| awesome-cv | `\cvhonor #2` | marks | editable | editable (21 of 21) | agrees |
| awesome-cv | `\cvhonor #3` | marks | editable | editable (21 of 21) | agrees |
| awesome-cv | `\cvhonor #4` | marks | editable | editable (21 of 21) | agrees |
| awesome-cv | `item (standard)` | marks | editable | editable (29 of 29 editable) | agrees |
| awesome-cv | `paragraph (standard)` | marks | editable | editable (2 of 2 editable) | agrees |

Disagreements: 3 of 75.

What each disagreement means:

- **Paragraphs, breaks: not the probe's.** The engine reads paracol's environment as taking an
  optional argument alone, so `\begin{paracol}{2}` leaves `{2}` a paragraph, which the probe wraps
  and paracol cannot count; the sample's own paragraphs are editable, 5 of 7. A signature fault of
  the kind decision 0020 found in paracol's `\columnratio`.
- **`\position #1`, raw: the expectation missed a fact.** The example's position holds
  `{\enskip\cdotp\enskip}` between two positions, a raw chunk, so the argument is raw; its two parts
  are misaligned, as expected, since the class sets them in small capitals.
- **`\address #1`, `\cventry #1` and `\cvsubsection #1` were item 8's.** The header set the
  address in Roboto, whose proportional figures, `+pnum` (decision 0015's second gap), put glyphs
  with no text the page could read in place of 7 of its 8 digits, and the positions and
  subsections in small capitals the page could not name either. With item 8's page reading a
  glyph first as its own character (decision 0023), all three are editable, and the oracle now
  expects them so; before it, `\address #1` disagreed and the other two were expected misaligned.
- **`\cvsection #1`, misaligned rather than breaks: a finding.** Upstream's `\@sectioncolor` takes
  the marker macro, the first characters of its id and the next as its three tokens, as decision
  0015 foresaw, and does not stop: markers of an id no candidate has come in place of the title's
  (`torn`). Locked either way until item 6's redefinition.

Five disagreements of the first run are gone, of nine. Jake's `\resumeSubheading #4`, which the
end marker had moved by the italic correction it hid, 1.36 pt, is editable now that the prelude
adds the correction itself (decision 0007's update). Awesome-CV's `\cvhonor #1` to `#4`, which the
parser kept raw as a table's cells, are placed calls since item 4's fix, and all four are editable
in the 21 awards.

Of the port's other slots, the probe finds editable Jake's entries and bullets, AltaCV's name and
section titles, which the class sets in capitals and the aligner folds (decision 0021), its events,
headline, location and mail address, and Awesome-CV's name, entries' organisation, place and
dates, honours, and bullets; and locked as the ports' decisions say, AltaCV's contacts, whose
links repeat their text (`twice`), and its tags, which a PDF-only transform places (`moved`,
`transform`), and Awesome-CV's positions in small capitals and its contacts. What the ports leave
out comes out locked where the class takes it as a length, a key or an address, and editable
where it is plain text.

## The corpus

`corpus probe` on 27 September 2026, after the review's fixes, with item 4's parser, decision
0021's folding, and item 8's session fix and font table (the tree of layout 7) merged, the M4 Pro,
four children, on a machine loaded by other work (a load average of 12): 15.3 minutes. The time
rows read about twice the run of #52's, which took 9.6 minutes on layout 6 with a dump of 295 ms
and a probe of 2.9 s at the median; the counts do not depend on the load.

|  | jake | awesome-cv | altacv | moderncv | europecv | other | all |
|---|--:|--:|--:|--:|--:|--:|--:|
| Documents whose body parsed | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Probed | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Not probed: the body unmarked did not set the reference's glyphs | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Timed out or died | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Path: from the document's format | 35 | 0 | 9 | 14 | 6 | 27 | 91 |
| Path: whole compiles, XeTeX | 0 | 18 | 1 | 0 | 0 | 7 | 26 |
| Path: whole compiles, the preamble did not dump | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Path: whole compiles, the format did not set the reference's glyphs | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Compiles per document, median | 2 | 29 | 47 | 38 | 19 | 14 | 16 |
| Compiles per document, most | 39 | 64 | 64 | 64 | 32 | 64 | 64 |
| Compiles that took a second pass | 59% | 16% | 34% | 36% | 64% | 26% | 31% |
| The budget ran out | 0 | 1 | 1 | 3 | 0 | 2 | 7 |
| **Candidates** |  |  |  |  |  |  |  |
| In all | 2681 | 2014 | 1777 | 1380 | 796 | 4088 | 12736 |
| Editable | 2363 | 1524 | 740 | 822 | 556 | 2164 | 8169 |
| `container` | 15 | 146 | 12 | 30 | 21 | 174 | 398 |
| `raw` | 153 | 51 | 60 | 57 | 105 | 304 | 730 |
| `breaks` | 11 | 7 | 114 | 2 | 50 | 317 | 501 |
| `vanished` | 20 | 19 | 481 | 23 | 17 | 34 | 594 |
| `twice` | 0 | 82 | 54 | 15 | 10 | 22 | 183 |
| `moved` | 22 | 34 | 237 | 123 | 12 | 138 | 566 |
| `misaligned` | 97 | 63 | 63 | 1 | 25 | 448 | 697 |
| `case` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `split` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `untested` | 0 | 88 | 16 | 307 | 0 | 486 | 897 |
| **Macros' and environments' arguments, per document** |  |  |  |  |  |  |  |
| In all | 277 | 385 | 196 | 175 | 106 | 220 | 1359 |
| Editable | 232 | 199 | 86 | 110 | 55 | 140 | 822 |
| `container` | 0 | 25 | 10 | 6 | 5 | 9 | 55 |
| `raw` | 17 | 32 | 4 | 4 | 6 | 7 | 70 |
| `breaks` | 0 | 0 | 20 | 0 | 16 | 9 | 45 |
| `vanished` | 1 | 10 | 11 | 3 | 7 | 6 | 38 |
| `twice` | 0 | 82 | 41 | 15 | 6 | 13 | 157 |
| `moved` | 8 | 2 | 12 | 5 | 4 | 15 | 46 |
| `misaligned` | 19 | 16 | 11 | 1 | 7 | 19 | 73 |
| `case` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `split` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `untested` | 0 | 19 | 1 | 31 | 0 | 2 | 53 |
| Editable, but not when empty | 1 | 9 | 10 | 9 | 4 | 4 | 37 |
| Macros and environments every argument of which is editable | 67 of 106 | 84 of 213 | 49 of 142 | 43 of 85 | 29 of 69 | 46 of 105 | 318 of 720 |
| **Standard nodes, editable** |  |  |  |  |  |  |  |
| Section titles | 158 of 169 | 0 | 0 | 69 of 77 | 0 of 15 | 187 of 302 | 414 of 563 |
| List items' text | 127 of 155 | 465 of 489 | 214 of 333 | 68 of 96 | 9 of 11 | 419 of 923 | 1302 of 2007 |
| List items' labels | 0 | 0 | 0 | 0 | 0 | 72 of 77 | 72 of 77 |
| Paragraphs | 257 of 270 | 25 of 45 | 61 of 130 | 20 of 21 | 20 of 25 | 583 of 1156 | 966 of 1647 |
| **The reference's glyphs** |  |  |  |  |  |  |  |
| In all | 138202 | 78881 | 41818 | 43796 | 20643 | 215767 | 539107 |
| Covered by editable fields | 93% | 92% | 88% | 65% | 82% | 51% | 73% |
| Set by a locked candidate | 5% | 3% | 10% | 25% | 3% | 22% | 14% |
| Set by a raw chunk | 1% | 0% | 0% | 1% | 5% | 18% | 8% |
| Set by the template alone | 1% | 5% | 2% | 9% | 11% | 9% | 6% |
| **Time** |  |  |  |  |  |  |  |
| The dump, median | 333 ms |  | 792 ms | 509 ms | 328 ms | 421 ms | 388 ms |
| The dump, slowest | 3320 ms |  | 2170 ms | 4923 ms | 455 ms | 5096 ms | 5096 ms |
| The probe, median | 1247 ms | 54385 ms | 24675 ms | 15029 ms | 3000 ms | 4351 ms | 5706 ms |
| The probe, slowest | 28063 ms | 194679 ms | 80795 ms | 263585 ms | 6691 ms | 209262 ms | 263585 ms |
| **Locked arguments, by the argument and its verdict: documents** |  |  |  |  |  |  |  |
| `\email #1: twice` | 0 | 17 | 9 | 9 | 0 | 2 | 37 |
| `\linkedin #1: twice` | 0 | 15 | 9 | 0 | 0 | 1 | 25 |
| `\github #1: twice` | 0 | 15 | 7 | 0 | 0 | 1 | 23 |
| `\cvsection #1: misaligned` | 0 | 16 | 0 | 0 | 0 | 1 | 17 |
| `\homepage #1: twice` | 0 | 8 | 5 | 3 | 0 | 1 | 17 |
| `\makecvfooter #3: raw` | 0 | 12 | 0 | 0 | 0 | 1 | 13 |
| `\resumeProjectHeading #1: raw` | 13 | 0 | 0 | 0 | 0 | 0 | 13 |
| `\mobile #1: twice` | 0 | 12 | 0 | 0 | 0 | 0 | 12 |
| `\makecvfooter #1: raw` | 0 | 10 | 0 | 0 | 0 | 0 | 10 |
| `\columnratio #1: breaks` | 0 | 0 | 9 | 0 | 0 | 0 | 9 |
| `\makecvfooter #2: twice` | 0 | 8 | 0 | 0 | 0 | 1 | 9 |
| `\makecvheader #1: vanished` | 0 | 9 | 0 | 0 | 0 | 0 | 9 |
| `\position #1: raw` | 0 | 8 | 0 | 0 | 0 | 1 | 9 |
| `\resumeItem #1: moved` | 7 | 0 | 0 | 0 | 0 | 0 | 7 |
| `\phone #1: twice` | 0 | 0 | 6 | 0 | 0 | 0 | 6 |
| **Editable arguments, by the argument: documents** |  |  |  |  |  |  |  |
| `\resumeSubheading #2` | 34 | 0 | 0 | 0 | 0 | 0 | 34 |
| `\resumeSubheading #4` | 34 | 0 | 0 | 0 | 0 | 0 | 34 |
| `\resumeSubheading #1` | 33 | 0 | 0 | 0 | 0 | 0 | 33 |
| `\name #1` | 0 | 15 | 8 | 6 | 0 | 3 | 32 |
| `\resumeSubheading #3` | 31 | 0 | 0 | 0 | 0 | 0 | 31 |
| `\cventry #2` | 0 | 16 | 0 | 8 | 0 | 1 | 25 |
| `\cventry #3` | 0 | 16 | 0 | 8 | 0 | 1 | 25 |
| `\cventry #4` | 0 | 16 | 0 | 8 | 0 | 1 | 25 |
| `\name #2` | 0 | 16 | 0 | 6 | 0 | 1 | 23 |
| `\resumeItem #1` | 18 | 0 | 0 | 0 | 0 | 0 | 18 |
| `\cventry #1` | 0 | 16 | 0 | 0 | 0 | 1 | 17 |
| `\address #1` | 0 | 13 | 0 | 0 | 0 | 3 | 16 |
| `\cvskill #1` | 0 | 12 | 1 | 0 | 0 | 2 | 15 |
| `\cvskill #2` | 0 | 12 | 0 | 0 | 0 | 2 | 14 |
| `\resumeProjectHeading #2` | 13 | 0 | 0 | 0 | 0 | 0 | 13 |

"Macros' and environments' arguments" counts each document's aggregates, so a macro called in 20
documents counts 20 times; the names below the table count documents. A candidate's text and a
document's name never reach the table. The verdicts, arguments and glyphs of a document the probe
could not probe would count nowhere; none was.

### What the table says

- **Seven tenths of what the references set is editable before naming**: 73% of the corpus's
  glyphs lie in editable fields, 93% of Jake's forks', 92% of Awesome-CV's, 88% of AltaCV's, 82%
  of europecv's, 65% of moderncv's and 51% of the hand-rolled ones'. By candidate, 8,169 of 12,736
  are editable; by argument, 822 of 1,359 across the documents, and 318 of 720 macros are editable
  in every argument. Awesome-CV's share rose from 87% with item 8, whose page reads a glyph first
  as its own character and only then as a substitution's source (decision 0023), so its dates,
  places and addresses in Roboto's proportional figures align: `\cventry #1` and `#3` and
  `\address #1` are editable in 16, 16 and 13 of its 18 forks. europecv's body, one raw table to the parser before item 4's fix, is its
  calls now, 796 candidates where there were 56, and Awesome-CV's honours and skills are calls
  too, 2,014 candidates where there were 1,663.
- **What locks the rest, by argument, is mostly what the ports patched**: `twice` (157), contacts
  whose macro builds its link from the text it sets, as `\email` does in 37 documents, AltaCV's,
  Awesome-CV's and moderncv's alike; `misaligned` (106), Awesome-CV's section titles taken apart
  (17 documents) and its entries' positions in small capitals (16); `breaks` (45), AltaCV's
  lengths and keys, as `\columnratio` and `\photoR` take (20), and europecv's `\ecvitem`, language
  and personal-information arguments (16); and `moved` (46, 88 in the first run), since Jake's
  `\resumeSubheading #4`, which the italic correction the end marker hid moved in 27 of 35 forks,
  is editable in 34. `case` locks none: the aligner folds case (decision 0021), and no field of the
  corpus needs a fold it does not make. Of the 20 arguments it locked before, AltaCV's names and
  section titles and five names and titles of three hand-rolled documents, 19 are editable, and
  one AltaCV fork's titles are `vanished`, the first of their calls to fail now being one a
  conditional hides; of its 127 candidates, 126 are editable, and a Jake fork's first paragraph,
  aligned now, moves the page alone (`moved`). Item 6's seeded redefinitions, Awesome-CV's
  contacts and section colour and AltaCV's contact text and tags, lift the largest of these; and
  item 8's small capitals and figures Awesome-CV's positions and addresses.
- **By candidate, a few documents weigh most**: 506 of the 697 misaligned are seven documents set
  in LaTeX's T1 Computer Modern, the EC fonts, which the tree has metrics for and no outlines
  (decision 0009), so the page names none of their glyphs; 479 of the 594 vanished are one AltaCV
  fork's parts inside a conditional the parser cannot decide, which the page does not show either;
  273 of the 501 that break are one document's `\code` arguments. `untested` (897) is seven
  documents whose budget ran out, three of them moderncv's, and 475 of it is one document's.
- **microtype moves a field that starts a line.** pdfTeX protrudes a line's first character into
  the margin and stops looking at a whatsit, so a field whose begin marker starts a line with a
  letter that protrudes, A, T, V, W or Y, or a quote, loses the protrusion, and its line moves by a
  few tenths of a point: in moderncv's 14 documents, whose class loads microtype, and in 9 other
  documents that load it. Checked on an invented moderncv list, where turning protrusion off makes
  the two pages the same. Each such field is found alone, which is what spends moderncv's budget.
- **The editable candidates hold together.** The union's check, every document's editable
  candidates compiled together after the bisection, locked none. It costs a compile in a document
  where no set the bisection compiled was just its editable candidates, and none where the first
  compile of all of them passed, as in Jake's sample.
- **A second pass where the first changed a file**: 31% of the probe's compiles took one, 59% of
  Jake's forks', whose `\section` writes its title to the `.aux` whether or not a table of contents
  reads it back, 64% of europecv's, and 16% of Awesome-CV's.
- **What sets what no editable field covers is found by its source**: 13% of the references'
  glyphs are set by a locked candidate, 8% by a raw chunk, and 7% by the template alone. A locked
  candidate's glyphs a compile placed in the reference's order count as its own, and each stretch
  of the rest is read against the text its source sets, which puts the classes' own labels with
  the template, 11% of europecv's glyphs and of Awesome-CV's. Checked on six documents, 96% of the
  glyphs the page names that went to the template have a text the body's source holds nowhere, and
  83% of those that went to a raw chunk lie in the chunk's own text; the rest are what a chunk's
  own command sets between its pieces.
- **The format path holds for pdfTeX**: 82 of 91 pdfTeX documents compiled from their own format,
  and none failed to dump; a dump took 295 ms at the median. Of the twelve that fell back to whole
  compiles in the first run, three did so for the comparison's own artefact, xcolor's first black
  pushed in RGB, which the comparison now leaves out in any colour model. The nine left, which
  the run of #52 took for real differences between a format and a whole compile (the running
  heads of two documents, 17 and 18 glyphs on every page after the first, one of which then ran
  to 28 pages rather than 27; a second page the format's compile needed; a page's end that moved
  138 glyphs from the second page to the first, with hyperref's dvips link specials 0.7 pt off; link
  specials alone 8 pt off; a page colour the dump dropped; and the first line of two documents in
  EC small capitals 0.9 pt higher, and 57 glyphs of a last page 4.6 pt higher), were one bug of
  the session's: every dumped format's body began with a leftover 10 pt `\@holdpg` box, and the
  dump dropped what the preamble had written onto the page. Item 8's session fix voids the box
  and restores that material (decision 0023), and in the run after it every one of the 91 pdfTeX
  documents compiles from its own format; item 7's first check meets no such difference.
- **Time is XeTeX's**: a probe took 2.9 s at the median, 0.8 s for a Jake fork, 11 s for moderncv,
  18 s for AltaCV and 45 s for an Awesome-CV fork, whose compiles are whole, 149 s at most; item
  8's rewrite puts XeTeX on the format path. A document took 16 compiles at the median, 2 for a
  Jake fork, and the budget ran out in 7. The slowest dumps, 2.2 s against 0.3 s at the median,
  are the shared machine's.
- **Empty arguments**: 37 arguments are editable but moved the page when empty, as AltaCV's
  `\cvevent` and moderncv's `\cventry` test their arguments for being empty; the generator writes
  an absent value bare (decision 0007), which keeps them.

## Consequences

- Items 6 and 7 read `Probe.macros` and `Probe.standard`, per macro and argument, with every
  verdict's count, the empty calls' apart and the parts of a raw argument, and item 6 keys and
  describes each macro by `Probe.signatures`; the per-candidate verdicts and the uncovered runs
  are item 13's report's.
- A single call's failure locks its argument for the document, as the rule above has it, however
  many of its calls pass: `\resumeItem` is locked `moved` in 7 of the 35 Jake forks, each by one
  bullet or two of up to 30. The counts are there for item 7 to weigh.
- Two things `\rtfield` did to a page, which no curated package's harness saw, since it compares
  no page without markers. Its end marker hid a field's last glyph from the italic correction
  LaTeX's text commands add; the prelude now adds it before the marker, inside a text command, in
  a slanted font (decision 0007's update), which changes every format's name and gives the
  curated packages' slanted fields the correction their upstream classes set. An upright letter's
  correction, as `\textbf` adds after an `f`, is still hidden, and such a field is locked `moved`.
  Its begin marker stops pdfTeX's protrusion of a line's first character, a few tenths of a point;
  a way to keep it is for its own item, and until then the probe locks such fields.
- A preamble's calls that store their arguments are issued again after the prelude, which holds
  only for a macro whose second call does what its first did; the probe reads only macros that
  store every argument before anything else, and moderncv's `\phone`, with its optional argument,
  is not one.
- A pdfTeX document whose format does not reproduce the reference compiles whole, several times
  slower; the corpus has none since item 8's session fix, which took the nine such of the run
  before it, all one leftover box of the dump's, back to their formats (decision 0023). XeTeX's probe is slow
  until item 8, and is the second compile that lets fontconfig scan the tree's fonts (decision
  0019).
- The budget of 64 compiles holds for 110 of 117 documents. Isolating each field a margin kerns
  costs two compiles, and documents with many run out: what is left is `untested`, not guessed.
  The union's check takes the budget's last compile when it has work, and a document whose union
  fails when none is left keeps editable only the largest set a compile passed.
- A probe compile's second pass, taken when its first changed a file it read, came to 31% of the
  corpus's compiles. The probe before it took none on the baseline's files, and could not see a
  title that a table of contents repeats.
- The session's `dump` takes files at paths and a preamble as bytes; its `compile` passes again
  while a pass changes a file of the job's folder, when asked (`rerunOnChange`); `dropFormat`
  takes a format out, and a dropped name dumped again is a new format to its old jobs.
  `readOutput` gives the parsed output with its glyph stream; `difference` says where the second
  stream parts from the first, leaving out the first shipout's black in any colour model; the
  harness exports `SETS_NO_GLYPH`.
- The oracle's samples are fetched, never committed; `corpus/oracle.json` names them by repository,
  commit and hash, and their verdicts by macro and argument alone.
