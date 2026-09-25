import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTfm } from "./tfm";
import { expand, parseVf, type VirtualFont } from "./vf";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const ONE = 2 ** 20;
const bytes = (n: number, value: number) =>
  Array.from({ length: n }, (_, i) => (value >>> (8 * (n - 1 - i))) & 0xff);

/**
 * A virtual font of two local fonts, `base` at its design size and `half` at half of it, with
 * the packets given, long or short by length, and a width of one design size each.
 */
function virtualFont(packets: Record<number, number[]>): Uint8Array {
  const out = [247, 202, 0, ...bytes(4, 0), ...bytes(4, 10 * ONE)];
  const define = (k: number, scale: number, name: string) =>
    out.push(
      243,
      k,
      ...bytes(4, 0),
      ...bytes(4, scale),
      ...bytes(4, 10 * ONE),
      0,
      name.length,
      ...[...name].map((c) => c.charCodeAt(0)),
    );
  define(0, ONE, "base");
  define(5, ONE / 2, "half");
  for (const [code, dvi] of Object.entries(packets)) {
    if (dvi.length < 242) out.push(dvi.length, Number(code), ...bytes(3, ONE), ...dvi);
    else
      out.push(242, ...bytes(4, dvi.length), ...bytes(4, Number(code)), ...bytes(4, ONE), ...dvi);
  }
  out.push(248, 248, 248);
  return new Uint8Array(out);
}

/** Every character of both local fonts is a quarter of the design size wide. */
const quarter = () => ONE / 4;

describe("parseVf", () => {
  const vf = parseVf(fixture("ptmr8t.vf"));

  it("reads the preamble and the local fonts of Times in T1", () => {
    expect(vf.design).toBe(10 * ONE);
    expect(vf.fonts).toEqual([
      { number: 0, checksum: 0, scale: ONE, design: 10 * ONE, area: "", name: "ptmr8r" },
    ]);
    expect(vf.chars.size).toBe(256);
  });

  it("gives each character the width its TFM has", () => {
    const tfm = parseTfm(fixture("ptmr8t.tfm"));
    for (let code = tfm.bc; code <= tfm.ec; code++) {
      const info = tfm.chars[code - tfm.bc];
      if (info) expect(vf.chars.get(code)?.width, `code ${code}`).toBe(tfm.widths[info.width]);
    }
  });

  it("reads a long packet as a short one", () => {
    const long = parseVf(virtualFont({ 7: Array.from({ length: 300 }, () => 138) }));
    expect(long.chars.get(7)?.dvi).toHaveLength(300);
    expect(long.chars.get(7)?.width).toBe(ONE);
  });

  it("refuses what is not a virtual font, or is cut short", () => {
    expect(() => parseVf(new Uint8Array([247, 2, 0]))).toThrow("not a virtual font");
    const whole = virtualFont({ 65: [65] });
    expect(() => parseVf(whole.subarray(0, whole.length - 6))).toThrow("ends early");
    // Below 242 an opcode is a short packet's length; 250 is nothing a VF holds.
    expect(() => parseVf(new Uint8Array([...whole.subarray(0, 11), 250]))).toThrow("opcode 250");
  });
});

describe("expand", () => {
  const times = parseVf(fixture("ptmr8t.vf"));

  it("sets A as one character of the raw font", () => {
    expect(expand(times, 65, quarter)).toEqual([
      { font: "ptmr8r", scale: ONE, code: 65, h: 0, v: 0 },
    ]);
  });

  it("composes Abreve from 8r's breve, raised and moved right, and the A", () => {
    const [breve, a, ...rest] = expand(times, 128, quarter) ?? [];
    expect(breve).toMatchObject({ font: "ptmr8r", code: 11 });
    expect(breve).toMatchObject({ h: expect.any(Number), v: expect.any(Number) });
    if (!breve || "rule" in breve) throw new Error("no breve");
    expect(breve.h).toBeGreaterThan(0);
    expect(breve.v).toBeLessThan(0);
    expect(a).toEqual({ font: "ptmr8r", scale: ONE, code: 65, h: 0, v: 0 });
    expect(rest).toEqual([]);
  });

  it("gives nothing for a character with no packet", () => {
    expect(expand(parseVf(virtualFont({ 65: [65] })), 66, quarter)).toBeUndefined();
  });

  it("runs every command a packet may hold", () => {
    const packet = [
      65, // set_char A: base, at the origin, then a quarter right
      128,
      66, // set1 B, then a quarter right
      133,
      67, // put1 C, not moving
      132,
      ...bytes(4, 100),
      ...bytes(4, 200), // set_rule 100 high, 200 wide, then right
      137,
      ...bytes(4, 10),
      ...bytes(4, 20), // put_rule
      141, // push
      143,
      ...bytes(1, -8), // right1 -8
      148,
      ...bytes(1, 3),
      147, // w1 3, w0
      154,
      ...bytes(2, 5),
      152, // x2 5, x0
      157,
      ...bytes(1, 7), // down1 7
      162,
      ...bytes(1, 2),
      161, // y1 2, y0
      167,
      ...bytes(1, 1),
      166, // z1 1, z0
      176, // fnt_num_5: half
      68, // set_char D in half
      235,
      0, // fnt1 0: base
      239,
      3,
      120,
      120,
      120, // xxx1, skipped
      138, // nop
      133,
      69, // put1 E
      142, // pop
      69, // set_char E, back where the push was, in base
    ];
    const vf = parseVf(virtualFont({ 1: packet }));
    const at = (h: number, v: number) => ({ h, v });
    const q = ONE / 4;
    expect(expand(vf, 1, quarter)).toEqual([
      { font: "base", scale: ONE, code: 65, ...at(0, 0) },
      { font: "base", scale: ONE, code: 66, ...at(q, 0) },
      { font: "base", scale: ONE, code: 67, ...at(2 * q, 0) },
      { rule: true, ...at(2 * q, 0), width: 200, height: 100 },
      { rule: true, ...at(2 * q + 200, 0), width: 20, height: 10 },
      { font: "half", scale: ONE / 2, code: 68, ...at(2 * q + 200 - 8 + 6 + 10, 7 + 4 + 2) },
      { font: "base", scale: ONE, code: 69, ...at(2 * q + 200 - 8 + 6 + 10 + q / 2, 13) },
      { font: "base", scale: ONE, code: 69, ...at(2 * q + 200, 0) },
    ]);
  });

  it("refuses a command a packet may not hold, naming it, and a stack or font out of place", () => {
    const refused = (dvi: number[]) => () => expand(parseVf(virtualFont({ 1: dvi })), 1, quarter);
    expect(refused([139, ...Array.from({ length: 44 }, () => 0)])).toThrow("holds bop");
    expect(refused([140])).toThrow("holds eop");
    expect(refused([243, 1])).toThrow("holds fnt_def1");
    expect(refused([250])).toThrow("holds opcode 250");
    expect(refused([142])).toThrow("pops more than it pushes");
    expect(refused([172, 65])).toThrow("selects font 1, which is not defined");
    const empty: VirtualFont = { comment: "", checksum: 0, design: 0, fonts: [], chars: new Map() };
    empty.chars.set(1, { width: 0, dvi: new Uint8Array([65]) });
    expect(() => expand(empty, 1, quarter)).toThrow("before any font is defined");
  });
});
