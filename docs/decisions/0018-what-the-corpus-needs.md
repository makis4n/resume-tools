# 0018. What the corpus needs

Date: 2026-09-26 · Status: accepted

## Context

Milestone 3 item 2 surveys the corpus of decision 0017 before the import pipeline exists: what
the 220 documents ask of the engine and its TeX Live tree, and so what the pipeline will refuse.
Then it grows the tree from the answer, through decision 0011's mechanism, within a budget on the
tree's size, since the engine session mounts every file of the manifest when it starts. The
survey is `corpus survey`, in `apps/editor/scripts/corpus-survey.ts`; the tree is built by
`scripts/fetch-engine.ts`. The review of this item found the survey misreading three kinds of
source, which changed what the tree took, and open to hostile documents in four ways; the
survey, the tables and the tree here are the corrected ones.

## Decision

### The survey reads source, and names no document's text

- It reads every document the last fetch marks fetched, each file checked against its size and
  SHA-256 again; a document not fetched, or whose file changed on disk, is counted apart. The tree
  is the engine manifest's file list alone: a class or package is there when a `.cls` or `.sty`
  of its name is under a `tex/` folder, a font file when an OpenType or TrueType file of its name
  is, whatever its extension or case, and a family when `TREE_FAMILIES`, a table written from the
  name tables of the tree's files, names it and the tree holds the file it names for it.
  `--tree <file>` checks the documents against another engine manifest's file list instead of
  `.engine/`'s; the two tables below come from the same code, layout 4's from a checkout of main.
- For each document: its class and the classes its classes load, and every package its files
  load, each held by the document, by the tree, or by neither, and those it loads only if present;
  its engine; how it loads fonts, through fontspec by a family's name, by a file's (a file name,
  `Path=` or `Extension=`), through font packages, or none of these; the families and files, and
  whether the tree has each; its definitions (`\newcommand` and its kin, `\def`,
  `\newenvironment`) in its main file and sources and in its classes and styles; what it needs
  that the engine lacks; and its size.
