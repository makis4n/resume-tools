import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENGINE_DIR, engineAvailable } from "../engine/node";
import type { FontOutlines, GlyphOutline } from "./glyphs";
import { parseType1, readType1, type Type1Font, type1Outlines } from "./type1";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const tree = (path: string) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path)));

/**
 * The reference outlines were produced by fontTools from the same font. Its path data uses
 * H, V and implicit command repetition, ours does not, so compare the segments, not the text.
 */
type Segment = ["M" | "L", number, number] | ["C", ...number[]] | ["Z"];
function segments(d: string): Segment[] {
  const out: Segment[] = [];
  const tokens = d.match(/[MLHVCZ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let cmd = "";
  let x = 0;
  let y = 0;
  let i = 0;
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i] as string;
    if (/[MLHVCZ]/.test(t)) {
      cmd = t;
      i++;
      if (cmd === "Z") {
        out.push(["Z"]);
        continue;
      }
    } else if (cmd === "M") {
      // Pairs that follow a move without a command letter are line segments.
      cmd = "L";
    }
    switch (cmd) {
      case "M":
      case "L":
        x = next();
        y = next();
        out.push([cmd, x, y]);
        break;
      case "H":
        x = next();
        out.push(["L", x, y]);
        break;
      case "V":
        y = next();
        out.push(["L", x, y]);
        break;
      case "C": {
        const c = [next(), next(), next(), next(), next(), next()];
        x = c[4] as number;
        y = c[5] as number;
        out.push(["C", ...c]);
        break;
      }
      default:
        throw new Error(`unexpected path token ${t}`);
    }
  }
  return out;
}

describe("readType1", () => {
  const font = readType1(fixture("cmr10.pfb"));

  it("reads the clear-text header", () => {
    expect(font.name).toBe("CMR10");
    expect(font.fontMatrix).toEqual([0.001, 0, 0, 0.001, 0, 0]);
    expect(font.encoding[97]).toBe("a");
    expect(font.encoding[12]).toBe("fi");
    expect(font.encoding[127]).toBe("dieresis");
    expect(font.encoding.filter((n) => n === ".notdef").length).toBe(90);
  });

  it("decrypts the private portion", () => {
    expect(font.subrs.length).toBe(102);
    expect(font.charstrings.size).toBe(132);
    // Every charstring ends in endchar (14) or a seac escape, once decrypted correctly.
    for (const [name, cs] of font.charstrings) {
      const last = cs[cs.length - 1];
      expect(last === 14 || last === 6, `${name} ends with ${last}`).toBe(true);
    }
  });
});

describe("parseType1", () => {
  const outlines = parseType1(fixture("cmr10.pfb"));
  const reference = JSON.parse(
    readFileSync(new URL("./fixtures/cmr10.outlines.json", import.meta.url), "utf8"),
  ) as FontOutlines;

  it("has the shape the renderer consumes", () => {
    expect(outlines.name).toBe("CMR10");
    expect(outlines.encoding).toEqual(reference.encoding);
    expect(Object.keys(outlines.glyphs).sort()).toEqual(Object.keys(reference.glyphs).sort());
  });

  it("gives 'a' its width, path and bounds", () => {
    const a = outlines.glyphs.a;
    expect(a?.w).toBe(500);
    expect(a?.b).toEqual([42, -11, 493, 448]);
    expect(a?.d.startsWith("M333 76C337 36 364 -6 411 -6")).toBe(true);
  });

  it("leaves an empty glyph empty", () => {
    expect(outlines.glyphs.space).toEqual({ w: 333, d: "", b: null });
  });

  it("matches fontTools on every glyph", () => {
    for (const [name, want] of Object.entries(reference.glyphs)) {
      const got = outlines.glyphs[name];
      expect(got, name).toBeDefined();
      if (!got) continue;
      expect(got.w, `${name} width`).toBe(want.w);
      const wantSegments = segments(want.d);
      const gotSegments = segments(got.d);
      expect(gotSegments.length, `${name} segment count`).toBe(wantSegments.length);
      wantSegments.forEach((seg, i) => {
        const other = gotSegments[i] as Segment;
        expect(other[0], `${name} segment ${i}`).toBe(seg[0]);
        seg.slice(1).forEach((v, j) => {
          expect(other[j + 1] as number, `${name} segment ${i} value ${j}`).toBeCloseTo(
            v as number,
            3,
          );
        });
      });
      if (want.b === null) expect(got.b).toBeNull();
      else {
        expect(got.b, `${name} bounds`).not.toBeNull();
        want.b.forEach((v, j) => {
          expect((got.b as number[])[j], `${name} bound ${j}`).toBeCloseTo(v, 3);
        });
      }
    }
  });
});

