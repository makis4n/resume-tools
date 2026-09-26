# 0018. What the corpus needs

Date: 2026-09-26 · Status: accepted

## Context

Milestone 3 item 2 surveys the corpus of decision 0017 before the import pipeline exists: what
the 220 documents ask of the engine and its TeX Live tree, and so what the pipeline will refuse.
Then it grows the tree from the answer, through decision 0011's mechanism, within a budget on the
tree's size, since the engine session mounts every file of the manifest when it starts. The
survey is `corpus survey`, in `apps/editor/scripts/corpus-survey.ts`; the tree is built by
`scripts/fetch-engine.ts`.

## Decision

### The survey reads source, and names no document's text

- It reads every document the last fetch marks fetched, each file checked against its size and
  SHA-256 again; a document not fetched, or whose file changed on disk, is counted apart. The tree
  is the engine manifest's file list alone: a class or package is there when a `.cls` or `.sty`
  of its name is under a `tex/` folder, a font file when an OpenType or TrueType file of its name
  is, whatever its extension or case, and a family when `TREE_FAMILIES`, a table written from the
  name tables of the tree's files, names it and the tree holds the file it names for it.
- For each document: its class and the classes its classes load, and every package its files
  load, each held by the document, by the tree, or by neither; its engine; how it loads fonts,
  through fontspec by a family's name, by a file's (a file name, `Path=` or `Extension=`), through
  font packages, or none of these; the families and files, and whether the tree has each; its
  definitions (`\newcommand` and its kin, `\def`, `\newenvironment`) in its main file and sources
  and in its classes and styles; what it needs that the engine lacks; and its size.
