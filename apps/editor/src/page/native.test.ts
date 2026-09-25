import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Font, Glyph, Path } from "opentype.js";
import { describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable } from "../engine/node";
import { MAX_FONT_BYTES, nativeFileName, parseNativeFont } from "./native";

/** A glyph's outline: a box 700 units tall, 50 units in from each side of its advance. */
function box(width: number): Path {
  const path = new Path();
  path.moveTo(50, 0);
  path.lineTo(width - 50, 0);
  path.lineTo(width - 50, 700);
  path.lineTo(50, 700);
  path.close();
  return path;
}

/**
 * An invented OpenType font, written by opentype.js: a space; an f and an i, and their ligature,
 * which its `liga` feature makes of them and its character map also gives U+FB01 ﬁ, as Roboto's
 * does; an a the map gives two characters; a small capital a nothing reaches; and a hyphen.
 */
function inventedFont(): Uint8Array {
  const glyphs = [
    new Glyph({ name: ".notdef", advanceWidth: 500, path: new Path() }),
    new Glyph({ name: "space", unicodes: [0x20, 0xa0], advanceWidth: 250, path: new Path() }),
    new Glyph({ name: "f", unicodes: [0x66], advanceWidth: 300, path: box(300) }),
    new Glyph({ name: "i", unicodes: [0x69], advanceWidth: 250, path: box(250) }),
    new Glyph({ name: "f_i", unicodes: [0xfb01], advanceWidth: 520, path: box(520) }),
    new Glyph({ name: "a", unicodes: [0xaa, 0x61], advanceWidth: 480, path: box(480) }),
    new Glyph({ name: "a.sc", advanceWidth: 460, path: box(460) }),
    new Glyph({ name: "hyphen", unicodes: [0x2d], advanceWidth: 330, path: box(330) }),
  ];
  const font = new Font({
    familyName: "Invented",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 900,
    descender: -300,
    glyphs,
  });
  font.substitution.add("liga", { sub: [2, 3], by: 4 });
  return new Uint8Array(font.toArrayBuffer());
}

describe("parseNativeFont on an invented font", () => {
  const bytes = inventedFont();
  const file = parseNativeFont(bytes);

  it("reads each glyph's advance, outline and box, in font units", () => {
    expect(file.unitsPerEm).toBe(1000);
    expect(file.advanceOf(2)).toBe(300);
    expect(file.advanceOf(4)).toBe(520);
    expect(file.pathOf(2)).toBe("M50 0L250 0L250 700L50 700Z");
    expect(file.boxOf(2)).toEqual([50, 0, 250, 700]);
    // A glyph with no outline, such as the space, is not drawn and has no box.
    expect(file.pathOf(1)).toBeUndefined();
    expect(file.boxOf(1)).toBeUndefined();
  });

  it("reads a glyph as the lowest character the character map gives it", () => {
    // The a is U+0061 and U+00AA ª: it reads as the a.
    expect(file.textOf(5)).toBe("a");
    expect(file.textOf(2)).toBe("f");
    expect(file.textOf(7)).toBe("-");
  });

  it("reads a ligature as its components, though the character map gives it U+FB01", () => {
    // XeTeX's shaping makes the ligature of an f and an i, which the text holds as fi.
    expect(file.textOf(4)).toBe("fi");
  });

  it("gives a glyph nothing reaches no text, and one past the font's glyphs nothing at all", () => {
    expect(file.textOf(6)).toBeUndefined();
    for (const glyph of [8, 1000, -1, 1.5]) {
      expect(file.textOf(glyph), String(glyph)).toBeUndefined();
      expect(file.advanceOf(glyph), String(glyph)).toBeUndefined();
      expect(file.pathOf(glyph), String(glyph)).toBeUndefined();
    }
  });

  it("finds a character's glyph through the character map, and the space's advance", () => {
    expect(file.glyphFor("f")).toBe(2);
    expect(file.glyphFor(" ")).toBe(1);
    expect(file.glyphFor("ﬁ")).toBe(4);
    // A character the font has no glyph for, and more than one character.
    expect(file.glyphFor("z")).toBeUndefined();
    expect(file.glyphFor("fi")).toBeUndefined();
    expect(file.spaceAdvance).toBe(250);
  });

  it("gives the ascent and descent as fractions of the em, and keeps the file's bytes", () => {
    expect(file.ascent).toBeCloseTo(0.9, 6);
    expect(file.descent).toBeCloseTo(0.3, 6);
    expect(file.bytes).toBe(bytes);
  });
});

