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
and in Node alike. An adversarial review of the first version found seven major and ten minor
faults; this record is the corrected one, and says where a rule changed.

## Decision

### The reader moves under `src/`

The survey's reading of TeX source, what a file loads (`references`), each engine's view of it
(`readSource`), a class's options (`optionValues`) and fontspec's fonts (`fontsOf`, and the
tree's families, `TREE_FAMILIES`), is the intake's too. It moves to `src/import/source.ts` and
`src/import/fonts.ts`, which import nothing Node lacks, so that the corpus's scripts import them
as they stand; the survey's tests move with them. A path's rule, `isSafePath`, is
`src/import/paths.ts`'s, which the manifest's adds its marker file to. What the engine needs of a
view, XeTeX for fontspec and its kin, LuaTeX for Lua, becomes `viewNeeds` and `engineFrom`, which
the survey and the intake both call.

- Two changes to what it reads, after the review. LuaTeX's PDF settings, `\pdfvariable`,
  `\pdfextension` and `\pdffeedback`, are LuaTeX's commands, and asked after they guard as
  `\directlua` does; the survey reads one document, moderncv-0021, as LuaTeX's where it read it
  as XeTeX's (decision 0018's update says so). And an argument is read no further than 2,048
  characters past where it starts (`WINDOW`, 8,192 before): the survey reads every document of
  the corpus the same with either.
- The intake runs each reader once for each text, however many of its steps ask, and its reader
  of paths above the folder (`pathsAbove`) reads an argument only when its start says it is one.
  The reviewers' megabyte of `\input{`, none of which closes, took the intake 5.2 s of CPU time,
  every command read through the window four times over; it takes 0.3 s. Two invented test inputs
  shrank to the window: an `\ExecuteOptions` list of 500 options and a fontspec face of 8,000
  stars, now 300 and 2,000.

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
  the bytes as they were, but for the two edits below.
- The main file is the `.tex` that holds `\documentclass` and that no other `.tex` inputs, so that
  a part that starts a document of its own, as `subfiles` has each part do, is none. None, or more
  than one, is refused, naming them; LaTeX 2.09's `\documentstyle` is refused as too old.

### The job

- The job is the main file's folder: each file there or below keeps its path from it, as TeX's
  working folder is the main file's. A file elsewhere keeps its path from the upload's top, one
  wrapping folder that holds everything aside, as GitHub's zips have: Awesome-CV keeps its class
  and fonts at the top and its sample in `examples/`, and compiles from the top. A file of the
  main file's folder wins a path, an image as any other; the other is named in the warnings, and
  an image so left out is dropped (`duplicate`). A class or package the document loads that the
  upload holds anywhere else is put where TeX finds it, beside the main file, as the corpus's
  survey counts it the document's (decision 0017). A path with a dot folder in it is left out,
  since TeX may open nothing there, but a dot folder above the main file is not in the job's paths
  at all, so a document kept in `.overleaf-repo/` is taken.
- A path the main file or a file it inputs names above the main file's folder, in `\graphicspath`,
  `\includegraphics`, `\input`, `\include`, `\subfile`, `\import`, `\addbibresource` or
  `\bibliography`, is rewritten to the path the job holds what it names at, its path from the
  upload's top, with a warning for each path, once: TeX may open nothing above its folder, and the
  reference compile then reads the files the author's setup did. `\graphicspath{{../img/}}` in
  `src/cv.tex` becomes `{img/}`. A path whose job path holds another of the upload's files, one
  beside the main file that won the path, is left as it is, and so is one that leaves the upload;
  one that names nothing the upload holds is rewritten too, and is missing as any other. A path a
  macro builds, as a class's `\photo` builds one, is not seen, and stays out of reach.
- `\pdfoutput` set above 0 in the main file or a file it inputs, `\pdfoutput=1` or `\pdfoutput 1`
  but not a test of it such as `\ifnum\pdfoutput=1`, is set to 0, with a warning: the editor's
  pdfTeX writes DVI (decision 0003), and a document written for PDF mode ships a DVI as any other,
  where it wrote a PDF the reference compile could not read. The main file's text and bytes are
  those the job compiles, both edits in; a UTF-8 file keeps its byte-order mark, a Latin-1 one its
  encoding.
