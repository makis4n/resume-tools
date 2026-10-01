# 0041. Locked parts on the page

Date: 2026-10-01 · Status: proposed; amends 0025's second lock marker and its side panel row

## Context

Milestone 3 item 15. Decision 0025 gave the model a `locked` section, a part of an imported resume
kept as the upload wrote it, and the generator's `\rtlocked`, which writes a lock marker,
`rt:l:<id>`, before and after the part and moves nothing on the page; the side panel listed each
as a row, "Kept as it was", that moves and is removed. Decision 0026's assembly keeps as such
parts what no snippet can hold, and decision 0039's report names each locked part by its first
words as the page shows them. The page did nothing with the markers: a part read as the
template's own text, a click on it opened nothing because no field was there, and nothing said
why. This record is the page's reading of the markers, the lock it shows, the panel's name for a
part, and what a part can and cannot do until item 16 decides how one is edited. The code is
`apps/editor/src/page/locked.ts`, `draw.ts` and `Page.tsx`, `src/tex/svg.ts`,
`src/templates/prelude.ts`, `src/editor/Panel.tsx` with `src/App.tsx` and
`src/templates/resolve.ts`, and one field more in `src/import/report.ts`.

## Decision

### The page reads a part from its markers

- **A part's end says it is one.** `\rtlocked` writes `rt:l:<id>` before the part, as decision
  0025 has it, and now `rt:l:/<id>` after it (`LOCK_END`): the same `\rt@lock`, so it moves
  nothing either, and the same prefix, which the model refuses in kept LaTeX and the import's
  comparison of glyph streams leaves out, as before. Two alike markers could not say which of
  them a part starts with, and the output does not always set them in the source's order (below).
- **What is a part's.** `lockedSets` walks the output's pages in order. A part's start opens it,
  its end closes it, and a part a page breaks runs on to its end on the next page. What the
  output sets while a part is open, its glyphs and its drawn rules, is the part's, but for what a
  field's markers hold there: a part's LaTeX never holds them (the schema refuses them, decision
  0025), but a macro it calls may typeset a field the class stored, as a header set before
  `\begin{document}` is, and that stays the field's. Markers are read in any case, their ids
  lowercased, as a field's are. A part is never a field: `collectFields` reads only a field's
  markers, so the page aligns no text of a part's, and a click finds no field in it.
- **Where the output sets a part out of the source's order.** Within one run of a page, one column,
  the output keeps the source's order; across runs it need not. paracol sets two columns side by
  side column by column, page by page, and a page's foot and the next page's head come between a
  part's lines where a page breaks it. So a part whose end comes before its start, as one that
  runs from one column into the other ends at the top of the second before it starts at the foot
  of the first, or whose start no end follows, keeps nothing, and the page shows no lock over it.
  A part that starts on one page and ends on another keeps, on the first, the run of what it sets
  that goes on down the page from its start, up to where the output goes back up by more than a
  line, to another column's top, and on the last the run that goes down into its end; what lies
  past them, another column's sections, is not its. Two parts open at once, which the source never
  nests, each take what comes, and each that a page breaks keeps its own runs. AltaCV's sample
  shows both: a part ends there before it starts, and without the rule of runs 62 glyphs of other
  sections' content read as a part's.
- **Its blocks**, on the page drawn: the boxes of its glyphs and rules there, in the order the
  page sets them, joined while they go on down the page, and a new block where the part goes back
  up by more than the size of what comes next, a line or more, as to the top of a column or of a
  table's cell beside the last (`blocksOf`); a superscript, or an accent raised over a capital,
  goes up less. The SVG draws each block as a box with no paint, under every glyph, that carries
  the part's id, and each glyph of the part carries it too (`data-locked`), as a field's glyph
  carries its field's: the pointer between a part's words and lines is over the part, and over
  a glyph of anything else it is not. `DrawnPage.locked` holds each part, in the order the output
  first sets it, with its blocks on the page drawn, none where it is on another page or kept
  nothing.

