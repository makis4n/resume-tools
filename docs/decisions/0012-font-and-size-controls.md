# 0012. Font and font size controls

Date: 2026-09-25 · Status: accepted

## Context

Milestone 2 item 17 gives Jake's Resume the font size and font controls of plan section 5.4:
sizes from 9 to 12 points in half points, and three or four families that the template's engine
loads from TeX Live. Plan section 5.4 and decision 0006 give a class that fixes its size as it
loads, as `article` does, one format per size, since a snippet after the format cannot change
what the class set; but `article` sets its sizes only at 10, 11 and 12 points, so the half
sizes would need another way in any case. Decision 0009 made re-encoded and virtual fonts draw,
which opens TeX Live's PostScript families to pdfTeX templates.

## Decision

- **The font size scales the class's own sizes, after the format.** A pdfTeX template whose fonts
  scale defines in its preamble a macro that sets every size its class sets as it loads, with the
  spacing that goes with each, scaled by the size asked for over the class's own, and its font
  size control calls the macro in the body. The control is then not format-bound: one format
  serves every size, and a change of size is an ordinary compile. The page keeps the class's
  proportions at every size, so that every size and the space between lines grow with the
  control. The fontsize package would do the same work with the proportions `article`'s sizes
  have at 10 points, so that 10.5 points would set the name and the titles larger than the
  class's own 11 do, and it sets every size from 10 points as it loads unless it finds a file to
  read in their place.
- **Jake's `\rtfontsize`.** `\rtfontsize{<points>}` sets the ten sizes `article`'s `size11.clo`
  defines, `\tiny` to `\Huge`, each with its baselineskip, and with the display skips and the
  first list level's spacing that `\normalsize`, `\small` and `\footnotesize` set; the second and
  third list levels' spacing, the bullets being the second; and, outside any list, the first
  level's spacing and `\partopsep`, which `\trivlist` and so `center` take, as `size11.clo` sets
  them as it loads. Each length is multiplied by <points>/11 and rounded to a hundredth of a
  point in TeX's own arithmetic (`\dimexpr` and `\numexpr`), and `\normalsize` follows. The
  preamble defines the sizes once, in `size11.clo`'s shape with each length scaled by the size
  `\rtfontsize` last set, 11 points until it sets another. The control applies
  `\rtfontsize{{{value}}}`, keeps `11pt` on `\documentclass`, and defaults to 11. A length
  written to two decimals rounds back to what TeX reads for it, so at 11 points, or 11.0, every
  length is `size11.clo`'s. The paragraph indent stays the 0pt Jake's `\raggedright` sets. Latin
  Modern is scalable, with a design size for each range of sizes, so the half sizes need no other
  font.
- **One format per size is for a class whose sizes do not scale.** A `format` control, with the
  size in the class's options, stays for a class whose sizes cannot be set again after the
  format, such as one whose fonts come in fixed sizes or that sets what it derives from the size
  only as it loads. No port has one. Decision 0006's example of a format-bound control, the font
  size in `article`, is one only a template that does not scale the class's sizes itself needs.
- **Four families, in T1 through psnfss.** Jake's offers Latin Modern (`lm`, the default, which
  its preamble sets), Charter (`charter`, `\renewcommand{\rmdefault}{bch}`), Palatino
  (`palatino`, `\renewcommand{\rmdefault}{ppl}`) and Helvetica (`helvetica`,
  `\usepackage[scaled=.92]{helvet}\renewcommand{\familydefault}{\sfdefault}`), each applied in
  the body. They are T1, as decision 0009 has every pdfTeX port: the PostScript families' T1
  fonts are virtual fonts over their `8r` fonts, which decision 0009 draws, and psnfss's `.fd`
  files, which the tree has, give each family upright, italic or oblique, bold and small caps in
  T1, and its symbols in TS1, so that a user's accented letters are the family's own. A symbol
  the family's TS1 subset lacks, such as → or №, is set in Latin Modern's TS1 font (Latin Modern
  Sans's in Helvetica, and Latin Modern's caps in small caps), because the tree's Computer Modern
  TS1 fonts, which LaTeX would otherwise take, have no outlines: Jake's preamble names Latin Modern as the substitution family,
  in `\rmsubstdefault`, `\sfsubstdefault` and `\ttsubstdefault`, and the round trip sets both
  symbols in each family, on the page and in the PDF. They change the text's font only: the math,
  which Jake's sets only for its separators and bullets, stays Latin Modern's. Helvetica is scaled
  to 0.92, so that its large x-height sets nearer the serif families' size. Times (`ptm`) is in
  the tree too, and stays out, since four is the plan's most. XeTeX families wait for item 21, and
  families outside the tree, such as Roboto, Lato and Source Sans, for item 19.
