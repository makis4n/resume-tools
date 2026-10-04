# resume-model

The editor's canonical resume data model, as Zod schemas with inferred TypeScript types. Owner: @makis4n.

Version 1 is settled by [decision 0006](../../docs/decisions/0006-template-packages-and-model-v1.md): a header with the name split into first and last, optional contact fields and typed links, then sections of four kinds (entries with dates and bullets, plain lists, labelled lists and paragraphs), each with a role, every node carrying an id unique across the document, and dates stored as `YYYY` or `YYYY-MM`.

[Decision 0025](../../docs/decisions/0025-locked-content-and-extras.md) adds what an import keeps of the user's own upload: a fifth kind of section, `locked`, which holds LaTeX kept as it was and has no field, `extras` on the header, a section or an entry, LaTeX under a key a template's snippet writes back, and `kept` on the same nodes, the slots whose value is such an extra, which are no fields.

[Decision 0049](../../docs/decisions/0049-an-imported-tex-keeps-its-own-shape.md) adds a sixth kind of section, `outline`, which holds an imported `.tex` resume in its own shape: kept text, the upload's LaTeX written back byte for byte; fields of plain or rich text where they stand in it; and groups whose units, a bullet or an entry, repeat. Every field, group and unit has an id unique across the document. The import's checks (decision 00XX) mark a field `required` where the template stops when it is empty, and a group `fixed`, with why, where it takes no unit more or fewer.

It is the editor's own concern for now. The ATS reads PDFs, not this model. If that changes, the change is a decision record and a contract, not an import.
