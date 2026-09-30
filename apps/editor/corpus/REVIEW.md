# Reviewing the top templates' answers

Milestone 3 item 17 has the naming answers of the corpus's twenty most common templates reviewed,
corrected where the naming model got them wrong, and committed here under `answers/`, by an Opus
agent in Claude Code rather than a person (decisions 0037 and 0043). It runs once item 18 has picked
the naming model and filled its cache. This is how.

## Before the review, in a shell

1. Fill the naming model's cache under `.corpus/cache/<id>/`, which item 18's benchmark of the
   model does, and `corpus name --model` or `corpus run --allow-model` completes, with the key in
   your shell and never in CI: `SOCLAAS_API_KEY=… NAMING_MODEL=<id> pnpm --filter
   @resume-tools/editor corpus run --allow-model`. Either asks the model only for what the cache
   misses, behind the privacy gate.
2. Run the whole import over the corpus with that cache, `NAMING_MODEL` set as before:
   `pnpm --filter @resume-tools/editor corpus run`. It keeps, for each document, its naming request
   and what the checks found under `.corpus/run/`.
3. Export the top templates: `pnpm --filter @resume-tools/editor corpus review export`. It writes
   `apps/editor/.review/`, which git ignores: `index.json`, the templates by rank, and a folder for
   each, `01-jake` and on, holding
   - `template.json`: its documents and what became of them; its macros, each by its key, named as
     a written request names it, with how many documents hold it, the answer the cache holds, the
     fields a stored answer needs besides the answer (`filing`: its hash, family and dependencies),
     the probe's verdicts on its arguments, its fields editable, raw, required and locked by reason,
     the parts kept locked at its calls and the findings on its fields; what no macro holds; and
     the redefinitions its documents applied and dropped;
   - `requests/<id>.json`: the naming requests of the fewest of its documents that together hold
     every key its passing requests hold, each exactly as the privacy gate passed it, which is what
     the naming model is sent; a request the gate withholds is never written, and `template.json`
     says how many were withheld, and names no macro only such a request holds;
   - `answers/<key>.json`: the answer the cache serves now for each of its keys, committed or the
     model's, as the cache holds it.

   Every file is checked with the leak detector against every document of its template before it
   is written, so the folder holds no document's text: template code with placeholders, names of
   macros, closed lists and counts.

## The review, by the agent

Start a Claude Code session with Opus in the repository, and point it at this file. It reads
`apps/editor/.review/`, this file, decisions 0024, 0026 and 0037, and the answer's schema in
`packages/naming/src/answer.ts`, and nothing else of the corpus (below). For each template, in rank
order, and each macro by how many documents hold it, most first:

- It decides whether the answer is right, as decision 0024 defines one: the macro's kind; each
  argument's meaning, slot, parts and blank; whether it repeats or is left off when blank; the list
  it opens or closes, and its partner; the section role; a contact's field or a link's kind; and any
  variant by role. `template.json` says what the checks made of the answer: an argument locked
  `unmapped` has no slot, one locked `shape`, `date` or `differs` has one the template sets
  otherwise, and a finding names the check.
- It writes each answer it corrects, and one for a macro that has none, as
  `apps/editor/corpus/answers/<key>.json`: the stored answer, with `reviewed: true` and
  `"source": "seed"`, since every committed answer is the seed; the answer itself with
  `"reviewed": true` and `notes` naming the review model and the naming model whose answer it
  corrects, as "Reviewed by Claude Opus from qwen3.8:27b's answer (decision 0037)"; the key, kind
  and name, and `hash`, `family` and `dependencies` as `answers/<key>.json` or `filing` gives them;
  and, for a list, `partnerKeys` with the keys `template.json` gives the partner macros.
- It adds a redefinition, `{ "name": ..., "latex": ... }` in the answer's `redefinitions`, only
  where a macro defeats the editor's markers, as the launch templates' ports show (decision 0024's
  table), and only LaTeX that keeps the template's output as it is. The naming model never writes
  one.
- It runs `pnpm format`, which formats the files as the committed answers are.

## After the review

- `pnpm --filter @resume-tools/editor corpus review check` assembles again every corpus document
  whose request holds the key of a reviewed answer that carries redefinitions, and says of each
  redefinition whether it is kept, unproven or dropped, and why. A redefinition is kept only when a
  document applies it and every such document that reaches the checks applies it, its page
  unchanged, and runs the checks through; it is unproven when no corpus document applies it. Take
  each dropped one out of its answers, and run the check again until it exits 0, or exits 1 for
  unproven ones alone, which the pull request lists for a person to keep or take out.
- `pnpm --filter @resume-tools/editor test scripts/corpus-seed.test.ts` checks that every committed
  answer validates, is served under the key its file is named by, is formatted as `corpus seed
  --write` writes it, and pairs each list's opener with its closer.
- The pull request lists every redefinition, kept or dropped, by template and macro, so that a
  person can read them.
- `pnpm --filter @resume-tools/editor corpus run --committed-only --write-baseline` over the whole
  corpus, on the committed branch, raises `corpus/baseline.json` when the success rate rises.

## What the agent never reads

- `apps/editor/.corpus/`: the documents, the fetch's report, what the runners keep of each
  document, which holds its text, and the model's cache. What it needs of them is in the export.
- `corpus/manifest.json`, whose paths can carry a person's name, and the corpus's repositories on
  GitHub.
- `.env` files, and any key.
