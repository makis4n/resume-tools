# 0024. The naming contract, and the seed answers

Date: 2026-09-27 · Status: proposed; reviewed answers may come from Opus (0037); superseded by 0049: the naming step leaves the import, and item 17 deletes its code

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
- **Every definition is masked by pattern; only the document's own by its values.** Item 4's
  patterns mask emails, links and phone numbers before anything is hashed (`maskDefinition`, moved
  into the package so that the rules live with the contract). A definition from the engine's tree,
  a class or package of TeX Live's, is public and cannot hold the person's details, so it goes as
  item 4 hashed it, whoever the person is: its key is then every fork's, and no masked word of it
  can tell a reader who has the package which word the person's details hold, as a class's
  `\hfill Page \thepage` sent as `\hfill Xxxx \thepage` would say the surname is Page. A
  definition is the document's own when the upload defines its name: the builder reads the main
  file and each `.tex`, `.cls`, `.sty` and `.def` the upload holds (`sourcesOf`) for `\newcommand`
  and its kin, `\def`, `\edef`, `\gdef`, `\xdef` and `\let`, xargs' and etoolbox's commands,
  xparse's commands and environments, `\newenvironment`, tcolorbox's, expl3's `\cs_new:Npn` and
  `\cs_set:Npn` and their variants, and `\@namedef` or `\csname` with the name spelt out
  (`ownNames`); a macro the engine prints as a robust command's, an optional argument's or xparse's
  code is its command's. Without the sources every definition is the tree's.
- **The document's values mask its own definitions** where a matcher reads text (below), accents
  taken off, in any case, across commands, braces, punctuation and spaces, and as whole words, so
  that `{\Large Quill Invented}`, `\mbox{Quill}\mbox{Invented}`, `+44\,20\,7946\,0000` and `Jos\'e`
  are found, and `Tom` never masks `bottom`. What is looked for: each phrase of two words or more
  that start with letters, of the body's text runs, dates and raw chunks, of the header's values,
  the name whole among them, and of the texts the preamble stores; each identifier, an email, a
  link's host and its address without its scheme (`quill.example` from `https://quill.example`,
  the address after `mailto:`, the digits after `tel:`), a path's handle of five letters and digits
  or more, and a run of seven digits or more, the header's links and the body's alike; and each
  word of the header's first and last name of three letters or more. Then the literal rule, in the
  definition's direction: each pair of adjacent words of a literal of the definition, a stretch no
  command, brace or code parts, that a phrase of the document holds is masked, however much longer
  the phrase, so that `\textbf{Larkspur Labs}` is found in a paragraph that names the firm. Never
  looked for: a link's label, which is the class's word as often as the person's (`GitHub`); a
  single word of a stored text's; and a single word of the body's, `itemize` or a section's title,
  which a copy of a public class holds as often as the person writes it. A number with a unit,
  `0.5cm`, is no text of the person's. A definition that masking changes is sent with the SHA-256
  of what is sent, never item 4's hash of the text that held the person's details, which the masked
  text would let anyone confirm a guess against; its key, and those of the macros that name it, are
  then the document's own, which no fork's cache entry serves, as is right for a definition that
  holds the person's text.
- **What a matcher reads as text** of a definition (`visibleOfMeaning`) is its letters and digits
  outside commands' names, parameters, the patterns' placeholders and code: the arguments of
  `\color`, `\textcolor`'s first, `\pagecolor`, `\colorlet`, `\definecolor` and the table's colour
  commands; of the counter, length and boolean commands; `\csname` to `\endcsname`, `\@nameuse`,
  `\@namedef`, `\begin` and `\end`; of `\usepackage`, `\RequirePackage`, `\documentclass`,
  `\input`, `\include`, `\label`, `\ref`, `\pageref` and a link's target; of `\hypersetup`,
  `\pgfkeys`, `\tikzset`, `\pgfkeysvalueof` and pgf's mathematics; of `\ifthenelse`, `\equal` and
  the `\@if` tests; of fontspec's, the font selection's and babel's language commands; every message
  command's, `\PackageWarning` to `\wlog`; each key of a key list; and each value in an option
  list's brackets, tikz's `[draw=white, anchor=west]`. So a class word the person's name spells in
  code, `\color{white}` for a surname White, moves no key. A body's raw chunk is read the same way,
  so that a colour or a language the body names is no text of the person's.
