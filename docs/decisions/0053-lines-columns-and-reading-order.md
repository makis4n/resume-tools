# 0053. Lines, columns and reading order

> Accepted by 00YY: two columns on one grid of baselines read as a table is a known limit,
> not chased in milestone 3.

Date: 2026-10-04 · Status: accepted; two columns on one grid of baselines read as a table is accepted by 00YY

## Context

Item 11 of `docs/milestone-3-overhaul.md`: rules, always, do a PDF's geometry, whoever then says
what each line is (item 12 by rules, item 13 by the hosted model). Runs become lines and lines
become blocks; columns are found from the gaps between them and read one after the other; a
bullet's glyph marks a bullet; an icon is dropped and its drop noted; a hyphen at a line's end
joins its word only where the next line carries on in small letters. The spike of item 3 (decision
0051) wrote a first cut of these rules in `scripts/spike-pdf/layout.ts`; this item makes them the
editor's.

## Decision

**Where.** `apps/editor/src/pdf/layout.ts`, pure functions over the reader's output (item 10,
decision 0052): `layOut(read)` gives the lines and blocks in reading order, each page's columns,
the links, the body's size, the icons dropped and the hyphens joined. It loads no pdf.js and
touches no DOM, so it runs in the page, in a worker or in Node alike. The spike's scripts lay out
through it (`scripts/spike-pdf/layout.ts` re-exports it), as they read through item 10's reader.

**The rules**, the spike's, kept as they were except where marked *new*:

- **Rows.** Runs whose baselines are within 0.45 em of the smaller run's stand on one row. *New:*
  a run joins the row whose baseline is nearest, not the first near enough. Before, on AltaCV's
  built-in PDF, a bullet's text 4.4 pt below a row of the other column joined that row and left its
  glyph alone on a row of its own, where it was dropped, so the line lost its bullet.
- **Pieces.** A gap wider than 1.2 em (10 pt at least) cuts a row into pieces, so that a title and
  the date at the row's end are two lines. A bullet's glyph stays with the text after it.
- **Columns.** A region splits in two at the tallest vertical band of gap that spans a quarter of
  its height with three rows on each side, where the right side's pieces mostly start at one edge,
  as a column's do, and the two sides do not mostly stand on each other's rows, as a table's cells
  and a title's date do. Each side is split again, three deep at most. The region is read above
  the band, the left side, the right side, then below: a header across the page first, then each
  column whole, one after the other.
- **Lines.** A row's next row carries on its paragraph or bullet when it stands right below in
  its column, alone on its row, in the same size, starts where the text above starts, and the row
  above is full, too short for the next row's first word. A hyphen at a row's end (`-`, U+2010 or a
  soft hyphen) joins its word without it only where the next row starts with a small letter; else
  it is kept, with no space. Letter-spaced capitals (`S U M M A R Y`) lose their spaces.
- **Bullets.** A line is a bullet when a bullet's glyph (`•`, `◦`, `▪`, `‣`, `–`, `*` and their
  kin, or any one glyph of a dingbat font) stands first on its piece, when a drawn dot stands just
  before it at its height, as a browser draws one, or when it starts with such a glyph and a space.
- **Icons.** A run in an icon font (Font Awesome and its kin, by the font's name), and pictographs
  and private-use characters in any run, are dropped. *New:* each line notes the icons dropped from
  its rows (`icons`), those after a row's last text on its last line, and the layout counts every
  icon dropped, a row of icons alone among them, which the spike missed.
- **Blocks** (*new*). A line stands in the block of the line before it in reading order when both
  are on one page and in one column, and they share a row, or the line stands right below with no
  long rule between them, in about its size (within 15%), and with a gap no wider than 0.6 em or
  1.3 times the gap its column usually leaves between two lines, whichever is wider. A block is
  then a paragraph, an entry with its bullets, a run of contacts, or a heading set apart. Each line
  knows its block, and each block its lines, page, column and box.

**The proof on AltaCV.** `src/pdf/layout.test.ts` compiles the built-in AltaCV template with its
invented sample, makes the PDF as the editor exports one and lays it out: the name and the
contacts come first, across the page; then the left column whole, Experience, Education, Projects,
with every bullet of its entries; then the right column, About, Skills, Languages, Awards,
Interests, the order AltaCV's snippets set them (a section whose snippet switches to the right
column stands in it). No line merges across the gap: every line of the left column ends before
any line of the right begins. Jake's and Awesome-CV's PDFs read in one column, their sections in
the sample's order, and the eight PDFs of other tools in the columns each has, each column read
whole: Chrome's left sidebar before its main column, its right sidebar after.

**The spike's scores did not move.** `spike-pdf builtin` and `spike-pdf other` give, field for
field, what decision 0051 recorded: 96.5% of fields on the built-in templates and 91.9% on the
other tools' PDFs by rules, and the model's recorded labels file as before. The bullet that the
nearest row now keeps was already filed as a bullet by the spike's filing step.

**The corpus, laid out by rules** (counts only, never text). `spike-pdf corpus --out pdf-layout`,
run on 4 October 2026 over the 220 fetched documents, keeps its counts under
`.corpus/pdf-layout/` and leaves the spike's own run and `results.json` as they were.

| | |
|---|--:|
| Documents | 220 |
| Read: compile, xdvipdfmx makes a PDF, within the reader's caps | **73**, 148 pages |
| Not read | xdvipdfmx made no PDF 42; refused by the reference compile 103; past the reader's caps 2 |
| **Documents by the most columns found on a page** | **one 57, two 16, three or more 0** |
| Two columns, by family | altacv 7 of 8, europecv 5 of 5, other 4 of 17; awesome-cv, jake, moderncv none |
| Pages with more than one column | 22 of 148 |
| **Lines; blocks** | **6,202; 1,934** (85 and 26 a document on average) |
| Icons dropped; hyphens joined | 411; 120 |
| Laying out and the spike's rules for labels and filing, a PDF: median, max | 9 ms, 57 ms |

The column counts are the spike's (decision 0051: one 57, two 16). The changes above moved its
other counts a little: words in a recognised place 97.7% (44,410, 9 more than the spike's), the
catch-all 1,077 words (10 fewer), every word landing in 73 of 73; and 411 icons counted where the
spike counted 379, the 32 more being icons after a row's last text, which it missed.

## Consequences

- Item 12 labels and files these lines: it gets each line's text, size, weight, position, row,
  column, rule, links, bullet, icons and block, and the blocks around it.
- Two columns set on one grid of baselines read as a table, row by row, as one column: the rule
  that keeps a title and its date, or a table's cells, on one row cannot tell them from columns
  whose rows line up. Pieces still split at the gap, so no line merges across it, but the order
  interleaves the columns. europecv's label column, read as a column, is the reverse case.
- Letter-spaced capitals keep no word boundary (`WORK EXPERIENCE` reads `WORKEXPERIENCE`), since
  pdf.js gives a letter's gap and a word's the same space; glyphs' own positions would be needed,
  which the reader does not give.
- Blocks are geometry only. A word processor that sets headings with little space before them
  (AppKit's text system) gives fewer, longer blocks; AltaCV's larger entry titles stand in blocks of
  their own. Item 12 decides what a block means.
