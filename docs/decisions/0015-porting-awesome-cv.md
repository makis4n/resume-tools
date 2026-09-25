# 0015. Porting Awesome-CV

Date: 2026-09-25 · Status: accepted

## Context

Milestone 2 item 22 ports Awesome-CV, the third of plan section 7's launch templates and the one
that takes the XeTeX path: Claud D. Park's `awesome-cv.cls` as it stood at its last revision for
Font Awesome 5, which calls itself v1.6.1, and the example `resume.tex` that comes with it. The
milestone asks for a renamed class, its fonts from TeX Live, the name split into first and last,
its controls, and XeTeX's longer debounce. Decision 0003 measured the class on the XeTeX loop at
459 ms a compile, with fontspec removed and the fonts declared by file; decision 0014 made that
loop the editor's and left this item its gaps: a glyph that `+smcp` substitutes has no text, a
family has one features string, emboldened runs are drawn as boxes, and the overlay does not
shape. Decision 0011 hid the packages' fonts from fontconfig, so XeTeX finds them only by file.

## Decision

### The licence

The class is under the LPPL 1.3c: a modified file must not keep the original's name, must say
that it is modified and not the original, and must say where the original is. So the class is
`rt-awesome-cv.cls`, which the package carries in `files`: its `\ProvidesClass{rt-awesome-cv}`
says that it is modified and not the original, its header names awesome-cv.cls, its author and
where the original is, keeps the original's notice verbatim below, and lists each change, which
is marked `rt:` where it is made. The package's `source` names the licence, `LPPL-1.3c`, and the
author. The example is under CC BY-SA 4.0; the preamble is the editor's own, and takes from the
example only the class options, its margins and settings that restate the class's defaults (the
accent, the section highlight, the contacts' separator), and none of its text. The sample is
invented, and none of the example's words reach it.

### What the class changes, and why

Only what the loop needs, and what the editor's page, text and PDF need of the class's macros:

- **fontspec is not loaded**, nor unicode-math, fontawesome5, roboto and sourcesanspro, each of
  which loads it: loading fontspec loads a native font, which a format cannot hold (decision
  0003). `\defaultfontfeatures{Ligatures=TeX}` goes with it; the families' `mapping=tex-text` is
  what it set. `\roboto`, `\robotolight`, `\sourcesanspro` and `\sourcesansprolight`, which the
  class took from roboto.sty and sourcesanspro.sty, are `\newcommand`s that select the families
  the package declares in TU, so `\headerfont`, `\bodyfont` and the class's styles are upstream's.
  This version of the class has no `\newfontfamily` lines of its own.
