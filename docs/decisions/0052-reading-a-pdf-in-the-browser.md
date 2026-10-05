# 0052. Reading a PDF in the browser

> Accepted by 0066: about 1.4 GB for a second before a near-limit PDF is refused is a known
> limit, and the guard's budgets stay as they are.

Date: 2026-10-04 · Status: accepted; its 1.4 GB peak before a near-limit PDF is refused is accepted by 0066

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
  no reader, the size cap and the `%PDF-` header, and a dynamic import of `src/pdf/browser.ts`, a
  chunk of its own of 1 KB, which starts the reader's worker, `src/pdf/reader-worker.ts`. Vite makes
  the worker a file of its own (1,744 KB, 535 KB gzipped), the editor's own copy of pdf.js, from a
  `?worker` import. A file over the cap, or one that is plainly not a PDF, is refused before either
  is fetched, and the documents list checks a PDF's size before it reads the file into memory.
  `scripts/build-output.test.ts` holds that what the first load fetches contains no pdf.js: the
  page's entry, every chunk it imports statically, and every worker those start, the compile
  worker among them, with what each of those imports.
- **All of the reading in a worker, one a reading.** pdf.js and the code that takes runs, links and
  marks from what it makes (`src/pdf/read.ts`) both run in the worker, pdf.js parsing there in the
  same thread (its worker code found on `globalThis.pdfjsWorker`), and only the reading crosses back
  to the page (`src/pdf/protocol.ts`). Each reading starts its worker and ends it when it is done,
  so nothing of one file stays in memory. A reading past 20 s (`READ_TIME_LIMIT_MS`) refuses the
  PDF as too complex from inside the worker; should the worker not answer 5 s after that, the page
  stops it and refuses the PDF itself. A worker that fails to load, or fails, rejects at once as the
  editor's failure, which the list reports as an import that could not finish. The spike's slowest
  reading was 232 ms.
- **Caps on what a page holds, so that memory is bounded.** A PDF of 150 KB can hold one compressed
  stream that pdf.js turns into six million operations: read whole, it took 4.5 GB and 26 s in Node
  and took a tab's memory before the time limit. So a page's operator list is taken as pdf.js
  streams it, a piece at a time, kept only as marks, and never gathered whole; its text is read
  from pdf.js's text stream the same way; and both are counted against caps, on each page
  (`PAGE_CAPS`) and in all (`DOCUMENT_CAPS`): 250,000 and 1,000,000 of drawing (each operation, and
  each number and glyph it is given), 5,000 and 20,000 runs, 50,000 and 200,000 characters, 5,000
  and 20,000 marks, 500 and 2,000 links. Past any of them the reading stops and the PDF is refused
  as too complex; nothing is cut short and read in part. The resumes the spike read draw 9,000 at
  most on a page, with 200 runs and 2,000 characters, so the caps leave room of thirty times and
  more. The clock is checked as each piece is counted, since in one thread a timer may not fire
  while pdf.js works, and each page's objects are let go of when it is read (`page.cleanup()`). The
  pieces come through pdf.js's `_renderPageChunk`, its own and not its public API, which has no way
  to stream an operator list: a pdf.js without it fails every reading as unreadable rather than
  read a list whole, and the tests of the caps fail with it.
- **Nothing fetched, nothing run, nothing loaded into the page.** No CMap, standard font, ICC or
  WASM address is given; the worker may not fetch (`useWorkerFetch: false`); pdf.js's loader of
  that data on its API's side is replaced by one that fetches nothing (`NothingFetched`); WASM is
  off. No font is loaded into the document (`disableFontFace`) or taken from the system. No image is
  decoded (`maxImageSize: 0`), which a reader of text does not need and which keeps pdf.js's image
  decoders away from the file. XFA forms are off. pdf.js 6 has no `isEvalSupported` left: it
  removed the code that compiled a PDF's functions to JavaScript, and neither build holds a
  `new Function` or an `eval` of the file's content (the polyfills' `Function('return this')` is a
  fallback for an old global object).