- A file of the upload where the reference compile writes its own is refused, naming it, unless it
  holds what the compile would write: at the job's top, one named as the job is, `import.tex`,
  `import.bbl`, `import.pdf` or of any other extension, which TeX writes and reads back or
  `session.pdf` removes; and, on the intake's engine, the compatibility files below, which a file
  of the name the upload held used to take the place of. The session's `.fonts.conf` and a
  stand-in's `.xbb` need no check: the intake passes over dot files and `.xbb` files alike.
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
  one; 72 without either.
- A PNG or a JPEG of more than 10,000 pixels on a side is dropped as unreadable, with a warning:
  xdvipdfmx reads all of a stand-in's image data, 12.5 MB at 10,000 by 10,000, and a header can
  say 2^31 on a side, which cost 60 to 100 ms a stand-in at level 9, and 50 such headers five
  seconds. A stand-in's image data, zero bytes alone, is written as a zlib stream directly, a copy
  of the byte before for each 258 bytes, rather than compressed: 10,000 by 10,000 pixels, which
  took 60 to 70 ms at level 1, take under a millisecond, and 400 of them nothing to speak of. A
  document that shows an image dropped as unreadable gets the 1 by 1 stand-in of one missing.
- A PDF's box is read from the whole file, 10 MB at most, by a scanner that reads a number over 32
  characters at most and moves forward only, and then from its compressed object streams in one
  pass over the file's `stream` and `endstream` pairs, 32 object streams and 16 MB inflated at
  most, each stream tried charged what it read or gave, whether or not it inflated. The reviewers'
  crop box of 200,000 digits took 13.5 s of CPU time and their 40,000 object streams' markers 9.1
  s; they take 1 and 5 ms, and `images.test.ts` bounds both against a tenth of each. Reading the
  first and last 256 KB alone, as the corrections first did, missed a whole PDF of 800 KB whose
  page sits between an image's stream and a font's. The file is read as Latin-1 by `TextDecoder`,
  10 MB in about 10 ms, where building the string from its bytes took 130. A PDF whose box still
  cannot be read, as one whose box is given by reference, is dropped as unreadable with a warning
  that names it, where it was dropped silently.
- An intake reads its upload's images within one budget (`UPLOAD_BUDGET`): 64 PDFs, and 32 MB
  inflated from their object streams, all together. A PDF's own 16 MB and 32 streams bound one PDF
  alone, and the reviewers' 399 PDFs of two 8 MB object streams each, from a zip of 134 KB, took 91
  s of CPU time within them. A PDF past the budget, the 65th or one whose object streams the 32 MB
  has no room left for, is dropped as unreadable, and so is every image after it, with one warning:
  "This upload has too many images to read: 397 of them are left out." The reviewers' zip takes 60
  ms. The tree's images, TeX Live's own, are read outside it.
- For pdfTeX, the job gets one `.xbb` for each name, the bounding box `extractbb` would write for
  the image graphicx takes for the name without an extension, exact, not rounded to whole points:
  dvipdfmx's driver reads `<name>.xbb` whatever the extension, and graphicx tries `.pdf`, `.PDF`,
  `.ai`, `.AI`, `.png`, `.PNG`, `.jpg`, `.JPG`, `.jpeg` and `.JPEG` in that order, the same in
  `dvipdfmx.def` and `xetex.def`. Another image of the name is shadowed, which a warning says, and
  one the document names with its extension takes the other's size on pdfTeX, which a second
  warning says; `logo.png` beside `logo.pdf` wrote `logo.xbb` with the PNG's size, and moved the
  line 160 pt. A stand-in the compile adds keeps a name's `.xbb` for the image graphicx takes.
- But an image the job has, the upload's or the tree's, gives its name's `.xbb` before a stand-in
  for a name the upload lacks, whatever graphicx's order says, since the stand-in's 1 by 1 is a
  guess (`sizedImage`): a `photo.pdf` named in a command the document never uses, and lacked, took
  `photo.xbb` from the `photo.png` the upload holds, and moved the line 39 pt. One warning names
  the stand-in's name as shadowed: "photo.pdf, which the upload lacks, is shadowed by photo.png, of
  the same name, whose size it takes: on pdfTeX, this editor sizes the two by the name they share."
