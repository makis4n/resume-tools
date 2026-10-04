/**
 * The PDF reader's worker (decision 0052): all of the reading runs here, pdf.js and the code that
 * takes runs, links and marks from what it makes, and only the reading crosses back to the page.
 * pdf.js's worker code is loaded beside pdf.js, which finds it on `globalThis.pdfjsWorker` and
 * parses in this thread; so a hostile file's cost stays in this worker, which the page ends when the
 * reading is done, or stops when it takes too long, freeing all of it.
 *
 * When the review asks (milestone 3 second pass, item 14), each page is drawn here too, once the
 * reading has passed its caps, on an `OffscreenCanvas`, and only a PNG of it crosses back: the file
 * itself never reaches the page, and nothing is fetched to draw it, as nothing is to read it.
 */

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { drawScaleOf, type ReaderScope, serveReadings } from "./protocol.ts";
import { type PageDrawer, readPdfWith } from "./read.ts";

interface CanvasEntry {
  canvas: OffscreenCanvas | null;
  context: OffscreenCanvasRenderingContext2D | null;
}

/** pdf.js's scratch canvases, which its own factory would make from a document a worker has not. */
class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasEntry {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
  }
  reset(entry: CanvasEntry, width: number, height: number) {
    if (entry.canvas === null) throw new Error("Canvas is not specified");
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    entry.canvas.width = width;
    entry.canvas.height = height;
  }
  destroy(entry: CanvasEntry) {
    if (entry.canvas === null) throw new Error("Canvas is not specified");
    entry.canvas.width = 0;
    entry.canvas.height = 0;
    entry.canvas = null;
    entry.context = null;
  }
}

/**
 * pdf.js's filters, which its own factory makes as SVG in a document: none here. A page that asks
 * for a transfer function or a soft mask's filter is drawn without it, which a picture to check a
 * resume against can spare.
 */
class NoFilterFactory {
  addFilter() {
    return "none";
  }
  addHCMFilter() {
    return "none";
  }
  addAlphaFilter() {
    return "none";
  }
  addLuminosityFilter() {
    return "none";
  }
  addKnockoutFilter() {
    return "none";
  }
  addHighlightHCMFilter() {
    return "none";
  }
  addSelectionHCMFilter() {
    return "none";
  }
  addSelectionFilter() {
    return "none";
  }
  createSelectionStyle() {
    return "";
  }
  destroy() {}
}

/** Draw each page at `scale` pixels a point, on white, without its forms or annotations. */
const drawerAt = (scale: number): PageDrawer => ({
  factories: {
    CanvasFactory: OffscreenCanvasFactory as never,
    FilterFactory: NoFilterFactory as never,
  },
  async draw(page) {
    const viewport = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: null as unknown as CanvasRenderingContext2D,
      viewport,
      background: "white",
      annotationMode: pdfjs.AnnotationMode.DISABLE,
    }).promise;
    return canvas.convertToBlob({ type: "image/png" });
  },
});

serveReadings(self as unknown as ReaderScope, (bytes, request) => {
  const scale = drawScaleOf(request);
  return readPdfWith(pdfjs, bytes, scale === undefined ? {} : { draw: drawerAt(scale) });
});
