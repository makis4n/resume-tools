# 0045. The import measured, and milestone 2's owed table closed

Date: 2026-10-01 · Status: proposed; raises milestone 3's import bar to under 8 s (2026-10-02)

## Context

Milestone 3 is done, among other things, when "a cached template imports in under 5 seconds",
plan section 4.3's target for an import whose template is already cached, which the owner raised
for the milestone to under 8 s on 2 October 2026 (below). Item 19 measures it as decision 0016
measured the editor: a cached pdfTeX template, a fork of Jake's Resume, from the file to the page,
in Node and in the browser with a warm HTTP cache, with the XeTeX number beside it, the numbers
next to decision 0016's, and the slow laptop's column left for the owner to fill with the same
command; and it closes out the milestone's table of what milestone 2 owed. Item 12 (decision 0038)
runs the import in the compile worker, on the editor's own engine; its test imported an invented
fork of Jake's Resume in 5.5 s, under other work. Item 13 (decision 0039) reads the import's report
between its outcome and the page. The code is `apps/editor/src/measure/import.ts`, `node.ts` and
`ImportMeasurePage.tsx`, and `apps/editor/scripts/measure.ts` and `serve-samples.ts`.

## Decision

### The bar: under 8 s, raised from 5 s

- On 2 October 2026 the owner raised the bar for an import of a template already cached, the
  milestone's, from under 5 s to under 8 s, after the measurement below had the pdfTeX import
  0.41 s over 5 s in Node, the rest of its time TeX's: "raise the limit, I don't mind even if it
  takes a few more seconds." Eight seconds is this record's reading of "a few more seconds"; the
  owner may set another number, and the measurement (`TARGETS.importCached`) and this record
  follow it.
- It amends the milestone's Done means, "a cached template imports in under 5 seconds", and item
  19's bar, "under 5 s on this machine": `docs/milestone-3.md` gives both as under 8 s, citing this
  record, as do its decision on the bar and the two risks that cited 5 s.
- It does not amend the plan. Plan section 4.3's row, "Import, template already cached: under
  5 s", and milestone 3's Done means in its section 9 are the owner's to revise on the shared page
  that `docs/editor-plan.md` mirrors; until then the plan says 5 s, and the milestone is judged at
  8 s. Decisions 0020 and 0023, which weigh their costs against item 19's 5 s, were written to the
  bar as it then stood.
- What the bar is judged on is as before (below): pdfTeX, a cache hit, in Chrome with the engine's
  start and without `load`, and in Node without the engine's start.

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
  gives it a person's files, its report is read, and the document it comes to opens with its
  package and job, `Compiler.open`, as the app opens it, to its first drawn page
  (`measureImport`). The store's write and read between the import and the open, in IndexedDB,
  are left out: the measurement keeps nothing.
- The report is read as the app reads it between the import's outcome and the page
  (`reportOfImport`, decision 0039), and timed as a part of its own, `report`. The app reads it to
  say whether the import succeeded, and holds a partial one in the list, its report shown, until
  the person clicks Continue, and only then keeps and opens the document. The measurement goes
  straight on to the page, partial or not, so its whole is the machine's time and leaves the
  person's out. Jake's Resume's sample comes out partial, 83.0% of its words editable, 323 of 389,
  so a person importing it sees the report once `report` ends, clicks Continue, and waits for
  `page`.
  The app reads the report a second time as it opens an imported document, for the names its side
  panel gives the locked parts (decision 0041), which is in `page`.
- The parts come from what the import says as it goes (`ImportProgress`): each step from its first
  word to the next step's, with the compiles and the dumps or PDFs it began, and the time TeX took,
  from each request's first word to its last; before them the wait for the first word, while the
  worker loads the import's code and the tree's fonts at its first import (`load`); and after them
  the report, and the page, from the report to the page drawn, with the scheduler's dump, compile
  and draw. The steps are the pipeline's own, whatever it gains later, and the parts add up to the
  whole. The assembly is not a step of its own: `validate` assembles, checks, and assembles again
  with what the checks decided (decision 0026), so the two are timed as one, "Checking the imported
  template", and the findings below count its requests one by one.
- Each import runs on an engine started afresh, as a newly opened editor's worker is, with fonts
  of its own. The engine's start is timed apart, before the import, and `load` is a part of its own.
- One import first is not counted: it fills the HTTP cache, which the bar assumes warm, and
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

