# 0016. The editor measured against its targets

Date: 2026-09-25 · Status: accepted

## Context

Plan section 4.3 sets the bar the editor has to clear, and milestone 2 closes with the editor
measured against it, on a fast machine and on the slow laptop, a 2019 machine with integrated
graphics (item 23). Decision 0003 measured the spike, and its update the editor's engine
session, both on an M4 Pro; neither measured the editor as a whole, and nobody has measured the
slow laptop yet. The spike's page, which took 0003's browser numbers, is retired in the same
item, so the editor has to measure itself.

Main holds one curated package today, Jake's Resume. AltaCV (pdfTeX, item 20) and Awesome-CV
(XeTeX, items 21 and 22) are on branches in review, and fit to one page (item 18) is too. Their
rows below are left empty, to be filled by running the same command again once they merge.

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
  compiled once and drawn, median, from the command to the page. It prints a table per package
  and a summary against section 4.3, `--json <file>` writes the numbers, and `--runs <n>` sets
  the edits, with ten times as many layouts.
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
  files the fonts read that TeX had not. What they compress to on the way is the CDN's to say
  (milestone 5), and the app's own JavaScript is not in it.

## Findings

This machine is an Apple M4 Pro, 12 cores and 24 GB of memory, on macOS with Node 24.15, while
other sessions' test runs kept its one-minute load average between 6.6 and 7.9. Two runs of the
command agreed within 14 ms on the dump and 1 ms on an edit; the tables have the second. The
browser is the desktop app's pane, Chrome 152, and its column is the second of five loads. The
first, which also fetched the engine into the HTTP cache, was within 25 ms of it everywhere but
the engine's start; three later loads, the pane hidden, came out three to four times slower (the
engine's start 2.0 to 2.1 s, an edit's page 280 to 291 ms, the row layout 0.30 to 0.40 ms), as
decision 0003's update also saw.

Jake's Resume, next to decision 0003's numbers:

| | Decision 0003 | This machine | Slow laptop |
|---|---|---|---|
| Node: dump the preamble into a format | 1.4 to 1.7 s (spike), 0.28 s (update) | 358 ms; a 6.74 MB format, from 57 files and 7.94 MB of TeX Live | |
| Node: a new document's compile, two passes | | 163 ms (83 + 79); 36 files and 0.20 MB more | |
| Node: the page drawn | 2 ms to parse the DVI and build the SVG, the fonts already loaded | 79 ms the first time, which loads the fonts; 2.5 ms in an edit | |
| Node: an edit, from the command to the drawn page, median of 10 | 135 ms (spike), 68 ms (update), the compile alone | 82 ms: compile 79, draw 2.5; from 79 to 84 | |
| Node: a keystroke's row layout, median of 100 | | 0.07 ms, 245 characters on 3 lines | |
| Chrome: the engine's start | 0.3 s (update) | 349 ms; 1,011 ms on the first visit, which fetched the engine | |
| Chrome: the first page, the dump and two passes and the draw | 0.37 s + 0.15 s (update) | 625 ms | |
| Chrome: an edit's page, median of 10 | 100 to 110 ms (spike), 65 ms (update) | 84 ms; 186 ms from the command, the pause included | |
| Chrome: a keystroke's row layout, median of 100 | | 0.10 ms, the browser's timer resolution | |
| First load, uncompressed | about 14 MB compressed | 41.98 MB: engine 30.36, loader 0.30, manifest 1.83, TeX Live 8.14, fonts 1.35 | |

The edit's compile, 79 ms against the update's 68 ms, compiles a larger template than the
spike's: Latin Modern in T1 where the spike set Computer Modern, geometry, xcolor and hyperref's
dvipdfmx driver, and a body with a paragraph special beside every field.

AltaCV and Awesome-CV, to fill once items 20 and 22 merge, with the same rows:

| | AltaCV, this machine | AltaCV, slow laptop | Awesome-CV, this machine | Awesome-CV, slow laptop |
|---|---|---|---|---|
| Node: dump, new document, first draw | | | | |
| Node: an edit, median of 10 | | | | |
| Node: a keystroke's row layout, median of 100 | | | | |
| Chrome (`?measure=altacv`, `?measure=awesome-cv`): the first page, an edit's page | | | | |
| First load, uncompressed | | | | |

Against plan section 4.3, Jake's Resume:

| Target | Limit | This machine | Slow laptop |
|---|---|---|---|
| Keystroke in the overlay | under 16 ms | 0.07 ms in Node, 0.10 ms in Chrome: met | |
| True page updated after an edit, typical | 300 ms | 82 ms in Node, 84 ms in Chrome: met | |
| True page updated after an edit, slow laptop | under 500 ms | not judged here | |
| First load, cached afterwards | under 30 MB | 41.98 MB uncompressed: missed | |

To fill the slow laptop's column: set the repository up on it as its README says, with
`pnpm install` and `pnpm --filter @resume-tools/editor fetch-engine`; run
`pnpm --filter @resume-tools/editor measure --json slow-laptop.json`; then run `pnpm dev`, open
`/?measure=1` in Chrome with the tab in front, and read the text under the page.

## Consequences

- The keystroke and the typical edit are met on this machine with room: the row layout is a
  small fraction of a frame, and an edit's page takes under a third of the budget, under two
  thirds with the pause. Whether the slow laptop keeps Jake's Resume's edit under 500 ms is the
  open question.
- The first load is missed as the dev server serves it, uncompressed. Milestone 5 addresses it:
  the CDN compresses what it serves, and decision 0003 put the engine alone at 9.5 MB with
  Brotli; the per-engine build shrinks the engine, nearly three quarters of the bytes; and a
  template's format served from the cache removes the stock format, 6.48 MB of the 8.14 MB of
  TeX Live.
- The keystroke's number is the row layout alone. The DOM work after it, redrawing the rows or
  ProseMirror's decorations, is not measured, so the target stays open to a browser trace on
  the slow laptop if the overlay ever feels slow there.
- XeTeX's numbers come with Awesome-CV. Milestone 2's risk that it misses the slow-laptop target
  is decided on them, not on the spike's.
- Fit to one page is not measured: item 18 is not on main. The plan's measure of it, the
  search's compiles and total time on a sample made too long, joins the command once it merges.
- The spike's page is gone, with `src/spike/`, `spike/web/` and the dev server's `/spike/`
  route. Its Jake's Resume preamble and body are test fixtures now, and the spike's Node scripts
  remain in `apps/editor/spike/`, with a README for what they need.
