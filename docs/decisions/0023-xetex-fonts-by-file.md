# 0023. XeTeX imports: fonts by file, features per shape

Date: 2026-09-27 · Status: proposed

## Context

Milestone 3 item 8. A resume written for XeTeX names its fonts through fontspec, by name or by
file, or through a font package that loads fontspec, and fontspec loads a native font as the
preamble runs, which a format cannot hold (decision 0003). The editor's loop declares every font
by file instead, as NFSS shapes in TU that load nothing until the body selects them (decision
0014). So an import must become a package whose `fonts` section declares, shape by shape, the
files and the features fontspec would have loaded, and whose preamble no longer loads fontspec,
and the result must set the reference's glyphs (decision 0019). Decision 0014 left two additions
for this: features per shape, so that `sc` loads its file with `+smcp` where the upright does not,
and a text for a glyph a single substitution makes, so that the page can read small capitals and
proportional figures. Decision 0015 gave both up in the Awesome-CV port for want of them.

## Decision

### The tree's fonts, from their own tables

`fetch-engine` reads every OpenType and TrueType file of the tree with opentype.js, the editor's
own reader, with its glyphs unread, and writes what each file's tables say into the manifest's
`fonts` table (`TreeFont`, `scripts/fonttable.ts`): its typographic family and style, its
four-style family and subfamily, its full and PostScript names, every other name its name table
gives on another platform or in another language, its `OS/2` weight and width, its italic, bold
and regular flags, its slant as a thousand times the tangent of its italic angle, and the scripts
and features of its GSUB and GPOS tables. The layout is 7. The table holds 289 files in 44
families; the manifest grows from 2.04 MB to 2.18 MB. `src/import/fonts.ts` answers from it
(`readTree(files, table)`), and the hand-written `TREE_FAMILIES` is gone: the survey's numbers
come out as they did.

### The rewrite

`rewriteForXetex(intake, tree)` (`src/import/xetex.ts`) reads the main file, and the classes,
packages and files of the upload it loads, where TeX would run them, and rewrites each fontspec
command it meets:

- `\setmainfont`, `\setsansfont` and `\setmonofont` set `\rmdefault`, `\sfdefault` or
  `\ttdefault` to the family, with the bold series fontspec sets beside it; `\newfontfamily` and
  its kin, and `\newfontface` and its kin, define their command with `\NewDocumentCommand` and
  the rest as fontspec does, to select the family; `\fontspec` in the body selects it where it
  stands; `\defaultfontfeatures` goes, and what it set is applied. A command that a definition,
  a `\let` or a test only names is left alone, and one inside a definition's body that asks for
  what cannot be reproduced becomes a `\PackageError` that stops the compile only if the
  definition is used, as XeTeX would.
- Each family is what fontspec 2.8a would declare (`src/import/fontspec.ts`), from the tree's
  table: a font by name is found as XeTeX 0.999995's font manager finds one, by full name, as
  `Family-Style`, by PostScript name, then as a family's regular face, and its bold and italic as
  XeTeX's `/B`, `/I` and `/BI` choose them, by weight and half the family's range, and by slant;
  the choice matched XeTeX's own on about 120 names of the tree's families. A font by file,
  through `Path`, `Extension` or a file's name, is the tree's file of that name, never the
  upload's copy. The shapes are fontspec's: `m/n`, `b/n`, `m/it`, `b/it`, the slanted as the
  italic, `bx` as `b`, and each face's small capitals, `sc` or `scit`, as its file with `+smcp`
  where the file has the feature, or `SmallCapsFont`'s.
- A shape's features are fontspec's: `script=latn;language=dflt`, or `DFLT` for a font without
  Latin, then `LetterSpace`, `FakeBold`, `FakeSlant` and `FakeStretch`, then the OpenType options,
  `Numbers`, `Letters`, `Ligatures` and the rest, each only where the font has the feature and
  each taking out what it clashes with, then `mapping=tex-text` and the colour. `Scale` is the
  declaration's scale, and `WordSpace`, `PunctuationSpace` and `HyphenChar` what the declaration
  does to the font as it loads it. Two requests that come to the same shapes share a family.
- The font packages that load fontspec on XeTeX and that the tree holds, roboto, sourcesanspro,
  lato, fontawesome, fontawesome5 and IBM Plex's three, each become a style file of the
  rewrite's own, `rt-<package>.sty`, loaded in their place, which does on XeTeX what the package
  does, with its families declared through the same emulation, and defines only the commands the
  document names. fontawesome5 reads its fonts' glyph names as it loads; its stand-in defines
  each icon from the package's own table, finds its glyph by name with `\XeTeXglyphindex`, in the
  style asked for, then Solid, then Brands, and sets it with `\XeTeXglyph`. academicons declares its font by file already, in its own `.fd`,
  and stays; Fira, Raleway and Open Sans are not in the tree, so their documents are refused
  before the rewrite.