### What the bar is judged on

- Only a cache hit: every timed import's naming step answered from the cache, none of the
  template's macros asked of a model or left unnamed, and the service not failed. Otherwise the
  table says why it was not one, and gives no verdict: the dev server's rate limit, ten requests a
  minute, can fail the naming step of a page reloaded in a hurry, and an import whose every macro
  stays locked is quicker and proves nothing.
- In Chrome, with the engine's start: a person whose list shows no document waits for it, since the
  app starts no engine then (`App.tsx` makes the compiler's engine only when a document or an import
  first needs one). And without `load`, which the dev server makes slow: each new worker loads the
  pipeline as some seventy modules, each revalidated, where a build loads one chunk from the cache.
  The page gives `load` on a line of its own.
- In Node, without the engine's start, which compiles the engine afresh at every start, 3.4 s here,
  where Chrome keeps it compiled (decision 0016 had it start in 0.4 s).
- Either way, the machine's time alone: a partial import goes straight on to its page, its
  report's wait for the person's Continue left out (above).

### Each format dumped once, and each control's value compiled once

The two speedups below change what an import compiles, not what it proves. An engine test imports
the same invented document with them and without (`ValidationInputs.share`, false only for that),
and holds the package, the document, the locks and every finding to be the same, but for how many
compiles it took.

- A format's name is a hash of exactly what is dumped (`generateFormat`), and the checks and the
  harness dump with the same files, so the same name is the same format: the harness no longer
  dumps one the checks dumped. It puts the checks' back instead (`harnessSession`), which starts the
  jobs compiled with it again as new documents, keeping their files, as a dump that replaces it
  does, and their dump's result answers its `dump` check. The checks take one the harness dumped
  the same way.
- The import hands the editor the format its document opens with (`Imported.formats`), as the
  checks dumped it, and the compiler keeps it as it keeps a format it dumps, in its bytes and in the
  store: the page puts it in place rather than dumping it a third time. The worker hands its bytes
  over rather than copying them.
- The harness's `controls` check does not compile a value check 4 has proven (`Proven`): one that
  compiled from its format, with the same body, with no error in its log, and set other glyphs than
  the document's own, which is all the controls check asks of a value. It still compiles the date
  format, which check 4 does not try, and each font, whose output it draws besides. And it skips
  only a run of such values that no compile from the same format follows straight after, which
  would read what theirs wrote; where a skipped value would have moved the job to another format,
  the next compile starts afresh all the same, as it would have.

## Findings

