/**
 * Glyph outlines for the Type 1 fonts a DVI refers to, and the text each glyph stands for.
 *
 * The outlines (SVG path data in a 1000-unit em, y pointing up) and the font's built-in
 * encoding come from reading the Type 1 font itself in the browser (`type1.ts`), so the
 * page can be drawn as one path per glyph from the same files the PDF driver embeds. A font the
 * map re-encodes, slants or stretches, and a virtual font, come out in the same shape
 * (`outlines.ts`, `page/fonts.ts`).
 */

export interface GlyphOutline {
  /** Advance width, in a 1000-unit em whatever the font's own units. */
  w: number;
  /** SVG path data in a 1000-unit em, y up. */
  d: string;
  /** Bounding box [xMin, yMin, xMax, yMax] in a 1000-unit em, or null for an empty glyph. */
  b: [number, number, number, number] | null;
}

export interface FontOutlines {
  name: string;
  /** Glyph name for each of the 256 codes of the font's built-in encoding. */
  encoding: string[];
  /**
   * One outline per glyph name, in a table made by `glyphTable`, which has no prototype: a name
   * comes from a font file or an encoding vector and may be any word, `constructor` or `__proto__`
   * among them, which on an ordinary object would read an inherited member or set the prototype.
   * Read it with `Object.hasOwn`, or through `glyphOf`.
   */
  glyphs: Record<string, GlyphOutline>;
}

/** An empty table of glyphs by name, as `FontOutlines.glyphs` must be: one with no prototype. */
export function glyphTable(): Record<string, GlyphOutline> {
  return Object.create(null) as Record<string, GlyphOutline>;
}

/**
 * The outline a code of a font draws: the glyph its encoding names there, when the font has one
 * by that name. The renderer, the hit boxes and a virtual font's composition all ask this, so a
 * code one of them leaves out, the others leave out too.
 */
export function glyphOf(outlines: FontOutlines, code: number): GlyphOutline | undefined {
  const name = outlines.encoding[code];
  return name !== undefined && Object.hasOwn(outlines.glyphs, name)
    ? outlines.glyphs[name]
    : undefined;
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
  // OT1 has no ASCII caret or tilde: LaTeX sets \textasciicircum and \textasciitilde as the
  // circumflex and tilde accent glyphs at codes 94 and 126, which read as the characters.
  circumflex: "^",
  tilde: "~",
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

/**
 * The spacing accents TeX's `\accent` sets over a letter, by glyph name, and the combining mark
 * each stands for there. OT1 sets every accented letter as an accent and the letter, and T1 the
 * letters it has no glyph for, such as `ǎ`; a virtual font composes its accented letters from the
 * same two glyphs. Either way the pair reads as the one letter the text holds.
 */
export const ACCENTS: ReadonlyMap<string, string> = new Map([
  ["grave", "\u{300}"],
  ["acute", "\u{301}"],
  ["circumflex", "\u{302}"],
  ["tilde", "\u{303}"],
  ["macron", "\u{304}"],
  ["breve", "\u{306}"],
  ["dotaccent", "\u{307}"],
  ["dieresis", "\u{308}"],
  ["ring", "\u{30a}"],
  ["hungarumlaut", "\u{30b}"],
  ["caron", "\u{30c}"],
  ["cedilla", "\u{327}"],
  ["ogonek", "\u{328}"],
]);

/** A glyph name without the suffix from its first period on: `a.sc` is a form of `a`. */
const baseName = (name: string) => {
  const dot = name.indexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
};

/**
 * A glyph name with its suffix joined to its base, `twosuperior` for `two.superior`, anything
 * after a second period left out; undefined for a name with no suffix.
 */
function joinedName(name: string): string | undefined {
  const dot = name.indexOf(".");
  if (dot <= 0) return undefined;
  const next = name.indexOf(".", dot + 1);
  return name.slice(0, dot) + name.slice(dot + 1, next < 0 ? undefined : next);
}

/**
 * A character of the Private Use Area, where the Adobe Glyph List puts Adobe's old expert glyphs
 * (`dollaroldstyle` is U+F724): characters no model's text holds.
 */
const PRIVATE_USE = /\p{Co}/u;

/** The combining mark a glyph stands for when TeX's `\accent` sets it over a letter, if any. */
export function accentMark(name: string): string | undefined {
  return ACCENTS.get(baseName(name));
}

/**
 * The Adobe Glyph List, TeX Live's `glyphlist.txt`: `name;XXXX` per line, several code points
 * separated by spaces for a name that stands for more than one, and `#` comments. Lines of any
 * other shape are skipped.
 */
export function parseAgl(text: string): Map<string, string> {
  const agl = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const entry = /^([A-Za-z0-9._]+);([0-9A-Fa-f]{4}(?: [0-9A-Fa-f]{4})*)\s*$/.exec(line);
    if (!entry) continue;
    const codes = (entry[2] as string).split(" ").map((hex) => Number.parseInt(hex, 16));
    agl.set(entry[1] as string, String.fromCodePoint(...codes));
  }
  return agl;
}

