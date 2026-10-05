// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pdfRefusal } from "../pdf/refusals";
import { measuredImport } from "./ImportMeasurePage";
import { measuredTemplate } from "./MeasurePage";
import { measuredPdfImport, PdfMeasurePage, type PdfPrepared } from "./PdfMeasurePage";
import { PDF_BAR, type PdfMeasured, type PdfSample, type PdfTime } from "./pdf-import";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The PDF import's measurement page, its imports invented: no engine, worker or PDF runs here.

/** An invented import of a built-in template's PDF, `ms` long from the file to the review. */
function timed(id: string, ms: number): PdfTime {
  return {
    id,
    set: "builtin",
    parts: [
      { part: "read", ms: ms - 6 },
      { part: "layout", ms: 3 },
      { part: "labels", ms: 1 },
      { part: "filing", ms: 1 },
      { part: "review", ms: 1 },
    ],
    ms,
    pdfPages: 1,
    lines: 28,
    words: { read: 160, landed: 160, unfiled: 0 },
    flags: 0,
    by: "rules",
    fallback: "no consent",
    page: {
      ms: 300,
      startMs: 350,
      formatMs: 150,
      dumped: true,
      passes: [60, 50],
      drawMs: 30,
      pages: 1,
    },
  };
}

const PDFS: PdfSample[] = ["jake--jake", "altacv--altacv"].map((id) => ({
  id,
  set: "builtin",
  bytes: new Uint8Array(),
}));

let visibility: DocumentVisibilityState = "visible";

describe("the PDF import's measurement page", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    vi.spyOn(console, "log").mockImplementation(() => {});
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const text = () => host.querySelector("pre")?.textContent ?? "";

  function rendered(next: (pdf: PdfSample, index: number) => PdfMeasured, runs = 2) {
    let index = 0;
    const prepare = async (): Promise<PdfPrepared> => ({
      pdfs: PDFS,
      once: async (pdf) => next(pdf, index++),
    });
    act(() => root.render(<PdfMeasurePage prepare={prepare} runs={runs} />));
  }

  it("shows the table of the timed passes as text, the warm-up left out", async () => {
    // The warm-up pass is far slower, and must not reach the slowest.
    rendered((pdf, index) => timed(pdf.id, index < 2 ? 900 : 20 + index));
    await vi.waitFor(() => expect(text()).toContain(PDF_BAR));
    const shown = text();
    expect(shown).toContain("One pass over the PDFs first, not counted");
    expect(shown).toContain("The tab was in front throughout.");
    expect(shown).toContain("2 PDFs, 2 of the built-in templates and 0 printed by other tools");
    expect(shown).toContain("by the reader's worker, each page drawn as a picture");
    // The slowest timed import is the last, 25 ms, and the target is met.
    expect(shown).toContain("25 ms at the slowest (altacv--altacv) met");
    // In the browser each page starts a worker of its own, which the table gives apart.
    expect(shown).toMatch(/\nstart +350 ms/);
    expect(host.querySelector("h1")?.textContent).toBe(
      "A PDF import by rules, from the file to the review",
    );
  });

  it("says when the tab was hidden during a timed pass", async () => {
    rendered((pdf, index) => {
      if (index === 3) {
        visibility = "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
        visibility = "visible";
      }
      return timed(pdf.id, 20);
    });
    await vi.waitFor(() => expect(text()).toContain(PDF_BAR));
    expect(text()).toContain("The tab was hidden during 1 of the 2 timed passes");
  });

  it("says which PDF was refused, in the refusal's own words", async () => {
    rendered((pdf) => ({ id: pdf.id, refused: pdfRefusal("no-text") }));
    await vi.waitFor(() => expect(text()).toContain("was refused"));
    expect(text()).toBe(
      `The invented PDF jake--jake was refused (no-text): ${pdfRefusal("no-text").message}`,
    );
  });

  it("says the measurement stopped when it fails, and what for in the console", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() =>
      root.render(
        <PdfMeasurePage
          prepare={async () => {
            throw new Error("HTTP 404");
          }}
        />,
      ),
    );
    await vi.waitFor(() => expect(text()).toBe("The measurement stopped; the console says why."));
    expect(error).toHaveBeenCalled();
  });
});

describe("measuredPdfImport", () => {
  it("reads from the location whether to measure the PDF import", () => {
    expect(measuredPdfImport("?measure=import-pdf")).toBe(true);
    expect(measuredPdfImport("?measure=import")).toBe(false);
    expect(measuredPdfImport("")).toBe(false);
    // The other pages' readings do not take it for theirs, but for a template's id, which
    // `main.tsx` asks only after this one.
    expect(measuredImport("?measure=import-pdf")).toBeUndefined();
    expect(measuredTemplate("?measure=import-pdf")).toBe("import-pdf");
  });
});