### The lock

- **On hover.** The pointer over a part marks each of its blocks with a dashed grey outline and a
  faint tint, and puts above the first a padlock and one line: "Kept as it was; remove or move it
  from the side panel" (`LOCKED_TIP`). Off the part, over a field's glyph, the page's white or
  off the page, it goes. The lock takes no pointer, so what lies under it is clicked as it would
  be, and it never looks like a field's overlay, whose outline is solid and green.
- **A click opens nothing**, neither the plain overlay nor the rich editor: the page reports a
  click only on a field's glyph (`fieldAt`), and nothing of a part carries a field. With a field
  open, a click on a part leaves the overlay as it was; in the browser that click also takes the
  focus from the field, which then closes, as a click anywhere off it does, its visit ending.
- **The tab-order rule.** The page holds no tab stop, and a locked part adds none: no element of
  a part or of its lock takes the focus, and `focus()` on one does nothing, so Tab goes from
  whatever comes before the page to whatever comes after it, past every part, whether a field's
  overlay is open or not. The keyboard reaches a part through the side panel, whose row's
  buttons are in the tab order. A screen reader passes over the padlock; the line beside it is a
  tooltip's.

### The side panel

- **A part's row is named by its first words as the page shows them, item 13's naming**, with
  the mark "kept as it was", and never anything of its LaTeX: this amends decision 0025, which
  named every part "Kept as it was", as a part the report does not name still is, one that sets
  no word among them. Removing one asks first, by its name.
