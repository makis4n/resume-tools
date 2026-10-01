# resume-tools

Two tools for job seekers, in one repository.

| Part | Where | Language | Owner | What it is |
|---|---|---|---|---|
| Editor | `apps/editor` | TypeScript | @makis4n | A browser editor for LaTeX resumes: you edit the typeset page directly and never see LaTeX. The plan is in [docs/editor-plan.md](docs/editor-plan.md). |
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
  naming/               the import's naming step: request, prompt, model call   owner: @makis4n
docs/
  editor-plan.md        the editor plan, converted from the shared page
  ats-prd.md            the ATS product requirements
  decisions/            short records of decisions, one file each
.github/                CODEOWNERS, CI, pull request and issue templates
```

## Getting started

You need Node 24, pnpm 11 and uv. `.node-version` and `apps/ats/.python-version` pin the runtimes. `corepack enable` gives you the right pnpm, and uv fetches its Python by itself. Docker is not needed for development; it comes in later for building the TeX engines and for deploying the ATS service, and any Docker-compatible runtime works, such as Docker Desktop, OrbStack or Colima.

### The editor

From the repository root:

```sh
pnpm install
pnpm --filter @resume-tools/editor fetch-engine   # the TeX engine and TeX Live: about 290 MB to download, 850 MB on disk
cp -n apps/editor/.env.example apps/editor/.env   # settings, all optional; see below
pnpm dev                                          # the editor at http://localhost:5173
```

The dev server does more than serve the page. It serves the TeX engine's files from `apps/editor/.engine/` and answers the naming route that imports call, `/v1/name`, so until milestone 5 hosts both, the editor works fully only under `pnpm dev`: a production build keeps documents but cannot draw their pages. `http://localhost:5173/?measure=1` shows the timing page in place of the editor (decision 0016).

Every setting in `apps/editor/.env` is optional, and the editor runs with none:

- `VITE_ATS_SERVICE_URL`: where the ATS panel will send PDFs, `http://localhost:8000` for the ATS service below. Nothing in the editor calls it yet.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: for accounts, which come in milestone 4. Leave them empty.
- The naming model's key and `NAMING_MODEL`, below. Without a key the naming route answers only from the answers already stored, and the dev server says so when it starts.

After you pull, run `pnpm install` and the `fetch-engine` line again, then restart `pnpm dev`. The fetch does nothing when the engine is current and rebuilds it when its layout changed, and a dev server left running does not see new workspace packages: it fails with "Cannot find package '@resume-tools/…'".

Checks, from the repository root:

```sh
pnpm check          # Biome: formatting and lint for the whole repo
pnpm format         # the same, fixing what it can
pnpm typecheck
pnpm test           # tests that run TeX skip without the engine
pnpm build          # the production bundle in apps/editor/dist
```

### The naming model

Importing a template asks a language model what each of the template's commands is. Only the template's code goes, with placeholders where the resume's text was, never the text itself (decision 0033). The model runs on SoCLaaS, the School of Computing's free LLM gateway for its students and staff (decision 0036), and `apps/editor/.env.example` names the variables the code reads.

1. Log in at https://soclaas-portal.comp.nus.edu.sg with your SoC account and issue a key, or run `soclaas-portal issue` on an SoC server. It is shown once.
2. Put it in `apps/editor/.env` as `SOCLAAS_API_KEY=clsk_...`, and, if you want another model than the default `qwen3.8:27b`, its id as `NAMING_MODEL`; milestone 3's item 18 benchmarks the candidates. Never give either the `VITE_` prefix, which would put the key in the page.
3. Check that the key works, and which models it may use:

   ```sh
   set -a && source apps/editor/.env && set +a
   curl -sS https://soclaas-api.comp.nus.edu.sg/v1/models -H "Authorization: Bearer $SOCLAAS_API_KEY" | jq -r '.data[].id'
   ```

The dev server reads `apps/editor/.env` itself. The corpus scripts read only their environment, so load the file into your shell first with the `set -a` line. CI never has a key.

### The ATS service

```sh
cd apps/ats
uv sync                                          # creates .venv with everything, dev tools included
uv run ats-serve                                 # the service at http://localhost:8000
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

It accepts browser calls from `http://localhost:5173` by default, so it runs beside `pnpm dev` in a second terminal. Its settings and the container build are in [apps/ats/README.md](apps/ats/README.md).

### What CI runs

CI runs exactly the checks above, the editor's and the ATS's. If they pass on your machine they pass there. It also runs three checks on every pull request: `bash .github/scripts/check-repo.sh`, which catches the mistakes listed in AGENTS.md that show in the file list, a check that every schema in `packages/contracts` is a valid schema (the command is in AGENTS.md), and a check that the pull request's title follows the commit convention below (decision 0029).

## Ownership