This machine is decision 0016's M4 Pro, 12 cores and 24 GB, on macOS with Node 24.15. The numbers
below are the branch's as it stands, with main's items 13, 15 and 18 taken in (the report, check
3's tries of the locked parts, the naming model) and the speedups above made, measured on
3 October 2026 on an otherwise idle machine, each a median of five: in Node at a one-minute load
average of 2.6 as the pdfTeX imports began and 3.0 as they ended, and 3.0 to 3.4 for XeTeX's; in
Chrome, the owner's own, at `?measure=import` and `?measure=import-xetex` on this branch's dev
server, the tab in front throughout. Where a cell says "before the merge", that is the same
measurement in Node before main's items were taken in, at a load of 2.3 to 2.4 for pdfTeX and 2.3
to 1.8 for XeTeX, with the machine shared with other worktrees. Before the speedups, a pdfTeX run
at 1.7 to 2.6 took 6.55 s, and one at 5.2 to 5.5, while another worktree's corpus run kept four
cores busy, 6.69 s; a XeTeX run at 5.5 to 5.7 took 81.69 s. A run while another worktree's whole
test suite ran, at a load of 16, took 107 s for Awesome-CV's import that warms up, and is not used.
The slow laptop's cells are the owner's.

Jake's Resume's upstream sample on pdfTeX, each part a median of five imports:

| | This machine | Slow laptop |
|---|---|---|
| Node: the import, from the file to the page | 5.38 s, from 5.33 to 5.47 s: 38 compiles and 5 dumps or PDFs, 5.17 s of it in TeX; 5.41 s before the merge, 6.55 s before the speedups | |
| Node: loading what the import runs with, at the worker's first import | 15 ms | |
| Node: the intake | 3 ms | |
| Node: the reference compile | 375 ms: 1 compile, whole, from the stock format | |
| Node: the signatures | 288 ms: 2 compiles | |
| Node: the parse | 1 ms | |
| Node: the probe | 599 ms: the document's own format dumped, 2 compiles | |
| Node: the naming request, built and checked, and the naming service | 9 ms and 3 ms: 7 macros named from the cache, none asked of a model | |
| Node: the assembly and its checks, `validate` | 3.92 s: 32 compiles and 4 dumps or PDFs, 3.82 s of it in TeX; 3.95 s before the merge; 4.81 s, 35 compiles and 6, before the speedups | |
| Node: the report, read as the app reads it | 1 ms: no request, the reference's glyph stream read | |
| Node: the page | 171 ms: its format put in place as the checks dumped it, two passes in 142 ms, drawn in 26 ms; 447 ms before the speedups, its format dumped in 274 ms | |
| Node: the engine's start, before the import | 3.49 s | |
| Chrome (`?measure=import`): the import, with the engine's start and without `load` | 5.39 s; 5.50 s in a first run | |
| Chrome: the parts, as the page's table gives them, `load` among them | the whole 5.11 s, from 5.09 to 5.23 s (5.21 s in the first run); `load` 60 ms; `validate` 3.63 s, 32 compiles | |
| Chrome: the engine's start, before the import | 340 ms | |

What the import came to, every time, before the speedups and after: assembled, 47 fields editable
and 5 locked, the document on one page, as `corpus oracle` assembles the sample. Its report, which
item 13 added, comes out partial: 83.0% of its words editable, 323 of the reference's 389, which a
count by hand agrees with exactly.

Awesome-CV's upstream sample on XeTeX, each part a median of five imports:

| | This machine | Slow laptop |
|---|---|---|
| Node: the import, from the file to the page | 79.12 s, from 77.36 to 79.29 s: 119 compiles and 9 dumps or PDFs, 76.88 s of it in TeX; 77.39 s before the merge, 81.69 s before the speedups | |
| Node: loading, the intake, the parse, the naming request and the naming service | 14 ms, 4 ms, 1 ms, 35 ms and 11 ms: 19 macros named from the cache, none asked of a model | |
| Node: the reference compile | 2.88 s: 1 compile, whole, fontconfig given the tree's fonts (decision 0019) | |
| Node: the signatures | 1.54 s: 2 compiles, whole | |
| Node: the probe | 51.91 s: 37 compiles, each whole from the stock format, 1.40 s apiece (decision 0022) | |
| Node: the fonts declared by file, and their check (decision 0023) | 1.60 s: its format dumped, 2 compiles | |
| Node: the assembly and its checks, `validate` | 20.80 s: 76 compiles and 8 dumps or PDFs from the package's formats, 19.42 s of it in TeX, 0.23 s apiece; 20.35 s before the merge; 22.67 s, 79 compiles and 10, before the speedups | |
| Node: the report, read as the app reads it | 2 ms | |
| Node: the page | 337 ms: its format put in place, two passes in 268 ms, drawn in 35 ms; 907 ms before the speedups, its format dumped in 581 ms | |
| Node: the engine's start, before the import | 3.53 s | |
| Chrome (`?measure=import-xetex`): the import, with the engine's start and without `load` | 74.55 s | |
| Chrome: the parts, as the page's table gives them | the whole 74.25 s, from 73.90 to 77.27 s: 119 compiles; `load` 59 ms; the probe 48.8 s, 37 compiles; `validate` 18.9 s, 76 compiles; the engine's start 351 ms. The import that warmed up, not counted, took 191 s | |

What the import came to, every time: assembled, 119 fields editable and 17 locked, the document on
three pages. Its report comes out partial: 80% of its words editable, as it says, a rate of 80.6%.

Next to decision 0016's numbers, which do not compare like for like: each of 0016's is one run of a
fresh process at a load of 7.2, and these are medians of five warm imports at a load of about 3.
With that said, the import's compiles from the package's format average 85 ms, where 0016's edit
took 80, so an import is some sixty-five edits' worth of TeX; before the speedups, the page an
import opened to took 447 ms with its format's dump, where 0016's curated Jake's Resume took 604 ms
to its first page, and Awesome-CV's 907 ms against the curated Awesome-CV's 796 ms, on a sample of
three pages to its one. In Node the engine starts in 3.4 to 3.5 s, nearly all of it the engine's
own load, its 30 MB of WebAssembly compiled afresh at each start, where Chrome started it in 0.4 s
in decision 0016, its cache warm: Node's start is no guide to a person's.

### Where the time goes

TeX is 96% of the pdfTeX import: the JavaScript between its requests, the intake, the parse, the
naming request and the reading of each output, comes to about 0.2 s. The checks are nearly three
quarters of it. Counted request by request, in imports of their own whose session noted each dump,
compile and PDF with the check that asked for it, at a load of about 4:

| Where | Requests now | TeX now | Before the speedups |
|---|---|---|---|
| The reference compile, the signatures, the probe | 1 + 2 + 2 compiles, and the probe's format dumped | 1.23 s | the same |
| Check 1: the original as the reference was, from the package's format, dumped here, and the body the generator makes | 3 compiles, 1 dump | 0.83 s | the same |
| Check 2: every field set long, empty and to special characters | 3 compiles | 0.23 s | the same |
| Check 3: a unit of each kind added, and the first and last removed | 12 compiles | 0.90 s | the same |
| Check 4: every value of each control, the class's other two sizes formats of their own (decision 0006) | 10 compiles, 2 dumps | 1.51 s | the same |
| The harness: the package's format put back, its compiles and its PDF | 3 compiles, 1 PDF | 0.32 s | 0.59 s, the format dumped again |
| The harness's controls: the date format alone, the others proven by check 4 | 1 compile of two passes | 0.15 s | 0.72 s: 4 compiles, one size's format dumped again |
| The page: the package's format put in place | 1 compile of two passes | 0.15 s | 0.42 s, the format dumped a third time |

The table was counted before the merge of items 13, 15 and 18. Since then check 3 also takes each
locked part that may stop the compile, one that ends an environment it did not begin or begins one
it does not end, removed and moved one place up and down, up to three compiles a part (decision
0041); a part that ends what it begins is not tried, as neither of the two parts of the invented
fork of Jake's Resume that the editor's tests import is. The sample has no part that is tried
either: `validate` compiles 32 times after the merge, as before it. The report adds no request: it
reads the reference's glyph stream, in the app's thread rather than the worker's, twice (`report`,
1 ms, and `page`).

