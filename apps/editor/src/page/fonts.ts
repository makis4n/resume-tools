/**
 * The fonts a page needs, from the TeX Live tree: each TeX font's metrics from its TFM, and its
 * outlines as the font map and the tree say to draw them. Loads are shared and kept for the
 * session; one whose files cannot be read is dropped, so the next draw reads them again.
 *
 * A TeX font resolves to outlines in one of two ways (decision 0009). When its `pdftex.map` entry
 * names a Type 1 file, they are the file's, re-encoded when the entry names an encoding vector,
 * and slanted or stretched when it says so (`outlines.ts`). Otherwise, when it is a virtual font,
 * each character is its packet's characters composed into one glyph (`vf.ts`), from the fonts the
 * packets set, loaded the same way, virtual ones too. It is all done here, where a TeX font
 * becomes a `FontOutlines`, so that the renderer, the hit boxes, the field aligner and item 9's
 * web fonts see every font alike. Each glyph's text is read from its name through the Adobe Glyph
 * List (`glyphText`), since the fonts beyond Computer Modern name their glyphs Adobe's way.
 *
 * A font the page cannot draw never costs the page. Whatever goes wrong past its metrics, be it a
 * file the tree lacks, one that does not parse, a packet the expander refuses or a virtual font
 * that uses itself, leaves the font with `missing` saying why and no outlines, so that each of its
 * glyphs is left out and counted, never drawn as the wrong glyph. Only a read that fails is passed
 * on, since the file may be there next time. Nothing is logged here; the callers report.
 */

import { parseEncoding } from "../tex/enc";
import {
  accentMark,
  type FontOutlines,
  type GlyphOutline,
  glyphText,
  parseAgl,
} from "../tex/glyphs";
import { type Matrix, reencode, transform, transformBox, transformPath } from "../tex/outlines";
import { parseTfm, type Tfm } from "../tex/tfm";
import { parseType1 } from "../tex/type1";
import { expand, type Placement, parseVf } from "../tex/vf";
import { type FontMapEntry, parseFontMaps } from "./fontmap";
import type { TexLiveIndex } from "./texlive";

/** Reads a TeX Live file by its path in the engine's file system. */
export type ReadFile = (path: string) => Promise<Uint8Array>;

export interface PageFont {
  name: string;
  tfm: Tfm;
  /** Outlines, or undefined when they cannot be drawn faithfully; see `missing`. */
  outlines?: FontOutlines;
  /** Why there are no outlines, for the harness and the console. */
  missing?: string;
  /** The text the glyph a code draws stands for; undefined for a code the font does not draw. */
  text: (code: number) => string | undefined;
}

/** A fix_word's 1.0. */
const FIX = 2 ** 20;

/** Em units, 1000 to the size a font is used at, per 2^-20 of it, as a VF gives its lengths. */
const EM = 1000 / FIX;

/** The text of a font that draws nothing. */
const NO_TEXT = () => undefined;

/** A code's width in a TFM, as a fix_word relative to its design size, if the font has it. */
function widthOf(tfm: Tfm, code: number): number | undefined {
  const info = tfm.chars[code - tfm.bc];
  return info ? tfm.widths[info.width] : undefined;
}

/**
 * `start()`, shared by every caller asking for `key` until it fails, when the next caller starts
 * it again.
 */
