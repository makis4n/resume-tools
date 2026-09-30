# 0043. The corpus run, its baseline, and the review's tooling

Date: 2026-10-01 · Status: proposed

## Context

Milestone 3 item 17 puts every document of the corpus through the whole import in Node, writes one
JSON of what became of each and a summary, holds the run to a baseline in the corpus workflow, and
has the twenty most common templates' answers reviewed by an Opus agent in Claude Code (decision
0037). This record is part A: the runner, its outcome, the baseline, the workflow's step, and the
review's export and check. Part B, the review itself, runs once item 18 has picked the naming model
and filled its cache. Items 12 (the import in the browser), 13 (the report and its 90% bar) and 14
(the controls proven) are built beside it. The code is `apps/editor/scripts/corpus-run.ts`,
`corpus-review.ts` and `corpus-assemble-child.ts`, with `corpus.ts`'s commands.

## Decision

### One pipeline, one child

- `corpus run [--only <id>] [--ids <file>] [--json <file>] [--committed-only] [--allow-model]
  [--write-baseline]` takes each fetched document, or those `--only` or a file of ids names, in the
  reference runner's pool, as many children as the machine has cores and four at most (`poolSize`:
  two on a private repository's free runner), 900 s a document, a model step's 300 s more with
  `--allow-model`. It writes its JSON after each document, and on SIGINT or SIGTERM, as a CI step's
  time running out sends, the pool kills its children and leaves what they held undone, and the run
  ends as it would, printing its table and writing its JSON, marked unfinished, for what it did, and
  exits 1. The child is `corpus assemble`'s, which `corpus oracle` and `corpus review check`
  run too, so the run adds no copy of the pipeline: the intake, the reference compile, the Latin
  Modern swap, the signatures, the parse, the probe, the naming request, its answers, the XeTeX
  rewrite and its check, the assembly, the four checks and the harness.
