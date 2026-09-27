# 0020. The parser

Date: 2026-09-26 · Status: proposed

## Context

Milestone 3 item 4 turns the body of a resume the intake took in and the reference compile
compiled (decision 0019) into a tree: what the probe (item 5) wraps in markers, the naming step
(item 6) describes to a model, and the assembly (item 7) maps onto the model, and what prints back
to source that sets the reference's glyphs. Plan section 6 step 2 describes it. The code is under
`apps/editor/src/import/`: `signatures.ts` asks the engine what a body's commands are, with
`packages.ts` for a few packages' commands, `parse.ts` splits, inlines and builds the tree, with
`arguments.ts`, `standard.ts`, `richtext.ts` and `dates.ts` under it, and `print.ts` prints it
back. `corpus parse` runs it over the corpus.

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
- `\write` writes a line to a file whole: `max_print_line` bounds only the terminal and the log;
  a meaning of 27,000 characters comes back whole (`signatures.test.ts`). With `\newlinechar` off
  a record's lines would be its lines, but TeX writes a few control characters raw: pdfTeX the
  characters 9, 10 and 11, XeTeX the character 10, which the kernel's `\GenericError` family
  holds as `^^J`. The first version's records split on them in 62 corpus documents of 111, a
  meaning cut short and the rest read as lines of no record, and a meaning holding one hashed
  differently on the two engines. The code writes those three as `^^I`, `^^J` and `^^K`
  (`\str_replace_all:Nnn`), as both engines write every other control character, and each line
  of the file is read alone, as UTF-8 or, where it is not, as Latin-1. No corpus document's file
  now has a line that is no record's, and a meaning holding each control character reads the same
  on both engines (`signatures.test.ts`). The session gains `written(job, path)`, which reads a
  file of a job's own folder by a path inside it and nothing else.
- The compile then follows every macro's meaning to the macros it names and prints theirs, the
  body's names first and a level at a time, to 2,048 names, passing over the table's names,
  LaTeX's scratch macros (`\reserved@a` and its kin, whose meaning is whatever was put in them
  last) and expl3's functions and variables. It reads a meaning back as tokens with every printable
  character a letter, so that a name TeX printed whole, `\cv@entry-style `, reads back whole; and
  beside a macro of a shape below it prints the macro that shape hands its work to, which reading
  back would split: `\x ` (a name ending in a space), `\\x` (a name starting with a backslash),
  twoopt's `\2\x`, and xparse's `\x code` and an environment's code. The same catcodes are in
  force while it prints, so TeX prints a space after every control sequence but the control
  space, and a meaning's names read back from the file the same way.
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

- A plain macro, `macro:#1#2->...`, takes one mandatory argument for each parameter, `m m`, and
  then what the command its replacement text ends with takes beyond the brace groups that follow
  it there: `\ding` is `\Pisymbol {pzd}`, and `\Pisymbol` takes two, so `\ding` takes one;
  `\newcommand\cvsection{\section}` takes `s o m`. The tail's arguments are its own signature's,
  the engine's or the table's, or, for an expl3 function, what its name's signature says
  (`\__cmd_if_no_value:nTF` takes three), followed three commands deep at most. A conditional
  whose every branch ends with `\expandafter` and a command, as etoolbox's `\ifblank` does, hands
  on to those commands when they take the same. A name another command takes as its own argument
  (`\def\x{...}`, `\let\x\y`, `\setlength\x\y`, `\kern\z@`, `2\p@`) is no tail.
- A tail whose arguments cannot be read leaves the macro the arguments its meaning shows, marked
  `tail: "unresolved"`, so that the parser can keep a call to it cautious: a look ahead at the
  end, `\futurelet`, a name built with `\csname`, `\expandafter` before the last command, a
  primitive or a register the walk does not print, or a chain past three commands. Of the 800
  template macros the corpus's bodies call, 24 are marked: paracol's `\columnratio`, which looks
  ahead for its second ratio, in nine documents; europecv's `\ecvitem`, which ends with
  `\tabularnewline`, `\relax` when the preamble ends and a look ahead for `[` inside the table, in
  six; four text symbols LaTeX dispatches by the font encoding, in five; and four others.
- A `\newcommand` with an optional first argument is `\@protected@testopt \x \\x {default}`; its
  second macro, `\\x`, has the parameters, `[#1]#2`: `o m`, and what its tail takes. twoopt's
  `\newcommandtwoopt{\x}[n][a][b]` makes this form, whose second macro scans for a second
  optional argument (`\to@ScanSecondOptArg`) before handing both to `\2\x`: `o o` and n - 2
  mandatory arguments, one corpus document's `\cvitem`, which the first version read as `o`.
