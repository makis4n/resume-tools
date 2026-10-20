# 0095. Deleting an account

Date: 2026-10-21 · Status: proposed with docs/milestone-4.md

## Context

Decision 0047 says whoever receives resume content keeps only what the person asked to be kept. A
person who no longer wants an account must be able to take back everything it holds without writing
to anyone. Deleting a user in Supabase normally needs the service key, which never reaches the
browser, and the plan has no server code of the editor's own beside Supabase.

## Decision

- **A "Delete my account" action**, behind a confirmation that names how many documents and files go
  with it, deletes the account and everything it keeps.
- **Files first, then the user.** The browser deletes every file under the person's folder in the
  `originals` bucket through Storage's API, under the policies of decision 0093. It then calls a
  database function, `delete_my_account()`, that runs with the definer's rights, refuses if any file
  of the caller is left, and deletes the caller's own user, `auth.uid()`, and nothing else; the
  person's rows go with the user by the foreign key. Execution of the function is granted to
  `authenticated` only.
- **Then this browser**: the editor removes the account's documents and import files from the store,
  signs out, and says the account is gone. Documents only in this browser stay.
- **No grace period and no undo.** Nothing is kept for later recovery.

## Consequences

- One function runs with raised rights. It takes no argument, so it can only ever delete its caller,
  and its pull request gets an adversarial review with the migrations.
- If deleting the files fails partway, the function refuses and the person can try again; nothing is
  half deleted from the database's side.
- The other devices of a deleted account find their session refused at the next request, and treat
  it as a sign-out of that account.
