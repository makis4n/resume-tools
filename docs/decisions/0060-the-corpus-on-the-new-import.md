# 0060. The corpus on the new import

> Accepted by 0066: AltaCV's 82.2% against 90%, which this record calls a follow-up, is a
> known limit, not chased in milestone 3.

Date: 2026-10-05 · Status: accepted; resets the baseline of decision 0043 for the outline's import; its AltaCV gap is accepted by 0066

## Context

Item 9 of `docs/milestone-3-overhaul.md`: the whole corpus runs on the new import, an outline built
from the probe with no naming step (decisions 0049 and 0055); the baseline is reset; the run is
compared resume by resume with the first pass's last run; the hand counts of the three upstream
samples are taken again and pinned; and the import is timed on pdfTeX and on XeTeX. The plan's
"Done means" for a `.tex` import gives the targets the owner set on 4 October 2026 (decision 0050).
Everything below is counts and document ids; no document's text.

## Decision

### Three runs in a row agree

`corpus run --json` over all 220 fetched documents, three times one after the other, each alone on
the machine's heavy slot, four documents at a time, on main at 23f40e5 (runs 1 and 2, the worktree
holding only this item's change to a test file) and at bd21e8f, a commit of this branch's holding
that change alone (run 3, clean), which changes nothing the import runs; the baseline names it. Each
took 6.5 to 6.6 minutes at a one-minute load of 4 to 6 from the other worktrees' agents.

| | Run 1 | Run 2 | Run 3 |
|---|--:|--:|--:|
| Success | 50 | 50 | 50 |
| Partial | 58 | 58 | 58 |
| Refused by a step | 9 | 9 | 9 |
| No reference (do not compile here) | 103 | 103 | 103 |
| Not parsed, not probed, timed out, died | 0 | 0 | 0 |
| Words of the 108 imported | 79,582 | 79,582 | 79,582 |
| Editable in place | 73.91% | 73.91% | 73.91% |
| Through the retype | 24.46% | 24.46% | 24.46% |
| Locked | 1.63% | 1.63% | 1.63% |
| At 90% or more in place | 53 | 53 | 53 |

`corpus compare` says runs 1 and 2, and runs 2 and 3, agree on all 220 documents, times aside: no
document differs in its outcome, its words, its fields or its groups. No document timed out.

The locked words, 1,295 in all, by reason: `raw` 379, `untested` 204, `shape` 171, `twice` 155,
`split` 122, `differs` 109, `moved` 64, `misaligned` 62, `breaks` 29.

By family, of the documents imported:

| | Imported | Words | In place | Retype | Locked | At 90% |
|---|--:|--:|--:|--:|--:|--:|
| jake | 35 of 50 | 22,197 | 93.7% | 6% | 0% | 30 |
| awesome-cv | 14 of 40 | 10,259 | 93.5% | 6% | 1% | 10 |
| altacv | 10 of 20 | 6,758 | 82.2% | 17% | 1% | 4 |
| moderncv | 14 of 30 | 6,887 | 54.1% | 43% | 3% | 4 |
| europecv | 6 of 10 | 2,951 | 76.7% | 18% | 5% | 1 |
| other | 29 of 70 | 30,530 | 55.3% | 42% | 2% | 4 |
| All | 108 of 220 | 79,582 | 73.9% | 24.5% | 1.6% | 53 |

### The baseline, reset

`corpus run --write-baseline --from` run 3 writes `apps/editor/corpus/baseline.json`: 220
documents, no timeout, 50 successes, a success rate of 22.73% and 73.91% of words editable in
place, at the run's commit. It replaces the first pass's (2026-10-01: no success, 19.48%), so a run
over the corpus that falls more than a point under 22.73% now fails the corpus workflow.

### Resume by resume, against the first pass's last run

The first pass's last runs over the whole corpus, 3 October 2026, read the same 220 documents:
with the committed answers alone (the brief's 0/79/11/103/26/1, 18.6% of 48,597 words, at
731c82e), and with the committed answers and the model `qwen3.8:27b` (the plan's table: 92
partial, 12 refused, 12 with no answer, 1 timed out, 22.2% of 66,453 words).

| First pass, committed answers → now | Documents |
|---|--:|
| partial → success | 46 |
| partial → partial | 33 |
| no answer → partial | 22 |
| no answer → success | 2 |
| refused → partial | 3 |
| refused → success | 1 |
| timed out → success | 1 |
| no answer → refused | 2 |
| refused → refused | 7 |
| no reference → no reference | 103 |

