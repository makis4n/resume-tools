# 0040. Page size, margins and font size on every import

Date: 2026-10-01 · Status: proposed; amends 0026's generic controls, and does what 0012 left to
milestone 3

## Context

Milestone 3 item 14 gives imported templates plan section 5.4's generic controls, and sets the
milestone's bar: page size, margins and font size work on every successful corpus import, and the
corpus runner checks it. Item 7 (decision 0026) offered the page size where the class or geometry
names Letter or A4, or the reference is one of them; the margins only where geometry sets one
margin in tenths of an inch, which no corpus document did; and the font size only where the
class's options name a size the class declares. Decision 0012 left the harness's `controls` check
compiling each font a package offers without drawing it. The code is
`apps/editor/src/import/assemble.ts`, `validate.ts` and `signatures.ts`,
`apps/editor/src/validate/harness.ts`, and `apps/editor/scripts/corpus-assemble.ts` with
`corpus.ts`.

## Decision

### The layout, from the engine

- The signatures step's first compile, which runs the document's own preamble past
  `\begin{document}` (decision 0020), writes the page's layout there before the names it prints
  (`Layout`, `EngineSignatures.layout`): the text block's left margin, `1in + \hoffset +
  \oddsidemargin`, and top, `1in + \voffset + \topmargin + \headheight + \headsep`, its width and
  height, the paper's, and the normal font size, `\f@size`, in points. It holds numbers and none
  of the document's text, and never reaches the naming request. It is how the controls learn the
  document's own margins and size where no line of the preamble says them: Jake's Resume sets its
  margins by hand, with `fullpage` and `\addtolength`, and many classes' options name no size.

### Margins, through geometry

- Every document has margins, so every import whose layout was read offers the control. Its
  default is the document's own left margin, to the nearest tenth of an inch the control offers,
  from 0.4 to 1 (decision 0006); geometry's `margin` or `left` stands in where no layout was read.
- Its snippet, in the body's preamble region, does nothing at the default: TeX compares the value
  with it (`\ifdim`), so that the unchanged control is the original to the byte, whatever the
  document's margins are, even or uneven, geometry's, the class's or set by hand, and the first
  check never drops it for its default. Any other value sets one margin on every side of the text
  block: `\geometry{margin=...in}` reissued after the document's own where the class or the
  preamble loaded geometry, which overrides the scale, width and sides it was given, and geometry
  loaded with that margin where nothing loaded it (`marginsSnippet`).
- Geometry is told what else it needs to set the margins it is given (`GEOMETRY_RESETS`): no
  `\hoffset` and no `\voffset`, since it sets `\oddsidemargin` to the left margin less an inch and
  keeps the offsets a document may place its page with, so that they counted twice, half an inch
  of offset and 0.6 inch asked setting 0.1 inch on the left and 1.1 on the right (the review of
  this item); the head, the foot and marginal notes outside the body, where a document may have
  counted them in; no binding offset; and the text's height as the margins leave it, not rounded
  to its lines.
- The class option route the brief gives moderncv and europecv is not built: neither class in the
  tree takes a margin among its options. moderncv 2.3.1 loads no geometry and sets its page from
  `size1x.clo`, and europecv passes every option it does not know to `article`. Geometry in the
  body's preamble region serves both as it serves any class; the sample's three moderncv imports
  prove their margins so.

### Page size

- As item 7 had it: offered where the class or geometry names Letter or A4, or the reference is
  one, and nothing at the document's own paper. At the other paper, the document's own margins,
  each side's of its text block and its head's and foot's, are measured as TeX finds them there,
  and given to geometry with the paper and the same resets, reissued where the class or the
  preamble loaded geometry and loaded with them where nothing did (`pageSizeSnippet`). Item 7's
  `\usepackage[a4paper]{geometry}` took geometry's own layout where nothing loaded it, text 70 per
  cent of the paper, so that a Jake's fork's half inch became an inch and a quarter on A4; and its
  `\geometry{a4paper}` ran geometry again from the options it was given, which undid what a
  document adjusted by hand after them, as a fork that keeps Jake's `\addtolength` lines after
  geometry does, its 0.3 inch becoming 0.5 on A4, and `\usepackage{geometry}` with Jake's lines
  0.775 inch becoming 1.24 (the review of this item). A page size and a margin chosen together set
  that margin on the other paper.

### The fourth check proves the page they set

- A margin or a paper that changes the page is not yet the one it asks for. So the fourth check
  reads the layout of each compile of the margins and the page size, as the log says it at
  `\begin{document}` (`LAYOUT_TYPEOUT`, `layoutOfLog`, the signatures step's measures), and of the
  document at its own values, and holds each value to it (`laidOut`): at a margin, that margin on
  every side of the text block, on the document's own paper; at a paper, that paper, with the
  document's own margins on every side; each within half a point. A control of which a value
  compiles and moves the page but sets another page than it asks is dropped, "sets another page
  than it asks at" and the value; one that sets the same page at every value is still dropped for
  that. Engine tests hold both snippets to the page they ask for on documents laid out by geometry,
  by TeX's offsets, by geometry adjusted by hand after it, and by hand with no geometry, on either
  paper; and a document that moves its text block at `\begin{document}` has its margins dropped.

### Font size, the class's option

- Format-bound (decisions 0006 and 0012), at the sizes from 9 to 12 points the class declares, as
  the signatures step finds `\ds@<size>pt` defined (decision 0026); where the step was not asked of
  them, `article`'s 10, 11 and 12, which the fourth check holds to the page as any.
- The control's default is the size the class set, the declared size within a tenth of a point of
  the layout's normal size, 11 for 10.95, whatever the options name: where the two disagree, as
  `[11pt]` on a class that sets 12 points, the page is the class's, and the named size would set
  another. A class whose normal size is none of the sizes it declares offers no control. Where the
  class's options name no size, the slot goes first among them,
  `\documentclass[{{fontSize}}pt,a4paper]{moderncv}`; where they name one, the slot takes its
  place, a size the class ignores, as `article` ignores 10.5 points, among them. Where no layout
  was read, the size the options name, where the class declares it.
- A slot that names a size the options did not is a change to the original's preamble, so the
  first check holds the font size's default to the original's page as it holds the other
  controls' defaults, and drops it, saying so, where it moves the page. The fourth check then
  proves the sizes: a class whose sizes do not follow its option, as one that loads `article`
  without passing on its options, sets the same page at every size, and is dropped.

### Drawing each font

- The harness's `controls` check draws each font a package offers besides compiling it, as
  decision 0012 asked: its output is read as the page reads it, and every field must be found,
  align with its text and be set in fonts the page can draw, by the fields, alignment and fonts
  checks' rules; a field or a font those checks report for the resume as it is stays theirs. A
  finding of the `controls` check names its control (`Finding.control`), and the report lists the
  fonts drawn (`Report.fonts`). The curated packages' eleven fonts all draw.
- An import drops a control the harness finds does not work, a font it cannot draw among them,
  and runs the checks again, once, as it locks a field the harness finds unmarked (decision 0026).
- The harness tries the font size at the largest size the package offers but the document's,
  where it tried 12, or 11.5 at 12, whatever the class declares.

### Why a control is dropped

- The checks say why, and the report inputs keep it (`checks.controls.dropped`), in the checks'
  own words and never TeX's, since item 13's report shows them: its default moves the original's
  page (the first check); a value stops the compile, every value sets the same page, or a value
  sets another page than it asks (the fourth), the value at fault named; the harness finds it does
  not work, its finding's own words, which may quote TeX's log, kept with the findings; or the
  checks stopped before the fourth (`DROPPED`, `UNCHECKED`). The runner's row keeps the kind of
  why alone.

### The runner's bar

- `corpus assemble` prints, for each document, which of the page size, the margins and the font
  size are proven, and for a successful import each it lacks with the kind of why; its table counts
  the documents with all three proven, the successful ones lacking any, and each control dropped by
  the kind of why. It exits 1 when a successful import lacks any of the three, and names each such
  document by its id and the control alone.
- Until item 13 says what a success is, a successful import is an assembly whose first check holds
  ("Assembled: the first check holds", `firstCheckHolds`). `barFailures(rows, successful)` in
  `scripts/corpus-assemble.ts` takes item 13's rule in that one's place, for item 17's runner, from
  the same rows.
- `--only` takes several ids a comma separates, as the sample's runs do.

## The sample

`corpus assemble` over the twenty documents of the sample (six of Jake's forks, four of
Awesome-CV's, three of AltaCV's, three of moderncv's, one europecv and three others), before this
item and after it with the review's fixes, the tree of layout 7, the M4 Pro:

| | Before | After |
|---|--:|--:|
| Assembled and checked | 13 | 13 |
| Successful: the first check holds | 12 | 12 |
| `pageSize` proven | 13 | 13 |
| `margins` proven | 0 | 13 |
| `fontSize` proven | 13 | 13 |
| Successful imports with all three proven | 0 of 12 | 12 of 12 |
| Controls dropped | 0 | 0 |
| Compiles, median | 25 | 33 |
| Assembly and checks, median | 7.8 s | 9.1 s |

The other seven are as they were: four call no macro the committed answers name (the europecv
document and the three others), item 8's check refuses two Awesome-CV forks (`difference`), and
altacv-0001 times out both times, at 900 s, as the one AltaCV fork that timed out in item 7's run
did, whose body at the font size's 9 points never ends (decision 0026). One Jake fork is partial,
by a position, as before, and has all three controls proven. Every value of every control
compiles, changes the page and, for the margins and the page size, sets the page it asks for on
the thirteen: none is dropped, by the first check, the fourth or the harness. The six margins the
fourth check tries and the one the harness tries cost seven to ten compiles more a document, eight
and 1.3 s at the median; reading the layouts costs none.

## Consequences

- The bar is the corpus's to confirm: the whole corpus runs before the pull request, where a
  successful import that lacks a control fails the run by its id and control, with the kind of
  why on its line. Documents the sample does not show, a class that sets its layout at
  `\begin{document}`, a body that calls `\newgeometry`, a class whose sizes do not follow its
  option, are where to look first.
- The margins control sets one margin on every side. A document's own uneven margins are its
  default, "as imported", which the slider shows at its left margin to the tenth; a document whose
  margins lie outside 0.4 to 1 inch shows the nearest end. What stays open: any other value sets
  every side alike, so a value narrower than the left margin can widen a narrower top one and
  lengthen the document, the fit to one page's first step among them. The fit takes no margins
  step that sets more pages than the setting before it, and goes on from that setting without the
  margins (`fit`, `src/editor/fit.ts`), trying the document's own values first where the margins
  step first, as an import's do; a step that lengthens the document within the pages it had is not
  seen. Margins side by side, which the model's one value cannot hold, would close it.
- Check 4 compiles every margin but the document's, six compiles, and each is a compile that could
  run forever, as an AltaCV fork's body at 9 points does: the engine has no time limit (decision
  0026), and item 12's worker, terminated and started afresh, remains the answer.
- The whole corpus runs before the pull request, the orchestrator's run: its table reports the
  compiles at the median and the most and the slowest document's assembly and checks, which are to
  be read against the runner's 900 s a document, since the six margins, and a second round of
  the checks where the harness drops a control, add to each document's compiles; reading the
  layouts adds none, as the compiles that set them say them.
- Item 12 reads the layout as the corpus does, from the signatures step it already calls; asking
  the step of `SIZE_OPTIONS` stays its to do, and without it an import offers `article`'s three
  sizes, held to the page by the fourth check.
- The accent, font and density controls stay as item 7 made them, from the answer's preamble
  settings, which neither the seed nor the corpus runner gives yet, so the corpus shows none. The
  drawing of fonts is proven on the curated packages, whose eleven fonts draw, and on invented ones.
- A document whose paper is neither Letter nor A4 gets no page size control; none of the corpus's
  seventy imports of item 7 is one.
