# 0044. The naming model, chosen by a benchmark

Date: 2026-10-01 · Status: proposed; amends 0036

## Context

Milestone 3 item 18. Decision 0036 put the naming step on SoCLaaS, the School of Computing's
OpenAI-compatible gateway, with `qwen3.8:27b` the default until this item benchmarked three of its
models over the corpus and picked the default by the milestone's rule: the highest editable rate
whose slowest part stays within the naming service's two minutes (decision 0028). The gateway bills
nothing, so the answers' quality and their speed are all that tell the candidates apart. The code
is `apps/editor/scripts/corpus-bench.ts` and `corpus.ts`'s `bench`, with the runner's child
(`corpus-assemble-child.ts`), its cache (`answer-cache.ts`), its naming step (`corpus-name.ts`) and
the package's model step (`packages/naming/src/model.ts`).

## Decision

### The benchmark

- `corpus bench --model <id> [--only <id>] [--ids <file>] [--json <file>]` is `corpus run`'s
  pipeline, in its child (decision 0043), with the naming step answered from the model's own
  answers alone. The child's cache leaves the committed answers out (`FileAnswerCache`'s `own`), so
  the seed's reviewed answers, and every other model's folder, answer nothing: the model is asked
  for every macro its own folder, `.corpus/cache/<id>/`, does not answer, and its answers are filed
  there as the run files them, a key once, never over the folder's own. The committed folder is
  never written, and a run that reads both still serves the committed answer first. Later
  documents of a template hit what earlier ones filed, as an import's cache would; a second run of
  the same model answers from the folder, asks nothing, and says so.
- Every request leaves as the run's does: the request the browser sends (`importRequest`, decision
  0038), refused when the import's privacy check finds the resume's text in it, then the stricter
  check `run --allow-model` asks behind, the header's values given to it besides, found by the
  run's answers, the committed first, whatever the benchmark answers from, so that the gate is the
  run's; and `checkRequest`. Nothing per document is kept: the benchmark writes no assembly, and
  never touches `.corpus/run/`, which the review reads.
- It stops, its table partial and the run exiting 1, once the gateway has failed three documents
  in a row with a 429, a 5xx or another failure of the call, a wrong key's 401 among them; a part
  that runs out of its time, or an answer that does not validate, measures the model and stops
  nothing. A 429 that persists is the key's daily budget, which resets at 00:00 UTC, and the same
  command then asks only what the folder lacks.
- Per candidate it reports, in its table and its lines, and with `--json` in its file, ids and
  counts only (`benchSummary`): the documents success, partial, refused, with no answer, stopped
  before the naming step, and timed out or died, as `outcomeOf` gives them (decision 0043); the
  editable rate and the words locked by reason, as the run's summary counts them; the macros with a
  key, answered from the folder, asked, stored, invalid and missing, the requests the stricter check
  withheld and the imports that asked; each part's time, its median, its 90th percentile by the
  nearest rank and its slowest, with the slowest part's document and number; a request's parts
  together, the median and the slowest, since the service gives its two minutes to a request's parts
  together; the calls, the tokens in and out and, of those out, the reasoning as the gateway counts
  it; the failures by kind (`failureKind`: `timeout`, `429`, `5xx`, `invalid` after its retry,
  `refused`, `cut off` at the output's limit, and any other failure of the call, `provider`); and the
  cost at `LIST_PRICES`, in all and per import that asked, which the gateway never bills: its
  reference prices count only toward a key's limits.
- A part's time runs from the part's start, the step's or the previous part's filing, to its answer
  or its failure: its call, the AI SDK's retries (`MODEL_RETRIES`, four, past the gateway's rate)
  and the answer's own retry when it does not validate. The child keeps them in the row's
  `times.parts`, which `corpus compare` sets aside with the other times, and the failure's kind,
  message and part in `naming.failure`. The package's `NamingUsage` gains `reasoning`, the output
  tokens the provider counts as the model's reasoning, where it counts them, and `STOPPED`, what a
  part stopped at its limit says.
- `corpus bench <bench.json> [<bench.json>...]` runs nothing: it sets the candidates' files side by
  side, one column a model, each summarised again from its rows, and names the model the rule
  picks. Files of one model, in the order they ran, make one column, each document's row the last
  that asked the model: the sample's run and the whole corpus's, or a run the key's budget stopped
  and the next day's.

### The rule

`chooseDefault`: of the candidates whose slowest part stays within 120 s, the service's limit
(`PART_LIMIT_MS`, which a test holds to the service's `LIMITS.modelMs`), the highest editable
rate, as the run's summary gives it, in percent to two decimals; on a tie, the faster, by the
median part, then the 90th percentile, then the slowest part, then the id, so that the order the
candidates come in decides nothing. A candidate that asked no part has no time to judge and is not
chosen.

### The runs

Not yet run. A call with a wrong key on one document failed at once with the gateway's 401 at
02:19 UTC on 2026-10-01, and nothing of the key was in what the bench printed. Then every call
with the key failed with 503, Service Unavailable, after the runner's retries: the sample's first
three documents for `qwen3.8:27b` at 02:21 and again at 02:45, for `qwen3.6:35b` at 02:24, and for
`qwen3-coder-next` at 02:48, each run stopped by the rule above after three documents, with nothing
filed. The table, the choice and what the reasoning model's time did wait for the gateway.

## Consequences

Pending the runs. The default stays `qwen3.8:27b` (decision 0036) until they pick.
