# 0069. The probe's budget spent on the most words first

Date: 2026-10-06 · Status: accepted, lane 2 of decision 0067; amends 0022

## Context

The probe tries every candidate of an imported resume within a budget of 64 compiles (decision
0022). Decision 0067 found that the budget ran out in 6 resumes and left 809 candidates untested,
4,994 words that reach the editor only through the retype. The probe spent its budget in the
source's order, kind by kind, and tried the first half of a failing set before the second, so what
the budget left was the last kinds, whatever their size: in three moderncv resumes, the entries'
descriptions, which come after the entry's six other arguments. Decision 0067 chose to order the
kinds by their words, largest first, with the budget as it is.

## Decision

- **The probe orders its kinds by their words.** The kinds whose candidates' text holds the most
  words come first; kinds of as many words keep the order each first came in the source; each
  kind's candidates keep the source's order. Words are counted as the report counts them, runs of
  letters and digits. The budget stays 64 compiles.
- **A kind held apart waits for a rest with more words.** Once a candidate fails alone, the others
  of its kind are held apart and tried among themselves, and the probe tried them before the rest of
  the set. Now the rest's first compile comes before them when the rest holds more words than each
  kind held apart, and a kind held apart whose candidates hold no word waits for the rest
  altogether. For candidates in the same order these are the same compiles in another order: with
  the budget to finish, this rule changes no verdict, and decides only what the budget leaves.
  Ordering the kinds alone won 780 words on the 22 resumes of `top-loss.txt`; this rule took
  `other-0028` from 38 to 2,315 words in place, where a rest of 174 candidates that passes in one
  compile had waited behind a kind held apart of 24, which took the last of the budget. Ordering the
  kinds held apart and the rest wholly by their words lost 6 words on `other-0020`, so the kinds
  held apart that hold words still go before the rest of its compiles.
- **The checks keep the source's order.** They bisect with the same functions, and the words-first
  order, tried on them too, took `europecv-0008` from 1,025 words in place to 820 while it gave
  `altacv-0017` 224 more. The order is an option the probe asks for; the checks' bisections are
  decision 0067's fix 5, for a later change.
- **The kinds' order can change a verdict the budget does not reach.** The union compiles the
  editable candidates in the order they settled, and of two that pass alone and fail together it
  locks the later one. With the words first, that tends to be the one with fewer words, which
  keeps the one with more words editable; in the source's order it was whichever came later.
- **The order is a heuristic, and the corpus run is its guard.** Under a tight budget a first
  half that fails, such as a rest whose candidates' markers tear or come twice, can take the
  compile a candidate held apart would have passed with alone, so a resume can lose words to it.
  On invented sets with budgets of 3 to 12 compiles the order left fewer words in place than the
  source's order in about one seed in eight, and more in about one in four. No resume of the
  corpus loses a word (below); a run over the corpus is what would show one that does.
