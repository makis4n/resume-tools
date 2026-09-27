import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Font, Glyph, Path } from "opentype.js";
import { describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable } from "../engine/node";
import { bound, cpuMs, fastest } from "../test/timing";
import {
  MAX_FONT_BYTES,
  MAX_SUBTABLES,
  nativeCoverage,
  nativeFileName,
  parseNativeFont,
  singleFeaturesOn,
} from "./native";

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
 * micro sign it also gives Greek mu, as Source Sans's map does; an Omega it gives the ohm sign
 * too, as Roboto's does; and the ligatures its `ccmp` feature makes, which the map does not reach:
 * of l, a middle dot and l, as Source Sans's makes for Catalan, and of d and a combining dot below,
 * as Roboto's makes where it has no ḍ.
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
    new Glyph({ name: "l", unicodes: [0x6c], advanceWidth: 240, path: box(240) }),
    new Glyph({ name: "periodcentered", unicodes: [0xb7], advanceWidth: 200, path: box(200) }),
    new Glyph({ name: "l_periodcentered_l", advanceWidth: 600, path: box(600) }),
    new Glyph({ name: "d", unicodes: [0x64], advanceWidth: 520, path: box(520) }),
    new Glyph({ name: "dotbelowcomb", unicodes: [0x323], advanceWidth: 0, path: box(100) }),
    new Glyph({ name: "d_dotbelowcomb.ccmp", advanceWidth: 520, path: box(520) }),
  ];
  const font = new Font({
    familyName: "Invented",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 900,
    descender: -300,
    glyphs,
  });
  // Features go in in alphabetical order, as opentype.js writes them.
  font.substitution.add("ccmp", { sub: [12, 13, 12], by: 14 });
  font.substitution.add("ccmp", { sub: [15, 16], by: 17 });
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
    // XeTeX's shaping makes the ligature of an f and an i, which the text holds as fi, and sets
    // the same glyph for the U+FB01 a text may hold.
    expect(file.textOf(4)).toBe("fi");
    expect(file.textsOf(4)).toEqual(["fi", "\u{fb01}"]);
  });

  it("reads a ligature of the ccmp feature, which HarfBuzz applies unasked, as its components", () => {
    expect(file.textOf(14)).toBe("l\u{b7}l");
    // A combining mark composes with the letter before it, as the generator keeps the text.
    expect(file.textOf(17)).toBe("\u{1e0d}");
  });

  it("gives a glyph nothing reaches no text, and one past the font's glyphs nothing at all", () => {
    expect(file.textOf(6)).toBeUndefined();
    expect(file.textsOf(6)).toEqual([]);
    for (const glyph of [18, 1000, -1, 1.5]) {
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

  it("covers a character its map gives a glyph, or whose letter and marks it does", () => {
    expect(file.covers("f")).toBe(true);
    expect(file.covers("\u{2019}")).toBe(true);
    // HarfBuzz sets a character the font lacks as its decomposition, when the font has it all.
    expect(file.covers("\u{1e0d}")).toBe(true);
    expect(file.covers("z")).toBe(false);
    expect(file.covers("\u{1e0c}")).toBe(false);
    expect(file.covers("\u{2192}")).toBe(false);
  });

  it("gives the ascent and descent as fractions of the em, and keeps the file's bytes", () => {
    expect(file.ascent).toBeCloseTo(0.9, 6);
    expect(file.descent).toBeCloseTo(0.3, 6);
    expect(file.bytes).toBe(bytes);
  });
});

/** A single substitution lookup as opentype.js writes one: its subtables, in order. */
const single = (...subtables: object[]) => ({ lookupType: 1, lookupFlag: 0, subtables });

/** A language system that takes the features at `indexes` of the feature list. */
const system = (indexes: number[]) => ({
  reserved: 0,
  reqFeatureIndex: 0xffff,
  featureIndexes: indexes,
});

/**
 * An invented OpenType font whose GSUB table holds single substitutions, written by hand, since
 * opentype.js adds none of these features itself. `c2sc` makes the small capital a of the A and
 * the small capital i of the I, in one lookup of two subtables that add to the glyph's index
 * (format 1), the second taking from it; `smcp` makes them of the a and the i, listing each
 * (format 2); `onum` makes an old-style one of the one, and `pnum` a proportional one of that, a
 * chain the one reaches only through both; the Turkish language system's `smcp` makes a dotted
 * small capital of the i first, which XeTeX, shaping the default language, never applies;
 * `salt`, a feature the page does not read through, makes an alternate a; and `sups` makes the
 * superior two, which the map gives U+00B2 ², of the two, and the modifier letter h, U+02B0 ʰ, of
 * the h, as Source Sans Pro's does.
 */
function substitutingFont(): Uint8Array {
  const glyph = (name: string, advanceWidth: number, unicodes: number[] = []) =>
    new Glyph({ name, unicodes, advanceWidth, path: box(advanceWidth) });
  const font = new Font({
    familyName: "Invented Caps",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 900,
    descender: -300,
    glyphs: [
      new Glyph({ name: ".notdef", advanceWidth: 500, path: new Path() }),
      new Glyph({ name: "space", unicodes: [0x20], advanceWidth: 250, path: new Path() }),
      glyph("A", 600, [0x41]),
      glyph("a.sc", 520),
      glyph("a", 480, [0x61]),
      glyph("i.sc", 260),
      glyph("i", 230, [0x69]),
      glyph("I", 280, [0x49]),
      glyph("idotaccent.sc", 270),
      glyph("one", 550, [0x31]),
      glyph("one.osf", 540),
      glyph("one.posf", 400),
      glyph("a.alt", 490),
      glyph("two", 550, [0x32]),
      glyph("twosuperior", 330, [0xb2]),
      glyph("h", 520, [0x68]),
      glyph("hsuperior", 310, [0x2b0]),
    ],
  });
  const list = (glyphs: number[]) => ({ format: 1, glyphs });
  font.tables.gsub = {
    version: 1,
    scripts: [
      {
        tag: "DFLT",
        script: { defaultLangSys: system([0, 1, 2, 3, 4, 6]), langSysRecords: [] },
      },
      {
        tag: "latn",
        script: {
          defaultLangSys: system([0, 1, 2, 3, 4, 6]),
          langSysRecords: [{ tag: "TRK ", langSys: system([0, 1, 2, 3, 5, 6]) }],
        },
      },
    ],
    features: [
      { tag: "c2sc", feature: { featureParams: 0, lookupListIndexes: [0] } },
      { tag: "onum", feature: { featureParams: 0, lookupListIndexes: [3] } },
      { tag: "pnum", feature: { featureParams: 0, lookupListIndexes: [4] } },
      { tag: "salt", feature: { featureParams: 0, lookupListIndexes: [5] } },
      { tag: "smcp", feature: { featureParams: 0, lookupListIndexes: [2] } },
      { tag: "smcp", feature: { featureParams: 0, lookupListIndexes: [1, 2] } },
      { tag: "sups", feature: { featureParams: 0, lookupListIndexes: [6] } },
    ],
    lookups: [
      single(
        { substFormat: 1, coverage: list([2]), deltaGlyphId: 1 },
        { substFormat: 1, coverage: list([7]), deltaGlyphId: -2 },
      ),
      single({ substFormat: 2, coverage: list([6]), substitute: [8] }),
      single({ substFormat: 2, coverage: list([4, 6]), substitute: [3, 5] }),
      single({ substFormat: 2, coverage: list([9]), substitute: [10] }),
      single({ substFormat: 2, coverage: list([10]), substitute: [11] }),
      single({ substFormat: 2, coverage: list([4]), substitute: [12] }),
      single({ substFormat: 2, coverage: list([13, 15]), substitute: [14, 16] }),
    ],
  };
  return new Uint8Array(font.toArrayBuffer());
}

describe("parseNativeFont's reading of single substitutions", () => {
  const file = parseNativeFont(substitutingFont());

  it("reads a glyph a single substitution makes as each glyph it is made of", () => {
    // Made by smcp of the a, and by c2sc of the A, whose subtable adds 1 to its index.
    expect(file.textsOf(3)).toEqual(["a", "A"]);
    // And of the I by a subtable that takes 2 from its index.
    expect(file.textsOf(5)).toEqual(["i", "I"]);
    // A language's lookup is read through too: the glyph can come from nowhere else.
    expect(file.textsOf(8)).toEqual(["i"]);
    expect(file.madeBy(3)).toEqual(["smcp", "c2sc"]);
    expect(file.madeBy(4)).toEqual([]);
  });

  it("reads a chain of substitutions as its start, and leaves a feature it does not read alone", () => {
    expect(file.textsOf(10)).toEqual(["1"]);
    expect(file.textsOf(11)).toEqual(["1"]);
    expect(file.madeBy(11)).toEqual(["pnum"]);
    // salt's alternate a has no text: the page reads no feature but those it names.
    expect(file.textsOf(12)).toEqual([]);
    expect(file.madeBy(12)).toEqual([]);
  });

  it("reads a glyph as its own character first, and as what it is made from after", () => {
    // The map gives the superior two ², which sups makes of the two: a text holds the ² itself.
    expect(file.textOf(14)).toBe("\u{b2}");
    expect(file.textsOf(14)).toEqual(["\u{b2}", "2"]);
    // A spacing modifier letter too, which a text holds more rarely than its letter.
    expect(file.textOf(16)).toBe("\u{2b0}");
    expect(file.textsOf(16)).toEqual(["\u{2b0}", "h"]);
    expect(file.madeBy(14)).toEqual(["sups"]);
  });

  it("reads a glyph as what it is made from only for the features its file is loaded with", () => {
    // sups loaded: the ² stands for the 2 as well, which a text set in superiors holds.
    expect(file.textsOf(14, ["sups"])).toEqual(["\u{b2}", "2"]);
    expect(file.textsOf(16, ["smcp", "sups"])).toEqual(["\u{2b0}", "h"]);
    // Not loaded, the glyph can come only from the character the map gives it.
    expect(file.textsOf(14, ["smcp", "pnum"])).toEqual(["\u{b2}"]);
    expect(file.textOf(16, [])).toBe("\u{2b0}");
    // A small capital reads as the letter of each feature loaded that makes it, and none else.
    expect(file.textsOf(3, ["smcp"])).toEqual(["a"]);
    expect(file.textsOf(3, ["c2sc"])).toEqual(["A"]);
    expect(file.textsOf(3, ["pnum"])).toEqual([]);
    expect(file.textOf(3, [])).toBeUndefined();
    // A chain reads through only when every step's feature is loaded.
    expect(file.textsOf(11, ["pnum"])).toEqual([]);
    expect(file.textsOf(11, ["onum", "pnum"])).toEqual(["1"]);
    // A tag outside SINGLE_FEATURES turns nothing on.
    expect(file.textsOf(12, ["salt"])).toEqual([]);
  });

  it("substitutes a glyph as XeTeX's shaping does, lookup by lookup in the default language", () => {
    expect(file.substitute(4, ["smcp"])).toBe(3);
    expect(file.substitute(2, ["c2sc"])).toBe(3);
    expect(file.substitute(7, ["c2sc"])).toBe(5);
    // The Turkish lookup comes first in the lookup list, but the default language has it not.
    expect(file.substitute(6, ["smcp"])).toBe(5);
    // smcp leaves a capital as it is, and no feature leaves every glyph so.
    expect(file.substitute(2, ["smcp"])).toBe(2);
    expect(file.substitute(4, [])).toBe(4);
    // pnum makes the proportional one of the old-style one only, so it takes both.
    expect(file.substitute(9, ["onum"])).toBe(10);
    expect(file.substitute(9, ["pnum"])).toBe(9);
    expect(file.substitute(9, ["pnum", "onum"])).toBe(11);
    // A feature the page does not read through is not applied either.
    expect(file.substitute(4, ["salt"])).toBe(4);
  });
});

/**
 * An invented OpenType font of `glyphs` glyphs, a space and an a among them, whose `smcp` lookup
 * holds the subtables given, each as opentype.js writes one, its a the third glyph.
 */
function smcpFont(glyphs: number, subtables: object[]): Uint8Array {
  const font = new Font({
    familyName: "Invented Ranges",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 900,
    descender: -300,
    glyphs: [
      new Glyph({ name: ".notdef", advanceWidth: 500, path: new Path() }),
      new Glyph({ name: "space", unicodes: [0x20], advanceWidth: 250, path: new Path() }),
      new Glyph({ name: "a", unicodes: [0x61], advanceWidth: 480, path: box(480) }),
      ...Array.from(
        { length: glyphs - 3 },
        (_, i) => new Glyph({ name: `g${i + 3}`, advanceWidth: 460, path: box(460) }),
      ),
    ],
  });
  font.tables.gsub = {
    version: 1,
    scripts: [{ tag: "DFLT", script: { defaultLangSys: system([0]), langSysRecords: [] } }],
    features: [{ tag: "smcp", feature: { featureParams: 0, lookupListIndexes: [0] } }],
    lookups: [single(...subtables)],
  };
  return new Uint8Array(font.toArrayBuffer());
}

/** A subtable that adds one to each glyph of one range, from the a to `end`. */
const plusOne = (end: number) => ({
  substFormat: 1,
  coverage: { format: 2, ranges: [{ start: 2, end, index: 0 }] },
  deltaGlyphId: 1,
});

describe("parseNativeFont's reading of a hostile font's substitutions", () => {
  /** Read a file whole, its substitutions and its texts, as the page does. */
  const readAll = (bytes: Uint8Array) => {
    const file = parseNativeFont(bytes);
    file.substitute(2, ["smcp"]);
    file.textsOf(3);
    return file;
  };

  it("walks a range only over the glyphs the font has, in CPU time and memory", () => {
    // Hundreds of subtables, each running a range from the a to 65,535, as against the same
    // subtables running to the font's last glyph. Read a glyph at a time to 65,535 in each, as
    // 26 million substitutions of which the first subtable's alone count, the hostile font took
    // 1,857 ms of CPU time here against 0.9 ms; walked over the font's own 62, 0.16 ms against
    // 0.16 ms. The tree's fonts have 31 such subtables at most.
    const hostile = smcpFont(
      64,
      Array.from({ length: 400 }, () => plusOne(65_535)),
    );
    const tame = smcpFont(
      64,
      Array.from({ length: 400 }, () => plusOne(63)),
    );
    const [far, near] = fastest([() => readAll(hostile), () => readAll(tame)], 3);
    expect(far).toBeLessThan(bound(3, near ?? 0));
    expect(cpuMs(() => readAll(hostile))).toBeLessThan(1_000);
    // What reading it leaves on the heap, the parsed file and 61 substitutions: 0.45 MB here.
    const before = process.memoryUsage().heapUsed;
    const kept = readAll(hostile);
    const grown = process.memoryUsage().heapUsed - before;
    expect(grown).toBeLessThan(64 * 2 ** 20);
    // The first subtable that covers a glyph makes its substitution: the a's small capital.
    expect(kept.substitute(2, ["smcp"])).toBe(3);
    expect(kept.textsOf(3)).toEqual(["a"]);
    expect(kept.substitute(63, ["smcp"])).toBe(63);
  });

  it("reads no glyph the font has not, as covered or as made", () => {
    const file = parseNativeFont(
      smcpFont(8, [
        // A glyph past the font's, and a range past them: read as nothing.
        { substFormat: 2, coverage: { format: 1, glyphs: [60_000, 3] }, substitute: [2, 4] },
        {
          substFormat: 1,
          coverage: { format: 2, ranges: [{ start: 9, end: 65_535, index: 0 }] },
          deltaGlyphId: -7,
        },
        // The a made into a glyph past the font's: HarfBuzz takes no later subtable for it.
        { substFormat: 2, coverage: { format: 1, glyphs: [2] }, substitute: [60_000] },
        { substFormat: 2, coverage: { format: 1, glyphs: [2, 5] }, substitute: [6, 7] },
      ]),
    );
    expect(file.substitute(3, ["smcp"])).toBe(4);
    expect(file.substitute(2, ["smcp"])).toBe(2);
    expect(file.madeBy(6)).toEqual([]);
    expect(file.textsOf(6)).toEqual([]);
    // The fifth glyph comes of the fourth subtable alone, its first that covers it.
    expect(file.substitute(5, ["smcp"])).toBe(7);
    expect(file.madeBy(7)).toEqual(["smcp"]);
  });

  it("reads a glyph's substitution from the first subtable that covers it, once", () => {
    const file = parseNativeFont(
      smcpFont(8, [
        { substFormat: 2, coverage: { format: 1, glyphs: [2] }, substitute: [3] },
        { substFormat: 2, coverage: { format: 1, glyphs: [2, 2, 4] }, substitute: [5, 6, 7] },
      ]),
    );
    expect(file.substitute(2, ["smcp"])).toBe(3);
    expect(file.madeBy(5)).toEqual([]);
    expect(file.textsOf(3)).toEqual(["a"]);
    expect(file.substitute(4, ["smcp"])).toBe(7);
  });

  it(`walks at most ${MAX_SUBTABLES} subtables of a font's lookups`, () => {
    const empty = { substFormat: 2, coverage: { format: 1, glyphs: [] }, substitute: [] };
    const cover = { substFormat: 2, coverage: { format: 1, glyphs: [2] }, substitute: [3] };
    const within = parseNativeFont(smcpFont(8, [...Array(MAX_SUBTABLES - 1).fill(empty), cover]));
    expect(within.substitute(2, ["smcp"])).toBe(3);
    const past = parseNativeFont(smcpFont(8, [...Array(MAX_SUBTABLES).fill(empty), cover]));
    expect(past.substitute(2, ["smcp"])).toBe(2);
    expect(past.textsOf(3)).toEqual([]);
  });
});

describe("singleFeaturesOn", () => {
  it("gives the features of a XeTeX feature string that substitute glyphs, as its last say", () => {
    expect(singleFeaturesOn("script=latn;language=dflt;+pnum;+lnum;mapping=tex-text")).toEqual([
      "pnum",
      "lnum",
    ]);
    // Off, and on with 0, turn one off; a bare tag is no feature to XeTeX.
    expect(singleFeaturesOn("+smcp;+onum;-onum;+tnum=0;+case=1;+liga;sups")).toEqual([
      "smcp",
      "case",
    ]);
    // A shape's features come after its family's, and the last say wins.
    expect(singleFeaturesOn("+smcp;-smcp;+smcp")).toEqual(["smcp"]);
    expect(singleFeaturesOn("letterspace=6.0;embolden=1.5;+ss01")).toEqual([]);
    expect(singleFeaturesOn(undefined)).toEqual([]);
  });
});

/** A font of a box for each character a list gives, written by opentype.js. */
function fontOf(family: string, characters: number[]): Uint8Array {
  const glyphs = [
    new Glyph({ name: ".notdef", advanceWidth: 500, path: new Path() }),
    ...characters.map(
      (point) =>
        new Glyph({
          name: `u${point.toString(16)}`,
          unicodes: [point],
          advanceWidth: 500,
          path: box(500),
        }),
    ),
  ];
  const font = new Font({
    familyName: family,
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 900,
    descender: -300,
    glyphs,
  });
  return new Uint8Array(font.toArrayBuffer());
}

describe("nativeCoverage", () => {
  // As Source Sans Pro has an arrow and Roboto does not: a template may set a text in either.
  const serif = parseNativeFont(fontOf("Serif", [0x61, 0xe9, 0x2192]));
  const sans = parseNativeFont(fontOf("Sans", [0x61, 0xe9]));
  // As Font Awesome's map gives only ASCII and its icons, in the Private Use Area.
  const icons = parseNativeFont(fontOf("Icons", [0x41, 0x61, 0xf0e0]));

  it("covers what every text font covers, and leaves an icon font out", () => {
    expect([serif.setsText, sans.setsText, icons.setsText]).toEqual([true, true, false]);
    const covers = nativeCoverage([serif, sans, icons]);
    expect(covers("a")).toBe(true);
    expect(covers("\u{e9}")).toBe(true);
    expect(covers("\u{2192}")).toBe(false);
    expect(covers("\u{f0e0}")).toBe(false);
    expect(nativeCoverage([serif])("\u{2192}")).toBe(true);
  });

  it("leaves everything to XeTeX when no file is a text font, having nothing to judge by", () => {
    expect(nativeCoverage([icons])("\u{e9}")).toBe(true);
    // As when none of the files loaded, which the caller leaves out.
    expect(nativeCoverage([])("\u{2192}")).toBe(true);
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

  it("reads Source Sans's small capitals as the letters they are made of, as +smcp sets them", () => {
    const sans = read("SourceSansPro-Regular.otf");
    const a = sans.glyphFor("a") ?? -1;
    const small = sans.substitute(a, ["smcp"]);
    expect(small).not.toBe(a);
    expect(sans.textsOf(small)).toEqual(["a", "A"]);
    expect(sans.madeBy(small)).toEqual(["smcp", "c2sc"]);
    // A small capital is its own glyph, of its own width.
    expect(sans.advanceOf(small)).not.toBe(sans.advanceOf(a));
    expect(sans.substitute(sans.glyphFor("A") ?? -1, ["c2sc"])).toBe(small);
    for (const char of "resume") {
      const glyph = sans.substitute(sans.glyphFor(char) ?? -1, ["smcp"]);
      expect(sans.textOf(glyph), char).toBe(char);
    }
  });

  it("reads Roboto's proportional and old-style figures as their digits", () => {
    const roboto = read("Roboto-Regular.otf");
    for (const features of [["pnum"], ["onum"], ["onum", "pnum"]]) {
      let substituted = 0;
      for (const digit of "0123456789") {
        const lining = roboto.glyphFor(digit) ?? -1;
        const glyph = roboto.substitute(lining, features);
        if (glyph !== lining) substituted++;
        expect(roboto.textOf(glyph), `${digit} ${features}`).toBe(digit);
      }
      // Its proportional 6 is its tabular one, which no lookup replaces.
      expect(substituted, `${features}`).toBeGreaterThan(5);
    }
    // Roboto's figures are tabular: a proportional one is narrower.
    const one = roboto.glyphFor("1") ?? -1;
    expect(roboto.advanceOf(roboto.substitute(one, ["pnum"]))).toBeLessThan(
      roboto.advanceOf(one) ?? 0,
    );
  });

  it("reads Source Sans's and Roboto's ² as itself first, and as 2 only under their feature", () => {
    // Source Sans Pro's sups and Roboto's frac make the glyph the map gives U+00B2 of the two.
    for (const [name, feature] of [
      ["SourceSansPro-Regular.otf", "sups"],
      ["Roboto-Regular.otf", "frac"],
    ] as const) {
      const file = read(name);
      const two = file.glyphFor("\u{b2}") ?? -1;
      expect(file.madeBy(two), name).toEqual([feature]);
      expect(file.textOf(two), name).toBe("\u{b2}");
      expect(file.textsOf(two), name).toEqual(["\u{b2}", "2"]);
      expect(file.textsOf(two, [feature]), name).toEqual(["\u{b2}", "2"]);
      // As Awesome-CV's port loads Roboto, and as a family's upright loads a file.
      expect(file.textsOf(two, ["pnum", "lnum"]), name).toEqual(["\u{b2}"]);
      expect(file.textOf(two, []), name).toBe("\u{b2}");
    }
  });

  it("reads the modifier letters as themselves first, Source Sans's as their letters under sups", () => {
    const sans = read("SourceSansPro-Regular.otf");
    for (const letter of "\u{2b0}\u{2b2}\u{2b3}\u{2b7}\u{2b8}\u{2e1}\u{2e2}\u{2e3}") {
      const glyph = sans.glyphFor(letter) ?? -1;
      const base = letter.normalize("NFKD");
      expect(sans.madeBy(glyph), letter).toEqual(["sups"]);
      expect(sans.textsOf(glyph), letter).toEqual([letter, base]);
      expect(sans.textsOf(glyph, ["sups"]), letter).toEqual([letter, base]);
      expect(sans.textsOf(glyph, ["smcp", "c2sc"]), letter).toEqual([letter]);
    }
    // Roboto's are made by no substitution, and read as themselves whatever it is loaded with.
    const roboto = read("Roboto-Regular.otf");
    for (const letter of "\u{2bc}\u{2c6}\u{2c7}\u{2dc}\u{2f3}") {
      const glyph = roboto.glyphFor(letter) ?? -1;
      expect(roboto.madeBy(glyph), letter).toEqual([]);
      expect(roboto.textsOf(glyph), letter).toEqual([letter]);
    }
  });

  it("reads Lato's figures, whose substitutions are extension lookups, as their digits", () => {
    const lato = read("Lato-Regular.ttf");
    const zero = lato.glyphFor("0") ?? -1;
    const oldStyle = lato.substitute(zero, ["onum", "pnum"]);
    expect(oldStyle).not.toBe(zero);
    expect(lato.textOf(oldStyle)).toBe("0");
    expect(lato.madeBy(oldStyle)).toContain("pnum");
  });

  it("reads a Font Awesome icon as the private-use character the header sets it with", () => {
    const icons = read("FontAwesome5Free-Solid-900.otf");
    const envelope = icons.glyphFor("");
    expect(envelope).toBeDefined();
    expect(icons.textOf(envelope ?? -1)).toBe("");
    expect(icons.pathOf(envelope ?? -1)).toBeDefined();
  });
});
