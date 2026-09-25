/**
 * Virtual fonts (VF): TeX fonts whose characters are small DVI programs over other fonts. TeX
 * sees only the virtual font's TFM; a driver draws each character by running its packet, which
 * sets characters of the fonts the VF names, moves and draws rules. TeX Live's PostScript
 * families are virtual in every encoding LaTeX uses (`ptmr8t` for Times in T1 draws from the raw
 * `ptmr8r`), and so are other families, so the page reads them to draw them.
 *
 * The format is vftovp.web's. Every length in a VF is a fix_word: an amount in a packet, and a
 * local font's scale, are in units of 2^-20 of the virtual font's design size, so the page scales
 * them once by the size the font is used at.
 */

export interface VfFont {
  /** The font number packets select it by. */
  number: number;
  checksum: number;
  /** The size it is used at, as a fix_word relative to the virtual font's design size. */
  scale: number;
  /** Its design size, as a fix_word in points. */
  design: number;
  area: string;
  /** The TeX font's name, such as `ptmr8r`. */
  name: string;
}

export interface VfChar {
  /** The character's width as the packet gives it, a fix_word relative to the design size. */
  width: number;
  /** The packet: DVI commands, run by `expand`. */
  dvi: Uint8Array;
}

export interface VirtualFont {
  comment: string;
  checksum: number;
  /** The design size, as a fix_word in points. */
  design: number;
  /** The local fonts, in the order the file defines them; packets start in the first. */
  fonts: VfFont[];
  chars: Map<number, VfChar>;
}

/** A character of a local font the packet sets, at (h, v), DVI's y pointing down. */
export interface GlyphPlacement {
  font: string;
  /** The local font's scale, as a fix_word relative to the virtual font's design size. */
  scale: number;
  code: number;
  h: number;
  v: number;
}

/** A rule the packet draws, from (h, v) rightwards by `width` and up by `height`. */
export interface RulePlacement {
  rule: true;
  h: number;
  v: number;
  width: number;
  height: number;
}

/** What a packet draws; every length is in units of 2^-20 of the virtual font's design size. */
export type Placement = GlyphPlacement | RulePlacement;

/**
 * A local font's width for a character, as a fix_word relative to that font's design size (the
 * TFM's), or undefined when its TFM has no such character. A `set` moves right by it.
 */
export type LocalWidth = (font: string, code: number) => number | undefined;

const PRE = 247;
const VF_ID = 202;
const LONG_CHAR = 242;
const FNT_DEF1 = 243;
const FNT_DEF4 = 246;
const POST = 248;

