# 0013. Porting AltaCV

Date: 2026-09-25 · Status: accepted

## Context

Milestone 2 item 20 ports AltaCV, the second of plan section 7's launch templates: LianTze Lim's
`altacv.cls` v1.7.4 and its sample CV, `altacv-sample.tex`, called the sample below, which the
plan picked to exercise two columns and icon fonts on pdfTeX. The milestone asks for a renamed
class under the LPPL, pdfx dropped because the loop writes DVI, two columns through paracol, and
icons from Font Awesome's Type 1 fonts, and names TikZ and tcolorbox in the format as a risk to
the 300 ms target (decision 0003), to be measured before anything else. Decision 0006 left the
column a section goes in to this item.

## Decision

### What the format costs

Measured in Node on an M4 Pro, as the median of ten or twenty compiles of one pass each after
the document's first, from a format dumped three times.

| Format and body | Dump | Format | Per compile |
|---|---|---|---|
| Upstream's class, pdfx swapped for hyperref on dvipdfmx, tcolorbox without `skins`; the sample's body without its photo and bibliography, two pages | 460 ms | 6.79 MB | 175 ms |
| The same class, on that body without the wheel chart, tags and skill ratings | 430 ms | 6.79 MB | 108 ms |
| The same, without tcolorbox, on the same body | 410 ms | 6.73 MB | 106 ms |
| The same, without tcolorbox, TikZ or pgffor, on the same body | 335 ms | 6.51 MB | 104 ms |
| The port, on its sample | 400 ms | 6.73 MB | 103.5 ms |
| The port, on its sample with the skills a plain list | 400 ms | 6.73 MB | 85 ms |
| Jake's Resume, on its sample, measured the same way | 290 ms | 6.43 MB | 75 ms |

TikZ and tcolorbox in the format cost about 2 ms a compile each, and 75 ms and 20 ms of the dump:
a format is loaded whole, so what it holds costs in proportion to its size, and they add 0.22 MB
and 0.06 MB to 6.5 MB. What costs is drawing with them: the sample's wheel chart, tags and
ratings add about 66 ms, and each of the port's tags about 3 ms. The port is well inside the
target, so nothing is trimmed for speed. tcolorbox is dropped all the same, below, and so it
cannot be measured with its `skins` library.

### The licence

AltaCV is under the LPPL 1.3c, where plan section 7 has MIT. A modified file must not keep the
original's name, must say that it is modified and not the original, and must say where the
original is. So the class is `rt-altacv.cls`, which the package carries in `files`: its
`\ProvidesClass{rt-altacv}` says that it is modified and not the original, its header names
altacv.cls v1.7.4, LianTze Lim and where the original is, keeps her contributors' list and the
LPPL notice verbatim, and lists each change, which is marked `rt:` where it is made. The preamble
is a modified version of the sample, which is under the same licence, and says so above the same
notice. The package's `source` names the licence, `LPPL-1.3c`, and the author.

### What the class changes, and why

Only what the loop needs, as decision 0008 has a port change, what the tree forced, and what the
review of the port found the editor's page and text need of the class's macros:

- **pdfx is not loaded.** It makes PDF/A for pdfTeX's PDF mode. hyperref, which pdfx loaded, is
  loaded in its place on the dvipdfmx driver, with `bookmarks=false` and `hidelinks`, as decision
  0008 has every pdfTeX port, and the `withhyper` option's behaviour becomes the only one.
- **accsupp is not loaded.** Its ActualText is for pdfTeX's PDF, and xdvipdfmx makes the PDF's
  text from the fonts. Its two commands do nothing, so that the macros that call them are
  upstream's.
- **Latin Modern loads after T1 fontenc**, as decision 0009 has every pdfTeX port, so that
  anything the template's own fonts do not set draws.
- **tcolorbox is not loaded.** The tree's tcolorbox 6.0.1 needs tikzfill for its `skins` library,
  which the class loads and the tree does not have; nothing uses it but the round photo's
  `fill overzoom image`, and the editor has no photos.
