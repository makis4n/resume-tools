/**
 * TeX font metric (TFM) files, and TeX's own arithmetic for scaling them.
 *
 * A DVI file advances the horizontal position by a character's width after each
 * `set_char`, and that width is not stored in the DVI: it comes from the TFM file,
 * scaled to the font size with the exact integer arithmetic of tex.web §571-572.
 * Reproducing that arithmetic here keeps our glyph positions identical to TeX's.
 */

export interface CharInfo {
  /** Indices into the width, height, depth and italic tables. */
  width: number;
  height: number;
  depth: number;
  italic: number;
  tag: number;
  remainder: number;
}

export interface Tfm {
  checksum: number;
  /** Design size in points. */
  designSize: number;
  /** First and last character codes. */
  bc: number;
  ec: number;
  /** Raw fix_word tables: signed 32-bit integers in units of 2^-20 design sizes. */
  widths: Int32Array;
  heights: Int32Array;
  depths: Int32Array;
  italics: Int32Array;
  /** Indexed by `code - bc`; `undefined` where the font has no such character. */
  chars: (CharInfo | undefined)[];
}

export interface ScaledMetrics {
  /** Per character code 0..255, in scaled points; 0 for missing characters. */
  widths: Int32Array;
  heights: Int32Array;
  depths: Int32Array;
}

export function parseTfm(bytes: Uint8Array): Tfm {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const half = (i: number) => view.getUint16(i * 2);
  const lf = half(0);
  const lh = half(1);
  const bc = half(2);
  const ec = half(3);
  const nw = half(4);
  const nh = half(5);
  const nd = half(6);
  const ni = half(7);
  if (lf * 4 !== bytes.byteLength) {
    throw new Error(
      `TFM length mismatch: header says ${lf * 4} bytes, file has ${bytes.byteLength}`,
    );
  }
  if (ec < bc - 1 || ec > 255) throw new Error(`TFM has an invalid character range ${bc}..${ec}`);
  const word = (i: number) => view.getInt32(i * 4);
  const checksum = view.getUint32(6 * 4);
  const designSize = word(7) / 2 ** 20;

  let at = 6 + lh;
  const chars: (CharInfo | undefined)[] = [];
  for (let code = bc; code <= ec; code++) {
    const w = view.getUint32(at * 4);
    const width = (w >>> 24) & 0xff;
    chars.push(
      width === 0
        ? undefined
        : {
            width,
            height: (w >>> 20) & 0xf,
            depth: (w >>> 16) & 0xf,
            italic: (w >>> 10) & 0x3f,
            tag: (w >>> 8) & 0x3,
            remainder: w & 0xff,
          },
    );
    at++;
  }
  const table = (n: number) => {
    const out = new Int32Array(n);
    for (let i = 0; i < n; i++) out[i] = word(at + i);
    at += n;
    return out;
  };
  const widths = table(nw);
  const heights = table(nh);
  const depths = table(nd);
  const italics = table(ni);
  return { checksum, designSize, bc, ec, widths, heights, depths, italics, chars };
}

/**
 * tex.web §572 `store_scaled`: multiply a fix_word by the font size `z` (in scaled
 * points) with TeX's truncating integer arithmetic.
 */
export function scaleFixWord(fix: number, z: number): number {
  let alpha = 16;
  let zz = z;
  while (zz >= 2 ** 23) {
    zz = Math.floor(zz / 2);
    alpha += alpha;
  }
  const beta = Math.floor(256 / alpha);
  alpha *= zz;
  const a = (fix >>> 24) & 0xff;
  const b = (fix >>> 16) & 0xff;
  const c = (fix >>> 8) & 0xff;
  const d = fix & 0xff;
  const sw = Math.floor((Math.floor((Math.floor((d * zz) / 256) + c * zz) / 256) + b * zz) / beta);
  if (a === 0) return sw;
  if (a === 255) return sw - alpha;
  throw new Error(`fix_word ${fix} is out of range`);
}

/** Metrics for every character code, scaled to a font size in scaled points. */
export function scaleTfm(tfm: Tfm, sizeSp: number): ScaledMetrics {
  const widths = new Int32Array(256);
  const heights = new Int32Array(256);
  const depths = new Int32Array(256);
  const w = Array.from(tfm.widths, (f) => scaleFixWord(f, sizeSp));
  const h = Array.from(tfm.heights, (f) => scaleFixWord(f, sizeSp));
  const d = Array.from(tfm.depths, (f) => scaleFixWord(f, sizeSp));
  for (let code = tfm.bc; code <= tfm.ec; code++) {
    const info = tfm.chars[code - tfm.bc];
    if (!info) continue;
    widths[code] = w[info.width] ?? 0;
    heights[code] = h[info.height] ?? 0;
    depths[code] = d[info.depth] ?? 0;
  }
  return { widths, heights, depths };
}
