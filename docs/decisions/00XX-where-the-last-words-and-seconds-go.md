# 00XX. Where the last words and seconds go

Date: 2026-10-07 · Status: accepted, under the owner's decisions of 6 October 2026, which let this
run choose its fixes and set its targets from what it finds

## Context

The perf run (decisions 0067 to 0072) left the `.tex` import at 84.6% of the imported resumes'
words editable in place, 61 resumes at 90% or more and 5 under 50%, with its slowest pdfTeX import
at 136.3 s. Decision 0072 listed what it left: the outline's `shape`, check 1's `differs`, the
probe's `moved`, and the checks' budgets, which spend 163 compiles on `other-0015` for no word. The
owner asked for a run that finds where those words and seconds go, fixes what is worth it, and
sets a target for each number above today's. A diagnostic change (D3, record "the reasons behind
the pieces") made each corpus row say which of the outline's rules declined a candidate, what kind
of difference check 1 found and what the probe saw move. This record reads its output only, never
a resume. It names resumes by id, and pieces by the names their class or package defines.

## Decision

### How it was measured

- `corpus run --json` over all 220 fetched documents on D3's commit (`4f521c3`, main `ad0a73e` and
  D3), never pushed, four at a time, at a one-minute load of 1.5 to 4.1; it took 6.4 minutes.
  `corpus compare` against main's own run finds the old fields the same on all 220 documents,
  times aside: 56 successes, 54 partial, 7 refused, 103 with no reference; 84.6% of 82,497 words in
  place; 5,845 compiles.
- The typing timing on the 110 imported resumes, one at a time, at a load of 1.2 to 4.1: 108 typed,
  2 have no field. `other-0028` is typed now that D3 takes the longest field of any page.
- `measure` at a load of 1.4: an edit on the built-in templates 79, 107 and 118 ms; the first load
  20.11, 21.48 and 25.06 MB with gzip.
- The words are main's to the word. The times are this run's; main's own run, at a load of 4.4 to
  6.2, gives the same compiles and a slowest import of 142.2 s. Today's numbers below are the perf
  run's integration run (decision 0072), as the owner's rubric gives them, and the typing's are
  this run's, which types 108 resumes.

### Where the words go

12,694 of the 82,497 words are not in place. The three reasons this record is about hold 7,750 of
them; the rest are `raw` 1,585 in 27 resumes, the checks' `untested` 1,144 in 4, `twice` 664 in
42, `breaks` 402 in 6, and smaller ones.

| Kept | Rule, kind or detail | Words | Resumes | Largest piece |
|---|---|--:|--:|---|
| `shape` | `line-break` | 3,250 | 36 | paragraph, 1,632 in 21 |
| `differs` | `position` | 1,870 | 27 | paragraph, 744 in 10 |
| `differs` | `glyph` | 425 | 15 | paragraph, 136 in 7 |
| `differs` | `rule` | 22 | 1 | `itemize`, 22 |
| `moved` | `position` | 1,790 | 39 | `itemize`, 767 in 12 |
| `moved` | `transform` | 383 | 9 | AltaCV's `cvtag` #1, 254 in 5 |
| `moved` | `rule` | 10 | 2 | a class macro #3, 7 |

