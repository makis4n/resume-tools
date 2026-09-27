# 0028. The naming service, inside the editor's own project

Date: 2026-09-27 · Status: proposed

## Context

Milestone 3 item 10 is the service of plan section 6 step 4: `POST /v1/name`, which takes an
import's naming request (decision 0024), answers each macro from the shared cache by its key, asks
the model (decision 0026) for the rest, and files what the model says for the next import of the
same template. The owner settled where it lives on 26 September, the milestone's "option b, the
monolith": inside the editor's project, not in an app of its own. The code is
`apps/editor/src/service/` (the handler and its stores), `scripts/serve-naming.ts` (the dev server's
host), `functions/v1/name.ts` (the Pages Function) and `src/import/service.ts` (the browser's
client). Deploying it is milestone 5's.

## Decision

### One project, one handler

The service is one function written against the fetch API, `handleName(request, deps)`, which
imports neither Node, nor Vite, nor the Workers runtime; its host hands it the cache, the model or
none, the client's address, the rate limit's store, the limits and a clock. Two hosts serve it: in
development a middleware of the dev server, so that no second process runs; in production a
Cloudflare Pages Function beside the app, or the app's Worker if milestone 5 hosts the app as a
Worker with static assets, in which case the same handler is that Worker's `fetch` for the route.
The browser's client calls the relative address `/v1/name`, so there is one origin, no CORS and one
deploy. The logic stays in `packages/naming`, which the corpus runner calls in Node the same way.

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
| 413 | A body over 1 MB, refused by its declared length before a byte is read, or as soon as what arrives passes the cap; or a request the model cannot take in a call (`budget`) |
| 415 | A content type other than `application/json`, so that a page on another site cannot post to the route with a simple request, which a browser sends without asking |
| 422 | The model's answer did not validate after its retry (`invalid`), or it gave none (`refused`) |
| 429 | The address's buckets are empty, with `Retry-After` in whole seconds |
| 500 | Anything else, logged by the error's class alone |
| 502 | The model's provider failed after the AI SDK's retries, or the model took over two minutes (`provider`) |

The checks run in that order: method, content type, rate limit, size, form, keys. Every refusal is a
fixed sentence, `{ error, problems? }`; a `NamingError` becomes its status and a sentence, never its
message, and nothing of a request's text or of the model's reaches a response or a log.

The reply is `NamingReply` (`src/service/reply.ts`): decision 0024's `NamingAnswer`, the stored
answer of each macro answered, one for each key, and the preamble's answer, with `hits`, the
request's macros the cache answered, `asked`, those asked of the model now, and `missing`, each
macro left with no answer by its `of`, name and key, which the editor locks. The macros are looked
up by key; those the cache lacks are asked of the model in one `name` call, narrowed to them as the
corpus runner narrows, and filed with `storedAnswersOf`, `reviewed: false` and `model:<id>` as their
source. Two macros of one request can share a key, when their definitions and closures are the
same: the first answer the model gives for the key is filed and given for both, as a later hit
would give it. An answer the cache fails to file is still given. With no model configured the
misses are `missing` and nothing is asked. The preamble's answer is the model's when the model was
asked, and empty when every macro hit (decision 0026's consequence stands: item 7 then reads the
settings itself).

### The rate limit

Two token buckets for each client address (`src/service/rate.ts`): one holds ten requests and fills
again over a minute, the other a hundred over a day, so that an address makes ten requests at once,
then one every six seconds, and a hundred in a day. Every request that passes its method and
content type takes a token from both, before its body is read. An IPv6 address draws on its /64's
buckets, since one subscriber is given a whole /64 and would otherwise have a fresh bucket for each
address in it; an IPv4 address written as IPv6 draws on its IPv4 address's; a request whose host
gives no address draws on one shared bucket. The buckets live in a `RateStore`: memory in
development and the tests, KV in production. The limit counts requests, not the model's calls: a
request of many new macros is asked in parts (decision 0026), at least sixteen at the 512 macros'
cap, each asked once more when its answer does not validate.

### Two hosts, two caches