/** Code points a `uniXXXX` or `uXXXX[XX]` name spells, as the AGL specification reads them. */
function unicodeName(name: string): string | undefined {
  const uni = /^uni((?:[0-9A-F]{4})+)$/.exec(name);
  const u = /^u([0-9A-F]{4,6})$/.exec(name);
  const hex = uni ? ((uni[1] as string).match(/.{4}/g) ?? []) : u ? [u[1] as string] : [];
  const codes = hex.map((h) => Number.parseInt(h, 16));
  const valid = (c: number) => c <= 0x10ffff && (c < 0xd800 || c > 0xdfff);
  return codes.length > 0 && codes.every(valid) ? String.fromCodePoint(...codes) : undefined;
}

/**
 * The letters of each Latin ligature Unicode encodes, U+FB00 to U+FB06. A model's text spells a
 * ligature out and TeX sets the glyph for its letters, so the aligner needs the letters, which
 * Computer Modern's `fi` reads as; but the AGL reads `fi` as U+FB01, and fonts beyond Computer
 * Modern may name the glyph `uniFB01`, as Lato and Roboto do.
 */
const LIGATURE_LETTERS: ReadonlyMap<string, string> = new Map([
  ["\u{fb00}", "ff"],
  ["\u{fb01}", "fi"],
  ["\u{fb02}", "fl"],
  ["\u{fb03}", "ffi"],
  ["\u{fb04}", "ffl"],
  ["\u{fb05}", "\u{17f}t"],
  ["\u{fb06}", "st"],
]);

/** Text for one name with no `+` in it, as `lookUpName` reads it, each ligature spelled out. */
function nameText(name: string, agl: ReadonlyMap<string, string> | undefined): string | undefined {
  return lookUpName(name, agl)?.replace(
    /[\u{fb00}-\u{fb06}]/gu,
    (ligature) => LIGATURE_LETTERS.get(ligature) ?? ligature,
  );
}

/** Text for one name with no `+` in it, by the lookups `glyphText` lists. */
function lookUpName(
  name: string,
  agl: ReadonlyMap<string, string> | undefined,
): string | undefined {
  const joined = joinedName(name);
  const variant = joined === undefined ? undefined : agl?.get(joined);
  if (variant !== undefined && !PRIVATE_USE.test(variant)) return variant;
  const base = baseName(name);
  if (base === "") return undefined;
  if (Object.hasOwn(GLYPH_TEXT, base)) return GLYPH_TEXT[base];
  if (base.length === 1 && /[A-Za-z]/.test(base)) return base;
  const listed = agl?.get(base) ?? unicodeName(base);
  if (listed !== undefined) return listed;
  if (!base.includes("_")) return undefined;
  const parts = base.split("_").map((part) => nameText(part, agl));
  return parts.every((part) => part !== undefined) ? parts.join("") : undefined;
}

