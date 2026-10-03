# 0037. Opus reviews the top templates' answers

Date: 2026-09-30 · Status: accepted; amends 0024; superseded by 0049: the naming step leaves the import, and the reviewed answers go with it

## Context

Plan section 10 and milestone 3's item 17 ask for the naming answers of the twenty most common
templates to be reviewed, corrected where the naming model got them wrong, and marked reviewed. A
reviewed answer is served before any model's, is never filed over, seeds the naming service's
cache for good in milestone 5, and may carry redefinitions: LaTeX that rewrites a template's
command so the editor can mark its fields, which then runs in every document whose command has
that key. Decision 0024 lets only a person write a reviewed answer and its redefinitions, on the
ground that code a model wrote should not run in users' documents. Nobody will review by hand;
the review goes to Opus, a stronger model than the naming step's.

## Decision

- An Opus agent in a Claude Code session writes the reviewed answers, with no API key. The corpus
  runner writes, for each of the top twenty templates, its masked naming request, the answers the
  naming model gave and the four checks' findings, to a folder git ignores; the agent reads only
  that folder, never `.corpus/` and never a document's text, and writes corrected answers under
  `corpus/answers/`, `reviewed: true`, its notes naming the model that wrote them.
- A reviewed answer's redefinitions, which the naming model still may not give, are kept only when
  item 7's reference compile shows the page unchanged and the four checks pass, on every corpus
  document whose command has the redefined key. One that fails is dropped, and its command stays
  locked where it cannot be marked otherwise.
- The pull request that commits reviewed answers lists every redefinition, by template and
  command, so that a person can read them, though none is required to.

## Consequences

- Decision 0024's rule becomes: the naming model never writes LaTeX; a reviewed answer's LaTeX is
  written by a person or by the review model, and is proven on the corpus before it is kept.
- The trust a reviewed answer carries, served first and never overwritten, now rests on the review
  model and the checks instead of a person. A wrong reviewed answer is found by the corpus run's
  numbers or by a user's report, and is removed by deleting its file (and, after milestone 5, its
  KV entry).
- What the review model sees is what the naming model sees, plus answers and findings: the privacy
  rule of decision 0033 holds, since the masked request is the same one the leak check proves.
- Plan section 10's risk line, "human review of the top twenty templates" (docs/editor-plan.md),
  now means this review; the shared plan page is the owner's to update.
