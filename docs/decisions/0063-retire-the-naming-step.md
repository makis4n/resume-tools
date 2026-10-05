# 0063. Retire the naming step

Date: 2026-10-05 · Status: accepted; carries out 0049's "the naming step is deleted, not kept
unused"; supersedes what 0049 left of 0024, 0027, 0036, 0037, 0044's choice for naming, and
0033's gate and leak check; marks what it deletes in 0026, 0028, 0035, 0038, 0039, 0040 and 0043, and amends 0056's KV namespace

## Context

Decision 0049 took the naming step out of a `.tex` import and said it would be deleted, not kept
asleep, once the outline's numbers beat the first pass's (item 9) and the PDF reading had landed
(item 13). Both are merged. Until now the naming step's code stayed in the repository unused: the
naming package's contract, the import's request and privacy gate, the service's `/v1/name` route,
209 committed answers, and six corpus commands. Only the signatures step still read one function of
it, the masking of a definition. Item 17 of docs/milestone-3-overhaul.md deletes it.

## Decision

### What goes

- From `packages/naming`: the request and the answer as schemas, the cache and its key, the masking
  of a request, the prompt, the model step (`name`), and the invented fixtures, with their tests.
- From the editor's import: the request's builder and its privacy gate (`naming.ts`), the client
  of the service (`service.ts`), the cache keys (`keys.ts`), and the first pass's assembly and
  checks (`assemble.ts`, `validate.ts`), which only the naming tooling still ran. The types the
  outline's checks fill and the report reads (`LockReason`, `LockedPart`, `GlyphOwner`,
  `AssemblyChecks` and theirs) move to `report.ts` unchanged.
- From the service: the `/v1/name` route (`src/service/name.ts`, `functions/v1/name.ts`, the dev
  server's `serve-naming.ts`), its answer and preamble caches in KV with the writes that filed
  them there, and its reply's schema.
- The committed answers under `apps/editor/corpus/answers/` (209 files) and the review's notes.
- The corpus commands `name`, `seed`, `assemble`, `leak`, `review` and `bench`, their children and
  tests, the answer cache on disk (`answer-cache.ts`), the first pass's run's rows and table, and
  the key comparison of `corpus parse`. `corpus oracle` probes the samples and compares the
  verdicts, as it did before it assembled them.
- The two refusals only the naming request gave, `unreadable` and `request`, and the report's note
  for a template no answer came for.
- The corpus workflow's leak step: it runs the survey, which reads no request, and `corpus run`.

### What stays, and why

- The model's provider code, `packages/naming/src/providers.ts`: the route that labels a PDF's
  lines makes its model with it (decision 0056), and `pdf-model` too. The package keeps its name,
  `@resume-tools/naming`, with one export path, `./providers`: renaming it would change every
  import of it and the lockfile's entries for nothing a person sees.
- The service's shell: the label route, `serve-fetch.ts`, the rate limit (`rate.ts`) and its KV
  store (`KvRateStore`), and the key's handling in `config.ts`.
- The masking of a definition, moved into the signatures step (`masked` in `signatures.ts`), with
  its tests: a definition's text and hash read as they did, so the outline does not change.
- The history: the superseded records keep their bodies, with a line at the top that points here,
  and docs/milestone-3.md stays as the first pass's plan.

### The KV namespace

The label route's namespace is renamed from `NAMING_KV` to `LABEL_KV`. Nothing has been deployed:
there is no `wrangler.toml`, and the Pages project and its bindings are milestone 5's, so the
rename is the function's `Env`, its README and the build's test, and no deploy-side change. Its
keys keep their `label-rate:` prefix.

### Dependencies

`@resume-tools/resume-model` is removed from `packages/naming`'s dependencies: only the deleted
masking used it. `zod` stays there as the peer the AI SDK's packages resolve. Nothing is added or
moved.

## Consequences

- About 38,000 lines of code and tests and 8,800 lines of answers leave the repository. A `.tex`
  import sends nothing and loads nothing of the provider code, which the no-network test and the
  samples' test now hold by refusing to load it.
- Anything that needs a template's commands to have meaning, such as switching an import to
  another template, would be rebuilt from the history (decision 0049).
- A first pass's run file, version 1, can no longer be summed: `corpus run --write-baseline --from`
  refuses it in plain words, as it did.