- **pgf takes the dvipdfmx driver**, for hyperref's reason: in DVI mode pgf takes dvips's, whose
  PostScript xdvipdfmx cannot run, and the PDF would lose a tag's frame. Every later pdfTeX port
  that loads pgf does the same.
- **`\printinfo` sets a contact's text as it comes.** Upstream re-reads it through
  `\utffriendlydetokenize`, a `\scantokens` with `~`, `_`, `&`, `$` and `#` made ordinary, so that
  one typed raw prints. The generator escapes all five already, and writes `~` for a no-break space
  (U+00A0, U+202F, U+2007), which the re-read printed as a tilde on the page and in the PDF, so that
  a pasted phone number failed alignment. The space the re-read left after the text stays, so the
  contacts are as far apart as upstream's.
- **`\cvevent` lets the dates and the place wrap.** Upstream sets each in a box half the column
  wide, which cannot break, so in the right column, where awards and other entries go, a range at
  the `MMMM yyyy` format, or at 12 points at the default one, ran into the place, and in either
  column a long place ran past the column, over the next or off the page. Each is a ragged-right
  paragraph of that width, `\parbox[t]`, whose first line is where the box's was, so a range or a
  place that fits is set as upstream sets it, to the sample's every glyph.
- **`\cvtag` sets a tag's text as an ordinary box, and TikZ draws only its frame.** Upstream sets a
  tag as a TikZ node, whose text pgf's dvipdfmx driver places through a `pdf:btrans` transform,
  which xdvipdfmx applies and the page, drawn from the DVI, does not: the page drew every tag half
  its width right of where the PDF has it, the sample's "Web performance" past the margin, so the
  page the user edits was not the PDF's. The port measures the text and draws the node's frame
  around it, the same padding, corners and line, so the sample's frames and text are where the node
  put them in the PDF, to a thousandth of a point, and each tag's text is where the page draws it. A
  text wider than the column less its frame is set in lines of that width, ragged right, in one
  frame: upstream's one line ran off the page past about 45 characters, and past about 3,000 (1,357
  of `W` at 12 points in Latin Modern) stopped TeX with `Dimension too large`. It is set in those
  lines first, which says whether it fits on one, and only then measured whole, so that a text TeX
  can break is never measured whole, however long; a run it cannot break is a limit, below. The tag
  is one box, as the node is, so that a line breaks only at the space after it, where upstream's
  does: with the frame, the text and the kerns around it loose, TeX could break at the last kern,
  which has that space after it, and drop it, and the frame of a tag that ended a line hung past the
  column by the kern, 6.25 bp for the sample's "Design systems" in Roboto at 11.5 points, and in 21
  of the 84 settings of font, size and density. The frames and the text are then the node's in all
  84, to 0.0015 bp.

The class's other `\RequirePackage`s are all in the tree but simpleicons, which it loads only if
present, falling back from `\xtwitter` to `\twitter`, and academicons, which it loads only when
Font Awesome lacks `\faOrcid`, and the tree's has it. Decision 0018 later added academicons to
the tree for the corpus; the class still never loads it, since `\faOrcid` is there.

### What the preamble changes, and why

The sample's layout and colours, and its pdfLaTeX fonts: Roboto Slab as the roman family, which
the name and the section titles are set in, and Lato as the sans-serif family, which is the
text's. Past that:

- **No capitals.** The class sets the name and the section titles through `\MakeUppercase`, which
  the preamble takes out of `\makecvheader` and `\cvsection` with etoolbox's `\patchcmd`. The page
  cannot match a capital it draws to the lower-case letter the resume holds until the aligner
  folds case (decision 0007, item 9), so every title and the name failed alignment; and
  `\MakeUppercase`, built on expl3's `\text_uppercase:n`, takes time that grows with the square of
  its argument's length, even over `\NoCaseChange`: 0.2 s a pass for a title of 2,000
  characters, 2.2 s for 8,000, where the port takes 77 ms. In `\cvsection`, `\leavevmode` takes
  its place, so that a blank title still starts the line the class ends with `\\`, which would
  otherwise stop the compile. A class without them stops the dump.
