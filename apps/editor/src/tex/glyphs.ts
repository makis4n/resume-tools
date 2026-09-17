/**
 * Glyph outlines for the Type 1 fonts a DVI refers to, and the text each glyph stands for.
 *
 * The outlines (SVG path data in a 1000-unit em, y pointing up) and the font's built-in
 * encoding come from reading the Type 1 font itself in the browser (`type1.ts`), so the
 * page can be drawn as one path per glyph from the same files the PDF driver embeds.
 */

export interface GlyphOutline {
  /** Advance width in font units. */
  w: number;
  /** SVG path data in font units, y up. */
  d: string;
  /** Bounding box [xMin, yMin, xMax, yMax] in font units, or null for an empty glyph. */
  b: [number, number, number, number] | null;
}

export interface FontOutlines {
  name: string;
  /** Glyph name for each of the 256 codes of the font's built-in encoding. */
  encoding: string[];
  glyphs: Record<string, GlyphOutline>;
}

/** The characters a Computer Modern glyph represents in the source text. */
const GLYPH_TEXT: Record<string, string> = {
  space: " ",
  exclam: "!",
  quotedbl: '"',
  numbersign: "#",
  dollar: "$",
  percent: "%",
  ampersand: "&",
  quoteright: "'",
  quoteleft: "`",
  quotesingle: "'",
  parenleft: "(",
  parenright: ")",
  asterisk: "*",
  plus: "+",
  comma: ",",
  hyphen: "-",
  minus: "-",
  period: ".",
  slash: "/",
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  colon: ":",
  semicolon: ";",
  less: "<",
  equal: "=",
  greater: ">",
  question: "?",
  at: "@",
  bracketleft: "[",
  backslash: "\\",
  bracketright: "]",
  asciicircum: "^",
  underscore: "_",
  braceleft: "{",
  bar: "|",
  braceright: "}",
  asciitilde: "~",
  endash: "--",
  emdash: "---",
  quotedblleft: "``",
  quotedblright: "''",
  exclamdown: "!`",
  questiondown: "?`",
  ff: "ff",
  fi: "fi",
  fl: "fl",
  ffi: "ffi",
  ffl: "ffl",
  dotlessi: "i",
  dotlessj: "j",
  bullet: "•",
  periodcentered: "·",
};

/** Text for a glyph name: single letters map to themselves, the rest come from the table. */
export function glyphText(name: string): string | undefined {
  if (name.length === 1 && /[A-Za-z]/.test(name)) return name;
  return GLYPH_TEXT[name];
}

/**
 * The font code for each character of the source text, from a font's built-in encoding.
 * Where several glyphs stand for one character (an `i` and a dotless i both read as "i"),
 * the glyph at the character's own code wins, then the first in encoding order.
 */
export function textToCode(encoding: string[]): Map<string, number> {
  const codes = new Map<string, number>();
  encoding.forEach((name, code) => {
    const text = glyphText(name);
    if (
      text !== undefined &&
      text.length === 1 &&
      (!codes.has(text) || text.charCodeAt(0) === code)
    )
      codes.set(text, code);
    // The characters inputenc maps onto the ligature glyphs, so "–" costs what "--" costs.
    const spelled = UNICODE_SPELLING[name];
    if (spelled !== undefined && !codes.has(spelled)) codes.set(spelled, code);
  });
  return codes;
}

/** Glyphs TeX reaches through a ligature that a source text may spell with one character. */
const UNICODE_SPELLING: Record<string, string> = {
  endash: "\u2013",
  emdash: "\u2014",
  quotedblleft: "\u201c",
  quotedblright: "\u201d",
  quoteleft: "\u2018",
  quoteright: "\u2019",
};
