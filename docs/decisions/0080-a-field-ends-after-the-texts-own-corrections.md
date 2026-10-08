# 0080. A field ends after the text's own corrections

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

- **Nothing is stored; the end marker waits.** A field's end (`\rt@f@end`) first takes the italic
  correction of the field's last glyph, as `\/` sets it, and off again. Where it is none, LaTeX's
  own `\/` would set a kern of nothing there, and the end marker is written at once, as most fields'
  are. Where it is some, the end marker is held back, and what follows is read, past spaces and the
  ends of simple groups, as `\small{...}` and `{\itshape ...}` close round a field, which set
  nothing a correction cannot pass and are put back as they were. Where it is the `\check@icr` of a
  text command whose argument the field ends, that runs and the marker comes back after the group,
  behind LaTeX's `\maybe@ic`. Where it is one of LaTeX's text commands whose text is not empty and
  does not start with `\nocorr`, the marker waits for that command's `\maybe@ic` at its start. Where
  a text command inside the field ends it, its `\maybe@ic` reads past the field's end. Where it is
  the text's own `\/`, as a declaration's group `{\itshape #1\/}` sets it, that corrects, after
  what was read past goes back. Each time
  LaTeX decides on the token the unmarked page has there, its own `\/` corrects the glyph that ends
  the list, since the marker is not on it yet, and only then is the marker written. Anything else
  writes it at once. The held markers are global, to pass a group's end, and are written and cleared
  before the text after them is set, whether LaTeX corrects or not: no state outlives the text
  command, and no correction is set but by TeX's `\/`. LaTeX's `\maybe@ic@` is wrapped, its decision
  kept as the kernel has it.
- **Where the held marker goes, and what it waits for** (found by the lane's review). By the time
  LaTeX has decided, the list may end in the correction's kern, and in a space set inside the text
  command, as in `\textbf{\rtfield{c}{...} }`. A marker after them would end the list differently
  from the unmarked page: after a kern, the glue that follows becomes the line's breakpoint, and a
  line broken there keeps the kern, which shifts a justified line's spaces; after a space, `\par`
  and `\\` can no longer take it off, which shifts a centred or ragged line. So the held markers
  go in front of a last space and a last kern (`\rt@f@lift`), and the list ends as the unmarked
  one does. A group's end is read past only where a line's end and a space have their usual
  category codes, since the token after the group is read inside it: under `\obeylines` it would
  be read as a paragraph's end. The marker waits for a text command only where the command is the
  kernel's, its robust wrapper and inside it the declaration, `\check@icl` and the text
  (`\rt@f@kernel`, checked against the kernel's definition, which fontspec, microtype, hyperref and
  moderncv leave as it is, and ulem replaces for `\emph`): a class's own `\emph` that sets a bullet
  before its text gave the bullet to the field before it, and one that drops its text held the
  marker until the next field's end, which the next field's begin marker then stood inside. A
  class's own command now gets the marker at once, and a field's begin writes any marker still
  held, so no marker outlives the next field's start.
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
  in a conditional's branch, as the letter class's `\signature` is: it is compared and never left in
  skipped text, where it would close the conditional. A first version did, and broke one candidate
  each in `other-0030` and `europecv-0008`. A group's end is read by taking it and putting it back,
  never by `\aftergroup`: TikZ's node text ends in a group whose own `\aftergroup` must come first,
  and a version that read past it so stopped AltaCV's `\cvtag` compiles (35 words more `breaks`,
  none fewer in place). And the first whole run found `jake-0035`, whose fork sets
  `\textit{\small{#4}}`, 14 words worse until the group's end was read past: main's own `\/` had
  corrected there.
- **What still moves the page**: a field followed by anything but spaces and groups' ends before the
  text command whose start corrects it, as a tie, or a command a document defines that corrects it,
  or a class's own command of a kernel text command's name;
  XeTeX's line-start protrusion; the begin marker's `\leavevmode`, which starts a paragraph where
  the field does (decision 0003; in the Awesome-CV sample it moves the colour special of a section's
  title into its line, and no glyph); and microtype's `\leftprotrusion` at the start of an item's
  later paragraphs, which reads the `\leavevmode`.
