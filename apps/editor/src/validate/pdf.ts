/**
 * What a PDF from xdvipdfmx holds, read back for the validation harness and the engine's tests:
 * its page size, whether its fonts carry ToUnicode maps, and the strings its text operators show.
 * The ATS reads the PDF's text, so these are what say the PDF is one it can read.
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
 * their own. The content streams are the pages' /Contents and any form XObject; the other streams,
 * such as fonts and ToUnicode maps, hold no text operators.
 */
export function shownStrings(pdf: Uint8Array): string[] {
  const text = asText(pdf);
  const contents = new Set<number>();
  for (const match of text.matchAll(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/g))
    for (const ref of (match[1] ?? "").matchAll(/(\d+)\s+\d+\s+R/g)) contents.add(Number(ref[1]));
  const shown: string[] = [];
  for (const stream of streamsOf(text)) {
    const content = contents.has(stream.object) || /\/Subtype\s*\/Form\b/.test(stream.dict);
    if (content && !/\/Filter\b/.test(stream.dict)) readContent(stream.data, shown);
  }
  return shown;
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
 * writes as a number. The search goes on after the data, since a font's bytes can hold anything.
 */
function streamsOf(text: string): Stream[] {
  const streams: Stream[] = [];
  const objects = /\d+\s+\d+\s+obj\b/g;
  for (let found = objects.exec(text); found !== null; found = objects.exec(text)) {
    STREAM_START.lastIndex = found.index;
    const start = STREAM_START.exec(text);
    const dict = start?.[2];
    const length = dict === undefined ? undefined : /\/Length\s+(\d+)(?!\d|\s+\d+\s+R)/.exec(dict);
    if (start === null || dict === undefined || length?.[1] === undefined) continue;
    const from = start.index + start[0].length;
    const to = from + Number(length[1]);
    streams.push({ object: Number(start[1]), dict, data: text.slice(from, to) });
    objects.lastIndex = to;
  }
  return streams;
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

/** Add what each text-showing operator of a content stream shows to `shown`. */
function readContent(content: string, shown: string[]) {
  /** The operands since the last operator: strings, and arrays of the strings they hold. */
  let operands: (string | string[])[] = [];
  let array: string[] | undefined;
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
      // A name (after its slash) or a number is an operand this does not need; anything else
      // is an operator, which ends its operands.
      const name = char === "/";
      REGULAR.lastIndex = name ? at + 1 : at;
      const word = REGULAR.exec(content)?.[0] ?? "";
      at = REGULAR.lastIndex > at ? REGULAR.lastIndex : at + 1;
      if (name || /^[-+.\d]/.test(word)) continue;
      const last = operands.at(-1);
      if (word === "TJ" && Array.isArray(last)) shown.push(last.join(""));
      else if ((word === "Tj" || word === "'" || word === '"') && typeof last === "string")
        shown.push(last);
      else if (word === "ID") {
        // An inline image's data runs to its EI, and may hold any byte.
        const end = content.slice(at).search(/\sEI(?=\s|$)/);
        at = end < 0 ? content.length : at + end + 3;
      }
      operands = [];
      array = undefined;
    }
  }
}
