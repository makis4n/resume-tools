/**
 * XeTeX's native fonts: the OpenType and TrueType files a XeTeX template sets its text in
 * directly, read in the browser through opentype.js (decision 0014). The XDV names the file and
 * gives each glyph by its index in it, so the page draws a glyph from the file's outline, hit-tests
 * it by the outline's box, and reads the character it stands for from the file's character map;
 * the overlay measures a character by its glyph's advance, and sets its rows in the file itself.
 *
 * A glyph's text is the character the character map gives it. A map may give one glyph several,
 * as Source Sans's gives its apostrophe U+2019 and U+02BC, and its hyphen U+002D, U+00AD, U+2010
 * and U+2011: the glyph then stands for each (`textsOf`), the one a field's text likelier holds
 * first (`likelihood`), and the aligner takes any of them. A ligature of the `liga` feature, such
 * as the `fi` XeTeX's shaping makes of an f and an i, reads as its components, and so does one of
 * the `ccmp` feature, which HarfBuzz applies unasked, as Source Sans's l·l for Catalan, or Roboto's
 * d and U+0323, which it sets where it has no ḍ: composed, as the generator keeps a text. So does
 * a ligature the character map reaches only through a character that stands for those letters, as
 * Roboto's `fi` is also U+FB01 ﬁ, which a resume's text never holds where the page shows the
 * ligature. A glyph that a single substitution of one of `SINGLE_FEATURES` makes, as `+smcp` makes a
 * small capital and `+pnum` a proportional figure, reads as the glyph it was substituted from, a chain
 * of them as its start (decision 0023), so that a position set in small capitals aligns with the
 * lower-case text a resume holds. A glyph reached none of these ways has no text.
 *
 * A file is read whole, so it is bounded as decision 0009 bounds a virtual font: a file of more
 * than 32 MB, or with more than 65,535 glyphs, is refused. Every file comes from the TeX Live tree,
 * whose largest, Lato's, are under 1 MB.
 */

import { type Font, parse } from "opentype.js";
import { INVISIBLE } from "../tex/fields";
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
  /**
   * The character or characters the glyph stands for, or undefined when nothing says: the first
   * of `textsOf`.
   */
  textOf: (glyph: number) => string | undefined;
  /**
   * Every text the glyph stands for, the one a field's text likelier holds first: each character
   * the character map gives it (`likelihood`), or a ligature's components. Empty when nothing
   * says.
   */
  textsOf: (glyph: number) => readonly string[];
  /** The glyph's advance in font units, or undefined past the file's glyphs. */
  advanceOf: (glyph: number) => number | undefined;
  /** The glyph the character map gives a character, or undefined when it gives none. */
  glyphFor: (char: string) => number | undefined;
  /**
   * The features of `SINGLE_FEATURES` whose single substitutions make the glyph, in their order; empty
   * for a glyph none makes, which the overlay asks its browser for (decision 0023).
   */
  madeBy: (glyph: number) => readonly string[];
  /**
   * The glyph the single substitutions of `features` among `SINGLE_FEATURES` make of a glyph, in the
   * order of the font's lookups, as XeTeX's shaping applies them: the glyph itself when none does.
   */
  substitute: (glyph: number, features: readonly string[]) => number;
  /**
   * Whether XeTeX can set a character in the font rather than its `.notdef`, as HarfBuzz's
   * normalisation sets it: the character map gives it a glyph, or it decomposes to a character the
   * font covers and a mark the map gives a glyph, which HarfBuzz sets in its place, as Roboto sets
   * ṛ as r and U+0323; or it is U+2011, which HarfBuzz sets as U+2010 where the font lacks it.
   */
  covers: (char: string) => boolean;
  /**
   * Whether text is set in the font: its map gives a glyph to a character past ASCII outside the
   * Private Use Area. An icon font does not, as Font Awesome's map gives only its icons, in the
   * Private Use Area, and ASCII.
   */
  setsText: boolean;
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

