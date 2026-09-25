import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Resume, RichText, Run } from "@resume-tools/resume-model";
import { getSchema } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Font, Glyph, Path, parse } from "opentype.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { type DrawnPage, drawPage, type FieldLayout, type GlyphBox } from "../page/draw";
import { FontLibrary, type NativePageFont, type PageFont } from "../page/fonts";
import { parseNativeFont } from "../page/native";
import { breakParams, type Paragraph, parseParagraph } from "../page/paragraph";
import { TexLiveIndex } from "../page/texlive";
import { curated } from "../templates/curated";
import { generateBody, generateFormat } from "../templates/generate";
import { INVENTED_XETEX } from "../templates/invented";
import { defaultControls, parsePackage } from "../templates/package";
import { PRELUDE } from "../templates/prelude";
import { bound, fastest, median } from "../test/timing";
import { glyphOf, glyphText, textToCode } from "../tex/glyphs";
import {
  type Node as BreakNode,
  type BreakParams,
  type Face,
  FIL_GLUE,
  type Glue,
  LATEX_PARAMS,
  paragraphNodes,
  richParagraphNodes,
  tfmFace,
  ZERO_GLUE,
} from "../tex/linebreak";
import { parseTfm, scaleTfm } from "../tex/tfm";
import { parseType1 } from "../tex/type1";
import { fieldsOf } from "./document";
import {
  datesCommand,
  deleteAt,
  deleteRange,
  faceFor,
  layoutRows,
  lineStartOf,
  namedVariants,
  placementFor,
  type RichFaces,
  type Row,
  richFaces,
  richRows,
  rowOf,
  type Setting,
  settingFor,
  shouldClose,
  slantOf,
  spaceWidths,
  variantFontsOf,
} from "./Overlay";
import { breakRuns, docToRuns, RICH_SCHEMA, runsToDoc, type Variant } from "./rich";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../tex/fixtures/${name}`, import.meta.url)));
const PT = 65536;

/** cmr10 at 10 pt from the fixtures, which the spike measured Jake's bullets in. */
function cmr10(): Face {
  const tfm = parseTfm(fixture("cmr10.tfm"));
  const codes = textToCode(parseType1(fixture("cmr10.pfb")).encoding);
  return tfmFace(tfm, scaleTfm(tfm, 10 * PT), (ch) => codes.get(ch));
}

/** cmr10 as the page has it, with each code's text read from its glyph's name. */
function cmr10Font(): PageFont {
  const outlines = parseType1(fixture("cmr10.pfb"));
  return {
    kind: "tex",
    name: "cmr10",
    tfm: parseTfm(fixture("cmr10.tfm")),
    outlines,
    text: (code) =>
      glyphOf(outlines, code) === undefined ? undefined : glyphText(outlines.encoding[code] ?? ""),
  };
}

/** The spike's three-line bullet, set in Jake's `\resumeItem`. */
const BULLET =
  "Built a document pipeline that turns structured data into typeset pages, cutting the office's turnaround from days to minutes and removing a whole class of formatting errors, then wrote the runbook so the next team could operate it without help.";

/** The paragraph special of a bullet in Jake's `\resumeItem`, as `\rt@par` writes it. */
const BULLET_SPECIAL =
  "rt:p:fennel-1.text:hsize=542.02501pt;leftskip=0.0pt;rightskip=0.0pt plus 1.0fil;" +
  "parfillskip=0.0pt plus 1.0fil;pretolerance=100;tolerance=200;emergencystretch=0.0pt;" +
  "hangindent=0.0pt;hangafter=1;parshape=1;inner=0;shape=34.93008pt,507.09492pt;" +
  "spaceskip=0.0pt;xspaceskip=0.0pt";
const BULLET_PARAGRAPH = parseParagraph(BULLET_SPECIAL) as Paragraph;

/** The bullet's special with some values replaced, in decision 0007's order. */
function special(values: Record<string, string>): string {
  const pairs = BULLET_SPECIAL.slice(BULLET_SPECIAL.indexOf(":", 5) + 1)
    .split(";")
    .map((pair) => {
      const key = pair.slice(0, pair.indexOf("="));
      return `${key}=${values[key] ?? pair.slice(key.length + 1)}`;
    });
  return `rt:p:fennel-1.text:${pairs.join(";")}`;
}

/** The text each row holds. */
const texts = (text: string, rows: Row[]) => rows.map((row) => text.slice(row.from, row.to));

describe("layoutRows", () => {
  const face = cmr10();
  const params = breakParams(BULLET_PARAGRAPH);

  it("breaks the spike's bullet where TeX did, and spreads TeX's shrink over the spaces", () => {
    const rows = layoutRows(BULLET, face, params);
    expect(rows.map((row) => [row.from, row.to])).toEqual([
      [0, 115],
      [115, 229],
      [229, 245],
    ]);
    expect(texts(BULLET, rows).join("")).toBe(BULLET);
    // TeX shrank the second line by 1.46 pt to fit it; the ragged lines keep their spaces.
    expect(rows[0]?.wordSpacingSp).toBe(0);
    expect(rows[2]?.wordSpacingSp).toBe(0);
    const spaces = (texts(BULLET, rows)[1]?.trimEnd().match(/ /g) ?? []).length;
    expect(((rows[1]?.wordSpacingSp ?? 0) * spaces) / PT).toBeCloseTo(-1.46, 2);
  });

  it("widens a row's spaces by the extra space TeX sets after a sentence", () => {
    // The browser sets each space as the font's; TeX sets the one after "it." an extra 1.11 pt.
    const text = "Shipped it. Then wrote the notes.";
    const [row] = layoutRows(text, face, params);
    expect(((row?.wordSpacingSp ?? 0) * 5) / PT).toBeCloseTo(1.11111, 4);
    expect(layoutRows("Shipped it, then wrote the notes.", face, params)[0]?.wordSpacingSp).toBe(0);
  });

  it("stretches the full lines of a justified paragraph, and not its last", () => {
    const justified = { ...params, rightSkip: LATEX_PARAMS.rightSkip };
    const rows = layoutRows(BULLET, face, justified);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(0, -1)) expect(row.wordSpacingSp).not.toBe(0);
    expect(rows.at(-1)?.wordSpacingSp).toBe(0);
  });

  it("shares a finite right skip's stretch with the spaces, unless they are rigid", () => {
    // ragged2e's \RaggedRight: \rightskip 0pt plus 2em, and \spaceskip the font's space alone.
    const raggedRight = { ...params, rightSkip: { ...ZERO_GLUE, stretch: 20 * PT } };
    const shared = layoutRows(BULLET, face, raggedRight);
    expect(shared[0]?.wordSpacingSp).toBeGreaterThan(0);
    const rigid = { ...raggedRight, spaceSkip: { ...ZERO_GLUE, width: face.spaceGlue().space } };
    for (const row of layoutRows(BULLET, face, rigid)) expect(row.wordSpacingSp).toBe(0);
  });

  it("sets a field TeX never breaks on one row, and an empty field on one empty row", () => {
    expect(layoutRows(BULLET, face, undefined)).toEqual([
      { from: 0, to: BULLET.length, wordSpacingSp: 0 },
    ]);
    expect(layoutRows("", face, params)).toEqual([{ from: 0, to: 0, wordSpacingSp: 0 }]);
  });

  it("breaks a keystroke's text again well within a frame", () => {
    // What a keystroke costs besides the DOM: the bullet's nodes, breaks and rows, each time, in
    // CPU time, against the 50 ms the plan asks of Node, a bound a real keystroke is far below.
    let i = 0;
    const took = median(() => {
      const at = 100 + (i++ % 25);
      layoutRows(`${BULLET.slice(0, at)}x${BULLET.slice(at)}`, face, params);
    }, 25);
    expect(took).toBeLessThan(50);
  });

  it("breaks 5 KB under any shape in linear time, against the same shape at a fifth of it", () => {
    // The reviewers' specials: a \parshape of 2,000 lines, and a \hangafter of 2^31 - 1 around a
    // ragged paragraph, which looks no different; each cost hundreds of milliseconds a keystroke.
    // The breaker tells a shape's lines apart, so its work grows with the shape's length as well
    // as the text's. With the 64 lines of a shape it is given, 5 KB costs 4.4 to 4.9 times what
    // the same shape costs at 1 KB, as five times the text should; with 256 lines it costs 13.3
    // to 13.7 times, and with 2,000 lines 26 to 29. So each shape at 5 KB is bound by nine times
    // itself at a fifth of the text, like against like on whatever machine runs the test, which
    // a plain paragraph's time was not: a shared runner took twice this machine's ratio of a
    // shape to a plain paragraph. 100 ms stays as a ceiling, should the fifth go slow too.
    const shape = Array.from({ length: 2000 }, () => "0.0pt,542.0pt").join("|");
    const crafted = [
      special({ parshape: "2000", shape }),
      special({ hangindent: "10.0pt", hangafter: "2147483647", parshape: "0", shape: "" }),
    ].map((each) => breakParams(parseParagraph(each) as Paragraph));
    const whole = `${BULLET} `.repeat(25).slice(0, 5 * 1024);
    const fifth = whole.slice(0, 1024);
    for (const params of crafted) {
      expect(params.lines.length).toBeLessThanOrEqual(65);
      const [short = 0, long = 0] = fastest(
        [fifth, whole].map((text) => () => layoutRows(text, face, params)),
        9,
      );
      expect(long).toBeLessThan(bound(9, short));
      expect(long).toBeLessThan(100);
    }
  }, 60_000);
});

describe("richRows", () => {
  const params = breakParams(BULLET_PARAGRAPH);
  const codes = textToCode(parseType1(fixture("cmr10.pfb")).encoding);
  const faceOf = (name: string): Face => {
    const tfm = parseTfm(fixture(`${name}.tfm`));
    return tfmFace(tfm, scaleTfm(tfm, 10 * PT), (ch) => codes.get(ch));
  };
  const roman = cmr10();
  const bold = faceOf("cmbx10");
  const italic = faceOf("cmti10");
  const faces: RichFaces = {
    variants: new Map([
      ["regular", roman],
      ["bold", bold],
      ["italic", italic],
    ]),
    letter: roman,
  };

  it("sets a field of one run as the plain overlay sets its text", () => {
    expect(richRows([{ text: BULLET }], faces, params)).toEqual(
      layoutRows(BULLET, cmr10(), params),
    );
    // A bold run's italic correction at its end is nothing after a period.
    expect(richRows([{ text: BULLET, bold: true }], faces, params)).toEqual(
      layoutRows(BULLET, bold, params),
    );
    expect(richRows([{ text: BULLET }], faces, undefined)).toEqual([
      { from: 0, to: BULLET.length, wordSpacingSp: 0 },
    ]);
  });

  it("measures each space in its own run's font, as the browser draws it", () => {
    // A justified line, whose spaces TeX sets wider than any font's: the browser draws the bold
    // space wider than the roman, so the word spacing that makes up the line is less.
    const justified = { ...params, rightSkip: LATEX_PARAMS.rightSkip };
    const [alone] = richRows([{ text: BULLET }], faces, justified);
    const words = BULLET.split(" ");
    const runs = [
      { text: `${words.slice(0, 3).join(" ")} ` },
      { text: `${words.slice(3, 6).join(" ")} `, bold: true },
      { text: words.slice(6).join(" ") },
    ];
    const [mixed] = richRows(runs, faces, justified);
    expect(alone && mixed && mixed.wordSpacingSp).toBeLessThan(alone?.wordSpacingSp ?? 0);
  });

  it("takes a variant the page sets no glyph of as its family has it, not as the letter font", () => {
    // A field set wholly in italic: the page sets only its italic and bold italic, and its letter
    // font is italic, but the regular and bold fonts outside its groups are the paragraph's.
    const wholly: RichFaces = { variants: new Map([["italic", italic]]), letter: italic };
    const slant = slantOf(wholly);
    expect(
      ["regular", "bold", "italic", "boldItalic"].map((each) => slant(each as Variant)),
    ).toEqual([false, false, true, true]);
    const runs = [
      { text: "Led the ", italic: true },
      { text: "team", italic: true, bold: true },
      { text: " well", italic: true },
    ];
    expect(breakRuns(runs, slant).map((run) => run.italicCorrection)).toEqual([true, true, true]);
    // A slanted regular or bold font the page does set says the paragraph is slanted.
    const slantedParagraph: RichFaces = { variants: new Map([["bold", italic]]), letter: italic };
    expect(slantOf(slantedParagraph)("regular")).toBe(true);
    expect(slantOf(faces)("bold")).toBe(false);
  });

  it("measures a variant's symbols in its own companion first", () => {
    // Two companions for one field, the bold one listed first, as the page sorts them by glyphs:
    // the regular variant takes the regular one, whose name it gives.
    const font = (name: string, tfm: string): PageFont => ({
      ...cmr10Font(),
      name,
      tfm: parseTfm(fixture(`${tfm}.tfm`)),
    });
    const euro = (code: number) => (code === 36 ? "\u20ac" : undefined);
    const regular = font("ec-lmr10", "cmr10");
    const boldFont = font("ec-lmbx10", "cmbx10");
    const boldTs1 = { ...font("ts1-lmbx10", "cmbx10"), text: euro };
    const regularTs1 = { ...font("ts1-lmr10", "cmr10"), text: euro };
    const layout = layoutAt(72, {
      font: regular,
      fonts: [regular, boldFont, boldTs1, regularTs1].map((each) => ({
        font: each,
        size: 10,
        glyphs: 1,
        letters: 0,
      })),
    });
    const both = richFaces(
      new Map([
        ["regular", { font: regular, size: 10 }],
        ["bold", { font: boldFont, size: 10 }],
      ]),
      layout,
    );
    const width = (tfm: string) => scaleTfm(parseTfm(fixture(`${tfm}.tfm`)), 10 * PT).widths[36];
    expect(both.variants.get("regular")?.fallbackWidth?.("\u20ac")).toBe(width("cmr10"));
    expect(both.variants.get("bold")?.fallbackWidth?.("\u20ac")).toBe(width("cmbx10"));
    expect(both.letter.fallbackWidth?.("\u20ac")).toBe(width("cmr10"));
  });

  it("breaks tens of thousands of runs in time proportional to their number", () => {
    // The reviewers' field, bold and plain word by word: breakRuns copied the runs after each on
    // every call, and each space looked for its run from the first, so 40,000 runs took 700 ms,
    // 55 times 4,000's. Bound by three times ten times the tenth, in CPU time, as draw.test.ts
    // bounds a page, rather than in milliseconds a slow shared machine may not meet.
    const runsOf = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        i % 2 === 0 ? { text: "word", bold: true } : { text: " word " },
      );
    const [small = 0, large = 0] = fastest(
      [4000, 40_000].map((count) => {
        const runs = runsOf(count);
        return () => richRows(runs, faces, params);
      }),
      3,
    );
    expect(large).toBeLessThan(bound(3 * 10, small));
  }, 60_000);

  it("breaks a keystroke's runs again well within a frame", () => {
    const runs = [
      { text: BULLET.slice(0, 60) },
      { text: BULLET.slice(60, 90), italic: true },
      { text: BULLET.slice(90, 150) },
      { text: BULLET.slice(150, 170), bold: true, href: "example.org" },
      { text: BULLET.slice(170) },
    ];
    let i = 0;
    const took = median(() => {
      const at = i++ % 25;
      const typed = runs.map((run, k) =>
        k === 2 ? { ...run, text: `${run.text}x`.slice(at) } : run,
      );
      richRows(typed, faces, params);
    }, 25);
    expect(took).toBeLessThan(50);
  });
});

describe("spaceWidths", () => {
  const space = (stretch: number, shrink = 0): Glue => ({
    ...ZERO_GLUE,
    width: 3 * PT,
    stretch,
    shrink,
  });

  it("shares a shortfall between the spaces and a finite skip, by their stretch", () => {
    const skip = { ...ZERO_GLUE, stretch: 2 * PT };
    expect(spaceWidths([space(PT), space(PT)], [skip], 4 * PT)).toEqual([4 * PT, 4 * PT]);
  });

  it("gives all of it to fil glue, and none to rigid spaces", () => {
    expect(spaceWidths([space(PT)], [FIL_GLUE], 4 * PT)).toEqual([3 * PT]);
    expect(spaceWidths([space(0)], [{ ...ZERO_GLUE, stretch: PT }], 4 * PT)).toEqual([3 * PT]);
    expect(spaceWidths([space(0)], [ZERO_GLUE], 4 * PT)).toEqual([3 * PT]);
  });

  it("shrinks the spaces by their shrink, and never past it", () => {
    expect(spaceWidths([space(0, PT), space(0, PT)], [], -PT)).toEqual([2.5 * PT, 2.5 * PT]);
    expect(spaceWidths([space(0, PT)], [], -10 * PT)).toEqual([2 * PT]);
  });
});

describe("faceFor", () => {
  it("measures what the letter font lacks in the field's other fonts, at their size", () => {
    const letters = { font: cmr10Font(), size: 10 };
    // A companion font whose $ glyph stands for €, as TS1 holds € beside a T1 font's letters.
    const companion = {
      font: { ...cmr10Font(), text: (code: number) => (code === 36 ? "€" : undefined) },
      size: 12,
    };
    const face = faceFor(letters, [letters, companion]);
    expect(face.codeFor("€")).toBeUndefined();
    const dollar = scaleTfm(companion.font.tfm, 12 * PT).widths[36];
    expect(face.fallbackWidth?.("€")).toBe(dollar);
    expect(face.fallbackWidth?.("\u{1f680}")).toBeUndefined();
    const nodes = paragraphNodes("Raised €3", face).filter((node) => node.kind === "box");
    expect(nodes.find((node) => node.offset === 7)?.width).toBe(dollar);
  });

  /**
   * An invented native font, written by opentype.js and read as the page reads one: a space 250
   * units wide, an f, an i and their ligature, a hyphen, and a glyph for € when `euro` is set, in
   * a 2000-unit em.
   */
  function nativeFont(name: string, euro = false): NativePageFont {
    const glyph = (glyphName: string, unicodes: number[], advanceWidth: number) =>
      new Glyph({ name: glyphName, unicodes, advanceWidth, path: new Path() });
    const glyphs = [
      glyph(".notdef", [], 1000),
      glyph("space", [0x20], 500),
      glyph("f", [0x66], 600),
      glyph("i", [0x69], 480),
      glyph("f_i", [0xfb01], 1050),
      glyph("hyphen", [0x2d], 660),
      ...(euro ? [glyph("Euro", [0x20ac], 1111)] : []),
    ];
    const font = new Font({
      familyName: "Invented",
      styleName: "Regular",
      unitsPerEm: 2000,
      ascender: 1800,
      descender: -400,
      glyphs,
    });
    font.substitution.add("liga", { sub: [2, 3], by: 4 });
    return { kind: "native", name, file: parseNativeFont(new Uint8Array(font.toArrayBuffer())) };
  }

  it("measures a native font's characters by their glyphs' advances, with no ligature or kern", () => {
    const face = faceFor({ font: nativeFont("Invented-Regular.otf"), size: 10 });
    const f = face.codeFor("f");
    expect(f).toBe(2);
    // 600 units of a 2000-unit em at 10 pt, rounded to a scaled point.
    expect(face.widthOf(f ?? -1)).toBe(Math.round((600 * 10 * PT) / 2000));
    expect(face.ligKern).toBeUndefined();
    expect(face.hyphenChar).toBe(face.codeFor("-"));
    // XeTeX sets f and i as its fi; the overlay leaves that to the page and sets them apart.
    const boxes = paragraphNodes("fi", face).filter((node) => node.kind === "box");
    expect(boxes.map((node) => node.kind === "box" && node.code)).toEqual([2, 3]);
  });

  it("gives a native font XeTeX's interword glue: its space, half to stretch, a third to shrink", () => {
    const space = Math.round((500 * 10 * PT) / 2000);
    expect(faceFor({ font: nativeFont("Invented-Regular.otf"), size: 10 }).spaceGlue()).toEqual({
      space,
      stretch: Math.trunc(space / 2),
      shrink: Math.trunc(space / 3),
      extraSpace: Math.trunc(space / 3),
    });
  });

  it("measures a native font XeTeX stretches or letterspaces as XeTeX sets it", () => {
    // extend scales every advance and the space; letterspace, in points at the size, goes after
    // each glyph of a word but its last and into the space, and the overlay puts it after each
    // glyph and leaves it out of the space, which sets a word and its space as wide.
    const font = nativeFont("Invented-Regular.otf");
    const f = Math.round((600 * 10 * PT * 0.85) / 2000);
    const space = Math.round((500 * 10 * PT * 0.85) / 2000);
    const stretched = faceFor({ font, size: 10, extend: 0.85 });
    expect(stretched.widthOf(2)).toBe(f);
    expect(stretched.spaceGlue()).toEqual({
      space,
      stretch: Math.trunc(space / 2),
      shrink: Math.trunc(space / 3),
      extraSpace: Math.trunc(space / 3),
    });
    const letters = Math.round(0.6 * PT);
    const spaced = faceFor({ font, size: 10, letterSpace: 0.6 });
    expect(spaced.widthOf(2)).toBe(Math.round((600 * 10 * PT) / 2000) + letters);
    // XeTeX's \fontdimen2 is the space and the letterspace, and its stretch and shrink are of both.
    const glue = Math.round((500 * 10 * PT) / 2000) + letters;
    expect(spaced.spaceGlue()).toEqual({
      space: glue - letters,
      stretch: Math.trunc(glue / 2),
      shrink: Math.trunc(glue / 3),
      extraSpace: Math.trunc(glue / 3),
    });
  });

  it("measures what a native font lacks in another native font of the field", () => {
    const letters = { font: nativeFont("Invented-Regular.otf"), size: 10 };
    const symbols = { font: nativeFont("Invented-Symbols.otf", true), size: 12 };
    const face = faceFor(letters, [letters, symbols]);
    expect(face.codeFor("€")).toBeUndefined();
    expect(face.fallbackWidth?.("€")).toBe(Math.round((1111 * 12 * PT) / 2000));
    // And a TeX font's in a native one's, as a field that mixes the two measures them.
    const mixed = faceFor({ font: cmr10Font(), size: 10 }, [symbols]);
    expect(mixed.fallbackWidth?.("€")).toBe(Math.round((1111 * 12 * PT) / 2000));
  });
});

/** A field's layout as `draw.ts` gives it, for the pure tests. */
function layoutAt(x: number, more: Partial<FieldLayout> = {}): FieldLayout {
  const font = cmr10Font();
  return {
    paragraph: undefined,
    fonts: [{ font, size: 10, glyphs: 1, letters: 1 }],
    font,
    size: 10,
    x,
    y: 100,
    secondLine: undefined,
    baseline: [x],
    ...more,
  };
}

describe("lineStartOf", () => {
  const hsize = 400 * PT;
  const lines = [{ indent: 20 * PT, width: 380 * PT }];

  it("finds the paragraph's edge from the field's second line", () => {
    // A bullet whose first line starts at its label's distance past a bullet in the margin: the
    // second line, at the edge and the shape's indent, says the first starts there too.
    const layout = layoutAt(92, { secondLine: 92, baseline: [80, 92, 97] });
    expect(lineStartOf(layout, lines, hsize, ZERO_GLUE)).toBe(92);
    // Hanging indentation: the second line is indented by 30 pt more than the first.
    const hung = [
      { indent: 0, width: 400 * PT },
      { indent: 30 * PT, width: 370 * PT },
    ];
    expect(lineStartOf(layoutAt(160, { secondLine: 102 }), hung, hsize, ZERO_GLUE)).toBe(72);
    // A centred paragraph's lines start where their stretch puts them, so the baseline decides.
    const centred = { ...ZERO_GLUE, stretchOrder: 1, stretch: PT };
    expect(lineStartOf(layoutAt(160, { secondLine: 102 }), hung, hsize, centred)).toBe(160);
  });

  it("guesses a field on one line's start from its baseline, within the line's reach", () => {
    // A label set before the field, and a column 500 pt to the left, past the line's width.
    const layout = layoutAt(700, { baseline: [150, 160, 640, 650, 700, 720] });
    expect(lineStartOf(layout, lines, hsize, ZERO_GLUE)).toBe(640);
    expect(lineStartOf(layoutAt(700, { baseline: [150, 700] }), lines, hsize, ZERO_GLUE)).toBe(700);
    // Never further back than \hsize, even with a wider first line.
    const wide = [{ indent: 0, width: 800 * PT }];
    expect(lineStartOf(layout, wide, 100 * PT, ZERO_GLUE)).toBe(640);
    expect(lineStartOf(layout, wide, 600 * PT, ZERO_GLUE)).toBe(150);
  });
});

describe("rowOf", () => {
  // "Led the migration of " and "three services": a break at the space before "three".
  const rows: Row[] = [
    { from: 0, to: 21, wordSpacingSp: 0 },
    { from: 21, to: 35, wordSpacingSp: 0 },
  ];

  it("puts an offset in its row, at its column", () => {
    expect(rowOf(rows, 0)).toEqual({ row: 0, column: 0 });
    expect(rowOf(rows, 4)).toEqual({ row: 0, column: 4 });
    expect(rowOf(rows, 20)).toEqual({ row: 0, column: 20 });
  });

  it("puts the offset after the space TeX broke at at the start of the next row", () => {
    expect(rowOf(rows, 21)).toEqual({ row: 1, column: 0 });
    expect(rowOf(rows, 22)).toEqual({ row: 1, column: 1 });
  });

  it("puts the text's end at the end of the last row, and one row's start at its start", () => {
    expect(rowOf(rows, 35)).toEqual({ row: 1, column: 14 });
    expect(rowOf(rows, 99)).toEqual({ row: 1, column: 14 });
    expect(rowOf([{ from: 0, to: 0, wordSpacingSp: 0 }], 0)).toEqual({ row: 0, column: 0 });
  });
});

describe("deleting across rows", () => {
  const text = "Led the migration of three services";

  it("deletes the character before or after an offset, a whole grapheme", () => {
    expect(deleteAt(text, 21, "backward")).toEqual({
      text: "Led the migration ofthree services",
      offset: 20,
    });
    expect(deleteAt(text, 20, "forward")).toEqual({
      text: "Led the migration ofthree services",
      offset: 20,
    });
    expect(deleteAt("Shipped 👍🏽 it", 12, "backward")).toEqual({ text: "Shipped  it", offset: 8 });
    expect(deleteAt("café bar", 5, "backward")).toEqual({ text: "caf bar", offset: 3 });
    expect(deleteAt(text, 0, "backward")).toEqual({ text, offset: 0 });
    expect(deleteAt(text, text.length, "forward")).toEqual({ text, offset: text.length });
  });

  it("deletes a range either way round", () => {
    expect(deleteRange(text, 18, 27)).toEqual({ text: "Led the migration services", offset: 18 });
    expect(deleteRange(text, 27, 18)).toEqual({ text: "Led the migration services", offset: 18 });
    expect(deleteRange(text, 30, 99)).toEqual({
      text: "Led the migration of three ser",
      offset: 30,
    });
  });

  it("puts the caret where the deletion was, in the rows the text breaks into then", () => {
    // Backspace at the start of the second row, which the browser would only join to the first:
    // the space goes, and "ofthree" no longer fits the first row.
    const face = cmr10();
    const params = { ...LATEX_PARAMS, lines: [{ indent: 0, width: 95 * PT }], rightSkip: FIL_GLUE };
    const before = layoutRows(text, face, params);
    expect(texts(text, before)).toEqual(["Led the migration of ", "three services"]);
    const edit = deleteAt(text, before[1]?.from ?? 0, "backward");
    const after = layoutRows(edit.text, face, params);
    expect(texts(edit.text, after)).toEqual(["Led the migration ", "ofthree services"]);
    expect(rowOf(after, edit.offset)).toEqual({ row: 1, column: 2 });
  });
});

describe("datesCommand", () => {
  it("sends a start alone, a start and an end, and an ongoing range", () => {
    expect(datesCommand("fennel.dates", "2020-07", undefined)).toEqual({
      type: "dates",
      field: "fennel.dates",
      dates: { start: "2020-07" },
    });
    expect(datesCommand("fennel.dates", "2020-07", "2023-02")).toEqual({
      type: "dates",
      field: "fennel.dates",
      dates: { start: "2020-07", end: "2023-02" },
    });
    expect(datesCommand("fennel.dates", "2020-07", "present")).toEqual({
      type: "dates",
      field: "fennel.dates",
      dates: { start: "2020-07", end: "present" },
    });
  });

  it("keeps a start or an end stored as a year, and reads an end the model refuses as none", () => {
    expect(datesCommand("marginalia.dates", "2023", "present")).toMatchObject({
      dates: { start: "2023", end: "present" },
    });
    // The sample's Marginalia runs 2023 to 2024: a new start month keeps the year it ends in.
    expect(datesCommand("marginalia.dates", "2023-01", "2024")).toEqual({
      type: "dates",
      field: "marginalia.dates",
      dates: { start: "2023-01", end: "2024" },
    });
    expect(datesCommand("marginalia.dates", "2023-01", "")).toMatchObject({
      dates: { start: "2023-01" },
    });
    expect(datesCommand("marginalia.dates", "2023-01", "2024-13")).toMatchObject({
      dates: { start: "2023-01" },
    });
  });

  it("sends nothing without a start", () => {
    expect(datesCommand("fennel.dates", "", "2023-02")).toBeUndefined();
    expect(datesCommand("fennel.dates", "2020-13", undefined)).toBeUndefined();
  });
});

describe("when an open field closes, and where it stays", () => {
  it("closes only when the document no longer has the field", () => {
    // The reviewers' case, where a page without the field closed it: select a bullet's text,
    // delete it, and type its replacement while the empty text compiles. The page for the empty
    // text lands without the bullet, which Jake's template leaves out once emptied, as it does
    // every one of the sample's 30 text and rich fields; the document still has it.
    expect(shouldClose(true, false)).toBe(false);
    expect(shouldClose(true, true)).toBe(false);
    // The panel removed the node: the page may still show the field, compiled before that.
    expect(shouldClose(false, true)).toBe(true);
    expect(shouldClose(false, false)).toBe(true);
  });

  /** A glyph's box with nothing in it, in cmr10 at 10 pt. */
  const box = { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, font: "cmr10", size: 10 };

  /** A page of one field, or of none. */
  const pageOf = (layout: FieldLayout | undefined): DrawnPage => ({
    svg: "",
    size: { width: 600, height: 800 },
    fields: new Map(layout ? [["fennel-1.text", { id: "fennel-1.text", glyphs: [], layout }]] : []),
    glyphs: layout
      ? [
          { ...box, y: 200, field: "fennel-1.text", offset: 0 },
          { ...box, y: 212, field: "fennel-1.text", offset: 9 },
        ]
      : [],
    pageCount: 1,
    unmatched: 0,
    missingFonts: new Map(),
  });

  it("keeps its place from the last page that showed the field, until one shows it again", () => {
    const first = placementFor("fennel-1.text", pageOf(layoutAt(72)), undefined);
    expect(first).toMatchObject({ baselines: [200, 212], pageWidth: 600 });
    expect(first?.layout.x).toBe(72);
    const empty = pageOf(undefined);
    expect(placementFor("fennel-1.text", empty, first)).toBe(first);
    expect(placementFor("fennel-1.text", empty, undefined)).toBeUndefined();
    expect(placementFor("fennel-1.text", pageOf(layoutAt(80)), first)?.layout.x).toBe(80);
  });
});

/** The offset each line of a field starts at on the page, down the page. */
function pageLines(page: DrawnPage, id: string): number[] {
  const lines = new Map<number, number>();
  const lowest = new Map<number, number>();
  for (const glyph of page.glyphs)
    if (glyph.field === id && glyph.offset !== undefined)
      lowest.set(glyph.offset, Math.max(glyph.y, lowest.get(glyph.offset) ?? glyph.y));
  for (const [offset, y] of lowest) lines.set(y, Math.min(offset, lines.get(y) ?? offset));
  return [...lines.entries()].sort(([a], [b]) => a - b).map(([, offset]) => offset);
}

/** The offset each row's first character is at, past the spaces it starts with. */
function rowStarts(text: string, rows: Row[]): number[] {
  return rows.map((row) => {
    let at = row.from;
    while (at < row.to && /\s/.test(text[at] ?? "")) at++;
    return at;
  });
}

/** The rows the overlay sets a field of a page in, and the lines the page set it in. */
function compare(page: DrawnPage, id: string, text: string) {
  const layout = page.fields.get(id)?.layout;
  if (!layout) throw new Error(`${id} has no layout`);
  const setting = settingFor(id, layout, page.size.width);
  const rows = layoutRows(text, setting.face, setting.params);
  return { rows: rowStarts(text, rows), page: pageLines(page, id), setting, layout };
}

/**
 * How far each row's last glyph sits from its first, in points, as the overlay sets the row: the
 * boxes and kerns, and each space as the browser sets it, the font's space and the row's word
 * spacing.
 */
function overlayEnds(text: string, setting: Setting): { first: number; last: number; x: number }[] {
  const { face, params } = setting;
  const nodes = paragraphNodes(text, face, params);
  return rowEnds(nodes, layoutRows(text, face, params), () => face.spaceGlue().space);
}

/** `overlayEnds` for rows of `nodes` whose spaces the browser sets at `space` before spacing. */
function rowEnds(
  nodes: BreakNode[],
  rows: Row[],
  space: (offset: number) => number,
): { first: number; last: number; x: number }[] {
  return rows.flatMap((row) => {
    let x = 0;
    let first: number | undefined;
    let last = { offset: 0, x: 0 };
    for (const node of nodes) {
      const offset = node.kind === "box" || node.kind === "glue" ? node.offset : undefined;
      if (offset !== undefined && (offset < row.from || offset >= row.to)) continue;
      if (node.kind === "box") {
        first ??= node.offset;
        last = { offset: node.offset, x };
        x += node.width;
      } else if (node.kind === "kern") x += first === undefined ? 0 : node.width;
      else if (node.kind === "glue" && first !== undefined)
        x += space(node.offset) + row.wordSpacingSp;
    }
    return first === undefined ? [] : [{ first, last: last.offset, x: last.x / PT }];
  });
}

/**
 * `overlayEnds` for a rich field's runs as the rich editor sets them: each run in its variant's
 * face, with LaTeX's italic corrections, and each space in its own run's font.
 */
function richEnds(runs: RichText, faces: RichFaces, params: BreakParams) {
  const faceOf = (variant: Variant) => faces.variants.get(variant) ?? faces.letter;
  const set = breakRuns(runs, slantOf(faces)).map((run) => ({ ...run, face: faceOf(run.variant) }));
  const nodes = richParagraphNodes(set, params);
  const faceAt = (offset: number) => {
    let at = 0;
    for (const run of set) {
      at += run.text.length;
      if (offset < at) return run.face;
    }
    return faces.letter;
  };
  const rows = richRows(runs, faces, params);
  return rowEnds(nodes, rows, (offset) => faceAt(offset).spaceGlue().space);
}

/**
 * The rows the rich editor sets a field of a page in, and the lines the page set it in: the faces
 * of the variants the page sets, and of the others as the tree names them (`namedVariants`), as
 * the editor finds them with `load`.
 */
async function compareRich(
  page: DrawnPage,
  resume: Resume,
  id: string,
  load: (name: string) => Promise<PageFont | undefined>,
) {
  const layout = page.fields.get(id)?.layout;
  const field = fieldsOf(resume).get(id);
  const variants = variantFontsOf(page, resume, id);
  if (!layout || field?.kind !== "rich" || !variants) throw new Error(`${id} is not on the page`);
  const setting = settingFor(id, layout, page.size.width);
  const named = await namedVariants(variants, layout, load);
  const faces = richFaces(new Map([...named, ...variants]), layout);
  const runs = field.get(resume);
  const text = runs.map((run) => run.text).join("");
  const rows = richRows(runs, faces, setting.params);
  return { rows: rowStarts(text, rows), page: pageLines(page, id), runs, faces, setting, named };
}

/** Runs joined where their marks are the same, as the rich editor sends them. */
const RICH = getSchema(RICH_SCHEMA);
const normalised = (runs: RichText) => docToRuns(ProseMirrorNode.fromJSON(RICH, runsToDoc(runs)));

/** The invented words of the rich bullets. */
const WORDS =
  "Designed and shipped a streaming ingestion service that cut reporting latency from hours to minutes, kept costs flat across three regions and two providers, wrote the failover runbook the operations team still uses every quarter, and trained four new engineers to run it.".split(
    " ",
  );

/**
 * The reviewers' wholly italic bullets: every word italic, and a bold italic word every sixth, or
 * an italic link every fifth, from the word `shift`; the spaces between words are only italic.
 */
function whollyItalic(kind: "bold" | "link", shift: number): RichText {
  return normalised(
    WORDS.flatMap((word, i): Run[] => [
      ...(i > 0 ? [{ text: " ", italic: true }] : []),
      {
        text: word,
        italic: true,
        ...(kind === "bold" && i % 6 === shift && { bold: true }),
        ...(kind === "link" && i % 5 === shift && { href: "example.org/runbook" }),
      },
    ]),
  );
}

/**
 * An invented bullet with italic, bold, bold italic and a link on words that move along it with
 * `k`, a mark never taking the comma or period after its word, so that some italic words are
 * followed by one. The space between two words goes with the word after it when `k` is even, and
 * with the word before it when odd.
 */
function richBullet(k: number): RichText {
  const words = WORDS;
  const n = words.length;
  const runs: Run[] = [];
  words.forEach((word, i) => {
    const both = i === (k * 7 + 11) % n;
    const italic = both || i === (k * 3) % n || i === (k * 3 + 1) % n;
    const bold = both || i === (k * 5 + 7) % n;
    const link = i === (k * 2 + 15) % n || i === (k * 2 + 16) % n;
    const [, core = word, stop = ""] = /^(.*?)([,.]?)$/.exec(word) ?? [];
    const before = k % 2 === 0 && i > 0 ? " " : "";
    const after = k % 2 === 1 && i < n - 1 ? " " : "";
    runs.push({
      text: `${before}${core}`,
      ...(bold && { bold }),
      ...(italic && { italic }),
      ...(link && { href: "example.org/runbook" }),
    });
    runs.push({ text: `${stop}${after}` });
  });
  return normalised(runs);
}

/**
 * How far a field's glyphs sit from where the overlay sets them, within their rows: each glyph's x
 * from its row's first glyph's on the page, against the overlay's, for every glyph the page shows
 * whose offset begins one of the overlay's boxes. The most and the mean, in points, and over how
 * many glyphs.
 */
function rowDrift(
  text: string,
  setting: Setting,
  glyphs: readonly GlyphBox[],
): { most: number; mean: number; glyphs: number } {
  const { face, params } = setting;
  const nodes = paragraphNodes(text, face, params);
  const pageX = new Map<number, number>();
  for (const glyph of glyphs)
    if (glyph.offset !== undefined && !pageX.has(glyph.offset)) pageX.set(glyph.offset, glyph.x);
  let most = 0;
  let total = 0;
  let count = 0;
  for (const row of layoutRows(text, face, params)) {
    let x = 0;
    let first: number | undefined;
    for (const node of nodes) {
      const offset = node.kind === "box" || node.kind === "glue" ? node.offset : undefined;
      if (offset !== undefined && (offset < row.from || offset >= row.to)) continue;
      if (node.kind === "box") {
        first ??= node.offset;
        const at = pageX.get(node.offset);
        const start = pageX.get(first);
        if (at !== undefined && start !== undefined) {
          const drift = Math.abs(x / PT - (at - start));
          most = Math.max(most, drift);
          total += drift;
          count++;
        }
        x += node.width;
      } else if (node.kind === "kern") x += first === undefined ? 0 : node.width;
      else if (node.kind === "glue" && first !== undefined)
        x += face.spaceGlue().space + row.wordSpacingSp;
    }
  }
  return { most, mean: count > 0 ? total / count : 0, glyphs: count };
}

/** A sentence of `count` invented words, different for each `seed`. */
function sentence(seed: number, count: number): string {
  const words =
    "Designed built and shipped a streaming ingestion service that cut reporting latency from hours to minutes while keeping costs flat across three regions and two cloud providers with careful capacity planning and automated failover drills every quarter for the operations team".split(
      " ",
    );
  const out: string[] = [];
  for (let i = 0; i < count; i++)
    out.push(words[(seed * 7 + i * 3 + ((i * i) % 5)) % words.length] as string);
  return `${out.join(" ")}.`;
}

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("the overlay's lines against TeX's", () => {
  let session: EngineSession;
  let fonts: FontLibrary;

  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 60_000);

  /** The page of an article in Latin Modern with the prelude, its fields' texts given. */
  async function article(job: string, preamble: string, body: string, texts: Map<string, string>) {
    const latex = [
      "\\documentclass{article}\\usepackage[T1]{fontenc}\\usepackage{lmodern}",
      PRELUDE,
      preamble,
      "\\begin{document}",
      body,
      "\\end{document}",
    ].join("\n");
    const compiled = session.compile("pdftex", "stock", latex, { job });
    if (!compiled.output) throw new Error(compiled.error);
    const page = await drawPage(compiled.output, fonts, texts);
    expect(page.missingFonts, job).toEqual(new Map());
    return page;
  }

  describe("on Jake's Resume", () => {
    const { package: pkg, sample } = curated("jake");
    const values = defaultControls(pkg);
    const format = generateFormat(pkg, values);

    /**
     * The page of a resume set with Jake's Resume, and its fields' texts, with the controls'
     * `controls`, which must share the defaults' format, as the font size does.
     */
    async function jake(resume: Resume, job: string, controls = values) {
      const dumped = session.dump(pkg.engine, format.name, format.preamble, format.files);
      if (!dumped.ok) throw new Error(dumped.error);
      const body = generateBody(pkg, resume, controls);
      const result = session.compile(pkg.engine, format.name, body.latex, { job, maxPasses: 3 });
      if (!result.output) throw new Error(result.error);
      return { page: await drawPage(result.output, fonts, body.texts), texts: body.texts };
    }

    /** The sample with its first entry's bullets replaced by `bullets`, named `<prefix>-<i>`. */
    function withBullets(prefix: string, bullets: string[]): Resume {
      const resume = structuredClone(sample);
      const section = resume.sections.find((each) => each.kind === "entries");
      const entry = section?.kind === "entries" ? section.entries[0] : undefined;
      if (!entry) throw new Error("the sample has no entry");
      entry.bullets = bullets.map((text, i) => ({ id: `${prefix}-${i}`, text: [{ text }] }));
      return resume;
    }

    it("reads every field's paragraph, and breaks each where TeX did", async () => {
      const { page, texts } = await jake(sample, "overlay-jake");
      expect(page.fields.size).toBeGreaterThan(20);
      let broken = 0;
      for (const [id, field] of page.fields) {
        const layout = field.layout;
        expect(layout, id).toBeDefined();
        expect(parseParagraph(layout?.paragraph ?? ""), id).toBeDefined();
        const { rows, page: lines, setting } = compare(page, id, texts.get(id) ?? "");
        expect(rows, id).toEqual(lines);
        if (setting.params) broken++;
      }
      // The name, the phone, the section titles, the bullets and the skills with their labels are
      // set as paragraphs; the rest sit in tabular cells or boxes, where TeX breaks nothing.
      expect(broken).toBe(17);
      expect(pageLines(page, "fennel-1.text")).toHaveLength(3);
    }, 60_000);

    it("breaks a skill list that wraps after its label where TeX did", async () => {
      const skills =
        "TypeScript, Python, Rust, SQL, Go, Kotlin, Swift, Haskell, OCaml, Elixir, Clojure, Scala, Julia, Fortran, Zig, Nim, Crystal, Dart, Lua, Perl, Ruby, Erlang, Racket, Prolog";
      const resume = structuredClone(sample);
      const section = resume.sections.find((each) => each.id === "skills");
      if (section?.kind !== "labelled") throw new Error("the sample has no skills");
      const languages = section.items.find((item) => item.id === "languages");
      if (!languages) throw new Error("the sample has no languages");
      languages.text = [{ text: skills }];
      const { page } = await jake(resume, "overlay-skills");
      const { rows, page: lines, setting } = compare(page, "languages.text", skills);
      expect(lines).toHaveLength(2);
      expect(rows).toEqual(lines);
      // The first line is shorter by the label, and the second starts back under it.
      const [first, second] = setting.params?.lines ?? [];
      expect(first && second && second.width - first.width).toBeGreaterThan(50 * PT);
    }, 60_000);

    it("measures what LaTeX sets from other fonts, and a field that starts with it", async () => {
      // The reviewers' bullets: •, €, ×, °, ™ come from TS1 in Jake's T1 paragraphs, and … is
      // three periods. Measured as nothing, three of the first six broke late; the seventh, which
      // starts with €, took TS1 for its face and set every letter as nothing.
      const bullets = [
        "Cut the nightly build from forty to nine minutes, 4× faster, and made test runs 3× faster by caching dependencies, splitting suites across workers, and pruning steps nobody needed any more.",
        "Skills used daily • TypeScript • Python • Rust • SQL • Go • Kotlin • Swift • Haskell • OCaml • Elixir • Clojure • Scala • Julia • Fortran • Zig • Nim • Crystal • Dart • Lua • Perl",
        "Raised €2.4M across two rounds… then grew revenue 5× to €12M while keeping churn under 2% and the team under twenty people across three offices and two continents.",
        "Ran cold-chain logistics at 20°C below zero to 4°C for 300 sites, cutting spoilage 3× and saving €1.1M a year while meeting every audit on the first attempt without exception.",
        "Wrote the SDK™ that forty partner teams build on, with guides, samples and a review process that keeps releases consistent as the teams grow and change over the years ahead.",
        "Built a document pipeline that turns structured data into typeset pages × 10 per day, cutting turnaround from days to minutes • zero formatting errors… and wrote the runbook.",
        "€2.4M raised in seed funding after building the first prototype, then hired and led a team of six engineers through launch, growth and a migration to a new cloud platform.",
        "…and then rebuilt the reporting stack from scratch so that analysts could answer questions in minutes rather than days, with dashboards used by every team in the company.",
      ];
      const { page } = await jake(withBullets("cc", bullets), "overlay-companion");
      bullets.forEach((text, i) => {
        const { rows, page: lines, layout } = compare(page, `cc-${i}.text`, text);
        expect(lines.length, text).toBeGreaterThan(1);
        expect(rows, text).toEqual(lines);
        expect(layout.font.name, text).toBe("ec-lmr10");
      });
      const euro = page.fields.get("cc-6.text")?.layout;
      expect(euro?.fonts.map((each) => each.font.name)).toEqual(["ec-lmr10", "ts1-lmr10"]);
      expect(euro?.fonts[1]).toMatchObject({ glyphs: 1, letters: 0 });
    }, 60_000);

    it("never breaks at a no-break space, wherever it stands", async () => {
      // The reviewers' twelve bullets, each with a no-break space between another pair of words;
      // at 114, where TeX would break, it moved the break back to 110.
      const words =
        "Built a document pipeline that turns structured data into typeset pages, cutting the office's turnaround from days to minutes and removing a whole class of formatting errors".split(
          " ",
        );
      const bullets = Array.from({ length: 12 }, (_, k) =>
        words.map((word, i) => (i === 0 ? word : `${i === k + 10 ? " " : " "}${word}`)).join(""),
      );
      const { page } = await jake(withBullets("nb", bullets), "overlay-nbsp");
      const moved = bullets.filter((text, i) => {
        const { rows, page: lines } = compare(page, `nb-${i}.text`, text);
        expect(rows, text).toEqual(lines);
        return lines[1] !== 115;
      });
      expect(moved).toEqual([bullets[7]]);
    }, 60_000);

    it("breaks rich bullets where TeX did, each run in its own font, corrections and all", async () => {
      const bullets: RichText[] = [
        ...Array.from({ length: 16 }, (_, k) => richBullet(k)),
        // A bold label before the text, and a mark that starts inside a word, which splits the
        // ligature and the kern the word would have had.
        normalised([
          { text: "Lead engineer:", bold: true },
          { text: " took the reporting stack from nightly batches to a streaming pipeline and " },
          { text: "of", italic: true },
          { text: "fice dashboards that every team now reads before its Monday planning " },
          { text: "WAV", bold: true },
          { text: "E review." },
        ]),
      ];
      const resume = structuredClone(sample);
      const section = resume.sections.find((each) => each.kind === "entries");
      const entry = section?.kind === "entries" ? section.entries[0] : undefined;
      if (!entry) throw new Error("the sample has no entry");
      entry.bullets = bullets.map((text, i) => ({ id: `rb-${i}`, text }));
      const { page } = await jake(resume, "overlay-rich");
      for (const i of bullets.keys()) {
        const id = `rb-${i}.text`;
        const load = (name: string) => fonts.load(name);
        const {
          rows,
          page: lines,
          runs,
          faces,
          setting,
        } = await compareRich(page, resume, id, load);
        const text = runs.map((run) => run.text).join("");
        expect(lines.length, text).toBeGreaterThan(1);
        expect(rows, `${id}: ${text}`).toEqual(lines);
        // Each line ends where TeX ends it, which the italic corrections decide within a line.
        const glyphs = page.glyphs.filter((glyph) => glyph.field === id);
        const at = (offset: number) => glyphs.find((glyph) => glyph.offset === offset)?.x ?? NaN;
        if (!setting.params) throw new Error(`${id} is not broken`);
        for (const row of richEnds(runs, faces, setting.params)) {
          const tex = at(row.last) - at(row.first);
          expect(Math.abs(row.x - tex), `${id} at ${row.last}: ${text}`).toBeLessThan(0.01);
        }
      }
      const table = variantFontsOf(page, resume, "rb-0.text") ?? new Map();
      expect(
        Object.fromEntries([...table].map(([variant, font]) => [variant, font.font.name])),
      ).toEqual({
        regular: "ec-lmr10",
        bold: "ec-lmbx10",
        italic: "ec-lmri10",
        boldItalic: "ec-lmbxi10",
      });
    }, 60_000);

    /** The sample with its first entry's bullets replaced by rich `bullets`, and its page. */
    async function richPage(prefix: string, bullets: RichText[], controls = values) {
      const resume = structuredClone(sample);
      const section = resume.sections.find((each) => each.kind === "entries");
      const entry = section?.kind === "entries" ? section.entries[0] : undefined;
      if (!entry) throw new Error("the sample has no entry");
      entry.bullets = bullets.map((text, i) => ({ id: `${prefix}-${i}`, text }));
      const { page } = await jake(resume, `overlay-${prefix}`, controls);
      return { page, resume };
    }

    /**
     * A rich bullet as the editor sets it against the page: the same breaks, and each line ending
     * within a hundredth of a point of where TeX ends it.
     */
    async function sameAsTex(page: DrawnPage, resume: Resume, id: string) {
      const compared = await compareRich(page, resume, id, (name) => fonts.load(name));
      const { rows, page: lines, runs, faces, setting } = compared;
      const text = runs.map((run) => run.text).join("");
      expect(lines.length, text).toBeGreaterThan(1);
      expect(rows, `${id}: ${text}`).toEqual(lines);
      const glyphs = page.glyphs.filter((glyph) => glyph.field === id);
      const at = (offset: number) => glyphs.find((glyph) => glyph.offset === offset)?.x ?? NaN;
      if (!setting.params) throw new Error(`${id} is not broken`);
      for (const row of richEnds(runs, faces, setting.params)) {
        const tex = at(row.last) - at(row.first);
        expect(Math.abs(row.x - tex), `${id} at ${row.last}: ${text}`).toBeLessThan(0.01);
      }
      return compared;
    }

    it("sets the corrections of a field wholly in italic, whose upright font the page lacks", async () => {
      // The reviewers' eight bullets: the page sets no regular glyph of them, and their letter
      // font is italic, whose slant dropped every correction TeX sets outside their groups; two
      // broke where TeX did not, and every line ended 1.5 to 4.9 pt short.
      const bullets = [0, 1, 2, 3].flatMap((shift) => [
        whollyItalic("bold", shift),
        whollyItalic("link", shift),
      ]);
      const { page, resume } = await richPage("wi", bullets);
      for (const i of bullets.keys()) {
        const { named } = await sameAsTex(page, resume, `wi-${i}.text`);
        expect(named.get("regular")?.font.name).toBe("ec-lmr10");
      }
    }, 60_000);

    it("measures a run that is only a space in its own variant's font, which the page never sets", async () => {
      // The reviewers' \textbf{ } and \textit{  }: TeX sets the bold space at 3.833 pt and the
      // italic one in the italic font, where the letter font's space is 3.333 pt. The first line
      // is ragged, so that it ends where the spaces' natural widths put it.
      const tail =
        "office dashboards, then wrote the runbook the operations team reads every quarter before it plans its work for the year.";
      const bullets: RichText[] = [
        [{ text: "Built the" }, { text: " ", bold: true }, { text: tail }],
        [{ text: "Built the" }, { text: "  ", italic: true }, { text: tail }],
      ];
      const { page, resume } = await richPage("sp", bullets);
      const { faces, setting, named } = await sameAsTex(page, resume, "sp-0.text");
      await sameAsTex(page, resume, "sp-1.text");
      expect(named.get("bold")?.font.name).toBe("ec-lmbx10");
      const set = breakRuns(bullets[0] ?? [], slantOf(faces)).map((run) => ({
        ...run,
        face: faces.variants.get(run.variant) ?? faces.letter,
      }));
      const space = richParagraphNodes(set, setting.params).find(
        (node) => node.kind === "glue" && node.offset === 9,
      );
      expect(space?.kind === "glue" && space.width / PT).toBeCloseTo(3.833, 3);
    }, 60_000);

    it("names each variant at the cut LaTeX picks for the size the page sets it at", async () => {
      // The verifier's bullets: every word bold italic, which Latin Modern cuts only at 10 and is
      // all the page sets, and the spaces plain, bold or italic, which set no glyph. At the font
      // sizes 9, 9.5 and 10 the bullets are 8.18, 8.64 and 9.09 pt, where t1lmr.fd sets the
      // regular, bold and italic fonts in their 8, 9 and 9 cuts; named at the bold italic's 10,
      // one broke at 112 where TeX broke at 106, and lines ended 1.36 to 3.07 pt off.
      const spaced = (space: Run): RichText =>
        WORDS.flatMap((word, i) => [
          ...(i > 0 ? [space] : []),
          { text: word, bold: true, italic: true },
        ]);
      const bullets = [
        spaced({ text: " " }),
        spaced({ text: " ", bold: true }),
        spaced({ text: " ", italic: true }),
      ];
      for (const [fontSize, cut] of [
        [9, 8],
        [9.5, 9],
        [10, 9],
      ] as const) {
        const prefix = `cut${fontSize * 10}`;
        const { page, resume } = await richPage(prefix, bullets, { ...values, fontSize });
        for (const i of bullets.keys()) {
          const { named } = await sameAsTex(page, resume, `${prefix}-${i}.text`);
          expect([...named].map(([variant, font]) => [variant, font.font.name])).toEqual([
            ["regular", `ec-lmr${cut}`],
            ["bold", `ec-lmbx${cut}`],
            ["italic", `ec-lmri${cut}`],
          ]);
        }
      }
    }, 60_000);

    it("measures each variant's symbols in its own companion, and corrects after them", async () => {
      // The reviewers' bullets. Euros regular and bold: each regular one was measured in bold
      // TS1, which set more of the field's glyphs. Degrees in italic runs: TeX's \/ after each
      // takes ts1-lmri10's correction, 1.0655 pt, which a character another font sets never got.
      const bullets: RichText[] = [
        [
          {
            text: "Raised \u20ac2.4M and \u20ac1.1M and \u20ac0.9M and \u20ac0.4M in a rounds x, then grew revenue to ",
          },
          { text: "\u20ac".repeat(10) + " twelve", bold: true },
          {
            text: " while keeping churn under two percent and the team small across three offices and two continents.",
          },
        ],
        [
          { text: "Ran the cold chain at the xxx " },
          { text: "minus 20\u00b0", italic: true },
          { text: " for three hundred sites and at " },
          { text: "plus 4\u00b0", italic: true },
          { text: " for the rest, cutting spoilage by " },
          { text: "half\u00b0", italic: true },
          {
            text: " while keeping churn under two percent and the team small across three offices and continents.",
          },
        ],
      ];
      const { page, resume } = await richPage("cm", bullets);
      await sameAsTex(page, resume, "cm-0.text");
      const { faces, setting } = await sameAsTex(page, resume, "cm-1.text");
      const set = breakRuns(bullets[1] ?? [], slantOf(faces)).map((run) => ({
        ...run,
        face: faces.variants.get(run.variant) ?? faces.letter,
      }));
      const nodes = richParagraphNodes(set, setting.params);
      const degree = nodes.findIndex((node) => node.kind === "box" && node.offset === 38);
      const after = nodes[degree + 1];
      expect(after?.kind === "kern" && after.width / PT).toBeCloseTo(1.0655, 4);
    }, 60_000);

    it("breaks a run of 8,000 characters with no space where TeX does, at the generator's breaks", async () => {
      // The generator writes a break opportunity every 200 characters of a run with no space in
      // it, and the overlay's breaker has the same ones, so that a pasted address, say, wraps on
      // the page and in the overlay alike.
      const text = "abcdefghij".repeat(800);
      const { page } = await jake(withBullets("run", [text]), "overlay-unbroken");
      const { rows, page: lines } = compare(page, "run-0.text", text);
      expect(lines.length).toBeGreaterThan(1);
      expect(rows).toEqual(lines);
    }, 60_000);

    it("breaks rich runs with no space where TeX does, the count going on from run to run", async () => {
      // The generator counts a run with no space on from one run of rich text into the next, and so
      // does the overlay's breaker: a break inside the bold run, and one just where the italic run
      // begins, before its first letter.
      const { page, resume } = await richPage("unbroken", [
        [{ text: "abcdefghij".repeat(15) }, { text: "klmnopqrst".repeat(85), bold: true }],
        [{ text: "abcdefghij".repeat(20) }, { text: "klmnopqrst".repeat(80), italic: true }],
      ]);
      await sameAsTex(page, resume, "unbroken-0.text");
      await sameAsTex(page, resume, "unbroken-1.text");
    }, 60_000);

    it("keeps an emptied field's place while the page lacks it", async () => {
      // Jake's template leaves an emptied bullet out, so the page compiled from the empty text has
      // none of its glyphs; the overlay stays where the bullet was, and open.
      const id = "fennel-1.text";
      const before = await jake(sample, "overlay-before-emptied");
      const field = fieldsOf(sample).get(id);
      if (field?.kind !== "rich") throw new Error(`the sample has no ${id}`);
      const emptied = field.set(sample, [{ text: "" }]);
      const after = await jake(emptied, "overlay-emptied");
      expect(after.page.fields.has(id)).toBe(false);
      const placed = placementFor(id, before.page, undefined);
      expect(placed?.layout).toBe(before.page.fields.get(id)?.layout);
      expect(placementFor(id, after.page, placed)).toBe(placed);
      expect(shouldClose(fieldsOf(emptied).has(id), after.page.fields.has(id))).toBe(false);
    }, 60_000);
  });

  describe("on the invented XeTeX template", () => {
    const { package: pkg, sample } = INVENTED_XETEX;
    const values = defaultControls(pkg);
    const format = generateFormat(pkg, values);

    /** The page of a resume set with the invented XeTeX template, drawn with every font. */
    async function invented(resume: Resume, job: string) {
      const dumped = session.dump(pkg.engine, format.name, format.preamble, format.files);
      if (!dumped.ok) throw new Error(dumped.error);
      const body = generateBody(pkg, resume, values);
      const result = session.compile(pkg.engine, format.name, body.latex, { job, maxPasses: 3 });
      if (!result.output) throw new Error(result.error);
      const page = await drawPage(result.output, fonts, body.texts);
      expect(page.missingFonts, job).toEqual(new Map());
      return page;
    }

    /** The sample with its first entry's bullets replaced by `bullets`, named `<prefix>-<i>`. */
    function withBullets(prefix: string, bullets: string[]): Resume {
      const resume = structuredClone(sample);
      const section = resume.sections.find((each) => each.kind === "entries");
      const entry = section?.kind === "entries" ? section.entries[0] : undefined;
      if (!entry) throw new Error("the sample has no entry");
      entry.bullets = bullets.map((text, i) => ({ id: `${prefix}-${i}`, text: [{ text }] }));
      return resume;
    }

    it("measures a field XeTeX stretches or letterspaces as the page sets it, and breaks there", async () => {
      // The page places each glyph where XeTeX did, extended and letterspaced; the overlay measures
      // the field's characters so, from the XDV's extend and the family's features, and so its
      // rows break where XeTeX's lines do. A paragraph Roboto neither kerns nor joins, as above.
      const text =
        "Built and shipped a new build system that cut the nightly build down in minutes while also making the tests run in all machines in the lab and it now helps the whole company plan its launches with much less guesswork than it used.";
      const cases = [
        ["extend=0.85", 30.28],
        ["letterspace=6.0", 38.91],
      ] as const;
      for (const [more, moved] of cases) {
        const variant = parsePackage({
          ...pkg,
          id: `invented-xetex-${more.split("=")[0]}`,
          fonts: pkg.fonts?.map((font) =>
            font.family === "Roboto" ? { ...font, features: `${font.features};${more}` } : font,
          ),
        });
        const chosen = defaultControls(variant);
        const made = generateFormat(variant, chosen);
        const dumped = session.dump(variant.engine, made.name, made.preamble, made.files);
        if (!dumped.ok) throw new Error(dumped.error);
        const body = generateBody(variant, withBullets("spaced", [text]), chosen);
        const job = `overlay-${more.split("=")[0]}`;
        const result = session.compile(variant.engine, made.name, body.latex, {
          job,
          maxPasses: 3,
        });
        if (!result.output) throw new Error(result.error);
        // Each file with the features its family loads it with, which the XDV does not record.
        const features = new Map(
          (variant.fonts ?? []).flatMap(({ shapes, features: loaded }) =>
            Object.values(shapes).map((file): [string, string] => [file, loaded ?? ""]),
          ),
        );
        const page = await drawPage(result.output, fonts, body.texts, 0, { features });
        expect(page.missingFonts, more).toEqual(new Map());
        // "Moved " on the page, from the M to the t after the space.
        const gull = body.texts.get("gull-1.text") ?? "";
        const glyphs = page.glyphs.filter((glyph) => glyph.field === "gull-1.text");
        const x = (offset: number) => glyphs.find((glyph) => glyph.offset === offset)?.x ?? NaN;
        const onPage = x(gull.indexOf("the")) - x(0);
        expect(onPage, more).toBeCloseTo(moved, 2);
        // The overlay's, within Roboto's kerning of o and v, and v and e, which it leaves to the page.
        const layout = page.fields.get("gull-1.text")?.layout;
        if (!layout) throw new Error("gull-1.text has no layout");
        const { face } = settingFor("gull-1.text", layout, page.size.width);
        const nodes = paragraphNodes("Moved the", face);
        let measured = 0;
        for (const node of nodes) {
          if (node.kind === "box" && node.offset < 6) measured += node.width;
          else if (node.kind === "kern") measured += node.width;
          else if (node.kind === "glue") {
            measured += node.width;
            break;
          }
        }
        // Roboto kerns them by 0.14 pt at this size, and extend by 85% of it.
        expect(Math.abs(measured / PT - onPage), more).toBeLessThan(0.2);
        const { rows, page: lines } = compare(page, "spaced-0.text", text);
        expect(rows, more).toEqual(lines);
      }
    }, 60_000);

    it("gives a native font the interword glue XeTeX gives it", async () => {
      // XeTeX's \fontdimen2, 3, 4 and 7 of Roboto at the invented template's 10.95 pt, printed in
      // scaled points: the space glyph's advance, half of it, a third and a third.
      const latex = String.raw`\documentclass{article}\begin{document}
