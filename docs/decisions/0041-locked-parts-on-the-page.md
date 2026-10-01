# 0041. Locked parts on the page

Date: 2026-10-01 · Status: proposed; amends 0025's second lock marker and its side panel row, and
adds the locked parts' steps to 0038's check 3

## Context

Milestone 3 item 15. Decision 0025 gave the model a `locked` section, a part of an imported resume
kept as the upload wrote it, and the generator's `\rtlocked`, which writes a lock marker,
`rt:l:<id>`, before and after the part and moves nothing on the page; the side panel listed each
as a row, "Kept as it was", that moves and is removed. Decision 0026's assembly keeps as such
parts what no snippet can hold, and decision 0039's report names each locked part by its first
words as the page shows them. The page did nothing with the markers: a part read as the
template's own text, a click on it opened nothing because no field was there, and nothing said
why. This record is the page's reading of the markers, the lock it shows, the panel's name for a
part, what a part can and cannot do until item 16 decides how one is edited, and, after the
review, how a step that stops the compile is kept from the store. The code is
`apps/editor/src/page/locked.ts`, `draw.ts` and `Page.tsx`, `src/tex/svg.ts`,
`src/templates/prelude.ts`, `src/editor/Panel.tsx` with `src/App.tsx` and
`src/templates/resolve.ts`, and one field more in `src/import/report.ts`; and for a step that
stops, check 3 in `src/import/validate.ts`, `pinned` in `src/templates/package.ts` and
`src/import/assemble.ts`, `src/editor/document.ts`, and `src/editor/guard.ts` with the compiler's
`stopped` in `src/editor/compiler.ts`.

## Decision

### The page reads a part from its markers

- **A part's end says it is one.** `\rtlocked` writes `rt:l:<id>` before the part, as decision
  0025 has it, and now `rt:l:/<id>` after it (`LOCK_END`): the same `\rt@lock`, so it moves
  nothing either, and the same prefix, which the model refuses in kept LaTeX and the import's
  comparison of glyph streams leaves out, as before. Two alike markers could not say which of
  them a part starts with, and the output does not always set them in the source's order (below).
- **What is a part's.** `lockedSets` reads each part's start and end where they stand among the
  output's glyphs and rules. What the output sets between them is the part's, but for what a
  field's markers hold there: a part's LaTeX never holds them (the schema refuses them, decision
  0025), but a macro it calls may typeset a field the class stored, as a header set before
  `\begin{document}` is, and that stays the field's. What the output sets inside a part's span
  that lies within another part's, as only a reordering can put it, is the inner part's. Markers
  are read in any case, their ids lowercased, as a field's are. A part is never a field:
  `collectFields` reads only a field's markers, so the page aligns no text of a part's, and a
  click finds no field in it.
- **A part whose markers stand on one page keeps everything between them**, cells side by side, a
  list in columns of its own and all.
- **Where the output sets a part out of the source's order.** Within one run of a page, one column,
  the output keeps the source's order; across runs it need not. paracol sets two columns side by
  side column by column, page by page, so that between the markers of a part a page breaks lie the
  other column's sections, and a page's foot and the next page's head. Where a marker stands says
  where its column starts: TeX writes one between paragraphs at its column's left edge, and one
  that follows a paragraph with no blank line at the end of the paragraph's last line, which
  starts at the column's edge. So:
  - a part whose markers stand on two pages or more keeps, on its start's page, the run from its
    start down its column: up to where the output goes back up above its start, to another
    column's top, or to within a size of its own first line, where it starts at its column's top;
    but not where the output comes back after to a line that starts at the part's column, as a
    table's next row after a cell beside the last, which went back up. On the pages after, it
    keeps the lines that start in its column, give or take three times their size, a list's
    indent, so not another column's to its left: to its end, and on a page between, up to where
    another column starts beside it, as above. Its start may stand alone at the foot of a page,
    and its lines all be on the next;
  - a part whose end the output sets before its start, as one that runs from the foot of one
    column into the top of the next, on the page before, ends, keeps the run that goes down into
    its end, the lines before it on its page, after the last field or part there, that start in
    the column its end stands in; and the run from its start down its column, as above, up to the
    next part;
  - a part with no start or no end keeps nothing, and the page shows no lock over it.
  AltaCV's sample shows both kinds: one of its parts ends before it starts, and without these
  rules 62 glyphs of other sections' content read as a part's; and the oracle's review found 199
  more, of sections and entries in the column beside a part, read as the part's by the first
  reading of these rules, which went by the part's first line alone and so took the column beside
  a part that starts at its column's top or sets nothing of its own on its start's page, both of
  which the rules above leave to the column. The reviewers' invented documents show the rest: a
  skills table of rows of two cells whose heading goes to the next page, or which a page breaks
  between its rows, and a list in two columns, each keep every glyph they own; and a part a
  `\newpage` breaks at its column's foot, and one paracol sets out of order from its column's top,
  beside the second column's field and words, keep only their own.
