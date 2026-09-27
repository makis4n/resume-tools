# 0024. The naming contract, and the seed answers

Date: 2026-09-27 · Status: proposed

## Context

Milestone 3 item 6 is the contract of plan section 6 step 4, the one step that leaves the browser:
what the naming step is asked about an imported template, what it answers, and the key its answers
are cached under; and the seed, the answers for the three launch templates' macros, written by hand
from the ports, which are the first cache entries and the fixtures the pipeline's tests run on with
no model. The model and the service are items 9 and 10, the assembly item 7, and the rules that
keep a person's details out of a request item 11's to finish. The code is `packages/naming`, a
workspace package the editor, the service and the corpus runner all read; the request builder,
`apps/editor/src/import/naming.ts`; and `apps/editor/scripts/corpus-seed.ts`, which checks the seed
under `apps/editor/corpus/answers/`.

## Decision

### The package

`@resume-tools/naming` holds the request and the answer as Zod schemas, the key, and the masking
rules, and nothing that reaches for Node or the DOM but `crypto.subtle`, which the browser, Node
and Workers all have. Its one dependency outside the workspace is Zod; it takes `SectionRole` and
`LinkKind` from `@resume-tools/resume-model`, the single definition of resume data, rather than
list them again. Node's corpus runner imports it as it imports its own scripts, by stripping types.

### The request

One request per document, `NamingRequest`:

| Field | What it holds |
|---|---|
| `version` | `NAMING_VERSION`, 1 |
| `engine` | `pdftex` or `xetex` |
| `family` | `jake`, `awesome-cv`, `altacv`, `moderncv` or `europecv`, when the class's name says so, or, for Jake's Resume, whose forks load `article`, when the body calls `\resumeSubheading`, as the corpus's classifier reads them (decision 0017) |
| `preamble` | the class's name and options, and the statements that set the page's geometry, the base size, fonts, colours and spacing, masked (below) |
| `macros` | each template macro the body calls, each template environment it opens, and each macro the preamble calls to store the header's text (`isSetter`, decision 0022) |
| `definitions` | every definition the macros and their closures name, once: a definition's masked `\meaning` and the SHA-256 of that text, or a macro that holds data by its name and kind alone |

A macro is its name, whether a command or an environment, its signature in xparse's syntax where
the engine could read it, its key, its dependencies by name in its closure's order, whether its
closure stopped at its cap, each argument of its signature with what the probe found of it
(`editable`, `container`, or the locked reason, and what its empty calls came to), up to three call
sites and how many times the document calls it. Its own definition is the one of its name in
`definitions`; an environment's is its `\begin` code, and its `\end` code is its first dependency,
then both closures, so that its key covers both. The definitions are a table the macros share,
since a template's closures overlap: every Awesome-CV macro reaches the same styles and fonts.

- **What the model is asked** is what TeX made of the template (decision 0020): each macro's
  definition closed over the macros it hands its work to, what the probe proved of each argument,
  and the shapes of a few calls. It is asked to name what the engine already found, never to find
  what is editable, which the probe and item 7's checks decide.
- **Call sites** are the calls whose arguments' shapes, absent, empty, a date, text or more, differ
  most, the first first. Each argument is its source between its delimiters, every letter written
  `X` or `x` by its case, of any script, every digit `0`, and everything else kept
  (`placeholder`); a date its shape as it is spelled, `0000` for a year, `0000-00` for a month,
  and a range `0000-00 -- 0000-00` or `0000-00 -- xxxxxxx`, so that the model sees that it is a
  date and not which; a command's name kept where the table knows it or the engine says it is
  defined, and masked where it does not, since an undefined `\Quill` is the person's as likely as
  the template's; an environment's name kept; comments left out and spaces made one. An
  environment's site also shows the start of its body, 600 characters. A site is cut before a
  command's backslash, never through a name. The schema refuses any site that holds a letter but
  `x` and `X`, or a digit but `0`, outside the names of commands and environments (`holdsText`),
  whoever built it, and the builder checks its own request against the schema before it gives it
  back.
- **Settings** are the statements of `\geometry`, `\setlength`, `\definecolor`, `\setmainfont`,
  font and colour packages' `\usepackage` and their kin, and `\renewcommand` of a font, size,
  colour or spacing macro, each masked by the patterns (below), then every word written as its
  placeholder but a number or a length, a hex colour, a colour the preamble names, and about 300
  keywords: geometry's keys, class options, font, colour and list options, and the packages and
  font families the tree has. The class's name and options are masked the same way, so that a
  fork's class named after its owner goes as `x`s.
