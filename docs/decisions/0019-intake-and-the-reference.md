# 0019. Intake and the reference compile

Date: 2026-09-26 · Status: proposed

## Context

Milestone 3 item 3 is the import pipeline's first code, under `apps/editor/src/import/`: the
intake, which takes a person's `.tex` file or zip and makes the files of a job the engine can
compile, or refuses it; and the reference compile, which compiles the original as it stands and
reads its output as the page does, the glyph stream item 7 compares a regenerated body against and
item 13 counts words in. Plan section 6 step 1 describes both. `corpus reference` runs them over
the corpus of decisions 0017 and 0018, and says how many documents reach the parser and what
refuses the rest. fflate 0.8.3 (MIT) is the one new dependency; it unpacks a zip in the browser
and in Node alike.

## Decision

### The reader moves under `src/`

The survey's reading of TeX source, what a file loads (`references`), each engine's view of it
(`readSource`), a class's options (`optionValues`) and fontspec's fonts (`fontsOf`, and the
tree's families, `TREE_FAMILIES`), is the intake's too. It moves, unchanged, to
`src/import/source.ts` and `src/import/fonts.ts`, which import nothing Node lacks, so that the
corpus's scripts import them as they stand; the survey's tests move with them, and the survey's
table of decision 0018 comes out the same, line for line. A path's rule, `isSafePath`, is
`src/import/paths.ts`'s, which the manifest's adds its marker file to. What the engine needs of a
view, XeTeX for fontspec and its kin, LuaTeX for Lua, becomes `viewNeeds` and `engineFrom`, which
the survey and the intake both call.

### What an upload is, and its caps

- One `.tex` file, or a zip. A zip is refused past 20 MB or 400 entries, folders among them; a
  file past 10 MB unpacked, by the size the zip's directory gives, before anything is inflated
  (fflate then inflates into a buffer of that size and no larger); text files past 5 MB together;
  fonts past 30 MB together; and everything it unpacks past 100 MB together, a cap the brief did
  not name: a zip's entries can say they unpack to a thousand times their size, and without it 20
  MB of zip could unpack to gigabytes of images.
- An entry whose name is not a safe relative path is refused, naming it. Dot files, `__MACOSX`,
  `Thumbs.db` and `desktop.ini` are passed over, and so is anything the job does not need: only
  text files (`.tex .cls .sty .def .clo .fd .bib .bst .ldf .cfg .lco`), a `.bbl`, fonts and images
  are unpacked. Text is read as UTF-8, or as Latin-1 when its bytes are not UTF-8; the job gets
  the bytes as they were.
- The main file is the `.tex` that holds `\documentclass` and that no other `.tex` inputs, so that
  a part that starts a document of its own, as `subfiles` has each part do, is none. None, or more
  than one, is refused, naming them; LaTeX 2.09's `\documentstyle` is refused as too old.

### The job

- The job is the main file's folder: each file there or below keeps its path from it, as TeX's
  working folder is the main file's. A file elsewhere keeps its path from the upload's top, one
  wrapping folder that holds everything aside, as GitHub's zips have: Awesome-CV keeps its class
  and fonts at the top and its sample in `examples/`, and compiles from the top. A file of the
  main file's folder wins a path; the other is named in the warnings. A class or package the
  document loads that the upload holds anywhere else is put where TeX finds it, beside the main
  file, as the corpus's survey counts it the document's (decision 0017). A path with a dot folder
  in it is left out, since TeX may open nothing there, but a dot folder above the main file is not
  in the job's paths at all, so a document kept in `.overleaf-repo/` is taken.
- The engine is read as the survey reads it, on the main file and the files it loads that the
  upload holds: LuaTeX is refused ("This resume needs LuaTeX, which this editor does not have");
  XeTeX takes XeTeX; pdfTeX and either take pdfTeX. A package a source loads only if it is present
  counts when the upload or the tree has it.
- Fonts the upload ships go into the job for the reference compile alone, and are named for item
  8 (decision 0014). The page reads a native font the output takes from the job from the upload's
  bytes, and a TFM the upload ships and TeX Live lacks for its widths.

### Images are stand-ins

- Version one's PDFs carry no images (decision 0008), so an image never reaches the engine: a
  blank stand-in of the same size does, so that nothing on the page moves. A PNG or a JPEG becomes
  a transparent PNG of its pixels, one bit a pixel, with the PNG's own `pHYs` or the JPEG's
  resolution; a PDF becomes one blank page with its crop box, or media box, and rotation. Sizes are
  read as XeTeX reads them, which the engine confirmed on invented JPEGs: a JFIF header decides
  whenever there is one, even with no unit, which is 72 dots per inch; Exif decides only without
  one; 72 without either. An image past 16 MB of 1-bit pixels keeps its size with fewer, larger
  pixels.
- For pdfTeX, the job gets each stand-in's `.xbb`, the bounding box `extractbb` would write, from
  which graphicx's dvipdfmx driver sizes an image: exact, not rounded to whole points.
- Every PNG, JPEG and PDF of the upload is stood in for at its place, but for a PDF named as the
  main file is, beside it, which is the document compiled. A file `\includegraphics` names, in the
  engine's view of the files the main file loads, that graphicx would not find in the job, from
  its working folder or a `\graphicspath` folder, gets a 1 by 1 stand-in where graphicx looks
  first (`.png` added to a name with no extension), or one of the tree's image's size when the
  tree holds one of the name, as a class keeps its logos there (`treeImages`). A name built by a
  macro, as a class's `\photo` builds one, is found by the compile instead (below). EPS, SVG, GIF
  and every other format are dropped, and so is a file that is not the image its name says; the
  intake names every image it stood in for or dropped, as plan section 6 asks.
- `session.pdf` learns to take an image: its caller lists the stand-ins, by their paths in the
  job (`PdfOptions.images`), and a `pdf:image`, `pdf:img` or `pdf:epdf` special whose file,
  resolved inside the job's folder, is one of them and still holds the bytes the caller gave, is
  taken. The file is the special's first PDF string, with nothing before it but the words and
  numbers the image specials take, so that no comment or other object can hide the file xdvipdfmx
  would read; a path out of the folder names none. Every other image special is refused as
  before, and a document that writes over its stand-in, as TeX may write in its folder, is too.
  XeTeX 2023 writes a PDF image as a `pdf:image` special too, not as the old XDV `pic_file`, so one
  check covers both engines.

### The reference compile

- The original compiles from the stock format in the job `import`, forgotten first, two passes,
  three at most, as the session gives every new document. Its output is read as the page and the
  harness read one (`glyphStream`): each page's glyphs, each with its font (a TeX font by name, a
  native one by file), size, code or glyph number, text as the page reads it and place in scaled
  points; its rules and specials in the order the output sets them; the page's size; the fonts,
  TeX and native, and which were the upload's; and the commands of the specials seen. With them
  go the log's warnings that matter (files and font shapes it did without, fonts that lack a
  character, never the character), whether the bibliography was left out, the stand-ins the
  compile added, the passes' times, and the log. It is JSON as it stands. `sameGlyphs` says
  whether two streams set the same glyphs and rules at the same places, within a scaled point;
  specials are no part of it, the editor's markers because a marked body adds them, and the
  others because a body compiled from a dumped format lacks those LaTeX writes at the first
  shipout (decisions 0003 and 0014), which set nothing.
