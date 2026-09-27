import { unzlibSync, zlibSync } from "fflate";
import { describe, expect, test } from "vitest";
import { bound, cpuMs, fastest } from "../test/timing";
import {
  boundingBox,
  crc32,
  imageInfo,
  MAX_SIDE,
  ONE_BY_ONE,
  ONE_POINT_PDF,
  type PdfInfo,
  type RasterInfo,
  standIn,
  tooLarge,
  uploadBudget,
  xbb,
  zlibOfZeros,
} from "./images";

// Every image here is made in the test: headers and boxes only, no picture of anything.

const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const bytes = (text: string) => new TextEncoder().encode(text);

/** A PNG chunk, its CRC computed independently of the module's writer. */
function chunk(type: string, data: number[]): number[] {
  const body = [...ascii(type), ...data];
  return [...be32(data.length), ...body, ...be32(crc32(new Uint8Array(body)))];
}

/** A PNG of the given pixels, with a `pHYs` chunk when asked, and one row of data. */
function png(width: number, height: number, phys?: [number, number, number]): Uint8Array {
  const header = [...be32(width), ...be32(height), 8, 0, 0, 0, 0];
  return new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...chunk("IHDR", header),
    ...(phys ? chunk("pHYs", [...be32(phys[0]), ...be32(phys[1]), phys[2]]) : []),
    ...chunk("IDAT", [...zlibSync(new Uint8Array(1 + width))]),
    ...chunk("IEND", []),
  ]);
}

function jfif(units: number, x: number, y: number): number[] {
  const data = [...ascii("JFIF"), 0, 1, 1, units, ...be16(x), ...be16(y), 0, 0];
  return [0xff, 0xe0, ...be16(data.length + 2), ...data];
}

/** An Exif segment giving a resolution, big-endian or little-endian, per inch or per cm. */
function exif(dpi: number, { unit = 2, little = false } = {}): number[] {
  const u16 = (n: number) => (little ? be16(n).reverse() : be16(n));
  const u32 = (n: number) => (little ? be32(n).reverse() : be32(n));
  const entry = (tag: number, type: number, value: number[]) => [
    ...u16(tag),
    ...u16(type),
    ...u32(1),
    ...value,
  ];
  const tiff = [
    ...(little ? ascii("II") : ascii("MM")),
    ...u16(42),
    ...u32(8),
    ...u16(3),
    ...entry(0x011a, 5, u32(50)),
    ...entry(0x011b, 5, u32(58)),
    ...entry(0x0128, 3, [...u16(unit), 0, 0]),
    ...u32(0),
    ...u32(dpi),
    ...u32(1),
    ...u32(dpi),
    ...u32(1),
  ];
  const data = [...ascii("Exif"), 0, 0, ...tiff];
  return [0xff, 0xe1, ...be16(data.length + 2), ...data];
}

/** A JPEG's headers, up to its frame header of the given pixels, and its end. */
const jpeg = (width: number, height: number, ...segments: number[][]) =>
  new Uint8Array([
    0xff,
    0xd8,
    ...segments.flat(),
    ...[0xff, 0xc0, 0, 11, 8, ...be16(height), ...be16(width), 1, 1, 0x11, 0],
    0xff,
    0xd9,
  ]);

/** A small PDF whose one page has the given dictionary entries, uncompressed. */
const pdf = (page: string) =>
  bytes(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R ${page} >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
  );

const raster = (info: ReturnType<typeof imageInfo>) => {
  if (info === undefined || info.kind === "pdf") throw new Error("not a raster image");
  return info;
};

