/**
 * A parser for DVI files, and for the XDV dialect XeTeX writes.
 *
 * The output is a flat list of positioned items per page, in stream order, with
 * every position in scaled points (2^-16 pt) measured from the DVI origin, which
 * sits one inch in from the top-left corner of the page. Stream order matters: the
 * glyphs between two marker specials are the glyphs of that field.
 *
 * Every position is where the PDF puts the item: xdvipdfmx moves, turns and scales what it sets
 * inside a `pdf:btrans` and after an `x:scale` or `x:rotate`, as a TikZ node's text is set, and
 * the parser applies the same (`GraphicsState`, decision 0081), so that whatever reads its output,
 * the page, the glyphs' boxes, the reference's stream and the checks, reads the PDF's positions. An
 * item set inside one says so (`transform`), with the matrix's linear part where it turns or
 * scales, which the page draws its glyph with.
 */

import { type ItemTransform, placeItems } from "./transforms";

export interface DviFont {
  id: number;
  name: string;
  checksum: number;
  /** Size the font is used at, in scaled points. */
  scale: number;
  /** Design size, in scaled points. */
  design: number;
}

export interface NativeFont {
  id: number;
  /** File name, as XeTeX wrote it. */
  name: string;
  /** Face index inside the file. */
  index: number;
  /** Size in scaled points. */
  size: number;
  flags: number;
  /** Packed as (r << 24) | (g << 16) | (b << 8) | a. */
  rgba?: number;
  /** 16.16 fixed values as XeTeX wrote them: 65536 is 1.0. */
  extend?: number;
  slant?: number;
  embolden?: number;
}

/**
 * One thing a page sets. `transform` is there for an item set inside a transformation xdvipdfmx
 * applies (`ItemTransform`): its `h` and `v`, and a native run's glyphs' offsets, are then
 * already where the PDF puts them.
 */
export type PageItem =
  | {
      kind: "glyph";
      font: number;
      code: number;
      h: number;
      v: number;
      width: number;
      transform?: ItemTransform;
    }
  | {
      kind: "native";
      font: number;
      h: number;
      v: number;
      width: number;
      glyphs: { id: number; x: number; y: number }[];
      text?: string;
      transform?: ItemTransform;
    }
  | {
      kind: "rule";
      h: number;
      v: number;
      width: number;
      height: number;
      transform?: ItemTransform;
    }
  | { kind: "special"; h: number; v: number; text: string; transform?: ItemTransform };

export interface DviPage {
  counters: number[];
  items: PageItem[];
}

export interface DviDocument {
  /** 2 for DVI, 7 for XDV. */
  id: number;
  numerator: number;
  denominator: number;
  magnification: number;
  comment: string;
  fonts: Map<number, DviFont>;
  nativeFonts: Map<number, NativeFont>;
  pages: DviPage[];
}

/** Supplies character widths, in scaled points, for a font at its used size. */
export type WidthProvider = (font: DviFont) => Int32Array | undefined;

/** Bytes decoded per call of `String.fromCharCode`, well within what a call may be passed. */
const LATIN1_CHUNK = 8192;

class Reader {
  pos = 0;
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get done(): boolean {
    return this.pos >= this.bytes.length;
  }
  u8(): number {
    const v = this.bytes[this.pos];
    if (v === undefined) throw new Error(`DVI ended early at byte ${this.pos}`);
    this.pos++;
    return v;
  }
  unsigned(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + this.u8();
    return v;
  }
  signed(n: number): number {
    const v = this.unsigned(n);
    const limit = 2 ** (8 * n - 1);
    return v >= limit ? v - 2 * limit : v;
  }
  fix32(): number {
    const v = this.view.getInt32(this.pos);
    this.pos += 4;
    return v;
  }
  bytes_(n: number): Uint8Array {
    const out = this.bytes.subarray(this.pos, this.pos + n);
    if (out.length !== n) throw new Error(`DVI ended early at byte ${this.pos}`);
    this.pos += n;
    return out;
  }
  /**
   * `n` bytes as ISO-8859-1, one character per byte. A special may be as long as pdfTeX's string
   * pool, megabytes, and spreading a byte per argument overflows the call stack at about 125,000,
   * so the string is built a chunk at a time. TextDecoder would not do: its `latin1` is
   * windows-1252, which reads bytes 0x80 to 0x9F as other characters.
   */
  latin1(n: number): string {
    const bytes = this.bytes_(n);
    let text = "";
    for (let at = 0; at < bytes.length; at += LATIN1_CHUNK)
      text += String.fromCharCode(...bytes.subarray(at, at + LATIN1_CHUNK));
    return text;
  }
  utf16(units: number): string {
    let s = "";
    for (let i = 0; i < units; i++) s += String.fromCharCode(this.unsigned(2));
    return s;
  }
}

