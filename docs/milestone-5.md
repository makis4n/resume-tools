# Milestone 5: launch

Written 21 October 2026, for the owner's approval before anything is built. Each numbered item is
one pull request, or a few if it grows past ten minutes of reading. Tick the item in the pull
request that finishes it.

## The goal

The plan (docs/editor-plan.md, section 9) sets milestone 5 as: "Polish, the model endpoint hosted
with a bot check and its provider settled, the corpus number published internally as the import
quality metric, and accounts online: the hosted Supabase project, a mail provider for sign-in and
reset, Google sign-in (decision 0094), deleting an account (decision 0095), and a cap per account
on originals." It sets no done-check. This plan proposes one:

> A person who has never seen the editor opens its address in a current desktop browser, makes a
> resume from a built-in template or imports their own, downloads its PDF, saves it to a new
> account, opens it on a second device, and deletes the account, leaving nothing of it behind. A
> PDF's lines are read by Claude, or by the school's gateway when Claude gives no answer, behind a
> bot check, and the editor's own service keeps none of their text. The import's quality number is
> published where both owners read it.

Unlike milestone 4's plan, this one was written before the owner settled anything. Every choice in
it is a proposal. The ones that spend money, need an account only the owner can open, or speak for
the project are the owner's, gathered under "What the owner settles" with a recommendation each.
As in milestones 3 and 4, the work stops at the plan: this file and its decision records are
merged, and the owner approves them before a build starts.

## What the owner settles

Seven questions; the owner settled the second on 21 October 2026. Items that wait on an answer
say so.

1. **A domain of our own.** Recommended: buy one, about $10 a year at cost through Cloudflare's
   registrar; the name is the owner's. In practice it is not optional. Mail providers send to
   strangers only from a domain whose DNS they can check, and the account service's own sender
   mails only the project's team. R2's `r2.dev` address is rate-limited and meant for development,
   so the engine's files need a custom domain in the same Cloudflare account. And Google shows an
   app's name on its consent screen only after brand verification, which needs a home page and a
   privacy page on a domain the owner has verified in Google's Search Console.
2. **Who reads a PDF's lines at launch**, the plan's open question (sections 6.4 and 11).
   **Settled by the owner on 21 October 2026: Claude first, the school's gateway behind it**
   (decision 0109). Anthropic's Claude Haiku 5.5 reads a PDF's lines, and SoCLaaS, the school's
   gateway, with `qwen3.8:27b`, reads them when Claude gives no answer. Haiku read 95.7% of fields
   right on invented resumes from other tools, as `qwen3.8:27b` did (decisions 0064 and 0109), at
   about 2 s a call; it is paid from the owner's $200 of Anthropic API credit, well under a tenth
   of a cent a PDF, and the gateway bills nothing. Both run in development. The owner chose the
   gateway alone first, the same day, and put Claude in front of it to spend the credit. The owner
   set aside what either provider keeps, and the school's leave that section 6.4 asks for, so
   neither waits for launch. Workers AI is not used.
3. **Supabase's plan.** Recommended: Free while the milestone builds, Pro ($25 a month, its spend
   cap on) from launch day. A Free project pauses after a week of low activity and signs nobody in
   until the owner resumes it; it keeps no backups, so one mistake loses people's documents for
   good; and the leaked-password check is Pro's. Pro never pauses, keeps a daily backup for seven
   days, and grows file storage from 1 GB to 100 GB.
4. **The project's region**, near most of the people expected. Supabase offers 17, Stockholm,
   Frankfurt, London and Singapore among them. A region is chosen when the project is made;
   moving means a new project. Cloudflare serves the app and the engine from the location nearest
   each person wherever the project is, so only the account service's distance depends on this.
5. **The mail provider.** Recommended: **Resend**, free for 3,000 emails a month and 100 a day, $20
   a month for 50,000. It is on Supabase's list of providers and has a guide for exactly this.
   Postmark (100 a month free), Amazon SES ($0.10 per 1,000, once out of its sandbox) and Brevo are
   the alternatives. Each needs the domain.
6. **Our own engine build and a newer TeX Live.** Milestone 2 left the per-engine build to this
   milestone ("it changes size and licensing, not behaviour"), and decision 0011 a newer TeX Live
   with it. Recommended: after launch. Behaviour does not change; the first load was about 14 MB
   compressed against the 30 MB target, which items 2 and 3 measure from the CDN; and the licences
   page names the sources of the BusyTeX release the editor ships. It is the heaviest engineering
   item in the plan (section 8.4).
7. **Who sees it first.** Recommended: the address stays unlisted, shared by the owners alone,
   until item 19's check passes; then the owner decides when to tell anyone.

What it costs on the recommended choices:

| What | Cost | When paying starts, or grows |
|---|---|---|
| The domain | about $10 a year | at once |
| Cloudflare: the Worker, R2, the cache, Turnstile | nothing | past 100,000 requests a day to the reading route, or 10 GB of files |
| Anthropic's API, Claude Haiku 5.5 | well under a tenth of a cent a PDF, from the owner's $200 of credit | the credit is prepaid, with auto-reload off: once it is spent, the gateway reads alone |
| SoCLaaS, the school's gateway, behind Claude | nothing | never; the launch key's own limits cap a day's reading |
| Supabase | nothing while building | $25 a month from launch day, on Pro |
| Resend | nothing up to 100 emails a day | $20 a month past them |
| Google's sign-in | nothing | never |

## Where milestone 4 left us

- **The editor runs only under `pnpm dev`.** The dev server serves the engine's files from
  `apps/editor/.engine/` under `/engine/` and answers `POST /v1/label`, the route that reads a
  PDF's lines. A production build keeps documents but cannot draw their pages (README). CI
  deploys nothing; it keeps the editor's build as an artifact (decision 0029).
- **The engine** is BusyTeX's prebuilt WebAssembly build of TeX Live 2023 (decisions 0003 and
  0011): one 30 MB binary holding pdfTeX, XeTeX, LuaHBTeX and xdvipdfmx, its loaders, and a tree
  of 28,658 files and about 490 MB that the worker reads one file at a time, with synchronous
  requests, as TeX opens them. Every file but the manifest sits under a tag, the release and
  layout, so a URL's contents never change (`src/engine/urls.ts`). The engine needs no
  cross-origin isolation: it uses no `SharedArrayBuffer`. A first load was about 14 MB
  compressed in the spike; the dev server sends 42 to 53 MB uncompressed, which milestone 2 left
  to "milestone 5's CDN and engine build" to bring under the 30 MB target.