- **The icons are Font Awesome 5's glyphs by code point**, `\char"F10B` in the family of the font
  fontawesome5 takes the icon from, in place of fontawesome5's commands, which look a glyph up by
  its name in the font as the document starts. Every icon the class uses is defined, by the code
  point fontawesome5 gives it in `fontawesome5-mapping.def` (5.15.4, the tree's): from Free Solid,
  `\faMobile` F10B, `\faEnvelope` F0E0, `\faBirthdayCake` F1FD, `\faHome` F015 and
  `\faGraduationCap` F19D; from Brands, `\faGithubSquare` F092, `\faGitlab` F296, `\faBitbucket`
  F171, `\faStackOverflow` F16C, `\faLinkedin` F08C, `\faOrcid` F8D2, `\faTwitter` F099,
  `\faMastodon` F4F6, `\faSkype` F17E, `\faReddit` F1A1, `\faResearchgate` F4F8, `\faXingSquare`
  F169, `\faMedium` F23A, `\faKaggle` F5FA, `\faHackerrank` F5F7 and `\faTelegram` F2C6. Each
  code point reaches the glyph of the icon's name in the tree's fonts.
- **A list's bullet is the text font's U+2022**, `\textbullet`, where unicode-math's `\bullet`
  took U+2022 from the math font. The tree has no OpenType math font, and every text family on
  offer has the glyph. The class's other unicode-math symbol, the example's centred dot, is text a
  user types, U+00B7, which the text fonts set.
- **hyperref makes no bookmarks**, as decision 0008 has every port, and bookmark, which only
  manages them, is not loaded. hyperref keeps its own XeTeX driver, which writes xdvipdfmx's
  specials; it refuses the `dvipdfmx` option under XeTeX (decision 0014).
- **`\@sectioncolor` takes the title whole and sets its first three characters in the accent
  inside the title's field.** Upstream's takes a title's first three tokens and colours them,
  which in the editor are the marker macro and its two arguments, whose braces it drops, so that
  the field comes apart; it also dropped a space among the first three characters, and stopped
  the compile on a title shorter than three. The port's scans the field's text: a letter, a
  symbol such as `\&` or a braced bracket counts as a character, an empty group after
  `\textbackslash` as none, and a space is kept and not counted, so a title of fewer than three
  characters is all in the accent and a blank one sets nothing. A colour change within a word has
  xdvipdfmx show the word in two text operators, the second from where the first ends, which a
  reader of the PDF reads as one word; the harness's PDF check now reads them so too (below).
- **`\makecvheader` starts the name's line and the contacts' line when nothing on them has**,
  with `\leavevmode`: each line ends with `\\`, which stopped the compile where a name of two
  blank halves, or a header with no contacts, left no line to end. A line with anything on it is
  upstream's: a blank first half drops the space before the second at the start of the line, and
  the last name is centred on its own, as upstream sets it.
- **cvhonors sets an award's date in a column as wide as the widest date it holds**, with an em of
  the date's size on either side, and never narrower than upstream's 1.5 cm, which holds a year;
  the award's title gives up what it takes. The editor's dates are ranges too, such as May 2022 –
  Present, which wrapped in upstream's column at every date format, their first line up against
  the title, and a single month at the long month format wrapped too. The environment reads its
  body first and measures each date in a box it throws away, so the column fits the date format
  the document has; the sample's years keep upstream's column, and its page is upstream's.
- **cvskills sets the skills' text in what the labels' column leaves**, when the widest label
  takes more than the tenth of the text's width upstream's table leaves it, and in upstream's 0.9
  of the width otherwise. Upstream's text column was 0.9 of the text's width whatever the labels,
  so a label of two or three words, such as Programming Languages, set a long skill's text past
  the page's edge, on the page and in the PDF. The environment reads its body first and measures
  each label in a box it throws away; the sample's skills are where upstream's table sets them.

tcolorbox stays, loaded with its `skins` library for the photo, which the editor never sets; the
tree has tikzfill now (decision 0011). It costs about 125 ms of the dump and 0.37 MB of the format,
and no measurable time a compile.

### The fonts

The package declares eight families by file (decision 0014), each shape of the tree's files:

| Family | Upright, italic, bold, bold italic | For |
|---|---|---|
| `Roboto` | `Roboto-Regular.otf`, `-Italic`, `-Bold`, `-BoldItalic` | the header; the text under the Roboto choice |
| `RobotoLight` | `Roboto-Light.otf`, `-LightItalic`, `-Medium`, `-MediumItalic` | the first name; the light text under Roboto |
| `SourceSans` | `SourceSansPro-Regular.otf`, `-RegularIt`, `-Bold`, `-BoldIt` | the text, titles and positions |
| `SourceSansLight` | `SourceSansPro-Light.otf`, `-LightIt`, `-Semibold`, `-SemiboldIt` | the bullets, paragraphs, places and dates |
| `Lato` | `Lato-Regular.ttf`, `-Italic`, `-Bold`, `-BoldItalic` | the text under the Lato choice |
| `LatoLight` | `Lato-Light.ttf`, `-LightItalic`, `-Semibold`, `-SemiboldItalic` | the light text under Lato |
| `FontAwesome` | `FontAwesome5Free-Solid-900.otf` | the free icons |
| `FontAwesomeBrands` | `FontAwesome5Brands-Regular-400.otf` | the brands' icons |

The text families load with `mapping=tex-text`, the icons with nothing. Each text family declares
`m/n`, `m/it`, `m/sl`, `m/sc`, and `b` and `bx` in `n`, `it` and `sl`: slanted is the italic, as
fontspec substitutes it, and the light families' bold is the weight between, Roboto's medium and
Source Sans Pro's semibold, as the packages' light families have it, which rich text in a bullet
sets. The plan named Source Sans 3; the tree's is Source Sans Pro, whose files these are.

Two of decision 0014's gaps decide the rest:

- **Small capitals are the family's upright.** The class sets the headline and every entry's
  position in `\scshape`, which fontspec gave Source Sans Pro's `+smcp`. A glyph `+smcp`
  substitutes has no text the page can match, and one features string serves a whole family, so
  each family's `m/sc` is its upright file: the headline and the positions are set upright, in the
  capitals and lower case the user types.
- **Roboto's figures are its default ones.** roboto.sty asks for proportional lining figures,
  `+pnum;+lnum`, where Roboto's own are tabular; the proportional ones are single substitutions,
  which have no text either, so the contacts' digits are Roboto's tabular ones.

XeTeX emboldens nothing, since every bold shape the class selects is declared by its file. The
overlay does not shape, as decision 0014 records; Awesome-CV's text is justified, and a bullet in
Roboto Light whose words Roboto kerns and joins nowhere breaks where XeTeX did, each row ending
within a hundredth of a point of its line.

### The preamble

`\RequirePackage[OT1]{fontenc}` before `\documentclass[11pt,a4paper]{rt-awesome-cv}`, so that the
format holds no native font, then `\encodingdefault` TU and `\familydefault` Source Sans, as
sourcesanspro's `default` option made it; the example's geometry, whose margins the control
replaces, so that it sets only the footer's space; `\definecolor{rtaccent}{HTML}{DC3522}`, the
example's `awesome-red`, and `\colorlet{awesome}{rtaccent}`; `\setbool{acvSectionColorHighlight}
{true}`; and the example's contacts' separator, a bar, which is the class's own. It ends before
`\begin{document}`.

### The controls

| Control | Default | Applied by |
|---|---|---|
| `pageSize` | `a4`, the example's; a new document takes its locale's (plan section 5.4) | `\geometry{a4paper}`, `\geometry{letterpaper}` |
| `margins` | 0.5 inch | `\geometry{margin=...in}` |
| `fontSize` | 11 pt, the class's | `\rtfontsize{...}` |
| `font` | Source Sans | Source Sans (nothing), Roboto (`\rtbodyfonts{Roboto}{RobotoLight}`), Lato (`\rtbodyfonts{Lato}{LatoLight}`) |
| `accent` | `#DC3522`, the example's red | `\definecolor{rtaccent}{HTML}{...}\colorlet{awesome}{rtaccent}` |
| `density` | normal | `\rtdensity{50}`, nothing, `\rtdensity{150}` |
| `dateFormat` | `MMM yyyy` | the generator |

- **Margins.** Half an inch on every side is, of what the control offers, nearest the example's
  margins taken together: 1.4 cm at the sides, 0.8 cm at the top and 1.8 cm at the bottom.
- **Font size.** The class sets its text in sizes of its own, fixed in points, 32 for the name,
  16 for a title, 9 for a bullet, from its 11-point option, and article's size11.clo and parskip
  set the rest as it loads. `\rtfontsize`, after the pattern of Jake's port (item 17), sets
  size11.clo's sizes and parskip's half-line between paragraphs scaled by the size asked for over
  11 points, rounded to a hundredth of a point, and every style of the class takes its size
  through the same scaling: the preamble patches the `\fontsize` of each of the class's 34
  styles, and a class without one stops the dump. At 11 points every size is the class's, and
  the page is the one the preamble sets without any of it, byte for byte.
- **Density.** The class parts sections with `\acvSectionTopSkip`, 3 mm before a title, and
  parskip's half-line, which is also what parts one entry from the next, and its bullets with
  nothing. `\rtdensity` sets the first two at a percentage, half for compact and one and a half
  for relaxed, and gives the bullets a point less or more for each half, through cvitems, which
  is patched to take the space. The plan named `\acvSectionContentTopSkip`, the 2.5 mm after a
  title, as well; it stays the class's at every density, because the class takes 3 mm back right
  after it in a paragraph section, and a compact paragraph at 9 points was set over its title.
  Normal sets nothing, and no density sets a line over another or a rule through a line, at any
  size, in any font, on A4 or Letter, and on both pages where the sample spills onto a second.
- **Font.** A choice sets `\bodyfont`, `\bodyfontlight` and the document's family, which is the
  text, the titles, the headline and the entries; the header's name, address and contacts stay
  Roboto, as the class sets them.
- **Accent.** `\colorlet` takes a colour's value when it runs, so the control sets `awesome` from
  `rtaccent` again: the headline, the section titles and the places. The name, the organisations
  and the text keep the class's greys.

### The snippets

- **The header** is `\name{first}{last}`, `\position` for the headline and `\address` for the
  location when they are present, then `\makecvheader[C]`, centred. The contacts are not set
  through the class's `\mobile`, `\email`, `\homepage`, `\github`, `\linkedin`, `\twitter` and
  `\orcid`, which the plan named: each builds its link's address from its argument, which in the
  editor is the field in its markers, as decision 0007 foresaw of such a macro, and each holds one
  value, so a second link of a kind would replace the first, and their order is the class's, not
  the resume's. So the phone, the email and the links go through `\extrainfo`, the class's own
  place for what it has no command for: `{{contacts}}`, in the resume's order and apart by the
  class's `\acvHeaderSocialSep`, each `\href` to the address the generator gives, around the
  class's icon for its kind (`\faMobile`, `\faEnvelope`, `\faHome` for a website,
  `\faGithubSquare`, `\faLinkedin`, `\faTwitter`, `\faOrcid`) and its text, as the class sets a
  contact; an other link has no icon, as `\extrainfo` has none. The class sets the line.
