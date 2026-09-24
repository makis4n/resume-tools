/**
 * Font map files (`pdftex.map` and the `.map` files packages ship), which say for each TeX font
 * which Type 1 file holds its outlines and how to re-encode, slant or stretch them. The DVI names
 * only the TeX font; the map is how the page finds what to draw.
 */

export interface FontMapEntry {
  /** The TeX font name the DVI uses, such as `cmr10`. */
  tfm: string;
  /** The font's PostScript name, such as `CMR10`. */
  psName?: string;
  /** The outline file, such as `cmr10.pfb`, when the map names one. */
  fontFile?: string;
  /** The encoding vector file, such as `8r.enc`, when the font is re-encoded. */
  encodingFile?: string;
  /** Horizontal slant applied to the outlines, from `SlantFont`. */
  slant?: number;
  /** Horizontal stretch applied to the outlines, from `ExtendFont`. */
  extend?: number;
}

/** Split a map line into words, keeping a double-quoted string as one word with its quotes. */
function words(line: string): string[] {
  const out: string[] = [];
  const pattern = /"[^"]*"?|\S+/g;
  for (const match of line.matchAll(pattern)) out.push(match[0]);
  return out;
}

/** Parse one map line, or return undefined for a comment, a blank line or a malformed line. */
export function parseMapLine(line: string): FontMapEntry | undefined {
  const trimmed = line.trim();
  if (!trimmed || "%#;*".includes(trimmed[0] as string)) return undefined;
  const [tfm, ...rest] = words(trimmed);
  if (!tfm || tfm.startsWith("<") || tfm.startsWith('"')) return undefined;
  const entry: FontMapEntry = { tfm };
  for (const word of rest) {
    if (word.startsWith('"')) {
      // PostScript instructions: "<number> SlantFont", "<number> ExtendFont", "... ReEncodeFont".
      const tokens = word.replace(/"/g, " ").trim().split(/\s+/);
      tokens.forEach((token, i) => {
        const value = Number(tokens[i - 1]);
        if (token === "SlantFont" && Number.isFinite(value)) entry.slant = value;
        if (token === "ExtendFont" && Number.isFinite(value)) entry.extend = value;
      });
    } else if (word.startsWith("<")) {
      // "<file", "<<file" (embed all of it) or "<[file" (an encoding); ".enc" is an encoding.
      const file = word.replace(/^<[<[]?/, "");
      if (!file) continue;
      if (word.startsWith("<[") || file.toLowerCase().endsWith(".enc")) entry.encodingFile = file;
      else entry.fontFile = file;
    } else if (entry.psName === undefined && !/^\d+$/.test(word)) {
      entry.psName = word;
    }
  }
  return entry;
}

/**
 * Read map files into one table. Earlier maps win for a font they both list, as they would if
 * the later map were added to `pdftex.map` by updmap without replacing entries.
 */
export function parseFontMaps(...maps: string[]): Map<string, FontMapEntry> {
  const table = new Map<string, FontMapEntry>();
  for (const map of maps) {
    for (const line of map.split(/\r?\n/)) {
      const entry = parseMapLine(line);
      if (entry && !table.has(entry.tfm)) table.set(entry.tfm, entry);
    }
  }
  return table;
}
