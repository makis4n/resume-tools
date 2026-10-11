# 0086. Reading-order checks

Date: 2026-10-12 · Status: accepted

## Context

Milestone 1 (`docs/ats-prd.md` §13) lists reading-order checks. Two common layouts make an ATS
extract a resume in the wrong order or lose words: side-by-side columns whose lines are drawn
alternately (left line one, right line one, left line two, ...), which an extractor joins into one
run of mixed text; and words split across lines with a hyphen, which an extractor reads as two
fragments. Decision 0032 fixed pypdfium2 as the only extractor, and decision 0083 fixed the
finding conventions: stable ids, `warning` severity for layout problems, "many ATSs/may" wording.

## Decision

- **Source.** Reading order is read from pypdfium2's text rects (`PdfTextPage.get_rect`), in
  extraction order, with no second extractor (0032). `ats.extract.Page.text_rects` carries
  `(left, bottom, right, top)` per rect, geometry only. It is read only on pages within
  `_CHAR_BUDGET` (there are never more rects than characters, so the budget already bounds the
  work); a page over budget gets `()` and no reading-order check.
- **Segments.** Chrome/Skia PDFs make one rect per glyph, so consecutive rects merge into line
  segments when their vertical ranges overlap by at least half the smaller height and the
  horizontal gap lies between -0.5 and 1.0 times the larger height (`_SEGMENT_JOIN_FACTOR`): a word
  space is about a quarter of the height, a column gutter is well over it.
- **Lateral step.** From segment a to the next segment b, when `b.left - a.right >= 18` points
  (`_MIN_GUTTER_PT`: wider than any word space, narrower than a real gutter) and their vertical
  centres differ by at most 1.5 times the larger height (two columns set independently have
  offset baselines).
- **Chain.** The longest run of lateral steps that alternate strictly (the left segment of each
  step comes straight after the right segment of the one before), where each left segment sits
  lower than the previous (by at least half its height) and all gutters share one x-band.
  A page whose chain reaches `_MIN_INTERLEAVED_LINES` = 4 fires `column-interleaving`.
- **Fill and width.** A chain counts only if, for its left segments and for its right segments
  alike, at least 3/5 are filled (right edge within the right 12 percent of that side's extent,
  `_FILL_FRACTION`) with no two unfilled ones in a row, and the median width is at least 150
  points (`_MIN_COLUMN_WIDTH_PT`). The last line of a paragraph or bullet is short, so a lone
  unfilled segment is allowed; a skills grid's short cells, right-aligned years, key/value labels,
  date columns, school/city rows and ragged one-line cells are not. At least 3/4 of each side's
  segments must also start within 3 points of one of that side's two commonest start x positions
  (`_LEFT_EDGE_TOLERANCE_PT`, `_MIN_ALIGNED_RATIO`): wrapped prose starts every line at one x, a
  bulleted list at two (the bullet and the hanging indent), a right-aligned cell at many. A bullet
  or number mark drawn apart from its text (no wider than the line height, text within twice the
  height on the same line) is merged into that text first (`_join_markers`), so a list item is one
  segment. A chain that breaks its band restarts at the step that broke it, which keeps the work
  linear; the fill test is made on the whole chain.
- **Calibration.** Synthetic: interleaved prose 7/7 (fires), with offset baselines 7/7 (fires),
  cleanly ordered two columns 0, single column 0, right-aligned dates 1, a skills grid of five rows
  with two filled cells 0, bulleted columns of 3-line items with a hanging indent 12/12
  (fires), ragged one-line cells 0. The eight committed editor spike PDFs (`chrome-icons`, `chrome-table`,
  `chrome-one-column`, `chrome-sidebar`, `chrome-right-sidebar`, `textedit-rtf`, `textutil-table`,
  `textutil-html`) all score 2 or fewer, below the threshold. They were a one-off calibration;
  tests do not read anything under `apps/editor`.
- **Hyphenation.** PDFium turns a hyphen at the end of a line into U+0002 and joins the two lines
  with no break ("distri\x02buted"), whatever the next line starts with. A mid-line hyphen, or a
  hyphen followed by a jump to another column on the same line, stays `-`. `hyphen_break_count`
  counts a letter, U+0002, then a lowercase letter, computed from `Page.text` with one compiled
  regex for every page. A line-end hyphen before a capital or a digit (such as a name or a date
  range) is not counted. `hyphenated-line-breaks` fires when the count is above zero. PDFium also
  writes U+0002 for the hyphen of a real compound (`user-` / `facing`), so the count cannot tell it
  from an automatic break; the message and suggestions say so and advise rewording the compound,
  because turning hyphenation off does not clear it.
- **Findings.** Both are `warning`, origin `layout`, with a page, and both ids are stable (0083).
  Neither message quotes resume text. Both run only when the document has a text layer.
- **Versions.** `RUBRIC_VERSION` stays `readiness-1`: these are new checks that were silent before
  and do not change any existing fixture's result (0083). The analyser goes to 0.2.0, because a
  new check changes the response.

## Consequences

- Known limits. Columns of one- or two-line items (half or more of the lines short) cannot be told from a table of ragged cells and are
  not detected. A table whose rows are single lines of near-equal width at one left x, drawn row by
  row, cannot be told from wrapped prose by geometry alone and may still fire. Other out-of-order cases, such as shuffled text boxes jumping up within one
  column, are not detected and are later work. A producer that writes both columns in one text run
  gives one rect that spans the gutter, so the check misses it. Pages over `_CHAR_BUDGET` get no
  reading-order check. Fonts so large that a word space exceeds 18 points could merge columns.
- `Page.text` still contains U+0002; joining hyphenated words before matching is milestone 3's
  concern.
- Under PRD §12.1, a curated LaTeX template that hyphenates or interleaves would now fail the
  validation gate. That is a follow-up for the editor's owner (@makis4n) and is not changed here.
- `keaen/contact-sections` also moves the analyser to 0.2.0; whichever branch merges second takes
  0.3.0 when it is rebased.
