# 0064. The second pass measured, and milestone 3 closed

> Superseded by 00YY in what it leaves owed: the slow laptop's column is dropped, and the
> browser's numbers are 00YY's. Accepted by 00YY: XeTeX's margin, 1.49 s under the 20 s aim, is a
> known limit, not chased in milestone 3.

Date: 2026-10-05 · Status: accepted; closes milestone 3 with its second pass; its slow laptop's column is dropped, its browser's numbers are taken and its XeTeX margin is accepted by 00YY

## Context

Item 18 of `docs/milestone-3-overhaul.md`, the second pass's last: the measuring command and page
time a `.tex` import on both engines and a PDF import by rules, the model's time comes from item
15's command, and one record holds the numbers beside decision 0045's, which measured the first
pass. The targets are the plan's "Done means", which the owner set on 4 October 2026 from items 2
and 3 (decisions 0050 and 0051): a pdfTeX import under 8 s on this machine, judged on Jake's sample,
with XeTeX reported and 20 s as its aim; a PDF import by rules under 1 s; one by the model inside a
time budget of 15 s, after which the rules answer; and at least 90% of fields right by the model on
invented resumes from other tools.

## Decision

### How it was measured

- The `.tex` import is measured as decision 0045 measured it: Jake's Resume's upstream sample
  (`jake-0000`) on pdfTeX and Awesome-CV's (`awesome-cv-0000`) on XeTeX, from the file to the first
  drawn page, each import on an engine started afresh, one import first not counted, then five
  timed, medians given. The import is now the outline's (decision 0049): no naming step, and
  nothing sent.
- The PDF import by rules is new to the command (`src/measure/pdf-import.ts`, and
  `PdfMeasurePage.tsx` at `?measure=import-pdf`): each PDF goes the way the app takes it for a
  person who said no to sending its text, the reader, the layout, the labels through the model's
  labeller with a no on record, so that the rules answer and nothing is sent, the filing, and the
  review's draft on the template it opens on. That whole is what the target is judged on, at the
  slowest import, as decision 0051 gave its spike's time at most. The draft set on its template, to
  its first drawn page, is timed beside it and not in it: the review shows the resume read while
  that page compiles. The PDFs are invented, never a corpus resume or anything made from one: the
  editor's own PDF of each built-in template typesetting its own invented sample, made on the engine
  as the editor exports one, and the eight invented resumes other tools printed
  (`scripts/spike-pdf/fixtures/other/`). One pass over the eleven is not counted, then five timed.
  In Node the reader is pdf.js in the command's thread, drawing no page as a picture, and every
  page shares one engine, started once.
- The model's time is `pdf-model`'s (item 15), run by hand with the key, on the invented sets
  alone: three passes over the eight PDFs of other tools and the nine the engine makes from the
  built-in templates and the curated samples, each call through the page's labeller and the
  reading service's handler, to SoCLaaS's `qwen3.8:27b`.
- The commands:
  `pnpm --filter @resume-tools/editor measure --import --json <file>` (about 3.5 minutes here), and
  `SOCLAAS_API_KEY=... pnpm --filter @resume-tools/editor pdf-model both --passes 3`.

### The machine

Decision 0016's and 0045's: an Apple M4 Pro, 12 cores and 24 GB, on macOS, Node 24.15, measured on
5 October 2026. It was not idle: other worktrees' agents ran beside it, a one-minute load average of
4.8 as the pdfTeX imports began and 4.2 as they ended, 4.2 to 5.5 for XeTeX's, and 5.5 to 5.4 for the
PDFs. Decision 0045's first-pass numbers were taken at a load of 2.6 to 3.0 for pdfTeX and 3.0 to
3.4 for XeTeX, so this pass ran on a busier machine, and its gains are not the machine's. Decision
0060, at a load of 3.3 to 3.8, had the same samples at 2.64 s and 18.59 s, in line with these.

## Findings

Each `.tex` cell a median of five imports in Node, from the file to the page, without the engine's
start; each PDF cell over five imports of each of the eleven PDFs:

