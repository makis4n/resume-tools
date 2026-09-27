import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { PRELUDE } from "../templates/prelude";
import type { Intake } from "./intake";
import type { GlyphStream, ReferenceItem } from "./reference";
import type { XetexRewrite } from "./xetex";
import {
  compareGlyphs,
  dumpFiles,
  formatPreamble,
  normalized,
  withBibliography,
} from "./xetex-check";

// Every rewrite and stream here is invented for these tests.

const rewrite: XetexRewrite = {
  preamble:
    "\\RequirePackage{rt-preamble}\n\\documentclass{article}\n\\RequirePackage{rt-fontspec}\n",
  body: "\\begin{document}\nInvented.\n\\end{document}\n",
  files: {},
  fonts: [
    {
      family: "RtQuire",
      shapes: {
        "m/n": "Roboto-Regular.otf",
        "m/sc": { file: "Roboto-Regular.otf", features: "+smcp" },
      },
      features: "script=latn;language=dflt",
    },
  ],
  warnings: [],
  mathFonts: [],
  deferred: [],
  features: {},
};

describe("formatPreamble", () => {
  it("is the rewritten preamble, its families declared by file, and the editor's prelude", () => {
    expect(formatPreamble(rewrite)).toBe(
      [
        rewrite.preamble,
        "\\DeclareFontFamily{TU}{RtQuire}{}",
        '\\DeclareFontShape{TU}{RtQuire}{m}{n}{<->"[Roboto-Regular.otf]:script=latn;language=dflt"}{}',
        '\\DeclareFontShape{TU}{RtQuire}{m}{sc}{<->"[Roboto-Regular.otf]:script=latn;language=dflt;+smcp"}{}',
        PRELUDE,
      ].join("\n"),
    );
    expect(formatPreamble({ ...rewrite, fonts: [] })).toBe(`${rewrite.preamble}\n${PRELUDE}`);
  });
});

describe("normalized", () => {
  it("names a native font by its file without its extension, and puts a colour special nowhere", () => {
    const stream: GlyphStream = {
      pages: [
        {
          items: [
            {
              kind: "glyph",
              font: "/tmp/upload/fonts/Roboto-Regular.ttf",
              native: true,
              size: 655360,
              code: 5,
              h: 10,
              v: 20,
            },
            { kind: "glyph", font: "cmr10", size: 655360, code: 65, h: 30, v: 20 },
            { kind: "special", h: 40, v: 20, text: "color push rgb 1 0 0" },
            {
              kind: "special",
              h: 50,
              v: 20,
              text: "pdf:dest (a) [@thispage /XYZ @xpos @ypos null]",
            },
          ],
        },
      ],
      size: { width: 612, height: 792 },
      fonts: { tex: ["cmr10"], native: ["Roboto-Regular.ttf"], shipped: [] },
      specials: ["color", "pdf:dest"],
    };
    expect(normalized(stream).pages[0]?.items).toEqual([
      { kind: "glyph", font: "roboto-regular", native: true, size: 655360, code: 5, h: 10, v: 20 },
      { kind: "glyph", font: "cmr10", size: 655360, code: 65, h: 30, v: 20 },
      { kind: "special", h: 0, v: 0, text: "color push rgb 1 0 0" },
      { kind: "special", h: 50, v: 20, text: "pdf:dest (a) [@thispage /XYZ @xpos @ypos null]" },
    ]);
  });
});

/** A glyph of an invented stream: a native font's by its file, or a TeX font's by its name. */
const glyph = (font: string, code: number, h: number, v = 100): ReferenceItem =>
  font.endsWith(".otf")
    ? { kind: "glyph", font, native: true, size: 655360, code, h, v }
    : { kind: "glyph", font, size: 655360, code, h, v };

/** An invented stream of one page of items. */
const stream = (...items: ReferenceItem[]): GlyphStream => ({
  pages: [{ items }],
  size: { width: 612, height: 792 },
  fonts: {
    tex: [
      ...new Set(
        items.flatMap((item) => (item.kind === "glyph" && !item.native ? [item.font] : [])),
      ),
    ],
    native: [],
    shipped: [],
  },
  specials: [],
});

