/**
 * The overlay's web fonts.
 *
 * The overlay is set in the page's own glyphs, so that what the user types looks like the page and
 * sits where the next compile puts it (decision 0004). Each TeX font a field is set in becomes an
 * OpenType font with CFF outlines, written by opentype.js in the browser from the `FontOutlines`
 * the page is drawn from, so the overlay and the page share every outline: re-encoded, slanted,
 * stretched and virtual fonts included (decision 0009), and nothing is built ahead of time, which
 * retires the spike's Python script. It is registered with the document as `rt-<font name>`.
 *
 * The font has no `liga`, `kern` or other layout features. The breaker lays the overlay's lines
 * out with TeX's ligature and kern program, but the rows are plain text the browser shapes, and
 * giving the browser those programs as GSUB and GPOS tables is decision 0004's later step.
 */

import { Font, Glyph, Path } from "opentype.js";
import { type FontOutlines, type GlyphOutline, glyphOf, textToCode } from "../tex/glyphs";
import type { PageFont } from "./fonts";

/** The em the outlines are in, as Type 1 fonts and `FontOutlines` have it. */
const UNITS_PER_EM = 1000;

/**
 * Where the baseline sits in a line of the font's text, as a fraction of the em below the top of
 * its one-em box: the ascender, 800 units, over a descender of 200, as the spike's fonts had them.
 * The overlay places its rows by it, so every set of vertical metrics a browser may read, the
 * `hhea` table's, the typographic ones and the Windows ones, says the same.
 */
export const ASCENT = 0.8;
const ASCENDER = ASCENT * UNITS_PER_EM;
const DESCENDER = ASCENDER - UNITS_PER_EM;

/** The CSS font family the web font for the TeX font `name` is registered as. */
export function webFontFamily(name: string): string {
  return `rt-${name}`;
}

/**
 * The character each code a font draws is typed as. A code whose text is one character gets it,
 * the code at the character's own code first and then the lowest, so `i` is the i and not the
 * dotless i; and a ligature glyph TeX reaches from `--`, `---` or a pair of quotes also gets the
 * one character a text may spell it with, such as `–`. The web font's character map and the
 * overlay's breaker both take their characters from this, so they give each the same glyph.
 */
export function typedCodes(
  outlines: FontOutlines,
  texts: (code: number) => string | undefined,
): Map<string, number> {
  return textToCode(outlines.encoding, (code) =>
    glyphOf(outlines, code) === undefined ? undefined : texts(code),
  );
}

/** How many numbers each command takes, of those `type1.ts` and `outlines.ts` write. */
const ARITY: ReadonlyMap<string, number> = new Map([
  ["M", 2],
  ["L", 2],
  ["C", 6],
  ["Q", 4],
  ["Z", 0],
]);

/**
 * An outline's path data, SVG's absolute `M`, `L`, `C`, `Q` and `Z` in font units with y up, as
 * an opentype.js path, which is in the same units. Pairs after an `M` are lines, as in SVG.
 * Anything else throws, rather than build a glyph that differs from the page's.
 */
export function pathOf(d: string): Path {
  const path = new Path();
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let at = 0;
  while (at < tokens.length) {
    const command = tokens[at++] as string;
    const arity = ARITY.get(command);
    if (arity === undefined)
      throw new Error(`path data holds ${command}, not only M, L, C, Q or Z`);
    const numbers: number[] = [];
    while (at < tokens.length && !/^[A-Za-z]$/.test(tokens[at] as string))
      numbers.push(Number(tokens[at++]));
    if (arity === 0 ? numbers.length > 0 : numbers.length === 0 || numbers.length % arity !== 0)
      throw new Error(`path data gives ${command} ${numbers.length} numbers`);
    if (arity === 0) path.close();
    for (let i = 0; i < numbers.length; i += arity) {
      const [a = 0, b = 0, c = 0, e = 0, f = 0, g = 0] = numbers.slice(i, i + arity);
      if (command === "M" && i === 0) path.moveTo(a, b);
      else if (command === "M" || command === "L") path.lineTo(a, b);
      else if (command === "C") path.curveTo(a, b, c, e, f, g);
      else path.quadTo(a, b, c, e);
    }
  }
  return path;
}

/** A glyph of the web font from an outline: its path, its advance and its left side bearing. */
function glyphFrom(name: string, outline: GlyphOutline, unicodes: number[]): Glyph {
  return new Glyph({
    name,
    unicodes,
    // The tables hold whole font units; a composed glyph's advance comes from a TFM.
    advanceWidth: Math.max(0, Math.round(outline.w)),
    leftSideBearing: Math.round(outline.b?.[0] ?? 0),
    path: pathOf(outline.d),
  });
}

