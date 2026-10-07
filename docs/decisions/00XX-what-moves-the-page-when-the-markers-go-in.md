# 00XX. What moves the page when the markers go in

Date: 2026-10-07 · Status: accepted, lane F3 of decision 0074 (its fix 3, and fix 8 tried); under
the owner's decision of 6 October 2026 that markers go only where they cannot move the layout

## Context

The probe keeps a candidate as `moved` when its marked compile's page is not the reference's.
Decision 0074 found 1,790 words in 39 resumes kept so for a glyph's `position`, and 383 in 9 for
`transform`, a field set inside a transformation the PDF alone applies, 254 of them AltaCV's
`cvtag`. It supposed the markers sat where a line break or the spaces around a field change the
layout, and chose to move them where a `\special` cannot. The owner allows no other fix: an
import never changes the page, and no difference is tolerated.

## Decision

### What moves the page

Each candidate kept as `moved` in the 48 resumes of `moved-top.txt` was compiled alone again on
its own document, with the markers changed one part at a time, and the page compared with the
unmarked one: the begin marker left out, the end marker left out, the prelude's italic correction
left out, protrusion turned off on both sides, and the end marker before a trailing break. The run
printed ids, verdicts and counts only. Of the 1,789 `position` words it reached, in 42 resumes:

| What moves the page | Words | Resumes |
|---|--:|--:|
| The end marker stands between a field's last glyph and the italic correction LaTeX adds after it: after a text command that holds the field (`\textbf{#1}` followed by `:` in Jake's forks), or before the next text command after a space | 559 | 27 |
| microtype's protrusion of an item's first glyph: its `\leftprotrusion`, which `\@item` ends with, looks at the next token, and `\rtfield` is none it knows, so the glyph is not protruded (moderncv loads microtype) | 548 | 11 |
| The begin marker: XeTeX's margin protrusion stops at a `\special` at a line's start (`other-0032`, with microtype), and `\leavevmode` in an empty argument starts a paragraph the argument never started (no words) | 302 | 6 |
| No one part alone: the field's ends together, or a macro that reads its argument twice | 301 | 11 |
| The prelude's own italic correction, added at a field's end inside a slanted text command's argument though the field does not end the argument | 49 | 7 |
| The end marker after a `\\` that ends the paragraph, as `\raggedright` and `\centering` have it, where it is set on the vertical list | 30 | 1 |

- **Only the last is a marker's place.** The other five are what the marker macro does where it
  stands, not where it stands: a `\special` is a node, and TeX's `\/` corrects only a glyph that
  ends the list; a token LaTeX or microtype looks ahead at is a token wherever it goes. No place
  in a field's span puts the begin marker after the item's first glyph's protrusion, or the end
  marker after an italic correction LaTeX adds once the field's group has ended.
- **The end marker now goes before a trailing break.** Where a span ends in `\\`, with no star or
  length, the end marker goes before the breaks and the spaces before them (`markerEnd`), which
  set no glyph; a control space or an escaped line's end before a break sets glue, and stays in
  the field. `\\` then takes off the space before it, as it does with no marker, and ends the
  paragraph with the marker inside it. The candidates' spans stay as they are, so the outline,
  which places its own fields, and the source's attribution of glyphs read them as before; only
  where the probe writes its end marker changes.
- **`transform` stays as it is, the owner's.** On a look-alike of AltaCV's upstream sample, with
  the markers outside `\cvtag{...}` rather than inside it, the page is the same, but the field's
  glyphs are still inside the TikZ node's transformation, which the page, drawn from the DVI,
  cannot place: the harness's special check still names it. No marker's place changes that.

### What would move nothing: the marker macro

The prelude's `\rtfield` is outside this lane's files and every template's compile uses it, so it
is not changed here. A prototype of it, measured on a scratch tree only, changed two things:

- At a field's end it takes the italic correction of the last glyph, keeps it, and takes it off
  the list before the end marker; LaTeX's own `\@@italiccorr`, which `\maybe@ic` calls when it
  corrects, adds it back after the marker when the list ends in a whatsit, and does nothing new
  otherwise. LaTeX alone then decides whether to correct, from the font after the group and the
  next token, so the prelude's own correction inside a slanted text command goes.
- microtype's `\leftprotrusion` learns `\rtfield`: it passes the call on with `\leftprotrusion` at
  the start of its text, so the item's first glyph is protruded inside the field, by the same kern.

Over the 49 resumes of the lane's list (`moved-top.txt` and five more), against main's run, the
prototype took words in place from 35,864 to 37,050 (+1,186); 33 resumes gain, 3 lose
(`other-0004` 18 words, `other-0020` 7, `altacv-0008` 2); words kept as `moved` 2,183 to 982;
successes 21 to 26, resumes at 90% 23 to 28; all compiles 2,993 to 2,693. Its first version lost
the two XeTeX resumes whole: XeTeX's text is set in whatsits, so the correction must be taken only
when one was kept. Its three losses are not understood yet.

### Measured

`corpus run --json` over the lane's 49 resumes on a scratch merge of main (`ad0a73e`), decision
0073's diagnostics and this change, never pushed, against main's run: words in place the same,
35,864; no resume worse in outcome or words; all compiles 2,993 to 2,978. `jake-0043`'s item of
30 words that ended in `\\` now passes the probe and is kept by the outline's `line-break` rule
(`shape`), which lane F2 splits at its breaks; with F2 it can be placed.

Then over all 220 documents on the same merge, alone in its slot but beside the other lanes'
work, against main's run: `corpus compare` finds them the same but in `jake-0043`, whose piece is
now `shape` by the outline where it was `moved` by the probe, and whose compiles go from 59 to 44,
15 fewer in the probe's bisection (its import 7.7 s to 6.2 s). Words in place stay 69,803 of
82,497, 84.6%; 61 resumes at 90%, 5 under 50%; every family's share the same; no resume worse
in outcome or words. All compiles 5,845 to 5,830. The times are no measure here: the run shared
the machine with the other lanes, and its slowest pdfTeX import, `altacv-0017`, which this change
does not reach, took 146.4 s against main's 142.2 s with the same compiles.

## Consequences

- The probe no longer keeps a field for a break its end marker followed; the outline must not
  place a field's end after a `\\` either, or check 1 keeps it as `differs`.
- What decision 0074 counted on from this fix, 450 to 900 words, is not won by markers' places:
  of the 1,789 words, 1,458 move for one part of the marker macro alone (559 + 548 + 302 + 49 in
  the table), 301 for no one part alone (both its ends together, or a macro that reads its
  argument twice), and only 30 for a marker's place. A change to the prelude, which every
  template and the editor compile with, is the owner's to choose. The prototype above is the
  measure of it.
- `transform`, 383 words, stays the owner's: placing a field inside a transformation is the
  page's overlay to change, not a marker.
- The change is in `src/import/`, so a corpus run is worth doing, by the owner's choice:
  `gh workflow run corpus.yml --ref waikin/perf2-moved`. It could move the probe's verdicts on
  fields that end in a line break, and its compiles.