/** A language system of a GSUB table's script, as opentype.js parses one: the features it takes. */
interface LangSys {
  reqFeatureIndex?: number;
  featureIndexes?: number[];
}

/** The parts of a GSUB table as opentype.js parses one that the substitutions are read from. */
interface Gsub {
  scripts?: { tag: string; script?: { defaultLangSys?: LangSys } }[];
  features: { tag: string; feature: { lookupListIndexes: number[] } }[];
  lookups: { lookupType: number; subtables: unknown[] }[];
}

/**
 * The features XeTeX's shaping takes from a GSUB table, by their index in its feature list: those
 * of the default language system of the Latin script, which fontspec asks for where a font has it,
 * or else of the default script; undefined for a table with neither, whose every feature is taken.
 */
function shapedFeatures(gsub: Gsub): Set<number> | undefined {
  const scripts = Array.isArray(gsub.scripts) ? gsub.scripts : [];
  const system = (tag: string) => scripts.find((each) => each?.tag === tag)?.script?.defaultLangSys;
  const chosen = system("latn") ?? system("DFLT");
  if (!isObject(chosen)) return undefined;
  const indexes = new Set(Array.isArray(chosen.featureIndexes) ? chosen.featureIndexes : []);
  if (typeof chosen.reqFeatureIndex === "number" && chosen.reqFeatureIndex !== 0xffff)
    indexes.add(chosen.reqFeatureIndex);
  return indexes;
}

/** The lookup types of a single and a ligature substitution, and of an extension that wraps one. */
const SINGLE = 1;
const LIGATURE = 4;
const EXTENSION = 7;

/** A single substitution subtable, lookup type 1, as opentype.js parses one. */
interface SingleSubtable {
  substFormat?: number;
  coverage: Coverage;
  deltaGlyphId?: number;
  substitute?: number[];
}

/**
 * The features whose single substitutions a glyph reads through as the glyph it replaces (decision
 * 0023): small capitals of lower case and of capitals, the figures' widths and styles, capitals'
 * forms of punctuation, superiors and inferiors, and fractions' figures.
 */
export const SINGLE_FEATURES = [
  "smcp",
  "c2sc",
  "pnum",
  "lnum",
  "onum",
  "tnum",
  "case",
  "sups",
  "subs",
  "frac",
] as const;

/**
 * The features of `SINGLE_FEATURES` a XeTeX features string turns on, in that order: `+smcp`, or
 * `smcp` as HarfBuzz reads a bare tag, turns one on, `-smcp` or `+smcp=0` off, and the last of a
 * feature's wins, as a shape's features come after its family's (`shapeFeatures`).
 */
export function singleFeaturesOn(features: string | undefined): string[] {
  const on = new Map<string, boolean>();
  for (const part of (features ?? "").split(";")) {
    const found = /^([+-])([A-Za-z0-9]{4})(?:=(\d+))?$/.exec(part.trim());
    if (found) on.set(found[2] ?? "", found[1] !== "-" && Number(found[3] ?? "1") !== 0);
  }
  return SINGLE_FEATURES.filter((tag) => on.get(tag) === true);
}

/**
 * One single substitution: the feature and lookup it is of, the glyph it makes of another, and
 * whether XeTeX's shaping applies it (`shapedFeatures`), which a language's lookup it does not.
 */
interface Single {
  feature: string;
  lookup: number;
  from: number;
  to: number;
  shaped: boolean;
}

/**
 * The single substitutions of `SINGLE_FEATURES`, in every script, lookup type 1 and extension lookups
 * wrapping it, each glyph of each subtable's coverage with the glyph it becomes, in the features'
 * order and then the lookups'. A table opentype.js did not parse as expected gives none rather than
 * an error, so that the glyphs keep the text the character map gives them.
 */
