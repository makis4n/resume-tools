# 00XX. The page opens when the outline is made

Date: 2026-10-06 · Status: accepted, under the owner's decisions of 6 October 2026 (decision 0067's
lane 4); amends 0038 and 0039 in when an import opens

## Context

An imported `.tex` resume opened only once all four checks and its report were done (decisions 0038
and 0039): a success straight into the editor, a partial import into the list, its report waiting
for Continue. The checks are most of an import's time, two thirds of it on pdfTeX by decision
0067's count, and their bisections run one compile after another on the one compile worker. So the
person looked at a progress line for the whole of it: 57 of 91 pdfTeX imports were under 8 s, and
the slowest took 175.9 s. Decision 0067 judged the wait on the time to the page once the page could
open early, and chose this lane to open it there: on the page the outline sets, its fields locked,
which open as checks 1 and 2 settle them, and its entries' copy, removal and move after check 3.

## Decision

### What opens, and when

- **The page, after check 1**, where the outline with nothing kept, compiled as the editor compiles
  it, set the page the checks hold it to at its first compile: the reference's page, or, for an
  import that is partial before any field is tried, the page its package sets. Every field is shown
  on it and locked: a click opens nothing and the side panel takes no input. Above the page, the
  import's progress line with its Cancel, and "This is your resume's page. Its fields open as soon as
  they have been checked."
- **The fields, after check 2**, which has settled every field: those it kept as text are kept text
  on the page, as they always were, and the rest open, in place and in the side panel. Where check 2
  kept a field, the outline it leaves is another, and its page, which check 2 compiled anyway, is
  drawn in place of the first. Where check 1 had to bisect, nothing opens after it, and the page and
  the fields open together after check 2.
- **The entries, with the outcome**, once check 3 has tried every group: until then a copy, a
  removal or a move of a unit is refused with "Entries can be added, removed and moved once the
  import's checks end, which try each kind." The outcome's document takes the place of the one
  open, with whatever the person typed meanwhile and the groups the checks fixed, and compiles at
  once; its page is drawn again, the same page where nothing changed. A success is kept then, its
  report above the page; a partial import shows its report above the page, with Continue, Stop and
  the move onto a built-in template, and is kept only on Continue. A refusal, a failure or a cancel
  goes back to the list as before, saying why, and keeps nothing.
- An edit typed after the fields open reaches the page once the import lands, since the import
  holds the engine until then, and is kept with the document. Nothing is saved before the import is
  kept: the document has no id in the store until then.

### How

- The page is a compile the checks made anyway, never one more: the checks' compiler keeps the
  output of each compile that went through, by the resume it set (`StagedCompiler`, in
  `src/import/stages.ts`), and each check's end (a callback in `checkOutline`, `ChecksInput.ended`)
  looks up the outline it leaves. Where that outline was not compiled as it stands, or did not set
  the page, nothing opens until a later check's did, or until the outcome.
- The import says what opens as a stage (`ImportStage`: `page` or `fields`, the package, the
  document so far, the job, and the output where the stage brings a page), through
  `ImportDeps.onStage`; the worker sends it to the client under the import's id, the output handed
  over rather than copied, and the client hands it to the compiler's caller. A stage settles nothing.
- The compiler draws a stage's output as it draws a compile's (`Compiler.preview`), asking nothing
  of the engine, which the import holds; the document becomes the open one, so that an edit made
  meanwhile compiles once the import lands. No PDF is made of that page, and the Download and the fit
  to one page wait for the import to be kept.
- What the page shows is the real TeX output of the document that opens, as every page is, and
  nothing on it shows LaTeX.
- `corpus run` puts `times.page` and `times.unlocked` in each imported row, the pipeline's time to
  the first stage and to the fields, its import's time where it said none, and its headline gives
  them per engine against 8 s on pdfTeX and 20 s on XeTeX, with the median and the slowest.
  `measure --import` opens the document as the app does, and gives when its page was drawn and when
  every field was open.

### Measured

To be filled in from the corpus runs.

## Consequences

- The wait is judged on the time to the page, as decision 0067's targets have it; the whole import
  is reported beside it.
- Decisions 0038 and 0039 no longer hold an import's document until the checks end: a success opens
  before it is kept, and a partial import's report shows above its page rather than in the list. The
  list still holds a partial import that the move sent back to it, as before.
- An import whose check 1 bisects, or whose check-2 outline was compiled long before and not kept,
  opens no earlier than check 2's end; one whose page differs where check 1 left it opens with its
  fields.
- What the person typed while check 3 ran lands with the outcome, but its steps are not undone one
  by one: the document the outcome marks starts a history of its own.
- The early document is not in the store, so a tab closed before the import is kept loses it, as a
  partial import waiting in the list always did.
