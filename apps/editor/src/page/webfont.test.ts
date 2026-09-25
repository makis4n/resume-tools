import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Font, parse } from "opentype.js";
import { describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable } from "../engine/node";
import { type FontOutlines, glyphOf, glyphTable, glyphText } from "../tex/glyphs";
import { parseTfm } from "../tex/tfm";
import { parseType1 } from "../tex/type1";
import { FontLibrary, type PageFont } from "./fonts";
import { TexLiveIndex } from "./texlive";
import { buildWebFont, pathOf, typedCodes, webFontFamily, webFontOf } from "./webfont";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../tex/fixtures/${name}`, import.meta.url)));

/** cmr10 as the page has it, with each code's text read from its glyph's name. */
function cmr10(): PageFont {
  const outlines = parseType1(fixture("cmr10.pfb"));
  return {
    name: "cmr10",
    tfm: parseTfm(fixture("cmr10.tfm")),
    outlines,
    text: (code) =>
      glyphOf(outlines, code) === undefined ? undefined : glyphText(outlines.encoding[code] ?? ""),
  };
}

/** The glyph a character is mapped to in a font, and its name. */
function glyphFor(font: Font, char: string) {
  const glyph = font.glyphs.get(font.charToGlyphIndex(char));
  if (glyph === undefined) throw new Error(`no glyph for ${char}`);
  return glyph;
}

describe("buildWebFont on cmr10", () => {
  const page = cmr10();
  const outlines = page.outlines as FontOutlines;
  const font = parse(webFontOf(page));
  const codeOf = (name: string) => outlines.encoding.indexOf(name);

  it("has the spike's vertical metrics, which the overlay positions by", () => {
    expect(font.unitsPerEm).toBe(1000);
    expect(font.ascender).toBe(800);
    expect(font.descender).toBe(-200);
    expect(font.tables.os2).toMatchObject({
      sTypoAscender: 800,
      sTypoDescender: -200,
      sTypoLineGap: 0,
      usWinAscent: 800,
      usWinDescent: 200,
    });
    expect(font.getEnglishName("fontFamily")).toBe(webFontFamily("cmr10"));
    expect(webFontFamily("cmr10")).toBe("rt-cmr10");
    // No layout features: the breaker already set the ligatures and kerns it needs.
    for (const table of ["gsub", "gpos", "kern"]) expect(font.tables[table], table).toBeUndefined();
  });

  it("has .notdef, then a glyph for each code with an outline, with its advance and shape", () => {
    const drawn = outlines.encoding.filter(
      (name, code) => name !== ".notdef" && glyphOf(outlines, code) !== undefined,
    );
    expect(font.glyphs.get(0)?.name).toBe(".notdef");
    // Every drawn code, and the no-break space, which no code of cmr10 is typed as.
    expect(font.glyphs.length).toBe(1 + drawn.length + 1);
    for (const name of ["a", "fi", "Omega", "endash", "quotedblleft"]) {
      const code = codeOf(name);
      const outline = outlines.glyphs[name];
      const glyph = font.glyphs.get(1 + drawn.slice(0, code).length);
      expect(glyph?.name, name).toBe(`code${code}`);
      expect(glyph?.advanceWidth, name).toBe(Math.round(outline?.w ?? Number.NaN));
      const box = glyph?.path.getBoundingBox();
      const [xMin, yMin, xMax, yMax] = outline?.b ?? [];
      for (const [got, want] of [
        [box?.x1, xMin],
        [box?.y1, yMin],
        [box?.x2, xMax],
        [box?.y2, yMax],
      ])
        expect(Math.abs((got ?? Number.NaN) - (want ?? Number.NaN)), name).toBeLessThanOrEqual(1);
    }
  });

  it("maps each character to the glyph its code is typed as", () => {
    expect(glyphFor(font, "a").name).toBe(`code${codeOf("a")}`);
    // The i at its own code wins over the dotless i, which reads as i too.
    expect(glyphFor(font, "i").name).toBe("code105");
    expect(codeOf("dotlessi")).toBeLessThan(105);
    // What TeX reaches through a ligature, a text may spell with one character.
    const spelled: [string, string][] = [
      ["–", "endash"],
      ["—", "emdash"],
      ["“", "quotedblleft"],
      ["”", "quotedblright"],
      ["‘", "quoteleft"],
      ["’", "quoteright"],
    ];
    for (const [char, name] of spelled)
      expect(glyphFor(font, char).name, name).toBe(`code${codeOf(name)}`);
    expect(font.charToGlyphIndex("\u{1f680}")).toBe(0);
  });

  it("sets a space as wide as TeX's interword space", () => {
    // cmr10's built-in encoding has a space at 160, as wide as the TFM's 3.33333 pt at 10 pt.
    expect(glyphFor(font, " ").name).toBe(`code${codeOf("space")}`);
    expect(glyphFor(font, " ").advanceWidth).toBe(333);
    const nbsp = glyphFor(font, " ");
    expect(nbsp.name).toBe("space");
    expect(nbsp.advanceWidth).toBe(333);
    expect(nbsp.path.commands).toEqual([]);
  });

  it("gives the breaker the characters the web font maps", () => {
    const codes = typedCodes(outlines, page.text);
    for (const [char, code] of codes) expect(glyphFor(font, char).name, char).toBe(`code${code}`);
  });
});

describe("buildWebFont", () => {
  /** A font of three codes: a composed glyph, one named apart by its code, and one repeated. */
  function composed(): FontOutlines {
    const glyphs = glyphTable();
    glyphs["A+breve"] = { w: 722.2, d: "M0 0L700 0L350 700Z", b: [0, 0, 700, 700] };
    glyphs["a.200"] = { w: 500, d: "M0 0Q250 500 500 0Z", b: [0, 0, 500, 250] };
    glyphs.hyphen = { w: 333, d: "M10 200L300 200L300 250L10 250Z", b: [10, 200, 300, 250] };
    const encoding = Array.from({ length: 256 }, () => ".notdef");
    encoding[128] = "A+breve";
    encoding[200] = "a.200";
    encoding[45] = "hyphen";
    encoding[127] = "hyphen";
    return { name: "ptmr8t", encoding, glyphs };
  }
  const texts: Record<number, string> = { 128: "Ă", 200: "a", 45: "-", 127: "-" };

  it("takes a virtual font's composed names, and a glyph used at two codes", () => {
    const font = parse(buildWebFont("ptmr8t", composed(), (code) => texts[code], 250));
    expect(font.glyphs.length).toBe(1 + 4 + 1);
    expect(glyphFor(font, "Ă").name).toBe("code128");
    expect(glyphFor(font, "Ă").advanceWidth).toBe(722);
    expect(glyphFor(font, "a").name).toBe("code200");
    // The hyphen at its own code wins; the one at 127 is in the font with no character.
    expect(glyphFor(font, "-").name).toBe("code45");
    expect(font.glyphs.get(2)?.name).toBe("code127");
    expect(glyphFor(font, " ").advanceWidth).toBe(250);
  });

  it("keeps a quadratic curve as a curve", () => {
    const font = parse(buildWebFont("ptmr8t", composed(), (code) => texts[code], 250));
    const box = glyphFor(font, "a").path.getBoundingBox();
    expect(box.y2).toBeGreaterThan(200);
    expect(box.y2).toBeLessThanOrEqual(251);
  });

  it("types no character as a code without an outline, or one whose text is longer", () => {
    const outlines = composed();
    outlines.encoding[66] = "B";
    const codes = typedCodes(outlines, (code) => (code === 66 ? "B" : code === 128 ? "Ă" : "ff"));
    expect(codes.has("B")).toBe(false);
    expect([...codes.keys()]).toEqual(["Ă"]);
  });
});

describe("pathOf", () => {
  it("reads absolute moves, lines, curves and closes, lines after a move included", () => {
    const path = pathOf("M0 0 10 0L10 10C10 15 5 20 0 20Q-5 10 0 0Z");
    expect(path.commands.map((command) => command.type)).toEqual(["M", "L", "L", "C", "Q", "Z"]);
    expect(path.commands[1]).toMatchObject({ x: 10, y: 0 });
  });

  it("refuses path data it would draw differently from the page", () => {
    expect(() => pathOf("M0 0h10")).toThrow("not only M, L, C, Q or Z");
    expect(() => pathOf("M0 0L1")).toThrow("gives L 1 numbers");
    expect(() => pathOf("Z1")).toThrow("gives Z 1 numbers");
  });
});

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("webFontOf over TeX Live", () => {
  const manifest = engineAvailable()
    ? (JSON.parse(readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8")) as EngineManifest)
    : ({ release: "", layout: 0, bundles: [], files: {} } as EngineManifest);
  const fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
    readFileSync(join(ENGINE_DIR, "files", path)),
  );

  it("builds Latin Modern in T1, its space from its TFM, and Times, a virtual font", async () => {
    for (const [name, sample] of [
      ["ec-lmr10", "Ran a café pilot – €3 won’t"],
      ["ptmr8t", "Ăla Đurva naïve – “quoted”"],
    ] as const) {
      const page = await fonts.load(name);
      expect(page?.outlines, name).toBeDefined();
      const font = parse(webFontOf(page as PageFont));
      const codes = typedCodes(page?.outlines as FontOutlines, (page as PageFont).text);
      for (const char of sample) {
        if (char === " " || !codes.has(char)) continue;
        const outline = glyphOf(page?.outlines as FontOutlines, codes.get(char) ?? -1);
        expect(glyphFor(font, char).advanceWidth, `${name} ${char}`).toBe(
          Math.round(outline?.w ?? Number.NaN),
        );
      }
      // T1 has no space glyph, so the space is the TFM's: 3.33333 pt at 10 pt, and Times's 0.25 em.
      expect(glyphFor(font, " ").name, name).toBe("space");
      expect(glyphFor(font, " ").advanceWidth, name).toBe(name === "ptmr8t" ? 250 : 333);
      for (const char of "é–’") expect(codes.has(char), `${name} ${char}`).toBe(true);
    }
  });
});