const XDV_FLAG_COLORED = 0x0200;
const XDV_FLAG_EXTEND = 0x1000;
const XDV_FLAG_SLANT = 0x2000;
const XDV_FLAG_EMBOLDEN = 0x4000;

export function parseDvi(bytes: Uint8Array, widthsFor: WidthProvider): DviDocument {
  const r = new Reader(bytes);
  if (r.u8() !== 247) throw new Error("not a DVI file: missing preamble");
  const id = r.u8();
  const numerator = r.unsigned(4);
  const denominator = r.unsigned(4);
  const magnification = r.unsigned(4);
  const comment = r.latin1(r.u8());
  const doc: DviDocument = {
    id,
    numerator,
    denominator,
    magnification,
    comment,
    fonts: new Map(),
    nativeFonts: new Map(),
    pages: [],
  };

  const widths = new Map<number, Int32Array | undefined>();
  const widthOf = (font: number, code: number): number => {
    if (!widths.has(font)) {
      const def = doc.fonts.get(font);
      widths.set(font, def ? widthsFor(def) : undefined);
    }
    return widths.get(font)?.[code] ?? 0;
  };

  let page: DviPage | undefined;
  let h = 0;
  let v = 0;
  let w = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  let font = -1;
  const stack: number[][] = [];
  const emit = (item: PageItem) => {
    if (!page) throw new Error("DVI drawing command outside a page");
    page.items.push(item);
  };
  const setChar = (code: number, advance: boolean) => {
    const width = widthOf(font, code);
    emit({ kind: "glyph", font, code, h, v, width });
    if (advance) h += width;
  };
  const defineFont = (k: number) => {
    const checksum = r.unsigned(4);
    const scale = r.signed(4);
    const design = r.signed(4);
    const a = r.u8();
    const l = r.u8();
    const name = r.latin1(a + l);
    doc.fonts.set(k, { id: k, name, checksum, scale, design });
  };
  const readGlyphRun = (text?: string) => {
    const width = r.signed(4);
    const n = r.unsigned(2);
    const glyphs: { id: number; x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) glyphs.push({ id: 0, x: r.fix32(), y: r.fix32() });
    for (let i = 0; i < n; i++) {
      const g = glyphs[i];
      if (g) g.id = r.unsigned(2);
    }
    const item: PageItem = { kind: "native", font, h, v, width, glyphs };
    if (text !== undefined) item.text = text;
    emit(item);
    h += width;
  };

  while (!r.done) {
    const op = r.u8();
    if (op <= 127) {
      setChar(op, true);
    } else if (op >= 128 && op <= 131) {
      setChar(r.unsigned(op - 127), true);
    } else if (op === 132 || op === 137) {
      const height = r.signed(4);
      const width = r.signed(4);
      emit({ kind: "rule", h, v, width, height });
      if (op === 132) h += width;
    } else if (op >= 133 && op <= 136) {
      setChar(r.unsigned(op - 132), false);
    } else if (op === 138) {
      // nop
    } else if (op === 139) {
      const counters: number[] = [];
      for (let i = 0; i < 10; i++) counters.push(r.signed(4));
      r.signed(4); // pointer to the previous bop
      page = { counters, items: [] };
      doc.pages.push(page);
      h = v = w = x = y = z = 0;
      stack.length = 0;
    } else if (op === 140) {
      page = undefined;
    } else if (op === 141) {
      stack.push([h, v, w, x, y, z]);
    } else if (op === 142) {
      const top = stack.pop();
      if (!top) throw new Error("DVI stack underflow");
      [h, v, w, x, y, z] = top as [number, number, number, number, number, number];
    } else if (op >= 143 && op <= 146) {
      h += r.signed(op - 142);
    } else if (op === 147) {
      h += w;
    } else if (op >= 148 && op <= 151) {
      w = r.signed(op - 147);
      h += w;
    } else if (op === 152) {
      h += x;
    } else if (op >= 153 && op <= 156) {
      x = r.signed(op - 152);
      h += x;
    } else if (op >= 157 && op <= 160) {
      v += r.signed(op - 156);
    } else if (op === 161) {
      v += y;
    } else if (op >= 162 && op <= 165) {
      y = r.signed(op - 161);
      v += y;
    } else if (op === 166) {
      v += z;
    } else if (op >= 167 && op <= 170) {
      z = r.signed(op - 166);
      v += z;
    } else if (op >= 171 && op <= 234) {
      font = op - 171;
    } else if (op >= 235 && op <= 238) {
      font = r.unsigned(op - 234);
    } else if (op >= 239 && op <= 242) {
      const k = r.unsigned(op - 238);
      emit({ kind: "special", h, v, text: r.latin1(k) });
    } else if (op >= 243 && op <= 246) {
      defineFont(op === 246 ? r.signed(4) : r.unsigned(op - 242));
    } else if (op === 247) {
      throw new Error("DVI preamble found inside the file");
    } else if (op === 248) {
      // postamble: pointer, num, den, mag, max height, max width, stack depth, pages
      r.signed(4);
      r.unsigned(4);
      r.unsigned(4);
      r.unsigned(4);
      r.signed(4);
      r.signed(4);
      r.unsigned(2);
      r.unsigned(2);
    } else if (op === 249) {
      break;
    } else if (op === 250 || op === 251) {
      // XDV's begin_reflect and end_reflect, TeX--XeT's, which take nothing from the stream: so
      // the TeX Live 2023 xdvipdfmx reads them, checked, where 251 was once `pic_file`, a picture
      // placed from a file. XeTeX 2023 writes neither, and writes a picture as a `pdf:image`
      // special, so reading them as xdvipdfmx does keeps the page's reading of a stream and the
      // PDF step's the same, byte for byte (decision 0008).
    } else if (op === 252) {
      const k = r.signed(4);
      const size = r.signed(4);
      const flags = r.unsigned(2);
      const name = r.latin1(r.u8());
      const index = r.unsigned(4);
      const def: NativeFont = { id: k, name, index, size, flags };
      if (flags & XDV_FLAG_COLORED) def.rgba = r.unsigned(4);
      if (flags & XDV_FLAG_EXTEND) def.extend = r.fix32();
      if (flags & XDV_FLAG_SLANT) def.slant = r.fix32();
      if (flags & XDV_FLAG_EMBOLDEN) def.embolden = r.fix32();
      doc.nativeFonts.set(k, def);
    } else if (op === 253) {
      readGlyphRun();
    } else if (op === 254) {
      readGlyphRun(r.utf16(r.unsigned(2)));
    } else {
      throw new Error(`unknown DVI opcode ${op} at byte ${r.pos - 1}`);
    }
  }
  // Each page's items where the PDF puts them, a big point in DVI units being what a
  // transformation's offsets are given in.
  const unitsPerBp = 72.27 / 72 / pointsPerUnit(doc);
  for (const each of doc.pages) placeItems(each.items, unitsPerBp);
  return doc;
}

/** Points per scaled point for a document, taking its units and magnification into account. */
export function pointsPerUnit(doc: DviDocument): number {
  // A DVI unit is num/den * 1e-7 m; a point is 1/72.27 in = 0.0254/72.27 m.
  const metres = (doc.numerator / doc.denominator) * 1e-7;
  return (metres / (0.0254 / 72.27)) * (doc.magnification / 1000);
}
