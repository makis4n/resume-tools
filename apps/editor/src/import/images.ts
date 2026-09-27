/**
 * An upload's images, and the blank stand-ins the intake writes in their place (milestone 3 item
 * 3, decision 0019). Version one's PDFs carry no images (decision 0008), so an image never reaches
 * the engine: a stand-in of the same size does, so that nothing on the page moves. For a PNG or a
 * JPEG that is a transparent PNG of the same pixels and resolution, since XeTeX measures an image by
 * reading it; for a PDF a one-page PDF with the same page box and rotation; and for pdfTeX, whose
 * graphicx driver for DVI reads an image's size from a `.xbb` file beside it, as `extractbb` writes
 * one, that file too (`boundingBox`, `xbb`).
 *
 * The sizes are read as XeTeX and xdvipdfmx read them: a PNG's pixels and its `pHYs` chunk, whose
 * resolution counts only in pixels per metre; a JPEG's frame header, and its resolution from its
 * JFIF header, or failing that from its Exif data; 72 dots per inch when an image gives none; and a
 * PDF's first crop box, or media box when it has none, and its rotation. Reading stops at the first
 * thing it cannot read, and an image it cannot read is none (`imageInfo` gives undefined). A PDF's
 * box is read within a budget (`Budget`), which one intake shares across every image of its upload.
 */

import { Unzlib } from "fflate";

/** A PNG's or a JPEG's size and resolution. */
export interface RasterInfo {
  kind: "png" | "jpeg";
  /** Pixels across and down. */
  width: number;
  height: number;
  /** Dots per inch across and down, 72 when the image gives none, as both engines take it. */
  xdpi: number;
  ydpi: number;
  /**
   * A PNG's own `pHYs` chunk's data, which the stand-in keeps as it is, so that XeTeX reads the
   * same resolution from it, whatever its unit.
   */
  phys?: Uint8Array;
}

/** A PDF's first page as graphicx and XeTeX size it. */
export interface PdfInfo {
  kind: "pdf";
  /** Its crop box, or its media box when it has none, in big points: left, bottom, right, top. */
  box: [number, number, number, number];
  /** Its `/Rotate`, a multiple of 90 from 0 to 270. */
  rotate: number;
}

export type ImageInfo = RasterInfo | PdfInfo;

/**
 * The size, kind and resolution of an image, by its content, or undefined when it is not one. A
 * PDF's box is read within `budget`, by default one PDF's alone; one the budget has no room for is
 * not read, or not read further, and is none, which `budget.spent` says.
 */