- **TS1's symbols from Latin Modern where a family lacks them.** The kernel declares Roboto Slab and
  Roboto to have TS1's subset 4 and Source Sans its subset 3, each short of many symbols, so LaTeX
  sets a symbol outside a family's subset, such as an arrow, a lone acute accent or a musical note,
  from the substitution family, `cmr` by default, whose TS1 fonts the tree has metrics for and no
  outlines: the page left the glyph out, and xdvipdfmx made no PDF, which the download and the ATS
  need. Roboto Slab sets the name and the section titles under every font choice, so 33 of the 73
  characters LaTeX's UTF-8 input sets from TS1 did this in a title at the default controls. The
  preamble sets `\rmsubstdefault`, `\sfsubstdefault` and `\ttsubstdefault` to Latin Modern's
  families, whose TS1 fonts both can draw, and none of the 73 does it now.
- **The sizes and the space**, below.
- **The accent**, below.
- **The margins** are the control's, the same on every side, half an inch by default, the
  nearest it has to the sample's 1.25 cm at the sides and 1.5 cm at the top and bottom, so only
  the sample's 1.2 cm between the columns is set here.

### The controls

| Control | Default | Applied by |
|---|---|---|
| `pageSize` | `a4`, the sample's; a new document takes its locale's (plan section 5.4) | `\geometry{a4paper}`, `\geometry{letterpaper}` |
| `margins` | 0.5 inch | `\geometry{margin=...in}` |
| `fontSize` | 10 pt, the class's | `\rtfontsize{...}` |
| `font` | Lato | Lato, Roboto (`Roboto-LF`), Source Sans (`SourceSansPro-TLF`), Latin Modern (`lmr`), each as `\familydefault` |
| `accent` | `#8F0D0D`, the sample's red | `\definecolor{rtaccent}{HTML}{...}\rtaccentcolours` |
| `density` | normal | `\rtdensity{50}`, nothing, `\rtdensity{150}` |
| `dateFormat` | `MMM yyyy` | the generator |

- **Font size.** The class sets its sizes once, from LaTeX's `size10.clo`, as it loads, so
  `\rtfontsize`, after the pattern of Jake's port (item 17), sets every size and the spacing that
  goes with it from `size10.clo`'s lengths scaled by the size asked for over 10 points, rounded to
  a hundredth of a point, with `\smallskip`, `\medskip` and `\bigskip`. At 10 points every length
  is the class's, so the default page is the one the preamble sets without it, byte for byte, and
  one format serves every size.
- **Density.** The class defines no spacing lengths of its own: `\cvsection`, `\cvevent`,
  `\divider` and `\makecvheader` space with `\smallskip`, `\medskip` and `\bigskip`, and its lists
  with enumitem's item space and space after a list, a quarter of a line each. `\rtdensity` sets
  both at a percentage, half for compact and one and a half for relaxed, of what the size gives
  them, so density and size compose in either order. Normal sets nothing. Nothing in the class
  takes space back but the `\\[-1ex]` under a title, which density does not touch, so no density
  sets a line over another.
- **Font.** A choice sets the text's family and leaves the name and the section titles in Roboto
  Slab, as the sample has them. Latin Modern is the roman, the one serif on offer.
- **Accent.** `\colorlet` takes a colour's value when it runs, so the control defines `rtaccent`
  and sets the colours derived from it again: the tagline, the contacts' icons and the entries'
  subtitles in it, as the sample has its red; the section titles in it darkened by half, which is
  the sample's `DarkPastelRed` to within a few units; and the rules under them in a tint of it,
  thirty per cent, in place of the sample's gold, which no accent can derive. The name, the
  entries' titles and the text keep the sample's black, slate grey and light grey.

