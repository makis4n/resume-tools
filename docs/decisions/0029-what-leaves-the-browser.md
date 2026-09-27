# 0029. What leaves the browser

Date: 2026-09-27 · Status: proposed

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
the person's text in a definition the builder did not mask by it. The code is
`apps/editor/src/import/naming.ts`, `packages/naming/src/mask.ts`, `candidates.ts` for the
preamble's storing calls, `privacy.ts` for what the import screen says, and
`apps/editor/scripts/corpus-leak.ts` for the check over the corpus.

## Decision

### The detector's sources

Four sources say what the person's text is, and the builder and the check take all of them
(`DocumentText`, `RequestOptions`): the body's tree, its runs, links, dates and raw chunks; the
header's values item 7's finder gives by the answers (`headerOf`); the texts the preamble stores,
the probe's candidates there; and the page.

- **The page** (`pageStrings(stream, fonts)`) is the reference compile's glyph stream read as
  words: each glyph's text as the page names it (`glyphTextOf`), in the order the output sets
  them; a line's glyphs parted into words where the gap after a glyph's advance, its TeX font's
  width or its native font's advance, is 0.1 em or more, and lines parted where the baseline moves
  a fifth of an em or a glyph steps back; a word TeX hyphenated at a line's end read whole, a
  spacing accent `\accent` sets left out, and a mark kept with its letter. Its words are then read
  as a body's text is, parted at punctuation. It gives each word of three letters or more, each
  pair of adjacent words that start with letters, and each identifier: an email, a link written
  with or without its scheme, `github.com/quillinv`, read as a link's address, host and handle,
  and a run of seven digits or more, a line's digits read as a phone's. It takes time linear in
  the glyphs; a twenty-page reference costs ten times a two-page one (`naming.test.ts`). In the
  references of the corpus's first 60 fetched documents a space shrunk to its least is 0.14 em or
  more and a kern 0.06 em at most, and of some 146,000 gaps one lies between; and in each of the 31
  whose fonts the page can read, 94 to 100% of the body's words of three letters or more are words
  of the page.
- **Why the page is the strongest source.** It is the text as the world reads it, whatever holds
  it: the body, the header, a stored text, or a macro of the preamble's that no body text names,
  which S2 is. The body's tree says only what the body spells; the page says what the document
  prints.
- **What it cannot see.** Text in a definition that never reaches the page: metadata, a
  `pdfauthor` or a message, which the matchers read as code anyway, a macro defined and never
  called, a branch not taken. Text set in glyphs the page names nothing for: 7 of the 117
  references set their text in fonts whose glyphs the page cannot name, and read no words; there
  the detector has the body, the header and the stored texts alone. A word the page parts, as a
  letter-spaced name, or joins, as a compound broken at a line's end after its own hyphen.

### What the page masks, and what the check looks for

- **The builder** masks the document's own definitions and the settings by the page's pairs of
  words, as phrases, and by its identifiers, as it masks by the body's (decision 0024): whole
  words, in any case, a pair across commands and braces, and an identifier of six characters or
  more anywhere in a setting. A single word the page shows masks nothing: the page shows the
  template's own words, `Experience`, `Page`, `Email`, as often as the person's. A single word of
  the header's name still masks an own definition, as item 6 left it, and so the name the page
  shows is masked where a definition holds it alone.
- **The check** (`findLeaks`, which `assertNoText` throws on) is fed the page too, and stays
  stricter than the builder: in a call site, a signature's defaults, a setting and the class it
  looks for the page's single words as well, a keyword or colour a setting keeps excepted as the
  body's are; in an own definition, the page's pairs and identifiers, with every other source's
  single words as before. It never looks for the page's strings in a definition of the tree's.
  It reads a signature by its brace groups alone, the defaults and the tokens `e{...}`, `E` and
  `u{...}` give, since the letters outside them are xparse's argument types, `s o m`, code
  however they spell a word. `findLeaks` gives each leak as what kind of text, the body's, a
  link's, a date, a raw chunk's, the header's, a stored text or the page's, what kind of place,
  an own or a tree definition, a call site, a signature, a setting or the class, and the macro:
  never the text.

