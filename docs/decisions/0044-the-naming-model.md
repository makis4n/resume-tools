# 0044. The naming model, chosen by a benchmark

Date: 2026-10-01 · Status: proposed; amends 0036

## Context

Milestone 3 item 18. Decision 0036 put the naming step on SoCLaaS, the School of Computing's
OpenAI-compatible gateway, with `qwen3.8:27b` the default until this item benchmarked three of its
models over the corpus and picked the default by the milestone's rule: the highest editable rate
whose slowest part stays within the naming service's two minutes (decision 0028). The gateway bills
nothing, so the answers' quality and their speed are all that tell the candidates apart. The
editable rate is the corpus run's (decision 0043), which item 13's report now gives (decision
0039): the words editable in place on the reference's page, over the resume's words. The code is
`apps/editor/scripts/corpus-bench.ts` and `corpus.ts`'s `bench`, with the runner's child
(`corpus-assemble-child.ts`), its pool (`corpus-reference.ts`), its cache (`answer-cache.ts`), its
naming step (`corpus-name.ts`), and the package's model step and providers
(`packages/naming/src/model.ts`, `providers.ts`).

## Decision

### The benchmark

- `corpus bench --model <id> [--only <id>] [--ids <file>] [--json <file>] [--thinking <switch>]
  [--retries <n>]` is `corpus run`'s pipeline, in its child, with the naming step answered from the
  model's own answers alone. The child's cache leaves the committed answers out (`FileAnswerCache`'s
  `own`), so the seed's reviewed answers, and every other model's folder, answer nothing: the model
  is asked for every macro its own folder, `.corpus/cache/<id>/`, does not answer, and its answers
  are filed there as the run files them, a key once, never over the folder's own. The committed
  folder is never written, and a run that reads both still serves the committed answer first.
  Later documents of a template hit what earlier ones filed, as an import's cache would; a second
  run of the same model answers from the folder, asks nothing, and says so.
- Every request leaves as the run's does: the request the browser sends (`importRequest`, decision
  0038), refused when the import's privacy check finds the resume's text in it, then the stricter
  check `run --allow-model` asks behind, the header's values given to it besides, found by the run's
  answers, the committed first, whatever the benchmark answers from, so that the gate is the run's;
  and `checkRequest`. Nothing per document is kept: the benchmark writes no assembly and never
  touches `.corpus/run/`, which the review reads.
- It stops, its table partial and the run exiting 1, once the gateway has failed three documents in
  a row with a 429, a 5xx or another failure of the call, a wrong key's 401 among them; a part that
  runs out of its time, or an answer that does not validate, measures the model and stops nothing.
  A 429 that persists is the key's daily budget, which resets at 00:00 UTC, and the same command
  then asks only what the folder lacks.
