# 0033. What leaves the browser

Date: 2026-09-27 · Status: proposed; the leak check runs when the corpus workflow is started by hand, not nightly (0035); the rule it serves is restated as one sentence by 0047

## Context

Milestone 3 item 11. The naming request is the one thing an import sends out (decision 0024), and
the plan's rule is that nothing of the resume's text goes with it. Item 6 masked a definition by
pattern, emails, links and phone numbers, and the document's own definitions by the document's
values: the body's text, the header's values item 7's finder gives, and the texts the preamble
stores. Its leak check (`assertNoText`) was fed the same strings the builder masked with, so it
could only find a masking bug, never text the builder did not know was the person's: item 9's
security review (S2) put a name in a preamble macro the body calls,
`\newcommand{\cvcontact}{{\Large\bfseries Quill Invented}\par Harbour City\par}`, and the request
went out with the check green. Over the corpus the check failed on 3 of 117 documents, each for
the person's text in a definition the builder did not mask by it. Item 11's first round made the
reference's page the detector's source; its review found fifteen ways the page, the reader of a
definition and the check still let a name out, and the fixes below answer them. The code is
`apps/editor/src/import/naming.ts`, `signatures.ts` for what the preamble stores,
`packages/naming/src/mask.ts`, `privacy.ts` for what the import screen says, `service.ts` for the
names read back, and `apps/editor/scripts/corpus-leak.ts` for the check over the corpus.

## Decision

### The detector's sources

Four sources say what the person's text is, and the builder and the check take all of them
(`DocumentText`, `RequestOptions`): the body's tree, its runs, links, dates and raw chunks; the
header's values item 7's finder gives by the answers (`headerOf`); the texts the preamble stores,
the probe's candidates there; and the page.

- **The page** (`pageStrings(stream, fonts, upload)`) is the reference compile's glyph stream read
  as words: each glyph's text as the page names it (`glyphTextOf`), in the order the output sets
  them; a line's glyphs parted into words where the gap after a glyph's advance is 0.1 em or more,
  and lines parted where the baseline moves a fifth of an em or a glyph steps back; a word TeX
  hyphenated at a line's end read whole, a spacing accent left out, and a mark kept with its
  letter. A glyph's advance comes from the font that set it, read as the reference read it: the
  upload's file of that name first, where the stream says the upload's was read, and the tree's by
  name second; so a font the upload ships under a name the tree lacks is measured as it was set,
  and the corpus's five documents that ship fonts, set before at half an em a glyph, now read every
  glyph (awesome-cv-0003, -0018, -0025, -0035 and other-0056, whose pairs had been split). A glyph
  whose text or advance is not known, an icon's or one whose font is nowhere, is not read, and
  parts words. The words are then read as a body's text is, parted at punctuation. It gives each
  word of three letters or more; each pair of adjacent words of one line, each of three letters or
  more, since a line's end or a word of one or two letters ends a pair; each identifier, an email,
  a link written with or without its scheme and a run of seven digits or more; each number of two
  digits or more, a house's, a postcode's or a year; each word it shows letter-spaced, as soul's
  `\so` sets it, its single letters joined where the gaps between them are alike and parted where
  one is half as wide again as the narrowest; and how many glyphs it sets and reads. It takes time
  linear in the glyphs; a twenty-page reference costs ten times a two-page one (`naming.test.ts`).
- **A page the detector cannot read refuses the request** (`pageReadable`). It must read three
  quarters of its glyphs, a word for every hundred of those, and a word at least. Over the corpus
  each page it reads reads 97.6% of its glyphs or more, and shows a word for every 38.5 of them or
  fewer; the 7 it refuses are T1's Computer Modern, the EC fonts, whose metrics the tree has and
  whose outlines it lacks, so that they read no word, and at most 21 of a page's 2,581 glyphs.
  There a name a preamble's
  macro writes would go unseen, so `buildRequest` refuses with a plain reason, "This resume's text
  is set in fonts this editor cannot read yet", the refusal reason `unreadable`, and the gate
  (`assertNoText`), the runner and the corpus test count the document as refused, never passed.
  Item 7's rewrite of such a document to Latin Modern will lift it: with `\usepackage{lmodern}` the
  same document is read, and its name masked (`naming.test.ts`).
- **Why the page is the strongest source.** It is the text as the world reads it, whatever holds
  it: the body, the header, a stored text, or a macro of the preamble's that no body text names,
  which S2 is. The body's tree says only what the body spells; the page says what the document
  prints.