- **A guard on what pdf.js would decode, before it decodes any of it** (`src/pdf/guard.ts`). The
  caps above count only what pdf.js has built, and pdf.js decodes a stream whole first: a 78 KB
  file holding one compressed Tj of 80 million letters took a tab's renderer to 3.3 GB, and 2 GB of
  compressed spaces, which build nothing to count, read to the end at 4.2 GB. So the reader's
  worker, and the Node path with it, first measures every stream of the file and refuses the PDF as
  too complex when one stream would decode past 16 MB or all of them together past 48 MB; the
  fixtures' largest stream decodes to 81 KB and their largest total to 234 KB. A Flate stream is
  inflated with fflate, a kilobyte of input at a time, counting the output and keeping none of it,
  from where its data starts to where the compressed data itself ends, whatever its `/Length` or a
  stray `endstream` says, and never past the budget; its end is read from fflate's inflater's state,
  which a newer fflate without it fails closed on. A RunLength stream is sized from its run headers,
  a JPEG from its frame header (64 million samples a picture, 192 million in all, since pdf.js would
  decode one used as a page's content), ASCIIHex as its length and ASCII85 as four times it.
  Filters are read under `/Filter` and pdf.js's `/F`, with names' `#xx` escapes decoded. The guard
  is not a parser: it takes every `stream` token in the bytes as a stream, its dictionary from the
  `obj` before it, and fails closed. LZW, JPX, JBIG2, CCITT fax, Brotli, Crypt, any other filter, a
  chain of two or more, a filter given by reference or past a comment, a dictionary it cannot find,
  and more than 50,000 streams are refused, as unreadable or too complex; and so is any encrypted
  file, even one that opens without a password, as locked, since its streams cannot be measured
  without decrypting them. These are rare in a resume; a scanned page's JBIG2 or fax image is the
  likeliest loss, and such a page has no text to read anyway.
- **The file's caps stay the spike's.** 5 MB, the checker's upload cap (decision 0032), checked
  before parsing; 10 pages, checked once pdf.js has counted them; and 20 letters or digits, short
  of which a PDF has no text and is a scan or a picture.
- **Marks through forms.** A mark drawn inside a form XObject is placed through the form's own
  matrix, and the state the form drew in ends with it, as pdf.js paints it.
- **Links to the web, mail or phone only.** A link's address is kept only when it is `http:`,
  `https:`, `mailto:` or `tel:`, or a bare domain with a path, which becomes `https:`. A script, a
  file, a relative path or a link inside the document is dropped, since the address may later
  become a link in the person's resume.
- **A typed result.** A reading is the pages read or a refusal,
  `{ refused: true, reason, message }`, as the `.tex` import's refusals are (decision 0019), with
  six reasons: `not-pdf`, `password`, `no-text`, `too-large`, `too-complex` and `unreadable`.
  The message is plain English and never pdf.js's own, which may quote the file. pdf.js logs
  errors only, from a tab's first reading on, since a warning may quote a font's name.
- **Until items 11 to 14**, a PDF dropped on the documents list is read as an import is run: the
  list shows its progress line with a Cancel, which ends the worker, and takes no other import
  meanwhile, and then says that importing from a PDF is not ready yet, or why it was refused; a
  reading that was cancelled says nothing. The picker still takes `.tex` and zip files; item 14
  makes the documents screen take a PDF.

## Consequences

- The first load of the editor does not grow by pdf.js: only the small module of checks joins it.
  A person who imports a PDF downloads about 530 KB gzipped once, then the browser caches it.
- A hostile page now stops at the caps: six million operations are refused in 266 ms in Node, at
  470 MB of the process's memory at its peak, most of it pdf.js's decoded stream, and in 117 ms in
  Chrome, where it costs the page nothing, the worker holding it until it ends; ten pages of a
  10-million-character text in 676 ms and 630 MB in Node. With the guard, the review's second round
  of files, an 80-million-letter Tj, 2 GB of spaces, a path of 20 million lines, a TJ of 5 million
  parts and a 30-million-letter Tj, are each refused before pdf.js parses them, in 150 to 190 ms
  in Node, pdf.js's loading included, at 194 to 199 MB of the process's peak memory, against 187 MB
  for a fixture that reads. Within the budgets pdf.js still builds what a stream holds before the
  caps can count it, at up to about ninety times the stream's size: just under 16 MB of one Tj
  peaked at 1.4 GB for a second in Node, a TJ of 3.9 million parts at 0.76 GB, a path of 2.6
  million lines at 0.61 GB, each then refused by the caps, in the worker, which its end frees. A
  lower budget would halve that and refuse more real files: a guard cannot tell a stream that is a
  picture from one a page draws as content, and a 2,000-pixel photograph compressed with Flate, as
  Chrome prints a PNG, decodes to 12 MB. The budgets are constants in `guard.ts`, for the owner to
  lower if that trade is wanted.
  The links of a page come from pdf.js all at once, bounded by the file's 5 MB rather than streamed.
- A PDF whose fonts need one of Adobe's predefined CMaps, as some CJK documents do, reads with no
  text from those fonts and may be refused as having none. A standard font that is not embedded
  reads with the metrics pdf.js carries, which the tests show for Helvetica and Times.
- An image is never read, so a picture of text, or a bullet drawn as an image, adds nothing; the
  marks still come from the page's paths.
- The tests read in Node through the same code (`src/pdf/read.ts`), with pdf.js parsing in the same
  thread, as it does in the worker; a test of the page's module serves readings over a message
  channel as the worker does, and the build test checks what Vite emits. A real browser read
  Chrome's fixture with only the reader's chunk and its worker fetched, no font face added to the
  page and nothing logged.
- The spike's scripts read through the editor's reader now (`scripts/spike-pdf/read.ts` adapts its
  result), and read every fixture as before, run for run.
