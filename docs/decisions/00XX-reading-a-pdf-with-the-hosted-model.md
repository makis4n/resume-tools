# 00XX. Reading a PDF with the hosted model, with consent

Date: 2026-10-04 · Status: accepted

## Context

Item 13 of `docs/milestone-3-overhaul.md`: the hosted model replaces the first step of item 12's
reading of a PDF, saying what each line is, for a person who has agreed to send the PDF's text.
The owner chose a hosted model on 3 October 2026 and set its target and time budget on 4 October
(decision 0051): at least 90% of fields right on invented resumes from other tools, within 15 s,
after which the rules answer. It is the first feature built under the one-sentence privacy rule
(decision 0047), so it must ask first, say each time that it sends, and keep nothing. It reuses the
first pass's provider code and service shell (decisions 0028, 0036, 0044).

## Decision

### The page

- **The question** (`src/pdf/consent.ts`, `src/editor/PdfReading.tsx`). Asked the first time a
  person imports a PDF: "Send your PDF's text to the editor's reading service?", with what is sent
  (the text of each line, with its size and place on the page, not the file), what is done with it
  (the editor's reading service passes the lines to a hosted language model, which says what each
  line is, and only that comes back), what is kept (the editor's service keeps none of it, in a
  store or a log, and asks the model to label the lines and nothing more; nothing is promised of
  the model's host, whose keeping the repository does not establish), what a no means (the editor reads it in the browser, less accurately on
  some layouts, and nothing leaves), and where to change it. Two answers, yes or no. Item 14 places
  the question and the one-line notice in the import's flow; this item builds them.
- **The answer is remembered in that browser**, under one key of local storage
  (`resume-tools.pdf-reading.consent`), `yes` or `no`; any other value is no answer. Where the
  storage is missing or refuses, the answer holds for the page's life alone, so the person is asked
  again later and nothing is sent meanwhile.
- **A setting changes it**: a checkbox on the documents screen, beside the way in, on for yes and
  off for no or none. The editor has no settings screen yet, and this is where a person importing
  looks.
- **Each later import says so in one line** while the answer is yes: "This PDF's text is being sent
  to the editor's reading service, which asks a language model to label its lines and keeps none
  of it. You can turn this off under Documents."
- **The labeller** (`src/pdf/model-labeller.ts`) is a `Labeller` for item 12's seam, `by: "model"`.
  It reads the answer afresh on every call, before it builds or sends anything, so turning the
  setting off stops the next import from sending, even with a labeller made earlier. With a yes it
  posts `{ lines: featuresOf(layout) }` to the editor's own origin, `POST /v1/label`, with
  `cache: "no-store"`, and takes the reply only when it is one role from the list for each line.
