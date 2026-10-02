# 0016. The editor measured against its targets

Date: 2026-09-25 · Status: accepted

## Context

Plan section 4.3 sets the bar the editor has to clear, and milestone 2 closes with the editor
measured against it, on a fast machine and on the slow laptop, a 2019 machine with integrated
graphics (item 23). Decision 0003 measured the spike, and its update the editor's engine
session, both on an M4 Pro; neither measured the editor as a whole, and nobody has measured the
slow laptop yet. The spike's page, which took 0003's browser numbers, is retired in the same
item, so the editor has to measure itself.

Main holds the three curated packages, Jake's Resume and AltaCV (item 20) on pdfTeX and
Awesome-CV (items 21 and 22) on XeTeX, and fit to one page (item 18). Awesome-CV's rows were
filled by running the same command once it merged, as the first version of this record said.

## Decision

- One command measures every curated package in Node, whatever `src/templates/curated.ts` holds,
  on either engine: `pnpm --filter @resume-tools/editor measure` (`scripts/measure.ts`). Each
  package gets an engine session and fonts of its own, as a first load has them, and the editor's
  compile scheduler (`Compiler`) drives them, as the app drives its worker, so that every step
  the editor takes to make a page is a step measured, including those it gains later
  (`src/measure/measure.ts`). It opens a new document of the sample on the package's defaults
  and reads, from the scheduler's requests to the engine, its draws and its events: the format's
  dump; the new document's compile, two passes; its first draw, which loads the page's fonts; and
  the first page as the scheduler times it (`Shown.ms`). Then the overlay's row layout of the
  sample's longest field, median of 100, which is what a keystroke there costs before the DOM
  (`richRows` for a rich field, `layoutRows` for a text one); and ten edits of that field, each
  its last character retyped as a command through the document's history and an `update`,
  compiled once and drawn, median, from the command to the page. Last, fit to one page (`fit`,
  item 18) as the app runs it, through the scheduler's trials, on the sample made too long: grown
  by the fewest invented bullets under its first job that run it onto a second page, which is
  when a user reaches for it; its compiles and its time. It prints a table per package and a
  summary against section 4.3, `--json <file>` writes the numbers, and `--runs <n>` sets the
  edits, with ten times as many layouts.
- The app measures itself in the browser at `?measure=1` (`src/measure/MeasurePage.tsx`): it
  opens Jake's Resume's sample, or another package's with `?measure=<id>`, through the worker as
  the app does, and times the engine's start and the first page (`Shown.startMs`, `Shown.ms`),
  the same row layout, and ten edits one after another, each a command through the history and
  an `update`, from the command to the page it brings. The medians go to the console and under
  the page. It keeps nothing, so every load dumps the format, and TeX's words stay in the
  console.
- An edit is judged by its own time, from the command to the drawn page. The scheduler's pause
  before the compile, 100 ms for pdfTeX and 400 ms for XeTeX, waits for the typing to stop and is
  not in it, as it was not in decision 0003's numbers: the command sets it to nothing, and the
  browser page gives the edit with it too.
- Sizes are bytes on disk. A first load is the engine's `.wasm` and its loader's `.mjs`, the
  manifest, every TeX Live file the engine read while the scheduler made the first page, and the
  files the fonts read for it that TeX had not. The fonts the overlay reads when a field opens,
  for variants the page sets no glyph of, are counted apart, since the app fetches them only
  then. What they compress to on the way is the CDN's to say (milestone 5), and the app's own
  JavaScript is not in it.

## Findings

This machine is an Apple M4 Pro, 12 cores and 24 GB of memory, on macOS with Node 24.15, while
other sessions' test runs kept its one-minute load average about 7. Three runs of the command, on
this branch rebased onto item 18's merge, agreed within 6 ms on Jake's Resume's dump and 1 ms on
its edit, and within 50 ms and 13 ms on AltaCV's; the tables have the third, at a load of 7.2.
The browser is the desktop app's pane, Chrome 152, which was hidden: most loads there came out
three to four times slower, as decision 0003's update also saw, and the column has the one load
of Jake's Resume that did not, whose engine started in 0.4 s against 1.5 to 1.7 s throttled. No
load of AltaCV escaped the throttling: its edit's page took 323 to 339 ms, against Jake's 243 ms
in the same state, which is the ratio Node gives.

Jake's Resume, next to decision 0003's numbers:

| | Decision 0003 | This machine | Slow laptop |
|---|---|---|---|
| Node: dump the preamble into a format | 1.4 to 1.7 s (spike), 0.28 s (update) | 350 ms; a 6.74 MB format, from 57 files and 7.94 MB of TeX Live | |
| Node: a new document's compile, two passes | | 173 ms (87 + 85); 36 files and 0.20 MB more | |
| Node: the page drawn | 2 ms to parse the DVI and build the SVG, the fonts already loaded | 81 ms the first time, which loads the fonts; 2.5 ms in an edit | |
| Node: the first page, as the scheduler times it | | 604 ms | |
| Node: an edit, from the command to the drawn page, median of 10 | 135 ms (spike), 68 ms (update), the compile alone | 84 ms: compile 80, draw 2.5; from 83 to 87 | |
| Node: a keystroke's row layout, median of 100 | | 0.07 ms, 245 characters on 3 lines | |
| Node: fit to one page, on the sample 30 bullets too long | | 166 ms: 1 compile, to compact density | |
| Chrome: the engine's start | 0.3 s (update) | 425 ms | |
| Chrome: the first page, the dump and two passes and the draw | 0.37 s + 0.15 s (update) | 654 ms | |
| Chrome: an edit's page, median of 10 | 100 to 110 ms (spike), 65 ms (update) | 79 ms; 182 ms from the command, the pause included | |
| Chrome: a keystroke's row layout, median of 100 | | 0.10 ms, the browser's timer resolution | |
| First load, uncompressed | about 14 MB compressed | 41.85 MB: engine 30.36, loader 0.30, manifest 1.83, TeX Live 8.14, fonts 1.22 | |
| Opening the long bullet, uncompressed | | 0.13 MB more: its bold italic's metrics and outlines, which the page does not set | |

