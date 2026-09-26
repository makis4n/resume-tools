# 0020. The parser

Date: 2026-09-26 · Status: proposed

## Context

Milestone 3 item 4 turns the body of a resume the intake took in and the reference compile
compiled (decision 0019) into a tree: what the probe (item 5) wraps in markers, the naming step
(item 6) describes to a model, and the assembly (item 7) maps onto the model, and what prints back
to source that sets the reference's glyphs. Plan section 6 step 2 describes it. The code is under
`apps/editor/src/import/`: `signatures.ts` asks the engine what a body's commands are, `parse.ts`
splits, inlines and builds the tree, with `arguments.ts`, `standard.ts`, `richtext.ts` and
`dates.ts` under it, and `print.ts` prints it back. `corpus parse` runs it over the corpus.

## Decision

### Signatures come from the engine

- The parser never reads a class or a package for a definition. TeX has read them, and
  `\meaning` gives back what it made of each macro: the spacing and comments a fork changed are
  gone, and what a class builds with `\csname`, `\let` or a package's machinery is there as it is.
- One compile, of the document's own preamble from the stock format, in the reference's job, with
  its files (the intake's, its `.bbl`, the stand-ins the reference added and the compatibility
  files, `referenceFiles`) and on its engine, goes past `\begin{document}` and prints to
  `import.rtm`, one record for each name the body uses that the table does not know, and for each
  environment it opens its `\x` and `\endx`: the meaning, and for an xparse command or environment
  its specification (`\GetDocumentCommandArgSpec`, `\GetDocumentEnvironmentArgSpec`). The code is
  expl3, which the kernel holds; it reads the names from `import.rtn`, one a line with a `|` after
  it, since TeX drops a line's trailing spaces and a robust command's real macro ends in one, and
  stops the run with `\@@end`, so no page ships and no end-of-document hook runs. The `import.*`
  names are ones the intake refuses in an upload (decision 0019), so none can be the upload's.
- `\write` writes a line to a file whole: `max_print_line` bounds only the terminal and the log.
  With `\newlinechar` off, a record's lines are its lines; a meaning of 27,000 characters comes
  back whole (`signatures.test.ts`). The session gains `written(job, path)`, which reads a file of a
  job's own folder by a path inside it and nothing else.
- The compile then follows every macro's meaning to the macros it names and prints theirs, the
  body's names first and a level at a time, to 2,048 names, passing over the table's names,
  LaTeX's scratch macros (`\reserved@a` and its kin, whose meaning is whatever was put in them
  last) and expl3's functions and variables. It reads a meaning back as tokens with every printable
  character a letter, so that a name TeX printed whole, `\cv@entry-style `, reads back whole; and
  beside a macro of a shape below it prints the macro that shape hands its work to, which reading
  back would split: `\x ` (a name ending in a space), `\\x` (a name starting with a backslash), and
  xparse's `\x code` and an environment's code.
- A second compile, from `\documentclass{article}` alone on the same engine, prints the same names
  in LaTeX's kernel. A macro defined the same way there is standard; every other macro is the
  template's, whether its class, a package or its preamble defines it. A name that is undefined, a
  primitive, a `\char`, a register or anything else a meaning shows is recorded as such.
- Two findings of the first corpus run shaped the code. The walk was quadratic, since expl3's
  sequences copy themselves on every change: a queue in numbered macros made the kernel's compile
  of 2,048 names 113 ms where it took 1.4 s. And setting the catcodes for reading back once for
  the whole walk, rather than once a meaning, and asking for a companion only when a meaning has
  its shape, took the walk from about 1.2 s to 0.3 s on an AltaCV fork, whose two compiles went
  from 3.3 s to 1.1 s.

### How a meaning gives a signature

