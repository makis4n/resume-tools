# 0096. How CI tests accounts

Date: 2026-10-21 · Status: proposed with docs/milestone-4.md; extends decision 0029

## Context

The editor's workflow fetches the engine and runs the checks, tests and build in 16 to 20 minutes,
and only on changes to the editor, the packages or the root configuration (decision 0029). Accounts
add code whose correctness depends on a real Postgres with row-level security, a real sign-in
service and real file storage. A fake of all of that would not prove the policies; the real stack
in every editor test run would make `pnpm test` need Docker.

## Decision

- **Two layers.** The sync logic is written against a small interface for the server side. Its unit
  tests use an in-memory fake of that interface with fake-indexeddb, run in `pnpm test` everywhere,
  and need no Docker. Everything the fake cannot prove, the policies, sign-in, the mail and the
  files, is tested on the real local stack.
- **A new workflow, `accounts`**, runs on pull requests and on pushes to `main` that touch
  `apps/editor/supabase/**`, the editor's account and storage code, its own file, or the root
  `package.json` and lockfile. It installs with pnpm, starts the stack with the pinned CLI, leaving
  out the services the editor does not use (Studio, Realtime, the edge runtime, logging, the pooler,
  the image proxy and the database admin API), then runs `supabase db lint` with `--fail-on error`,
  `supabase test db`, and the editor's integration tests against the stack.
- **The integration tests** live beside the code as `name.integration.test.ts`, run by a script of
  their own, and skip unless the stack's address is in the environment. They use the browser's
  Supabase client from Node, two fake-indexeddb stores as two devices, and Mailpit's HTTP API to
  read the links that sign-in and reset send.
- **No browser driver.** The editor's DOM tests cover the account screens with the fake, as they do
  the rest of the app. The milestone's final check with two browser profiles is done by hand once.
- **Nothing in CI calls Google or a hosted Supabase**, and nothing needs a secret: the local stack's
  keys are fixed, public development keys.

## Consequences

- A change to accounts runs two workflows, the editor's and this one. The accounts workflow does not
  fetch the engine, so a `.tex` import's original is checked byte for byte after the round trip,
  not compiled.
- Item 1 of docs/milestone-4.md measures how long the stack takes to start on a runner. If the
  workflow takes over ten minutes, the plan is revised before it grows.
- `supabase db lint` without `--fail-on` always passes, so the flag is required.