function shared<T>(cache: Map<string, Promise<T>>, key: string, start: () => Promise<T>) {
  let loading = cache.get(key);
  if (!loading) {
    const started = start();
    started.catch(() => {
      if (cache.get(key) === started) cache.delete(key);
    });
    cache.set(key, started);
    loading = started;
  }
  return loading;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class FontLibrary {
  private map: Promise<Map<string, FontMapEntry>> | undefined;
  private agl: Promise<ReadonlyMap<string, string>> | undefined;
  private readonly fonts = new Map<string, Promise<PageFont | undefined>>();
  /**
   * Type 1 outlines by file, read and interpreted once for the fonts that share a file, as
   * `ec-lmr10` and `ts1-lmr10` share `lmr10.pfb`.
   */
  private readonly type1 = new Map<string, Promise<FontOutlines>>();
  private readonly encodings = new Map<string, Promise<string[]>>();
  /** What reads threw, which `load` passes on rather than take for a font it cannot draw. */
  private readonly failedReads = new WeakSet<object>();
  /** The fonts each virtual font waits for while it loads, so that a cycle is refused. */
  private readonly waiting = new Map<string, ReadonlySet<string>>();

  constructor(
    private readonly index: TexLiveIndex,
    private readonly read: ReadFile,
  ) {}

  /**
   * The TeX font `name`, or undefined when TeX Live has no TFM by that name. It rejects only when
   * a file cannot be read, or the TFM cannot be parsed, since a page needs a font's metrics; any
   * other fault leaves the font `missing`.
   */
  load(name: string): Promise<PageFont | undefined> {
    return shared(this.fonts, name, () => this.loadNow(name));
  }

  /** A file of the tree, marking a failure as a read's, which `load` passes on. */
  private async fetch(path: string): Promise<Uint8Array> {
    try {
      return await this.read(path);
    } catch (error) {
      const failure =
        typeof error === "object" && error !== null ? error : new Error(String(error));
      this.failedReads.add(failure);
      throw failure;
    }
  }

  private async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.fetch(path));
  }

  private fontMap(): Promise<Map<string, FontMapEntry>> {
    if (!this.map) {
      const started = (async () => {
        const path = this.index.find("map", "pdftex.map");
        if (!path) throw new Error("the TeX Live tree has no pdftex.map");
        return parseFontMaps(await this.readText(path));
      })();
      started.catch(() => {
        if (this.map === started) this.map = undefined;
      });
      this.map = started;
    }
    return this.map;
  }

  /** The Adobe Glyph List, read once; without one, glyphs are named by the rest of `glyphText`. */
  private glyphList(): Promise<ReadonlyMap<string, string>> {
    if (!this.agl) {
      const started = (async () => {
        const path = this.index.find("map", "glyphlist.txt");
        return path ? parseAgl(await this.readText(path)) : new Map<string, string>();
      })();
      started.catch(() => {
        if (this.agl === started) this.agl = undefined;
      });
      this.agl = started;
    }
    return this.agl;
  }

  private async loadNow(name: string): Promise<PageFont | undefined> {
    const tfmPath = this.index.find("tfm", `${name}.tfm`);
    if (!tfmPath) return undefined;
    const tfm = parseTfm(await this.fetch(tfmPath));
    try {
      const outlines = await this.outlinesOf(name, tfm);
      const agl = await this.glyphList();
      const texts = outlines.encoding.map((glyph) =>
        Object.hasOwn(outlines.glyphs, glyph) ? glyphText(glyph, agl) : undefined,
      );
      return { name, tfm, outlines, text: (code) => texts[code] };
    } catch (error) {
      if (this.failedReads.has(error as object)) throw error;
      return { name, tfm, missing: messageOf(error), text: NO_TEXT };
    }
  }

  /** The outlines of a font with metrics: as its map entry says, or as its virtual font says. */
  private async outlinesOf(name: string, tfm: Tfm): Promise<FontOutlines> {
    const entry = (await this.fontMap()).get(name);
    if (entry?.fontFile) return this.mapped(entry, entry.fontFile);
    const vf = this.index.find("vf", `${name}.vf`);
    if (vf) return this.virtual(name, tfm, vf);
    throw new Error("no font map entry names an outline file");
  }

  /** A Type 1 file's outlines, re-encoded, slanted and stretched as the map entry says. */
  private async mapped(entry: FontMapEntry, file: string): Promise<FontOutlines> {
    const path = this.index.find("type1", file);
    if (!path) throw new Error(`TeX Live has no ${file}`);
    let outlines = await shared(this.type1, path, async () => parseType1(await this.fetch(path)));
    const vector = entry.encodingFile;
    if (vector) {
      const vectorPath = this.index.find("enc", vector);
      if (!vectorPath) throw new Error(`TeX Live has no ${vector}`);
      const read = async () => parseEncoding(await this.readText(vectorPath));
      outlines = reencode(outlines, await shared(this.encodings, vectorPath, read));
    }
    return transform(outlines, { slant: entry.slant, extend: entry.extend });
  }

  /**
   * A virtual font's outlines: for each code its TFM has, the glyphs and rules its packet draws,
   * each part scaled by its font's scale and moved to where the packet puts it, as one glyph in
   * the virtual font's own em, with the TFM's advance and the parts' boxes together. Codes with
   * no packet, or one that sets a glyph its font lacks, have no outline.
   */
  private async virtual(name: string, tfm: Tfm, path: string): Promise<FontOutlines> {
    const vf = parseVf(await this.fetch(path));
    const codes: number[] = [];
    for (let code = tfm.bc; code <= tfm.ec; code++) if (tfm.chars[code - tfm.bc]) codes.push(code);
    // The fonts the packets set, found by running each once, before their widths are known.
    const used = new Set<string>();
    for (const code of codes)
      for (const part of expand(vf, code, () => 0) ?? [])
        if (!("rule" in part)) used.add(part.font);
    const locals = await this.locals(name, used);
    const localWidth = (font: string, code: number) => {
      const local = locals.get(font);
      return local && widthOf(local.tfm, code);
    };
    const glyphs: Record<string, GlyphOutline> = {};
    const encoding = Array.from({ length: 256 }, () => ".notdef");
    for (const code of codes) {
      const composed = compose(expand(vf, code, localWidth) ?? [], locals);
      if (!composed) continue;
      const glyph = { ...composed.glyph, w: (widthOf(tfm, code) ?? 0) * EM };
      // Two codes may place the same glyph differently, as a small-caps font scales its capitals
      // for the lowercase letters; the later one is named apart, and reads the same.
      const taken = Object.hasOwn(glyphs, composed.name) ? glyphs[composed.name] : undefined;
      const same = taken && taken.d === glyph.d && taken.w === glyph.w;
      const glyphName = !taken || same ? composed.name : `${composed.name}.${code}`;
      glyphs[glyphName] = glyph;
      encoding[code] = glyphName;
    }
    return { name, encoding, glyphs };
  }

  /**
   * The fonts a virtual font's packets set, each loaded as any font is, by name. One that is
   * waiting, itself or through others, for the virtual font would wait for ever, so it is refused;
   * and one that cannot be drawn leaves the virtual font undrawn, rather than drawn in part.
   */
  private async locals(name: string, used: ReadonlySet<string>): Promise<Map<string, PageFont>> {
    for (const local of used)
      if (this.leadsTo(local, name))
        throw new Error(`its virtual font sets ${local}, which leads back to ${name}`);
    this.waiting.set(name, used);
    try {
      const loaded = await Promise.all([...used].map((local) => this.load(local)));
      const locals = new Map<string, PageFont>();
      for (const [i, local] of [...used].entries()) {
        const font = loaded[i];
        if (!font) throw new Error(`its virtual font sets ${local}, which has no TFM`);
        if (!font.outlines)
          throw new Error(`its virtual font sets ${local}, which cannot be drawn: ${font.missing}`);
        locals.set(local, font);
      }
      return locals;
    } finally {
      this.waiting.delete(name);
    }
  }

  /** Whether `from` is `to`, or waits for it while it loads, directly or through other fonts. */
  private leadsTo(from: string, to: string, seen = new Set<string>()): boolean {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const next of this.waiting.get(from) ?? []) if (this.leadsTo(next, to, seen)) return true;
    return false;
  }
}