- **Data macros go by name alone.** A macro whose replacement text is text, as `\name{...}` stores
  `\@firstname`, holds the person's data (decision 0020); the request names it where a closure
  does, with neither its text nor its length. A definition says what its closure's data macros
  are called, which is all the model needs to read `\@firstname` as the first name.
- **Definitions are masked twice.** Item 4's patterns mask emails, links and phone numbers before
  anything is hashed (`maskDefinition`, moved into the package so that the rules live with the
  contract). What they miss, the builder masks by the document's own values, in the simple form item
  11 finishes: a matcher reads a definition's letters and digits alone, accents taken off, in lower
  case, across commands, braces, punctuation and spaces, so that `{\Large Quill Invented}`,
  `\mbox{Quill}\mbox{Invented}`, `+44\,20\,7946\,0000`, `Jos\'e` and `A\&M` are all found; and it
  looks for the header's values, whole and word by word, the texts the preamble stores and the
  words of those of two words or fewer, each link's address, and the body's text runs, dates and
  raw chunks' words where the person wrote them, two words or more, or twelve letters and digits or
  more. A single word of the body, `itemize` in `\setlist[itemize]{...}` or a section's title, is
  as likely the template's code or a word every resume has as the person's, and masking it where a
  class's definition holds it would give that class's macro a key of the document's own, which no
  fork's cache entry serves. A text of fewer than six characters, a first name of three among them,
  is found in a definition only as whole words, so that `Tom` never masks `bottom`; in a setting,
  where masking moves no key, it is found anywhere, a colour named `quillblue` among it. A
  definition that masking changes is sent with the SHA-256 of what is sent, never item 4's hash of
  the text that held the person's details, which the masked text would let anyone confirm a guess
  against; its key, and those of the macros that name it, are then the document's own.
- **The leak check** (`assertNoText`) reads a request by the same rules, over every definition,
  call site, setting and the class, and throws when any of the document's text is there, naming what
  kind of text and where, never the text. The builder's requests pass it by construction; it is
  what a change to the builder must still pass, and what item 11's corpus-wide test runs.

`REQUEST_CAPS` bounds what a service reads: 512 macros, 8,192 definitions of a megabyte each at
most, 32 arguments, three sites of 4,000 characters, 256 settings of 2,000.

### The answer

The model's answer for a macro, `ModelAnswer`, is words from closed lists and nothing else:

