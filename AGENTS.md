# AGENTS.md

Rules for AI coding agents working in this repository. Humans have the full version in
[README.md](README.md); this is the short version an agent must follow. When the two disagree,
README.md wins and this file has a bug.

## What this repository is

One monorepo, two products, two owners:

- `apps/editor`: a browser editor for LaTeX resumes (TypeScript, Vite, React). Owner @makis4n.
- `apps/ats`: an applicant-tracking-system simulator and resume optimiser (Python, uv). Owner @keaenlim.
- `packages/contracts`: JSON Schemas for what crosses between them. `packages/resume-model`: the
  editor's resume data model (Zod). `docs/`: the plan and decision records. Owned by both.

The only link between the two products: the editor sends a PDF to the ATS over HTTP
(`POST /v1/analyze`) and shows the JSON reply, whose shape is `packages/contracts/ats/v1/analysis.schema.json`.

## Before you touch anything

- Read `docs/plan.md` before changing anything architectural in the editor. Its decisions table is
  authoritative; do not re-decide settled questions in code.
- Read the relevant `docs/decisions/` files. If your change contradicts one, write a new decision
  record in the same pull request instead of diverging silently.
- Work on a branch. Never commit to `main`.

## Branches

- One branch per topic, named `<person>/<topic>`, using the name of the person you are working for:
  `waikin/overlay-editor`, `keaen/pdf-text-layer`.
- Short-lived: open the pull request as soon as the change works, and keep it small enough to read
  in ten minutes. Split anything bigger.
- Never force-push `main`. Never rewrite history on a branch someone else has pulled.

## Commits

Conventional Commits with the area as scope:

```
<type>(<scope>): <imperative summary, lower case, no trailing period>
```

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`.
- Scopes: `editor`, `ats`, `contracts`, `model`, `docs`, `repo`.
- Examples: `feat(editor): open a field by clicking its glyph`, `fix(ats): handle PDFs with no text
  layer`, `docs(repo): record the hosting decision`, `chore(repo): bump biome`.
- The pull request title follows the same rule, because the squash merge uses it as the commit
  message on `main`.

## Pull requests

- Fill in `.github/PULL_REQUEST_TEMPLATE.md`, including the area checkboxes.
- CI must be green. CI runs exactly the commands listed below, so run them first.
- Squash merge only. Do not merge on someone's behalf unless they asked.

## Commands that must pass

TypeScript, from the repository root:

```sh
pnpm install
pnpm format       # Biome, fixes formatting and safe lint issues
pnpm check        # Biome, must be clean
pnpm typecheck
pnpm test
```

Python, inside `apps/ats`:

```sh
uv sync
uv run ruff format .
uv run ruff check --fix .
uv run pytest
```

Use `pnpm --filter @resume-tools/editor <script>` to run one package, and `uv run` for anything
Python. Do not call `npm`, `npx`, `pip` or a bare `python` in this repository.

## Boundaries you must not cross

- The editor never imports from `apps/ats`. The ATS never imports from `apps/editor`. Sharing
  happens through `packages/` or the HTTP contract, never by reaching across.
- Changing `packages/contracts`: additive changes stay in the current version. A change that would
  break the panel goes in a new version folder (`ats/v2/`) next to the old one.
- `packages/resume-model` is the single definition of resume data. Do not add parallel types for
  the same thing elsewhere.
- Do not move code across the boundary to "share" it. Propose a decision record first.

## Product rules the editor must keep

These come from the plan and are not negotiable in code:

- A user never sees LaTeX. No error, panel, tooltip or fallback shows source.
- Resume content stays in the browser, except when the user saves it to their account or sends
  a PDF to the ATS. The template-import pipeline sends only macro definitions and placeholdered
  call sites to the language model, never the resume's text.
- The page the user edits is the real TeX output. Do not replace it with an approximation.

## Code conventions

- TypeScript strict, ES modules, `import type` for types. Formatting is Biome's: two spaces,
  double quotes, 100 columns. Never hand-format against it; run `pnpm format`.
- Python: Ruff with rules `E F I UP B`, 100 columns, type hints on public functions.
- Tests live next to the code as `name.test.ts`, or under `apps/ats/tests/`. A bug fix comes with
  the test that would have caught it.
- Vite only exposes environment variables prefixed `VITE_`. Every variable an app reads is listed
  in that app's `.env.example`.

## Secrets

- Never commit a `.env` file, a key, a token or a password, anywhere, including commit messages,
  documentation and test fixtures.
- Never paste real resume content into tests, fixtures or examples. Invent it.

## Things agents get wrong here

- Adding ESLint or Prettier. Biome is the only TypeScript formatter and linter.
- Adding a second package manager or lockfile: no `package-lock.json`, `yarn.lock`,
  `requirements.txt`, `poetry.lock`.
- Putting Python under `apps/editor` or TypeScript under `apps/ats`.
- Committing `node_modules`, `dist`, `.venv` or caches.
- Adding a dependency without naming it in the pull request description.
- Changing the Node or Python version pins without a decision record.
- Using Docker for development. It is for building the TeX engines and for deploying the ATS,
  nothing else.
- Editing `docs/plan.md` beyond fixing a typo. It mirrors a shared page; substantive changes go
  through the owner.

## Before you say you are done

1. Formatter, lint, typecheck and tests pass for every toolchain you touched.
2. The pull request template is filled in, with the area ticked.
3. Any new dependency is named in the description.
4. Any decision is recorded in `docs/decisions/`.
5. Nothing was pushed to `main`.
