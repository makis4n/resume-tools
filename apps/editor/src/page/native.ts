/**
 * XeTeX's native fonts: the OpenType and TrueType files a XeTeX template sets its text in
 * directly, read in the browser through opentype.js (decision 0014). The XDV names the file and
 * gives each glyph by its index in it, so the page draws a glyph from the file's outline, hit-tests
 * it by the outline's box, and reads the character it stands for from the file's character map;
 * the overlay measures a character by its glyph's advance, and sets its rows in the file itself.
 *
 * A glyph's text is the character the character map gives it, the lowest when it gives several;
 * a ligature of the `liga` feature, such as the `fi` XeTeX's shaping makes of an f and an i, reads
 * as its components, and so does a ligature the character map reaches only through a character
 * that stands for those letters, as Roboto's `fi` is also U+FB01 ﬁ, which a resume's text never
 * holds where the page shows the ligature. A glyph reached neither way, such as a small capital,
 * has no text.
 *
 * A file is read whole, so it is bounded as decision 0009 bounds a virtual font: a file of more
 * than 32 MB, or with more than 65,535 glyphs, is refused. Every file comes from the TeX Live tree,
 * whose largest, Lato's, are under 1 MB.
 */

import { type Font, parse } from "opentype.js";
import type { NativeOutlines } from "../tex/svg";

/** The largest font file the page reads, in bytes. */
export const MAX_FONT_BYTES = 32 * 1024 * 1024;
/** The most glyphs a font file may hold, all an OpenType glyph index can name. */
export const MAX_GLYPHS = 65_535;

/** An outline's box, [xMin, yMin, xMax, yMax], in font units. */
export type NativeBox = [number, number, number, number];

/** A native font file as the page and the overlay read it. Glyphs are named by their index. */
export interface NativeFontFile extends NativeOutlines {
  /** Font units per em. */
  unitsPerEm: number;
  /**
   * SVG path data in font units, y up, read once: undefined for a glyph with no outline, one past
   * the file's glyphs, and one the file cannot deliver, which is left out rather than the page.
   */
  pathOf: (glyph: number) => string | undefined;
  /** The box of the glyph's outline, in font units, when `pathOf` gives one. */
  boxOf: (glyph: number) => NativeBox | undefined;
  /** The character or characters the glyph stands for, or undefined when nothing says. */
  textOf: (glyph: number) => string | undefined;
  /** The glyph's advance in font units, or undefined past the file's glyphs. */
  advanceOf: (glyph: number) => number | undefined;
  /** The glyph the character map gives a character, or undefined when it gives none. */
  glyphFor: (char: string) => number | undefined;
  /** The advance of the space's glyph, in font units, which XeTeX makes `\fontdimen2`; 0 without. */
  spaceAdvance: number;
  /**
   * The font's slant, which XeTeX makes `\fontdimen1`: the tangent of its `post` table's italic
   * angle, turned to lean right, as Roboto Italic's -12° gives 0.2126; 0 for an upright font.
   */
  slant: number;
  /**
   * The ascent and descent a browser lays a line of the font out with, as fractions of the em:
   * the `hhea` table's, which browsers take on macOS and Linux. Windows takes the `OS/2` table's,
   * which for Roboto, Lato, Source Sans Pro and Font Awesome put a line's baseline within a
   * hundredth of an em of the same place.
   */
  ascent: number;
  descent: number;
  /** The file's bytes, which the overlay registers as its web font. */
  bytes: Uint8Array;
}

/** A coverage table as opentype.js parses one: a list of glyphs, or ranges of them. */
type Coverage =
  | { format: 1; glyphs: number[] }
  | { format: 2; ranges: { start: number; end: number }[] };

/** A ligature substitution subtable, lookup type 4, as opentype.js parses one. */
interface LigatureSubtable {
  coverage: Coverage;
  ligatureSets: { ligGlyph: number; components: number[] }[][];
}

/** The parts of a GSUB table as opentype.js parses one that the ligatures are read from. */
interface Gsub {
  features: { tag: string; feature: { lookupListIndexes: number[] } }[];
  lookups: { lookupType: number; subtables: unknown[] }[];
}