- Per candidate it reports, in its table and its lines, and with `--json` in its file, ids and
  counts only (`benchSummary`): the documents success, partial, refused, with no answer, stopped
  before the naming step, and timed out or died, as `outcomeOf` gives them; the editable rate and
  the words locked by reason, as the run's summary counts them; the macros with a key, answered from
  the folder, asked, stored, invalid and missing, the requests the stricter check withheld and the
  imports that asked; each part's time, its median, its 90th percentile by the nearest rank and its
  slowest, with the slowest part's document and number; a request's parts together, the median and
  the slowest, since the service gives its two minutes to a request's parts together; the calls,
  the tokens in and out and, of those out, the reasoning as the gateway counts it; the failures by
  kind (`failureKind`: `timeout`, `429`, `5xx`, `invalid` after its retry, `refused`, `cut off` at
  the output's limit, and any other failure of the call, `provider`); and the cost at `LIST_PRICES`,
  in all and per import that asked, which the gateway never bills: its reference prices count only
  toward a key's limits.
- A part's time runs from the part's start, the step's or the previous part's filing, to its answer
  or its failure: its call, the AI SDK's retries (`MODEL_RETRIES`, four, past the gateway's rate,
  or `--retries`) and the answer's own retry when it does not validate. The child keeps them in the
  row's `times.parts`, which `corpus compare` sets aside with the other times, and the failure's
  kind, message and part in `naming.failure`; and it says its naming step to the parent as soon as
  the step ends (the pool's `onMessage`), so that a document whose checks outrun the pool's limit,
  as `altacv-0001`'s do, keeps its parts' times. The package's `NamingUsage` gains `reasoning`, the
  output tokens the provider counts as the model's reasoning, where it counts them, and `STOPPED`,
  what a part stopped at its limit says.
- `--thinking <switch>` asks the model not to reason first (`withoutThinking` in
  `packages/naming/src/providers.ts`, a model middleware of the AI SDK's, so that `name`, the gate,
  the prompt's content and the answer's schema stay as they are): `no-think` adds a `/no_think` line
  after the instructions; `template` sends `chat_template_kwargs: { enable_thinking: false }` under
  the provider's options, which the AI SDK's OpenAI-compatible provider passes into the request's
  body; `effort` sends a reasoning effort of none; `on` lets the model reason. Unless given, the
  model is asked as the naming step asks it everywhere (`MODEL_THINKING`, below). A variant's
  answers go in its model's folder, and its column is its own.
- `corpus bench <bench.json> [<bench.json>...]` runs nothing: it sets the candidates' files side by
  side, one column a model and thinking switch, each summarised again from its rows, and names the
  model the rule picks. Files of one column, in the order they ran, are joined, each document's row
  the last that asked the model: a probe's, the sample's and the whole corpus's, or a run the key's
  budget stopped and the next day's.

### The rule

`chooseDefault`: of the candidates whose slowest part stays within 120 s, the service's limit
(`PART_LIMIT_MS`, which a test holds to the service's `LIMITS.modelMs`), the highest editable
rate, as the run's summary gives it, in percent to two decimals; on a tie, the faster, by the
median part, then the 90th percentile, then the slowest part, then the name, so that the order the
candidates come in decides nothing. A candidate that asked no part has no time to judge and is not
chosen.

### The runs, on 2026-10-01

- A call with a wrong key on one document failed at once with the gateway's 401, at 02:19 UTC, and
  nothing of the key was in what the bench printed.
- From 02:21 to 02:48 UTC every call with the key failed with 503, Service Unavailable: the sample's
  first three documents for each of the three candidates, each run stopped by the rule above, with
  nothing filed. The gateway's own authentication backend was down: its catalog, `GET /v1/models`,
  answered 503 too, "API key authentication failed". It answered again before 05:20.
- Main then gave the run item 13's report (decision 0039): the outcome and the editable rate below
  are the report's.
- `qwen3.8:27b`, as 0036 left it, reasoning before it answers, over the 20-document sample with
  four requests in flight: every one of the 12 parts asked (7 to 21 macros) was stopped at the
  runner's 300 s with no answer, and the run was stopped there, 13 documents in.
- One timed call to `qwen3.6:35b`, which does not reason, of the same 11-macro request
  (`jake-0001`), with no retry of a failed call: 24.4 s, 11,800 tokens in and 2,917 out, every macro
  stored, in two calls, its first answer not validating. The gateway was answering; the 27B's time
  was its own.
- The 27B with its thinking off, on the same request: `--thinking no-think` was stopped at 300 s as
  before; `--thinking template` answered in 50.6 s, two calls, no reasoning counted, its answer not
  validating after its retry. `effort` was not tried. The template's switch is how the 27B is
  measured without reasoning below, `qwen3.8:27b` with thinking off (`template`).
- Over the sample, the 27B with thinking off and `qwen3.6:35b` (whose run a stalled session's
  signal stopped after its twenty documents had ended):

| The sample | `qwen3.8:27b`, thinking on | `qwen3.8:27b`, thinking off (`template`) | `qwen3.6:35b` |
|---|--:|--:|--:|
| Documents | 13, stopped | 20 | 20 |
| Success, partial, refused, no answer | 0, 0, 1, 12 | 0, 13, 3, 3 | 0, 13, 3, 3 |
| Timed out, in no share | 0 | 1 | 1 |
| Editable rate, of the documents assembled | none assembled | 11.52% of 10,597 words | 4.05% of 11,310 words |
| Macros asked, stored, invalid | 149, 0, 0 | 169, 138, 31 | 171, 77, 94 |
| Parts asked, and those asked twice, the answer not validating at first | 12, 0 | 18, 15 | 18, 17 |
| A part: median, 90th percentile, slowest | 300.0, 300.0, 300.0 s, every one stopped | 40.9, 71.5, 82.0 s (`altacv-0010`, part 1) | 25.1, 54.3, 63.1 s (`europecv-0002`, part 1) |
| Calls; tokens in, out, reasoning | 0; 0, 0, 0 | 33; 370,516, 42,664, 0 | 35; 431,569, 48,450, 0 |
| Failures by kind | timeout 12 | invalid 6 | invalid 10 |
| Cost at the reference prices, in all and an import | $0.00 | $0.11, $0.0061 | $0.10, $0.0058 |
| The slowest part within 120 s | no | yes | yes |

  No sample document is a success for any of them: every document assembled is partial, as item
  17's committed-only sample was (decision 0043), the words of its own macros the model's answers
  left locked, `unmapped` above all.

- Then the whole corpus, one model at a time, four documents at a time: `qwen3-coder-next`, the
  27B with thinking off, and `qwen3.6:35b`. The 27B with thinking on was not run over it: on the
  sample every part outran 300 s, against the rule's 120 s.

### The table

The whole corpus, 220 documents at commit 842a825, from 07:08 to 08:11 UTC, the three runs taking
16, 24 and 23 minutes; each column joins the model's probe, sample and whole-corpus files, as
`corpus bench <bench.json>...` does, and the last is the 27B with its reasoning, from its sample.

| | `qwen3-coder-next` | `qwen3.8:27b`, thinking off (`template`) | `qwen3.6:35b` | `qwen3.8:27b`, thinking on, the sample |
|---|--:|--:|--:|--:|
| Documents | 220 | 220 | 220 | 13, stopped |
| Success, partial, refused, no answer | 0, 31, 11, 75 | 0, 87, 13, 16 | 0, 84, 13, 19 | 0, 0, 1, 12 |
| Stopped before the naming step; timed out, in no share | 103; 0 | 103; 1 | 103; 1 | 0; 0 |
| **Editable rate**, words editable on the page of the documents assembled | **3.07%** of 17,055 | **19.90%** of 60,039 | **11.82%** of 56,213 | none assembled |
| Words locked: `unmapped`, `shape`, `moved`, `untested`, `differs`, `date`, the rest | 16,065, 56, 328, 0, 6, 6, 58 | 39,497, 5,669, 819, 765, 546, 444, 292 | 45,642, 2,069, 629, 648, 235, 201, 136 | |
| Macros with a key: from its folder, asked, stored, invalid | 1,001: 179, 822, 62, 760 | 1,001: 558, 443, 320, 121 | 1,001: 406, 595, 149, 446 | 149 asked, none stored |
| Parts asked; asked twice, the answer not validating at first | 99; 98 | 86; 58 | 99; 92 | 12; 0 |
| A part: median, 90th percentile | 14.1, 25.5 s | 21.7, 51.9 s | 16.6, 32.8 s | 300.0, 300.0 s |
| The slowest part | 41.0 s, `europecv-0008` part 1, invalid | 82.0 s, `altacv-0010` part 1 | 59.9 s, `altacv-0002` part 1, invalid | 300.0 s, `jake-0001` part 1, timed out |
| A request's parts together, the slowest | 41.0 s | 82.0 s | 59.9 s | 300.0 s |
| Calls; tokens in, out, of them reasoning | 197; 1,866,892, 221,492, 0 | 144; 1,231,355, 127,981, 0 | 191; 1,836,661, 200,111, 0 | 0 |
| Failures by kind | invalid 91 | invalid 28 | invalid 69 | timeout 12 |
| Cost at the reference prices: in all, an import that asked | $0.38, $0.0039 | $0.36, $0.0041 | $0.44, $0.0044 | $0.00 |
| The slowest part within 120 s | yes | yes | yes | no |

The gateway failed no call in the three runs: no 429, no 5xx, no other failure, no part out of
its time. Every request asked was one part. The gateway bills nothing; the cost is what the tokens
would count toward the key's daily limit of $80.

### The choice

By the rule, **`qwen3.8:27b` with its thinking off by its chat template**: 19.90% of the words of
the 87 documents it assembled editable on the page, its slowest part 82.0 s, within 120 s; then
`qwen3.6:35b`, 11.82%, and `qwen3-coder-next`, 3.07%, no tie. It also assembled the most
documents, and had the fewest answers invalid after their retry, 28 parts of 86 against 69 and 91
of 99. The 27B with its reasoning is out: every part of its sample outran 300 s.

- `DEFAULT_MODEL` stays `qwen3.8:27b`, and the switch goes with it wherever the naming step asks
  it: `MODEL_THINKING` gives it `template`, which `soclaasModel` applies to every call of the
  model, so the naming service (`namingModel`), `corpus name --model`, `corpus run --allow-model`
  and `corpus bench` ask it with its thinking off; a test reads the request a call would send and
  finds `chat_template_kwargs: { enable_thinking: false }` in it, and in no other model's.
  `soclaasModel(key, id, { thinking: false })`, or `corpus bench --thinking on`, lets it reason.
- `withoutThinking` and the other two switches stay, unused by default.
- The chosen model's cache stays under `.corpus/cache/qwen3.8%3A27b/`, 311 answers filed by the
  27B with its thinking off, under `model:qwen3.8:27b`, for item 17's part B; the other two
  candidates' folders stay too.

### What the reasoning model's time did

With its reasoning, the 27B answered no part of the sample within the runner's 300 s, with four
requests in flight: 12 of 12 were stopped, though decision 0036's single small call had taken
18.7 s. So no call of a reasoning model completed, every completed call counted no reasoning, and
whether the gateway counts reasoning apart stays unknown. A `/no_think` line after the instructions
did not switch it off. With its chat template's switch, its parts took 21.7 s at the median and
82.0 s at the slowest, slower than the two others but within the limit, and its answers were the
best of the three.

## Consequences

- **The validation retry is the rule, not the exception.** The answer's own retry, which `name`
  asks once when an answer does not validate, was needed on most parts: 15 of 18 for the 27B with
  its thinking off on the sample, 58 of 86 over the corpus, and 92 and 98 of 99 for the others. A
  part's time holds both calls, the 82.0 s among them.
- **No document is a success on a model's answers alone**, on the sample or the corpus: the words
  left locked are `unmapped` above all, macros whose answers place no slot, then `shape`. Item 17's
  part B, the review of the top templates' answers, starts from the 27B's cache.
- **The 23 documents all three failed on**, an answer invalid or none: 9 hold no macro with a key,
  so no model is asked for them, and the 27B answered the other 14 in part or invalidly. No fourth
  candidate, `gemma4:26b` or `qwen3.6:27b`, was run: the three did not fail on the same templates
  beyond those, and the owner asked to finish the items in flight. `LIST_PRICES` needs no entry.
- **The switch is the gateway's to honour.** Should its backend stop passing the chat template's
  `enable_thinking`, the 27B's parts outrun the service's two minutes again, and the service answers
  502; `corpus bench --model qwen3.8:27b` measures the model as the naming step asks it, and is the
  check.
- **What stays open.** A real import's latency in the browser: the service gives its two minutes
  to a request's parts together, with one retry of a failed call (`LIMITS.modelMs`, `MAX_RETRIES`),
  where the benchmark gave each part 300 s and four retries, four requests in flight; every request
  here was one part, so the slowest request is the slowest part, 82.0 s. Item 19 measures an import
  in the browser. And the launch's leave from the school (milestone 5), with Gemini's paid tier as
  the fallback (decision 0036).
- **The gateway can be down.** On 2026-10-01 its authentication backend failed every call for
  some hours; the benchmark stops after three documents in a row and asks only what is missing
  when run again, and the naming service answers a request its cache answers whole, and 502 for
  one that needs the model, until the gateway is back.
