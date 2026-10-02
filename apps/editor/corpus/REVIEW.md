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
2. Run the whole import over the whole corpus with that cache, `NAMING_MODEL` set as before, and
   neither `--committed-only` nor `--only`: `pnpm --filter @resume-tools/editor corpus run`. The
   export and the check read what this run kept, and refuse a run of another mode or model, one
   that did not finish, and, for the check, one over some documents alone.
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
     says how many were withheld;
   - `answers/<key>.json`: the answer the cache serves now for each of its keys, committed or the
     model's, as the cache holds it.

   Every file is checked with the leak detector against every document of its template before it
   is written, so the folder holds no document's text: template code with placeholders, names of
   macros, closed lists and counts.

## The review, by the agent

Start a Claude Code session on Claude Opus 5.5 in the repository, and point it at this file. It
reads this file and `apps/editor/.review/`, and nothing else (below). For each template, in rank
order, and each macro by how many documents hold it, most first:

- It decides whether the macro's answer is right, by the contract below, reading the macro in the
  requests (its definition, the definitions it hands its work to, its signature, the probe's
  verdicts and its masked calls) and what the checks made of the answer in `template.json`: an
  argument locked `unmapped` has no slot, one locked `shape`, `date` or `differs` has one the
  template sets otherwise, and a finding names the check.
- A macro whose `name` is `null` has no `filing` either: only requests the gate withheld hold it,
  and the export shows nothing of it to review. It leaves that macro alone and writes no answer for
  it.
- A macro whose `answer` is `withheld` has an answer the cache serves, often a committed one, that
  the export did not write because the leak check found a document's text in it. It leaves that
  macro alone too: an answer written for it would be filed over the one the cache serves.
- It writes each answer it corrects, and one for a macro that has none, as
  `apps/editor/corpus/answers/<key>.json`, a stored answer: `"version": 1`, the `key`, `hash`, `of`
  and `name`, the `family` where `filing` gives one, and the `dependencies`, as `answers/<key>.json`
  or `filing` gives them; `"reviewed": true`; `"source": "model:claude-opus-5-5"`, the review
  model's id; the answer itself, with `"reviewed": true` and `notes` naming the review model and
  the naming model whose answer it corrects, as "Reviewed by Claude Opus 5.5 (claude-opus-5-5) from
  qwen3.8:27b's answer, decision 0037"; and, for a list, `partnerKeys` with the keys `template.json`
  gives the partner macros. An answer that opens a list is committed with its closer's, each naming
  the other, since the committed answers' test pairs them.
- It adds a redefinition, `{ "name": ..., "latex": ... }` in the answer's `redefinitions`, only
  where a macro defeats the editor's markers, as a port of a launch template patches its class, and
  only LaTeX that keeps the template's output as it is. The naming model never writes one.
- It runs `pnpm format`, which formats the files as the committed answers are.

## The answer

An answer says what a macro sets, in words of closed lists alone, and never holds a resume's text:

- `kind`: `entry`, `section`, `bullet` (an entry's bullet, or a list section's item), `bulletList`,
  `header`, `contact`, `link`, `labelledItem`, `paragraph`, `layout` (sets none of the resume's
  text) or `other` (the editor has no place for it, and keeps it as the upload has it).
- `arguments`: each by its `index`, from 1 in the signature's order, a star counting, once each:
  - `meaning`: `title`, `subtitle`, `place`, `dates`, `text`, `label`, `address`, `icon`,
    `colour`, `length`, `key` or `other`;
  - `slot`, the one it fills, of its kind's, each filled once: an `entry`'s `title`, `subtitle`,
    `place`, `dates` or `bullets`; a `section`'s `title`, `entries`, `items` or `text`; a `bullet`'s
    `text`; a `bulletList`'s `bullets`; the `header`'s `first`, `last`, `headline`, `email`,
    `phone`, `location`, `links` or `contacts`; a `contact`'s `text` or `href`; a `link`'s `label`
    or `href`; a `labelledItem`'s `label` or `text`; a `paragraph`'s `text`; `layout` and `other`
    have none;
  - `parts`, where the argument holds more than one paragraph, each with its `meaning` and `slot`,
    as Jake's projects heading holds a title and a subtitle either side of `$|$`;
  - `blank`, what it is in a unit the user adds: `empty`, `absent` (an optional argument left out)
    or `kept` (as the document's first call gives it: an icon, a length, a key).
- `repeatable`: whether the user may add and remove the unit; `omitWhenBlank`: whether a blank unit
  is left off the page.
- `list`, for a macro that opens or closes one: `does`, `opens` or `closes`; for an opener, the
  macro that closes it (`closedBy`, which a command must name) and what the list `holds`: `entry`,
  `bullet`, `labelledItem`, `contact`, `link` or `section`; for a closer, the macro that opened it
  (`openedBy`) and nothing else. A closer is of its opener's kind.
- `role`, the section role its meaning implies: `summary`, `experience`, `education`, `projects`,
  `skills`, `awards`, `publications`, `languages` or `other`.
- `contact`, for a contact, the header's field it sets: `email`, `phone` or `location`; `link`, for
  a link, its kind: `website`, `linkedin`, `github`, `twitter`, `orcid` or `other`.
- `variants`: another mapping of the arguments in the sections of one role, each with its `role` and
  its `arguments`, as Jake's Resume swaps an entry's dates and place in its education section.

## After the review

- `pnpm --filter @resume-tools/editor corpus review check` assembles again every corpus document
  whose request holds the key of a reviewed answer that carries redefinitions, and says of each
  redefinition whether it is kept, unproven or dropped, and why. A redefinition is kept only when a
  document applies it and every such document that reaches the checks applies it, its page
  unchanged, and runs the checks through; it is unproven when no corpus document applies it. Take
  each dropped one out of its answers, and run the check again until it exits 0, or exits 1 for
  unproven ones alone, which the pull request lists for a person to keep or take out.
- `pnpm --filter @resume-tools/editor test scripts/corpus-seed.test.ts` checks that every committed
  answer validates, is reviewed, is served under the key its file is named by, is formatted as
  `corpus seed --write` writes it, and pairs each list's opener with its closer.
- The pull request lists every redefinition, kept, unproven or dropped, by template and macro, so
  that a person can read them.
- `pnpm --filter @resume-tools/editor corpus run --committed-only --write-baseline` over the whole
  corpus, on the committed branch, raises `corpus/baseline.json` when the success rate rises.

## What the agent never reads

Anything but this file and `apps/editor/.review/`, above all:

- `apps/editor/.corpus/`: the documents, the fetch's report, what the runners keep of each
  document, which holds its text, and the model's cache. What it needs of them is in the export.
- `corpus/manifest.json`, whose paths can carry a person's name, and the corpus's repositories on
  GitHub.
- `.env` files, and any key.