\font\roboto="[Roboto-Regular.otf]" at 10.95pt
\typeout{DIMENS=\number\fontdimen2\roboto,\number\fontdimen3\roboto,\number\fontdimen4\roboto,\number\fontdimen7\roboto}
x\end{document}`;
      const printed = session.compile("xetex", "stock", latex, { job: "dimens", maxPasses: 1 });
      const dimens = /DIMENS=(\d+),(\d+),(\d+),(\d+)/.exec(printed.log)?.slice(1).map(Number);
      const roboto = await fonts.loadNative("Roboto-Regular.otf");
      if (!roboto) throw new Error("the tree has no Roboto");
      const { space, stretch, shrink, extraSpace } = faceFor({
        font: roboto,
        size: 10.95,
      }).spaceGlue();
      expect([space, stretch, shrink, extraSpace]).toEqual(dimens);
    }, 60_000);

    it("gives a native font the slant and italic corrections XeTeX gives it", async () => {
      // XeTeX's \fontdimen1 of Roboto Italic, and what \/ adds after an f and a d, in scaled
      // points at 10 pt: the tangent of its italic angle, and what each outline reaches past its
      // advance. LaTeX's \textit reads the first to set the second at its end (item 10).
      const latex = String.raw`\documentclass{article}\begin{document}