- The naming step is the import's: the request built with the upload's sources, the page's strings
  and the header's values, and gated as `corpus name` gates it (`gatedRequest`, decision 0033);
  answered macro by macro (`answerDocument`, decision 0027) from the committed answers first, then,
  unless `--committed-only`, the cache of the model `NAMING_MODEL` names; and from that model, for
  what they miss, only with `--allow-model` and `SOCLAAS_API_KEY`, behind the same gate
  (`assertNoText`, the page's leak check) and `checkRequest`, the parent ceasing to ask once the
  provider fails three documents in a row, as `corpus name --model` does. `--allow-model` with
  `--committed-only`, or without a key, stops the run before any document is read.
- `corpus assemble` and `corpus oracle` send the same child the committed answers alone, as they
  read them before; but their requests are now built with the page and gated as the import's are,
  where they were built with the sources and the header alone (decision 0033 has item 7 build them
  with the page): a key a page's strings mask differently moves, as it does in the import, and a
  page the detector cannot read refuses the document (`unreadable`).
- A child answers with `corpus assemble`'s row and the run's; what holds a document's text, its
  assembly and what the review reads of it (below), the parent keeps under `.corpus/run/<id>/`,
  `assembly.json` and `review.json`, emptying the document's folder first so that no file of an
  older run is left beside a newer.
- The run records itself beside them, in `.corpus/run/run.json` (`RunRecord`): a stamp of its own,
  which each `review.json` it writes carries too; the answers it read, the committed alone or with a
  model's cache, by the model's id; the model it asked, if any; whether it took every fetched
  document or some, and which; and whether it finished, written unfinished before the first
  document and finished after the last. The review's export and check read what the last run kept
  only when it finished, read the answers they read, the committed and the cache of the model
  `NAMING_MODEL` names, and stamped every document it took, and the check only when it took every
  fetched document; else each refuses, saying why in one line (`runMismatch`), so that neither mixes
  the results of runs of another mode or scope.

### The outcome

- `outcomeOf(assembled)`, in `corpus-run.ts`, gives the outcome, the editable rate and what the
  rate counts, `{ editable, all }`, and the runner reads the outcome nowhere else: each row keeps
  the counts (`counted`), and the summary, the headline, the table and the baseline add them up for
  the corpus's rate, the table naming the rule as the function's constant says it (`OUTCOME_RULE`),
  so that item 13 replaces the function's body with its report and nothing more. Until then: a
  **success** is an import assembled whose first check holds, not partial, and at least 90% of whose
  words are in editable fields, counted as decision 0026's table counts them, the words of editable
  fields over those and the locked parts' words; anything else assembled is **partial**; the rate is
  that share.
- A document the pipeline does not assemble is **refused**, with the refusal's reason, when a step
  after the parse refuses it: the Latin Modern swap, the request's builder for a page it cannot read
  (`unreadable`) or a request its contract refuses (`invalid`), the XeTeX rewrite or its check, or
  the validation; or it stopped: **no reference** (the intake or the reference compile refused it,
  the reason kept), **not parsed**, **not probed** (its body unmarked does not set its reference's
  glyphs), **no answer** for any macro its body calls, or **timed out or died**.

### What a run writes

- `--json` writes the day and the commit it ran at (`at`), the mode (the committed answers alone or
  with a model's cache, the model asked if any, every document or some), whether it finished
  (`complete`), the summary and a row per document, ids and counts only: the outcome
  and its refusal's reason; the editable rate; the words editable and locked by reason; the fields
  editable, raw, required and locked by reason; the sections mapped and locked; the controls proven
  and dropped; the redefinitions applied and dropped, counted; what `outcomeOf` counted; the
  harness's and the checks' own findings, by check; the kinds of unit that stop the compile; the
  naming step's macros, answered from the committed answers or the model's cache, refused there,
  missing, asked and stored, the calls and tokens, and whether the gate passes the request; the
  compiles of the probe and of the checks; and the milliseconds of each step, the reference, the
  Latin Modern swap, the parse, the probe, the naming, the fonts and the checks, and of the whole
  (`times`).
- It prints a line a document, then one table, per family and in all, and a headline: the documents,
  and those that timed out, which a machine's speed decides and which count in no share and no rate;
  the shares of the others that are a success, partial and refused or stopped, with where the
  stopped ones stopped; the editable rate over the documents assembled; and the locked words by
  reason. Everything goes through `printable`.
- `corpus compare <run.json> <run.json> [...]` compares each run's JSON with the next, every field
  but each row's `times` and the file's `at`, and prints each path that differs with its two values,
  which are counts and words of closed lists, exiting 1 when any does: item 17's bar, three runs in
  a row that agree, is checked with it.

### The baseline

- `apps/editor/corpus/baseline.json` holds the date, the commit, the documents, those that timed
  out, the successes and the two rates, in percent, of a `--committed-only` run over the whole
  corpus, the success rate of the documents that did not time out. It is committed as a placeholder,
  `"run": null`, which is no baseline yet: nothing is compared until the full run of this item's
  pull request writes it.
- Only a finished `--committed-only` run over every fetched document is held to it: it exits 1 when
  its success rate, a document that timed out counting in neither its rate nor the baseline's, falls
  more than one point under the baseline's, saying so in one line; a run with the cache, the model
  or a subset, or one a signal stopped, says it is not held to it. The editable rate is recorded
  beside, and not compared.
- A pull request raises it by hand when the rate rises. `--write-baseline` writes it from a
  `--committed-only` run over the whole corpus, with the day and the commit, and never over a
  baseline the run falls more than a point under: a person lowers a baseline by editing it in a
  pull request, where it is read (`nextBaseline`). It refuses a checkout that differs from its
  commit, a file git does not track among them, as an answer not yet committed under
  `corpus/answers/` is, which the run reads though the commit lacks it.
- `corpus run --write-baseline --from <run.json>` runs nothing, and writes the baseline from a run's
  JSON, as CI's run leaves it as an artifact, by the same rule, the summary counted again from its
  rows, the day and the commit its own: only a finished `--committed-only` run over the whole corpus
  that names its commit gives one (`baselineFromFile`).

### The workflow

`.github/workflows/corpus.yml`, still started by hand alone (decision 0035), runs `corpus run
--committed-only --json run.json` after the leak check: the table and its headline to the job's
summary, `run.json` as an artifact, whatever the step's end. Its time on the free runner is not yet
measured, about an hour the estimate with four children where a private repository's runner has two
cores and takes two: the step is given three hours and the job 230 minutes, and a step stopped short
still leaves its table and `run.json` for what it did. It holds no key, ever: the run reads the
committed answers alone.

### Templates

A template is found from the requests' keys, which leave the macros' names out (decision 0024), so
that a fork that renames a macro stays its template's: two documents are of one template when their
requests share at least two macro keys and at least half the keys of the one with fewer, and a
template is every document linked so, directly or through others (`templatesOf`). A fork that calls
a few of its template's macros is its template's; one key two templates happen to share, a bare
`\end{itemize}` closer's, links neither. Templates are ranked by the documents they cover, then by
their keys, then by their first document's id, whatever order the documents come in; each is named
by its rank and the family most of its documents are of, `01-jake`. A document whose request holds
no key, or that has no request, is of none.

### The review's export

- `corpus review export [--top <n>] [--out <dir>]`, 20 templates and `apps/editor/.review/`, which
  git ignores, reads what the last run kept of each document it took (`review.json`: its request as
  the gate is given it, whether the gate passes it, its macros' fates, and its text as the leak
  check reads it: the tree, the header's values, the stored texts, the sources, the page's strings
  and the placeholders' names), and the answers the cache serves now, committed first and then the
  model's `NAMING_MODEL` names.
- For each of the top templates, one folder: `requests/<id>.json`, the requests of the fewest of its
  documents that together hold every key its passing requests hold, the most first, each written as
  the gate passed it; `answers/<key>.json`, the answer the cache holds for each of its keys, as it
  holds it; and `template.json`: its documents' ids, outcomes, rates and the gate's word; how many
  requests are written and withheld, saying so where none is; and, for each key, by how many
  documents hold it, the macro named as a written request names it (a key only requests not written
  hold goes unnamed), the answer the cache holds, the fields a stored answer needs besides the
  answer (`filing`: the hash, the family and the dependencies its key is computed from), the probe's
  verdicts on its arguments, its fields editable, raw, required and locked by reason, the parts kept
  locked at its calls by reason and words, the findings on its fields by check, and in how many
  documents the cache's answer was refused for it; what no macro holds; the redefinitions applied
  and dropped by name; and the checks' own notes. `index.json` names the templates, the rule, and
  how many documents the run kept of those fetched.
- A locked part belongs to the innermost call, or environment, of a macro of the request whose span
  holds where the part starts (`macroAt`); a field and a finding on it to its slot's macro. Names
  are the request's throughout, so that a macro named after a word of the person's goes as its
  placeholder (decision 0033).
- **Nothing in the folder may hold a document's text.** Every file is checked with the leak detector
  (`findLeaks`) against every document of its template before it is written, the index against every
  document of every template it names (`leaksIn`). A request, as the gate checks one, must hold none
  of any of their text, so a request the gate withholds is never written, nor one that holds another
  document's words, and the fewest requests are found again without it. An answer, whose schema
  holds it to the contract's closed lists, keys and names, has its notes and its redefinitions'
  LaTeX read; a summary, every string and key but the export's own words (its fields, the closed
  lists its values come from, its sentences), its own values (ids, keys, numbers, folders, files)
  and the names the requests beside it hold; each read as the gate reads a call site's argument, the
  notes and the rest with every backslash and percent sign a space, so that no letter is taken for
  code, the LaTeX as source, and each must hold none of the documents' text but a single word the
  builder does not mask by, as the contract's own words, `education` as a role, are. Names of macros
  and definitions are code there, as the gate reads them in a request, by its own rule for names;
  and the export's own words are set aside because the detector finds a link's identifiers anywhere,
  even inside a word, so that a fork's link to its owner's `awesome-cv` repository would match the
  folder `02-awesome-cv`, which is no text of theirs. An answer that fails is left out; a template
  whose summary fails is left out whole, and the index says so.
- The export writes over `--out` only when it is empty, absent, or an earlier export's.

### The review's check

`corpus review check [--dir <dir>]` reads every reviewed answer under `corpus/answers/` that carries
redefinitions, finds from the last run's requests, which must be of every fetched document, every
document whose request holds one of their keys, assembles each of those again, in the pool, with the
committed answers and the model's cache, and gives each redefinition, by name, one of three verdicts
over those documents:

- **dropped** when one drops it, its page moved or no redefinition proven there (`unproven`), when
  the checks stop on one, when the validation refuses one for anything but a font the page cannot
  draw (the assembly, or its reading back, `keep`, which a reviewed answer may cause), or when one
  times out or dies;
- **kept** when none of those, and one or more apply it, its page kept by the first check and the
  checks run through;
- **unproven** when neither: no corpus document holds its keys, or none of those reaches the
  checks, the import refusing it before them (item 8's check of its fonts, say) or for a font.

A document refused before the checks, or for a font, or where the answer is not served for its
macro, neither keeps nor drops a redefinition; the child says which step refused a document beside
its rows. Each line names the redefinition, the macros whose answers carry it, the templates the
export in `--dir` (`.review/`) names for their keys, and the counts. It exits 1 when one is dropped
or unproven, when an answer file is none the cache would serve under its name (it does not
validate, or its dependencies do not give its key, as the committed answers' test holds them), so
that the review's pull request takes the dropped ones out and lists every other for a person to
read.

`apps/editor/corpus/REVIEW.md` says how part B runs, and holds the answer's contract, its fields and
their closed lists, which a test holds it to, so that the agent reads nothing but it and the export
folder. The agent files each answer it corrects as a stored answer whose `source` is where it came
from, as decision 0024 defines the field, `model:claude-opus-5-5` for the review model, with
`reviewed: true` and notes naming the review model and the naming model whose answer it corrects;
the committed answers' test takes a reviewed answer whose source is the seed or a model. A macro
only withheld requests hold, which the export names no more than by its key, it leaves alone.

## The sample

The twenty documents of the implementers' sample (six `jake`, four `awesome-cv`, three `altacv`,
three `moderncv`, one `europecv` and three `other`), `corpus run --ids <sample> --committed-only`,
on the M4 Pro beside other work, three times in a row: `corpus compare` finds the three runs'
JSON the same, times aside. Each took 15.2 minutes, 900 s of them one AltaCV fork, `altacv-0001`,
whose body never ends at the font size control's 9 points (decision 0026) and times out every
time; the other nineteen took 11 to 23 s each at the median, from being sent to their child, as
the machine's other work allowed.

| | Documents |
|---|--:|
| Success | 0 |
| Partial | 13 |
| Refused: `difference`, two Awesome-CV forks whose fonts by file set their glyphs otherwise (decision 0023) | 2 |
| No answer for any macro the body calls: `europecv-0002` and three of `other` | 4 |
| Timed out | 1 |

13 documents assembled, 12 of them their first check holding and one partial for a position;
9.8% of their 8,749 words are in editable fields, and the locked words are `unmapped` 7,630,
`moved` 126, `shape` 124, `date` 8 and `text` 6. The committed answers, the seed alone, answer 71
of the 216 macros with keys the sample's requests hold, counted a document at a time; 145 have none,
and the privacy gate withholds one request, `jake-0021`'s. So the sample's success rate is 0% until
the naming model's answers and the review's are in: what is locked is what no answer places, as
decision 0026 found.

The child that `corpus assemble` ran before, at `309ebd7`, which built its requests without the
page, gives four of the documents, `awesome-cv-0003`, `jake-0007`, `moderncv-0001` and
`altacv-0015`, the same answers, words and fields as this one.

`corpus review export` over what the runs kept, in two seconds: the 19 documents with a request make
nine templates, `01-jake` (all six `jake` documents, 29 keys), `02-awesome-cv` (three forks, 26
keys), `03-moderncv` (all three), `04-europecv`, two AltaCV forks apart, whose own macros outnumber
the seed's keys they share, an Awesome-CV fork apart for the same, and two of `other`; 66 files,
every request, answer and summary passing the leak check against its template's documents, and
`jake-0021`'s request, which the gate withholds, not written, its template's summary saying so.
`corpus review check` over the same, which assembles again the four documents that hold the keys of
the seed's seventeen answers with redefinitions, in 72 s: of eight redefinitions it kept
Awesome-CV's `cvskills`, applied where it reaches the checks, called six more unproven, no sample
document that holds their keys reaching the checks, which first read as kept and now exit 1, and
drops AltaCV's `\cvtag`, which moves `altacv-0015`'s page, as decision 0026 found it moving AltaCV
forks' pages; and it exits 1, too, for the run's covering 20 of the 220 documents.

## Consequences

- **What stays open.** Item 13's report replaces `outcomeOf`'s body, its rate the reference's
  glyphs', where this record counts the assembly's words in the source; the baseline is written from
  the orchestrator's full `--committed-only` run over the corpus, before this item's pull request
  merges; and part B, the review, waits for item 18's model and its cache.
- `corpus assemble` and `corpus oracle` build their requests with the page now, as the import does,
  so their numbers may move where a page's strings mask a document's own definition that the
  document's values did not.
- The seed's own redefinitions face the check too, as reviewed answers' (decision 0037): AltaCV's
  `\cvevent` and `\cvtag`, which move some forks' pages (decision 0026), are dropped by it unless
  they keep every page that reaches the checks, and one no corpus document applies is unproven,
  which the review's pull request lists for a person to keep or take out.
- The check reads which documents hold a key from the last run; a reviewed answer that changes what
  the header's values are can change a document's keys, which the next run finds.
- The export's check leans to leaving out: an answer's notes or a summary's value that a document's
  text matches is not written, whether or not it is that text, and a template whose documents' own
  macros outnumber the keys they share with its other forks, as two of the sample's AltaCV forks',
  is a template of its own, reviewed apart.
- `.corpus/run/` keeps each document's text a second time, beside `.corpus/<id>/`, where
  `.corpus/assemble/` and `.corpus/probe/` keep theirs; it is ignored, and never leaves the machine.