- A command written by hand that looks ahead with `\@ifnextchar [`, `\@ifnextchar *` or `\@ifstar`
  is read through the branch it hands to, walked past the flags it sets (`\@xtrue`, `\@xfalse`,
  `\let` and its two tokens, `\def` and its kin with their bodies, `\relax`, `\global`) and past
  commands that take nothing, to the first that takes arguments: after `[`, one whose parameters
  are `[#1]#2` or whose first argument is optional; after `\@ifnextchar *`, which leaves the star
  in place, one whose parameters are `*#1`; and after `\@ifstar`, the same arguments in both
  branches. A branch with no such command, or a star's two branches that differ, leave the
  command unresolved: it is never read as a star alone. europecv's `\ecvitem`,
  `\@ifstar{\@ecvitemstartrue\@ecvitem}{\@ecvitemstarfalse\@ecvitem}` over `\@ecvitem`'s
  `[#1]#2#3`, reads `s o m m`, where the first version read `s` and left the arguments of its 247
  calls outside them; bibentry's `\nobibliography`, whose star branch gives its argument and plain
  branch takes it, is unresolved in three documents. The table counts these with the
  optional-argument form.
- A `\DeclareRobustCommand` is `\protect \x  `, or `\x@protect \x \protect \x  ` for a control
  symbol; its real macro is `\x `, read in turn as any of the others.
- An xparse command's specification is its own, its processors (`>{...}`) taken out.
- Some packages' commands take arguments their meaning does not show: ulem's underlines
  (`\uline`, `\uuline`, `\uwave`, `\sout`, `\xout`, `\dashuline`, `\dotuline`) hand theirs on
  from inside a conditional, soul's (`\so`, `\ul`, `\st`, `\hl`, `\caps`) scan them a token at a
  time, and ifthen's `\ifthenelse` takes its test and leaves its two branches to `\@firstoftwo` or
  `\@secondoftwo`. `packages.ts` gives their arguments, and pifont's `\ding`'s, before the
  meaning's, when the name is one of them and its meaning holds a mark of the package's
  definition, so that a document's own `\uline` is read from its own meaning. The signature names
  the package (`package`), and `how` keeps the shape of the meaning. The corpus calls `\ding` and
  `\uline` in a document each and `\ifthenelse` in two.
- An alias of a command the table knows, `\let\x\textbf` or `\let\x\section`, whose real macro the
  walk never prints, takes the table's arguments.
- A macro with delimited parameters, one that looks ahead any other way, and an xparse
  specification unified-latex's reader does not take (`v`, `u`, embellishments) are unresolved,
  and the parser keeps their calls raw, the command alone.

### Definitions and hashes

- A template macro whose replacement text holds no parameter and names nothing but text is data,
  the person's: a preamble's `\name{Quill}{Invented}` sets `\@firstname` to one, `\email{...}`
  `\@email`, and AltaCV's `\personalinfo{...}` `\@personalinfo`. Text is characters, `~`,
  `\relax`, `\@empty`, `\protect` and `\space`; what the table decodes as text (the escapes,
  symbols, letters and accents, `\textbf` and the other marks, the declarations, `\href`, `\url`,
  `\\`); spacing and breaks (`\enskip`, `\quad`, `\,`, `\smallskip`, `\par`, `\hspace{...}` and
  their kin, and `\cdotp`, which Awesome-CV's example puts between a person's positions); and a
  template command that takes arguments, given them as brace groups, as `\email{...}` in a list
  of contacts, when the macro itself takes none. A narrower rule, characters and those first five
  alone, left a name with an accent (`Jos\'e`), Awesome-CV's positions and AltaCV's contacts as
  definitions holding the person's text. The result keeps a data macro's kind and the length of
  its text, never the text; a closure names it, follows it no further and counts it against
  neither cap, and it takes no part in any hash or key. 6,402 of the corpus's 42,534 template
  macros are data.
- Every other template macro is a definition, and its meaning is kept with what item 11's
  patterns find masked, before it is hashed or stored: links (a scheme and an address, `www.` and
  one, or a domain and a path), email addresses, and runs of seven digits or more with
  separators, which phone numbers are, each by a placeholder of its own length,
  `<email______________>`. A definition then hashes the same whoever's address it holds; the
  corpus's definitions hold 1,112 placeholders.