- **Entries** are `\cvsection{title}` and `cventries`, each `\cventry{title}{subtitle}{place}
  {dates}{...}`: the model's title is the class's position, on the second line with the dates,
  and its subtitle the class's title, the organisation, bold on the first with the place, as
  upstream's example has a job's title and its organisation; the bullets are `\item`s of
  `cvitems`, left out with it when there are none, since an empty description row would leave a
  line. Entries are paragraphs apart, as the example's blank lines make them.
- **Awards** are `cvhonors` and `\cvhonor{title}{subtitle}{place}{dates}`: the year, the title
  and after a comma the event, and the place. An award's bullets, which the class's `\cvhonor`
  has no place for, are set under it as an entry's description row is, so that none of the
  resume's text is lost.
- **Labelled sections** are `cvskills` and `\cvskill{label}{text}`.
- **Lists** are `cvitems` in a `cvparagraph`, through the preamble's `rtlist`, which gives back
  the 4 mm cvitems takes above and below its list: in `\cventry`'s table that is space the row
  before it leaves, and outside one the list was set over the section's title. A list's first
  line falls where a paragraph's does.
- **Paragraphs** are `cvparagraph`.

Every optional argument may come empty, as edits leave it: the class's macros are compiled with
each left out, a blank name, a header with nothing but a name, blank titles, labels and items,
and empty sections of every kind, and every field set still reaches the page.