On XeTeX, TeX is 97% too, and the probe is 66% of the whole: decision 0022 compiles every probe
whole from the stock format on XeTeX, since a preamble that loads fontspec cannot be dumped, and
each of its 37 compiles takes 1.4 s, where `validate`'s, from the package's formats with the fonts
declared by file, take 0.23 s. The checks take 20.80 s more, the reference and the signatures 4.42
s together, and everything else under 2.5 s. Chrome is quicker at both: 48.8 s for the probe and
18.9 s for the checks.

### Against the bar

| Target | Limit | Jake's Resume, Node | Jake's Resume, Chrome | Awesome-CV, Node | Awesome-CV, Chrome | Slow laptop |
|---|---|---|---|---|---|---|
| Import, template already cached | under 8 s, raised by this record from plan section 4.3's 5 s | 5.38 s, met, under 8 s by 2.62 s and over 5 s by 0.38 s, without the engine's start; 5.41 s before the merge, 6.55 s before the speedups | 5.39 s, met, under 8 s by 2.61 s and over 5 s by 0.39 s, with the engine's start and without `load`; 5.50 s in a first run | 79.12 s, reported, not judged | 74.55 s, reported, not judged | |

The bar is judged on pdfTeX, and only on imports that were all cache hits, which these were. The
import meets the raised bar on this machine, in Node by 2.62 s and in Chrome, which decides it for
a person, by 2.61 s, where it misses the plan's 5 s by 0.38 s and 0.39 s. Chrome's cell counts the
engine's start, which a person importing into an empty list waits for, and still comes out level
with Node's, which leaves it out: Chrome's engine starts in 340 ms where Node's takes 3.49 s, and
its import, 5.11 s without the start, is quicker than Node's 5.38 s, its checks 3.63 s to Node's
3.92 s. A first run in Chrome took 5.50 s with the start, 5.21 s without. Awesome-CV on XeTeX is
reported beside the bar and not judged, as the plan lets XeTeX feel slower, and the measurement
says so: its verdict line reads "reported, not judged" where pdfTeX's reads "met" or "missed".

### To fill the other columns

