# 0101. The editor online

Date: 2026-10-21 · Status: proposed, with the plan for milestone 5 (docs/milestone-5.md); revises
plan section 8.1's hosting row, as 0028 asked; replaces 0028's Pages Function and 0029's Pages job
with a Worker; amends 0010 on where the manifest lives and 0094 on third-party scripts

## Context

Until milestone 5 the editor runs only under `pnpm dev`, whose server serves the engine's files
under `/engine/` and answers `POST /v1/label`. The plan puts the app, the engine's files and the
reading route on Cloudflare (sections 8.1 and 8.2); decision 0028 put the route beside the app as
a Pages Function, and decision 0029 planned a Pages job. Cloudflare now tells new projects, "If you
are starting a new project, use Workers instead of Pages", and the route's rate limit needs a
Durable Object on the free plan (decision 0103), which only a Worker's own script can define.

## Decision

- **One domain**, the owner's, written `<domain>`.
- **One Worker** at `https://<domain>`, configured in `apps/editor/wrangler.jsonc`. Its static
  assets are the Vite build, with every unknown path answered by `index.html`. Only `/v1/*` runs
  its code, whose entry answers `POST /v1/label` with `handleLabel` (`src/service/label.ts`), as
  the Pages Function did; `functions/` goes. The same script defines the route's Durable Object
  (decision 0103), and its observability is off.
- **The engine's files** live in an R2 bucket served on `files.<domain>`, a custom domain in the
  same Cloudflare account, under the tagged paths the dev server serves (`src/engine/urls.ts`),
  with `Cache-Control: public, max-age=31536000, immutable`, compressed in transit. A cache rule on
  the subdomain caches every file, since Cloudflare's cache otherwise skips `.wasm`, `.json` and
  most of TeX's extensions. The bucket's CORS allows the app's origin, and `http://localhost:4173`
  for `vite preview`; the files are public, so a second origin opens nothing.
- **The engine's base address** is a build variable, listed in `apps/editor/.env.example`,
  `/engine/` when unset, which is the dev server's. The manifest that names the tag ships with the
  app, so a deployment names the tree it was built and tested with; decision 0010 kept it
  untagged beside the files, revalidated on every load, and it is still revalidated, now as one of
  the app's files.
- **No COOP and no COEP**: the engine uses no `SharedArrayBuffer`, and its synchronous requests
  need none.
- **`_headers`** for the static assets sets a Content Security Policy that allows scripts, styles,
  workers, frames and connections from the app and from `files.<domain>`, the project's Supabase
  address and `challenges.cloudflare.com` alone, with `'wasm-unsafe-eval'` for the engine, `blob:`
  for the pictures the PDF review draws, and `frame-ancestors 'none'`, `object-src 'none'` and
  `base-uri 'none'`; `Cache-Control`, immutable for hashed assets and revalidated for `index.html`
  and the manifest; `X-Content-Type-Options: nosniff`; and
  `Referrer-Policy: strict-origin-when-cross-origin`. The route sets its own headers in code,
  since `_headers` does not reach what a Worker's code answers.
- **No other origin**: no analytics, no outside fonts, no error reporting. Turnstile's script is
  the only one not ours, fetched only when a check is needed. That amends decision 0094's "The
  editor runs no third-party script, and keeps it that way": Cloudflare already serves every byte
  of the editor, so its script adds no new party to trust with the session in local storage.
- **Who it is for**: current desktop Chrome, Firefox and Safari. A narrow window gets a plain note
  that editing needs a larger screen.

## Consequences

- Requests for static assets are free and unlimited and run no code, so only the reading route
  counts against the free plan's 100,000 requests a day and its 10 ms of CPU a request.
- The engine's files cannot be the Worker's assets: a version holds at most 20,000 files of at most
  25 MiB, and the tree has 28,658 files beside a 30 MB binary. R2 holds them, about 0.5 GB a tag,
  well inside its free 10 GB.
- The worker's synchronous requests now cross to another origin, and every TeX file a cold start
  reads is one request to the nearest Cloudflare location.
- A Content Security Policy is new to the editor and may break a path no test drives; the
  milestone's items 3 and 18 walk every path with the console open.
- Section 8.1's row becomes, if the owner revises it: "Cloudflare: a Worker with static assets for
  the app and its reading route, a Durable Object for the route's rate limit, R2 for the engine,
  fonts and TeX Live files".
