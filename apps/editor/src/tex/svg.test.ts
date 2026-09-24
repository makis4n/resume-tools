import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDvi, pointsPerUnit } from "./dvi";
import { renderPage, US_LETTER } from "./svg";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("renderPage with XeTeX native fonts", () => {
  const doc = parseDvi(fixture("hello.xdv"), () => undefined);
  const page = doc.pages[0];
  if (!page) throw new Error("fixture has no page");
  const runs = page.items.filter((i) => i.kind === "native");
  const glyphs = runs.reduce((n, r) => n + (r.kind === "native" ? r.glyphs.length : 0), 0);

  it("draws a box per run when the font is missing", () => {
    const svg = renderPage(doc, page, { outlines: () => undefined });
    expect(svg.match(/<rect [^>]*stroke="rgb\(200,60,60\)"/g)?.length).toBe(runs.length);
    expect(svg).not.toContain('href="#n');
  });

  it("draws one <use> per glyph at the run's position when outlines are given", () => {
    const svg = renderPage(doc, page, {
      outlines: () => undefined,
      native: (font) =>
        font.name.endsWith("SourceSans3-Regular.otf")
          ? { unitsPerEm: 1000, pathOf: (id) => `M0 0L${id} 0L${id} 700Z` }
          : undefined,
    });
    const uses = svg.match(/<use href="#n[^>]*>/g) ?? [];
    expect(uses.length).toBe(glyphs);
    const first = runs[0];
    if (first?.kind !== "native") throw new Error("no run");
    const g = first.glyphs[0];
    if (!g) throw new Error("empty run");
    const pt = pointsPerUnit(doc);
    const x = 72.27 + (first.h + g.x) * pt;
    expect(uses[0]).toContain(`x="${x.toFixed(3)}"`);
    expect(uses[0]).toContain(`data-glyph="${g.id}"`);
    // The glyph's path is scaled from font units to the font's size in points.
    const font = doc.nativeFonts.get(first.font);
    if (!font) throw new Error("no font");
    const s = (font.size * pt) / 1000;
    expect(svg).toContain(`transform="matrix(${s} 0 0 ${-s} 0 0)"`);
    expect(svg).toContain(`viewBox="0 0 ${US_LETTER.width} ${US_LETTER.height}"`);
    // Glyphs are hit by their bounding boxes, not their ink.
    expect(svg).toContain('pointer-events="bounding-box"');
  });
});

describe("renderPage on a hand-built native run", () => {
  const PT = 65536;
  const base = parseDvi(fixture("hello.xdv"), () => undefined);
  const font = (extra: Partial<import("./dvi").NativeFont>) => ({
    id: 1,
    name: "./fonts/Test.otf",
    index: 0,
    size: 10 * PT,
    flags: 0,
    ...extra,
  });
  const run = (glyphs: { id: number; x: number; y: number }[]) => ({
    counters: [1],
    items: [{ kind: "native" as const, font: 1, h: 100 * PT, v: 50 * PT, width: 30 * PT, glyphs }],
  });
  const doc = (
    extra: Partial<import("./dvi").NativeFont>,
    glyphs = [{ id: 7, x: 5 * PT, y: -2 * PT }],
  ) => {
    const d = { ...base, nativeFonts: new Map([[1, font(extra)]]), pages: [run(glyphs)] };
    return { doc: d, page: d.pages[0] as (typeof d.pages)[0] };
  };
  const outlines = {
    unitsPerEm: 1000,
    pathOf: (id: number) => (id === 7 ? "M0 0L500 700Z" : undefined),
  };
  const pt = pointsPerUnit(base);

  it("places a glyph at the run origin plus its own offset, y downward", () => {
    const { doc: d, page } = doc({});
    const svg = renderPage(d, page, { outlines: () => undefined, native: () => outlines });
    expect(svg).toContain(
      `x="${(72.27 + 105 * PT * pt).toFixed(3)}" y="${(72.27 + 48 * PT * pt).toFixed(3)}"`,
    );
    expect(svg).toContain(
      `transform="matrix(${(10 * PT * pt) / 1000} 0 0 ${-(10 * PT * pt) / 1000} 0 0)"`,
    );
  });

  it("applies the font's colour with its alpha, and stretch and slant to the matrix", () => {
    // extend and slant are 16.16 fixed in the XDV: 1.5 and 0.25.
    const { doc: d, page } = doc({ rgba: 0xff000080, extend: 98304, slant: 16384 });
    const svg = renderPage(d, page, { outlines: () => undefined, native: () => outlines });
    expect(svg).toContain('fill="rgb(255,0,0)" fill-opacity="0.502"');
    const s = (10 * PT * pt) / 1000;
    expect(svg).toContain(`transform="matrix(${s * 1.5} 0 ${s * 0.25} ${-s} 0 0)"`);
  });

  it("draws emboldened runs, other faces and unusable ems as boxes", () => {
    for (const extra of [{ embolden: 0.5 }, { index: 1 }]) {
      const { doc: d, page } = doc(extra);
      const svg = renderPage(d, page, {
        outlines: () => undefined,
        native: (f) => (f.index === 0 ? outlines : undefined),
      });
      expect(svg, JSON.stringify(extra)).toContain('stroke="rgb(200,60,60)"');
      expect(svg).not.toContain("<use");
    }
    const { doc: d, page } = doc({});
    const svg = renderPage(d, page, {
      outlines: () => undefined,
      native: () => ({ ...outlines, unitsPerEm: 0 }),
    });
    expect(svg).toContain('stroke="rgb(200,60,60)"');
    expect(svg).not.toContain("Infinity");
  });

  it("leaves out a glyph whose outline throws and keeps the rest", () => {
    const { doc: d, page } = doc({}, [
      { id: 7, x: 0, y: 0 },
      { id: 8, x: 5 * PT, y: 0 },
    ]);
    const svg = renderPage(d, page, {
      outlines: () => undefined,
      native: () => ({
        unitsPerEm: 1000,
        pathOf: (id) => {
          if (id === 8) throw new Error("Bad flags.");
          return "M0 0L1 1Z";
        },
      }),
    });
    expect(svg.match(/<use href="#n/g)?.length).toBe(1);
  });
});
