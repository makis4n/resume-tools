# 0039. The import's report, and its bar at nine tenths

> Superseded by 0063 in its corpus assemble command, which is deleted with the naming step (the
> second pass's item 17).

Date: 2026-10-01 · Status: proposed; amends 0040's interim rule of what a successful import is,
and replaces 0043's interim outcome · Amended 2026-10-03: the hand counts, and a running footer
counted on every page (below)

## Context

Milestone 3 item 13 is plan section 6 step 6's report and section 6.2's success bar: what share
of an imported resume's words came out editable, whether that is enough, and what the person reads
when it is not. Item 7 (decision 0026) counted words in the source, as a stand-in, and left the
reference's glyphs to this item; item 12 (decision 0038) keeps the report's inputs with each import
(`ImportReport`) and opens a document as soon as its import comes through; item 14 (decision 0040)
made the bar of page size, margins and font size hold over "successful" imports, taken until now
to be those whose first check holds. The code is `apps/editor/src/import/report.ts`, the owners in
`assemble.ts` and `probe.ts`, the screen in `src/editor/ImportReport.tsx`, `DocumentList.tsx` and
`App.tsx`, and the runner's side in `scripts/corpus-assemble.ts`, its child and `corpus.ts`.

## Decision

### The count: the page's words

- **Words are the reference's**, read from its glyph stream as the aligner reads a field's glyphs
  (`pageWords`, `readPage`): each glyph's text as the page names it, a ligature its letters (`fi`),
  a spacing accent that a letter starts under, from twice the accent's width before it to the end
  of its advance, folded into the letter as `collectFields` composes them, and a glyph the page
  cannot name, as an icon, read as a space. A word is a run of letters and digits, as the assembly
  counts a field's words (`wordsIn`), so punctuation parts words as a space does: `555-0100` is two
  words, `quill@example.invalid` three.
- **A space** stands between two glyphs where the second starts further on than the first ends by
  more than a tenth of its size, or on another line, more than half its size up or down, or back by
  more than its size, as at a column's top. The reference keeps each glyph's advance for this
  (`ReferenceGlyph.width`): a TeX font's character's width, a native glyph's way to the next glyph
  of its run or to the run's end. On the three upstream samples and the invented fork, every gap
  within a word is under 0.08 of the size and every space over 0.12, Source Sans Pro's tightest,
  so a tenth parts them with room on both sides.
- **A hyphen that ends a line** between a letter and a small letter that starts the next is the
  break TeX added in a word, as the aligner reads a hyphen it inserted, and the word goes on past
  it; unless the resume itself writes the two halves with a hyphen, in its text or in what it keeps
  as the upload wrote it, whatever their case, when it parts two words as any hyphen does. The
  Awesome-CV sample breaks three words of its fields so, which its source holds whole, and ends a
  line with one hyphen of its own; one moderncv fork of the sample ends a line with one of its own.
  So does a hyphen that ends a page, a small letter starting the next (item 13's review): the word
  is one, counted on the page it begins on, and the next page's first word is none of its own.

### Who sets each word: the attribution, in order

1. **The probe's runs** (decision 0022), now kept whole (`Probe.runs`): every run of the
   reference's glyphs and what sets it, an editable candidate's glyphs a compile showed in place
   among them, besides the uncovered ones the probe already kept, each a locked candidate's, a raw
   chunk's or the template's own (`chrome`). Where no compile placed a locked candidate's or a raw
   chunk's glyphs, the probe finds them by the pieces of text its source sets, and now, among the
   glyphs those leave unclaimed, by its words alone too (item 13's review): a macro that parses a
   list of `value/label` pairs and sets each label alone, as a `\foreach` chart does (AltaCV's
   wheel chart, decision 0013), holds pieces the page never shows whole, values and commas with the
   labels, so that its labels went to the template's text, left the resume's words, and passed an
   import over the bar that should not pass it.
2. **The assembly reads each run through the document it made** (`ownersOf`,
   `AssemblyChecks.owners`): a run a part of the source sets belongs to the innermost editable
   field that holds that part, typeset or set raw for the side panel; else to the innermost locked
   part that holds it, a field's kept instance, a list kept whole, a header's extra, a section's
   `before` or `after`, or a locked section; else to the locked field that holds it; and else it is
   something the document keeps as the upload wrote it that no part counts (`kept`, `unmapped`), so
   that no word of the document's source counts as the template's. Every locked part now carries
   where it stands in its source for this (`keepPart`). A XeTeX import's preamble is item 8's
   rewrite (decision 0023), whose storing calls stand elsewhere than in the upload's: the probe's
   preamble spans are moved as far as the call that holds them, the calls taken in turn where both
   preambles write them alike (`preambleSpans`). The template's own text has no owner.
3. **A word is what sets most of its glyphs**, the first where two set as many.
4. **A running line is the locked part's on every page** (2026-10-03, `ownRunningLines`, below):
   a stretch of a page's glyphs on one line that another page sets at the same height, at least
   half the longer's glyphs the same character at the same place, is one running header or footer
   in copies. Where every owned glyph of its copies has one and the same locked owner, that part
   sets the whole line on every page, the date or the page's number its call passes among it;
   otherwise each copy's glyph the template has takes the locked owner of a copy's same glyph at
   the same place. A running line none of the source sets stays the template's.

The body's words are all the resume's; the template's own, a label, a separator, an icon's neighbour
or a page's number that no part of the document's source sets, are no word of the resume's.
**The editable rate is the share of the body's words editable in place**, in fields the page opens,
as plan section 6.2 has the bar ("90% of body words are editable in place"); a raw field's words,
which the side panel alone edits where the page cannot mark them, as a contact whose address is
built from its text (decision 0026), are the body's and count apart (`panel`, item 13's review),
never toward the bar: the report says how many there are.

### The bar

- **An import succeeds when its first check holds** (the regenerated document set the reference's
  glyph stream, decision 0026) **and at least 90% of its body's words are editable in place**
  (`SUCCESS_RATE`, `outcomeOf`); anything else is partial. 90% is the plan's default (plan section
  3, "Import success bar"), which no measurement here argues against: the bar's job is to keep a
  poor import from looking like a good one, and a tenth of a resume locked is about what a person
  can read through in the report. The rate shows in whole per cent, rounded down, so that 89.9%
  never reads as the bar.
- **The corpus's successes are the report's.** `corpus assemble` reads every document's report
  with the same function the browser does (`reportOf`, which imports nothing but types, so that
  Node runs it as it is), keeps its counts in the row (`ReportRow`: outcome, rate, words by where
  they are, how many parts and things left out, never a word), prints it on each document's line,
  and counts it in the table; and item 14's bar holds the page size, the margins and the font size
  over the report's successes (`reportSucceeded`), which amends decision 0040's interim rule, the
  first check holding. `corpus oracle` prints each sample's report beside its outcome.

### What the report says

All of it in plain words, never a command's name or a line of source: every string it shows passes
`shown`, which takes out a backslash, a brace, a control and the private use area's characters
whatever the page or a name holds, and a test holds every string to that.

- **Its first line** (`summaryOf`): "Imported: 96% of your resume's words are editable on the
  page.", or for a partial import why: under the bar, or the page this editor sets differs from the
  original's.
- **Each locked part that sets a word**, in the page's order, by its first words as the page shows
  them, eight at most and an ellipsis after (`FIRST_WORDS`), with its count and why
  (`LOCK_WHY`, a sentence for each of the probe's, the assembly's and the harness's reasons);
  what the document keeps that no part counts is a part of its own for each run of it.
- **What was left out**, by kind: the images, as the document names them, those shown as blank space
  of their size (the intake's stand-ins and the reference compile's) and those the intake dropped; a
  bibliography the upload has no built copy of; each control the checks did not prove, through the
  kind of why decision 0040 keeps (`DROPPED`, `UNCHECKED`), never the checks' words, which may name
  a value or quote TeX; and each file the intake or the XeTeX rewrite left out, in their words
  (`ImportReport.warnings` now holds the rewrite's too).
- **Notes**: no answer came for the template, in the naming client's words (decision 0038); the
  fonts were set in Latin Modern (decision 0026); the kinds of unit the template can neither add
  nor remove (decision 0038); and how many more words the side panel alone edits.

### The screen

A successful import is kept and opened as item 12 opened every import, its report's line and what
was left out above its page until the document closes. A partial one is not kept yet: the list
holds its report in place of the progress line, the locked parts listed, with **Continue**, which
keeps it and opens it as it is, and **Stop**, which keeps nothing; nothing else starts meanwhile.
Its package was never stored and the formats its checks dumped went as they ended (decision 0038),
so stopping has nothing else to drop. In the dev server, the invented fork below imports from the
picker and waits in the list, partial at 82%, its two locked parts named; Continue opens it with the
line above its page, and a second import stopped leaves the list as it was.

### Two changes on the way

- **A header call with no answer is counted.** The header kept such a call whole in its extras with
  no locked part, so that its words counted nowhere; it is a locked part (`unmapped`) now, as
  decision 0026 has every part kept.
- **The reference keeps each glyph's width**, never compared (`difference` and `sameOrder` read
  what they read), and the probe keeps its runs whole beside the uncovered ones.

## The counts

### The invented fork, counted by hand

`src/test/jake-fork.ts`, Jake's template with invented words, imported through `importResume` as
the browser does, the committed answers serving the naming route (decision 0038). Counted by hand
from its source, each run of letters and digits the page sets, the heading block and the skills
list being what the assembly keeps as the upload wrote them (decision 0038) and everything else a
field: the entries' titles, places, subtitles and dates 12, 9, 9 and 7 words, their bullets 11, 9, 6
and 8, the section titles 5; the heading 9 (`555-0100` two of them), the skills 7.

| | Hand count | The report | Source count (decision 0038) |
|---|--:|--:|--:|
| Editable | 76 | 76 | 76 |
| Locked | 16 | 16 | 16 |
| The resume's, in all | 92 | 92 | 92 |
| The template's own | 0 | 0 | |
| Rate | 82.6% | 82.6%, partial | |

The report names the two parts "Quill Invented 555-0100 | quill@example.invalid | quill…" (9
words) and "Languages: Invented, Words, Other Tools: Quill, Wren" (7). `run.test.ts` holds the
report to the hand count within two words.

The review's case, also in `run.test.ts`: the fork without its heading and its skills, and with an
invented `\foreach` chart in a section of its own, whose four labels are 12 words. Before the
probe looked for a part's words alone, the labels were the template's, and the import passed:
"Imported: 100% of your resume's words are editable.", none locked. Counted by hand, 76 words are
editable, the section title's 2 among them, and the chart's 12 locked, 88 in all; the report now
reads 76 of 88, 86.4%, partial, and names the chart by its first words, "Tending invented bees
Sleeping in late Writing invented…" (12 words).

### The three upstream samples

Through the same import, the M4 Pro, the tree of layout 7, with the review's fixes. The source
count is decision 0026's, the assembly's own in the source, its typeset fields' words of all its
fields' and locked parts'.

| Sample | Editable on the page | In the side panel | The resume's | The template's | Rate | Outcome | Source count |
|---|--:|--:|--:|--:|--:|---|--:|
| Jake's Resume | 323 | 0 | 389 | 0 | 83.0% | partial | 323 of 389 |
| AltaCV | 67 | 0 | 232 | 0 | 28.9% | partial | 67 of 282 |
| Awesome-CV | 1023 | 9 | 1269 | 18 | 80.6% | partial | 1023 of 1260 |

- **Jake's sample** reads as its source counts, word for word: its heading block (15 words), its
  skills (40) and three dates written with a stop (11) are locked, as decision 0026 found them.
- **Awesome-CV's** pages hold its source's words to the word: its typeset fields its 1023, once the
  three words TeX broke with a hyphen read as one each, and its locked parts its 237, reason by
  reason (`date` 35, `unmapped` 192, `shape` 5, `text` 4, `differs` 1). The side panel edits 9
  more, its raw contacts', which the source count leaves out and the rate now does too.
- **AltaCV's** pages showed 13 words the report left to the template: the probe's search by words
  now gives all 13 to a locked part (`unmapped`, 117 where it was 104), as the review expected of
  the words its wheel chart sets from a list of `value/label` pairs, and its template words are
  none. Its source still counts 50 words more than its pages show: words the page never sets, as
  the review found them, the chart's values and ratings, lengths and widths, colours, the photo's
  size and file name, and options. The page's count is the report's.
- **The template's counts are unverified** (settled 2026-10-03, below). No one has read the samples' pages to say which words
  are the template's own (below): AltaCV's 13 were a parsing macro's, and Awesome-CV's 18, which
  the search by words does not move, are words no part's source holds where its pages set them,
  most likely the footer its class sets on each of its three pages from one call, with a date and
  a page's number that no text of the source spells.

**The hand counts of the three samples are owed, and item 13 stays unticked.** The permission
system of the session that built this item refused it a reading of `.corpus/oracle/`, where the
samples are fetched, as it guards the corpus's documents, so nobody has counted their pages by hand;
how they are counted is the owner's to decide. `scripts/corpus-oracle.test.ts` holds each
sample's report to the counts above within two words (`SAMPLE_COUNTS`), the report's own on this
commit and no hand count's, as a regression check until then: a count reads each page's words,
the runs of letters and digits, and sets each down to a field the page opens, a field of the side
panel's, a part the report names by its first words, or the template, the way the fork's are
counted above; its numbers then go here and in the test, and item 13 is ticked. (Done on
2026-10-03, below.)

### The hand counts, 2026-10-03

By the owner's decision of 2 October 2026, an agent read the three upstream samples, and no other
document of the corpus, to count their pages by hand. Each sample was imported once through
`importResume` with the committed answers, as `corpus-oracle.test.ts` imports it, on main at
7dd0042; nothing of `report.ts` was called, and the counts were written down before
`SAMPLE_COUNTS` or this record's counts above were opened.

**The method.**

- **The page** is the reference compile, made again in a job of its own and read as image strips
  of 200 to 250 dpi, line by line, AltaCV's columns apart.
- **A word** is this record's: a run of letters and digits, punctuation, an icon and a hyphen the
  source writes parting words, a hyphen TeX adds at a line's end joining one.
- **Editable on the page** is the editor's own marking: the document compiled as the editor
  compiles it, then drawn page by page, giving the fields that hold glyphs.
- **Two routes, reconciled.** The first transcribes and classifies every line, counted by hand and
  then tallied; the second works field by field through the imported document, each locked part's
  source read for the words it sets and the raw header fields added. The two agree in every
  category for all three samples. Poppler's `pdftotext`, split the same way, served only as a
  check on the transcription: it differs only by the icons it spells as letters (AltaCV 10,
  Awesome-CV 3) and by the three words TeX hyphenated in Awesome-CV.

**The counts.**

| | Jake | AltaCV | Awesome-CV |
|---|--:|--:|--:|
| Pages | 1 | 2 | 3 |
| The resume's words, by hand | 389 | 232 | 1287 |
| Editable on the page, by hand | 323 | 67 (65 on page 1, 2 on page 2) | 1023 (549, 441 and 33 by page) |
| In the side panel only, by hand | 0 | 0 | 9 |
| Locked, by hand | 66 | 165 | 255 |
| The template's, by hand | 0 | 0 | 0 |
| The report before the fix: editable, resume's, template's | 323, 389, 0 | 67, 232, 0 | 1023, 1269, 18 |
| Rate, by hand | 83.0% | 28.9% | 79.5% |

Jake's and AltaCV's match the report word for word, Jake's locked words its heading block (15),
three dates kept as written (11) and its skills (40), AltaCV's its wheel chart's 16 labels among
them; AltaCV's bibliography is left out with no built copy, and its icons set no word.
Awesome-CV's editable words and its side panel's match, and so do its locked parts, the footer
aside.

**The fault: a running footer counted on its first page alone.** Awesome-CV's class sets a
running footer on each of the three pages from one call in the body, `\makecvfooter`, which passes
it a date (`\today`), a centre text of three words, and the page's number (`\thepage`): seven words
a page, 21 in all. The probe set the centre text down to the call where a compile showed it, on
page 1, and no further; the date and the number spell no text of the source, so no search found
them. The report gave the locked part 3 words and the template 18: page 1's date and number, and
the whole footer on pages 2 and 3, the call's own literal text among it. The owner's reading: all
21 are the resume's, locked, since the call is in the document's source and no word of the source
is the template's.

**The fix** is the fourth step of the attribution above, in `report.ts` (`ownRunningLines`), and
general: any running header or footer a locked part of the source sets, on any number of pages,
is that part's whole on every page. The report now reads the Awesome-CV sample as the hand count
does, word for word: 1023 editable on the page, 9 in the side panel, 255 locked (`unmapped` 210,
`date` 35, `shape` 5, `text` 4, `differs` 1), 1287 the resume's and none the template's, 79.5%,
partial; Jake's and AltaCV's are unchanged. `SAMPLE_COUNTS` now holds each sample's report to
the hand counts, the side panel's among them, within two words, and `report.test.ts` holds an
invented two-page document whose footer repeats. Its limits: a footer on one page alone has no
copy to find it by, so its date and number stay the template's; and a class's own label on such a
line counts as the part's.

**Later pages are editable on the page.** The editor drew page 1 alone when the counts were made,
so 2 of AltaCV's editable words and 474 of Awesome-CV's stood on pages it did not draw. The report
and the pins count a marked field on any page as editable on the page; item 20 (every page on
screen, PR #78) draws every page, which settles it that way.

**The corpus.** `corpus run --committed-only` over the whole corpus with the fix, the M4 Pro, 15.4
minutes: 0 success, 69 partial, 11 refused, 103 with no reference, 36 with no answer, 1 timed out,
as before it. The words in editable fields are the same 8,083, of 41,631 resume's words where
there were 41,499: the 132 more are running lines' words the template had, now locked, and the
rate reads 19.4% where it read 19.5% (19.42 against the baseline's 19.48). The baseline holds the
success rate, 0.0%, which holds; it is not raised.

## The sample

`corpus run --committed-only` over the twenty documents of the sample, on main with item 17 merged,
the M4 Pro, four children beside other work: 15.2 minutes, altacv-0001 timing out at its 900 s as
every run of it does (decision 0040). Beside it, the same run before the review's fixes, and
decision 0043's interim rule, the assembly's words counted in the source, from its runs before item
12 merged and since.

| | The report's rule | Before the review | The interim rule, before item 12 | The interim rule, since |
|---|--:|--:|--:|--:|
| Success | 0 | 0 | 0 | 0 |
| Partial | 12 | 12 | 13 | 12 |
| Refused | 3 | 3 | 2 | 3 |
| No answer, timed out | 4, 1 | 4, 1 | 4, 1 | 4, 1 |
| Words in editable fields | 8.5% of 7,828 | 9.0% of 7,780 | 9.8% of 8,749 | 8.7% of 7,708 |

Since item 12, the privacy gate withholds `jake-0021`'s request and the run refuses it
(`request`, decision 0043), which this item does not move. Over the same twelve, the report reads
668 words editable on the page of the resume's 7,828, besides 29 in the side panel, and locks
`unmapped` 6,873, `moved` 126, `shape` 118, `date` 8 and `text` 6. The review's fixes take the
29 side-panel words out of the rate and give 48 words the template had to locked parts, 44 of them
the two AltaCV forks' and 4 a moderncv fork's. `corpus assemble` reads the same words from the
same function, document by document, as a run of it before the review's fixes showed.

- **The page and the source agree on what is typeset**: in every one of the twelve, the words of the
  fields the page opens are, to the word, those the assembly counts in its source. The locked words
  part by a few in each, as a page and a source each show what the other does not: a hyphen, a
  word a macro reads and never sets, or one it sets that its source holds in another shape.
- **No import succeeds yet, as none did before**: the committed answers name the launch templates'
  own macros, and these forks call macros of their own, so what they set stays `unmapped`, 88% of
  the resume's words, until item 18's model answers them (decision 0026's finding). The bar of page
  size, margins and font size holds over no success, and all twelve prove the three.

## Consequences

- **Item 17's runner reads the outcome here** (decision 0043): `outcomeOf` in
  `scripts/corpus-run.ts` takes the reference and what the intake and the XeTeX rewrite set aside
  beside the assembly, which the child passes (`runRowOf`), and calls `reportOf`, which Node imports
  as it is; its success is the report's, its rate the report's, and what it counts the report's
  editable words, the resume's and the locked ones by reason (`counted`), which the run's summary,
  headline, table and baseline add up; `SUCCESS_RATE` is this record's. `corpus run`, `corpus
  assemble` and the person's report read every import alike.
- **What a page sets that its source does not spell** parts the counts a little: a word TeX breaks
  at a line's end whose two halves the resume also writes with a hyphen somewhere reads as two; a
  word whose letters a class spaces more than a tenth of their size would read as several, which no
  sample does. A page's number or a date `\today` sets, called from the body, counts as the
  resume's, locked, where the probe sets its glyphs down to the call, as it does a stretch whose
  source lies inside one, or where it stands on a running line a locked part sets (2026-10-03);
  elsewhere, where no text of the source finds them, they are the template's.
- **The template's own text is the probe's `chrome`** (decision 0022): what no part of the
  document's source sets, read by the pieces of text each part's source holds and by its words
  alone. The search errs on the resume's side: a class label whose words a neighbouring part's
  source holds too is counted as that part's, locked, which can only lower the rate. Text a macro
  makes that no source spells, a date, a page's number, a counter, stays the template's, but on a
  running line a locked part of the source sets (2026-10-03). A class's own label on such a line
  is counted as the part's too, locked, which can only lower the rate.
- **An import kept before this change** has no owners, and its report counts the words as its
  assembly did in the source, naming no part; only development stores hold such imports.
- **A partial import is not kept until the person continues**: one left waiting when the tab goes
  is lost, and is imported again from the file.
- The report's first line stays above the page while the document stays open, and goes with it.