describe("parseNativeFont's bounds", () => {
  it("refuses a file of more than 32 MB before it reads it, and one that is not a font", () => {
    expect(() => parseNativeFont(new Uint8Array(MAX_FONT_BYTES + 1))).toThrow(
      `more than ${MAX_FONT_BYTES}`,
    );
    expect(() => parseNativeFont(new Uint8Array([0, 1, 0, 0, 0, 0]))).toThrow();
  });
});

describe("nativeFileName", () => {
  it("is the last segment of the path XeTeX wrote", () => {
    expect(nativeFileName("/texlive/texmf-dist/fonts/opentype/google/roboto/Roboto-Bold.otf")).toBe(
      "Roboto-Bold.otf",
    );
    expect(nativeFileName("./fonts/SourceSans3-Regular.otf")).toBe("SourceSans3-Regular.otf");
    expect(nativeFileName("Lato-Regular.ttf")).toBe("Lato-Regular.ttf");
  });
});

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("parseNativeFont over TeX Live's fonts", () => {
  const manifest = engineAvailable()
    ? (JSON.parse(readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8")) as EngineManifest)
    : ({ release: "", layout: 0, bundles: [], files: {} } as EngineManifest);
  const read = (name: string) => {
    const path = Object.keys(manifest.files).find((each) => each.endsWith(`/${name}`));
    if (path === undefined) throw new Error(`the tree has no ${name}`);
    return parseNativeFont(new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))));
  };

  it("reads Roboto's fi as fi, its en dash as one, and its space as XeTeX measures it", () => {
    const roboto = read("Roboto-Regular.otf");
    const fi = roboto.glyphFor("ﬁ");
    expect(fi).toBeDefined();
    expect(roboto.textOf(fi ?? -1)).toBe("fi");
    expect(roboto.textOf(roboto.glyphFor("–") ?? -1)).toBe("–");
    // 247 units of a 1000-unit em: XeTeX's \fontdimen2 of Roboto at 10 pt is 2.47 pt.
    expect(roboto.spaceAdvance).toBe(247);
  });

  it("reads Lato's TrueType outlines, in quadratic curves, and its ligatures", () => {
    const lato = read("Lato-Regular.ttf");
    expect(lato.unitsPerEm).toBe(2000);
    expect(lato.pathOf(lato.glyphFor("a") ?? -1)).toMatch(/Q/);
    // Lato's liga lookups are extension lookups, which are read through.
    expect(lato.textOf(lato.glyphFor("ﬁ") ?? -1)).toBe("fi");
  });

  it("reads Source Sans's ff, which the character map does not reach, as its letters", () => {
    const sans = read("SourceSansPro-Regular.otf");
    const f = sans.glyphFor("f") ?? -1;
    const ligatures = Array.from({ length: 3000 }, (_, glyph) => glyph).filter(
      (glyph) => sans.textOf(glyph) === "ff" && glyph !== f,
    );
    expect(ligatures.length).toBeGreaterThan(0);
  });

  it("reads a Font Awesome icon as the private-use character the header sets it with", () => {
    const icons = read("FontAwesome5Free-Solid-900.otf");
    const envelope = icons.glyphFor("");
    expect(envelope).toBeDefined();
    expect(icons.textOf(envelope ?? -1)).toBe("");
    expect(icons.pathOf(envelope ?? -1)).toBeDefined();
  });
});
