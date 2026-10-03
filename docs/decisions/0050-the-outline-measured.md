# 0050. The outline measured

Date: 2026-10-04 · Status: accepted; the targets are the owner's to set

Targets: set by the owner on

## Context

Item 2 of `docs/milestone-3-overhaul.md`: before stage 1 builds the outline (items 4 to 9), measure
what it keeps of the probe's verdicts, so that the owner can set the second pass's `.tex` targets.
The plan's "Done means" holds five provisional numbers for a `.tex` import, and its first risk is
that the probe's 73% (decision 0022) may not survive once each field is written back as the
generator writes a slot. This record is the spike's method, its tables, and what they say for each
target. The code is `apps/editor/scripts/spike-outline.ts`, its child, `spike-outline-build.ts` and
`spike-outline-table.ts`; the import itself does not change, and four of its files export what the
spike reuses (Consequences).

## Decision

### The method

`spike-outline` takes the three upstream samples and the implementers' twenty of decision 0043
(`jake-0001`, `-0007`, `-0016`, `-0021`, `-0030`, `-0038`; `awesome-cv-0003`, `-0009`, `-0018`,
`-0027`; `altacv-0001`, `-0010`, `-0015`; `moderncv-0001`, `-0010`, `-0018`; `europecv-0002`;
`other-0001`, `-0028`, `-0046`) through the import's own functions up to the probe, as
`corpus run`'s child does: the intake, the reference compile, the Latin Modern swap, the
signatures, the parse and the probe, on the engine in Node, XeTeX documents probed whole as the
first pass probes them. From the tree and the probe's verdicts it builds the outline: each
editable candidate a field where it stands, a value the preamble stores through the preamble's
call issued again, as the probe issues it, and everything else kept text, byte for byte; a list's
items are a group of units, and so is a run of calls to the same command, each with what follows
it up to the next, at levels that the template macros beginning and ending an environment bracket,
as Jake's `\resumeItemListStart` and `\resumeItemListEnd`. Check 1 writes each field in the
editor's marker as the generator writes a slot, a date's text as plain text, compiles the outline
on the probe's own path, and makes kept text of each field whose rewriting moves the page from
the reference, bisected by the probe's own `settle` within 48 compiles. Check 3 tries each group's
copy of its last unit with its fields emptied, and the removal of its first and of its last,
compiled in batches whose changes do not overlap and halved where a batch breaks the page, within
64 compiles; a trial keeps the page when the compile goes through and every other glyph of the
reference is still there in the same font, size and code, in its order or reflowed to another
column or page, a removal taking out every glyph the probe's runs give to a part inside the unit
and the template's own free to go either way. The words are the reference's page's, read and set
down as item 13's report reads them (decision 0039), and a kept word is one the retype reaches
where decision 0042's alignment offers the run of plain text its glyphs are in. The counts of the
three samples' words are their hand counts', 389, 232 and 1,287.

Times are the M4 Pro's, Node, two documents at a time at a load of about 3.5, from the intake to
the end of check 3; they leave out what the spike alone adds, its baseline compiled again and its
reading of the words. The first pass's share is `corpus run --committed-only --ids` over the same
twenty on the same checkout, 4 October 2026, a document it did not import counting its words as
the spike reads them, none editable; and for the samples, item 13's report pinned to their hand
counts (decision 0039). `pnpm --filter @resume-tools/editor spike-outline --report` prints the
tables again from the rows under `.corpus/spike-outline/`, ids and counts only.

### The tables

The words, by template family of the corpus's twenty, each upstream sample, and all 23: the
resume's words; their shares in fields, in kept text the retype reaches, and locked; the documents
with 90% or more in fields; the probe's own share of the reference's glyphs (decision 0022's
measure, 73% over the whole corpus) and of the words, before check 1; and the first pass's
editable share of the same words.

