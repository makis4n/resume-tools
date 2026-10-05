# 0027. The naming step on a model

> Superseded by 00XX: the naming step on a model is deleted (the second pass's item 17), all but its
> provider code, which the PDF reading keeps.

Date: 2026-09-27 · Status: proposed; the provider is SoCLaaS, not Gemini (0036); superseded by 0049: the naming step leaves the import, and only its provider code stays, for the PDF reading

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
  answer, is too large for a call), and whose `part` is the part of the request whose asking
  failed, its number, how many there are and its macros, or none where the step failed before it
  asked anything.
- What a `NamingError` says is printed and kept by the runner, so it holds none of the request's
  text and none of the model's words: a macro is named only by a name that is plainly one, 63
  letters, `@` and `*` at most, as the runner's `shownMacro` has it, and otherwise as "a command
  whose name is not plain"; a field the model added is "fields the contract has not", never its
  name; a provider's answer is its HTTP status and its first line, cut at 200 characters, with any
  key-like token, Google's `AIza…` or a run of 30 letters and digits, written `<key>`; and anything
  else is a sentence of the module's own, since the runtime's messages quote what they were given:
  the check of a header quotes the key whole when the key has a line break in it, which is said as
  "the key is not a single line", and any other error is named by its class alone.
- The SDK validates the answer against the schema; the module validates it again, the refinements
  included, and checks what the schema cannot, since it takes the request: that the answer answers
  every macro asked, by its name and whether a command or an environment, once, and nothing else;
  that each partner a list names, `closedBy` or `openedBy`, is one of the template's commands by
  name, as decision 0024 has partners, a command of the request or one the caller adds
  (`partners`, below); and, in the part that asks the preamble, that each parameter names a
  setting the request has and a key that is a plain name. A key is an option or a name item 7
  writes into a control's snippet, `margin`, `11pt` or `awesome-red`, so it is letters, digits,
  `@`, dots, hyphens and underscores, 64 at most, and nothing TeX reads as more than a name. An
  answer that fails is asked again once, with the answer and its problems quoted back by macro and
  field, forty at most; one that fails again throws.
- What is asked is the request's macros with a key: one that holds data has none and is never
  answered (decision 0024).
- `name` never stores. `storedAnswersOf(request, naming, "model:<id>")` in the package gives what
  the answer files (`Filing`): for each macro answered, a stored answer under the key the request's
  definitions give (`requestKey`), with its macro's own hash, the dependencies its key is computed
  from, as `requestKey` computes them, the family, the keys of the partners its list names, each a
  command of the request found by its name, `reviewed: false` and the model's id as its source;
  then one a key. A key leaves the name out, so macros of one definition and closure share it and
  one file serves them all (decision 0024): their answers are filed once where they agree, the
  first macro's by name, and not at all where they disagree beyond their names and their partners'
  names, their partners' keys compared, since whichever were filed would be served to the others.
  Such a key is a conflict, and a macro whose list names a partner no command of the request is is
  invalid; neither is filed. The caller files the rest, after `checkRequest`.
- The model step has paths of its own, `@resume-tools/naming/model` and
  `@resume-tools/naming/providers`, since they bring the AI SDK, which the page never needs: the
  page imports the contract's path alone. New dependencies: `ai` 7.0.116 and `@ai-sdk/google`
  4.0.82 in the package, both Apache-2.0, and `ai` as a development dependency of the editor, for
  its tests' mock model. pnpm's minimum release age picked 7.0.116 over the day-old 7.0.117, so the
  workspace's policy needed no exclusion.

### The model

- `googleModel(apiKey, id)` makes Google's model of an id with the key its caller read, and refuses
  an empty key, or one of more than one line or with a space in it, without saying what it is. The
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

