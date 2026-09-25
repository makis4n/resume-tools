/**
 * What a PDF from xdvipdfmx holds, read back for the validation harness and the engine's tests:
 * its page size, whether its fonts carry ToUnicode maps, and the strings its text operators show,
 * and where. The ATS reads the PDF's text, so these are what say the PDF is one it can read; and
 * the page is drawn from the same output, so where the PDF shows a text is where the page must.
 *
 * It reads only what a PDF made at compression level 0 (`PdfOptions.compress`) keeps as plain
 * text: xdvipdfmx then writes every stream, object streams among them, unfiltered, so the page
 * and font dictionaries in its object streams can be searched as they stand. A stream with a
 * filter is skipped, since inflating one would make this asynchronous in the browser, where the
 * harness will run too.
 */

/** A page's width and height, in PDF units, big points. */
export interface MediaBox {
  width: number;
  height: number;
}

/** Bytes decoded per call of `String.fromCharCode`, well within what a call may be passed. */
const CHUNK = 8192;

/**
 * The PDF as text, one character per byte, so that a string's offsets are the file's. Not
 * `TextDecoder("latin1")`, which decodes as windows-1252 and so gives some bytes other codes.
 */
function asText(pdf: Uint8Array): string {
  let text = "";
  for (let at = 0; at < pdf.length; at += CHUNK)
    text += String.fromCharCode(...pdf.subarray(at, at + CHUNK));
  return text;
}

const NUMBER = String.raw`(-?(?:\d+\.?\d*|\.\d+))`;
const MEDIA_BOX = new RegExp(
  String.raw`/MediaBox\s*\[\s*${NUMBER}\s+${NUMBER}\s+${NUMBER}\s+${NUMBER}\s*\]`,
  "g",
);

/** The size of every /MediaBox the PDF gives, a page's own or one its pages inherit. */
export function mediaBoxes(pdf: Uint8Array): MediaBox[] {
  return [...asText(pdf).matchAll(MEDIA_BOX)].map((match) => {
    const [left, bottom, right, top] = match.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    return { width: right - left, height: top - bottom };
  });
}

/**
 * Whether a font of the PDF has a ToUnicode map, which is what lets a reader take the text out:
 * xdvipdfmx builds one for each Type 1 font from its glyph names.
 */
export function hasToUnicode(pdf: Uint8Array): boolean {
  return /\/ToUnicode\s*\d+\s+\d+\s+R/.test(asText(pdf));
}

/**
 * The strings the PDF's text-showing operators show, one for each Tj, TJ, ' and ", in the order
 * of its content streams: a TJ's strings are joined without the kerns between them, which is also
 * where xdvipdfmx puts the space between two words. Each is its bytes as characters, the codes of
 * the glyphs in the font's encoding, which for ASCII letters, digits and most punctuation are
 * their own; except in a composite font with a ToUnicode map, which is how xdvipdfmx embeds
 * XeTeX's native fonts, whose two-byte codes are glyphs: its strings are read through the map, as
 * a reader takes the text out, and a glyph the map does not name reads as nothing. The content
 * streams are the pages' /Contents and any form XObject; the other streams, such as fonts and
 * ToUnicode maps, hold no text operators.
 */
export function shownStrings(pdf: Uint8Array): string[] {
  return shownTexts(pdf).map((shown) => shown.text);
}

/** What one text-showing operator shows, and where. */
export interface ShownText {
  /** Its strings joined, as `shownStrings` gives them. */
  text: string;
  /**
   * Its strings and the kerns between them as a TJ gives them, in thousandths of the font's size,
   * a negative kern moving the next glyph right; a Tj, ' or " shows one string.
   */
  parts: (string | number)[];
  /**
   * Where its first glyph's origin is, in big points, in the space of the content stream that
   * shows it: for a page's content, the page's own, from the lower left corner. That is the text
   * matrix's origin through the transformation matrix, `cm` by `cm` and `q` and `Q` as the stream
   * has them, which is where xdvipdfmx places a line of text; and a TJ's kerns before its first
   * string move it. NaN where the operator follows another show with no move of the text between
   * them, since the first moved the text by its glyphs' widths, which this does not read.
   */
  x: number;
  y: number;
}

/**
 * What each of the PDF's text-showing operators shows, and where, in the order `shownStrings`
 * reads them. The graphics state starts afresh in each content stream.
 */
