import { describe, expect, it } from "vitest";
import { type PageItem, parseDvi, pointsPerUnit } from "./dvi";
import { about, btransMatrix, compose, IDENTITY, kindOf, placed, turned } from "./transforms";

/** A DVI of TeX's units, scaled points, one page a list of commands, built byte by byte. */
function dvi(...pages: Command[][]): Uint8Array {
  const bytes: number[] = [];
  const u = (n: number, size: number) => {
    for (let i = size - 1; i >= 0; i--) bytes.push((n >>> (8 * i)) & 0xff);
  };
  bytes.push(247, 2);
  u(25_400_000, 4);
  u(473_628_672, 4);
  u(1000, 4);
  bytes.push(0);
  for (const page of pages) {
    bytes.push(139);
    for (let i = 0; i < 11; i++) u(i === 10 ? -1 : 0, 4);
    for (const command of page) {
      switch (command.kind) {
        case "glyph":
          bytes.push(command.code);
          break;
        case "right":
        case "down":
          bytes.push(command.kind === "right" ? 146 : 160);
          u(command.by, 4);
          break;
        case "rule":
          bytes.push(137);
          u(command.height, 4);
          u(command.width, 4);
          break;
        case "push":
        case "pop":
          bytes.push(command.kind === "push" ? 141 : 142);
          break;
        case "special": {
          const text = [...command.text].map((char) => char.charCodeAt(0));
          bytes.push(239, text.length, ...text);
          break;
        }
      }
    }
    bytes.push(140);
  }
  return new Uint8Array(bytes);
}

type Command =
  | { kind: "glyph"; code: number }
  | { kind: "right" | "down"; by: number }
  | { kind: "rule"; width: number; height: number }
  | { kind: "push" | "pop" }
  | { kind: "special"; text: string };

const PT = 65_536;
/** A big point in scaled points. */
const BP = (72.27 / 72) * PT;
const glyph = (code = 65): Command => ({ kind: "glyph", code });
const right = (pt: number): Command => ({ kind: "right", by: Math.round(pt * PT) });
const down = (pt: number): Command => ({ kind: "down", by: Math.round(pt * PT) });
const special = (text: string): Command => ({ kind: "special", text });

/** Every glyph and rule of a page, where the parser puts it, in points, and what it is set in. */
function drawn(bytes: Uint8Array, page = 0) {
  const doc = parseDvi(bytes, () => undefined);
  const pt = pointsPerUnit(doc);
  return (doc.pages[page]?.items ?? [])
    .filter((item): item is Exclude<PageItem, { kind: "special" }> => item.kind !== "special")
    .map((item) => ({
      kind: item.kind,
      h: Number((item.h * pt).toFixed(4)),
      v: Number((item.v * pt).toFixed(4)),
      ...(item.transform === undefined ? {} : { transform: item.transform }),
    }));
}

describe("btransMatrix", () => {
  it("reads a matrix, a rotation and scales as xdvipdfmx does, and nothing else", () => {
    expect(btransMatrix("matrix 1.0 0.0 0.0 1.0 -23.59927 0.0")).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: -23.59927,
      f: 0,
    });
    expect(btransMatrix("")).toEqual(IDENTITY);
    expect(btransMatrix("  ")).toEqual(IDENTITY);
    // Degrees, anticlockwise, y up.
    const turned = btransMatrix("rotate 90");
    expect(turned?.a).toBeCloseTo(0, 12);
    expect(turned?.b).toBeCloseTo(1, 12);
    expect(turned?.c).toBeCloseTo(-1, 12);
    expect(turned?.d).toBeCloseTo(0, 12);
    expect(btransMatrix("xscale 2 yscale 0.5")).toEqual({ a: 2, b: 0, c: 0, d: 0.5, e: 0, f: 0 });
    expect(btransMatrix("scale 3")).toEqual({ a: 3, b: 0, c: 0, d: 3, e: 0, f: 0 });
    // What sizes an image moves nothing.
    expect(btransMatrix("width 10pt height 5 bp")).toEqual(IDENTITY);
    // What it cannot read is no matrix.
    expect(btransMatrix("matrix 1 0 0 1 5")).toBeUndefined();
    expect(btransMatrix("matrix 1 0 0 1 5 x")).toBeUndefined();
    expect(btransMatrix("skew 10")).toBeUndefined();
    expect(btransMatrix("matrix 1 0 0 1 5 5 rotate 10")).toBeUndefined();
  });

  it("names a matrix's kind by its linear part", () => {
    expect(kindOf({ ...IDENTITY, e: 50, f: -3 })).toBe("translation");
    expect(kindOf(btransMatrix("rotate 30") ?? IDENTITY)).toBe("rotate");
    expect(kindOf(btransMatrix("xscale -1") ?? IDENTITY)).toBe("scale");
    expect(kindOf({ a: 1, b: 0, c: 0.3, d: 1, e: 0, f: 0 })).toBe("matrix");
    // A rotation and its undoing come to a translation.
    const there = btransMatrix("rotate 30") ?? IDENTITY;
    const back = btransMatrix("rotate -30") ?? IDENTITY;
    expect(kindOf(compose(there, back))).toBe("translation");
  });

  it("takes a matrix about the point it is written at", () => {
    const quarter = about(btransMatrix("rotate 90") ?? IDENTITY, 10, 20);
    const at = placed(quarter, 10, -20);
    expect(at.h).toBeCloseTo(10, 9);
    expect(at.v).toBeCloseTo(-20, 9);
    // A point 5 right of it goes 5 up, which is 5 less down in the DVI.
    const beside = placed(quarter, 15, -20);
    expect(beside.h).toBeCloseTo(10, 9);
    expect(beside.v).toBeCloseTo(-25, 9);
    const offset = turned([0, 1, -1, 0], 5, 0);
    expect(offset.x).toBeCloseTo(0, 12);
    expect(offset.y).toBeCloseTo(-5, 12);
  });
});