describe("reading an image's size", () => {
  test("of a PNG, from its header and its resolution in pixels per metre", () => {
    expect(imageInfo(png(30, 20))).toEqual({
      kind: "png",
      width: 30,
      height: 20,
      xdpi: 72,
      ydpi: 72,
    });
    const at300 = raster(imageInfo(png(300, 600, [11811, 11811, 1])));
    expect(at300.xdpi).toBeCloseTo(300, 1);
    expect(boundingBox(at300)[2]).toBeCloseTo(72, 2);
    expect(boundingBox(at300)[3]).toBeCloseTo(144, 2);
    // Unit 0 gives an aspect ratio, not a resolution, so the default stands; the chunk is kept.
    const aspect = raster(imageInfo(png(30, 20, [2, 1, 0])));
    expect([aspect.xdpi, aspect.ydpi]).toEqual([72, 72]);
    expect(aspect.phys).toHaveLength(9);
  });

  test("of a JPEG, from its frame header, and its resolution as XeTeX reads it", () => {
    const box = (bytes: Uint8Array) =>
      boundingBox(raster(imageInfo(bytes))).map((n) => n.toFixed(3));
    expect(box(jpeg(100, 200))).toEqual(["0.000", "0.000", "100.000", "200.000"]);
    expect(box(jpeg(100, 200, jfif(1, 300, 300)))).toEqual(["0.000", "0.000", "24.000", "48.000"]);
    expect(box(jpeg(100, 200, jfif(2, 100, 100)))).toEqual(["0.000", "0.000", "28.346", "56.693"]);
    expect(box(jpeg(100, 200, exif(150)))).toEqual(["0.000", "0.000", "48.000", "96.000"]);
    expect(box(jpeg(100, 200, exif(150, { little: true })))).toEqual([
      "0.000",
      "0.000",
      "48.000",
      "96.000",
    ]);
    expect(box(jpeg(100, 200, exif(60, { unit: 3 })))).toEqual([
      "0.000",
      "0.000",
      "47.244",
      "94.488",
    ]);
    // A JFIF header decides whenever there is one, before or after the Exif data, and one with no
    // unit means 72 dots per inch, as XeTeX reads it (checked against the engine).
    expect(box(jpeg(100, 200, jfif(1, 300, 300), exif(150)))).toEqual(
      box(jpeg(100, 200, jfif(1, 300, 300))),
    );
    expect(box(jpeg(100, 200, exif(150), jfif(1, 300, 300)))).toEqual(
      box(jpeg(100, 200, jfif(1, 300, 300))),
    );
    expect(box(jpeg(100, 200, jfif(0, 1, 1), exif(150)))).toEqual(box(jpeg(100, 200)));
  });

  test("of a PDF, from its first crop box or media box, and its rotation", () => {
    expect(imageInfo(pdf("/MediaBox [0 0 200 100]"))).toEqual({
      kind: "pdf",
      box: [0, 0, 200, 100],
      rotate: 0,
    });
    expect(imageInfo(pdf("/MediaBox [0 0 200 100] /CropBox [10 20 110.5 70]"))).toEqual({
      kind: "pdf",
      box: [10, 20, 110.5, 70],
      rotate: 0,
    });
    const turned = imageInfo(pdf("/MediaBox [0 0 200 100] /Rotate -90")) as PdfInfo;
    expect(turned.rotate).toBe(270);
    expect(boundingBox(turned)).toEqual([0, 0, 100, 200]);
  });

  test("of a PDF whose page is in a compressed object stream", () => {
    const objects = zlibSync(bytes("3 0 << /Type /Page /MediaBox [0 0 300 150] >>"));
    const head =
      "%PDF-1.5\n4 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode >>\nstream\n";
    const file = new Uint8Array([
      ...bytes(head),
      ...objects,
      ...bytes("\nendstream\nendobj\n%%EOF\n"),
    ]);
    expect(imageInfo(file)).toEqual({ kind: "pdf", box: [0, 0, 300, 150], rotate: 0 });
  });

  test("of a PDF from anywhere in it, its start, its end or between, and a rotation read as before", () => {
    const filler = "%".repeat(600_000);
    const atEnd = bytes(`%PDF-1.4\n${filler}\n3 0 obj << /Type /Page /MediaBox [ 0 0 90 45 ] >>`);
    expect(imageInfo(atEnd)).toEqual({ kind: "pdf", box: [0, 0, 90, 45], rotate: 0 });
    const atStart = bytes(`%PDF-1.4\n<< /MediaBox [0 0 90 45] /Rotate\n90 >>\n${filler}`);
    expect(imageInfo(atStart)).toEqual({ kind: "pdf", box: [0, 0, 90, 45], rotate: 90 });
    // 600 KB from either end, where the first and last 256 KB, all that was once read, missed it.
    const between = bytes(`%PDF-1.4\n${filler}\n<< /MediaBox [0 0 90 45] >>\n${filler}`);
    expect(imageInfo(between)).toEqual({ kind: "pdf", box: [0, 0, 90, 45], rotate: 0 });
    // A box written by reference, or with no space between its numbers, is not one.
    expect(imageInfo(pdf("/MediaBox 5 0 R /CropBox [0 0 10-10 10]"))).toBeUndefined();
    expect(imageInfo(pdf("/MediaBox [-.5 0 .5e 1]"))).toBeUndefined();
    expect(imageInfo(pdf("/MediaBox [-.5 0 .5 1] /Rotate 450"))).toEqual({
      kind: "pdf",
      box: [-0.5, 0, 0.5, 1],
      rotate: 90,
    });
  });

  test("of a PDF made to be slow to read, in time linear in its length", () => {
    // The reviewers' files: a crop box of 200,000 digits, which a regular expression read in time
    // that grew with the square of its length (5 s at 200,000), and 40,000 object streams' markers
    // before one `endstream`, each of which searched to the end (1.4 s at 40,000). Each is now read
    // in about ten times what a tenth of it takes, in CPU time, as its length is ten times.
    const digits = (n: number) => bytes(`%PDF-1.4\n/CropBox [${"1".repeat(n)}\n`);
    const markers = (n: number) =>
      bytes(`%PDF-1.5\n${"/Type/ObjStm stream\n".repeat(n)}endstream\n`);
    for (const make of [digits, markers]) {
      const small = make(make === digits ? 20_000 : 4_000);
      const large = make(make === digits ? 200_000 : 40_000);
      expect(imageInfo(large)).toBeUndefined();
      const [short = 0, long = 0] = fastest(
        [small, large].map((file) => () => imageInfo(file)),
        5,
      );
      expect(long).toBeLessThan(bound(3 * 10, short));
      expect(long).toBeLessThan(250);
    }
  }, 60_000);

  test("of PDFs read within a budget they share, which says when it ran out", () => {
    // Two object streams of 8 MB of zeros each, and no box: one PDF inflates 16 MB, its own
    // allowance, and a budget of 32 MB has room for two of them; a third is past it.
    const zeros = zlibSync(new Uint8Array(8 * 1024 * 1024), { level: 9 });
    const stream = [
      ...bytes("<< /Type /ObjStm /Filter /FlateDecode >>\nstream\n"),
      ...zeros,
      ...bytes("\nendstream\n"),
    ];
    const bombs = new Uint8Array([...bytes("%PDF-1.5\n"), ...stream, ...stream]);
    const budget = uploadBudget();
    expect(budget).toEqual({ pdfs: 64, inflated: 32 * 1024 * 1024, spent: false });
    expect(imageInfo(bombs, budget)).toBeUndefined();
    expect(imageInfo(bombs, budget)).toBeUndefined();
    expect(budget).toEqual({ pdfs: 62, inflated: 0, spent: false });
    // A box in a PDF's text needs nothing inflated, but a box in its object streams does.
    expect(imageInfo(pdf("/MediaBox [0 0 60 40]"), budget)).toMatchObject({ box: [0, 0, 60, 40] });
    expect(budget.spent).toBe(false);
    expect(imageInfo(bombs, budget)).toBeUndefined();
    expect(budget).toMatchObject({ pdfs: 60, inflated: 0, spent: true });
    // Once spent, a budget reads no PDF, and a PNG or a JPEG costs it nothing.
    expect(imageInfo(pdf("/MediaBox [0 0 60 40]"), budget)).toBeUndefined();
    expect(imageInfo(png(30, 20), budget)).toMatchObject({ width: 30 });
    // One PDF read alone has its own allowance and no other.
    expect(imageInfo(pdf("/MediaBox [0 0 60 40]"))).toMatchObject({ box: [0, 0, 60, 40] });
    const few = { pdfs: 1, inflated: 32 * 1024 * 1024, spent: false };
    expect(imageInfo(pdf("/MediaBox [0 0 60 40]"), few)).toMatchObject({ box: [0, 0, 60, 40] });
    expect(imageInfo(pdf("/MediaBox [0 0 60 40]"), few)).toBeUndefined();
    expect(few).toMatchObject({ pdfs: 0, spent: true });
  }, 60_000);

  test("of a PDF whose object streams inflate past what the reading allows, cut short", () => {
    // 64 MB of zeros, and no box in them: inflating stops at 16 MB and a piece.
    const bomb = zlibSync(new Uint8Array(64 * 1024 * 1024), { level: 9 });
    const head =
      "%PDF-1.5\n4 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode >>\nstream\n";
    const file = new Uint8Array([...bytes(head), ...bomb, ...bytes("\nendstream\nendobj\n")]);
    const took = cpuMs(() => expect(imageInfo(file)).toBeUndefined());
    expect(took).toBeLessThan(2_000);
  }, 60_000);

  test("of nothing that is not one it can read", () => {
    expect(imageInfo(bytes("Invented text, no image."))).toBeUndefined();
    expect(imageInfo(png(0, 20))).toBeUndefined();
    expect(imageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeUndefined();
    expect(imageInfo(pdf("/MediaBox [0 0 0 0]"))).toBeUndefined();
    expect(imageInfo(png(10, 10).subarray(0, 20))).toBeUndefined();
  });
});

describe("a stand-in", () => {
  /** A PNG's chunks, each with its CRC checked. */
  function chunks(file: Uint8Array): { type: string; data: Uint8Array }[] {
    expect([...file.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    const found: { type: string; data: Uint8Array }[] = [];
    for (let at = 8; at < file.length; ) {
      const length = view.getUint32(at);
      const type = String.fromCharCode(...file.subarray(at + 4, at + 8));
      expect(view.getUint32(at + 8 + length), type).toBe(
        crc32(file.subarray(at + 4, at + 8 + length)),
      );
      found.push({ type, data: file.subarray(at + 8, at + 8 + length) });
      at += 12 + length;
    }
    return found;
  }

  test("of a PNG is a transparent PNG of its pixels, its pHYs kept as it was", () => {
    const original = raster(imageInfo(png(300, 7, [11811, 11811, 1])));
    const made = chunks(standIn(original));
    expect(made.map(({ type }) => type)).toEqual(["IHDR", "pHYs", "tRNS", "IDAT", "IEND"]);
    const header = new DataView(
      made[0]?.data.buffer ?? new ArrayBuffer(0),
      made[0]?.data.byteOffset,
    );
    expect([header.getUint32(0), header.getUint32(4)]).toEqual([300, 7]);
    expect([...(made[1]?.data ?? [])]).toEqual([...be32(11811), ...be32(11811), 1]);
    // One bit a pixel, a filter byte a row, every one of them 0: the transparent grey.
    const data = unzlibSync(made[3]?.data ?? new Uint8Array());
    expect(data.length).toBe((1 + Math.ceil(300 / 8)) * 7);
    expect(data.every((byte) => byte === 0)).toBe(true);
    // Read back, it is the image's size.
    expect(boundingBox(raster(imageInfo(standIn(original))))).toEqual(boundingBox(original));
  });

  test("of a JPEG is a PNG of its pixels at its resolution, none at 72 dots per inch", () => {
    const at300 = raster(imageInfo(jpeg(100, 200, jfif(1, 300, 300))));
    const back = raster(imageInfo(standIn(at300)));
    expect([back.kind, back.width, back.height]).toEqual(["png", 100, 200]);
    expect(boundingBox(back)[2]).toBeCloseTo(24, 3);
    expect(chunks(standIn(raster(imageInfo(jpeg(10, 10))))).map(({ type }) => type)).toEqual([
      "IHDR",
      "tRNS",
      "IDAT",
      "IEND",
    ]);
  });

  test("of a huge image keeps its size with fewer, larger pixels", () => {
    // The intake drops an image past MAX_SIDE; a caller that asks for one gets its size still.
    const huge: RasterInfo = { kind: "png", width: 40_000, height: 30_000, xdpi: 300, ydpi: 300 };
    expect(tooLarge(huge)).toBe(true);
    const back = raster(imageInfo(standIn(huge)));
    expect(back.width * back.height).toBeLessThan(huge.width * huge.height);
    const [, , width, height] = boundingBox(back);
    expect(width).toBeCloseTo(9600, -1);
    expect(height).toBeCloseTo(7200, -1);
  });

  test("of the largest image the intake stands in for costs next to nothing, and keeps every pixel", () => {
    const largest: RasterInfo = {
      kind: "png",
      width: MAX_SIDE,
      height: MAX_SIDE,
      xdpi: 72,
      ydpi: 72,
    };
    expect(tooLarge(largest)).toBe(false);
    expect(tooLarge({ ...largest, height: MAX_SIDE + 1 })).toBe(true);
    let made: Uint8Array = new Uint8Array();
    // Compressing its 12.5 MB of zeros took 60 to 70 ms at level 1; writing them takes under 1.
    expect(cpuMs(() => (made = standIn(largest)))).toBeLessThan(50);
    expect(made.length).toBeLessThan(100_000);
    expect(raster(imageInfo(made))).toMatchObject({ width: MAX_SIDE, height: MAX_SIDE });
    // A header of 2^31 by 2^31, which the intake drops, is quick to stand in for all the same.
    const header: RasterInfo = { ...largest, width: 2 ** 31 - 1, height: 2 ** 31 - 1 };
    expect(cpuMs(() => standIn(header))).toBeLessThan(250);
  });

  test("of a PDF is a blank page of its box and rotation, whose table of objects is right", () => {
    const original: PdfInfo = { kind: "pdf", box: [10, 20, 110.5, 70], rotate: 90 };
    const made = standIn(original);
    expect(imageInfo(made)).toEqual(original);
    const text = new TextDecoder().decode(made);
    const table = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(table).startsWith("xref\n0 5\n")).toBe(true);
    const offsets = [...text.slice(table).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets).toHaveLength(4);
    offsets.forEach((offset, i) =>
      expect(text.slice(offset)).toMatch(new RegExp(`^${i + 1} 0 obj`)),
    );
    expect(text).not.toMatch(/\/XObject|\/Image|BT/);
  });

  test("of a file the upload lacks is 1 by 1", () => {
    expect(boundingBox(raster(imageInfo(standIn(ONE_BY_ONE))))).toEqual([0, 0, 1, 1]);
    expect(imageInfo(standIn(ONE_POINT_PDF))).toEqual(ONE_POINT_PDF);
  });
});

describe("a zlib stream of zeros", () => {
  /** Adler-32, computed as zlib does, independently of the writer. */
  const adler32 = (data: Uint8Array) => {
    let a = 1;
    let b = 0;
    for (const byte of data) {
      a = (a + byte) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  };

  test("inflates to that many zeros, at every length a copy's codes can end on", () => {
    for (const length of [
      0, 1, 2, 3, 4, 10, 11, 258, 259, 260, 261, 262, 516, 517, 1000, 65_521, 100_003,
    ]) {
      const stream = zlibOfZeros(length);
      const data = unzlibSync(stream);
      expect(data.length, String(length)).toBe(length);
      expect(data.every((byte) => byte === 0)).toBe(true);
      const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
      expect(view.getUint32(stream.length - 4), String(length)).toBe(adler32(data));
      // The header is zlib's: its check makes it a multiple of 31.
      expect((stream[0] ?? 0) * 256 + (stream[1] ?? 0)).toSatisfy((n: number) => n % 31 === 0);
    }
  });
});

describe("the .xbb file", () => {
  test("gives the box as extractbb would, exactly, in both of its lines", () => {
    const text = xbb(raster(imageInfo(png(300, 150, [11811, 11811, 1]))));
    expect(text).toContain("%%BoundingBox: 0 0 72.00014 36.00007\n");
    expect(text).toContain("%%HiResBoundingBox: 0 0 72.00014 36.00007\n");
    expect(text).not.toContain("%%Pages");
    const page = xbb({ kind: "pdf", box: [10, 20, 110.5, 70], rotate: 0 });
    expect(page).toContain("%%BoundingBox: 10 20 110.5 70\n");
    expect(page).toContain("%%Pages: 1\n");
  });
});
