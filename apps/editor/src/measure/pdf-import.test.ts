import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cpuUsage } from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineAvailable } from "../engine/node";
import { readPdf } from "../pdf/node";
import { pdfRefusal } from "../pdf/refusals";
import { CURATED } from "../templates/curated";
import { engineManifest, importEngine, treeFonts } from "./node";
import {
  builtinPdfs,
  isPdfRefused,
  measurePdfImport,
  PDF_BAR,
  PDF_PARTS,
  type PdfMeasured,
  type PdfSample,
  type PdfTime,
  pdfMedians,
  pdfMeets,
  pdfRuns,
  pdfTable,
} from "./pdf-import";

// Every PDF here is invented: the PDFs other tools printed for the PDF spike's third set, committed
// beside their truth, and the built-in templates' own invented samples. No model is asked.

const OTHER_DIR = fileURLToPath(
  new URL("../../scripts/spike-pdf/fixtures/other/", import.meta.url),
);

/** One of the other tools' invented PDFs, by its folder. */
const other = (name: string): PdfSample => ({
  id: name,
  set: "other",
  bytes: new Uint8Array(readFileSync(join(OTHER_DIR, name, "resume.pdf"))),
});

/** A clock that moves on by `step` each time it is read. */
const ticking = (step: number) => {
  let at = 0;
  return () => {
    at += step;
    return at;
  };
};

afterEach(() => vi.restoreAllMocks());

describe("measurePdfImport", () => {
  it("times each part from the file to the review's draft, by rules, sending nothing", async () => {
    const sent = vi.spyOn(globalThis, "fetch");
    const result = await measurePdfImport(other("chrome-one-column"), {
      read: (bytes) => readPdf(bytes),
      now: ticking(10),
    });
    if (isPdfRefused(result)) throw new Error("refused");
    // Each part once, in the pipeline's order, and the parts are the whole.
    expect(result.parts.map((each) => each.part)).toEqual([...PDF_PARTS]);
    expect(result.parts.every((each) => each.ms === 10)).toBe(true);
    expect(result.ms).toBe(50);
    // The rules labelled it, for want of a yes: the model's labeller was asked and sent nothing.
    expect(result.by).toBe("rules");
    expect(result.fallback).toBe("no consent");
    expect(sent).not.toHaveBeenCalled();
    // What it came to: every word read landed in the resume. No page was asked for.
    expect(result.pdfPages).toBe(1);
    expect(result.lines).toBeGreaterThan(0);
    expect(result.words.read).toBeGreaterThan(0);
    expect(result.words.landed).toBe(result.words.read);
    expect(result.page).toBeUndefined();
  });

  it("stops at the reader's refusal", async () => {
    const result = await measurePdfImport(
      { id: "invented", set: "other", bytes: new Uint8Array([1, 2, 3]) },
      { read: async () => pdfRefusal("password") },
    );
    expect(isPdfRefused(result)).toBe(true);
    expect(result).toMatchObject({ id: "invented", refused: { reason: "password" } });
  });
});

/** An invented import of a PDF, `ms` long in all, its read what is left past the rules. */
function timed(id: string, ms: number, page?: number): PdfTime {
  return {
    id,
    set: id.includes("--") ? "builtin" : "other",
    parts: [
      { part: "read", ms: ms - 6 },
      { part: "layout", ms: 3 },
      { part: "labels", ms: 1 },
      { part: "filing", ms: 1 },
      { part: "review", ms: 1 },
    ],
    ms,
    pdfPages: 1,
    lines: 30,
    words: { read: 150, landed: 150, unfiled: 0 },
    flags: 0,
    by: "rules",
    fallback: "no consent",
    ...(page === undefined
      ? {}
      : {
          page: {
            ms: page,
            startMs: 300,
            formatMs: 200,
            dumped: true,
            passes: [100, 80],
            drawMs: 40,
            pages: 1,
          },
        }),
  };
}

describe("pdfRuns", () => {
  const pdfs: PdfSample[] = ["a", "b"].map((id) => ({
    id,
    set: "other",
    bytes: new Uint8Array(),
  }));

  it("imports every PDF once to warm up, uncounted, then each as many times as asked", async () => {
    const order: string[] = [];
    const passes: number[] = [];
    let index = 0;
    const done = await pdfRuns(
      pdfs,
      async (pdf) => {
        order.push(pdf.id);
        return timed(pdf.id, 100 + index++);
      },
      2,
      (pass) => passes.push(pass),
    );
    expect(passes).toEqual([0, 1, 2]);
    expect(order).toEqual(["a", "b", "a", "b", "a", "b"]);
    if (done === undefined || "refused" in done) throw new Error("not measured");
    expect(done.warm.map((each) => each.ms)).toEqual([100, 101]);
    expect(done.runs.map((each) => each.ms)).toEqual([102, 103, 104, 105]);
  });

  it("stops at a refusal, and when it is no longer wanted", async () => {
    const refused: PdfMeasured = { id: "b", refused: pdfRefusal("no-text") };
    const stopped = await pdfRuns(
      pdfs,
      async (pdf) => (pdf.id === "b" ? refused : timed("a", 20)),
      3,
    );
    expect(stopped).toEqual({ refused });
    let asked = 0;
    const gone = await pdfRuns(
      pdfs,
      async (pdf) => timed(pdf.id, 20 + asked++),
      3,
      undefined,
      () => asked < 3,
    );
    expect(gone).toBeUndefined();
    expect(asked).toBe(3);
    await expect(pdfRuns(pdfs, async () => timed("a", 1), 0)).rejects.toThrow("whole number");
    await expect(pdfRuns([], async () => timed("a", 1), 1)).rejects.toThrow("no PDFs");
  });
});

