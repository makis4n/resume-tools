# 0108. Milestone 5's dependencies

Date: 2026-10-21 · Status: proposed, with the plan for milestone 5 (docs/milestone-5.md); the owner
approves them with the plan, and each is named again in the pull request that adds it

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
- **The provider's code.** SoCLaaS and Gemini come through `@ai-sdk/openai-compatible` and
  `@ai-sdk/google`, already dependencies of `packages/naming`. If the owner picks Workers AI, as
  decision 0103 recommends, **`workers-ai-provider`**, Cloudflare's AI SDK provider over the
  Workers AI binding, MIT licensed, becomes a dependency of the Worker's code and never of the
  page. If it does not fit the AI SDK version the code uses, Workers AI's OpenAI-compatible
  endpoint goes through `@ai-sdk/openai-compatible` instead, with a token as the Worker's secret,
  and nothing is added. Any other provider's package is named in item 5's pull request and
  approved with question 2.
- **Services, not packages**, each in an account the owner opens: the domain, at Cloudflare's
  registrar; Cloudflare's Workers, R2, Durable Objects, Turnstile and Workers AI; the hosted
  Supabase project; the mail provider; Google's OAuth client; and, if it is not Workers AI, the
  model's provider.
- **Already dependencies**: `@supabase/supabase-js`; the `supabase` CLI, whose `link`, `db push`,
  `config push` and `test db --linked` the `database` workflow and item 14 use;
  `@cloudflare/workers-types`; the AI SDK.
- **Not added**: no analytics or error-reporting library, no Turnstile wrapper, no S3 library, no
  browser driver, no Supabase test helper, and no GitHub Action for `wrangler` or the Supabase
  CLI, which run as the pinned development dependencies through pnpm.

## Consequences

- One development dependency for the whole milestone, and at most one more for the Worker, none
  of them in the page's bundle.
- Every check in the repository still runs with none of the services; only the `deploy`, `files`
  and `database` jobs need them.