/** Encode a Type 1 charstring from numbers and operator names, for hand-built glyphs. */
const OPS: Record<string, number[]> = {
  hsbw: [13],
  closepath: [9],
  hstem: [1],
  rmoveto: [21],
  hlineto: [6],
  vlineto: [7],
  rlineto: [5],
  rrcurveto: [8],
  callsubr: [10],
  return: [11],
  endchar: [14],
  seac: [12, 6],
  sbw: [12, 7],
  div: [12, 12],
  callothersubr: [12, 16],
  pop: [12, 17],
  setcurrentpoint: [12, 33],
};
function charstring(...program: (number | string)[]): Uint8Array {
  const bytes: number[] = [];
  for (const item of program) {
    if (typeof item === "string") {
      const op = OPS[item];
      if (!op) throw new Error(`no such operator ${item}`);
      bytes.push(...op);
    } else if (item >= -107 && item <= 107) bytes.push(item + 139);
    else if (item >= 108 && item <= 1131) {
      const v = item - 108;
      bytes.push((v >> 8) + 247, v & 0xff);
    } else if (item >= -1131 && item <= -108) {
      const v = -item - 108;
      bytes.push((v >> 8) + 251, v & 0xff);
    } else
      bytes.push(255, (item >>> 24) & 0xff, (item >> 16) & 0xff, (item >> 8) & 0xff, item & 0xff);
  }
  return Uint8Array.from(bytes);
}