/**
 * The text a glyph stands for, by its name, or undefined when the name says nothing. A name with a
 * suffix reads first as the Adobe Glyph List reads its suffix joined to its base, unless that is a
 * private-use character: Latin Modern names its superior figures `two.superior`, which is the
 * AGL's `twosuperior`, `²`, where dropping the suffix would read `2`; and the AGL puts
 * `dollaroldstyle` in the Private Use Area, so `dollar.oldstyle` stays `$`. Otherwise the suffix
 * from the first period on is dropped (`a.sc` reads as `a`), and then, in order: the table above,
 * which gives Computer Modern's quote and ligature names the spellings the aligner expects and
 * so wins (`quoteright` is `'`, `endash` is `--`); a single ASCII letter; the Adobe Glyph List,
 * which fonts beyond Computer Modern name their glyphs by (`Aacute` is `Á`, and a name for
 * several code points is their string); the `uniXXXX` and `uXXXX[XX]` forms; and a ligature's
 * parts joined by `_` (`f_f_i`). Whichever of these reads a name, a Latin ligature's code point,
 * U+FB00 to U+FB06, is spelled as its letters, as the table spells Computer Modern's ligatures:
 * `uniFB01` is `fi`, as `fi` is, and `uniFB05` is `ſt`. A name that joins parts with `+`, as a
 * virtual font's composed character is named (`fonts.ts`), is its parts' texts composed: a spacing
 * accent becomes its combining mark after the rest, and the whole is NFC, so `A+breve` is `Ă`.
 */
export function glyphText(name: string, agl?: ReadonlyMap<string, string>): string | undefined {
  if (!name.includes("+")) return nameText(name, agl);
  const parts = name.split("+");
  const texts = parts.map((part) => nameText(part, agl));
  if (!texts.every((text) => text !== undefined)) return undefined;
  const marks = parts.map((part) => accentMark(part));
  const bases = texts.filter((_, i) => marks[i] === undefined);
  // Accents alone, with no letter to go over, read as themselves.
  if (bases.length === 0) return texts.join("");
  return `${bases.join("")}${marks.filter((mark) => mark !== undefined).join("")}`.normalize("NFC");
}

/**
 * The font code for each character of the source text, from a font's built-in encoding.
 * Where several glyphs stand for one character (an `i` and a dotless i both read as "i"),
 * the glyph at the character's own code wins, then the first in encoding order.
 *
 * `textOf` gives each code's text, by default what its glyph's name reads as. The overlay passes
 * a page font's own texts (`PageFont.text`), which read names through the Adobe Glyph List and
 * leave out codes the font does not draw, so that its breaker and its web font's character map
 * (`webfont.ts`) give each character the same code. A code with no text gets no character.
 */
export function textToCode(
  encoding: readonly string[],
  textOf: (code: number) => string | undefined = (code) => glyphText(encoding[code] ?? ""),
): Map<string, number> {
  const codes = new Map<string, number>();
  encoding.forEach((name, code) => {
    const text = textOf(code);
    if (text === undefined) return;
    if (text.length === 1 && (!codes.has(text) || text.charCodeAt(0) === code))
      codes.set(text, code);
    // The characters inputenc maps onto the ligature glyphs, so "–" costs what "--" costs.
    const spelled = UNICODE_SPELLING.get(name);
    if (spelled !== undefined && !codes.has(spelled)) codes.set(spelled, code);
  });
  return codes;
}

/**
 * Glyphs TeX reaches through a ligature that a source text may spell with one character. A map,
 * since it is looked up by glyph name, which may be any word.
 */
const UNICODE_SPELLING: ReadonlyMap<string, string> = new Map([
  ["endash", "\u2013"],
  ["emdash", "\u2014"],
  ["quotedblleft", "\u201c"],
  ["quotedblright", "\u201d"],
  ["quoteleft", "\u2018"],
  ["quoteright", "\u2019"],
]);