export function imageInfo(bytes: Uint8Array, budget = oneImage()): ImageInfo | undefined {
  if (startsWith(bytes, PNG_SIGNATURE)) return pngInfo(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegInfo(bytes);
  if (latin1(bytes.subarray(0, 1024)).includes("%PDF-")) return pdfInfo(bytes, budget);
  return undefined;
}

/**
 * What reading images' boxes may yet spend, shared by the images read with it: the PDFs whose
 * boxes may be read, and the bytes their object streams may inflate to, together, each stream
 * tried charged what it cost whether or not it inflated. `spent` says that a PDF was not read, or
 * not read to its end, because one of the two ran out; a PDF's own allowance, MAX_INFLATED and
 * MAX_OBJECT_STREAMS, ends its reading without setting it.
 */
export interface Budget {
  pdfs: number;
  inflated: number;
  spent: boolean;
}

/**
 * What one intake may spend reading its upload's images, all of them together (decision 0019): 64
 * PDFs, and 32 MB inflated from their object streams. A PDF's own allowance bounds one PDF alone,
 * and 399 PDFs of two 8 MB streams each, from a zip of 134 KB, took 91 s of CPU time within it.
 */
export const UPLOAD_BUDGET = { pdfs: 64, inflated: 32 * 1024 * 1024 } as const;

/** A budget of UPLOAD_BUDGET, for one intake. */
export const uploadBudget = (): Budget => ({ ...UPLOAD_BUDGET, spent: false });

/** A budget for one image read alone: its own allowance and no other. */
const oneImage = (): Budget => ({ pdfs: 1, inflated: MAX_INFLATED, spent: false });

/**
 * Where an image's box lies in big points, as `extractbb` gives it and graphicx reads it: from the
 * origin to its size for a PNG or a JPEG, its pixels at its resolution; a PDF's own box, turned
 * with its rotation.
 */
export function boundingBox(info: ImageInfo): [number, number, number, number] {
  if (info.kind !== "pdf")
    return [0, 0, (info.width * 72) / info.xdpi, (info.height * 72) / info.ydpi];
  const [left, bottom, right, top] = info.box;
  return info.rotate % 180 === 0 ? [left, bottom, right, top] : [bottom, left, top, right];
}

/**
 * The `.xbb` file pdfTeX's graphicx driver for DVI output (`dvipdfmx.def`) reads an image's size
 * from, as `extractbb` writes one: its bounding box in big points, the low-resolution line as
 * exactly as the high-resolution one, since graphicx reads the one and no rounding should move the
 * page. It holds no name: the file it goes with is beside it.
 */
export function xbb(info: ImageInfo): string {
  const box = boundingBox(info).map(number).join(" ");
  const lines = ["%%Creator: resume-tools", `%%BoundingBox: ${box}`, `%%HiResBoundingBox: ${box}`];
  if (info.kind === "pdf") lines.push("%%PDFVersion: 1.4", "%%Pages: 1");
  return `${lines.join("\n")}\n`;
}

/** A number as a box writes it: at most five places, and none that are 0. */
const number = (value: number) => String(Number(value.toFixed(5)));

/** A 1 by 1 stand-in for a raster image the upload lacks, at 72 dots per inch. */
export const ONE_BY_ONE: RasterInfo = { kind: "png", width: 1, height: 1, xdpi: 72, ydpi: 72 };

/** A 1 by 1 point stand-in for a PDF the upload lacks. */
export const ONE_POINT_PDF: PdfInfo = { kind: "pdf", box: [0, 0, 1, 1], rotate: 0 };

/** The bytes of the blank stand-in for an image: a PNG for a PNG or a JPEG, a PDF for a PDF. */
export function standIn(info: ImageInfo): Uint8Array {
  return info.kind === "pdf" ? standInPdf(info) : standInPng(info);
}

// PNG.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The largest a PNG may say it is, as PNG itself bounds a width or a height. */
const PNG_MAX = 2 ** 31 - 1;

/** A PNG's pixels from its header and its resolution from its `pHYs` chunk, read up to its data. */
function pngInfo(bytes: Uint8Array): RasterInfo | undefined {
  const view = viewOf(bytes);
  let at = 8;
  let info: RasterInfo | undefined;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = latin1(bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (data.length !== length) break;
    if (type === "IHDR") {
      if (length < 8) return undefined;
      const width = view.getUint32(at + 8);
      const height = view.getUint32(at + 12);
      if (width < 1 || height < 1 || width > PNG_MAX || height > PNG_MAX) return undefined;
      info = { kind: "png", width, height, xdpi: 72, ydpi: 72 };
    } else if (type === "pHYs" && info && length === 9) {
      const x = view.getUint32(at + 8);
      const y = view.getUint32(at + 12);
      // Only a resolution in pixels per metre counts, unit 1; unit 0 gives only an aspect ratio.
      if (data[8] === 1 && x > 0 && y > 0) {
        info.xdpi = x * 0.0254;
        info.ydpi = y * 0.0254;
      }
      info.phys = data.slice();
    } else if (type === "IDAT" || type === "IEND") break;
    at += 12 + length;
  }
  return info;
}

/**
 * The most pixels a PNG or a JPEG may have on a side to be stood in for; the intake drops a larger
 * one as unreadable (decision 0019). A stand-in of 10,000 by 10,000 pixels is 12.5 MB of image
 * data to xdvipdfmx, which reads it all to make the PDF, where a header can say 2^31 on a side.
 */
export const MAX_SIDE = 10_000;

/** Whether an image has more pixels on a side than a stand-in is made for (MAX_SIDE). */
export const tooLarge = (info: ImageInfo) =>
  info.kind !== "pdf" && (info.width > MAX_SIDE || info.height > MAX_SIDE);

/**
 * The most bytes a stand-in's image data may take unpacked, which xdvipdfmx reads all of: a 1-bit
 * image of 11,000 by 11,000 pixels, past MAX_SIDE. A stand-in for a larger one, which only a
 * caller past the intake's cap asks for, keeps its size with fewer, larger pixels.
 */
const MAX_RAW = 16 * 1024 * 1024;

/**
 * A transparent PNG of the image's pixels and resolution: one bit of grey a pixel, every pixel the
 * grey `tRNS` makes transparent, so that its image data is zero bytes alone, which are written as
 * a compressed stream directly (`zlibOfZeros`), never held unpacked. A PNG's own `pHYs` goes in as
 * it was; a JPEG's resolution becomes one, in pixels per metre, as PNG records it, unless it is 72
 * dots per inch, the engines' default. An image past MAX_RAW keeps its size in points with pixels
 * as many times larger as it takes.
 */
function standInPng(info: RasterInfo): Uint8Array {
  const rawOf = (width: number, height: number) => (1 + Math.ceil(width / 8)) * height;
  const fits = (scale: number) =>
    rawOf(Math.ceil(info.width / scale), Math.ceil(info.height / scale)) <= MAX_RAW;
  // Near the least scale that fits from the start, so that a header of 2^31 by 2^31 takes a few
  // steps to it and not hundreds of thousands.
  let scale = Math.max(1, Math.floor(Math.sqrt((info.width * info.height) / 8 / MAX_RAW)));
  while (!fits(scale)) scale++;
  const width = Math.ceil(info.width / scale);
  const height = Math.ceil(info.height / scale);
  const header = new Uint8Array(13);
  const view = viewOf(header);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([1, 0, 0, 0, 0], 8); // bit depth 1, grey, deflate, adaptive filtering, not interlaced
  const chunks = [chunk("IHDR", header)];
  let phys = scale === 1 ? info.phys : undefined;
  if (phys === undefined && (scale !== 1 || info.xdpi !== 72 || info.ydpi !== 72)) {
    phys = new Uint8Array(9);
    const perMetre = viewOf(phys);
    perMetre.setUint32(0, Math.max(1, Math.round(info.xdpi / scale / 0.0254)));
    perMetre.setUint32(4, Math.max(1, Math.round(info.ydpi / scale / 0.0254)));
    phys[8] = 1;
  }
  if (phys !== undefined) chunks.push(chunk("pHYs", phys));
  chunks.push(chunk("tRNS", new Uint8Array([0, 0])));
  // Every row is a filter byte, 0, and pixels of grey 0, the transparent one.
  chunks.push(chunk("IDAT", zlibOfZeros(rawOf(width, height))));
  chunks.push(chunk("IEND", new Uint8Array(0)));
  return concat([new Uint8Array(PNG_SIGNATURE), ...chunks]);
}

/** The lengths deflate's length codes 257 to 285 start at, and their extra bits. */
const LENGTH_BASE = [
  ...[3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115],
  ...[131, 163, 195, 227, 258],
];
const LENGTH_EXTRA = [
  ...[0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0],
];

/**
 * A zlib stream of `length` zero bytes, written directly rather than compressed: one block of
 * deflate's fixed codes, a literal 0 and then copies of the byte before, 258 at a time, 13 bits
 * for each, and the Adler-32 of zeros. It costs a copy for each 258 bytes it stands for, where
 * compressing 12.5 MB of them took 60 ms at level 1, and holds no unpacked data at all.
 */
export function zlibOfZeros(length: number): Uint8Array {
  const out = new Uint8Array(16 + Math.ceil((13 * Math.ceil(length / 258)) / 8));
  let at = 2;
  let bits = 0;
  let count = 0;
  /** Write `n` bits of `value`, its lowest first, as deflate packs numbers. */
  const put = (value: number, n: number) => {
    bits |= value << count;
    count += n;
    while (count >= 8) {
      out[at++] = bits & 0xff;
      bits >>>= 8;
      count -= 8;
    }
  };
  /** Write a code of `n` bits, its highest first, as deflate packs Huffman codes. */
  const code = (value: number, n: number) => {
    let reversed = 0;
    for (let i = 0; i < n; i++) reversed |= ((value >> i) & 1) << (n - 1 - i);
    put(reversed, n);
  };
  /** A fixed code for a literal or length symbol from 0 to 287. */
  const symbol = (s: number) => {
    if (s < 144) code(0x30 + s, 8);
    else if (s < 256) code(0x190 + s - 144, 9);
    else if (s < 280) code(s - 256, 7);
    else code(0xc0 + s - 280, 8);
  };
  /** A copy of `n` bytes, 3 to 258, from one byte back, at distance code 0. */
  const copy = (n: number) => {
    let index = LENGTH_BASE.length - 1;
    while ((LENGTH_BASE[index] ?? 0) > n) index--;
    symbol(257 + index);
    put(n - (LENGTH_BASE[index] ?? 0), LENGTH_EXTRA[index] ?? 0);
    code(0, 5);
  };
  // zlib's header: deflate with a 32 KB window, no dictionary, the fastest level.
  out[0] = 0x78;
  out[1] = 0x01;
  put(1, 1); // the last block
  put(1, 2); // of fixed codes
  let left = length;
  if (left > 0) {
    symbol(0);
    left--;
  }
  for (; left >= 258; left -= 258) copy(258);
  if (left >= 3) copy(left);
  else for (; left > 0; left--) symbol(0);
  symbol(256);
  if (count > 0) put(0, 8 - count);
  // Adler-32 of zeros: its sum stays 1, and the sum of sums is the length.
  const adler = (((length % 65521) << 16) | 1) >>> 0;
  new DataView(out.buffer).setUint32(at, adler);
  return out.slice(0, at + 4);
}

/** A PNG chunk: its length, type, data and CRC. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = viewOf(out);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** CRC-32 as PNG computes it, over a chunk's type and data. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

// JPEG.

/** The frame headers, whose data gives the image's size: every SOF marker. */
const START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * A JPEG's pixels from its frame header, read segment by segment up to it, and its resolution:
 * from its JFIF header when it has one, or else from its Exif data's X and Y resolution; 72 dots
 * per inch otherwise. XeTeX reads a JPEG so (decision 0019 has the cases it was checked on).
 */
function jpegInfo(bytes: Uint8Array): RasterInfo | undefined {
  const view = viewOf(bytes);
  let jfif: { xdpi: number; ydpi: number } | undefined;
  let exif: { xdpi: number; ydpi: number } | undefined;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at++; // a fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2; // a marker with no segment
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined; // the end, or the data, and no frame
    const length = view.getUint16(at + 2);
    const data = bytes.subarray(at + 4, at + 2 + length);
    if (length < 2 || data.length !== length - 2) return undefined;
    if (START_OF_FRAME.has(marker)) {
      if (data.length < 5) return undefined;
      const height = (data[1] ?? 0) * 256 + (data[2] ?? 0);
      const width = (data[3] ?? 0) * 256 + (data[4] ?? 0);
      if (width < 1 || height < 1) return undefined;
      const dpi = jfif ?? exif ?? { xdpi: 72, ydpi: 72 };
      return { kind: "jpeg", width, height, ...dpi };
    }
    if (marker === 0xe0 && latin1(data.subarray(0, 5)) === "JFIF\0") jfif ??= jfifDensity(data);
    if (marker === 0xe1 && latin1(data.subarray(0, 6)) === "Exif\0\0") exif ??= exifDensity(data);
    at += 2 + length;
  }
  return undefined;
}