- A plain macro, `macro:#1#2->...`, takes one mandatory argument for each parameter: `m m`.
- A `\newcommand` with an optional first argument is `\@protected@testopt \x \\x {default}`; its
  second macro, `\\x`, has the parameters, `[#1]#2`: `o m`. A command written by hand that looks
  ahead with `\@ifnextchar [` or `\@ifstar` is read through the branch it hands to, `[#1]#2` or the
  star's; the table counts these with the optional-argument form. They made europecv's entries
  calls, where the first run left 12 of its macros unresolved.
- A `\DeclareRobustCommand` is `\protect \x  `, or `\x@protect \x\protect \x  ` for a control
  symbol; its real macro is `\x `, read in turn as any of the others.
- An xparse command's specification is its own, its processors (`>{...}`) taken out.
- An alias of a command the table knows, `\let\x\textbf` or `\let\x\section`, whose real macro the
  walk never prints, takes the table's arguments.
- A macro with delimited parameters, one that looks ahead any other way, and an xparse
  specification unified-latex's reader does not take (`v`, `u`, embellishments) are unresolved,
  and the parser keeps their calls raw, the command alone.

### Definitions and hashes

- A template macro's definition is its meaning, closed over the template macros it names and those
  it hands its work to, the first reached first, to 64 macros and 64 KB of meanings together; the
  closure says when it stopped at its cap. Each macro keeps the SHA-256 of its meaning in UTF-8,
  which item 6's cache key is built from with its dependencies' and the naming version. The same
  macro hashes the same on pdfTeX and on XeTeX (`signatures.test.ts`).
- A package's macros are the template's by this rule, and TikZ's and pgf's fill a closure fast:
  a command that draws a tag reaches 63 of them. The walk's cap of 2,048 names stops nine corpus
  documents early, six AltaCV forks and three moderncv documents, whose classes load TikZ with
  paracol or microtype beside it, but only after every name the body uses and the levels nearest
  them.

### Splitting and inlining

- The main file is split at the first `\begin{document}` and the `\end{document}` after it,
  outside comments; one without both is refused. The preamble stays text for item 7.
- `\input`, `\include` and `\subfile` of a `.tex` file the job holds are inlined, never one of the
  tree: `\input{x}` and `\subfile{x}` add `.tex` to a name without an extension, `\include{x}`
  always, as LaTeX does. `\endinput` ends a file after the rest of its line, which TeX reads; a
  newline is added where a file lacks a final one; a subfile gives its body alone. An `\include` is
  inlined between two `\clearpage`s, as LaTeX reads one, and as the one `\clearpage` it leaves when
  the preamble's `\includeonly` leaves it out. An input the job does not hold, one of another kind,
  one already being read and one past 16 inputs deep stay as they are. The body records where each
  of its spans came from: a file and an offset in it, or the parser, for what inlining adds.
- The added newline makes the inlined body read as TeX reads the input in every case the corpus has,
  a `\input` on a line of its own, where TeX's two spaces and the body's blank line both come in
  vertical mode. Mid-paragraph, the blank line would end the paragraph where TeX sets a space; the
  round trip would show it.

### The tree

- unified-latex parses the body with nothing attached (`parseMinimal`); the parser reads each
  command's arguments itself (`arguments.ts`), by the table's specification or the engine's, and
  places what it reads. It reads as TeX does where unified-latex does not: one token for an
  argument that is not braced, so `\'etude` accents the `e` alone; past spaces and comments before
  an argument, but not a blank line; a line's end in `\r\n` as one line's end, where unified-latex
  reads a blank line; and a `%` in the address of `\href`, `\url` or `\nolinkurl` as a character, as
  hyperref reads it, where unified-latex reads a comment and loses the rest of the line. It reads a
  delimited argument through unified-latex's own reader (`gobbleSingleArgument`), given only the
  nodes up to the closing delimiter, and never takes nodes out of the array it reads: taking them
  out, as unified-latex's reader does, made a megabyte of short calls take 6.1 s, where it takes
  0.3 s.
