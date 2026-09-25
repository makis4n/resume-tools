import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type DviFont, parseDvi, pointsPerUnit } from "./dvi";
import { parseTfm, scaleTfm } from "./tfm";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const widthsFor = (font: DviFont) =>
  scaleTfm(parseTfm(fixture(`${font.name}.tfm`)), font.scale).widths;

describe("parseDvi", () => {
  const doc = parseDvi(fixture("jake.dvi"), widthsFor);
  const page = doc.pages[0];
  if (!page) throw new Error("fixture has no page");
  const items = page.items;

  it("reads the preamble", () => {
    expect(doc.id).toBe(2);
    expect(doc.numerator).toBe(25400000);
    expect(doc.denominator).toBe(473628672);
    expect(doc.magnification).toBe(1000);
    expect(pointsPerUnit(doc)).toBeCloseTo(1 / 65536, 12);
  });

  it("finds one page with the expected mix of items", () => {
    expect(doc.pages).toHaveLength(1);
    const count = (kind: string) => items.filter((i) => i.kind === kind).length;
    expect(count("glyph")).toBe(2266);
    expect(count("rule")).toBe(7);
    expect(count("special")).toBe(120);
    expect(count("native")).toBe(0);
  });

  it("defines the Computer Modern fonts the page uses", () => {
    const names = [...doc.fonts.values()].map((f) => f.name).sort();
    expect(names).toEqual([
      "cmbx10",
      "cmbx10",
      "cmbx12",
      "cmcsc10",
      "cmr10",
      "cmr10",
      "cmsy10",
      "cmsy6",
      "cmti10",
    ]);
    const cmr10 = [...doc.fonts.values()].find((f) => f.name === "cmr10" && f.scale === f.design);
    expect(cmr10?.scale).toBe(655360);
  });

  it("keeps every glyph inside a US Letter page", () => {
    const pt = pointsPerUnit(doc);
    for (const item of items) {
      if (item.kind !== "glyph") continue;
      expect(item.h * pt).toBeGreaterThanOrEqual(-72.27);
      expect(item.h * pt).toBeLessThan(614.3 - 72.27);
      expect(item.v * pt).toBeGreaterThanOrEqual(-72.27);
      expect(item.v * pt).toBeLessThan(795 - 72.27);
    }
  });

  it("advances by the TFM width after a set_char", () => {
    const glyphs = items.filter((i) => i.kind === "glyph");
    // Consecutive letters of a word sit exactly one width apart.
    const pairs = glyphs.slice(0, 200).filter((g, i) => {
      const next = glyphs[i + 1];
      return next && next.v === g.v && next.font === g.font && next.h === g.h + g.width;
    });
    expect(pairs.length).toBeGreaterThan(100);
  });

  it("records specials with their position", () => {
    const papersize = items.find((i) => i.kind === "special" && i.text.startsWith("papersize="));
    expect(papersize).toBeDefined();
    const color = items.filter((i) => i.kind === "special" && i.text.startsWith("color "));
    expect(color.length).toBeGreaterThan(50);
  });

  it("rejects something that is not a DVI file", () => {
    expect(() => parseDvi(new Uint8Array([1, 2, 3]), widthsFor)).toThrow(/not a DVI/);
  });
});

describe("parseDvi on a long special", () => {
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

  it("reads a special of 300,000 bytes, as one character for each byte", () => {
    // pdfTeX allows a special as long as its string pool, megabytes, and passing a call one
    // argument a byte overflows the stack at about 125,000. Every byte value is there, so a
    // decoder that is not ISO-8859-1, as TextDecoder's "latin1" is not, shows too.
    const bytes = Uint8Array.from({ length: 300_000 }, (_, i) => i % 256);
    const head = [
      ...[247, 2, ...u32(25_400_000), ...u32(473_628_672), ...u32(1_000), 0], // pre, no comment
      ...[139, ...new Array<number>(44).fill(0)], // bop: ten counters and the previous bop
      ...[242, ...u32(bytes.length)], // xxx4: the special's length, then its bytes
    ];
    const dvi = new Uint8Array(head.length + bytes.length + 1);
    dvi.set(head);
    dvi.set(bytes, head.length);
    dvi[dvi.length - 1] = 140; // eop
    const [special] = parseDvi(dvi, () => undefined).pages[0]?.items ?? [];
    const text = special?.kind === "special" ? special.text : "";
    expect(text).toHaveLength(bytes.length);
    const expected = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    expect(text === expected).toBe(true);
  });
});

describe("parseDvi on XeTeX output", () => {
  const doc = parseDvi(fixture("hello.xdv"), () => undefined);
  const page = doc.pages[0];
  if (!page) throw new Error("fixture has no page");

  it("recognises the XDV dialect and its native font definition", () => {
    expect(doc.id).toBe(7);
    expect(doc.fonts.size).toBe(0);
    const [font] = [...doc.nativeFonts.values()];
    expect(font?.name).toBe("./fonts/SourceSans3-Regular.otf");
    expect(font?.index).toBe(0);
    expect(font?.size).toBe(655360);
  });

  it("reads glyph runs with their positions and advances past them", () => {
    const runs = page.items.filter((i) => i.kind === "native");
    expect(runs).toHaveLength(3);
    const first = runs[0];
    if (first?.kind !== "native") throw new Error("not a native run");
    expect(first.glyphs.length).toBeGreaterThan(0);
    expect(first.width).toBeGreaterThan(0);
    expect(first.glyphs.every((g) => g.id > 0)).toBe(true);
  });

  it("keeps XeTeX's pdf specials", () => {
    const pagesize = page.items.find(
      (i) => i.kind === "special" && i.text.startsWith("pdf:pagesize"),
    );
    expect(pagesize).toBeDefined();
  });
});