export function shownTexts(pdf: Uint8Array): ShownText[] {
  return contentOf(pdf).shown;
}

/** A path the PDF strokes, as a rule or a frame is drawn. */
export interface StrokedPath {
  /**
   * The box its points span, in big points, in the space of the content stream that strokes it,
   * as `ShownText` places a text. A curve's control points count, which for a rounded corner lie
   * within the box its ends span.
   */
  left: number;
  bottom: number;
  right: number;
  top: number;
  /** The line's width in that space: the stroke reaches half of it past the path. */
  width: number;
  /** Whether it has a curve, as a rounded frame does and a rule, drawn as a line, does not. */
  curved: boolean;
}

/**
 * Every path the PDF's content streams stroke, in the order `shownTexts` reads them, with an S, s,
 * B, B*, b or b*; a path that is only filled or clipped is left out.
 */
export function strokedPaths(pdf: Uint8Array): StrokedPath[] {
  return contentOf(pdf).strokes;
}

/** What the content streams show and stroke. */
interface Content {
  shown: ShownText[];
  strokes: StrokedPath[];
}

/** What every content stream of the PDF shows and strokes, the pages' and the forms'. */
function contentOf(pdf: Uint8Array): Content {
  const text = asText(pdf);
  const contents = new Set<number>();
  for (const match of text.matchAll(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/g))
    for (const ref of (match[1] ?? "").matchAll(/(\d+)\s+\d+\s+R/g)) contents.add(Number(ref[1]));
  const { streams, dictionaries } = objectsOf(text);
  const decoders = composites(streams, dictionaries);
  const read: Content = { shown: [], strokes: [] };
  for (const stream of streams) {
    const content = contents.has(stream.object) || /\/Subtype\s*\/Form\b/.test(stream.dict);
    if (content && !/\/Filter\b/.test(stream.dict)) readContent(stream.data, read, decoders);
  }
  return read;
}

interface Stream {
  object: number;
  dict: string;
  data: string;
}

/** The start of a stream object, up to its data: its number, and its dictionary. */
const STREAM_START = /(\d+)\s+\d+\s+obj\s*(<<(?:(?!endobj)[\s\S])*?>>)\s*stream\r?\n/y;

/**
 * Every stream object in the file, its data cut to the dictionary's /Length, which xdvipdfmx
 * writes as a number, and every other object's text, by its number: a top-level object's, up to
 * its `endobj`, and each of an unfiltered object stream's, where xdvipdfmx puts a PDF 1.5 file's
 * dictionaries, fonts' and pages' among them. The search goes on after a stream's data, since a
 * font's bytes can hold anything.
 */
function objectsOf(text: string): { streams: Stream[]; dictionaries: Map<number, string> } {
  const streams: Stream[] = [];
  const dictionaries = new Map<number, string>();
  const objects = /(\d+)\s+\d+\s+obj\b/g;
  for (let found = objects.exec(text); found !== null; found = objects.exec(text)) {
    STREAM_START.lastIndex = found.index;
    const start = STREAM_START.exec(text);
    const dict = start?.[2];
    const length = dict === undefined ? undefined : /\/Length\s+(\d+)(?!\d|\s+\d+\s+R)/.exec(dict);
    if (start === null || dict === undefined || length?.[1] === undefined) {
      const body = found.index + found[0].length;
      const end = text.indexOf("endobj", body);
      if (end >= 0) dictionaries.set(Number(found[1]), text.slice(body, end));
      continue;
    }
    const from = start.index + start[0].length;
    const to = from + Number(length[1]);
    const stream = { object: Number(start[1]), dict, data: text.slice(from, to) };
    streams.push(stream);
    if (/\/Type\s*\/ObjStm\b/.test(dict) && !/\/Filter\b/.test(dict))
      for (const [object, body] of objectStream(stream)) dictionaries.set(object, body);
    objects.lastIndex = to;
  }
  return { streams, dictionaries };
}

/**
 * The objects an object stream holds, by number: its data starts with pairs of an object's number
 * and its offset past `/First`, and each object runs to the next one's offset.
 */