- **What it cannot see.** Text in a definition that never reaches the page: metadata, a message, a
  macro defined and never called, a branch not taken. Metadata a definition writes is masked by its
  shape instead (below). A word the page parts, or joins, as a compound broken at a line's end after
  its own hyphen; and a text set in a font the page reads none of, on a page it reads otherwise.

### How a definition is read

What the builder masks and the check reads of a definition is its visible text
(`visibleOfMeaning`), read from the engine's printout:

- **A control symbol is one character.** The printout writes a space after every name but a control
  symbol whose character is the backslash, whose category is the escape's while it prints: so `\\`
  is the line's end, and what follows it is text or the next token, `\\Larkspur Lane` the break and
  two words, where it had been read as one command's name. A name that starts with a backslash is an
  optional argument's code, which the kernel hands a command's work to right after naming it,
  `\@protected@testopt \cvitem \\cvitem {}`, or after `\@testopt`. Of the corpus's 59 own
  definitions with `\\` straight before a letter or a command, 56 are that optional argument's
  code, 3 a line's end before a command, and none a line's end before text; the signatures step's
  reading of names (`tokensOf`) reads them the same way.
- **A letter command is its letter**, `\o`, `\ss`, `\l`, `\ae`, `\aa`, `\oe`, `\i`, `\j`, `\dh`,
  `\th`, `\ng`, `\dj` and their capitals, and an accent command and the letter after it, braced or
  not, a dotless `\i` among them, the letter composed: `Bj\o rnstad`, `Wei\ss{}enfeld`,
  `Wr\'o\-b\l ewska`, `Gr\ae nl\aa kke` and `Mar\'{\i}n` read as the page shows them, so a page's
  pair masks them, where their letters had been dropped. `\-`, `\/` and an empty group part no word.
- **Code is not text.** Besides decision 0024's code: an address's scheme before its colon,
  `https://\@homepage` and `skype:\@skype`, where no link is left for the pattern to mask; a
  quantity, `0.97\textwidth`, `12pt` or `0.85`, never a house's number or a year; a length's
  argument, `\hspace{...}` and `\hskip 2pt plus 1fil`; the file of `\includegraphics` and the icon
  of `\faIcon`; and the option lists of tikz's paths, `\node[rounded corners]`, whose every entry
  is a key.
- **Glue and code between words.** Braces, a line's end, `\par`, a space's command, a font or size
  switch, a text font's command opening its group and a length are glue; a parameter, an option's
  bracket, a code command's argument and any other command part two words hard (`Visible.glued`).

### What the builder masks, and what the check looks for

- **The builder** masks the document's own definitions and the settings by the body's, the
  header's and the stored texts' phrases and identifiers, and each word of the header's name, as
  decision 0024 has it. From the page it masks, in the document's own definitions alone: its
  identifiers; its pairs, where the definition holds the two words adjacent or parted by glue
  alone, `Quill\hspace{0.4em}Invented`, never across code as a phrase is found, and never a pair
  that holds a word of the tree's vocabulary (below), a resume's `Node services` beside tikz's
  `node`; each number of two digits or more, as one word, never `1,...,5` read as `15`; each
  letter-spaced word; and each word the page shows that a definition spells a letter a word,
  europecv's kerned title, `E\ecv@kern u\ecv@kern r...`. A single word the page shows masks
  nothing: the page shows the template's own words, `Experience`, `Page`, `Email`, as often as the
  person's. The text of a definition's metadata, each value of a `\hypersetup` key list that is
  text, not a command, a number, a length, a hex colour or a keyword, goes as its placeholder
  (`maskedMetadata`), `pdfauthor={Xxxxx Xxxxxxxx}`, since it never reaches the page.
- **The tree's vocabulary** (`vocabularyOf`) is every word and number the tree's definitions a
  request carries show as text, built from the request itself, never from a dictionary: tikz's
  `node`, a class's `Page`. A page's pair that holds one masks nothing, and a word or a number of it
  the check reads as the tree's, not the person's.
