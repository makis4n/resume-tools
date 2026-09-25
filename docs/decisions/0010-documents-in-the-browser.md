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
  | `documents` | `id`, a random UUID; `title`, the header's name or "Untitled"; `template`; `createdAt`; `updatedAt`, indexed for the list; and the `document` as the editor holds it | none |
  | `formats` | `key`, which is `<tag>:<engine>:<name>`; `tag`; `engine`; `name`; `bytes`; `usedAt` | 20, the least recently used dropped as a new one comes in, since a format is 6 to 9 MB |
  | `prefetch` | `template`, and the `paths` its dumps and compiles have read, first read first | 2,000 paths; later ones are not kept |

- **Saves.** The app saves the whole document after every command. The store writes the newest
  save of each document at most twice a second, and at once on `pagehide` and when the page is
  hidden, the last moments a page can count on running; `flush()` writes at once. A list or a read
  flushes first, so the list the "Documents" button shows has the last edit. A save that fails is
  reported on the console, and the next one repairs it, since each is the whole document.
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
  drops those of every other build.
- **Immutable paths.** Everything the browser fetches of the engine but the manifest is under a
  tag, `<release>-<layout>` from the manifest: `/engine/<tag>/busytex.mjs`, `busytex.wasm` and
  `files/<path>`. The worker reads the manifest first, untagged at `/engine/manifest.json` and
  served with `Cache-Control: no-cache`; the tagged files are served with
  `public, max-age=31536000, immutable`. `src/engine/urls.ts` builds every URL, for the worker, the
  prefetch and the page's fonts alike. The dev server serves `.engine/` under any tag, since it
  holds one tree; hosting (milestone 5) serves each tree under its own tag.
- **Not the Cache API.** TeX asks for a file in the middle of a run, so the worker reads with
  synchronous requests, and only the HTTP cache answers those: the Cache API is asynchronous, and
  the worker cannot wait on it. Immutable URLs keep the files for good in the browser's own cache.
- **The prefetch.** The scheduler notes the paths each dump and compile read, by template. When a
  document opens, it fetches every path noted for its template on the main thread, once a session,
  while the engine starts, so that the worker's reads find them in the HTTP cache rather than make a
  round trip each. The tree's own formats are not noted: a dump reads the stock format once, so
  fetching it ahead saves no round trip, and once the template's format comes from the store it
  would be 6.5 MB fetched for nothing.
- **A store never costs the page.** A store read that fails, or has not answered within two
  seconds, as IndexedDB has been known to hang in some browsers, is gone around: a dump instead of
  a kept format, and TeX's own reads instead of the prefetch. Nothing waits on a write.
- **One document open at a time, in the job `doc`,** which the validation harness compiles in too;
  a document's id never reaches TeX. The job's folder may hold the auxiliary files of the document
  open before, so a document opened on an engine that has compiled one starts the job afresh and
  compiles as new, in two passes; the same document opened again pays that extra pass. Going back
  to the list keeps the engine and its formats for the next document.
- **The list** shows the documents newest first, each with its title, its template's name and when
  it was edited. It opens one, creates one from the template's sample and opens it, and deletes one
  once the user confirms. On load, the most recently edited document opens, or the list when there
  is none.

## Consequences

- A document a newer editor wrote stays in the list and cannot be opened until the editor catches
  up; there is no export yet.
- Formats may take about 180 MB of the site's storage. A browser that evicts the site's storage
  loses its documents with it until accounts arrive (milestone 4), which is when asking for
  persistent storage is worth deciding.
- A save that fails is only logged; the user is not told yet.
- A tree rebuilt under the same tag would keep being served from every browser's cache for a year,
  so `scripts/fetch-engine.ts`'s rule to bump `LAYOUT` whenever what it writes changes is now needed
  for correctness, not only for rebuilding. Hosting must never change a file under a tag.
- When the template's format is kept but the HTTP cache has lost the files, the prefetch fetches
  the package files the dump read, 1.4 MB for Jake's Resume and 0.25 MB compressed, for nothing:
  the cost of one list per template.
- The harness and the editor share the job `doc`, so jobs of their own per document would change
  both.
