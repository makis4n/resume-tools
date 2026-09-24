# 0001. Repository layout and working conventions

Date: 2026-09-13 · Status: accepted; the review rule is superseded by 0005

## Context

Two people are building two products that share one moment of contact: the editor produces a PDF and the ATS analyses it. Wai Kin writes TypeScript; Keaen will mostly write Python. The budget is zero and the repository is private on a free GitHub plan.

## Decision

- One monorepo, `resume-tools`, private under makis4n, with keaenlim as collaborator.
- `apps/editor` (TypeScript, Vite, React) is owned by makis4n. `apps/ats` (Python, uv) is owned by keaenlim. `packages/`, `docs/` and `.github/` are owned by both.
- The boundary is a PDF sent over HTTP and a JSON response described by a JSON Schema in `packages/contracts`. The ATS panel lives inside the editor and depends only on the schema.
- Toolchain: pnpm workspaces, Node 24, Biome, TypeScript strict, Vitest; uv, Python 3.12, Ruff, pytest.
- Trunk-based work on short-lived branches, squash merges, Conventional Commits with area scopes, review required across areas and on shared paths, one CI workflow per area with path filters.
- No licence file while private, which means all rights reserved.
- The editor plan lives in `docs/plan.md`, converted from the shared page, which stays the shareable copy.

## Consequences

- `main` is protected on GitHub: pull requests only, with no required approvals and no required status checks. Reviews are not required (decision 0005), and a required check would block merges on pull requests whose paths never trigger that workflow.
- Two toolchains in one repository. Each CI workflow runs only for its own paths, so neither slows the other down.
- Contract changes cost two reviews by design.
