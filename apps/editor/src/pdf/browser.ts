/**
 * The PDF reader in the page (milestone 3 second pass, item 10). This module is loaded only when a
 * person imports a PDF (`index.ts`), so Vite puts it, pdf.js and pdf.js's worker in files of their
 * own, which the first load of the editor does not fetch. pdf.js's legacy build, which reaches
 * older browsers than its modern one does, parses in a module worker of its own, made from the
 * editor's own copy of pdf.js's worker: no CDN, and nothing fetched while reading (`READ_OPTIONS`).
 *
 * Each reading has its own worker, ended when the reading is done, so nothing of one file stays in
 * memory after it, and a file that keeps the worker busy past `READ_TIME_LIMIT_MS` is refused and
 * its worker stopped, whatever it was doing.
 */

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import PdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?worker";
import { type PdfReading, readPdfWith } from "./read.ts";
import { pdfRefusal, READ_TIME_LIMIT_MS } from "./refusals.ts";

type PdfWorkerOptions = ConstructorParameters<typeof pdfjs.PDFWorker>[0];

/** Read a PDF in a worker of its own: the PDF read, or why it was not, in plain words. */
export async function readPdfInWorker(bytes: Uint8Array): Promise<PdfReading> {
  const port = new PdfWorker();
  // pdf.js's types say a port is null, from its documentation's default; its code takes a worker.
  const worker = new pdfjs.PDFWorker({ port } as unknown as PdfWorkerOptions);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<PdfReading>((resolve) => {
    timer = setTimeout(() => resolve(pdfRefusal("unreadable")), READ_TIME_LIMIT_MS);
  });
  try {
    return await Promise.race([readPdfWith(pdfjs, bytes, { worker }), late]);
  } finally {
    clearTimeout(timer);
    worker.destroy();
    port.terminate();
  }
}
