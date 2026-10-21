# Milestone 4: accounts and cloud save

Written 21 October 2026, for the owner's approval before anything is built. Each numbered item is
one pull request, or a few if it grows past ten minutes of reading. Tick the item in the pull
request that finishes it.

## The goal

The plan (docs/editor-plan.md, section 9) sets milestone 4 as: "Sign-in, the document store, sync
from the local store, and private storage of originals." Its done-check: "A document saved on one
device opens on another, and an original upload is visible only to its owner."

The owner settled four things before this plan was written, on 5 October 2026, and reconfirmed them
on 20 October 2026:

1. **Stop at the plan.** This file and its decision records are merged, and the owner approves them
   before a build starts.
2. **Development runs against local Supabase**: Supabase's own stack in Docker, started by its CLI.
   No Supabase account and no cloud project. The two-device proof is two browser profiles, or two
   clients in a test, against that stack. Hosting stays milestone 5.
3. **Sign-in by email link, Google, and email and password**, all three (Google then moved to
   milestone 5, point 5 below).
4. **Dependencies are decided in the plan**, named below, and approved with it. The pull request
   that adds this plan adds none.

On 21 October 2026, reading the first draft of this plan, the owner settled four more:

5. **Google waits for milestone 5.** This milestone signs in by email link and by email and
   password; Google comes with the production client at hosting.
6. **A password is at least 8 characters.**
7. **Deleting an account waits for milestone 5.** Its design is recorded now (decision 0095).
8. **Signing out removes the account's documents from that browser**, as this plan proposed.

## Where milestone 3 left us

- **Documents live in the browser** (decision 0010): one IndexedDB database, `resume-tools`, through
  Dexie, at version 2 since imports arrived (decision 0038). A document is one row: a random UUID, a
  title taken from the resume, its template, when it was made and changed, a revision that counts
  its writes, and the whole document as one blob. The editor saves after every command, at most
  twice a second, and at once when the page is hidden.
- **Two tabs** on the same document are kept apart by that revision, checked inside the write, and a
  message on a `BroadcastChannel`; the losing tab offers a Reload.
- **Three kinds of document.** A built-in template's (Jake's Resume, AltaCV, Awesome-CV) is the
  canonical model. A `.tex` import is an outline in the same model (decision 0049) on an imported
  package; the store keeps, in a `packages` row, the person's uploaded files as given, the import's
  job and its report. A PDF import is a canonical-model document on a built-in template; the PDF
  itself is not kept.