/**
 * The resolution a JFIF header gives, which decides even when its units are 0, as XeTeX and
 * xdvipdfmx read it: units 1 are dots per inch, 2 dots per centimetre, and 0 no unit, which is 72
 * dots per inch across and the aspect ratio's down.
 */
function jfifDensity(data: Uint8Array): { xdpi: number; ydpi: number } | undefined {
  if (data.length < 12) return undefined;
  const units = data[7];
  const x = (data[8] ?? 0) * 256 + (data[9] ?? 0);
  const y = (data[10] ?? 0) * 256 + (data[11] ?? 0);
  if (x < 1 || y < 1) return { xdpi: 72, ydpi: 72 };
  if (units === 1) return { xdpi: x, ydpi: y };
  if (units === 2) return { xdpi: x * 2.54, ydpi: y * 2.54 };
  return { xdpi: 72, ydpi: (72 * y) / x };
}

/** Exif's tags for the resolution, in its first image file directory. */
const X_RESOLUTION = 0x011a;
const Y_RESOLUTION = 0x011b;
const RESOLUTION_UNIT = 0x0128;

/**
 * The resolution an Exif segment gives, from the TIFF structure after its six-byte header: X and
 * Y resolution, each a fraction, per inch unless the resolution unit says centimetres (3).
 */
