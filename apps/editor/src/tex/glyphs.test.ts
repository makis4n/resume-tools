import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENGINE_DIR, engineAvailable } from "../engine/node";
import {
  ACCENTS,
  accentMark,
  glyphOf,
  glyphTable,
  glyphText,
  parseAgl,
  textToCode,
} from "./glyphs";

/** A few lines of the Adobe Glyph List, as TeX Live's `glyphlist.txt` has them. */
const AGL = parseAgl(
  [
    "# Name:          Adobe Glyph List",
    "A;0041",
    "Aacute;00C1",
    "Dcroat;0110",
    "Euro;20AC",
    "acute;00B4",
    "breve;02D8",
    "degree;00B0",
    "eacute;00E9",
    "endash;2013",
    "ffi;FB03",
    "quoteright;2019",
    "dalethatafpatah;05D3 05B2",
  ].join("\n"),
);

describe("parseAgl", () => {
  it("reads each name's code points, several for some, and skips comments", () => {
    expect(AGL.size).toBe(12);
    expect(AGL.get("Euro")).toBe("€");
    expect(AGL.get("dalethatafpatah")).toBe("\u{5d3}\u{5b2}");
    expect(AGL.has("#")).toBe(false);
  });
});

describe("glyphText", () => {
  it("keeps Computer Modern's spellings ahead of the AGL", () => {
    expect(glyphText("quoteright", AGL)).toBe("'");
    expect(glyphText("endash", AGL)).toBe("--");
    expect(glyphText("ffi", AGL)).toBe("ffi");
    expect(glyphText("circumflex", AGL)).toBe("^");
  });

  it("reads single letters, then the AGL", () => {
    expect(glyphText("e", AGL)).toBe("e");
    expect(glyphText("Aacute", AGL)).toBe("Á");
    expect(glyphText("Euro", AGL)).toBe("€");
    expect(glyphText("degree", AGL)).toBe("°");
    expect(glyphText("dalethatafpatah", AGL)).toBe("\u{5d3}\u{5b2}");
    // Without the AGL, only the table and the letters.
    expect(glyphText("Aacute")).toBeUndefined();
  });

  it("reads the uniXXXX and uXXXX[XX] forms, and refuses surrogates and lowercase hex", () => {
    expect(glyphText("uni2423", AGL)).toBe("␣");
    expect(glyphText("uni00410301", AGL)).toBe("A\u{301}");
    expect(glyphText("u1F600", AGL)).toBe("\u{1f600}");
    expect(glyphText("u2423", AGL)).toBe("␣");
    expect(glyphText("uniD800", AGL)).toBeUndefined();
    expect(glyphText("uni20ac", AGL)).toBeUndefined();
    expect(glyphText("u12345678", AGL)).toBeUndefined();
  });

  it("reads a Latin ligature's code point as its letters, however the name comes to it", () => {
    const hex = ["FB00", "FB01", "FB02", "FB03", "FB04", "FB05", "FB06"];
    const letters = ["ff", "fi", "fl", "ffi", "ffl", "\u{17f}t", "st"];
    expect(hex.map((h) => glyphText(`uni${h}`, AGL))).toEqual(letters);
    expect(hex.map((h) => glyphText(`u${h}`, AGL))).toEqual(letters);
    // Without the glyph list, as `textToCode` reads a name.
    expect(hex.map((h) => glyphText(`uni${h}`))).toEqual(letters);
    // A glyph list naming one, a suffix joined to its base there, and a suffix dropped.
    const agl = parseAgl(["ff;FB00", "st;FB06"].join("\n"));
    expect(glyphText("st", agl)).toBe("st");
    expect(glyphText("f.f", agl)).toBe("ff");
    expect(glyphText("uniFB01.sc", AGL)).toBe("fi");
    // Several code points in one name, a ligature's parts, and a virtual font's with an accent.
    expect(glyphText("uniFB01FB02", AGL)).toBe("fifl");
    expect(glyphText("uniFB00_i", AGL)).toBe("ffi");
    expect(glyphText("uniFB01+acute", AGL)).toBe("f\u{ed}");
  });

  it("joins a ligature's parts, and drops a suffix from the first period", () => {
    expect(glyphText("f_f_i", AGL)).toBe("ffi");
    expect(glyphText("T_h", AGL)).toBe("Th");
    expect(glyphText("f_nosuch", AGL)).toBeUndefined();
    expect(glyphText("a.sc", AGL)).toBe("a");
    expect(glyphText("hyphen.alt", AGL)).toBe("-");
    expect(glyphText("zero.taboldstyle", AGL)).toBe("0");
    expect(glyphText(".notdef", AGL)).toBeUndefined();
  });

  it("reads a suffix the glyph list knows joined to its base, unless for private use", () => {
    // Latin Modern's TS1 names, as lm-ts1.enc gives them, and the glyph list's entries for them.
    const agl = parseAgl(
      [
        "cent;00A2",
        "centoldstyle;F7A2",
        "dollaroldstyle;F724",
        "onesuperior;00B9",
        "threesuperior;00B3",
        "twoinferior;2082",
        "twosuperior;00B2",
      ].join("\n"),
    );
    const superiors = ["one.superior", "two.superior", "three.superior", "two.inferior"];
    expect(superiors.map((name) => glyphText(name, agl))).toEqual(["¹", "²", "³", "₂"]);
    // The glyph list puts Adobe's old-style figures in the Private Use Area, which no text holds,
    // so they read as their bases, as does a suffix it does not know.
    expect(["dollar.oldstyle", "cent.oldstyle"].map((name) => glyphText(name, agl))).toEqual([
      "$",
      "¢",
    ]);
    expect(glyphText("zero.taboldstyle", agl)).toBe("0");
    expect(glyphText("a.sc", agl)).toBe("a");
    expect(glyphText(".notdef", agl)).toBeUndefined();
  });

  it("composes a virtual font's parts, putting accents after the letter", () => {
    expect(glyphText("A+breve", AGL)).toBe("Ă");
    expect(glyphText("breve+A", AGL)).toBe("Ă");
    expect(glyphText("dotlessi+acute", AGL)).toBe("í");
    expect(glyphText("A+breve.128", AGL)).toBe("Ă");
    expect(glyphText("S+S", AGL)).toBe("SS");
    expect(glyphText("q+acute", AGL)).toBe("q\u{301}");
    expect(glyphText("acute+breve", AGL)).toBe("\u{b4}\u{2d8}");
    // A part with no text, such as a rule, leaves the whole without one.
    expect(glyphText("rule+rule", AGL)).toBeUndefined();
  });

  it("does not read a name from the prototype of an object", () => {
    expect(glyphText("constructor", AGL)).toBeUndefined();
    expect(glyphText("toString")).toBeUndefined();
  });
});