- **Its blocks**, on the page drawn: the boxes of its glyphs and rules there, in the order the
  page sets them, joined while they go on down the page, and a new block where the part goes back
  up by more than the size of what comes next, a line or more, as to the top of a column or of a
  table's cell beside the last, and where a field it holds comes between, so that no block lies
  over the field (`blocksOf`); a superscript, or an accent raised over a capital, goes up less.
  The SVG draws each block as a box with no paint, under every glyph, that carries the part's id,
  and each glyph and rule of the part carries it too (`data-locked`), a box of colour among the
  rules, as a field's glyph carries its field's: the pointer between a part's words and lines,
  and over its rules, is over the part, and over a glyph of anything else it is not.
  `DrawnPage.locked` holds each part, in the order the output first sets it, with its blocks on
  the page drawn, none where it is on another page or kept nothing.

### The lock

- **On hover.** The pointer over a part marks each of its blocks with a dashed grey outline and a
  faint tint, and puts above the first a padlock and one line: "Kept as it was; remove or move it
  from the side panel" (`LOCKED_TIP`). Off the part, over a field's glyph, the page's white or
  off the page, it goes. The lock takes no pointer, so what lies under it is clicked as it would
  be, and it never looks like a field's overlay, whose outline is solid and green. It lies under
  an open field's overlay, its bar and its pickers, which come after the page at the same height,
  and the line moves left as far as it takes to end within the page.
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
  page recompiled after it as after any command, but for a step the template stops after (below).

### A step that stops the compile

- **Check 3 pins a part against a step that stops it.** The review found a part that holds the
  closer of a list a section above it opens, which decision 0038 leaves in a locked part where no
  answer names the list's opener: removing the part, or moving it above that section, stops the
  compile, and the step was offered, applied and saved, so that after a reload the document no
  longer opened, and undo was gone with the session. Check 3 now takes each locked part's
  removal, and its move one place up and one place down where a section stands there, as the
  panel's buttons take them, under the package as though it pinned none, and compiles each: a
  step that stops pins the part against it. The package records the steps by the part's id, in
  the order remove, up, down (`pinned`, additive beside `fixed`), which changes its id as `fixed`
  does. `applyUnder` refuses a pinned step (`CommandError`), so the history makes none, and the
  part's row disables the button, which says why when pointed at, in plain words (`PINNED`): "The
  template stops without this part, so it stays", "The template stops if this part moves up", or
  "… moves down".
- **Only a part that may stop the compile is tried** (`unbalanced`): one that ends an environment
  it did not begin or begins one it does not end, or does so with a group, `\begingroup` or
  `\bgroup`, once each of the document's own macros it calls is expanded one level through its
  definition as the signatures read it, through the kernel's wrappers around a command with an
  optional argument or a robust one, so that a `\skillsEnd` defined as `\end{itemize}` closes a
  list; its comments are passed over, and its braces balance already. A part that ends whatever
  it begins cannot stop the compile so and is not tried, so that the trials cost up to three
  compiles a round for each part that may: the fork of Jake's Resume the editor's test imports,
  whose two parts each end what they begin, makes 40 compiles again, as before the trials, where
  it made 44 with them.
- **Every structural step is saved only once it compiles.** Check 3 tries the document as
  imported, and a step it does not try may stop the compile too, as the list's section moved below
  the part that closes its list. So the app keeps every structural step, one that adds, removes or
  moves a node or sets a section's role, from the store until a page shows its structure, and what
  is typed after it with it (`StructureGuard`); an undo or a redo that changes the structure is
  held alike. An edit of a field's text is saved at once, as before (decision 0010). When the held
  step's compile stops (`CompilerEvents.stopped`, which comes before the compile's error), the
  step is taken back, with every edit since, to the last document a page showed, which the store
  still holds: the page shows that again, and the message line says "That change stopped the page
  from being made, so it was taken back." (`TAKEN_BACK`) in place of the compile's message. Redo
  does the step again, held again. So a saved document always has a page, and a reload never opens
  one that stops.
- **What the user sees of any other compile that stops**: the page as it was, and the message
  line's `COULD_NOT_UPDATE`, "The page could not be updated."; TeX's error and its log go to the
  console alone, for developers, so that the user never sees LaTeX.

### What a locked part can and cannot do