/** The lookup type of a ligature substitution, and of an extension lookup that wraps another. */
const LIGATURE = 4;
const EXTENSION = 7;

/** The most ligatures deep a ligature's components may be made, such as ffi from ff and i. */
const LIGATURE_DEPTH = 4;

/** Whether a value is an object, which a parsed table is. */
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The glyphs a coverage table lists, in its order, which is the order of its subtable's records.
 * A coverage never lists more glyphs than a font can have, so a longer one is cut there.
 */
function coverageGlyphs(coverage: Coverage): number[] {
  if (coverage.format === 1) return coverage.glyphs.slice(0, MAX_GLYPHS);
  const glyphs: number[] = [];
  for (const { start, end } of coverage.ranges)
    for (let glyph = start; glyph <= end && glyphs.length < MAX_GLYPHS; glyph++) glyphs.push(glyph);
  return glyphs;
}

/**
 * The ligatures of a font's `liga` feature, in every script, each as its glyph and the glyphs it
 * is made of, in the order of the font's lookups. Extension lookups are read through. A table
 * opentype.js did not parse as expected gives no ligatures rather than an error, so that the
 * glyphs keep the text the character map gives them.
 */
function ligaturesOf(font: Font): { glyph: number; components: number[] }[] {
  const ligatures: { glyph: number; components: number[] }[] = [];
  try {
    const gsub = font.tables.gsub as unknown as Gsub | undefined;
    if (!isObject(gsub) || !Array.isArray(gsub.features) || !Array.isArray(gsub.lookups)) return [];
    const indexes = new Set<number>();
    for (const { tag, feature } of gsub.features)
      if (tag === "liga") for (const index of feature.lookupListIndexes) indexes.add(index);
    for (const index of [...indexes].sort((a, b) => a - b)) {
      const lookup = gsub.lookups[index];
      for (const subtable of lookup?.subtables ?? []) {
        if (!isObject(subtable)) continue;
        const extended = lookup?.lookupType === EXTENSION;
        const type = extended ? subtable.lookupType : lookup?.lookupType;
        const table = (extended ? subtable.extension : subtable) as LigatureSubtable | undefined;
        if (type !== LIGATURE || !isObject(table) || !Array.isArray(table.ligatureSets)) continue;
        const firsts = coverageGlyphs(table.coverage);
        table.ligatureSets.forEach((set, i) => {
          const first = firsts[i];
          if (first === undefined || !Array.isArray(set)) return;
          for (const { ligGlyph, components } of set)
            ligatures.push({ glyph: ligGlyph, components: [first, ...components] });
        });
      }
    }
  } catch {
    return [];
  }
  return ligatures;
}

/**
 * Each glyph's text: the character map's lowest character for it, then the `liga` ligatures'
 * components, a pass for each level a ligature may be made of others, up to `LIGATURE_DEPTH`. A
 * ligature takes its components' text when it has none, or when the character map reaches it only
 * through a character that decomposes to that text, as U+FB01 ﬁ decomposes to fi.
 */
