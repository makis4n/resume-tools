# 0028. The naming service, inside the editor's own project

> Superseded by 00XX in its naming route: /v1/name is deleted with the naming step (the second
> pass's item 17); the service's shell, rate limit and key handling stay for the label route.

Date: 2026-09-27 · Status: proposed; the key is SOCLAAS_API_KEY (0036); amended by 0049: the service gains a route that labels a PDF's lines, and loses its naming route

## Context

Milestone 3 item 10 is the service of plan section 6 step 4: `POST /v1/name`, which takes an
import's naming request (decision 0024), answers each macro from the shared cache by its key, asks
the model (decision 0027) for the rest, and files what the model says for the next import of the
same template. The owner settled where it lives on 26 September, the milestone's "option b, the
monolith": inside the editor's project, not in an app of its own. The code is
`apps/editor/src/service/` (the handler and its stores), `scripts/serve-naming.ts` (the dev server's
host), `functions/v1/name.ts` (the Pages Function) and `src/import/service.ts` (the browser's
client). Deploying it is milestone 5's. Its adversarial review found that the reply gave one answer
a key, under whichever macro filed it, that KV filed over any answer, a reviewed one among them,
that one request could send hundreds of model calls, that the limit keyed IPv6 too finely and
failed closed, and that no filing could be traced; this record says what was decided for each.

## Decision

### One project, one handler

The service is one function written against the fetch API, `handleName(request, deps)`, which
imports neither Node, nor Vite, nor the Workers runtime; its host hands it a cache for answers and
one for the preambles' answers, the model or none, the client's address, the rate limit's store,
the limits and a clock. Two hosts serve it: in development a middleware of the dev server, so that
no second process runs; in production a Cloudflare Pages Function beside the app, or the app's
Worker if milestone 5 hosts the app as a Worker with static assets, in which case the same handler
is that Worker's `fetch` for the route. The browser's client calls the relative address `/v1/name`,
so there is one origin, no CORS and one deploy. The logic stays in `packages/naming`, which the
corpus runner calls in Node the same way.

What it costs: the editor's project now holds server code, which must never reach the page. The
function's folder is outside the app's `tsconfig.json` (and excluded by name), has a config of its
own with the Workers types and no DOM, which the editor's `typecheck` script now also runs, and
nothing the app imports imports it; `scripts/build-output.test.ts` builds the page with the app's
config and invented values in the key's variables, and fails if any output file holds the variables'
names or values, or the function's export, binding or address header, or sits under a `functions`
path. Pages makes a route of every script in `functions/`, so the code the function runs, and its
tests, live under `src/service/`; the function only wires them. The plan's hosting row names a
separate Worker for the model endpoint; milestone 5 revises it.

### The contract

| Status | When |
|---|---|
| 200 | The reply below |
| 400 | The body is not UTF-8, not JSON, or not a `NamingRequest` (its problems listed by path in the schema's own words, never a value it holds: the names of fields the contract has not are left out), or its hashes or keys do not follow from its definitions (`checkRequest`, counted by kind) |
| 405 | A method other than POST, with `Allow: POST` |
| 413 | A body over 1 MB, refused by its declared length before a byte is read, or as soon as what arrives passes the cap; a template whose misses would take more than four parts, or more than 400,000 characters of prompts, or a macro or preamble over a call's budget on its own, all before any call ("The template is too large to name here."); or an answer cut off at the model's output limit |
| 415 | A content type other than `application/json`, so that a page on another site cannot post to the route with a simple request, which a browser sends without asking |
| 422 | The model's answer did not validate after its retry (`invalid`), or it gave none (`refused`) |
| 429 | The address's request buckets are empty, or its day's characters are spent, with `Retry-After` in whole seconds |
| 500 | Anything else, logged by the error's class alone |
| 502 | The model's provider failed after one retry, or the model took over two minutes (`provider`) |

The checks run in that order: method, content type, rate limit, size, form, keys. Every refusal is a
fixed sentence, `{ error, problems? }`; a `NamingError` becomes its status and a sentence, never its
message, and nothing of a request's text or of the model's reaches a response or a log.

### One answer for each macro of the request

The reply is `NamingReply` (`src/service/reply.ts`): decision 0024's `NamingAnswer`, with `macros`
holding one stored answer for each macro of the request that has one, named for that macro and of
its kind, its list's partners named as the request names them, however it was found; with `hits`,
the request's macros the cache answered, `asked`, those asked of the model now, `conflicts`, the
keys left unfiled because the answers under them disagree, and `missing`, each macro left with no
answer by its `of`, name and key, which the editor locks. Item 7 assembles by `of` and name
(`command|<name>`, `answersOf`), so this is the contract: a macro that shares its key with another,
or hits an answer another template filed under the key, still finds its own.

- **The cache is asked as each macro** (`answerFor(cache, key, { name, of, partners })`, the
  partners the request's commands' keys by name), one read a key: an answer under the key comes
  back named for the macro that asked, or is refused when it is another kind's, or pairs a list the
  request has not. A refused answer is a miss, asked of the model, and its key is never filed
  over: a template whose bare `\begin{itemize}` and `\end{itemize}` have the keys of Jake's item
  list's opener and sub-heading list's closer is asked afresh, and Jake's reviewed answers stay.
- **A list's partner is found by key, or by name.** Decision 0024 found a partner by the key the
  answer holds for it alone. `answerFor` now pairs by the name the answer gives the partner where
  no macro of the request has its key and one has that name: a Jake fork whose
  `\resumeItemListEnd` is a bare `\end{itemize}`, the sub-heading list's closer's definition, keeps
  its item list's answers, paired under its names, with no model call, where before its opener was
  refused and asked. The seed's check of its own files, which `--write` gives their partners' keys,
  pairs by key alone (`byName: false`). The corpus runner and item 7 take the fallback too.
- **The model's answers are each macro's own.** The misses are asked in one `name` call, as the
  corpus runner asks them; `storedAnswersOf` gives each macro's stored answer (`Filing.answered`),
  which the reply gives it whether or not its key's is filed: two macros of one key that the model
  answers otherwise, a template's twin lists, each get their own in the reply, and neither is
  filed, one conflict. Where they agree, one answer is filed, the first macro's by name, and both
  hit it next time, each under its own name.
- **The preamble's answer is kept.** No macro's key files it, so a template whose every macro hits
  would lose the style controls its first import found. The service keeps each preamble's answer
  under the SHA-256 of the naming version, the class's name and options and the settings, masked
  as the request holds them (`preamble:<key>` on KV), filed as an answer is; a request whose every
  macro hits takes it from there, or, where none is kept and the preamble has settings or class
  options, asks the model for the preamble alone, a part with no macros, and keeps what it says; a
  failure there leaves the reply without it, and fails nothing else. A request with misses asks the
  preamble with them and keeps that answer where none is. The dev server keeps them in memory, and
  asks again once a template after it restarts.

### Never over what a key holds

An answer is filed only under a key that holds nothing: `KvAnswerCache.put` reads the key and
writes only where the read finds none, and `FileAnswerCache.put` writes only where neither the
committed folder nor the model's holds a file for it; each says whether it filed. KV has no write
that checks the key, so two filings of one key within the moment between a read and a write can
both write, the later kept: both are a model's answers to one template's macro, and the race is
accepted. A person's reviewed answer, uploaded by milestone 5 or committed, therefore always wins;
a model's answer is never filed over it, and a request that lists a reviewed answer's macro as the
other kind, which the key cannot tell, is answered by the model for that request and files nothing.

What it costs: a fork whose macro is refused the answer its key holds, another kind's, or a list's
the fork pairs otherwise, asks the model on every import, since its answer has no slot to be filed
in: a call a macro an import, counted in the reply's `conflicts`, until a store of variants a key,
by kind and partners, exists (open).

### What one request and one address may cost

- **A request** is asked in at most four parts and 400,000 characters of prompts, the instructions
  among them (`name`'s `maxParts` and `maxChars`, with its budget of 200,000 characters a call):
  more is refused with 413 before any call. The review's request, 512 macros that each hand their
  work to one definition of some 190,000 characters, made 512 calls and sent a hundred million
  characters; it is refused when `batchesOf` opens its fifth part. The AI SDK tries a failed call once more, not twice, and a
  part that does not validate is asked once more, so a request makes sixteen calls at the most.
- **An address** has three buckets (`src/service/rate.ts`): ten requests that fill again over a
  minute, a hundred over a day, and two million characters of prompts over a day. A request takes a
  token from each request bucket before its body is read, and is refused while the characters are
  spent; what its calls send, the instructions and messages each call's prompt holds, is taken from
  the characters as each part validates, and what a failed part sent when the step ends, so that the
  bucket may go below nothing, which the address waits out. The handler files each part's answers
  as it validates (`onPart`), a key once all its macros are answered and agree, so that a later
  part's failure loses nothing paid for, and the same request asks only what is left.
- **IPv6 by its /48.** A subscriber may be given a /48, a /56 or a /60, each many /64s, and keying
  by /64 gave each of them fresh buckets, 65,536 times the limit for a /48. An IPv6 address now
  draws on its /48's buckets. What it costs: everyone behind one /48, a campus or an office on one
  delegation, shares ten requests a minute, a hundred a day and two million characters; milestone 5
  may key a known shared prefix otherwise. An IPv4 address written as IPv6 draws on its IPv4
  address's, and a request whose host gives no address on one shared bucket.
- **The limit fails open.** A rate store that cannot read or write, KV past its day's writes or
  reads among them, lets the request through uncounted, and the process says so once, by the
  error's class, never the address or the key; so no address is refused for what is no address's
  doing, as before, when a failed write refused everyone with `Retry-After: 1`. A request that the
  caches answer whole writes nothing but its rate bucket.

### Two hosts, two caches

- **Development**: `serveNaming()` in `vite.config.ts`, applied when the dev server serves and never
  in vitest's own server, mounts the handler at `/v1/name`. It converts Node's request to a fetch
  `Request`, whose body is a stream that reads Node's no faster than the handler takes it and, once
  the handler stops at the cap, drains the rest so that the connection still carries the 413, and
  converts the `Response` back. The key is `GOOGLE_GENERATIVE_AI_API_KEY`, the provider's own name,
  which the corpus runner reads too, so that one variable serves both, read with `NAMING_MODEL` by
  Vite's `loadEnv` from the editor's `.env` files and environment, on the server side and never
  under the `VITE_` prefix; the service's `NAMING_API_KEY` is dropped. With no key the route serves
  the cache alone and the dev server says so in one line when it starts. The cache is item 9's
  `FileAnswerCache`: the committed answers under `corpus/answers/`, read first and never written,
  so that a person's reviewed answer always wins, then the model's folder, `.corpus/cache/<id>/`,
  where the runner files that model's answers too, and where the route files the model's.
- **Production**: `functions/v1/name.ts` exports `onRequestPost` and binds one KV namespace,
  `NAMING_KV`, as all three stores (`src/service/kv.ts`): stored answers under `answer:<key>`, a
  model's for 90 days, after which it is asked again, and a person's for good; the preambles'
  answers under `preamble:<key>`, for 90 days; and each address's buckets under `rate:<address>`,
  expiring once they would be full again, a minute at least. The key and the model come from the
  function's environment under the same names, the address from `CF-Connecting-IP`. KV starts
  empty: it has no reviewed layer until milestone 5 uploads the committed answers, which are then
  read by key like any other. KV is eventually consistent, a write seen at once where it was made
  and within about a minute elsewhere, so two imports of a new template in two places within that
  minute may both ask the model; and a key takes one write a second, so a request whose buckets KV
  will not keep goes through uncounted, as any failing store's does. The limit on KV is therefore
  rough: a client that spreads its requests over Cloudflare's locations can outrun it.
  `functions/README.md` lists the bindings.

`@cloudflare/workers-types` 5.20260926.1 (MIT OR Apache-2.0) is a new development dependency of the
editor, for the function's config: its version 5 has one entry point, the current runtime's types,
and pnpm's minimum release age took the day-old release over the same day's. `wrangler` is not
added: nothing here deploys, and the Workers types check the function without it.

### What the service can check of a request, and what it cannot

Decision 0024 has `checkRequest` keep a request from filing an answer under another template's key;
what it proves is narrower. It proves that each definition's hash is its text's and each macro's key
the one its definitions give, so that no request files an answer under a key its own definitions do
not give. It cannot prove that the definitions are any document's, nor that the calls, the
signatures and the probe's verdicts sent with them are honest: none of those is in the key, and nor
is whether a macro is a command or an environment. A request that sends a public template's real
definitions with invented calls or verdicts, before any other import of it, gets the model's
reading of them filed under that template's key, for every later import of it. The privacy gate
(`assertNoText`) runs in the browser, where the document is; the service never sees a document,
only what the browser sends. What bounds a misleading answer: a reviewed answer wins where one
exists, and nothing is filed over any answer; every answer is checked by compiling on every import
(plan section 6.4, item 7), so a wrong one lowers that template's editable rate and never shows
something unsafe as editable; a model's answer expires after 90 days; the limits bound how much one
address files; and each filing can be traced and removed. KV keeps each filed answer's
provenance as the key's metadata, `{ filedAt, model, by }`: the time, the model's id and the
SHA-256 of the filing address's key, never the address; and the handler logs one line a filing,
the key alone. A bad batch is found by listing the keys with their metadata, by the time, the model
or the filer, and removed.

### The client

`nameOnService(request, fetchLike = fetch, signal?)` posts the request as JSON to `/v1/name` and
gives back the reply, checked against `NamingReply`; on anything else it throws a
`NamingServiceError` whose message says in plain English what the status means, from the status and
`Retry-After` alone, never the reply's body, and never LaTeX. A cancel through `signal` is thrown as
it comes. Item 12's import screen calls it; nothing in the page changes here.

### What this changes of decisions 0024 and 0027

- `answerFor` pairs a list's partner by the name the answer gives it where no macro of the request
  has the key the answer holds (above); decision 0024 paired by key alone. The corpus's
  `jake-0001`, whose `\resumeSubHeadingListEnd` has the seed's key and names an opener by a key the
  fork's `\resumeSubHeadingListStart` has not, now has it answered by name: 3 of its 11 macros hit
  the seed, where 2 did, as `corpus name --only jake-0001` counts them with no model. 0027 says so;
  its figures over the whole corpus predate the pairing until the runner is run again.
- `FileAnswerCache.put`, the runner's cache, never files over a file either folder holds, so two
  children that ask for one macro keep the earlier filing where 0027 kept the later.
- `name` takes `maxParts` and `maxChars`, refused before any call; tells `onCall` each call's
  prompt in characters; and tells `onPart` the preamble's answer with the part that asks it.
  `Filing` gives each macro's own answer (`answered`), and `AnswerCache.put` may say whether it
  filed.

## Consequences

- The milestone's done line for item 10, an import in the browser hitting the dev server's route and
  the second import of the same template hitting the cache, waits for item 12's import screen to
  call the client; the middleware's test runs the same round trip on a real dev server, and the
  handler's tests the rest: a hit-only request asks the model nothing, a miss asks once and files,
  the same request again is all hits, and no response holds the request's definitions, calls or
  settings.
- A fork refused the answer its key holds pays a call a macro on every import, and the conflicts
  count says how often; a store of variants a key is open.
- Milestone 5 binds `NAMING_KV` and the key, uploads the committed answers, and decides eviction
  beyond the model's 90 days and the audit plan section 6.3 asks for. The route needs the paid plan,
  or a Durable Object limiter, at launch (open): the free plan's day of KV operations, 100,000
  reads and 1,000 writes, is spent by a thousand imports the caches answer whole, a write each for
  the buckets, and by far fewer that ask the model, which write the buckets again a part and each
  answer they file, with a read a key and a read a filing besides; past it the limit lets
  everything through uncounted and nothing is filed. The free plan's 10 ms of CPU, 50
  subrequests and 1,000 KV operations a request do not fit a large request's parsing, hashing and
  model calls either, where the paid plan's 30 s and 10,000 do; KV's bulk reads would cut the reads
  on either. Milestone 5 puts a stronger limit behind `RateStore`, the Workers rate limiting binding
  or a Durable Object, beside the bot check the milestone names.
- The discounted batch analysis of the top templates before launch (plan section 6.4) is not here:
  it fills the same cache, by key, from outside the service.