/**
 * An OpenType font of a TeX font's outlines: `.notdef` first, then one glyph for each code of its
 * encoding that has an outline, with the outline's path and advance, in the 1000-unit em. Its
 * character map gives each glyph the characters `typedCodes` gives its code, from `texts`, the
 * text each code stands for. The glyphs are named by their codes rather than by the outlines'
 * names, which may be a virtual font's `A+breve` or `a.200` and may repeat across codes.
 *
 * TeX sets a space as glue, never a glyph, so a font's encoding seldom has one; without one the
 * browser would take the space from another font and the overlay's words would drift apart. So a
 * space, and a no-break space, that no code is typed as get a blank glyph `space` wide: the font's
 * interword space from its TFM, in thousandths of an em, which TeX sets between words before it
 * stretches or shrinks a line.
 */
export function buildWebFont(
  name: string,
  outlines: FontOutlines,
  texts: (code: number) => string | undefined,
  space: number,
): ArrayBuffer {
  const unicodes = new Map<number, number[]>();
  for (const [char, code] of typedCodes(outlines, texts)) {
    const chars = unicodes.get(code) ?? [];
    chars.push(char.charCodeAt(0));
    unicodes.set(code, chars);
  }
  const notdef = Object.hasOwn(outlines.glyphs, ".notdef") ? outlines.glyphs[".notdef"] : undefined;
  const glyphs = [glyphFrom(".notdef", notdef ?? { w: 0, d: "", b: null }, [])];
  const typed = new Set<number>();
  for (let code = 0; code < outlines.encoding.length; code++) {
    const outline = glyphOf(outlines, code);
    // An encoding names the codes it leaves empty `.notdef`, which a Type 1 font has a glyph for.
    if (outline === undefined || outlines.encoding[code] === ".notdef") continue;
    const chars = unicodes.get(code) ?? [];
    for (const char of chars) typed.add(char);
    glyphs.push(glyphFrom(`code${code}`, outline, chars));
  }
  const blanks = [0x20, 0xa0].filter((char) => !typed.has(char));
  if (blanks.length > 0) glyphs.push(glyphFrom("space", { w: space, d: "", b: null }, blanks));
  const family = webFontFamily(name);
  const font = new Font({
    familyName: family,
    styleName: "Regular",
    // A CFF font's name must avoid spaces and PostScript's delimiters; a TeX font's may not.
    postScriptName: family.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 63),
    unitsPerEm: UNITS_PER_EM,
    ascender: ASCENDER,
    descender: DESCENDER,
    glyphs,
    tables: { os2: { usWinAscent: ASCENDER, usWinDescent: -DESCENDER } },
  });
  return font.toArrayBuffer();
}

/**
 * The web font for a page font, whose space is its TFM's interword space: `\fontdimen2`, which a
 * TFM gives as a fraction of the font's size, as the web font's em is. Throws for a font the page
 * cannot draw, since it has no outlines to build one from.
 */
export function webFontOf(font: PageFont): ArrayBuffer {
  if (font.outlines === undefined) throw new Error(`${font.name} has no outlines: ${font.missing}`);
  const space = ((font.tfm.params[2] ?? 0) / 2 ** 20) * UNITS_PER_EM;
  return buildWebFont(font.name, font.outlines, font.text, space);
}

/** The web fonts registered with the document, by family, each for the page's life. */
const registered = new Map<string, Promise<FontFace>>();

/**
 * The web font for the TeX font `name`, registered with the document: built by `build` the first
 * time any field in the font is opened and kept for the page's life, so that each font is built
 * once. It resolves once the browser has loaded the font, so that text set in it lays out in its
 * metrics from the first frame. It rejects when the build throws or the browser refuses the font,
 * and that is forgotten once it settles, so that the next field opened in the font tries again: a
 * font whose outlines could not be read this time has them after a later page reads them again,
 * as `FontLibrary` forgets a failed read. It needs the browser's `FontFace` and `document.fonts`.
 */
export function registerWebFont(name: string, build: () => ArrayBuffer): Promise<FontFace> {
  const family = webFontFamily(name);
  const kept = registered.get(family);
  if (kept !== undefined) return kept;
  const face = (async () => {
    const loaded = await new FontFace(family, build()).load();
    document.fonts.add(loaded);
    return loaded;
  })();
  registered.set(family, face);
  face.catch(() => {
    if (registered.get(family) === face) registered.delete(family);
  });
  return face;
}
