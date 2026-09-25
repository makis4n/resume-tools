# 0014. XeTeX templates

Date: 2026-09-25 · Status: accepted

## Context

Milestone 2 item 21 makes decision 0003's XeTeX loop the editor's: a format dumped from a
preamble that loads no native font, and fonts declared by file, which load when the body selects
them. The page could draw only Type 1 glyphs, the overlay only measure TFM fonts, and a package
had nowhere to name its fonts, which decision 0006 left to this item as a "resolved fonts"
section. Decision 0011 gives fontconfig no font folder to scan, so XeTeX finds Roboto, Lato,
Source Sans Pro, Font Awesome and every other font of the tree only by file. Awesome-CV's port is item 22; an invented XeTeX
template (`src/templates/invented.ts`: Roboto for the text, Source Sans Pro for the headings,
one Font Awesome icon in the header) stands in for it in the tests.

## Decision

- **A package's fonts.** A package with `engine: "xetex"` may carry `fonts`, a list of families,
  each an NFSS name of letters and digits, its shapes keyed `<series>/<shape>` from `m`, `b`, `bx`
  and `n`, `it`, `sl`, `sc`, each a font file of the tree by its plain name, and the XeTeX
  features every shape loads with, such as `mapping=tex-text`:

  ```json
  "fonts": [
    { "family": "Roboto", "shapes": { "m/n": "Roboto-Regular.otf", "bx/n": "Roboto-Bold.otf" },
      "features": "mapping=tex-text" },
    { "family": "FontAwesome", "shapes": { "m/n": "FontAwesome5Free-Solid-900.otf" } }
  ]
  ```

  A file name is letters, digits, `.`, `_`, `+` and `-`, not starting with a dot, and ends in
  `.otf` or `.ttf`, as every file of the tree's `fonts/opentype` and `fonts/truetype` does;
  features are letters, digits, `=`, `;`, `+`, `-`, `.` and `_`. Neither can hold `[`, `]`, `"`,
  `:` or anything else TeX would read as syntax, since both go inside the declaration's quotes. A
  family is declared once; a pdfTeX package with `fonts` is refused. TeX Live 2023's Roboto is
  OpenType, not TrueType: its files are `Roboto-*.otf`, as Source Sans Pro's and Font Awesome's
  are; Lato's are TrueType.
- **The declarations.** `generateFormat` writes, after the package's preamble and before the
  prelude, `\DeclareFontFamily{TU}{<family>}{}` for each family and
  `\DeclareFontShape{TU}{<family>}{<series>}{<shape>}{<->"[<file>]:<features>"}{}` for each
  shape, or `[<file>]` alone. They load nothing until a shape is selected, so the format dumps;
  the preamble is the port's: `\RequirePackage[OT1]{fontenc}` before the class, no fontspec,
  `\renewcommand{\encodingdefault}{TU}` and `\renewcommand{\rmdefault}{<family>}`, so that
  `\begin{document}` selects the family. hyperref takes its own XeTeX driver, which writes
  dvipdfmx's specials: under XeTeX it refuses the `dvipdfmx` option decision 0008 gives pdfTeX
  ports. A package without fonts dumps what it did, under the same format name.