- **Settings are masked by the same texts**, words and phrases as whole words, and an identifier
  of six characters or more anywhere, a handle inside a colour's name among them: a first name
  `Tom` never rewrites `bottom`, `Ali` `ItalicFont`, nor `Art` `article`. A colour the preamble
  names keeps its name though a word of the person's is inside it, `quillblue`, as the class's
  code that sets the colour does; a whole word of theirs, `\definecolor{quill}`, is masked.
- **Signatures** go in xparse's syntax, each default an argument gives, `O{...}`, `D<>{...}`,
  `G{...}`, `R<>{...}` and `E{...}{...}`'s, masked by the patterns and then written as its
  placeholder, every letter and digit of it, a command's name among them (`maskedSignature`):
  `O{Quill Invented} m` goes as `O{Xxxxx Xxxxxxxx} m`, and fontawesome5's `O{\str_use:N ...}` as
  `O{\xxx_xxx:X ...}`. A signature takes no part in a key, so a masked default moves none, the
  seed's and those of the corpus's documents with fontawesome5's defaults among them.
- **The leak check** (`assertNoText`) is stricter than the masking, on purpose, so that it finds
  what the masking misses. It throws when any text of the document's, a body run, a date as it is
  spelt, a raw chunk's piece, a header value or a word of the name, a stored text, or an
  identifier any of them holds, of three letters and digits or more, single words among them, is
  in a call site, a signature, a setting, the class or an own definition as whole words, and, in an
  own definition, when a pair of adjacent words of a literal is a phrase's; and when a phrase of
  two words or more, or an identifier, is in a definition of the tree's, where a single word of the
  body's is no leak. A text of one word and numbers, a name set above a phone number that the
  parser reads as one run, is looked for as that word too. In a setting or the class, a single word
  of the body's or a stored text's that the setting keeps as it is, a keyword or a colour the
  settings define, is no leak; a word of the header's is. It names what kind of text is where,
  never the text. What it proves: no text of the document's, as its tree, the header and the
  stored texts the caller passes give it, is spelt out as whole words where the check reads, and
  no identifier of six characters or more is anywhere in a setting. What it does not: text in code
  the matcher does not read (above); a name inside a longer word, as a colour named after its
  owner; a word the body writes only inside a longer text, in a definition; a text a definition
  holds that no document string names; and anything the caller's header and stored texts leave
  out. Over the corpus's 117 compiling documents, each with its sources and a header of its own
  name's words, no definition of the tree's is masked, and the check passes on the builder's
  request for 114: the three it fails on hold the person's text, stored or written raw, in a
  definition the builder does not mask by it: a single word in two of their own, and a stored
  text in the tree's `\ecv@rfoot`, which europecv's setter filled. Item 11 (decision 0033) adds
  the page, read with the upload's fonts, and the header's address to the builder's and the
  check's sources, reads a definition's control symbols, letter commands and code as the page does,
  holds a macro a storing call filled as data where closures are computed, reads the request's
  names, and refuses a page the detector cannot read. Over the corpus's 117 documents with a
  reference, 104 of the 110 it reads pass, the gate withholds 6 for a single word of the page's in
  a macro of their own, which the check alone looks for, and 7 in T1's Computer Modern are refused
  (`corpus leak`).

`REQUEST_CAPS` bounds what a service reads: 512 macros, 8,192 definitions of a megabyte each at
most, 32 arguments, three sites of 4,000 characters, 256 settings of 2,000. The schema refuses a
signature that is not xparse's, or whose defaults, `O{...}`, `D<>{...}`, `R<>{...}`, `G{...}` and
`E{...}{...}`'s, hold a letter but `x` and `X` or a digit but `0` outside the names of commands,
which a default spells as code does, `@`, `_` and `:` among their letters (`defaultHoldsText`): a
default is the definition's own text, `O{quill@example.invalid}` among them, and the builder sends
it as its placeholder. The placeholder and `holdsText` count marks and the letters of an enclosed
alphabet as letters (`\p{Alphabetic}` and `\p{M}`), so that a Devanagari or Tamil name's vowel
signs and viramas, a decomposed accent and `Ⓠ` go as `x`. `maskDefinition`'s patterns read a
host of ten labels of 63 characters at most, a path of 2,048 and an email's local part of 64, so
that masking takes time linear in a definition however it is spelled: unbounded, 64,000 dotted
letters took seconds.

### The answer

The model's answer for a macro, `ModelAnswer`, is words from closed lists and nothing else:

| Field | What it holds |
|---|---|
| `kind` | `entry`, `section`, `bullet` (an entry's bullet, or a list section's item), `bulletList`, `header`, `contact`, `link`, `labelledItem`, `paragraph`, `layout` (sets none of the resume's text) or `other` (the model has no place for it, and item 7 keeps it as an extra) |
| `arguments` | each argument by its index: its meaning, `title`, `subtitle`, `place`, `dates`, `text`, `label`, `address`, `icon`, `colour`, `length`, `key` or `other`; the slot it fills, one of decision 0006's for the kind (an entry's `title`, `subtitle`, `place`, `dates`, `bullets`; a section's `title`, `entries`, `items`, `text`; the header's `first`, `last`, `headline`, `email`, `phone`, `location`, `links`, `contacts`; a contact's `text` and `href`; a link's `label` and `href`; a labelled item's `label` and `text`; a bullet's and a paragraph's `text`); the paragraphs it holds, each with its meaning and slot, where it holds more than one, as Jake's projects heading holds its title and subtitle either side of `$|$`; and what it is in a blank unit, `empty`, `absent` or `kept` as the document's first call gives it |
| `repeatable` | a unit the user may add and remove: an entry, a bullet, a section, a link |
| `omitWhenBlank` | a blank unit is left off the page, as a tag whose empty frame would show |
| `list` | whether it opens or closes a list; the macro that closes what it opens, which a command that opens one must name and an environment's `\end` is, or opened what it closes; and what the list holds. A closer is of its opener's kind |
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
  name, or adds one it needs, applied after `\documentclass`, or before `\begin{document}` where a
  compile stops there, as it does for a macro a package or the preamble defines, once by name
  (`withRedefinitions`, whose `placement` is `class` or `preamble`), so that a macro that defeats
  the editor's markers gets the fix its port has. A redefinition must keep upstream's output, which
  item 7's reference check proves document by document; one that changes the page on purpose, as
  AltaCV's port took its capitals out, does not qualify. Code the model wrote would run in every
  document whose macro has its key; code a person reviewed may.
- **A stored answer** is `{ version, key, hash, of, name, family?, answer, reviewed, source,
  dependencies?, partnerKeys? }`, by the macro's key, `source` `seed` or `model:<id>`, reviewed
  exactly when the answer is a person's, and the seed's always. `of` tells a command from an
  environment, which may share a name. `dependencies` are the `[name, hash]` pairs its key was
  computed from, in order, an environment's `\end` first, so that `keyOf(version, hash,
  dependencies)` is its key and a new version can file it again without the document; and
  `partnerKeys` the keys of the macros its list names, `closedBy` and `openedBy`, given only for a
  partner the answer names. `answerFor(cache, key)` gives a stored answer only when it validates,
  is of this version, was filed under the key asked for, and, where it names its dependencies,
  they give that key: what a cache holds is not trusted. Asked for a document's macro,
  `answerFor(cache, key, { name, of, partners })` also fits the answer to it (below, the key).
- **The preamble's answer** names the style parameters found, `pageSize`, `margins`, `fontSize`,
  `font`, `accent` and `density`, each by the request's setting that sets it, or the class's
  options, its command and the key or name inside it, so that item 7 writes the control's snippet
  itself.
- `ModelNaming` is what item 9 asks the model for as structured output, one answer for each macro
  by its name and `of`, a command that opens a list naming its closer, and the preamble's, each
  style parameter by the index of a setting the request has; `NamingAnswer` is what item 7
  assembles from, the stored answer of each macro that has a key and the preamble's. A macro that
  holds data has no key and is never answered. Whether each partner a list names is a macro of
  the request is checked where the request is known, by item 9's `name` and by `corpus seed`, not
  by the schema.

### The key

`keyOf(version, hash, dependencies)`, the SHA-256 of the JSON of the naming version, the macro's
hash, and its closure's definitions as `[name, hash]` in order, data left out. Item 4's `keysOf`
now builds every key through it, so there is one function, and item 4's keys carry the version;
equality between documents, which the corpus runner compares, is unchanged. `NAMING_VERSION` is 1,
and goes up when the request, the answer or what the prompt asks changes meaning.

- **An environment's key** is `environmentKeyOf(version, beginHash, endName, endHash,
  dependencies)`: `keyOf` over its `\begin` code's hash, its `\end` code first among its
  dependencies, by its end name, then the names of both closures, the `\begin` code's and the
  `\end` code's, each once, data left out (`keyInputs`). An `\end` code that holds data, as an
  empty one does, and as Awesome-CV's `cvparagraph`'s does, is left out as every dependency that
  holds data is, and the key is `keyOf` over the rest. The request builder and item 4's `keysOf`
  compute it the same way, and `keysOf` gives each environment the body opens its key by its name,
  in place of its `\begin` code's alone, so that the corpus runner's comparison of a shared file's
  keys and the seed's comparison with item 4's cover environments as they do commands.
- **The key leaves out the macro's name.** A fork that renames a macro and keeps its definition
  keeps its answer, and another template's macro of the same definition and closure gets it too,
  a bare `\end{itemize}` among them. What an answer says of other macros, its list's partners,
  the key cannot vouch for, so `answerFor`, asked for a document's macro with its request's
  macros' keys by name (`{ name, of, partners }`), gives the answer as that macro's: named as the
  document names it, of its kind, and with each partner found by the key the answer holds for it
  (`partnerKeys`) among the request's macros and named as the request names it. An answer whose
  kind is another's, or whose partner no macro of the request is by key, or that holds no key for
  a partner it names, is refused, `{ answer: undefined, reason: "kind" | "partner" }`: a fork that
  renames Jake's `\resumeItemListStart` and `\resumeItemListEnd` keeps both answers, paired under
  its names, and a `\newcommand{\bulletsEnd}{\end{itemize}}`, which has
  `\resumeSubHeadingListEnd`'s key, does not take the pairing of a list it does not close.
- **What a service checks.** A service recomputes a request's keys from its definitions
  (`requestKey`) and checks each definition's hash against its text (`checkRequest`) before it
  stores what a model answered. That proves a request's keys follow from the definitions it
  carries, and no more: not that those are the document's, nor that its call sites are. A request
  that carries upstream Awesome-CV's definitions and any calls passes it, and files its answers
  under Awesome-CV's keys for every later import. So item 10 stores a model's answer as
  unreviewed (`reviewed: false`), and never over a reviewed one; item 7 checks every answer it
  assembles against the document's own reference, whoever gave it, a reviewed one too; and the
  service caps and rate-limits what one client may store.

### The answers folder

`apps/editor/corpus/answers/<key>.json`, a stored answer a file, as Biome formats it. The milestone
had them by hash; they are by key, since the key covers the macro's closure and the naming version,
and one macro read the same by two classes that hand its work to different macros must not share
an answer. Each file carries the dependencies its key is computed from and its list's partners'
keys, which `corpus seed --write` writes: it files every seed answer under item 4's key for its
macro, found under that key, under its request's key, or by its family, kind and name, with the
hash and dependencies the key is computed from and the partners' keys the sample gives, and moves
a file whose key changed; without `--write`, `corpus seed` says what it would change, and counts
each as a problem. A test that needs neither the engine nor the oracle, and so runs in CI, parses
every file as a `StoredAnswer`, checks that `answerFor` serves it under its file's name, that it is
as `--write` writes it, and that each command that opens a list is paired with its closer, by
name and by key.

### The seed

65 answers: every template macro and environment the three samples call, and six the ports use or
a preamble defines that the samples leave out (`SEED_EXTRAS`): Jake's `\resumeSubSubheading` and
`\resumeSubItem`, AltaCV's `\printinfo`, and Awesome-CV's `\cvskill`, `cvskills` and `\extrainfo`.
The engine is asked of those with the samples' own names, and their keys come from the same class.

Every answer is filed under item 4's key (`keysOf`, an environment's by `environmentKeysOf`), which
no value of a document's masks. The check builds each sample's request as items 7 and 11 will:
with the upload's sources (`sourcesOf`), so that the macros a sample defines, Jake's in its main
file and AltaCV's and Awesome-CV's in the classes the samples ship, are its own, which its values
mask where they hold them as text; and with the header's values the sample's own calls give
(`headerOf`: each argument of a call whose answer is the header's, a contact or a link, by the
slot its answer says it fills). It requires every command's and environment's key in the request
to be item 4's, and its answer to be served for it by `answerFor`, its partners found by key,
which holds for all 65. Before the builder read a colour's name as code (the masking above),
AltaCV's `\makecvheader` moved: the sample's placeholder name holds, as a word, the name of the
colour its closure passes to `\color`. A second test builds the three samples' requests, with
their sources, with the names and values the reviewers found moving keys, `Page`, `Link`, `Box`,
`White`, `West`, `East`, `Line` and `Xing` as names, `Mobile Developer`, `Harbour Square` and
`Full Stack` as a headline, a location and stored text, and a link labelled `GitHub`, and requires
every seed key to hold with each.

`corpus seed [--json <file>] [--write]` fetches the oracle's samples as `corpus oracle` does, runs
each through the reference, the signatures, the parse, the probe and the request, built with the
upload's sources and the header's values, and prints each macro's hash, key and verdicts, item
4's key where the request's differs, and whether its answer validates, is filed under its key,
holds its hash and is served for the macro; it exits 1 when one is not, a key moved, a file is
not as `--write` writes it, or a redefinition stops a compile the sample takes without it. It then
compiles each sample with its answers' redefinitions after `\documentclass`, or before
`\begin{document}` where a compile after the class stops, as a redefinition of a macro a package
or the preamble defines needs: the body with the calls they serve regenerated as item 7 writes
them, against the same body without them, and the sample as it is against its reference; where
they move a page, each alone. The logs of compiles that stop are kept under
`.corpus/oracle/seed/`. The run takes about a minute on the M4 Pro.

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
| altacv | `\name` | header | #1 first and last, a space apart | `7d911959d48b` | |
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
| awesome-cv | `\cvsection` | section | #1 title | `76f0ea467567` | `\@sectioncolor` |
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
| Awesome-CV | `\@sectioncolor` takes the title whole (decision 0015) | `\@sectioncolor`, which reads upstream's three arguments and, where the first is the editor's marker, the title's first three tokens inside the field | keeps it | `\cvsection #1` from `misaligned` to `editable` |
| Awesome-CV | `\makecvheader` starts its lines with `\leavevmode` | `\makecvheader`, patched by name with etoolbox's `\patchcmd`, which also builds each contact's address with the markers taken out | keeps it | the contacts from `twice` to `editable`, each of the sample's holding a digit set in Roboto's proportional figures, which item 8 reads (decision 0023) |
| Awesome-CV | the contacts through `\extrainfo` | `\mobile`, which makes its `tel:` address from the number it stores with the markers taken out | keeps it | `\mobile #1` from `twice` to `editable` |
| Awesome-CV | `cvhonors`' date column | `cvhonors` | keeps it | the same verdicts |
| Awesome-CV | `cvskills`' label column | `cvskills` | the sample does not open it | none |

