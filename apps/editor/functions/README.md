# The naming service on Cloudflare Pages

`v1/name.ts` is `POST /v1/name` as a Pages Function: the naming service's handler
(`../src/service/name.ts`) with its caches and its rate limit in KV. In development the dev server
answers the same route through a middleware (`../scripts/serve-naming.ts`), so the page always calls
its own origin. Decision 0028 says why, and what the route answers. Deploying the function is
milestone 5's; this says how it is meant to be bound.

| Name | Kind | What it is |
|---|---|---|
| `NAMING_KV` | KV namespace | The stored answers under `answer:<key>`, a model's for 90 days and a person's reviewed one for good, each with who filed it as its metadata (`filedAt`, `model`, and `by`, the SHA-256 of the filing address's key); the preambles' answers under `preamble:<key>`, for 90 days; and each address's rate buckets under `rate:<address>`, which expire. Nothing is ever filed over what a key holds |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Secret | The naming model's key, Google's for Gemini, under the provider's own name, which the corpus runner reads too. Without it the route answers from KV alone and names the macros it could not answer, which the editor locks |
| `NAMING_MODEL` | Variable | The model's id, `gemini-3.8-flash` when unset |

Set the key as a secret, never as a plain variable, and never under the `VITE_` prefix, which
would put the key in the page. The client's address comes from `CF-Connecting-IP`; an IPv6 address
is limited by its /48.

KV starts empty. The committed answers under `../corpus/answers/`, which a person reviewed, are
the dev server's first layer; milestone 5 uploads them to `NAMING_KV`, each under `answer:<key>`
with no expiry, when it deploys the service, so that the launch templates hit a reviewed answer
here too, which no model's answer is ever filed over. A bad batch of the model's is found by
listing the `answer:` keys with their metadata, by its time, its model or its filer, and removed.

The route needs the paid Workers plan, or a Durable Object limiter, at launch: the free plan's
day of KV reads and writes is spent by about a thousand imports, and past it the limit lets every
request through uncounted and nothing is filed (decision 0028).

The folder has its own `tsconfig.json`, with the Workers types and no DOM, which
`pnpm --filter @resume-tools/editor typecheck` checks, and Vite's build never includes it, which
`../scripts/build-output.test.ts` asserts. Pages makes a route of every script here, so no other
script goes in this folder: the code the function runs, and its tests, live under `../src/service/`.