/** Reads big-endian integers from a VF, and says where it ended early. */
class Bytes {
  pos = 0;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  get done() {
    return this.pos >= this.bytes.length;
  }
  u8(): number {
    const v = this.bytes[this.pos];
    if (v === undefined) throw new Error(`virtual font ends early at byte ${this.pos}`);
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
  take(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length)
      throw new Error(`virtual font ends early at byte ${this.bytes.length}`);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  latin1(n: number): string {
    return String.fromCharCode(...this.take(n));
  }
}

/** Read a VF file: its preamble, its local fonts and its character packets. */
export function parseVf(bytes: Uint8Array): VirtualFont {
  const r = new Bytes(bytes);
  if (r.u8() !== PRE || r.u8() !== VF_ID) throw new Error("not a virtual font: no VF preamble");
  const comment = r.latin1(r.u8());
  const checksum = r.unsigned(4);
  const design = r.signed(4);
  const vf: VirtualFont = { comment, checksum, design, fonts: [], chars: new Map() };
  for (;;) {
    const op = r.u8();
    if (op === POST) break;
    if (op >= FNT_DEF1 && op <= FNT_DEF4) {
      const number = op === FNT_DEF4 ? r.signed(4) : r.unsigned(op - FNT_DEF1 + 1);
      const fontChecksum = r.unsigned(4);
      const scale = r.signed(4);
      const fontDesign = r.signed(4);
      const a = r.u8();
      const l = r.u8();
      const area = r.latin1(a);
      const name = r.latin1(l);
      vf.fonts.push({ number, checksum: fontChecksum, scale, design: fontDesign, area, name });
    } else if (op === LONG_CHAR) {
      const length = r.unsigned(4);
      const code = r.unsigned(4);
      const width = r.signed(4);
      vf.chars.set(code, { width, dvi: r.take(length) });
    } else if (op < LONG_CHAR) {
      // A short packet: its opcode is its length, and the width is three bytes.
      const code = r.u8();
      const width = r.unsigned(3);
      vf.chars.set(code, { width, dvi: r.take(op) });
    } else {
      throw new Error(`virtual font has opcode ${op} at byte ${r.pos - 1}, outside any packet`);
    }
  }
  return vf;
}

/** DVI opcodes a packet may hold, by the first of each group. */
const SET1 = 128;
const SET_RULE = 132;
const PUT1 = 133;
const PUT_RULE = 137;
const NOP = 138;
const PUSH = 141;
const POP = 142;
const RIGHT1 = 143;
const W0 = 147;
const X0 = 152;
const DOWN1 = 157;
const Y0 = 161;
const Z0 = 166;
const FNT_NUM_0 = 171;
const FNT1 = 235;
const XXX1 = 239;

/** Names for the opcodes a packet may not hold, for the error that refuses one. */
function opcodeName(op: number): string {
  if (op === 139) return "bop";
  if (op === 140) return "eop";
  if (op >= FNT_DEF1 && op <= FNT_DEF4) return `fnt_def${op - FNT_DEF1 + 1}`;
  if (op === PRE) return "pre";
  if (op === POST) return "post";
  if (op === 249) return "post_post";
  return `opcode ${op}`;
}

/**
 * Run the packet of `code` and return what it draws, in the order it draws it, or undefined when
 * the font has no such character. Packets hold `set_char`, `set`, `put`, rules, moves, `push` and
 * `pop`, font changes, specials, which are skipped, and `nop`; anything else throws, naming it.
 * The current font starts as the first the file defines. `widthOf` gives each local font's TFM
 * widths, which a `set` moves right by, scaled by the font's scale.
 */
export function expand(
  vf: VirtualFont,
  code: number,
  widthOf: LocalWidth,
): Placement[] | undefined {
  const char = vf.chars.get(code);
  if (!char) return undefined;
  const byNumber = new Map(vf.fonts.map((font) => [font.number, font]));
  let font = vf.fonts[0];
  const r = new Bytes(char.dvi);
  const out: Placement[] = [];
  let h = 0;
  let v = 0;
  let w = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  const stack: [number, number, number, number, number, number][] = [];

  const set = (c: number, advance: boolean) => {
    if (!font) throw new Error(`the packet of ${code} sets a character before any font is defined`);
    out.push({ font: font.name, scale: font.scale, code: c, h, v });
    if (advance) h += ((widthOf(font.name, c) ?? 0) * font.scale) / 2 ** 20;
  };
  const rule = (advance: boolean) => {
    const height = r.signed(4);
    const width = r.signed(4);
    out.push({ rule: true, h, v, width, height });
    if (advance) h += width;
  };
  const select = (number: number) => {
    font = byNumber.get(number);
    if (!font)
      throw new Error(`the packet of ${code} selects font ${number}, which is not defined`);
  };

  /** Whether `op` is one of the `n` opcodes of a group starting at `first`. */
  const among = (op: number, first: number, n: number) => op >= first && op < first + n;
  while (!r.done) {
    const op = r.u8();
    if (op < SET1) set(op, true);
    else if (among(op, SET1, 4)) set(r.unsigned(op - SET1 + 1), true);
    else if (op === SET_RULE) rule(true);
    else if (among(op, PUT1, 4)) set(r.unsigned(op - PUT1 + 1), false);
    else if (op === PUT_RULE) rule(false);
    else if (op === NOP) continue;
    else if (op === PUSH) stack.push([h, v, w, x, y, z]);
    else if (op === POP) {
      const top = stack.pop();
      if (!top) throw new Error(`the packet of ${code} pops more than it pushes`);
      [h, v, w, x, y, z] = top;
    } else if (among(op, RIGHT1, 4)) h += r.signed(op - RIGHT1 + 1);
    else if (op === W0) h += w;
    else if (among(op, W0 + 1, 4)) h += w = r.signed(op - W0);
    else if (op === X0) h += x;
    else if (among(op, X0 + 1, 4)) h += x = r.signed(op - X0);
    else if (among(op, DOWN1, 4)) v += r.signed(op - DOWN1 + 1);
    else if (op === Y0) v += y;
    else if (among(op, Y0 + 1, 4)) v += y = r.signed(op - Y0);
    else if (op === Z0) v += z;
    else if (among(op, Z0 + 1, 4)) v += z = r.signed(op - Z0);
    else if (among(op, FNT_NUM_0, 64)) select(op - FNT_NUM_0);
    else if (among(op, FNT1, 4)) select(op === FNT1 + 3 ? r.signed(4) : r.unsigned(op - FNT1 + 1));
    else if (among(op, XXX1, 4)) r.take(r.unsigned(op - XXX1 + 1));
    else throw new Error(`the packet of ${code} holds ${opcodeName(op)}, which a packet may not`);
  }
  return out;
}
