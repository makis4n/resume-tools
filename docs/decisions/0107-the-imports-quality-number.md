# 0107. The import's quality number

Date: 2026-10-21 · Status: proposed, with the plan for milestone 5 (docs/milestone-5.md)

## Context

The plan asks for "the corpus number published internally as the import quality metric", and its
section 5.7 says "the fraction of them that import fully editable is the number the whole import
effort is measured by". The corpus run already computes that fraction as its success rate and
guards it against a baseline (decision 0043), but writes it only to its summary and artifacts,
among several other numbers, and no record says which of them is the metric.

## Decision

- **The import's quality number is the corpus run's success rate**: of the corpus's resumes, less
  any the run timed out on, the share that import as an outline whose page matches the original's
  glyph stream with at least 90% of body words editable in place (section 6.2; `importSummary` in
  `apps/editor/scripts/corpus-import.ts`). On 8 October 2026 at c526f08 it was 77 of 220, 35%.
- **Its companion** is the share of body words editable in place over the resumes that import,
  89.66% on that day. It is reported beside the number and never replaces it.
- **It is not the count "at the bar"** that the plan's section 4.3 quotes, the imported resumes
  with at least 90% of their words in place, 83 in the same run (decision 0082): a success also
  asks that the page match.
- **Published** in `docs/import-quality.md`: the definition in plain words, then a table with one
  row for each adopted baseline (date, commit, documents, successes, the success rate, the words'
  share, and, where its run reported them, resumes under 50% and words kept as `moved`), starting
  from the baselines in the history of `apps/editor/corpus/baseline.json`. The pull request that
  adopts a baseline adds its row, and the run's summary opens with the number.
- **Internally** means the repository, which is private, and the status page when the owner
  updates it. The number is not shown on the editor's site.
- **Guarded as now**: a run fails when the success rate falls more than a point under the
  baseline (decision 0043).

## Consequences

- There is one number to quote, defined once. A change that lifts the words' share and not the
  success rate shows as exactly that.
- The page is as fresh as the last adopted baseline, and a run is still started by hand (decision
  0035).
- The page holds counts alone, never a document's text or name, as the run's summary does.
