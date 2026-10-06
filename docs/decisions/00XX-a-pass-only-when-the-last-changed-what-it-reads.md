# 00XX. A pass only when the last one changed what the next reads

Date: 2026-10-06 · Status: accepted, lane 1 of decision 0067's chosen fixes; amends 0003's rule
that a compile passes again whenever its log asks, and 0022's on the probe's second pass

## Context

Decision 0067 found two imported resumes, `altacv-0017` and `awesome-cv-0033`, whose every edit
ran three passes, the most a compile is allowed, where every edit of the other 105 typed resumes
ran one; they were the slowest two to type in, at 1,537 and 558 ms an edit, and their imports'
compiles cost twice a pass. The session passed again whenever a pass's log asked for it (decision
0003). The record inferred that biblatex asked, for Biber, which the engine never runs, and asked
again on every pass, so no pass could ever meet it.

## Decision

### What asked

On AltaCV's upstream sample (`altacv-0000`), imported as the app imports it and then edited,
every pass's log carries biblatex's warning that asks to run Biber on the job's file "and rerun
LaTeX afterwards". The session read the word "rerun" in it as a request for another pass, so
every edit ran three; the first pass of a new document also carries hyperref's request for a pass
to get the `/PageLabels` entry. From the second pass on, a pass of an edit changed no file of the
job's folder but its log and its output.

### The rule

- A pass is repeated only when it changed a file of the job's folder that the next pass reads,
  and, as before, the document is new, its log asks, or the caller asked for a pass after any
  change (`rerunOnChange`, the probe's, decision 0022). The session compares the folder's bytes
  before and after each pass (`src/engine/session.ts`).
- TeX reads nothing a pass can change but the files of the job's folder: the body, the format and
  the tree stay as they were. A pass after one that left those files as it found them reads what
  that one read, so it sets the same page, whatever the log asked for.
- Two kinds of change do not count, since the next pass's page cannot depend on them:
  - files TeX writes for other programs and never reads: biblatex's control file for Biber
    (`.bcf`) and logreq's requests for latexmk (`.run.xml`);
  - biblatex's two lines in the `.aux` that note the `.bbl`'s checksum and its request for Biber
    (`\abx@aux@read@bbl@mdfivesum`, `\abx@aux@read@bblrerun`). biblatex reads them only to ask
    for Biber again, in its log, when the `.bbl` has not changed since it last asked. The checksum's
    line reads `nohash` after a pass that found none, and `nobblfile` or the `.bbl`'s checksum on
    the pass after, so without the exception every new document with biblatex, and every compile of
    the import that follows one with another body, paid a third pass for a line no page reads.
- The cap stays: 3 passes by default, `maxPasses` as given. The rule only ever takes passes away,
  never adds one: a pass that changed what the next reads, under a log that does not ask, still
  ends the compile, as before.
- The log's reading is unchanged (`src/engine/log.ts`); its comment says a request is a reason for a
  pass and never enough alone.

### Proof that the page is the same

Tests in `src/engine/session.test.ts` compile invented documents both ways: as the session does now,
and as it did before, one pass at a time in the same job for as many passes as the old rule ran.
Outputs are compared byte for byte, with the minute TeX writes in the output's preamble blanked.
They cover biblatex asking for Biber on pdfTeX and XeTeX (a new document 2 passes where it took 3,
each edit 1 where it took 3); a reference set before its label, so that only the second pass sets it,
where a new document and an edit that renumbers the label keep their second pass and lose the third;
and a label that changes on every pass, which still runs to the cap.

### Numbers

- AltaCV's upstream sample, imported and edited in Node: three passes an edit before, one after; a
  new document of it, three before, three after, since its second pass changes the label of a page.
- The 18 imports over 20 s (decision 0067's `slow.txt`), imported one at a time with each compile's
  passes counted, on a local merge of main with the two diagnostic changes (#111, #112): 2,891
  passes before, 2,767 after. `altacv-0017` 386 to 309 and its passes' time 175 to 131 s;
  `awesome-cv-0033` 137 to 99, 33 to 23 s; `altacv-0002` 128 to 121; `altacv-0015` 120 to 118; the
  other 14 as before. Every one of the 18 has the same outcome, compiles and words in place as the
  before-run. Times were taken while other lanes ran, at a load of 3.5 to 7.7, so they are
  indicative; the pass counts are not.

## Consequences

- An edit of a resume with biblatex takes one pass, like any other: AltaCV's forks, and Awesome-CV's
  that load it. Imports with biblatex lose a pass on many of their trial compiles. Their compiles and
  words are as before.
- Each pass now copies the job's folder before it runs and compares after: about 3 ms for 4 MB of
  files in Node, and an upload's images are small blank stand-ins, so a pass's cost barely moves.
- The exception names biblatex's own lines. Another package whose `.aux` lines change on every pass
  without changing the page would still cost passes up to the cap, as every package did before.
