import { describe, expect, it } from "vitest";
import { PRELUDE } from "../templates/prelude";
import type { GlyphStream } from "./reference";
import type { XetexRewrite } from "./xetex";
import { formatPreamble, normalized } from "./xetex-check";

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