function exifDensity(data: Uint8Array): { xdpi: number; ydpi: number } | undefined {
  const tiff = data.subarray(6);
  if (tiff.length < 8) return undefined;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return undefined;
  const view = viewOf(tiff);
  const u16 = (at: number) => (at + 2 <= tiff.length ? view.getUint16(at, little) : 0);
  const u32 = (at: number) => (at + 4 <= tiff.length ? view.getUint32(at, little) : 0);
  const directory = u32(4);
  const count = u16(directory);
  let x = 0;
  let y = 0;
  let unit = 2;
  for (let i = 0; i < count; i++) {
    const entry = directory + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    const tag = u16(entry);
    const fraction = () => {
      const at = u32(entry + 8);
      const denominator = u32(at + 4);
      return denominator === 0 ? 0 : u32(at) / denominator;
    };
    if (tag === X_RESOLUTION) x = fraction();
    else if (tag === Y_RESOLUTION) y = fraction();
    else if (tag === RESOLUTION_UNIT) unit = u16(entry + 8);
  }
  if (!(x > 0 && y > 0) || (unit !== 2 && unit !== 3)) return undefined;
  return unit === 3 ? { xdpi: x * 2.54, ydpi: y * 2.54 } : { xdpi: x, ydpi: y };
}

// PDF.

