# 0051. Reading PDFs, measured

Date: 2026-10-04 · Status: accepted; the targets and the model's time budget are the owner's to set

## Context

Item 3 of milestone 3's second pass (docs/milestone-3-overhaul.md): before the PDF import is built
(items 10 to 15), read PDFs by rules and by the hosted model on three sets, so that the owner sets
the plan's provisional PDF targets and the model's time budget from measurements, and so that the
reader the plan chose, pdf.js, is confirmed or not. The owner approved the `pdfjs-dist` dependency
with the plan.

## Decision

### The method

A measuring script, with no editor UI (`apps/editor/scripts/spike-pdf.ts` and
`scripts/spike-pdf/`):

```sh
pnpm --filter @resume-tools/editor spike-pdf builtin|other [--model] [--again] [--print]
pnpm --filter @resume-tools/editor spike-pdf corpus [--only <ids>] [--ids <file>] [--limit <n>]
pnpm --filter @resume-tools/editor spike-pdf reader
pnpm --filter @resume-tools/editor spike-pdf --report
```

`--report` prints the tables below again from `scripts/spike-pdf/fixtures/results.json`, reading
and calling nothing else.

- **The reader.** pdf.js's legacy build, in Node, gives each page's runs of text with their
  position, size, font and weight (from the font's name), each link's rectangle and address, and
  the small dots and long thin rules the page draws. It refuses, in plain words, a file that is not
  a PDF, one locked with a password, one with no text, and one over 5 MB (the checker's cap) or 10
  pages; a test holds each refusal on a PDF made by hand.
- **The rules**, a first cut of items 11 and 12. Runs on one baseline make a row; a gap wider than
  1.2 em (10 pt at least) cuts it into pieces, so that a title and the date at the row's end are two
  lines. A column split is the tallest vertical band of gap with three rows on each side, a quarter
  of the region's height, a right side that keeps one left edge, and two sides that do not stand on
  each other's rows, as a table's cells and a title's date do; columns are read one after the other. A
  bullet is its glyph, the dot a browser draws, or a dash before the words. Icons (Font Awesome
  and its kin by the font's name, pictographs, private-use characters) are dropped and counted. A
  bullet's or a paragraph's rows join when the row above is full, and a hyphen at a row's end joins
  its word only before a small letter. Each line then takes one role of eight (name, contact, section
  heading, entry head, date, place, bullet, running text) from its size against the body's, its
  weight, capitals, a rule by it, its row and its neighbours, and the words sections are known by.
  The lines are filed into the resume model: the header, with links' addresses from the PDF's own
  links; sections with the role their heading's words give; entries, a head line cut at a bold
  prefix, a spaced separator or a comma before a capital, and a date or a place at its end taken
  off; lists, labelled lists and paragraphs. A date the model cannot hold stays as text in its
  entry and is flagged; a line that fits nowhere goes to a last section, `Unsorted`, and is flagged.
  The words read are counted against the resume built, and nothing is dropped when as many letters
  and digits land as were read, which no cutting of a line into fields counts twice.
- **The model.** SoCLaaS's `qwen3.8:27b`, asked as decision 0044 asks it (the naming step's
  provider code, thinking off by its chat template), is given every line's text and features as a
  table and answers one role a line: a JSON schema response format whose keys are the lines' ids
  and whose values are an enum of the eight roles, so that a reply in the schema's form is valid by
  construction. The rules' filing step files its labels. One call a PDF, no retry, stopped at 180 s,
  at the gateway's default temperature. The model reads only a PDF in the invented sets' own
  folders with its truth beside it: `labelByModel` takes a path, not lines, and refuses any other
  path before it reads the file, and a test holds that nothing is sent for a corpus path, a path
  outside the folders, a link out of them or a climb up. The key reached the command only inline,
  from the keychain.
- **Fields right**, defined once: the name, the email, the phone and each link (address and
  label); each section's title (without case) and role; each entry's title, place and dates, the
  truth's entries paired with the reading's across the resume by likeness; and each bullet's exact
  text. A field counts where the truth has it. Texts compare as two readings of one page do: TeX's
  dashes and curly quotes count as what was typed, and a ligature as its letters.
- **The sets.**
  - (i) The editor's own PDFs: Jake's Resume, AltaCV and Awesome-CV each typeset each of the three
    curated packages' invented samples, nine PDFs, compiled by the engine and made PDF by xdvipdfmx
    as the editor exports one. The truth is the sample.
  - (ii) The corpus: the 220 documents of the manifest that the last fetch fetched, each taken in as
    its zip and compiled by the reference compile in a pool of four, 120 s each; those that compile
    are made PDF by xdvipdfmx, as the editor would, and read by the rules alone. Counts only, per
    document under `.corpus/spike-pdf/`. No list of the first pass's run was used.
  - (iii) Eight invented resumes made outside the editor, each committed with its source, its PDF
    and the truth written as it was made (`scripts/spike-pdf/fixtures/other/`). Five Chrome printed
    headless: one column; a sidebar with justified, hyphenated text; icons beside the contacts and
    the headings; a table of years beside the entries; and a header band over a main column and a
    right sidebar, a company and its role on one line, dashes for bullets. Three macOS's own text
    system printed, AppKit's, as TextEdit prints: an RTF with a right tab for the dates; a word
    processor's HTML with the dates inside the head lines, made RTF by `textutil`; and a table of
    section names beside their content, likewise. `cupsfilter` on this machine converts only plain
    text to PDF, so the text system prints through AppKit from `osascript`, whose PDFs name
    `Quartz PDFContext` as their producer. In these truths an entry's title is its first, most
    prominent line or part.
  - The rules were debugged on set (i) and on six of set (iii)'s eight. The other two, one from
    Chrome and one from the text system, were written, printed and scored after the rules were set,
    and are held out. Since then the rules changed only for two faults of the count, `at` taken as a
    separator and a date kept as text that a later head line overwrote, which left every invented
    PDF's score as it was. Set (ii) was never looked at, only counted.

### The tables

The model's figures are three passes over every PDF, each a call a PDF; where one figure stands, it
is the last pass's. Runs of 4 October 2026, from 8239160 with this record's code uncommitted.

**The editor's own PDFs** (set i)

| | Jake's Resume | AltaCV | Awesome-CV | All nine |
|---|--:|--:|--:|--:|
| Words read; PDFs where every word lands (rules) | 648; 3 of 3 | 658; 3 of 3 | 658; 3 of 3 | 1,964; 9 of 9 |
| Words in the catch-all (rules) | 0 | 0 | 0 | 0 |
| **Fields right, rules** | 100% (115) | 100% (115) | 89.6% (103/115) | **96.5%** (333/345) |
| **Fields right, model**, three passes | 100, 100, 100% | 98.3, 98.3, 98.3% | 91.3, 89.6, 90.4% | **96.5, 95.9, 96.2%** |
| Name, email, phone, links; section titles; section roles: rules and model | all right | all right | all right | 48 of 48; 54; 54 |
| Bullets exact: rules / model | 21 / 21 of 21 | 21 / 20 of 21 | 21 / 21 of 21 | 63 / 62 of 63 |
| Entries with title, place and dates right: rules / model | 100% / 100% | 100% / 93.3% | 20.0% / 26.7% | **73.3% / 73.3%** (33/45) |
| The same, a title and its subtitle swapped counted right | 100% / 100% | 100% / 93.3% | 100% / 100% | **100% / 97.8%** |

Every miss of the rules is an Awesome-CV entry's title: the template sets an entry's subtitle, the
employer, above its title, the role, and both readings take the line above as the title.

**Invented resumes from other tools** (set iii)

| Fixture | Made by | Lines | Fields | Rules | Model, three passes |
|---|---|--:|--:|--:|--:|
| `chrome-one-column` | Chrome | 30 | 29 | 27 | 27, 27, 27 |
| `chrome-sidebar` | Chrome | 39 | 33 | 33 | 33, 31, 31 |
| `chrome-icons` | Chrome | 28 | 26 | 26 | 26, 26, 26 |
| `chrome-table` | Chrome | 29 | 29 | 29 | 29, 24, 28 |
| `textedit-rtf` | AppKit | 23 | 24 | 24 | 24, 24, 24 |
| `textutil-html` | textutil, AppKit | 13 | 22 | 22 | 22, 22, 22 |
| **The six the rules were debugged on** | | | 163 | **98.8%** | **98.8, 94.5, 96.9%** |
| `chrome-right-sidebar`, held out | Chrome | 26 | 27 | 13 | 21, 21, 21 |
| `textutil-table`, held out | textutil, AppKit | 12 | 21 | 20 | 17, 20, 20 |
| **The two held out** | | | 48 | **68.8%** | **79.2, 85.4, 85.4%** |
| **All eight** | | | 211 | **91.9%** (194) | **94.3, 92.4, 94.3%** |

Every word read lands in all eight, by rules; 4 words of 1,138 land in the catch-all. The rules'
misses: `WORK EXPERIENCE`, set letter-spaced, reads as one word (its title and role). On the
held-out sidebar: the phone, in a block of contacts beside the name; the sidebar's `Skills`
heading; and both entries, whose head line sets the company in bold before its role
(`Nordkanal Engineering | Senior Structural Engineer`), which the rules do not take for an entry's
head, with the date and the place together on the next line (`Apr 2019 – Present · Hamburg`), and
their bullets. On the held-out table: `Training`, a heading whose role no rule knows. The model's
misses on the held-out sidebar are the `Skills` heading and the two date-and-place lines, which
the shared filing step keeps as text.

**The corpus, read by rules alone** (set ii, counts only)

| | |
|---|--:|
| Documents | 220 |
| Refused by the reference compile (decision 0019) | 103: package 38, stopped 27, font 21, file 9, class 5, LuaTeX 3 |
| Compile, and xdvipdfmx made no PDF | 42: a font with no outline in the engine's tree 39, a `psfile=` special 2, another failure 1 |
| Refused by the reader, past 5 MB or 10 pages | 2 |
| **Read** | **73**, 148 pages |
| Columns found, the most on a page: documents | one 57, two 16 (altacv 7 of 8, europecv 5 of 5, other 4) |
| Sections found; median a document; documents with none | 468; 6; 0 |
| Header found: name, email, phone (documents) | 73, 68, 51 |
| Words read; documents where every word lands | 45,474; **73 of 73** |
| **Words in a recognised place**, not the catch-all | **97.6%** (44,401); catch-all 2.4% (1,087) |
| The recognised share a document: median; documents at 85% or more | 99.4%; **72 of 73** |
| By family, recognised | jake 99.2%, awesome-cv 98.4%, altacv 97.7%, europecv 96.5%, other 96.2%, moderncv 96.1% |
| Icons dropped; hyphens joined; dates kept as text | 379; 120; 15 |

**Times**, in Node on this machine (Apple silicon, the model on the school's gateway)

| | Set (i) | Set (iii) | Set (ii) |
|---|--:|--:|--:|
| pdf.js's reading and the rules together, a PDF: median, max | 19 ms, 25 ms | 16 ms, 33 ms | 24 ms, 232 ms |
| pdf.js's first read in a process, its loading with it | 141 ms | 148 ms | |
| The model's call, a PDF: median, max | 6.9 s, 8.1 s | 3.9 s, 5.8 s | not asked |
| The model's calls; answered within 30 s; failures | 27; 27; none | 24; 24; none | |

All 51 calls of the three passes answered, in 2.0 to 8.1 s, median 5.0 s, with 1,100 to 3,400
tokens in and 120 to 580 out, none counted as reasoning. In an earlier round on the same day, whose
calls were cleared with that round when the final code ran, three calls in a row failed with no
HTTP status at about 23:48 UTC on 3 October, one after 70.3 s and two after about 10 s; the run
stopped asking after the third, as the command does, and the gateway answered every call minutes
later.

### The reader

pdf.js is confirmed: `pdfjs-dist` 6.3.289, Apache-2.0, a devDependency of `apps/editor` for this
spike. It read every PDF the three sets gave it, TeX's Type 1 and OpenType fonts through
xdvipdfmx, Chrome's subsets and Quartz's, with no failure; the two corpus PDFs it refused were past
its cap.

| Browser build | Raw | gzip -9 | Brotli |
|---|--:|--:|--:|
| `build/pdf.min.mjs`, the main module | 448 KiB | 129 KiB | 107 KiB |
| `build/pdf.worker.min.mjs`, the worker | 1,236 KiB | 366 KiB | 300 KiB |
| `legacy/build/pdf.min.mjs` | 506 KiB | 148 KiB | 123 KiB |
| `legacy/build/pdf.worker.min.mjs` | 1,286 KiB | 383 KiB | 315 KiB |

- In the browser it is ES modules: the main module starts a module worker from the worker's file
  (`GlobalWorkerOptions.workerSrc`), or takes a worker the page made (`workerPort`), and parses
  there. Reading text needs no WASM, whose decoders are for JBIG2, JPEG 2000 and colour profiles,
  and fetches nothing: CMaps and standard fonts come only from URLs a caller gives, and this spike
  gives none. A CID font that needs a predefined CMap would then not decode, which no PDF here did.
- In Node, as this spike reads, the legacy build loads its worker in the same thread, a fake worker.
  It loads `@napi-rs/canvas` when it starts, to stand in for the browser's DOMMatrix and Path2D:
  an optional native package pnpm installs beside it, 1.0.10, 26.8 MiB on disk for this machine's
  platform. Text, links and marks read without it, which a run with it hidden showed; the browser
  build never loads it.
- A run's font name, and so its weight, comes from the page's operator list, which also gives the
  drawn dots and rules; its cost is in the times above.
- pdf.js gives letter-spaced text a space at every letter's gap, a word's gap the same one, so a
  word boundary in letter-spaced capitals is lost; glyphs' own positions would be needed.

### What the numbers mean for the provisional targets

- **The model, at least 90% of fields on invented resumes from other tools.** It read 92.4% to
  94.3% over the eight, 94.5% to 98.8% over the six and 79.2% to 85.4% over the two held out. Its
  misses there are as much the shared filing step's (a date and its place on one line) as its own,
  and its passes differ by up to four fields of 211.
- **Rules, the built-in templates: every word read lands.** Met: 9 of 9, none in the catch-all.
- **Rules, the built-in templates: name, email, phone, links, section titles and roles exact.**
  Met: 9 of 9.
- **Rules, the built-in templates: at least 95% of entries have the right title, place and dates.**
  73.3% as defined; 100% where a title and its subtitle swapped count right. Every miss is
  Awesome-CV's order, the employer above the role, which the truths themselves do not keep alike
  (Jake's sample makes a school the title, Awesome-CV's a degree). Meeting the target as written
  needs the rules to know each built-in template's order, which a PDF the editor made shows by its
  fonts; or the target counts the pair, with the review swapping the two in one click.
- **Rules, the built-in templates: bullets exact.** Met: 63 of 63.
- **Rules, the corpus: every word read lands.** Met: 73 of 73 documents read.
- **Rules, the corpus: at least 85% of words in a recognised place.** Met: 97.6% of words, 72 of
  73 documents. A recognised place is a place other than the catch-all, not a right one: the counts
  cannot say whether an entry's fields or a column's order are right, as europecv's label column,
  read as a column in 5 documents of 5, may not be. And it is 73 of the 117 documents that compile.
- **Rules, invented resumes from other tools: at least 80% of fields.** 91.9% over the eight;
  98.8% on the six the rules were debugged on, which says what the rules fit, not what they reach;
  68.8% on the two held out, 95.2% and 48.1%. On layouts the rules have not seen, the held-out pair
  is the closer guide, and it is two PDFs.
- **Rules, under 3 s.** Met with room to spare: 33 ms at most a PDF on the invented sets and 232 ms
  on the corpus, pdf.js's first load, 141 to 148 ms, apart. In the browser the worker's download
  and start come on top.
- **The model, inside a time budget of 30 s.** Every answered call took 8.1 s at most and 5.0 s at
  the median, so 30 s leaves about four times the slowest; 15 s would have kept every answer too.
  The budget is what the gateway's failures cost before the rules answer: one failed after 70.3 s.

Targets: set by the owner on

## Consequences

- Item 10 builds on pdf.js as measured: the worker is most of its weight, 366 KiB gzipped, which
  the plan loads only when a person imports a PDF. `pdfjs-dist` moves to the editor's dependencies
  there.
- Items 11 and 12 start from this prototype. The held-out pair names what it lacks: a date and its
  place on one line, contacts in a block beside the name, a sidebar's headings, heading words such
  as `Training`, and letter-spaced headings. Each fix should be judged on PDFs the rules were not
  tuned on, which the owner may add from other tools.
- The model replaces only the labels (item 13); its reading on these sets is bounded by the filing
  step the rules share, and improving that step raises both. Its variance between passes argues
  for judging its target over several passes, or for a temperature of 0.
- Item 16's bridge cannot rely on xdvipdfmx for every import: 42 of the 117 corpus documents that
  compile get no PDF, 39 for a font with no outline in the engine's tree. Moving their content
  onto a built-in template needs their fonts' outlines in the tree, or a reading of the reference's
  own glyph stream, which the page already reads, in place of a PDF.
- The corpus counts say nothing is dropped and little is left unsorted; they cannot say the
  structure is right. Item 15's corpus command could add counts of structure, such as entries with
  a date, for a check that needs no text.
- The spike adds no editor code. Its fixtures are committed; the first set's PDFs are made again on
  every run and git ignores them.