- **Development**: `serveNaming()` in `vite.config.ts`, applied when the dev server serves and never
  in vitest's own server, mounts the handler at `/v1/name`. It converts Node's request to a fetch
  `Request`, whose body is a stream that reads Node's no faster than the handler takes it and, once
  the handler stops at the cap, drains the rest so that the connection still carries the 413, and
  converts the `Response` back. The key is `NAMING_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY`, the
  provider's own name, read with `NAMING_MODEL` by Vite's `loadEnv` from the editor's `.env` files
  and environment, on the server side and never under the `VITE_` prefix; with no key the route
  serves the cache alone and the dev server says so in one line when it starts. The cache is item
  9's `FileAnswerCache`: the committed answers under `corpus/answers/`, read first and never
  written, so that a person's reviewed answer always wins, then `.corpus/cache/`, where the model's
  are filed.
- **Production**: `functions/v1/name.ts` exports `onRequestPost` and binds one KV namespace,
  `NAMING_KV`, as both stores (`src/service/kv.ts`): stored answers under `answer:<key>`, with no
  expiry, and each address's buckets under `rate:<address>`, expiring once they would be full
  again, a minute at least. The key and the model come from the function's environment under the
  same names, the address from `CF-Connecting-IP`. KV starts empty: it has no reviewed layer until
  milestone 5 uploads the committed answers, which are then read by key like any other.
  KV is eventually consistent, a write seen at once where it was made and within about a minute
  elsewhere, so two imports of a new template in two places within that minute may both ask the
  model; and a key takes one write a second, so the rate store refuses for a second a request
  whose buckets KV will not keep, rather than let it through uncounted. The limit on KV is
  therefore rough: a client that spreads its requests over Cloudflare's locations can outrun it.
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
signatures and the probe's verdicts sent with them are honest: none of those is in the key. A
request that sends a public template's real definitions with invented calls or verdicts gets the
model's reading of them filed under that template's key, for every later import of it, and the
service never files over an answer it holds. The privacy gate (`assertNoText`) runs in the browser,
where the document is; the service never sees a document, only what the browser sends. What bounds a
misleading answer: a reviewed answer wins where one exists; every answer is checked by compiling on
every import (plan section 6.4, item 7), so a wrong one lowers that template's editable rate and
never shows something unsafe as editable; the rate limit bounds how many one address files; and each
answer names its model, so that a bad batch can be found and removed.

### The client

`nameOnService(request, fetchLike = fetch, signal?)` posts the request as JSON to `/v1/name` and
gives back the reply, checked against `NamingReply`; on anything else it throws a
`NamingServiceError` whose message says in plain English what the status means, from the status and
`Retry-After` alone, never the reply's body, and never LaTeX. A cancel through `signal` is thrown as
it comes. Item 12's import screen calls it; nothing in the page changes here.

## Consequences

- The milestone's done line for item 10, an import in the browser hitting the dev server's route and
  the second import of the same template hitting the cache, waits for item 12's import screen to
  call the client; the middleware's test runs the same round trip on a real dev server, and the
  handler's tests the rest: a hit-only request asks the model nothing, a miss asks once and files,
  the same request again is all hits, and no response holds the request's definitions, calls or
  settings.
- Item 9's review fixes reach this branch at its rebase: `answerFor` asked with the macro, so that
  an answer of another kind under the key is a miss; `storedAnswersOf` filling partner keys; and the
  runner filing none of two answers under one key that disagree, where the service files the first.
  The rebase gives both one rule.
- Milestone 5 binds `NAMING_KV` and the key, uploads the committed answers, and decides eviction and
  the audit plan section 6.3 asks for. It puts a stronger limit behind `RateStore`, the Workers
  rate limiting binding or a Durable Object, beside the bot check the milestone names. It picks the
  plan: the free plan's 10 ms of CPU, 50 subrequests and 1,000 KV operations a request do not fit
  a large request's parsing, hashing and model calls, with a KV read a macro and a write an answer,
  where the paid plan's 30 s and 10,000 do; KV's bulk reads would cut the reads on either.
- The discounted batch analysis of the top templates before launch (plan section 6.4) is not here:
  it fills the same cache, by key, from outside the service.