- The editor's pdfTeX writes DVI (decision 0003), and most documents are written for pdfTeX's PDF
  mode. So a pdfTeX job gets a `graphics.cfg` and a `color.cfg` that give graphics, color and
  xcolor dvipdfmx's driver, the default and for the `pdftex` and `dvips` drivers a document names,
  since the three share one driver file and the last to load would put its rules over the others';
  a `hyperref.cfg` that makes hyperref's `pdftex` driver dvipdfmx's, as every pdfTeX port has
  (decision 0008); and, on either engine, a `pdfx.sty` that loads what pdfx loads, xcolor and
  hyperref, without making the PDF/A that neither engine can make here, as AltaCV's port does
  (decision 0013). None sets a glyph, and a file of the name the upload has beside its main file
  is kept instead. The `graphics.cfg` also has graphicx name an image it finds no `.xbb` for, where
  dvipdfmx's driver would ask `extractbb` through a pipe the engine does not have: an image of the
  tree, or one a document names with its extension that the job lacks, which graphicx only warns
  of.
- A compile that stops on a graphic graphicx cannot find or size gets a stand-in for it, of the
  tree image's size or 1 by 1, and runs again, eight stand-ins at most: that is how a photo a class
  names through a macro is found. One that stops because pdfTeX will not do, as fontspec says when
  a class of the tree loads it, runs again on XeTeX; so does one whose source asks for either
  engine and that stops on a primitive of pdfTeX's PDF mode.
