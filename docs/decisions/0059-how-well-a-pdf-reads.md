# 0059. How well a PDF reads, tracked

Date: 2026-10-04 · Status: accepted

## Context

Item 15 of `docs/milestone-3-overhaul.md`: item 3's three sets (decision 0051) become the way the
PDF import's reading is tracked from now on. The two sets with a truth become tests of the rules,
with the owner's targets of 4 October 2026 as their thresholds; the corpus set becomes a command
that reports counts and never text, run by hand as the corpus run is; and the model's reading is
measured by a command run by hand with the key, on the invented sets only, while the suite tests
its path with a recorded reply and no model is called in CI. Items 10 to 13 (decisions 0052 and
the records of items 11, 12 and 13) built the reader, the layout, the rules and the model's
labeller this measures.

## Decision

### The suite

`apps/editor/src/pdf/round-trip.test.ts`, item 12's file, is where every PDF target with a truth
is a threshold, exactly as "Done means" sets it under "For a PDF import":

| Target | Threshold in the suite |
|---|---|
| Rules, built-in templates: every word read lands | `everyWordLands` on each of the nine PDFs |
| Rules, built-in templates: name, email, phone, links, section titles and roles, bullets exact | no field of those kinds wrong, on each PDF |
| Rules, built-in templates: entries with title, place and dates right, title and subtitle a pair | at least 95% of the 45 |
| Rules, other tools: fields right | at least 80% of the 211 |
| Rules: under 1 s a PDF | pdf.js's reading and the rules together under 1,000 ms of this thread's CPU time, on each of the seventeen PDFs (`src/test/timing.ts`'s `cpuMsAsync`), a ceiling and not a wall-clock bound |
| Model, other tools: fields right | at least 90% of the 211, from the model's recorded replies |

- Item 12's test asserted more than the targets: every field but an entry's title right on the
  built-in PDFs, place and dates included, and nothing in the catch-all. Those are dropped as
  thresholds, so a change of the rules fails the suite only where it misses a target; every word
  read landing stays an assertion on every set, being the import's promise that nothing is
  dropped, as does the test that each filed resume typesets again.
- **The model's path** reads the eight PDFs of other tools through the code the editor ships: the
  page's labeller with a yes on record posts to the service's handler in the same process, whose
  model is the AI SDK's mock giving back the model's recorded reply for that PDF. The replies,
  `src/pdf/fixtures/model-replies.json`, are `qwen3.8:27b`'s raw content from this item's run,
  the roles by line id and no text. Item 13's one recorded reply (`model-reply.chrome-table.json`)
  and its test in `model-labeller.test.ts` are replaced by them. The platform's `fetch` is stubbed
  for the test and asserted never called, and every PDF must be read by the model, not by the
  rules' fall back, so a change of the layout that renumbers lines fails here until the replies
  are recorded again.
- The test logs its numbers on each run, as the harness's timing test does.

### The corpus command

`pnpm --filter @resume-tools/editor pdf-corpus` (`scripts/pdf-corpus.ts`, its child
`scripts/pdf-corpus-child.ts`, its counts and tables `scripts/pdf-counts.ts`) is the spike's corpus
set promoted: each fetched corpus document that compiles is made a PDF by xdvipdfmx, as the editor
exports one, read by the editor's reader (`src/pdf/node.ts`) and turned into a resume by
`resumeOfPdf` with the rules, in a pool of four, 120 s a document. Each document's counts, by id
and family, go to `.corpus/pdf-corpus/<id>.json` and their sum to `summary.json` beside them; it
prints, a document a line, counts only, then the table and the three targets for this set, each
met or not. `--only`, `--ids`, `--limit`, `--again` and `--out <folder>` work as the spike's did.
New counts: the entries whose dates the resume holds as dates, and pdf.js's reading and the rules
together a PDF. It is never run in CI, and no corpus document is given to a model.

### The model command

`pnpm --filter @resume-tools/editor pdf-model other|builtin|both [--passes <n>] [--record]`, item
13's command, now prints the owner's targets for the model, each met or not, and `--record` writes
the replies for all eight PDFs of other tools from its last pass. Its guard is the spike's
(`assertInvented`, with its test in `scripts/spike-pdf/model.test.ts`): it reads only a PDF in the
invented sets' own folders with its truth beside it.

### The spike

The spike's `corpus` command is retired, with its child and its counts module, since `pdf-corpus`
replaces them; it now says so and points to the new command. `spike-pdf builtin|other [--model]`,
`reader` and `--report` stay as they were, for decision 0051's tables and `results.json`, whose
corpus part is the spike's own run and is printed by `pdf-counts.ts`'s table.

### The results

Runs of 4 October 2026, at 7aeca70 with this record's code uncommitted, in Node on this machine
(Apple silicon).

**Rules, the built-in templates** (`round-trip.test.ts`; nine PDFs, three templates typesetting
the three curated samples)

| Target | Result | |
|---|---|---|
| Every word read lands | 9 of 9 PDFs | met |
| Name, email, phone, links; section titles and roles; bullets exact | 9 of 9 PDFs | met |
| At least 95% of entries right, title and subtitle a pair | 100% (45 of 45); 73.3% (33) by the title alone | met |
| Fields right in all | 96.5% (333 of 345) | |

**Rules, the corpus** (`pdf-corpus`, counts only)

| Target | Result | |
|---|---|---|
| Every word read lands | 73 of 73 documents read (45,474 words read, 45,487 land) | met |
| At least 95% of words in a recognised place | 97.7% (44,410); the catch-all 2.4% (1,077 words, 284 lines, in 51 documents) | met |

Of the 220 documents: read 73 (148 pages); not read: xdvipdfmx made no PDF 42 (a font with no
outline 39, a `psfile=` special 2, xdvipdfmx failed 1), refused by the reference compile 103
(package 38, stopped 27, font 21, file 9, class 5, LuaTeX 3), past the reader's caps 2. Columns,
the most on a page: one 57, two 16; 22 pages with more than one. Sections 468, median 6 a document,
no document without; entries 841, 373 of them with dates; bullets 2,305. Header found: name 73,
email 68, phone 51. A document's recognised share: median 99.4%, 72 of 73 at 85% or more. By
family, recognised: jake 99.2%, awesome-cv 98.4%, altacv 97.7%, europecv 96.5%, other 96.3%,
moderncv 96.1%. These are item 12's counts: no rule changed.

**Rules, invented resumes from other tools** (`round-trip.test.ts`; eight PDFs, 211 fields)

| Target | Result | |
|---|---|---|
| At least 80% of fields right | 91.9% (194 of 211) | met |

The six the rules were debugged on read 98.8% (161 of 163); the two held out 68.8% (33 of 48), for
the causes decision 0051 gives. The held-out pair is the closer guide to layouts not yet seen, and
it is under the target; that stays the open risk of the rules until PDFs the rules were not tuned
on are added.

**Rules, time**

| Target | Result | |
|---|---|---|
| Under 1 s a PDF | pdf.js's reading and the rules together: in the suite, at most 194 ms of CPU time on the built-in PDFs (the first, which loads pdf.js) and 38 ms on the other tools'; on the corpus, median 28 ms and at most 118 ms elapsed (rules alone 11 and 51 ms) | met |

In the browser the reader's worker, its download and its start come on top (decision 0052).

**The model** (`pdf-model both --passes 1`, `qwen3.8:27b` on SoCLaaS, one pass; the key from the
keychain, inline)

| Target | Result | |
|---|---|---|
| At least 90% of fields right on invented resumes from other tools | 95.7% (202 of 211); held out 41 of 48 | met |
| Inside a time budget of 15 s, then the rules | 8 calls, 2.0 to 5.8 s, median 4.2 s; none past the budget, no fall back | met |

On the built-in PDFs, not the target's set, it read 95.7% (330 of 345), 9 calls in 3.7 to 9.3 s,
median 6.7 s. Item 13's three passes read 95.7% each on both sets; this pass agrees. In the suite,
the recorded replies read 95.7% (202 of 211) through the same path.

### Rerunning them

```sh
# The suite's thresholds (needs .engine/ for the built-in templates):
pnpm --filter @resume-tools/editor test src/pdf/round-trip.test.ts
# The corpus, by rules, counts only (needs `corpus fetch` and .engine/), by hand:
pnpm --filter @resume-tools/editor pdf-corpus
# The model, on the invented sets only, by hand, with the key:
SOCLAAS_API_KEY="$(security find-generic-password -s soclaas -w)" \
  pnpm --filter @resume-tools/editor pdf-model both --passes 1
# ... and to record the suite's replies again after the layout changes:
SOCLAAS_API_KEY="$(security find-generic-password -s soclaas -w)" \
  pnpm --filter @resume-tools/editor pdf-model other --passes 1 --record
```

## Consequences

- Every PDF target is met, on every set. The gap to watch is the rules on layouts they were not
  tuned on: 68.8% on the two held out, under the 80% the eight together reach. Each fix of the
  rules should be judged on PDFs added for the purpose, which the owner may make in other tools.
- A change to the rules, the layout or the filing fails the suite only where a target is missed.
  A change that renumbers a PDF's lines also fails the model's test until `pdf-model --record` is
  run again with the key, by hand; CI never calls a model.
- `pdf-corpus` is the corpus set's measure from now on, beside `corpus run`; like it, a run is
  the author's call and never a merge requirement. Its counts say nothing is dropped and little
  is left unsorted, and now how many entries carry dates; they still cannot say the structure is
  right.
- Item 18 takes the model's time from `pdf-model`, as the plan says.
