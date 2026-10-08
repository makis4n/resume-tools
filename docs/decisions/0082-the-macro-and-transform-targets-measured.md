# 0082. The marker macro's and the page transforms' targets measured

Date: 2026-10-07 · Status: accepted, the markers-and-transform run's closing record; measures
decisions 0080 and 0081 together against the run's targets; amends plan section 4.3

## Context

Decision 0079 measured the follow-ups run and left two causes of the words still kept as `moved`:
the marker macro, which moved the page where LaTeX's italic correction or microtype's protrusion
meets a marker (1,760 words kept for `position`), and the page's want of the PDF's translations,
which drew AltaCV's tags half their width off and kept their text (383 words for `transform`). The
owner settled on 7 October 2026 that the app has no users yet, so one macro serves everyone, the
built-ins included, and that the page applies the PDF's translations. Rotated and scaled text is
drawn where the PDF draws it and stays locked.

Two pull requests followed, each with its record: the field's end after the text's own corrections
(0080) and the page applying the PDF's translations (0081). Neither is merged yet, so this record
measures them together on a local merge that is never pushed, against the run's targets, and gives
plan section 4.3 the targets and what was measured.

The targets, set from main after the follow-ups run (`6167a5e`, the numbers of 0079):

- at least 88.8% of body words editable in place (87.7%);
- at most 1,000 words kept as `moved` (2,153);
- at least 78 resumes at the 90% bar (75);
- no family of forks lower than main's run, and no resume worse in outcome or in words in place;
- 0074's time and typing targets held: the slowest whole import on pdfTeX under 100 s; the page
  within 8 s for at least 66 of 91 on pdfTeX, the slowest under 60 s and every field open under
  120 s; within 20 s for at least 17 of 19 on XeTeX, the slowest under 36 s and every field under
  40 s; an edit of an imported resume within 300 ms for at least 104 of those typed, the slowest
  under 700 ms;
- the guard rails: an edit of a built-in under 300 ms, Jake's Resume's sample imported under 8 s,
  Awesome-CV's on XeTeX under 20 s, and every built-in sample's marked page setting every glyph
  where its unmarked compile does.

## Decision

### How it was measured

- The tree: main at `6167a5e` with the run's pull requests merged in their merge order: #127, the
  baseline (`039cd54`); #128, the marker macro (`9767e7d`); and #129, the page transforms
  (`5b66ec2`), giving `fa2b5fd`. The full suite passed on it: 2,406 editor tests, 2 skipped, and
  the ATS's 41. (#129's last commit only makes its PDF test print each offset it checks; a first
  measure, on `f971d88` with #129 at `f6ab170`, agrees with this one on all 220 documents.)
- Each step ran alone on the M4 Pro, nothing else of the run beside it: `corpus run --json` over
  all 220 documents, four at a time, at a one-minute load of 7.8 falling to 5.4, the suite before
  it most of that; the PDF check of every translated glyph after it; then, each once the load was
  under 3.5, `measure` at 2.0 to 2.4, `measure --import` at 1.5 to 2.0, and the typing timing over
  the 110 imported resumes at 1.5 to 1.7.
- The before run is main's own at `6167a5e` (6.6 minutes), which agrees with 0079's integration run
  on all 220 documents, times aside. Its times ran beside the lanes' work, so the times' "today"
  are 0079's.

### Against the targets

| Target | Today | Measured | |
|---|--:|--:|---|
| Words editable in place, of the imported | 87.7% | 89.7% | met, at least 88.8% |
| Words kept as `moved` | 2,153 | 657 | met, at most 1,000 |
| Imported resumes at 90% or more | 75 | 83 | met, at least 78 |
| Each family, none lower: jake | 97.3% | 97.9% | met |
| awesome-cv | 94.2% | 94.2% | met |
| altacv | 89.6% | 94.3% | met |
| europecv | 78.1% | 78.9% | met |
| moderncv | 87.0% | 91.0% | met |
| The others | 80.0% | 82.5% | met |
| pdfTeX: the slowest whole import (0074) | 88.6 s | 87.2 s | met, under 100 s |
| pdfTeX: the page within 8 s (0074) | 66 of 91 | 69 of 91 | met, at least 66 |
| pdfTeX: the slowest page (0074) | 49.7 s | 48.7 s | met, under 60 s |
| pdfTeX: the slowest until every field is open (0074) | 79.0 s | 77.8 s | met, under 120 s |
| XeTeX: the page within 20 s (0074) | 17 of 19 | 17 of 19 | met, at least 17 |
| XeTeX: the slowest page (0074) | 26.3 s | 25.8 s | met, under 36 s |
| XeTeX: the slowest until every field is open (0074) | 28.9 s | 28.3 s | met, under 40 s |
| Typing on an imported resume within 300 ms (0074) | 104 of 108 | 104 of 108 | met, at least 104 |
| Typing on an imported resume, the slowest (0074) | 572 ms | 552 ms | met, under 700 ms |