- Scratch macros are neither, and take no part in any closure or hash: LaTeX's `\@temp...`,
  `\reserved@...`, `\...@tempa` to `\...@tempf`, `\@gtemp...`, `\@curr...`, `\@x...`
  (`\@ifnextchar`'s helpers) and `\CurrentOption`, xkeyval's `\XKV@...` and ltxcmds'
  `\LTXcmds@...`, expl3's `l_`, `g_` and `c_` variables, and what `\@ifpackageloaded` reads,
  `\ver@...` and `\opt@...`. Their meaning is whatever was put in them last, a preamble's
  `\setkeys` or its options among it.
- A definition's closure is the template macros its meaning names and those it hands its work
  to, then theirs, the first reached first, to 64 definitions and 64 KB of meanings together; the
  closure says when it stopped at its cap. Each definition keeps the SHA-256 of its masked meaning
  in UTF-8, and `keysOf` gives its key, the SHA-256 of its hash and its definition dependencies'
  hashes in order: item 6's cache key but for the naming version. Two documents whose class or
  style is the same file give each macro the file defines, and the preamble leaves alone, the
  same key, whatever the person's name, contacts and settings (`signatures.test.ts`). In the
  corpus nine pairs of documents share a class and give it the same setting (the runner's table
  below): three moderncv documents in the classic style and blue, two in the casual and blue,
  three Awesome-CV forks sharing a class file, two europecv documents and two AltaCV forks. Eight
  give every macro of the class that both bodies call one key. The AltaCV pair's `\cvsection` and
  `\makecvheader` differ, because both preambles define `\cvsectionfont` and `\personalinfofont`,
  which the two hand their work to, each its own way; no key differs otherwise. A macro the
  preamble defines itself, as Jake's Resume forks do their `\resumeSubheading`, is the preamble's.
  The same macro hashes the same on pdfTeX and XeTeX.
- What still holds a person's text is a definition a preamble builds of the person's details and
  code, as two europecv documents' `\SignatureAndDate` holds the place they sign in, or a class a
  fork edited to hold them. Item 11 masks those by the document's own header values before
  anything leaves the browser.
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
  always, as LaTeX does. A subfile gives its body alone. An `\include` is inlined between two
  `\clearpage`s, as LaTeX reads one, and as the one `\clearpage` it leaves when the preamble's
  `\includeonly` leaves it out. An input the job does not hold, one of another kind, one already
  being read and one past 16 inputs deep stay as they are. The body records where each of its spans
  came from: a file and an offset in it, or the parser, for what inlining adds.
- `\endinput` is honoured only where it begins its line, spaces aside: the file is read up to that
  line and none of it, and adds no newline. One after something else on its line is not honoured,
  and the file is inlined whole, the command with it: that is most often a guard,
  `\ifdefined\x\endinput\fi`, which TeX reads through the first time. An unconditional `\endinput`
  in the middle of a line, which the first version cut at, no longer is; the corpus has no
  `\endinput` at all.
- A file ends in a newline, one added where it lacks one, as TeX ends every line it reads with a
  line's end; an empty file is one empty line to TeX, which ends a paragraph, so it is a blank
  line wherever its input is. Where the input is the last thing on its line, TeX reads the file's
  last line's end and then the input's own: two spaces in a paragraph (the engine shows them, the
  second as wide as the first). The two newlines alone, as the first version gave, make a blank
  line, which ends the paragraph; one alone, as the review proposed, sets one space. So an empty
  group goes before the input's line's end, `{}`, the parser's in the body's record of its spans:
  it gives the second space and sets nothing, and in vertical mode it starts no paragraph. It keeps
  the line of an input whose file `\endinput` ends on its first line a space, not a blank line,
  too. A bare name, `\input x`, is different: TeX takes the line's end after it as the name's end,
  so the file's last line's end stands for it, and no group is added. Twelve shapes of input, on a
  line of their own or in one, braced or bare, a file with a newline or without, empty or ended at
  once, and `\include`, now set the reference's glyphs printed byte for byte, where the first
  version's differed for an input alone on its line inside a paragraph (`parse.test.ts` compiles one
  document holding seven of them); regenerated, the model's text holds one space where TeX set two,
  which the second round trip shows.

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
  inverted question and exclamation marks; `~` a no-break space; `\textbullet`, the letters `\ss`,
  `\ae`, `\o`, `\l`, `\i` and their kin, the dashes, quotes and dots by name, and what the generator
  writes for the characters TeX reads as something else (decision 0007), `\textless{}` and its kin
  and `\allowbreak`; every accent command, `` \` \' \^ \" \~ \= \. \u \v \H \c \d \b \r \k \t ``,
  composed with its letter, `\i` taken for `i`, where the generator writes the letter back as the
  one character it is (below); `\textbf`, `\textit`, `\emph` (which turns italic over) and
  `\textsc` (text with no mark); `\bfseries`, `\itshape` and `\em` inside a group, since an argument
  is not one, and `\bf` and `\it` there too, each `\normalfont` and one attribute, so that it clears
  the other mark first; `\href{url}{text}` a link, its address as hyperref turns it back; `\url{x}`
  its address, linked; `\nolinkurl{x}` its address alone; and `\\` a space inside a paragraph,
  since a field is one. Whitespace is TeX's: a run of spaces and a single line's end are one space,
  a blank line ends a paragraph, the spaces after a control word are skipped, and a comment takes
  its line's end with it, and one on a line of its own adds no space where a comment took the line
  end before it. A group is text when all it holds is text in one paragraph, and one that sets
  nothing, `{}`, is no text at a paragraph's edge. An `\item`'s label is read in a state of its
  own, as LaTeX sets it in a box: a declaration in it marks nothing after it.
- **What the generator cannot write back stays raw**, the smallest node, where the first version
  decoded it and the regenerated round trip (below) showed other glyphs, or a compile that
  stopped: a control space, which the generator writes as a space that stretches after a period;
  `\,`, which it writes as a word space; `\@`; an accent over nothing, `\~{}`, `\^{}` or `\'{}`, which
  sets the text font's accent where the character sets another font's or an ASCII glyph; an accent
  whose letter lies past Latin Extended-A and is not one of the few LaTeX defines there, `\d{a}`,
  `\b{a}`, a stacked `\~{\^e}`, which the generator decomposes on pdfTeX (a mark LaTeX has no
  definition for stops the compile), or that leaves a mark nothing composes with, `\t{oo}` (the
  test is the generator's own `escapeText` giving the letter back unchanged, with no mark); and
  typewriter text, `\texttt{...}`, and what `\ttfamily` or `\tt` sets to the end of its group, or
  of a list's items, which share its font, since the model has no monospace mark and typewriter
  fonts make no ligature of `--`. `\d{s}`, `\v{a}` and the like, which LaTeX defines, decode.
- **Font declarations the model has no mark for**, `\normalfont`, `\rm`, `\sf`, `\sl`, `\sc`,
  `\upshape`, `\slshape`, `\scshape`, `\mdseries`, `\rmfamily`, `\sffamily`, stay raw, in place, and
  inside a group clear the marks of the text after them that their axis holds: `\sc` both, as
  `\normalfont` and a shape, `\scshape` italic, `\mdseries` bold.
- **Dates**: a whole argument or a whole text with no mark that reads as a date or a range becomes
  the model's `Dates`, with the text as it reads: English months full or in three letters, with or
  without a period, and `Sept`; `01/2020` and `2020-01`; a year, 1900 to 2100; ranges on a hyphen,
  `--`, `---`, an en or em dash, or `to`; and an open end, `Present`, `Current`, `Now`, `Ongoing`
  or `Today` in any case. An academic year, `2019-20` or `2019–20`, whose second part is the next
  year's last two digits, is the range of the two years; otherwise the second part is a month only
  from 01 to 12, so `2010-11` is 2010 to 2011, and `2020-12` December. Anything else stays text;
  `Jun - Aug 2019` does.
- **Sections**: `\part`, `\chapter`, `\section` and down to `\subparagraph`, their star, their
  optional title and their title, placed as any argument is.
- **Lists**: `itemize`, `enumerate` and `description`, their options kept as they are, and an item
  for each `\item`, its label and what follows it to the next. A template environment's body is
  split at its `\item`s the same way; an `\item` outside a list, as between a template's commands
  that open and close one, takes the text and raw chunks after it, up to the next `\item`, a blank
  line, or anything else the parser places.
- **Template calls** and **template environments**: a command or an environment the engine says
  the template defines, its arguments read by its signature, each a subtree, the optional ones
  marked and the star kept. A call a mandatory argument of which is missing stays raw. So does a
  call whose signature takes no mandatory argument, ends in an optional one, or is marked `tail`
  whatever it takes, and which a group follows, spaces and comments between: the signature of a
  macro that hands its arguments on to another, `\ding` to `\Pisymbol{pzd}`, or looks ahead for
  them, reads so from its meaning, and the group would otherwise read as text the call in fact
  takes. The call and the groups after it are one raw chunk, unresolved and marked `suspect`, and
  the runner counts them per family. A template environment whose body holds an alignment's `&` of
  its own, a bare one where TeX reads it as a table's tab, not in a group, mathematics, verbatim, a
  comment or a nested environment, and outside every template call's arguments, a bracketed one's
  too, keeps its arguments placed and its body one raw chunk: it is a table its author wrote by
  hand, and its cells are not text. One whose body holds template calls and no such `&` is placed,
  whatever the environment opens for them: Awesome-CV's `cvskills` and `cvhonors` open a `tabular*`,
  and europecv's `europecv` a `longtable`, whose rows `\cvskill`, `\cvhonor` and `\ecvitem` set;
  `parse.test.ts` compiles an invented class's three such environments, one of them a second time
  with its rows written by hand, and both round trips set the reference's glyphs. A body with an `&`
  among its own nodes is placed first, to find its calls' arguments; for a table, the placing is let
  go, and its nodes do not count against the caps. The first version of this rule read the
  environment's own macros' meanings instead, and kept the body raw wherever they opened `tabular`
  or its kin, which took those three environments' calls with it (below).
- **Groups** and **blocks**: a braced group that is not text, and `center`, `flushleft`,
  `flushright`, `quote`, `quotation`, `verse`, `raggedright`, `raggedleft`, `centering`,
  `samepage`, `sloppypar`, `minipage` and `multicols`, whose content the parser places; and a
  declaration used as an environment, a size, `\begin{small}` or `\begin{footnotesize}`, a series,
  a shape or a family, `\begin{bfseries}`, whose body is placed with the marks the declaration sets,
  bold, italic or `\em`'s turn, and the rest left to the generator's snippets. The first version
  kept them raw, the whole body of two corpus documents set in `footnotesize`; `\begin{ttfamily}`
  stays raw.
- **Conditionals whose branch is known**: what `\iffalse` skips, to its `\else` or `\fi` among the
  nodes after it, the conditionals between counted as TeX counts them (its own, and a name starting
  `if` the engine says is a primitive, as `\newif` makes), is one raw chunk, and so is what `\iftrue`
  skips from its `\else`; the branch TeX takes is placed as any content is, `\iftrue` and `\fi` raw
  alone. One whose `\fi` is in another group, and every other conditional, stays as it was, raw.
- **Raw chunks**, byte for byte: mathematics, verbatim, `tabular` and every environment the table
  does not place and the engine did not resolve as the template's; commands whose effect is not
  text, from the table (spacing, breaks, sizes, font switches, rules, boxes, colours, graphics,
  lengths, references, definitions), with the arguments LaTeX's kernel, xcolor, hyperref, multicol
  and geometry give them in unified-latex's CTAN table, but for a few it has wrong; TeX's own
  definitions, `\def` with its parameters and body and `\let` with its token, whole; a primitive or
  a register with the quantity after it, `\vskip 3pt plus 1pt`; a paragraph with an alignment's `&`
  in it, one of the source's and not `\&`, which is a table's cells, and, among nodes that hold
  such an `&` of their own (an environment's body, a group's or an argument's content, an item's),
  a paragraph with a `\\` that text follows in it, which there ends a table's row where the model
  would read a space; and any command the table does not know and the engine did not resolve,
  alone. A raw chunk is the smallest node the parser cannot place: `\vspace{2pt}` between two
  paragraphs is one chunk, and a command whose argument is text the page shows,
  `\textcolor{red}{...}`, `\underline`, a box, `\textbf` over a call, keeps that argument placed
  inside it, so that a call in it is still a call.
- Every node keeps its span in the inlined body, and every argument its span and its content's.
  `print(tree)` gives back the body's bytes for every span, a node's children in turn and the
  body's between them, so that a tree printed as it was parsed is the inlined body exactly, and a
  caller can put what it makes in the place of any node or argument.
- Printed so, a tree that is wrong gives back its bytes all the same, and the first version's round
  trip could not fail on what it read. `regenerate(tree, engine)` prints it the way item 7 will: every
  text as the generator writes its runs, escaped by `escapeText` (composed for XeTeX, whose fonts
  set letters whole), bold outside italic and a link outside both as `generate.ts`'s `richLatex`
  writes them, with its break opportunities; every date formatted by the generator's `formatDates`
  in the one of its four formats the date is spelled in, or left as its own text when it is spelled
  in none of them (`Sept 2019`, `2019-20`, a hyphen between the two ends). Where the text follows a
  control word, braces go before a letter or a space, which would join the name or be skipped; where
  it ended in one, which had TeX skip the spaces after it, `\relax` goes after it.

### The caps

- A body of at most 5 MB in UTF-8 once inlined, the intake's cap on an upload's text; inlining
  stops as soon as it passes it, so that repeated inputs cannot run it up.
- Nesting of at most 64 groups and environments, read before unified-latex parses, since its parse
  recurses with them, and a tree of at most 64 levels, since a list and its items nest twice.
- A tree of at most 200,000 nodes. Past any cap the parse is refused with a plain message, which
  names no source, under a new refusal reason, `parse`.
- The parser's work grows linearly: `parse.test.ts` bounds a megabyte of groups nested 50 deep and
  a megabyte of short calls against a tenth of each, in CPU time. A megabyte of either takes 0.7
  to 0.8 s to parse, unified-latex's parse 0.6 to 0.7 s of it.
- Every look ahead is bounded, where the first version's were not and the review timed openers that
  never close growing with the square of the body: a delimited argument's closer is looked for up
  to the paragraph's end or 2,048 characters on, whichever comes first (`MAX_DELIMITED`); an
  address, an `\href`'s options and a `\verb`'s text on their line and 2,048 characters at most,
  each line's end found once; and conditionals are matched to their `\else` and `\fi` in one pass a
  sequence. `parse.test.ts` bounds `\\[` repeated to 192 KB, `\item[x ` outside a list to 256 KB and
  `\iftrue` to 200 KB, parsed, and `\url{` to 400 KB on one line and `\verb!x!` to 1.4 MB, read
  before unified-latex parses, each against a tenth of it. 192 KB of `\\[` took 25 s to build a
  tree of, and takes 0.75 s now; 400 KB of `\url{` took 24 s to read, and takes 0.18 s.
- Each of those bounds is a ratio alone, the fastest of five runs of each size: a tenth costs a
  tenth, 10 to 12 times at rest, and up to 20 times while the whole suite runs beside it, the
  megabyte's larger heap slowed the most; the first version's openers cost 88 to 141 times. So
  each is bound by 50 times, as the snippet parse is, with no ceiling in milliseconds, which load
  can push a run past: the first bounds, 20 times and 15 s, failed under load.

### Dependencies

unified-latex 1.8.4, MIT: `@unified-latex/unified-latex-util-parse`, `-util-arguments`,
`-util-argspec`, `-util-visit`, `-ctan`, and `-types` for its types. `-util-to-string` is not added:
it pulls Prettier 2 and 3 into the browser's bundle, and printing by spans needs no printer of
unified-latex's. `-util-macros`, which expands macros, is not needed either.

## The corpus

### What the runner checks

- **Two round trips.** Each parsed document compiles again as the reference was, twice: its tree
  printed byte for byte, which says the body was split and inlined as TeX reads it and the tree lost
  no byte; and regenerated (`regenerate`), which says the tree read its texts and dates as the page
  sets them, since only that can fail on a tree that is wrong. The table counts both, and the first
  difference's kind of each. For a round trip that did not set the reference's glyphs, the runner
  keeps the printed document and its log under `.corpus/parse/`: the byte-for-byte one's, or the
  regenerated one's when only it differs.
- **Calls a group after them belies**, kept raw (`suspect`), counted per family: how many calls the
  engine's signatures still read short once the package-known ones are in.
- **Keys of a shared file.** For each two documents that hold a class or style file byte for byte,
  or load the same class from the tree, and give it the same setting, a pair for each such file:
  whether the keys (`keysOf`) of the file's macros both bodies call are the same, which item 6's
  cache needs. The setting is what changes what the file's macros become: the class's options,
  which every package sees, the options the preamble loads the file itself with, moderncv's style
  and colour, and the engine. The file's macros are the names its definitions give, read from the
  file, that a body calls or opens as an environment, but for those either preamble defines again,
  which are the preamble's. A key is its closure's, so a macro a preamble defines among those a
  called one hands its work to moves its key; the table counts those pairs apart, and the
  invariant is that no key differs otherwise. The file and the setting are named by their SHA-256,
  and a macro by its name only when it is plainly one.
- **Its first documents.** On `jake-0001`, `altacv-0001` and `awesome-cv-0003`, the last on XeTeX,
  both round trips set the reference's glyphs. `other-0009` and `other-0010`, whose bodies are set in
  `footnotesize` and were raw, now parse through, and set the reference's glyphs byte for byte;
  regenerated, each differs first in a position, in a paragraph with `\\` in it, which the model
  reads as a space. What the regenerated round trip finds on invented documents are the decodings
  this record keeps for the model but the generator cannot set as the source did: `\\` inside a
  paragraph, a line's break lost; `\textsc`'s small capitals; `\url`'s typewriter; an `\href`
  whose address has no scheme, which the generator gives `https://`; `{\it ...}`, which the
  generator writes as `\textit{...}` and so adds an italic correction; and the second of TeX's two
  spaces around a mid-paragraph input. Item 7 decides what to make of each.

The table is the run after the review's fixes and the alignment rule's (above). The first run,
before them, had the byte-for-byte round trip alone, which set the reference's glyphs on all 117
documents then too. Run again with the rule that read an environment's meanings, every document
counts the same but 20: six europecv documents, 13 Awesome-CV forks and one hand-rolled document
on Awesome-CV's class, whose table environments that rule kept raw (below).

`corpus parse` on 27 September 2026, the tree of layout 6, the M4 Pro, four children: 1.8 minutes.

|  | jake | awesome-cv | altacv | moderncv | europecv | other | all |
|---|--:|--:|--:|--:|--:|--:|--:|
| Documents with a reference | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Parsed | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Refused by the parser | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| No signatures: the compile that prints them stopped | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Timed out or died | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Printed back byte for byte | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Round trip byte for byte sets the reference's glyphs | 35 | 18 | 10 | 14 | 6 | 34 | 117 |
| Round trip byte for byte differs | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Round trip byte for byte differs first in a glyph | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Round trip byte for byte differs first in a position | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Round trip byte for byte differs first in a special | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Round trip byte for byte differs first otherwise: pages, size, count, rule | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Round trip byte for byte did not compile | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Round trip regenerated sets the reference's glyphs | 13 | 13 | 5 | 10 | 1 | 6 | 48 |
| Round trip regenerated differs | 22 | 4 | 4 | 4 | 5 | 25 | 64 |
| Round trip regenerated differs first in a glyph | 5 | 0 | 0 | 1 | 0 | 0 | 6 |
| Round trip regenerated differs first in a position | 13 | 4 | 3 | 3 | 3 | 22 | 48 |
| Round trip regenerated differs first in a special | 4 | 0 | 1 | 0 | 0 | 0 | 5 |
| Round trip regenerated differs first otherwise: pages, size, count, rule | 0 | 0 | 0 | 0 | 2 | 3 | 5 |
| Round trip regenerated did not compile | 0 | 1 | 1 | 0 | 0 | 3 | 5 |
| **Template macros the body calls** |  |  |  |  |  |  |  |
| In all | 270 | 107 | 162 | 54 | 62 | 145 | 800 |
| Per document, median | 7 | 6 | 15 | 4 | 8 | 2 | 6 |
| Arguments read from its meaning | 270 | 88 | 147 | 30 | 32 | 135 | 702 |
| Arguments read from the optional-argument form | 0 | 18 | 11 | 24 | 27 | 7 | 87 |
| Arguments read from the robust form | 0 | 0 | 1 | 0 | 0 | 1 | 2 |
| Arguments read from xparse | 0 | 0 | 2 | 0 | 0 | 1 | 3 |
| Arguments read unresolved | 0 | 1 | 1 | 0 | 3 | 1 | 6 |
| Arguments a package's table gave | 1 | 0 | 0 | 0 | 2 | 2 | 5 |
| A tail whose arguments could not be read | 1 | 0 | 9 | 0 | 7 | 7 | 24 |
| Calls kept raw: a group after them belies their signature | 0 | 1 | 0 | 0 | 0 | 11 | 12 |
| Template environments the body opens | 0 | 69 | 10 | 0 | 6 | 20 | 105 |
| Template macros with their closures, per document, median | 7 | 317 | 1657 | 1750 | 89 | 9 | 31 |
| Template macros with their closures, in all | 312 | 5889 | 12558 | 19410 | 619 | 3746 | 42534 |
| Of them, holding data | 4 | 1191 | 1653 | 2698 | 287 | 569 | 6402 |
| Placeholders for an email, a link or a phone number | 0 | 230 | 247 | 561 | 0 | 74 | 1112 |
| Signatures stopped at the cap of names | 0 | 0 | 6 | 3 | 0 | 0 | 9 |
| Names undefined when the preamble ends | 6 | 2 | 9 | 0 | 0 | 31 | 48 |
| **Two documents sharing a class or style file byte for byte, and its setting** |  |  |  |  |  |  |  |
| Pairs of documents, a pair for each such file | 0 | 3 | 1 | 4 | 1 | 0 | 9 |
| The file's macros both call have the same keys | 0 | 3 | 0 | 4 | 1 | 0 | 8 |
| Other keys, each where a preamble defines a macro it hands its work to | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| Other keys otherwise | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| They call none of the file's macros in common | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **The body's characters** |  |  |  |  |  |  |  |
| In rich text and dates | 13% | 3% | 41% | 8% | 1% | 39% | 23% |
| In template calls' arguments | 50% | 53% | 19% | 66% | 71% | 13% | 35% |
| In raw chunks | 5% | 0% | 2% | 2% | 13% | 24% | 11% |
| Dates read | 203 | 187 | 111 | 143 | 37 | 205 | 886 |
| Parse time, median | 7 ms | 10 ms | 6 ms | 6 ms | 5 ms | 10 ms | 8 ms |
| Parse time, slowest | 19 ms | 30 ms | 67 ms | 13 ms | 18 ms | 65 ms | 67 ms |
| Signatures' two compiles, median | 231 ms | 1524 ms | 1140 ms | 1042 ms | 307 ms | 255 ms | 317 ms |
| Signatures' two compiles, slowest | 317 ms | 1980 ms | 1400 ms | 1084 ms | 391 ms | 1542 ms | 1980 ms |
| **Unresolved, by why** |  |  |  |  |  |  |  |
| delimited | 0 | 1 | 1 | 0 | 1 | 0 | 3 |
| looks ahead | 0 | 0 | 0 | 0 | 2 | 1 | 3 |

"Template macros the body calls" counts each macro once a document, by how its arguments were
read; the rows for a package's table and for a tail whose arguments could not be read count some
of the same macros again. The six unresolved macros are biblatex's `\nocite`, whose parameters are
delimited, in two documents, textpos's `\atxy(x,y)`, and bibentry's `\nobibliography`, whose
star's two branches differ, in three. Of the 48 names undefined when the preamble ends, 9 are
paracol's `\switchcolumn` and 3 TikZ's `\node` and `\draw`, which exist only inside their
environments, 7 are `\height`, which exists only in a box's dimensions, and 29 are five documents'
own, which the signatures, read at `\begin{document}`, do not see: 11 in one document, 11 in
another, and 7 in three more.

The 69 regenerated round trips that did not set the reference's glyphs, each bisected to the first
text or date whose regeneration makes it differ:

- 35 differ in a paragraph with `\\` in it, a line's break the model reads as a space: 30 first in a
  position, 3 in the count of pages, and in 2 the compile stops.
- 12 in a link: 5 in the special that holds its address, which the generator writes otherwise, and
  7 in a position.
- 14 in plain text: five Jake's Resume forks with no `fontenc`, whose OT1 fonts set `|` as an em
  dash and `<` as an inverted exclamation mark, where the generator writes `\textbar{}` and
  `\textless{}`; a T1 document whose ``` `` ``` and `''` the model holds as curly quotes, which the
  generator writes as characters its setup does not take, so that the compile stops, and a
  europecv document on OT1 whose curly quotes the generator writes so set in another position; a
  XeTeX document whose text holds brackets, which the generator braces, and whose compile stops;
  two europecv documents whose `\nobibliography`, unresolved and kept raw alone, leaves the file
  it names to be read as text, which the generator writes after the command unbraced, so that the
  name is set and an item of another kind differs first; and four in a position.
- 3 in `\textsc`'s small capitals, two of them europecv documents' labels, 1 in a date, 1 in a
  group holding a space and comments alone, 2 in bold and italic runs, and 1 in `\em` beside `\&`,
  whose compile stops.

These are the decodings "Its first documents" names, `\\` above all, and three it does not: the
characters an OT1 font sets as others, quotes a document's setup does not set as characters as it
set the ligatures, and the argument of a command the parser keeps raw alone, which it reads as
text. The five europecv documents are new to the list: their bodies were raw, and could not
differ, until the alignment rule placed them. Item 7 decides what to make of each.

### What the table says for items 5 and 6

- **The byte-for-byte round trip holds on every document**: the tree prints back the inlined body
  byte for byte, and that body, with the preamble, sets the reference's glyphs, on all 117, pdfTeX
  and XeTeX. What item 5 wraps and item 7 splices starts from a body that compiles as the original
  did.
- **The regenerated round trip holds on 48 of the 117**, differs on 64, and stops on 5. More than
  half of what does not hold is `\\` inside a paragraph, which a field of the model, one paragraph,
  cannot hold; the rest is links, characters an OT1 font sets as others, quotes, an unresolved
  command's argument read as text, and a few marks. What item 7 regenerates sets the page as the
  source did for under half the corpus until it decides what to make of those.
- **A third of a resume's characters are in template calls' arguments** (35%), and 23% in rich text,
  the rest the commands' own names, delimiters, spaces and raw chunks (11%). Jake's Resume forks
  (50%), Awesome-CV's (53%), moderncv's (66%) and europecv's (71%) are mostly calls: item 5's probe
  has most of their text to wrap. Hand-rolled documents are mostly rich text (39%) and raw chunks
  (24%), and AltaCV's too (41% text): for them the model's paragraphs and lists matter more than the
  naming step.
- **A table its author wrote is raw; the calls a template's table holds are calls.** A template
  environment keeps its body one raw chunk only where the body holds an `&` of its own, which no
  corpus document's does. europecv's `europecv`, a `longtable`, and Awesome-CV's `cvskills` and
  `cvhonors`, `tabular*`s, hold template calls that set their rows, and are placed. The rule that
  read the environments' meanings kept them raw: 98% of europecv's characters, where the first
  version read 69% as rich text with `\ecvitem`'s arguments outside its calls, and 9% of
  Awesome-CV's. Now 71% of europecv's characters are in calls' arguments and 13% raw: 223 of the 247
  `\ecvitem`s in its six bodies are calls, and the other 24 lie in an `\ifthenelse` in each of two
  documents that gives no else branch before a blank line, a call a mandatory argument of which is
  missing, which stays raw; 37 of its dates are read, where none were. Awesome-CV's 58 `\cvskill`
  and 54 `\cvhonor` calls, in 13 documents, take its raw share from 9% to 0% and its calls' from 49%
  to 53%, and 50 more of its dates are read, 187; one hand-rolled document on Awesome-CV's class
  gains four `\cvskill` calls. Placed, five of europecv's six regenerated round trips differ, where
  a raw body could not, each first in a text the list above names; Awesome-CV's differ first where
  they did.
- **A document calls few template macros**: 6 at the median, 15 for AltaCV's, 2 for a hand-rolled
  one; 800 in the corpus, 105 environments besides. Item 6 names few macros a document, and forks
  share them, which is what its per-macro cache is for.
- **The engine resolves all but 6 of the 800**: 702 from their meaning, and their tail's where
  they hand on, 87 from the optional-argument form, 2 from the robust form and 3 from xparse, 5 of
  them by a package's table; 24 have a tail it could not read. 12 calls, 11 of them in hand-rolled
  documents, are kept raw because a group after them belies their signature. What item 6 describes
  for a call has its arguments right.
- **Closures are large where TikZ or paracol is loaded**: a median of 31 template macros a
  document, but 1,657 for AltaCV's and 1,750 for moderncv's, most of them pgf's, microtype's and
  paracol's; 6,402 of the corpus's 42,534 hold data. By this record's rule they are the template's;
  item 6 sends a macro's closure capped at 64 definitions and 64 KB, the data it names by name
  alone, and a closure that reaches TikZ is mostly TikZ. Item 6 may want to send the preamble's and
  the class's macros before a package's, which only a source's own text can tell.
- **A shared file gives its macros the same keys**: of the nine pairs of documents that share a
  class and its setting, eight give every macro of it that both call one key, and the ninth's
  differ only where both preambles define a macro those hand their work to, as item 6's cache
  needs.
- **Time**: parsing takes 8 ms at the median and 67 ms at most. The signatures' two compiles take
  231 ms at the median for a Jake's Resume fork and 1.5 s for an Awesome-CV fork, and 2.0 s for
  the slowest document, the preamble's compile from the stock format, fontspec's scan included,
  most of it: an import pays them once. Reading the meanings, their tails and their data, and
  hashing, add 4 ms at the median and at most 147 ms, for an AltaCV or moderncv document whose
  closures reach a package's machinery.

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
- A template macro that holds data never leaves `signatures`: the result keeps its length, a
  definition's meaning is kept masked, and neither the person's text nor which of a class's fields
  a preamble sets moves a hash or a key. What a definition still holds of a person, item 11 masks
  by the document's own header values.
- A signature marked `tail` may take more arguments than it says: the parser keeps a call to it
  raw where a brace group follows its arguments, as it does a call that takes no mandatory
  argument.
- A template environment keeps its body raw only where the body holds an `&` of its own, a table
  its author wrote by hand, whose cells items 5 and 7 take as they are. One whose rows template
  calls set is placed, whatever it opens for them: europecv's items and Awesome-CV's skills and
  honours are calls, whose arguments item 5 wraps and item 7 regenerates, in a table's cells.
- The session reads a file a compile wrote in its job, by a path inside its folder; the reference
  compile gives back its files (`referenceFiles`) and compiles a document as it did
  (`compileLikeReference`); and `difference` says how two glyph streams first differ, which the
  runner counts.
