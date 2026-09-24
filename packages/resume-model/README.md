# resume-model

The editor's canonical resume data model, as Zod schemas with inferred TypeScript types. Owner: @makis4n.

Version 1 is settled by [decision 0006](../../docs/decisions/0006-template-packages-and-model-v1.md): a header with the name split into first and last, optional contact fields and typed links, then sections of four kinds (entries with dates and bullets, plain lists, labelled lists and paragraphs), each with a role, every node carrying an id unique across the document, and dates stored as `YYYY` or `YYYY-MM`.

It is the editor's own concern for now. The ATS reads PDFs, not this model. If that changes, the change is a decision record and a contract, not an import.
