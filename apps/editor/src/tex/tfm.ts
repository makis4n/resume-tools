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

/** One instruction of a font's ligature/kern program (TFtoPL's LIG and KRN). */
export interface LigKern {
  /** 0..127: the instruction applies; >128: skip; 255 in the first or last slot marks a boundary char. */
  skip: number;
  /** The character that must follow for this instruction to apply. */
  next: number;
  /** Below 128 a ligature op (4a+2b+c, see `applyLigKern`); 128 or more a kern. */
  op: number;
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
  ligKern: LigKern[];
  /** Kern amounts as fix_words. */
  kerns: Int32Array;
  /** Font parameters as fix_words, 1-based like fontdimen: slant, space, stretch, shrink, xHeight, quad, extraSpace, ... */
  params: Int32Array;
  /** The right boundary character, if the font has one. */
  boundaryChar?: number;
}

export interface ScaledMetrics {
  /** Per character code 0..255, in scaled points; 0 for missing characters. */
  widths: Int32Array;
  heights: Int32Array;
  depths: Int32Array;
  /** Kern amounts in scaled points, indexed like `Tfm.kerns`. */
  kerns: Int32Array;
  /** Interword glue and the em, in scaled points. */
  space: number;
  stretch: number;
  shrink: number;
  extraSpace: number;
  quad: number;
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
  const nl = half(8);
  const nk = half(9);
  const ne = half(10);
  const np = half(11);
  if (lf * 4 !== bytes.byteLength) {
    throw new Error(
      `TFM length mismatch: header says ${lf * 4} bytes, file has ${bytes.byteLength}`,
    );
  }
  if (ec < bc - 1 || ec > 255) throw new Error(`TFM has an invalid character range ${bc}..${ec}`);
  // tftopl's check: the tables must account for the whole file.
  if (6 + lh + (ec - bc + 1) + nw + nh + nd + ni + nl + nk + ne + np !== lf)
    throw new Error("TFM table lengths do not add up to the file length");
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
  const ligKern: LigKern[] = [];
  for (let i = 0; i < nl; i++) {
    const w = view.getUint32((at + i) * 4);
    ligKern.push({
      skip: (w >>> 24) & 0xff,
      next: (w >>> 16) & 0xff,
      op: (w >>> 8) & 0xff,
      remainder: w & 0xff,
    });
  }
  at += nl;
  const kerns = table(nk);
  at += ne;
  const params = new Int32Array(np + 1);
  for (let i = 1; i <= np; i++) params[i] = word(at + i - 1);
  const first = ligKern[0];
  const boundaryChar = first && first.skip === 255 ? first.next : undefined;
  return {
    checksum,
    designSize,
    bc,
    ec,
    widths,
    heights,
    depths,
    italics,
    chars,
    ligKern,
    kerns,
    params,
    boundaryChar,
  };
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
  const kerns = Int32Array.from(tfm.kerns, (f) => scaleFixWord(f, sizeSp));
  const param = (i: number) => scaleFixWord(tfm.params[i] ?? 0, sizeSp);
  return {
    widths,
    heights,
    depths,
    kerns,
    space: param(2),
    stretch: param(3),
    shrink: param(4),
    extraSpace: param(7),
    quad: param(6),
  };
}

/** Where a font's ligature/kern program for a character starts, or -1 if it has none. */
function ligKernStart(tfm: Tfm, code: number): number {
  const info = tfm.chars[code - tfm.bc];
  if (!info || info.tag !== 1) return -1;
  let start = info.remainder;
  const first = tfm.ligKern[start];
  // A first instruction with skip > 128 is a pointer to the real start.
  if (first && first.skip > 128) start = 256 * first.op + first.remainder;
  return start;
}

/** The instruction that applies between two characters, if any. */
function ligKernFor(tfm: Tfm, left: number, right: number): LigKern | undefined {
  let i = ligKernStart(tfm, left);
  if (i < 0) return undefined;
  for (;;) {
    const ins = tfm.ligKern[i];
    if (!ins) return undefined;
    if (ins.skip <= 128 && ins.next === right) return ins;
    if (ins.skip >= 128) return undefined;
    i += ins.skip + 1;
  }
}

export interface LigKernResult {
  /** Character codes after ligature substitution. */
  codes: number[];
  /** Kern (as a fix_word index into `kerns`, or -1) inserted after each code. */
  kernAfter: number[];
  /** For each output code, the index of the first input code it came from. */
  source: number[];
}

/**
 * Run a font's ligature/kern program over a run of characters the way TeX's main
 * loop does (tex.web §1039-1040): ligature ops replace, insert or keep characters and
 * may re-examine the result; kern ops record a kern between the pair.
 * Boundary characters are not applied.
 */
export function applyLigKern(tfm: Tfm, input: number[]): LigKernResult {
  const codes = [...input];
  const source = input.map((_, i) => i);
  const kernAfter: number[] = input.map(() => -1);
  let i = 0;
  // A real program settles in a few steps per pair; a crafted one could re-examine the
  // same pair forever or insert without end, so both are bounded.
  let steps = 0;
  const limit = 8 * input.length + 64;
  while (i < codes.length - 1) {
    if (++steps > limit || codes.length > 2 * input.length + 64)
      throw new Error("TFM ligature program does not terminate");
    const ins = ligKernFor(tfm, codes[i] as number, codes[i + 1] as number);
    if (!ins) {
      i++;
      continue;
    }
    if (ins.op >= 128) {
      kernAfter[i] = 256 * (ins.op - 128) + ins.remainder;
      i++;
      continue;
    }
    const lig = ins.remainder;
    switch (ins.op) {
      case 0: // =:  replace both, re-examine
        codes.splice(i, 2, lig);
        source.splice(i, 2, source[i] as number);
        kernAfter.splice(i, 2, -1);
        break;
      case 1: // =:|  replace the left, keep the right, re-examine
        codes[i] = lig;
        break;
      case 2: // |=:  keep the left, replace the right, re-examine
        codes[i + 1] = lig;
        break;
      case 3: // |=:|  insert between, re-examine with the inserted character
        codes.splice(i + 1, 0, lig);
        source.splice(i + 1, 0, source[i + 1] as number);
        kernAfter.splice(i + 1, 0, -1);
        break;
      case 5: // =:|>
        codes[i] = lig;
        i++;
        break;
      case 6: // |=:>
        codes[i + 1] = lig;
        i++;
        break;
      case 7: // |=:|>
        codes.splice(i + 1, 0, lig);
        source.splice(i + 1, 0, source[i + 1] as number);
        kernAfter.splice(i + 1, 0, -1);
        i++;
        break;
      case 11: // |=:|>>
        codes.splice(i + 1, 0, lig);
        source.splice(i + 1, 0, source[i + 1] as number);
        kernAfter.splice(i + 1, 0, -1);
        i += 2;
        break;
      default:
        i++;
    }
  }
  return { codes, kernAfter, source };
}
