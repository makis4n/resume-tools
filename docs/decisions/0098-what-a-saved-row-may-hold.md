# 0098. What a saved row may hold

Date: 2026-10-21 · Status: accepted, approved by the owner on 21 October 2026; from the adversarial
review of milestone 4 item 2; amends decision 0093's size bound and adds bounds beside it; tells
decision 0092's queue which refusals it never retries

## Context

Decision 0093 bounds a document at 2 MB as JSON so that the `documents` table cannot be used as free
storage. The review of the migration found three gaps. Postgres measured its own rendering of the
`jsonb`, which puts a space after every `:` and `,`, so a document of 1.6 MB as the browser's
compact JSON measured 2.4 MB and was refused. The title and the template's id had no bound, so
either could hold tens of megabytes. And `jsonb` and `text` refuse U+0000 and a lone UTF-16
surrogate, both of which a browser string can hold, so a row carrying one can never be saved, and a
queue that retries every failure would retry it without end.

## Decision

- **The browser measures the document, and the server's ceiling follows from it.** The browser
  keeps a document to 2 MB as its own compact JSON (`JSON.stringify`, counted in UTF-8 bytes). The
  check `documents_document_size_check` allows 3 MiB (3,145,728 bytes) of Postgres's rendering,
  which is the browser's 2 MB grown by the most the added spaces can add, half as much again, so
  everything within the browser's bound passes and nothing far beyond it does. The one thing that
  can grow further is a number JSON writes in exponent form, which Postgres writes out in full; a
  resume has no reason to hold one.
- **The title and the template's id are bounded too**: `documents_title_length_check` allows 1000
  characters of title and `documents_template_id_length_check` 100 characters of template id.
  Titles are a name or a resume's first line and ids are a folder's name, so neither bound is near
  a real one. The browser cuts a longer title to fit before sending.
- **What the browser sends holds no U+0000 and no lone surrogate.** Before a row is sent, every
  string in it, the document's included, has U+0000 removed and each lone surrogate replaced with
  U+FFFD (`String.prototype.toWellFormed`). A document never needs either.
- **The queue never retries a refusal that cannot succeed.** A refused check (`23514`), an
  unsupported escape (`22P05`) or invalid input (`22P02`) is not a passing failure: the queue stops
  sending that document, keeps it in the browser, and the list marks it as not saved to the account
  with a plain message, until a later save changes it.

## Consequences

- The server's ceiling is 3 MiB of rendering rather than 2 MB, so a document of long strings can
  reach about 3 MB in the table. Every real resume is far below either.
- Item 7's sync tests cover the cleaning and the non-retried refusals; item 2's pgTAP tests pin the
  bounds and show that the server refuses U+0000 and a lone surrogate.
- The pgTAP tests also pin the grants: `authenticated` holds the four operations and `anon` and
  `service_role` hold nothing, so the local stack, whose default privileges grant every new table to
  the API's roles, behaves as a hosted project does.
