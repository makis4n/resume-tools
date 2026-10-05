# The service on Cloudflare Pages

`v1/label.ts` is `POST /v1/label` as a Pages Function: the reading service's handler that labels an
imported PDF's lines (`../src/service/label.ts`, milestone 3 second pass, item 13). The page sends
it the lines' text and features only once the person has agreed (decision 0047); it asks the model
and answers one role a line, and it keeps nothing: no cache is bound, and it logs fixed lines alone.
Its rate limit's buckets are kept in `LABEL_KV` under `label-rate:<address>`. In development the dev
server answers the same route through a middleware (`../scripts/serve-label.ts`), so the page always
calls its own origin. Deploying the function is milestone 5's; this says how it is meant to be
bound.

The first pass's naming route, `POST /v1/name`, and its caches in KV went with the naming step
(decision 00XX). Its namespace was `NAMING_KV`; nothing was ever deployed under that name, so the
label route's namespace is named for it alone.

| Name | Kind | What it is |
|---|---|---|
| `LABEL_KV` | KV namespace | The label route's rate buckets under `label-rate:<address>`, which expire and hold counts alone |
| `SOCLAAS_API_KEY` | Secret | The model's key, a SoCLaaS key (decision 0036), under the name `pdf-model` reads too. Without it the label route refuses with 503 and the page's rules read the PDF |
| `PDF_LABEL_MODEL` | Variable | The label route's model's SoCLaaS id, `qwen3.8:27b` when unset |

Set the key as a secret, never as a plain variable, and never under the `VITE_` prefix, which
would put the key in the page. The client's address comes from `CF-Connecting-IP`; an IPv6 address
is limited by its /48.

The route needs the paid Workers plan, or a Durable Object limiter, at launch: the free plan's day
of KV writes is soon spent, and past it the label route refuses every request it cannot count
(decision 0028, item 13's review).

The folder has its own `tsconfig.json`, with the Workers types and no DOM, which
`pnpm --filter @resume-tools/editor typecheck` checks, and Vite's build never includes it, which
`../scripts/build-output.test.ts` asserts. Pages makes a route of every script here, so no other
script goes in this folder: the code the function runs, and its tests, live under `../src/service/`.
