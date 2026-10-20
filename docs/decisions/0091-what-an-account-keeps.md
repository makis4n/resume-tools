# 0091. What an account keeps for each kind of document

Date: 2026-10-21 · Status: accepted, approved with the plan by the owner on 21 October 2026

## Context

The editor has three kinds of document (decisions 0010, 0038, 0049). A built-in template's
document is the canonical model as JSON. A `.tex` import is an outline in the same model, and its
template is an imported package built from the upload; the browser keeps, beside the document, the
person's uploaded files as they gave them, the import's job (the files compiles need) and its
report. A PDF import is a canonical-model document on a built-in template, and the PDF itself is
not kept anywhere, even in the browser. Decision 0047's rule: resume content leaves the browser
only when the person asks for something that needs it and is told what is sent, and whoever
receives it keeps only what the person asked to be kept. Saving to an account sends the document
and keeps it, since keeping it is what was asked.

## Decision

- **Every kind**: one row in the `documents` table: the document's id (the same UUID as in the
  browser), its owner, its kind (`template`, `tex` or `pdf`), its template's id, its title, the
  document as JSON, a revision the server counts, and when it was made and last changed.
- **A built-in template's document**: the row and nothing else.
- **A `.tex` import**: the row, and two private files (decision 0090): `original.zip`, the person's
  uploaded files exactly as given, zipped with the editor's existing zip library; and `import.bin`,
  the imported package, the job and the report, which another device needs to open and compile the
  document. The job's copy of the uploaded files is not stored again: `import.bin` refers to the
  files of `original.zip` by name.
- **The package is kept, not rebuilt.** Rebuilding it on the other device from the original would
  rerun the import, which takes seconds on pdfTeX and longer on XeTeX, and is not promised to give
  the same outline once the import changes. Keeping it costs storage and makes the other device's
  first opening a download.
- **A PDF import**: the row and nothing else. The PDF is not kept, in the account or in the browser,
  since nothing reads it after the import and the person asked to keep the resume, not the file.
- **Never kept**: dumped formats, the prefetch lists and compiled PDFs. They are caches each device
  makes for itself.
- **Saving to an account says what it sends**, once, at the first save, in plain words: the
  document, and for an imported `.tex` the files that were uploaded, kept in the account until the
  person deletes them.

## Consequences

- An imported resume can cost part of its original twice in the account, since the package holds
  its own copy of the preamble and, on XeTeX, of the uploaded fonts. The job's files are not
  duplicated.
- A document opens on another device only once its row has been downloaded, and an imported one
  only once its two files have too. Without a connection the other device shows the document in the
  list and says it cannot be opened until it is online.
- A first-pass import, which the store already refuses (decision 0049), is never uploaded.