/**
 * The most bytes the object streams one PDF's boxes are looked for in may inflate to, together,
 * each stream tried charged what it cost whether or not it inflates, and the most streams tried.
 */
const MAX_INFLATED = 16 * 1024 * 1024;
const MAX_OBJECT_STREAMS = 32;

/** Compressed bytes given the inflater at a time, which inflate to 1 MB at most. */
const INFLATE_PIECE = 1024;

/**
 * A PDF's first page's box and rotation, read from its text: the first crop box, or media box when
 * there is none, and the first rotation, anywhere in the file, since a page's dictionary may sit
 * between the images and fonts it shows. A PDF an image is made from has one page, whose box its
 * page or its page tree gives. When that text gives no box, its compressed object streams, where
 * PDF 1.5 keeps its dictionaries, are inflated and read, in one pass over the file's streams,
 * within MAX_INFLATED and MAX_OBJECT_STREAMS and within `budget`. Every search moves forward and
 * every number is read over a bounded number of characters, so that the work is linear in the
 * file's length however it is laid out; the intake unpacks no file past 10 MB.
 */
function pdfInfo(bytes: Uint8Array, budget: Budget): PdfInfo | undefined {
  if (budget.spent || budget.pdfs <= 0) {
    budget.spent = true;
    return undefined;
  }
  budget.pdfs--;
  return pageBox(latin1(bytes)) ?? objectStreamBox(bytes, budget);
}

