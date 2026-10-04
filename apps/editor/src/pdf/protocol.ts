/**
 * What the page and the PDF reader's worker say to each other (decision 0052): the page sends the
 * file's bytes, once, and the worker answers with the reading, the pages read or a refusal, which
 * is all of the file that crosses back. Anything else on the line, as pdf.js's own handshake, which
 * its worker code sends when it loads in a worker, is not for either and passes by.
 */

import type { PdfReading } from "./read.ts";
import { pdfRefusal } from "./refusals.ts";

export interface ReadRequest {
  kind: "read-pdf";
  bytes: Uint8Array;
}

export interface ReadReply {
  kind: "pdf-reading";
  reading: PdfReading;
}

const kindOf = (data: unknown) =>
  typeof data === "object" && data !== null ? (data as { kind?: unknown }).kind : undefined;

export const isReadRequest = (data: unknown): data is ReadRequest =>
  kindOf(data) === "read-pdf" && (data as { bytes?: unknown }).bytes instanceof Uint8Array;

export const isReadReply = (data: unknown): data is ReadReply =>
  kindOf(data) === "pdf-reading" &&
  typeof (data as { reading?: unknown }).reading === "object" &&
  (data as { reading?: unknown }).reading !== null;

/** The worker's side of the line: a worker's global scope, or a port standing in for one. */
export interface ReaderScope {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(message: ReadReply): void;
}

/** Answer each request on `scope` with its reading; a failure of the reader's own is unreadable. */
export function serveReadings(
  scope: ReaderScope,
  read: (bytes: Uint8Array) => Promise<PdfReading>,
): void {
  scope.addEventListener("message", (event) => {
    if (!isReadRequest(event.data)) return;
    void read(event.data.bytes)
      .catch(() => pdfRefusal("unreadable"))
      .then((reading) => scope.postMessage({ kind: "pdf-reading", reading }));
  });
}
