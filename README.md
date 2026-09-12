# resume-tools

Two tools for job seekers, in one repository.

| Part | Where | Language | Owner | What it is |
|---|---|---|---|---|
| Editor | `apps/editor` | TypeScript | @makis4n | A browser editor for LaTeX resumes: you edit the typeset page directly and never see LaTeX. The plan is in [docs/plan.md](docs/plan.md). |
| ATS | `apps/ats` | Python | @keaenlim | An applicant-tracking-system simulator and resume optimiser. It takes a finished PDF and returns an analysis. |

The two meet in exactly one place. The editor sends a PDF to the ATS service over HTTP and shows the result in a panel. The shape of that request and response is the contract in `packages/contracts`, and both of us own it.

## Layout

```
apps/
  editor/               the web app (Vite + React)            owner: @makis4n
    src/features/ats/   the panel that calls the ATS service   owner: both
  ats/                  the ATS service (Python, uv)           owner: @keaenlim
packages/
  contracts/            JSON Schemas for what crosses between the two   owner: both
  resume-model/         the editor's resume data model (Zod)  owner: @makis4n
docs/
  plan.md               the editor plan, converted from the shared page
  decisions/            short records of decisions, one file each
.github/                CODEOWNERS, CI, pull request and issue templates
```

## Getting started

You need Node 24, pnpm 11 and uv. `.node-version` and `apps/ats/.python-version` pin the runtimes. `corepack enable` gives you the right pnpm, and uv fetches its Python by itself. Docker is not needed for development; it comes in later for building the TeX engines and for deploying the ATS service, and any Docker-compatible runtime works, such as Docker Desktop, OrbStack or Colima.

Editor, from the repository root:

```sh
pnpm install
pnpm dev            # the editor at http://localhost:5173
pnpm check          # Biome: formatting and lint for the whole repo
pnpm format         # the same, fixing what it can
pnpm typecheck
pnpm test
```

ATS:

```sh
cd apps/ats
uv sync                                          # creates .venv with everything, dev tools included
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

CI runs exactly these commands. If they pass on your machine they pass there.

## Ownership

`.github/CODEOWNERS` maps every path to an owner, and GitHub asks the owner of whatever a pull request touches for a review. In short: you own your app, we both own the contract, the docs and the root configuration. Working in the other person's area is fine; it just means they review it.

## How we work

**Branches.** `main` is always releasable and is protected on GitHub: changes reach it through pull requests only. The repository owner can bypass that, and that is reserved for emergencies. Work happens on short-lived branches named `<you>/<topic>`, for example `waikin/overlay-editor` or `keaen/pdf-text-layer`.

**Pull requests.** Every change to `main` goes through a pull request, squash-merged, with CI green. A review is required when a change touches the other person's area, `packages/`, `docs/decisions/` or `.github/`. Changes inside your own app can be self-merged once CI passes. Keep a pull request small enough to read in ten minutes, and split it otherwise.

**Commits.** [Conventional Commits](https://www.conventionalcommits.org/), with the area as scope: `feat(editor): open a field by clicking its glyph`, `fix(ats): handle PDFs with no text layer`, `chore(repo): bump biome`. Scopes are `editor`, `ats`, `contracts`, `model`, `docs` and `repo`. The squash-merge title follows the same rule, because that is what ends up in history.

**Formatting and lint.** Biome for TypeScript, from the one `biome.json` at the root. Ruff for Python, from `apps/ats/pyproject.toml`. Both run in CI. Run `pnpm format` or `uv run ruff format .` before pushing and there is nothing to argue about.

**Tests.** Vitest for TypeScript, with test files next to the code as `name.test.ts`. pytest for Python, under `apps/ats/tests/`. A change that fixes a bug comes with the test that would have caught it.

**Secrets.** Never commit a `.env` file. Each app has a `.env.example` listing what it reads; copy it to `.env` and fill it in. Keys for hosted services live in GitHub Actions secrets or at the hosting provider, never in the repo.

**Decisions.** Anything we would otherwise re-argue in three months gets a short file in `docs/decisions/`, numbered, using `docs/decisions/template.md`. The first one records how this repository is set up.

**Issues.** GitHub Issues, one per task or bug, labelled `area:editor`, `area:ats` or `area:shared`. The templates in `.github/ISSUE_TEMPLATE` ask for the area.

## The boundary between editor and ATS

- The ATS service exposes `POST /v1/analyze`, takes a PDF as multipart form data, and returns JSON that validates against `packages/contracts/ats/v1/analysis.schema.json`.
- The panel in `apps/editor/src/features/ats` depends on that schema and on nothing else inside the ATS. The ATS never imports from the editor.
- Changing the contract is a pull request that both of us review. Additive changes are fine within `v1`. Anything that would break the panel becomes `v2` next to it, and `v1` stays until the panel has moved.
- Locally the ATS runs at `http://localhost:8000` and the editor reads its address from `VITE_ATS_SERVICE_URL`.

## Hosting

The editor is planned for Cloudflare Pages and Workers, with sign-in and saved resumes on Supabase; the reasoning and the costs are in the plan. The ATS service needs a Python host, which in practice rules out Cloudflare Workers. Where it runs is its owner's call and is not decided yet.

## Documents

- [docs/plan.md](docs/plan.md): the editor's version-one plan. The shareable page version is at https://claude.ai/code/artifact/c9403706-378d-475b-8599-48f4b0c6f569.
- [docs/decisions/](docs/decisions/): the decision records.