- **The check** (`findLeaks`, which `assertNoText` throws on) is fed the page too, and stays
  stricter than the builder. In a call site, a signature's defaults, a setting and the class it
  looks for the page's single words as well, a keyword or colour a setting keeps excepted as the
  body's are. In an own definition it looks for everything the builder masks by, and every single
  word of the body's, a stored text's or the page's, a page's word only of four letters or more
  and none of the tree's vocabulary: so `Born 12 March 1994` in a preamble's macro, whose numbers
  the builder masks, is still found. It never looks for the page's strings in a definition of the
  tree's. Each leak says whether it is a single word the builder does not mask by (`Leak.alone`):
  the gate refuses the request either way, and nothing of it leaves; only a leak that is not alone
  is the builder's fault.
- **Names are checked, and masked when they are the person's.** The check reads every name a
  request holds of the document's own macros: each macro's, definition's and dependency's, and each
  command's a call site keeps. A name is the person's word (`nameOrigin`) when, parted at capitals
  and at anything but a letter, `\quillPage` into `quill` and `page`, a part is a word of the
  header's name, the parts together are a word the page shows of four letters or more, or two parts
  in a row, or the whole run together, are a pair the page shows, none of them the tree's
  vocabulary; and the macro spells out what its name is, as a shortcut for a word does,
  `\newcommand{\Wrenfield}{\textsc{Wrenfield}}`, or holds data and is named with letters alone. A
  template's names are made of the words its page shows as labels, `\email` and `\tagline` beside
  the person's address and headline, which they store and never spell, and renaming them moved the
  launch samples' keys; a part alone that is a word of the page's is no word of the person's
  either, `\resumeItem` of a page headed Resume. The builder writes each such name as a
  placeholder, `rtx` and letters, the same throughout: in the macros, the definitions, the
  dependencies, the call sites and the definitions' texts, and masks the words it spells in its own
  definitions. The key leaves out a macro's own name, so its answer is the cache's as before; its
  dependents' keys are the request's, which the service computes from what it carries. The map from
  placeholder to name stays in the browser (`BuiltRequest.names`): the check reads a masked
  macro's definition as the document's own through it, the service's reply is read back through it
  (`withRealNames`, `nameOnService`), and item 7 assembles under the document's names. A leak
  of a name never names the macro. Over the corpus 8 names in 4 documents go as placeholders.

### The own-versus-tree rule, restated

A definition of the tree's, a class or package of TeX Live's, is public code: it is masked by
pattern and never by the document's values, the page's among them, so that its key is the same
whoever the person is and a masked word could tell no one which word their details hold (decision
0024). The check looks in it for a phrase or an identifier of the body's, the header's or a stored
text's, and not for the page's strings, since the tree's classes set their own words on the page. A
definition the upload defines is the document's own, and is masked by every source.

One kind of macro is the person's whoever defines it: the one a storing call of the preamble's
filled. The signatures step reads what the preamble stores (`signatures`): the setters it calls in
its main file and in every file it inputs, `\input`, `\include`, `\subfile` and `\import`'s, the
commands of those files asked of the engine too, each read from its meaning, a robust one's code
among them (`storedTargets`): the template's, as Awesome-CV's `\position` stores `\@position`,
and the kernel's, as `\author` stores `\@author`; moderncv's `\address`, xparse's, and its
collections, which it cannot read so (`TREE_STORAGE`); and hyperref's `pdfauthor`, `pdftitle`,
`pdfsubject` and `pdfkeywords` where the preamble gives them. Each macro they fill holds the
person's text, and is data though that text names a command, `\position{\small ...}`: no closure
follows or counts it, `keysOf`, the request and the seed agree, and its dependents key as they
would had the text named no command. The Awesome-CV sample with its position in `\small`, with an
icon, or with an extra's icon keeps every seed key, where the first moved `\makecvheader` off its
answer; over the corpus the stored macros' dependents in awesome-cv-0035 and europecv-0006 key as
item 4 keys them. A setter the preamble never calls leaves its macro holding the class's default,
which goes as the class's code.

### The header's address

The header's location, where the finder puts a postal address (a header's location slot, or a
contact of that kind: AltaCV's `\mailaddress` and `\location`, Awesome-CV's `\address`), is looked
for as a phrase, as before, and by its parts (`addressNeedles`): each postcode of letters and
digits, the UK's and Canada's shapes in any case and with or without the space, as an identifier;
and each of its words that holds a digit, a street's number or a postcode of digits, with the word
before it and the word after it where those start with letters, as a phrase, `221B Larkspur`,
`Hauptstraße 5`, `75001 Paris`, `City 94103`. A number alone is looked for only as the page shows
it, in the document's own definitions (above).

