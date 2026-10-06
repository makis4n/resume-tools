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
  drawn in place of the first. Where check 1 bisects, the page opens after it only if the outline it
  leaves was compiled and set the page; otherwise page and fields open together after check 2.
- **The entries, with the outcome**, once check 3 has tried every group: until then a copy, a
  removal or a move of a unit is refused with "Entries can be added, removed and moved once the
  import's checks end, which try each kind." The outcome's document takes the place of the one
  open, with whatever the person typed meanwhile and the groups the checks fixed, and compiles at
  once; its page is drawn again, the same page where nothing changed. A success is kept then, its
  report above the page; a partial import shows its report above the page, with Continue, Stop and
  the move onto a built-in template, and is kept only on Continue. A refusal, a failure or a cancel
  goes back to the list as before, saying why, and keeps nothing.
- An edit typed after the fields open waits in the document until the import lands, since the import
  holds the engine until then; nothing is asked of the engine for it, so an import cancelled or
  refused compiles nothing after it. Nothing is saved before the import is kept: the document has no
  id in the store until then. What is kept is the document the checks compiled; what was typed is
  saved over it once a page shows it, as every change to an imported outline is (the second pass's
  item 7, `StructureGuard`), and a compile it stops takes it back to the checked document.

### How

- The page is a compile the checks made anyway, never one more: the checks' compiler keeps the
  output of each compile that went through of an outline the checks built from what they keep, by
  the resume it set (`StagedCompiler`, in `src/import/stages.ts`), never a mutation's or a group's
  trial, and lets them go once check 2 has ended; each check's end (a callback in `checkOutline`, `ChecksInput.ended`)
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

`corpus run` over all 220 fetched documents on a local merge of main with #111 and #112 and this
change, never pushed, four at a time, at a one-minute load of 5.7 to 7.4, with other worktrees'
runs beside it; it took 7.3 minutes. `corpus compare` against the before-run (`fc62298`, decision
0066) finds every document the same, times aside: 50 successes, 60 partial, 7 refused, 103 with no
reference; 71.9% of 82,391 words in place, 16 resumes under 50% and 53 at 90% or more; 5,817
compiles, as before. No document is worse, in outcome or in words in place.

Every one of the 110 imported resumes opened before its import ended. Times are the pipeline's,
in Node, from the files to the stage; the browser's draw comes on top.

| | Before: the whole import | The page opens | Every field open | The whole import, this run |
|---|---|---|---|---|
| pdfTeX, 91: under 8 s | 57 | 66 | 60 | 56 |
| pdfTeX: median | 5.3 s | 3.8 s | 5.5 s | 6.1 s |
| pdfTeX: slowest | 175.9 s | 61.8 s | 120.0 s | 198.9 s |
| XeTeX, 19: under 20 s | 15 | 16 | 11 | 11 |
| XeTeX: median | 16.5 s | 12.1 s | 17.4 s | 18.0 s |
| XeTeX: slowest | 41.8 s | 38.1 s | 41.1 s | 48.9 s |

- Against decision 0067's targets this loaded run reaches one and misses three: the pdfTeX page under
  8 s in 66 of 91 meets "at least 66" with none to spare, but the slowest pdfTeX page, 61.8 s, misses
  "under 60 s", the XeTeX page under 20 s in 16 of 19 misses "at least 17", and the slowest XeTeX
  page, 38.1 s, misses "under 36 s". Against the lane's own estimate (about 72 of 91, a slowest
  pdfTeX page of 30 to 39 s, 18 of 19 on XeTeX) it falls short on every line. The targets were not
  reached in this run.
