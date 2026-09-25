# 0004. The overlay breaks lines the way TeX does

Date: 2026-09-17 · Status: proposed

## Context

Decision 0003 measured the editing overlay against the typeset page: on the same line the
overlay's characters sit within a few points of TeX's glyphs, but the browser and TeX break
a three-line bullet differently, which moved 7 of 204 glyphs to another line and shifted
words by up to 36 pt. The plan foresaw this and named the fix: the overlay gets its own line
breaker using the TeX font metrics. This record says how, and what it measured.

## Findings

`apps/editor/src/tex/linebreak.ts` ports TeX's `line_break` (tex.web §813–890: the active
list, fitness classes, demerits, the three passes with `\pretolerance`, `\tolerance` and
`\emergencystretch`) over a list of boxes, glue, kerns, penalties and discretionaries, and
builds that list from a field's text with the font's TFM widths, its ligature and kern
program, and TeX's space-factor rules for the glue after punctuation. Hyphenation is a hook;
nothing hyphenates yet.

| Question | Answer |
|---|---|
| Does it break where TeX did? | Yes. On the spike's three-line bullet, read back from the DVI, the breaks fall at the same character offsets and every line's set width matches TeX's to the scaled point, including the second line, which TeX shrank by 1.46 pt to fit |
| Overlay drift with TeX's breaks, three-line bullet | 0 of 204 glyphs on a different line; horizontal shift at most 0.99 px, 0.35 px mean; baseline within 0.5 px. Against 7 glyphs, 35.5 px and 3.1 px with the browser's breaks |
| What the browser still gets wrong within a line | Nothing measurable here. The web font is built from the same outlines, so advances agree; kerns and ligatures TeX applied are absent from the web font, which is where the remaining fraction of a pixel comes from |

## Decision

- The overlay does not let the browser wrap. It sets each field as explicit lines broken by
  the TeX breaker with the field's font metrics, with `white-space: pre`, and sets each
  line's `word-spacing` to the glue TeX set: the line's shortfall shared between its spaces
  and its skips as TeX's `hpack` shares it, by the stretch of the highest order of infinity
  there is, or an excess by shrink. So nothing goes to the spaces of a ragged line or of the
  last line of a justified one, where fil glue takes it all; a justified line's spaces take
  it all; and a finite `\rightskip`, as ragged2e's `\RaggedRight` has, shares it with the
  spaces, or takes it all when `\spaceskip` has made them rigid. The lines tile the text:
  each runs from where the previous one stopped to the first character of the next, so the
  space TeX broke at, leading and trailing whitespace and characters the font has no glyph
  for all stay in the field. While the user types, every input event rebuilds the text from
  the element, re-breaks it and puts the caret back, so the overlay always shows the breaks
  the next compile will produce. Offsets are UTF-16 indices throughout, since that is what
  the DOM and the model slice by. Enter inserts nothing: a field is one paragraph.
- The breaker needs the paragraph TeX set the field in: the `\parshape` (or `\hsize` with
  hanging indentation), `\leftskip`, `\rightskip`, `\parfillskip`, the tolerances,
  `\emergencystretch`, and `\spaceskip` and `\xspaceskip`, which replace the font's glue
  between words when they are not zero. The spike hard-codes the values measured inside
  Jake's `\resumeItem` (`\parshape 1`, `\@totalleftmargin` 34.93 pt, `\linewidth`
  507.09 pt, `\raggedright`). The template package will carry them per field: the
  generated LaTeX emits them next to the field's begin marker, as a second `\special`
  written with `\the` of each parameter (e-TeX's `\parshapeindent` and `\parshapelength`
  for the shape), so they are measured by TeX rather than derived from the template by
  hand. Space-factor codes are LaTeX's defaults unless the template changes them, which
  the probe step can detect.
- A field that starts mid-paragraph, after other text on its first line, gets its first
  line's available width from the position of its first glyph on the page, less where the
  line starts. That is the paragraph's left edge and the line's indent, and the edge comes
  from the field's second line when the page shows one, since every line after a
  paragraph's first starts at the edge and its own indent. A field the page shows on one
  line takes its line's start from the leftmost glyph or rule on its baseline within the
  line's width, never more than `\hsize` back; a list's label hung in the margin, an indent
  box, which draws nothing, and a column beside it that shares the baseline still mislead
  that guess, until the field grows onto a second line and the next page says where the
  edge is.
- A field is measured in its letter font, the font that sets the most of its letters and
  digits on the page, whatever font its first glyph is in. A character that font lacks costs
  what the first of the field's other fonts that has it sets it at, as LaTeX sets `€`, `×`
  or `•` from TS1 in a T1 paragraph, as a box of its own outside any ligature or kern; the
  browser draws it in its serif. `…` costs LaTeX's `\textellipsis`, three periods each
  followed by a kern of `\fontdimen3`, and a character none of the field's fonts has costs
  nothing, as in TeX. Characters that reach a glyph through a ligature in TeX but sit in the
  text as one character (`–`, `—`, curly quotes) are mapped to that glyph's code, so they
  cost what the ligature costs.
- A no-break space, which the generator writes as `~`, is `\nobreak` and a normal space, so
  the overlay never breaks there, and the characters the generator leaves out, U+FEFF and the
  zero-width space among them, cost nothing and never break.
- Hyphenation stays a hook until a template needs it. TeX hyphenates only on its second
  pass, when the first pass finds no feasible break; a resume bullet on a ragged-right
  measure almost never reaches it. When one does, the overlay's break will differ from the
  page's until the compile lands, which is the fallback decision 0003 already accepts.

## Consequences

- `src/tex/tfm.ts` now reads the ligature/kern program and the font parameters, which the
  renderer will also want for kerning the SVG's glyph runs from the DVI's own positions. It
  checks that a TFM's tables add up to its length, and the ligature program runner stops a
  program that never settles, since fonts will come from a CDN and from uploaded templates.
- The port charges `\finalhyphendemerits` at the paragraph's end the way tex.web §873
  does (the final break is tried as a hyphenated one); the review found that a first draft
  did not, which moved a break in a justified paragraph ending in a hyphenated word.
- The generated LaTeX grows a second special per field. The marker macro in the spike
  (`\rtfield`) does not emit it yet.
- The overlay reads that special (milestone 2, item 9): a field breaks with the `\parshape` or
  hanging indentation, skips, tolerances and emergency stretch TeX measured where it begins, and
  one that starts after other text on its line loses the distance from the line's start to it.
  The breaker's work grows with a shape's length, so it is given at most 64 lines of one,
  which no resume paragraph reaches.
- The overlay closes on Escape, when it loses the focus, and when the document no longer has
  its field, never because a page lacks the field: that page may be the compile of older text,
  such as an emptied field a template leaves out while the user types its replacement. It then
  keeps its place from the last page that showed the field until a page shows it again.
- The web fonts should be built with the TFM kerns and ligatures as GPOS and GSUB tables
  once the OpenType writer exists, so the within-line drift goes to zero too.
- Rich fields (milestone 2, item 10) break the same way, shown through ProseMirror decorations: a
  `<br>` widget where TeX ends each line and each line's `word-spacing`, with every run measured
  in the font the page sets its variant in, and with the italic corrections LaTeX's `\textit` and
  `\textbf` add at their edges.