- Every PNG, JPEG and PDF of the upload is stood in for at its place, but for a PDF named as the
  main file is, beside it, which is the document compiled. A file `\includegraphics` names, in the
  engine's view of the files the main file loads, that graphicx would not find in the job, from
  its working folder or a `\graphicspath` folder, gets a 1 by 1 stand-in where graphicx looks
  first (`.png` added to a name with no extension), or one of the tree's image's size when the
  tree holds one of the name, as a class keeps its logos there (`treeImages`). A name that finds
  only an image of the upload's in a format with no stand-in gets none, where it got a 1 by 1 PNG
  marked missing: a document that shows it stops on it, and the reference compile refuses it
  (below). A name built by a macro, as a class's `\photo` builds one, is found by the compile
  instead. EPS, SVG, GIF and every other format are dropped, and so is a file that is not the
  image its name says; the intake names every image it stood in for or dropped, each once, as plan
  section 6 asks.
- `session.pdf` learns to take an image: its caller lists the stand-ins, by their paths in the
  job (`PdfOptions.images`), and a `pdf:image`, `pdf:img` or `pdf:epdf` special whose file,
  resolved inside the job's folder, is one of them and still holds the bytes the caller gave, is
  taken. The file is the special's first PDF string, with nothing before it but the words and
  numbers the image specials take, so that no comment or other object can hide the file xdvipdfmx
  would read; a path out of the folder names none. Only a path of letters, digits, `.`, `_`, `-`
  and `/`, no part of which starts with a dot, can be listed (`isShowableImage`), so that nothing
  in the special's string can mean anything to xdvipdfmx but the file. Every other image special
  is refused as before, and a document that writes over its stand-in, as TeX may write in its
  folder, is too.
- XeTeX 2023 writes every picture, a PDF's page and one of the tree's among them, as a
  `pdf:image` special, checked on the engine, so one check covers both engines. The XDV opcode
  that once placed a picture from a file, 251, `pic_file`, is TeX--XeT's `end_reflect` to TeX Live
  2023's xdvipdfmx, as 250 is `begin_reflect`: each takes nothing from the stream and reads no
  file, checked on XDV written to hold them, and XeTeX 2023 writes neither, even for right-to-left
  text. `parseDvi` reads the two as xdvipdfmx does, where it read 251 as a picture's 29 bytes and
  a path and threw on 250, so that the page's reading of a stream and the PDF step's are the same
  byte for byte and no special can hide from the scan behind them. The review's brief had the
  parser emit 251 as a picture for the scan to check; this engine gives it nothing to check.

### The reference compile

- The original compiles from the stock format in the job `import`, forgotten first, two passes,
  three at most, as the session gives every new document. Its output is read as the page and the
  harness read one (`glyphStream`): each page's glyphs, each with its font (a TeX font by name, a
  native one by file, with its face in the file when not the first, and the colour, fake slant,
  emboldening and extent XeTeX gives it), size, code or glyph number, text as the page reads it
  and place in scaled points; its rules and specials in the order the output sets them; the page's
  size; the fonts, TeX and native, and which were the upload's; and the commands of the specials
  seen. With them go the log's warnings that matter (files and font shapes it did without, fonts
  that lack a character, never the character), whether the bibliography was left out, the
  stand-ins the compile added, the passes' times, and the log. It is JSON as it stands.
