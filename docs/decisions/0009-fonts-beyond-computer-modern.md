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
- **What a virtual font may cost.** A packet is a program a font file brings, and each composed
  glyph copies the path data of the glyphs it sets, so a chain of virtual fonts multiplies its
  cost at every level: a few kilobytes of files could hold the page's thread for a minute and run
  it out of memory. Budgets a real font never reaches, and a hostile one reaches at once, leave
  such a font undrawn with the reason: at most 8 KB in a packet, 64 characters and rules set by
  one, 32 pushes nested in one (`vf.ts`), four virtual fonts in a chain, and 64 K characters of
  path data and name in one composed glyph, 4 M in one font (`fonts.ts`). A glyph's name counts
  because it joins its parts' names, and grows with them even where they have no path. Across TeX
  Live's 664 virtual fonts the most any needs is 111 bytes, 11 characters and rules, pushes 2 deep,
  one virtual font in a chain, and 3.1 KB and 187 KB of path data; Times in T1, `ptmr8t`, needs
  52 bytes, 3 characters and rules, pushes 1 deep, a chain of one, and 1.2 KB and 97 KB.
- **Where.** In `FontLibrary` (`src/page/fonts.ts`), where a TeX font becomes a `FontOutlines`:
  256 glyph names and one outline per name. The renderer, the hit boxes and the field aligner are
  unchanged by it, and draw a re-encoded, transformed or virtual font as they draw Computer
  Modern. A Type 1 file is read and interpreted once for every font that uses it, as `ec-lmr10`
  and `ts1-lmr10` both use `lmr10.pfb`.
- **A font the page cannot draw costs nothing else.** Whatever goes wrong past a font's metrics,
  a file the tree lacks, one that does not parse, a packet the expander refuses, a cycle or a
  budget, leaves the font without outlines and with the reason, so that each of its glyphs is left
  out and counted, never drawn as the wrong glyph, while its metrics still place every glyph after
  its own. `drawPage` never throws over such a font: its `missingFonts`, like the harness's fonts
  check, names each one and why. A read that fails there, such as a dropped request for a Type 1
  file, leaves the font the same way for that draw only: the library forgets it once it settles,
  and the next draw reads the file again. What every page needs cannot be left out that way: when
  a font's TFM, `pdftex.map` or `glyphlist.txt` cannot be read, `load` rejects and `drawPage`
  with it, since a page drawn without them would put glyphs in the wrong places, or name them
  wrongly, with no error, and the caller keeps the page it had.
- **Glyph names are data.** A glyph name comes from a font file or an encoding vector and may be
  any word, `constructor` and `__proto__` among them, so every `FontOutlines.glyphs` is a table
  with no prototype (`glyphTable`), read with `Object.hasOwn` (`glyphOf`), and every other table
  looked up by a glyph's name or text is a map or is read with `Object.hasOwn`.
- **Glyph text through the Adobe Glyph List.** A glyph's text comes from its name. A name with
  a suffix reads first as the AGL, TeX Live's `glyphlist.txt`, reads the suffix joined to the base,
  unless that is a private-use character: Latin Modern's TS1 names its superior figures
  `two.superior` and the like, which are the AGL's `twosuperior`, `²`, while the AGL puts Adobe's
  expert glyphs such as `dollaroldstyle` in the Private Use Area, so `dollar.oldstyle` stays `$`.
  Otherwise, after the suffix from the first period is dropped (`a.sc` is `a`), Computer Modern's
  own table first, which keeps winning so that `quoteright` stays `'` and `endash` stays `--`
  for the aligner, and which names TS1's symbols as LaTeX's UTF-8 input sets them (`ts1enc.dfu`)
  where the AGL lacks them, as `permyriad` for `‱`, or reads them as other characters:
  `asteriskmath` is `⁎`, not `∗`, and `angleleft` is `⟨`, not U+2329, the aligner taking each
  angle bracket for any of the three code points LaTeX sets it from; then a single ASCII letter;
  then the AGL, which a name for several code points reads as all of them; then the `uniXXXX` and
  `uXXXX[XX]` forms; then a ligature's parts joined by `_`. Whichever of these reads a name, a
  Latin ligature's code point, U+FB00 to U+FB06, is spelled as its letters (`uniFB01` is `fi`,
  `uniFB05` is `ſt`), as the table spells Computer Modern's ligatures, since a model's text holds
  the letters: Lato and Roboto name their ligatures by code point, and the AGL reads `fi` as
  U+FB01. A virtual font's composed character is named after its parts, joined by `+` with any
  accent after the rest (`A+breve`), and a rule is `rule`; it reads as its parts' texts with each
  accent as its combining mark after the rest, composed (NFC), so `A+breve` is `Ă`. A part with
  no text leaves the whole without one.