- **What the store does not do**: no persistent-storage request, no export, no rename (the title
  follows the resume's name). 0010's consequences leave persistent storage to this milestone.
- **The privacy rule** (decision 0047): resume content leaves the browser only when the person asks
  for something that needs it and is told what is sent, and whoever receives it keeps only what the
  person asked to be kept. Saving to an account sends the document and keeps it.
- **Nothing of accounts exists yet** but two empty variables in `apps/editor/.env.example`,
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. No Supabase code, no Playwright, no Docker in
  development.
- **Nobody uses the editor yet** (owner, 7 October 2026), so no stored document needs migrating.

## What the plan says, and where this milestone departs from it

The plan agrees with itself on the document store and disagrees on originals:

- Sections 5.6 and 6.3: the document store holds "for imports the original upload, visible only to
  its owner", and "the original upload is stored in its owner's account and nowhere else".
- Sections 8.1 and 8.2: R2 holds "uploads" and Cloudflare serves "uploaded originals"; Supabase
  holds sign-in and saved resumes; "the two never talk to each other".

R2 has no rule of its own that limits a file to one person. A private original on R2 needs a Worker
that checks the person's Supabase session, which is server code between the two and makes them talk.
This milestone keeps originals in Supabase Storage instead (decision 0090), and lists the edits to
the plan page under "What the owner does". It does not edit docs/editor-plan.md, which is the
owner's (decision 0048).

Sections 5.3 ("sync to the account when one exists") and 5.6 ("no synchronisation engine because
nothing is edited by two people at once") are both kept: sync here is a queue that sends whole
documents with a revision check, not an engine that merges.

## Where originals live

Decision 0090.

- An original upload lives in Supabase Storage, in one private bucket, `originals`, under the
  owner's user id: `<user id>/<document id>/original.zip`, with the import's own files beside it as
  `<user id>/<document id>/import.bin`.
- The bucket is private, with no signed or public links. The browser reads and writes through
  Storage's API with the person's session, and the policies under "Who can see what" decide.
- R2 keeps only what is the same for everyone: the engine, the fonts and the TeX Live files.
- At hosting nothing moves: the hosted project gets the same bucket and policies from the same
  migrations.
- The cost: originals count against Supabase's storage (1 GB on the free tier) and its downloads
  (5 GB a month). Most uploads are a few hundred kilobytes; the import's caps bound one at 20 MB of
  zip or 100 MB unpacked. Milestone 5 measures and decides on a cap per account.

## Sync from the local store

Decision 0092, which extends decision 0010.

- **The browser's store stays the one the editor writes.** Sync is a queue beside it. The editor
  never waits on the network.
- **Three new fields on each local row**: `owner` (the account's user id, or none for a document
  only in this browser), `serverRevision` (the account's revision it was last in step with, or none)
  and `pending` (saves the account has not taken). The store goes to version 3; nothing is migrated.
- **One blob, with a revision check.** The queue sends a document's whole row at most every two
  seconds per document, at once when the page is hidden, and after a failure with a growing wait up
  to a minute. An update names its `serverRevision`, and the server writes it only if the row is
  still at that revision; a trigger counts the revision up and stamps the time. A new document is
  inserted with the id it already has.
- **One tab sends**, holding the Web Lock `resume-tools-sync`. 0010's rules between tabs stay.
- **A conflict never loses work.** The account's version keeps the id; this device's version becomes
  a new document whose title ends in "(from this device)", and the editor says so. Nothing is
  merged.
- **Bringing documents in**: on load, on sign-in, when the page becomes visible, and every five
  minutes while visible, the queue lists the account's documents (id, revision and time) and
  downloads the newer rows. An open document changed elsewhere, with nothing pending here, offers
  "This document was changed on another device." with a Reload, as a change in another tab does.
  No live subscription.
- **Offline**: saves keep going to the browser, the list marks each document "in your account",
  "waiting to save to your account" or "only in this browser", and the queue sends when the
  connection returns.
- **Signing in with documents already here**: the first sign-in on a browser with documents only in
  this browser asks once whether to add them to the account, saying what is sent. "Not now" leaves
  them; each can be added later from the list. Nothing is uploaded without the answer.
- **Signing out** sends what is pending, then removes the account's documents, their import files
  and the session from this browser. If saves could not be sent, it names the documents and asks
  first. Documents only in this browser stay.
- **Another account on the same browser** sees only its own documents and those with no owner.
- **Deleting a document** deletes it from the account and this browser. Another device removes it
  when the account's list no longer has it, unless it has pending saves, which become a new document
  as in a conflict. No tombstones.
- **Persistent storage is not asked for**: the account is the remedy for eviction, and the list's
  "only in this browser" mark tells a signed-out person where their documents are.

## What is stored for each kind of document

Decision 0091.

| Kind | In the `documents` table | In the `originals` bucket | Not kept |
|---|---|---|---|
| Built-in template | one row: the document as JSON | nothing | |
| `.tex` import | one row: the outline document as JSON | `original.zip`, the uploaded files exactly as given; `import.bin`, the imported package, the job and the report | |
| PDF import | one row: the canonical-model document as JSON | nothing | the PDF, in the account and in the browser |
| Every kind | | | dumped formats, prefetch lists, compiled PDFs |

- A row holds the document's id (the browser's UUID), its owner, its kind (`template`, `tex`,
  `pdf`), its template's id, its title, the document, the server's revision, and when it was made
  and changed.
- `import.bin` refers to the files of `original.zip` by name rather than storing the job's copy
  again. The package is kept, not rebuilt, because rebuilding reruns the import, takes seconds to
  minutes, and is not promised to give the same outline once the import changes.
- The first save to an account says, once and in plain words, what is sent and kept: the document,
  and for an imported `.tex` the uploaded files, kept until the person deletes them. That is the
  privacy rule's "told what is sent", and saving is the person's request.
- An imported document opens on another device once its row and its two files are downloaded. The
  files are downloaded when the document is opened, not when the list refreshes.

## Who can see what: row-level security and the two-account proof

Decision 0093.

- **The table**: row-level security on; one policy each for select, insert, update and delete, for
  `authenticated` only, requiring `(select auth.uid()) = owner_id`. Granted to `authenticated` and
  to nobody else, since new tables are no longer granted automatically. `owner_id` defaults to the
  caller and goes with the user. A trigger owns the revision and the times and refuses a change of
  owner or id. A check refuses a document over 2 MB.
- **The bucket**: private, 50 MB a file. Policies on `storage.objects` for the four operations, for
  `authenticated` only, require `bucket_id = 'originals'` and that the first folder is the caller's
  id, `(storage.foldername(name))[1] = (select auth.uid()::text)`.
- **Proof in the database**: pgTAP tests, run by `supabase test db`, make users A and B and check,
  as each, that B cannot select, update, delete or insert-as-A on A's row, cannot read, list,
  overwrite or delete A's file or write under A's folder; that `anon` reaches neither; and that A
  can do all of it to A's own.
- **Proof through the API**: an integration test signs in A and B with the browser's own client on
  the local stack; A saves a `.tex` import with its original; B's download of it fails, B's listing
  of A's folder is empty, B's select of A's row is empty, and a client with no session gets the
  same; A downloads the original byte for byte.
- **Proof by hand**, at the end: two browser profiles, two accounts; the second never sees the
  first's documents or original.
- **Deleting an account** is milestone 5's (the owner's decision of 21 October 2026). Decision
  0095 records how: the browser deletes the person's files through Storage, then calls a
  definer's-rights function with no argument that refuses while files remain and deletes only its
  caller, whose rows go with the user. Until then an account can be removed only by hand on the
  local stack, which holds no real person's data.

## Signing in

Decision 0094.

- **Two ways in this milestone**: a link sent by email, and an email with a password. Google, the
  third way the owner chose, waits for milestone 5 (below).
- **The client**: Supabase's browser client with the PKCE flow, the session kept in local storage
  and refreshed by the client. A link opened in another browser says so and offers to send a new
  one.
- **Email link**: an email, then a link that signs in and makes the account if needed.
- **Email and password**: signing up needs the email confirmed first. A password is 8 to 72
  characters with no rule on which characters (the owner's choice of 21 October 2026, the common
  minimum; NIST asks for 15 when a password is the only factor, and the email link is there for
  anyone who wants no password at all). A failed sign-in does not say whether the email or the
  password was wrong.
- **Reset**: "Forgot your password?" sends a link whether or not the account exists, and says so.
  The link opens the editor in a recovery state to set a new password. Changing a password while
  signed in asks for the current one.
- **Linking**: an email link and a password on the same address are the same account in Supabase,
  since both are its email identity. Supabase's automatic linking is kept for when Google arrives:
  a Google identity with the same verified address joins the existing user, and unconfirmed
  identities on that address are dropped first, which stops someone claiming an account with
  another person's address. Manual linking stays off.
- **Why Google waits for milestone 5**: Google needs an OAuth client that only the owner can
  register, and hosting needs a production client with a verified consent screen anyway. The owner
  chose on 21 October 2026 to register once, at hosting, rather than a testing client now and a
  production one later. Decision 0094 records how it will be tested then: a web application client
  whose redirect address is the project's `/auth/v1/callback` (on the local stack,
  `http://127.0.0.1:54321/auth/v1/callback`), its secret read through `env()` from an untracked
  file, a sign-in checked by hand, and CI checking only that the button leads to Google's address
  with the right redirect.
  Nothing of Google is built in this milestone.
