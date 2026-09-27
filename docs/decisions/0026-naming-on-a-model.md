# 0026. The naming step on a model

Date: 2026-09-27 · Status: proposed

## Context

Milestone 3 item 9 is plan section 6 step 4's model: decision 0024's contract put to a language
model, with the cache in front of it, and a runner that measures both over the corpus. Plan section
6.4 leaves the model open, probably a cheap or free one such as Gemini first, called in one place
against a fixed schema; the milestone takes the AI SDK, Gemini first. The code is
`packages/naming/src/model.ts`, `prompt.ts` and `providers.ts`, with `cache.ts`'s new parts; and
`apps/editor/scripts/answer-cache.ts`, `corpus-name.ts` and `corpus-name-child.ts`. Item 10's
service calls the same module; item 7's assembly and item 11's leak test are on other branches.

## Decision

### One place calls a model

- `name(request, options)` asks the model for a `ModelNaming` through AI SDK 7's `generateText`
  with `output: Output.object({ schema: ModelNaming })`, since `generateObject` is deprecated; the
  prompt's instructions go as the system text. The model is a `LanguageModel` the caller passes,
  never a model's name, which the SDK would send to its own gateway, and the module never reads
  the environment. It returns the answer, or throws a `NamingError` whose reason is `refused` (the
  model gave no answer, or its provider filtered it), `invalid` (it did not validate after a
  retry), `provider` (the call failed, after the SDK's retries) or `budget` (the request, or the
  answer, is too large for a call), and whose message names macros, fields and counts, and the
  provider's HTTP status and first line, never the request's text.
- The SDK validates the answer against the schema; the module validates it again, the refinements
  included, and checks that it answers every macro asked, by its name and whether a command or an
  environment, once, and nothing else. An answer that fails is asked again once, with the answer
  and its problems quoted back by macro and field, forty at most; one that fails again throws.
- What is asked is the request's macros with a key: one that holds data has none and is never
  answered (decision 0024).
- `name` never stores. `storedAnswersOf(request, naming, "model:<id>")` in the package turns the
  answer into stored answers under the keys the request's definitions give (`requestKey`), each
  with its macro's own hash, the family, `reviewed: false` and the model's id as its source, which
  `AnswerSource` already took; the caller files them after `checkRequest`.
- The model step has paths of its own, `@resume-tools/naming/model` and
  `@resume-tools/naming/providers`, since they bring the AI SDK, which the page never needs: the
  page imports the contract's path alone. New dependencies: `ai` 7.0.116 and `@ai-sdk/google`
  4.0.82 in the package, both Apache-2.0, and `ai` as a development dependency of the editor, for
  its tests' mock model. pnpm's minimum release age picked 7.0.116 over the day-old 7.0.117, so the
  workspace's policy needed no exclusion.

### The model

- `googleModel(apiKey, id)` makes Google's model of an id with the key its caller read. The
  default, `DEFAULT_MODEL`, is `gemini-3.8-flash`, the current Flash model, which Google's free
  tier serves, as its models and pricing pages gave them on 2026-09-27; `NAMING_MODEL` picks
  another, so that a candidate swaps with a variable, and item 18 adds the other providers. The
  choice is one place to change: the model is a parameter of `name`, and nothing else in the
  pipeline knows which it is.
- Google's structured mode takes the schema as it is, `structuredOutputs` left on: `@ai-sdk/google`
  4 sends it as `responseJsonSchema`, and `ModelNaming`'s JSON Schema holds none of the unions or
  records that mode refuses, only objects, arrays, string enums, bounded integers and booleans. The
  mode does not enforce `pattern`, `minLength` and `maxLength`, which its documentation leaves out;
  the module's validation does. `name` passes `providerOptions` through, so that
  `{ google: { structuredOutputs: false } }` is one line if a real run shows the mode refusing.
- Temperature, thinking and the output's length are the provider's defaults; item 18's benchmark
  is where they are tuned. The free tier lets Google use what is sent (plan section 8.3), which is
  the request alone, behind the privacy gate below.

### The prompt

All of it is `prompt.ts`. The instructions, about 9,700 characters and the same for every call,
say the contract in decision 0024's words: what the model is given, the definitions, the macros'
signatures in xparse's letters, their masked calls and dates' shapes, the probe's verdicts and the
preamble's settings; what each field of the answer means, a kind, a meaning, the slots of each
kind, parts, a blank, a unit that repeats, a list's opener and closer, a role, a contact's field, a
link's kind, a variant and the preamble's parameters; and that the model never writes LaTeX: a
redefinition is a person's, keeps upstream's output, and has no place in the model's answer, which
must never invent LaTeX that changes upstream's output. What it cannot tell, it answers `other`,
which keeps a macro as the document has it. Each list's words are explained by a record keyed by
the list, so that a word added and not explained fails to compile, and a test checks that the text
names every one of `MACRO_KINDS`, `MEANINGS`, `SLOTS` and `BLANKS`, and the other lists, and writes
no command but `\begin`, `\end` and four example macros' names.

The user's text lays the request out: an opening line with the engine and the family; the
definitions the macros hand their work to, each once, one that holds data by its name alone; each
asked macro under a heading that gives its `of` and `name` as the answer gives them, with its
signature, how often the document calls it, its own definition, its dependencies by name, the
probe's verdict on each argument and on its empty calls, and up to three calls, each argument in
its delimiters, an environment's body after; then the class and the preamble's settings, numbered
from 0 as `StyleSetting.setting` indexes them.

