# 0045. The import measured, and milestone 2's owed table closed

Date: 2026-10-01 · Status: proposed

## Context

Milestone 3 is done, among other things, when "a cached template imports in under 5 seconds",
plan section 4.3's target for an import whose template is already cached. Item 19 measures it as
decision 0016 measured the editor: a cached pdfTeX template, a fork of Jake's Resume, from the file
to the page, in Node and in the browser with a warm HTTP cache, with the XeTeX number beside it, the
numbers next to decision 0016's, and the slow laptop's column left for the owner to fill with the
same command; and it closes out the milestone's table of what milestone 2 owed. Item 12 (decision
0038) runs the import in the compile worker, on the editor's own engine; its test imported an
invented fork of Jake's Resume in 5.5 s, under other work. The code is
`apps/editor/src/measure/import.ts`, `node.ts` and `ImportMeasurePage.tsx`, and
`apps/editor/scripts/measure.ts` and `serve-samples.ts`.

## Decision

### What is imported

- The oracle's upstream samples (`corpus/oracle.json`, decision 0022): the examples the templates'
  repositories ship, public, and not corpus documents. Jake's Resume's (`jake-0000`) on pdfTeX,
  which the bar is judged on, as the milestone's decisions have it, and Awesome-CV's
  (`awesome-cv-0000`) on XeTeX, reported beside it. Every macro of each has its answer in the
  committed seed (decision 0024), so each is a template already cached: the naming step answers
  from the cache and asks no model.
- The upload is the sample's files zipped at their paths in its repository, as `corpus oracle`
  gives them to the pipeline (`sampleUpload`), read from `.corpus/oracle/` once `corpus oracle` has
  fetched them, each file checked against the oracle's size and SHA-256. Node and the browser import
  the same bytes, and nothing else under `.corpus/` is read.

### From the file to the page

- The upload goes to the editor's compile scheduler, `Compiler.importResume`, as the document list
  gives it a person's files, and the document it comes to opens with its package and job,
  `Compiler.open`, as the app opens it, to its first drawn page (`measureImport`). The store's write
  and read between the two, in IndexedDB, are left out: the measurement keeps nothing.
- The parts come from what the import says as it goes (`ImportProgress`): each step from its first
  word to the next step's, with the compiles and the dumps or PDFs it began, and the time TeX took,
  from each request's first word to its last; before them the wait for the first word, while the
  worker loads the import's code and the tree's fonts at its first import (`load`); and after them
  the page, from the import's outcome to the page drawn, with the scheduler's dump, compile and
  draw. The steps are the pipeline's own, whatever it gains later, and the parts add up to the
  whole. The assembly is not a step of its own: `validate` assembles, checks, and assembles again
  with what the checks decided (decision 0026), so the two are timed as one, "Checking the imported
  template", and the findings below count its requests one by one.
- Each import runs on an engine started afresh, as a newly opened editor's worker is, with fonts
  of its own. The engine's start is timed apart, before the import: a person whose editor opened a
  document has it started already, and one who imports into an empty list waits for it as well, so
  the bar is judged on the import, and the start is given beside it.
- One import first is not counted: it fills the HTTP cache, which the plan's bar assumes warm, and
  in Node the disk's cache and the runtime's compiled code. Then five are timed, and the table gives
  each part's median, the whole's, and the fastest and slowest whole.
- In Node: `pnpm --filter @resume-tools/editor measure --import [--engine pdftex|xetex] [--runs
  <n>] [--json <file>]`, each import on a session of the engine started afresh, which imports on
  it as the worker does (`src/measure/node.ts`), the naming step the service's own handler over the
  committed answers alone, as the dev server answers with no key.
- In the browser: `?measure=import`, and `?measure=import-xetex` for XeTeX
  (`ImportMeasurePage.tsx`). The dev server serves the sample's zip at `/measure/samples/<id>.zip`
  (`scripts/serve-samples.ts`), only for the oracle's ids, only when every file is as the oracle
  names it, and never to be cached; each import is on a new worker, and the naming step is the dev
  server's route. The page gives the same table as text, under its heading and in the console, says
  whether the tab stayed in front, since Chrome slows a hidden tab, and shows nothing of the sample.

