# 0105. Deleting an account, finished

Date: 2026-10-21 · Status: accepted, approved by the owner on 27 October 2026 with the plan for
milestone 5 (docs/milestone-5.md); finishes 0095

## Context

Decision 0095 designed deleting an account and left building it to milestone 5: the browser
deletes the person's files, then calls a function that deletes only its caller. It does not say
what the sync queue does meanwhile, what another device signed in to the account does once the
account is gone, or how the function sees a file left, and it names no test.

## Decision

- **Decision 0095 stands.** "Delete my account" sits in the account menu, behind the editor's own
  confirmation, which names how many documents and files go and says that documents only in this
  browser stay. The browser deletes every file under the person's folder in `originals` through
  Storage, then calls `delete_my_account()`, which takes no argument, runs with definer's rights,
  refuses while any file of the caller is left, and deletes `auth.uid()` alone, the rows going
  with the user by their foreign key. This browser then removes the account's documents and
  import files, signs out and says the account is gone. There is no grace period and no undo.
- **The queue stops first.** The tab that sends holds the Web Lock `resume-tools-sync` for as long
  as it is open and visible, and a Web Lock does not nest, so asking for it and waiting would wait
  behind that tab, or behind itself. Deleting stops this tab's queue, then takes the lock with
  `steal`, which ends any other tab's hold, and that tab's queue stops sending when its hold ends.
  It keeps the lock from the first file to the end, so no tab sends a save or an upload in
  between. Saves the account has not taken, for that account's documents, go with them, and the
  confirmation says so when there are any.
- **The function sees a file left** with a query on `storage.objects` for the bucket `originals`
  and a first folder equal to the caller's id, which its definer's rights can read. It then
  refuses with an error of its own, which the editor shows in plain words: the account was not
  deleted because some of its files are still there, and trying again finishes it.
- **Another device** finds the account gone at its next request, when the session is refused or a
  write is refused because its owner no longer exists, and treats that as a sign-out it did not
  ask for. The account's documents leave that browser, except those holding saves the account
  never took, which stay as documents only in this browser, as a conflict's copy does under
  decision 0092. The editor says the account was deleted on another device.
- **Tests.** pgTAP, with two users: the function refuses while a file of the caller is left;
  deletes its caller and the caller's rows; leaves the other user, their rows and their files
  alone; and cannot be called by `anon`. An integration test on the local stack with two devices
  on one account: the first deletes; the second finds the account gone, keeps a document with an
  unsent save as only in this browser and loses the rest; and the table and the bucket hold
  nothing of the account. One adversarial review, with the migration.

## Consequences

- A deletion stopped between the files and the function leaves an account whose `.tex` imports
  have lost their originals. The function's refusal and the editor's message make trying again the
  way out.
- An unsent save on another device outlives the deletion, so a person who deleted their account
  by mistake may still find their latest work in one browser. It is the only undo there is.
- The project is on Free, which keeps no backups (decision 0104), so a deleted account is gone at
  once and no copy outlives it. The privacy page says so. If the project ever moves to a plan with
  backups, the page says how long they hold a deleted account.