describe("type1Outlines on hand-built glyphs", () => {
  // A 100-unit square with its left side bearing at 50, and a 20-unit square "accent".
  const square = charstring(
    50,
    600,
    "hsbw",
    0,
    0,
    "rmoveto",
    100,
    "hlineto",
    100,
    "vlineto",
    -100,
    "hlineto",
    "closepath",
    "endchar",
  );
  const accent = charstring(
    10,
    300,
    "hsbw",
    0,
    0,
    "rmoveto",
    20,
    "hlineto",
    20,
    "vlineto",
    -20,
    "hlineto",
    "closepath",
    "endchar",
  );
  const font: Type1Font = {
    name: "Test",
    fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    encoding: new Array(256).fill(".notdef"),
    charstrings: new Map([
      ["a", square],
      ["acute", accent],
      // Names an ordinary object would read as its members.
      ["constructor", square],
      ["__proto__", accent],
      // seac: asb adx ady bchar achar, with 'a' (97) as base and 'acute' (194) as accent.
      ["aacute", charstring(50, 600, "hsbw", 10, 200, 300, 97, 194, "seac")],
      // Hint replacement through OtherSubrs[3], then a line drawn with a divided length.
      [
        "hinted",
        charstring(
          0,
          400,
          "hsbw",
          4,
          1,
          3,
          "callothersubr",
          "pop",
          "callsubr",
          0,
          0,
          "rmoveto",
          300,
          3,
          "div",
          "hlineto",
          50,
          "vlineto",
          "closepath",
          "endchar",
        ),
      ],
      // Flex: the seven collected moves become two curves; the pops feed setcurrentpoint.
      [
        "flexed",
        charstring(
          0,
          500,
          "hsbw",
          0,
          0,
          "rmoveto",
          0,
          1,
          "callothersubr",
          0,
          0,
          "rmoveto",
          0,
          2,
          "callothersubr",
          10,
          5,
          "rmoveto",
          0,
          2,
          "callothersubr",
          10,
          5,
          "rmoveto",
          0,
          2,
          "callothersubr",
          10,
          0,
          "rmoveto",
          0,
          2,
          "callothersubr",
          10,
          0,
          "rmoveto",
          0,
          2,
          "callothersubr",
          10,
          -5,
          "rmoveto",
          0,
          2,
          "callothersubr",
          10,
          -5,
          "rmoveto",
          0,
          2,
          "callothersubr",
          50,
          60,
          0,
          3,
          0,
          "callothersubr",
          "pop",
          "pop",
          "setcurrentpoint",
          -60,
          "hlineto",
          "closepath",
          "endchar",
        ),
      ],
    ]),
    subrs: [
      charstring("return"),
      charstring("return"),
      charstring("return"),
      charstring("return"),
      charstring(10, 20, "hstem", "return"),
    ],
  };
  const outlines = type1Outlines(font);

  it("keeps glyphs named after an object's members as glyphs of their own", () => {
    expect(Object.getPrototypeOf(outlines.glyphs)).toBeNull();
    expect(Object.hasOwn(outlines.glyphs, "__proto__")).toBe(true);
    expect(outlines.glyphs["__proto__"]?.w).toBe(300);
    expect(outlines.glyphs["constructor"]?.w).toBe(600);
    expect(Object.hasOwn(outlines.glyphs, "toString")).toBe(false);
  });

  it("draws a plain glyph from its side bearing", () => {
    expect(outlines.glyphs.a).toEqual({
      w: 600,
      d: "M50 0L150 0L150 100L50 100Z",
      b: [50, 0, 150, 100],
    });
  });

  it("composes an accented glyph with seac", () => {
    // The accent lands at (sbx - asb + adx, ady) = (50 - 10 + 200, 300), plus its own bearing.
    expect(outlines.glyphs.aacute).toEqual({
      w: 600,
      d: "M50 0L150 0L150 100L50 100ZM250 300L270 300L270 320L250 320Z",
      b: [50, 0, 270, 320],
    });
  });

  it("ignores hint replacement and divides", () => {
    expect(outlines.glyphs.hinted?.d).toBe("M0 0L100 0L100 50Z");
  });

  it("turns flex into two curves", () => {
    expect(outlines.glyphs.flexed?.d).toBe("M0 0C10 5 20 10 30 10C40 10 50 5 60 0L0 0Z");
    expect(outlines.glyphs.flexed?.b).toEqual([0, 0, 60, 10]);
  });

  it("maps points, advances and seac's placements through the whole font matrix", () => {
    // A 500-unit em, skewed both ways and moved: in the 1000-unit em, a point (x, y) of the
    // charstrings goes to (2x + 0.5y + 10, 0.25x + 2y - 20).
    const skewed = type1Outlines({
      ...font,
      fontMatrix: [0.002, 0.00025, 0.0005, 0.002, 0.01, -0.02],
      charstrings: new Map([
        ...font.charstrings,
        // sbw: a side bearing of (20, 30) and an advance of (400, 100), then a triangle.
        [
          "sbw",
          charstring(
            20,
            30,
            400,
            100,
            "sbw",
            0,
            0,
            "rmoveto",
            10,
            "hlineto",
            10,
            "vlineto",
            "closepath",
            "endchar",
          ),
        ],
      ]),
    });
    expect(skewed.glyphs.a).toEqual({
      w: 1200,
      d: "M110 -7.5L310 17.5L360 217.5L160 192.5Z",
      b: [110, -7.5, 360, 217.5],
    });
    // seac places the accent at (240, 300) in the charstrings' units, then both are mapped.
    expect(skewed.glyphs.aacute).toEqual({
      w: 1200,
      d: "M110 -7.5L310 17.5L360 217.5L160 192.5ZM660 642.5L700 647.5L710 687.5L670 682.5Z",
      b: [110, -7.5, 710, 687.5],
    });
    // An advance is a distance, moved by no translation: 2·400 + 0.5·100.
    expect(skewed.glyphs.sbw).toEqual({
      w: 850,
      d: "M65 45L85 47.5L90 67.5Z",
      b: [65, 45, 90, 67.5],
    });
  });
});

