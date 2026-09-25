/**
 * PostScript encoding vectors: the `.enc` files a font map names when it re-encodes a Type 1
 * font, such as `8r.enc` for the URW families or `lm-ec.enc` for Latin Modern in T1. The TeX font
 * sets code `n`, and the vector names the glyph of the Type 1 font that code draws; the font's
 * built-in encoding no longer counts.
 */

/** The number of codes a TeX font has, and so of names in a vector. */
const CODES = 256;

/** A PostScript name, `/` and the regular characters after it, which end at a delimiter. */
const NAME = /\/([^\s/[\]{}()<>%]*)/g;

/**
 * The 256 glyph names of an encoding vector, `/Name [ /g0 ... /g255 ] def`, by code. Comments
 * (`%` to the end of a line) may stand anywhere, whitespace may be of any kind or none between
 * two names, and `.notdef` is kept as it is. Anything else, or a count other than 256, throws
 * with what is wrong, since a vector read wrongly would draw every glyph after the fault as
 * another.
 */
export function parseEncoding(text: string): string[] {
  const code = text.replace(/%[^\r\n]*/g, " ");
  const open = code.indexOf("[");
  const close = code.indexOf("]", open + 1);
  if (open < 0 || close < 0) throw new Error("not an encoding vector: no [ ... ] holds its names");
  if (!/^\s*\/[^\s/[\]{}()<>%]+\s*$/.test(code.slice(0, open)))
    throw new Error("not an encoding vector: it does not begin with its name");
  if (!/^\s*def\s*$/.test(code.slice(close + 1)))
    throw new Error("not an encoding vector: `def` does not follow its names");
  const body = code.slice(open + 1, close);
  const stray = body.replace(NAME, " ").trim();
  if (stray) throw new Error(`an encoding vector holds names only, not ${stray.split(/\s+/)[0]}`);
  const names = Array.from(body.matchAll(NAME), (match) => match[1] as string);
  if (names.length !== CODES)
    throw new Error(`an encoding vector names ${CODES} glyphs, not ${names.length}`);
  if (names.includes("")) throw new Error("an encoding vector holds an empty name");
  return names;
}
