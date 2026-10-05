# 0054. A PDF onto the resume, by rules

> Accepted by 00YY: the rules' known lacks, which this record leaves open, and their 68.8% on
> the two held-out layouts are known limits, not chased in milestone 3.

Date: 2026-10-04 · Status: accepted; the rules' known lacks it leaves open are accepted by 00YY

## Context

Item 12 of `docs/milestone-3-overhaul.md`: once item 11 has laid a PDF's lines out, two steps with
a seam between them turn them into the resume. The first says what each line is; the second files
the labelled lines into the shared resume model the built-in templates set. Rules do the first
here, and stay the answer for a person who does not agree to send the PDF's text; item 13's hosted
model replaces that step only. The spike of item 3 (decision 0051) wrote a first cut of both steps
in `scripts/spike-pdf/`; this item makes them the editor's, and is done when the targets the owner
set for rules on 4 October 2026 are met on the spike's three sets, or each gap is recorded with its
cause.

## Decision

**Where.** Pure modules in `apps/editor/src/pdf/`, which load no pdf.js and touch no DOM, so they
run in the page, a worker or Node alike:

- `label.ts`, the first step. The closed list of eight roles (name, contact, section heading, entry
  head, date, place, bullet, running text), the spike's rules (`labelByRules`), unchanged, and the
  seam: a `Labeller` is given the layout's lines, each with its text and its features (size,
  weight, position, row, column, rule, links, bullet, the gap above it), the pages and the body's
  size, and answers one role a line, `roles[i]` for `lines[i]`. The rules are one labeller
  (`rulesLabeller`). `labelLines` takes another's answer only when it gives one role from the list
  for every line; one that throws or answers in another form is set aside whole and the rules
  answer, with the reason kept (`failed`, `wrong form`), so the review can say who read the PDF. A
  caller's stop is not caught. `featuresOf` is the same lines as a table of plain values, what a
  model is told; item 13 adds the consent, the time budget and the service.
