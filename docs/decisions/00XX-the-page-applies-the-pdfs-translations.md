# 00XX. The page applies the PDF's translations

Date: 2026-10-07 · Status: accepted, lane T of the markers-and-transform run; amends decisions 0008
and 0013 (the rule against fields in a transform) and 0073 (the `transform` detail); under the owner's
decisions 4 and 5 of 7 October 2026

## Context

xdvipdfmx makes the PDF from the DVI the page is drawn from (decision 0003), and some specials
change where it sets what follows them. pgf's dvipdfmx driver sets a TikZ node's text inside
`pdf:btrans matrix 1 0 0 1 e f` and `pdf:etrans`, a translation; graphicx's driver sets a rotated
box inside `pdf:btrans rotate` and a scaled one after `x:scale`. The page applied none of them, so
it drew a node's text where TeX left it, about half the node's width right of the PDF (decision
0013). The harness's special check named every field set inside one, and the probe kept such a
field as `moved`, detail `transform`: 383 words in 9 resumes, 254 of them AltaCV's `\cvtag` (0073,
0077). The owner decided the page applies the PDF's translations, so that an imported page with
tags changes to match the PDF, and that rotated or scaled text is drawn where the PDF draws it and
stays locked.

## Decision

### What the words were kept for

The `transform` detail now says what the field is set inside, by the matrix's linear part:
`translation`, `rotate`, `scale`, another `matrix`, or `other`, a `pdf:btrans` whose arguments the
page does not read. Each corpus row's piece breaks its `transform` words down by kind
(`transforms`, beside 0073's `details`), and `corpus compare` sets the new field aside against a
run made before it. On main's code with this breakdown, over the 9 resumes: all 383 words are
`translation`; none is rotated, scaled or set in another matrix.

### The page applies them, once, where the stream is read

`parseDvi` reads each page's specials in order as xdvipdfmx keeps its graphics state
(`GraphicsState`, `placeItems` in `src/tex/transforms.ts`): `pdf:btrans` and `pdf:etrans` under every
name xdvipdfmx takes for them, nested; `pdf:bcontent` and `pdf:econtent`, `x:gsave` and `x:grestore`,
which open and close a level; `x:scale` and `x:rotate` to the end of their level; `x:bscale` and
`x:escale` as the tree's xdvipdfmx does them, about two points; afresh on each page. Each matrix is
taken about the point it is written at, its offsets in big points and its y up, and composed with
those open around it. Every item set inside one is moved to where the PDF puts it, a native run's
glyph offsets turned with it, and marked with what it is set in (`PageItem.transform`, and the
matrix's linear part where it is not the identity).

So everything that reads the parser's output reads the PDF's positions: the SVG, the glyphs' boxes
and origins (`draw.ts`), the click between two glyphs (`fieldNear`, which reads the SVG), the
overlay's layout, the locked parts' blocks, the reference's glyph stream and every check that
compares a compile with it. An import's page and its reference are read the same way, so they
cannot differ by this.

A rotated or scaled glyph or rule is drawn turned or scaled about its origin, as the PDF draws it
(`turnedAbout`), and its box is the turned box's bounds (`boxAbout`).

### What the checks let through

The special check names a field only where its begin marker or a glyph of it is set inside a
rotation, a scale, another matrix, or a level it does not read, with the kind
(`Finding.transform`), which the probe keeps as its `moved`, `transform` verdict. A field in a
translation is checked as any other: the probe compiles it, and keeps it where its markers move the
page, as it would anywhere. The overlay sets a field's rows upright at the font's size, so a rotated
or scaled field stays locked: editing one would need a turned overlay and new hit-testing, for few
words (owner's decision 5). A closed level that was never opened, and an `x:escale` with no
`x:bscale`, are reported as before.

This amends the rule decisions 0008 and 0013 gave every port: a field may be set inside a
translation, as a TikZ node's text is; not inside a rotation or a scale, which the harness reports.
The built-in templates set no field inside any, and their pages do not change.

### Against the PDF

- AltaCV's upstream sample, compiled as an import's reference is, and its PDF: 16 text operators
  set in a translation, its six tags' 172 glyphs, each within 0.010 pt of the PDF at its start and
  at its last glyph's end; the 1,130 glyphs set in none within 0.017 pt; no operator unmatched
  (`scripts/oracle-transform.test.ts`).
- Invented look-alikes, on pdfTeX and on XeTeX: an inline node, three nodes in a picture, one in a
  shifted scope, a node rotated 30 degrees, `\rotatebox{30}`, `\rotatebox{90}` and `\scalebox{1.5}[0.8]`:
  each operator within 0.5 pt of the PDF, the four upright nodes as translations, the three
  rotations as `rotate` and the scale as `scale`; the turned glyphs drawn with the turned matrix and
  boxed turned (`src/tex/transforms-pdf.test.ts`). Imported, the three tags' arguments are
  `editable` and fields; the rotated argument is `moved`, `transform`, `rotate`, and the scaled one
  `scale`, neither a field; the outline's page is the upload's.
- Every imported corpus resume whose reference output has a `pdf:btrans`, 16 of the 110: 10 set
  glyphs in a translation, 4,054 of them. Of those, 3,644 are matched to the PDF's operators, each
  within 0.012 pt. The rest go unchecked: `altacv-0008` (72) and `altacv-0015` (63), whose PDF
  xdvipdfmx cannot make (a font with no outline), and 275 of `other-0023`'s in operators whose codes
  are not the DVI's. `europecv-0008`'s PDF was made, for this check alone, with its dvips picture
  specials (`psfile=`), which the session refuses, passed over. The script prints ids, counts and
  offsets only.
- One way the PDF moves the text that the page still does not follow: a `cm` a template writes
  itself in `pdf:code` or `pdf:literal`, and a form's content, which xdvipdfmx draws where
  `pdf:uxobj` puts it. Neither is a translation pgf or graphicx writes around text.

### Measured

`corpus run --json` over the 9 resumes with `transform` words, against main's run: no resume
worse in outcome or words in place; words in place 6,831 to 7,200 (+369), 86.1% to 90.5%;
`altacv-0008`, `altacv-0010` and `altacv-0014` from partial to success, and 2 to 5 of them at 90%.
`moved` words 448 to 101: `transform` 383 to 0, `position` 65 to 101. The 36 new `position` words
are `altacv-0010`'s, a class macro's first argument inside its node, which its markers move, as
they move the page elsewhere (decision 0077); no invented look-alike of a tag reproduced it. A few
of the resumes count a word or two more on their page (`altacv-0005` 808 to 813), as the tags' words
now stand where the PDF has them, apart from the text they overlapped. Compiles 717 to 735 over the
9. Jake's Resume's own sample imported in 4.27 s, 28 compiles, at a load of 6 beside another lane
(4.23 s and 28 in decision 0079).

Then over all 220 documents, alone in the whole-corpus slot but beside the other lane's work,
against main's run: `corpus compare` finds them the same but the same 9, times aside, and the
breakdown set aside where main's run lacks it; no resume worse in outcome or words in place.
Words in place 72,384 to 72,753 of 82,519 (82,497 before), 87.7% to 88.2%; 75 to 78 resumes at 90%,
3 under 50% as before; 69 to 72 successes. By family: AltaCV 89.6% to 94.3%, Europass 78.1% to
78.7%, the others 80.0% to 80.1%; Jake's, Awesome-CV and moderncv as before. `moved` words 2,153 to
1,806: `transform` 383 to 0, `position` 1,760 to 1,796, `rule` 10. All compiles 5,849 to 5,867. The
slowest pdfTeX import is still `altacv-0017`'s, 88.8 s (103.9 s in main's run, at its load); the
others of the 9 within 3.2 s of main's run's times.

## Consequences

- Every imported page with a TikZ node's text changes: the text moves to where the PDF puts it.
  No user has a saved import (owner, 7 October 2026), so nothing stored needs moving.
- Rotated and scaled text is on the page where the PDF has it, locked; making it editable is the
  overlay's to do, with hit-testing that turns too.
- `parseDvi` reads each page's specials once more, which costs a regular expression a special.
- The change touches `src/import/` (the probe) and the corpus scripts (`corpus-import.ts`,
  `corpus-pieces.ts`, `corpus-run.ts`), so a corpus run is worth doing, by the owner's choice:
  `gh workflow run corpus.yml --ref waikin/page-transforms`. It moves the `transform` words, and the
  pages of every resume with tags.