- **Mail**: locally every email lands in Mailpit, the stack's catcher, at `http://127.0.0.1:54324`,
  and the tests read sign-in and reset links from its HTTP API. Nothing is sent. A real mail
  provider is milestone 5's.
- **Words**: every message is the editor's own plain English; Supabase's error text is never shown.

## How CI tests it

Decision 0096, which extends decision 0029.

- **Unit tests, everywhere**: the sync queue is written against a small interface for the server
  side; `pnpm test` runs it on an in-memory fake with fake-indexeddb, and needs no Docker. The
  account screens are DOM tests on the same fake.
- **A new workflow, `accounts`**, on pull requests and pushes to `main` that touch
  `apps/editor/supabase/**`, the editor's account and storage code, its own file, or the root
  `package.json` and lockfile. It starts the stack with the pinned CLI, without Studio, Realtime,
  the edge runtime, logging, the pooler, the image proxy and the admin API, then runs `supabase db
  lint --fail-on error`, `supabase test db`, and the integration tests.
- **Integration tests**, `name.integration.test.ts` beside the code, with a script of their own,
  skip unless the stack's address is set. Two fake-indexeddb stores stand for two devices; Mailpit's
  API gives the links.
- **No browser driver** and no Google or hosted Supabase in CI; no secrets, since the local stack's
  keys are fixed development keys. The two-profile check is by hand, once, in item 10.
