# 0010. Documents in the browser

Date: 2026-09-25 · Status: accepted

## Context

Milestone 2 item 13 keeps documents in the browser, as plan section 8.1 chose: IndexedDB through
Dexie for documents and formats, and ordinary HTTP caching for TeX Live's files, which never change
once published. Until now a reload lost the document, every session dumped its template's format
again (0.37 s in Chrome, and on a cold cache 8 MB of TeX Live files, decision 0003), and the worker
fetched each file with a synchronous request of its own, one round trip at a time. Item 4's review
also left this item a question: what a stored document does with a choice a revised package no
longer offers. Dexie 4 is the one new runtime dependency; the store's tests run on fake-indexeddb.

## Decision

- **One database,** `resume-tools`, version 1, behind `DocumentStore` in
  `apps/editor/src/storage/store.ts`:

  | Table | Holds | Bound |
  |---|---|---|
  | `documents` | `id`, a random UUID; `title`, the header's name or "Untitled"; `template`; `createdAt`; `updatedAt`, indexed for the list; `revision`, a count of the document's writes, which a row written before revisions lacks and which then reads as 0; and the `document` as the editor holds it | none |
  | `formats` | `key`, which is `<tag>:<engine>:<name>`; `tag`; `engine`; `name`; `bytes`; `usedAt` | 20, the least recently used dropped as a new one comes in, since a format is 6 to 9 MB |
  | `prefetch` | `template`, and the `paths` its dumps and compiles have read, first read first | 2,000 paths; later ones are not kept |

  (Decision 0038 makes it version 2: a `packages` table for imported templates, and documents
  indexed by their template.)

- **Saves.** The app saves the whole document after every command. The store writes the newest
  save of each document at most twice a second, and at once on `pagehide` and when the page is
  hidden, the last moments a page can count on running; `flush()` writes at once, and says how
  many saves it wrote, which documents' saves it could not write, and which met another tab's
  change. A list or a read flushes first, so the list the "Documents" button shows has the last
  edit.
- **A save that fails is kept.** It waits in memory, unless a newer save of the document has come
  meanwhile, and the next flush writes it: a later save's, a read's, the page going away, a Retry,
  or the store's own, which tries again two seconds after a failure at the soonest, so that a full
  disk is not asked twice a second. A disk that is full first gives up the least recently used
  format, which saves only a dump, to make room for the document. While a save of the open document
  is not written, the editor keeps the document open with its history, the only copy of the edits:
  the message line says "This document could not be saved in this browser." with a Retry, and
  "Documents" flushes first and leaves only once nothing was left unwritten. The message goes once
  a flush writes the document.
- **Two tabs.** Every tab shares the database, and a new tab opens the most recent document, so
  two tabs can hold the same one. `get` returns a document with its revision, and the app's saves
  name that revision; a write reads the row's revision in the transaction that puts the save and,
  when another tab has written since, puts nothing and reports a conflict. After every write and
  delete a tab posts `{ type: "changed", id, revision }` or `{ type: "deleted", id }` on the
  `BroadcastChannel` named after the database, `resume-tools`, and a tab that holds the document at
  an older revision takes it as changed. Either way the editor says "This document was changed in
  another tab." with a Reload, which reads the document again and drops the edits made here since,
  and takes no edit until then, so that none is made that could not be saved.
- **The last writes.** A page may run no task after `pagehide`, and one being hidden may be going
  away, so what waits then is put and committed in the same task (`IDBTransaction.commit`), with no
  read of the row first: those writes are guarded only by what the tab has heard from the others.
  A read's answer comes in a later task, which such a page may never run, and a transaction waiting
  on it may never commit.
- **Reading.** A document is checked against the model when it is read. One the strict schemas
  refuse, as they refuse a newer editor's (decision 0006), is refused whole, and the user reads
  "This document cannot be opened by this version of the editor."; it stays stored, and only the
  user deletes it. A document whose template this editor does not have is refused the same way.
- **Choices.** A document keeps only the choices made for it. A new one holds the page size its
  locale implies (plan section 5.4) and nothing else, and a control a document leaves out is the
  package's default, so a revision of a package that changes a default reaches every document that
  never chose. A stored choice the package now refuses, for a control it no longer offers or a font
  it no longer lists, is dropped when the document opens, with a warning on the console naming it;
  the document opens on the package's default, and the next save writes it without the choice.
  Refusing the document instead would keep the user from their own text over a template's revision.
