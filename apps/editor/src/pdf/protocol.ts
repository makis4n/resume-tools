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
  /**
   * Draw each page as a picture too, at this many pixels a point, for the review (item 14); the
   * pictures come back with the reading.
   */
  draw?: { scale: number };
}

export interface ReadReply {
  kind: "pdf-reading";
  reading: PdfReading;
}

const kindOf = (data: unknown) =>
  typeof data === "object" && data !== null ? (data as { kind?: unknown }).kind : undefined;

export const isReadRequest = (data: unknown): data is ReadRequest =>
  kindOf(data) === "read-pdf" && (data as { bytes?: unknown }).bytes instanceof Uint8Array;

/** The scale a request asks its pages to be drawn at, when it is a sane one: 0.25 to 4. */
export function drawScaleOf(request: ReadRequest): number | undefined {
  const scale = request.draw?.scale;
  return typeof scale === "number" && scale >= 0.25 && scale <= 4 ? scale : undefined;
}

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
  read: (bytes: Uint8Array, request: ReadRequest) => Promise<PdfReading>,
): void {
  scope.addEventListener("message", (event) => {
    if (!isReadRequest(event.data)) return;
    void read(event.data.bytes, event.data)
      .catch(() => pdfRefusal("unreadable"))
      .then((reading) => scope.postMessage({ kind: "pdf-reading", reading }));
  });
}
