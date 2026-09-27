# The naming service on Cloudflare Pages

`v1/name.ts` is `POST /v1/name` as a Pages Function: the naming service's handler
(`../src/service/name.ts`) with its cache and its rate limit in KV. In development the dev server
answers the same route through a middleware (`../scripts/serve-naming.ts`), so the page always calls
its own origin. Decision 0028 says why, and what the route answers. Deploying the function is
milestone 5's; this says how it is meant to be bound.

| Name | Kind | What it is |
|---|---|---|
| `NAMING_KV` | KV namespace | The stored answers under `answer:<key>`, kept until milestone 5 decides what is evicted, and each address's rate buckets under `rate:<address>`, which expire |
| `NAMING_API_KEY` | Secret | The naming model's key, Google's for Gemini. Without it the route answers from KV alone and names the macros it could not answer, which the editor locks |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Secret | The same key under the provider's own name, read when `NAMING_API_KEY` is unset |
| `NAMING_MODEL` | Variable | The model's id, `gemini-3.8-flash` when unset |

Set the key as a secret, never as a plain variable, and never under the `VITE_` prefix, which
would put it in the page. The client's address comes from `CF-Connecting-IP`.

KV starts empty. The committed answers under `../corpus/answers/`, which a person reviewed, are
the dev server's first layer; milestone 5 uploads them to `NAMING_KV`, each under `answer:<key>`,
when it deploys the service, so that the launch templates hit a reviewed answer here too.

The folder has its own `tsconfig.json`, with the Workers types and no DOM, which
`pnpm --filter @resume-tools/editor typecheck` checks, and Vite's build never includes it, which
`../scripts/build-output.test.ts` asserts. Pages makes a route of every script here, so no other
script goes in this folder: the code the function runs, and its tests, live under `../src/service/`.