- A second whole run, after the review's fixes (which change what is kept for a stage, not what
  opens or when), at a load of 5.0 to 6.9: `corpus compare` again finds all 220 the same, times
  aside, no document worse, 5,817 compiles, and all 110 opened before the import ended. pdfTeX: the
  page under 8 s in 66 of 91, median 3.7 s, slowest 55.9 s (`altacv-0017`); every field open in 60
  of 91, slowest 105.1 s; the whole import in 57 of 91, slowest 185.7 s. XeTeX: the page under 20 s
  in 17 of 19, median 11.9 s, slowest 31.9 s (`awesome-cv-0033`); every field open in 15 of 19; the
  whole import in 14 of 19. This run meets all four of decision 0067's targets for the page, the
  pdfTeX count with none to spare, and still falls short of the lane's estimate on the pdfTeX count,
  the slowest pdfTeX page and the XeTeX count. The two runs differ by load alone, so the targets are
  met only at the edge: a quiet machine's run, at integration, settles them.
- The machine was busier than for the before-run (load 1.7 to 4.1): the same compiles took 1,642 s
  in all against 1,471 s, 12% more, and the slowest import 198.9 s against 175.9 s. So the
  whole-import columns are not this change's; the early columns are best read against this run's
  own whole import.
- The slowest page is `altacv-0017`'s, 61.8 s here: its probe takes 40 s before the outline is
  made, and check 1 bisects, 7 compiles of about 2 s, before its outline sets the page. On a quieter
  machine, in a run of 23 slow and sample resumes at a load of 3.8 to 5.8, it opened at 55.4 s of
  177.4 s, every field at 101.0 s. Next `other-0028` at 44.6 s, `moderncv-0013` at 40.9 s (whose
  check 1 bisects 48 compiles), `awesome-cv-0033` on XeTeX at 38.1 s.
- The page opens soon after the outline is made: on the 23 resumes of the shorter run it opened
  0.5 to 2 s after the steps before the checks, except where check 1 bisected. What is left before
  it is the reference, the signatures and above all the probe, which this lane does not touch.
- Every resume opened its fields before its outcome; in two, `moderncv-0012` and `other-0030`,
  which have no groups, check 3 has nothing to try and the outcome follows within milliseconds.

### In the browser

The app, on this branch with the review's fixes, in the desktop app's browser pane, importing the three
upstream samples through the document list as a person would (the dev server's sample zips put in
its file input), on the real worker. The pane was hidden and the machine at a load of 5 to 7, so the
times below show the order of events, not the wait a person would have.

| Sample | The page opens, fields locked | Fields open | Outcome | The outcome's page |
|---|---|---|---|---|
| `jake-0000`, pdfTeX | 1.8 to 2.2 s | 2.2 to 2.5 s | partial at 2.6 to 2.9 s | the same page, compiled in 160 ms |
| `altacv-0000`, pdfTeX | 33.2 to 34.2 s | 45.1 s | partial at 50.5 s | the same 2 pages, compiled in 910 ms |
| `awesome-cv-0000`, XeTeX | 12.4 s | 17.6 s | success, kept, at 18.4 s | the same 3 pages, compiled in 309 ms |

- Each page was drawn from the output the worker handed over, the XeTeX one with the browser's
  fonts, and every page the outcome compiled was the early page byte for byte (its SVG the same).
- While the fields were locked the side panel was inert, a click on a field opened nothing, and the
  progress line with its Cancel stood above the page. Cancel there, on `altacv-0000`, went back to
  the list, kept nothing and said nothing; the next import ran on the fresh worker.
- A partial import's report stood above the page with Continue, Stop and the move: Stop kept nothing,
  Continue kept the document. The success was kept with its report above the page. No error reached
  the console.

## Consequences

- The wait is judged on the time to the page, as decision 0067's targets have it; the whole import
  is reported beside it.
- Decisions 0038 and 0039 no longer hold an import's document until the checks end: a success opens
  before it is kept, and a partial import's report shows above its page rather than in the list. The
  list still holds a partial import that the move sent back to it, as before.
- An import whose check 1 bisects opens when the bisection ends, and only with its fields, after
  check 2, where the outline check 1 leaves was not compiled as it stands or did not set the page.
- What the person typed while check 3 ran lands with the outcome, but its steps are not undone one
  by one: the document the outcome marks starts a history of its own.
- The early document is not in the store, so a tab closed before the import is kept loses it, as a
  partial import waiting in the list always did.
