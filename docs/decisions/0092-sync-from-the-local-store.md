# 0092. Sync from the local store

Date: 2026-10-21 · Status: proposed with docs/milestone-4.md; extends decision 0010

## Context

Documents live in the browser, in IndexedDB through Dexie (decision 0010). The editor saves the
whole document after every command, as one blob, at most twice a second; each row counts its writes
in a revision, and two tabs on the same document are kept apart by checking that revision and by a
message on a `BroadcastChannel`. The plan says documents "sync to the account when one exists"
(section 5.3) and that "there is no synchronisation engine because nothing is edited by two people
at once" (section 5.6). One person on two devices, or one device that was offline, can still make
two versions of a document. Nobody uses the editor yet, so no stored document needs migrating.

## Decision

- **The browser's store stays the one the editor writes.** Every save goes to IndexedDB first, as
  today. Sync is a queue beside it that sends each signed-in document's latest save to the account,
  and brings the account's newer documents into the store. The editor never waits on the network.
- **Each local row gains three fields**: `owner`, the user id of the account it belongs to, or none
  for a document that is only in this browser; `serverRevision`, the account's revision it was last
  in step with, or none if it was never uploaded; and `pending`, true while it has saves the account
  has not taken. The store's version goes to 3.
- **Sending is one blob with a revision check.** The queue sends a document's whole row, at most
  once every two seconds per document, at once when the page is hidden, and after a failure with a
  growing wait up to a minute. An update names the `serverRevision` it starts from, and the server
  writes it only if the row is still at that revision; a trigger then counts the revision up and
  stamps the time, whatever the browser sent. A new document is inserted with its own id.
- **Only one tab sends.** The tabs take the queue in turn through a Web Lock named
  `resume-tools-sync`, so two tabs never send the same document. Decision 0010's rules between tabs
  are unchanged.
- **A conflict never loses work.** When the server refuses an update because its revision moved,
  the account's version wins the document's id, and this device's version is kept as a new document
  whose title ends in "(from this device)", sent to the account like any other. The editor says, in
  plain words, that the document was changed on another device and that this device's version was
  kept as a copy. Nothing is merged.
- **Bringing documents in.** On load, on sign-in, when the page becomes visible again and every five
  minutes while it is visible, the queue lists the account's documents (id, revision and time only)
  and downloads the rows that are newer than this device's. A document open in the editor that
  changed in the account, with no pending saves here, takes the newer version with the message
  "This document was changed on another device." and a Reload, as a change in another tab does
  today. There is no live subscription.
- **Offline.** Saves keep going to the browser. The document list marks each document "in your
  account", "waiting to save to your account" or "only in this browser", and the queue sends when
  the connection returns.
- **Signing in with documents already in this browser.** The first time a person signs in on a
  browser that holds documents only in this browser, the editor asks once whether to add them to the
  account, saying what is sent. "Add them" uploads them; "Not now" leaves them only in this browser,
  and each can be added later from the list. A document is never uploaded without that answer.
- **Signing out** sends what is pending, then removes the account's documents and their import
  files from this browser, so that a shared computer keeps nothing of the account. If some saves
  could not be sent, it names the documents and asks before removing them. Documents only in this
  browser stay. The session's tokens are removed with them.
- **Another account on the same browser** never sees the first account's documents: the list shows
  only documents with no owner or the signed-in owner, and any left by an account that did not sign
  out are removed once they hold no pending saves.
- **Deleting a document** deletes it from the account, row and files, and from this browser. Another
  device learns of it from the list: a document it had in step with the account (it has a
  `serverRevision`) and that the account no longer lists is removed there, unless it has pending
  saves, in which case it is kept as a new document as in a conflict. No tombstones are stored.
- **Persistent storage is not asked for.** Decision 0010 left it for this milestone. A signed-in
  person's documents are in the account, which is the remedy for a browser that evicts the site's
  storage; asking would show some browsers' permission prompt to everyone for the benefit of those
  who never sign in. The list's "only in this browser" mark tells them.

## Consequences

- Two devices editing the same document at once produce copies, not a merge. Since one person does
  not usually type on two devices at once, copies should be rare, and they are never silent.
- The account's revision and the browser's tab revision are separate counters, each guarding its
  own boundary.
- A device that stays offline for long and then comes back may bring several copies. The person
  deletes the ones they do not want.
- The five-minute refresh and the visibility check cost one small request each while the page is
  visible and signed in. Nothing is sent while signed out.