- XeTeX finds a font by name only through fontconfig, which decision 0011 gave no folder. The
  engine reads its environment once, when it starts, and the session restores its heap after
  every run, so no compile can change a variable (checked: a variable set after start-up reaches
  no run). So the session points fontconfig, at start-up, at a file a compile can change:
  `FONTCONFIG_FILE` is `.fonts.conf` and `FONTCONFIG_PATH` is the run's folder, then a folder of the
  session's holding a link to the tree's own `fonts.conf`. A dot file, which TeX may neither read
  nor write and no caller may supply. `CompileOptions.fontsByName` writes one into the job's
  folder listing the tree's `fonts/opentype` and `fonts/truetype` folders and the job's own, for
  the compile's passes alone, and takes it out after. Only the reference compile asks for it; the
  loop's compiles never do.
- What the scan costs, measured on an M4 Pro in Node at a load of 3 to 4, on a document that sets
  Roboto by file, so that the font is the same either way: a warm pass takes 168 ms without it and
  200 ms with it, 32 to 33 ms for the scan; the same document asking for Roboto by name takes 206
  ms. The first compile that scans reads the tree's 285 OpenType and TrueType files, 56.8 MB, where
  one without reads 17 files, 9.4 MB. `session.test.ts` bounds the scan's cost.
- A bibliography with no `.bbl` is no refusal: the compile goes on, and the reference says the
  bibliography was left out. biblatex asks for Biber and a rerun on every pass then, which the
  session's three passes cannot answer, and which is not a document that does not settle. A `.bbl`
  the upload has beside its main file, of its name, is the job's.

### Refusals

- A refusal names what stopped it, in plain English and never a line of source: "This resume needs
  the template Foo, which this editor does not have", "...the package foo...", "...the font Open
  Sans...", "...the file part.tex, which is not in the upload", "This resume loads ../x from outside
  its own folder, which this editor cannot reach", "This resume could not be compiled by this
  editor.", and, for output that asks for a pass after the third, "This resume came out differently
  every time it was compiled, so this editor cannot take it." A biblatex style and a babel
  language name the TeX Live package that has them, `biblatex-ieee` and `babel-german`. The intake's
  refusals say which cap or rule, naming the upload's file where one is at fault.
- The log, which quotes the source, goes with every refusal and reference, for developers, and
  never into a message. The corpus runner writes each document's under `.corpus/reference/` and
  prints none; an undefined command's name, which is a name and not a line, is kept for them too.

### The corpus runner

- `pnpm --filter @resume-tools/editor corpus reference [--only <id>] [--json <file>]` takes each
  fetched document in as a zip of its files at their paths in its repository, with, for each font
  the manifest names beside the main file, the tree's file of that name when the tree has one: the
  corpus fetches no font, and a person's zip would hold them. The zip holds no image; the corpus
  counts them only.
- The engine session's calls are synchronous, so a looping document would hold the whole run. The
  documents go to a pool of four child processes, each with an engine session and fonts of its own,
  loaded through Vite's module runner as `measure` loads them; each document gets 90 s, after which
  its child is killed, another started in its place, and the document counted as timed out.
- It prints one table and, with `--json`, a row for each document, names and numbers only. A name
  is printed only when it is plainly one, as the survey prints them.

## The corpus

The run on 26 September 2026, on the tree of layout 5, the M4 Pro, took about 30 s with four
children; a document took 350 ms from being sent to its row coming back, the median, and 2.0 s at
most.