- **`shape` is one rule.** Every one of its 3,250 words is `line-break`: a text whose source breaks
  a line with `\\`, `\newline` or `\linebreak`, which a field, one paragraph, would set on one line
  (decision 0050 found it in the skills block of Jake's sample). No candidate is declined as marked
  in part, several paragraphs or any other rule. By family: the others 1,865 in 18 (paragraphs
  1,434), Jake's 688 in 12 (`itemize` 605 in 11), moderncv 330 in 1 (`cventry` #7 254), AltaCV 252
  in 2 (a user environment 172), Awesome-CV 111 in 2 (paragraphs), europecv 4 in 1. 3,079 of the
  words go through the retype, 171 are locked. Half of them are in 7 resumes: `moderncv-0023` 330,
  `other-0059` 320, `other-0009` 300, `altacv-0005` 237, `other-0043` 218, `other-0010` 175,
  `jake-0031` 163.
- **`differs` is mostly where glyphs stand.** `position`, 1,870 words: the others 1,110 in 12,
  europecv 266 in 3, Jake's 218 in 6, moderncv 126 in 2, Awesome-CV 83 in 3, AltaCV 67 in 1; its
  pieces paragraphs 744, `itemize` 365, `enumerate` 329 in 2, `ecvitem` #4 86, `cventry` #7 86,
  `cvitems` 73. `glyph`, 425 words, where check 1's page sets another glyph or font than the
  reference's: moderncv 172 in 3 (`cventry` #7 121), Awesome-CV 155 in 3 (`cvitems` 85), the others
  92 in 7, europecv 6. A field kept for `differs` passed the probe, so its markers moved nothing:
  what differs is the page the outline writes, its text written back from the model. The row
  cannot say what in the writing moves it; invented look-alikes have to. The most are in
  `other-0044` 382, `europecv-0008` 280, `other-0033` 236, `moderncv-0007` 198, `other-0052` 142.
- **`moved` is mostly markers that moved the page.** `position`, 1,790 words in 39: the others
  1,343 in 13, moderncv 287 in 8 (`itemize` 275 in 7), Jake's 154 in 16 (a user macro #1 101 in
  11), europecv 6; its pieces `itemize` 767 in 12, paragraphs 541 in 12, a user macro #1 233 in 12,
  a class macro #3 131 in 1. `transform`, 383 words in 9, is not a page that moved: the field is set
  inside a transformation the PDF alone applies, which the page cannot place; AltaCV's `cvtag` #1
  is 254 of it in 5 resumes, the rest user and class macros in AltaCV, europecv and one of the
  others. The most are in `other-0032` 491, `other-0044` 215, `other-0020` 147, `other-0023` 132,
  `other-0033` 97.

### Where the seconds go: the checks

An import's time is still its compiles. By kind of trial, over the whole run:

| Trial | pdfTeX, 91 imports, 1,064.5 s, 4,378 compiles | XeTeX, 19 imports, 357.7 s, 1,467 compiles |
|---|--:|--:|
| The probe's bisection | 1,539 compiles, 323.5 s, 30.4% | 626, 101.1 s, 28.3% |
| Check 1, its first compiles | 124, 27.1 s, 2.5% | 24, 5.6 s, 1.6% |
| Check 1's bisection | 396 in 29 imports, 51.7 s, 4.9% | 76 in 5, 11.0 s, 3.1% |
| Check 2, its texts' first compiles | 449, 75.7 s, 7.1% | 95, 16.0 s, 4.5% |
| Check 2's bisections | 694 in 38, 165.3 s, 15.5% | 346 in 16, 62.2 s, 17.4% |
| Check 3, its batches' first compiles | 415, 60.3 s, 5.7% | 94, 14.7 s, 4.1% |
| Check 3's bisection | 339 in 25, 140.6 s, 13.2%, 415 ms each | 90 in 3, 23.0 s, 6.4% |
| The checks in all | 2,422, 521.7 s, 49.0% | 725, 132.4 s, 37.0% |

- Bisections are 64.0% of pdfTeX's import time and 55.2% of XeTeX's, the probe's and the checks'
  together, as in decision 0072.
- **Check 3 in two resumes.** Its bisection on pdfTeX is 140.6 s, and 103.0 s of it is two
  resumes. `altacv-0017`: 64 compiles, 62.5 s, about 1 s each; 4 of its 118 groups settled and
  114 left untried, which costs no word, only the entries' copy and removal. Its fields are open at
  72.5 s and its import ends at 135.9 s: 62.5 s of the last 63.4 s are check 3. `other-0028`: 64
  compiles, 43.5 s; 39 of 122 groups settled, 83 untried; check 3 is 43.5 s of the 45.1 s after its
  fields open.
- **What the checks' budgets leave.** The bisections of checks 1 and 2, 48 compiles each, ran out
  in 4 resumes and left 235 fields, 1,144 words, kept as text untested. `altacv-0017`: check 2's
  bisection of the empty text found 43 fields required, at about a compile each, and left 43
  untried, 344 words; an empty text that stops the compile makes a field required, not kept, so
  every field it reaches stays editable, and the paragraphs, 273 of the words, come before the
  budget only if the bisection takes the most words first. `other-0006`: check 2's special text
  stopped the compile in every one of the 48 fields its bisection settled, and the budget left 62
  untried, 323 words. `other-0015`: the special text stopped it in every one of the 29 fields
  settled, and one of its two bisections, 48 compiles each, left 129 fields untried, 475 words;
  the row does not say which. `europecv-0008`: check 1's bisection left 1 field, 2 words. In
  `other-0006` and `other-0015` the fields left would most likely stop the compile too and be kept
  as text, so the budget costs them seconds, not words.