### What is not editable

The photo (`\photo`), the quote (`\quote`), the footer (`\makecvfooter`), the date of birth,
subsections (`\cvsubsection`), sub-entries (`cvsubentries`, `\cvsubentry`), the cover letter and
its commands, and the social kinds the model has no link kind for, such as GitLab, Stack Overflow,
Mastodon and Google Scholar, have no place in the model: an import keeps them in `extras`
(decision 0006), or takes a link of an unknown kind as `other`, and the port's `sample.json`
leaves them out.

## Numbers

Measured in Node on an M4 Pro with a load average of about 4.5, as the median of ten compiles of
one pass each after the document's first:

| | |
|---|---|
| Dump the format | 510 ms, 600 ms the first time; 9.37 MB |
| A new document's two passes | 390 and 319 ms |
| The body, one pass, median of ten | 317 ms (311 to 322) |
| The invented XeTeX template's body, measured the same way | 300 ms |
| The same class without tcolorbox | dump 390 ms, 9.00 MB; the body the same |
| xdvipdfmx on its XDV | 51 to 66 ms |
| Drawing its page, 17 native fonts from 11 files | 59 ms reading and parsing the files, 6 ms after |

Decision 0003's mark was 459 ms, for the example's three pages on the spike's tree; the port's
one-page sample compiles in 317 ms, and the scheduler already waits 400 ms after an edit before a
XeTeX compile, against 100 ms for pdfTeX (item 8), which is the longer debounce the milestone
asks for. The harness passes on the sample with no findings, 57 fields on one page, in 13 passes
of 320 to 400 ms.

## Consequences

- The port's default page is the example's but for the headline and the positions, upright where
  upstream's were small capitals; Roboto's tabular figures; the margins, half an inch on every
  side; the contacts, in the resume's order; and what has no place in the model. Small capitals
  and proportional figures can come back when the page reads the texts of glyphs a single
  substitution makes, and a family can load one shape with features of its own; both are
  additions to decision 0014.
- Source Sans Pro reaches its apostrophe and its hyphen from several code points each, and
  xdvipdfmx's ToUnicode map shows the hyphen as U+2011, the non-breaking hyphen: the page takes
  any of a glyph's code points as its text, and the harness's PDF check reads the hyphen as typed
  (decision 0014). The sample holds both, an apostrophe in a bullet and in an award's first word,
  and a hyphen in a bullet's and an interest's first word, and aligns and passes the harness.
- The generator leaves out of a text any character one of the six text families lacks (decision
  0014), since it cannot tell which of them sets the text: whichever the font control chooses, a
  character is set only when Roboto, Source Sans Pro and Lato all have it, so an arrow, which
  Source Sans Pro has and Roboto does not, is left out in Source Sans as well.
- The harness's PDF check reads text operators that abut, each starting where the one before it
  ends, as one text, so that a word a template colours in part is found whole: the PDF reader
  (`src/validate/pdf.ts`) gives each operator its end, from its font's glyph widths and its
  kerns. Operators a space apart stay apart.
- The harness's `pages` check reports a field whose glyphs the page sets past one of its edges,
  as upstream's skills table set one, for every template: neither the page nor the PDF shows
  what is past the edge.
- The class takes space back with fixed lengths, 3 mm after a title in a paragraph section, 2 mm
  before an entry and 4 mm around a list's items, which the font size does not scale; at 9 points
  they leave less room than at 11, and a density below the port's compact could set lines over
  each other there.
- The sample fits on one page at every size, density and font, on A4 and on Letter, but relaxed at
  12 points on A4 and relaxed at 11.5 and 12 points on Letter, which is shorter, where it spills
  onto a second page in every font. Fitting on one page is item 18's to do.
- New documents still start from Jake's Resume; choosing a template for a new one is not part of
  this item.
