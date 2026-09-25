# 0009. Fonts beyond Computer Modern

Date: 2026-09-25 · Status: accepted

## Context

Milestone 2 item 16 gives the page the fonts beyond Computer Modern. The page is drawn from Type 1
outlines read in the browser (decision 0003), and until now only a font whose `pdftex.map` entry
named a Type 1 file to draw as it is had outlines, in practice Computer Modern; TeX Live's other
pdfTeX families, which the font control (item 17) and AltaCV (item 20) need, are re-encoded (Latin
Modern in T1 and TS1, the URW fonts through `8r.enc`), slanted or stretched, or virtual (the
PostScript families in T1), and name their glyphs as Adobe does. And LaTeX 2023 sets its itemize
bullet, `$`, `€` and `°` from TS1 even in OT1, and in OT1 cannot set `ą`, `Đ` or guillemets at all
(decisions 0007 and 0008).

## Decision

- **What a TeX font resolves to.** Its TFM gives its metrics, and then its `pdftex.map` entry
  its outlines: an entry that names a Type 1 file gives that file's glyphs, under the entry's
  encoding vector when it names one (`src/tex/enc.ts`), then slanted and stretched as `SlantFont`
  and `ExtendFont` say, x' = extend·x + slant·y with advances scaled by extend (`outlines.ts`).
  A font with no such entry is looked for as a virtual font (`vf.ts`): each character's packet is
  run, and the glyphs and rules it places become one glyph in the virtual font's own 1000-unit em,
  each glyph scaled by its font's scale and moved where the packet puts it, with the advance from
  the virtual font's TFM. The fonts a packet sets resolve the same way, virtual ones too, and a
  chain that leads back to itself is refused. A font that is neither has no outlines.
- **Where.** In `FontLibrary` (`src/page/fonts.ts`), where a TeX font becomes a `FontOutlines`:
  256 glyph names and one outline per name. The renderer, the hit boxes and the field aligner are
  unchanged by it, and draw a re-encoded, transformed or virtual font as they draw Computer
  Modern. A Type 1 file is read and interpreted once for every font that uses it, as `ec-lmr10`
  and `ts1-lmr10` both use `lmr10.pfb`.
- **A font the page cannot draw costs nothing else.** Whatever goes wrong past a font's metrics,
  a file the tree lacks, one that does not parse, a packet the expander refuses or a cycle, leaves
  the font without outlines and with the reason, so that each of its glyphs is left out and
  counted, never drawn as the wrong glyph. `drawPage` never throws over a font: its
  `missingFonts`, like the harness's fonts check, names each one and why. A read that fails is
  passed on rather than kept, since the next draw may read the file.
- **Glyph text through the Adobe Glyph List.** A glyph's text comes from its name: after a suffix
  from the first period is dropped (`a.sc` is `a`), Computer Modern's own table first, which keeps
  winning so that `quoteright` stays `'` and `endash` stays `--` for the aligner; then a single
  ASCII letter; then the AGL, TeX Live's `glyphlist.txt`, which a name for several code points
  reads as all of them; then the `uniXXXX` and `uXXXX[XX]` forms; then a ligature's parts joined
  by `_`. A virtual font's composed character is named after its parts, joined by `+` with any
  accent after the rest (`A+breve`), and a rule is `rule`; it reads as its parts' texts with each
  accent as its combining mark after the rest, composed (NFC), so `A+breve` is `Ă`. A part with
  no text leaves the whole without one.
- **Accents set with `\accent`.** TeX puts the accent in the DVI before its letter and moves back
  so that the letter starts under it. A spacing accent (`ACCENTS` in `glyphs.ts`: the thirteen of
  TeX's text encodings) directly followed in the same field by a letter that starts before the
  accent's advance ends is one character, composed (NFC): the letter's item, listing the accent's,
  so that a click on either lands on it and both carry its field and offset in the SVG. The
  position test keeps OT1's `\textasciitilde` and `\textasciicircum`, the same accent glyphs
  standing alone, reading as `~` and `^`. The aligner takes a composed letter for its decomposed
  spelling too, as a model holds a letter typed with a combining mark, and T1's one glyph for `Ð`
  and `Đ`, which its fonts name `Eth`, for either.
- **One font map.** The Ubuntu bundles' font maps are not in `pdftex.map`, which updmap wrote for
  TeX Live's basic tree only. The fetch script merges them as updmap would (`scripts/fontmaps.ts`):
  each entry of `/texmf/texmf-dist/fonts/map/dvips/*/*.map`, in path order, for a TeX font the map
  does not have yet and whose outline file the trees hold, appended as its line is, under a
  comment naming its map; the manifest records the new size, and the layout is 2, so an older
  `.engine/` is built again. It adds 150 entries from 18 maps, among them marvosym, eurosym,
  txfonts, pxfonts, wasy, esint, mflogo, manfnt and the URW families' own maps. The page and the
  PDF, which item 14 makes with xdvipdfmx, whose `dvipdfmx.cfg` reads `pdftex.map`, so find the
  same outline for the same font.
- **pdfTeX ports take T1 and Latin Modern.** A pdfTeX port loads `\usepackage[T1]{fontenc}` and
  `\usepackage{lmodern}`: the tree's Computer Modern has no outlines in T1, since it has no
  cm-super, while Latin Modern is Computer Modern's scalable successor, the same design, and has
  them; and in OT1 LaTeX cannot set `ą`, `Đ` or guillemets at all. This amends decision 0008's
  list of what a port changes. Jake's Resume takes them: its sample draws from `ec-lmr10`,
  `ec-lmbx10`, `ec-lmbx12`, `ec-lmri10`, `ec-lmcsc10`, `ts1-lmr10` for `€` and `°`, and Latin
  Modern's math symbols, `lmsy10` for the separators and `lmsy6` for the bullets, which
  `\labelitemii` sets as a math bullet, as `cmsy6` did before.
- **The web fonts.** Item 9 builds the overlay's web fonts from `FontOutlines`, so what this gives
  the page serves them as it is: glyphs already re-encoded, slanted, stretched or composed, in the
  em and with the advances the page uses, and names that `glyphText` reads.

## Consequences

- The EC and TC fonts, such as `ecrm1000` and `tcrm1000`, have metrics in the tree but no
  outlines: a template set in T1 or TS1 with Computer Modern is drawn without those glyphs and
  fails the harness's fonts check. Ports take Latin Modern instead.
- XeTeX's native fonts (item 21) and fonts outside the tree (item 19) stay open.
- A virtual small-caps font, such as `ptmrc8t`, draws its lowercase letters as scaled capitals
  and names them after the capitals, so they read as capitals and do not align with lowercase
  text. Item 17 decides whether its families need small caps from a virtual font; if they do,
  such a font's text has to come from its encoding rather than its glyphs.
- A glyph whose name neither table, the AGL nor its forms know, such as T1's `cwm`,
  `perthousandzero` (half of `‰`) or `Germandbls` (`\SS`), has no text, and a field that holds
  one fails the alignment check.
- Composed glyphs are named with `+` and, where two codes place one glyph differently, a `.code`
  suffix. Item 9's web font writer has to take such names or give the glyphs its own.
