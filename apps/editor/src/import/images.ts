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
 * thing it cannot read, and an image it cannot read is none (`imageInfo` gives undefined).
 */

import { unzlibSync, zlibSync } from "fflate";

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

/** The size, kind and resolution of an image, by its content, or undefined when it is not one. */
export function imageInfo(bytes: Uint8Array): ImageInfo | undefined {
  if (startsWith(bytes, PNG_SIGNATURE)) return pngInfo(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegInfo(bytes);
  if (latin1(bytes.subarray(0, 1024)).includes("%PDF-")) return pdfInfo(bytes);
  return undefined;
}

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
 * The most bytes a stand-in's image data may take before it is compressed: a 1-bit image of
 * 11,000 by 11,000 pixels. A stand-in for a larger one keeps its size with fewer, larger pixels.
 */
const MAX_RAW = 16 * 1024 * 1024;

/**
 * A transparent PNG of the image's pixels and resolution: one bit of grey a pixel, every pixel the
 * grey `tRNS` makes transparent, which compresses to almost nothing. A PNG's own `pHYs` goes in as
 * it was; a JPEG's resolution becomes one, in pixels per metre, as PNG records it, unless it is 72
 * dots per inch, the engines' default. An image past MAX_RAW keeps its size in points with pixels
 * as many times larger as it takes.
 */
function standInPng(info: RasterInfo): Uint8Array {
  const rawOf = (width: number, height: number) => (1 + Math.ceil(width / 8)) * height;
  let scale = 1;
  while (rawOf(Math.ceil(info.width / scale), Math.ceil(info.height / scale)) > MAX_RAW) scale++;
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
  chunks.push(chunk("IDAT", zlibSync(new Uint8Array(rawOf(width, height)), { level: 9 })));
  chunks.push(chunk("IEND", new Uint8Array(0)));
  return concat([new Uint8Array(PNG_SIGNATURE), ...chunks]);
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

const NUMBER = String.raw`(-?(?:\d+\.?\d*|\.\d+))`;
const BOX = (name: string) =>
  new RegExp(String.raw`/${name}\s*\[\s*${NUMBER}\s+${NUMBER}\s+${NUMBER}\s+${NUMBER}\s*\]`);
const CROP_BOX = BOX("CropBox");
const MEDIA_BOX = BOX("MediaBox");
const ROTATE = /\/Rotate\s+(-?\d+)/;

/** The most bytes the object streams a PDF's boxes are looked for in may inflate to, together. */
const MAX_INFLATED = 16 * 1024 * 1024;

/**
 * A PDF's first page's box and rotation, read from its text: the first crop box, or media box when
 * there is none, and the first rotation. A PDF an image is made from has one page, whose box its
 * page or its page tree gives. When its plain text gives no box, its compressed object streams,
 * where PDF 1.5 keeps its dictionaries, are inflated, within MAX_INFLATED, and read too.
 */
function pdfInfo(bytes: Uint8Array): PdfInfo | undefined {
  const plain = latin1(bytes);
  const found = pageBox(plain);
  if (found) return found;
  let budget = MAX_INFLATED;
  const streams = /\/Type\s*\/ObjStm[\s\S]{0,512}?stream\r?\n/g;
  for (const match of plain.matchAll(streams)) {
    const start = match.index + match[0].length;
    const end = plain.indexOf("endstream", start);
    if (end < 0 || budget <= 0) break;
    let inflated: Uint8Array;
    try {
      inflated = unzlibSync(bytes.subarray(start, end), { out: new Uint8Array(budget) });
    } catch {
      continue;
    }
    budget -= inflated.length;
    const box = pageBox(latin1(inflated));
    if (box) return box;
  }
  return undefined;
}

/** The box and rotation a PDF's text gives, if it gives a box. */
function pageBox(text: string): PdfInfo | undefined {
  const match = CROP_BOX.exec(text) ?? MEDIA_BOX.exec(text);
  if (!match) return undefined;
  const [left = 0, bottom = 0, right = 0, top = 0] = match.slice(1).map(Number);
  if (![left, bottom, right, top].every(Number.isFinite) || right <= left || top <= bottom)
    return undefined;
  const turned = Number(ROTATE.exec(text)?.[1] ?? 0);
  const rotate = Number.isInteger(turned) && turned % 90 === 0 ? ((turned % 360) + 360) % 360 : 0;
  return { kind: "pdf", box: [left, bottom, right, top], rotate };
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

/** Bytes decoded per call of `String.fromCharCode`, well within what a call may be passed. */
const CHUNK = 8192;

/** Bytes as text, one character per byte, so that a string's offsets are the bytes'. */
function latin1(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += CHUNK)
    text += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return text;
}
