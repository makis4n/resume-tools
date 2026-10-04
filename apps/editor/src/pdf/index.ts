/**
 * Reading a PDF a person imports (milestone 3 second pass, item 10). This is the only part of the
 * reader the editor loads with its page: the checks that need no reader, and a dynamic import of
 * the rest (`browser.ts`), which starts the reader's worker, with pdf.js in it, when a PDF is read.
 * A file past the size cap, or one that is plainly not a PDF, is refused before anything is
 * fetched.
 */

import type { PdfReading } from "./read.ts";
import { refusedBeforeReading } from "./refusals.ts";

export type { Mark, PdfLink, PdfPage, PdfReading, ReadPdf, TextRun } from "./read.ts";
export {
  isPdfRefusal,
  MAX_PAGES,
  MAX_PDF_BYTES,
  PDF_REFUSAL_MESSAGES,
  type PdfRefusal,
  type PdfRefusalReason,
  refusedBySize,
} from "./refusals.ts";

/** Whether a file the person chose or dropped is meant as a PDF, by its name or its type. */
export const isPdfFile = (file: { name: string; type?: string }) =>
  /\.pdf$/i.test(file.name) || file.type === "application/pdf";

/**
 * Read a PDF in the browser: every page's runs of text, links and marks, or why it was not read,
 * in plain words. Rejects only when the reader itself cannot be loaded or fails, which is the
 * editor's failure and not the file's, or when `signal` stops it.
 */
export async function readPdfFile(
  bytes: Uint8Array,
  options: { signal?: AbortSignal } = {},
): Promise<PdfReading> {
  const before = refusedBeforeReading(bytes);
  if (before) return before;
  const { readPdfInWorker } = await import("./browser.ts");
  return readPdfInWorker(bytes, options);
}