The package the rewrite makes carries its families in `fonts`, extended additively:

- A shape is its file, as before, or `{ file, features }`, the features it loads with after its
  family's (`shapeFeatures`). A family may carry a `scale` and an `adjust` (`FontAdjust`: the
  word space's factors, the punctuation space and the hyphen character, numbers only).
  `fontDeclarations` writes `<->s*[<scale>]` before the name and the adjustment in the
  declaration's last argument, which NFSS runs once the font is loaded. A family's name may hold a
  hyphen, as fontspec's `NFSSFamily` gives one, and a shape may be any NFSS series and shape of
  lower-case letters. A package without these reads and generates as it did.

The preamble loses fontspec, the font packages and fontspec's commands, unicode-math and
`\setmathfont`, and keeps everything else byte for byte. It gains two style files of the
rewrite's own, where the brief named the lines themselves:

- `rt-preamble.sty` before the class: `\RequirePackage[OT1]{fontenc}`, so that nothing selects a
  native font before the dump, and a `selectfont` hook that gives each TFM font the preamble
  selects a quad of its size. XeTeX's LaTeX sets the preamble in TU's native fonts, whose quad is
  their size; cmr12's is 11.74982 pt at 12 pt, so every length a class sets in em as it loads,
  `\leftmargini`, `\labelsep` and `\parindent` among them, came out 2% short without it.
- `rt-fontspec.sty` at its end: TU as the encoding again, unless the document chose another; the
  hook taken off; and, where fontspec was loaded without `no-math` and without unicode-math,
  mathematics set up as fontspec sets it at `\begin{document}`.

### unicode-math

Mathematics stays in TeX's own fonts: the tree has one OpenType math font, and the page draws no
OpenType mathematics. unicode-math lets each of its symbols' commands be the symbol's character at
`\begin{document}`, so that one used in text sets that character in the text's font, as
Awesome-CV's `\cdotp` and `\bullet` do; `rt-fontspec.sty` gives each such command the document
names that meaning in text, from unicode-math's own table, and keeps LaTeX's in mathematics.
What differs then is unicode-math's alone: its math font's glyphs, and the axis and rule thickness
of that font, which place a centred table and an underline. The check tells that apart (below).

### The check

`checkRewrite` (`src/import/xetex-check.ts`) checks the rewrite as the body is checked. The whole
document, the rewritten preamble with the declarations and the editor's prelude, compiles from
the stock format with no font found by name, and must set the reference's glyph stream
(`sameGlyphs`), a native font compared by its file's name; then the preamble dumps as
`generateFormat` dumps a package's, and the body compiled from that format must set the same
glyphs again. A difference refuses the import, naming the first font whose glyphs differ, or
`layout` for a difference of pages, rules or specials. A difference that the rewrite compiled with
unicode-math kept does not have, that is, one in mathematics alone, is a warning.

Two changes to what the comparison sees. A colour special is compared by its text, not its
place, since unicode-math's axis moves the colour specials of a centred table by a few scaled
points where none of its glyphs moves. And a whole compile's first shipout, which a body compiled
from a format lacks, holds two more things `sameGlyphs` leaves out: xcolor's black in RGB and
CMYK, as a document whose colour model is one of those writes it, beside gray; and the white page
background `\pagecolor{white}` writes, as AltaCV's class has it (decision 0019).

What it refuses, naming it: a font the tree lacks; an option the emulation does not know;
`Scale=MatchLowercase`; a renderer other than OpenType; a script or language other than the
default; a mapping other than `tex-text`; a raw feature other than a plain `+tag` or `-tag`; a
value only TeX could read; `\addfontfeature`, `\newfontfeature` and the other commands that change
what fontspec's options mean; an `NFSSFamily` that is not a plain name or is taken; the packages
that need fontspec itself, polyglossia, xeCJK, mathspec and xltxtra among them; and glyphs that
come out otherwise.

### The page reads substituted glyphs

`src/page/native.ts` walks each font's GSUB lookups of type 1, and of type 7 wrapping type 1, for
`smcp`, `c2sc`, `pnum`, `lnum`, `onum`, `tnum`, `case`, `sups`, `subs` and `frac`
(`SINGLE_FEATURES`), and reads a glyph one of them makes as the glyph it was made from, a chain as
its start: Source Sans Pro's small capital a reads as a and A, Roboto's proportional one as 1. So
a position set in small capitals aligns with the lower case the resume holds. No other feature's
glyph gains a text.

