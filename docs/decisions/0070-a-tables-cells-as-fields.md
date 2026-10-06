# 0070. A table's cells as fields

Date: 2026-10-06 · Status: accepted, lane 3 of decision 0067, measured with lane 2 (decision 0069); amends 0020

## Context

The parser kept a `tabular` and its kin whole, as raw text the upload wrote, so no word in a
table's cells was ever tried as a field (decision 0020). Decision 0067 found that the largest single
piece of the import's loss: 6,539 words in the cells of `tabular`, `table`, `longtable`,
`tabularx` and `tabular*`, most of them in the others family, and 15 of Jake's forks with a small
`tabular*` in their heading. It chose to cut a table into its cells and let the probe and the checks
try each cell as they try any paragraph, with nothing else in the pipeline changed.

## Decision

- **A table is a block of cells.** The body of a `tabular`, `tabular*`, `tabularx`, `tabulary` or
  `longtable` is cut at its `&` and its rows' ends. Each cell's content is placed as any content is,
  in a state of its own, since TeX sets each cell in a group: a declaration in one cell marks
  nothing in the next. The table's arguments, its width and its column preamble, are kept as
  written.
- **What stands between cells is kept as written.** The `&` stays in the body's bytes between the
  cells. A row's end, `\\` and `\tabularnewline` with their star and space, LaTeX's, booktabs' and
  hhline's rules, colortbl's `\rowcolor` and longtable's heads and feet are raw, with their
  arguments; none of them sets a glyph, so none can claim one no field covers. `\multicolumn` and
  `\multirow` are raw, and the text they set is placed inside them, as a coloured word's is.
- **A cell is never part of a larger field.** A candidate that holds a table is not probed whole,
  even a table of one row with no mark to keep, so no field's markers ever span an `&`; its cells
  are candidates of their own.
- **A `table` float's body is placed**, as a `center`'s is, so that the table in it is cut too.
- **A table whose cells are unsafe stays raw, as before.** That is a table whose body uses TeX's own
  ways of changing an alignment (`\omit`, `\span`, `\cr`, `\noalign` and the like), longtable's
  `\kill`, whose row is measured and never set, or a conditional, whose skipped text could cross a
  cell's edge; or one with a mark whose arguments cannot be read, which would leave them to be read
  as a cell's text. `array`, whose cells are mathematics, and `tabbing` stay raw too.
- Nothing else changes: the probe, the outline and the checks take the new paragraphs as they take
  any, and a cell they do not prove stays kept text.

### Measured

`corpus run --json` over all 220 documents on a local merge of main (`e5b41cf`), #111, #112, lane
2 (the probe's words first) and this change, never pushed, four at a time at a load of 5.7 to 6.7,
against the before-run of decision 0066 (`fc62298`). `corpus compare` and a count over both runs
find no document with a worse outcome or fewer words in place.

| | Before | Lane 2 alone | With this change |
|---|--:|--:|--:|
| Words editable in place, of the 110 imported | 71.9% (59,240) | 75.6% (62,312) | 79.5% (65,581) |
| The others family | 51.9% | 58.8% | 67.6% |
| Jake's | 93.7% | 93.7% | 94.8% |
| moderncv | 54.1% | 64.6% | 64.9% |
| Imported resumes under 50% in place | 16 | 14 | 8 |
| Imported resumes at 90% or more | 53 | 54 | 59 |
| Successes | 50 | 51 | 54 |
| Words locked as raw | 877 | 873 | 688 |
| All compiles, all imports | 5,817 | 5,768 | 5,988 |

- Against lane 2 alone, 29 resumes gain 3,269 words in place: `other-0010` 1,765 to 4,613 of
  4,922, a success; `other-0052` 418 to 1,212; `other-0051` 263 to 660; `other-0032` 1,339 to
  1,662; `other-0034`, `other-0046` and `other-0065` from 10 to 61 words to 257 to 307, the last
  two successes; all 15 of Jake's forks with a `tabular*`, 8 to 26 words each, and six more. One
  loses, `other-0028`, below.
- `other-0028` keeps 106 words in place, more than the before-run's 38 but fewer than lane 2's
  2,315. Its probe runs out of budget either way: a set's output moves, names a candidate, that
  candidate passes alone, and the set is tried again without it, two compiles a candidate. With
  its 87 cells among the candidates, that goes on to the end of the budget, where lane 2's order
  alone reached a set of 174 that passed. Lane 2's record names the fix, halving the set once a
  named candidate passes alone, as a follow-up in the probe.
- The 31 resumes with a table take 1,449 compiles, 216 more than with lane 2 alone, and 369 s in
  all against 315 s at a higher load. `other-0010` takes 77 compiles, not 18, and 16.0 s, not
  4.4 s, for its 2,848 more words; `other-0009` 9.9 s, not 7.3 s, for 66 more.
- `other-0015` is a cost the owner's rule does not cover, since its extra seconds buy no word: 162
  compiles, not 30, and 25.6 s, not 5.0 s, still with no word in place. Its cells' checks stop on
  the special characters and spend their budget bisecting. Decision 0067's fix 6, check 3 stopping
  when its budget cannot cover the groups it has left, is the follow-up that would win those
  seconds back.

## Consequences

- With lane 2, decision 0067's word targets are met: at least 76% in place (79.5%), the others at
  least 58% (67.6%), moderncv at least 60% (64.9%), at most 12 resumes under 50% (8), at least 55 at
  90% (59). The time targets rest on lane 4, which opens the page before the checks end.
- The probe's and the checks' budgets now meet more candidates in a resume with a long table; the
  corpus run is the guard. `other-0028` shows what lane 2's halving rule in the probe would win
  back, and `other-0015` what fix 6 would: the halving rule is best landed with this lane or
  before it, so that no resume does worse than lane 2 alone.
- A cell takes what any field takes: Enter inserts nothing (decision 0004), so no edit ends a
  row, and the generator escapes an `&` a person types.
- The change is in `src/import/`, so a corpus run is worth doing, by the owner's choice:
  `gh workflow run corpus.yml --ref waikin/perf-tables`. It could move the raw words, the words in
  place of resumes with tables, and the probe's and the checks' budgets on them.