- Item 1 measures the stack's start time on a runner; over ten minutes for the workflow, and the
  plan is revised.

## Dependencies

Decision 0097. The owner approves these with the plan; each pull request that adds one names it.

| What | Where | Why |
|---|---|---|
| `@supabase/supabase-js`, version 2, MIT | runtime dependency of `apps/editor` | the browser's client for sign-in, the table and Storage; loaded on demand, so a signed-out first load does not grow |
| `supabase`, the CLI, at an exact version, MIT | development dependency of `apps/editor` | one pinned version for every machine and for CI; its binaries come as optional dependencies, with no install script; Supabase's guide recommends it over Homebrew, which drifts per machine |
| A container runtime | the machine: OrbStack on the owner's Mac, Docker on GitHub's runners | runs only the local Supabase stack; AGENTS.md gains this as Docker's third use (decision 0089) |

Already part of the stack, so not dependencies: Mailpit and pgTAP. Already dependencies: Dexie,
fake-indexeddb, fflate, Zod, Vitest and jsdom. Not added: Playwright or any browser driver, a
Supabase test-helper extension, the CLI's GitHub Action, a query or state library, a generated
types package.

## Done means

- **A document saved on one device opens on another**, for each of the three kinds: shown by an
  integration test with two devices on one account, and by hand with two browser profiles. An
  imported `.tex` opens and compiles on the second profile.
- **An original upload is visible only to its owner**: the pgTAP tests and the API test with two
  accounts and no session pass in CI, and the second profile's account sees nothing of the first's.
- **Sign-in works two ways**: email link, and email and password with confirmation and reset, both
  through Mailpit in CI.
- **No edit is lost**: a conflict and an offline edit each end in two documents, never one
  overwritten, which tests prove.
- **Signing out leaves nothing of the account** in the browser; signing in elsewhere shows it all.
- **A signed-out person's editor is unchanged**: it sends no request to Supabase and does not load
  its client, which a test proves.
- **`pnpm test` runs without Docker**, and the `accounts` workflow is green.
- **A person never sees LaTeX or Supabase's own error text** in any account screen.

## Not in this milestone

