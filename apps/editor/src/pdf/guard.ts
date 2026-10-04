/**
 * A guard on what pdf.js would decode, run on the file's bytes before pdf.js sees them (decision
 * 0052). A PDF of a few kilobytes can hold a compressed stream that decodes to gigabytes, and pdf.js
 * decodes a stream whole, into memory, before anything downstream can count it: the caps on what a
 * page holds (`read.ts`) come too late. So every stream the file holds is measured here first, by
 * decoding it as far as a budget allows and no further, and the PDF is refused as too complex when
 * one stream, or all of them together, would decode past the budgets.
 *
 * It is a guard, not a parser: it finds each `stream` keyword in the bytes, reads the filters from
 * the dictionary before it, and measures what follows. It fails closed: what it cannot bound, an
 * encrypted file, a filter it does not measure, a chain of filters, a filter it cannot read, is
 * refused rather than passed on.
 *
 * - No filter, or ASCIIHex: the data is at most as long as the file. ASCII85 decodes to at most
 *   four times its length, which the guard counts.
 * - Flate: inflated from the data's start, a kilobyte of input at a time, counting the output and
 *   keeping none of it, until the compressed stream ends, fails, or passes the budget. It is
 *   measured from where the data starts to where the compressed data itself ends, whatever the
 *   stream's `/Length` says, so a length pdf.js reads further than this guard cannot hide data.
 * - RunLength: its decoded length is read from its run headers, up to its end of data.
 * - DCT, a JPEG: its size, width by height by components, is read from its frame header. pdf.js
 *   decodes no image here (`maxImageSize`), but would decode a JPEG used as a page's content.
 * - LZW, JPX, JBIG2, CCITT fax, Brotli, Crypt, any other filter, and any chain of two or more, are
 *   refused as unreadable: rare in a resume, and each can expand past what a guard this small can
 *   bound.
 * - An encrypted file is refused as locked: its streams cannot be measured without decrypting.
 */

import { Unzlib } from "fflate";
import { type PdfRefusal, pdfRefusal } from "./refusals.ts";

/** The most one stream may decode to. The fixtures' largest stream decodes to under 1 MB. */
export const STREAM_BUDGET = 16 * 1024 * 1024;

/** The most all of a file's streams may decode to together. The fixtures' total is under 2 MB. */
export const DOCUMENT_BUDGET = 48 * 1024 * 1024;

/**
 * The most samples one JPEG may decode to, width by height by components, and all of them
 * together: a 12-megapixel photograph in colour is 36 million.
 */
export const PICTURE_BUDGET = 64_000_000;
export const PICTURES_BUDGET = 192_000_000;

/** How much compressed input the guard inflates at a time: at most about a megabyte out. */
const PIECE = 1024;

/** The most streams a file may hold; a resume holds a few hundred at most. */
export const MAX_STREAMS = 50_000;

/** The furthest a stream's `obj` keyword may stand before its `stream` keyword: its dictionary. */
const MAX_DICTIONARY = 64 * 1024;

/** What the guard measured of a file: its streams, the largest, and the totals. */
export interface StreamCensus {
  streams: number;
  largest: number;
  total: number;
  pictures: number;
}

/** Why the guard stops: a budget passed, a stream it cannot bound, or an encrypted file. */
class Stop extends Error {
  readonly refusal: PdfRefusal;
  constructor(refusal: PdfRefusal) {
    super(refusal.reason);
    this.refusal = refusal;
  }
}

const tooComplex = () => new Stop(pdfRefusal("too-complex"));
const unbounded = () => new Stop(pdfRefusal("unreadable"));

/** Whitespace and delimiters, which end a PDF token. */
const isBoundary = (char: string | undefined) =>
  char === undefined || /[\s\0/[\]<>(){}%]/.test(char);

/** A PDF name with its `#xx` escapes decoded, as pdf.js reads it. */
const decodeName = (name: string) =>
  name.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

/**
 * Measure every stream of a PDF against the budgets: the census, or the refusal of a file past
 * them or one the guard cannot bound.
 */
export function guardStreams(bytes: Uint8Array): PdfRefusal | undefined {
  const census = censusOf(bytes);
  return "refused" in census ? census : undefined;
}

