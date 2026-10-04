import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { minimalPdf } from "./minimal-pdf.ts";
import { OTHER_DIR } from "./print.ts";
import {
  boldName,
  fontName,
  italicName,
  looksLikePdf,
  MAX_PDF_BYTES,
  type ReadPdf,
  type Refused,
  readPdf,
} from "./read.ts";

const read = (result: ReadPdf | Refused): ReadPdf => {
  if ("refused" in result) throw new Error(`refused: ${result.refused}`);
  return result;
};

describe("the reader", () => {
  it("reads runs with their position, size, font and weight, links and drawn marks", async () => {
    const pdf = minimalPdf([
      {
        texts: [
          { x: 72, y: 80, size: 20, text: "Wren Halloway", font: "Helvetica-Bold" },
          { x: 72, y: 110, size: 10, text: "wren@example.com", font: "Helvetica-Oblique" },
        ],
        rects: [
          { x: 72, y: 120, width: 400, height: 1 },
          { x: 60, y: 140, width: 3, height: 3 },
        ],
        links: [{ x: 70, y: 100, width: 90, height: 14, url: "mailto:wren@example.com" }],
      },
    ]);
    const { pages } = read(await readPdf(pdf));
    expect(pages).toHaveLength(1);
    const [page] = pages;
    expect(page?.runs.map((run) => run.text)).toEqual(["Wren Halloway", "wren@example.com"]);
    const [name, email] = page?.runs ?? [];
    expect(name).toMatchObject({ x: 72, baseline: 80, size: 20, bold: true, italic: false });
    expect(email).toMatchObject({ bold: false, italic: true, font: "Helvetica-Oblique" });
    expect(page?.links).toEqual([
      { x0: 70, y0: 100, x1: 160, y1: 114, url: "mailto:wren@example.com" },
    ]);
    expect(page?.marks.map((mark) => mark.kind).sort()).toEqual(["dot", "rule"]);
  }, 60_000);

  it("reads a resume Chrome printed", async () => {
    const pdf = new Uint8Array(readFileSync(join(OTHER_DIR, "chrome-one-column", "resume.pdf")));
    const { pages } = read(await readPdf(pdf));
    const runs = pages.flatMap((page) => page.runs);
    expect(runs.find((run) => run.text === "Teodor Amsel")).toMatchObject({ bold: true });
    expect(pages[0]?.links.map((link) => link.url)).toContain("mailto:teodor.amsel@example.com");
    // Chrome draws a list's bullets: they are dots, not text.
    expect(pages[0]?.marks.filter((mark) => mark.kind === "dot").length).toBeGreaterThan(3);
  }, 60_000);

  it("refuses a file that is not a PDF", async () => {
    const text = new TextEncoder().encode("Invented notes, not a PDF at all.");
    expect(looksLikePdf(text)).toBe(false);
    expect(await readPdf(text)).toMatchObject({ refused: "not-pdf" });
    // One that begins as a PDF and is not one is refused too, never thrown.
    const broken = new TextEncoder().encode("%PDF-1.4\nnothing else");
    expect(await readPdf(broken)).toHaveProperty("refused");
  }, 60_000);

  it("refuses a PDF locked with a password", async () => {
    const pdf = minimalPdf([{ texts: [{ x: 72, y: 80, size: 12, text: "Invented and locked" }] }], {
      locked: true,
    });
    expect(await readPdf(pdf)).toMatchObject({ refused: "password" });
  }, 60_000);

  it("refuses a PDF with no text, as a scan has", async () => {
    const pdf = minimalPdf([{ rects: [{ x: 50, y: 50, width: 500, height: 700 }] }]);
    const refused = await readPdf(pdf);
    expect(refused).toMatchObject({ refused: "no-text" });
    expect((refused as Refused).message).toMatch(/no text/);
  }, 60_000);

  it("refuses a PDF past the size cap before it parses it", async () => {
    const big = new Uint8Array(MAX_PDF_BYTES + 1);
    big.set(new TextEncoder().encode("%PDF-1.4\n"));
    expect(await readPdf(big)).toMatchObject({ refused: "too-large" });
  });

  it("tells weights and slants from fonts' names, TeX's among them", () => {
    expect(fontName("ABCDEF+LMRoman10-Bold")).toBe("LMRoman10-Bold");
    for (const bold of ["LMRoman10-Bold", "SourceSansPro-Semibold", "CMBX10", "Roboto-Black"])
      expect(boldName(bold), bold).toBe(true);
    for (const regular of ["LMRoman10-Regular", "Lato-Regular", "CMR10", "Georgia"])
      expect(boldName(regular), regular).toBe(false);
    for (const italic of [
      "LMRoman10-Italic",
      "CMTI10",
      "Helvetica-Oblique",
      "SourceSansPro-LightIt",
    ])
      expect(italicName(italic), italic).toBe(true);
    expect(italicName("LMRomanCaps10-Regular")).toBe(false);
  });
});