- **The route that reads a PDF** is a Pages Function, `apps/editor/functions/v1/label.ts`, over a
  handler tied to no host (`src/service/label.ts`, decision 0056). It has never been deployed. It
  asks SoCLaaS, the school's gateway, for `qwen3.8:27b` (decisions 0036 and 0044); Gemini's provider
  code is written and unused. Decision 0109 (pull request #151) puts Claude Haiku 5.5 in front of
  the gateway, which it asks when Claude gives no answer within the same 14 s. The route limits each
  address to 10 requests a minute, 100 a day and 2 million prompt characters a day, in KV, and
  refuses what it cannot count; it stops the model at 14 s so the page's 15 s budget holds; it keeps
  no text and logs fixed lines alone. Without a key it answers 503 and the page's rules read the
  PDF.
- **Accounts** run against the local Supabase stack (decision 0089): sign-in by email link and by
  email and password (decisions 0094 and 0099), the `documents` table and the private `originals`
  bucket that only their owner reaches (decision 0093), and sync as a queue of whole documents
  (decision 0092). Mail lands in Mailpit. `config.toml` has its SMTP and CAPTCHA blocks still
  commented out and no Google block, and its email templates link straight to the service's own
  address.
- **Left open by milestone 4** (decisions 0094, 0095, 0099 and 0100): Google sign-in and deleting
  an account, both designed; a real mail sender; the hosted project; "Three ways to tell which
  addresses have accounts", which no setting closed locally; and the extra session a password
  change leaves on the server: the change signs in afresh with the current password, "which
  leaves one more session on the server until it lapses; nothing keeps its tokens."
- **CI last ran on `main` at e6d2099** (#140). From about 01:00 UTC on 21 October 2026 GitHub
  Actions has refused every job ("recent account payments have failed or your spending limit
  needs to be increased"). Milestone 4's items 3 and 6 passed on their pull requests but never ran
  on `main`; items 4, 5 and 7 to 10 were merged on the same checks run locally (decision 0100);
  and every run on `main` since has failed in seconds without starting. The first green run on
  `main` is milestone 4's real check. GitHub's `ubuntu-latest` began moving to Ubuntu 26 on 19
  October 2026, under the `accounts` workflow's Docker stack.
- **The checker** (@keaenlim): its milestone 2, the connection to the editor and a check page, is
  next. Nothing mounts its panel or calls the client that reads `VITE_ATS_SERVICE_URL`, and where
  the service is hosted is its owner's call (README, "Hosting").
- **The corpus** is guarded by `apps/editor/corpus/baseline.json`: on 8 October 2026 at c526f08,
  77 of 220 resumes import at the success bar, 35%, with 89.66% of body words editable in place.
  The run writes its numbers to its summary and artifacts; nothing publishes them.
- **Nobody uses the editor yet** (owner, 7 October 2026), so nothing stored needs migrating. That
  ends at launch.

## What the plan says, and where this milestone departs from it

- **The app and its reading route are one Worker, not Pages and a separate Worker.** Section
  8.1's hosting row has "Pages for the app ... a Worker for the model endpoint"; decision 0028 put
  the route beside the app as a Pages Function and left the row to this milestone, and decision
  0029 planned a Pages job. Since then Cloudflare tells new projects: "If you are starting a new
  project, use Workers instead of Pages." A rate limit that holds on the free plan needs a Durable
  Object, which only a Worker's own script can define; on Pages it would take a second thing to
  deploy. One Worker with static assets serves the app's files free, runs only for `/v1/*`, and
  is one thing to configure and deploy (decision 0101).
- **The rate limit moves from KV to a Durable Object.** Section 8.1 has "KV for its rate limit".
  The route writes KV once a request, the free plan's KV takes 1,000 writes a day (decision 0028),
  and past them the route refuses everything it cannot count (decision 0056,
  `functions/README.md`). A SQLite-backed Durable Object on the free plan, with the counting done
  inside it, is the "stronger limit" decision 0028 asked this milestone for (decision 0103).
- **The providers at launch are settled: Claude first, the school's gateway behind it.** Sections
  6.4 and 11 leave it open between the school's gateway, with its leave, and a paid service whose
  terms "rule out training on what it is sent". The owner chose the gateway on 21 October 2026,
  then, the same day, put Claude in front of it to spend $200 of Anthropic API credit (decision
  0109). The school's leave and what either provider keeps are set aside, so no leave is sought
  and the consent goes on promising only what the editor's own service does
  (`src/pdf/consent.ts`, decision 0103).
- **The engine stays BusyTeX's release**, if the owner agrees (question 6). Section 8.1's TeX
  engines row says the engines are built "from TeX Live sources", and milestone 2 left that build
  to this milestone.
- **A free Supabase project pauses after a week idle** (section 8.3) and keeps no backups.
  Question 3.
- Kept: Cloudflare and Supabase never talk to each other (section 8.2). The bot check on signing
  in is the account service's own call to Turnstile, and nothing on Cloudflare reaches Supabase.

## Where it runs

Decision 0101.

- **One domain**, written `<domain>` here (question 1).
- **One Worker** at `https://<domain>`, configured in `apps/editor/wrangler.jsonc`. Its static
  assets are the Vite build, every unknown path answered with `index.html`; requests for them are
  free, unlimited and run no code. Only `/v1/*` runs the Worker, whose code answers
  `POST /v1/label` with the handler milestone 3 wrote (`src/service/label.ts`). The Pages
  Function becomes that Worker's entry, and `functions/` goes.
- **The engine's files** at `https://files.<domain>`, an R2 bucket on its own custom domain: the
  engine, its loaders and the TeX Live tree with its fonts, under the same tagged paths the dev
  server serves today. They cannot be the Worker's assets: a version holds at most 20,000 files of
  at most 25 MiB each, and the tree has 28,658 files beside a 30 MB binary. A tag's files never
  change, so they are served `public, max-age=31536000, immutable`, compressed in transit, under a
  cache rule for the whole subdomain, since Cloudflare's cache otherwise skips `.wasm`, `.json` and
  most of TeX's own extensions. The bucket allows the app's origin by CORS, which the worker's
  synchronous requests and the page's fonts need. No COOP or COEP header is set: nothing needs
  cross-origin isolation.
- **The manifest ships with the app**, not with the files, so a deployed build always names the
  tag it was built and tested with, and a new tree reaches people only through a new deploy; this
  amends decision 0010, which kept it untagged beside the files. The engine's base address is a
  build variable, listed in `.env.example`, `/engine/` when it is unset, as under the dev server.
- **The account service** at `https://<ref>.supabase.co`, reached from the browser as now.
- **Headers**, in `_headers` for the static assets, as decision 0101 lists them: a Content
  Security Policy that allows nothing but the app, `files.<domain>`, the project's Supabase address
  and `challenges.cloudflare.com`, with `'wasm-unsafe-eval'` for the engine, `blob:` for the
  pictures the PDF review draws, and `frame-ancestors 'none'`; immutable caching for hashed
  assets, and revalidation for `index.html` and the manifest; and `nosniff`. The reading route
  sets its own headers in code, as now, since `_headers` does not reach what a Worker's code
  answers.
- **No other origin.** No analytics, no web fonts from elsewhere, no error-reporting service. The
  only script that is not ours is Turnstile's, from `challenges.cloudflare.com`, loaded only when a
  check is needed (decisions 0103 and 0104). Cloudflare already serves every byte of the editor,
  so its script adds no new party to trust with the session that sits in local storage. It amends
  decision 0094's "The editor runs no third-party script, and keeps it that way."
- **Who it is for**: current desktop Chrome, Firefox and Safari, each checked by hand in item 18.
  The editor is not made for phones; a narrow window gets a plain note that editing needs a larger
  screen.

## How main reaches production

Decision 0102, which extends decision 0029.

- **The app**: a `deploy` job in the `editor` workflow, on pushes to `main` only and after the
  checks pass. It builds with the production values, every one public (the files' address, the
  account service's address and publishable key, Turnstile's site keys), checks that the files
  hold the tag the manifest names, and deploys the Worker and its assets with `wrangler deploy`.
  Deploys share one concurrency group that never cancels a run in progress, and one deploys only
  while its commit is still `main`'s head, so a build never replaces a newer one, as decision
  0029's image only moves forward. Pull requests build but never deploy, so there are no preview
  addresses to allow in the account service's redirects.
- **The files**: a `files` workflow, started by hand, runs `fetch-engine` and uploads the tag's
  folder to R2 through its S3 API with the AWS CLI that GitHub's runners carry. It refuses to touch
  a tag that is already there, and old tags stay until no deployed build names them.
- **The database**: a `database` workflow, started by hand on `main`. It first runs the
  `accounts` checks on the local stack for the same commit, then `supabase link`,
  `supabase db push --dry-run`, `supabase db push`, `supabase config diff` and
  `supabase config push`. A migration on a database people use is a deliberate act, never a side
  effect of a merge. It is the one workflow that reaches the hosted project, with secrets, which
  amends decision 0096's "Nothing in CI calls Google or a hosted Supabase, and nothing needs a
  secret": no check workflow does.
- **Secrets** live in GitHub's Actions secrets for the three jobs (a Cloudflare token limited to
  Workers and R2, R2's access keys, Supabase's access token and database password, the SMTP
  password, Google's client secret, the Turnstile secret the account service checks with), and in
  the Worker for its own (the Turnstile secret the route checks with, the key that hashes
  addresses, and the launch keys for Claude and the school's gateway). None is in the repository,
  and none has the
  `VITE_` prefix.
- **Undoing a deploy**: Cloudflare keeps the Worker's versions, and `wrangler rollback` or its
  dashboard returns to one. A bad migration is undone by a new one.
- **When Actions is down**, as it is on 21 October 2026, the owner runs the same commands from a
  clean checkout of `main`; the README says how.
- **From launch day, what people store is kept.** A change to the `documents` table, the bucket's
  layout or the browser store's version migrates what is there, which the owner's rule of
  7 October 2026 made unnecessary until now.

## Reading a PDF at launch

Decision 0103, which extends decisions 0028, 0047 and 0056.

- **Claude reads first, the school's gateway behind it** (decision 0109): Claude Haiku 5.5, and
  SoCLaaS's `qwen3.8:27b` when Claude fails or answers in a wrong form within the same 14 s, both
  with their thinking off, as in development. The owner chose this on 21 October 2026 and set
  aside what either provider keeps. Both read 95.7% of fields right on the invented resumes from
  other tools; Haiku is paid from the owner's $200 of Anthropic API credit, and the gateway bills
  nothing. The owner also set aside the school's leave that section 6.4 asks for. The launch has
  keys of its own, so development never spends the launch's allowance, and the Claude credit is
  prepaid with auto-reload off, so once it is spent the gateway reads alone.
- **Measured from where it will run** (item 5). The reading's accuracy is measured already
  (decisions 0064 and 0109); what launch changes is the caller. Item 5 checks that Claude and the
  gateway each answer the Worker from Cloudflare's network, times the invented sets through each
  against the 15 s budget, a fallback's included, and reads the launch keys' limits. If one
  provider does not answer a Worker, the other reads alone; if neither does, the rules read every
  PDF until the owner decides again.
- **The bot check comes first.** A Turnstile widget of the route's own, rendered when the person
  has said yes and a PDF is being sent; its script is fetched then and not before. Its token, good
  once and for five minutes, goes with the request. The route checks it with Turnstile's
  Siteverify, with its hostname and action, before it counts the request or calls the model, and
  refuses without a valid one. A refusal is one more cause for the page's rules to read the PDF,
  as a timeout is, and the review says the rules read it.
- **The limits** of decision 0056 stay: 10 requests a minute, 100 a day and 2 million prompt
  characters a day per address, IPv6 by its /48. One more is added: a ceiling for everyone each
  UTC day, set under the gateway's launch key's own limits (decision 0036 names 90 requests a
  minute, and reference prices of $80 a day and $800 a month), past which the rules read every PDF
  until the day ends. The ceiling keeps one busy day from spending the key's whole allowance, or
  much of the Claude credit.
- **A Durable Object counts**, in place of KV: a SQLite-backed class, one object for each
  address's buckets and one for the day's ceiling. The counting moves inside it: one call checks
  and takes from every bucket at once, where `RateStore`'s separate reads and writes let two
  requests read the same count, which is why its limit held "roughly" (`src/service/rate.ts`).
  `RateStore` changes to that one call. Its keys are a keyed hash of the address, with a secret
  of the Worker's, so the store holds no address. KV and `LABEL_KV` go.
- **Nothing kept by the route**: no cache and fixed log lines, as now, and the Worker's
  observability off, with no tail consumer and no Logpush, so not even those lines are stored.
  They show only in a live tail someone is watching.
- **The consent and the privacy page name Anthropic and the school's gateway** as who reads the
  text, Anthropic first and the gateway when Claude gives no answer, so a request that falls back,
  which reaches both, is covered, in words the owner approves (item 6). As today, they promise only
  what the editor's own service does: it keeps none of the text.
- **Development and the launch ask the same models in the same order**, so `pdf-model` and the
  route's `labelModels` (decision 0109) stay as they are.
- **No model is called in CI**, and no corpus resume is ever sent to one, as now.

## Accounts online

Decision 0104, which extends decisions 0089, 0094, 0096 and 0099.

- **One hosted project**, production. Its plan and region are questions 3 and 4. No staging
  project and no branching: the local stack is where changes are tried, as in milestone 4.
- **Configured from the repository.** The migrations and `config.toml` that run the local stack
  configure the hosted project too, through the `database` workflow. A `[remotes.production]`
  block in `config.toml` holds what differs there: the site address, the redirect list, SMTP, the
  bot check, Google, the rate limits, and the minimum time between two emails to one person,
  which the local stack sets to one second for its tests. Its secrets come from the workflow's
  environment through `env()`, which `config push` never sends unresolved. The local stack keeps
  Mailpit, no bot check and its fixed keys. A setting `config push` does not manage, such as the
  leaked-password check, is set in the dashboard and listed in the README. The hosted schema is
  never changed in the dashboard, which would break `db push`'s history.
- **Addresses**: the site address is `https://<domain>`, and the one redirect pattern
  `https://<domain>/**`, since links come back with the service's own query.
- **Mail** goes out through the mail provider (question 5) as the project's SMTP server, from an
  address on the domain with SPF, DKIM and DMARC set, and with the provider's link tracking off,
  since it rewrites sign-in links. Every email the account service sends uses the editor's own
  template in plain English: confirming an address, the sign-in link, a reset, a change of
  address, and the notice that a password changed. Each link leads first to a page of the
  editor's that asks for one click before it goes on to the service, carrying the service's link
  in the part of the address no server sees, and going on to the project's own address alone. A
  mail scanner that opens the link then uses nothing up, and the PKCE exchange still signs in
  only the browser that asked (decision 0094). Today's templates link straight to the service.
- **Rate limits** for launch, in `[remotes.production]`: emails an hour set so that a day stays
  within the provider's own daily limit, since the service allows 30 an hour once SMTP is set and
  the local stack's 1,000 is for tests; a minute between two emails to one person, the service's
  own default; and the rest at the service's defaults (sign-ups and sign-ins 30 every five
  minutes per address), unless item 7 finds them too tight.
- **Signing up stays open**, which decision 0094 left to this milestone: guarded by the bot check,
  the rate limits and the caps per account, with no cap on the number of accounts at launch. The
  Free plan's 50,000 monthly active users are far off.
- **The bot check on signing in**: the account service's own CAPTCHA with Turnstile, on a widget
  of its own. The service then refuses, without a token, signing up, signing in with a password,
  asking for a link or a code, asking for a reset and asking to resend. The panel fetches
  Turnstile when it opens and sends a fresh token with each request as `captchaToken`. Signing in
  with Google and refreshing a session need none. Locally it stays off, and the integration tests
  that cover it turn it on with Turnstile's test keys, which always pass.
- **The leaked-password check** goes on the day the project moves to Pro (question 3), since the
  Free plan lacks it.
- **Google**, as decision 0094 designed it: "Continue with Google", hidden while no client is
  configured; a Google identity with the same verified address joins the existing account. The
  owner's production client is a web application with the domain as its JavaScript origin and
  `https://<ref>.supabase.co/auth/v1/callback` as its redirect, asking `openid`, `email` and
  `profile`, published in production, which those scopes allow with no review, no test-user list
  and no seven-day expiry. CI checks only that the button leads to Google's address with the right
  redirect, through a stand-in client on the local stack; a real sign-in is checked by hand.
- **What Google's screen shows.** Without brand verification Google shows only the app's domain,
  and through the account service that is `<ref>.supabase.co`. The owner submits the brand, with
  the home page and the privacy page on the domain verified in Search Console; a review takes two
  or three working days. If Google refuses it because the callback is on `supabase.co`, as some
  have reported, the screen names `<ref>.supabase.co` until the owner takes Supabase's custom
  domain, $10 a month and only on Pro, which moves the account service to `auth.<domain>`.
- **The extra session a password change leaves** is closed: the session the change signs in with
  to prove the current password is signed out at once, revoking its refresh token, so nothing is
  left on the server to lapse. If the hosted service checks a current password itself, the change
  uses that and signs in no second time.
- **Telling which addresses have accounts** (decision 0099's three ways): checked again on the
  hosted service in item 13. Each is closed there, or accepted in a record with the bot check and
  the rate limits as its guard.
- **Proven on the hosted project before anyone but the owners signs up** (item 14).
  `supabase test db --linked` runs the database's own tests against it, each rolled back.
  Decision 0093's API test runs from the owner's machine against the hosted address, with two
  throwaway accounts made with the service key, which the bot check does not stop and which never
  leaves that machine. The editor's own deletion then removes both accounts, and a query over the
  database connection finds nothing of them in the table or the bucket; the service key cannot
  read the table, which grants it nothing. No check workflow calls the hosted project (decision
  0102).

## Deleting an account

Decision 0105, which finishes decision 0095.

Decision 0095 holds: "Delete my account", behind a confirmation that names how many documents and
files go; the browser deletes every file under the person's folder through Storage, then calls
`delete_my_account()`, which takes no argument, refuses while any file of the caller is left, and
deletes the caller alone, the rows going with the user; this browser then removes the account's
documents and import files, signs out and says the account is gone; no grace period and no undo.
The account service agrees on the order: it deletes no user who still owns files, and refuses to
delete files but through Storage. Decision 0095 left three things open:

- **The queue stops first.** The tab that sends holds the sync lock, `resume-tools-sync`, for as
  long as it is open and visible, and a Web Lock does not nest, so waiting for it would wait
  forever. Deleting stops this tab's queue, then takes the lock with `steal`, which ends any other
  tab's hold; that tab's queue stops sending when its hold ends. No save or upload then lands
  between the files and the function. Saves not yet sent for the account's documents go with
  them, which the confirmation says.
- **Another device** finds the account gone at its next request, a session refused or a write the
  database refuses for an owner that no longer exists, and treats it as a sign-out it was not
  asked for. The account's documents leave that browser, except those holding saves the account
  never received: they stay as documents only in this browser, so no edit is lost, and the editor
  says the account was deleted.
- **The function sees a file left** by looking in `storage.objects` for the caller's folder in
  `originals`, under its definer's rights.
- **Tests**: pgTAP for the function (it refuses while a file is left, deletes only its caller,
  takes the caller's rows with it, leaves another account's alone, and `anon` cannot call it); an
  integration test of the whole path with two devices on the local stack, the second keeping its
  unsent saves; and an adversarial review.

## Caps per account

Decision 0106, which item 12 completes with the numbers it measures.

- **Measured first**: the sizes of `original.zip` and `import.bin` for each corpus resume that
  imports, sizes alone, nothing of their text leaving the machine; and the sizes of the saved rows
  of the built-in templates' samples and of the invented PDF imports.
- **What is capped**, with numbers here only as a starting point the measurement replaces: the
  originals' total per account, 100 MB; documents per account, 200; and each file, at the bucket's
  one size limit, set from the larger of the measured `original.zip` and `import.bin` with room to
  spare, in place of today's 50 MiB. An `original.zip` holds the upload as given, so a zip at the
  import's own 20 MB cap makes one a little larger.
- **Where**: in the database, so no client can pass it. The `documents` trigger refuses a row past
  the count, and the bucket's insert and update policies refuse a file once the caller's files
  already total the cap. A policy cannot see the size of the file being added, so an account can
  pass the total by at most one file.
- **What the person sees**: the list's mark for a save the account refused, "Could not be saved to
  your account" (decision 0098), with the cap's own reason in place of "most likely too large",
  and what to delete to make room. The document stays in this browser.

## The import's quality number

Decision 0107.

- **The number** is the corpus run's success rate: the share of the corpus's 220 resumes that
  import as an outline whose page is the original's, with at least 90% of body words editable in
  place (section 6.2). On 8 October 2026 at c526f08 it was 77 of 220, 35%, which is the baseline
  the run guards today. Beside it, never instead of it, goes the share of body words editable in
  place over the resumes that import, 89.66% there. Section 5.7 calls the first "the number the
  whole import effort is measured by". It is not the count of imported resumes with 90% or more
  of their words in place, 83 in the same run, which section 4.3 calls "at the bar": a success
  also asks that the page match.
- **Published internally** in `docs/import-quality.md`: the definition, then one dated row per
  adopted baseline (date, commit, the success rate, the words' share, and, where its run reported
  them, resumes under 50% and words kept as `moved`), back to the first baseline in the file's
  history. The pull request that adopts a baseline adds its row, and the run's summary prints the
  number first. Nothing of it is on the public site.
- **Guarded as now** (decision 0043): a run fails when the success rate falls more than a point
  under the baseline.

## Polish

The plan's word, made a list. Each entry says how it is checked.

- **The editor's own dialogs** in place of the browser's: deleting a document
  (`editor/DocumentList.tsx`) and removing a section (`editor/Panel.tsx`) ask through the
  browser's `confirm`, which some people read as an error and which freezes browser automation.
  A DOM test covers each, and a test fails on any `confirm`, `alert` or `prompt` left in `src`.
- **When something online is down**: the engine's files, the reading service or the account
  service unreachable, or the account service paused. One plain message each; the documents in
  this browser still open where the engine is cached; never LaTeX or a service's own text. DOM
  tests cover each message.
- **The built-in templates pass the checker's readiness checks** (decision 0031): each, compiled
  with invented content, with no critical finding and no layout warning. "Templates that fail the
  gate need fixing before launch", and "A failure is a template bug". Decision 0031 is still
  proposed, needing the editor owner's agreement, which the owner gives with this plan or the gate
  leaves it. Run by hand through `POST /v1/analyze` on the checker's service, started locally with
  `ats-serve`, over the PDFs `builtin-pdfs` writes, or in CI if the checker's milestone 2 has put
  the gate there by then.
- **Two pages**, in the editor's plain English, whose words the owner approves. Privacy: what leaves
  the browser and when (the PDF reading, by Anthropic and the school's gateway, and saving to an
  account), what an account keeps, how to delete it, how long the account service's backups keep a
  deleted account, and which services see what (Cloudflare, Supabase, Anthropic, the school's
  gateway, the mail provider). Licences: the engine and where the sources of its release are, TeX
  Live, each template's licence and attribution, the fonts, and the libraries the app ships.
  Google's brand verification needs the first. Neither is legal advice, and this plan asks for none.
- **Three browsers**: item 18.

## Done means

- **The editor is online** at `https://<domain>`, deployed from `main` by the workflow. A clean
  profile in current desktop Chrome, Firefox and Safari makes, edits and downloads a resume on each
  built-in template, imports a `.tex` and imports a PDF.
- **The first load stays under 30 MB** from the hosted files, measured on a cold cache, with its
  time recorded.
- **A PDF is read by Claude, or by the school's gateway when Claude gives no answer**, within the
  15 s budget after the person's yes and the bot check, and the consent names who reads it.
  Without the yes or the check, past a limit, or when both providers fail, the rules read it, and
  nothing is sent.
- **Accounts work online**: signing up and in by email link, by password and with Google on the
  hosted project, with mail from the domain that arrives in an inbox and not in spam; a document
  saved on one device opens on another.
- **Only its owner reaches an account's rows and files** on the hosted project: the database's
  tests and the two-account API test pass there before anyone but the owners signs up.
- **Deleting an account** leaves nothing of it in the table, the bucket or this browser, and
  another device loses no unsent edit.
- **The caps** refuse past their limits in the database, with a plain message.
- **The bot check** guards signing up, signing in, asking for a link or a reset, and reading a
  PDF; a signed-out first load still makes no request to the account service and fetches neither
  its client nor Turnstile.
- **The quality number** is defined and published in `docs/import-quality.md`.
- **CI is green on `main`**, and nothing reaches production but through the three workflows.
- **A person never sees LaTeX or a service's own text**, in any screen, page or email.
- **The privacy and licences pages** are online, in words the owner approved.

## Not in this milestone

- What the plan puts after launch: template switching, in-page structure editing, more style
  controls, cheat sheets with a visual math editor, LuaTeX and other scripts.
- The checker in the editor, and its hosting: @keaenlim's milestone 2. The editor launches with no
  checker panel, and `VITE_ATS_SERVICE_URL` stays unset in production. Only the template gate
  above is this milestone's.
- Our own engine build and a newer TeX Live, if the owner agrees (question 6).
- The import's known limits accepted in decision 0066, and the import gaps on the status page; the
  owner may move any of them into the polish stage.
- Analytics, error reporting, session recording, or any service that watches how people use the
  editor. The owners see Cloudflare's and Supabase's own counts.
- A staging project, preview deploys and Supabase's branching.
- Supabase's custom domain, unless Google's brand review needs it (decision 0104).
- Two-factor sign-in; Apple, GitHub or any other provider; sharing; live updates; version history;
  export of documents or of the account; payments.
- Phones and tablets.
- The Notion status page, which the owner updates when asked.

## The work, in order

Stage 0 brings CI back. Stage 1 puts the editor online, stage 2 the accounts, stage 3 the quality
number, stage 4 the polish, and stage 5 checks it all and launches. After item 1, stages 1, 2 and
3 need little of each other: stage 2 takes the domain and the privacy page from stage 1, so the
three can run side by side, each waiting on the owner's part.

### Stage 0. CI back

1. [ ] **CI green on `main`.** Once the owner has restored Actions billing, read the first runs on
   `main` of `editor`, `accounts` and `repo`, the first to check milestone 4's items 4, 5 and 7 to
   10 at all and items 3 and 6 on `main`, and fix what fails. If the move to Ubuntu 26 breaks the
   local stack, pin the runner to `ubuntu-24.04` here. Done when every workflow's latest run on
   `main` is green.

### Stage 1. The editor online

2. [ ] **The engine's files on R2.** The `files` workflow; the bucket's CORS, set with `wrangler`;
   its custom domain and its cache rule, which the owner sets up; the engine's base address as a
   build variable, in `.env.example`; the manifest shipped with the app. Measures the upload's
   time, the folder's size, and each kind of file's size in transit, and stores a file compressed
   if Cloudflare does not compress it on the way. Done when a production build served by
   `vite preview` compiles each built-in template from the hosted files in a clean browser
   profile, a second load fetches them from the cache, and the numbers are in the pull request.
3. [ ] **The app on a Worker.** `wrangler.jsonc`, the reading route moved from `functions/` into the
   Worker's entry, `_headers`, the single-page fallback, observability off, and the `deploy` job.
   The route goes up with the app and, with no rate store and no provider bound yet, refuses
   every request, so the rules read every PDF. Done when `main`'s build is at `https://<domain>`;
   a clean profile makes, edits and downloads each built-in template and imports a `.tex`, sending
   nothing; the console shows no policy violation on any path; and the first load's size and time
   on a cold cache are in the pull request.
4. [ ] **The privacy and licences pages**, as the polish list says, on the domain, linked from the
   editor, naming Anthropic and the school's gateway as who read a PDF's lines. Done when both pages
   are online in words the owner approved, and a test checks that the licences page names every
   template and every font family the built-in templates use.
5. [ ] **The providers from Cloudflare, measured.** Waits on the launch keys. The reading's accuracy
   on both is measured already (decisions 0064 and 0109), so this measures only what launch
   changes: with the route run on Cloudflare's network (`wrangler dev --remote`), that Claude and
   the gateway each answer it, the invented sets' times through each against the 15 s budget, a
   fallback's included, and the launch keys' limits. Done when a record holds the times and the
   limits, the slowest reply is within the budget, and the daily ceiling follows from them.
6. [ ] **The reading route live.** The launch keys in the Worker; the bot check, the Durable
   Object's limits, the daily ceiling and the hashed address (decision 0103); Turnstile's site key
   in `.env.example`; the consent's and the privacy page's words. Gets an adversarial review: it
   carries resume text and spends the launch key's allowance. Done when
   tests show a request without a valid token refused before it is counted, Turnstile's test keys
   passing, the script fetched only after the yes, the limits and the ceiling refusing past their
   counts, the rules reading the PDF after each refusal, and no line of a request's text logged;
   and when a PDF on the hosted site is read by the model within 15 s, the review saying so, with
   the route's CPU time for the largest invented PDF in the pull request.

### Stage 2. Accounts online

7. [ ] **The hosted project, configured from the repository.** The `[remotes.production]` block, the
   `database` workflow, and the production values in the `deploy` job. Done when the workflow has
   applied every migration and setting to the hosted project, `supabase config diff` shows
   nothing left, and the owner signs in at `https://<domain>` by email link, sent at this point by
   the service's own mailer, which mails only the project's team.
8. [ ] **Mail from the domain.** The provider's SMTP in `[remotes.production]`, the editor's
   templates for every email with links the editor checks in the page, and the launch's email
   limits. Gets an adversarial review: it changes how a sign-in link is checked. Done when the
   confirmation, the sign-in link, the reset, the change of address and the password notice each
   reach a Gmail and an Outlook inbox from the domain, outside spam, with SPF, DKIM and DMARC
   passing in their headers, and a link fetched first by a script still signs in when the person
   opens it.
9. [ ] **The bot check on signing in.** As decision 0104 says, with its site key in `.env.example`.
   Gets an adversarial review. Done when integration tests pass with the check on and Turnstile's
   test keys, a request without a token is refused on the local stack, and a DOM test shows a
   signed-out first load fetching neither Turnstile nor the client.
10. [ ] **Google.** Waits on the owner's client, which needs item 4's privacy page. The button, the
    stand-in client on the local stack, and the production client in `[remotes.production]`. Gets
    an adversarial review: it decides who can sign in. Done when CI shows the button leading to
    Google's address with the project's callback as its redirect; and, by hand on the hosted site,
    a Google sign-in makes an account, and a sign-in link sent to the same address opens the same
    account and its documents.
11. [ ] **Deleting an account.** Decisions 0095 and 0105. Gets an adversarial review. Done when the
    pgTAP and integration tests of decision 0105 pass, and a test shows nothing of the account left
    in the table or the bucket.
12. [ ] **The caps.** Measures, then completes decision 0106 with the numbers, then enforces them.
    Gets an adversarial review. Done when pgTAP refuses a document past the count and a file past
    the total, each for the caller alone, and a DOM test shows the message.
13. [ ] **The sign-in service's loose ends.** The extra session closed, and decision 0099's three
    ways to tell which addresses have accounts checked on the hosted project. Gets an adversarial
    review. Done when an integration test shows a password change leaving no other session, and a
    record says what became of each of the three ways.
14. [ ] **Accounts proven on the hosted project.** By hand, before anyone but the owners signs up,
    as decision 0104 says, with a script that reads the hosted address and the service key from the
    environment and is never run in CI. Done when the pull request records the run: the database's
    tests passing, the two-account test passing, both accounts deleted, and nothing of them left.

### Stage 3. The quality number

15. [ ] **The number, published.** `docs/import-quality.md` with the definition and the rows of the
    baselines already adopted; the run's summary printing the number first; the README and
    AGENTS.md pointing at the page. It touches the corpus scripts, so the pull request suggests a
    corpus run and leaves it to the owner. Done when the page holds the rows and a unit test shows
    the summary's first line.

### Stage 4. Polish

16. [ ] **The editor's own dialogs, and the messages when something online is down.** Done when the
    tests the polish list names pass.
17. [ ] **The template gate.** Waits on the owner's agreement to decision 0031's gate. Done when
    each built-in template's PDF passes the checker's readiness checks through `POST /v1/analyze`,
    or the fix that makes it pass is merged.
18. [ ] **Three browsers.** By hand on the hosted site, in current desktop Chrome, Firefox and
    Safari: each built-in template made, edited and downloaded, a `.tex` import, a PDF import with
    and without the yes, each way of signing in, a document opened in a second browser, an account
    deleted. What fails is fixed here, or in its own pull request if it is large. Done when each
    browser passes every step.

### Stage 5. Launch

19. [ ] **The milestone, proven.** On the hosted site, by hand: every box under "Done means", with
    two devices; the first load cold and warm, an edit's page, a `.tex` import and a PDF read by
    the model, each timed against section 4.3. One record measures the milestone. Done when that
    record is merged and every box holds. Launch is then the owner's: Pro from that day, with the
    leaked-password check on, if question 3 chose it, and the address shared as question 7 says.

| Item | Size | Depends on |
|---|---|---|
| 1 CI green on `main` | small | the owner's billing fix and approval of this plan |
| 2 The engine's files on R2 | medium | 1; the domain and the bucket |
| 3 The app on a Worker | medium | 2 |
| 4 Privacy and licences pages | small | 3; the owner's words |
| 5 The providers from Cloudflare, measured | small | 3; the launch keys |
| 6 The reading route live | medium | 3, 4, 5; the route's Turnstile widget |
| 7 The hosted project | medium | 1, 3; the project |
| 8 Mail from the domain | small | 7; the mail provider |
| 9 The bot check on signing in | medium | 7 |
| 10 Google | medium | 4, 7; the owner's client |
| 11 Deleting an account | medium | 1 |
| 12 The caps | medium | 1 |
| 13 The loose ends | small | 7 |
| 14 Accounts proven on the hosted project | small | 8 to 13 |
| 15 The number, published | small | 1 |
| 16 Dialogs and messages | small | 1 |
| 17 The template gate | small to medium | 1; the owner's agreement to 0031's gate |
| 18 Three browsers | medium | 6, 8 to 11 |
| 19 The milestone, proven | small | all |

## Decisions this milestone makes

Each has its record in `docs/decisions/`, merged with this plan. Questions 1 to 7 are the owner's;
the rest is proposed and approved with the plan.

- **0101. The editor online**: one domain, one Worker for the app and its reading route, the
  engine's files on R2 on their own subdomain, the manifest with the app, the headers and the
  policy, no other origin, desktop browsers.
- **0102. How `main` reaches production**: a deploy job after the checks, the files and the
  database by hand, the secrets, rollback, and stored data kept from launch day.
- **0103. Reading a PDF at launch**: Claude first and the school's gateway behind it, the owner's
  choice (decision 0109), measured from Cloudflare, the bot check before the count, the limits and
  the daily ceiling in a Durable Object, nothing kept by the route.
- **0104. Accounts online**: one hosted project configured from the repository, mail from the
  domain, the bot check on signing in, Google and its screen, the extra session, and the proof on
  the hosted project.
- **0105. Deleting an account, finished**: the queue stops first, another device keeps unsent
  saves, how the function sees files, and the tests.
- **0106. Caps per account**: what is capped and where, with the numbers item 12 measures.
- **0107. The import's quality number**: the success rate, published in `docs/import-quality.md`.
- **0108. Milestone 5's dependencies.**

Items 5, 13 and 19 add records of their own: the providers measured from Cloudflare, the sign-in
service's ways of telling, and the milestone measured. Item 12 completes decision 0106 with the
caps' numbers.

## Dependencies

Decision 0108. The owner approves these with the plan; each pull request that adds one names it.

| What | Where | Why |
|---|---|---|
| `wrangler`, at an exact version, MIT or Apache 2.0 | development dependency of `apps/editor` | deploys the Worker and its assets, and runs them locally with their bindings |
| The AWS CLI | GitHub's runners carry it | uploads the engine's files to R2 through its S3 API |
| Services: the domain, Cloudflare (Workers, R2, Durable Objects, Turnstile), the hosted Supabase project, the mail provider, Google's OAuth client, and launch keys for Anthropic's API and the school's gateway | the owner's accounts | what the milestone puts online |

Already dependencies: `@supabase/supabase-js`; the `supabase` CLI, whose `link`, `db push`,
`config push` and `test db --linked` the `database` workflow and item 14 use;
`@cloudflare/workers-types`; the AI SDK with its Anthropic, Google and OpenAI-compatible providers,
the Anthropic one added by decision 0109. Not added:
an analytics or error-reporting library, a Turnstile wrapper, an S3 library, a browser driver, or
a GitHub Action for `wrangler` or the Supabase CLI, which run as pinned development dependencies
through pnpm.

## Risks

- **A deploy or a migration breaks the live editor**, now that people use it. Deploys come only
  from `main` after every check, migrations only when the owner runs the `database` workflow after
  `accounts` passed, Cloudflare keeps the Worker's versions for a rollback, and from launch day a
  change to stored data migrates it, with a test (decision 0102).
- **The school's gateway is not a service built for the public.** It serves the school's students
  and staff, its sign-in failed every call for some hours on 1 October 2026 (decision 0044), and
  each key has its limits. The school has not been asked to agree, and what the gateway keeps is
  not established; the owner set both aside. Claude reads first, so the gateway reads only what
  Claude does not answer; the daily ceiling stays under the launch key's limits, the consent names
  it, and no corpus resume is ever sent to it. If the school objects or withdraws the key, Claude
  reads alone, and once the credit is spent too, the rules read every PDF until the owner chooses
  again.
- **Anthropic's API is paid, and keeps what it keeps.** The $200 credit is prepaid with auto-reload
  off, so it cannot be overspent: once it is spent, Claude's calls fail and the gateway reads
  alone. What Anthropic keeps of the text is not established either, and the owner set it aside;
  the consent names Anthropic, and no corpus resume is ever sent to it.
- **Costs run away.** The bot check comes before anything is counted or sent; the per-address
  limits and the daily ceiling bound Claude's spend and the gateway's use; the Claude credit is
  prepaid, with auto-reload off; the caps bound
  storage; Supabase's spend cap stays on; and on Cloudflare's free plan nothing can bill at all.
- **A free tier runs out or pauses.** A free Supabase project pauses after a week of low activity
  and keeps no backups, and the gateway's key stops at its daily limits. Question 3 chooses; the
  editor says in plain words when the account service cannot be reached, and documents stay in
  the browser; past the key's limits the rules read.
- **The free plan's 10 ms of CPU** a request may not parse and check a large PDF's lines. Item 6
  measures it on the largest invented PDF; past it the request fails and the rules read, or the
  owner takes the paid plan.
- **Mail lands in spam, stops, or is used up by a scanner.** A verified domain with SPF, DKIM and
  DMARC, link tracking off, the account service's email limit kept within the provider's, links
  the editor checks in the page, and item 8's check in two inboxes. Both ways of signing in without
  Google depend on it.
- **Turnstile is a third-party script** on a page whose session sits in local storage (decision
  0094). It is fetched only when a check is needed, from Cloudflare, which already serves every
  byte of the editor, and the policy allows no other script origin. Cloudflare's own advice is to
  load it early; loading it late is item 6's and item 9's to prove.
- **The policy breaks a path no test drives**: the engine's WebAssembly, its worker, the fonts, the
  PDF reader's worker, the PDF review's pictures, the sign-in redirect. Item 3 walks every path in
  one browser and item 18 in three, with the console open.
- **Safari or Firefox fails** where Chrome works: the engine's memory, synchronous requests in a
  worker, IndexedDB, Web Locks. Every milestone so far was checked in Chrome alone; item 18 finds
  it before anyone else does.
- **A cold start is slow from far away.** Each TeX Live file a first compile reads is one
  synchronous request, so the distance to the nearest Cloudflare location decides how a first
  visit feels, not its size (decision 0003). Items 3 and 19 time it. Serving each template's own
  format from the files, which removes most of those requests, stays after launch.
- **GitHub stops or changes under the pipeline.** Its billing has refused every job since 21
  October 2026, and `ubuntu-latest` moves to Ubuntu 26 from 19 October 2026. The same commands run
  by hand (decision 0102), and item 1 pins `ubuntu-24.04` if the stack breaks on the new image.
- **The hosted service is not the local one**: its version, its limits, its replies. Items 7 and 14
  rerun sign-in and the two-account proof there, and item 13 checks the replies that tell which
  addresses have accounts.
- **Google's brand review stalls** on the `supabase.co` callback, as some have reported. The
  screen then names the project's address, which works, until the owner takes the custom domain.
- **The engine's licences.** The editor hands every visitor BusyTeX's build of programs under the
  GPL. The licences page names the sources of the exact release it ships, and the owner reads the
  obligation once, as section 8.4 asks.
- **Shared editor surface.** The checker's milestone 2 adds a check page to the editor's header and
  panels, which items 9, 10, 11 and 16 also change; whichever lands second rebases.

## What the owner does

- **Before item 1**: restores Actions billing; approves this plan, decisions 0101 to 0108 and the
  dependencies of decision 0108; answers the seven questions; and agrees to decision 0031's
  template gate, or leaves item 17 out.
- **Before item 2**: buys the domain and adds it to the Cloudflare account; makes the R2 bucket,
  gives it `files.<domain>` as its custom domain, and adds the cache rule for that subdomain;
  makes a Cloudflare API token limited to Workers and R2, and R2's access keys, as Actions
  secrets.
- **Item 4**: approves the privacy and licences pages' words.
- **Before item 5**: issues a Claude API key and a SoCLaaS key for the launch, apart from the
  development keys, keeps the Claude Console's auto-reload off, and sets both as the Worker's
  secrets.
- **Before item 6**: makes the route's Turnstile widget and sets its secret as the Worker's;
  approves the consent's new words.
- **Before item 7**: makes the Supabase project, in the chosen region, on the Free plan, and puts
  its access token, database password and ref in Actions secrets.
- **Before item 8**: opens the mail provider's account, adds its DNS records to the domain, turns
  its link tracking off, and puts the SMTP password in Actions secrets.
- **Before item 9**: makes the sign-in's Turnstile widget and puts its secret in Actions secrets.
- **Before item 10**: verifies the domain in Search Console; registers Google's OAuth client and
  consent screen as decision 0104 says; submits the brand for verification; puts the client's id
  and secret in Actions secrets.
- **Item 14**: runs the hosted proof's script on their own machine with the service key, which
  never leaves it.
- **Launch day** (item 19): moves the project to Pro if question 3 chose it and turns on its
  leaked-password check in the dashboard, and shares the address as question 7 says.
- **May revise the plan page**, docs/editor-plan.md, where this milestone departs from it: section
  8.1's hosting row (one Worker for the app and its route, its rate limit in a Durable Object, the
  engine's files on R2 at their own subdomain), and section 8.2's sentence and section 8.3's rows
  that name Pages and KV; section 8.1's TeX engines row and section 3's tech stack row, if question
  6 keeps BusyTeX's release; sections 1.5, 6.4, 8.3 and 11, now that the owner has chosen Claude
  first and the school's gateway behind it for launch; section 8.3's rows for Supabase, the mail
  provider and the domain; and section 9's milestone 5, with this plan's done-check, marked done
  after item 19.

## How the work is run

As milestones 3 and 4 were: one branch and one worktree an item, the checks run before the pull
request, squash merge on green. Items 6 and 8 to 13 get one adversarial review before they are
pushed: they carry resume text, spend a service's allowance, or decide who can sign in or read a
resume. Agents
never create accounts, buy anything, register clients or hold production secrets: those are the
owner's, and an item that needs one waits for it. Agents start the `files` and `database`
workflows only when the owner asks. Items 12 and 15 may touch the corpus's scripts; each then
suggests a corpus run and leaves it to the owner, as AGENTS.md asks. No item touches `apps/ats`
or `packages/contracts`.

## Sources for the outside facts

Read on 21 October 2026.

- Workers or Pages for a new project:
  <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>
- Static assets on Workers, their limits, `_headers` and the single-page fallback:
  <https://developers.cloudflare.com/workers/static-assets/>,
  <https://developers.cloudflare.com/workers/platform/limits/>,
  <https://developers.cloudflare.com/workers/static-assets/headers/>
- Workers' and KV's free plans: <https://developers.cloudflare.com/workers/platform/pricing/>,
  <https://developers.cloudflare.com/kv/platform/limits/>
- Durable Objects on the free plan:
  <https://developers.cloudflare.com/durable-objects/platform/pricing/>
- Workers Logs and switching them off:
  <https://developers.cloudflare.com/workers/observability/logs/workers-logs/>
- Turnstile's plans, its tokens and its policy:
  <https://developers.cloudflare.com/turnstile/plans/>,
  <https://developers.cloudflare.com/turnstile/get-started/server-side-validation/>,
  <https://developers.cloudflare.com/turnstile/reference/content-security-policy/>
- R2's prices, public buckets, CORS and what Cloudflare caches by default:
  <https://developers.cloudflare.com/r2/pricing/>,
  <https://developers.cloudflare.com/r2/buckets/public-buckets/>,
  <https://developers.cloudflare.com/r2/buckets/cors/>,
  <https://developers.cloudflare.com/cache/concepts/default-cache-behavior/>
- Supabase's plans, pausing and backups: <https://supabase.com/pricing>,
  <https://supabase.com/docs/guides/platform/project-pausing>,
  <https://supabase.com/docs/guides/platform/backups>
- Its mail, rate limits, CAPTCHA and leaked-password check:
  <https://supabase.com/docs/guides/auth/auth-smtp>,
  <https://supabase.com/docs/guides/auth/rate-limits>,
  <https://supabase.com/docs/guides/auth/auth-captcha>,
  <https://supabase.com/docs/guides/auth/password-security>
- Google on a hosted project, and the custom domain:
  <https://supabase.com/docs/guides/auth/social-login/auth-google>,
  <https://supabase.com/docs/guides/platform/custom-domains>
- Its regions, migrations and user deletion: <https://supabase.com/docs/guides/platform/regions>,
  <https://supabase.com/docs/guides/deployment/database-migrations>,
  <https://supabase.com/docs/guides/auth/managing-user-data>
- `config push`, `[remotes]` and `test db --linked`: the CLI's reference,
  <https://supabase.com/docs/reference/cli/introduction>
- Google's consent screen, publishing and brand verification:
  <https://support.google.com/cloud/answer/15549945>,
  <https://support.google.com/cloud/answer/15549049>,
  <https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification>
- Mail providers: <https://resend.com/pricing>,
  <https://resend.com/docs/send-with-supabase-smtp>, <https://postmarkapp.com/pricing>,
  <https://aws.amazon.com/ses/pricing/>
