# 00XX. A field ends after the text's own corrections

Date: 2026-10-07 · Status: accepted, lane M of the markers-and-transform run; changes the field
macro of decision 0007 and its update of 27 September, takes up the prototype of decision 0077,
and settles what decision 0022 left of the italic correction and microtype

## Context

The probe keeps a candidate as `moved` when its marked page is not the reference's. Decision 0077
found that of the 1,789 words kept so for a glyph's `position`, 1,458 move for one part of the
marker macro alone, not for where the markers stand: (a) the end marker between a field's last
glyph and the italic correction LaTeX adds after it, 559 words in 27 resumes; (b) microtype's
`\leftprotrusion` at an item's start, which reads `\rtfield` as a command it does not know, 548 in
11; (c) XeTeX's margin protrusion at a line's start, which stops at the begin marker, 302 in 6;
and (d) the prelude's own `\/` inside a slanted text command, where LaTeX sets none, 49 in 7. Its
prototype of a new macro won 1,186 words on 49 resumes and lost 27 on three, for reasons not then
understood. The owner settled on 7 October that one macro serves everyone, the built-in templates
included, with no versioning, since no one uses the app yet: a built-in page may change only
toward its unmarked compile.

## Decision

### The prototype's three losses

The prototype kept the italic correction of a field's last glyph in a global dimension and gave it
back through LaTeX's `\@@italiccorr` wherever the list ended in a whatsit. Run again on the three
resumes on main (`6167a5e`), counts only, it lost the same words: `other-0004` 18, `other-0020` 7
(XeTeX) and `altacv-0008` 2, each more `moved` for `position`. Variants of it, each over the three:

| Variant | other-0004 | other-0020 | altacv-0008 |
|---|--:|--:|--:|
| The prototype | −18 | −7 | −2 |
| Its italic correction alone | −18 | −7 | −2 |
| Its microtype part alone | 0 | 0 | 0 |
| The kept correction cleared after every `\maybe@ic` | −18 | −7 | −2 |
| A correction kept only inside a text command | +14 | 0 | 0 |
| A colour special clears the kept correction | +14 | 0 | 0 |
| XeTeX's own `\/` where its text ends the list | −18 | 0 | −2 |

So the loss is the kept correction of a field that ends outside any text command, where LaTeX
never corrects, which nothing cleared:

- **`other-0004` and `altacv-0008`, pdfTeX.** A field outside a text command ends in a glyph that
  has a correction; a colour special follows (xcolor's `color push`), and then a text command,
  whose correction at its start (`\check@icl`) finds the special last. TeX's `\/` sets nothing
  after a whatsit, and the prototype set the kept kern there: the text command's text moved.
- **`other-0020`, XeTeX.** The same kept correction, a colour change, and then XeTeX's text, which
  XeTeX sets as whatsits. The next text command's correction took the kept kern in place of the
  correction of XeTeX's last glyph, which `\/` would have set.

Two invented look-alikes, one in each engine, move under the prototype and not under the new macro
(`prelude.test.ts`, "the prototype's pdfTeX loss" and "the prototype's XeTeX loss").

### The macro

- **Nothing is stored; the end marker waits.** A field's end (`\rt@f@end`) holds its end marker
  back and reads the next token, past the end of a simple group, which sets nothing, as
  `\small{...}` and `{\itshape ...}` close round a field. Where it is the `\check@icr` of a text command whose argument the
  field ends, that runs and the marker comes back after the group, behind LaTeX's `\maybe@ic`.
  Where it is one of LaTeX's text commands, after a space or none, whose text is not empty and
  does not start with `\nocorr`, the marker waits for that command's `\maybe@ic` at its start.
  Where a text command inside the field ends it, its `\maybe@ic` reads past the field's end. Each
  time LaTeX decides on the token the unmarked page has there, its own `\/` corrects the glyph
  that ends the list, since the marker is not on it yet, and only then is the marker written.
  Anything else writes it at once. The held markers are global, to pass the group's end, and are
  written and cleared before the text after them is set, whether LaTeX corrects or not: no state
  outlives the text command, and no correction is ever set but by TeX's `\/`. LaTeX's `\maybe@ic@`
  is wrapped, its decision kept as the kernel has it.
- **The prelude's own `\/` goes** (d): LaTeX decides past the field.
- **microtype** (b): `{R\rtfield}` joins `\MT@prot@check@cmds`, guarded by `\ifdefined`, so that
  `\leftprotrusion` goes to the start of the field's text, after the markers, and protrudes the
  same glyph by the same kern; inside a text command, which microtype sets again after its kern,
  it reads on past the field's id.
- **XeTeX's line-start protrusion (c) is out of reach.** On an invented look-alike, a field that
  starts a line with microtype's protrusion on sets every glyph where its unmarked page does in
  pdfTeX, whose margin kerning passes a whatsit, and moves its line in XeTeX, which stops at the
  begin marker. No macro can put the begin marker after the line's first glyph, and none moves it
  out of the line without moving it out of the field's order on the page. Its words stay `moved`.
- Every new macro is `\protected`, and draw.ts reads nothing new: nothing comes between `rt:b:` and
  `\rt@par`. The names are `\rt@f@...`, since the Awesome-CV port's class has an `\rt@end`, an
  `\rt@next` and an `\rt@do` of its own. A token read ahead may be `\fi`, where a class sets a field
  in a conditional's branch, as the letter class's `\signature` is: it is compared and never left
  in skipped text, where it would close the conditional. A first version did, and broke one
  candidate each in `other-0030` and `europecv-0008`.
- **What still moves the page**: a field followed by anything but a space before the text command
  whose start corrects it, as a tie, or by a command a document defines that corrects it; XeTeX's line-start protrusion; the
  begin marker's `\leavevmode`, which starts a paragraph where the field does (decision 0003; in
  the Awesome-CV sample it moves the colour special of a section's title into its line, and no
  glyph); and microtype's `\leftprotrusion` at the start of an item's later paragraphs, which reads
  the `\leavevmode`.