## Findings

This machine is decision 0016's M4 Pro, 12 cores and 24 GB, on macOS with Node 24.15, shared with
other worktrees' test suites and corpus runs. The pdfTeX numbers are the first run's, at a
one-minute load average of 1.7 as it began and 2.6 as it ended; a second, at 5.2 to 5.5 while
another worktree's corpus run kept four cores busy, came out 0.14 s slower in the whole and agreed
part by part within 0.12 s. The XeTeX numbers are that second run's, at a load of 5.5 to 5.7; its
six imports, the warm-up's among them, took from 81.2 to 81.9 s. A run while another worktree's
whole test suite ran, at a load of 16, took 107 s for Awesome-CV's import that warms up, and is not
used. The browser's cells are for the orchestrator to fill from `?measure=import` before the pull
request; the slow laptop's are the owner's.

Jake's Resume's upstream sample on pdfTeX, each part a median of five imports:

| | This machine | Slow laptop |
|---|---|---|
| Node: the import, from the file to the page | 6.55 s, from 6.49 to 6.69 s: 41 compiles and 8 dumps or PDFs, 6.34 s of it in TeX | |
| Node: loading what the import runs with, at the worker's first import | 15 ms | |
| Node: the intake | 3 ms | |
| Node: the reference compile | 362 ms: 1 compile, whole, from the stock format | |
| Node: the signatures | 287 ms: 2 compiles | |
| Node: the parse | 1 ms | |
| Node: the probe | 586 ms: the document's own format dumped, 2 compiles | |
| Node: the naming request, built and checked, and the naming service | 8 ms and 4 ms: 7 macros named from the cache, none asked of a model | |
| Node: the assembly and its checks, `validate` | 4.81 s: 35 compiles and 6 dumps or PDFs, 4.71 s of it in TeX | |
| Node: the page | 447 ms: its format dumped in 274 ms, two passes in 148 ms, drawn in 24 ms | |
| Node: the engine's start, before the import | 3.47 s | |
| Chrome (`?measure=import`): the import, from the file to the page | TBD (orchestrator) | |
| Chrome: the parts, as the page's table gives them | TBD (orchestrator) | |
| Chrome: the engine's start, before the import | TBD (orchestrator) | |

What the import came to, every time: assembled, 47 fields editable and 5 locked, the document on
one page, as `corpus oracle` assembles the sample.

Awesome-CV's upstream sample on XeTeX, each part a median of five imports:

| | This machine | Slow laptop |
|---|---|---|
| Node: the import, from the file to the page | 81.69 s, from 81.19 to 81.86 s: 122 compiles and 12 dumps or PDFs, 79.60 s of it in TeX | |
| Node: loading, the intake, the parse, the naming request and the naming service | 15 ms, 4 ms, 1 ms, 35 ms and 9 ms: 19 macros named from the cache, none asked of a model | |
| Node: the reference compile | 2.82 s: 1 compile, whole, fontconfig given the tree's fonts (decision 0019) | |
| Node: the signatures | 1.57 s: 2 compiles, whole | |
| Node: the probe | 51.82 s: 37 compiles, each whole from the stock format, 1.38 s apiece (decision 0022) | |
| Node: the fonts declared by file, and their check (decision 0023) | 1.62 s: its format dumped, 2 compiles | |
| Node: the assembly and its checks, `validate` | 22.67 s: 79 compiles and 10 dumps or PDFs from the package's formats, 0.24 s apiece | |
| Node: the page | 907 ms: its format dumped in 581 ms, two passes in 264 ms, drawn in 31 ms | |
| Node: the engine's start, before the import | 3.52 s | |
| Chrome (`?measure=import-xetex`): the import, from the file to the page | TBD (orchestrator) | |
| Chrome: the parts, as the page's table gives them | TBD (orchestrator) | |

What the import came to, every time: assembled, 119 fields editable and 17 locked, the document on
three pages.