The patterns (`maskDefinition`) gain one shape, a postcode of letters and digits in capitals with
the space between its halves, the UK's `QV1A 2ZX` and Canada's `X9Q 0Q9`, masked by underscores of
its length, as every definition, setting and default is masked before it is hashed. No other shape
is unambiguous in code: five digits, a ZIP code or a German, French or Spanish postcode, are
numbers as a class writes them, and the Netherlands' `1012 AB`, four digits and two capitals, is
too plain a shape to tell from code. Across the 42,280 definitions the engine printed for the
corpus's 117 documents, the new shape matches none, so no key moves, and a test holds class code
with numbers, fonts' encodings, lengths, colours and coordinates as it is.

### The corpus-wide leak test

`corpus leak [--only <id>] [--json <file>]` (`scripts/corpus-leak.ts`, `corpus-leak-child.ts`)
takes every fetched document in as the reference runner does, in its pool of four children with
90 s each, and for each that compiles to a reference and whose body parses builds its request as
the import will: the upload's sources, the page's strings read with the upload's fonts, the texts
its preamble stores, and the header's values the finder gives by the seed's answers, found with a
request built with the page. The probe's compiles are left out, as the seed's check leaves them.
It checks each request with `findLeaks`, fed all four sources and the names' map, and each
document is one of: checked and passed; checked and withheld by the gate, its request holding only
single words the builder does not mask by; checked and failed, its request holding text the
builder should have masked; refused, its page one the detector cannot read; invalid, a request the
contract's schema refuses, which the builder throws (`InvalidRequest`) and the runner names by
kind of place and macro, never text; not parsed; crashed or timed out; or with no reference. It
prints each document's outcome, then a table per family, each failure's, withholding's and
invalid request's leaks by macro and kind, and the refused documents, never the text. It exits 1
when the proof fails or shrinks (`leakFailures`): a request fails, one is invalid, a document
crashes or times out, fewer documents are checked or refused than have a reference, as when one
does not parse, or none is checked at all. A Vitest test (`corpus-leak.test.ts`), which runs where
the corpus is fetched and the engine built, runs the same check over the corpus and asserts the
same; the nightly workflow runs `corpus leak` after `fetch`, puts its table in the run's summary,
and fails with it.

The result, on the M4 Pro in a minute: 220 documents, 103 with no reference, **117 with a
reference: 110 checked, 104 passed, 0 failed, 6 withheld by the gate for a single word the builder
leaves, 7 refused for pages the detector cannot read, 0 invalid, 0 not parsed, 0 crashed or timed
out**. The document's values masked 14 of the 1,469 own definitions of the checked documents, in
9 documents, europecv-0002's shipped class's kerned title among them, which moves that fork's key
alone and no seed's; 8 names in 4 documents went as placeholders; the finder found header values
in 40 documents. The six withheld hold, in macros of their own, a word the page shows alone: two a
label before a colon, one a shipped class's own section words, one a word the page shows on every
page in two of a shipped class's macros, one a word a fork's header macro sets, and one two macros
a fork wrote that set a word of the page's. The gate refuses each, and nothing of them leaves.

The three item 6 left, and what fixed each, in the masker:

| Document | What the check found | What masks it now |
|---|---|---|
| other-0023 | a word of a raw chunk of the body in `\makeheader`, a header macro of its own | the page: `\makeheader` sets the word beside others of the person's, and the page's pairs mask them; one word it sets alone the check still finds, and the gate withholds the request |
| awesome-cv-0035 | a stored word in its own `\@extrainfo`, which `\extrainfo` filled with a text holding a command | the storage rule: it goes as data, as a macro a storing call filled |
| europecv-0006 | a stored text in the tree's `\ecv@rfoot`, which `\ecvfootnote` filled with a text holding a command | only the storage rule: a tree's definition is masked by no value, and it now goes as data |

A second test (`corpus-seed.test.ts`), where the corpus and the oracle's samples are fetched, builds
each launch sample's request with each readable corpus page's strings in place of its own, as a
fork that ships the class unchanged shows a page of its own, and requires every seed key to hold;
and with the reviewers' sentences, `Built invented services with Node at Larkspur`, in a sample's
body. `corpus seed` has no problem.

### What the test proves