describe("parseDvi's transformations", () => {
  it("moves what a translation holds by its offset, in big points, y up, and nothing after it", () => {
    const items = drawn(
      dvi([
        right(100),
        down(200),
        glyph(),
        special("pdf:btrans matrix 1 0 0 1 -20 4"),
        glyph(),
        { kind: "rule", width: 10 * PT, height: 2 * PT },
        special("pdf:etrans"),
        glyph(),
      ]),
    );
    const bp = BP / PT;
    expect(items).toEqual([
      { kind: "glyph", h: 100, v: 200 },
      {
        kind: "glyph",
        h: Number((100 + 0 - 20 * bp).toFixed(4)),
        v: Number((200 - 4 * bp).toFixed(4)),
        transform: { kind: "translation" },
      },
      {
        kind: "rule",
        h: Number((100 - 20 * bp).toFixed(4)),
        v: Number((200 - 4 * bp).toFixed(4)),
        transform: { kind: "translation" },
      },
      { kind: "glyph", h: 100, v: 200 },
    ]);
  });

  it("nests translations, and a rotation turns what it holds about where it was written", () => {
    const items = drawn(
      dvi([
        right(100),
        down(100),
        special("pdf:btrans matrix 1 0 0 1 10 0"),
        special("pdf:btrans matrix 1 0 0 1 0 10"),
        glyph(),
        special("pdf:etrans"),
        special("pdf:btrans rotate 90"),
        right(20),
        glyph(),
        special("pdf:etrans"),
        special("pdf:etrans"),
      ]),
    );
    const bp = BP / PT;
    const [both, turned] = items;
    expect(both?.h).toBeCloseTo(100 + 10 * bp, 3);
    expect(both?.v).toBeCloseTo(100 - 10 * bp, 3);
    expect(both?.transform).toEqual({ kind: "translation" });
    // 20 points right of the rotation's point is 20 points up, then 10 bp right of that.
    expect(turned?.h).toBeCloseTo(100 + 10 * bp, 3);
    expect(turned?.v).toBeCloseTo(80, 3);
    expect(turned?.transform?.kind).toBe("rotate");
    const [a, b, c, d] = turned?.transform?.matrix ?? [];
    expect([a, b, c, d].map((x) => Math.round((x ?? Number.NaN) * 1e9) / 1e9)).toEqual([
      0, 1, -1, 0,
    ]);
  });

  it("follows x:scale and x:rotate to the end of their level, and x:bscale to its x:escale", () => {
    const items = drawn(
      dvi([
        right(100),
        down(100),
        special("x:gsave"),
        special("x:scale 2 2"),
        right(10),
        glyph(),
        special("x:grestore"),
        glyph(),
        special("pdf:bcontent"),
        special("x:bscale 3 3"),
        right(10),
        glyph(),
        special("x:escale"),
        special("pdf:econtent"),
        glyph(),
      ]),
    );
    expect(items[0]).toMatchObject({ h: 120, v: 100, transform: { kind: "scale" } });
    expect(items[0]?.transform?.matrix).toEqual([2, 0, 0, 2]);
    expect(items[1]).toEqual({ kind: "glyph", h: 110, v: 100 });
    expect(items[2]).toMatchObject({ h: 140, v: 100, transform: { kind: "scale" } });
    expect(items[3]).toEqual({ kind: "glyph", h: 120, v: 100 });
  });

  it("leaves what it cannot read where it is, as other, and starts each page afresh", () => {
    const bytes = dvi(
      [special("pdf:btrans skew 10"), glyph(), special("pdf:btrans matrix 1 0 0 1 72 0"), glyph()],
      [glyph()],
    );
    const items = drawn(bytes);
    expect(items[0]).toEqual({ kind: "glyph", h: 0, v: 0, transform: { kind: "other" } });
    // Inside a level it cannot read, a translation still moves, and the level stays other.
    expect(items[1]?.h).toBeCloseTo(72.27, 3);
    expect(items[1]?.transform).toEqual({ kind: "other" });
    expect(drawn(bytes, 1)).toEqual([{ kind: "glyph", h: 0, v: 0 }]);
  });

  it("closes no level that was never opened", () => {
    const items = drawn(
      dvi([special("pdf:etrans"), special("x:grestore"), special("x:escale"), glyph()]),
    );
    expect(items).toEqual([{ kind: "glyph", h: 0, v: 0 }]);
  });
});