- It reads source as TeX would, without compiling, which is item 3's: comments, `\iffalse`
  blocks and `comment` environments are out; a conditional on the engine (`\ifxetex`, `\iftutex`,
  `\ifPDFTeX`, AltaCV's `\ifxetexorluatex` and `\ifdefined\XeTeXversion` among them) is read as each
  engine takes it; and so is an `\ifnum` or `\ifcase` whose numbers hold one, as pandoc's
  templates ask `\ifnum 0\ifxetex 1\fi\ifluatex 1\fi=0`: each engine conditional in the numbers is
  reduced to the branch the engine takes, `\ifxetex 1\fi` to `1` on XeTeX and to nothing on
  pdfTeX, the integers and the relation are read from what is left, and each engine's view keeps
  the branch it takes, an `\ifcase`'s case or its `\else`. A test that holds anything else, a
  register or a macro, is read both ways. A conditional that only a document class's
  `\DeclareOption` code sets takes the value the options the document passes give it, as TeX
  would, so that AltaCV's `academicons` option, which loads fontspec, counts only where it is
  passed. ifthen's and etoolbox's conditionals take their branches as arguments and are read
  whole, `\ifdef{\faOrcid}{}{...}` among them.
- A conditional passed as an argument opens none: one that is a group's whole content, as
  `\ifundef{\iftutex}` passes it, but for TeX's own, since `{\iffalse}\fi` balances a brace; the
  command `\ifdefined` asks after and the two `\ifx` compares; and one in a name `\csname` builds.
  The current AltaCV class, which six documents ship, has `\ifundef{\iftutex}{\newif\iftutex}{}`;
  read as a conditional, it never closed, and the pdfTeX view lost the rest of the class. A
  conditional that starts a group but is not all of it, as in a macro's body, is one, as nine in
  the corpus are.
- A package loaded in the second argument of `\IfFileExists`, the code TeX runs when the file it
  asks after is there, is loaded only if present: TeX loads it only when the tree or the document
  has it, so one the tree lacks is no need, and one the tree has counts for the engine as any load
  does. Each row lists them as `optional`, and the table counts the documents that load a package
  the tree lacks that way in a column of its own, "loaded only if present"; the packages section
  ranks a package by the documents that need it and those that load it only if present. Six
  AltaCV documents load simpleicons that way, an AltaCV fork biblatex, and a document made from
  pandoc's template five packages the tree has.
- A document needs XeTeX when fontspec, polyglossia, xeCJK or another XeTeX package, academicons
  among them (it sets its icons in the TU encoding, which pdfTeX lacks), or a fontspec or XeTeX
  command appears where pdfTeX would read it; LuaTeX when a LuaTeX package, `\directlua` or
  `luacode` does where XeTeX would; pdfTeX otherwise; and either when it guards on the engine and
  its pdfTeX branches need nothing of the others'. What it needs is read on its engine's branches,
  pdfTeX's for either. It lacks nothing when it needs no class, package or font the tree lacks,
  and not LuaTeX, which the table counts in a row of its own.
- It needs a bibliography tool for `\addbibresource`, `\bibliography`, `\printbibliography` or
  `\bibliographystyle`; shell escape for `\write18`, minted and their kin, or a comment asking
  for `-shell-escape`, which it counts apart; images for `\includegraphics` in its main file or
  sources, or images beside it, which the manifest counts; and a class, package or font that
  neither it nor the tree holds.
- It prints one Markdown table of documents, per family and in all, and `--json <file>` writes
  each document's row, by id. Both name classes, packages, fonts and counts, never a line of a
  document: a name is printed and written only when it is letters, digits, spaces and `._/+-`, 64
  characters at most, and is `(unprintable name)` otherwise, counted all the same, so that no line
  break or Markdown a hostile source puts in a name reaches the table, the job's summary or the
  JSON; one document's class, an absolute path longer than that, is shown so. Each line of the
  table goes through `printable`. The tests run on invented documents and check that an invented
  body's words reach neither. It takes under a second for the corpus.
- It takes time linear in what it reads, however a hostile document is laid out: the style words
  after a family's name are read in one pass, and a name of more than 128 characters is no
  family's; a font command's options are read from four bracketed groups at most, and a face
  whose name, each `*` in it the font's name, would pass 128 characters is dropped; a class's
  options run once each, however often `\ExecuteOptions` names them; and the walk keeps count of
  the conditionals whose dead branch it is in. Before, a font name of 40 digits took hours, 16 KB
  of face options made a name of 64 million characters, and a class of 150 KB took over two
  minutes, its time growing as the cube of its options, past the nightly job's 30 minutes at
  400 KB.

### The survey on the tree of layout 4

|  | jake | awesome-cv | altacv | moderncv | europecv | other | all | loaded only if present |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Documents surveyed | 50 | 40 | 20 | 30 | 10 | 70 | 220 |  |
| Skipped: not fetched, or changed on disk | 0 | 0 | 0 | 0 | 0 | 0 | 0 |  |
| Engine: pdfTeX | 48 | 0 | 4 | 23 | 10 | 44 | 129 |  |
| Engine: XeTeX | 0 | 39 | 2 | 3 | 0 | 22 | 66 |  |
| Engine: LuaTeX | 0 | 1 | 0 | 1 | 0 | 0 | 2 |  |
| Engine: either, guarded on the engine | 2 | 0 | 14 | 3 | 0 | 4 | 23 |  |
| Fonts: fontspec, by name | 0 | 10 | 13 | 1 | 0 | 17 | 41 |  |
| Fonts: fontspec, by file | 0 | 23 | 0 | 1 | 0 | 8 | 32 |  |
| Fonts: font packages | 46 | 39 | 20 | 10 | 4 | 42 | 161 |  |
| Fonts: none loaded | 4 | 0 | 0 | 18 | 6 | 20 | 48 |  |
| Needs a class the tree lacks | 0 | 0 | 0 | 0 | 0 | 3 | 3 |  |
| Needs a package the tree lacks | 8 | 12 | 14 | 6 | 2 | 28 | 70 |  |
| Needs a font the tree lacks | 0 | 20 | 0 | 2 | 0 | 18 | 40 |  |
| Needs LuaTeX | 0 | 1 | 0 | 1 | 0 | 0 | 2 |  |
| Lacks nothing: no class, package or font the tree lacks, nor LuaTeX | 42 | 14 | 6 | 21 | 8 | 30 | 121 |  |
| Needs biber or bibtex | 1 | 3 | 8 | 3 | 4 | 11 | 30 |  |
| Needs shell escape | 0 | 0 | 5 | 0 | 0 | 0 | 5 |  |
| Needs shell escape only by a comment's hint | 0 | 0 | 5 | 0 | 0 | 0 | 5 |  |
| Has images: calls `\includegraphics` or has image files beside it | 29 | 31 | 14 | 21 | 9 | 43 | 147 |  |
| Calls `\includegraphics` in its main file or sources | 1 | 0 | 0 | 3 | 4 | 8 | 16 |  |
| **Packages the tree lacks, top 25** |  |  |  |  |  |  |  |  |
| `biblatex` | 1 | 3 | 10 | 1 | 0 | 6 | 21 | 1 |
| `fontawesome` | 0 | 4 | 7 | 1 | 0 | 5 | 17 | 0 |
| `ulem` | 2 | 1 | 0 | 1 | 0 | 4 | 8 | 0 |
| `simpleicons` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| `academicons` | 0 | 1 | 2 | 0 | 0 | 1 | 4 | 0 |
| `fontawesome6` | 0 | 4 | 0 | 0 | 0 | 0 | 4 | 0 |
| `soul` | 1 | 0 | 0 | 0 | 0 | 3 | 4 | 0 |
| `ctex` | 0 | 2 | 0 | 1 | 0 | 0 | 3 | 0 |
| `raleway` | 0 | 0 | 0 | 0 | 0 | 3 | 3 | 0 |
| `xeCJK` | 0 | 1 | 0 | 0 | 0 | 2 | 3 | 0 |
| `FiraMono` | 1 | 0 | 0 | 0 | 0 | 1 | 2 | 0 |
| `beramono` | 0 | 0 | 0 | 0 | 0 | 2 | 2 | 0 |
| `carlito` | 1 | 0 | 0 | 0 | 0 | 1 | 2 | 0 |
| `l3regex` | 0 | 0 | 0 | 2 | 0 | 0 | 2 | 0 |
| `nth` | 0 | 0 | 0 | 0 | 0 | 2 | 2 | 0 |
| `plex-sans` | 0 | 0 | 0 | 0 | 2 | 0 | 2 | 0 |
| `smartdiagram` | 0 | 0 | 0 | 0 | 0 | 2 | 2 | 0 |
| `tgheros` | 1 | 0 | 0 | 0 | 0 | 1 | 2 | 0 |
| `CormorantGaramond` | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| `DejaVuSansMono` | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| `MinionPro` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `MnSymbol` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `bbding` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `droidsans` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `ebgaramond` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| **Fonts the tree lacks, top 25** |  |  |  |  |  |  |  |  |
| `FontAwesome` | 0 | 17 | 0 | 0 | 0 | 1 | 18 |  |
| `SourceSansPro-It` | 0 | 6 | 0 | 0 | 0 | 0 | 6 |  |
| `Minion Pro` | 0 | 0 | 0 | 1 | 0 | 3 | 4 |  |
| `TeX Gyre Termes` | 0 | 0 | 0 | 0 | 0 | 4 | 4 |  |
| `Minion Pro Medium` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |  |
| `Monaco` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |  |
| `Myriad Pro` | 0 | 0 | 0 | 1 | 0 | 1 | 2 |  |
| `Source Sans 3` | 0 | 2 | 0 | 0 | 0 | 0 | 2 |  |
| `Source Sans 3 Bold` | 0 | 2 | 0 | 0 | 0 | 0 | 2 |  |
| `Source Sans 3 Bold Italic` | 0 | 2 | 0 | 0 | 0 | 0 | 2 |  |
| `Source Sans 3 Italic` | 0 | 2 | 0 | 0 | 0 | 0 | 2 |  |
| `TeX Gyre Heros` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |  |
| `Adobe Caslon Pro` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `AdobeFangsongStd-Regular.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `AdobeHeitiStd-Regular.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `AdobeKaitiStd-Regular.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `AdobeSongStd-Light.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `ArchivoNarrow-Bold.ttf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `ArchivoNarrow-Regular.ttf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `Avenir Next` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `Avenir Next LT Pro Demi` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `Avenir Next LT Pro Italic` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `Avenir Next LT Pro Regular` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `Fontin-SmallCaps.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `Gilroy-Bold` | 0 | 1 | 0 | 0 | 0 | 0 | 1 |  |
| **Classes, top 10** |  |  |  |  |  |  |  |  |
| `article` | 48 | 0 | 0 | 0 | 0 | 41 | 89 |  |
| `awesome-cv` | 0 | 40 | 0 | 0 | 0 | 0 | 40 |  |
| `moderncv` | 0 | 0 | 0 | 30 | 0 | 0 | 30 |  |
| `altacv` | 0 | 0 | 20 | 0 | 0 | 0 | 20 |  |
| `europecv` | 0 | 0 | 0 | 0 | 10 | 0 | 10 |  |
| `resume` | 0 | 0 | 0 | 0 | 0 | 7 | 7 |  |
| `res` | 0 | 0 | 0 | 0 | 0 | 3 | 3 |  |
| `cv` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |  |
| `extarticle` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |  |
| `yaac-another-awesome-cv` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |  |

### The survey on the tree of layout 5

|  | jake | awesome-cv | altacv | moderncv | europecv | other | all | loaded only if present |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Documents surveyed | 50 | 40 | 20 | 30 | 10 | 70 | 220 |  |
| Skipped: not fetched, or changed on disk | 0 | 0 | 0 | 0 | 0 | 0 | 0 |  |
| Engine: pdfTeX | 48 | 0 | 4 | 23 | 10 | 44 | 129 |  |
| Engine: XeTeX | 0 | 39 | 2 | 3 | 0 | 22 | 66 |  |
| Engine: LuaTeX | 0 | 1 | 0 | 1 | 0 | 0 | 2 |  |
| Engine: either, guarded on the engine | 2 | 0 | 14 | 3 | 0 | 4 | 23 |  |
| Fonts: fontspec, by name | 0 | 10 | 13 | 1 | 0 | 17 | 41 |  |
| Fonts: fontspec, by file | 0 | 23 | 0 | 1 | 0 | 8 | 32 |  |
| Fonts: font packages | 46 | 39 | 20 | 10 | 4 | 42 | 161 |  |
| Fonts: none loaded | 4 | 0 | 0 | 18 | 6 | 20 | 48 |  |
| Needs a class the tree lacks | 0 | 0 | 0 | 0 | 0 | 3 | 3 |  |
| Needs a package the tree lacks | 4 | 6 | 1 | 5 | 0 | 16 | 32 |  |
| Needs a font the tree lacks | 0 | 9 | 0 | 2 | 0 | 13 | 24 |  |
| Needs LuaTeX | 0 | 1 | 0 | 1 | 0 | 0 | 2 |  |
| Lacks nothing: no class, package or font the tree lacks, nor LuaTeX | 46 | 27 | 19 | 22 | 10 | 42 | 166 |  |
| Needs biber or bibtex | 1 | 3 | 8 | 3 | 4 | 11 | 30 |  |
| Needs shell escape | 0 | 0 | 5 | 0 | 0 | 0 | 5 |  |
| Needs shell escape only by a comment's hint | 0 | 0 | 5 | 0 | 0 | 0 | 5 |  |
| Has images: calls `\includegraphics` or has image files beside it | 29 | 31 | 14 | 21 | 9 | 43 | 147 |  |
| Calls `\includegraphics` in its main file or sources | 1 | 0 | 0 | 3 | 4 | 8 | 16 |  |
| **Packages the tree lacks, top 25** |  |  |  |  |  |  |  |  |
| `simpleicons` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| `fontawesome6` | 0 | 4 | 0 | 0 | 0 | 0 | 4 | 0 |
| `ctex` | 0 | 2 | 0 | 1 | 0 | 0 | 3 | 0 |
| `raleway` | 0 | 0 | 0 | 0 | 0 | 3 | 3 | 0 |
| `xeCJK` | 0 | 1 | 0 | 0 | 0 | 2 | 3 | 0 |
| `FiraMono` | 1 | 0 | 0 | 0 | 0 | 1 | 2 | 0 |
| `beramono` | 0 | 0 | 0 | 0 | 0 | 2 | 2 | 0 |
| `carlito` | 1 | 0 | 0 | 0 | 0 | 1 | 2 | 0 |
| `l3regex` | 0 | 0 | 0 | 2 | 0 | 0 | 2 | 0 |
| `nth` | 0 | 0 | 0 | 0 | 0 | 2 | 2 | 0 |
| `smartdiagram` | 0 | 0 | 0 | 0 | 0 | 2 | 2 | 0 |
| `CormorantGaramond` | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| `DejaVuSansMono` | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| `MinionPro` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `MnSymbol` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `bbding` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `droidsans` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `ebgaramond` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `eulervm` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `ifsym` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `libertine` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `libertinus` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `libertinus-otf` | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| `libertinust1math` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| `mathdesign` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| **Fonts the tree lacks, top 25** |  |  |  |  |  |  |  |  |
| `SourceSansPro-It` | 0 | 6 | 0 | 0 | 0 | 0 | 6 |  |
| `Minion Pro` | 0 | 0 | 0 | 1 | 0 | 3 | 4 |  |
| `Minion Pro Medium` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |  |
| `Monaco` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |  |
| `Myriad Pro` | 0 | 0 | 0 | 1 | 0 | 1 | 2 |  |
| `Source Sans 3` | 0 | 2 | 0 | 0 | 0 | 0 | 2 |  |
| `Source Sans 3 Bold` | 0 | 2 | 0 | 0 | 0 | 0 | 2 |  |
| `Source Sans 3 Bold Italic` | 0 | 2 | 0 | 0 | 0 | 0 | 2 |  |
| `Source Sans 3 Italic` | 0 | 2 | 0 | 0 | 0 | 0 | 2 |  |
| `Adobe Caslon Pro` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `AdobeFangsongStd-Regular.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `AdobeHeitiStd-Regular.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `AdobeKaitiStd-Regular.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `AdobeSongStd-Light.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `ArchivoNarrow-Bold.ttf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `ArchivoNarrow-Regular.ttf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `Avenir Next` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `Avenir Next LT Pro Demi` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `Avenir Next LT Pro Italic` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `Avenir Next LT Pro Regular` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `Fontin-SmallCaps.otf` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |
| `Gilroy-Bold` | 0 | 1 | 0 | 0 | 0 | 0 | 1 |  |
| `Gilroy-BoldItalic` | 0 | 1 | 0 | 0 | 0 | 0 | 1 |  |
| `Gilroy-Italic` | 0 | 1 | 0 | 0 | 0 | 0 | 1 |  |
| `Gilroy-Light` | 0 | 1 | 0 | 0 | 0 | 0 | 1 |  |
| **Classes, top 10** |  |  |  |  |  |  |  |  |
| `article` | 48 | 0 | 0 | 0 | 0 | 41 | 89 |  |
| `awesome-cv` | 0 | 40 | 0 | 0 | 0 | 0 | 40 |  |
| `moderncv` | 0 | 0 | 0 | 30 | 0 | 0 | 30 |  |
| `altacv` | 0 | 0 | 20 | 0 | 0 | 0 | 20 |  |
| `europecv` | 0 | 0 | 0 | 0 | 10 | 0 | 10 |  |
| `resume` | 0 | 0 | 0 | 0 | 0 | 7 | 7 |  |
| `res` | 0 | 0 | 0 | 0 | 0 | 3 | 3 |  |
| `cv` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |  |
| `extarticle` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |  |
| `yaac-another-awesome-cv` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |  |

### What the tree takes

The rule: every package that three documents or more need, as the survey's missing classes,
packages and font files and families map to TeX Live 2023's packages, the most needed first,
until the containers added reach 80 MB; and of those, only one that makes a document importable,
that at least one of the documents that need it lacks nothing once everything taken is in. What
lacks nothing with a set taken was worked out on the tree of layout 4 with the set's run files
from the archive's database added, dropping a package that made no document lack nothing until
none was left, and checked on the rebuilt tree. A bibliography, shell escape and images do not
count against a document, since item 3 drops them. Never documentation or source containers,
binaries, LuaTeX-only packages or a newer TeX Live (decision 0011). `WANTED` names seven more,
`--resolve` adds logreq, which biblatex depends on, and `LAYOUT` is 5:

| Package | Need it | Lack nothing with it | Container | Files in the tree | On disk |
|---|--:|--:|--:|--:|--:|
| fontawesome r48145, Font Awesome 4: its package and `FontAwesome.otf` | 34 | 23 | 0.28 MB | 16 | 0.45 MB |
| biblatex r66403, with logreq r53003 | 21 | 15 | 0.26 MB | 119 | 2.26 MB |
| tex-gyre r68624 | 10 | 7 | 7.75 MB | 813 | 25.4 MB |
| ulem r53365 | 8 | 3 | 7 KB | 1 | 16 KB |
| academicons r62622 | 4 | 2 | 35 KB | 3 | 83 KB |
| soul r67365 | 4 | 2 | 9 KB | 3 | 43 KB |
| plex r69154 | 3 | 2 | 11.53 MB | 1,602 | 27.7 MB |

"Need it" counts the documents that need the package on layout 4, "Lack nothing with it" those of
them that lack nothing on layout 5: 45 documents in all, each needing one or more of the seven.
Of them fontawesome alone makes 15 importable, biblatex 9, tex-gyre 6, ulem, soul and plex 2
each, and academicons 1; the rest need two or more of the seven. That is 19.9 MB of containers,
64.8 MB with decision 0011's. Their style files, read as 0011 read its packages', load nothing
the tree lacks, and ask fontenc for T1, LY1 and OT1 only; plex's Greek, like Roboto's, is its
only through an LGR encoding no default asks for. The bundles held none of their files. Font
Awesome 4's 34 documents are the 17 that load its package, AltaCV's forks among them, and the
18, 17 of them Awesome-CV forks, whose class loads `FontAwesome` by file from a fonts folder of
their own, which a package cannot ship (decision 0014); one document does both. academicons'
four include an AltaCV fork that needs XeTeX by its own `\setmainfont`, whose class loads
academicons on XeTeX in `\ifdef{\faOrcid}{...}{...}`'s branch for a Font Awesome without
`\faOrcid`, which the survey reads both ways.

### What stays out, and why

- simpleicons: the six documents that load it, AltaCV documents shipping its current class, load
  it only in `\IfFileExists{simpleiconsglyphs-pdftex.tex}{...}{}`, so none needs it. Without it
  the shipped AltaCV class's `\IfFileExists` probe fails again, the port falls back from
  `\xtwitter` to `\twitter` as it did, and decision 0013 stays true.
- raleway (2.3 MB, 745 files): three documents need it, and none of them lacks nothing once it is
  in; they still lack montserrat, smartdiagram, tikz-3dplot or droidsans, each of which fewer
  than three documents need.
- fira (15.5 MB, 2,168 files): two documents need it, for `FiraMono`. A third, made from
  pandoc's template, asks for Fira Sans only on XeTeX and LuaTeX, through the `\ifnum` above,
  and is either.
- ctex and xeCJK, 3 documents each, for size and LuaTeX: the database makes xecjk depend on ctex,
  and ctex brings 43 packages and 86.2 MB of containers, the Arphic, Fandol and Wadalab fonts and
  LuaTeX's luatexja among them, more than the budget alone; and two of the six name Adobe's or
  Noto's CJK fonts, which the archive does not have either.
- Not in the archive: fontawesome6 (4 documents), which TeX Live 2023 does not have; Source Sans
  3 (3), whose package came later; commercial and system fonts, Minion Pro, Myriad Pro, Monaco,
  Helvetica Neue, Avenir Next, Adobe Caslon Pro, Hoefler Text, Optima, Verdana, Gilroy, SF Pro,
  PragmataPro and Adobe's CJK fonts among them (14 documents); l3regex (2), which expl3 absorbed;
  and fmtprefix and xetex-inputenc, which fmtcount and luainputenc, in the tree, ask for.
- Fewer than three documents: Fira and Montserrat (2 each, 15.5 MB and 13.2 MB), Carlito, Bera,
  nth and smartdiagram (2 each), and 18 packages one document needs, EB Garamond, Libertine and
  DejaVu among them. Open Sans, Source Serif Pro, Source Code Pro and Noto (26.6 MB) no document
  names.
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

- The tree grows from 25,835 files and 428.9 MB to 28,392 files and 485.0 MB: plex's 1,602 files
  and tex-gyre's 813 are most of it, each weight, figure style and encoding's metrics and virtual
  fonts, as 0011 found for Roboto. It holds 288 OpenType and TrueType files, 99 more, in 15 more
  families, which `TREE_FAMILIES` names; a test checks that every folder of such files in the
  tree has a family there, so a package that adds fonts without the table fails CI. A first build
  downloads about 280 MB, 20 MB more.
- The manifest grows from 1.83 MB to 2.02 MB (128 KB to 140 KB with Brotli), and `pdftex.map`,
  which the page reads before it draws, from 489 KB to 630 KB (25 KB to 33 KB), with the maps of
  Font Awesome 4, TeX Gyre and Plex.
- The engine starts later, since the session mounts every file of the manifest: in Node on the
  M4 Pro, sessions started from each manifest in turn at a load of 2 to 3 took 3.3 to 3.5 s on
  layout 4's and 3.7 to 3.8 s on layout 5's, about 0.35 s more for a tenth more files, some
  0.14 ms a file. Weighed against what each package makes importable: plex's 1,602 files cost
  about 0.22 s for 2 documents and tex-gyre's 813 about 0.11 s for 7, where biblatex's 119 files
  serve 15 and fontawesome's 16 serve 23 for next to nothing, and ulem's, academicons' and
  soul's 7 serve 7. plex is the one whose cost is out of proportion; dropping it would take 1,602
  files back out and leave its 2 documents lacking IBM Plex, and the slow laptop's start, which
  decision 0016 leaves to the owner, says whether to. fira, raleway and simpleicons, which the
  uncorrected survey took, would have cost 2,955 files, about 0.4 s, for the 2 documents fira
  serves. A first compile of a one-line article from the stock formats is unchanged, about 130 ms
  on pdfTeX and 165 ms on XeTeX.
- The full test suite passes on the new tree, 1,108 tests in 57 files: the curated templates'
  round trips, the harness's eleven checks over each curated package, and the fonts check of
  decision 0014, which finds every file the three packages name.
- What items 3 and 8 can expect. On layout 4, 121 documents lack nothing; on layout 5, 166 do.
  The other 54, other 28, awesome-cv 13, moderncv 8, jake 4 and altacv 1, lack a class (3), a
  package (32) or a font (24), or need LuaTeX (2), and item 3 should expect to refuse them, naming
  what is missing, and to find more that source cannot show: a package a tree class loads that the
  tree lacks, a font chosen by its NFSS code. 30 documents use biber or bibtex, which the engine
  lacks, 23 of them lacking nothing else: with biblatex in the tree they should compile with their
  bibliography empty, which item 13 names as dropped. 147 have images to drop at intake, 16 of
  them through `\includegraphics` in their own source; the rest have images beside them, a photo
  or a preview, and some show them through their class. For item 8: 66 documents need XeTeX, and
  23 either, whose pdfTeX branches need nothing of XeTeX's; 49 of the 66 load fonts through
  fontspec, and the family table covers every font of 25 of them, where it covered 10 on layout
  4; 42 of the 66 name no font the tree lacks, where 27 did. Of the other 24, 13 name commercial
  fonts, 6 Source Sans Pro's italic by its older file name, which item 8 maps by family and
  shape, 3 Source Sans 3, and 2 only free fonts the tree lacks, Montserrat and Merriweather among
  them.
- The survey reads what source says, so its engine and needs are the source's: a conditional set
  anywhere but a class's options is read both ways, as are an etoolbox test and an `\ifnum` whose
  numbers hold a register; a package loaded only if present is loaded when the tree has it,
  whichever file `\IfFileExists` asks after; a class's photo macro is not an `\includegraphics`
  of the document's, and 5 AltaCV documents ask for shell escape only in a comment, which the
  table counts apart. Item 3's compile is the judge.
- The rule is written down, so the next survey grows the tree the same way: a package three
  documents need that makes one of them importable, within the budget. `corpus survey` in CI
  reruns the table every night against whatever tree the cache holds.