- `rich.ts` follows: the last run's closing correction is decided on what the template sets after
  the field (`breakRuns`' `after`), a command by default, which corrects as the space, `\par` or
  brace that follows a rich field in the built-in templates does. Before, the end marker stood
  there, and the model took it for a command.

### Tests

- `prelude.test.ts`: for each cause, an invented look-alike whose marked page sets every glyph, rule
  and special where its unmarked compile does, and which the macro it replaces moved: (a) after a
  field that is a text command's argument, decided past the field's end, and at the next text
  command's start, after a space, none or a group's end; (d) in pdfTeX, and with (a) in XeTeX; (b)
  an item's first glyph; and each of the prototype's two losses. Two more show the macro where it
  stands: a field that ends a conditional's branch, and one in a TikZ node. Five more come from
  the review, each of which the macro before it moved or miscounted: a line broken right after a
  bold field's correction, at seven widths in pdfTeX and eight in XeTeX; a space a text command
  ends with after a field, at a centred line's end and before `\\` on a ragged one; a field that
  ends a group under `\obeylines`; and fields before a class's own `\emph`, which sets a bullet
  first, and `\textsc`, which drops its text, where each field counts its own glyphs alone and
  the markers stand in order. Three more come from the re-verify: the text's own `\/` right
  after a field, in a text command, a declaration's group and a document's command that wraps
  one, `{\itshape #1\/}`, and after a group's end, in pdfTeX and XeTeX; the first version of the
  macro wrote the marker before it, where it set nothing, and main's did in a declaration's group.
  (c) is pinned as it is:
  equal in pdfTeX, moved in XeTeX. Then every built-in template's sample compiled marked and
  unmarked from its format: `jake: marked = unmarked, 950 glyphs; main's macro moved them`, `altacv:
  marked = unmarked, 1253 glyphs`, `awesome-cv: marked = unmarked, 1693 glyphs`, glyphs and rules at
  the same places and the same specials in the same order.
- `probe.test.ts`: `cvslant`, `\textit{#1}.`, is editable now; a field corrected by a document's
  own command, `{\itshape #1} \cvbold{...}`, is the one kept `moved`, and the uncovered glyphs'
  test uses it.
- `rich.test.ts`: the last run's correction by what follows the field.
- The oracle's pinned shares are unchanged; Jake's upstream sample imports in 28 compiles and 2
  dumps, as on main, in a median of 4.22 and 4.25 s against 4.22 s on main (`measure --import`,
  run back to back at a load of 4.6 to 5.2).

### Measured

Over `moved-top.txt` and the three losers, 48 resumes, against main's run: words in place 36,207
to 37,425 (+1,218); no resume worse in outcome or words; `moved` for `position` 1,760 to 658 and
for `rule` 10 to 0, `transform` 383 as it was; successes 22 to 27, resumes at 90% 24 to 29; all
compiles 2,845 to 2,527.

Then over all 220 documents (`4f5053a`, 6.4 min, against main's run of `6167a5e`): no document
worse in outcome or in words in place, and none timed out. Words in place 72,384 to 73,602 of
82,497, 87.7% to 89.2% (+1,218); successes 69 to 74; resumes at 90% 75 to 80, under 50% 3 to 2.
By family: jake 97.3% to 97.9%, moderncv 87.0% to 91.0%, other 80.0% to 82.5%, europecv 78.1% to
78.3%, altacv 89.6% and awesome-cv 94.2% as they were. `moved` words 2,153 to 1,041: `position`
1,760 in 39 resumes to 658 in 10 (pdfTeX 1,100 to 268; XeTeX 660 to 390, where (c) stays),
`rule` 10 to 0, and `transform` 383 as it was, which the macro does not touch. Words locked as
`moved` 75 to 64; the 11 more `differs` are in one resume with no words in place before or after.
All compiles 5,849 to 5,505. The pdfTeX page opened within 8 s in 68 of 91 resumes against 63, and
the slowest whole import took 91.3 s against 103.9 s, on a machine running other work, so the
compiles are the measure.

With the review's fixes, all 220 again (6.2 min, against the same main run): no document worse in
outcome or in words in place, none timed out. Words in place 73,617, 89.2% (+1,233 on main, 15
more than before the fixes, all in `jake-0030`, whose 15 words kept `moved` for `position` are
now in place); successes 74, resumes at 90% 80, under 50% 2, every family as above. `moved`
words 1,004: `position` 621 in 8 resumes (pdfTeX 253, XeTeX 368), `transform` 383; in `other-0052`
(XeTeX) 22 words go from `moved` to kept for another reason, its words in place the same. All
compiles 5,501. The pdfTeX page opened within 8 s in 68 of 91, the slowest whole import 90.4 s.

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