### The own-versus-tree rule, restated

A definition of the tree's, a class or package of TeX Live's, is public code: it is masked by
pattern and never by the document's values, the page's among them, so that its key is the same
whoever the person is and a masked word could tell no one which word their details hold (decision
0024). The check looks in it for a phrase or an identifier of the body's, the header's or a stored
text's, and not for the page's strings, since the tree's classes set their own words on the page:
over the corpus, 8 definitions of the tree's in 5 documents hold a pair of words their page shows,
all public code, TikZ's library loader and two of its libraries, and europecv's language header. A
definition the upload defines is the document's own, and is masked by every source.

One kind of macro is the person's whoever defines it: the one a storing call of the preamble's
filled. A setter (`isSetter`, decision 0022) stores each argument with `\def`; after the preamble
has called it, what it stored in (`storedIn`) holds exactly the person's text, as Awesome-CV's
`\@position` holds what `\position` was given and europecv's `\ecv@rfoot` what `\ecvfootnote` was.
Such a macro is data when the text names nothing but text, and went by its name alone; when the
text named a command, `\small` or an icon, it was code, and a tree class's went out as the class's.
The builder now sends it as data whatever it holds, by its name alone: it is masked by no value,
and a macro whose closure names it keys as it would had the stored text named no command, so that
a fork whose position holds `\small` keys as the upstream sample does. A setter the preamble never
calls leaves its macro holding the class's default, which goes as the class's code.

### The header's address

The header's location, where the finder puts a postal address (a header's location slot, or a
contact of that kind: AltaCV's `\mailaddress` and `\location`, Awesome-CV's `\address`), is looked
for as a phrase, as before, and by its parts (`addressNeedles`): each postcode of letters and
digits, the UK's and Canada's shapes in any case and with or without the space, as an identifier;
and each of its words that holds a digit, a street's number or a postcode of digits, with the word
before it and the word after it where those start with letters, as a phrase, `221B Larkspur`,
`Hauptstraße 5`, `75001 Paris`, `City 94103`. A number alone is never looked for, since code is
full of them: a person whose postcode is `10000` masks no `\penalty 10000`.

