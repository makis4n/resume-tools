# 0057. The review of a PDF import

Date: 2026-10-04 · Status: accepted

## Context

Item 14 of `docs/milestone-3-overhaul.md`: the documents screen takes a PDF as it takes a `.tex`,
and a review shows the PDF's pages beside the resume as read, what was read in doubt first, and the
template it opens in, set by the engine; the person corrects, picks a template and creates an
ordinary document of it. Showing the PDF's pages needs them drawn, and the file is a stranger's,
which decision 0052 keeps inside the reader's worker; the review's draft needs a page from the
engine before anything is stored.

## Decision

- **The PDF's pages are drawn in the reader's worker.** When the review asks, the same worker that
  read the PDF draws each page, after the reading has passed its caps, on an `OffscreenCanvas` at
  1.5 pixels a point, and sends back only a PNG of each (`ReadPdf.pictures`). pdf.js is given a
  canvas factory that makes `OffscreenCanvas`es and a filter factory that makes no filters, since a
  worker has no document; fonts are drawn from their outlines (`disableFontFace` stays on), no image
  is decoded and nothing is fetched, as for the reading. Drawing has 10 s of its own after the
  reading (`DRAW_TIME_LIMIT_MS`); a page that fails or a drawing past it gives no pictures at all,
  and the review says the pages could not be shown, the reading kept. The page never loads pdf.js:
  the main bundle's build test holds. The reading's hook on pdf.js's operator stream is taken off
  each page once its list is in, so a page drawn afterwards gets every operation.
- **The steps after the reading load with the first PDF**, as the reader does: the layout, the
  labels, the filing and the model's labeller are a dynamic import, not part of the first load.
- **The flow is one hook** (`src/editor/pdf-import.ts`): the size check, the question the first time
  (with a Cancel that keeps no answer), the reading with its progress line and Cancel, and, while the
  answer is yes, the one line that the text is being sent; then `resumeOfPdf` with the model's
  labeller, which reads the answer afresh, so a no sends nothing; then the review. The app and the
  tests drive the same hook.
- **The review's draft is a document of a built-in template in a history of its own**, Jake's Resume
  first. The app's compiler sets it while the list is down, as it sets an open document; the person
  corrects it as they would edit a document, on the template's page (`Overlay`) and in the side
  panel (`Panel`). Picking another template carries the resume over, corrections and all, and sets
  it again. "Create document" stores it with `DocumentStore.create`, as "New" does, and opens it:
  an ordinary document of that template. Cancel, at any step, stores nothing and lets go of the
  pictures.
- **The review says, before anything else**, that it keeps the content and not the PDF's look, and
  who read the PDF (`whoRead`, item 13). What was read in doubt (`Flags`, item 12) comes first, each
  in a plain sentence naming where it landed; one the person has since settled, a date set or the
  item removed, is no longer listed.

## Consequences

- A PDF import costs the drawing on top of the reading, and the PNGs' memory while the review is
  up; in Chrome the three built-in templates' PDFs read, drew and reached the review within a few
  seconds, the first import's load of the reader included.
- A page whose look depends on a transfer function or a soft mask's filter is drawn without it; a
  picture to check a resume against can spare that. Images are not drawn, as they are not read.
- The review has no undo of its own: a correction is taken back by correcting it again, or by
  cancelling. Once created, the document has the editor's undo as any document does.
- `scripts/builtin-pdfs.ts` (`pnpm --filter @resume-tools/editor builtin-pdfs <folder>`) writes a PDF
  of each built-in template with its own invented sample, for trying the review by hand.
