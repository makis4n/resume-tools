# 0067. Where the import's words and seconds go

Date: 2026-10-06 · Status: accepted, under the owner's decisions of 6 October 2026, which let this
run choose its fixes and set its targets from what it finds

## Context

Milestone 3 left the `.tex` import with three numbers worth raising: the share of words editable in
place, 71.9% of the 110 imported resumes' 82,391 words; the time an import takes, 57 of 91 pdfTeX
imports under 8 s and 15 of 19 XeTeX imports under 20 s, the slowest 175.9 s and 41.8 s; and the
time an edit takes to reach the page on an imported resume, which nobody had measured (decision
0066). The owner asked for a run that finds out where the words and the seconds go, chooses the
fixes worth their cost, and sets a target for each number above today's. Two diagnostic changes
made the corpus run say more: each row now names the pieces that hold the words not in place and
why, and counts compiles and time by kind of trial (#112); and a command times typing on every
imported resume (#111). This record reads their output only, never a resume. It names resumes by
id, and pieces by the names their class or package defines.

## Decision

### How it was measured

- `corpus run --json` over all 220 fetched documents on a local merge of main (`e5b41cf`) with #111
  and #112, never pushed, four at a time, at a one-minute load of 2.5 to 3.7; it took 6.6 minutes.
  `corpus compare` against the before-run (`fc62298`, decision 0066) finds the old fields the same
  on all 220 documents: 50 successes, 60 partial, 7 refused, 103 with no reference.
- The typing timing on the 110 imported resumes, one at a time: each imported, then five edits of
  its longest editable field, each timed from its command to its drawn page; 107 typed, 3 have no
  editable field. Load 1.4 to 3.9.
- `measure` and `measure --import` at a load of 1.4 to 2.0: an edit on the built-in templates
  78 ms (Jake), 106 ms (AltaCV) and 119 ms (Awesome-CV); Jake's upstream sample imported in
  2.55 s with 17 compiles; Awesome-CV's on XeTeX in 18.09 s with 81 compiles.
- A browser check with the pane hidden, so not a timing, only a hint: an edit on AltaCV's upstream
  sample after its import took about 860 ms, 857 ms of it the compile, on 2 pages; Jake's 84 ms;
  Awesome-CV's 178 ms.

### Where the words go

23,151 of the 82,391 words are not in place: 21,310 through the retype and 1,841 locked. By why,
with the step that decided it:

| Why | Decided by | Words | Resumes |
|---|---|--:|--:|
| `raw`: kept as the upload wrote it, mostly tables' cells | the parser | 8,275 | 50 |
| `untested`: a budget ran out before a compile tried it | the probe 4,994, the checks 1,188 | 6,182 | 9 |
| `shape`: editable, but the outline could not make it a field | the outline | 3,162 | 36 |
| `moved`: the page moved with it | the probe | 2,107 | 44 |
| `differs`: the outline's page differs with it | the checks | 1,908 | 29 |
| `twice`, `misaligned`, `breaks`, `split`, `compile`, `text` | the probe and the checks | 1,517 | 60 |

- **Tables.** The cells of `tabular` (3,507 words in 12 resumes), `table` (1,502 in 2),
  `longtable` (782 in 1), `tabularx` (512 in 3) and `tabular*` (236 in 15) are kept as the upload
  wrote them: the parser keeps a paragraph that holds an alignment's `&` whole. That is 6,539
  words, the largest single piece of the loss; the first four alone are 5,037 words in 30 resumes.
- **Budgets.** The probe's budget, 64 compiles, ran out in 6 resumes and left 809 candidates
  untested, 4,994 words: `other-0028` 3,038, `moderncv-0007` 848, `moderncv-0013` 550,
  `moderncv-0002` 442, `altacv-0005` 115, `other-0020` 1. The checks' budget, 48 compiles a
  bisection, ran out 4 times, 1,188 words: `altacv-0017` 344, `other-0006` 323, `moderncv-0013`
  311, `europecv-0008` 210. Check 3's budget, 64, left 143 groups untried in 2 resumes, which costs
  no words, only the units' copy and removal. The probe spends its budget in the source's order,
  kind by kind, and bisects the first failing half before the second, so what the budget leaves is
  the last kinds, whatever their size: moderncv's descriptions (`cventry` #7, 874 words in 3
  resumes) come after the entry's six other arguments.
- **The others family**, 33,339 words in 31 resumes, 51.9% in place, holds 16,027 of the words not
  in place. Tables are 6,271 of them; `other-0028`'s untested paragraphs 2,636; paragraphs the
  outline could not make fields (`shape`) 1,290 in 15 resumes; paragraphs whose field changed the
  outline's page (`differs`) 580 in 8; `itemize` and paragraphs that moved the page 916, in 4 and
  5 resumes.
- **moderncv**, 6,887 words in 14 resumes, 54.1% in place, holds 3,161. The probe's budget is
  1,840 of them, in three resumes: `cventry` #7 874, `cvitem` #3 303, `cvlistitem` #2 105, `cventry`
  #3 and #4 183. Then `itemize` that moved the page, 264 in 6; one resume's `cventry` #7 the outline
  could not make a field, 254; `cvitem` #3 kept raw, 123 in 2.
- Half the words not in place are in 7 resumes, as decision 0066 found: `other-0028`, `other-0010`,
  `other-0006`, `moderncv-0013`, `other-0052`, `moderncv-0007`, `other-0032`.

### Where the seconds go

An import's time is its compiles: compile count and time agree (r = 0.76), and the time outside
the trials' compiles is 2.5% of it on pdfTeX and 4.6% on XeTeX. By kind of trial, over the whole
run:

| Trial | pdfTeX, 91 imports, 1,099 s | XeTeX, 19 imports, 366 s |
|---|--:|--:|
| The probe's bisection | 34.5%, 1,718 compiles, 221 ms each | 28.6%, 623 compiles, 168 ms each |
| The checks' bisections, 1 to 3 | 30.3%, 1,227 compiles; check 3's 439 ms each | 25.9%, 508 compiles |
| The checks' first compiles, 1 to 3 | 15.0%, 988 compiles | 10.6%, 213 compiles |
| Formats dumped | 5.5%, 182 dumps, 330 ms each | 8.5%, 57 dumps, 547 ms each |
| The reference | 4.7%, 102 compiles | 12.1%, 21 compiles, 2.1 s each |
| Signatures, the probe's first compile, the fonts' matching or rewrite, checks again | 7.5% | 9.7% |

- Bisections are two thirds of pdfTeX's time and half of XeTeX's. An import's compiles run one at
  a time on the one compile worker, so a bisection is a chain: each split waits for the last.
- A compile of an import costs 1.21 times one pass of the same resume's edit at the median, the
  rest being the trial's body made, its files written and its output read. Two resumes stand out at
  twice: `altacv-0017` (1,007 ms a compile against a 499 ms pass) and `awesome-cv-0033` (405 ms
  against 179 ms). Their edits show why: every edit of either ran three passes, the most allowed,
  where every edit of the other 105 typed resumes ran one. A pass asks for another when its log
  says rerun, and theirs say it on every pass. The counts cannot say what asks; AltaCV's upstream
  sample loads biblatex, whose log asks for Biber and a rerun on every pass, a request no further
  pass can meet since the engine never runs Biber, and its browser edit's 857 ms over 2 pages is
  about three passes' worth.
- The slowest import, `altacv-0017`, 177 s: 171 compiles at about 1 s each, three passes where one
  would do; check 3's bisection spent 75 s of it to try 4 of its 118 groups, and check 2's 37 s to
  leave 43 fields untested. The next, `other-0028`, 82 s, spent 64 probe compiles at 486 ms each
  and kept 7 fields.

### Typing on imports

103 of the 107 typed resumes edit to the page within 300 ms by the page's own time, the median of
five edits: median 111 ms, p90 207 ms. By family: Jake's 35 all under 300 ms, at 92 ms; europecv's
6 and moderncv's 14 all under, at 106 and 190 ms; the others' 28 all under, at 105 ms; Awesome-CV's
13 of 14, at 153 ms; AltaCV's 7 of 10, at 241 ms. The four over: `altacv-0017` 1,537 ms (7 pages,
three passes an edit), `awesome-cv-0033` 558 ms (2 pages, three passes), `altacv-0014` 343 ms and
`altacv-0005` 302 ms (2 pages each, one pass). The compile is nearly all of it: 1,498 of
`altacv-0017`'s 1,537 ms, the draw 33 ms. At one pass an edit, `altacv-0017` would take about
540 ms and `awesome-cv-0033` about 200 ms.