- **A family a template lists must draw as well as compile.** Every glyph of the sample in it is
  drawn and matched to its text. The harness's `controls` check compiles each listed family and
  fails one that does not compile or changes nothing; the round trip in `curated.test.ts` draws
  the sample in each, and fails one with a font the page cannot draw, a glyph that matches no
  character, or a field set in another family.

## Consequences

- Jake's page at the default is upstream's to the byte, which the round trip checks against the
  output of its preamble without `\rtfontsize` and with no size asked for: the name at 24.88pt,
  the section titles at 12pt, the lines 13.6pt apart and the entries' lists spaced 9pt and
  4.5pt, as `size11.clo` sets them. The sample's text is 380.8pt tall, and the density round trip
  ends it at 361.7pt, 416.6pt and 464.7pt, as before this item.
- Everything grows with the control, as the round trip checks at every size. In Latin Modern the
  sample's name, section titles, bullets' lines and text are:

  | Size | Name | Section titles | Bullets' lines apart | Text, top to bottom |
  |---|---|---|---|---|
  | 9pt | 20.36pt | 9.82pt | 9.82pt | 306.4pt |
  | 9.5pt | 21.49pt | 10.36pt | 10.36pt | 322.2pt |
  | 10pt | 22.62pt | 10.91pt | 10.91pt | 347.9pt |
  | 10.5pt | 23.75pt | 11.45pt | 11.45pt | 364.4pt |
  | 11pt | 24.88pt | 12pt | 12pt | 380.8pt |
  | 11.5pt | 26.01pt | 12.55pt | 12.55pt | 397.2pt |
  | 12pt | 27.14pt | 13.09pt | 13.09pt | 413.7pt |

  The normal size runs from 8.96pt to 11.95pt, 10.95pt at 11 as `article` has it. The sample sets
  one page in every family at every size and in every density, with nothing set over anything
  else.
- `\rtfontsize` costs nothing measurable: every size and every family compiles in the time the
  default does, about 70 ms a pass on an M4 Pro, Helvetica's `\usepackage` adding about a
  millisecond, and the format dumps as fast as upstream's preamble. The first compile in a family
  fetches its `.fd` files and TFMs, 25 to 57 KB, before the page fetches its outlines.
- The PostScript families' small caps, `bchrc8t`, `pplrc8t` and `phvrc8t`, and bold small caps,
  `bchbc8t`, `pplbc8t` and `phvbc8t`, are virtual fonts in T1, which read their lowercase codes
  as lowercase from T1's vector (decision 0009), so the section titles align. No family needs
  small caps from a virtual font in OT1, which decision 0009 left to this item. Latin Modern has
  no bold small caps, so the name is set in bold in it, as upstream's is in Computer Modern, and
  in bold small caps in the other three families.
- A known limit: the psnfss T1 virtual fonts of Charter, Palatino and Helvetica have no Ŋ, ŋ or
  ȷ, and their TS1 fonts no ␢ (Palatino's and Helvetica's no ‽ either), and draw fontinst's black
  box in their place, on the page and in the PDF, as any LaTeX document set in these families
  does; LaTeX counts the two symbols as present, so the substitution above never reaches them.
  Latin Modern draws them all.
- The harness's `controls` check compiles a family but does not draw it. A curated package's
  round trip does; an imported package has none, so milestone 3's probe step has to draw each
  font it probes, or the harness has to learn to.
- Fit to one page (item 18) steps the font size as an ordinary compile, with no dump. What the
  class sets in ems as it loads, such as the bullets' indent, stays as it is at every size, and
  the density control's compact and relaxed spacing is in points: at 9 points normal's space
  after a section title, 8.9pt, is a tenth of a point under compact's 9pt.