- **Native fonts on the page.** `drawPage` loads the XDV's native fonts too, by the file name,
  the last segment of the path XeTeX writes (`/texlive/texmf-dist/fonts/opentype/google/roboto/
  Roboto-Regular.otf`), from the tree's `fonts/opentype` and `fonts/truetype` (`loadNative`), and
  reads each through opentype.js (`src/page/native.ts`, the spike's adapter grown). A file of
  more than 32 MB, or with more than 65,535 glyphs, is refused, as decision 0009 bounds a virtual
  font. Each glyph of a run is drawn from its outline, has a hit box of its own, the outline's box
  scaled to the size and stretched and slanted as xdvipdfmx does, and is a glyph of its field of
  its own, with its index in the run (`FieldGlyph.glyph`) and its own `data-field` and
  `data-offset`, so that a click lands on its character. The field's layout records the native
  font, its file and size, as the field's font.
- **A native glyph's text.** The character the file's character map gives the glyph, the lowest
  when it gives several. A ligature of the `liga` feature reads as its components, which is what
  a resume's text holds: Roboto's `fi` is also U+FB01 in its map, and a ligature the map reaches
  only through a character that decomposes to its components reads as them. A glyph neither
  reaches, such as a small capital that `+smcp` substitutes, has no text. Native fonts set
  accented letters whole, so none is paired with an accent. XeTeX's `tex-text` mapping sets `’`
  for `'`, `–` for `--`, `”` for `"` and the rest of `tex-text.map`, so the aligner reads each of
  those characters as the text's spelling too.
- **What the page cannot draw.** A native font is drawn as boxes, one for each run, and named in
  `missingFonts` and the harness's fonts check, by its file's name, when the tree lacks the file,
  the file cannot be read or parsed, XeTeX set a face of a collection other than the first, or
  XeTeX emboldened it, which xdvipdfmx strokes and the page does not.
- **The overlay's native face.** `Face` is an interface either kind of font fills: `codeFor`,
  `widthOf`, `spaceGlue` and `hyphenChar`, and a TeX font's ligature and kern program, which
  `paragraphNodes` runs when the face has one. A native face's codes are glyphs from the
  character map; a glyph is its advance at the size, rounded to a scaled point; the space is the
  space glyph's advance, which XeTeX makes `\fontdimen2`, with half of it to stretch and a third
  to shrink, and a third more after a sentence, which is XeTeX's `\fontdimen3`, `4` and `7` of
  every native font, as an engine test prints them; and there are no ligatures or kerns. Its
  slant, which LaTeX's `\textit` and `\textbf` read to set an italic correction at a rich run's
  end (item 10), is XeTeX's `\fontdimen1`, the tangent of the file's italic angle, and a glyph's
  italic correction what its outline reaches past its advance, as XeTeX measures it; an engine
  test prints both. A rich field in a native font measures each variant the page sets in that
  variant's file; one the page does not set, in the letter font, since the TeX font names
  `namedVariants` reads give nothing for a file. The
  overlay's web font for a native font is the file itself, registered as it is under
  `rt-<file name>`, and its rows are placed with the file's own ascent and descent, its `hhea`
  table's, which macOS's and Linux's browsers read, where a TeX font's web font has 0.8 and 0.2;
  Windows reads the `OS/2` table's, which for the tree's fonts put a row's baseline within a
  hundredth of an em of the same place.
- **Nothing is re-emitted.** The invented template's sample, compiled from the dumped format and
  as a whole document from the stock `xelatex.fmt`, sets the same glyphs, runs and rules. The
  whole compile has four specials more, all written at the first shipout: hyperref's
  `pdf:majorversion 1` and `pdf:minorversion 5`, which is xdvipdfmx's own version, its
  `dvipdfmx:config C 0x0010`, which keeps named destinations nothing links to, and xcolor's
  `color push gray 0`, the black the PDF starts in anyway. The two PDFs are PDF 1.5 of the same
  size, text, links and colours; the whole compile's also has hyperref's `Doc-Start` and `page.1`
  destinations and one black more, which renders the same. As item 14 found for pdfTeX, the body
  re-emits nothing.
- **The PDF's text.** xdvipdfmx embeds a native font as a composite font with two-byte glyph codes
  and a ToUnicode map made from the character map and the ligatures, so the harness's PDF check
  reads such a font's strings through the map (`shownStrings`), with the curled single quotes the
  mapping sets read as the straight ones the text holds. The invented template passes the harness
  with no findings.

## Numbers

Measured in Node on an M4 Pro with a load average of about 4, other sessions running, on the tree
whose fontconfig scans no folder (decision 0011, layout 4):

| | |
|---|---|
| Dump the invented template's format | 420 to 450 ms, 8.5 MB, 43 files read |
| A new document's two passes | 108 to 114 ms, then 88 to 93 ms, 9 files and 1.2 MB read |
| The body, one pass, median of ten | 86 to 91 ms |
| The same template's whole document from the stock format | 150 to 156 ms a pass |
| xdvipdfmx on its XDV | 27 to 40 ms |
| Drawing its page, 559 glyphs from five font files | 27 ms reading and parsing the files, 2 ms after |

The files a new document reads are the fonts its body selects, which load then and not in the
format, and what LaTeX loads with them: `fonts.conf`, the `tex-text` mapping, a font definition
file and a backend file. On the tree before, whose `fonts.conf` had fontconfig scan the release's
own `fonts/opentype` and `fonts/type1` folders, the first compile read 565 files, 22 MB, which
the browser's worker reads one synchronous request at a time, and fontconfig scanned them again,
from memory, on every compile: the body took 284 to 312 ms, of which the scan was about 200, and
the XDV was the same byte for byte.

Decision 0003 measured 459 ms for Awesome-CV's body on the same loop, on a tree whose fontconfig
scanned the release's folders on every compile. The invented template's body is lighter than
Awesome-CV's (one page, no TikZ), so item 22 measures Awesome-CV again.

The overlay against XeTeX's lines, on the invented template in Roboto at 10.95 pt: a three-line
bullet none of whose words holds a pair Roboto kerns or joins breaks where XeTeX did, and each
row ends within 0.01 pt of its line; a three-line bullet of ordinary words breaks where XeTeX did
too, and its glyphs sit at most 0.96 pt, 0.14 pt on average over 211 glyphs, from the page's
within their rows, which is Roboto's kerning and ligatures, left to the page.

## Consequences

- Emboldened runs, a face after the first of a collection, and unicode-math stay as decision 0003
  left them: boxes for the first two, and a math symbol a template needs becomes a plain family
  at port time.
- The overlay does not shape: it measures `--` as two hyphens and `'` as a straight quote where
  XeTeX's `tex-text` mapping sets one dash and a curled quote, and leaves out kerns and ligatures,
  which is the drift above; decision 0004 accepts drift within a line, and a break it moves waits
  for the compile. Giving the breaker the font's shaping is a later step, as giving the TeX fonts'
  web fonts their kerns is.
- A glyph that `+smcp` or another single substitution makes has no text, so a field set in small
  capitals does not align. Awesome-CV sets its position line in Source Sans Pro's small capitals,
  so item 22 needs a family whose `sc` shape loads with `+smcp` while its other shapes do not, which
  one `features` string per family cannot say, and texts for the substituted glyphs: both are
  additions to this record.
- The fonts a package declares must be the tree's: XeTeX finds them through kpathsea, the page
  through the manifest, and a template cannot ship one, since a package's files are text.
- A package is refused for fonts only where the schema can tell. A file the tree does not have
  dumps, since the declarations load nothing, and fails the first compile that selects it, which
  the harness reports as the compile's error.