describe("the PDF import's table", () => {
  const runs = [
    timed("jake--jake", 20, 480),
    timed("jake--jake", 22, 470),
    timed("chrome-table", 30, 490),
    timed("chrome-table", 40, 500),
  ];

  it("takes each part's median and slowest, the whole's, the page's, and names the slowest", () => {
    const medians = pdfMedians(runs);
    expect(medians.ms).toBe(26);
    expect(medians.fastest).toBe(20);
    expect(medians.slowest).toEqual({ ms: 40, id: "chrome-table" });
    expect(medians.parts.map((each) => each.part)).toEqual([...PDF_PARTS]);
    expect(medians.parts[0]).toEqual({ part: "read", ms: 20, slowest: 34 });
    expect(medians.page).toEqual({
      ms: 485,
      slowest: 500,
      startMs: 300,
      formatMs: 200,
      drawMs: 40,
    });
    expect(pdfMedians([timed("a", 5)]).page).toBeUndefined();
  });

  it("judges the target on the slowest import, from the file to the review", () => {
    expect(pdfMeets(runs)).toEqual({ ms: 40, id: "chrome-table", met: true });
    expect(pdfMeets([...runs, timed("chrome-table", 1000)])).toMatchObject({ met: false });
    const text = pdfTable(runs, "node");
    expect(text).toContain("2 PDFs, 1 of the built-in templates and 1 printed by other tools");
    expect(text).toContain("2 imports of each");
    expect(text).toContain(PDF_BAR);
    expect(text).toContain("40 ms at the slowest (chrome-table) met");
    expect(text).toContain("sent nothing; every word read landed in the resume");
    // A row a part, the whole and the page; in Node, no start row, since the pages share one.
    const parts = text.split("\n").map((line) => line.split(/\s{2,}/)[0]);
    expect(parts).toEqual(expect.arrayContaining([...PDF_PARTS, "whole", "page"]));
    expect(parts).not.toContain("start");
    expect(
      pdfTable(runs, "browser")
        .split("\n")
        .some((line) => line.startsWith("start")),
    ).toBe(true);
    expect(pdfTable([...runs, timed("chrome-table", 1000)], "node")).toContain("missed");
  });
});

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("the PDF import, on the engine", () => {
  it("makes the built-in templates' PDFs and imports each to its review's page", async () => {
    const manifest = engineManifest();
    const engine = await importEngine(manifest);
    const pdfs = await builtinPdfs(engine, treeFonts(manifest));
    expect(pdfs.map((pdf) => pdf.id)).toEqual([...CURATED.keys()].map((id) => `${id}--${id}`));
    for (const pdf of pdfs) {
      // The rules' CPU time, from the file to the review, against the page's on the engine.
      const before = cpuUsage();
      const rules = await measurePdfImport(pdf, { read: (bytes) => readPdf(bytes) });
      const rulesCpu = cpuUsage(before);
      const between = cpuUsage();
      const paged = await measurePdfImport(pdf, {
        read: (bytes) => readPdf(bytes),
        page: { engine: async () => engine, fonts: () => treeFonts(manifest) },
      });
      const pagedCpu = cpuUsage(between);
      if (isPdfRefused(rules) || isPdfRefused(paged)) throw new Error(`${pdf.id} was refused`);
      expect(rules.by).toBe("rules");
      expect(rules.words.landed).toBe(rules.words.read);
      // The review's draft on Jake's Resume: its format dumped, as a first review in a tab, then
      // compiled and drawn on one page.
      expect(paged.page).toMatchObject({ dumped: true, pages: 1 });
      expect(paged.page?.passes.length).toBeGreaterThan(0);
      // The page takes the engine far longer than the rules take the PDF.
      expect(pagedCpu.user + pagedCpu.system).toBeGreaterThan(
        2 * (rulesCpu.user + rulesCpu.system),
      );
    }
  }, 60_000);
});

describe("the set's other PDFs", () => {
  it("are the invented ones committed beside their truth", () => {
    const names = readdirSync(OTHER_DIR);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(readdirSync(join(OTHER_DIR, name))).toContain("truth.json");
  });
});