The overlay measures such a field in the same file, as the glyphs the features make of the
characters (`NativeFontFile.substitute`, which applies the lookups of the Latin default language
in order, as XeTeX's shaping does), and its rows draw those glyphs: a browser applies no such
feature unasked, so the rows' `font-feature-settings` turn on the features of `SINGLE_FEATURES`
the shape loads with, each by the OpenType tag CSS takes as it is. Kerning and ligatures stay off,
as decision 0014 has them. The XDV names a native font's file and size, not its features, so a
file loaded two ways, as a family's upright and its small capitals load one, is told apart by the
glyphs the page sets in it: of the ways the package loads that file (`fontFeatures`), the one
whose substitutions make the most of those glyphs from the characters they read as.

## Numbers

`pnpm --filter @resume-tools/editor corpus fonts` over the corpus, four documents at a time on
this machine: every XeTeX document with a reference, and every pdfTeX document that guards on the
engine and loads a font package, compiled to a reference on XeTeX for this.

| | jake | awesome-cv | altacv | moderncv | europecv | other | all |
|---|--:|--:|--:|--:|--:|--:|--:|
| XeTeX, with a reference | 0 | 18 | 1 | 0 | 0 | 7 | 26 |
| pdfTeX guarded on the engine, with font packages | 1 | 0 | 14 | 1 | 0 | 1 | 17 |
| Rewritten, dumped, and matched the reference twice | 0 | 18 | 9 | 0 | 0 | 5 | 32 |
| ... with mathematics alone set otherwise | 0 | 4 | 0 | 0 | 0 | 1 | 5 |
| Refused: a font the tree lacks | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Refused: a feature or package | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| Refused: glyphs that come out otherwise | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| No reference on XeTeX | 1 | 0 | 5 | 1 | 0 | 1 | 8 |
| Dump, median (slowest) | | 557 ms (944) | 601 ms (949) | | | 398 ms (568) | 558 ms (949) |
| Format, median size | | 9.45 MB | 9.47 MB | | | 9.01 MB | 9.45 MB |
| Body from the format, median | | 243 ms | 420 ms | | | 231 ms | 253 ms |
| Whole document from the stock format, median | | 718 ms | 1161 ms | | | 588 ms | 729 ms |
| Reference compile, median | | 2776 ms | 2530 ms | | | 866 ms | 2756 ms |
| Families declared | 0 | 78 | 16 | 0 | 0 | 9 | 103 |
| Shapes declared | 0 | 850 | 146 | 0 | 0 | 105 | 1101 |

The families carry `mapping` 87 times, `smcp` 85, `pnum` 29 and `lnum` 29. The refusals are
`\addfontfeatures` once, `xltxtra` once, and one AltaCV fork whose body from the format sets its
first page lower than the whole document does, on two pages against one.

Of the 26 XeTeX documents with a reference, 24 rewrite and match, 5 of them with mathematics alone
set otherwise, and 2 are refused, for `\addfontfeatures` and `xltxtra`; every one of the 18
Awesome-CV forks rewrites and matches, 4 with mathematics alone set otherwise, the rest exactly. Of
the 17 pdfTeX documents taken on XeTeX, 8 have no reference there, 8 rewrite and match, and one is
the layout difference. The survey counts 65 XeTeX documents, of which 41 name no font the tree
lacks; the rest were refused before the rewrite, as decision 0019's table says.

Against item 19's bar, 5 s from file to page for a pdfTeX import: a XeTeX import compiles the
reference, a median of 2.8 s here, then the check, the whole document, the dump and the body from
the format, a median of 1.5 s more, 4.3 s in all at four documents at a time; the slowest, 12.9 s.
The body from the format takes a third of the whole compile's time, which is what every edit after
the import costs.

## Consequences

- The Awesome-CV port's Roboto families load roboto.sty's proportional lining figures,
  `+pnum;+lnum`, as upstream's did; the curated tests and the harness pass with them, and the
  contacts' digits are proportional. Its small capitals stay upright: the page reads them, but
  xdvipdfmx's ToUnicode gives Source Sans Pro's small capitals their capitals, so the PDF's text
  would show `SENIOR` where the resume holds `Senior`, and the harness's PDF check fails on every
  position. An import keeps its small capitals, since that is what its reference sets.
- A feature outside `SINGLE_FEATURES` that substitutes glyphs, a stylistic set among them, is
  declared as fontspec declares it, but its glyphs have no text: the check passes, and the fields
  set in them do not align until the page reads them too.
- The overlay's rows are set with the features the shape loads, from the package, so an
  imported package's fields are measured as XeTeX sets them. A font whose glyphs on the page do
  not tell two ways apart, as Roboto's small capitals where they set only digits, which `smcp`
  leaves as they are, takes the first way,
  which sets those glyphs alike but may measure a letter typed after them otherwise.
- The corpus's one layout difference, a body from the format that sets a page lower than the
  whole document does, is not explained; the check refuses it, which is safe.
- The manifest is larger by 0.14 MB, which a first load fetches once.