### The fixes, ranked

Worth against cost. A word fix's worth is the words it reaches times a share it is expected to win
back, kept low on purpose: 40 to 60% for the probe's untested words, since the resumes the budget
stopped hold their tested words in place at 4% to 100%, and 77.7% over the corpus; 35 to 50% for
tables' cells, which no compile has tried yet. A count of resumes crossing 50% or 90% takes each
resume as won back whole or not at all, half of them won. A time fix's worth is the compiles or
passes it saves, at the run's own cost per compile.

| # | Fix | Worth | Resumes it touches | Cost | Risk | Files |
|--:|---|---|---|:-:|---|---|
| 1 | Pass again only when a pass changed a file the next pass reads, not whenever the log says rerun | typing: `altacv-0017` 1,537 to about 540 ms, `awesome-cv-0033` 558 to about 200 ms, 104 of 107 under 300 ms; import: `altacv-0017` 177 to 110-120 s, `awesome-cv-0033` 35 to 24-25 s | 2, and every compile of a resume like AltaCV's sample | S | low: a pass that reads the same files sets the same page | `src/engine/session.ts`, `src/engine/log.ts` |
| 2 | The probe's budget spent on the most words first: kinds ordered by their text, largest first | 2,000 to 3,000 words of 4,994, no compile more; 71.9% to 74.3-75.5% | 6 | M | medium: verdicts' order changes; the corpus compare guards | `src/import/probe.ts` |
| 3 | A table's cells as fields: the alignment's paragraph cut at `&` and row ends, which stay kept | 1,760 to 2,520 words of 5,037; up to 7 resumes past 50% and 6 past 90% | 30 (15 Jake forks with small `tabular*`) | M-L | medium: more candidates for the probe's budget; rows' marks (`\\[..]`, `\hline`, `\multicolumn`) | `src/import/parse.ts` |
| 4 | Open the document when the outline is made, on the reference's page, fields locked; they unlock as checks 1 and 2 pass them, units after check 3 | the wait to the page: pdfTeX under 8 s 57 to about 72 of 91, median 5.2 to 3.1 s, slowest 177 to about 30-39 s; XeTeX under 20 s 15 to 18 of 19 | 110 | L | high: when an import opens (decisions 0038, 0039); the report comes after the page; 9 resumes whose page differs redraw | `src/import/run.ts`, `src/import/checks.ts` (a hook only), `src/engine/protocol.ts`, `worker.ts`, `client.ts`, the import's screens |
| 5 | The checks' bisections spent on the most words first | 360 to 600 words of 1,188 | 4 | S-M | medium | `src/import/checks.ts` |
| 6 | Check 3 stops when its budget cannot cover the groups it has left | `altacv-0017` up to 70 s, `other-0028` up to 40 s; no words | 2 | S | low-medium: the few groups it would have tried stay fixed | `src/import/checks.ts` |
| 7 | A larger probe budget for a long resume | the rest of the 4,994 words; 30 to 100 s more on 6 resumes at about 1 compile a candidate | 6 | S | medium: time | `src/import/probe.ts` |
| 8 | Several compile workers at once, a bisection's halves in parallel | 15 to 25% off every import with a bisection | 110 | L | high: an engine's memory each in the browser; budgets counted alike in any order; cancel | `src/engine/*`, `probe.ts`, `checks.ts`, the corpus and measure children |
| 9 | `shape`: make fields of the editable pieces the outline gives up on | up to 3,162 words, 15 resumes past 90% if all; which shapes is not in the counts | 36 | L? | unknown until a diagnostic names them | `src/import/outline.ts` |
| 10 | `moved`: fields that move the page judged rather than kept | up to 2,107 words (`cvtag` #1 254 in 5 AltaCV forks, moderncv's `itemize` 264) | 44 | L | high: a moved page is what the probe guards | `probe.ts` |
| 11 | Check 2 in fewer compiles: the long and the special text in one | about 1 compile, 0.2 s, an import | 110 | S | low | `checks.ts` |
| 12 | Typing: draw the edited page before the pages after it | `altacv-0017` below 540 ms | a few long ones | L | high: the engine's output read page by page | `src/engine/*`, the page |

### The chosen fixes

Four lanes, the first four of the table. Together they win back an expected 3,760 to 5,520 words
(71.9% to 76.5-78.6% in place), take the slowest import from 177 s to about 110-120 s, bring the
typing ceiling to about 540 ms, and move the judged wait to the page, which opens when the outline
is made. More words win where they cost seconds, as the owner's rule says, so long as every target
below holds: lanes 2 and 3 add fields and candidates, and lane 4 is what keeps the wait within its
targets as they do. Each product change gets its own decision record.

| Lane | What | Files, its own | Starts | Merges |
|---|---|---|---|---|
| 1, passes | A pass is repeated only when it changed a file of the job's folder that the next pass reads; a rerun that the log asks for with nothing changed gives the same page and is skipped. First, confirm on AltaCV's upstream sample that its passes drop from three to one. | `src/engine/session.ts`, `src/engine/log.ts`, their tests | first | 1st |
| 2, the probe's words first | The probe orders its kinds by the length of their candidates' text, largest first, so that what its budget leaves is small; the budget stays 64 | `src/import/probe.ts`, `probe.test.ts` | first | 2nd |
| 3, tables' cells | A paragraph with an alignment's `&` becomes its cells as text, with the `&`, the row ends and their marks kept; the probe and the checks then try each cell as any paragraph | `src/import/parse.ts`, `parse.test.ts` (and `candidates.ts` if a cell needs it) | when lane 1's PR is open | 3rd |
| 4, the page opens early | The document opens after the outline on the reference's page, its fields shown and locked; they unlock as checks 1 and 2 settle them, units' copy and removal after check 3; the report follows the page, with its Continue and move offers; a page that differs is drawn again when the checks end. Browser check on the 3 upstream samples. | `src/import/run.ts`, `src/import/checks.ts` (a callback as each check ends, nothing else), `src/engine/protocol.ts`, `src/engine/worker.ts`, `src/engine/client.ts`, the import's screens and the editor's locked fields | first | 4th |

- Lanes share no file. Fix 5 and fix 6, both in `checks.ts`, wait for lane 4's hook to merge, and
  fix 7 waits for lane 2's order to show what is left: they are follow-ups, not this run's.
- Lanes 2, 3 and 4 change `src/import/`, so a corpus run is worth doing on each, by the owner's
  choice: `gh workflow run corpus.yml --ref <branch>`. Lane 2 could move the probe's untested words
  and every resume's compile count; lane 3 the raw words and the probe's budget on resumes with
  tables; lane 4 no word, only when the page opens.
- Lane 3 adds candidates that lane 2's order puts last, so lane 3's whole-corpus run is taken on a
  local merge with lane 2.
- Time to the page needs no new column: it is the steps through the outline, from `times.steps`,
  plus the page's draw, about 0.3 s. Time until every field unlocks is the import less check 3's
  trials, plus the same draw.

### The targets

Each beats today's number, and sits where the chosen fixes are expected to land, with a margin.
The wait is judged on the time to the page, as the owner's rubric says once the page opens early.

| Target | Today | Expected | Target |
|---|---|---|---|
| Words editable in place, of the imported | 71.9% | 76.5 to 78.6% | at least 76% |
| The others family's share in place | 51.9% | 60.6 to 64.6% | at least 58% |
| moderncv's share in place | 54.1% | 60.5% if one of its three budget-stopped resumes is won back, 64.9 to 70.3% | at least 60% |
| Imported resumes under 50% in place | 16 | 8 to 12 | at most 12 |
| Imported resumes at 90% or more in place | 53 | 55 to 57 | at least 55 |
| pdfTeX: time to the page under 8 s | 57 of 91 (the whole import) | about 70 of 91 | at least 66 of 91 |
| pdfTeX: slowest time to the page | 175.9 s | 30 to 40 s | under 60 s |
| pdfTeX: slowest time until every field unlocks | 175.9 s | 60 to 100 s | under 120 s |
| XeTeX: time to the page under 20 s | 15 of 19 | 17 to 18 of 19 | at least 17 of 19 |
| XeTeX: slowest time to the page | 41.8 s | 21 to 30 s | under 36 s |
| XeTeX: slowest time until every field unlocks | 41.8 s | 26 to 33 s | under 40 s |
| Typing on imports: edits under 300 ms, of the 107 typed today | 103 (96.3%) | 104 | at least 104 (97.2%) |
| Typing on imports: the slowest resume's median edit | 1,537 ms | about 540 ms | under 700 ms |

- The typing share has no margin to give: one resume, `awesome-cv-0033`, is expected to cross, and
  `altacv-0005` (302 ms) and `altacv-0002` (295 ms) sit on the line either way. Resumes that become
  typable through lanes 2 and 3 are reported beside the 107, not in them.
- Guard rails, not targets: an edit on the built-in templates under 300 ms (78, 106 and 119 ms);
  Jake's upstream sample imported under 8 s (2.55 s); Awesome-CV's on XeTeX under 20 s (18.09 s);
  and no resume with a worse outcome, or fewer words in place, than the before-run.
- The whole import is reported beside the targets, not judged: about 110 to 120 s at the slowest
  on pdfTeX after lane 1.

## Consequences

- The run's fix lanes are the four above, in that order, each with its own record; they start
  only after these targets are printed.
- The targets rest on lane 4 for the wait. Should it not land, the import's time would be judged
  whole again, and lanes 2 and 3, which add compiles, would have no time target they could promise
  to beat on pdfTeX's share under 8 s.
- What this run leaves, for a later one: the checks' bisections and check 3's budget (fixes 5 and
  6, in `checks.ts`), a larger probe budget (7), several compile workers (8), the outline's `shape`
  and the probe's `moved` (9 and 10), and the edited page drawn first (12). `shape` needs a
  diagnostic that names the shapes first: its 3,162 words would lift 15 resumes past 90% if all
  came back, the most of any fix.
- AltaCV stays the slowest family to type in: after lane 1, `altacv-0017`'s seven pages at about
  70 ms each are still about 540 ms an edit.