All of it is `prompt.ts`. The instructions, about 10,300 characters and the same for every call,
say the contract in decision 0024's words: what the model is given, the template's commands, the
definitions, the macros' signatures, their masked calls and dates' shapes, the probe's verdicts and
the preamble's settings; what each field of the answer means, a kind, a meaning, the slots of each
kind, parts, a blank, a unit that repeats, a list's opener and closer, each one of the template's
commands, a role, a contact's field, a link's kind, a variant and the preamble's parameters, whose
keys are plain names; and that the model never writes LaTeX: a redefinition is a person's, keeps
upstream's output, and has no place in the model's answer, which must never invent LaTeX that
changes upstream's output. What it cannot tell, it answers `other`, which keeps a macro as the
document has it. Each list's words are explained by a record keyed by the list, so that a word
added and not explained fails to compile, and a test checks that the text names every one of
`MACRO_KINDS`, `MEANINGS`, `SLOTS`, `BLANKS` and `ARGUMENT_KINDS`, and the other lists, and writes
no command but `\begin`, `\end` and four example macros' names.

The user's text lays the request out: an opening line with the engine and the family; the
template's commands by name, the request's and those the caller adds, the same line in every part,
one of which a list's partner is; the definitions the macros hand their work to, each once, one
that holds data by its name alone; each asked macro under a heading that gives its `of` and `name`
as the answer gives them, with its signature, how often the document calls it, its own definition,
its dependencies by name, the probe's verdict on each argument and on its empty calls, and up to
three calls, each argument in its delimiters, an environment's body after; then the class and the
preamble's settings, numbered from 0 as `StyleSetting.setting` indexes them.

A signature is laid out as its arguments, each by its index and its kind as the request lists
them, `mandatory`, `optional`, `star` or `token`, and whether an optional one has a default: never
as the engine printed it, since a default, `O{...}`'s among them, is the definition's own text,
which may be the person's. Item 6's schema refuses a signature whose defaults hold text, and its
builder sends defaults as placeholders; the prompt does not depend on either, and a test lays out a
request whose signature holds a default of invented text, past the schema, and finds none of it,
nor any backslash of it.

`PROMPT_HASH`, beside `NAMING_VERSION` in `key.ts`, is the SHA-256 of the instructions and of a
fixed request laid out whole and in a part, with a retry's text, and a test recomputes it: an edit
to the prompt fails the test until the constant is its hash again, and whoever updates it decides
whether the edit changes what the prompt asks, which bumps `NAMING_VERSION` so that answers to the
old question are no longer read. Laying signatures out by their arguments' kinds and naming the
template's commands put the same question, so the version stays 1.

### A large class, in parts

- The budget counts the characters the model reads, the instructions and the laid-out request:
  `options.budget`, at most and by default 200,000, about 50,000 tokens, well inside Gemini Flash's
  million. A part also asks 32 macros at most, so that its answer, some hundreds of characters a
  macro, stays well inside a model's output, 65,536 tokens for Flash, thinking among them.
- `batchesOf` fills parts in the request's order: each macro with the definitions it hands its work
  to, a definition once in each part that needs it, an asked macro's own in its own piece; the
  preamble's settings in the first part alone, the others told to answer none. A macro goes in the
  part being filled, or else in the first, which takes whatever fits beside the preamble, later
  macros too, or else starts the next part, so that no order of the macros makes a request too
  large: a macro too large to go beside the preamble starts a part of its own, and the preamble
  keeps its part with what fits. Only a macro over the budget on its own, or a preamble, throws
  `budget`, before any call. A part is sized from the pieces `layOut` joins, to the character.