Measured again with the probe and the fonts of items 5 and 8, each sample against its own
reference: the Awesome-CV contacts, whose digits item 8 reads, go to `editable`, where they went
to `misaligned`; and with the redefinitions, the AltaCV sample's three contacts that break spend
the probe's 64 compiles before `\cvtag`, `\cvachievement`, `\cvskill` and `\cvref` settle, which it
leaves `untested`: given the compiles, `\cvtag` is `editable` and the rest keep their verdicts.

The port's `\@sectioncolor` takes the title whole, as its own `\sectionstyle` and
`\lettersectionstyle` pass it, and keeps a space among its first three characters, which upstream's
three arguments drop. The redefinition reads upstream's three arguments, from both of upstream's
styles, which pass the title unbraced, so that it redefines neither: as they are when the first is
not the editor's marker, and, when it is, the marker round the whole title and the title's first
three tokens read inside it as upstream reads them, a space among them dropped, in the accent only
where highlighting is on. It opens the colour's group before the field, in vertical mode, where
upstream opens it, so that the field's begin marker, which starts the paragraph, moves no colour
special: the port's own order moved every sample title. It keeps upstream's page with highlighting
off, as 8 of the corpus's 40 Awesome-CV forks have it, and for a letter's `\lettersection`, where
the first redefinition, which took the title whole, dropped no space and coloured one character;
and marked it compiles, where that one stopped. A title of fewer than three tokens sets, where
upstream's stops (`corpus-seed.test.ts`).