- **The rules answer for each cause**, through `labelLines`, which keeps the cause: `no consent`
  (no yes on record: nothing sent), `unreachable` (no network), `busy` (429), `not set up` (503, no
  model), `too long` (400 or 413), `failed` (any other refusal, 500 or 502 among them), `timeout` (no reply read within 15 s from the call's start, the owner's budget, or the service's
  own 504), and `wrong form` (a 422 from the service, a reply that is not JSON, or not one role from
  the list for each line). A stop the caller asks for is the caller's, and not a fallback. A
  labeller says why it gives no answer by throwing `LabellerFallback(reason)`; anything else it
  throws is `failed`. `whoRead(labels)` says in one sentence, for item 14's review, which read the
  PDF and why the rules did, a sentence a cause. A line's text is sent cut to its first 2,000
  characters (`labelText`, the contract's most), since a role needs a line's start and one long
  paragraph joined from many rows would otherwise make the whole request refused.

### The service

- **One handler, two hosts**, as decision 0028's: `handleLabel(request, deps)`
  (`src/service/label.ts`), written against the fetch API, served by the dev server's middleware
  (`scripts/serve-label.ts`, beside `/v1/name`, which item 17 removes) and by a Pages Function
  (`functions/v1/label.ts`). The dev server's request and response conversion moved to
  `scripts/serve-fetch.ts`, which both routes share, so that item 17 can delete the naming route
  alone.
- **The contract** (`src/service/label-contract.ts`): the request is `{ lines }`, each line exactly
  `Features` (its id, text, page, column, indent, width, size, weights, bullet, row, rule, gap,
  links and rows), 1 to 2,000 lines, each text at most 2,000 characters, each id once; a field the
  contract has not is refused. The reply is `{ roles }`, one of `ROLES` a line, in the lines'
  order. The closed list and `Features` moved to `src/pdf/roles.ts`, which imports nothing, so the
  service takes them without the layout's code; `label.ts` re-exports them.
- **The model**: SoCLaaS's `qwen3.8:27b` by default (decision 0044), made by the first pass's
  provider code (`soclaasModel`, thinking off), the id from `PDF_LABEL_MODEL`. It is told the lines
  as a table (the spike's prompt, moved to `src/service/label-model.ts`, which the spike now
  imports) and answers through a JSON schema response format whose keys are the lines' ids and
  whose values are the roles' enum, with no other key: a reply in the schema's form is valid by
  construction. It is still checked (`rolesOf`): a reply with a role off the list, a line left out,
  a key no line has, or no JSON is refused with 422. One call, no retry, at temperature 0, stopped
  at 14 s so the route answers before the page's 15 s run out.
- **The order of a request's checks**: method (405), content type, JSON alone (415, so a page on
  another site cannot post with a simple request), the address's rate limit (429 with
  `Retry-After`), the body read no further than 512 KiB (413), UTF-8 and JSON (400), the contract
  (400, its problems named by path in the schema's words, never a value), no model (503), then the
  call: 200, 422 for a reply of the wrong form, 502 for a provider that failed, 504 past 14 s, 500
  for anything else.
- **The key** is `SOCLAAS_API_KEY`, the naming route's, read on the server side alone: by Vite's
  `loadEnv` with the prefixes `SOCLAAS_` and `PDF_LABEL_` in development and from the function's
  environment on Pages; never a `VITE_` variable. `scripts/build-output.test.ts` builds the page
  with invented values in all three variables and finds none of them in it. Without a key the route
  refuses with 503 and the page's rules read the PDF.
- **The rate limit** is decision 0028's (`rate.ts`): ten requests a minute, a hundred a day and two
  million characters of prompts a day an address, IPv6 by its /48; the prompt's characters are
  taken before the call. Its buckets are kept apart from the naming route's: in memory in the dev
  server, and in `NAMING_KV` under `label-rate:<address>` on Pages. Each request is counted in one
  write of its address's buckets, its prompt's characters with it, since KV takes one write a key a
  second. Unlike 0028's, it fails closed: a request the store cannot count, a write KV refuses
  within a second among them, is refused with 429 and the model is not asked, so a burst cannot
  outrun the limit. A PDF with no lines sends nothing.

### The privacy rule, applied

| | |
|---|---|
| What the person asks for | Read this PDF, with the model |
| What they are told | the question above, once; the one line, each import while yes |
| What is sent | each line's text and its features, as `featuresOf` gives them; not the file, not its links' addresses, not the document |
| To whom | the editor's own service, which sends the same table to the hosted model and nothing else |
| What the editor's service keeps | nothing |
| What the model's host keeps | not established here: the launch provider's question (plan section 8.3), so the person is told only that the text goes to a hosted language model |

- **Nothing before a yes.** The labeller reads the answer before it builds the request; with no
  answer, a no, a value that is not an answer, or a storage that refuses, it throws `no consent`
  and `fetch` is never called. Tests: "nothing is sent to the model before a yes" and "nothing is
  sent after the setting is turned off", each with a stubbed `fetch` that counts calls, once on the
  labeller and once through the question and the documents screen's setting in the DOM.
- **No cache.** The handler has no cache among its dependencies, and nothing it is sent or the model
  says is written anywhere; its replies say `Cache-Control: no-store`. The rate store holds an
  address's four counts and a time. A test runs the handler on every path (an answer, a wrong
  form, a provider's failure quoting the text, an unexpected failure quoting it, a store that
  throws) with a Workers-style `caches` that must not be opened, and a store that records each
  write: no cache is touched, and every write is the address's counts.
- **No log of text.** The handler logs fixed lines, a failure by its kind or its class alone; a
  refusal is a fixed sentence. The same test spies on the log and on every `console` method and
  finds none of the invented lines' text in any of them, nor in any refusal's body.
- **The model's provider**: the school's gateway during development (decision 0044), on which
  SoCLaaS is billed nothing; who provides it at launch, and on what terms of keeping, stays the
  plan's question (section 8.3), as the overhaul's decisions say. What the model's host keeps of
  what it is sent is part of that question; until it is settled, the words the person reads promise
  only what the editor's own service does, and name the hosted model as a receiver (item 13's
  review).

### The model's numbers

