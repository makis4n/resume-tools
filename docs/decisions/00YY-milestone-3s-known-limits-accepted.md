# 00YY. Milestone 3's known limits accepted, and the slow laptop's run dropped

Date: 2026-10-05 · Status: accepted, the owner's decisions of 5 October 2026; amends 0003, 0011,
0016, 0018, 0045, 0051, 0052, 0053, 0054, 0060, 0062 and 0064

## Context

Milestone 3 closed on its second pass (decision 0064) with five known limits that its records call
open or a follow-up: Awesome-CV's XeTeX import close to its aim, AltaCV's forks under the 90% bar,
the compiling resumes xdvipdfmx makes no PDF of, the rules' reading of layouts they were not tuned
on, and the memory a near-limit PDF takes before it is refused. Beside them stood a run on a slow
laptop, a 2019 machine with integrated graphics, which plan section 4.3 asked for from the spike
onward and nobody took: decisions 0003, 0016, 0045 and 0064 left its column owed to the owner. On
5 October 2026 the owner accepted the five limits as they stand and dropped the slow laptop's run
for good. This record holds both, the browser's numbers decision 0064 did not take, and the corpus
run on main after milestone 3's follow-ups.

## Decision

### The known limits, accepted

Each is accepted as measured, with its reason. None is a follow-up of milestone 3 any more:
chasing one is out of the milestone, and a later one that takes it up writes a record of its own.

1. **Awesome-CV's XeTeX import, 18.51 s against the 20 s aim.** Decision 0064 measured
   Awesome-CV's upstream sample at 18.51 s in Node, from 18.42 to 18.57 s, a margin of 1.49 s,
   which a slower machine or a longer document would spend; decision 0060's corpus run had 14 of
   its 18 XeTeX imports under 20 s, 16.3 s at the median and 41.9 s at the slowest. Accepted
   because 20 s is an aim, not a bar: plan section 4.3 judges an import on pdfTeX, under 8 s, met
   at 2.56 s, and reports XeTeX, whose sample is under its aim. What closing the margin would take
   is fewer compiles in the probe, 37, and the checks, 38 (decision 0064).
2. **AltaCV's forks, 82.2% of words editable in place against 90%.** Decision 0060: 10 of
   AltaCV's 20 forks import, 6,758 words, 82.2% in place, 17% through the retype and 1% locked,
   where Jake's reach 93.7%, Awesome-CV's 93.5% and the three families together 91.6%. Two
   documents hold the gap: `altacv-0017`, 2,740 of the family's words, 43 of whose fields the
   checks' budget left untested and kept as text, and 114 of whose 118 groups it left untried; and
   `altacv-0005`, 385 of whose 808 words are kept text the probe did not prove, all of it through
   the retype. Without the two, the other eight hold 90.8%. Accepted as the owner's call: the
   corpus-wide targets are met (73.9% against 60%, 53 resumes at the bar against 45), and closing
   the gap would take a larger budget for the checks on a long document, on a family whose imports
   already take 9.9 to 178 s on pdfTeX (decision 0060), and a probe that reaches the pieces it
   leaves.
3. **The 42 compiling resumes xdvipdfmx makes no PDF of.** Decision 0051: of the corpus's 117
   resumes that compile, 42 get no PDF, 39 for a font with no outline in the engine's tree, 2 for a
   `psfile=` special and 1 for another failure; decisions 0053 and 0054 count them among the
   documents not read. The move onto a built-in template reads that PDF (decision 0062), so it
   cannot take them: such an import waits as it was, with a notice that its content cannot be moved
   and that the person's own PDF of the resume can be imported instead. Accepted because that is a
   way across, and the move is offered only to an import under the bar. Closing it would take the
   fonts' outlines into the engine's tree, or a reading of the page's own glyph stream in place of
   a PDF (decisions 0051 and 0062).
4. **PDF reading by rules: 68.8% on the two held-out layouts, and two columns on one grid of
   baselines read as a table.** Decision 0051: the rules read 91.9% of fields (194 of 211) on the
   eight invented resumes from other tools, 98.8% on the six they were debugged on and 68.8% (33 of
   48) on the two held out, `chrome-right-sidebar` 13 of 27 and `textutil-table` 20 of 21; decision
   0054 changed no rule and met the 80% target over the eight. Decision 0053: two columns whose rows
   share baselines read row by row, their lines interleaved, though no line merges across the gap.
   Accepted because the rules are the fallback, for a person who says no to sending and for a model
   that fails (decision 0054); the model reads the same eight at 93.4% to 95.7% a pass (decision
   0064); the review shows the PDF beside what was read, its flags first, and everything stays
   editable afterwards. A fix needs PDFs the rules were not tuned on to judge it, and the held-out
   pair stops being held out once a fix is tuned on it (decision 0054).
5. **About 1.4 GB for a second before a near-limit PDF is refused.** Decision 0052: within the
   guard's budgets, pdf.js builds what a stream holds before the caps can count it, at up to about
   ninety times the stream's size; just under 16 MB of one Tj peaked at 1.4 GB for a second in
   Node, a TJ of 3.9 million parts at 0.76 GB and a path of 2.6 million lines at 0.61 GB, each then
   refused by the caps in the reader's worker, whose end frees it. Accepted because it takes a
   stream that decodes to near the 16 MB budget, where the fixtures' largest decodes to 81 KB;
   the peak lasts about a second, in a worker the reading ends; and a lower budget, which would
   halve it, would refuse real files: a 2,000-pixel photograph compressed with Flate, as Chrome
   prints a PNG, decodes to 12 MB. The budgets stay constants in the guard, for a later record to
   lower.