- **A virtual font's text from its encoding.** A code's glyph may say less than the code: fontinst
  builds `ď` from a `d` and a `quoteright`, `đ` from a `d` and a `macron`, a small-caps
  font's `a` from a smaller `A`, and Courier's en dash from a hyphen. So a virtual font whose name
  says its encoding by fontinst's naming reads each code as the name its encoding's vector gives
  it, through `glyphText`: `8t` is T1 (`lm-ec.enc`), `8c` TS1 (`lm-ts1.enc`) and `8r` TeX Base 1
  (`8r.enc`), each followed by `n` in a narrow font; a name the vector gives no text, such as T1's
  `Germandbls`, falls back to the parts (`S+S` reads `SS`), and so does every other virtual font.
  OT1 (`7t`) is left to its parts: its layout depends on the shape, a typewriter font having `<`
  where a roman one has `¡`, an italic one `£` where an upright one has `$`, which the name does
  not say. The glyphs keep their parts' names, which item 9's web fonts need apart.
- **Accents set with `\accent`.** TeX puts the accent in the DVI before its letter, centred over
  it, and moves back so that the letter starts where the accent began: after the accent when the
  letter is the narrower, before it when the letter is the wider, by less than twice the accent's
  width in every T1 and OT1 font the page can draw (a dot over a W is the most, 1.83 widths in
  Avant Garde's oblique). A spacing accent (`ACCENTS` in `glyphs.ts`: the thirteen of TeX's text
  encodings, and the ASCII `^` and `~`, which OT1's typewriter fonts set `\^` and `\~` with)
  directly followed in the same field by a letter that starts within that span, from twice the
  accent's width before it to the end of its advance, is one character, composed (NFC): the
  letter's item, listing the accent's, so that a click on either lands on it and both carry its
  field and offset in the SVG. The test does not look at the height, since TeX raises the accent
  over a tall letter. It keeps a `~` or `^` standing alone, OT1's `\textasciitilde` and
  `\textasciicircum` or T1's, reading as itself, since a letter after one starts where it ends (no
  text font in the tree kerns a letter after either), and an accent that ends a line apart from
  the first letter of the next, back at the left margin. It needs the fonts' widths, so the
  harness parses the output with them, as the page does. The aligner takes a composed letter for
  its decomposed spelling too, as a model holds a letter typed with a combining mark, and T1's one
  glyph for `Ð` and `Đ`, which its fonts name `Eth`, for either.
- **One font map.** The Ubuntu bundles' font maps are not in `pdftex.map`, which updmap wrote for
  TeX Live's basic tree only. The fetch script merges them as updmap would (`scripts/fontmaps.ts`):
  each entry of `/texmf/texmf-dist/fonts/map/dvips/*/*.map`, in path order, for a TeX font the map
  does not have yet and whose outline file the trees hold, appended as its line is, under a
  comment naming its map; the manifest records the new size, and the layout is 2, so an older
  `.engine/` is built again. CI keys its cached `.engine/` on the fetch script and the two modules
  the merge runs on, `scripts/fontmaps.ts` and `src/page/fontmap.ts`. It adds 150 entries from 18
  maps, among them marvosym, eurosym, txfonts, pxfonts, wasy, esint, mflogo, manfnt and the URW
  families' own maps. The page and the PDF, which item 14 makes with xdvipdfmx, whose
  `dvipdfmx.cfg` reads `pdftex.map`, so find the same outline for the same font.
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
- A virtual small-caps font in T1 or TS1, such as `ptmrc8t`, reads its lowercase codes as
  lowercase, from its encoding, though it draws them as scaled capitals; one in OT1, such as
  `ptmrc7t`, still reads them as the capitals it draws. Item 17 decides whether its families
  need small caps from a virtual font in OT1.
- A hostile font within the budgets still costs what they allow: a chain of four virtual fonts of
  4 M characters each composes in about a quarter of a second on a recent laptop and holds 16 MB,
  on the thread that draws the page.
- A glyph whose name neither table, the AGL nor its forms know, such as T1's `cwm`,
  `perthousandzero` (half of `‰`) or `Germandbls` (`\SS`), has no text, and a field that holds
  one fails the alignment check.
- Composed glyphs are named with `+` and, where two codes place one glyph differently, a `.code`
  suffix. Item 9's web font writer has to take such names or give the glyphs its own.
