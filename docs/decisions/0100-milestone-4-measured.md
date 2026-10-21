# 0100. Milestone 4, measured and checked by hand

Date: 2026-10-21 · Status: accepted, milestone 4's closing record (item 10 of docs/milestone-4.md)

## Context

Milestone 4's done-check (docs/editor-plan.md, section 9) is that a document saved on one device
opens on another, and that an original upload is visible only to its owner. Items 1 to 9 prove both
in tests: pgTAP in the database, integration tests through the browser's own client on the local
stack, and DOM tests on a fake. Item 10 asks for one record of what the milestone costs, the
`accounts` workflow's time and the client's size, and one check by hand with two browsers, so that
the proof is not only the tests' own.

## Decision

- **The `accounts` workflow** takes 2 min 1 s on GitHub's runner (item 3's first run, 39522996491):
  the stack's cold start, with its image downloads, 78 s; `db lint` 1 s; `supabase test db` 5 s,
  70 assertions then (75 with item 5's); `test:integration` 3 s; stopping 7 s. Decision 0096's
  ceiling is ten minutes. On the owner's Mac (M4 Pro, OrbStack) the stack starts in 61 s the first
  time, 23 s after, resets in 23 s and uses about 330 MB (item 1).
- **The client's size**: supabase-js is a chunk of its own, 214.5 kB (55.2 kB gzipped), loaded only
  when a person opens sign-in, has a stored session or comes back from a sign-in link (decision
  0097). The editor's entry chunk, which a signed-out first load reads, is 1,584 kB (492 kB
  gzipped) at item 10 against 1,637 kB (506 kB) on main before the milestone's editor code: the
  signed-out first load did not grow. A DOM test proves that a signed-out editor makes no request to
  Supabase and never loads the client (item 4).
- **The check by hand**, on 21 October 2026, against the dev server and the local stack: Claude in
  Chrome as device 1 and the desktop app's built-in browser as device 2, each with its own storage,
  two invented accounts. Screenshots are in `docs/figures/milestone-4-hand-check/`.
  - Device 1, account A, saved three documents: a built-in template's (AltaCV), a `.tex` import
    (an invented resume on Jake's Resume) and a PDF import read by the editor's rules, the
    reading-service consent declined so nothing was sent to the model. All three were marked "In
    your account" (screenshot 1).
  - Device 2, signed in as A, listed all three (2) and opened each: the `.tex` import downloaded its
    original and import files and compiled with its outline (3), the PDF import (4) and the built-in
    document (5).
  - Device 1 deleted the AltaCV document; device 2 lost it at its next refresh (6).
  - Device 2 signed out, which removed A's documents from that browser and kept its own, and signed
    in as account B, which listed none of A's documents (7).
  - Found and fixed on the way: the list showed a brought-in import's package id
    (`import-…`) as its template's name until its files came; it now says "Imported resume"
    (item 9's branch). Deleting asks with the browser's own confirmation dialog, as before this
    milestone.
- **Nothing syncs before the first save's notice is read** (item 9, recorded here at the owner's
  choice of 21 October 2026): after signing in, the queue does not start until the person accepts
  "Save to my account"; until then nothing is sent or downloaded, and documents made meanwhile stay
  only in this browser and join the first sign-in's question. This is how decision 0091's "says
  what it sends, once, at the first save" and decision 0047's "told what is sent" hold before any
  request.
- **Every "Done means" of docs/milestone-4.md holds**: two devices on one account, for each kind,
  in `sync.integration.test.ts` and `originals.integration.test.ts` and by hand; owner-only rows
  and files in pgTAP (decision 0093) and in the API test "only its owner reaches an original";
  sign-in by email link and by password with confirmation and reset through Mailpit; conflicts and
  offline edits ending in two documents (item 6's and 7's tests); sign-out leaving nothing of the
  account; the signed-out editor unchanged; `pnpm test` without Docker and the `accounts` workflow
  green; no LaTeX or Supabase text in any account screen (item 9's DOM tests).

## Consequences

- The hand check ran once, on the local stack. Milestone 5 runs the API test and sign-in again on
  the hosted project, and decides the mail provider that both ways in need.
- The numbers here are the baseline a later change to the stack or the client is compared with.
- Items 4, 5 and 7 to 10 were merged on the local checks (`pnpm check`, `pnpm typecheck`,
  `pnpm test`, `supabase test db`, `db lint` and `test:integration` on the stack), not on CI: from
  21 October 2026 GitHub Actions refused every job on the repository for its account's billing, and
  the owner chose to merge on the local results. The first CI run after billing is restored, on
  `main`, is the check that the editor and `accounts` workflows agree.
- Changing a password signs in afresh with the current one, since this Auth ignores a current
  password, which leaves one more session on the server until it lapses; nothing keeps its tokens.
  The owner left it for milestone 5.
