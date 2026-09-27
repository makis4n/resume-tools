/**
 * The tree's fonts by name, from the files themselves (decision 0023): `fetch-engine.ts` reads
 * every OpenType and TrueType file of the tree with opentype.js, the editor's own reader, and
 * writes what each file's tables say of it into the manifest (`TreeFont`), which the import
 * pipeline matches a font's name to as XeTeX's font manager does.
 *
 * The reader is given opentype.js's `parse`, so that this file imports nothing but types: Node runs
 * `fetch-engine.ts` by stripping its types, and loads opentype.js, a CommonJS module, only when a
 * build reads the fonts.
 */

// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { TreeFont } from "../src/engine/manifest.ts";

/** A name record as opentype.js parses one: its text by language. */
type NameRecord = Readonly<Record<string, string>>;

/** The parts of a font as opentype.js 2 parses one that the record is read from. */
export interface ParsedFont {
  names: Readonly<Record<string, unknown>>;
  tables: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>;
}

/** opentype.js's `parse`, with the option that leaves the glyphs unread. */
export type ParseFont = (buffer: ArrayBuffer, options?: { lowMemory?: boolean }) => ParsedFont;

/** Whether a path is one of the tree's OpenType or TrueType files, which the table records. */
export const isTreeFontPath = (path: string) =>
  /\/fonts\/(?:opentype|truetype)\/.*\.(?:otf|ttf)$/i.test(path);

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

/**
 * The names of the font's name table by opentype.js's key for them, in English, each once: a
 * Macintosh record's first, since XeTeX's font manager puts those first, then a Windows one's,
 * then Unicode's; a record with no English name gives its first language's.
 */
function namesOf(font: ParsedFont, key: string): string[] {
  const found: string[] = [];
  for (const platform of ["macintosh", "windows", "unicode"]) {
    const names = font.names[platform];
    const record = isObject(names) ? (names[key] as NameRecord | undefined) : undefined;
    if (!isObject(record)) continue;
    const text = record.en ?? Object.values(record).find((value) => typeof value === "string");
    const name = typeof text === "string" ? text.trim() : "";
    if (name !== "" && !found.includes(name)) found.push(name);
  }
  return found;
}

/** The tags a layout table's list names, each once, in the table's order. */
function tagsOf(table: unknown, list: "scripts" | "features"): string[] {
  const records = isObject(table) ? table[list] : undefined;
  if (!Array.isArray(records)) return [];
  const tags: string[] = [];
  for (const record of records) {
    const tag = isObject(record) ? record.tag : undefined;
    if (typeof tag === "string" && /^[\x20-\x7e]{4}$/.test(tag) && !tags.includes(tag))
      tags.push(tag);
  }
  return tags;
}

/**
 * What a font file's tables say of it (`TreeFont`), or undefined when opentype.js cannot parse it
 * or it names no family. Only the tables are read, not the glyphs.
 */
export function treeFontOf(bytes: Uint8Array, parse: ParseFont): TreeFont | undefined {
  let font: ParsedFont;
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    font = parse(buffer as ArrayBuffer, { lowMemory: true });
  } catch {
    return undefined;
  }
  const legacy = namesOf(font, "fontFamily");
  const [fontFamily] = legacy;
  if (fontFamily === undefined) return undefined;
  const subfamilies = namesOf(font, "fontSubfamily");
  const fontSubfamily = subfamilies[0] ?? "Regular";
  // XeTeX's font manager takes a font's typographic family and style names in place of the
  // four-style ones when it has any, and knows it by every full name.
  const preferred = namesOf(font, "preferredFamily");
  const families = preferred.length > 0 ? preferred : legacy;
  const preferredStyles = namesOf(font, "preferredSubfamily");
  const styles =
    preferredStyles.length > 0 ? preferredStyles : [fontSubfamily, ...subfamilies.slice(1)];
  const fullNames = namesOf(font, "fullName");
  const more = Object.fromEntries(
    (
      [
        ["family", families],
        ["style", styles],
        ["fontFamily", legacy],
        ["fullName", fullNames],
      ] as const
    ).flatMap(([key, names]) => (names.length > 1 ? [[key, names.slice(1)]] : [])),
  );
  const os2 = font.tables.os2;
  const head = font.tables.head;
  const post = font.tables.post;
  const number = (value: unknown, otherwise: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : otherwise;
  const selection = number(os2?.fsSelection, 0);
  const macStyle = number(head?.macStyle, 0);
  const angle = number(post?.italicAngle, 0);
  const slant = Math.trunc(1000 * Math.tan((-angle * Math.PI) / 180));
  const layout = [font.tables.gsub, font.tables.gpos];
  const once = (tags: string[]) => [...new Set(tags)];
  return {
    family: families[0] ?? fontFamily,
    style: styles[0] ?? fontSubfamily,
    fontFamily,
    fontSubfamily,
    fullName: fullNames[0] ?? fontFamily,
    postScriptName: namesOf(font, "postScriptName")[0] ?? "",
    ...(Object.keys(more).length > 0 ? { more } : {}),
    weight: number(os2?.usWeightClass, 400),
    width: number(os2?.usWidthClass, 5),
    ...((selection & 1) !== 0 || (macStyle & 2) !== 0 ? { italic: true as const } : {}),
    ...((selection & 32) !== 0 || (macStyle & 1) !== 0 ? { bold: true as const } : {}),
    ...((selection & 64) !== 0 ? { regular: true as const } : {}),
    ...(slant === 0 ? {} : { slant }),
    scripts: once(layout.flatMap((table) => tagsOf(table, "scripts"))),
    features: once(layout.flatMap((table) => tagsOf(table, "features"))),
  };
}

/**
 * The table of every OpenType and TrueType file among `files`, by path, in path order, each read
 * by `read`; a file that cannot be parsed, or names no family, is left out and named in `skipped`.
 */
export function treeFonts(
  files: Readonly<Record<string, number>>,
  read: (path: string) => Uint8Array,
  parse: ParseFont,
): { fonts: Record<string, TreeFont>; skipped: string[] } {
  const fonts: Record<string, TreeFont> = {};
  const skipped: string[] = [];
  for (const path of Object.keys(files).filter(isTreeFontPath).sort()) {
    const font = treeFontOf(read(path), parse);
    if (font) fonts[path] = font;
    else skipped.push(path);
  }
  return { fonts, skipped };
}