function objectStream(stream: Stream): Map<number, string> {
  const held = new Map<number, string>();
  const first = Number(/\/First\s+(\d+)/.exec(stream.dict)?.[1]);
  const count = Number(/\/N\s+(\d+)/.exec(stream.dict)?.[1]);
  if (!Number.isInteger(first) || !Number.isInteger(count)) return held;
  const numbers = stream.data.slice(0, first).trim().split(/\s+/).map(Number);
  for (let i = 0; i < count && 2 * i + 1 < numbers.length; i++) {
    const object = numbers[2 * i] as number;
    const from = first + (numbers[2 * i + 1] as number);
    const next = numbers[2 * i + 3];
    const to = next === undefined || 2 * i + 3 >= 2 * count ? stream.data.length : first + next;
    if (Number.isInteger(object) && from <= to) held.set(object, stream.data.slice(from, to));
  }
  return held;
}

/**
 * How each composite font's strings read, by the name the pages' resources give it: through its
 * ToUnicode map, a CMap stream, two bytes to a code (`Identity-H`, as xdvipdfmx embeds every
 * native font). xdvipdfmx names each font once for the whole document, so the names of every
 * resource dictionary are read as one. A font without a map, or whose map is filtered, reads as
 * its bytes.
 */
function composites(
  streams: readonly Stream[],
  dictionaries: ReadonlyMap<number, string>,
): Map<string, (shown: string) => string> {
  const byObject = new Map(streams.map((stream) => [stream.object, stream]));
  const decoders = new Map<string, (shown: string) => string>();
  const resources = [...dictionaries.values(), ...streams.map((stream) => stream.dict)];
  for (const holder of resources)
    for (const fonts of holder.matchAll(/\/Font\s*(<<[^<>]*>>|\d+\s+\d+\s+R)/g)) {
      const ref = /^(\d+)\s+\d+\s+R$/.exec(fonts[1] ?? "");
      const table = ref ? (dictionaries.get(Number(ref[1])) ?? "") : (fonts[1] ?? "");
      for (const [, name, object] of table.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
        const font = dictionaries.get(Number(object)) ?? "";
        const map = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(font)?.[1];
        const cmap = map === undefined ? undefined : byObject.get(Number(map));
        if (!/\/Subtype\s*\/Type0\b/.test(font) || !cmap || /\/Filter\b/.test(cmap.dict)) continue;
        const unicode = toUnicode(cmap.data);
        decoders.set(name as string, (shown) => {
          let out = "";
          for (let at = 0; at + 1 < shown.length; at += 2)
            out += unicode.get(shown.charCodeAt(at) * 256 + shown.charCodeAt(at + 1)) ?? "";
          return out;
        });
      }
    }
  return decoders;
}

/** A hexadecimal string's bytes as UTF-16BE, the way a ToUnicode map writes a code's text. */
function utf16(hex: string): string {
  let out = "";
  for (let at = 0; at + 4 <= hex.length; at += 4)
    out += String.fromCharCode(Number.parseInt(hex.slice(at, at + 4), 16));
  return out;
}

/** The most codes a two-byte ToUnicode map can name. */
const CODES = 65_536;

/**
 * A ToUnicode CMap's codes and the text each stands for, from its `bfchar` and `bfrange` blocks:
 * a range's codes read as its first text with the last code unit counted up, or as the texts of
 * an array one by one.
 */
function toUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const [, block = ""] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const [, code = "", text = ""] of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g))
      map.set(Number.parseInt(code, 16), utf16(text));
  for (const [, block = ""] of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const [, low = "", high = "", text, array] of block.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[([^\]]*)\])/g,
    )) {
      const from = Number.parseInt(low, 16);
      const to = Math.min(Number.parseInt(high, 16), from + CODES - 1);
      const texts = array === undefined ? [] : [...array.matchAll(/<([0-9A-Fa-f]*)>/g)];
      for (let code = from; code <= to; code++) {
        const k = code - from;
        if (array !== undefined) {
          const each = texts[k]?.[1];
          if (each !== undefined) map.set(code, utf16(each));
          continue;
        }
        const first = utf16(text ?? "");
        if (first === "") continue;
        const last = first.charCodeAt(first.length - 1) + k;
        map.set(code, first.slice(0, -1) + String.fromCharCode(last & 0xffff));
      }
    }
  return map;
}

/** What a backslash and the character after it stand for in a literal string. */
const ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  "(": "(",
  ")": ")",
  "\\": "\\",
};