- **`other-0015`, 163 compiles for no word.** 56 of the probe's bisection, 48 of check 1's (4.9 s),
  48 of check 2's (7.7 s), 21.4 s in all. Every field that reaches check 2 is kept as text by the
  special text, so the bisection finds one by one what one compile already says. `other-0006` is
  the same case: 140 compiles, 21.8 s, 0 words in place, 48 compiles (7.5 s) of check 2's
  bisection.
- **Check 2's first compiles.** It compiles the long, the special and the empty text apart, then
  two scripts: 5 compiles an import at the median, about 170 ms each. The long and the special
  text in one compile would save one compile an import where both pass, about 110 compiles and
  19 s over the corpus.
- The probe's budget ran out in 4 resumes and left 200 words untested in 2 of them (`other-0028`,
  `other-0020` 1); it is not this run's.

### Typing on imports

104 of the 108 typed resumes edit to the page within 300 ms, the median of five edits: median
110 ms, p90 218 ms. The four over: `altacv-0017` 546 ms (7 pages), `other-0028` 451 ms (17 pages,
newly typed), `altacv-0014` 338 ms and `altacv-0005` 302 ms (2 pages each); `altacv-0002` at
295 ms sits on the line. No fix below touches an edit's compile; what still holds them is the
engine setting every page, which is the spike's question.

### The fixes, ranked

A word fix's worth is what the pieces it addresses hold, and the resumes those words would lift past
90% or 50% if all came back; the expected share is set lower, from what decision 0070 won of its
cells (65%) and what each rule's evidence says. A time fix's worth is the compiles it saves, at the
run's own cost per compile.

| # | Fix | Worth | Resumes | Cost | Risk | Files |
|--:|---|---|--:|:-:|---|---|
| 1 | A field split at its line breaks: each line's text its own field, the break (`\\`, `\newline`, `\linebreak`, with a star or a length) kept as kept text between them, as decision 0070 kept a table's `&` | up to 3,250 words, 88.6% if all; 14 resumes past 90%, 2 past 50% (`moderncv-0023`, `other-0043`); expected 1,300 to 2,200 | 36 | M | medium: the new parts' edges stand beside a break no marker was tried at, which check 1 guards; a rich run across a break; a field becomes several in the editor | `src/import/outline.ts` |
| 2 | Check 3 stops when its budget cannot cover the groups it has left, keeping what it settled | `altacv-0017` about 55 to 60 s (135.9 s to about 76 to 81 s), `other-0028` about 40 s (110.4 to about 70 s); the slowest pdfTeX import to about 80 s; no word | 2 | S | low to medium: a group it would have settled before running out is fixed instead (4 in `altacv-0017`, 39 in `other-0028`); the stop keeps every group settled | `src/import/checks.ts` |
| 3 | Markers where they cannot move the layout: no marker beside glue a line break can drop, the begin marker after the spaces before a field's first glyph and at a list item's text, the end marker before the spaces or the paragraph's end after its last | up to 1,790 words of `position`, 86.8% if all; 7 past 90%, 1 past 50% (`moderncv-0017`); expected a quarter to a half, 450 to 900 | 39 | M | medium to high: every verdict rests on the markers, and a marker placed elsewhere can move a page that passed; the outline shares `wrapEnd` | `src/import/candidates.ts`, `src/import/probe.ts` |
| 4 | The checks' bisections spent on the most words first, with decision 0069's held-apart and halving rules | `altacv-0017` 273 to 344 words, 80.9% to 90.8 to 93.5%, past 90%; `europecv-0008` 2; none in `other-0006` and `other-0015` | 2 | S | medium: tried with the order alone, `europecv-0008` lost 205 words (0069); the corpus run guards | `src/import/checks.ts` |
| 5 | A text that stops the compile in every field check 2 tries is kept for all of them, not bisected | `other-0015` and `other-0006`: about 46 compiles and 7.5 s each; no word (`untested` becomes `text`) | 2 | S | low to medium: it must hold only where the stop is the text's own, as the scripts' letters are, never where one field is the cause | `src/import/checks.ts` |
| 6 | `differs` the outline's writing causes: `glyph` 425 words, and the part of `position` a look-alike traces to the writing | up to 425 words, 3 past 90% (`awesome-cv-0003`, `awesome-cv-0025`, `moderncv-0007`); `position`'s share unknown until reproduced | 15, up to 33 | M | medium: a writer's change reaches every import; reproduction first | `src/import/outline.ts` |
| 7 | Check 2's long and special texts in one compile | about 1 compile an import, 110 compiles, 19 s over the corpus | 110 | S | low: a combined text that stops is split as now | `src/import/checks.ts` |
| 8 | A field set inside a PDF-only transformation placed on the page (`transform`) | 383 words, 3 past 90% (`altacv-0008`, `-0010`, `-0014`) | 9 | M to L | high: a field the page cannot place is what the probe guards; a marker outside the tag's box helps only if the field's glyphs then stand where the page places them | `src/import/probe.ts`, the page's overlay |
| 9 | A bisection's halves on two engines; the edited page read page by page | bisections 64% of pdfTeX's import time and 55% of XeTeX's; `altacv-0017` 546 ms and `other-0028` 451 ms an edit | 110 | S to measure, L to build | high to build | `src/engine/*` (the spike builds nothing) |
| 10 | `twice` 664 / 42, `raw` 1,585 / 27, `breaks` 402 / 6, the probe's untested 200 / 2, `misaligned` 232 / 25 | not costed here | | | | |