Measured by hand, with the key from the keychain, on the invented sets alone, by
`pnpm --filter @resume-tools/editor pdf-model other|builtin --passes 3` (`scripts/pdf-model.ts`).
It runs the code the editor ships: the page's labeller with a yes on record and its 15 s budget,
posting to `handleLabel` in the same process, which asks SoCLaaS; then the rules' filing step and
decision 0051's score. Every path it reads passes the spike's guard (`assertInvented`) before the
file is read, so no corpus resume, nor anything made from one, is sent. Runs of 4 October 2026.

**Invented resumes from other tools** (set iii, eight PDFs, 211 fields)

| Fixture | Lines | Fields | Three passes |
|---|--:|--:|--:|
| `chrome-icons` | 28 | 26 | 26, 26, 26 |
| `chrome-one-column` | 30 | 29 | 27, 27, 27 |
| `chrome-sidebar` | 39 | 33 | 33, 33, 33 |
| `chrome-table` | 29 | 29 | 29, 29, 29 |
| `textedit-rtf` | 23 | 24 | 24, 24, 24 |
| `textutil-html` | 13 | 22 | 22, 22, 22 |
| `chrome-right-sidebar`, held out | 26 | 27 | 21, 21, 21 |
| `textutil-table`, held out | 12 | 21 | 20, 20, 20 |
| **All eight** | | 211 | **95.7, 95.7, 95.7%** (202) |

Target, at least 90%: **met**, by 5.7 points, against 92.4 to 94.3% in the spike, whose calls ran
at the gateway's default temperature; at 0 the three passes agree. The rules read 91.9% (194) of
the same set. The two held out read 41 of 48 (85.4%); the misses there are the ones decision 0051
names, a sidebar's `Skills` heading and two lines holding a date and a place together, which the
filing step the rules share keeps as text.

**The editor's own PDFs** (set i, the three built-in templates each typesetting the three curated
samples, nine PDFs, 345 fields; not the target's set, measured beside it)

| Template | Fields | Three passes |
|---|--:|--:|
| Jake's Resume | 115 | 115, 115, 115 |
| AltaCV | 115 | 111, 111, 111 |
| Awesome-CV | 115 | 104, 104, 104 |
| **All nine** | 345 | **95.7, 95.7, 95.7%** (330) |

The spike's model read 96.5, 95.9 and 96.2% here, and the rules 96.5%: on the editor's own PDFs the
rules are as good, and most misses of both are Awesome-CV's, which sets the employer above the
role (decision 0051).

**Time and failures.** Every call answered: 51 calls on the two sets, 24 on set iii in 1.9 to
6.5 s (median 3.9 to 4.3 s a pass) and 27 on set i in 3.6 to 8.0 s (median 6.8 s), each timed from
the labeller's start to the roles taken, through the route. No call ran past the 15 s budget, none
failed, and none fell back to the rules. The spike's one failed call hung for 70.3 s; such a call
now costs the person 15 s, after which the rules answer.

The suite tests the path with a recorded reply: the model's answer for `chrome-table`, its raw
content (roles by line id, no text), kept as `src/pdf/fixtures/model-reply.chrome-table.json`, is
given by the AI SDK's mock model to the route, which the page's labeller posts to; the PDF read and
filed scores at least 90%. No model is called in CI.

## Consequences

- Item 14 places the question before a person's first PDF import (`needsAsking`), the one-line
  notice on each import while yes, and `whoRead(labels)` in the review, and builds the labeller
  with the app's `browserConsent()` store, the same the documents screen's setting writes.
- Item 15's hand-run command for the model's reading is `pdf-model`; the spike's `--model` path
  stays as it was for its own results.
- Item 17 removes `/v1/name` and its function; the label route, `serve-fetch.ts`, the rate limit,
  the key's handling and the provider code stay. `NAMING_KV` then holds only the label route's
  buckets and may be renamed with milestone 5's hosting.
- The editor's `ai` package, a development dependency that the service shell already used through
  `@resume-tools/naming`, is now imported by the service's own code, `label-model.ts`; it is bundled
  into the function at deploy as before. No dependency was added or moved.
- An open route that calls a model costs per call: the rate limit bounds an address, not a crowd of
  them; a bot check and the hosting are milestone 5's, as the overhaul's risks say.
- The resume's text in a line could carry words aimed at the model. Its answer is held to the
  closed list by the schema and by the check, so the worst it can do is mislabel that PDF's lines,
  which the review shows and the person can correct.