- `file.ts`, the second step: the spike's filing into `@resume-tools/resume-model`'s `Resume`, no
  parallel type. New here:
  - **Bold, italic and links inside a text are kept.** A bullet's, a list item's, a labelled
    item's and a paragraph's text is rich text: each run's weight and slant from the PDF, and the
    address of the PDF's own link over its words, a word linked whole where most of its letters
    lie under the link's box. A style over the whole text is the template's, as an entry's
    italic line is, and is not kept; a link is kept whatever it covers. Where a line's runs cannot
    be found in its text, as letter-spaced capitals joined, the text is plain. The runs' text is
    the line's text exactly, so nothing the count or the scores see changed.
  - **Flags are data for the review** (item 14): each names its kind (`date-as-text`, `unfiled`),
    the line it came from, the node of the resume it landed in (the entry whose date stays as
    text, or the last section's item) and the text in doubt.
  - **The count of every word read** against the resume built, `everyWordLands`: as many letters
    and digits land as were read, a date's among them where the model holds it as a date. Letters,
    not words, so that cutting a line into fields (`a|b`, one word read, two filed) counts nothing
    twice.
- `resume.ts` composes them: `resumeOfPdf(read, { labeller })` lays the PDF out, labels its lines,
  the rules by default, and files them.
- `text.ts` (dates, emails, phones, places, the words a heading gives its role by) and `score.ts`
  (fields right against a truth, decision 0051's definition) move with them; the page never loads
  `score.ts`, which the suite and the spike use. `Part` gains its row's baseline, so that a link
  over a wrapped bullet's second row is found on that row.

The spike's `text.ts`, `roles.ts`, `file.ts` and `score.ts` are re-exports of these now; its
command, its scoring and `--report` work as before.

**The rules are the spike's.** No rule was changed. Decision 0051 names what they lack, from the
two PDFs held out (a date and its place on one line, contacts in a block beside the name, a
sidebar's headings, heading words such as `Training`, letter-spaced headings), and asks that each
fix be judged on PDFs the rules were not tuned on. None has been added since, so a fix now could be
judged only on the held-out pair, which would then no longer be held out; the targets are met
without one.

**The tests.** `src/pdf/round-trip.test.ts` holds the targets as thresholds on the two sets with a
truth: the engine typesets each built-in template with each curated sample, the nine PDFs are read
back by rules and scored, and each filed resume is typeset again by its template; the eight PDFs
of other tools are read and scored. `label.test.ts` holds the seam and its fall back for each
cause; `file.test.ts` the rich text, the flags and the count.

### The results

Runs of 4 October 2026, at ff44033 with this record's code uncommitted, in Node on this machine:
`spike-pdf builtin`, `spike-pdf other`, and `spike-pdf corpus --out pdf-rules` (counts only, under
`.corpus/pdf-rules/`).

**The built-in templates** (set i: Jake's Resume, AltaCV and Awesome-CV, each typesetting the three
curated samples, nine PDFs)

| Target | Result | |
|---|---|---|
| Every word read lands | 1,964 words, 9 of 9 PDFs; none in the catch-all | met |
| Name, email, phone, links exact | 9, 9, 9 and 21 of 21 | met |
| Section titles and roles exact | 54 and 54 of 54 | met |
| At least 95% of entries with title, place and dates right, title and subtitle a pair | 100% (45 of 45); 73.3% (33) counting the title alone | met |
| Bullets exact | 63 of 63 | met |
| Fields right in all | 96.5% (333 of 345) | |

Every entry missed counting the title alone is Awesome-CV's, which sets the employer above the
role, as decision 0051 found; the pair counts it right.

**The corpus** (set ii, 220 documents, read by rules alone, counts only)

| Target | Result | |
|---|---|---|
| Every word read lands | 73 of 73 documents read (45,474 words; 45,487 land) | met |
| At least 95% of words in a recognised place, not the catch-all | 97.7% (44,410); catch-all 2.4% (1,077 words, 284 lines, in 51 documents) | met |

Not read: no PDF from xdvipdfmx 42, refused by the reference compile 103, past the reader's caps 2.
A document's recognised share: median 99.4%, 72 of 73 at 85% or more. By family: jake 99.2%,
awesome-cv 98.4%, altacv 97.7%, europecv 96.5%, other 96.3%, moderncv 96.1%. Dates kept as text and
flagged: 15. These are item 11's counts: this item changed no rule.

**Invented resumes from other tools** (set iii, eight PDFs)

| Target | Result | |
|---|---|---|
| At least 80% of fields right | 91.9% (194 of 211) | met |
| Every word read lands | 8 of 8 (1,138 words; 4 in the catch-all) | |

The six the rules were debugged on read 98.8% (161 of 163); the two held out 68.8% (33 of 48):
`chrome-right-sidebar` 13 of 27 and `textutil-table` 20 of 21, for the causes decision 0051 gives.

**Time**

| Target | Result | |
|---|---|---|
| Under 1 s a PDF by rules | rules (layout, labels, filing): median and max 7 and 15 ms on set i, 5 and 15 ms on set iii, 12 and 43 ms on the corpus; with pdf.js's reading, 30, 38 and about 250 ms at most | met |

pdf.js's first read in a process, its loading with it, took 160 to 190 ms; in the browser the
worker's download and start come on top (decision 0052).

## Consequences

- Item 13 plugs the hosted model in as a `Labeller` whose `by` is `model`: it is given the same
  lines, tells the service `featuresOf` them, and answers a role a line. A failure or a reply of
  the wrong form already falls back to the rules here; the time budget and the consent are its
  own. Its reading is bounded by this filing step, which the rules share.
- Item 14 shows `Flags` first, by their node, and opens the filed `Resume` in the template the
  person picks. On Awesome-CV's own PDFs an entry's title and subtitle come back swapped, which the
  pair-counting target accepts; the review is where they are swapped back.
- Item 15 turns `round-trip.test.ts` into its threshold tests and adds the corpus command; the
  thresholds here are the targets, which the rules meet with room on sets i and ii and by 11.9
  points on set iii, where the held-out pair is the closer guide to layouts not yet seen.
- The rules' known lacks stay open until PDFs the rules were not tuned on can judge a fix.