- `sameGlyphs` says whether two streams set the same glyphs, rules and specials at the same
  places, within a scaled point: a glyph's font and, for a native one, all XeTeX does to it, and
  a special's text, so that a colour, a link or an image is part of what it compares. It leaves
  out the editor's markers, `rt:b:`, `rt:e:`, `rt:p:` and the lock markers item 12 adds, `rt:l:`,
  which a marked body adds; and the four specials of a whole compile's first shipout, which a body
  compiled from a dumped format lacks (decisions 0003 and 0014): `pdf:majorversion`,
  `pdf:minorversion`, `dvipdfmx:config`, and xcolor's black, found by where it is, the
  `color push gray 0` at the bottom of the colour stack that no `color pop` takes off, with any
  black nothing takes off above it (decision 0023 adds black in RGB and CMYK, and a white
  `\pagecolor`'s background). The first version left every special out, and kept only a
  native font's file, so that a lost colour, photo, fake bold, slant or colour passed. On the
  engine: an article with xcolor and hyperref compiled whole on pdfTeX has that one black more
  than its body, marked and compiled from a format of its preamble, and the two are the same; a
  red word, a photo against an empty box, and XeTeX's FakeBold, FakeSlant and Color each differ.
  A difference names a special by its command alone, since its text may be the resume's, as a
  link's address is.
- The editor's pdfTeX writes DVI (decision 0003), and most documents are written for pdfTeX's PDF
  mode. So a pdfTeX job gets a `graphics.cfg` and a `color.cfg` that give graphics, color and
  xcolor dvipdfmx's driver, the default and for the `pdftex` and `dvips` drivers a document names,
  since the three share one driver file and the last to load would put its rules over the others';
  a `hyperref.cfg` that makes hyperref's `pdftex` driver dvipdfmx's, as every pdfTeX port has
  (decision 0008); and, on either engine, a `pdfx.sty` that loads what pdfx loads, xcolor and
  hyperref, without making the PDF/A that neither engine can make here, as AltaCV's port does
  (decision 0013). None sets a glyph. The `graphics.cfg` also has graphicx name an image it finds
  no `.xbb` for, where dvipdfmx's driver would ask `extractbb` through a pipe the engine does not
  have: an image of the tree, or one a document names with its extension that the job lacks,
  which graphicx only warns of.
- A compile that stops on a graphic graphicx or XeTeX cannot find, or the job cannot size, gets a
  stand-in for it, of the tree image's size or 1 by 1, and runs again, eight stand-ins at most:
  that is how a photo a class names through a macro is found. XeTeX's `Unable to load picture or
  PDF file` for a name with its extension is such a stop, as LaTeX's error is for one without; the
  first version refused it as stopped. A compile whose output shows an image from outside the
  job, the tree's, as XeTeX shows europecv's flag, which it finds in the tree and measures by
  reading, gets a stand-in of that image's size under its name in the job, which is found first,
  and runs again, so that no image special names the tree; pdfTeX's graphics configuration stops
  on such an image before. One that stops because pdfTeX will not do, as fontspec says when a
  class of the tree loads it, runs again on XeTeX; so does one whose source asks for either
  engine and that stops on a primitive of pdfTeX's PDF mode.
- A compile that stops on an image the upload holds in a format with no stand-in, by its name or
  by its name without the extension, or on one of such a format the upload lacks, is refused
  (`image`): "This resume shows the image figure.eps, in a format this editor does not take: it
  takes PNG, JPEG and PDF images." A document that only defines a command that would show it
  compiles.
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
- What the scan costs, on a document that sets Roboto by file, so that the font is the same either
  way, the fastest of five passes in the CPU time of the thread the engine runs in, on the M4 Pro
  and the tree of layout 6: a pass takes 173 to 174 ms without it and 211 ms with it, 37 to 38 ms
  for the scan; the same document asking for Roboto by name took 206 ms of elapsed time on layout
  5. The first compile that scans reads the tree's 286 OpenType and TrueType files, 57.5 MB, where
  one without reads 17 files, 9.4 MB. `session.test.ts` bounds the scan's cost in CPU time, where
  the first version bounded it in elapsed time.
- A bibliography with no `.bbl` is no refusal: the compile goes on, and the reference says the
  bibliography was left out. biblatex asks for Biber and a rerun on every pass then, which the
  session's three passes cannot answer, and which is not a document that does not settle. A `.bbl`
  the upload has beside its main file, of its name, is the job's.

### Refusals

- A refusal names what stopped it, in plain English and never a line of source: "This resume needs
  the template Foo, which this editor does not have", "...the package foo...", "...the font Open
  Sans...", "...the file part.tex, which is not in the upload", "This resume loads ../x from outside
  its own folder, which this editor cannot reach", "This resume shows the image figure.eps, in a
  format this editor does not take: it takes PNG, JPEG and PDF images.", "This resume could not be
  compiled by this editor.", and, for output that asks for a pass after the third, "This resume
  came out differently every time it was compiled, so this editor cannot take it." A biblatex
  style and a babel language name the TeX Live package that has them, `biblatex-ieee` and
  `babel-german`. The intake's refusals say which cap or rule, naming the upload's file where one
  is at fault, and so do the reference compile's of a file where it writes its own: "This upload
  holds import.tex, whose name this editor gives its own copy of the resume. Rename it, and upload
  the resume again.", "This upload holds graphics.cfg, a file this editor writes itself. Take it
  out, and upload the resume again."
- A font's name is read whole where fontspec's message wraps it: expl3 wraps its messages at about
  79 columns whatever `max_print_line` says, going on in lines that start `(fontspec)`, which are
  read as one line with the error. A font asked for by a path is named by its file,
  `fonts/Invented` as `Invented`. A compile that stops on one of LuaTeX's primitives undefined,
  `\pdfvariable`, `\pdfextension`, `\pdffeedback`, `\directlua` and their kin, is refused for
  LuaTeX, where the first version said it could not be compiled.
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
- It prints one table, which lists under each reason the 15 names the most documents give, and,
  under the table, every name each reason gives, with how many documents gave it; with `--json`,
  the file holds every name and its count in place of that list, and a row for each document, names
  and numbers only. A name is printed only when it is plainly one, as the survey prints them.

## The corpus

The run on 26 September 2026, on the tree of layout 6, the M4 Pro, took 42 s with four children;
a document took 360 ms from being sent to its row coming back, the median, and 5.2 s at most.

|  | jake | awesome-cv | altacv | moderncv | europecv | other | all |
|---|--:|--:|--:|--:|--:|--:|--:|
| Documents | 50 | 40 | 20 | 30 | 10 | 70 | 220 |
| Compiled to a reference | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Refused at intake | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Refused: needs LuaTeX | 0 | 1 | 0 | 2 | 0 | 0 | 3 |
| Refused: a template the tree lacks | 1 | 0 | 0 | 0 | 0 | 4 | 5 |
| Refused: a package the tree lacks | 6 | 5 | 2 | 4 | 2 | 19 | 38 |
| Refused: a font the tree lacks | 0 | 10 | 0 | 2 | 0 | 9 | 21 |
| Refused: a file the upload or the tree lacks | 0 | 1 | 6 | 1 | 0 | 1 | 9 |
| Refused: shows an image in a format with no stand-in | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Refused: stopped for another reason | 8 | 5 | 2 | 7 | 2 | 3 | 27 |
| Refused: did not settle in three passes | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Refused: timed out, past 90 s | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Reference of one page | 17 | 8 | 6 | 5 | 1 | 10 | 47 |
| Reference of two pages | 15 | 7 | 3 | 7 | 4 | 9 | 45 |
| Reference of more pages | 3 | 3 | 1 | 2 | 1 | 15 | 25 |
| Engine: pdfTeX | 35 | 0 | 9 | 14 | 6 | 27 | 91 |
| Engine: XeTeX | 0 | 18 | 1 | 0 | 0 | 7 | 26 |
| Engine: XeTeX after pdfTeX would not do | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Bibliography left out | 0 | 1 | 4 | 1 | 2 | 5 | 13 |
| Images stood in for | 1 | 2 | 3 | 4 | 5 | 5 | 20 |
| Images the upload lacked, stood in for at 1 by 1 | 1 | 2 | 3 | 4 | 3 | 5 | 18 |
| Images of the tree, stood in for at their size | 0 | 0 | 0 | 0 | 5 | 0 | 5 |
| Fonts from the upload | 0 | 4 | 0 | 0 | 0 | 1 | 5 |
| Compile time, median | 336 ms | 2683 ms | 1168 ms | 676 ms | 578 ms | 414 ms | 545 ms |
| Compile time, slowest | 521 ms | 5235 ms | 3460 ms | 1048 ms | 695 ms | 2681 ms | 5235 ms |
| **Packages the tree lacks** |  |  |  |  |  |  |  |
| `fontawesome6` | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| `xetex-inputenc` | 0 | 0 | 0 | 0 | 0 | 3 | 3 |
| `FiraMono` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `carlito` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `ctex` | 0 | 1 | 0 | 1 | 0 | 0 | 2 |
| `l3regex` | 0 | 0 | 0 | 2 | 0 | 0 | 2 |
| `raleway` | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| **Fonts the tree lacks** |  |  |  |  |  |  |  |
| `SourceSansPro-It` | 0 | 5 | 0 | 0 | 0 | 0 | 5 |
| `FontAwesome` | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| `Minion Pro` | 0 | 0 | 0 | 1 | 0 | 2 | 3 |
| **Files the upload or the tree lacks** |  |  |  |  |  |  |  |
| AltaCV sidebars and parts, five names | 0 | 0 | 6 | 0 | 0 | 0 | 6 |
| **Stopped, by the first error** |  |  |  |  |  |  |  |
| an undefined command | 2 | 0 | 0 | 4 | 1 | 1 | 8 |
| another TeX error | 2 | 4 | 1 | 0 | 0 | 1 | 8 |
| another LaTeX error | 2 | 0 | 0 | 2 | 0 | 1 | 5 |
| a package's error | 0 | 1 | 1 | 1 | 0 | 0 | 3 |
| LaTeX's hooks | 0 | 0 | 0 | 0 | 1 | 0 | 1 |
| a character pdfTeX cannot set | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| mathematics outside mathematics | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| **Stopped on an undefined command, by the command** |  |  |  |  |  |  |  |
| `\@initializecommand` | 0 | 0 | 0 | 3 | 0 | 0 | 3 |

The table here keeps the names two documents or more give; the command lists every name under its
table, and in its JSON. The templates are five documents' own: three named by a path out of their
folder, one the corpus does not hold, and `res`. The files are, besides AltaCV's, two photos named
by a path above the folder through a class's `\photo`, one Awesome-CV fork's and one moderncv
document's, and a part the corpus does not hold. Of the 27 that stopped, 8 stopped on an undefined
command: `\@initializecommand` in three moderncv documents, a document's own misspelt macro,
`\faFileAlt`, `\ecv@homepage`, `\ifdimgreater`, and babel's `\l@french` in the one document the tree's
babel-french lets go further. Four are Awesome-CV forks whose own `fontawesome.sty` defines `\FA` again,
which TeX Live 2023's fontspec refuses; three stopped on an option clash, two on unbalanced braces,
and one each on a character pdfTeX cannot set, a `$` outside mathematics, a lonely `\item`, a colour
the document never defines, a command defined twice, an illegal parameter, an unknown option, a
Font Awesome loaded twice at two versions, europecv's class ordering LaTeX's hooks too late, and a
command redefined that was never defined.

**Before and after.** The first version's run, on layout 5, compiled 90. With the review's fixes,
layout 5 compiles 91: moderncv-0026, which sets `\pdfoutput=1`, compiles, and moderncv-0021, which
sets `\pdfvariable`, is refused for LuaTeX where it stopped. Layout 6 compiles 117, 26 more and
none fewer: 19 of the 20 that lacked `latinmodern-math.otf` (the 20th names its photo above its
folder through `\photo`), all 3 that lacked biblatex's IEEE style, 2 of the 3 that lacked babel's
German, 1 of the 4 that lacked its French, and 1 of the 3 that lacked tipa's `t3enc.def`. The rest
of those stop on xetex-inputenc, which the archive does not have (decision 0018), on Minion Pro, a
commercial font, and on babel's `\l@french`.

### What the tree takes

The reference compile's refusals name what reading source cannot see: unicode-math's default math
font, which Awesome-CV's class loads, babel's languages, biblatex's styles and a font encoding's
definitions. Decision 0018's rule takes, of these, each that three documents or more need and that
makes at least one of them compile, checked on the rebuilt tree above; `LAYOUT` is 6:

| Package | Need it | Compile with it | Container | Files in the tree | On disk |
|---|--:|--:|--:|--:|--:|
| lm-math r67718, `latinmodern-math.otf` | 20 | 19 | 0.38 MB | 1 | 0.73 MB |
| babel-french r70261 | 4 | 1 | 16 KB | 6 | 0.09 MB |
| babel-german r69506 | 3 | 2 | 4 KB | 8 | 0.03 MB |
| biblatex-ieee r61243 | 3 | 3 | 6 KB | 5 | 0.03 MB |
| tipa r29349, its T3 encoding | 3 | 1 | 2.88 MB | 246 | 3.92 MB |

That is 3.3 MB of containers, 68.0 MB with decisions 0011's and 0018's, and 266 files and 4.8 MB
on disk: the tree grows from 28,392 files and 485.0 MB to 28,658 files and 489.8 MB, and tipa's map
joins `pdftex.map`. `TREE_FAMILIES` names Latin Modern Math. Babel's Italian, Czech and Portuguese
and biblatex's APA 6 style stop one document each, below the rule; xetex-inputenc, fontawesome6,
Minion Pro and the fonts folders Awesome-CV's forks keep, the archive does not have. The full test
suite passes on the new tree, 1,226 tests in 64 files.

### What the numbers say for items 4 to 8

- **117 documents reach the parser** (item 4), 91 on pdfTeX and 26 on XeTeX: 35 of the 50
  `jake`, 18 of the 40 `awesome-cv`, 10 of 20 `altacv`, 14 of 30 `moderncv`, 6 of 10 `europecv`
  and 34 of 70 `other`. 114 settle in two passes and 3 take three; none timed out, and none keeps
  asking for a pass.
- **The survey was right about what it could see, and missed what it could not.** A package a
  tree class or package loads, a babel language, a biblatex style, a font encoding's definitions
  and unicode-math's default math font are needs no source names; the tree now holds those three
  documents or more share. Of the 166 documents the survey found lacking nothing, 116 compile,
  where 89 did on layout 5; of the 54 it found lacking something, 1 compiles, as before.
- **Awesome-CV compiles now**: 18 of its 40 forks, all on XeTeX, which item 8 is written for. The
  other 22 stop on Adobe's old name for Source Sans Pro's italic (5, which item 8's table maps by
  family and shape), fontawesome6 (4, not in TeX Live 2023), a fonts folder the corpus lacks (4),
  their own `fontawesome.sty`, which TeX Live 2023's fontspec refuses (4), and one each on a
  package's error, a photo above the folder, LuaTeX, a commercial font and ctex.
- **Languages and bibliography styles**: babel's French and German stopped 7 documents on layout
  5, of which 3 compile with them and 4 stop on what else they need; biblatex's IEEE style stopped
  3, which all compile, their bibliographies left out. Plan section 4.1 keeps version one's text
  English, but these resumes are compiled whole, in their own language.
- **Images**: 20 references have stand-ins, 18 for images the corpus does not hold and 5, the
  europecv documents', for the European flag and Europass logo europecv's class keeps in the tree,
  at their size; 13 leave their bibliography out, which item 13's report names as dropped.
- **Time is not the constraint, but XeTeX takes the most of it**: the median document compiles in
  545 ms, a pdfTeX one in 370 ms and a XeTeX one in 2.7 s, the slowest in 5.2 s, two passes from
  the stock format, fontconfig's scan and unicode-math's fonts in each XeTeX pass. Item 5's probes
  and item 7's checks compile from a dumped format with no scan, and have room.

## Consequences

- The reference is the original compiled for DVI output: its PDF-mode drivers taken for
  dvipdfmx's, pdfx for what it loads and `\pdfoutput` set to 0, its paths above its folder
  rewritten, its images blank stand-ins of their size, a missing one 1 by 1, fonts found by name
  through fontconfig on XeTeX. It sets the glyphs the author's PDF sets but where a 1 by 1 stand-in
  takes a missing image's place, or two images of one name share a size on pdfTeX, which the
  warnings say; and a regenerated body compiled the same way sets the same, colours, links and
  images with them.
- The first XeTeX reference compile of a session reads every OpenType and TrueType file of the
  tree for fontconfig's scan, 286 files and 57.5 MB, which the browser's worker reads one
  synchronous request at a time (decision 0010): item 12 has to fetch them ahead, or item 8's table
  can name each font's file so that the scan is not needed, before an import in the browser starts
  on XeTeX.
- A document that needs pdfTeX's PDF mode past the drivers, pdfx and `\pdfoutput`, one that calls
  a PDF-mode primitive and does not ask for XeTeX, is refused; the corpus has none left.
- An image in a format with no stand-in, EPS above all, stops a document that shows it, and the
  reference compile says so; the corpus shows none it holds. A path above the main file's folder
  that a macro builds cannot be reached: two documents stop there. An image past 10,000 pixels on a
  side that a document shows gets a 1 by 1 stand-in, and moves the page, and so does one past the
  upload's budget for reading images, or a PDF whose box cannot be read.
- A stand-in whose path holds a character past letters, digits, `.`, `_`, `-` and `/`, a space
  among them, is not shown, so the PDF of a document that shows one is refused: item 12, which
  makes an imported resume's PDF, has to give such a stand-in a plain path, and the document's
  name for it with it, or leave the image out.
- The corpus's zips hold the tree's copy of each font the manifest names and none of its images,
  and miss the sidebars AltaCV names through a macro, so the corpus numbers undercount what a
  person's own zip would compile by those documents.
- The survey and the intake read source the same way, from `src/import/`, and item 4's parser,
  item 5's probe and item 7's checks build on `glyphStream` and `sameGlyphs`, which see colour,
  links, images and what XeTeX does to a font, and set aside only the editor's markers and a whole
  compile's first shipout.