- Sign-in with Google: the button, the OAuth client, its consent screen and its test. Milestone 5
  (the owner's decision of 21 October 2026); decision 0094 records the design.
- Deleting an account. Milestone 5 (the owner's decision of 21 October 2026); decision 0095 records
  the design.
- Hosting: the hosted Supabase project, its region, its keys, a real mail provider, a custom domain,
  deploys. Milestone 5.
- Supabase's leaked-password check and a cap on sign-ups or on storage per account. Milestone 5.
- A bot check on sign-up. Milestone 5, with the hosting.
- Two-factor sign-in, and sign-in with Apple, GitHub or any other provider.
- Sharing a document with another person, editing together, live updates.
- Version history, undo across sessions, export of documents or of the account.
- Originals on R2.
- Sending a PDF to the checker from an account: the checker stays anonymous (decision 0030).
- The Notion status page, the corpus workflow, and the ATS's milestone 2.

## The work, in order

Stage 0 sets up the stack and its guard. Stage 1 signs people in. Stage 2 saves their documents.
Stage 3 proves the milestone. Stage 2's queue (item 6) needs nothing of Stage 1 and can run beside
it; from item 7 on, Stage 2 uses item 4's client.

### Stage 0. The stack, the schema and its proof

1. [x] **The local stack.** Adds the pinned CLI as a development dependency,
   `apps/editor/supabase/` with `config.toml` (the editor's address as `site_url`, the services left
   out, Mailpit on, the `originals` bucket, sign-up and confirmations and the 8-character minimum as
   decision 0094 says), scripts to start, stop and reset the stack, and the stack's local address
   and public key in `.env.example` under the name the pinned CLI prints for it. Amends AGENTS.md:
   the commands, and Docker's third use (decision 0089). Measures the stack's cold and warm start on
   this machine and on a runner, and its memory. Done when, from a clean checkout and the README
   alone, the stack starts, `supabase db reset` runs and the stack stops, and the times are written
   in the pull request. No workflow runs the stack before item 3, so item 1 writes this machine's
   times and item 3's pull request writes the runner's.
2. [ ] **The schema and the policies.** One migration: the `documents` table, its grant, its four
   policies, its trigger, its size check and its index; and the bucket's four policies. pgTAP tests
   with two users, as decision 0093 lists. Gets an adversarial review. Done when `supabase test db`
   passes every two-account case and `supabase db lint --fail-on error` is clean.
3. [ ] **The `accounts` workflow.** As decision 0096 says. Done when it runs item 2's tests green on
   its own pull request and its run time is recorded, under ten minutes.

### Stage 1. Signing in

4. [ ] **The client and the email link.** A module that loads `@supabase/supabase-js` on demand
   with PKCE, knows whether a session is stored without loading it, and signs out. A "Sign in" entry
   in the editor's header and a panel with the email link. Done when a DOM test with the fake shows
   that a signed-out editor makes no request and loads no client, and an integration test signs in
   by email link read from Mailpit and signs out.
5. [ ] **Email and password.** Sign up with confirmation, sign in, the one message for a failed
   sign-in, the 8-character minimum in plain words, "Forgot your password?" and the recovery state,
   and changing a password with the current one. Done when integration tests cover sign up, confirm
   and sign in; a short password refused; a wrong password; reset through Mailpit for an existing
   and a missing address, with the same reply; and a password change.

### Stage 2. Saving to the account

6. [x] **The queue, on a fake.** Store version 3 with `owner`, `serverRevision` and `pending`; the
   queue against the server interface, with the Web Lock; and the in-memory fake. Done when unit
   tests cover each rule of decision 0092: send, revision check, conflict copy, bringing documents
   in, an open document changed elsewhere, offline and back, the first sign-in's question, sign-out
   with and without pending saves, another account on the same browser, deletion on another device
   with and without pending saves.
7. [ ] **The queue, on Supabase.** The server interface over the client and the `documents` table.
   Gets an adversarial review. Done when an integration test with two devices on one account shows
   a built-in document and a PDF import saved on one open on the other, a conflict ending in two
   documents, and a deletion reaching the other device.
8. [ ] **Originals.** On saving a `.tex` import: `original.zip` and `import.bin` uploaded under the
   owner's folder; on opening it on another device: both downloaded and unpacked into the store's
   package and import record. Deleting the document deletes both. Gets an adversarial review. Done
   when an integration test shows a `.tex` import's original and import files arrive on the second
   device byte for byte and the document opens there with its package, and the API test of decision
   0093 passes: B and a client with no session read nothing of A's.
9. [ ] **The editor's account screens.** The account's state in the header; the list's three marks;
   the first save's notice of what is sent; the first sign-in's question; the sign-out warning; the
   conflict and changed-elsewhere messages; "cannot be opened until online". Done when DOM tests
   cover each message and none shows LaTeX or Supabase's text.

### Stage 3. Close

10. [ ] **The milestone, proven.** By hand, with two browser profiles against the dev server and
    the local stack: one account saves a built-in document, a `.tex` import and a PDF import on the
    first profile, and all three open on the second, the `.tex` one compiling; a second account on
    the second profile sees none of them; the first account deletes a document and the other
    profile loses it. One record measures the milestone: the workflow's time, the client's size
    when loaded, and what the hand check showed. Done when that record is merged and every box
    under "Done means" holds.

| Item | Size | Depends on |
|---|---|---|
| 1 The local stack | small | the owner's approval of this plan |
| 2 Schema and policies | medium | 1 |
| 3 The `accounts` workflow | small | 2 |
| 4 Client and email link | medium | 1 |
| 5 Email and password | medium | 4 |
| 6 The queue, on a fake | large | 1 |
| 7 The queue, on Supabase | medium | 2, 4, 6 |
| 8 Originals | medium | 7 |
| 9 Account screens | medium | 5, 7 |
| 10 The milestone, proven | small | all |

## Decisions this milestone makes

Each has its record in `docs/decisions/`, merged with this plan. The first, the ways to sign in, the
password's length and what waits for milestone 5 are the owner's; the rest are proposed and
approved with the plan.

- **0089. Milestone 4 runs on local Supabase**, with Docker's third use, the stack in
  `apps/editor/supabase/`, and the stop at the plan.
- **0090. Originals live in Supabase Storage**, private to their owner, with no signed links; R2
  keeps only what is the same for everyone.
- **0091. What an account keeps for each kind of document**: a row for each, two private files for
  a `.tex` import, and no PDF.
- **0092. Sync from the local store**: the browser writes first, one blob with a revision check, a
  copy on conflict, one tab sending, the sign-in question, sign-out clearing the browser, and no
  persistent-storage request.
- **0093. Rows and files only their owner can reach**, and the two-account proof in the database
  and through the API.
- **0094. Signing in** by email link and password in this milestone, Google in milestone 5: PKCE,
  confirmation, 8 characters, reset, automatic linking by verified email.
- **0095. Deleting an account**, built in milestone 5: files first, then a function that deletes
  only its caller.
- **0096. How CI tests accounts**: a fake in `pnpm test`, the real stack in a workflow of its own.
- **0097. Milestone 4's dependencies**: the client, the CLI, and a container runtime.

## Risks

- **A policy mistake shows one person's resume to another.** The two-account tests in the database
  and through the API, and an adversarial review of items 2, 7 and 8.
- **Sync loses an edit.** The browser always writes first, a conflict always makes a copy, and
  nothing pending is ever removed without asking. Item 6's tests cover each path before any network
  code exists.
- **The stack is heavy.** It wants about 2 GB of memory and Docker. Only accounts work needs it; the
  rest of the repository's checks do not. Leaving out unused services helps; item 1 measures it.
- **The local stack is not the hosted one.** Mail is caught, keys are fixed, limits differ, and the
  hosted service has features the local one lacks. Milestone 5 reruns the API test and sign-in on
  the hosted project.
- **Supabase changes under us.** The Data API stopped granting new tables on 30 May 2026, and the
  mail catcher's config was renamed. One pinned CLI version, upgraded on purpose, contains it.
- **Google arrives late.** People who expect it get email link and password until milestone 5.
- **Email at launch.** Supabase's built-in sender is rate-limited and for trials, and both ways in
  this milestone depend on email. Milestone 5 needs a mail provider.
- **Free-tier limits.** A hosted free project pauses after a week idle, storage is small and
  downloads are 5 GB a month; originals are larger than resumes. Milestone 5's question.
- **The session sits in local storage**, readable by any script on the page. The editor runs no
  third-party script.
- **Copies may pile up** for a person who works offline on two devices. They are named and never
  silent; the person deletes them.
- **Shared editor surface.** The ATS's milestone 2 (@keaenlim) adds a check page to the editor. Its
  header and panels are the same ones item 9 changes, so whichever lands second rebases.

## What the owner does

- **Approves this plan**, the proposed decisions 0090 to 0097, and the dependencies of decision
  0097, before item 1 starts.
- **Approves AGENTS.md's change** in item 1: Docker also runs the local Supabase stack.
- **May revise the plan page**, docs/editor-plan.md, where this milestone departs from it: section
  8.1's Cloudflare row loses "uploads"; section 8.2 moves "uploaded originals" from Cloudflare to
  Supabase; section 8.3's Supabase line counts originals beside saved resumes; and section 5.3 or
  5.6 may name the sync as a queue of whole documents with a revision check.
- **At milestone 5**: registers the Google OAuth client (a web application client, the consent
  screen with `openid`, `email` and `profile`, the project's callback address), its secret kept out
  of the repository; and settles the hosted project and its region, the mail provider, the
  leaked-password check, and any cap on sign-ups or storage.

## How the work is run

As milestone 3 was: one branch and one worktree an item, checks run before the pull request, squash
merge on green. Items 2, 4, 5, 7 and 8 get one adversarial review before they are pushed: they
decide who can sign in, who can read a resume, or move it between devices (items 4 and 5 added by
the owner on 21 October 2026, under the standing policy for sign-in code). The stack runs one at a
time on the machine. No item touches `apps/ats` or `packages/contracts`, and none needs a corpus run.

## Sources for the outside facts

- Row-level security and its performance advice:
  <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Storage access control and folder policies:
  <https://supabase.com/docs/guides/storage/security/access-control>
- Identity linking and the removal of unconfirmed identities:
  <https://supabase.com/docs/guides/auth/auth-identity-linking>
- Passwords, confirmations and reset: <https://supabase.com/docs/guides/auth/passwords>
- Google sign-in and its local redirect address:
  <https://supabase.com/docs/guides/auth/social-login/auth-google>
- The local stack, its ports and its CLI install:
  <https://supabase.com/docs/guides/local-development/cli/getting-started>
- Testing with pgTAP: <https://supabase.com/docs/guides/local-development/testing/overview>
- `supabase start` and the services it can leave out:
  <https://supabase.com/docs/reference/cli/supabase-start>
- NIST's guidance on password length: <https://pages.nist.gov/800-63-4/sp800-63b.html>