/**
 * A PFB whose clear text gives another `/FontMatrix`, its segment's length changed to match. The
 * encrypted portion, and with it every charstring, stays as it is.
 */
function withFontMatrix(pfb: Uint8Array, matrix: string): Uint8Array {
  // The first segment is the clear text: 0x80, 1, its length as a little-endian 32-bit number.
  expect([pfb[0], pfb[1]]).toEqual([0x80, 1]);
  const length = new DataView(pfb.buffer, pfb.byteOffset).getUint32(2, true);
  const clear = String.fromCharCode(...pfb.subarray(6, 6 + length));
  const rewritten = clear.replace(/\/FontMatrix\s*\[[^\]]*\]/, `/FontMatrix [${matrix}]`);
  expect(rewritten).not.toBe(clear);
  const out = new Uint8Array(pfb.length - length + rewritten.length);
  out.set(pfb.subarray(0, 6));
  new DataView(out.buffer).setUint32(2, rewritten.length, true);
  out.set(
    Uint8Array.from(rewritten, (ch) => ch.charCodeAt(0)),
    6,
  );
  out.set(pfb.subarray(6 + length), 6 + rewritten.length);
  return out;
}

/** The numbers of path data, and its commands alone. */
const pathNumbers = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
const pathCommands = (d: string) => d.replace(/[^A-Z]/g, "");

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("type1Outlines of a font of the tree, its em doubled", () => {
  it("halves every coordinate, bound and advance of Latin Modern Roman", () => {
    const lmr10 = tree("/texlive/texmf-dist/fonts/type1/public/lm/lmr10.pfb");
    const plain = readType1(lmr10);
    const doubled = readType1(withFontMatrix(lmr10, "0.0005 0 0 0.0005 0 0"));
    expect(plain.fontMatrix).toEqual([0.001, 0, 0, 0.001, 0, 0]);
    expect(doubled.fontMatrix).toEqual([0.0005, 0, 0, 0.0005, 0, 0]);
    expect(doubled.charstrings).toEqual(plain.charstrings);
    const want = type1Outlines(plain).glyphs;
    const got = type1Outlines(doubled).glyphs;
    expect(Object.keys(got)).toEqual(Object.keys(want));
    expect(Object.keys(want).length).toBeGreaterThan(700);
    expect(want.a?.w).toBe(500);
    expect(got.a?.w).toBe(250);
    // Path data is written to three decimals, so a halved coordinate may differ from half the
    // one written for the plain font by up to 0.00075. Bounds and advances are not rounded.
    const wrong: string[] = [];
    for (const [name, glyph] of Object.entries(want)) {
      const half = got[name] as GlyphOutline;
      if (half.w !== glyph.w / 2) wrong.push(`${name}: advance ${half.w}, not ${glyph.w / 2}`);
      const [full, halved] = [pathNumbers(glyph.d), pathNumbers(half.d)];
      if (
        pathCommands(half.d) !== pathCommands(glyph.d) ||
        halved.length !== full.length ||
        halved.some((v, i) => Math.abs(v - (full[i] as number) / 2) > 0.001)
      )
        wrong.push(`${name}: path ${half.d}, not half of ${glyph.d}`);
      const box = glyph.b?.map((v) => v / 2);
      if (
        box === undefined
          ? half.b !== null
          : half.b === null || half.b.some((v, i) => Math.abs(v - (box[i] as number)) > 1e-9)
      )
        wrong.push(`${name}: bounds ${half.b}, not ${box ?? null}`);
    }
    expect(wrong).toEqual([]);
  });
});

