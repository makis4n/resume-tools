# 0072. The import's targets measured

Date: 2026-10-06 · Status: accepted, the perf run's closing record; measures the targets of 0067,
with 0068 to 0071 merged; amends plan section 4.3

## Context

Decision 0067 found where a `.tex` import's words and seconds go and set this run's targets, each
beside its number on main. Four fixes followed, each in its own pull request and record: a pass
only when the last one changed what the next reads (0068), the probe's budget spent on the most
words first and halved when the page names the wrong part (0069), a table's cells as fields (0070),
and the page opened when the outline is made (0071). None of them is merged yet, so this record
measures them together, on a local merge that is never pushed, and gives plan section 4.3 the
targets and what was measured.

## Decision

### How it was measured

- The tree: main at `e5b41cf` with the run's seven pull requests merged in their merge order:
  #112 (`849436c`), #111 (`71beab4`), #113 (`7f283d0`), #114 (`8d1ca2f`), #117 (`b4bf713`), #116
  (`b2447b1`) and #115 (`8d1b852`), giving `44d2f9c`. The full suite passed on it: 2,328 editor
  tests, 2 skipped.
- Each step ran alone on the M4 Pro, nothing else heavy beside it: `corpus run --json` over all
  220 documents, four at a time, at a load of 5.2 to 5.4, its own four imports most of that; the
  typing timing over the 110 imported resumes at 1.3 to 2.9; `measure` and `measure --import` at
  1.5 to 1.7; the browser pages at 2.3 to 4.1, their own compiles most of it.
- The before-run is decision 0066's run on `fc62298`, whose import code main still has. Its times
  were taken at a load of 1.7 to 4.1.

### Against the targets

| Target (0067) | Before | Measured | |
|---|--:|--:|---|
| Words editable in place, of the imported | 71.9% | 84.6% | met, at least 76% |
| The others family | 51.9% | 76.2% | met, at least 58% |
| moderncv | 54.1% | 83.8% | met, at least 60% |
| Imported resumes under 50% in place | 16 | 5 | met, at most 12 |
| Imported resumes at 90% or more | 53 | 61 | met, at least 55 |
| pdfTeX: the page within 8 s | 57 of 91 | 66 of 91 | met, at least 66 |
| pdfTeX: the slowest page | 175.9 s | 47.9 s | met, under 60 s |
| pdfTeX: the slowest until every field is open | 175.9 s | 72.7 s | met, under 120 s |
| XeTeX: the page within 20 s | 15 of 19 | 17 of 19 | met, at least 17 |
| XeTeX: the slowest page | 41.8 s | 25.8 s | met, under 36 s |
| XeTeX: the slowest until every field is open | 41.8 s | 28.2 s | met, under 40 s |
| Typing on an imported resume within 300 ms | 103 of 107 | 105 of 107 | met, at least 104 |
| Typing on an imported resume, the slowest | 1,537 ms | 549 ms | met, under 700 ms |

- Before, the whole import was the wait, since nothing opened until it ended; now the page is,
  which 0067 chose to judge.
- No resume has a worse outcome or fewer words in place than the before-run. 56 succeed (50
  before) and 54 are partial (60); 7 are still refused by the XeTeX fonts' rewrite and 103 still
  have no reference, both outside this run.
- The words: 69,803 of 82,497 in place, 13.3% to retype and 2.1% locked. The body counts 106
  words more than before, because a table's cells are now read as text. By family: jake 94.8%,
  awesome-cv 93.5%, altacv 83.0%, europecv 78.1%, moderncv 83.8%, the others 76.2%.
- The time to the page, medians: 3.8 s on pdfTeX (5.3 s for the whole import before) and 11.1 s
  on XeTeX (16.5 s). The slowest pages are `other-0028` (47.9 s) and `altacv-0017` (36.4 s) on
  pdfTeX, and `other-0020` (25.8 s) on XeTeX.
- The whole import, reported and not judged: pdfTeX median 5.6 s, 58 of 91 within 8 s, slowest
  136.3 s (`altacv-0017`, 175.9 s before); XeTeX median 16.4 s, 15 of 19 within 20 s, slowest
  43.0 s (`other-0032`). Compiles over the 110 imports went from 5,817 to 5,845, the new fields'
  checks taking about what the probe's order saved.
- Typing: the median of each resume's median edit is 110 ms, p90 211 ms, by the page's own time;
  212 ms with the scheduler's pause. The two over 300 ms are `altacv-0017` (549 ms, 7 pages) and
  `altacv-0014` (338 ms). Three resumes have no field the timing can type in, as before.

### The guard rails

- An edit on the built-in templates: 78, 104 and 117 ms for Jake's Resume, AltaCV and Awesome-CV,
  under 300 ms, and a keystroke in the overlay 0.08 to 0.12 ms.
- Jake's Resume's own sample imported on pdfTeX in 2.55 s, under 8 s, its page drawn at 1.82 s and
  every field open at 2.04 s.
- Awesome-CV's sample imported on XeTeX in 17.43 s, under the 20 s aim, its page at 11.41 s and
  every field open at 16.43 s.
- A PDF read by rules in 44 ms at the slowest, under 1 s.

### In the browser

Chrome in the app's browser pane, displayed, the tab in front throughout, on the dev server of the
same tree, one page at a time with nothing else running:

- `?measure=1`: an edit of Jake's Resume on the page in 84 ms by the page's own time, 186 ms from
  the command with the scheduler's pause; a keystroke's rows 0.10 ms.
- `?measure=import`: Jake's Resume's sample imported on pdfTeX in 2.52 s, 17 compiles, its page
  drawn at 1.71 s and every field open at 2.05 s; 2.81 s with the engine's start, under 8 s.
- `?measure=import-xetex`: Awesome-CV's on XeTeX in 16.29 s, 77 compiles, its page at 10.60 s and
  every field at 15.38 s; 16.60 s with the engine's start, under the 20 s aim.
- `?measure=import-typing`: an edit after importing each upstream sample, median of 5: Jake's
  84 ms, AltaCV's 299 ms (about 860 ms before 0068, with the pane hidden) and Awesome-CV's 180 ms,
  all three within 300 ms; 186, 401 and 584 ms with the pause.

## Consequences

- Plan section 4.3 takes these targets as its bars for an imported `.tex`, and this record's
  numbers as its measured lines.
- The corpus baseline is still the before-run's. Once every pull request of the run is merged, in
  the order above and this record last, `corpus run --write-baseline` on main takes the new one.
- Left for a later run, from 0067's table and what the lanes found: the checks' bisections spent
  on the most words first and check 3 stopping when its budget cannot cover what it has left
  (fixes 5 and 6; `other-0015` spends 163 compiles on its table's cells for no word), several
  compile workers at once (8), the outline's `shape` and the probe's `moved` (9 and 10), and the
  edited page drawn first (12), which is what still holds `altacv-0017` at 549 ms an edit.
- Node's first load, uncompressed, is 42 to 54 MB against the plan's 30 MB, which is a compressed
  size; it was so before this run, and section 4.3's measured first load is the compressed 14 MB.
