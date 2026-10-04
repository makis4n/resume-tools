/**
 * The PDF spike's reader (item 3) is the editor's now (item 10, `src/pdf/`): this is that reader,
 * read in Node, in the shape the spike's code takes, a refusal named by its reason.
 */

import { readPdf as readInNode } from "../../src/pdf/node.ts";
import type { ReadPdf } from "../../src/pdf/read.ts";
import { isPdfRefusal, type PdfRefusalReason } from "../../src/pdf/refusals.ts";

export type { Mark, PdfLink, PdfPage, ReadPdf, TextRun } from "../../src/pdf/read.ts";

export interface Refused {
  refused: PdfRefusalReason;
  /** What the person reads, in plain words; never pdf.js's own message. */
  message: string;
}

/** Read a PDF: every page's runs of text, links and marks, or a refusal in plain words. */
export async function readPdf(bytes: Uint8Array): Promise<ReadPdf | Refused> {
  const reading = await readInNode(bytes);
  return isPdfRefusal(reading) ? { refused: reading.reason, message: reading.message } : reading;
}