describe("a template's own cm", () => {
  /**
   * A TikZ node's text as pgf's dvipdfmx driver sets it, its picture's `cm`s before it (none for a
   * plain node, one for a scope's `transform canvas`): the half turns that undo each other around
   * the text, and the levels xdvipdfmx and the raw `q` and `Q` open and close, interleaved.
   */
  const node = (canvas: string[]): Command[] => [
    special("pdf:bcontent"),
    special("pdf:code q "),
    ...canvas.flatMap((cm) => [special("pdf:code q "), special(`pdf:code ${cm} `)]),
    special("pdf:code q "),
    special("pdf:code q -1 0 0 -1 0 0 cm q"),
    special("pdf: econtent"),
    special("pdf: bcontent"),
    special("pdf:code -1 0 0 -1 0 0 cm"),
    special("pdf:code q"),
    special("pdf: econtent"),
    special("pdf:btrans matrix 1.0 0.0 0.0 1.0 -20 -2"),
    glyph(),
    special("pdf:etrans"),
    special("pdf: bcontent"),
    special("pdf:code Q Q Q"),
    special("pdf:code Q "),
    ...canvas.map(() => special("pdf:code Q ")),
    special("pdf:code n "),
    special("pdf:code Q "),
    special("pdf:econtent"),
    glyph(),
  ];

  it("leaves a plain node's text a translation, through pgf's half turns", () => {
    const items = drawn(dvi(node([])));
    expect(items.map((item) => item.transform)).toEqual([{ kind: "translation" }, undefined]);
  });

  it("keeps a node under a transform canvas other, where it is, and nothing after it", () => {
    for (const cm of [
      "0.86603 0.5 -0.5 0.86603 0.0 0.0 cm",
      "1.0 0.0 0.0 1.0 56.69362 0.0 cm",
      "2.0 0.0 0.0 2.0 0.0 0.0 cm",
    ]) {
      const items = drawn(dvi(node([cm])));
      expect(
        items.map((item) => item.transform),
        cm,
      ).toEqual([{ kind: "other" }, undefined]);
      // The node's own translation still moves it, as on the page without the canvas.
      expect(items[0]?.h, cm).toBeCloseTo(-20 * (BP / PT), 3);
    }
  });

  it("follows q and Q in any literal, and passes over strings and the identity", () => {
    const items = drawn(
      dvi([
        special("pdf:literal direct q 1 0 0 1 0 0 cm (q Q 2 0 0 2 0 0 cm) Tj"),
        glyph(),
        special("pdf:content 0 1 -1 0 0 0 cm"),
        glyph(),
        special("pdf:literal q 1 0 0 1 5 0 cm"),
        glyph(),
        special("x:gsave"),
        special("pdf:code Q"),
        glyph(),
        special("x:grestore"),
        glyph(),
      ]),
    );
    expect(items.map((item) => item.transform?.kind)).toEqual([
      undefined,
      // A pdf:content's level closes after it.
      undefined,
      "other",
      // A Q of the template's own pops its q, under the level x:gsave opened; its x:grestore pops
      // the level below.
      "other",
      undefined,
    ]);
  });
});