|  | jake | awesome-cv | altacv | moderncv | europecv | other | all |
|---|--:|--:|--:|--:|--:|--:|--:|
| Documents | 50 | 40 | 20 | 30 | 10 | 70 | 220 |
| Compiled to a reference | 35 | 0 | 8 | 12 | 5 | 30 | 90 |
| Refused at intake | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Refused: needs LuaTeX | 0 | 1 | 0 | 1 | 0 | 0 | 2 |
| Refused: a template the tree lacks | 1 | 0 | 0 | 0 | 0 | 4 | 5 |
| Refused: a package the tree lacks | 6 | 5 | 4 | 7 | 3 | 21 | 46 |
| Refused: a font the tree lacks | 0 | 29 | 0 | 1 | 0 | 8 | 38 |
| Refused: a file the upload or the tree lacks | 0 | 0 | 6 | 1 | 0 | 4 | 11 |
| Refused: stopped for another reason | 8 | 5 | 2 | 8 | 2 | 3 | 28 |
| Refused: did not settle in three passes | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Refused: timed out, past 90 s | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Reference of one page | 17 | 0 | 5 | 3 | 1 | 10 | 36 |
| Reference of two pages | 15 | 0 | 3 | 7 | 3 | 5 | 33 |
| Reference of more pages | 3 | 0 | 0 | 2 | 1 | 15 | 21 |
| Engine: pdfTeX | 35 | 0 | 7 | 12 | 5 | 25 | 84 |
| Engine: XeTeX | 0 | 0 | 1 | 0 | 0 | 5 | 6 |
| Engine: XeTeX after pdfTeX would not do | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Bibliography left out | 0 | 0 | 2 | 1 | 1 | 4 | 8 |
| Images stood in for | 1 | 0 | 1 | 4 | 4 | 4 | 14 |
| Images the upload lacked, stood in for at 1 by 1 | 1 | 0 | 1 | 4 | 3 | 4 | 13 |
| Images of the tree, stood in for at their size | 0 | 0 | 0 | 0 | 4 | 0 | 4 |
| Fonts from the upload | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| Compile time, median | 336 ms |  | 1102 ms | 679 ms | 629 ms | 388 ms | 367 ms |
| Compile time, slowest | 520 ms |  | 1951 ms | 1043 ms | 691 ms | 1893 ms | 1951 ms |
| **Packages the tree lacks** |  |  |  |  |  |  |  |
| `babel-french` | 0 | 0 | 0 | 2 | 0 | 2 | 4 |
| `fontawesome6` | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| `babel-german` | 0 | 0 | 0 | 1 | 1 | 1 | 3 |
| `biblatex-ieee` | 0 | 0 | 2 | 0 | 0 | 1 | 3 |
| `FiraMono` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `carlito` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `ctex` | 0 | 1 | 0 | 1 | 0 | 0 | 2 |
| `l3regex` | 0 | 0 | 0 | 2 | 0 | 0 | 2 |
| `raleway` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| **Fonts the tree lacks** |  |  |  |  |  |  |  |
| `latinmodern-math` | 0 | 19 | 0 | 0 | 0 | 1 | 20 |
| `SourceSansPro-It` | 0 | 5 | 0 | 0 | 0 | 0 | 5 |
| `FontAwesome` | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| **Files the upload or the tree lacks** |  |  |  |  |  |  |  |
| `t3enc.def` | 0 | 0 | 0 | 0 | 0 | 3 | 3 |
| AltaCV sidebars and parts, five names | 0 | 0 | 6 | 0 | 0 | 0 | 6 |
| **Stopped, by the first error** |  |  |  |  |  |  |  |
| an undefined command | 2 | 0 | 0 | 4 | 1 | 1 | 8 |
| another TeX error | 2 | 4 | 1 | 0 | 0 | 1 | 8 |
| another LaTeX error | 2 | 0 | 0 | 2 | 0 | 1 | 5 |
| a package's error | 0 | 1 | 1 | 1 | 0 | 0 | 3 |

The packages, fonts and files each one document names are left out of the table here; the
command prints them all. The templates are five documents' own: three named by a path out of their
folder, one the corpus does not hold, and `res`. Of the 28 that stopped, 8 stopped on an undefined
command: `\@initializecommand` in three moderncv documents, a document's own misspelt macro,
`\faFileAlt`, `\ecv@homepage`, `\ifdimgreater` and LuaTeX's `\pdfvariable`. Four are Awesome-CV
forks whose own `fontawesome.sty` defines `\FA` again, which TeX Live 2023's fontspec refuses;
three stopped on an option clash, two on unbalanced braces, and one each on a character pdfTeX
cannot set, a `$` outside mathematics, a lonely `\item`, a colour the document never defines, a
command defined twice, an illegal parameter, an unknown option, a Font Awesome loaded twice at two
versions, europecv's class ordering LaTeX's hooks too late, a command redefined that was never
defined, and a document that ships no page.

### What the numbers say for items 4 to 8