For each of the corpus's 110 documents that compile, parse and read, the request the import builds
holds, where the check reads, no text of the body's, of the header's values the finder gives, of
the preamble's stored texts or of the page's that the builder masks by, and in 104 of them no
single word of theirs either; the other 6 the gate withholds. It does not prove what the sources do
not hold: text that never reaches the page and is not metadata, a message; a word the page shows in
a font it cannot read, on a page it reads otherwise; a name inside a longer name that is not the
person's word whole, `\quillname`, or a macro named after a word it does not spell; text in code the
matchers do not read (decision 0024); a header the finder does not find, which it finds only by the
seed's answers until the model's are cached. And it proves it for the corpus, not for every resume.

### What the import screen says

`src/import/privacy.ts` exports the note item 12 shows where a resume is imported, two sentences
that say what the code ensures: "To learn your template, the editor sends only its command
definitions, with the names, emails, phone numbers, links and addresses your page shows replaced,
the shape of a few places that use them, with their letters and digits replaced and the template's
command names kept, and the page's style settings; your resume's text and your header never leave
your browser, and its PDF leaves only when you send it to the checker. Text that never reaches your
page, such as the author and title a document keeps in its details, cannot be checked, so the
editor replaces it rather than sending it." The PDF leaves only through the ATS checker, which
AGENTS.md allows. A test pins it, and checks that it is two sentences with none of LaTeX's special
characters and no command's name.

## Consequences

- Item 7 and item 12 build the request with the page: `pageStrings(reference, fonts, intake.files)`
  after the reference compile, with the same fonts, and pass it, the sources and the header's values
  to `buildRequest`, which gives the request and the names' map, or refuses; the same, the map
  among them, go to the check before anything is sent, and the map reads the reply back.
- Item 9's runner (`corpus-name-child.ts`) builds the request and its gate as `corpus leak` does
  (`gatedRequest`), which closes S2: a name a macro of the preamble writes is masked where the page
  shows it as a pair, and the gate refuses the request where the builder leaves a word of it alone.
  A document whose page it cannot read is counted refused.
- The gate withholds some requests the builder cannot make safe, a single word the page shows in a
  macro of the document's own: such an import cannot ask the model, and names its template from the
  cache alone. Masking such a word would move the key of every fork that ships the class, and is not
  done.
- A phrase of a class's own that the page shows is masked in a copy of that class the upload ships
  as the person's would be, since nothing tells the two apart; the macro's key is then the
  document's own, and a fork that ships such a class misses the cache for it. Over the corpus none
  of the seed's 65 keys moved (`corpus seed`, `corpus-seed.test.ts`, whose requests are built with
  the page, and with every corpus page's).
- Documents in T1's Computer Modern are refused until item 7 rewrites them to Latin Modern.

## Update, 1 October 2026

Decision 0038: the browser builds its request with the upload's sources and the page's strings, and
without the header's values, which only the answers to that request give, and gates it with
`assertNoText` fed the tree, the texts the preamble stores, the sources, the page and the names; the
first consequence above no longer holds for item 12. `corpus leak` and the corpus-wide test proved
the request built with the header's values, which no browser sends. They now build the request the
browser sends, through the same function (`importRequest` in `naming.ts`), so that the two cannot
drift, and check it with the header's values the finder gives besides, so that a header word the
request holds is found: a three-letter word of the header's in the name of a macro the document
defines is one such, since the page's words reach a name from four letters (`nameNeedlesOf`). On
the 20-document sample the check came out the same before and after: 20 checked, 19 passed, 0
failed, 1 withheld by the gate for a single word, 0 refused.

The whole corpus then found one failure the sample did not: in altacv-0019, a word of the header's
of four letters, which the page shows, stood in a `\colorlet` setting, kept as a keyword or a
colour's name. The builder masks a setting's words by the header's values, which the browser's
request is built without, and no other needle reaches a single word in a setting. The rule now: a
word a setting keeps as it is, a keyword or the name of a colour the preamble defines, that is a
word the page shows or a text the preamble stores holds, of three letters or more, the header's
threshold, goes as its placeholder (`maskedSetting`, `personalWords`). Every other word of a
setting went as its placeholder already, so a setting now keeps no word of the person's that the
browser can know, and the header's values are among those words; the model still reads which
settings are controls. The leak runner tells such a failure without the word
(`explainSettingLeaks`): the setting's command, its key where the key is a keyword, the word's
length, whether the page shows it and a stored text holds it, and which needles mask it. The whole
corpus after it: 117 documents with a reference, 110 checked, 104 passed, 0 failed, 6 withheld by
the gate, 7 refused for pages the detector cannot read.