/** Lato, whose em is 2000 units, where the tree has it once a bundle brings it. */
const LATO = join(
  ENGINE_DIR,
  "files",
  "/texlive/texmf-dist/fonts/type1/typoland/lato/Lato-Regular.pfb",
);

describe("type1Outlines of Lato", () => {
  it.skipIf(!existsSync(LATO))("draws an x as tall as other fonts', not twice as tall", () => {
    const x = parseType1(new Uint8Array(readFileSync(LATO))).glyphs.x;
    const [, bottom = 0, , top = 0] = x?.b ?? [];
    expect(top - bottom).toBeGreaterThan(350);
    expect(top - bottom).toBeLessThan(650);
  });
});

describe("readType1 on damaged fonts", () => {
  const whole = fixture("cmr10.pfb");

  it("rejects a truncated file instead of returning part of it", () => {
    for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const cut = whole.subarray(0, Math.floor(whole.length * fraction));
      expect(() => parseType1(cut), `${fraction * 100}%`).toThrow(/Type 1|PFB/);
    }
  });

  /** A PFB whose private portion decrypts to the given text. */
  const craft = (privateText: string) => {
    const clear = latin1Bytes(
      "%!PS-AdobeFont-1.0: Test\n/FontName /Test def\n/FontMatrix [0.001 0 0 0.001 0 0] readonly def\n/Encoding StandardEncoding def\ncurrentfile eexec\n",
    );
    const plain = new Uint8Array(4 + privateText.length);
    plain.set(latin1Bytes(privateText), 4);
    let r = 55665;
    const enc = plain.map((b) => {
      const c = b ^ (r >> 8);
      r = ((c + r) * 52845 + 22719) & 0xffff;
      return c;
    });
    const segment = (type: number, data: Uint8Array) => {
      const head = new Uint8Array(6);
      head[0] = 0x80;
      head[1] = type;
      new DataView(head.buffer).setUint32(2, data.length, true);
      return [head, data];
    };
    return new Uint8Array([
      ...segment(1, clear).flatMap((a) => [...a]),
      ...segment(2, enc).flatMap((a) => [...a]),
      0x80,
      3,
    ]);
  };
  const latin1Bytes = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

  it("rejects a negative charstring length instead of looping", () => {
    const font = craft("/CharStrings 1 dict dup begin\n/a -12 RD xxxxxxxx ND\nend\n");
    expect(() => readType1(font)).toThrow(/length/);
  });

  it("rejects an absurd subr count at once", () => {
    const t0 = performance.now();
    const font = craft("/Subrs 4294967295 array\n/CharStrings 0 dict dup begin\nend\n");
    expect(() => readType1(font)).toThrow(/subrs/);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("type1Outlines on damaged glyphs", () => {
  it("rejects a seac whose component is itself a seac", () => {
    const font: Type1Font = {
      name: "Test",
      fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      encoding: new Array(256).fill(".notdef"),
      charstrings: new Map([["a", charstring(0, 500, "hsbw", 0, 0, 0, 97, 97, "seac")]]),
      subrs: [],
    };
    expect(() => type1Outlines(font)).toThrow(/nested seac/);
  });

  it("ends a glyph after a bare move without closing it, as fontTools does", () => {
    const font: Type1Font = {
      name: "Test",
      fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      encoding: new Array(256).fill(".notdef"),
      charstrings: new Map([
        [
          "a",
          charstring(
            0,
            500,
            "hsbw",
            0,
            0,
            "rmoveto",
            10,
            "hlineto",
            10,
            "vlineto",
            "closepath",
            5,
            5,
            "rmoveto",
            "endchar",
          ),
        ],
      ]),
      subrs: [],
    };
    expect(type1Outlines(font).glyphs.a?.d).toBe("M0 0L10 0L10 10ZM15 15");
  });
});