| | First pass (decision 0045) | Second pass (this record) | Target | Met |
|---|---|---|---|---|
| `.tex`, pdfTeX, Jake's sample | 5.38 s, from 5.33 to 5.47 s: 38 compiles and 5 dumps or PDFs | 2.56 s, from 2.54 to 2.57 s: 17 compiles and 2 dumps | under 8 s | met, by 5.44 s; under the plan's 5 s too |
| its parts | reference 375 ms, signatures 288 ms, probe 599 ms, naming 12 ms, checks (`validate`) 3.92 s with 32 compiles, page 171 ms | reference 357 ms, signatures 278 ms, probe 570 ms, outline 1 ms, checks 1.17 s with 11 compiles, page 162 ms | | |
| what it came to | 47 fields editable, 5 locked; partial, 83.0% of words editable | 55 editable, 2 locked; partial, 89% | | |
| `.tex`, XeTeX, Awesome-CV's sample | 79.12 s, from 77.36 to 79.29 s: 119 compiles and 9 dumps or PDFs | 18.51 s, from 18.42 to 18.57 s: 81 compiles and 3 dumps | reported, with 20 s as the aim | under the aim, by 1.49 s |
| its parts | reference 2.88 s, signatures 1.54 s, probe 51.91 s with 37 compiles, fonts by file 1.60 s, checks 20.80 s with 76 compiles, page 337 ms | reference 2.76 s, fonts rewritten 1.58 s, signatures 647 ms, probe 6.03 s with 37 compiles, checks 7.07 s with 38 compiles, page 368 ms | | |
| what it came to | 119 editable, 17 locked; partial, 80% | 150 editable, 17 locked; succeeded, 96% | | |
| The engine's start in Node, not in the whole | 3.49 s, 3.53 s | 3.39 s, 3.55 s | | |
| PDF by rules, from the file to the review's draft | none: the first pass had no PDF import. Decision 0051's spike: reading and rules 16 to 24 ms at the median, 33 ms at most on the invented sets, 232 ms on the corpus's | 18 ms at the median, 73 ms at the slowest (`chrome-right-sidebar`), from 7.52 ms; the reader 14 ms of it at the median | under 1 s | met, by 927 ms at the slowest |
| the review's draft on its template, beside it | none | 503 ms at the median, 529 ms at the slowest: Jake's Resume's format dumped in 285 ms, as a first review in a tab dumps it, compiled, drawn in 61 ms | | |
| PDF by the model: the call, a pass | none. Decision 0051's spike: 5.0 s at the median, 8.1 s at the most answered, one failed call 70.3 s | other tools' PDFs: 4.8, 4.6 and 4.5 s at the median, 6.3, 6.0 and 6.2 s at the slowest; the built-in templates': 7.6, 7.4 and 7.5 s, 8.7, 9.0 and 8.6 s; no fallback | inside 15 s, the rules answering past it | met, 9.0 s the slowest of 51 calls |
| PDF by the model: fields right | none. The spike: 92.4% to 94.3% over three passes | other tools' PDFs: 95.7%, 95.7% and 93.4% (202, 202 and 197 of 211); the built-in templates': 95.7% each pass (330 of 345) | at least 90% on other tools' PDFs | met, each pass |

Every PDF import by rules sent nothing and landed every word it read in the resume. A PDF import by
the model takes its call plus the other parts, about 18 ms: 4.5 to 7.6 s at the median here, 9.0 s
at the slowest.

### Where the time went

- **pdfTeX:** the import halved, at a busier load, because the checks did: the outline's checks
  (decision 0055) compile 11 times in 1.17 s where the first pass's assembly and checks compiled 32
  times in 3.92 s. The reference compile, the signatures, the probe and the page are as they were,
  and the naming step is gone.
- **XeTeX:** the import is a quarter of what it was. The probe compiles as often, 37 times, but from
  a saved format after the fonts are rewritten to files (item 5), about 0.15 s a compile in the
  engine where the first pass compiled each whole from the stock format in 1.40 s (decision 0022),
  as decision 0045's consequences foresaw: 51.91 s became 6.03 s. The checks compile half as often,
  38 times to 76. The whole, 18.51 s, is under the 20 s aim by 1.49 s, a margin that a slower
  machine, or a longer document, would spend: decision 0060's corpus run had 14 of its 18 XeTeX
  imports under 20 s.
- **PDF:** the reader is three quarters of the rules' import; the rules' own steps take 1 to 9 ms a
  PDF. The page the review shows, the draft on Jake's Resume, takes half a second, most of it its
  format's dump, which the target does not count since the review shows the resume read before it.
- **The model:** a call takes about 4.6 s at the median on the other tools' PDFs and 7.5 s on
  the built-in templates'. That is the PDF import's time with a yes. The slowest call
  had 6 s of the 15 s budget to spare.

### Against the targets

| Target (`docs/milestone-3-overhaul.md`, "Done means") | Measured | Verdict |
|---|---|---|
| A pdfTeX import under 8 s on this machine, judged on Jake's sample | 2.56 s | met |
| A XeTeX import reported, 20 s the aim | 18.51 s | reported; under the aim |
| With rules a PDF import under 1 s | 73 ms at the slowest | met |
| With the model, inside a time budget of 15 s, after which the rules answer | 9.0 s at the slowest, no fallback | met |
| With the model, at least 90% of fields right on invented resumes from other tools | 93.4% to 95.7% a pass | met |

No time target was missed. The other families' times are decision 0060's, from its corpus run, and
are not repeated here: Jake's forks 2.6 to 10.2 s, AltaCV's and moderncv's 5 to 178 s.

## Consequences

- Milestone 3 is closed on the second pass: items 1 to 18 of `docs/milestone-3-overhaul.md` are done,
  and `docs/milestone-3.md` points to it. The bar of under 8 s stands, met by 5.44 s.
- Still owed, as in decision 0045, and the owner's:
  - **The slow laptop's column**, with the same commands: `measure --import --json
    slow-laptop.json` in Node, then, on `pnpm dev`, `?measure=import`, `?measure=import-xetex` and
    `?measure=import-pdf` in Chrome with the tab in front.
  - **The browser's numbers on this machine** were not taken in this pass: decision 0045's Chrome
    column (5.39 s for Jake's sample with the engine's start) has no second-pass value beside it,
    and the PDF page, whose reader draws each page as a picture in its worker, has none yet. In
    Chrome the engine's start is about 0.35 s, where Node's is 3.4 s (decision 0045).
- The model's times are one afternoon's on a shared gateway; decision 0051 saw one failed call hang
  for 70.3 s, which the budget now cuts to 15 s and hands to the rules.
- XeTeX's margin under its aim is small. The probe's 37 compiles and the checks' 38 are where more
  would come from, as decision 0060's AltaCV and moderncv numbers say of pdfTeX too.
