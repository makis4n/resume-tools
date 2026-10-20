# 0097. Milestone 4's dependencies

Date: 2026-10-21 · Status: accepted, approved with the plan by the owner on 21 October 2026; the
owner approves them with the plan, and each is named again in the pull request that adds it

## Context

AGENTS.md asks that every new dependency be named in its pull request. The owner asked that this
plan name every library and tool milestone 4 will need, so they are approved once, with the plan,
before any is added. Nothing is installed by the pull request that adds this record.

## Decision

- **`@supabase/supabase-js`, version 2**, a runtime dependency of `apps/editor`, MIT licensed. It is
  the browser's client for sign-in, the `documents` table and Storage. It is loaded on demand, the
  first time the person opens sign-in or when a stored session exists, so the first load of a
  signed-out person does not grow. It needs Node 22 or later for its own tooling; the repository
  pins Node 24.
- **`supabase`, the CLI**, a development dependency of `apps/editor`, at an exact version, MIT
  licensed, run as `pnpm --filter @resume-tools/editor exec supabase`. The npm package carries the
  CLI's binaries as optional dependencies and runs no install script. A development dependency pins
  one version for every machine and for CI, where a Homebrew install would drift per machine.
  Supabase's own guide recommends it.
- **A container runtime**, not a package: OrbStack on the owner's Mac, Docker on GitHub's runners.
  It runs only the local Supabase stack (decision 0089).
- **Already part of the stack, so no dependency**: Mailpit, the stack's mail catcher, read over its
  HTTP API with `fetch`; pgTAP, which `supabase test db` enables.
- **Already dependencies**: Dexie, fake-indexeddb, fflate (zipping originals), Zod (checking rows
  read from the account against the model), Vitest and jsdom.
- **Not added**: no browser driver such as Playwright, no Supabase test-helper extension, no GitHub
  Action for the CLI (CI runs the pinned development dependency through pnpm), no state or query
  library on top of the client, no generated types package (types are generated into the source by
  the CLI, if they are used).

## Consequences

- One runtime dependency and one development dependency for the whole milestone. The runtime one is
  the editor's first network client beyond `fetch`, and its size counts only for signed-in people.
- Upgrading the CLI is a deliberate change of one exact version, which also moves CI.
- A machine without a container runtime can still run every check but the accounts workflow's.