| | Documents | Resume's words | In fields | Retype reaches | Locked | At 90% | Probe: glyphs | Probe: words | First pass |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| jake | 6 of 6 | 5099 | 95% | 4% | 0% | 5 | 97% | 98% | 11% |
| awesome-cv | 4 of 4 | 2058 | 96% | 2% | 0% | 4 | 95% | 96% | 0% |
| altacv | 3 of 3 | 1790 | 93% | 3% | 2% | 2 | 92% | 93% | 3% |
| moderncv | 3 of 3 | 1241 | 89% | 8% | 2% | 1 | 88% | 89% | 6% |
| europecv | 1 of 1 | 339 | 85% | 3% | 11% | 0 | 75% | 86% | 0% |
| other | 3 of 3 | 4398 | 4% | 92% | 3% | 0 | 3% | 4% | 0% |
| The corpus's documents | 20 of 20 | 14925 | 67% | 30% | 1% | 12 | 65% | 68% | 4% |
| altacv-0000 (upstream) | 1 of 1 | 232 | 72% | 21% | 5% | 0 | 74% | 77% | 28% |
| awesome-cv-0000 (upstream) | 1 of 1 | 1287 | 96% | 1% | 1% | 1 | 96% | 96% | 79% |
| jake-0000 (upstream) | 1 of 1 | 389 | 89% | 10% | 0% | 0 | 98% | 100% | 83% |
| All | 23 of 23 | 16833 | 70% | 27% | 1% | 13 | 68% | 71% | 12% |

The units and the time: the groups found and their units; how many keep the page with a copy of
their last unit, the removal of their first and of their last, and all three; the documents by
engine; and each document's compiles and its time, the median and the slowest.

| | Groups | Units | Copy | Remove first | Remove last | All three | Engine | Compiles, median | Time, median | Time, slowest |
|---|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| jake | 60 | 216 | 60 | 53 | 56 | 53 | pdfTeX 6 | 25 | 4.8 s | 7.1 s |
| awesome-cv | 39 | 158 | 39 | 37 | 37 | 37 | XeTeX 4 | 31 | 27.2 s | 94.5 s |
| altacv | 27 | 122 | 27 | 27 | 27 | 27 | pdfTeX 3 | 50 | 14.6 s | 19.4 s |
| moderncv | 28 | 118 | 28 | 27 | 25 | 25 | pdfTeX 3 | 60 | 19.3 s | 22.9 s |
| europecv | 1 | 24 | 1 | 1 | 1 | 1 | pdfTeX 1 | 25 | 3.8 s | 3.8 s |
| other | 126 | 429 | 126 | 78 | 57 | 57 | pdfTeX 3 | 60 | 7.6 s | 75.6 s |
| The corpus's documents | 281 | 1067 | 281 | 223 | 203 | 200 | pdfTeX 16, XeTeX 4 | 38 | 11.1 s | 94.5 s |
| altacv-0000 (upstream) | 12 | 38 | 12 | 11 | 11 | 11 | pdfTeX 1 | 74 | 37.9 s | 37.9 s |
| awesome-cv-0000 (upstream) | 14 | 66 | 14 | 12 | 12 | 12 | XeTeX 1 | 52 | 90.2 s | 90.2 s |
| jake-0000 (upstream) | 10 | 32 | 10 | 9 | 9 | 9 | pdfTeX 1 | 13 | 3.1 s | 3.1 s |
| All | 317 | 1203 | 317 | 255 | 235 | 232 | pdfTeX 18, XeTeX 5 | 45 | 14.6 s | 94.5 s |

Each document, the same counts, with the first pass's editable share of its words:

| Document | Engine | Words | In fields | Retype reaches | Locked | First pass | Groups | Copy | Remove first | Remove last | All three | Compiles | Time |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| altacv-0001 | pdfTeX | 300 | 100% | 0% | 0% | 0% | 7 | 7 | 7 | 7 | 7 | 50 | 6.5 s |
| altacv-0010 | pdfTeX | 566 | 84% | 7% | 7% | 1% | 10 | 10 | 10 | 10 | 10 | 45 | 14.6 s |
| altacv-0015 | pdfTeX | 924 | 97% | 2% | 0% | 4% | 10 | 10 | 10 | 10 | 10 | 68 | 19.4 s |
| awesome-cv-0003 | XeTeX | 494 | 96% | 3% | 0% | 1% | 8 | 8 | 8 | 8 | 8 | 31 | 27.7 s |
| awesome-cv-0009 | XeTeX | 243 | 95% | 4% | 0% | 0% | 8 | 8 | 8 | 8 | 8 | 9 | 16.9 s |
| awesome-cv-0018 | XeTeX | 558 | 98% | 1% | 0% | 1% | 9 | 9 | 9 | 9 | 9 | 30 | 26.7 s |
| awesome-cv-0027 | XeTeX | 763 | 97% | 2% | 0% | 0% | 14 | 14 | 12 | 12 | 12 | 56 | 94.5 s |
| europecv-0002 | pdfTeX | 339 | 85% | 3% | 11% | 0% | 1 | 1 | 1 | 1 | 1 | 25 | 3.8 s |
| jake-0001 | pdfTeX | 799 | 98% | 0% | 1% | 5% | 10 | 10 | 9 | 10 | 9 | 20 | 4.7 s |
| jake-0007 | pdfTeX | 833 | 96% | 3% | 0% | 12% | 9 | 9 | 6 | 7 | 6 | 29 | 5.5 s |
| jake-0016 | pdfTeX | 592 | 87% | 12% | 0% | 10% | 8 | 8 | 6 | 7 | 6 | 47 | 7.1 s |
| jake-0021 | pdfTeX | 1036 | 98% | 1% | 0% | 0% | 16 | 16 | 15 | 15 | 15 | 26 | 5.0 s |
| jake-0030 | pdfTeX | 744 | 96% | 3% | 0% | 45% | 8 | 8 | 8 | 8 | 8 | 11 | 2.7 s |
| jake-0038 | pdfTeX | 1095 | 92% | 7% | 0% | 1% | 9 | 9 | 9 | 9 | 9 | 24 | 4.3 s |
| moderncv-0001 | pdfTeX | 596 | 89% | 10% | 0% | 8% | 14 | 14 | 13 | 13 | 13 | 76 | 22.9 s |
| moderncv-0010 | pdfTeX | 302 | 79% | 13% | 6% | 8% | 7 | 7 | 7 | 5 | 5 | 55 | 19.2 s |
| moderncv-0018 | pdfTeX | 343 | 97% | 2% | 0% | 1% | 7 | 7 | 7 | 7 | 7 | 60 | 18.7 s |
| other-0001 | pdfTeX | 110 | 77% | 9% | 13% | 0% | 8 | 8 | 8 | 4 | 4 | 60 | 7.6 s |
| other-0028 | pdfTeX | 3975 | 0% | 96% | 2% | 0% | 114 | 114 | 68 | 51 | 51 | 129 | 75.6 s |
| other-0046 | pdfTeX | 313 | 19% | 80% | 0% | 0% | 4 | 4 | 2 | 2 | 2 | 11 | 2.4 s |
| altacv-0000 | pdfTeX | 232 | 72% | 21% | 5% | 28% | 12 | 12 | 11 | 11 | 11 | 74 | 37.9 s |
| awesome-cv-0000 | XeTeX | 1287 | 96% | 1% | 1% | 79% | 14 | 14 | 12 | 12 | 12 | 52 | 90.2 s |
| jake-0000 | pdfTeX | 389 | 89% | 10% | 0% | 83% | 10 | 10 | 9 | 9 | 9 | 13 | 3.1 s |

Shares are rounded down, as the report shows its rate. The first pass imported fourteen of the
twenty, 8.6% of their 8,277 words editable; it refused `jake-0021` (its request held its text),
`awesome-cv-0009` and `-0027` (fonts its rewrite sets otherwise, decision 0023), had no answer for
`other-0028` and `-0046`, and timed out on `altacv-0001`, whose body never ends at the font size
control's 9 points (decision 0026), which the outline does not try. The two read the same words
of every document both read, but for `moderncv-0010`, 302 here against the first pass's 284.

### What the tables say

- **The probe's 73% survives the outline.** Check 1 makes kept text of 20 of the 1,692 fields the
  probe proved, 19 that moved the page and one that stopped it: the generator's writing of a field
  sets the page as the person's LaTeX did, but where a field holds what a field cannot, as the line
  breaks (`\\`) of the skills block in Jake's sample, which a field reads as spaces. It took one
  compile at the median, and 22 at most. So the outline's fields hold what the probe proves: 67.7%
  of the twenty's words against 68.8% in the probe's editable candidates, and within a point or
  two of it in every family but Jake's, three points down. Measured on glyphs as decision 0022
  measured it, the probe covers 65% of the twenty, against 73% of the whole corpus.
