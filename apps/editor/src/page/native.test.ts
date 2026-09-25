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
 * does; an a the map gives two characters; a small capital a nothing reaches; a hyphen the map
 * also gives the soft hyphen, U+2010 and U+2011, an apostrophe it also gives U+02BC ʼ, and a
 * micro sign it also gives Greek mu, as Source Sans's map does; and an Omega it gives the ohm sign
 * too, as Roboto's does.
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
    new Glyph({
      name: "hyphentwo",
      unicodes: [0x2011, 0xad, 0x2010, 0x2d0],
      advanceWidth: 330,
      path: box(330),
    }),
    new Glyph({ name: "quoteright", unicodes: [0x2bc, 0x2019], advanceWidth: 200, path: box(200) }),
    new Glyph({ name: "mu", unicodes: [0x3bc, 0xb5], advanceWidth: 520, path: box(520) }),
    new Glyph({ name: "Omega", unicodes: [0x2126, 0x3a9], advanceWidth: 700, path: box(700) }),
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

  it("reads a glyph as the character the character map gives it", () => {
    expect(file.textOf(2)).toBe("f");
    expect(file.textOf(7)).toBe("-");
    expect(file.textsOf(2)).toEqual(["f"]);
  });

  it("reads a glyph the map gives several characters as each, the one a text likelier holds first", () => {
    // ASCII first: the a is U+0061 and U+00AA ª.
    expect(file.textsOf(5)).toEqual(["a", "ª"]);
    // A spacing modifier letter last but for what a text never holds: U+02D0 ː after the hyphens,
    // and the soft hyphen, which the generator leaves out, after it.
    expect(file.textOf(8)).toBe("\u{2010}");
    expect(file.textsOf(8)).toEqual(["\u{2010}", "\u{2011}", "\u{2d0}", "\u{ad}"]);
    // General punctuation before a spacing modifier letter, as tex-text curls the apostrophe.
    expect(file.textOf(9)).toBe("\u{2019}");
    expect(file.textsOf(9)).toEqual(["\u{2019}", "\u{2bc}"]);
    // The micro sign, which a keyboard types, before Greek mu, lowest first.
    expect(file.textsOf(10)).toEqual(["\u{b5}", "\u{3bc}"]);
    // A character composition replaces, as the ohm sign by Omega, last: the text is composed.
    expect(file.textsOf(11)).toEqual(["\u{3a9}", "\u{2126}"]);
  });

  it("reads a ligature as its components, though the character map gives it U+FB01", () => {
    // XeTeX's shaping makes the ligature of an f and an i, which the text holds as fi.
    expect(file.textOf(4)).toBe("fi");
  });

  it("gives a glyph nothing reaches no text, and one past the font's glyphs nothing at all", () => {
    expect(file.textOf(6)).toBeUndefined();
    expect(file.textsOf(6)).toEqual([]);
    for (const glyph of [12, 1000, -1, 1.5]) {
      expect(file.textOf(glyph), String(glyph)).toBeUndefined();
      expect(file.textsOf(glyph), String(glyph)).toEqual([]);
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