/** A literal string that starts at `from`, decoded, and where the content goes on after it. */
function literalString(content: string, from: number): [string, number] {
  let out = "";
  let depth = 0;
  for (let at = from + 1; at < content.length; at++) {
    const char = content[at] as string;
    if (char === "\\") {
      const next = content[++at];
      if (next === undefined) break;
      if (next in ESCAPES) out += ESCAPES[next];
      else if (/[0-7]/.test(next)) {
        let octal = next;
        while (octal.length < 3 && /[0-7]/.test(content[at + 1] ?? "")) octal += content[++at];
        out += String.fromCharCode(Number.parseInt(octal, 8) & 0xff);
      } else if (next === "\r") {
        // A backslash at the end of a line joins the lines.
        if (content[at + 1] === "\n") at++;
      } else if (next !== "\n") out += next;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") {
      if (depth === 0) return [out, at + 1];
      depth--;
    }
    out += char;
  }
  return [out, content.length];
}

/** A hexadecimal string that starts at `from`, decoded, and where the content goes on after it. */
function hexString(content: string, from: number): [string, number] {
  const end = content.indexOf(">", from);
  const to = end < 0 ? content.length : end;
  const digits = content.slice(from + 1, to).replace(/\s+/g, "");
  let out = "";
  for (let at = 0; at < digits.length; at += 2)
    out += String.fromCharCode(Number.parseInt(digits.slice(at, at + 2).padEnd(2, "0"), 16));
  return [out, to + 1];
}

/** A run of regular characters: a number, a name's body or an operator. */
const REGULAR = /[^\s()<>[\]{}/%]+/y;

/** An affine transformation as PDF writes one, `[a b c d e f]`. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m`, then `n`: PDF's `m × n`, which maps a point through `m` and the result through `n`. */
function times(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [p, q, r, s, t, u] = n;
  return [
    a * p + b * r,
    a * q + b * s,
    c * p + d * r,
    c * q + d * s,
    e * p + f * r + t,
    e * q + f * s + u,
  ];
}

/** A move by `x` and `y`. */
const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

/**
 * Add what each text-showing operator of a content stream shows, and where, and each path it
 * strokes, to `read`: what it shows read through the decoder of the font the last `Tf` selected,
 * when `decoders` has one for it.
 */
