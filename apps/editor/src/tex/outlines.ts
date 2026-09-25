/**
 * Outlines as a font map asks for them: the Type 1 font's glyphs under another encoding, slanted
 * or stretched as `SlantFont` and `ExtendFont` say, and glyphs placed and scaled to be composed
 * into a virtual font's characters. Each result is an ordinary `FontOutlines`, so the renderer,
 * the hit boxes, the field aligner and item 9's web fonts draw it as they draw any other font.
 */

import type { FontOutlines, GlyphOutline } from "./glyphs";

/**
 * An affine map of the plane, as SVG's `matrix(a b c d e f)` gives it: a point (x, y) goes to
 * (a·x + c·y + e, b·x + d·y + f).
 */
export type Matrix = readonly [number, number, number, number, number, number];

/** A glyph box, [xMin, yMin, xMax, yMax]. */
type Box = [number, number, number, number];

/** Numbers in path data: three decimals, as `type1.ts` writes them. */
const num = (v: number) => String(Math.round(v * 1000) / 1000 || 0);

/** How many coordinates each command of the path data takes. */
const ARITY: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };

/**
 * Path data with every point mapped through `m`. Only absolute `M`, `L`, `C`, `Q` and `Z` are
 * read, the commands `type1.ts` writes; a Bézier curve's image under an affine map is the curve
 * through its mapped control points, so mapping them is exact. The result uses the same
 * commands, with numbers rounded to three decimals. Anything else throws, rather than draw a
 * glyph wrong.
 */
export function transformPath(d: string, m: Matrix): string {
  const [a, b, c, dd, e, f] = m;
  const out: string[] = [];
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let at = 0;
  while (at < tokens.length) {
    const command = tokens[at++] as string;
    const arity = ARITY[command];
    if (arity === undefined)
      throw new Error(`path data holds ${command}, not only M, L, C, Q or Z`);
    const numbers: number[] = [];
    while (at < tokens.length && !/^[A-Za-z]$/.test(tokens[at] as string))
      numbers.push(Number(tokens[at++]));
    if (arity === 0 ? numbers.length > 0 : numbers.length === 0 || numbers.length % arity !== 0)
      throw new Error(`path data gives ${command} ${numbers.length} numbers`);
    const mapped: string[] = [];
    for (let i = 0; i < numbers.length; i += 2) {
      const x = numbers[i] as number;
      const y = numbers[i + 1] as number;
      mapped.push(num(a * x + c * y + e), num(b * x + dd * y + f));
    }
    out.push(`${command}${mapped.join(" ")}`);
  }
  return out.join("");
}

/**
 * The box of a box's image under `m`: the extent of its four corners, since under a slant the
 * box's x extent depends on y. It holds the mapped glyph, though for a slanted one it may be a
 * little larger than the glyph's own box.
 */
export function transformBox(box: Box | null, m: Matrix): Box | null {
  if (!box) return null;
  const [a, b, c, d, e, f] = m;
  const [x0, y0, x1, y1] = box;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ] as const) {
    xs.push(a * x + c * y + e);
    ys.push(b * x + d * y + f);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** One glyph's outline mapped through `m`, its advance scaled by the map's x scale. */
export function transformGlyph(glyph: GlyphOutline, m: Matrix): GlyphOutline {
  return { w: glyph.w * m[0], d: transformPath(glyph.d, m), b: transformBox(glyph.b, m) };
}

/**
 * The font's glyphs under another encoding vector, as a map entry's `ReEncodeFont` asks: code n
 * draws the glyph the vector names at n. A name the font lacks stays in the encoding with no
 * outline, as the renderer expects of a code it cannot draw.
 */
export function reencode(outlines: FontOutlines, encoding: readonly string[]): FontOutlines {
  return { name: outlines.name, encoding: [...encoding], glyphs: outlines.glyphs };
}

/**
 * The font slanted and stretched as a map entry's `SlantFont` and `ExtendFont` ask, as pdfTeX
 * and xdvipdfmx apply them to the font matrix: x' = extend·x + slant·y, y' = y. Advances are
 * scaled by `extend`, which the TFM of such a font already holds, and boxes are recomputed.
 */
export function transform(
  outlines: FontOutlines,
  { slant = 0, extend = 1 }: { slant?: number; extend?: number },
): FontOutlines {
  if (slant === 0 && extend === 1) return outlines;
  const m: Matrix = [extend, 0, slant, 1, 0, 0];
  const glyphs: Record<string, GlyphOutline> = {};
  for (const [name, glyph] of Object.entries(outlines.glyphs))
    glyphs[name] = transformGlyph(glyph, m);
  return { name: outlines.name, encoding: outlines.encoding, glyphs };
}