describe("compareGlyphs", () => {
  const MATH = ["latinmodern-math.otf"];
  // Invented text set around a centre dot, the reference's in Latin Modern Math and the rewrite's
  // in TeX's own symbols.
  const text = (dot: ReferenceItem, after: number) =>
    stream(
      glyph("Roboto-Regular.otf", 40, 0),
      glyph("Roboto-Regular.otf", 41, 10),
      dot,
      glyph("Roboto-Regular.otf", 42, after),
    );

  it("finds the same streams the same, and any difference one without unicode-math taken out", () => {
    const reference = text(glyph("latinmodern-math.otf", 2625, 20), 30);
    expect(compareGlyphs(reference, reference, MATH)).toEqual({ kind: "same" });
    const ours = text(glyph("cmsy10", 1, 20), 30);
    expect(compareGlyphs(reference, ours, []).kind).toBe("difference");
  });

  it("lets a difference in math fonts' glyphs alone pass, in either stream", () => {
    const reference = text(glyph("latinmodern-math.otf", 2625, 20), 30);
    expect(compareGlyphs(reference, text(glyph("cmsy10", 1, 20), 30), MATH)).toEqual({
      kind: "maths",
    });
    // A font whose file's name says it is a math font is one, whichever unicode-math was told of.
    expect(
      compareGlyphs(reference, text(glyph("cmsy10", 1, 20), 30), ["texgyrepagella-math.otf"]).kind,
    ).toBe("maths");
  });

  it("refuses a difference that moves a glyph of the text, naming its font", () => {
    const reference = text(glyph("latinmodern-math.otf", 2625, 20), 30);
    const found = compareGlyphs(reference, text(glyph("cmsy10", 1, 20), 34), MATH);
    expect(found.kind === "difference" ? found.font : found.kind).toBe("roboto-regular");
  });

  it("refuses a body set in TeX's fonts where the reference sets it in its own, math or not", () => {
    // Every glyph of the text in a TFM font the reference never uses, as the body came out when
    // loading fontspec was dropped: the reference's glyphs of the text differ, and are no math
    // font's. A rule under the line stays where it was.
    const rule: ReferenceItem = { kind: "rule", h: 0, v: 200, width: 1000, height: 26214 };
    const reference = stream(
      glyph("Roboto-Regular.otf", 40, 0),
      glyph("Roboto-Regular.otf", 41, 10),
      glyph("latinmodern-math.otf", 2625, 20),
      glyph("Roboto-Regular.otf", 42, 30),
      rule,
    );
    const ours = stream(
      glyph("cmr10", 40, 0),
      glyph("cmr10", 41, 10),
      glyph("cmsy10", 1, 20),
      glyph("cmr10", 42, 30),
      rule,
    );
    const found = compareGlyphs(reference, ours, MATH);
    expect(found.kind === "difference" ? found.font : found.kind).toBe("roboto-regular");
  });

  it("refuses a difference in a rule, which a math font's parameters set, and in the pages", () => {
    const rule = (height: number): ReferenceItem => ({
      kind: "rule",
      h: 0,
      v: 200,
      width: 1000,
      height,
    });
    const reference = stream(glyph("latinmodern-math.otf", 2625, 20), rule(28833));
    const found = compareGlyphs(reference, stream(glyph("cmsy10", 1, 20), rule(26213)), MATH);
    expect(found.kind === "difference" ? (found.font ?? "layout") : found.kind).toBe("layout");
    const twoPages = { ...reference, pages: [...reference.pages, { items: [] }] };
    expect(compareGlyphs(twoPages, reference, MATH).kind).toBe("difference");
  });

  it("takes no TFM font the reference sets text in for a math font", () => {
    // cmr10 sets text in both streams: its glyphs are compared as the text's.
    const reference = stream(
      glyph("cmr10", 40, 0),
      glyph("latinmodern-math.otf", 2625, 20),
      glyph("cmr10", 41, 30),
    );
    const ours = stream(glyph("cmr10", 40, 0), glyph("cmsy10", 1, 20), glyph("cmr10", 41, 34));
    const found = compareGlyphs(reference, ours, MATH);
    expect(found.kind === "difference" ? found.font : found.kind).toBe("cmr10");
  });
});

describe("the check's files", () => {
  const bytes = (text: string) => strToU8(text);
  const main = "\\documentclass{article}\n\\begin{document}\nInvented.\n\\end{document}\n";
  const intake: Intake = {
    engine: "xetex",
    source: "xetex",
    main: { path: "cv.tex", text: main, bytes: bytes(main) },
    files: {},
    fonts: [],
    images: { replaced: [], dropped: [] },
    warnings: [],
  };

  it("gives each job the upload's bibliography under its own name", () => {
    const files = { "cv.bbl": bytes("\\begin{thebibliography}{1}\\end{thebibliography}") };
    expect(Object.keys(withBibliography(files, intake, "fonts")).sort()).toEqual([
      "cv.bbl",
      "fonts.bbl",
    ]);
    expect(withBibliography(files, intake, "fonts-body")["fonts-body.bbl"]).toBe(files["cv.bbl"]);
    expect(Object.keys(withBibliography({}, intake, "fonts"))).toEqual([]);
  });

  it("gives the dump every text file at the job's top, a class, a bibliography's, the rewrite's", () => {
    const files = Object.fromEntries(
      [
        "invented.cls",
        "rt-preamble.sty",
        "settings.tex",
        "refs.bib",
        "plain2.bst",
        "cv.bbl",
        "fonts.cfg",
        "photo.png",
        "parts/settings.tex",
      ].map((path) => [path, bytes("% invented")]),
    );
    expect(Object.keys(dumpFiles(files)).sort()).toEqual([
      "cv.bbl",
      "fonts.cfg",
      "invented.cls",
      "plain2.bst",
      "refs.bib",
      "rt-preamble.sty",
      "settings.tex",
    ]);
  });
});