- Each part is asked on its own, with a time limit of its own (`partTimeoutMs`, the runner's 300 s),
  so that a request of many parts is not stopped by one limit for all of them; and each part's
  answers, once they validate, are told to the caller (`onPart`) before the next part is asked, so
  that a later part's failure loses nothing already paid for, and the next run asks only the parts
  still missing. A failure still throws, naming its part, "Part 2 of 2: ...", where there are more
  than one. The answers are merged in the request's order, the preamble's from the first part.
- The class text is reused across calls by laying every part out alike: the same instructions,
  the same opening line and commands, then the definitions in one order for the whole request, the
  ones most of its macros hand their work to first, so that a provider's cache of a prompt's start,
  Gemini's implicit cache among them, serves each part. No provider's cache API is asked for.

### The cache

- `AnswerCache` gains `put(key, answer)`, and `answerFor` takes a cache that can `get` alone.
  `storable(key, answer)` is the check every `put` makes: a stored answer this naming version
  reads, under its own key, or an error that names the field and never a value.
- `FileAnswerCache` (`answer-cache.ts`) reads and writes files, so it lives with the editor's
  scripts: the committed `corpus/answers/`, read first and never written, and a folder of each
  model's own under the ignored `.corpus/cache/`, `.corpus/cache/<model id>/`, read and written,
  `<key>.json` a stored answer each. A key that is not 64 hex digits is no file, and a model's id
  names one folder and never a path, each byte of it but a letter, a digit, `.`, `-` and `_`
  written out as a URL writes it, `.` and `..` refused. So a candidate model swapped in with
  `NAMING_MODEL` is asked afresh rather than served another model's answers, and every answer in a
  folder is that folder's model's, as its `source` says; the committed answers, a person's, serve
  every model. What prompt an answer was given to is the naming version's to say (`PROMPT_HASH`).
  Item 10's service keeps its own in KV.
- The runner asks the cache for each of a document's macros as that macro, `answerFor(cache, key,
  { name, of, partners })`, with the request's commands' keys by name, as decision 0024 has it: an
  answer under its key that is another kind's, a command's for an environment, or whose list names
  a partner the document has no command of by key, a bare `\end{itemize}` closer that another
  template's list ends with among them, is refused. A refused answer is a miss, counted apart
  (`refusedCache`), never a hit; the model is asked for the macro, and its answer is never filed
  over what the cache holds, which serves the other macro: that key is counted a conflict.
- The runner files a part's answers as it validates, through `storedAnswersOf`, the answers of
  macros that share a key together once all of them are answered, so that one key has one answer.
  A key two macros share whose parts are asked apart is filed once both have validated; where the
  later fails, neither is, and the next run asks both.

### The privacy gate

Nothing is asked of a request until it passes two checks. `assertNoText(request, document)` refuses
it when it holds any text the builder knows as the document's: the body's tree and the texts its
preamble stores, and the header's values once items 7 and 11 pass them. The child gives the gate
the upload's sources as it gives the builder them (`sourcesOf`), so that both tell the document's
own definitions from the tree's (decision 0024). The gate is stricter than the masking, on purpose:
a single word of the document's text in an own definition, which the builder leaves unless it is a
word of the header's name, is refused, so the invented document's `\cvgap`, which its uploaded
class defines to hold the surname its preamble stores, is refused as the child builds the request
now, and passes once item 7 gives the name. Before item 11 the gate did not catch a text that only
a definition holds, which no string of the document's names: a name a preamble's own macro spells
out, `\newcommand{\cvcontact}{{\Large Quill Invented}\par}`, went to the model with the gate
passing. Item 11 (decision 0033) makes the reference's page, read with the upload's fonts, a source
of the builder's and the gate's, and the child builds the request and its gate as `corpus leak`
does (`gatedRequest`): such a name is masked where the page shows it as a pair, the gate refuses a
request whose own definition still holds a word only the page shows, it reads the request's names
too, and a page it cannot read refuses the request. `checkRequest` refuses a request when a
definition's hash or a macro's key does not hold, so that no answer is filed under another
template's key.

Only then is `name` called, and only with `--model` and a key: until item 11's corpus-wide leak
test lands, a real call happens only behind the flag, never in CI, which has no key, and never for
a request the gate refuses. No test calls a provider: the package's tests run `name` on the AI
SDK's `MockLanguageModelV4`, and the editor's the runner's model step on the same.

### The runner

`corpus name [--only <id>] [--json <file>] [--model]` runs in `corpus seed`'s pool, four children
at 900 s a document, the probe's 600 s and 300 s for the model step; a document of many parts that
takes longer is stopped there, and keeps the parts it filed. Each child builds the document's
request as the seed's does, with the upload's sources, but without the header's values, which are
item 7's to find; drops the format the probe leaves in the session, as the probe runner's child
does, until item 7's checks hook in; looks each macro with a key up in the cache, and, for a
request with misses, runs the gate; with `--model` it asks the model for the misses, a call a part,
each part within 300 s of its own, a failed call tried four more times past a free tier's rate, and
files each part's answers as it validates. The parent stops asking once the provider has failed
three documents in a row, as a spent quota fails every call after it. The key comes from
`GEMINI_API_KEY`, or the provider's own name for it, `GOOGLE_GENERATIVE_AI_API_KEY`, and the model
from `NAMING_MODEL`, all three listed, commented, in `apps/editor/.env.example`, without the `VITE_`
prefix that would put a key in the page. A key of more than one line or with a space in it, as a
key file with a comment gives, exits 1 by the variable's name, never the value; so does an id that
is not a model's, and `--model` without a key, before anything else.

Each document's line gives its macros, those the cache answered and those it refused, those asked,
counted as the model was sent them, stored, as each part was filed, and invalid, the macros of the
part that never validated; the keys in conflict; why the gate refused the request, its keys do not
hold or it is over the budget before any call, or why the step failed, naming its part; and the
calls and tokens, in, from the provider's cache, and out; a macro by its name only when it is
plainly one. The table adds these up per family and in all, and its headline gives the documents
named, every macro answered, the macros answered, the model calls, the tokens and their cost at the
model's list price, `LIST_PRICES`: Gemini 3.8 Flash's paid tier as its pricing page gave it on
2026-09-27, $0.75 a million tokens in, $0.075 from the cache and $3.75 out, through 2026-12-31,
doubled from 2027-01-01; then the macros most often missing. The JSON names the model asked, if
any, and the model whose folder was read. Without a key nothing is asked, and each document's misses
are counted and named: the corpus's `jake-0001` has 11 macros, 3 of them answered by the seed and 8
missing. Its `\resumeSubHeadingListEnd` has the seed's key, whose answer names an opener by a key
the fork's `\resumeSubHeadingListStart` has not; the cache refused it, until decision 0028 had a
partner that no macro has the key of found by its name, which the fork keeps. Over the corpus,
before that, 14 of the 117 requests built were named whole, and 447 of their 1,092 macros answered.

Whether each document's import validates is item 7's assembly: the child marks the place its
checks hook in, once every macro has an answer, on the same engine session.

## Consequences

- Item 9's line is done but for its proof: the real corpus run, which needs a key, and the import
  validating, which needs item 7; until item 11's leak test lands the run stays behind the flag.
  The cost figures are the price constant's estimate until a real run counts the tokens.
- Item 10 calls `name`, `storedAnswersOf` and `storable` as the runner does, with a cache over KV:
  it asks the cache as each macro, files a `Filing`'s answers and counts its conflicts, passes the
  document's commands the cache answered as `partners`, and files parts through `onPart`, one key
  one answer; it runs the same gate before it trusts a request's keys.
- The preamble's answer comes with every call and the runner stores it nowhere, since no key files
  it; a document whose every macro hits asks nothing, and so has no preamble's answer, which item 7
  then reads from the settings or asks for alone. The naming service keeps it by the preamble's own
  key, and asks for it alone (decision 0028).
- Two children may ask for the same macro before either files it, once per template at the start
  of a run, a few calls in all; the earlier filing stays, since the cache files nothing over what a
  key holds (decision 0028).
- A key that two macros answered otherwise, or that the cache holds another macro's answer under,
  is asked again every run and never filed: the conflicts count says how often the name-less key
  cannot tell two macros apart, which a later version of the key may have to.
- A definition that the document's own text masks has the document's own key (decision 0024), so
  the model's answer for it serves that document alone: the runner's test on the invented document
  shows it for `\cvgap`, whose definition holds the invented surname, given the name as item 7
  will give it.
- `NAMING_VERSION` stays 1: the prompt asks what decision 0024's contract asks. A change to what it
  asks, or to what an answer means, bumps it, and `PROMPT_HASH`'s test makes every edit to the
  prompt a decision about it.
