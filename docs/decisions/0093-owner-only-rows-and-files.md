# 0093. Rows and files only their owner can reach, and the proof

Date: 2026-10-21 · Status: accepted, approved with the plan by the owner on 21 October 2026

## Context

The browser talks to Supabase directly (plan section 8.1), with a key that is public by design. What
keeps one person's resumes from another is Postgres row-level security on the `documents` table and
policies on Storage's objects. The plan's done-check for milestone 4 is that "an original upload is
visible only to its owner". Since 30 May 2026 a new table in Supabase's `public` schema is not
granted to the API's roles automatically, so a migration grants what it means to.

## Decision

- **The `documents` table**: `owner_id` references the user and is deleted with them; it defaults
  to `auth.uid()`. Row-level security is on, and there is one policy for each of select, insert,
  update and delete, for the `authenticated` role only, each requiring
  `(select auth.uid()) = owner_id` (update both before and after). The table is granted to
  `authenticated` for those four operations and to nobody else; `anon` has no grant and no policy.
  An index on `owner_id` serves the policies and the list.
- **A trigger owns the bookkeeping**: on update it sets the revision to the old one plus one and the
  change time to now, and refuses a change of `owner_id` or `id`. On insert it sets the revision to
  1 and both times to now.
- **A size bound**: a check refuses a document larger than 2 MB as JSON, far above any resume, so
  that the table cannot be used as free storage.
- **The `originals` bucket**: private, with a 50 MB limit for each file. Policies on
  `storage.objects` for select, insert, update and delete, for `authenticated` only, require
  `bucket_id = 'originals'` and that the first folder of the name is the caller's user id,
  `(storage.foldername(name))[1] = (select auth.uid()::text)`. No signed URLs (decision 0090).
- **The proof, in the database**: pgTAP tests under `apps/editor/supabase/tests/`, run by
  `supabase test db`, make two users, A and B, and as each in turn check that B cannot select,
  update or delete A's row, cannot insert a row owned by A, cannot read, list, overwrite or delete
  A's file, and cannot write a file under A's folder; that `anon` reaches neither; and that A can do
  all of it to A's own. The tests set the role and the user's claims themselves, with no helper
  library.
- **The proof, through the API**: an integration test signs in two accounts on the local stack with
  the browser's own client, has A save a `.tex` import with its original, and checks that B's
  download of A's file fails, B's list of A's folder is empty, B's select of A's row returns
  nothing, and a client with no session gets the same; then that A downloads the original byte for
  byte.
- **Review**: the pull requests that add the migrations and the sync code get one adversarial
  review before they are pushed, since a mistake here shows one person's resume to another.

## Consequences

- Every new table or bucket in later milestones needs its own grant, policies and two-account test;
  a missing grant fails loudly (permission denied) rather than leaking.
- The tests prove the policies on local Supabase. Milestone 5 runs the API test once against the
  hosted project before anyone signs in.
- The public key in the page is not a secret, and nothing relies on it being one. The service key
  is never in the page, in the repository or in CI's logs.