It is drawn where the original drew it, the real output; is named in the side panel; shows its
lock on hover; and is moved up and down among the sections, and removed, each step undone, but
for a step the template stops after, which the panel does not offer. It opens no overlay, plain or
rich; takes no text command, role, entry, item or bullet (decision 0025); takes no focus; and shows
nothing of its LaTeX anywhere.

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
  part the field's, a part a page breaks, a native run's `.notdef`, a part nested in another's span,
  one whose start TeX wrote alone at the foot of the page before, cells side by side on a page a
  part starts on, a part whose end comes first keeping its own runs and one that never ends
  keeping nothing, and two parts two columns break across pages each keeping its own column's
  runs; none of another column a part's markers hold where it sets nothing of its own beside it,
  nor of the column beside a part that starts at its column's top, while a row of cells at a
  page's top, whose next row comes back to the column, stays whole; none of the column beside the
  page between a part's first and its last; and none of the first column before the end of a part
  set out of order at the second column's top. On the engine, the reviewers' invented documents,
  each part keeping every glyph it owns, page by page, and drawn as the part's: a table of rows of
  two cells whose heading goes to the next page or which a page breaks between its rows, a list
  in two columns, a part broken in paracol's first column beside the second, and a part paracol
  sets out of order, its own text set in typewriter so that its glyphs are known; the oracle
  review's two, a `\newpage` in a part at its column's foot and a part paracol sets out of order
  from its column's top, each beside the second column's field and words in sans serif, which
  each keeps none of (both kept those columns before the fix, 1,049 glyphs and 1,151 besides 358
  of the first column's); and a field a macro of the part sets between two of its lines, which no
  block covers, and the part's rule and box of colour, marked.
- **The DOM** (`src/page/Page.dom.test.tsx`, jsdom), with the page and the overlay put together as
  the app puts them: the lock on hover over a part's glyph and block and none off it; a click on
  either opening nothing with no field open, with the plain overlay open and with the rich editor
  open, each left on its field as it was; the tab order passing the part and its lock by, and a
  tab stop, given one, found; and the lock placed where the SVG draws the part, under an open
  overlay, its line moved left to end within the page.
- **A step that stops the compile.** On the engine (`src/import/run.test.ts`), the review's
  invented fork of Jake's Resume, its skills list opened after the section's head by a macro of
  its own that no answer names and closed by another, with a section after it: check 3 pins the
  part that holds the closer against its removal and its move up, and leaves its move down, and
  pins nothing else; `applyUnder` refuses both and takes the move down; and through the compiler,
  the store and the guard wired as the app wires them, the list's section moved below the closer
  is never saved, its compile stops, and it is taken back, the page the first's to the byte and
  the store's document the one opened, while the closer moved down is saved once its page comes.
  With the fake compiler (`src/import/validate.test.ts`), a part that closes a list through the
  document's own macro pinned against the steps that stop, the package's id changed, and none
  pinned where every step compiles; a part that ends whatever it begins, a page break alone or a
  macro that begins and ends a list, never tried; `unbalanced` over closers and openers, groups,
  the kernel's wrappers, comments and data; the schema
  (`package.test.ts`); `applyUnder` and the history (`document.test.ts`); the part's row, its
  buttons disabled with their reasons and the other sending its step (`Panel.dom.test.tsx`); the
  guard (`guard.test.ts`): a field's edit saved at once, a structural step held with what comes
  after it until a page shows its structure, taken back to the last page shown when its compile
  stops, an undo or a redo of structure held alike, and nothing held once another document opens;
  and the compiler's `stopped`, of the document that stopped and before its error, and none for a
  page that fails to draw (`compiler.test.ts`).

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
  held before it there, and what its own first column sets after it from later in the source.
- **Where the geometry cannot tell a column from a cell.** The page reads columns from where the
  output goes back up and where lines start, not from TeX's boxes, which the reading of the output
  does not keep. A part whose run on a page is one line at its column's top reads the other
  column's first line, level with it, as the rest of that line, and keeps it; and a part that
  starts a page with one row of cells side by side, no row after it there, loses the cell beside,
  read as another column's top.
- **A part that ends what it begins may still stop the compile**, as one that defines a macro the
  sections after it use, when it is removed or moved below them: check 3 does not try it, and the
  guard takes such a step back.
- **A part past the first page** is named in the panel, and shows its lock once the editor draws
  its page, which it does not yet.
- **Steps tried where the import put the part.** Check 3 tries a part's steps in the document as
  imported, and the panel moves a part one place at a time. Once other sections have moved around
  it, a step check 3 let through may stop the compile, which the guard takes back, and one it
  pinned may compile, which the panel still refuses.
- **A step whose page has not come** is not saved yet: a tab closed, or the list or another
  document opened, in the second its compile takes loses it, and what was typed after it.
- **Touch.** The lock shows while a finger is on a part, and goes when it lifts.

## Consequences

- `DrawnPage` gains `locked`, which a page a test builds by hand gives empty, and `GlyphBox` gains
  `locked`, the part a glyph is of; `LockedShown` gains `section`, and `Template` `report`.
- The page's element holds its SVG in an element of its own and is positioned, for the lock; a
  field's overlay is placed in the sheet around it, as before.
- Every format is dumped once more, under its new name (above); no document changes, and no
  package but one with a part check 3 pins.
- `TemplatePackage` gains `pinned`, so an import with a pinned part has another package id than
  before, as a kind marked `fixed` gives it; `CompilerEvents` gains `stopped`. A structural step
  is saved once its page comes, a compile later than before.