- **90 documents reach the parser** (item 4), 84 on pdfTeX and 6 on XeTeX: 35 of the 50 `jake`, 12
  of 30 `moderncv`, 8 of 20 `altacv`, 5 of 10 `europecv`, 30 of 70 `other`, and none of the 40
  `awesome-cv`. Every one settles in two passes but one, which takes three; none timed out, and
  none keeps asking for a pass.
- **The survey was right about what it could see, and missed what it could not.** Of the 166
  documents it found lacking nothing on this tree, 89 compile. Of the other 77, 27 are refused for
  a font: unicode-math's default math font, `latinmodern-math.otf`, which no source names, for 20,
  a fonts folder the corpus did not fetch for 3, and 4 others. 13 need a package a tree class or
  package loads, or a babel language or biblatex style, which source reading does not count. 26
  stop on the documents' own errors and TeX Live 2023's differences from the versions they were
  written for. 9 lack a file: 6 AltaCV sidebars and parts named through a macro of AltaCV's, which
  the corpus's collector does not follow, a part the corpus does not hold, a photo named by a path
  out of its folder, and tipa's T3 encoding, which the tree lacks. 2 name their class by a path out
  of their folder. Of the 54 it found lacking something, 1 compiles.
- **Awesome-CV waits on one font.** Its class loads unicode-math, whose default math font the tree
  lacks: 20 documents stop there, and every Awesome-CV fork stops somewhere, so item 8, which is
  written for Awesome-CV's forks, has 6 XeTeX references to work on, none of them Awesome-CV's.
  TeX Live 2023's `lm-math` r67718, one OpenType file in a 0.38 MB container, is the tree's next
  package by decision 0011's mechanism and decision 0018's rule, and needs a machine that reaches
  the archive. After it, Awesome-CV's forks stop on Adobe's old name for Source Sans Pro's italic
  (5, which item 8's table maps by family and shape), fontawesome6 (4, not in TeX Live 2023), a
  fonts folder the corpus lacks (3) and their own `fontawesome.sty` (4).
- **Languages and bibliography styles are the other cheap wins**: babel's French, German, Italian,
  Czech and Portuguese stop 10 documents and are a few kilobytes each (babel-german r69506 4 KB,
  babel-french r70261 16 KB); biblatex's IEEE and APA 6 styles stop 4. Plan section 4.1 keeps
  version one's text English, but these resumes are compiled whole, in their own language.
- **Images**: 14 references have stand-ins, 13 for images the corpus does not hold and 4, the
  europecv documents', for the European flag and Europass logo europecv's class keeps in the tree,
  at their size; 8 leave their bibliography out, which item 13's report names as dropped.
- **Time is not the constraint**: the median document compiles in 367 ms, the slowest in 2.0 s,
  two passes from the stock format, XeTeX's in 0.4 to 2.0 s with fontspec, so item 5's probes and
  item 7's checks, a few dozen compiles from a dumped format, have room.

## Consequences

- The reference is the original compiled for DVI output: its PDF-mode drivers taken for dvipdfmx's
  and pdfx for what it loads, its images blank stand-ins of their size, a missing one 1 by 1, fonts
  found by name through fontconfig on XeTeX. It sets the glyphs the author's PDF sets but where a 1
  by 1 stand-in takes a missing image's place, and a regenerated body compiled the same way sets
  the same.
- The first XeTeX reference compile of a session reads every OpenType and TrueType file of the tree
  for fontconfig's scan, 285 files and 56.8 MB, which the browser's worker reads one synchronous
  request at a time (decision 0010): item 12 has to fetch them ahead, or item 8's table can name
  each font's file so that the scan is not needed, before an import in the browser starts on
  XeTeX.
- A document that needs pdfTeX's PDF mode past the drivers and pdfx, one that sets `\pdfoutput=1`
  or calls a PDF-mode primitive and does not ask for XeTeX, is refused; the corpus has none left.
- An image in a format with no stand-in, EPS above all, stops a document that shows it; the corpus
  shows none it holds. A name `\includegraphics` gives with a path out of the main file's folder
  cannot be reached.
- The corpus's zips hold the tree's copy of each font the manifest names and none of its images,
  and miss the sidebars AltaCV names through a macro, so the corpus numbers undercount what a
  person's own zip would compile by those documents.
- The survey and the intake read source the same way, from `src/import/`, and item 4's parser,
  item 5's probe and item 7's checks build on `glyphStream` and `sameGlyphs`.