### The chosen fixes

Four lanes. Together they can reach 5,811 words (F1 346, F2 3,250 and 425, F3 1,790): 91.7% in
place, 25 resumes past 90% and 3 past 50%. Expected: 2,000 to 3,700 words, 87 to 89% in place,
71 to 76 at 90%, 2 to 4 under 50%; the slowest pdfTeX import about 76 to 86 s.

| Lane | What | Files, its own | Starts | Merges |
|---|---|---|---|---|
| F1, the checks' budgets | Fixes 2, 4, 5 and 7: check 3 stops when its budget cannot cover the groups left, keeping what it settled; the bisections of checks 1 and 2 take the most words first, with 0069's held-apart and halving rules; a text check 2 finds stopping every field it tries is kept for every field, not bisected; the long and special texts in one compile | `src/import/checks.ts`, `checks.test.ts` | first | 1st |
| F2, the outline's line breaks | Fix 1: a text that breaks its line becomes a field a line, the break kept as kept text, from Jake's skills block to moderncv's `cventry` #7; then fix 6, `differs` whose cause invented look-alikes trace to how the outline writes a field back, `glyph` first | `src/import/outline.ts`, `outline.test.ts` | first | 2nd |
| F3, moved, markers only | Fix 3: markers placed where they cannot move the layout; a verdict is still the page unchanged, and no difference is accepted (owner decision 3). It tries fix 8's tags with the markers outside the box on look-alikes of AltaCV's upstream sample, and keeps it only if the page and every field's place are unchanged; otherwise `transform` stays, for the owner | `src/import/candidates.ts`, `src/import/probe.ts`, their tests | first | 3rd |
| S1, the spike | Fix 9, measured, nothing built (owner decision 4): a second engine's memory in Node and the browser; the gain from a bisection's halves on two engines, simulated on `slow.txt`'s 13 resumes with verdicts applied in serial order; when `altacv-0017`'s and `other-0028`'s edited page would show if the output were read page by page | none in the product; its record | first | 4th |

- The lanes share no file. `wrapEnd` in `candidates.ts` places the outline's field ends too, so F3
  changes where the probe's markers go and leaves the outline's spans as they are, or says so and is
  measured with F2 on one merge.
- F2 and F3 add fields that F1's checks bisect, so their whole-corpus runs are taken on a merge with
  F1's branch, and the four together on one scratch merge before their pull requests.
- Each product change gets its own decision record. F1, F2 and F3 change `src/import/`, so a corpus
  run is worth doing on each, by the owner's choice: `gh workflow run corpus.yml --ref <branch>`.
- Id lists for the lanes, one id a line, in the run's folder: `shape-top.txt` (36, most
  `line-break` words first), `differs-top.txt` (33), `moved-top.txt` (48), `checks-budget.txt`
  (`altacv-0017`, `europecv-0008`, `other-0006`, `other-0015`, `other-0028`), `slow.txt` (13: a
  pdfTeX import over 20 s or a XeTeX one over 30 s), `under50.txt` (5) and `near90.txt` (23, from
  80% to 90%).

### The targets

Each beats today's number and sits at about a quarter to a half of what the chosen fixes can
reach, at the low end of what they are expected to reach, since each lane's gain is a guess until
its corpus run.

