# 0079. The follow-ups' targets measured

Date: 2026-10-07 · Status: accepted, the follow-ups run's closing record; measures the targets of
0074, with 0073 and 0075 to 0078 merged; amends plan section 4.3

## Context

Decision 0074 found where the `.tex` import's last words and seconds go and set this run's targets,
each beside its number on main after the perf run (decision 0072). The fixes followed, each in its
own pull request and record: the checks' budgets spent where they win (0075), a field a line where
a text breaks its line (0076), and the end marker kept before a trailing break (0077); a diagnostic
change (0073) and a speed spike (0078) beside them. None of them is merged yet, so this record
measures them together, on a local merge that is never pushed, and gives plan section 4.3 the
targets and what was measured.

## Decision

### How it was measured

- The tree: main at `ad0a73e` with the run's pull requests merged in their merge order: #119
  (`b43bee2`), #121 (`3ff3509`), #120 (`1f21684`), #123 (`ea61fde`), #124 (`f97fcb5`), #125
  (`b5659d2`) and #122 (`f9a7506`), giving `bdccef5`. The full suite passed on it: 2,360 editor
  tests, 2 skipped, and the ATS's 41.
- Each step ran alone on the M4 Pro, nothing else of the run beside it: `corpus run --json` over
  all 220 documents, four at a time, at a one-minute load of 7.3 to 9.2, its own four imports and
  the suite before it most of that; the typing timing over the 110 imported resumes at 3.7 to 7.3;
  `measure` at 4.0 to 4.4, and `measure --import` at 4.6 to 5.0 until its last PDF imports, when
  work outside the run took the load to 13.
- The before-run is main's own run at `ad0a73e` (6.5 minutes, at a load of 4.4 to 6.2), whose
  words are the integration run of decision 0072's to the word. Today's numbers are 0072's, as
  0074 gives them.

### Against the targets

| Target (0074) | Today | Measured | |
|---|--:|--:|---|
| Words editable in place, of the imported | 84.6% | 87.7% | met, at least 86.5% |
| Imported resumes at 90% or more | 61 | 75 | met, at least 68 |
| Imported resumes under 50% in place | 5 | 3 | met, at most 4 |
| Each family, none lower: jake | 94.8% | 97.3% | met |
| awesome-cv | 93.5% | 94.2% | met |
| altacv | 83.0% | 89.6% | met |
| europecv | 78.1% | 78.1% | met |
| moderncv | 83.8% | 87.0% | met |
| The others | 76.2% | 80.0% | met |
| pdfTeX: the slowest whole import | 136.3 s | 88.6 s | met, under 100 s |
| pdfTeX: the page within 8 s (0067) | 66 of 91 | 66 of 91 | met, at least 66 |
| pdfTeX: the slowest page (0067) | 47.9 s | 49.7 s | met, under 60 s |
| pdfTeX: the slowest until every field is open (0067) | 72.7 s | 79.0 s | met, under 120 s |
| XeTeX: the page within 20 s (0067) | 17 of 19 | 17 of 19 | met, at least 17 |
| XeTeX: the slowest page (0067) | 25.8 s | 26.3 s | met, under 36 s |
| XeTeX: the slowest until every field is open (0067) | 28.2 s | 28.9 s | met, under 40 s |
| Typing on an imported resume within 300 ms (0067) | 104 of 108 | 104 of 108 | met, at least 104 |
| Typing on an imported resume, the slowest (0067) | 546 ms | 572 ms | met, under 700 ms |

- No resume has a worse outcome or fewer words in place than main's run. 69 succeed (56 before)
  and 41 are partial (54); 7 are still refused by the XeTeX fonts' rewrite and 103 still have no
  reference, both outside this run.
- The words: 72,384 of 82,497 in place, 10.4% to retype and 1.9% locked. `shape` holds 11 words,
  down from 3,250, all of them breaks the outline cannot split (0076). Check 1's `differs`, the
  probe's `moved`, `raw` and `twice` are what is left.
- The slowest whole import is `altacv-0017`, 88.6 s (142.2 s in main's run), where check 3 now
  stops when its budget cannot cover the trials left (0075); `other-0028` follows. Compiles over
  the 110 imports went from 5,845 to 5,849: the checks' savings (0075) about pay for the new
  fields a line (0076).
- The time to the page, medians: 3.8 s on pdfTeX and 11.2 s on XeTeX, as before. The slowest pages
  are `other-0028` (49.7 s) and `altacv-0017` (38.0 s) on pdfTeX. The page within 8 s holds at 66
  with no margin; this run's runs at a quieter load gave it 66 to 67.
- Typing: the median of each resume's median edit is 113 ms, p90 226 ms, by the page's own time;
  215 ms with the scheduler's pause. The four over 300 ms are `altacv-0017` (572 ms, 7 pages),
  `other-0028` (472 ms, 17 pages, typed now that the timing looks past its first page, 0073),
  `altacv-0014` (348 ms) and `altacv-0005` (310 ms). Two resumes have no field to type in.

### The guard rails

- An edit on the built-in templates: 83, 110 and 120 ms for Jake's Resume, AltaCV and Awesome-CV,
  under 300 ms; a keystroke in the overlay 0.09 to 0.13 ms; the first load 20.11, 21.48 and
  25.06 MB compressed, under 30 MB (0073 judges it compressed).
- Jake's Resume's own sample imported on pdfTeX in 4.23 s, under 8 s: its page drawn at 1.96 s and
  every field open at 3.69 s. It took 2.55 s before, in 17 compiles; its skills block is now a
  field a line (0076), 97% of its words in place where 89% were, and it succeeds where it was
  partial, at 28 compiles. Owner's decision 5 of 6 October: more editable words win while every
  time target holds.
- Awesome-CV's sample imported on XeTeX in 17.51 s, under the 20 s aim, its page at 11.88 s and
  every field open at 16.49 s (17.43 s before).
- A PDF read by rules in 53 ms at the slowest, under 1 s.

## Consequences

- Plan section 4.3 takes 0074's targets as its bars for what an imported `.tex` makes editable,
  and this record's numbers as its measured lines.
- The corpus baseline is #119's, main's after the perf run. Once every pull request of the run is
  merged, in the order above and this record last, `corpus run --write-baseline` on main takes the
  new one.
- Left for a later run, from 0074's table and what the lanes found: the marker macro, which moves
  the page by LaTeX's italic correction and microtype's protrusion where a marker stands (0077,
  about 1,460 words; a prototype gained 1,186 on 49 resumes and lost words in 3); `transform`,
  a field inside AltaCV's tags, which is the overlay's to place (0077); check 3's trials, which
  depend on each other's auxiliary files (0078); `differs`, `raw` and `twice`; and the special
  text that keeps every field of `other-0006` and `other-0015`.