/** The box and rotation a PDF's text gives, if it gives a box. */
function pageBox(text: string): PdfInfo | undefined {
  const box = firstBox(text, "/CropBox") ?? firstBox(text, "/MediaBox");
  if (box === undefined) return undefined;
  const [left, bottom, right, top] = box;
  if (right <= left || top <= bottom) return undefined;
  const turned = firstRotate(text) ?? 0;
  const rotate = turned % 90 === 0 ? ((turned % 360) + 360) % 360 : 0;
  return { kind: "pdf", box: [left, bottom, right, top], rotate };
}

/** PDF's white-space characters. */
const WHITE = new Set(["\0", "\t", "\n", "\f", "\r", " "]);

/** The most white space read between two tokens of a box or a rotation. */
const MAX_WHITE = 64;

/** The most characters a number of a box or a rotation is read over. */
const MAX_NUMBER = 32;

/** The index after the white space at `at`, or undefined past MAX_WHITE characters of it. */
function skipWhite(text: string, at: number): number | undefined {
  const stop = at + MAX_WHITE;
  while (at < text.length && WHITE.has(text[at] ?? "")) if (++at > stop) return undefined;
  return at;
}

/**
 * The number at `at`, a minus, digits and a point, as PDF writes a real, and the index after it;
 * or undefined when there is none, or it runs past MAX_NUMBER characters.
 */
function readNumber(text: string, at: number): { value: number; end: number } | undefined {
  let end = at;
  if (text[end] === "-") end++;
  let digits = 0;
  let point = false;
  for (; end < text.length && end - at <= MAX_NUMBER; end++) {
    const char = text[end] ?? "";
    if (char >= "0" && char <= "9") digits++;
    else if (char === "." && !point) point = true;
    else break;
  }
  if (digits === 0 || end - at > MAX_NUMBER) return undefined;
  const value = Number(text.slice(at, end));
  return Number.isFinite(value) ? { value, end } : undefined;
}

/**
 * The first box of the name, `/CropBox` or `/MediaBox`, whose array of four numbers the text
 * gives in place, as `[0 0 612 792]`, each number after white space.
 */
function firstBox(text: string, name: string): [number, number, number, number] | undefined {
  for (let found = text.indexOf(name); found >= 0; found = text.indexOf(name, found + 1)) {
    let at = skipWhite(text, found + name.length);
    if (at === undefined || text[at] !== "[") continue;
    const numbers: number[] = [];
    for (let i = 0; i < 4 && at !== undefined; i++) {
      const start: number | undefined = skipWhite(text, at + (i === 0 ? 1 : 0));
      if (start === undefined || (i > 0 && start === at)) break;
      const number = readNumber(text, start);
      if (number === undefined) break;
      numbers.push(number.value);
      at = number.end;
    }
    const close = numbers.length === 4 && at !== undefined ? skipWhite(text, at) : undefined;
    if (close === undefined || text[close] !== "]") continue;
    const [left = 0, bottom = 0, right = 0, top = 0] = numbers;
    return [left, bottom, right, top];
  }
  return undefined;
}

/** The first `/Rotate` the text gives as a whole number after white space. */
function firstRotate(text: string): number | undefined {
  const name = "/Rotate";
  for (let found = text.indexOf(name); found >= 0; found = text.indexOf(name, found + 1)) {
    const at = skipWhite(text, found + name.length);
    if (at === undefined || at === found + name.length) continue;
    const digits = /^-?\d{1,32}(?!\d)/.exec(text.slice(at, at + MAX_NUMBER + 2))?.[0];
    if (digits !== undefined) return Number(digits);
  }
  return undefined;
}

const STREAM = [..."stream"].map((char) => char.charCodeAt(0));
const ENDSTREAM = [..."endstream"].map((char) => char.charCodeAt(0));

/** Where `pattern` next is in `bytes` from `from`, or -1. */
function find(bytes: Uint8Array, pattern: readonly number[], from: number): number {
  const [first = 0] = pattern;
  for (let at = bytes.indexOf(first, from); at >= 0; at = bytes.indexOf(first, at + 1))
    if (pattern.every((byte, i) => bytes[at + i] === byte)) return at;
  return -1;
}

