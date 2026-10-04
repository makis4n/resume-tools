import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Zlib, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { assemblePdf, minimalPdf } from "../test/minimal-pdf";
import { cpuMsAsync } from "../test/timing";
import {
  censusOf,
  DOCUMENT_BUDGET,
  guardStreams,
  MAX_STREAMS,
  PICTURE_BUDGET,
  STREAM_BUDGET,
} from "./guard";
import { readPdf } from "./node";
import type { PdfReading } from "./read";
import { PDF_REFUSAL_MESSAGES } from "./refusals";

const encode = (text: string) => new TextEncoder().encode(text);

/** One line of invented text, which every PDF here starts its page with. */
const LINE = "BT /F1 12 Tf 72 700 Td (Invented Person, Software Engineer) Tj ET\n";

/**
 * A one-page PDF whose content is one stream with the dictionary entries and data given, as a
 * hostile file would write it: `dict` holds what goes beside its `/Length`.
 */
function pagePdf(data: Uint8Array, dict: string): Uint8Array {
  return assemblePdf(
    [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      { dict: `<< /Length ${data.length} ${dict} >>`, data },
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ],
    1,
  );
}

/** Content compressed a megabyte at a time, so that the test never holds the whole of it. */
function deflated(head: string, fill: string, megabytes: number): Uint8Array {
  const parts: Uint8Array[] = [];
  const zlib = new Zlib({ level: 9 }, (chunk) => parts.push(chunk));
  zlib.push(encode(head));
  const block = encode(fill.repeat(Math.ceil((1024 * 1024) / fill.length)));
  for (let i = 0; i < megabytes; i++) zlib.push(block);
  zlib.push(new Uint8Array(), true);
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const STREAM_MB = STREAM_BUDGET / 1024 / 1024;

/**
 * Read a PDF, and how much the process's peak memory grew and the CPU time the reading took. The
 * peak only grows, so its growth bounds what the reading took at its most.
 */
async function measured(pdf: Uint8Array) {
  const before = process.resourceUsage().maxRSS;
  let result: PdfReading | undefined;
  const ms = await cpuMsAsync(async () => {
    result = await readPdf(pdf, { timeLimitMs: 600_000 });
  });
  const grewMb = (process.resourceUsage().maxRSS - before) / 1024;
  return { result, ms, grewMb };
}

const TOO_COMPLEX = {
  refused: true,
  reason: "too-complex",
  message: PDF_REFUSAL_MESSAGES["too-complex"],
};

describe("the guard on what pdf.js would decode", () => {
  it("refuses a small PDF whose one text decodes past the budget, before pdf.js reads it", async () => {
    // Twice the budget of one letter, in a Tj: the review's 80-million-letter file took a tab's
    // renderer to 3.3 GB before the caps on runs could count it.
    const data = deflated(`${LINE}BT /F1 1 Tf 10 10 Td (`, "A", 2 * STREAM_MB);
    const pdf = pagePdf(data, "/Filter /FlateDecode");
    expect(pdf.length).toBeLessThan(100_000);
    expect(guardStreams(pdf)).toEqual(TOO_COMPLEX);
    const { result, ms, grewMb } = await measured(pdf);
    expect(result).toEqual(TOO_COMPLEX);
    expect(ms).toBeLessThan(2_000);
    expect(grewMb).toBeLessThan(256);
  }, 60_000);

  it("refuses a PDF of a short line and then millions of spaces, which pdf.js reads to no end", async () => {
    // Spaces make no operation and no text for the caps to count: only their decoding costs.
    const pdf = pagePdf(deflated(LINE, " ", 3 * STREAM_MB), "/Filter /FlateDecode");
    expect(pdf.length).toBeLessThan(200_000);
    const { result, ms, grewMb } = await measured(pdf);
    expect(result).toEqual(TOO_COMPLEX);
    expect(ms).toBeLessThan(2_000);
    expect(grewMb).toBeLessThan(256);
  }, 60_000);

  it("refuses a path of millions of lines", async () => {
    const pdf = pagePdf(
      deflated(`${LINE}0 0 m\n`, "1 1 l\n", 2 * STREAM_MB),
      "/Filter /FlateDecode",
    );
    const { result, ms, grewMb } = await measured(pdf);
    expect(result).toEqual(TOO_COMPLEX);
    expect(ms).toBeLessThan(2_000);
    expect(grewMb).toBeLessThan(256);
  }, 60_000);

  it("refuses streams that decode past the document's budget together, each under its own", () => {
    const each = deflated(LINE, " ", STREAM_MB / 2);
    const count = Math.ceil(DOCUMENT_BUDGET / (STREAM_BUDGET / 2)) + 1;
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents [${Array.from({ length: count }, (_, i) => `${i + 4} 0 R`).join(" ")}] >>`,
      ...Array.from({ length: count }, () => ({
        dict: `<< /Length ${each.length} /Filter /FlateDecode >>`,
        data: each,
      })),
    ];
    expect(guardStreams(assemblePdf(objects, 1))).toMatchObject({ reason: "too-complex" });
  });

  it("finds a filter however the file names it, and a bomb behind each", () => {
    const bomb = deflated(LINE, " ", 2 * STREAM_MB);
    for (const dict of [
      "/Filter /FlateDecode",
      "/Filter /Fl",
      "/Filter [/FlateDecode]",
      // pdf.js takes `/F` for `/Filter`, and reads a name's `#xx` escapes.
      "/F /FlateDecode",
      "/Filter /Fl#61teDecode",
      "/Fil#74er /FlateDecode",
    ])
      expect(guardStreams(pagePdf(bomb, dict)), dict).toMatchObject({ reason: "too-complex" });
  });

  it("reads a Flate stream to its own end, whatever its length says", () => {
    // A length that stops before the bomb: pdf.js reads further than a wrong length, so the guard
    // reads the compressed data to its own end.
    const bomb = deflated(LINE, " ", 2 * STREAM_MB);
    const pdf = assemblePdf(
      [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
        { dict: "<< /Length 10 /Filter /FlateDecode >>", data: bomb },
      ],
      1,
    );
    expect(guardStreams(pdf)).toMatchObject({ reason: "too-complex" });
  });

  it("bounds RunLength and JPEG data by what they say they decode to", () => {
    // 128 is RunLength's end of data; 129 repeats the next byte 128 times.
    const runs = new Uint8Array(2 * ((STREAM_BUDGET / 128) | 0) + 4).map((_, i) =>
      i % 2 === 0 ? 129 : 32,
    );
    expect(guardStreams(pagePdf(runs, "/Filter /RunLengthDecode"))).toMatchObject({
      reason: "too-complex",
    });
    expect(guardStreams(pagePdf(new Uint8Array([129, 32, 128]), "/Filter /RL"))).toBeUndefined();
    const jpeg = (width: number, height: number) =>
      new Uint8Array([
        0xff,
        0xd8,
        0xff,
        0xe0,
        0x00,
        0x04,
        0x00,
        0x00,
        0xff,
        0xc0,
        0x00,
        0x11,
        0x08,
        height >> 8,
        height & 255,
        width >> 8,
        width & 255,
        0x03,
        ...new Array(9).fill(0),
        0xff,
        0xda,
        0x00,
        0x02,
        0xff,
        0xd9,
      ]);
    expect(censusOf(pagePdf(jpeg(400, 300), "/Filter /DCTDecode"))).toMatchObject({
      pictures: 400 * 300 * 3,
    });
    const huge = jpeg(65_000, 65_000);
    expect(65_000 * 65_000 * 3).toBeGreaterThan(PICTURE_BUDGET);
    expect(guardStreams(pagePdf(huge, "/Filter /DCTDecode"))).toMatchObject({
      reason: "too-complex",
    });
    // A JPEG with no frame before its scan is not one the guard can size.
    expect(
      guardStreams(pagePdf(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]), "/Filter /DCT")),
    ).toMatchObject({ reason: "unreadable" });
  });

  it("refuses what it cannot bound: other filters, chains, references, and encrypted files", () => {
    const data = zlibSync(encode(LINE));
    for (const dict of [
      "/Filter /LZWDecode",
      "/Filter /JBIG2Decode",
      "/Filter /JPXDecode",
      "/Filter /CCITTFaxDecode",
      "/Filter /BrotliDecode",
      "/Filter /Crypt",
      "/Filter /SomethingElse",
      "/Filter [/ASCII85Decode /FlateDecode]",
      "/Filter 9 0 R",
      "/Filter [9 0 R]",
      "/Filter % a comment\n/FlateDecode",
    ])
      expect(guardStreams(pagePdf(data, dict)), dict).toMatchObject({ reason: "unreadable" });
    const locked = minimalPdf([{ texts: [{ x: 72, y: 80, size: 12, text: "Invented" }] }], {
      locked: true,
    });
    expect(guardStreams(locked)).toMatchObject({ reason: "password" });
    // A file's own name for its file is not a filter.
    expect(guardStreams(pagePdf(encode(LINE), "/F (notes.txt)"))).toBeUndefined();
  });

  it("refuses a file of more streams than any resume holds", () => {
    const one = "1 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n";
    const pdf = encode(`%PDF-1.4\n${one.repeat(MAX_STREAMS + 1)}`);
    expect(guardStreams(pdf)).toMatchObject({ reason: "too-complex" });
  });

  it("passes every fixture, far under the budgets", () => {
    const fixtures = fileURLToPath(
      new URL("../../scripts/spike-pdf/fixtures/other/", import.meta.url),
    );
    for (const name of readdirSync(fixtures)) {
      const census = censusOf(new Uint8Array(readFileSync(join(fixtures, name, "resume.pdf"))));
      expect(census, name).not.toHaveProperty("refused");
      expect((census as { largest: number }).largest, name).toBeLessThan(STREAM_BUDGET / 100);
      expect((census as { total: number }).total, name).toBeLessThan(DOCUMENT_BUDGET / 100);
    }
    // And the PDFs made here, compressed or not.
    const page = { texts: [{ x: 72, y: 80, size: 12, text: "An invented line" }] };
    expect(guardStreams(minimalPdf([page]))).toBeUndefined();
    expect(guardStreams(minimalPdf([page], { deflate: true }))).toBeUndefined();
  });
});