### The snippets, and the column a section goes in

A section's column follows its role; the model gets no column (decision 0006 left it here). The
roles the sample sets beside the main column, `summary`, `skills`, `awards`, `languages` and
`other`, go on the right: their section snippets are wrapped in `\switchcolumn[1]` and
`\switchcolumn[0]`, and paracol appends each to the right column's own flow and returns to the
left's, so that each column keeps the resume's order however the sections alternate. The rest,
`experience`, `education`, `projects` and `publications`, go on the left, in `\begin{paracol}{2}`
at the sample's `\columnratio{0.6}`. The sample also sets education on the right; the port keeps
it with experience. The header is `\name`, `\tagline` and `\personalinfo`, each contact and link
through `\printinfo` with its kind's icon and its address as the URL slot of `\printinfo`'s
optional argument, in braces so that a `]` in it cannot end the argument; an entry is `\cvevent`
with its bullets in the class's itemize, entries apart by `\divider`; skills are `\cvtag`s, a
blank one left out, and other lists the class's itemize; labelled items are `\textbf{label}: text`
lines; and paragraphs are plain. A paragraph or labelled section that holds something ends with a
`\medskip`, as the sample's paragraph and languages do, since `\cvsection` takes away the space
between lines before its title.

### What is not editable

Upstream's photos (`\photoL`, `\photoR`), skill ratings (`\cvskill`), achievements with an icon
(`\cvachievement`), the wheel chart (`\wheelchart`), referees (`\cvref`), subsections, the quote
environment and the publications through biblatex have no place in the model: an import keeps
them in `extras` (decision 0006), and the port's `sample.json` leaves them out.

## Consequences

- The editor's page draws Lato's glyphs at twice their size: Lato's Type 1 fonts have a 2000-unit
  em, and `type1.ts` reads a font's `FontMatrix` but returns outlines in the font's own units, which
  `svg.ts` scales by the size over 1000. The PDF, which xdvipdfmx makes, is right, and so are
  Roboto, Roboto Slab, Source Sans, Latin Modern and Font Awesome, whose em is 1000 units. The
  harness does not see it, since it checks glyphs by their text, and the round trip checks that
  no density sets a line over another in Roboto for that reason. Clicks on Lato's text resolve
  against boxes twice their size until the reader scales outlines by the matrix.
- The capitals can come back when the aligner folds case, and then need a way around
  `\MakeUppercase`'s cost, as the bookmarks did in decision 0008. Decision 0021 later taught the
  aligner to fold case; the cost is still to be got round, so the port keeps no capitals.
- Each font sets the ligatures its T1 metrics form, as the sample does, and the page reads each as
  the letters it joins (decision 0009), Lato's and Roboto's `uniFB00` to `uniFB04` among them:
  ff, fi, fl, ffi and ffl in Lato and Latin Modern, ff, fi, fl and ft in Source Sans, and fi and fl
  alone in Roboto and Roboto Slab. T1's `,,` is a ligature too, set as `quotedblbase` in every
  font, as in Jake's, which the page reads as „ and the aligner matches to the two commas the
  resume holds, as it matches the en dash to `--`.
- 17 of TS1's symbols draw and reach the PDF but match no character of their field in a title:
  `glyphText` has no reading for eleven of their glyphs' names, such as Latin Modern's `baht` and
  `naira`, and reads six as other text, such as Roboto Slab's `‖` as two bars and `‽` as `!?`. A
  field holding one fails alignment at that glyph until the reader knows those names.
- A tag's frame, which TikZ draws with `pdf:` specials, is in the PDF but not on the page, which
  draws glyphs, rules and colours only; a tag's text is on both, in the same place.