/** The census of a PDF's streams, or why the guard refuses it. */
export function censusOf(bytes: Uint8Array): StreamCensus | PdfRefusal {
  try {
    return measure(bytes);
  } catch (error) {
    if (error instanceof Stop) return error.refusal;
    return pdfRefusal("unreadable");
  }
}

function measure(bytes: Uint8Array): StreamCensus {
  // One character a byte, so that a string's offsets are the file's.
  const text = new TextDecoder("latin1").decode(bytes);
  for (const [name] of text.matchAll(/\/[A-Za-z0-9#]{1,40}/g))
    if (decodeName(name) === "/Encrypt") throw new Stop(pdfRefusal("password"));
  const objects = [...text.matchAll(/\d+[\s\0]+\d+[\s\0]+obj(?=[\s\0/[\]<>(){}%]|$)/g)].map(
    (match) => (match.index ?? 0) + match[0].length,
  );
  const ends = [...text.matchAll(/endstream/g)].map((match) => match.index ?? 0);
  const census: StreamCensus = { streams: 0, largest: 0, total: 0, pictures: 0 };
  for (let at = text.indexOf("stream"); at >= 0; at = text.indexOf("stream", at + 6)) {
    // `stream` as pdf.js reads it, a token that ends there and does not end a word: `endstream`
    // and `upstream` are not. One a number runs into, `5stream`, is.
    if (/[A-Za-z]/.test(text[at - 1] ?? "") || !isBoundary(text[at + 6])) continue;
    if (++census.streams > MAX_STREAMS) throw tooComplex();
    const start = dataStart(text, at + 6);
    const filters = filtersOf(dictionaryBefore(text, objects, at));
    const { size, picture } = decodedSize(bytes, start, nextAtOrAfter(ends, start), filters);
    if (picture) {
      if (size > PICTURE_BUDGET) throw tooComplex();
      census.pictures += size;
      if (census.pictures > PICTURES_BUDGET) throw tooComplex();
    } else {
      census.largest = Math.max(census.largest, size);
      census.total += size;
      if (census.total > DOCUMENT_BUDGET) throw tooComplex();
    }
  }
  return census;
}

/** Where a stream's data starts: after the end of the line its keyword ends, as pdf.js skips. */
function dataStart(text: string, from: number): number {
  for (let at = from; at < text.length; at++) {
    if (text[at] === "\n") return at + 1;
    if (text[at] === "\r") return text[at + 1] === "\n" ? at + 2 : at + 1;
  }
  return text.length;
}

/** The last of sorted `positions` at or before `at`, or undefined. */
function lastAtOrBefore(positions: number[], at: number): number | undefined {
  let low = 0;
  let high = positions.length - 1;
  let found: number | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const position = positions[middle] ?? 0;
    if (position <= at) {
      found = position;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/** The first of sorted `positions` at or after `at`, or infinity. */
function nextAtOrAfter(positions: number[], at: number): number {
  let low = 0;
  let high = positions.length - 1;
  let found = Number.POSITIVE_INFINITY;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const position = positions[middle] ?? 0;
    if (position >= at) {
      found = position;
      high = middle - 1;
    } else low = middle + 1;
  }
  return found;
}

/**
 * The text of the object a `stream` keyword ends, from its `obj` keyword: its dictionary. A
 * keyword with no object close before it is one the guard cannot place, and refuses.
 */
function dictionaryBefore(text: string, objects: number[], at: number): string {
  const obj = lastAtOrBefore(objects, at);
  if (obj === undefined || at - obj > MAX_DICTIONARY) throw unbounded();
  return text.slice(obj, at);
}

/** The filters a dictionary names, under `/Filter` or pdf.js's `/F`, in order. */
function filtersOf(dictionary: string): string[] {
  const plain = decodeName(dictionary);
  const filters: string[] = [];
  for (const match of plain.matchAll(/\/(Filter|F)(?=[\s\0/[\]<>(){}%])/g)) {
    const rest = plain.slice((match.index ?? 0) + match[0].length).replace(/^[\s\0]+/, "");
    const name = /^\/([^\s\0/[\]<>(){}%]*)/.exec(rest);
    if (name) {
      filters.push(name[1] ?? "");
      continue;
    }
    if (rest.startsWith("[")) {
      const end = rest.indexOf("]");
      const inside = end < 0 ? undefined : rest.slice(1, end);
      if (inside === undefined || !/^(\s*\/[^\s\0/[\]<>(){}%]+)*\s*$/.test(inside))
        throw unbounded();
      filters.push(
        ...[...inside.matchAll(/\/([^\s\0/[\]<>(){}%]+)/g)].map(([, each = ""]) => each),
      );
      continue;
    }
    // `/F` is also a stream's file, given as a string or a dictionary, which pdf.js does not take
    // for a filter; anything else, a reference or a comment, the guard cannot read.
    if (match[1] === "F" && (rest.startsWith("(") || rest.startsWith("<"))) continue;
    throw unbounded();
  }
  return filters;
}

/**
 * What a stream decodes to, by its filters: its size, and whether it is a picture's. `endstream`
 * is where the data ends for the filters that cannot expand, the next `endstream` or the end.
 */
function decodedSize(
  bytes: Uint8Array,
  start: number,
  endstream: number,
  filters: string[],
): { size: number; picture: boolean } {
  if (filters.length > 1) throw unbounded();
  const end = Math.min(endstream, bytes.length);
  const [filter] = filters;
  switch (filter) {
    case undefined:
    case "ASCIIHexDecode":
    case "AHx":
      return { size: end - start, picture: false };
    case "ASCII85Decode":
    case "A85":
      return { size: 4 * (end - start), picture: false };
    case "FlateDecode":
    case "Fl":
      return { size: inflatedSize(bytes, start), picture: false };
    case "RunLengthDecode":
    case "RL":
      return { size: runLengthSize(bytes, start), picture: false };
    case "DCTDecode":
    case "DCT":
      return { size: jpegSize(bytes, start, end), picture: true };
    default:
      throw unbounded();
  }
}

/**
 * How many bytes a Flate stream inflates to, counted up to the budget: inflated a piece at a time
 * from the data's start until the compressed stream ends, which fflate's inflater keeps in its
 * state (`s.f`, the last block begun, and `s.l`, a block under way), or until its data fails, as
 * pdf.js's own inflating would. An inflater without that state is one the guard cannot use, and
 * refuses.
 */
function inflatedSize(bytes: Uint8Array, start: number): number {
  let size = 0;
  const inflater = new Unzlib((chunk) => {
    size += chunk.length;
    if (size > STREAM_BUDGET) throw tooComplex();
  });
  const state = () => (inflater as unknown as { s?: { f?: unknown; l?: unknown } }).s;
  if (typeof state() !== "object") throw unbounded();
  try {
    for (let at = start; at < bytes.length; at += PIECE) {
      inflater.push(bytes.subarray(at, Math.min(at + PIECE, bytes.length)), false);
      const { f, l } = state() ?? {};
      if (f && !l) break;
    }
  } catch (error) {
    if (error instanceof Stop) throw error;
    // Data that fails to inflate stops pdf.js's inflating where it stops this one.
  }
  return size;
}

/** How many bytes RunLength data decodes to, from its run headers up to its end of data. */
function runLengthSize(bytes: Uint8Array, start: number): number {
  let size = 0;
  for (let at = start; at < bytes.length; ) {
    const header = bytes[at] ?? 128;
    if (header === 128) break;
    if (header < 128) {
      size += header + 1;
      at += header + 2;
    } else {
      size += 257 - header;
      at += 2;
    }
    if (size > STREAM_BUDGET) throw tooComplex();
  }
  return size;
}

/**
 * How many samples a JPEG decodes to, from its frame header: width by height by components. A
 * JPEG without one before its scan, or one whose height the frame leaves to later, is refused.
 */
function jpegSize(bytes: Uint8Array, start: number, end: number): number {
  let at = start;
  if (bytes[at] !== 0xff || bytes[at + 1] !== 0xd8) throw unbounded();
  at += 2;
  while (at + 4 <= end) {
    if (bytes[at] !== 0xff) throw unbounded();
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at++;
      continue;
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (frame) {
      const height = ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0);
      const width = ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0);
      const components = bytes[at + 9] ?? 0;
      if (height === 0 || width === 0 || components === 0) throw unbounded();
      return width * height * components;
    }
    if (marker === 0xda || length < 2) break;
    at += 2 + length;
  }
  throw unbounded();
}