function singlesOf(font: Font): Single[] {
  const singles: Single[] = [];
  try {
    const gsub = font.tables.gsub as unknown as Gsub | undefined;
    if (!isObject(gsub) || !Array.isArray(gsub.features) || !Array.isArray(gsub.lookups)) return [];
    const shapedIndexes = shapedFeatures(gsub);
    for (const tag of SINGLE_FEATURES) {
      const indexes = new Set<number>();
      const shaped = new Set<number>();
      gsub.features.forEach(({ tag: each, feature }, i) => {
        if (each !== tag) return;
        for (const index of feature.lookupListIndexes) {
          indexes.add(index);
          if (shapedIndexes === undefined || shapedIndexes.has(i)) shaped.add(index);
        }
      });
      for (const index of [...indexes].sort((a, b) => a - b)) {
        const lookup = gsub.lookups[index];
        for (const subtable of lookup?.subtables ?? []) {
          if (!isObject(subtable)) continue;
          const extended = lookup?.lookupType === EXTENSION;
          const type = extended ? subtable.lookupType : lookup?.lookupType;
          const table = (extended ? subtable.extension : subtable) as SingleSubtable | undefined;
          if (type !== SINGLE || !isObject(table) || !isObject(table.coverage)) continue;
          coverageGlyphs(table.coverage).forEach((from, i) => {
            const to =
              table.substFormat === 1
                ? (from + (table.deltaGlyphId ?? 0)) & 0xffff
                : table.substitute?.[i];
            if (typeof to === "number" && to !== from)
              singles.push({ feature: tag, lookup: index, from, to, shaped: shaped.has(index) });
          });
        }
      }
    }
  } catch {
    return [];
  }
  return singles;
}

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
 * The features whose ligatures read as their components: `liga`, which XeTeX's shaping applies,
 * and `ccmp`, which HarfBuzz applies to every run, composing a letter and its marks.
 */
const LIGATURE_FEATURES = new Set(["ccmp", "liga"]);

/**
 * The ligatures of a font's `liga` and `ccmp` features, in every script, each as its glyph and
 * the glyphs it is made of, in the order of the font's lookups. Extension lookups are read through.
 * A table opentype.js did not parse as expected gives no ligatures rather than an error, so that
 * the glyphs keep the text the character map gives them.
 */
