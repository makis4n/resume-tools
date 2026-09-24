/**
 * The fonts a page needs, from the TeX Live tree: each TeX font's metrics from its TFM, and its
 * outlines from the Type 1 file the font map names. Loads are shared and kept for the session.
 *
 * Only fonts drawn as the map says are given outlines. A font the map re-encodes, slants or
 * stretches is reported without them until the renderer applies those (milestone 2, item 16),
 * so a glyph is either drawn right or left out and counted, never drawn as the wrong glyph.
 */

import type { FontOutlines } from "../tex/glyphs";
import { parseTfm, type Tfm } from "../tex/tfm";
import { parseType1 } from "../tex/type1";
import { type FontMapEntry, parseFontMaps } from "./fontmap";
import type { TexLiveIndex } from "./texlive";

/** Reads a TeX Live file by its path in the engine's file system. */
export type ReadFile = (path: string) => Promise<Uint8Array>;

export interface PageFont {
  name: string;
  tfm: Tfm;
  /** Outlines, or undefined when they cannot be drawn faithfully yet; see `missing`. */
  outlines?: FontOutlines;
  /** Why there are no outlines, for the harness and the console. */
  missing?: string;
}

export class FontLibrary {
  private map: Promise<Map<string, FontMapEntry>> | undefined;
  private readonly fonts = new Map<string, Promise<PageFont | undefined>>();

  constructor(
    private readonly index: TexLiveIndex,
    private readonly read: ReadFile,
  ) {}

  /** The TeX font `name`, or undefined when TeX Live has no TFM by that name. */
  load(name: string): Promise<PageFont | undefined> {
    let loading = this.fonts.get(name);
    if (!loading) {
      loading = this.loadNow(name);
      this.fonts.set(name, loading);
    }
    return loading;
  }

  private fontMap(): Promise<Map<string, FontMapEntry>> {
    this.map ??= (async () => {
      const path = this.index.find("map", "pdftex.map");
      if (!path) throw new Error("the TeX Live tree has no pdftex.map");
      return parseFontMaps(new TextDecoder().decode(await this.read(path)));
    })();
    return this.map;
  }

  private async loadNow(name: string): Promise<PageFont | undefined> {
    const tfmPath = this.index.find("tfm", `${name}.tfm`);
    if (!tfmPath) return undefined;
    const tfm = parseTfm(await this.read(tfmPath));
    const entry = (await this.fontMap()).get(name);
    if (!entry?.fontFile) return { name, tfm, missing: "no font map entry names an outline file" };
    if (entry.encodingFile || entry.slant !== undefined || entry.extend !== undefined)
      return { name, tfm, missing: "re-encoded, slanted or stretched fonts are not drawn yet" };
    const type1Path = this.index.find("type1", entry.fontFile);
    if (!type1Path) return { name, tfm, missing: `TeX Live has no ${entry.fontFile}` };
    return { name, tfm, outlines: parseType1(await this.read(type1Path)) };
  }
}
