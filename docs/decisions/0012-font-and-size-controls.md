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

- **The font size through the fontsize package, after the format.** A pdfTeX template whose
  fonts scale loads the `fontsize` package in its preamble at its class's size, and its font
  size control applies `\changefontsize{<size>pt}` in the body. That sets `\normalsize` and every
  other size, the leading and the lists' spacing again from the size given, so the control is
  not format-bound: one format serves every size, and a change of size is an ordinary compile.
  Jake's loads `\usepackage[fontsize=11pt,parindent=0pt]{fontsize}` after Latin Modern, keeps
  `11pt` on `\documentclass`, and declares 11 as the control's default. `parindent=0pt` keeps
  the zero paragraph indent Jake's `\raggedright` sets, which `\changefontsize` would otherwise
  set to one and a half times the size. Latin Modern is scalable, with a design size for each
  range of sizes, so the half sizes need no other font.
- **One format per size is for a class whose sizes do not scale.** A `format` control, with the
  size in the class's options, stays for a class that the fontsize package cannot resize after
  the format, such as one whose fonts come in fixed sizes or that sets what it derives from the
  size only as it loads. No port has one. Decision 0006's example of a format-bound control, the
  font size in `article`, is one only a template without the fontsize package needs.
- **Four families, in T1 through psnfss.** Jake's offers Latin Modern (`lm`, the default, which
  its preamble sets), Charter (`charter`, `\renewcommand{\rmdefault}{bch}`), Palatino
  (`palatino`, `\renewcommand{\rmdefault}{ppl}`) and Helvetica (`helvetica`,
  `\usepackage[scaled=.92]{helvet}\renewcommand{\familydefault}{\sfdefault}`), each applied in
  the body. They are T1, as decision 0009 has every pdfTeX port: the PostScript families' T1
  fonts are virtual fonts over their `8r` fonts, which decision 0009 draws, and psnfss's `.fd`
  files, which the tree has, give each family upright, italic or oblique, bold and small caps in
  T1, and TS1's symbols, so that a user's accented letters and symbols set in the family. They
  change the text's font only: the math, which Jake's sets only for its separators and bullets,
  stays Latin Modern's. Helvetica is scaled to 0.92, so that its large x-height sets nearer the
  serif families' size. Times (`ptm`) is in the tree too, and stays out, since four is the
  plan's most. XeTeX families wait for item 21, and families outside the tree, such as Roboto,
  Lato and Source Sans, for item 19.
- **A family a template lists must draw as well as compile.** Every glyph of the sample in it is
  drawn and matched to its text. The harness's `controls` check compiles each listed family and
  fails one that does not compile or changes nothing; the round trip in `curated.test.ts` draws
  the sample in each, and fails one with a font the page cannot draw, a glyph that matches no
  character, or a field set in another family.

## Consequences

- Jake's page at the default is not upstream's to the point. The fontsize package keeps the
  proportions `article`'s sizes have at 10 points, so at 11 the name is 27.4pt where upstream's
  is 24.9pt, the section titles 13.2pt where upstream's are 12pt, the lines 13.2pt apart where
  upstream's are 13.6pt, and the entries' lists spaced 8.8pt and 4.4pt where upstream's are 9pt
  and 4.5pt. The sample's text is 388.5pt tall, 7.7pt more than before.
- The sample sets one page in every family at every size; in Latin Modern its text is 311.5pt
  tall at 9 points and 422.1pt at 12, growing at every half point. Every family compiles in the
  time Latin Modern does, about 75 ms a pass on an M4 Pro, Helvetica's `\usepackage` adding
  about 1.5 ms, and every size too. The fontsize package adds 8 files, 113 KB, and about 14 ms
  to the dump; the first compile in a family fetches its `.fd` files and TFMs, 25 to 57 KB,
  before the page fetches its outlines.
- The PostScript families' small caps, `bchrc8t`, `pplrc8t` and `phvrc8t`, and bold small caps,
  `bchbc8t`, `pplbc8t` and `phvbc8t`, are virtual fonts in T1, which read their lowercase codes
  as lowercase from T1's vector (decision 0009), so the section titles align. No family needs
  small caps from a virtual font in OT1, which decision 0009 left to this item. Latin Modern has
  no bold small caps, so the name is set in bold in it, as upstream's is in Computer Modern, and
  in bold small caps in the other three families.
- The harness's `controls` check compiles a family but does not draw it. A curated package's
  round trip does; an imported package has none, so milestone 3's probe step has to draw each
  font it probes, or the harness has to learn to.
- Fit to one page (item 18) steps the font size as an ordinary compile, with no dump. What the
  class sets in ems as it loads, such as the bullets' indent, stays as it is at every size, and
  the density control's compact and relaxed spacing is in points: at 9 points normal's space
  after a section title, 8.9pt, is a tenth of a point under compact's 9pt.