The slow laptop's: set the repository up as decision 0016 says, then
`pnpm --filter @resume-tools/editor corpus oracle` once, which fetches the upstream samples into
`.corpus/oracle/` (and probes and assembles them); run
`pnpm --filter @resume-tools/editor measure --import --json slow-laptop-import.json`; then run
`pnpm dev`, open `/?measure=import` and then `/?measure=import-xetex` in Chrome with the tab in
front, and read the table under the heading once it replaces the line that says which import is
under way. The page says whether the tab stayed in front; numbers from a hidden tab are not the
machine's. Chrome's on this machine were read the same way, from the dev server of this branch.

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
| An imported section whose head opens its content's list kept as one unit with the locked part that closes it (decision 0026) | Landed in item 12 (decision 0038), with a section's `after` and a region that runs to its lists' closers. What that left, the list sections of ten Jake forks, fixed until an opener and its closer are paired by the environments the macros' definitions begin and end, is decision 0038's own to take up, not milestone 2's. Item 15 (decision 0041) has check 3 pin a locked part that holds a list's closer against a removal or move that would stop the compile, and the app takes back any structural step that does |

So seven rows landed in milestone 3, and four stay owed, none of them to this milestone: the slow
laptop's column to the owner, the first load to milestone 5, and the PDF's text layer to the ATS.

## Consequences

- The milestone's bar is now under 8 s (above), and the pdfTeX import meets it on this machine: in
  Node by 2.62 s, and in Chrome, which decides it for a person and counts the engine's start, by
  2.61 s; it misses the plan's 5 s by 0.38 s and 0.39 s. Item 19 is done on these numbers. The
  two speedups took 1.14 s off and prove what they proved before. What is left is TeX's, and
  nothing else as large can go without checking less: check 4's two size formats and their
  compiles, 0.87 s before the merge, and check 3's compiles, twelve in 0.90 s then, judge the
  template rather than the document's words, so they could be kept with the package, or with the
  cached answer, and not compiled again for a template seen before; that skips checks on a
  person's import, which a record of its own would have to accept, as the milestone's risks
  foresaw. The raised bar does not ask for it; the slow laptop's column, or a person's wait, may.
- A person whose import is partial, as Jake's Resume's sample is, waits twice: until its report
  shows, at the end of `report`, and from their Continue until the page, `page`. The bar's whole
  adds the two and leaves their reading of the report out; an import that succeeds goes straight
  on to its page in the app, as here.
- Opening the document before check 4 finishes, its controls offered once they are proven, would
  put the page in front of the person sooner by about what check 4 and the harness take, 2 s, but
  it changes what the person sees, a page whose controls come later, and waits for the owner's
  decision.
- The engine's start counts in Chrome's verdict, and a person importing into an empty list waits
  for it: the compiler makes its engine only when a document first needs one, so the list starts
  none. Starting it as the list shows would take Chrome's start, 340 ms here and 0.4 s in decision
  0016, out of the wait.
- A cached XeTeX template takes well over a minute, which the plan lets XeTeX miss. Most of it is
  the probe's whole compiles: decision 0022 compiles whole only until item 8's fonts by file, which
  now make the preamble dumpable, so probing from that format, as pdfTeX's probe does, would take
  each of its 37 compiles from 1.35 s to about the checks' 0.23 s and save some 40 s, if the probe's
  verdicts hold there, which a later item would have to show. The progress line's "slower the
  first time" undersells a wait of that length: the first import in Chrome, its HTTP cache cold,
  took 191 s.
- The speedups touch the import pipeline, so a corpus run is worth doing: `corpus run`'s share of
  successful imports, held to `baseline.json`, the page size, margins and font size on each
  (decisions 0040 and 0043), and `corpus assemble`'s outcomes should not move, only their compiles
  and times, which is what the engine test above shows of one invented import. Reading the report
  and raising the bar change nothing a corpus run reads.
- The measurement keeps nothing and leaves out the store's write and read between the import and
  the page, a few IndexedDB transactions, a partial import's wait for the person's Continue, and
  what React does with each step's progress line, the report and the page.
- The browser's page takes its samples from the dev server, which reads them from `.corpus/oracle/`
  only as the oracle names them; without `corpus oracle` it answers 404 and says to run it.
- Node's numbers are not a person's for the engine's start, and its imports run in a runtime that
  the warm-up has already compiled, where each of the browser's runs on a new worker compiles the
  pipeline's code afresh; Chrome's column is the one that says what a person waits.