describe("glyph tables", () => {
  it("hold any name as a glyph's, and give nothing for a name the font lacks", () => {
    const glyphs = glyphTable();
    glyphs["__proto__"] = { w: 1, d: "", b: null };
    const outlines = { name: "Test", encoding: ["__proto__", "constructor", "valueOf"], glyphs };
    expect(Object.getPrototypeOf(glyphs)).toBeNull();
    expect(glyphOf(outlines, 0)?.w).toBe(1);
    expect(glyphOf(outlines, 1)).toBeUndefined();
    expect(glyphOf(outlines, 2)).toBeUndefined();
    expect(glyphOf(outlines, 3)).toBeUndefined();
  });

  it("give no character to a glyph named after an object's member", () => {
    const codes = textToCode(["constructor", "toString", "__proto__", "valueOf", "endash", "a"]);
    expect([...codes]).toEqual([
      ["\u2013", 4],
      ["a", 5],
    ]);
  });
});

describe("accentMark", () => {
  it("gives the combining mark of each spacing accent, and of nothing else", () => {
    expect(ACCENTS.size).toBe(13);
    expect(accentMark("acute")).toBe("\u{301}");
    expect(accentMark("caron")).toBe("\u{30c}");
    expect(accentMark("ogonek.ts1")).toBe("\u{328}");
    expect(accentMark("quoteleft")).toBeUndefined();
    expect(accentMark("A+breve")).toBeUndefined();
  });
});

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("the Adobe Glyph List in the tree", () => {
  it("names 4,281 glyphs", () => {
    const path = "/texlive/texmf-dist/fonts/map/glyphlist/glyphlist.txt";
    const agl = parseAgl(readFileSync(join(ENGINE_DIR, "files", path), "utf8"));
    expect(agl.size).toBe(4281);
    expect(glyphText("Dcroat", agl)).toBe("\u{110}");
    expect(glyphText("Eth", agl)).toBe("\u{d0}");
  });
});
