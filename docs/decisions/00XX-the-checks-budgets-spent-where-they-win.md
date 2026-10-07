# 00XX. The checks' budgets spent where they win words or time

Date: 2026-10-07 · Status: accepted, lane F1 of decision 0074; amends 0049, 0050 and 0069

## Context

Decision 0074 found the checks spending their budgets where they win nothing. Check 3 ran its 64
compiles out on `altacv-0017` and `other-0028`, 62.5 s and 43.5 s, for 4 and 39 groups. Checks 1
and 2 bisected in the source's order, so the budget left `altacv-0017`'s paragraphs untested, 344
words. Check 2 bisected `other-0006` and `other-0015` a field at a time, two compiles a field,
though its special text stopped the compile in every field it tried. And check 2 compiled its long
and special texts apart where both go through. It chose its fixes 2, 4, 5 and 7 for this lane; this
record takes 2, 4 and 5, and leaves 7, for the reason below.

## Decision

- **Check 3 stops when its budget cannot cover the trials it has left** (`coversLeft`). Once it has
  decided 4 trials, it expects the trials left to fail at the rate the decided ones did, one more
  failure and one more pass counted in, and each failure to cost its bisection about two compiles
  for each halving down to it, at least two. It stops when that passes three times the compiles its
  budget has left. What it settled stays settled; the groups left are fixed as untried, as when the
  budget runs out, and the note says it stopped. Tried on traces of check 3 on the 83 imports that
  bisect (counts only), the rule stops `altacv-0017` after 10 compiles and `other-0028` after 12,
  and no other: the largest the estimate came to on an import that finished was 1.1 times the
  compiles left, against the margin of 3. `other-0032` finishes at 61 of its 64 compiles, which a
  rule on the rate alone, without the margin, would have stopped.
- **Checks 1 and 2 bisect the most words first**, with decision 0069's rules as the probe applies
  them: `probeOrder` and `settle` with their words-first option, so a kind held apart waits for a
  rest with more words, and a set the compile names wrongly is halved. Tried on its own, the order
  took `europecv-0008` from 1,066 words in place to 1,045 (0069 had lost 205 without the rules);
  with the compile below given back, it keeps 1,068.
- **A bisection does not make its first compile again.** Check 1's bisection starts from the outline
  with nothing kept, and check 2's from the text in every field it tries: both compiles the check
  made already. The bisection takes them as made and still makes 48 compiles of its own.
- **A text that stops the compile on its own is kept for every field it is tried in** (`ownStop`).
  Once three fields of three kinds have each stopped it alone, what is left without them stops it
  still and no set has gone through, check 2 tries two fields no compile named, each alone, of kinds
  none of those was of: the first and the last such field. Where both stop it too, the stop is the
  text's, as a letter the document's fonts lack would be, and every field the text is tried in is
  kept for it (for the empty text, required) without a compile a field. Where one field is the
  cause, a set without it goes through first; where several are, each named rightly, a field no
  compile named goes through alone, and the bisection goes on as before. On the traces, the named
  fields' condition held in `other-0006` and `other-0015` on the special text and in `jake-0005` on
  the empty one, where 5 of the bisection's sets went through afterwards: there the two unnamed
  fields cost two compiles and the bisection goes on.
- **A field the empty text's bisection does not reach is required, not kept.** It is tried only
  after the long and special texts went through in it, which proved it takes text; required, it is
  never left empty, as a field that stops when empty is not. Kept as text, its words were lost for
  the one text the editor can refuse. The rule "nothing proved it takes any text" still keeps a
  field the long or special text's bisection leaves.
- **The long and special texts stay apart** (decision 0074's fix 7, not taken). One compile of the
  special text, the long one and the special text again saves about one compile an import, but it
  does not prove what each proves alone: together they are wider than a line, so a field whose
  macro sets a short text another way, as one that sets it in math does, never meets the special
  characters that way. The review found it on an invented look-alike: the special text alone stops
  three such fields, which main keeps as text; the text together made them editable, and typing an
  accented letter into one then stops the compile. Each text keeps its own compile.
- **What else changes, and what does not.** The budgets, check 3's trials and their judging do not.
  The checks' verdicts can change where no budget runs out: the words-first order can lock the other
  of two fields that stop the compile only together, as `probeOrder` says of the probe, and
  `ownStop` keeps every field the text is tried in once its stop shows itself the text's own,
  where the bisection would have tried each alone.

### Measured

`corpus run --json` over all 220 documents on a local merge of main (`ad0a73e`), the corpus run's
diagnostics (decision 0073's lane, `4f521c3`) and this change, never pushed, four at a time, while
other lanes ran beside it, against main's own run. `corpus compare` and a count over both runs find
no document with a worse outcome or fewer words in place.

| | Main | This change |
|---|--:|--:|
| Words editable in place, of the 110 imported | 84.6% (69,803) | 85.0% (70,149) |
| AltaCV | 83.0% | 88.1% |
| Jake's, Awesome-CV, europecv, moderncv, the others | 94.8, 93.5, 78.1, 83.8, 76.2% | the same |
| Imported resumes at 90% or more, under 50% | 61, 5 | 62, 5 |
| Successes | 56 | 57 |
| Fields the checks' bisections left untested | 235 in 4 resumes | 80 in 1 |
| Check 3's bisection, all imports | 429 compiles | 324 |
| The checks' compiles, all imports | 3,147 | 2,974 |
| All compiles, all imports | 5,845 | 5,672 |
| `altacv-0017`'s whole import | 170 compiles, 142.2 s | 114 compiles, 83 to 135 s |

- `altacv-0017` keeps 2,560 words in place of 2,740, not 2,216, and becomes a success: the empty
  text's bisection reaches its paragraphs first, and the fields it does not reach are required. Its
  import takes 114 compiles, not 170; check 3 stops after 10 compiles, not 64.
- `other-0028` takes 114 compiles, not 166; check 3 stops after 12 compiles, not 64. Its words are
  the same.
- `other-0006` takes 93 compiles, not 140, and `other-0015` 124, not 163: check 2 keeps every field
  for the special text after 8 and 9 compiles of its bisection, not 48. Neither has a word in
  place, as before; `other-0015` still keeps 80 fields untested by check 1's bisection, which the
  special text does not reach.
- `europecv-0008` keeps 1,068 words in place, not 1,066, and leaves no field untested.
- 25 imports take 1 to 14 compiles more, most in the empty text's bisection, where the words-first
  order reaches every field either way and splits elsewhere (`other-0034` 14, `other-0043` 8); 45
  take fewer, 40 the same.
- Times are from a machine shared with the other lanes, and they moved with its load more than
  with this change: an earlier run of this lane, one compile fewer an import, took `altacv-0017` in
  83.1 s and check 3's bisection over all imports in 76.5 s (main 169.9 s); this one, under more
  load, 134.9 s and 105.7 s, its reference compile, which this change does not touch, half again
  as slow as main's. The compiles are what compare.

## Consequences

- `altacv-0017` and `other-0028` fix every group as untried: the 4 and 39 groups check 3 settled
  before running out are fixed too, so a person cannot add or remove an entry in them, as in the
  other 114 and 83 already.
- The margin and the evidence are a heuristic, set on this corpus's traces; a run over the corpus
  is their guard, as for decision 0069's order.
- More fields are required: a person cannot empty one the empty text did not reach.
- The change is in `src/import/`, so a corpus run is worth doing, by the owner's choice:
  `gh workflow run corpus.yml --ref waikin/perf2-checks`. It could move the fields the checks keep
  untested, the groups check 3 fixes, every import's compiles, and the words in place where a
  budget ran out.
