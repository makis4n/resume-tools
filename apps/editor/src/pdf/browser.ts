/**
 * The PDF reader in the page (milestone 3 second pass, item 10, decision 0052). This module is
 * loaded only when a person imports a PDF (`index.ts`), and starts the reader's worker
 * (`reader-worker.ts`), which Vite makes a file of its own from the editor's own copy of pdf.js:
 * no CDN, and nothing fetched while reading (`READ_OPTIONS`).
 *
 * Each reading has its own worker, ended when the reading is done, so nothing of one file stays in
 * memory after it. The worker answers a reading past its time with a refusal of its own; should it
 * not, the page stops it a little later and refuses the PDF itself. A worker that cannot load or
 * fails is the editor's fault, not the file's, and rejects at once.
 */

import { isReadReply, type ReadRequest } from "./protocol.ts";
import type { PdfReading } from "./read.ts";
import ReaderWorker from "./reader-worker.ts?worker";
import { DRAW_TIME_LIMIT_MS, pdfRefusal, READ_TIME_LIMIT_MS } from "./refusals.ts";

/** How long past the reading's own limit the page waits before it stops the worker. */
export const WORKER_GRACE_MS = 5_000;

export interface InWorkerOptions {
  /** Stops the reading: the worker is ended and the promise rejects with an `AbortError`. */
  signal?: AbortSignal;
  /**
   * Draw each page as a picture too, at this many pixels a point, once the reading has passed
   * (item 14): the worker draws on an `OffscreenCanvas`, and the pictures come back with it.
   */
  drawScale?: number;
}

const stopped = () => new DOMException("The PDF's reading was stopped.", "AbortError");

/** Read a PDF in a worker of its own: the PDF read, or why it was not, in plain words. */
export function readPdfInWorker(
  bytes: Uint8Array,
  { signal, drawScale }: InWorkerOptions = {},
): Promise<PdfReading> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(stopped());
      return;
    }
    const worker = new ReaderWorker();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      finish();
    };
    const onAbort = () => settle(() => reject(stopped()));
    const failed = (event: Event) => {
      event.preventDefault();
      settle(() => reject(new Error("The PDF reader's worker failed.")));
    };
    timer = setTimeout(
      () => settle(() => resolve(pdfRefusal("too-complex"))),
      READ_TIME_LIMIT_MS + (drawScale === undefined ? 0 : DRAW_TIME_LIMIT_MS) + WORKER_GRACE_MS,
    );
    signal?.addEventListener("abort", onAbort);
    worker.addEventListener("message", (event: MessageEvent) => {
      if (isReadReply(event.data)) {
        const { reading } = event.data;
        settle(() => resolve(reading));
      }
    });
    worker.addEventListener("error", failed);
    worker.addEventListener("messageerror", failed);
    // The worker takes the copy over, so the caller's bytes stay theirs.
    const copy = new Uint8Array(bytes);
    const request: ReadRequest = {
      kind: "read-pdf",
      bytes: copy,
      ...(drawScale === undefined ? {} : { draw: { scale: drawScale } }),
    };
    worker.postMessage(request, [copy.buffer]);
  });
}