- **Rich text**, the model's `RichText`, is what the table decodes, a paragraph at a time: the
  escapes `\& \% \$ \# \_ \{ \}` and `\textbackslash`; the ligatures `--`, `---`, the quotes and the
  inverted question and exclamation marks; `~` a no-break space, `\,` a thin space, U+2009;
  `\textbullet`, the letters `\ss`, `\ae`, `\o`, `\l`, `\i` and their kin, the dashes, quotes and
  dots by name, and what the generator writes for the characters TeX reads as something else
  (decision 0007), `\textless{}` and its kin and `\allowbreak`; every accent command, `` \` \' \^ \"
  \~ \= \. \u \v \H \c \d \b \r \k \t ``, composed with its letter, `\i` taken for `i`; `\textbf`,
  `\textit`, `\emph` (which turns italic over) and `\textsc` (text with no mark); `\bfseries`,
  `\itshape`, `\bf`, `\it` and `\em` inside a group, since an argument is not one;
  `\href{url}{text}` a link, its address as hyperref turns it back; `\url{x}` its address, linked;
  `\nolinkurl{x}` its address alone; and `\\` a space inside a paragraph, since a field is one.
  Whitespace is TeX's: a run of spaces and a single line's end are one space, a blank line ends a
  paragraph, the spaces after a control word are skipped, and a comment takes its line's end with
  it. A group is text when all it holds is text in one paragraph.
- **Dates**: a whole argument or a whole text with no mark that reads as a date or a range becomes
  the model's `Dates`, with the text as it reads: English months full or in three letters, with or
  without a period, and `Sept`; `01/2020` and `2020-01`; a year, 1900 to 2100; ranges on a hyphen,
  `--`, `---`, an en or em dash, or `to`; and an open end, `Present`, `Current`, `Now`, `Ongoing`
  or `Today` in any case. Anything else stays text; `Jun - Aug 2019` does.
- **Sections**: `\part`, `\chapter`, `\section` and down to `\subparagraph`, their star, their
  optional title and their title, placed as any argument is.
- **Lists**: `itemize`, `enumerate` and `description`, their options kept as they are, and an item
  for each `\item`, its label and what follows it to the next. A template environment's body is
  split at its `\item`s the same way; an `\item` outside a list, as between a template's commands
  that open and close one, takes the text and raw chunks after it, up to the next `\item`, a blank
  line, or anything else the parser places.
- **Template calls** and **template environments**: a command or an environment the engine says
  the template defines, its arguments read by its signature, each a subtree, the optional ones
  marked and the star kept. A call a mandatory argument of which is missing stays raw.
- **Groups** and **blocks**: a braced group that is not text, and `center`, `flushleft`,
  `flushright`, `quote`, `quotation`, `verse`, `minipage` and `multicols`, whose content the parser
  places.
- **Raw chunks**, byte for byte: mathematics, verbatim, `tabular` and every environment the table
  does not place and the engine did not resolve as the template's; commands whose effect is not
  text, from the table (spacing, breaks, sizes, font switches, rules, boxes, colours, graphics,
  lengths, references, definitions), with the arguments LaTeX's kernel, xcolor, hyperref, multicol
  and geometry give them in unified-latex's CTAN table, but for a few it has wrong; TeX's own
  definitions, `\def` with its parameters and body and `\let` with its token, whole; a primitive or
  a register with the quantity after it, `\vskip 3pt plus 1pt`; and any command the table does not
  know and the engine did not resolve, alone. A raw chunk is the smallest node the parser cannot
  place: `\vspace{2pt}` between two paragraphs is one chunk, and a command whose argument is text
  the page shows, `\textcolor{red}{...}`, `\underline`, a box, `\textbf` over a call, keeps that
  argument placed inside it, so that a call in it is still a call.
- Every node keeps its span in the inlined body, and every argument its span and its content's.
  `print(tree)` gives back the body's bytes for every span, a node's children in turn and the
  body's between them, so that a tree printed as it was parsed is the inlined body exactly, and a
  caller can put what it makes in the place of any node or argument.

### The caps

- A body of at most 5 MB in UTF-8 once inlined, the intake's cap on an upload's text; inlining
  stops as soon as it passes it, so that repeated inputs cannot run it up.
- Nesting of at most 64 groups and environments, read before unified-latex parses, since its parse
  recurses with them, and a tree of at most 64 levels, since a list and its items nest twice.
- A tree of at most 200,000 nodes. Past any cap the parse is refused with a plain message, which
  names no source, under a new refusal reason, `parse`.
- The parser's work grows linearly: `parse.test.ts` bounds a megabyte of groups nested 50 deep and
  a megabyte of short calls against a tenth of each, in CPU time. unified-latex's parse takes about
  1.5 s a megabyte of it.

### Dependencies

unified-latex 1.8.4, MIT: `@unified-latex/unified-latex-util-parse`, `-util-arguments`,
`-util-argspec`, `-util-visit`, `-ctan`, and `-types` for its types. `-util-to-string` is not added:
it pulls Prettier 2 and 3 into the browser's bundle, and printing by spans needs no printer of
unified-latex's. `-util-macros`, which expands macros, is not needed either.

## The corpus

`corpus parse` on 26 September 2026, the tree of layout 6, the M4 Pro, four children: 1.4 minutes.

|  | jake | awesome-cv | altacv | moderncv | europecv | other | all |
|---|--:|--:|--:|--:|--:|--:|--:|
| Documents with a reference | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Parsed | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Refused by the parser | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| No signatures: the compile that prints them stopped | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Printed back byte for byte | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Round trip sets the reference's glyphs | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Round trip differs | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Round trip did not compile | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Template macros the body calls** |  |  |  |  |  |  |  |
| In all | 270 | 107 | 162 | 54 | 62 | 145 | 800 |
| Per document, median | 7 | 6 | 15 | 4 | 8 | 2 | 6 |
| Arguments read from its meaning | 270 | 88 | 147 | 30 | 32 | 135 | 702 |
| Arguments read from the optional-argument form | 0 | 18 | 11 | 24 | 29 | 8 | 90 |
| Arguments read from the robust form | 0 | 0 | 1 | 0 | 0 | 1 | 2 |
| Arguments read from xparse | 0 | 0 | 2 | 0 | 0 | 1 | 3 |
| Arguments read unresolved | 0 | 1 | 1 | 0 | 1 | 0 | 3 |
| Template environments the body opens | 0 | 69 | 10 | 0 | 6 | 20 | 105 |
| Template macros with their closures, per document, median | 7 | 320 | 1734 | 1756 | 89 | 10 | 31 |
| Signatures stopped at the cap of names | 0 | 0 | 6 | 3 | 0 | 0 | 9 |
| Names undefined when the preamble ends | 6 | 2 | 9 | 0 | 0 | 31 | 48 |
| **The body's characters** |  |  |  |  |  |  |  |
| In rich text and dates | 13% | 3% | 41% | 8% | 69% | 40% | 25% |
| In template calls' arguments | 50% | 53% | 19% | 66% | 4% | 13% | 33% |
| In raw chunks | 5% | 0% | 2% | 2% | 9% | 24% | 10% |
| Dates read | 203 | 185 | 111 | 143 | 8 | 205 | 855 |
| Parse time, median | 7 ms | 11 ms | 6 ms | 6 ms | 3 ms | 8 ms | 7 ms |
| Parse time, slowest | 18 ms | 25 ms | 101 ms | 16 ms | 12 ms | 59 ms | 101 ms |
| Signatures' two compiles, median | 232 ms | 1526 ms | 978 ms | 904 ms | 293 ms | 251 ms | 316 ms |
| **Unresolved, by why** |  |  |  |  |  |  |  |
| delimited | 0 | 1 | 1 | 0 | 1 | 0 | 3 |

"Template macros the body calls" counts each macro once a document. The first run of this item
refused six documents whose bodies use nothing the table does not know, wrongly, and stopped a
seventh's walk early on a meaning holding a control character, which reading it back took for an
invalid character; its round trips were the same as these. The three unresolved macros are
biblatex's `\nocite`, whose parameters are delimited, in two documents, and textpos's `\atxy(x,y)`.
Of the 48 names undefined when the preamble ends, 9 are paracol's `\switchcolumn` and 3 TikZ's
`\node` and `\draw`, which exist only inside their environments, 7 are `\height`, which exists
only in a box's dimensions, and 29 are five documents' own, which the signatures, read at
`\begin{document}`, do not see: 11 in one document, 11 in another, and 7 in three more.

### What the table says for items 5 and 6

- **The round trip holds on every document**: the tree prints back the inlined body byte for byte,
  and that body, with the preamble, sets the reference's glyphs, on all 117, pdfTeX and XeTeX. What
  item 5 wraps and item 7 splices starts from a body that compiles as the original did.
- **A third of a resume's characters are in template calls' arguments**, and a quarter in rich
  text, the rest the commands' own names, delimiters, spaces and raw chunks. Jake's Resume forks
  (50%), Awesome-CV's (53%) and moderncv's (66%) are mostly calls: item 5's probe has most of their
  text to wrap. Hand-rolled documents are mostly rich text (40%) and raw chunks (24%), and AltaCV's
  and europecv's too (41% and 69% text): for them the model's paragraphs and lists matter more than
  the naming step.
- **A document calls few template macros**: 6 at the median, 15 for AltaCV's, 2 for a hand-rolled
  one; 800 in the corpus, 105 environments besides. Item 6 names few macros a document, and forks
  share them, which is what its per-macro cache is for.
- **The engine resolves all but 3 of the 800**: 702 from their meaning, 90 from the
  optional-argument form, 2 from the robust form, 3 from xparse. What item 6 describes for a call
  has its arguments right.
- **Closures are large where TikZ or paracol is loaded**: a median of 31 template macros a
  document, but 1,734 for AltaCV's and 1,756 for moderncv's, most of them pgf's, microtype's and
  paracol's. By this record's rule they are the template's; item 6 sends a macro's closure capped at
  64 macros and 64 KB, and a closure that reaches TikZ is mostly TikZ. Item 6 may want to send the
  preamble's and the class's macros before a package's, which only a source's own text can tell.
- **Time**: parsing takes 7 ms at the median and 101 ms at most. The signatures' two compiles take
  232 ms for a Jake's Resume fork and up to 1.5 s for an Awesome-CV fork, the preamble's compile
  from the stock format, fontspec's scan included, most of it: an import pays them once.

## Consequences

- The import pipeline has a tree with every command's arguments read as TeX reads them, and a
  printer that gives back the body's bytes wherever nothing was changed; items 5 and 7 splice at
  spans, and item 7 regenerates what the model holds.
- Signatures cost two compiles an import, one of the preamble on the reference's engine, which
  item 19 counts in the 5 s bar; the second, of `article` alone, could be cached for an engine and a
  set of names, which this record does not do.
- A macro the body defines is undefined when the preamble ends, and its calls stay raw: the
  signatures are read at `\begin{document}`, not where the body defines one.
- A command the table knows is read by the table, even where a class redefines it: moderncv's
  `\section` is xparse's `s m`, where the table reads `s o m`, which reads its calls the same but
  for one that gives an optional argument.
- The walk prints a package's macros as the template's, and caps at 2,048 names; a document that
  loads TikZ spends most of its cap, and of its closures, on TikZ.
- The session reads a file a compile wrote in its job, by a path inside its folder; the reference
  compile gives back its files (`referenceFiles`) and compiles a document as it did
  (`compileLikeReference`); and `difference` says how two glyph streams first differ, which the
  runner counts.