- **Where it does not, it is the probe's, and one document of the twenty.** `other-0028` holds
  3,975 of the twenty's 14,925 words, 27%, and the probe proves 7 of its 956 candidates: 273 of
  them stop the compile (one command's arguments), and its budget of 64 compiles runs out with 475
  untested. Its words are kept text, 96% of them where the retype reaches. Without it, the nineteen
  hold 92.0% of their words in fields. `other-0046`, 19% in fields, sets most of its words through
  parts the parser keeps raw, and the retype reaches 80%. The family `other` in the twenty is these
  two and `other-0001` (77%), and says little of the corpus's 34, where decision 0022's probe
  covered 51% of the glyphs.
- **The retype reaches almost all the kept text.** Of the twenty's 4,815 kept words, 4,559 line up
  with runs of plain text its LaTeX holds, and 256, 1.7% of the words, are locked: in fields or
  through the retype, 98% of the twenty's words can be changed.
- **Groups of units come by shape, and most of them hold.** 317 groups of 1,203 units in the
  23 documents, 153 lists and 164 runs; 191 of them have a field in their last unit, the others
  being lists and runs of kept text, as `other-0028`'s 80 lists of one item. Every copy keeps the
  page. 255 removals of a group's first unit keep it and 235 of its last; 232 groups, 73%, keep it
  all three times, and 181 of 203, 89%, without `other-0028`. What fails: a list's only item, in
  15 lists, whose removal empties the list, which LaTeX refuses; four removals that set the rest of
  the page in other glyphs, the first section of three of Jake's forks and one of `other-0001`'s,
  as a size or a font declared in the unit and running on past its end would; eleven that took out
  what they had to and kept what they had to, but set 1 to 22 glyphs the reference has fewer of,
  nine in `other-0028`, four of them a page or two shorter, and two in `moderncv-0010`, which the
  counts alone do not explain; four that lost one glyph the probe's runs give to a part outside
  the unit, three of `other-0001`'s and one of `other-0028`'s; and `other-0028`'s 68 trials the
  budget left untried. A copy or a removal moves the rest down or up, and in AltaCV's paracol
  columns and over Awesome-CV's pages it reflows them: 204 of the copies kept every glyph but not
  in the reference's order, which a check that holds the order would refuse.
- **The time is the probe's.** On pdfTeX the import to the end of check 3 took 6.8 s at the median
  of 18 documents, 11 of them under 8 s: Jake's forks 2.7 to 7.1 s; AltaCV's 6.5 to 19.4 s and its
  sample 37.9 s, whose compiles take 0.1 to 0.45 s with paracol and TikZ; moderncv's 18.7 to 22.9 s,
  whose microtype has the probe isolate fields at two compiles each (decision 0022); and
  `other-0028` 75.6 s. At the median the probe took 3.7 s, check 1 0.4 s and check 3 1.8 s, 8.5
  compiles. On XeTeX, compiled whole as the first pass probes it: 16.9, 26.7, 27.7, 90.2 and 94.5 s,
  the probe 20 s at the median, a compile 0.8 to 1.6 s; the two over 90 s are the Awesome-CV
  sample, of three pages, and `awesome-cv-0027`, whose check 3 alone took 33 and 37 s.

### The provisional targets, against the numbers

- **At least 60% of body words editable over resumes that compile.** The twenty, all of which
  compile, hold 67.7% in fields (70.5% with the samples). Weighted family by family with each
  family's share of the 117 resumes' glyphs (decision 0022), it is 58.1% with the twenty's `other`
  (4%), and 76.8% with `other` at decision 0022's probe share, 51%, which the outline keeps: the
  corpus's number turns on its `other` documents, 40% of its glyphs, three of which are in the
  twenty. Item 9's run over the corpus says which.
- **At least 80% on Jake's, Awesome-CV's and AltaCV's forks.** The thirteen forks of the twenty
  hold 95.3%: Jake's 95%, Awesome-CV's 96%, AltaCV's 93%, and each fork 84% or more. Of the
  upstream samples, Jake's holds 89%, Awesome-CV's 96%, and AltaCV's 72%: its contacts, whose links
  repeat their text (`twice`), its tags and its wheel chart stay kept text, as the probe found them
  (decision 0022), and the retype reaches most of it, 21% of the sample's words.
- **At least 25 resumes at the 90% bar.** Twelve of the twenty reach 90% in fields: five of Jake's
  six, Awesome-CV's four, two of AltaCV's three, one of moderncv's three, and none of europecv's
  one or of `other`'s three. Scaled to the 117 resumes that compile, these are estimates and not
  counts: 70 at the twenty's share, 12 in 20; and 58 family by family, each family's share in the
  twenty times its documents among the 117 (35, 18, 10, 14, 6 and 34). Of the samples, Awesome-CV's
  reaches the bar. The fields counted here have not taken check 2, which may lock some.
- **A pdfTeX import under 8 s.** From the intake to the end of check 3: 6.8 s at the median, 11 of
  18 under 8 s, Jake's forks 2.7 to 7.1 s. Checks 2 and 4, the harness and the page took 2.4 s more
  on Jake's sample in the first pass (decision 0045), which would put Jake's forks at about 5 to
  9.5 s. AltaCV's and moderncv's documents take 6.5 to 23 s here, and 38 s AltaCV's sample, most
  of their probes alone 11 to 16 s, where the first pass's whole import took 23 to 30 s on the same
  ones: 8 s holds for Jake's family and documents like it, not for those.
- **A XeTeX aim of 30 s.** Compiled whole, as the first pass probes XeTeX, the five took 16.9 to
  94.5 s, 27.7 s at the median. On item 5's saved format, after the fonts' rewrite, at the 0.23 s a
  compile from a format takes on Awesome-CV in decision 0045, the three whose fonts the rewrite
  reproduces would spend 7 to 12 s on the same compiles, beside about 4 to 6 s for the reference,
  the signatures and the rewrite's check: an estimate of 11 to 18 s before checks 2 and 4, the
  sample's 18 s among them, and not a measurement. The other two forks, `awesome-cv-0009` and
  `-0027`, are ones the first pass's rewrite refuses for setting their glyphs otherwise; whole,
  they took 16.9 and 94.5 s.

## Consequences

- **The outline can be built as the plan has it.** It keeps what the probe proves, check 1 costs a
  compile or a few, and most groups found by shape take a copy and both removals, 89% of them
  outside one document; the outline's ceiling is the probe's own reach, and the retype covers most
  of what lies past it.
- **Check 3 needs three rules the trials show.** A list of one item cannot lose it: the editor
  removes the list with it, or disables the button. A unit whose removal sets the rest of the page
  in other glyphs holds what runs past its end, as a declared size or font would, and its group is
  fixed. And a copy or a removal reflows paracol's columns and a document's later pages, so the
  check holds every other glyph there in its font, size and code, not in the reference's order. The
  eleven removals that set a few glyphs more than the reference has want reading on the engine,
  with invented documents of their shape, before the rule for them is set.
- **Time is the probe's, and the probe's budget the reach.** The 8 s bar holds where the probe is
  quick; AltaCV's and moderncv's documents need fewer probe compiles or cheaper ones, and XeTeX
  needs item 5's saved format, with a whole path kept for the documents whose fonts the rewrite
  cannot reproduce. A large document runs out of both budgets, 64 for the probe and 64 for check 3,
  as `other-0028` did.
- **What the spike does not measure.** Check 2, whose mutations may lock fields or mark them
  required, and check 4; the fonts' rewrite before the probe; a unit's bounds beyond its shape, so
  a command called once at its level makes no group, and the last unit of a run of sections runs to
  the level's end; a field that holds a command taking no argument, as an icon, which is written
  with the command kept inside its marker; and the retype's reach compiled, here by alignment alone.
  The sample's `other` is three documents, one of them 27% of the twenty's words.
- **Exports, for the spike.** `src/import/candidates.ts` exports `wrapEnd`; `probe.ts` `Setup`,
  `formatPath`, `wholePath`, `failed` and `AUXILIARY`; `report.ts` `ownRunningLines`; and
  `validate.ts` `replacementOf`. Nothing else in `src/` changed. `pnpm --filter
  @resume-tools/editor spike-outline` runs the spike, and `--report` reprints the tables.
