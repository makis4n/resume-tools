# 0052. Reading a PDF in the browser

Date: 2026-10-04 · Status: accepted

## Context

Item 10 of `docs/milestone-3-overhaul.md` moves the PDF spike's reader (decision 0051) into the
editor: it loads only when a person imports a PDF, in a chunk and a worker of its own, fetches
nothing, gives each page's runs and links, and refuses in plain English a file that is not a PDF,
one with a password, one with no text and one past a size cap. The file is a stranger's, so how
pdf.js is loaded and what it is allowed to do are decisions, as are the caps.

## Decision

- **The legacy build, in the page too.** `pdfjs-dist`'s modern build calls what only the newest
  browsers have (`Map.prototype.getOrInsertComputed`, `Math.sumPrecise`,
  `Uint8Array.prototype.toHex`), and the plan wants the PDF path on every browser. The legacy build
  carries polyfills for them, costs about 7% more than the modern one gzipped, and is what the
  tests read with, so the page and the tests run one pdf.js. `pdfjs-dist` moves from the editor's
  devDependencies to its dependencies.
- **Loaded on demand.** `src/pdf/index.ts`, which the page loads, holds only the checks that need
  no reader, the size cap and the `%PDF-` header, and a dynamic import of `src/pdf/browser.ts`.
  Vite makes that a chunk of its own, with pdf.js in it (493 KB, 148 KB gzipped), and makes pdf.js's
  worker a file of its own beside it (1,239 KB, 382 KB gzipped), the editor's own copy, from a
  `?worker` import. A file over the cap, or one that is plainly not a PDF, is refused before either
  is fetched. `scripts/build-output.test.ts` holds that the page's entry and every chunk it imports
  statically contain no pdf.js.
- **A worker a reading.** Each reading starts its worker and ends it when it is done, so nothing of
  one file stays in memory, and a reading still going after 20 s (`READ_TIME_LIMIT_MS`) is refused
  as unreadable and its worker stopped. The spike's slowest reading was 232 ms.
- **Nothing fetched, nothing run, nothing loaded into the page.** No CMap, standard font, ICC or
  WASM address is given; the worker may not fetch (`useWorkerFetch: false`); pdf.js's loader of
  that data on the page's side is replaced by one that fetches nothing (`NothingFetched`); WASM is
  off. No font is loaded into the document (`disableFontFace`) or taken from the system. No image is
  decoded (`maxImageSize: 0`), which a reader of text does not need and which keeps pdf.js's image
  decoders away from the file. XFA forms are off. pdf.js 6 has no `isEvalSupported` left: it
  removed the code that compiled a PDF's functions to JavaScript, and neither build holds a
  `new Function` or an `eval` of the file's content (the polyfills' `Function('return this')` is a
  fallback for an old global object).
- **The caps stay the spike's.** 5 MB, the checker's upload cap (decision 0032), checked before
  parsing; 10 pages, checked once pdf.js has counted them; and 20 letters or digits, short of which
  a PDF has no text and is a scan or a picture.
- **Links to the web, mail or phone only.** A link's address is kept only when it is `http:`,
  `https:`, `mailto:` or `tel:`, or a bare domain with a path, which becomes `https:`. A script, a
  file, a relative path or a link inside the document is dropped, since the address may later
  become a link in the person's resume.
- **A typed result.** A reading is the pages read or a refusal,
  `{ refused: true, reason, message }`, as the `.tex` import's refusals are (decision 0019), with
  five reasons: `not-pdf`, `password`, `no-text`, `too-large` and `unreadable`. The message is
  plain English and never pdf.js's own, which may quote the file.
- **Until items 11 to 14**, a PDF dropped on the documents list is read and the list says so, that
  importing from a PDF is not ready yet, or why it was refused. The picker still takes `.tex` and
  zip files; item 14 makes the documents screen take a PDF.

## Consequences

- The first load of the editor does not grow by pdf.js: only the small module of checks joins it.
  A person who imports a PDF downloads about 530 KB gzipped once, then the browser caches it.
- A PDF whose fonts need one of Adobe's predefined CMaps, as some CJK documents do, reads with no
  text from those fonts and may be refused as having none. A standard font that is not embedded
  reads with the metrics pdf.js carries, which the tests show for Helvetica and Times.
- An image is never read, so a picture of text, or a bullet drawn as an image, adds nothing; the
  marks still come from the page's paths.
- The tests read in Node through the same code (`src/pdf/read.ts`), with pdf.js parsing in the same
  thread; a test of the page's module runs pdf.js's own worker code over a message channel, and the
  build test checks what Vite emits. A real browser read Chrome's fixture with only the reader's
  chunk and its worker fetched, and no font face added to the page.
- The spike's scripts read through the editor's reader now (`scripts/spike-pdf/read.ts` adapts its
  result), and read every fixture as before, run for run.