- **The names are the report's.** Item 13's report names each locked part by its first words on
  the original's page, each word set down to what in the source sets it (decision 0039); it now
  says which locked section a part is (`LockedShown.section`: a part of the section kind kept
  under no key of extras, as a section's `before` and `after` are), and the panel names that
  section's row by its words (`lockedWordsOf`). The store keeps the report with the import
  (decision 0038), `resolveTemplate` gives it with the document's template, and the app reads the
  names as it opens the document. The page, which knows a part only by its markers, named one of
  Awesome-CV's parts otherwise than the report in this test's first run, from what its markers
  hold in the output's order; read from the report, a part is named the same in the report the
  person read and in the panel, whatever page shows it, before its page comes and after its
  removal is undone.
- **Moving and removing are as decision 0025 made them**: each a step that undo takes back, the
  page recompiled after it as after any command.

### What a locked part can and cannot do

It is drawn where the original drew it, the real output; is named in the side panel; shows its
lock on hover; and is moved up and down among the sections, and removed, each step undone. It opens
no overlay, plain or rich; takes no text command, role, entry, item or bullet (decision 0025);
takes no focus; and shows nothing of its LaTeX anywhere.

### The format hash

The prelude is part of what is dumped, so every format's name changes once, its form unchanged,
as with decision 0025's change: Jake's becomes `jake-9867aa2f`, AltaCV's `altacv-411707d6`,
Awesome-CV's `awesome-cv-764e0c2b` and the invented XeTeX template's `invented-xetex-68ba40e7`,
and every `import-` format likewise. A browser that kept the old one dumps the new once and keeps
it, a redump and no failure (decision 0010).

## Done

- **The upstream samples** (`scripts/corpus-oracle.test.ts`): each of the three imported as the
  browser imports a resume (`importResume`, the committed answers naming its macros), once for
  item 13's report test and this one. For each, the first check holds; the harness, run by the
  import on the package that holds the locked parts, finds nothing but Awesome-CV's `pdf`, its
  entries' titles in small capitals (decision 0026); the document compiles as the editor
  compiles it, from its package's format in the editor's job, as many glyphs on each page as the
  reference; every locked section has one start and one end, and only AltaCV's two columns set
  one out of order; every glyph the page reads as a part's, on every page, is the reference's
  glyph at its place in the stream, its font's same character, set where the reference set it
  within the comparison's tolerance (`TOLERANCE`), decision 0025's test extended to the samples;
  none of them is, by the import's own reading of the original's page (`AssemblyChecks.owners`),
  another section's or entry's, a field of one, a part one keeps or another locked section, what a
  part's macro sets of the header aside; on the editor's first page, drawn as the compiler draws
  it, every kept glyph is where the reference set one of its font, and every part is a region of
  its own, with a block where it has a glyph; and the side panel names every part that sets a
  word, in plain words. The test asserts numbers alone: no sample's text, nor a compile's message,
  reaches its output.
- **The invented fork of Jake's Resume** (`src/import/run.test.ts`), its heading block and skills
  list kept as parts, imported, kept in the store and opened from it: the panel names them "Quill
  Invented 555-0100 | quill@example.invalid | quill…" and "Languages: Invented, Words, Other Tools:
  Quill, Wren" from the report the store keeps; the page draws each glyph of them where the
  reference drew it, in one block each; then, through the compiler, the heading is removed, the
  skills moved to the top, where they stand above the first section's title, and both undone,
  each step compiled with every field kept and matched, and the last page the first's to the byte.
- **Decision 0025's invented parts** (`src/templates/generate.test.ts`), drawn: each its own
  glyphs, every one, in one block that holds no field's glyph; and its tests of the markers moving
  nothing, which pass with the end marker as before.
- **The reading** (`src/page/locked.test.ts`): a part's start and end in any case, a field in a
  part the field's, a part a page breaks, a native run's `.notdef`, a part whose end comes first or
  that never ends keeping nothing, and two parts two columns break across pages each keeping its
  own column's runs.
- **The DOM** (`src/page/Page.dom.test.tsx`, jsdom), with the page and the overlay put together as
  the app puts them: the lock on hover over a part's glyph and block and none off it; a click on
  either opening nothing with no field open, with the plain overlay open and with the rich editor
  open, each left on its field as it was; and the tab order passing the part and its lock by.

## What stays open

- **Editing a part** is item 16's, which the corpus decides. Whatever it decides is where the
  panel's row or the page offers it, and the lock's line says so.
- **Kept instances and lists show no lock.** A field's instance kept as the upload wrote it, a
  list kept whole, the header's extras and a section's `before` and `after` are written through
  extras slots with no marker: the page draws them as the template's own text, with no field and
  no lock, and the report names them. Marking them needs a marker outside a macro's argument,
  `\rt@lock` alone before and after, proven by the probe to move nothing where it stands, in a
  table's cell or another macro's argument, which this item does not make; a part `\rtlocked`
  cannot take is kept so too (decision 0026).
- **What a part's markers hold in a page's foot and head.** A part a page breaks in one column
  takes the page's foot and the next page's head, the template's own text, which the report gives
  to no part; its lock shows over them on the page the editor draws. A part paracol switches
  columns in on one page, starting in one and ending in the other, takes what the other column
  held before it there.
- **A part past the first page** is named in the panel, and shows its lock once the editor draws
  its page, which it does not yet.
- **A removal that stops the compile.** A part that holds the closer of a list a section opens can
  still be removed or moved. Decision 0038 keeps most such closers with their section; where one
  stays in a part, removing the part stops the compile, the page stays as it was with the
  compile's message, and undo takes it back. Check 3 tries no part's removal; marking such a part
  as one the editor keeps in place, as it marks a kind (`fixed`, decision 0038), is left for the
  corpus to ask for.
- **Touch.** The lock shows while a finger is on a part, and goes when it lifts.

## Consequences

- `DrawnPage` gains `locked`, which a page a test builds by hand gives empty, and `GlyphBox` gains
  `locked`, the part a glyph is of; `LockedShown` gains `section`, and `Template` `report`.
- The page's element holds its SVG in an element of its own and is positioned, for the lock; a
  field's overlay is placed in the sheet around it, as before.
- Every format is dumped once more, under its new name (above); no document or package changes.