Next to decision 0016's numbers: the page the pdfTeX import opens to, 447 ms, costs less than a
curated Jake's Resume's first page, 604 ms, since its format dumps in 274 ms against 350 and its
first draw takes 24 ms against 81; and the import's compiles from the package's format average 85
ms, an edit's 80, so the import is about eighty edits' worth of TeX. Awesome-CV's import opens to a
page in 907 ms against the curated Awesome-CV's 796 ms, on a sample of three pages to its one. In
Node the engine starts in 3.4 to 3.5 s, nearly all of it the engine's own load, its 30 MB of
WebAssembly compiled afresh at each start, where Chrome started it in 0.4 s in decision 0016, its
cache warm: Node's start is no guide to a person's.

### Where the time goes

TeX is 97% of the pdfTeX import: the JavaScript between its requests, the intake, the parse, the
naming request and the reading of each output, comes to about 0.2 s. The checks are three quarters
of it. Counted request by request, in an import of its own whose session noted each dump, compile
and PDF with its format and job, at a load of 5.4:

| Where | Requests | TeX |
|---|---|---|
| The reference compile, the signatures, the probe | 1 + 2 + 2 compiles, and the probe's format dumped | 1.23 s |
| Check 1's compile of the original, as the reference was, with the rewrite's hyperref lines | 1 compile, whole, from the stock format | 0.34 s |
| The package's format, dumped for the checks and again by the harness, whose first check is that it dumps | 2 dumps | 0.56 s |
| The checks' and the harness's compiles from the package's format | 31 compiles, 85 ms each | 2.62 s |
| The class's other two font sizes, which are formats of their own (decision 0006), one of them dumped twice | 3 dumps, 3 compiles | 1.32 s |
| The harness's PDF | 1 | 0.02 s |
| The page: the package's format dumped a third time, and the body compiled | 1 dump, 1 compile of two passes | 0.42 s |

On XeTeX, TeX is 97% too, and the probe is 63% of the whole: decision 0022 compiles every probe
whole from the stock format on XeTeX, since a preamble that loads fontspec cannot be dumped, and
each of its 37 compiles takes 1.38 s, where `validate`'s, from the package's formats with the fonts
declared by file, take 0.24 s. The checks take 22.67 s more, the reference and the signatures 4.39
s together, and everything else under 3 s.

### Against plan section 4.3

| Target | Limit | Jake's Resume, Node | Jake's Resume, Chrome | Awesome-CV, Node | Awesome-CV, Chrome | Slow laptop |
|---|---|---|---|---|---|---|
| Import, template already cached | under 5 s | 6.55 s: missed, by 1.55 s; 10.06 s with Node's start of the engine | TBD (orchestrator) | 81.69 s: missed, reported beside the bar | TBD (orchestrator) | |

The bar is judged on pdfTeX, and it is missed on this machine in Node. Awesome-CV on XeTeX is
reported beside it, as the plan lets XeTeX feel slower.

### To fill the other columns

The slow laptop's: set the repository up as decision 0016 says, then
`pnpm --filter @resume-tools/editor corpus oracle` once, which fetches the upstream samples into
`.corpus/oracle/` (and probes them); run
`pnpm --filter @resume-tools/editor measure --import --json slow-laptop-import.json`; then run
`pnpm dev`, open `/?measure=import` and then `/?measure=import-xetex` in Chrome with the tab in
front, and read the table under the heading once it replaces the line that says which import is
under way. The page says whether the tab stayed in front; numbers from a hidden tab are not the
machine's. Chrome's on this machine are read the same way, from the dev server of this branch.

## Milestone 2's owed table, closed out

Each row of `docs/milestone-3.md`'s "Owed from milestone 2", where it landed, or where it goes:

| Owed | Where it landed |
|---|---|
| Imported ids minted under a prefix no curated package uses, and a loader that refuses the rest (decision 0006, item 4's review) | Landed. Item 7: the curated loader refuses an id under `import-` (`checkCuratedId`, decision 0026). Item 12: the store refuses an imported package outside the prefix, or with a curated id, when it keeps one and when it reads one (`PackageRefused`, decision 0038) |
| The harness in a worker the browser can terminate (decision 0008) | Landed in item 12 (decision 0038): the pipeline and its checks run in the compile worker, a cancel terminates it and starts it afresh, and a compile of an import past 120 s is taken for hung and gets the same |
| The `controls` check draws each font an import proves (decision 0012) | Landed in item 14 (decision 0040): the harness draws the fields in each font a package offers, and an import drops a font it cannot draw |
| A template chooser for a new document | Landed in item 12 (decision 0038): the list's New offers the three curated templates, each with its name, a line on its look and its engine |
| The slow laptop's column in decision 0016 | Stays owed, the owner's, with the same commands. This record adds the import's rows to it, filled the same way (Findings) |
| Small capitals and per-shape features for Awesome-CV (decision 0014's additions) | Landed in item 8 (decision 0023): features per shape, small capitals with `+smcp` among them, and a substituted glyph's text read back through the font's substitution table |
| Case folding in the aligner, for a field set through `\MakeUppercase` (decisions 0007 and 0013) | Landed in item 5 (decision 0021) |
| The first load at 42 to 44 MB uncompressed | Stays owed, to milestone 5: the CDN's compression, the per-engine build and a template's format from the cache (decision 0016's consequences) |
| The PDF's text layer showing a hyphen as U+2011 in some XeTeX fonts (decision 0014) | Stays owed, to the ATS's reader, outside the editor |
| The PDF's text layer showing an import's small capitals as capitals (decision 0026) | Stays owed, to the ATS's reader or the PDF driver, outside the editor |
| An imported section whose head opens its content's list kept as one unit with the locked part that closes it (decision 0026) | Landed in item 12 (decision 0038), with a section's `after` and a region that runs to its lists' closers. What that left, the list sections of ten Jake forks, fixed until an opener and its closer are paired by the environments the macros' definitions begin and end, is decision 0038's own to take up, not milestone 2's |

So seven rows landed in milestone 3, and four stay owed, none of them to this milestone: the slow
laptop's column to the owner, the first load to milestone 5, and the PDF's text layer to the ATS.

## Consequences

- The milestone's bar, a cached template imported in under 5 s, is missed as the editor stands: by
  1.55 s on pdfTeX in Node on this machine, before the browser's number, which decides it for a
  person, is in. This record measures and changes nothing in the pipeline. What each candidate
  would save, from the numbers above, for the item or record that takes the bar up:
  - The harness's dumps of formats the checks had dumped, 0.56 s: it could take the checks'
    formats, its own `dump` check answered by theirs.
  - The page's dump of the package's format, 0.27 s: the checks dumped that format and dropped it;
    handed to the compiler, as the compiler hands its kept formats to a new worker, it would also
    reach the store as any format does.
  - The checks themselves, 31 compiles from the package's format at 85 ms and 1.32 s for the font
    sizes' formats: what judges the template rather than the document's words, the units it adds
    and removes and the controls it tries, could be kept with the package, or with the cached
    answer, and not compiled again for a template seen before. That skips checks on a person's
    import, which a record of its own would have to accept, as the milestone's risks foresaw.
  - The first two take the import to about 5.7 s; the bar needs about nine of the checks' compiles
    besides, or the sizes' formats.
- The engine's start is apart from the bar, but a person importing into an empty list waits for
  it: the compiler makes its engine only when a document first needs one, so the list starts none.
  Starting it as the list shows would take Chrome's start, 0.4 s in decision 0016, out of the wait.
- A cached XeTeX template takes over a minute and a quarter, about sixteen times the bar, which
  the plan lets XeTeX miss. Most of it is the probe's whole compiles: decision 0022 compiles whole
  only until item 8's fonts by file, which now make the preamble dumpable, so probing from that
  format, as pdfTeX's probe does, would take each of its 37 compiles from 1.38 s to about the
  checks' 0.24 s and save some 40 s, if the probe's verdicts hold there, which a later item would
  have to show. The progress line's "slower the first time" undersells a wait of that length.
- The measurement keeps nothing and leaves out the store's write and read between the import and
  the page, a few IndexedDB transactions, and what React does with each step's progress line.
- The browser's page takes its samples from the dev server, which reads them from `.corpus/oracle/`
  only as the oracle names them; without `corpus oracle` it answers 404 and says to run it.
- Node's numbers are not a person's for the engine's start, and its imports run in a runtime that
  the warm-up has already compiled, where each of the browser's runs on a new worker compiles the
  pipeline's code afresh; Chrome's column is the one that says what a person waits.
