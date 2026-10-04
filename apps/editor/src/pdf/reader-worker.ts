/**
 * The PDF reader's worker (decision 0052): all of the reading runs here, pdf.js and the code that
 * takes runs, links and marks from what it makes, and only the reading crosses back to the page.
 * pdf.js's worker code is loaded beside pdf.js, which finds it on `globalThis.pdfjsWorker` and
 * parses in this thread; so a hostile file's cost stays in this worker, which the page ends when the
 * reading is done, or stops when it takes too long, freeing all of it.
 */

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { type ReaderScope, serveReadings } from "./protocol.ts";
import { readPdfWith } from "./read.ts";

serveReadings(self as unknown as ReaderScope, (bytes) => readPdfWith(pdfjs, bytes));