- **A set the page names wrongly is halved.** When a set's compile moves the page or stops, the
  probe tries first the candidates the compile names (those whose markers TeX's error shows it
  reading, or the field whose markers come last before where the output parts from the
  reference's), each alone, and then the rest without them. When every named one passes alone,
  the names were a wrong guess; the rest, if it fails too, is now split in two, as a set the
  compile names nothing of, not tried again without its own names. When one of several names is
  borne out alone, the names keep their trust. Each half's compile is trusted again. Where each
  next name is wrong, trusting them took a compile a name and one for the rest at each step; a
  level of halving takes a compile a name, one for the rest and two for its halves, so four for
  one name. The halving is keyed on the rest as it was left: when the quarantine of a kind that
  failed alone trims the rest first, what is left is tried by its names again. Halving every part
  of such a set from then on, tried first, left `other-0028` at 175 words in place, where its
  names are right more often than not, and gave `other-0010` 24 more compiles for no word, so
  only the rest of the set named wrongly is halved. Halving when only some of several names were
  wrong did worse than trusting them on invented sets whose stopped compiles name several
  candidates, so it waits for every name to fail. Verdicts stay sound: a candidate is editable
  only when a compile passed it, alone or in a set, and the union compiles them all together as
  before.
- Nothing else changes: the budget, the union's rule, and the order is the same for the same
  document every time.

### Measured

`corpus run --json` over all 220 documents on a local merge of main (`e5b41cf`), #111, #112 and
this change, never pushed, four at a time at a load of 4 to 6, against the before-run of decision
0066 (`fc62298`). `corpus compare` and a count over both runs find no document with a worse
outcome or fewer words in place.

| | Before | After |
|---|--:|--:|
| Words editable in place, of the 110 imported | 71.9% (59,240) | 75.6% (62,312) |
| The others family | 51.9% | 58.8% |
| moderncv | 54.1% | 64.6% |
| AltaCV | 82.2% | 83.0% |
| Jake's, Awesome-CV, europecv | 93.7%, 93.5%, 76.7% | the same |
| Imported resumes under 50% in place | 16 | 14 |
| Imported resumes at 90% or more | 53 | 54 |
| Successes | 50 | 51 |
| Candidates the probe's budget left untested | 809 | 449 |
| The probe's compiles, all imports | 2,451 | 2,346 |
| The checks' compiles, all imports | 2,943 | 2,999 |
| All compiles, all imports | 5,817 | 5,768 |

- Five resumes gain: `other-0028` 38 to 2,315 words in place of 3,975; `moderncv-0007` 146 to
  747 of 994; `moderncv-0013` 106 to 231 of 1,139; `altacv-0005` 423 to 477 of 808; `other-0001`
  85 to 100 of 110, which becomes a success.
- The probe takes 105 fewer compiles over the corpus; the checks take 56 more, for the fields they
  now check. A reordered bisection splits elsewhere, so single imports move either way:
  `altacv-0015` from 93 compiles to 50, `other-0052` from 93 to 103. The budget now runs out in 7
  resumes, not 6: `altacv-0005` no longer reaches it, and `moderncv-0001` and `other-0004` do,
  losing no word. `other-0028`'s import takes 158 compiles, not 138, and `moderncv-0007`'s 118, not
  94: the checks of their new fields.
- The run's load was higher than the before-run's, 4 to 6 against 2.5 to 3.7, so its times are
  not compared here; its compiles are.

### Halving after a wrong name, measured

`corpus run --json` over all 220 documents on a local merge of main, #111, #112, lane 3's branch
(the tables' cells) and this change, never pushed, four at a time, at a load of 4 to 6.
Against the before-run (`fc62298`) and lane 3's own run on that merge without the halving, no
document has a worse outcome or fewer words in place.

| | Before-run | Lanes 2 and 3 | With the halving |
|---|--:|--:|--:|
| Words editable in place, of the 110 imported | 71.9% | 79.5% (65,581) | 84.6% (69,803) |
| The others family | 51.9% | 67.6% | 76.2% |
| moderncv | 54.1% | 64.9% | 83.8% |
| europecv | 76.7% | 76.7% | 78.1% |
| AltaCV, Jake's, Awesome-CV | 82.2%, 93.7%, 93.5% | 83.0%, 94.8%, 93.5% | the same |
| Imported resumes under 50% in place | 16 | 8 | 5 |
| Imported resumes at 90% or more | 53 | 59 | 61 |
| Successes | 50 | 54 | 56 |
| Words the probe's budget left untested | 204 | 146 | 1 |
| Resumes whose probe budget ran out | 6 | 8 | 4 |
| The probe's compiles, all imports | 2,451 | 2,421 | 2,275 |
| All compiles, all imports | 5,817 | 5,988 | 5,845 |

- Four resumes gain against lane 3's run: `other-0028` 106 to 2,974 words in place of 3,974;
  `moderncv-0013` 231 to 1,122 of 1,139 and `moderncv-0002` 82 to 504 of 553, both becoming
  successes; `europecv-0008` 1,025 to 1,066 of 1,414.
- On lane 2 alone, without the tables' cells, a run over all 220 on its own merge, against its
  run above: words in place 75.6% to 77.9% (64,211), the others 58.8% to 60.4%, moderncv 64.6% to
  83.5%, europecv 76.7% to 78.1%; resumes under 50% 14 to 12, at 90% 54 to 56; untested words 133
  to 1; all compiles 5,768 to 5,608. `moderncv-0002` 82 to 504 and `moderncv-0013` 231 to 1,122,
  both successes, `other-0028` 2,315 to 2,860, `europecv-0008` 1,025 to 1,066; none worse, against
  it or the before-run.
- `moderncv-0002` takes 86 compiles, not 112, and its probe 42 of its 64. `other-0028`'s import
  takes 166 compiles, not 146: the checks of its new fields.
- The runs' load differs from the earlier runs', so their times are not compared; their
  compiles are.

## Consequences

- From decision 0067's targets, this lane alone meets moderncv's (at least 60%) and the others'
  (at least 58%). With lane 3, the tables' cells, it meets words in place overall (at least 76%),
  resumes under 50% (at most 12) and at 90% (at least 55).
- The order alone could not reach `moderncv-0002` (442 words untested): a set's output moved and
  named a candidate that passed alone, and the set was tried again without it, two compiles a
  candidate, 62 of its 64. With lane 3's cells, `other-0028` fell from 2,315 words in place to
  106 the same way. The halving above ends both; `other-0020`'s 1 word is still untested.
- Halving changes which sets are compiled, so like the order it can change which of two that fail
  together the union locks; the corpus run is its guard too.
- Lanes 3 and 4 measure on a merge with this change, since lane 3's new candidates are ordered by
  their words too.
- The change is in `src/import/`, so a corpus run is worth doing, by the owner's choice:
  `gh workflow run corpus.yml --ref waikin/perf-probe-order`. It could move the probe's untested
  words, the words in place of the resumes the budget stops, and every resume's compile count.
  The halving touches the same file and could move the same numbers.