| Target | Today | The fixes can reach | Target |
|---|--:|--:|--:|
| Words editable in place, of the imported | 84.6% | 91.7% | at least 86.5% |
| Imported resumes at 90% or more in place | 61 | 86 | at least 68 |
| Imported resumes under 50% in place | 5 | 2 | at most 4 |
| Each family's share in place: jake, awesome-cv, altacv, europecv, moderncv, other | 94.8, 93.5, 83.0, 78.1, 83.8, 76.2% | 98.6, 96.1, 91.8, 78.7, 95.2, 86.1% | none lower than today |
| pdfTeX: the slowest whole import | 136.3 s | about 80 s | under 100 s |
| pdfTeX: the page within 8 s (0067) | 66 of 91 | | at least 66 |
| pdfTeX: the slowest page (0067) | 47.9 s | | under 60 s |
| pdfTeX: the slowest until every field is open (0067) | 72.7 s | | under 120 s |
| XeTeX: the page within 20 s (0067) | 17 of 19 | | at least 17 |
| XeTeX: the slowest page (0067) | 25.8 s | | under 36 s |
| XeTeX: the slowest until every field is open (0067) | 28.2 s | | under 40 s |
| Typing on imports within 300 ms (0067) | 104 of 108 | | at least 104 |
| Typing on imports, the slowest resume's median edit (0067) | 546 ms | | under 700 ms |

- **Under 50%.** Of the five, the fixes reach three: `other-0043` (45.4%, 19 words short) and
  `moderncv-0023` (33.4%, 105 short) through F2, since their `line-break` words are 218 and 330,
  `moderncv-0023`'s `cventry` #7 254 of them; `moderncv-0017` (12.5%, 12 short) through F3, whose
  15 `itemize` words moved the page. `other-0006` and `other-0015`, 0% each, are reached by none:
  their fields stop the compile on the special text, and their words are `raw`, `compile`, `text`
  and untried. The target counts on one of the three.
- **At 90%.** 25 resumes would cross if every word came back: 14 by F2's line breaks, 3 by its
  `glyph`, 7 by F3, 1 by F1 (`altacv-0017`, 250 words short of the bar, which the paragraphs' 273
  cover). The target counts on 7 of them, fewer than F2's 14 alone.
- **Words.** At least 71,360 of the 82,497 words, 1,557 more: about a quarter of what the fixes
  can reach, near the low end of what F2 alone is expected to win (1,300 to 2,200), with F1's and
  F3's expected words beside it.
- **The slowest import.** F1's check 3 takes `altacv-0017` and `other-0028` to about 76 and 70 s;
  the next is `altacv-0014`, 34.5 s. Under 100 s leaves room for the fields F2 and F3 add.
- 0067's targets are held, not raised. The pdfTeX page within 8 s has no margin: 66 of 91, with
  four pages at 7.2 to 7.7 s (`moderncv-0020`, `other-0023`, `other-0033`, `other-0067`) and two at
  8.0 to 8.1 s (`altacv-0019`, `moderncv-0026`). F1's words-first order changes check 1's compiles
  and F3's markers the probe's, both before the page opens, so each lane gives its count, and a
  run at a matched load settles it.
- The typing count is judged on whatever resumes are typed after the fixes; a field split by F2
  can change which field the timing types in.
- Guard rails, not targets: an edit on the built-in templates under 300 ms (79, 107, 118 ms);
  Jake's upstream sample imported under 8 s (2.55 s); Awesome-CV's on XeTeX under 20 s (17.43 s);
  no resume with a worse outcome or fewer words in place than main's run.
- `targets.json` and `targets.cjs` in the run's folder print each target, today's number and the
  measured one, met or missed, and the guards, from a before run, an after run and a typing run.

## Consequences

- The run's fix lanes are F1, F2 and F3, with the spike S1 beside them, merged in that order, each
  with its own record; they start only after these targets are printed.
- The word targets rest on F2: its line breaks are 3,250 of the 5,811 words the fixes can reach and
  14 of the 25 resumes past 90%. Should a split field differ where the whole one did not, its words
  move from `shape` to `differs`, and the targets would want F3 and fix 6 to make up the rest.
- Check 3 stopping early leaves the groups it cannot cover fixed, as they are today; a person
  still cannot add or remove an entry in them.
- `transform`, 383 words, is the owner's to decide if F3's markers cannot keep the page and the
  fields' places: placing a field inside a transformation is an overlay change, not a marker's.
- Left for a later run: `twice`, `raw`, `breaks`, the probe's budget on `other-0028`, the special
  text that keeps every field of `other-0006` and `other-0015`, and what the spike recommends.