- **Formats.** The scheduler asks the store for a format before it would dump one, and hands the
  engine a copy; after a dump it keeps the bytes. A format is good only for the engine build that
  dumped it, since TeX refuses another build's, so it is kept under the build's tag, and keeping one
  drops those of every other build first, in a transaction of its own, so that their space is freed
  even when the new one then does not fit. A format that does not fit makes room by dropping the
  least recently used, and is tried once more.
- **Immutable paths.** Everything the browser fetches of the engine but the manifest is under a
  tag, `<release>-<layout>` from the manifest: `/engine/<tag>/busytex.mjs`, `busytex.wasm` and
  `files/<path>`. The worker reads the manifest first, untagged at `/engine/manifest.json` and
  served with `Cache-Control: no-cache`; the tagged files are served with
  `public, max-age=31536000, immutable`. `src/engine/urls.ts` builds every URL, for the worker, the
  prefetch and the page's fonts alike, and refuses a path with an empty, `.` or `..` segment, which
  would step out of the tree. The dev server holds one tree, and serves it only under the tag its
  manifest names, read again whenever the manifest changes; under any other tag it answers 404,
  since a tab still holding a replaced tree's tag would otherwise keep the new tree's files under
  the old tree's URLs for a year. Hosting (milestone 5) serves each tree under its own tag.
- **Not the Cache API.** TeX asks for a file in the middle of a run, so the worker reads with
  synchronous requests, and only the HTTP cache answers those: the Cache API is asynchronous, and
  the worker cannot wait on it. Immutable URLs keep the files for good in the browser's own cache.
- **The prefetch.** The scheduler notes the paths each dump and compile read, by template. When a
  document opens, it fetches every path noted for its template on the main thread, once a session,
  while the engine starts, so that the worker's reads find them in the HTTP cache rather than make a
  round trip each. It fetches only paths the manifest lists, and the app's fetch checks again:
  anything on the origin can write IndexedDB, and a path the tree does not have is not one TeX
  read. The tree's own formats are not noted: a dump reads the stock format once, so fetching it
  ahead saves no round trip, and once the template's format comes from the store it would be
  6.5 MB fetched for nothing.
- **A store never costs the page.** A store read that fails, or has not answered within two
  seconds, as IndexedDB has been known to hang in some browsers, is gone around: a dump instead of
  a kept format, and TeX's own reads instead of the prefetch. The scheduler waits on no write.
- **One document open at a time, in the job `doc`,** which the validation harness compiles in too;
  a document's id never reaches TeX. The job's folder may hold the auxiliary files of the document
  open before, so a document opened on an engine that has compiled one starts the job afresh and
  compiles as new, in two passes; the same document opened again pays that extra pass. Going back
  to the list keeps the engine and its formats for the next document.
- **The list** shows the documents newest first, each with its title, its template's name and when
  it was edited. It opens one, creates one from the template's sample and opens it, and deletes one
  once the user confirms. On load, the most recently edited document opens, or the list when there
  is none. A row whose title, template or times cannot be read is left out of it, with a warning on
  the console, since one row React cannot render would take the whole list down.

## Consequences

- A document a newer editor wrote stays in the list and cannot be opened until the editor catches
  up; there is no export yet.
- Formats may take about 180 MB of the site's storage. A browser that evicts the site's storage
  loses its documents with it until accounts arrive (milestone 4), which is when asking for
  persistent storage is worth deciding.
- A document whose saves keep failing keeps the editor on it until one is written; closing the
  tab then loses what was typed since the last write, as nothing else can hold it.
- A tab that goes away writes its last save unchecked, so another tab's write in the same moment,
  before its message arrives, can be written over.
- Browsers without `BroadcastChannel` (Safari before 15.4) hear of another tab's change only at
  their next write, which is refused.
- A tree rebuilt under the same tag would keep being served from every browser's cache for a year,
  so `scripts/fetch-engine.ts`'s rule to bump `LAYOUT` whenever what it writes changes is now needed
  for correctness, not only for rebuilding. Hosting must never change a file under a tag.
- When the template's format is kept but the HTTP cache has lost the files, the prefetch fetches
  the package files the dump read, 1.4 MB for Jake's Resume and 0.25 MB compressed, for nothing:
  the cost of one list per template.
- The harness and the editor share the job `doc`, so jobs of their own per document would change
  both.
