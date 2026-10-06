# 00XX. The probe's budget spent on the most words first

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
  of its kind are held apart and tried among themselves, and the probe tried them before the rest
  of the set. Now the rest's first compile comes before them when the rest holds more words than
  each kind held apart, and a kind held apart whose candidates hold no word waits for the rest
  altogether. For candidates in the same order these are the same compiles in another order: with
  the budget to finish, this rule changes no verdict, and decides only what the budget leaves. Ordering the kinds alone
  won 780 words on the 22 resumes of `top-loss.txt`; this rule took `other-0028` from 38 to 2,315
  words in place, where a rest of 174 candidates that passes in one compile had waited behind a kind
  held apart of 24, which took the last of the budget. Ordering the kinds held apart and the rest
  wholly by their words lost 6 words on `other-0020`, so the kinds held apart that hold words still
  go before the rest of its compiles.
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
- The probe takes 105 fewer compiles over the corpus; the checks take 56 more, for the fields
  they now check. A reordered bisection splits elsewhere, so single imports move either way:
  `altacv-0015` from 93 compiles to 50, `other-0052` from 93 to 103. The budget now runs out in 7 resumes,
  not 6: `altacv-0005` no longer reaches it, and `moderncv-0001` and `other-0004` do, losing no
  word. `other-0028`'s import takes 158 compiles, not 138, and `moderncv-0007`'s 118, not 94: the
  checks of their new fields.
- The run's load was higher than the before-run's, 4 to 6 against 2.5 to 3.7, so its times are
  not compared here; its compiles are.

## Consequences

- From decision 0067's targets, this lane alone meets moderncv's (at least 60%) and the others'
  (at least 58%). Words in place overall (at least 76%), resumes under 50% (at most 12) and at
  90% (at least 55) wait on lane 3, the tables' cells.
- The order cannot reach `moderncv-0002` (442 words untested) or `other-0020` (1 word). In
  `moderncv-0002` a set's output moves and names one candidate as the likely cause; tried alone,
  that candidate passes, and the set is tried again without it, two compiles a candidate, 62 of
  its 64. `other-0028` spends about 26 compiles the same way. Halving the set once a named
  candidate passes alone would stop that; it changes how a set is split, so it is a follow-up.
- Lanes 3 and 4 measure on a merge with this change, since lane 3's new candidates are ordered by
  their words too.
- The change is in `src/import/`, so a corpus run is worth doing, by the owner's choice:
  `gh workflow run corpus.yml --ref waikin/perf-probe-order`. It could move the probe's untested
  words, the words in place of the resumes the budget stops, and every resume's compile count.