- It reads source as TeX would, without compiling, which is item 3's: comments, `\iffalse`
  blocks and `comment` environments are out; a conditional on the engine (`\ifxetex`, `\iftutex`,
  `\ifPDFTeX`, AltaCV's `\ifxetexorluatex` and `\ifdefined\XeTeXversion` among them) is read as each
  engine takes it; and a conditional that only a document class's `\DeclareOption` code sets takes
  the value the options the document passes give it, as TeX would, so that AltaCV's
  `academicons` option, which loads fontspec, counts only where it is passed. ifthen's and
  etoolbox's conditionals take their branches as arguments and are read whole.
- A document needs XeTeX when fontspec, polyglossia, xeCJK or another XeTeX package, academicons
  among them (it sets its icons in the TU encoding, which pdfTeX lacks), or a fontspec or XeTeX
  command appears where pdfTeX would read it; LuaTeX when a LuaTeX package, `\directlua` or
  `luacode` does where XeTeX would; pdfTeX otherwise; and either when it guards on the engine and
  its pdfTeX branches need nothing of the others'. What it needs is read on its engine's branches,
  pdfTeX's for either.
- It needs a bibliography tool for `\addbibresource`, `\bibliography`, `\printbibliography` or
  `\bibliographystyle`; shell escape for `\write18`, minted and their kin, or a comment asking
  for `-shell-escape`, which it counts apart; images for `\includegraphics` in its main file or
  sources, or images beside it, which the manifest counts; and a class, package or font that
  neither it nor the tree holds.
- It prints one Markdown table of documents, per family and in all, and `--json <file>` writes
  each document's row, by id. Both name classes, packages, fonts and counts, never a line of a
  document; the tests run on invented documents and check that an invented body's words reach
  neither. It takes half a second for the corpus.

### The survey on the tree of layout 4

|  | jake | awesome-cv | altacv | moderncv | europecv | other | all |
|---|--:|--:|--:|--:|--:|--:|--:|
| Documents surveyed | 50 | 40 | 20 | 30 | 10 | 70 | 220 |
| Skipped: not fetched, or changed on disk | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Engine: pdfTeX | 48 | 0 | 4 | 23 | 10 | 44 | 129 |
| Engine: XeTeX | 0 | 39 | 2 | 3 | 0 | 23 | 67 |
| Engine: LuaTeX | 0 | 1 | 0 | 1 | 0 | 0 | 2 |
| Engine: either, guarded on the engine | 2 | 0 | 14 | 3 | 0 | 3 | 22 |
| Fonts: fontspec, by name | 0 | 10 | 13 | 1 | 0 | 17 | 41 |
| Fonts: fontspec, by file | 0 | 23 | 0 | 1 | 0 | 8 | 32 |
| Fonts: font packages | 46 | 39 | 20 | 10 | 4 | 42 | 161 |
| Fonts: none loaded | 4 | 0 | 0 | 18 | 6 | 20 | 48 |
| Needs a class the tree lacks | 0 | 0 | 0 | 0 | 0 | 3 | 3 |
| Needs a package the tree lacks | 8 | 12 | 17 | 6 | 2 | 28 | 73 |
| Needs a font the tree lacks | 0 | 20 | 0 | 2 | 0 | 19 | 41 |
| Needs LuaTeX | 0 | 1 | 0 | 1 | 0 | 0 | 2 |
| Needs biber or bibtex | 1 | 3 | 8 | 3 | 4 | 11 | 30 |
| Needs shell escape | 0 | 0 | 5 | 0 | 0 | 0 | 5 |
| Needs shell escape only by a comment's hint | 0 | 0 | 5 | 0 | 0 | 0 | 5 |
| Has images: calls `\includegraphics` or has image files beside it | 29 | 31 | 14 | 21 | 9 | 43 | 147 |
| Calls `\includegraphics` in its main file or sources | 1 | 0 | 0 | 3 | 4 | 8 | 16 |
| **Packages the tree lacks, top 25** |  |  |  |  |  |  |  |
| `biblatex` | 1 | 3 | 11 | 1 | 0 | 6 | 22 |
| `fontawesome` | 0 | 4 | 7 | 1 | 0 | 5 | 17 |
| `ulem` | 2 | 1 | 0 | 1 | 0 | 4 | 8 |
| `simpleicons` | 0 | 0 | 6 | 0 | 0 | 0 | 6 |
| `academicons` | 0 | 1 | 2 | 0 | 0 | 1 | 4 |
| `fontawesome6` | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| `soul` | 1 | 0 | 0 | 0 | 0 | 3 | 4 |
| `ctex` | 0 | 2 | 0 | 1 | 0 | 0 | 3 |
| `raleway` | 0 | 0 | 0 | 0 | 0 | 3 | 3 |
| `xeCJK` | 0 | 1 | 0 | 0 | 0 | 2 | 3 |
| `FiraMono` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `beramono` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| `carlito` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `l3regex` | 0 | 0 | 0 | 2 | 0 | 0 | 2 |
| `nth` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| `plex-sans` | 0 | 0 | 0 | 0 | 2 | 0 | 2 |
| `smartdiagram` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| `tgheros` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `CormorantGaramond` | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| `DejaVuSansMono` | 0 | 0 | 0 | 1 | 0 | 0 | 1 |
| `MinionPro` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `MnSymbol` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `bbding` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `droidsans` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `ebgaramond` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| **Fonts the tree lacks, top 25** |  |  |  |  |  |  |  |
| `FontAwesome` | 0 | 17 | 0 | 0 | 0 | 1 | 18 |
| `SourceSansPro-It` | 0 | 6 | 0 | 0 | 0 | 0 | 6 |
| `Minion Pro` | 0 | 0 | 0 | 1 | 0 | 3 | 4 |
| `TeX Gyre Termes` | 0 | 0 | 0 | 0 | 0 | 4 | 4 |
| `Minion Pro Medium` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| `Monaco` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| `Myriad Pro` | 0 | 0 | 0 | 1 | 0 | 1 | 2 |
| `Source Sans 3` | 0 | 2 | 0 | 0 | 0 | 0 | 2 |
| `Source Sans 3 Bold` | 0 | 2 | 0 | 0 | 0 | 0 | 2 |
| `Source Sans 3 Bold Italic` | 0 | 2 | 0 | 0 | 0 | 0 | 2 |
| `Source Sans 3 Italic` | 0 | 2 | 0 | 0 | 0 | 0 | 2 |
| `TeX Gyre Heros` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| `Adobe Caslon Pro` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `AdobeFangsongStd-Regular.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `AdobeHeitiStd-Regular.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `AdobeKaitiStd-Regular.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `AdobeSongStd-Light.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `ArchivoNarrow-Bold.ttf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `ArchivoNarrow-Regular.ttf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `Avenir Next` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `Avenir Next LT Pro Demi` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `Avenir Next LT Pro Italic` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `Avenir Next LT Pro Regular` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `Fira Sans` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| `Fontin-SmallCaps.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| **Classes, top 10** |  |  |  |  |  |  |  |
| `article` | 48 | 0 | 0 | 0 | 0 | 41 | 89 |
| `awesome-cv` | 0 | 40 | 0 | 0 | 0 | 0 | 40 |
| `moderncv` | 0 | 0 | 0 | 30 | 0 | 0 | 30 |
| `altacv` | 0 | 0 | 20 | 0 | 0 | 0 | 20 |
| `europecv` | 0 | 0 | 0 | 0 | 10 | 0 | 10 |
| `resume` | 0 | 0 | 0 | 0 | 0 | 7 | 7 |
| `res` | 0 | 0 | 0 | 0 | 0 | 3 | 3 |
| `cv` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| `extarticle` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `yaac-another-awesome-cv` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |

### What the tree takes

The rule: every package that three documents or more need, as the survey's missing classes,
packages and font files and families map to TeX Live 2023's packages, the most needed first,
until the containers added reach 80 MB; never documentation or source containers, binaries,
LuaTeX-only packages or a newer TeX Live (decision 0011). `WANTED` names ten more, `--resolve`
adds logreq, which biblatex depends on, and `LAYOUT` is 5:

| Package | Documents | Container | Files in the tree | On disk |
|---|--:|--:|--:|--:|
| fontawesome r48145, Font Awesome 4: its package and `FontAwesome.otf` | 34 | 0.28 MB | 16 | 0.45 MB |
| biblatex r66403, with logreq r53003 | 22 | 0.26 MB | 119 | 2.26 MB |
| tex-gyre r68624 | 10 | 7.75 MB | 813 | 25.4 MB |
| ulem r53365 | 8 | 7 KB | 1 | 16 KB |
| simpleicons r70519 | 6 | 3.43 MB | 42 | 5.3 MB |
| academicons r62622 | 4 | 35 KB | 3 | 83 KB |
| soul r67365 | 4 | 9 KB | 3 | 43 KB |
| fira r64422 | 3 | 15.53 MB | 2,168 | 53.3 MB |
| plex r69154 | 3 | 11.53 MB | 1,602 | 27.7 MB |
| raleway r42629 | 3 | 2.34 MB | 745 | 11.1 MB |

That is 41.2 MB of containers, 86.1 MB with decision 0011's. Their style files, read as 0011
read its packages', load nothing the tree lacks, and ask fontenc for T1, LY1 and OT1 only; fira's
and plex's Greek, like Roboto's, is theirs only through an LGR encoding no default asks for. The
bundles held none of their files. Font Awesome 4's 34 documents are the 17 that load its package,
AltaCV's forks among them, and the 18, 17 of them Awesome-CV forks, whose class loads
`FontAwesome` by file from a fonts folder of their own, which a package cannot ship (decision
0014).

### What stays out, and why

- ctex and xeCJK, 3 documents each, for size and LuaTeX: the database makes xecjk depend on ctex,
  and ctex brings 43 packages and 86.2 MB of containers, the Arphic, Fandol and Wadalab fonts and
  LuaTeX's luatexja among them, more than the budget alone; and two of the six name Adobe's or
  Noto's CJK fonts, which the archive does not have either.
- Not in the archive: fontawesome6 (4 documents), which TeX Live 2023 does not have; Source Sans
  3 (3), whose package came later; commercial and system fonts, Minion Pro, Myriad Pro, Monaco,
  Helvetica Neue, Avenir Next, Adobe Caslon Pro, Hoefler Text, Optima, Verdana, Gilroy, SF Pro,
  PragmataPro and Adobe's CJK fonts among them (13 documents); l3regex (2), which expl3 absorbed;
  and fmtprefix and xetex-inputenc, which fmtcount and luainputenc, in the tree, ask for.
- Fewer than three documents: Montserrat (2, 13.2 MB), Carlito, Bera, nth and smartdiagram (2
  each), and 19 packages one document needs, EB Garamond, Libertine and DejaVu among them. Open
  Sans, Source Serif Pro, Source Code Pro and Noto (26.6 MB) no document names.
- Not a package at all: `SourceSansPro-It`, which 6 Awesome-CV forks load by file, is Adobe's
  older name for the face the tree has as `SourceSansPro-RegularIt.otf`; item 8 matches files to
  the tree by family and shape, not by name.
- LuaTeX, which 2 documents need (a moderncv document's `\directlua` and an Awesome-CV fork's
  emoji package): the milestone leaves LuaTeX templates out.

### In CI, never on a pull request

`.github/workflows/corpus.yml` runs nightly and on demand, on ubuntu-latest, with editor.yml's
cache key for `.engine/`: `corpus fetch`, with the workflow's own token, then `corpus survey
--json survey.json`, whose table goes to the job's summary and whose rows to an artifact. The
fetch now takes a token from `GH_TOKEN` or `GITHUB_TOKEN` when gh has none, and `.env.example`
lists both. No pull request downloads a resume, and item 17 adds the runner to the same workflow.

## Consequences

- The tree grows from 25,835 files and 428.9 MB to 31,347 files and 554.9 MB: fira's 2,168 files
  and plex's 1,602 are most of it, each weight, figure style and encoding's metrics and virtual
  fonts, as 0011 found for Roboto. It holds 335 OpenType and TrueType files, 146 more, in 19 more
  families, which `TREE_FAMILIES` names; a test checks that every folder of such files in the tree
  has a family there, so a package that adds fonts without the table fails CI. A first build
  downloads about 300 MB, 41 MB more.
- The manifest grows from 1.83 MB to 2.26 MB (128 KB to 150 KB with Brotli), and `pdftex.map`,
  which the page reads before it draws, from 489 KB to 803 KB (25 KB to 40 KB), with the maps of
  Font Awesome 4, Simple Icons, TeX Gyre, Fira, Plex and Raleway.
- The engine starts later, since the session mounts every file of the manifest: in Node on the
  M4 Pro, sessions started from each manifest in turn at a load of about 2.3 took 3.2 to 3.4 s on
  layout 4's and 3.9 to 4.1 s on layout 5's, three quarters of a second more for a fifth more
  files. A first compile of a one-line article from the stock formats is unchanged, about 130 ms
  on pdfTeX and 160 ms on XeTeX. Dropping fira and plex, 6 documents between them, would take
  3,770 of the new files back out; the slow laptop's start, which decision 0016 leaves to the
  owner, says whether to.
- The full test suite passes on the new tree: the curated templates' round trips, the harness's
  eleven checks over each curated package, and the fonts check of decision 0014, which finds every
  file the three packages name.
- What items 3 and 8 can expect. On layout 4, 118 documents named nothing the tree lacked and
  needed no LuaTeX; on layout 5, 167 do. The other 53, other 28, awesome-cv 13, moderncv 8, jake 3
  and altacv 1, lack a class (3), a package (30) or a font (25), or need LuaTeX (2), and item 3
  should expect to refuse them, naming what is missing, and to find more that source cannot show:
  a package a tree class loads that the tree lacks, a font chosen by its NFSS code. 30 documents
  use biber or bibtex, which the engine lacks, 23 of them lacking nothing else: with biblatex in
  the tree they should compile with their bibliography empty, which item 13 names as dropped. 147
  have images to drop at intake, 16 of them through `\includegraphics` in their own source; the
  rest have images beside them, a photo or a preview, and some show them through their class. For
  item 8: 67 documents need XeTeX, and 22 either, whose pdfTeX branches need nothing of XeTeX's;
  50 of the 67 load fonts through fontspec, and the family table covers every font of 25 of them,
  where it covered 10 on layout 4; 42 of the 67 name no font the tree lacks. The rest name
  commercial fonts, Source Sans 3, or Source Sans Pro's italic by its older file name, which item
  8 maps by family and shape.
- The survey reads what source says, so its engine and needs are the source's: a conditional set
  anywhere but a class's options is read both ways, a class's photo macro is not an
  `\includegraphics` of the document's, and 5 AltaCV documents ask for shell escape only in a
  comment, which the table counts apart. Item 3's compile is the judge.
- The rule is written down, so the next survey grows the tree the same way: a package three
  documents need, within the budget. `corpus survey` in CI reruns the table every night against
  whatever tree the cache holds.