### The slow laptop's run, dropped

- Plan section 4.3 had a target for a slow laptop, a 2019 machine with integrated graphics: the
  true page updated after an edit, under 500 ms. Decisions 0003, 0016, 0045 and 0064 left that
  run's numbers, and the import's beside them, to the owner. The owner dropped the run for the
  future, the owner's call and not a measurement's: no slow-laptop target, column or owed line
  stands anywhere current. The targets are judged on this machine, decision 0016's Apple M4 Pro,
  12 cores and 24 GB, in Node and in the browser.
- The plan: section 4.3 loses the row "True page updated after an edit, slow laptop" and the
  sentence that defines a slow laptop; its measured line, section 9's spike line and the risk
  "Low-end devices run out of memory" lose what they said was still to come or owed.
- The code: the measure's target row goes (`src/measure/measure.ts`), with its verdict in the
  `measure` command's summary and on the `?measure=1` page (`MeasurePage.tsx`), and the tests' lines
  for it (`src/measure/measure.test.ts`, and `scripts/measure.test.ts`'s count of the summary's
  rows, three now); the measuring pages' comments (`MeasurePage.tsx`,
  `ImportMeasurePage.tsx`, `PdfMeasurePage.tsx`) no longer name the slow laptop; the command's
  footer drops its line that the target counts only on a 2019 laptop (`scripts/measure.ts`); and
  `spike/xetex-loop-report.md`'s note says the run was dropped.
- Decisions 0003, 0011, 0016, 0018, 0045 and 0064 keep their bodies as history under a banner
  pointing here, and `docs/milestone-2.md` and `docs/milestone-3.md` say it was dropped where they
  called it owed or a risk.

### The two resumes the checks refuse

Decision 0060's gap of 2, `other-0006` (`stopped`) and `other-0052` (`keep`), is not among the
limits above: decision 00XX settles it.

### The browser's numbers

Decision 0064 took its numbers in Node and left the browser's to come. They are this
machine's, from the four measuring pages:

- `?measure=1`: Jake's Resume's curated sample opened as a new document through the worker, as the
  app opens one: the engine's start and the first page, the overlay's row layout of the sample's
  longest field (median of 100), and ten edits of that field, each from its command to the page it
  brings, with the scheduler's pause and by the page's own time; judged against the keystroke,
  under 16 ms, and the typical edit, 300 ms.
- `?measure=import`: Jake's Resume's upstream sample (`jake-0000`) imported on pdfTeX as the
  documents list imports a file, through the compile scheduler on a new worker, its report read, to
  its first drawn page; one import not counted, then five timed, medians; judged against under 8 s
  with the engine's start and without `load`.
- `?measure=import-xetex`: the same for Awesome-CV's upstream sample (`awesome-cv-0000`) on XeTeX,
  reported beside the bar and not judged, with 20 s as its aim.
- `?measure=import-pdf`: the editor's own PDF of each built-in template typesetting its own
  invented sample, three PDFs made on a worker as the editor exports one, each imported by rules as
  for a person who said no to sending: the reader's worker, which draws each page as a picture for
  the review, the layout, the labels with nothing sent, the filing and the review's draft; and,
  beside it and not in it, the draft set on its template on a new worker, to its first drawn page.
  One pass not counted, then five timed; judged against under 1 s at the slowest import. The PDFs
  other tools printed are the Node command's alone.

[[BROWSER NUMBERS: ?measure=1, ?measure=import (pdfTeX), ?measure=import-xetex, ?measure=import-pdf — filled by the orchestrator]]

### The corpus run on main

The corpus workflow, started by hand on main after the last import change of milestone 3's
follow-ups (`gh workflow run corpus.yml --ref main`, decision 0035), runs the survey and the import
run over the fetched corpus, held to `apps/editor/corpus/baseline.json`, decision 0060's: 50
successes of 220, 22.73%, and 73.91% of words editable in place.

[[CORPUS RUN: URL, conclusion, successes and editable rate against the baseline's 50 and 73.91% — filled by the orchestrator]]

## Consequences

- Milestone 3 is done with these five limits as they stand. Plan section 9 marks it done on
  5 October 2026, and section 10's risks say which limits are accepted.
- The records that call a limit open, or the slow laptop's run owed, keep their bodies, under a
  banner pointing here: 0051, 0052, 0053, 0054, 0060 and 0062 for the limits; 0003, 0011, 0016,
  0018 and 0045 for the slow laptop; 0064 for both.
- No machine slower than the M4 Pro is measured. A person on one waits longer than the tables say,
  by an amount nobody has measured, and XeTeX's 1.49 s margin is the first that wait would spend.
- Decision 0011's lazily mounted tree and decision 0018's dropping of IBM Plex, each left to what
  the slow laptop's start would show, wait on no run now: either takes a record of its own should
  the engine's start prove too slow.
- `measure` and the `?measure=1` page judge the keystroke, the typical edit and, in Node, the first
  load; the import's and the PDF import's targets are judged as before.