- No resume has a worse outcome or fewer words in place than main's run. 77 succeed (69 before)
  and 33 are partial (41); 7 are still refused by the XeTeX fonts' rewrite and 103 still have no
  reference, both outside this run. 2 are under 50% in place (3).
- The words: 73,986 of 82,519 in place, 8.5% to retype and 1.9% locked. The body grew by 22 words
  because AltaCV's tag words now stand where the PDF has them (0081). Of the 2,153 words kept as
  `moved`, 657 are left, all `position`: `transform` went from 383 to none and `rule` from 10 to
  none. Most of what is left is XeTeX's protrusion at a line's start, which stops at the begin
  marker and which no macro reaches (0080).
- Compiles over the 110 imports went from 5,849 to 5,517, almost all of it the marker macro's
  (0080 measured 5,849 to 5,501 on its own). The slowest whole import is `altacv-0017`, 87.2 s, then `other-0028`.
- The time to the page, medians: 3.1 s on pdfTeX and 11.1 s on XeTeX. The slowest pages are
  `other-0028` (48.7 s) and `altacv-0017` (36.5 s) on pdfTeX, and `other-0020` (25.8 s) on XeTeX.
- Typing: the median of each resume's median edit is 112 ms, p90 221 ms, by the page's own time.
  The four over 300 ms are `altacv-0017` (552 ms), `other-0028` (464 ms), `altacv-0014` (335 ms)
  and `altacv-0005` (308 ms), as in 0079.

### The guard rails

- An edit on the built-in templates: 81, 109 and 121 ms for Jake's Resume, AltaCV and Awesome-CV,
  under 300 ms; a keystroke in the overlay 0.09 to 0.12 ms; the first load 20.11, 21.48 and
  25.06 MB compressed, under 30 MB.
- Jake's Resume's own sample imported on pdfTeX in 4.01 s, under 8 s (4.23 s before): its page
  drawn at 1.85 s and every field open at 3.49 s, 28 compiles.
- Awesome-CV's sample imported on XeTeX in 16.98 s, under the 20 s aim (17.51 s before), its page
  at 11.45 s and every field open at 15.97 s.
- A PDF read by rules in 45 ms at the slowest, under 1 s.
- Every built-in sample's marked page sets every glyph where its unmarked compile does: Jake's
  Resume 950 glyphs, AltaCV 1,253 and Awesome-CV 1,693 (0080's test, in the suite above). Jake's
  bold fields before a colon moved toward the unmarked compile; nothing else of the built-ins did.
- Every glyph a translation moves, in AltaCV's upstream sample (172) and in the corpus's resumes
  (4,054 in 10), is within 0.5 pt of the PDF, the most off 0.012 pt (0081), checked again on this
  tree; and #129's own test prints each rotated and scaled look-alike's offset, the most off
  0.0142 pt.

### In the browser

Chrome in the app's browser pane, displayed (the page reported itself visible after each), the tab
in front throughout, on the dev server of the same tree, one page at a time with nothing else of the
run beside it, on 8 October, at a load of 3.0 to 6.2, most of it the app drawing the pane:

- `?measure=1`: an edit of Jake's Resume on the page in 85 ms by the page's own time, 187 ms from
  the command with the scheduler's pause; a keystroke's rows 0.10 ms.
- `?measure=import`: Jake's Resume's sample imported on pdfTeX in 4.06 s, 28 compiles, its page
  drawn at 1.85 s and every field open at 3.55 s; 4.37 s with the engine's start, under 8 s.
- `?measure=import-xetex`: Awesome-CV's on XeTeX in 17.55 s, 77 compiles, its page at 11.73 s and
  every field at 16.52 s; 17.88 s with the engine's start, under the 20 s aim.
- `?measure=import-typing`: an edit after importing each upstream sample, median of 5: Jake's
  88 ms and Awesome-CV's 187 ms; AltaCV's 319 ms at a load of 4.7 to 5.4, and 305 ms timed again at
  5.0 to 3.3, where the first tree (`f971d88`, the same engine code) gave 297 ms at 3.0: its edit is
  a 2-page compile, 298 to 312 ms of it, and moves with the load. AltaCV's sample is no resume of
  the corpus's, whose typing target holds above; its tags are now editable where the PDF draws
  them, and it imported in 36.92 to 37.44 s in 96 compiles.

## Consequences

- Plan section 4.3 takes this run's targets as its bars for what an imported `.tex` makes editable,
  and this record's numbers as its measured lines.
- The corpus baseline is #127's, main's after the follow-ups run. Once every pull request of the
  run is merged, in the order above and this record last, `corpus run --write-baseline` on main
  takes the new one.
- Left for a later run: the 657 words still kept as `moved` for `position`, most of them XeTeX's
  protrusion at a line's start (0080); making rotated or scaled text editable, which needs a
  rotated overlay and new hit-testing (0081); TikZ's frames, still off the page (0013); check 3's
  trials, which depend on each other's auxiliary files (0078); `differs`, `raw` and `twice`; and
  the special text that keeps every field of `other-0006` and `other-0015`.