\font\it="[Roboto-Italic.otf]" at 10pt
\setbox0\hbox{\it f}\setbox2\hbox{\it f\/}\setbox4\hbox{\it d}\setbox6\hbox{\it d\/}
\typeout{ITALIC=\number\fontdimen1\it,\number\numexpr\wd2-\wd0\relax,\number\numexpr\wd6-\wd4\relax}
x\end{document}`;
      const printed = session.compile("xetex", "stock", latex, { job: "italic", maxPasses: 1 });
      const [slant, f, d] =
        /ITALIC=(\d+),(\d+),(\d+)/.exec(printed.log)?.slice(1).map(Number) ?? [];
      const italic = await fonts.loadNative("Roboto-Italic.otf");
      if (!italic?.file) throw new Error("the tree has no Roboto Italic");
      const face = faceFor({ font: italic, size: 10 });
      expect(Math.round(face.slant * PT)).toBe(slant);
      expect(face.italicOf(italic.file.glyphFor("f") ?? -1)).toBe(f);
      expect(face.italicOf(italic.file.glyphFor("d") ?? -1)).toBe(d);
      // And an upright font leans nothing.
      const upright = await fonts.loadNative("Roboto-Regular.otf");
      if (!upright) throw new Error("the tree has no Roboto");
      expect(faceFor({ font: upright, size: 10 }).slant).toBe(0);
    }, 60_000);

    it("breaks a paragraph Roboto neither kerns nor joins where XeTeX did, row for row", async () => {
      // No two letters of a word here are a pair Roboto kerns, and no f is joined to what
      // follows it, so XeTeX's words are as wide as their glyphs' advances, which the overlay
      // measures; the rows must end where XeTeX's lines do, to a hundredth of a point.
      const text =
        "Built and shipped a new build system that cut the nightly build down in minutes while also making the tests run in all machines in the lab and it now helps the whole company plan its launches with much less guesswork than it used.";
      const roboto = await fonts.loadNative("Roboto-Regular.otf");
      const file = roboto?.file;
      if (!file) throw new Error("the tree has no Roboto");
      const opened = parse(file.bytes.slice().buffer);
      for (const word of text.split(" ")) {
        expect(word, word).not.toMatch(/f[il]/);
        for (let i = 0; i + 1 < word.length; i++) {
          const pair = [word[i], word[i + 1]].map((char) => file.glyphFor(char ?? "") ?? 0);
          expect(opened.getKerningValue(pair[0] ?? 0, pair[1] ?? 0), word).toBe(0);
        }
      }
      const page = await invented(withBullets("plain", [text]), "overlay-xetex");
      const { rows, page: lines, setting, layout } = compare(page, "plain-0.text", text);
      expect(layout.font.kind).toBe("native");
      expect(lines).toHaveLength(3);
      expect(rows).toEqual(lines);
      const glyphs = page.glyphs.filter((glyph) => glyph.field === "plain-0.text");
      const at = (offset: number) => glyphs.find((glyph) => glyph.offset === offset)?.x ?? NaN;
      for (const row of overlayEnds(text, setting)) {
        const tex = at(row.last) - at(row.first);
        expect(Math.abs(row.x - tex), `at ${row.last}`).toBeLessThan(0.01);
      }
    }, 60_000);

    it("says how far the rows drift from a paragraph XeTeX kerns and joins", async () => {
      // Reported, not asserted: XeTeX kerns and joins within a word, which the overlay leaves to
      // the page (decision 0014), so its rows drift within a line, and may break a line apart.
      const text =
        "Wrote the typesetting service from scratch, cutting every proof's turnaround to forty minutes; every regional office now relies on it, and every team reviews layouts faster than before, with fewer errors and far less rework for the editors every year.";
      const page = await invented(withBullets("kerned", [text]), "overlay-xetex-kerned");
      const { rows, page: lines, setting } = compare(page, "kerned-0.text", text);
      const glyphs = page.glyphs.filter((glyph) => glyph.field === "kerned-0.text");
      const drift = rowDrift(text, setting, glyphs);
      console.log(
        `invented XeTeX template, a kerned paragraph: rows ${JSON.stringify(rows)}, XeTeX's lines ${JSON.stringify(lines)}; drift within a row at most ${drift.most.toFixed(2)} pt, ${drift.mean.toFixed(2)} pt on average over ${drift.glyphs} glyphs`,
      );
      expect(drift.glyphs).toBeGreaterThan(100);
    }, 60_000);
  });

  describe("on Awesome-CV with its text in Roboto", () => {
    const { package: pkg, sample } = curated("awesome-cv");
    const values = { ...defaultControls(pkg), font: "roboto" };
    const format = generateFormat(pkg, values);

    it("breaks a bullet Roboto Light neither kerns nor joins where XeTeX did, row for row", async () => {
      // The class sets an entry's bullets justified, in its light weight, which the font control
      // makes Roboto Light. No two letters of a word here are a pair Roboto Light kerns, and no
      // f is joined to what follows it, so XeTeX's words are as wide as their glyphs' advances,
      // which the overlay measures; the rows must end where XeTeX's lines do.
      const text =
        "Built and shipped a new build system that cut the nightly build down in minutes while also making the tests run in all machines in the lab and it now helps the whole company plan its launches with much less guesswork than it used, and then built the guide that the team still checks when it adds a machine or changes how the builds run in the lab each month.";
      const light = await fonts.loadNative("Roboto-Light.otf");
      const file = light?.file;
      if (!file) throw new Error("the tree has no Roboto Light");
      const opened = parse(file.bytes.slice().buffer);
      for (const word of text.split(" ")) {
        expect(word, word).not.toMatch(/f[il]/);
        for (let i = 0; i + 1 < word.length; i++) {
          const pair = [word[i], word[i + 1]].map((char) => file.glyphFor(char ?? "") ?? 0);
          expect(opened.getKerningValue(pair[0] ?? 0, pair[1] ?? 0), word).toBe(0);
        }
      }
      const resume = structuredClone(sample);
      const section = resume.sections.find((each) => each.kind === "entries");
      const entry = section?.kind === "entries" ? section.entries[0] : undefined;
      if (!entry) throw new Error("the sample has no entry");
      entry.bullets = [{ id: "plain-0", text: [{ text }] }];
      const dumped = session.dump(pkg.engine, format.name, format.preamble, format.files);
      if (!dumped.ok) throw new Error(dumped.error);
      const body = generateBody(pkg, resume, values);
      const job = "overlay-awesome";
      const result = session.compile(pkg.engine, format.name, body.latex, { job, maxPasses: 3 });
      if (!result.output) throw new Error(result.error);
      const page = await drawPage(result.output, fonts, body.texts);
      expect(page.missingFonts).toEqual(new Map());
      const { rows, page: lines, setting, layout } = compare(page, "plain-0.text", text);
      expect(layout.font.kind).toBe("native");
      expect(layout.font.name).toBe("Roboto-Light.otf");
      expect(lines).toHaveLength(3);
      expect(rows).toEqual(lines);
      const glyphs = page.glyphs.filter((glyph) => glyph.field === "plain-0.text");
      const at = (offset: number) => glyphs.find((glyph) => glyph.offset === offset)?.x ?? NaN;
      for (const row of overlayEnds(text, setting)) {
        const tex = at(row.last) - at(row.first);
        expect(Math.abs(row.x - tex), `at ${row.last}`).toBeLessThan(0.01);
      }
    }, 60_000);
  });

  it("breaks hanging, shaped, justified and ragged paragraphs where TeX did", async () => {
    const texts = new Map([
      [
        "hang.text",
        "Organised a volunteer reading programme across four branch libraries, recruiting tutors, scheduling weekly sessions and tracking progress for more than two hundred young readers over three years.",
      ],
      [
        "shape.text",
        "Designed the shared component library that three product teams now build on, with documented patterns for forms, tables and navigation, and a review process that keeps them consistent as the teams grow.",
      ],
      [
        "right.text",
        "Measured and cut the build pipeline from forty minutes to nine by caching dependencies, splitting the test suite across workers and removing steps nobody had needed for years.",
      ],
      [
        "mid.text",
        "TypeScript, Python, Rust, SQL, Go, Kotlin, Swift, Haskell, OCaml, Elixir, Clojure, Scala, Julia, Fortran, Zig, Nim, Crystal, Dart, Lua, Perl, Ruby, Erlang, Racket and Prolog.",
      ],
      [
        "ragged.text",
        "Wrote the evaluation harness for a typesetting study and ran it across four hundred documents, then turned its findings into a short guide that the next cohort of students used from their first week.",
      ],
    ]);
    const field = (id: string) => `\\rtfield{${id}}{${texts.get(id)}}`;
    // No hyphenation, which the overlay's breaker leaves as a hook (decision 0004).
    const page = await article(
      "overlay-shapes",
      "\\hyphenpenalty=10000\\parindent=0pt",
      [
        `{\\hangindent=3em\\hangafter=1 ${field("hang.text")}\\par}`,
        `{\\parshape 3 0pt 250pt 20pt 230pt 40pt 210pt ${field("shape.text")}\\par}`,
        `{\\hangindent=-6em\\hangafter=-2 ${field("right.text")}\\par}`,
        `Skills and tools: ${field("mid.text")}\\par`,
        `{\\raggedright ${field("ragged.text")}\\par}`,
      ].join("\n"),
      texts,
    );
    for (const [id, text] of texts) {
      const { rows, page: lines, setting } = compare(page, id, text);
      expect(lines.length, id).toBeGreaterThan(1);
      expect(rows, id).toEqual(lines);
      expect(setting.params, id).toBeDefined();
    }
  }, 60_000);

  it("finds where a field's lines start past a list's label, an indent and a column", async () => {
    // The reviewers' cases, where the leftmost glyph on the first baseline was not the line's
    // start: itemize's bullet sits on it, in the margin; \parindent's box draws nothing; and a
    // minipage beside the field's sets text on its baseline. Every field here has two lines or
    // more, whose second says where the paragraph's edge is.
    const itemize = new Map<string, string>();
    for (let i = 0; i < 12; i++) itemize.set(`b${i}.text`, sentence(i, 28 + (i % 5)));
    const indented = new Map<string, string>();
    for (let i = 0; i < 12; i++) indented.set(`p${i}.text`, sentence(i + 3, 28 + (i % 5)));
    const columns = new Map([["left.text", "Contact and skills"]]);
    for (let i = 0; i < 3; i++) columns.set(`r${i}.text`, sentence(i + 5, 30));
    const field = (texts: Map<string, string>) => (id: string) =>
      `\\rtfield{${id}}{${texts.get(id)}}`;
    const cases: [string, string, Map<string, string>, string][] = [
      [
        "itemize",
        "\\hyphenpenalty=10000",
        itemize,
        `\\begin{itemize}\n${[...itemize.keys()].map((id) => `\\item ${field(itemize)(id)}`).join("\n")}\n\\end{itemize}`,
      ],
      [
        "indent",
        "\\hyphenpenalty=10000",
        indented,
        [...indented.keys()].map((id) => `${field(indented)(id)}\\par`).join("\n"),
      ],
      [
        "columns",
        "\\hyphenpenalty=10000\\parindent=0pt",
        columns,
        `\\noindent\\begin{minipage}[t]{0.3\\textwidth}${field(columns)("left.text")}\\end{minipage}\\hfill\\begin{minipage}[t]{0.65\\textwidth}${field(columns)("r0.text")}\\par ${field(columns)("r1.text")}\\par ${field(columns)("r2.text")}\\end{minipage}`,
      ],
    ];
    for (const [name, preamble, texts, body] of cases) {
      const page = await article(`overlay-starts-${name}`, preamble, body, texts);
      let broken = 0;
      for (const [id, text] of texts) {
        const { rows, page: lines } = compare(page, id, text);
        if (lines.length < 2) continue;
        broken++;
        expect(rows, `${name} ${id}`).toEqual(lines);
      }
      expect(broken, name).toBeGreaterThan(name === "columns" ? 2 : 11);
    }
  }, 60_000);

  it("ends each row where TeX ends its line, ragged2e's rigid spaces included", async () => {
    // The reviewers' case: \RaggedRight's \rightskip has finite stretch and its \spaceskip makes
    // the spaces rigid, so the right skip takes each line's whole shortfall, where the overlay
    // widened the spaces and set the last word 17 pt right of TeX's.
    const text =
      "Measured and cut the build pipeline from forty minutes to nine by caching dependencies, splitting the test suite across workers and removing steps nobody had needed for years. Then wrote it up so the next team could run it.";
    const texts = new Map([
      ["rr.text", text],
      ["just.text", text],
      ["rag.text", text],
      [
        "over.text",
        "Maintained the build at https://ci.example.com/organisation/monorepo/pipelines/nightly-integration-suite and the release tooling for all teams.",
      ],
    ]);
    const field = (id: string) => `\\rtfield{${id}}{${texts.get(id)}}`;
    const page = await article(
      "overlay-spacing",
      "\\usepackage{ragged2e}\\hyphenpenalty=10000\\parindent=0pt",
      [
        `{\\RaggedRight ${field("rr.text")}\\par}`,
        `{${field("just.text")}\\par}`,
        `{\\raggedright ${field("rag.text")}\\par}`,
        `\\begin{minipage}{200pt}${field("over.text")}\\par\\end{minipage}`,
      ].join("\n"),
      texts,
    );
    for (const [id, text] of texts) {
      const { rows, page: lines, setting } = compare(page, id, text);
      expect(rows, id).toEqual(lines);
      const glyphs = page.glyphs.filter((glyph) => glyph.field === id);
      const at = (offset: number) => glyphs.find((glyph) => glyph.offset === offset)?.x ?? NaN;
      for (const row of overlayEnds(text, setting)) {
        const tex = at(row.last) - at(row.first);
        expect(Math.abs(row.x - tex), `${id} at ${row.last}`).toBeLessThan(0.01);
      }
    }
  }, 60_000);
});