/**
 * The box and rotation of the first page a PDF's compressed object streams give: one pass over
 * the file's `stream` and `endstream` pairs, each pair's data inflated when the dictionary before
 * it says `/ObjStm`, MAX_OBJECT_STREAMS of them at most, their costs within MAX_INFLATED and within
 * what `budget` has left, which they are charged to.
 */
function objectStreamBox(bytes: Uint8Array, budget: Budget): PdfInfo | undefined {
  let left = MAX_INFLATED;
  let tried = 0;
  /** Where the last stream ended, before which no dictionary of a later one is looked for. */
  let ended = 0;
  let from = 0;
  for (let at = find(bytes, STREAM, from); at >= 0; at = find(bytes, STREAM, from)) {
    from = at + 1;
    // The keyword, not `endstream`'s end, followed by the end of its line; the data after it.
    const eol =
      bytes[at + 6] === 0x0d && bytes[at + 7] === 0x0a ? 2 : bytes[at + 6] === 0x0a ? 1 : 0;
    if (eol === 0 || latin1(bytes.subarray(Math.max(0, at - 3), at)) === "end") continue;
    const start = at + 6 + eol;
    const end = find(bytes, ENDSTREAM, start);
    if (end < 0) return undefined;
    const dictionary = latin1(bytes.subarray(Math.max(ended, at - 512), at));
    ended = end + ENDSTREAM.length;
    from = ended;
    if (!/\/Type\s*\/ObjStm/.test(dictionary)) continue;
    if (++tried > MAX_OBJECT_STREAMS || left <= 0) return undefined;
    if (budget.inflated <= 0) {
      budget.spent = true;
      return undefined;
    }
    const inflated = inflateWithin(bytes.subarray(start, end), Math.min(left, budget.inflated));
    left -= inflated.cost;
    budget.inflated -= inflated.cost;
    const box = inflated.bytes === undefined ? undefined : pageBox(latin1(inflated.bytes));
    if (box) return box;
  }
  return undefined;
}

/**
 * A zlib stream inflated a piece at a time, stopping once its output passes `budget`: what it gave,
 * which is none when it could not be inflated, and what it cost, the bytes it read or gave, the
 * more of the two, whether or not it could be.
 */
function inflateWithin(data: Uint8Array, budget: number): { bytes?: Uint8Array; cost: number } {
  const parts: Uint8Array[] = [];
  let given = 0;
  const inflater = new Unzlib((part) => {
    parts.push(part);
    given += part.length;
  });
  let read = 0;
  try {
    while (read < data.length && given <= budget) {
      const piece = data.subarray(read, read + INFLATE_PIECE);
      read += piece.length;
      inflater.push(piece, read >= data.length);
    }
  } catch {
    return { cost: Math.max(read, given, 1) };
  }
  return { bytes: concat(parts), cost: Math.max(read, given, 1) };
}

/**
 * A blank one-page PDF with the image's page box and rotation, and nothing on its page: the
 * catalogue, the page tree, the page and its empty content, with a cross-reference table whose
 * offsets are the objects' own.
 */
function standInPdf(info: PdfInfo): Uint8Array {
  const box = info.box.map(number).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [${box}]${info.rotate ? ` /Rotate ${info.rotate}` : ""} /Resources << >> /Contents 4 0 R >>`,
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let text = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const table = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) text += `${String(offset).padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${table}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

// Bytes.

const viewOf = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) =>
  prefix.every((byte, i) => bytes[i] === byte);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * A decoder of Latin-1, which TextDecoder decodes as windows-1252: its bytes 0x80 to 0x9F are
 * other characters than Latin-1's, but still one each, and nothing here compares one. It reads the
 * whole of a PDF of 10 MB in about 10 ms, where `String.fromCharCode` took 130.
 */
const LATIN1 = new TextDecoder("latin1");

/** Bytes as text, one character per byte, so that a string's offsets are the bytes'. */
const latin1 = (bytes: Uint8Array) => LATIN1.decode(bytes);