The contacts do not go through `\extrainfo`, as the port's snippets send them, since a
redefinition that did would set a fork's contacts in the order it calls them, where upstream sets
them in its own, which changes the page; the redefinitions keep upstream's contacts in upstream's
order and take the markers out of their addresses instead, and `\extrainfo`'s answer is in the seed
for a document that calls it. `\mobile` stores the number first and names no parameter after, so
that it is still a storing call the probe issues again.

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
again after the format. The redefinitions go after `\documentclass`, each once by name, or before
`\begin{document}` where a compile after the class stops, as a redefinition of a macro a package
or the preamble defines needs, and stay only where the reference check proves them on the
document.

## Consequences

- Item 7 judges the redefinitions document by document, and on the upstream samples refuses two:
  `\cvevent`, where a date or a place runs over half the column, and `\cvtag` everywhere, unless the
  reference reads a glyph inside a transform only the PDF applies where the PDF sets it, which
  would let every AltaCV fork's tags be edited. It regenerates a field's text before it probes with
  a redefinition, since the marked path of `\printinfo` takes the generator's escaped text and a
  raw `_` breaks it. And it reads a document's tree from its original's signatures: an environment
  a redefinition gives xparse's `+b`, as `cvhonors` and `cvskills` are, reads to the engine as
  taking its body as an argument, which the parser keeps raw, so the awards' calls would go.
