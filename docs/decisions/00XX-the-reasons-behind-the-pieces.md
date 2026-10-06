# 00XX. The reasons behind the pieces

Date: 2026-10-07 · Status: accepted, lane D3 of the import's follow-ups; adds to the corpus run's
diagnostics of decision 0067

## Context

Each row of `corpus run` names the pieces that hold its words not in place, and why: `shape`, the
outline made no field of an editable candidate; `differs`, check 1 kept a field whose rewriting
moved the page; `moved`, the probe found a candidate's markers moved the page (decision 0067). On
main they are 3,250, 2,317 and 2,183 words. The fixes that would win them back depend on what
lies under each word, which the rows did not say: which of the outline's rules declined a
candidate, what kind of difference check 1 found, what the probe saw move. Two numbers of the
measurements were wrong besides: the typing timing found no field on `other-0028`, which has 282,
and `measure` judged the first load's bytes on disk against the plan's 30 MB, a compressed size.

## Decision

### Why each word is kept, further

Each piece kept for one of the three reasons breaks its words down, each word set down to the
candidate whose run sets most of its glyphs, as the piece is:

- **`shape`, by the outline's rule (`rules`).** The outline already declines a candidate at one of
  a few places; it now notes which (`Outline.declined`), and writes nothing differently. The
  rules: `marked-in-part`, a text of the tree crosses the candidate's edge, so a marker would hold
  part of it; `several-paragraphs`, its text's source ends a paragraph, with `\par` or a blank
  line; `line-break`, it breaks a line, with `\\`, `\newline` or `\linebreak`; `empty`; `no-text`
  and `blank`, it holds no text, or spaces alone; `overlaps`, its text overlaps a field placed
  before it; `cut-by-unit`, a group's unit begins or ends inside it; `after-escape`, the kept text
  before it ends in a backslash that would take its marker; `passed`, the outline had written past
  it; `outside-setter` and `no-preamble`, a preamble's candidate the outline has no call to write
  in. Two more come from the report's own count: `container`, a candidate the probe found holds
  structure, and `unknown candidate`.
- **`differs`, by check 1's kind of difference (`kinds`).** Check 1's bisection decides each field
  by a compile whose page it compares with the reference's; the kind of the first difference that
  compile showed (`pages`, `size`, `count`, `glyph`, `rule`, `special`, `kind` or `position`) is
  now heard as the field is kept (`CheckEvent`).
- **`moved`, by the probe's detail (`details`).** The probe kept the same kinds already, and
  `transform` for a field the page cannot place; the row now carries them.
- The tables of `corpus run` add one per family and in all: words and documents by reason and by
  rule, kind or detail, with the piece holding the most of them.
- Every name is one of a closed list, or `(other)`, set down where the row is made and again where
  the table is printed: nothing a document wrote, and no macro a document defines, can reach a
  row. The hooks only hear what the import computed already: the corpus run of eight documents on
  this change against main's (below) finds every old field the same.
- `corpus compare` sets aside `pieces.rules`, `pieces.kinds` and `pieces.details` where one run
  lacks them throughout, as it does the other diagnostics. It now reads a field inside an array
  under the array's own path (`pieces.rules` for every piece's), which only the pieces have.

### The typing timing's field

The timing typed in the longest field of the first page only. `other-0028`'s first page shows none
of its 282 fields, all on its 16 other pages. The timing now takes the longest field any page
shows, as the editor draws every page (decision 0046). On `other-0028` it now types in a rich field
of 337 characters: five edits at 466 to 476 ms by the page's own time, median 469 ms (418 ms
compiling 17 pages in one pass, 47 ms drawing), 572 ms with the scheduler's pause, at a load of
4 to 5. Of the three resumes that had no field to type in, it is the one that has fields: the
other two, `other-0006` and `other-0015`, have none in their outlines.

### The first load, compressed

`measure` judges the first load on what its files come to with gzip, each file of the tree once,
and prints the bytes on disk beside it. On this tree: Jake's Resume 20.11 MB (42.34 MB on disk),
AltaCV 21.48 MB (44.93), Awesome-CV 25.06 MB (53.79), each under 30 MB; the engine is 12.70 MB of
each. Gzip is the cautious measure: the spike's 14 MB was Brotli's, which compresses more.

### Measured

`corpus run --json` on this change and on main (`ad0a73e`), each over `other-0028`,
`moderncv-0007`, `altacv-0017`, `altacv-0003`, `jake-0004`, `awesome-cv-0033`, `europecv-0008`
and `other-0015`, four at a time: `corpus compare` finds them the same on all eight, times aside,
the breakdowns set aside. Over the five resumes with the most `shape` words on main
(`moderncv-0023`, `other-0059`, `other-0009`, `altacv-0005`, `jake-0031`), every one of their
1,350 `shape` words is `line-break`; over the eight, `differs` is `position` and `glyph`, and
`moved` is mostly `transform` (AltaCV's `cvtag` #1).

## Consequences

- The next lanes can choose their fixes by rule, kind and detail rather than by piece alone.
- A run made before this change lacks the breakdowns; `corpus compare` names them as set aside.
- The change touches `src/import/` (the outline, the checks, the import's observer) and the corpus
  scripts, so a corpus run is worth doing, by the owner's choice:
  `gh workflow run corpus.yml --ref waikin/perf2-diagnostics`. It should move no number but add
  the breakdowns.