function ligaturesOf(font: Font): { glyph: number; components: number[] }[] {
  const ligatures: { glyph: number; components: number[] }[] = [];
  try {
    const gsub = font.tables.gsub as unknown as Gsub | undefined;
    if (!isObject(gsub) || !Array.isArray(gsub.features) || !Array.isArray(gsub.lookups)) return [];
    const indexes = new Set<number>();
    for (const { tag, feature } of gsub.features)
      if (LIGATURE_FEATURES.has(tag))
        for (const index of feature.lookupListIndexes) indexes.add(index);
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

/** One of what the generator leaves out of a text: a control, a format character and the like. */
const LEFT_OUT = new RegExp(INVISIBLE.source, "u");

/**
 * How unlikely a field's text is to hold a character, among those the character map gives one
 * glyph: 0 for ASCII, which the ASCII hyphen of Source Sans's four is; 1 for any other, as U+2019
 * ’ and the micro sign, which a keyboard types; 2 for a spacing modifier letter, as U+02BC ʼ, which
 * a text holds rarely beside U+2019; and 3 for what the generator's text never holds: a character
 * composition replaces, as it replaces the ohm sign with Omega, since the text is composed, or one
 * it leaves out, as the soft hyphen. Characters equally likely go lowest first.
 */
function likelihood(point: number): number {
  const char = String.fromCodePoint(point);
  if (char.normalize("NFC") !== char || LEFT_OUT.test(char)) return 3;
  if (point < 0x80) return 0;
  return point >= 0x2b0 && point <= 0x2ff ? 2 : 1;
}

/**
 * Each glyph's texts: every character the character map gives it, the likeliest first, then the
 * ligatures' components (`ligaturesOf`), a pass for each level a ligature may be made of others,
 * up to `LIGATURE_DEPTH`, each component read as its first text and the whole composed (NFC), as
 * d and U+0323 compose to ḍ. A ligature takes its components' text first when it has none, or when
 * the character map reaches it only through a character that decomposes to that text, as U+FB01
 * ﬁ decomposes to fi and Roboto's À, which its `ccmp` makes of A and U+0300, to them.
 */
function glyphTexts(
  font: Font,
  cmap: Readonly<Record<number, number>>,
  singles: readonly Single[],
): Map<number, string[]> {
  const points = new Map<number, number[]>();
  for (const [code, glyph] of Object.entries(cmap)) {
    if (!(glyph > 0)) continue;
    const had = points.get(glyph);
    if (had) had.push(Number(code));
    else points.set(glyph, [Number(code)]);
  }
  const texts = new Map<number, string[]>();
  for (const [glyph, codes] of points) {
    codes.sort((a, b) => likelihood(a) - likelihood(b) || a - b);
    texts.set(
      glyph,
      codes.map((point) => String.fromCodePoint(point)),
    );
  }
  const ligatures = ligaturesOf(font);
  for (let pass = 0; pass < LIGATURE_DEPTH; pass++) {
    let changed = false;
    for (const { glyph, components } of ligatures) {
      const parts = components.map((component) => texts.get(component)?.[0]);
      if (parts.some((part) => part === undefined)) continue;
      const joined = parts.join("").normalize("NFC");
      const mapped = texts.get(glyph) ?? [];
      const had = mapped[0];
      if (had === joined) continue;
      if (had === undefined || had.normalize("NFKD") === joined.normalize("NFKD")) {
        // What the map gives it stays, after the letters, for a text that holds U+FB01 itself.
        texts.set(glyph, [joined, ...mapped.filter((text) => text !== joined)]);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // A glyph a single substitution makes reads as the glyph it replaces, ahead of what the character
  // map gives it: a chain of substitutions as its start, where the glyph a step replaces has no
  // text of its own.
  const sources = new Map<number, number[]>();
  for (const { from, to } of singles) {
    const had = sources.get(to);
    if (had === undefined) sources.set(to, [from]);
    else if (!had.includes(from)) had.push(from);
  }
  const own = new Map(texts);
  const through = (glyph: number, depth: number, seen: Set<number>): string[] => {
    const mine = own.get(glyph) ?? [];
    if (mine.length > 0 || depth >= LIGATURE_DEPTH || seen.has(glyph)) return mine;
    seen.add(glyph);
    return (sources.get(glyph) ?? []).flatMap((from) => through(from, depth + 1, seen));
  };
  for (const [glyph, froms] of sources) {
    const read = froms.flatMap((from) => through(from, 1, new Set([glyph])));
    if (read.length === 0) continue;
    texts.set(glyph, [...new Set([...read, ...(own.get(glyph) ?? [])])]);
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
  let singles: Single[] | undefined;
  const singlesRead = () => {
    singles ??= singlesOf(font);
    return singles;
  };
  let texts: Map<number, string[]> | undefined;
  const textsOf = (glyph: number): readonly string[] => {
    texts ??= glyphTexts(font, map, singlesRead());
    return texts.get(glyph) ?? [];
  };
  let makers: Map<number, string[]> | undefined;
  const madeBy = (glyph: number): readonly string[] => {
    if (makers === undefined) {
      makers = new Map();
      for (const { feature, to } of singlesRead()) {
        const had = makers.get(to);
        if (had === undefined) makers.set(to, [feature]);
        else if (!had.includes(feature)) had.push(feature);
      }
    }
    return makers.get(glyph) ?? [];
  };
  // The lookups XeTeX's shaping applies, in their order, each with the features that apply it and
  // the glyph it makes of each it covers: its first subtable's that covers the glyph.
  let lookups: { features: Set<string>; made: Map<number, number> }[] | undefined;
  const substitute = (glyph: number, features: readonly string[]): number => {
    if (lookups === undefined) {
      const byIndex = new Map<number, { features: Set<string>; made: Map<number, number> }>();
      for (const { feature, lookup, from, to, shaped } of singlesRead()) {
        if (!shaped) continue;
        let entry = byIndex.get(lookup);
        if (entry === undefined) {
          entry = { features: new Set(), made: new Map() };
          byIndex.set(lookup, entry);
        }
        entry.features.add(feature);
        if (!entry.made.has(from)) entry.made.set(from, to);
      }
      lookups = [...byIndex].sort(([a], [b]) => a - b).map(([, entry]) => entry);
    }
    let out = glyph;
    // Each lookup replaces the glyph once, and the next sees what it made.
    for (const { features: of, made } of lookups)
      if (features.some((feature) => of.has(feature))) out = made.get(out) ?? out;
    return out;
  };
  const privateUse = (point: number) => (point >= 0xe000 && point <= 0xf8ff) || point >= 0xf0000;
  const setsText = Object.keys(map).some(
    (code) => Number(code) >= 0x80 && !privateUse(Number(code)),
  );
  const covers = (char: string): boolean => {
    if (glyphFor(char) !== undefined) return true;
    if (char === "\u{2011}") return glyphFor("\u{2010}") !== undefined;
    // HarfBuzz takes a canonical decomposition a pair at a time: the last mark, and what the rest
    // composes to, which it may decompose in turn. A singleton, such as the ohm sign's Omega, is
    // a pair with no mark.
    const parts = [...char.normalize("NFD")];
    const last = parts.pop();
    if (last === undefined || last === char) return false;
    if (parts.length === 0) return covers(last);
    return glyphFor(last) !== undefined && [...parts.join("").normalize("NFC")].every(covers);
  };
  const space = glyphFor(" ");
  const angle = Number(font.tables.post?.italicAngle ?? 0);
  const slant = Number.isFinite(angle) ? -Math.tan((angle * Math.PI) / 180) : 0;
  return {
    unitsPerEm,
    pathOf: (glyph) => outline(glyph)?.d,
    boxOf: (glyph) => outline(glyph)?.box,
    textOf: (glyph) => textsOf(glyph)[0],
    textsOf,
    advanceOf,
    glyphFor,
    madeBy,
    substitute,
    covers,
    setsText,
    spaceAdvance: (space === undefined ? undefined : advanceOf(space)) ?? 0,
    slant: slant === 0 ? 0 : slant,
    // A font whose vertical metrics make no sense is laid out as the TeX fonts' web fonts are.
    ascent: Number.isFinite(font.ascender) ? font.ascender / unitsPerEm : 0.8,
    descent: Number.isFinite(font.descender) ? -font.descender / unitsPerEm : 0.2,
    bytes,
  };
}

/**
 * What a XeTeX package's fonts can set wherever its template sets a text (decision 0014): a
 * character every text font among `files` covers (`NativeFontFile.covers`), since the generator
 * cannot tell which family a template sets a text in, and XeTeX sets a font's `.notdef` box for a
 * character that font lacks, though another has it: Source Sans Pro has an arrow, and Roboto does
 * not. `files` are those of its `fonts` section that loaded: one that did not takes no part, so
 * that a failed fetch of a shape no text uses leaves nothing out (`FontLibrary.coverage`). An
 * icon font such as Font Awesome is no text font (`NativeFontFile.setsText`), and with no text
 * font among them, nothing is left out and everything is XeTeX's to set.
 */
export function nativeCoverage(files: readonly NativeFontFile[]): (char: string) => boolean {
  const texts = files.filter((file) => file.setsText);
  if (texts.length === 0) return () => true;
  return (char) => texts.every((file) => file.covers(char));
}

/**
 * The file a native font of an XDV is, by its name: the last segment of the path XeTeX wrote,
 * which is where kpathsea found the file in the engine's tree, such as
 * `/texlive/texmf-dist/fonts/opentype/google/roboto/Roboto-Regular.otf`.
 */
export function nativeFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