- Item 7 asks the cache for each of a document's macros with `answerFor(cache, key, macro)`, so
  that an answer comes under the document's names, and a list's partners are the document's by
  key, or it asks the model again. A closer is of its opener's kind, and a command that opens a
  list names its closer.
- Item 8's reading of Roboto's proportional figures (decision 0023) makes the Awesome-CV sample's
  address editable as it is, and every one of its contacts with the seed's redefinitions.
- Items 9 and 10 answer `ModelNaming` and store `StoredAnswer`s by key, after `checkRequest`; the
  prompt's meaning is part of `NAMING_VERSION`. What a model answered is stored unreviewed
  (`reviewed: false`), with the dependencies its key is computed from and its list's partners'
  keys, the request's (`requestKey`), and never over a reviewed answer. Item 9's `name` checks
  that each partner a list names is a macro of the request, which the schema cannot.
  `checkRequest` cannot prove that a request's definitions are its document's, so item 7's
  reference check of every answer, and the service's caps and rate limits, are what keep a hostile
  request's answers from harming another document.
- After an upgrade of the pinned tree, whose packages' definitions are in most closures, pgf and
  TikZ, paracol, biblatex and fontawesome5 among them, or a bump of `NAMING_VERSION`, run
  `corpus oracle` and `corpus seed --write`, and review what moved: a key moves with any
  definition in its closure, and `--write` files each answer again under its new key. Items 5 and
  8, which changed the probe and the tree's fonts, moved none.
- Item 11 finished the masking (decision 0033): the page masks a person's text a definition of
  their own writes where the page shows it, as a pair beside another word, glue alone between, a
  number, a letter-spaced word or a word it spells a letter a word; a macro a storing call filled
  goes as data, in closures and keys too, `\@extrainfo`, `\ecv@rfoot` and the kernel's `\@author`
  among them; a macro named after a word of the person's it spells goes by a placeholder name; and
  a definition's metadata goes as placeholders. What the builder does not mask: a person's text
  that only a definition holds and the page never shows, as a preamble's own macro holding a
  summary it never calls; a single word of the body's, a stored text's or the page's in an own
  definition, which the check finds, and the gate refuses the request, the page's of four letters
  or more and none of the tree's vocabulary; a phrase an own definition parts across code that the
  body writes only inside a longer text; a name inside a longer word, as a colour named after its
  owner, in a definition or a setting, or a macro's; text written into code the matcher does not
  read, as a message that names the person; and a macro the upload defines through a `\csname`
  built from an argument, as AltaCV's `\NewInfoField` defines its contacts, which is read as the
  tree's. And a word of the header's name that an uploaded copy of a public class
  holds as text, `\hfill Page \thepage` for a surname Page, is masked, so that a reader with the
  public class can tell the surname from the request: the disclosure is left to the person's own
  uploads, since no definition of the tree's is masked. Item 4's link pattern masks an address
  template a class writes itself, `mailto:#1` among them, which the model then reads as a link to
  somewhere; changing it moves every key, and goes with a version.
- The milestone's line for this item, that the pipeline assembles a package for each upstream
  sample from the seed alone, is item 7's to meet; the seed's check is that each sample's every
  macro has an answer that validates under its key, asked with the sample's sources and the
  header's values it gives, which holds for all 65 with the masking above.
- The oracle now finds Awesome-CV's `\cvhonor` calls, since item 4's fix placed `cvhonors`' body:
  the four arguments are editable, as the port marks them.