- `rich.ts` follows: the last run's closing correction is decided on what the template sets after
  the field (`breakRuns`' `after`), a command by default, which corrects as the space, `\par` or
  brace that follows a rich field in the built-in templates does. Before, the end marker stood
  there, and the model took it for a command.

### Tests

- `prelude.test.ts`: for each cause, an invented look-alike whose marked page sets every glyph, rule
  and special where its unmarked compile does, and which the macro it replaces moved: (a) after a
  field that is a text command's argument, decided past the field's end, and at the next text
  command's start, after a space, none or a group's end; (d) in pdfTeX, and with (a) in XeTeX; (b)
  an item's first glyph; each of the prototype's two losses; and a field that ends a conditional's
  branch. (c) is pinned as it is: equal in pdfTeX, moved in XeTeX. Then every built-in template's
  sample compiled marked and unmarked from its format: `jake: marked = unmarked, 950 glyphs; main's
  macro moved them`, `altacv: marked = unmarked, 1253 glyphs`, `awesome-cv: marked = unmarked, 1693
  glyphs`, glyphs and rules at the same places and the same specials in the same order.
- `probe.test.ts`: `cvslant`, `\textit{#1}.`, is editable now; a field corrected by a document's
  own command, `{\itshape #1} \cvbold{...}`, is the one kept `moved`, and the uncovered glyphs'
  test uses it.
- `rich.test.ts`: the last run's correction by what follows the field.
- The oracle's pinned shares are unchanged; Jake's upstream sample imports in 27 compiles, as on
  main, in 4.06 to 4.11 s against 4.04 to 4.06 s on main, run back to back.

### Measured

Over `moved-top.txt` and the three losers, 48 resumes, against main's run: words in place 36,207
to 37,425 (+1,218); no resume worse in outcome or words; `moved` for `position` 1,760 to 658 and
for `rule` 10 to 0, `transform` 383 as it was; successes 22 to 27, resumes at 90% 24 to 29; all
compiles 2,845 to 2,527.

Then over all 220 documents: see below.

## Consequences

- The prelude is dumped into every format, so every format's name changes and each is dumped once
  again. Jake's built-in pages change where a bold field before a colon took no correction: they
  now set the correction, as the unmarked page does. AltaCV's and Awesome-CV's set every glyph as
  before.
- The macro wraps LaTeX's `\maybe@ic@` and adds to microtype's list of commands, both internals; a
  newer LaTeX or microtype that renames them leaves the markers where they were, and the new tests
  fail.
- The change reaches every import's compile, so a corpus run is worth doing, by the owner's choice:
  `gh workflow run corpus.yml --ref waikin/marker-macro`. It moves the probe's verdicts and its
  compiles.