### A large class, in parts

- The budget counts the characters the model reads, the instructions and the laid-out request:
  `options.budget`, at most and by default 200,000, about 50,000 tokens, well inside Gemini Flash's
  million. A part also asks 32 macros at most, so that its answer, some hundreds of characters a
  macro, stays well inside a model's output, 65,536 tokens for Flash, thinking among them.
- `batchesOf` fills parts in the request's order: each macro with the definitions it hands its work
  to, a definition once in each part that needs it, an asked macro's own in its own piece; the
  preamble's settings in the first part alone, the others told to answer none. A part is sized
  from the pieces `layOut` joins, to the character. A macro over the budget on its own, or a
  preamble, throws `budget` before any call. The answers are merged in the request's order, the
  preamble's from the first part.
- The class text is reused across calls by laying every part out alike: the same instructions,
  the same opening line, then the definitions in one order for the whole request, the ones most of
  its macros hand their work to first, so that a provider's cache of a prompt's start, Gemini's
  implicit cache among them, serves each part. No provider's cache API is asked for.

### The cache

- `AnswerCache` gains `put(key, answer)`, and `answerFor` takes a cache that can `get` alone.
  `storable(key, answer)` is the check every `put` makes: a stored answer this naming version
  reads, under its own key, or an error that names the field and never a value.
- `FileAnswerCache` (`answer-cache.ts`) reads and writes files, so it lives with the editor's
  scripts: the committed `corpus/answers/`, read first and never written, and the ignored
  `.corpus/cache/`, read and written, `<key>.json` a stored answer each; a key that is not 64 hex
  digits is no file. Item 10's service keeps its own in KV.

### The privacy gate

Nothing is asked of a request until it passes two checks. `assertNoText(request, document)`, over
the document's tree and the texts its preamble stores, refuses it when any of the document's text
is in it, with a reason that names what kind of text is where and never the text; item 7's header
values join the document when that item finds them. `checkRequest` refuses it when a definition's
hash or a macro's key does not hold, so that no answer is filed under another template's key.
Only then is `name` called, and only with `--model` and a key: until item 11's corpus-wide leak
test lands, a real call happens only behind the flag, never in CI, which has no key, and never for
a request the gate refuses. No test calls a provider: the package's tests run `name` on the AI
SDK's `MockLanguageModelV4`, and the editor's the runner's model step on the same.

### The runner

`corpus name [--only <id>] [--json <file>] [--model]` runs in `corpus seed`'s pool, four children
at 900 s a document, the probe's 600 s and 300 s for the model step. Each child builds the
document's request as the seed's does, looks each macro with a key up in the cache, and, for a
request with misses, runs the gate; with `--model` it asks the model for the misses, a call a part,
a failed call tried four more times past a free tier's rate, and files the answers. The parent
stops asking once the provider has failed three documents in a row, as a spent quota fails every
call after it. The key comes from `GEMINI_API_KEY`, or the provider's own name for it,
`GOOGLE_GENERATIVE_AI_API_KEY`, and the model from `NAMING_MODEL`, all three listed, commented, in
`apps/editor/.env.example`, without the `VITE_` prefix that would put a key in the page.
`--model` without a key exits 1 before anything else.

Each document's line gives its macros, those the cache answered, those asked, stored and invalid,
why the gate refused it or the step failed, and the calls and tokens, in, from the provider's
cache, and out; a macro by its name only when it is plainly one. The table adds these up per family
and in all, and its headline gives the documents named, every macro answered, the macros answered,
the model calls, the tokens and their cost at the model's list price, `LIST_PRICES`: Gemini 3.8
Flash's paid tier as its pricing page gave it on 2026-09-27, $0.75 a million tokens in, $0.075 from
the cache and $3.75 out, through 2026-12-31, doubled from 2027-01-01; then the macros most often
missing. Without a key nothing is asked, and each document's misses are counted and named: the
corpus's `jake-0001` has 11 macros, 3 of them answered by the seed and 8 missing.

Whether each document's import validates is item 7's assembly: the child marks the place its
checks hook in, once every macro has an answer, on the same engine session.

## Consequences

- Item 9's line is done but for its proof: the real corpus run, which needs a key, and the import
  validating, which needs item 7; until item 11's leak test lands the run stays behind the flag.
  The cost figures are the price constant's estimate until a real run counts the tokens.
- Item 10 calls `name`, `storedAnswersOf` and `storable` as the runner does, with a cache over KV,
  and runs the same gate before it trusts a request's keys.
- The preamble's answer comes with every call and is stored nowhere, since no key files it; a
  document whose every macro hits asks nothing, and so has no preamble's answer, which item 7 then
  reads from the settings or asks for alone.
- Two children may ask for the same macro before either files it, once per template at the start
  of a run, a few calls in all.
- A definition that the document's own text masks has the document's own key (decision 0024), so
  the model's answer for it serves that document alone: the runner's test on the invented document
  shows it for `\cvgap`, whose definition holds the invented surname.
- `NAMING_VERSION` stays 1: the prompt asks what decision 0024's contract asks. A change to what it
  asks, or to what an answer means, bumps it.
