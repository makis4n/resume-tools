# 0102. How main reaches production

Date: 2026-10-21 · Status: proposed, with the plan for milestone 5 (docs/milestone-5.md); extends
0029, and amends 0096 on CI and the hosted project

## Context

Decision 0029 left deploys until the engine was on R2: "a Cloudflare Pages job goes into the
editor workflow, building with the production `VITE_` values." Milestone 5 puts three things
online that change at different speeds: the app and its reading route on most merges, the
engine's files when the engine changes, and the database when a migration lands. From launch day
people keep documents in the account, so a careless deploy can lose someone's work.

## Decision

- **The app** deploys from a `deploy` job in the `editor` workflow, on pushes to `main` only,
  after the check, typecheck, test and build steps pass. It builds with the production values,
  every one public: the address of the engine's files, the account service's address and
  publishable key, and Turnstile's site keys. It checks that the files hold the tag the build's
  manifest names, and stops if they do not. It then deploys the Worker and its static assets
  (decision 0101) with `wrangler deploy`. Deploys share one concurrency group that never cancels a
  run in progress, and a run deploys only while its commit is still `main`'s head, so a build
  never replaces a newer one: production only moves forward, as the image does under decision
  0029. A pull request builds as now and never deploys.
- **The engine's files** upload from a `files` workflow started by hand. It runs `fetch-engine`,
  then copies the tag's folder to the R2 bucket through R2's S3 API with the AWS CLI that GitHub's
  runners carry, and refuses when the tag is already in the bucket. A tag stays until no deployed
  build names it; removing one is the owner's.
- **The database** changes from a `database` workflow started by hand on `main`. It first runs
  the `accounts` checks on the local stack for the same commit, then `supabase link
  --project-ref`, `supabase db push --dry-run` into the run's summary, `supabase db push`,
  `supabase config diff` into the summary, and `supabase config push --yes`. No workflow ever
  resets the hosted database.
- **Only the `database` workflow reaches the hosted project.** That amends decision 0096's
  "Nothing in CI calls Google or a hosted Supabase, and nothing needs a secret": no check workflow
  calls the hosted project or holds a secret; the `deploy` job and the `files` and `database`
  workflows hold the secrets below.
- **Secrets** for these jobs are Actions secrets: a Cloudflare API token limited to Workers and R2
  on the account, R2's S3 access keys, Supabase's access token, the database password and the
  project's ref, the SMTP password, Google's client secret, and the Turnstile secret the account
  service checks tokens with. The reading route's own secrets, its Turnstile secret, the key that
  hashes addresses and the launch keys for Claude and the school's gateway (decision 0103), are the
  Worker's, set by
  the owner, never in GitHub. None is in the repository, and none has the `VITE_` prefix.
- **Rollback**: Cloudflare keeps the Worker's versions, and `wrangler rollback` or the dashboard
  returns to one; a bad migration is undone by a new migration.
- **When Actions cannot run**, the owner runs the same commands from a clean checkout of `main`
  with the secrets on their own machine; the README lists the commands.
- **From launch day, what is stored is kept.** A change to the `documents` table, the `originals`
  bucket's layout or the browser store's version migrates what is there, in the same pull
  request, with a test. The owner's rule of 7 October 2026, that nothing stored needs migrating,
  ends at launch.

## Consequences

- A merge to `main` that touches the editor reaches people within minutes, so `main` must stay
  releasable, as the README already asks.
- There are no preview deploys. A change is tried under `pnpm dev` against the local stack, and
  the hosted site sees it only after merging; the account service's redirect list holds one
  address.
- The `deploy` job is the repository's first job that holds a production secret. It runs only on
  `main`, after every check, in a job of its own with its own permissions.
- A merged migration can wait unapplied until the owner runs the `database` workflow, whose dry
  run shows what is pending. A deploy whose code needs that migration waits for it; the pull
  request that adds a migration says so.
- The engine's upload, about 490 MB in 28,658 files, runs only when the engine changes, which is
  rare.
- GitHub's billing failure of 21 October 2026 shows what one pipeline costs when it stops; the
  same commands run by hand.