The edit's compile, 80 ms against the update's 68 ms, compiles a larger template than the
spike's: Latin Modern in T1 where the spike set Computer Modern, geometry, xcolor and hyperref's
dvipdfmx driver, and a body with a paragraph special beside every field.

AltaCV and Awesome-CV, with the same rows:

| | AltaCV, this machine | AltaCV, slow laptop | Awesome-CV, this machine | Awesome-CV, slow laptop |
|---|---|---|---|---|
| Node: dump, new document, first draw | 438 ms (a 7.06 MB format, from 145 files and 9.42 MB of TeX Live); 218 ms (109 + 109); 231 ms | | 548 ms (a 9.37 MB format, from 133 files and 11.38 MB of TeX Live, the declared font files among them); 226 ms (123 + 103); 21 ms | |
| Node: the first page, as the scheduler times it | 887 ms | | 796 ms | |
| Node: an edit, median of 10 | 115 ms: compile 109, draw 3.7; from 114 to 120 | | 110 ms: compile 102, draw 6.4; from 108 to 122 | |
| Node: a keystroke's row layout, median of 100 | 0.11 ms, 139 characters on 4 lines | | 0.11 ms, 238 characters on 2 lines | |
| Node: fit to one page | 222 ms: 1 compile, to compact density, on the sample 9 bullets too long | | 200 ms: 1 compile, to compact density, on the sample 14 bullets too long | |
| Chrome (`?measure=altacv`, `?measure=awesome-cv`): the first page, an edit's page | Throttled only: 2.8 to 3.0 s, and 323 to 339 ms | | Not measured here; the page is there to run | |
| First load, uncompressed | 44.44 MB: TeX Live 9.71, fonts 2.25, the rest as Jake's | | 53.44 MB: TeX Live 14.08 (XeTeX reads the declared font files as TeX Live files), fonts 6.87 more for the page, the rest as Jake's | |

Against plan section 4.3:

| Target | Limit | Jake's Resume, this machine | AltaCV, this machine | Awesome-CV, this machine | Slow laptop |
|---|---|---|---|---|---|
| Keystroke in the overlay | under 16 ms | 0.07 ms in Node, 0.10 ms in Chrome: met | 0.11 ms in Node: met | 0.11 ms in Node: met | |
| True page updated after an edit, typical | 300 ms | 84 ms in Node, 79 ms in Chrome: met | 115 ms in Node: met | 110 ms in Node: met | |
| True page updated after an edit, slow laptop | under 500 ms | not judged here | not judged here | not judged here | |
| First load, cached afterwards | under 30 MB | 41.85 MB uncompressed: missed | 44.44 MB uncompressed: missed | 53.44 MB uncompressed: missed | |

To fill the slow laptop's column: set the repository up on it as its README says, with
`pnpm install` and `pnpm --filter @resume-tools/editor fetch-engine`; run
`pnpm --filter @resume-tools/editor measure --json slow-laptop.json`; then run `pnpm dev`, open
`/?measure=1` and `/?measure=altacv` in Chrome with the tab in front, and read the text under
the page. Decision 0045 adds an import's rows beside these, filled the same way with
`measure --import` and `/?measure=import`.

## Consequences

- The keystroke and the typical edit are met on this machine with room: the row layout is a
  small fraction of a frame, and an edit's page takes under a third of the budget on Jake's
  Resume and under two fifths on AltaCV, under two thirds and about three quarters with the
  scheduler's pause. Whether the slow laptop keeps them under 500 ms is the open question;
  AltaCV's edit is about 1.4 times Jake's.
- The first load is missed as the dev server serves it, uncompressed. Milestone 5 addresses it:
  the CDN compresses what it serves, and decision 0003 put the engine alone at 9.5 MB with
  Brotli; the per-engine build shrinks the engine, about seven tenths of the bytes; and a
  template's format served from the cache removes the stock format, 6.48 MB of the TeX Live a
  first load reads, 8.14 MB for Jake's Resume and 9.71 MB for AltaCV.
- A first load counts the manifest once, and it is cached afterwards: the dev server sends it
  `no-cache` with an `ETag`, so a later fetch, the worker's as well as the next load's, is a
  revalidation answered 304, about 300 bytes, until a rebuilt tree changes it. Before this item
  it had no validator, and every load downloaded it whole, once for the page and once for the
  worker. The CDN has to keep it so (milestone 5).
- The keystroke's number is the row layout alone. The DOM work after it, redrawing the rows or
  ProseMirror's decorations, is not measured, so the target stays open to a browser trace on
  the slow laptop if the overlay ever feels slow there.
- XeTeX's numbers are Awesome-CV's: an edit's page in 110 ms in Node, about 1.3 times Jake's
  and under Jake's spike-era figure, since item 21 hid every font folder from fontconfig; the
  spike's 459 ms no longer stands. Milestone 2's risk that it misses the slow-laptop target is
  decided on these, once the slow laptop runs the command.
- Fit to one page is measured on a sample that just runs past a page, the case it is for. Its
  longest search, one that tries every step, is six trials on Jake's Resume and four on AltaCV,
  each a compile in the fit's own job; plan section 5.4 expects it to finish in a few seconds.
- The spike's page is gone, with `src/spike/`, `spike/web/` and the dev server's `/spike/`
  route. Its Jake's Resume preamble and body are test fixtures now, and the spike's Node scripts
  remain in `apps/editor/spike/`, with a README for what they need.