- **75 documents moved up**, from refused, no answer, timed out or partial to partial or success;
  none moved down. 79 imported then and 108 now; 0 succeeded then and 50 now.
- **The editable share**: 18.6% of the 79 imported documents' 48,597 words then; 73.9% of the 108
  documents' 79,582 now. Over the 79 both imported, which the two read with nearly the same words
  (48,597 and 48,615), it went from 18.6% to 85.1%, and no one of them has fewer editable words.
- Against the run with the model: 48 partial → success, 44 partial → partial, 11 no answer →
  partial, 3 refused → partial, 1 refused → success, 1 timed out → success, 8 refused → refused, 1
  no answer → refused. 22.2% of 66,453 words then; 74.9% of the same 92 documents' 66,471 now. One
  document has fewer editable words than with the model's answers, `other-0044`, 1,014 then and
  846 of 1,604 now.
- By family, committed answers then and now: Jake's 23.4% → 93.7%, Awesome-CV's 27.4% → 93.5%,
  AltaCV's 10.6% → 82.2%, moderncv's 7.7% → 54.1%, europecv's 0.0% → 76.7%, the others' 6.9% (3
  imported) → 55.3% (29 imported).
- The timeout, `altacv-0001`, now succeeds at 100%: the outline does not try the font size control
  whose 9 points stopped its body (decision 0050). The refusals by the naming request's builder
  (`jake-0021`, `other-0020`, `-0023`, `-0042`) now import, and
  its three others (`awesome-cv-0015`, `-0035`, `other-0057`) are refused by the XeTeX rewrite.

### The hand counts, taken again and pinned

The three upstream samples, imported as outlines with no naming step, their document compiled from
the format the import hands over and drawn page by page as the editor draws it, without the report.
Each word of each page's line-by-line transcription (item 13's of the first pass, decision 0039's
words, the pages unchanged) was put by hand in a field the editor's page marks, in a run of plain
text of the kept LaTeX that lines up with the page as decision 0042 defines it, or in neither:

| Sample | Words | In place, hand / report | Retype, hand / report | Locked, hand / report |
|---|--:|--:|--:|--:|
| jake-0000 | 389 | 349 / 349 | 40 / 40 | 0 / 0 |
| altacv-0000 | 232 | 168 / 168 | 51 / 51 | 13 / 13 |
| awesome-cv-0000 | 1,287 | 1,246 / 1,246 | 23 / 23 | 18 / 18 |

They agree word for word. Jake's retype is the skills block. AltaCV's retype is the header's
contacts, one of the wheel chart's labels, of two lines, the tags and the referees' addresses; its
locked words are the wheel chart's other 13 labels, written in the chart's list with their
values. Awesome-CV's retype is the five section titles, the header's contacts and the footer's
middle on its first page; its locked words are the footer's date and page number on each page and
its middle on pages 2 and 3, which a run of kept text, lined up once, does not reach.
`scripts/oracle-outline.test.ts` pins the hand counts beside the report's shares and holds the report within two of each.

### The import timed

`measure --import` (decision 0045), five imports after one not counted, from the file to the page
without the engine's start, alone on the machine's heavy slot at a load of 3.3 to 3.8 from the
other worktrees' agents:

- **pdfTeX, Jake's sample: 2.64 s** (2.62 to 2.64), 17 compiles: the probe 0.59 s, the checks
  1.21 s, the page 0.17 s.
- **XeTeX, Awesome-CV's sample: 18.59 s** (18.55 to 18.68), 81 compiles: the reference 2.74 s, the
  fonts' rewrite 1.58 s, the probe 6.07 s, the checks 7.14 s. It was about 75 s in the first pass.

From the third run's rows, four documents at a time, each import's own time:

