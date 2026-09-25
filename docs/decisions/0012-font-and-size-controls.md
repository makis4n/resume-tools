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

- **The font size through the fontsize package, after the format, and the class's own sizes at
  the default.** A pdfTeX template whose fonts scale loads the `fontsize` package in its preamble
  with no size, and its font size control applies `\changefontsize{<size>pt}` in the body at
  every size but its class's. That sets `\normalsize` and every other size, the leading and the
  lists' spacing again from the size given, so the control is not format-bound: one format
  serves every size, and a change of size is an ordinary compile. At the class's size, the
  control's default, the sizes the class sets as it loads stand, so that the default page keeps
  upstream's look (decision 0008). Jake's loads `\usepackage[parindent=0pt]{fontsize}` after
  Latin Modern, keeps `11pt` on `\documentclass`, and applies
  `\ifdim{{value}}pt=11pt\else\changefontsize{{{value}}pt}\fi`: TeX compares the size as a
  dimension, so `11` and `11.0` alike leave article's sizes. The package sets every size from
  its default of 10 points as it loads, even when it is given no size, unless it finds
  `fontsize10.clo`, which it reads in its place; Jake's package carries that file, empty but for
  a comment, so the package adds `\changefontsize` and sets nothing. `parindent=0pt` keeps the
  zero paragraph indent Jake's `\raggedright` sets, which `\changefontsize` would otherwise set
  to one and a half times the size. Latin Modern is scalable, with a design size for each range
  of sizes, so the half sizes need no other font.
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

- Jake's page at the default is upstream's to the glyph, which the round trip checks against
  the page its preamble sets without the package: the name at 24.88pt, the section titles at
  12pt, the lines 13.6pt apart and the entries' lists spaced 9pt and 4.5pt, as `article`'s
  `size11.clo` sets them. The sample's text is 380.8pt tall, and the density round trip ends it
  at 361.7pt, 416.6pt and 464.7pt, as before this item. The package sets `\@ptsize`, the class's
  size less 10, to 0 as it loads, where `article` leaves 1; nothing Jake's loads reads it.
- The sizes the package sets keep the proportions `article`'s have at 10 points, not those of
  its own at 11, so the name and the section titles do not grow at every step: 10.5 points sets
  the name at 26.1pt and the titles at 12.6pt, larger than 11 does, and 11.5 points at 28.6pt
  and 13.8pt. The text grows at every step: in Latin Modern the sample's is 311.5pt tall at 9
  points, then 327.8pt, 354.9pt, 371.7pt, 380.8pt at 11, 405.3pt, and 422.1pt at 12, and it sets
  one page in every family at every size.
- Every family and every size compiles in the time the default does, about 72 ms a pass on an
  M4 Pro, Helvetica's `\usepackage` adding about a millisecond. The package adds 7 files,
  110 KB, and about 6 ms to the dump; the first compile in a family fetches its `.fd` files and
  TFMs, 25 to 57 KB, before the page fetches its outlines.
- A later fontsize with another default size or file name would set every size again as it
  loads, and the round trip's comparison with the page set without the package fails if it
  does.
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