The tree above names the owner of each path. In short: you own your app, we both own the contract, the docs and the root configuration. Working in the other person's area is fine. `.github/CODEOWNERS` names owners for the two apps only, so a pull request that touches the other person's app requests their review, and one that touches docs, decisions, packages or configuration requests nobody (decision 0034).

## How we work

**Branches.** `main` is always releasable and is protected on GitHub: changes reach it through pull requests only. The repository owner can bypass that, and that is reserved for emergencies. Work happens on short-lived branches named `<you>/<topic>`, for example `waikin/overlay-editor` or `keaen/pdf-text-layer`.

**Pull requests.** Every change to `main` goes through a pull request, squash-merged, with CI green. No review is required, wherever the change lands: you merge your own pull request once CI passes (decision 0005). A change to the other person's app requests their review automatically (decision 0034), but does not wait for it. Keep a pull request small enough to read in ten minutes, and split it otherwise.

**Commits.** [Conventional Commits](https://www.conventionalcommits.org/), with the area as scope: `feat(editor): open a field by clicking its glyph`, `fix(ats): handle PDFs with no text layer`, `chore(repo): bump biome`. Scopes are `editor`, `ats`, `contracts`, `model`, `docs` and `repo`. The squash-merge title follows the same rule, because that is what ends up in history.

**Formatting and lint.** Biome for TypeScript, from the one `biome.json` at the root. Ruff for Python, from `apps/ats/pyproject.toml`. Both run in CI. Run `pnpm format` or `uv run ruff format .` before pushing and there is nothing to argue about.

**Tests.** Vitest for TypeScript, with test files next to the code as `name.test.ts`. pytest for Python, under `apps/ats/tests/`. A change that fixes a bug comes with the test that would have caught it.

**The corpus.** The editor's import is measured on about 220 public resumes, listed in `apps/editor/corpus/` by source and hash and never committed. `.github/workflows/corpus.yml` fetches them and runs the survey, the leak check of every naming request and the import run, which fails when the share of documents that import successfully falls more than a point under `apps/editor/corpus/baseline.json`, or when a successful import lacks the page size, the margins or the font size controls (decision 0040). It runs only when someone starts it: Actions → corpus → Run workflow, or `gh workflow run corpus.yml --ref <branch>`, with the results in the run's summary (decision 0035). A run is worth it before merging a change to the import pipeline, the naming request or its masking, the corpus scripts or manifest, or the engine's TeX Live tree, and most of all a change to what the naming request holds, since the leak check is what shows that no resume text leaves the browser. Whether to run it is the author's call, and it is never required to merge. AI agents suggest a run when their change touches those paths and leave the decision to you. The same steps run locally: `pnpm --filter @resume-tools/editor corpus fetch`, then `corpus survey`, `corpus leak` or `corpus run --committed-only`.

**Secrets.** Never commit a `.env` file. Each app has a `.env.example` listing what it reads; copy it to `.env` and fill it in. Keys for hosted services live in GitHub Actions secrets or at the hosting provider, never in the repo.

**Decisions.** Anything we would otherwise re-argue in three months gets a short file in `docs/decisions/`, numbered, using `docs/decisions/template.md`. The first one records how this repository is set up.

**Issues.** GitHub Issues, one per task or bug, labelled `area:editor`, `area:ats` or `area:shared`. The templates in `.github/ISSUE_TEMPLATE` ask for the area.

## The boundary between editor and ATS

- The ATS service exposes `POST /v1/analyze`, takes a PDF as multipart form data, and returns JSON that validates against `packages/contracts/ats/v1/analysis.schema.json`.
- The panel in `apps/editor/src/features/ats` depends on that schema and on nothing else inside the ATS. The ATS never imports from the editor.
- Changing the contract is a pull request like any other. Additive changes are fine within `v1`. Anything that would break the panel becomes `v2` next to it, and `v1` stays until the panel has moved.
- Locally the ATS runs at `http://localhost:8000` and the editor reads its address from `VITE_ATS_SERVICE_URL`.

## Hosting

The editor is planned for Cloudflare Pages and Workers, with sign-in and saved resumes on Supabase; the reasoning and the costs are in the plan. The ATS service needs a Python host, which in practice rules out Cloudflare Workers. Where it runs is its owner's call and is not decided yet. Until then CI deploys nothing: it keeps the editor's build as an artifact, and will publish the ATS image to GitHub's container registry once the service is on `main` (decision 0029).

## Documents

- [docs/editor-plan.md](docs/editor-plan.md): the editor's version-one plan. The shareable page version is at https://claude.ai/code/artifact/c9403706-378d-475b-8599-48f4b0c6f569.
- [docs/ats-prd.md](docs/ats-prd.md): the ATS product requirements, including its editor integration.
- [docs/decisions/](docs/decisions/): the decision records.
- [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md): the short rules AI coding agents follow here.