| Engine, family | Imported | Fastest | Median | Slowest | Under 8 s | Under 20 s |
|---|--:|--:|--:|--:|--:|--:|
| pdfTeX, jake | 35 | 2.6 s | 4.2 s | 10.2 s | 34 | 35 |
| pdfTeX, altacv | 9 | 9.9 s | 26.7 s | 178.0 s | 0 | 3 |
| pdfTeX, moderncv | 14 | 5.4 s | 19.0 s | 38.7 s | 1 | 8 |
| pdfTeX, europecv | 6 | 4.8 s | 5.6 s | 16.5 s | 5 | 6 |
| pdfTeX, other | 26 | 2.7 s | 5.2 s | 82.0 s | 17 | 25 |
| pdfTeX, all | 90 | 2.6 s | 5.2 s | 178.0 s | 57 | 77 |
| XeTeX, awesome-cv | 14 | 13.6 s | 15.9 s | 35.4 s | 0 | 13 |
| XeTeX, altacv and other | 4 | 4.4 s | 30.0 s | 41.9 s | 1 | 1 |
| XeTeX, all | 18 | 4.4 s | 16.3 s | 41.9 s | 1 | 14 |

The pdfTeX imports over 30 s are `altacv-0002`, `-0014` and `-0017` (178 s, 171 compiles), and
`moderncv-0002`, `-0013` and `other-0028`; the XeTeX ones over 20 s are `altacv-0011`,
`awesome-cv-0033`, `other-0020` and `-0032`. AltaCV's and moderncv's are the probe's and the
checks' many compiles, as decision 0050 found.

### The targets

- **Every corpus resume that compiles and is probed imports; "no answer" is gone.** No answer is
  gone: no outcome of the run is one. Of the 117 documents that compile, 108 import and 9 are
  refused: 7 before the probe by the XeTeX fonts' rewrite, which sets their fonts otherwise
  (`difference`: `awesome-cv-0009`, `-0015`, `-0027`, `-0035`, `other-0031`) or meets a fontspec
  feature it cannot reproduce (`feature`: `other-0056`, `-0057`), as the first pass's rewrite
  refused them (decision 0023); and **a gap of 2 probed and refused by the checks**:
  `other-0006`, whose outline with every field kept stops the compile (`stopped`), and
  `other-0052`, whose outline with every field kept is not one the model holds, or is not compiled
  (`keep`). Each had no answer with the first pass's committed answers. Why needs the documents
  read on the engine, which this item may not do; invented documents of their shape would say.
  Decision 0065 says why, without reading them, and fixes both.
- **At least 60% of body words editable in place: met, 73.9%** of the 108 imported documents'
  79,582 words.
- **At least 90% on Jake's, Awesome-CV's and AltaCV's forks: met on Jake's (93.7%) and Awesome-CV's
  (93.5%), 91.6% over the three together; a gap on AltaCV's, 82.2%.** Two of its ten documents hold
  the gap: `altacv-0017`, 2,740 of the family's 6,758 words, of whose fields the checks' budget
  left 43 untested and so kept them as text, and 114 of whose 118 groups it left untried; and
  `altacv-0005`, 385 of whose 808 words are kept text the probe did not prove, all of it through
  the retype. Without the two, the other eight hold 90.8%. A larger budget for the checks on a
  long document, and the probe's reach on `altacv-0005`'s pieces, are what would close it.
- **At least 45 resumes at the 90% bar: met, 53**: 50 successes, and `jake-0021`, `jake-0043` and
  `other-0002`, at 100%, 96% and 95%, partial because the page their package sets differs in where
  glyphs stand before any field.
- **On each upstream sample, a bullet added to a list and removed, and a field on the last page
  opened in place:** item 7 shows the field on each sample's first and last page opening in place
  and an edit surviving a reload (pull request #98, decision 0058, and its browser check), and
  item 8 the bullet added and removed with the rest of the page unchanged but for moving down
  (its browser check).
- **A `.tex` import makes no network request: met**, `src/import/no-network.test.ts` (item 5).
- **pdfTeX under 8 s, judged on Jake's sample: met, 2.64 s.** Jake's forks in the run take 2.6 to
  10.2 s, four at a time, 34 of 35 under 8 s; AltaCV's and moderncv's take 5 to 178 s, as reported
  above.
- **XeTeX reported, with 20 s as the aim: Awesome-CV's sample 18.59 s, under the aim**; the
  corpus's 18 XeTeX imports take 4.4 to 41.9 s, 16.3 s at the median, 14 of them under 20 s.

## Consequences

- The baseline holds the outline's import to 22.73% of successes. Item 17 retires the naming step
  against these numbers, which beat the first pass's on every family.
- The AltaCV gap and the two documents the checks refuse are the follow-ups: the checks' budget on
  a long document, and the probe on the pieces it leaves.
- A corpus run takes about 6.5 minutes on this machine at four at a time, against about 15 for the
  first pass's.