- The rule the tags broke holds for every port, and decision 0008's port rules now say it: no
  field's text is set where xdvipdfmx transforms what the page does not, and no template closes a
  transform it never opened. The harness's special check reports a field whose begin marker or a
  glyph lies between a `pdf:btrans` and its `pdf:etrans`, which xdvipdfmx also takes as
  `begintransform`, `begintrans` and `bt`, and `endtransform`, `endtrans` and `et`, however they
  nest; or after an `x:scale`, `x:rotate` or `x:bscale` in its level of the graphics state, which
  `x:gsave` and `x:grestore`, or `pdf:bcontent` and `pdf:econtent`, open and close, or the page's
  own, to the end of the page; whatever whitespace comes before the prefix or after it, which
  xdvipdfmx skips. An `x:bscale` reaches past its `x:escale` because the tree's xdvipdfmx saves no
  state for the two: it scales about the point `x:bscale` is at and undoes the scale about the point
  `x:escale` is at, which is another once anything is set between them, so the rest of the level
  stays moved. The check reports once that a level was closed that was never opened: that pops the
  state xdvipdfmx opens each page with, the move an inch in from the corner, so everything after it
  on the page lands an inch left and off the PDF's page; and an `x:escale` with no `x:bscale` open
  stops the tree's xdvipdfmx with a memory fault, which `session.pdf` returns as a PDF it could not
  make, with the reason, rather than throw, and the harness reports as a `pdf` finding too. It does
  not see a `cm`, `q` or `Q` a template writes itself in `pdf:code`, `pdf:literal` or `pdf:content`,
  since pgf writes such pairs, which undo each other, around its boxes, and telling those from one
  that moves the text would take the matrices multiplied out; nor a form, `pdf:bxobj` to
  `pdf:exobj`, whose content the PDF draws wherever `pdf:uxobj` puts it.
- A tag is one box, so one of more than about 2,500 characters, taller than a page, is set on a
  page of its own and runs past its foot.
- Known limits, each far past a page and far under the generator's 1 MB bound on the body. About
  3,250 one-word tags compile, to 24 pages, and 3,500 exhaust TeX's main memory; about 1,386 items
  in a list in the right column stop paracol with `Too many unprocessed columns/floats`, as the
  review of this item found; and 1,500 tags take about 5 s a pass, so that a new document of them,
  two passes, reaches the scheduler's 10 s limit. And a tag whose text has a run TeX cannot break,
  such as one long word, wraps TeX's 32-bit arithmetic when the run is wide enough, which the port
  does not work around. Up to 32,768 points plus the width of the tag's lines (the column less the
  frame, 185.90 points at the default controls) the run is set as one line, which runs off the page.
  Past that, the excess TeX works out to fit the line passes 2³¹ scaled points and wraps, so the
  line seems to fit and the run is measured whole, and its width wraps to 65,536 points less than it
  is: up to 49,152 points that is below −16,384 points, and TikZ stops the compile with `Dimension
  too large`; from 49,152 points to 65,536 it compiles, with the tag's width taken as that negative
  amount, so the tags after it are set that far to the left, off the page for most of that range.
  From 65,536 points on, the same repeats every 65,536. In `W`s of Lato at 10 points, 10.355 points
  each, the compile stops from 3,183 to 4,746, and the other tags move from 4,747 to 6,328; a run of
  ordinary letters, about half as wide, takes about twice as many. Each edit is saved whatever the
  compile does, so a document can be saved in a state whose first compile fails. The editor, not the
  class, gives the way back: when the page cannot be shown, the side panel stays under the message,
  and with no page to click it gives each field an input, so the edit can be taken back or the item
  removed, and the page comes back with the compile that edit starts.
- The port's default page is the sample's but for the capitals, the margins, a pale rule in place
  of the gold, and what has no place in the model.
- xdvipdfmx warns once for each of the editor's marker specials, which it does not know, as it
  does for Jake's.
- Plan section 7 lists AltaCV's licence as MIT; the class says LPPL 1.3c.
