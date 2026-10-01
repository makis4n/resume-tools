# 0039. The import's report, and its bar at nine tenths

Date: 2026-10-01 · Status: proposed; amends 0040's interim rule of what a successful import is,
and replaces 0043's interim outcome

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

### Who sets each word: the attribution, in order

1. **The probe's runs** (decision 0022), now kept whole (`Probe.runs`): every run of the
   reference's glyphs and what sets it, an editable candidate's glyphs a compile showed in place
   among them, besides the uncovered ones the probe already kept, each a locked candidate's, a raw
   chunk's or the template's own (`chrome`).
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

The body's words are the editable and the locked ones; the template's own, a label, a separator,
an icon's neighbour or a page's number no part of the document's source sets, are no word of the
resume's and count in neither. **A raw field is editable**: the side panel edits it where the page
cannot mark it, as a contact whose address is built from its text (decision 0026); the report counts
its words apart (`panel`). **The editable rate** is the editable words over the body's.

### The bar

- **An import succeeds when its first check holds** (the regenerated document set the reference's
  glyph stream, decision 0026) **and at least 90% of its body's words are editable**
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

- **Its first line** (`summaryOf`): "Imported: 96% of your resume's words are editable.", or for a
  partial import why: under the bar, or the page this editor sets differs from the original's.
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
  fonts were set in Latin Modern (decision 0026); and the kinds of unit the template can neither
  add nor remove (decision 0038).

### The screen

A successful import is kept and opened as item 12 opened every import, its report's line and what
was left out above its page until the document closes. A partial one is not kept yet: the list
holds its report in place of the progress line, the locked parts listed, with **Continue**, which
keeps it and opens it as it is, and **Stop**, which keeps nothing; nothing else starts meanwhile.
Its package was never stored and the formats its checks dumped went as they ended (decision 0038),
so stopping has nothing else to drop.

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

The report names the two parts "Quill Invented 555-0100 | quill@example.invalid | quill…" (9 words)
and "Languages: Invented, Words, Other Tools: Quill, Wren" (7). `run.test.ts` holds the report to
the hand count within two words.

### The three upstream samples

Through the same import, the M4 Pro, the tree of layout 7. The source count is decision 0026's
(the assembly's own, in the source, raw fields aside).

| Sample | Editable | The resume's | The template's | Rate | Outcome | Source count |
|---|--:|--:|--:|--:|---|--:|
| Jake's Resume | 323 | 389 | 0 | 83.0% | partial | 323 of 389 |
| AltaCV | 67 | 219 | 13 | 30.6% | partial | 67 of 282 |
| Awesome-CV | 1032, 9 of them the side panel's | 1269 | 18 | 81.3% | partial | 1023 of 1260 |

- **Jake's sample** reads as its source counts, word for word: its heading block (15 words), its
  skills (40) and three dates written with a stop (11) are locked, as decision 0026 found them.
- **Awesome-CV's** pages hold its source's words to the word: its typeset fields its 1023, once the
  three words TeX broke with a hyphen read as one each, and its locked parts its 237, reason by
  reason (`date` 35, `unmapped` 192, `shape` 5, `text` 4, `differs` 1); the side panel edits 9 more,
  its raw contacts', which the source count leaves out. Its 18 template words are its class's own
  text, which no source counts.
- **AltaCV's** pages show 63 fewer locked words than its source counts in its locked parts: words
  their source holds that set no word on the page, as an argument a macro reads and does not show.
  The page's count is the report's. Its 13 template words are its class's own text; the report
  lists its images and its bibliography as left out.

**The hand counts of the three samples are owed.** The permission system of the session that built
this item refused it a reading of `.corpus/oracle/`, where the samples are fetched, as it guards the
corpus's documents, so nobody has yet counted their pages by hand. `scripts/corpus-oracle.test.ts`
holds each sample's report to the counts above within two words (`SAMPLE_COUNTS`), the report's own
on this commit, as a regression check until a person counts each page: import the sample in the dev
server, read each page's words, the runs of letters and digits, and set each down to a field the
page opens, a part the report names by its first words, or the template, the way the fork's are
counted above; then write the counts here and in the test, and tick item 13.

## The sample

`corpus assemble` over the twenty documents of the sample but altacv-0001, which times out at its
900 s every run (decision 0040), from the committed answers, the M4 Pro, four children beside other
work: 1.9 minutes. The thirteen assembled are as decision 0040's run left them, twelve whose first
check holds and one partial by a position; four call no macro the answers name, and item 8's check
refuses two Awesome-CV forks.

| | jake | awesome-cv | altacv | moderncv | all |
|---|--:|--:|--:|--:|--:|
| Assembled and checked | 6 | 2 | 2 | 3 | 13 |
| Succeeded, as the report says | 0 | 0 | 0 | 0 | 0 |
| Partial | 6 | 2 | 2 | 3 | 13 |
| Words in editable fields, read from the page | 14% | 4% | 2% | 7% | 10% |
| Words in editable fields, counted in the source (decision 0026) | 15% | 2% | 1% | 7% | 10% |
| The resume's words on the page | 5099 | 1052 | 1446 | 1219 | 8816 |
| Editable, of them in the side panel alone | 739, 0 | 39, 21 | 22, 0 | 84, 8 | 884, 29 |
| Locked `unmapped` | 4108 | 1013 | 1424 | 1133 | 7678 |
| Locked otherwise (`moved`, `shape`, `date`, `text`) | 252 | 0 | 0 | 2 | 254 |
| The template's own | 20 | 4 | 46 | 42 | 112 |

- **The page and the source agree on what is typeset**: in every one of the thirteen, the words of
  the fields the page opens are, to the word, those the assembly counts in its source; the report's
  other editable words are the raw contacts', which the source count leaves out (29). The locked
  words part by a few in each, 38 of 7,894 in all, as a page and a source each show what the other
  does not.
- **No import succeeds yet, as none did before**: the committed answers name the launch templates'
  own macros, and these forks call macros of their own, so what they set stays `unmapped`, 87% of
  the resume's words, until item 18's model answers them (decision 0026's finding). The bar of page
  size, margins and font size holds over no success, and all thirteen prove the three.

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
  resume's, locked, since the body's source sets it.
- **The template's own text is the probe's `chrome`** (decision 0022): what no part of the
  document's source sets, read by the pieces of text each part's source holds. A class label the
  probe sets down to a neighbouring part is counted as that part's, locked.
- **An import kept before this change** has no owners, and its report counts the words as its
  assembly did in the source, naming no part; only development stores hold such imports.
- **A partial import is not kept until the person continues**: one left waiting when the tab goes
  is lost, and is imported again from the file.
- The report's first line stays above the page while the document stays open, and goes with it.
