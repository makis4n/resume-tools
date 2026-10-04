/**
 * The PDF reader outside the browser, for tests and scripts: pdf.js's legacy build, the one the
 * page loads, parsing in this thread, as pdf.js does in Node, and reading through the same code as
 * the page (`read.ts`). In Node, pdf.js also loads `@napi-rs/canvas`, an optional package pnpm
 * installs beside it, which reading text does not need (decision 0051).
 */

import { type PdfJs, type PdfReading, readPdfWith } from "./read.ts";
import { refusedBeforeReading } from "./refusals.ts";

let loaded: Promise<PdfJs> | undefined;

/** pdf.js's legacy build, loaded once, when the first PDF is read. */
export function pdfjsInNode(): Promise<PdfJs> {
  loaded ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return loaded;
}

/** Read a PDF in this thread: the PDF read, or why it was not, in plain words. */
export async function readPdf(bytes: Uint8Array): Promise<PdfReading> {
  const before = refusedBeforeReading(bytes);
  if (before) return before;
  return readPdfWith(await pdfjsInNode(), bytes);
}