function readContent(
  content: string,
  read: Content,
  decoders: ReadonlyMap<string, (shown: string) => string> = new Map(),
) {
  const { shown, strokes } = read;
  /** The last name among the operands, which `Tf` takes as the font's, and that font's decoder. */
  let named: string | undefined;
  let decode: ((shown: string) => string) | undefined;
  /** The operands since the last operator: strings, numbers, and arrays of the two. */
  let operands: (string | number | (string | number)[])[] = [];
  let array: (string | number)[] | undefined;
  /** The last `count` operands, when they are all numbers. */
  const numbers = (count: number) => {
    const last = operands.slice(-count);
    return last.length === count && last.every((operand) => typeof operand === "number")
      ? (last as number[])
      : undefined;
  };
  // The transformation matrix and the line width, and the copies `q` saves of the two; the path
  // being built, its points through the matrix as each was added; the text line matrix and the
  // text matrix; and whether the text matrix is where the next glyph starts, which a show leaves
  // it not.
  let ctm = IDENTITY;
  let lineWidth = 1;
  const saved: { ctm: Matrix; lineWidth: number }[] = [];
  let path: { points: [number, number][]; curved: boolean } = { points: [], curved: false };
  const addPoints = (coordinates: number[] | undefined, curved = false) => {
    if (coordinates === undefined) return;
    for (let at = 0; at + 1 < coordinates.length; at += 2) {
      const [x = 0, y = 0] = coordinates.slice(at, at + 2);
      const [a, b, c, d, e, f] = ctm;
      path.points.push([x * a + y * c + e, x * b + y * d + f]);
    }
    if (curved) path.curved = true;
  };
  const endPath = (stroked: boolean) => {
    const { points, curved } = path;
    if (stroked && points.length > 0) {
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      const [a, b, c, d] = ctm;
      strokes.push({
        left: Math.min(...xs),
        bottom: Math.min(...ys),
        right: Math.max(...xs),
        top: Math.max(...ys),
        width: lineWidth * Math.sqrt(Math.abs(a * d - b * c)),
        curved,
      });
    }
    path = { points: [], curved: false };
  };
  let line = IDENTITY;
  let matrix = IDENTITY;
  let placed = true;
  let size = 0;
  let scaling = 1;
  let leading = 0;
  const moveTo = (next: Matrix) => {
    line = next;
    matrix = next;
    placed = true;
  };
  const show = (shownParts: (string | number)[]) => {
    const parts =
      decode === undefined
        ? shownParts
        : shownParts.map((part) => (typeof part === "string" ? (decode?.(part) ?? part) : part));
    let x = Number.NaN;
    let y = Number.NaN;
    if (placed) {
      // A TJ's kerns before its first string move its first glyph.
      let kern = 0;
      for (const part of parts) {
        if (typeof part === "string") break;
        kern -= (part / 1000) * size * scaling;
      }
      const origin = times(times(translation(kern, 0), matrix), ctm);
      x = origin[4];
      y = origin[5];
    }
    const text = parts.filter((part) => typeof part === "string").join("");
    shown.push({ text, parts, x, y });
    placed = false;
  };
  let at = 0;
  while (at < content.length) {
    const char = content[at] as string;
    if (/\s/.test(char)) at++;
    else if (char === "%") {
      const end = content.indexOf("\n", at);
      at = end < 0 ? content.length : end;
    } else if (content.startsWith("<<", at) || content.startsWith(">>", at)) at += 2;
    else if (char === "(" || char === "<") {
      const [value, next] = char === "(" ? literalString(content, at) : hexString(content, at);
      (array ?? operands).push(value);
      at = next;
    } else if (char === "[") {
      array = [];
      at++;
    } else if (char === "]") {
      if (array !== undefined) operands.push(array);
      array = undefined;
      at++;
    } else if (char === ">" || char === "{" || char === "}") at++;
    else {
      // A name (after its slash) is an operand of which only a font's is needed, and a number one
      // this may need; anything else is an operator, which ends its operands.
      const slash = char === "/";
      REGULAR.lastIndex = slash ? at + 1 : at;
      const word = REGULAR.exec(content)?.[0] ?? "";
      at = REGULAR.lastIndex > at ? REGULAR.lastIndex : at + 1;
      if (slash) {
        named = word;
        continue;
      }
      if (/^[-+.\d]/.test(word)) {
        const number = Number(word);
        if (Number.isFinite(number)) (array ?? operands).push(number);
        continue;
      }
      const last = operands.at(-1);
      const [first, second] = numbers(2) ?? [];
      const six = numbers(6) as Matrix | undefined;
      if (word === "TJ" && Array.isArray(last)) show(last);
      else if (word === "Tj" && typeof last === "string") show([last]);
      else if ((word === "'" || word === '"') && typeof last === "string") {
        moveTo(times(translation(0, -leading), line));
        show([last]);
      } else if (word === "q") saved.push({ ctm, lineWidth });
      else if (word === "Q") ({ ctm, lineWidth } = saved.pop() ?? { ctm, lineWidth });
      else if (word === "cm" && six) ctm = times(six, ctm);
      else if (word === "w") lineWidth = numbers(1)?.[0] ?? lineWidth;
      else if (word === "m" || word === "l") addPoints(numbers(2));
      else if (word === "c") addPoints(numbers(6), true);
      else if (word === "v" || word === "y") addPoints(numbers(4), true);
      else if (word === "re" && numbers(4)) {
        const [x = 0, y = 0, width = 0, height = 0] = numbers(4) ?? [];
        addPoints([x, y, x + width, y, x + width, y + height, x, y + height]);
      } else if (["S", "s", "B", "B*", "b", "b*"].includes(word)) endPath(true);
      else if (["f", "F", "f*", "n"].includes(word)) endPath(false);
      else if (word === "BT") moveTo(IDENTITY);
      else if ((word === "Td" || word === "TD") && first !== undefined && second !== undefined) {
        if (word === "TD") leading = -second;
        moveTo(times(translation(first, second), line));
      } else if (word === "Tm" && six) moveTo(six);
      else if (word === "T*") moveTo(times(translation(0, -leading), line));
      else if (word === "TL") leading = numbers(1)?.[0] ?? leading;
      else if (word === "Tf") {
        size = numbers(1)?.[0] ?? size;
        decode = named === undefined ? undefined : decoders.get(named);
      } else if (word === "Tz") scaling = (numbers(1)?.[0] ?? 100) / 100;
      else if (word === "ID") {
        // An inline image's data runs to its EI, and may hold any byte.
        const end = content.slice(at).search(/\sEI(?=\s|$)/);
        at = end < 0 ? content.length : at + end + 3;
      }
      operands = [];
      array = undefined;
      named = undefined;
    }
  }
}