| Field | What it holds |
|---|---|
| `kind` | `entry`, `section`, `bullet` (an entry's bullet, or a list section's item), `bulletList`, `header`, `contact`, `link`, `labelledItem`, `paragraph`, `layout` (sets none of the resume's text) or `other` (the model has no place for it, and item 7 keeps it as an extra) |
| `arguments` | each argument by its index: its meaning, `title`, `subtitle`, `place`, `dates`, `text`, `label`, `address`, `icon`, `colour`, `length`, `key` or `other`; the slot it fills, one of decision 0006's for the kind (an entry's `title`, `subtitle`, `place`, `dates`, `bullets`; a section's `title`, `entries`, `items`, `text`; the header's `first`, `last`, `headline`, `email`, `phone`, `location`, `links`, `contacts`; a contact's `text` and `href`; a link's `label` and `href`; a labelled item's `label` and `text`; a bullet's and a paragraph's `text`); the paragraphs it holds, each with its meaning and slot, where it holds more than one, as Jake's projects heading holds its title and subtitle either side of `$|$`; and what it is in a blank unit, `empty`, `absent` or `kept` as the document's first call gives it |
| `repeatable` | a unit the user may add and remove: an entry, a bullet, a section, a link |
| `omitWhenBlank` | a blank unit is left off the page, as a tag whose empty frame would show |
| `list` | whether it opens or closes a list; the macro that closes what it opens, or opened what it closes; and what the list holds |
| `role` | the section role its meaning implies, where it implies one: an awards table's, a projects heading's |
| `contact`, `link` | a contact's header field; a link's kind, which picks its icon |
| `variants` | another mapping of the arguments in sections of one role, as Jake's Resume swaps an entry's dates and place in its education section |

The schema is strict, as a package's is (decision 0006): a slot the kind has not, a slot filled
twice, arguments out of order, a field for another kind, or a role or a link kind the model does
not have is refused. A role is chiefly a section's, and an entry and an environment carry one too,
since Jake's projects heading and Awesome-CV's awards table say theirs by what they are.

- **The model never writes LaTeX.** An answer the model gives refuses `redefinitions` and
  `reviewed`. A person's answer, `ReviewedAnswer`, is the same fields, `reviewed: true`, notes, and
  redefinitions: each a name and LaTeX a person wrote that redefines the template's macro of that
  name, or adds one it needs, applied after `\documentclass`, once by name (`withRedefinitions`),
  so that a macro that defeats the editor's markers gets the fix its port has. A redefinition must
  keep upstream's output, which item 7's reference check proves document by document; one that
  changes the page on purpose, as AltaCV's port took its capitals out, does not qualify. Code the
  model wrote would run in every document whose macro has its key; code a person reviewed may.
- **A stored answer** is `{ version, key, hash, of, name, family?, answer, reviewed, source }`, by
  the macro's key, `source` `seed` or `model:<id>`, reviewed exactly when the answer is a person's,
  and the seed's always. `of` tells a command from an environment, which may share a name. `answerFor(cache, key)` gives a stored answer only when it
  validates, is of this version, and was filed under the key asked for: what a cache holds is not
  trusted.
- **The preamble's answer** names the style parameters found, `pageSize`, `margins`, `fontSize`,
  `font`, `accent` and `density`, each by the request's setting that sets it, or the class's options,
  its command and the key or name inside it, so that item 7 writes the control's snippet itself.
- `ModelNaming` is what item 9 asks the model for as structured output, an answer for each macro by
  name and the preamble's; `NamingAnswer` is what item 7 assembles from, the stored answer of each
  macro that has a key and the preamble's. A macro that holds data has no key and is never answered.

### The key

`keyOf(version, hash, dependencies)`, the SHA-256 of the JSON of the naming version, the macro's
hash, and its closure's definitions as `[name, hash]` in order, data left out. Item 4's `keysOf`
now builds every key through it, so there is one function, and item 4's keys carry the version;
equality between documents, which the corpus runner compares, is unchanged. `NAMING_VERSION` is 1,
and goes up when the request, the answer or what the prompt asks changes meaning. A service
recomputes a request's keys from its definitions (`requestKey`) and checks each definition's hash
against its text (`checkRequest`) before it files an answer, so that no request can file an answer
under another template's key.

### The answers folder

`apps/editor/corpus/answers/<key>.json`, a stored answer a file. The milestone had them by hash;
they are by key, since the key covers the macro's closure and the naming version, and one macro read
the same by two classes that hand its work to different macros must not share an answer.

### The seed

65 answers: every template macro and environment the three samples call, and six the ports use or
a preamble defines that the samples leave out (`SEED_EXTRAS`): Jake's `\resumeSubSubheading` and
`\resumeSubItem`, AltaCV's `\printinfo`, and Awesome-CV's `\cvskill`, `cvskills` and `\extrainfo`.
The engine is asked of those with the samples' own names, and their keys come from the same class.
On every one of the 65 the request's key is item 4's: no sample's text masked a class's definition.

`corpus seed [--json <file>]` fetches the oracle's samples as `corpus oracle` does, runs each
through the reference, the signatures, the parse, the probe and the request, and prints each
macro's hash, key and verdicts, and whether its answer validates, is filed under its key and holds
its hash; it exits 1 when one does not, or a redefinition stops a compile the sample takes without
it. It then compiles each sample with its answers' redefinitions after `\documentclass`: the body
with the calls they serve regenerated as item 7 writes them, against the same body without them,
and the sample as it is against its reference; where they move a page, each alone. The logs of
compiles that stop are kept under `.corpus/oracle/seed/`. The run takes 49 s on the M4 Pro.

| Template | Macro | Kind | Slots | Key | Redefinitions |
|---|---|---|---|---|---|
| jake | `\resumeSubHeadingListStart` | layout, opens a list | none | `f27b48af6241` | |
| jake | `\resumeSubheading` | entry | #1 title, #2 dates, #3 subtitle, #4 place | `f4e149eb11b9` | |
| jake | `\resumeSubHeadingListEnd` | layout, closes a list | none | `46916ae7b907` | |
| jake | `\resumeItemListStart` | bulletList, opens a list | none | `714200b66d4e` | |
| jake | `\resumeItem` | bullet | #1 text | `b7ef3295e9e6` | |
| jake | `\resumeItemListEnd` | bulletList, closes a list | none | `a80615c9c414` | |
| jake | `\resumeProjectHeading` | entry, projects | #1 title+subtitle, #2 dates | `8cef91ced08d` | |
| jake | `\resumeSubSubheading` (not called) | other | none | `a16f5e427a3b` | |
| jake | `\resumeSubItem` (not called) | bullet | #1 text | `a0b48160eb50` | |
| altacv | `\name` | header | #1 first | `7d911959d48b` | |
| altacv | `\tagline` | header | #1 headline | `d6677872f2af` | |
| altacv | `\photoR` | other | none | `9407be88787b` | |
| altacv | `\personalinfo` | header | #1 contacts | `784c61b29ca9` | |
| altacv | `\email` | contact (email) | #1 text | `807ae7db7730` | `\printinfo` |
| altacv | `\phone` | contact (phone) | #1 text | `899de3629cd5` | `\printinfo` |
| altacv | `\mailaddress` | contact (location) | #1 text | `38757db3d0e0` | `\printinfo` |
| altacv | `\location` | contact (location) | #1 text | `2befc9a895f1` | `\printinfo` |
| altacv | `\homepage` | link (website) | #1 label | `f70adfc50926` | `\printinfo` |
| altacv | `\xtwitter` | link (twitter) | #1 label | `c979d4c56e4e` | `\printinfo` |
| altacv | `\linkedin` | link (linkedin) | #1 label | `ff9ff943dc6a` | `\printinfo` |
| altacv | `\github` | link (github) | #1 label | `145235ae77e1` | `\printinfo` |
| altacv | `\orcid` | link (orcid) | #1 label | `c90c6816c6e0` | `\printinfo` |
| altacv | `\NewInfoField` | layout | none | `7ba10b7bfbef` | |
| altacv | `\faGitlab` | other | none | `37e753c7cbe9` | |
| altacv | `\faMastodon` | other | none | `4edb0b13b3ee` | |
| altacv | `\makecvheader` | header | none | `83df1c7c2fc3` | |
| altacv | `\columnratio` | layout | none | `f4b0a6255900` | |
| altacv | `paracol` (environment) | layout | none | `c813798fa9c8` | |
| altacv | `\cvsection` | section | #2 title | `d0f13efcec60` | |
| altacv | `\cvevent` | entry | #1 title, #2 subtitle, #3 dates, #4 place | `a8dac1fa314b` | `\cvevent` |
| altacv | `\divider` | layout | none | `be6829c5e06e` | |
| altacv | `\wheelchart` | other | none | `f20bf4705494` | |
| altacv | `\mynames` | other | none | `7c0dd22c930e` | |
| altacv | `\bibnamedelima` | other | none | `133c0c43abbd` | |
| altacv | `\bibnamedelimi` | other | none | `1a9bbe0c8992` | |
| altacv | `\nocite` | other | none | `2c50584d0761` | |
| altacv | `\cvachievement` | other | none | `ab2f421687aa` | |
| altacv | `\faTrophy` | other | none | `009ff45ea984` | |
| altacv | `\faHeartbeat` | other | none | `d80fca146e08` | |
| altacv | `\cvtag` | bullet, skills | #1 text | `08258377b89b` | `\cvtag` |
| altacv | `\cvskill` | other | none | `32467512926e` | |
| altacv | `\cvref` | other | none | `1460d747ea29` | |
| altacv | `\printinfo` (not called) | contact | #3 text, #4 href | `3cc5b44b04a1` | `\printinfo` |
| awesome-cv | `\name` | header | #1 first, #2 last | `afd6bb3cdb65` | |
| awesome-cv | `\position` | header | #1 headline | `a222a5600ee9` | |
| awesome-cv | `\address` | header | #1 location | `c4bd0e9631ca` | |
| awesome-cv | `\mobile` | contact (phone) | #1 text | `872e33037fa2` | `\mobile` |
| awesome-cv | `\email` | contact (email) | #1 text | `ce854d6c3d8b` | |
| awesome-cv | `\homepage` | link (website) | #1 label | `bec4b122c8e7` | |
| awesome-cv | `\github` | link (github) | #1 label | `a7360c6ade3f` | |
| awesome-cv | `\linkedin` | link (linkedin) | #1 label | `fc52faa2560f` | |
| awesome-cv | `\quote` | other | none | `c4557091e7f7` | |
| awesome-cv | `\makecvheader` | header | none | `f6897e04d426` | `\makecvheader` |
| awesome-cv | `\makecvfooter` | other | none | `75d5bcbc9ee9` | |
| awesome-cv | `\cvsection` | section | #1 title | `76f0ea467567` | `\@sectioncolor`, `\sectionstyle` |
| awesome-cv | `cvparagraph` (environment) | paragraph | none | `aa1a19a50bbc` | |
| awesome-cv | `cventries` (environment) | layout, opens a list | none | `d1483c8b8b8d` | |
| awesome-cv | `\cventry` | entry | #1 title, #2 subtitle, #3 place, #4 dates, #5 bullets | `1c7a3b7af9a7` | |
| awesome-cv | `cvitems` (environment) | bulletList, opens a list | none | `a365889d9d75` | |
| awesome-cv | `\cvsubsection` | other | none | `51035964ff17` | |
| awesome-cv | `cvhonors` (environment) | layout, awards, opens a list | none | `8d96714a024b` | `cvhonors` |
| awesome-cv | `\cvhonor` | entry, awards | #1 title, #2 subtitle, #3 place, #4 dates | `1136c0380adb` | |
| awesome-cv | `\cvskill` (not called) | labelledItem, skills | #1 label, #2 text | `e386a0055265` | |
| awesome-cv | `\extrainfo` (not called) | header | #1 contacts | `b29b55c01bcb` | |
| awesome-cv | `cvskills` (environment, not called) | layout, skills, opens a list | none | `8544a5e57d64` | `cvskills` |

A key is shown by its first twelve digits; the files carry them whole. Jake's `\resumeSubheading`
has an education variant with the dates and the place swapped, and Awesome-CV's `\cventry` maps the
class's position to the model's title and its organisation to the subtitle, as the port does
(decision 0015). `\cvhonor` and `\cvskill` end with `\\`, whose star and optional argument the
engine reads as their last two arguments, never given; the answers say so.

### Which port patches became redefinitions

Each is the port's patch written to redefine upstream's macro by name after the class loads, and
checked by `corpus seed` against the sample, and by probing the sample with it. The LaTeX is the
port's classes', modified versions under the LPPL 1.3c, and each answer says so.

| Template | The port's patch | Redefinition | The sample's page | What the probe finds with it |
|---|---|---|---|---|
| AltaCV | `\printinfo` sets a contact's text as it comes (decision 0013) | `\printinfo`: the editor's field, its text wrapped in `\rtfield`, as it comes; anything else re-read as upstream re-reads it; and a link's address built with the editor's markers taken out | keeps it, regenerated and as it is | the seven contacts from `twice` to `editable`; `\email`, `\linkedin` and `\github` break where the probe marks the sample's raw `_`, which item 7's regenerated text escapes |
| AltaCV | `\cvevent` lets the dates and the place wrap | `\cvevent` | moves one line: an event whose date or place does not fit half the column, which upstream's box lets run over, and which the redefinition wraps | its arguments are editable without it |
| AltaCV | `\cvtag` sets the text as a box and draws the frame | `\cvtag` | moves every tag: upstream sets a tag's text inside a transform the PDF applies, the reference reads the DVI's glyphs where the transform leaves them, and the redefinition sets the text where the PDF shows it | `moved` to `editable` against its own page |
| Awesome-CV | `\@sectioncolor` takes the title whole (decision 0015) | `\@sectioncolor` and `\sectionstyle`, which upstream writes to pass three tokens | keeps it | `\cvsection #1` from `misaligned` to `editable` |
| Awesome-CV | `\makecvheader` starts its lines with `\leavevmode` | `\makecvheader`, patched by name with etoolbox's `\patchcmd`, which also builds each contact's address with the markers taken out | keeps it | the contacts from `twice` to `misaligned`: each of the sample's holds a digit, set in Roboto's proportional figures (decision 0022); with letters for the digits, `editable` |
| Awesome-CV | the contacts through `\extrainfo` | `\mobile`, which makes its `tel:` address from the number it stores with the markers taken out | keeps it | `\mobile #1` from `twice` to `misaligned`, its digits Roboto's |
| Awesome-CV | `cvhonors`' date column | `cvhonors` | keeps it | the same verdicts |
| Awesome-CV | `cvskills`' label column | `cvskills` | the sample does not open it | none |

The port's `\@sectioncolor` kept a space among the title's first three characters, which upstream's
three arguments drop; the redefinition drops it, as upstream does, and opens the colour's group
before the field, in vertical mode, where upstream opens it, so that the field's begin marker, which
starts the paragraph, moves no colour special: the port's own order moved every sample title. The
contacts do not go through `\extrainfo`, as the port's snippets send them, since a redefinition
that did would set a fork's contacts in the order it calls them, where upstream sets them in its
own, which changes the page; the redefinitions keep upstream's contacts in upstream's order and take
the markers out of their addresses instead, and `\extrainfo`'s answer is in the seed for a document
that calls it. `\mobile` stores the number first and names no parameter after, so that it is still
a storing call the probe issues again.

What did not become a redefinition, and why:

- **What changes the page on purpose**: AltaCV's capitals, which the aligner's folding reads
  (decision 0022), and Awesome-CV's small capitals set upright and Roboto's tabular figures, which
  item 8's reading of a substituted glyph's text makes unnecessary.
- **What the loop needs of any template**: pdfx, hyperref on the dvipdfmx driver with no bookmarks,
  pgf's driver, accsupp, Latin Modern after T1, the TS1 substitution families and tcolorbox for
  AltaCV, and hyperref's bookmarks for Awesome-CV, which item 7's rewrite of the preamble does for
  every import (decisions 0008 and 0009).
- **Awesome-CV's fonts**: fontspec, unicode-math, fontawesome5, roboto and sourcesanspro not
  loaded, the icons by code point and the bullet from the text font: item 8's translation of fonts.

### What item 7 assembles from an answer

A call's kind picks the snippet its macro writes: an entry's, a bullet's, a section's, a labelled
item's, the header's or a contact's or a link's by its field or kind; each argument's slot is a
slot of that snippet, and one with none keeps the value the document's first call gives it, or is
left out where its blank is `absent`. A role's variant is a variant of the snippet. A macro that
opens a list and the one that closes it wrap the list slot's block, as Jake's port writes
`\resumeItemListStart`, `{{bullets}}` and `\resumeItemListEnd` inside `{{#bullets}}`; an environment
that holds a list does the same with its `\begin` and `\end`. `omitWhenBlank` is a `{{#text}}`
block around the unit. `layout` stays in the document snippet as the document has it, and `other`
is an extra. The preamble's parameters become controls whose snippets set the named command's key
again after the format. The redefinitions go after `\documentclass`, each once by name, and stay
only where the reference check proves them on the document.

## Consequences

- Item 7 judges the redefinitions document by document, and on the upstream samples refuses two:
  `\cvevent`, where a date or a place runs over half the column, and `\cvtag` everywhere, unless the
  reference reads a glyph inside a transform only the PDF applies where the PDF sets it, which
  would let every AltaCV fork's tags be edited. It regenerates a field's text before it probes with
  a redefinition, since the marked path of `\printinfo` takes the generator's escaped text and a
  raw `_` breaks it. And it reads a document's tree from its original's signatures: an environment
  a redefinition gives xparse's `+b`, as `cvhonors` and `cvskills` are, reads to the engine as
  taking its body as an argument, which the parser keeps raw, so the awards' calls would go.
- Awesome-CV's contacts and address wait for item 8's reading of Roboto's proportional figures;
  with it, the seed's redefinitions make every sample contact editable.
- Items 9 and 10 answer `ModelNaming` and store `StoredAnswer`s by key, after `checkRequest`; the
  prompt's meaning is part of `NAMING_VERSION`.
- Item 11 finishes the masking. What the simple form does not find: a person's text that only a
  definition holds, which no document string names, as a preamble's own macro holding a summary;
  a name inside an identifier in a definition, as a colour named after its owner; and a single word
  of the body in a definition. Item 4's link pattern masks an address template a class writes
  itself, `mailto:#1` among them, which the model then reads as a link to somewhere; changing it
  moves every key, and goes with a version.
- The milestone's line for this item, that the pipeline assembles a package for each upstream
  sample from the seed alone, is item 7's to meet; the seed's check is that each sample's every
  macro has an answer that validates under its key, which holds for all 65.
- The oracle now finds Awesome-CV's `\cvhonor` calls, since item 4's fix placed `cvhonors`' body:
  the four arguments are editable, as the port marks them.
