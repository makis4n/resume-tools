# 0106. Caps per account

Date: 2026-10-21 · Status: accepted, approved by the owner on 27 October 2026 with the plan for
milestone 5 (docs/milestone-5.md); its numbers are measured in item 12, which completes this record

## Context

An account can save any number of documents, each up to 3 MiB of the database's rendering
(decision 0098), and any number of originals, each up to the bucket's 50 MiB. The hosted project's
database and file storage are small on the plans this project can afford, so one account, or a
script holding many, could fill them for everyone. Decision 0090 left the cap to this milestone:
"Milestone 5 measures the real sizes and decides whether a cap per account is needed."

## Decision

- **Measured first.** Item 12 imports each corpus resume that imports and records the sizes of its
  `original.zip` and `import.bin`, sizes alone, on the machine that runs it and never the files;
  and the sizes of the saved rows of the three built-in templates' samples and of the invented PDF
  imports. The numbers below are where it starts. Item 12 writes the measured choice into this
  record.
- **Three caps**: 200 documents per account; 100 MB of originals per account; and each file, at
  the bucket's one size limit, which serves `original.zip` and `import.bin` alike. It is set from
  the larger of the two the measurement finds, with room to spare, in place of today's 50 MiB. An
  `original.zip` holds the upload as given, so a zip at the import's own 20 MB cap makes one a
  little larger.
- **Kept by the database.** A trigger on `documents` refuses a new row when its owner already has
  the cap's count. The bucket's insert and update policies also require that the caller's files in
  `originals` total less than the cap, read from the sizes `storage.objects` records. The
  bucket's own size limit refuses a file over its size.
- **The person is told.** A save refused for a cap is not retried. The list marks it as it marks
  any save the account refused, "Could not be saved to your account", with the cap's own reason in
  place of "most likely too large", and says what to delete to make room. The document stays in
  this browser.

## Consequences

- A policy cannot see the size of the file being added, only the files already there, so an
  account can pass its total by one file at most.
- Two hundred documents and 100 MB hold hundreds of resumes a person; the measurement may make
  them smaller.
- Each cap gets a two-account pgTAP test, in the way decision 0093 tests the table and the bucket:
  it refuses its caller past the cap and leaves the other account alone.
- A cap per account does not stop someone who makes many accounts; the bot check on signing up
  (decision 0104) does that work.