The patterns (`maskDefinition`) gain one shape, a postcode of letters and digits in capitals with
the space between its halves, the UK's `QV1A 2ZX` and Canada's `X9Q 0Q9`, masked by underscores of
its length, as every definition, setting and default is masked before it is hashed. No other shape
is unambiguous in code: five digits, a ZIP code or a German, French or Spanish postcode, are
numbers as a class writes them, and the Netherlands' `1012 AB`, four digits and two capitals, is
too plain a shape to tell from code.
Across the 42,280 definitions the engine printed for the corpus's 117 documents, the new shape
matches none, so no key moves (the seed's too: `corpus seed` has no problem), and a test holds
class code with numbers, fonts' encodings, lengths, colours and coordinates as it is.

### The corpus-wide leak test

`corpus leak [--only <id>] [--json <file>]` (`scripts/corpus-leak.ts`, `corpus-leak-child.ts`)
takes every fetched document in as the reference runner does, in its pool of four children with
90 s each, and for each that compiles to a reference and whose body parses builds its request as
the import will: the upload's sources, the page's strings, the texts its preamble stores, and the
header's values the finder gives by the seed's answers, found with a request built with the page.
The probe's compiles are left out, as the seed's check leaves them: what the probe decides goes in
a request as a verdict from a closed list, and the stored texts are the candidates `candidatesOf`
finds as the probe does. It checks each request with `findLeaks`, fed all four sources, and prints
each document's outcome, then a table per family of what became of the documents, how many
requests passed and failed, how many own definitions the document's values masked and how many
only the page did, and in how many documents the finder found the header, then each failure's
leaks by macro and kind, never the text; it exits 1 on any failure. A Vitest test
(`corpus-leak.test.ts`), which runs where the corpus is fetched and the engine built, as the
seed's does, runs the same check over the corpus and fails on a leak; the nightly workflow runs
`corpus leak` after `fetch` and puts its table in the run's summary.

The result, on the M4 Pro in a minute: 220 documents, 103 with no reference, 117 checked, **117
passed, 0 failed**. The document's values masked 14 own definitions of 1,509 in 6 documents, and
the page more of 8 of them; the finder found header values in 41 documents, 18 Awesome-CV forks, 9
AltaCV, 13 moderncv, whose `\name`, `\email` and `\homepage` are defined as Awesome-CV's and have
their keys, and one other.

The three item 6 left, and what fixed each, in the masker:

| Document | What the check found | What masks it now |
|---|---|---|
| other-0023 | a word of a raw chunk of the body in `\makeheader`, a header macro of its own | the page: `\makeheader` sets the word beside others of the person's, and the page's pairs mask them |
| awesome-cv-0035 | a stored word in its own `\@extrainfo`, which `\extrainfo` filled with a text holding a command | the page, whose pairs mask it; and it now goes as data, as a macro a storing call filled |
| europecv-0006 | a stored text in the tree's `\ecv@rfoot`, which `\ecvfootnote` filled with a text holding a command | only the storage rule: a tree's definition is masked by no value, and it now goes as data |

### What the test proves

For each of the corpus's 117 documents that compile and parse, the request the import builds
holds, where the check reads, no text of the body's, of the header's values the finder gives, of
the preamble's stored texts or of the page's, as the check's rules above look for each: no pair
of words or identifier the page shows in an own definition, a call site, a signature's defaults,
a setting or the class, and no single word the page shows in the last four. It does not prove
what the sources do not hold: text that never reaches the page, or that the page cannot read, in
7 of the 117; a word the page shows alone, which an own definition holds without the words beside
it on the page; text in code the matchers do not read (decision 0024); a macro of the tree's that
the preamble fills through a command the probe does not read as a setter, as the kernel's
`\author` or fancyhdr's `\rfoot`, with a command in its text, which goes as the tree's code and
in which the check finds only the body's, the header's or a stored text's phrases; and a header
the finder does not find, which it finds only by the seed's answers until the model's are
cached. And it proves it for the corpus, not for every resume.

### What the import screen says

`src/import/privacy.ts` exports the sentence item 12 shows where a resume is imported: "To learn
your template, the editor sends only its command definitions, with any names, emails, phone
numbers, links and addresses replaced, the shape of a few places that use them, with every letter
and digit replaced, and the page's style settings; your resume's text, its PDF and your header
never leave your browser." A test pins it, and checks that it is one sentence with none of LaTeX's
special characters and no command's name.

## Consequences

- Item 7 and item 12 build the request with the page: `pageStrings(reference, fonts)` after the
  reference compile, with the same fonts, and pass it, the sources and the header's values to
  `buildRequest`, and the same to the check before anything is sent.
- Item 9's gate (`corpus-name-child.ts`) passes the page to `buildRequest` and to the check, which
  closes S2: a name a macro of the preamble writes is masked where the page shows it, and the gate
  refuses the request where it is not.
- A phrase of a class's own that the page shows is masked in a copy of that class the upload ships
  as the person's would be, since nothing tells the two apart; the macro's key is then the
  document's own, and a fork that ships such a class misses the cache for it. Over the corpus the
  page masked more of 8 own definitions, this way or for the person's text, and none of the
  seed's 65 keys moved (`corpus seed`, `corpus-seed.test.ts`, whose requests are built with the
  page).
- A macro a storing call filled goes as data whatever it holds, so a request no longer carries the
  text of a stored command, and item 4's `keysOf`, which still hashes it as code, keys such a
  macro's dependents otherwise than the request does; the seed's samples store no command, and
  their keys are item 4's.
- The detector is as good as its sources: the page reads nothing from a font whose glyphs it
  cannot name, so a document whose text is set in one is checked against its body, header and
  stored texts alone.
