# 0020. What CI checks, and what it delivers before there is a host

Date: 2026-09-26 · Status: accepted

## Context

Decision 0001 set up one CI workflow per area, each with path filters and each running its area's
checks. Nothing built the editor for production, nothing checked the pull request title that the
squash merge turns into `main`'s history, and nothing checked the rules in AGENTS.md that a machine
could check. The editor's production home needs the engine and TeX Live on R2 first (plan, section
8.2). The ATS host is still open, and the ATS service (decision 0018) is not yet on `main`.

## Decision

- The per-area workflows stay as 0001 set them. The editor's also runs `pnpm build` and keeps
  `apps/editor/dist` as an artifact for 14 days. It is built with no `VITE_` variables, so it is
  for inspection, not for deploying.
- A `repo` workflow with no path filters runs on every pull request. It runs
  `.github/scripts/check-repo.sh`, which fails on a second lockfile, a committed `.env`, an ESLint
  or Prettier config, build output or caches, the corpus's documents, and Python or TypeScript on
  the wrong side of the boundary. It also checks every schema in `packages/contracts` against its
  draft's metaschema, with the tool's dependencies resolved as of a fixed date.
- A `pr-title` workflow checks the title against `<type>(<scope>): <summary>` with the types and
  scopes in AGENTS.md.
- Workflows get a read-only token by default. A job that publishes asks for more itself.
- Every third-party action is pinned to a commit, with its version in a comment. Dependabot opens
  one grouped pull request a month to move the pins.
- Nothing deploys yet. When the engine is on R2, a Cloudflare Pages job goes into the editor
  workflow, building with the production `VITE_` values. When the ATS service is on `main`, an
  `ats-image` workflow builds the image from `apps/ats/Dockerfile` and smoke-tests it on every
  pull request, pushes that same image to `ghcr.io/makis4n/resume-tools-ats` from `main`, tagged
  with the commit and `main`, and keeps the newest five versions. Deploying it anywhere is one more
  job that pulls that image.

## Consequences

- Branch protection still requires no checks. A path-filtered check cannot be required, as 0001
  says, but `repo` and `pr-title` run on every pull request, so they could be.
- The private repository's free plan has 2,000 Actions minutes and 500 MB of package storage a
  month. The new checks take seconds, the build adds seconds to the editor's job, and the
  ATS image, about 50 MB compressed, stays under the storage limit only because old versions are
  deleted.
- A new lockfile type or config file that AGENTS.md forbids has to be added to
  `check-repo.sh` as well, or it goes unchecked.