function textsOf(font: Font, cmap: Readonly<Record<number, number>>): Map<number, string> {
  const lowest = new Map<number, number>();
  for (const [code, glyph] of Object.entries(cmap)) {
    const point = Number(code);
    const had = lowest.get(glyph);
    if (glyph > 0 && (had === undefined || point < had)) lowest.set(glyph, point);
  }
  const texts = new Map([...lowest].map(([glyph, point]) => [glyph, String.fromCodePoint(point)]));
  const ligatures = ligaturesOf(font);
  for (let pass = 0; pass < LIGATURE_DEPTH; pass++) {
    let changed = false;
    for (const { glyph, components } of ligatures) {
      const parts = components.map((component) => texts.get(component));
      if (parts.some((part) => part === undefined)) continue;
      const joined = parts.join("");
      const had = texts.get(glyph);
      if (had === joined) continue;
      if (had === undefined || had.normalize("NFKD") === joined) {
        texts.set(glyph, joined);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return texts;
}

/** A copy of the bytes in a buffer of their own, which opentype.js reads from its start. */
const bufferOf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/**
 * Read a native font file. Throws for a file past the bounds, one opentype.js cannot parse, and
 * one with no usable em; a glyph the file cannot deliver is left out when it is asked for.
 */
export function parseNativeFont(bytes: Uint8Array): NativeFontFile {
  if (bytes.byteLength > MAX_FONT_BYTES)
    throw new Error(`the font file is ${bytes.byteLength} bytes, more than ${MAX_FONT_BYTES}`);
  const font = parse(bufferOf(bytes));
  const count = font.numGlyphs ?? font.glyphs.length;
  if (count > MAX_GLYPHS) throw new Error(`the font has ${count} glyphs, more than ${MAX_GLYPHS}`);
  const { unitsPerEm } = font;
  if (!Number.isFinite(unitsPerEm) || unitsPerEm <= 0)
    throw new Error(`the font has ${unitsPerEm} units per em`);
  const cmap = font.tables.cmap?.glyphIndexMap;
  const map: Readonly<Record<number, number>> = isObject(cmap)
    ? (cmap as Record<number, number>)
    : {};
  const known = (glyph: number) => Number.isInteger(glyph) && glyph >= 0 && glyph < count;
  const glyphFor = (char: string) => {
    const point = char.codePointAt(0);
    // One character, which may be two UTF-16 code units.
    const one = point !== undefined && String.fromCodePoint(point) === char;
    const glyph = one ? map[point] : undefined;
    return glyph !== undefined && glyph > 0 && known(glyph) ? glyph : undefined;
  };
  const advanceOf = (glyph: number) => {
    if (!known(glyph)) return undefined;
    const advance = font.glyphs.get(glyph)?.advanceWidth;
    return typeof advance === "number" && Number.isFinite(advance) ? advance : undefined;
  };
  const outlines = new Map<number, { d: string; box: NativeBox } | undefined>();
  const outline = (glyph: number) => {
    if (!outlines.has(glyph)) {
      let read: { d: string; box: NativeBox } | undefined;
      try {
        // Glyph outlines parse lazily, so a corrupt glyph surfaces here; it is left out.
        const path = known(glyph) ? font.glyphs.get(glyph)?.path : undefined;
        const d = path?.toPathData(2) ?? "";
        const box = path?.getBoundingBox();
        read =
          d !== "" && box && [box.x1, box.y1, box.x2, box.y2].every(Number.isFinite)
            ? { d, box: [box.x1, box.y1, box.x2, box.y2] }
            : undefined;
      } catch {
        read = undefined;
      }
      outlines.set(glyph, read);
    }
    return outlines.get(glyph);
  };
  let texts: Map<number, string> | undefined;
  const space = glyphFor(" ");
  const angle = Number(font.tables.post?.italicAngle ?? 0);
  const slant = Number.isFinite(angle) ? -Math.tan((angle * Math.PI) / 180) : 0;
  return {
    unitsPerEm,
    pathOf: (glyph) => outline(glyph)?.d,
    boxOf: (glyph) => outline(glyph)?.box,
    textOf: (glyph) => {
      texts ??= textsOf(font, map);
      return texts.get(glyph);
    },
    advanceOf,
    glyphFor,
    spaceAdvance: (space === undefined ? undefined : advanceOf(space)) ?? 0,
    slant: slant === 0 ? 0 : slant,
    // A font whose vertical metrics make no sense is laid out as the TeX fonts' web fonts are.
    ascent: Number.isFinite(font.ascender) ? font.ascender / unitsPerEm : 0.8,
    descent: Number.isFinite(font.descender) ? -font.descender / unitsPerEm : 0.2,
    bytes,
  };
}

/**
 * The file a native font of an XDV is, by its name: the last segment of the path XeTeX wrote,
 * which is where kpathsea found the file in the engine's tree, such as
 * `/texlive/texmf-dist/fonts/opentype/google/roboto/Roboto-Regular.otf`.
 */
export function nativeFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
