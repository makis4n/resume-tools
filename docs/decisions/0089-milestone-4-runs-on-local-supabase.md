# 0089. Milestone 4 runs on local Supabase

Date: 2026-10-21 · Status: accepted, the owner's decisions of 5 October 2026, reconfirmed on 20
October 2026; amends AGENTS.md's rule on Docker once item 1 of docs/milestone-4.md lands

## Context

Milestone 4 of the plan (docs/editor-plan.md, section 9) is accounts and cloud save: sign-in, the
document store, sync from the local store, and private storage of originals. Section 8.1 chose
Supabase, used directly from the browser. Hosting is milestone 5, so milestone 4 needs a Supabase
that runs without a hosted project. Supabase's CLI starts its own stack in Docker: Postgres, its
sign-in service, its file storage, its HTTP gateway and a mail catcher. AGENTS.md lists "Using
Docker for development" among the things agents get wrong, and allows Docker only for building the
TeX engines and deploying the ATS.

## Decision

- **Development and CI run against local Supabase**, the CLI's stack in Docker (OrbStack on the
  owner's Mac, Docker on GitHub's runners). No Supabase account and no cloud project is made in
  milestone 4. The hosted project, its region and its costs are milestone 5's.
- **Docker gains a third use**: running the local Supabase stack, started and stopped only through
  the Supabase CLI. Nothing of the editor or the ATS runs in a container for development. Item 1 of
  docs/milestone-4.md amends AGENTS.md's rule in the pull request that adds the stack.
- **The stack's files live in `apps/editor/supabase/`**: `config.toml`, `migrations/` and `tests/`.
  It is the editor's backend, owned by the editor's owner; the ATS never reads it.
- **The proof that a document saved on one device opens on another** is two devices against the
  same local stack: two Node clients with their own stores in the automated test, and two browser
  profiles for the milestone's final check.
- **The plan stops for approval.** docs/milestone-4.md is written and merged, and the owner approves
  it before anything is built.

## Consequences

- A developer working on accounts needs a container runtime and about 2 GB of memory for the stack.
  Work outside accounts does not: the editor's unit tests use a fake of the store's server side,
  and the tests that need the stack skip without it, as tests that need TeX skip without the engine.
- Every behaviour of milestone 4 is proven on a stack that differs from the hosted one in its mail
  (caught locally, never sent), its keys and its limits. Milestone 5 rechecks sign-in and the
  two-account proof on the hosted project.
- AGENTS.md's list of mistakes keeps "Using Docker for development", with the local Supabase stack
  named as the exception.
