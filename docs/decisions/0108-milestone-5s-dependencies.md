# 0108. Milestone 5's dependencies

Date: 2026-10-21 · Status: accepted, approved by the owner on 27 October 2026 with the plan for
milestone 5 (docs/milestone-5.md); the owner approves them with the plan, and each is named again in
the pull request that adds it

## Context

AGENTS.md asks that every new dependency be named in its pull request, and milestone 4 named its
own with its plan (decision 0097), so that the owner approved them once. Milestone 5 puts the
editor online, which needs a deploy tool and several services. Nothing is installed by the pull
request that adds this record.

## Decision

- **`wrangler`**, Cloudflare's command line, a development dependency of `apps/editor` at an exact
  version, licensed MIT or Apache 2.0, run as `pnpm --filter @resume-tools/editor exec wrangler`.
  It deploys the Worker and its static assets from the `deploy` job (decision 0101), sets the R2
  bucket's CORS, and serves the Worker locally with its bindings when an item needs to try the
  headers or the route as Cloudflare runs them. Upgrading it is a change of one exact version, as
  with the Supabase CLI.
- **Turnstile** is a script from `challenges.cloudflare.com`, loaded on demand, and not a package.
  No wrapper library is added for it.
- **The AWS CLI**, which GitHub's runners carry, uploads the engine's files to R2 through R2's S3
  API. It is not added to the repository.
- **The providers' code.** Claude first and the school's gateway behind it, the owner's choice for
  launch (decisions 0103 and 0109), come through `@ai-sdk/anthropic`, which decision 0109 adds to
  `packages/naming`, and `@ai-sdk/openai-compatible`, already a dependency there, so this milestone
  adds nothing for them.
- **Services, not packages**, each in an account the owner opens: the domain, at Cloudflare's
  registrar; Cloudflare's Workers, R2, Durable Objects and Turnstile; the hosted Supabase project;
  Resend, the mail provider; Google's OAuth client; and launch keys for Anthropic's API and the
  school's gateway.
- **Already dependencies**: `@supabase/supabase-js`; the `supabase` CLI, whose `link`, `db push`,
  `config push` and `test db --linked` the `database` workflow and item 14 use;
  `@cloudflare/workers-types`; the AI SDK.
- **Not added**: no analytics or error-reporting library, no Turnstile wrapper, no S3 library, no
  browser driver, no Supabase test helper, and no GitHub Action for `wrangler` or the Supabase
  CLI, which run as the pinned development dependencies through pnpm.

## Consequences

- One development dependency for the whole milestone, and none at runtime.
- Every check in the repository still runs with none of the services; only the `deploy`, `files`
  and `database` jobs need them.