/** Unit square path data, which a rule's matrix stretches over the rule. */
const SQUARE = "M0 0L1 0L1 1L0 1Z";

type Box = [number, number, number, number];

/** The box that covers two boxes, either of which may be empty. */
const union = (a: Box | null, b: Box | null): Box | null =>
  a && b
    ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
    : (a ?? b);

/**
 * One virtual character from what its packet draws, with a name made of its parts' names: a
 * single glyph's own name, several joined by `+` with any accent after the rest (`A+breve`), and
 * `rule` for a rule, so that `glyphText` can read it. Undefined when the packet draws nothing, or
 * sets a glyph its font has no outline for.
 */
function compose(
  parts: readonly Placement[],
  locals: ReadonlyMap<string, PageFont>,
): { name: string; glyph: GlyphOutline } | undefined {
  if (parts.length === 0) return undefined;
  const paths: string[] = [];
  const names: string[] = [];
  const accents: string[] = [];
  let box: Box | null = null;
  for (const part of parts) {
    if ("rule" in part) {
      names.push("rule");
      // DVI draws no rule whose width or height is not positive.
      if (part.width <= 0 || part.height <= 0) continue;
      const m: Matrix = [part.width * EM, 0, 0, part.height * EM, part.h * EM, -part.v * EM];
      paths.push(transformPath(SQUARE, m));
      box = union(box, transformBox([0, 0, 1, 1], m));
      continue;
    }
    const outlines = locals.get(part.font)?.outlines;
    const glyphName = outlines?.encoding[part.code];
    if (!outlines || glyphName === undefined || !Object.hasOwn(outlines.glyphs, glyphName))
      return undefined;
    const glyph = outlines.glyphs[glyphName] as GlyphOutline;
    const s = part.scale / FIX;
    const m: Matrix = [s, 0, 0, s, part.h * EM, -part.v * EM];
    if (glyph.d) paths.push(transformPath(glyph.d, m));
    box = union(box, transformBox(glyph.b, m));
    (accentMark(glyphName) === undefined ? names : accents).push(glyphName);
  }
  return { name: [...names, ...accents].join("+"), glyph: { w: 0, d: paths.join(""), b: box } };
}
