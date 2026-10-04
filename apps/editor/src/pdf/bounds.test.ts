import { afterEach, describe, expect, it, vi } from "vitest";
import { assemblePdf, minimalPdf, type PdfRect } from "../test/minimal-pdf";
import { cpuMsAsync } from "../test/timing";
import { guardStreams } from "./guard";
import { readPdf } from "./node";
import type { PdfReading, ReadPdf } from "./read";
import { DOCUMENT_CAPS, isPdfRefusal, PAGE_CAPS, PDF_REFUSAL_MESSAGES } from "./refusals";

/** A line of invented text, so that a page that reads has text to read. */
const NAME = { x: 72, y: 80, size: 20, text: "Wren Halloway, an invented engineer" };

/** `count` small squares down the page, each a dot the reader counts as a mark. */
const dots = (count: number): PdfRect[] =>
  Array.from({ length: count }, (_, i) => ({
    x: 40 + (i % 100) * 5,
    y: 100 + i / 20,
    width: 3,
    height: 3,
  }));

const read = (result: PdfReading): ReadPdf => {
  if (isPdfRefusal(result)) throw new Error(`refused: ${result.reason}`);
  return result;
};

/** No time limit to speak of: what stops these readings must be the caps, not the clock. */
const UNTIMED = { timeLimitMs: 600_000 };

describe("the PDF reader's bounds", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses a small PDF that draws millions of times, quickly, keeping none of it", async () => {
    // A million filled squares in one compressed stream: under 100 KB of file, under the guard's
    // budget for a stream's decoding (`guard.ts`), which pdf.js turns into a million operations,
    // gigabytes had the reader gathered them. The caps stop it.
    const pdf = minimalPdf([{ texts: [NAME], operators: "0 0 3 3 re f\n".repeat(1_000_000) }], {
      deflate: true,
    });
    expect(pdf.length).toBeLessThan(100_000);
    expect(guardStreams(pdf)).toBeUndefined();
    let result: PdfReading | undefined;
    const ms = await cpuMsAsync(async () => {
      result = await readPdf(pdf, UNTIMED);
    });
    expect(result).toEqual({
      refused: true,
      reason: "too-complex",
      message: PDF_REFUSAL_MESSAGES["too-complex"],
    });
    // Stopped at the caps, after a sliver of the stream: the whole of it took 26 s of CPU.
    expect(ms).toBeLessThan(5_000);
  }, 60_000);

  it("refuses a PDF whose one text runs past the caps", async () => {
    const pdf = minimalPdf(
      [{ texts: [NAME], operators: `BT /F0 1 Tf 10 10 Td (${"A".repeat(2_000_000)}) Tj ET` }],
      { deflate: true },
    );
    expect(pdf.length).toBeLessThan(50_000);
    expect(guardStreams(pdf)).toBeUndefined();
    expect(await readPdf(pdf, UNTIMED)).toMatchObject({ reason: "too-complex" });
  }, 60_000);

  it("reads a page up to its caps, and refuses one past them", async () => {
    const under = read(await readPdf(minimalPdf([{ texts: [NAME], rects: dots(4_000) }])));
    expect(under.pages[0]?.marks).toHaveLength(4_000);
    const over = minimalPdf([{ texts: [NAME], rects: dots(PAGE_CAPS.marks + 1) }]);
    expect(await readPdf(over, UNTIMED)).toMatchObject({ reason: "too-complex" });
  }, 60_000);

  it("counts the document's caps across its pages", async () => {
    // Each page under the page's cap, all of them past the document's.
    const each = Math.ceil(DOCUMENT_CAPS.marks / 9);
    expect(each).toBeLessThan(PAGE_CAPS.marks);
    const pages = Array.from({ length: 10 }, () => ({ texts: [NAME], rects: dots(each) }));
    expect(await readPdf(minimalPdf(pages), UNTIMED)).toMatchObject({ reason: "too-complex" });
  }, 60_000);

  it("refuses a reading past its time as too complex", async () => {
    const pages = Array.from({ length: 10 }, () => ({ texts: [NAME], rects: dots(100) }));
    expect(await readPdf(minimalPdf(pages), { timeLimitMs: 1 })).toMatchObject({
      reason: "too-complex",
    });
  }, 60_000);

  it("places what a form draws through the form's matrix", async () => {
    const rule = { x: 72, y: 100, width: 300, height: 1 };
    const plain = read(await readPdf(minimalPdf([{ texts: [NAME], forms: [{ rects: [rule] }] }])));
    expect(plain.pages[0]?.marks).toEqual([{ kind: "rule", x0: 72, y0: 100, x1: 372, y1: 101 }]);
    // The form's matrix moves it 300 points down the page, as pdf.js draws it; what the page draws
    // after the form is where the page puts it, the form's matrix gone with the form.
    const moved = read(
      await readPdf(
        minimalPdf([
          {
            texts: [NAME],
            forms: [{ matrix: [1, 0, 0, 1, 0, -300], rects: [rule] }],
            operators: "72 50 300 1 re f",
          },
        ]),
      ),
    );
    expect(moved.pages[0]?.marks).toEqual([
      { kind: "rule", x0: 72, y0: 400, x1: 372, y1: 401 },
      { kind: "rule", x0: 72, y0: 741, x1: 372, y1: 742 },
    ]);
  }, 60_000);

  it("logs nothing of a broken font, its name among it, from the first reading on", async () => {
    const said = vi.fn();
    for (const level of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, level).mockImplementation(said);
    const content = "BT /F1 12 Tf 72 700 Td (Invented Person, Software Engineer) Tj ET";
    const junk = new TextEncoder().encode("not a font at all ".repeat(10));
    const pdf = assemblePdf(
      [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        { dict: `<< /Length ${content.length} >>`, data: new TextEncoder().encode(content) },
        "<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+InventedSecretFont-Bold /FirstChar 32 /LastChar 126 /FontDescriptor 6 0 R >>",
        "<< /Type /FontDescriptor /FontName /ABCDEF+InventedSecretFont-Bold /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>",
        { dict: `<< /Length ${junk.length} >>`, data: junk },
      ],
      1,
    );
    const result = await readPdf(pdf);
    expect(isPdfRefusal(result) ? result.reason : "read").toBeTruthy();
    expect(said).not.toHaveBeenCalled();
  }, 60_000);
});
