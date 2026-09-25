import type { RichText, Run } from "@resume-tools/resume-model";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import {
  breakRuns,
  docToRuns,
  linePositions,
  RICH_SCHEMA,
  runsToDoc,
  type Variant,
  variantFonts,
} from "./rich";

const schema = getSchema(RICH_SCHEMA);

/** The runs back from the document the editor would open on `runs`. */
const roundTrip = (runs: RichText) => docToRuns(Node.fromJSON(schema, runsToDoc(runs)));

describe("runs as a document and back", () => {
  it("keeps runs with every combination of marks", () => {
    const runs: Run[] = [];
    for (const bold of [false, true])
      for (const italic of [false, true])
        for (const href of [undefined, "example.org/quill"]) {
          const run: Run = { text: `${runs.length} ` };
          if (bold) run.bold = true;
          if (italic) run.italic = true;
          if (href !== undefined) run.href = href;
          runs.push(run);
        }
    expect(runs).toHaveLength(8);
    expect(roundTrip(runs)).toEqual(runs);
    // Two links side by side with different addresses stay two runs.
    const links = [
      { text: "one", href: "example.org/a" },
      { text: "two", href: "example.org/b" },
    ];
    expect(roundTrip(links)).toEqual(links);
  });

  it("joins runs with the same marks, drops empty runs, and reads false marks as none", () => {
    expect(
      roundTrip([
        { text: "Led ", bold: true },
        { text: "" },
        { text: "the team", bold: true, italic: false },
        { text: " of four", bold: false },
      ]),
    ).toEqual([{ text: "Led the team", bold: true }, { text: " of four" }]);
  });

  it("opens an empty field on an empty paragraph, which holds no runs", () => {
    expect(runsToDoc([])).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(roundTrip([])).toEqual([]);
    expect(roundTrip([{ text: "" }])).toEqual([]);
  });

  it("keeps an address as typed, even one that will not be linked", () => {
    for (const href of ["", " javascript:void(0) ", "#top", "mailto:ada@example.org"])
      expect(roundTrip([{ text: "here", href }])).toEqual([{ text: "here", href }]);
  });
});

describe("variantFonts", () => {
  // "Led " bold, "the Quill" italic and " rewrite, €4M" a link: 26 characters in all.
  const runs: RichText = [
    { text: "Led ", bold: true },
    { text: "the Quill", italic: true },
    { text: " rewrite, €4M", href: "example.org" },
  ];
  const glyph = (offset: number, font: string) => ({ offset, font });

  it("gives each variant the font of its runs' glyphs", () => {
    const glyphs = [
      ...[0, 1, 2].map((offset) => glyph(offset, "bold")),
      ...[4, 5, 6, 8, 9, 10, 11, 12].map((offset) => glyph(offset, "italic")),
      ...[14, 15, 16].map((offset) => glyph(offset, "regular")),
    ];
    expect(variantFonts(runs, glyphs)).toEqual(
      new Map<Variant, string>([
        ["bold", "bold"],
        ["italic", "italic"],
        ["regular", "regular"],
      ]),
    );
  });

  it("takes the font of a run's letters over a companion font's symbol before them", () => {
    // The link's "€4M" as the page sets it, the € from TS1 first: letters decide, then glyphs.
    const glyphs = [glyph(23, "ts1"), glyph(24, "roman"), glyph(25, "roman")];
    expect(variantFonts(runs, glyphs).get("regular")).toBe("roman");
    // Among symbols alone, the font that sets the most, then the first.
    expect(variantFonts([{ text: "€€×" }], [glyph(0, "a"), glyph(1, "b"), glyph(2, "b")])).toEqual(
      new Map([["regular", "b"]]),
    );
    expect(variantFonts([{ text: "€×" }], [glyph(0, "a"), glyph(1, "b")])).toEqual(
      new Map([["regular", "a"]]),
    );
  });

  it("leaves out a variant with no glyph, and ignores glyphs past the text", () => {
    const table = variantFonts(runs, [glyph(0, "bold"), glyph(99, "stray")]);
    expect(table).toEqual(new Map([["bold", "bold"]]));
    expect(variantFonts([], [glyph(0, "any")])).toEqual(new Map());
  });
});

describe("breakRuns", () => {
  const slanted = (variant: Variant) => variant === "italic" || variant === "boldItalic";
  const corrections = (runs: RichText) =>
    breakRuns(runs, slanted).map((run) => [run.text, run.variant, run.italicCorrection]);

  it("sets an italic correction after \\textit and \\textbf unless a comma or period follows", () => {
    expect(
      corrections([
        { text: "Led", italic: true },
        { text: " the " },
        { text: "Quill", bold: true },
        { text: ", then " },
        { text: "shipped", italic: true },
        { text: "." },
      ]),
    ).toEqual([
      ["Led", "italic", true],
      [" the ", "regular", true],
      ["Quill", "bold", false],
      [", then ", "regular", false],
      ["shipped", "italic", false],
      [".", "regular", false],
    ]);
  });

  it("sets one before \\textbf for the character before it, unless its text starts with , or .", () => {
    expect(
      corrections([
        { text: "Chief " },
        { text: "Engineer", bold: true },
        { text: " at" },
        { text: ", Quill", bold: true },
      ]),
    ).toEqual([
      ["Chief ", "regular", true],
      ["Engineer", "bold", true],
      [" at", "regular", false],
      [", Quill", "bold", true],
    ]);
  });

  it("always sets one inside \\href and \\textbf, and none past a link's specials", () => {
    expect(
      corrections([
        { text: "Quill", italic: true, href: "example.org" },
        { text: ".", bold: true, italic: true },
        { text: "Report", bold: true, href: "example.org/report" },
        { text: "Next", bold: true },
        { text: " tools", href: "example.org/tools" },
        { text: " " },
        { text: "all", bold: true },
      ]),
    ).toEqual([
      ["Quill", "italic", true],
      [".", "boldItalic", true],
      ["Report", "bold", true],
      ["Next", "bold", true],
      [" tools", "regular", false],
      [" ", "regular", false],
      ["all", "bold", true],
    ]);
  });

  it("sets none for a run of spaces, which LaTeX takes for \\space, or after a slanted font", () => {
    expect(
      corrections([
        { text: "a" },
        { text: " ", italic: true },
        { text: "b", italic: true, bold: true },
      ]),
    ).toEqual([
      ["a", "regular", false],
      [" ", "italic", true],
      ["b", "boldItalic", true],
    ]);
    const allSlanted = breakRuns([{ text: "a", italic: true }, { text: "b" }], () => true);
    expect(allSlanted.map((run) => run.italicCorrection)).toEqual([false, false]);
  });

  it("joins runs TeX reads as one text: plain beside an unlinked link, or around nothing", () => {
    expect(
      corrections([
        { text: "of" },
        { text: "fice", href: "#section" },
        { text: "\u200b", bold: true },
        { text: " hours" },
        { text: "x", bold: true },
      ]),
    ).toEqual([
      ["office\u200b hours", "regular", true],
      ["x", "bold", true],
    ]);
  });
});

describe("linePositions", () => {
  it("puts each break after the space TeX broke at, one past the paragraph's opening", () => {
    // "Led the migration of " and "three services": the break is at the start of "three".
    const rows = [
      { from: 0, to: 21, wordSpacingSp: 0 },
      { from: 21, to: 35, wordSpacingSp: 5 },
    ];
    expect(linePositions(rows)).toEqual({
      breaks: [22],
      lines: [
        { from: 1, to: 22, wordSpacingSp: 0 },
        { from: 22, to: 36, wordSpacingSp: 5 },
      ],
    });
    expect(linePositions([{ from: 0, to: 0 }])).toEqual({
      breaks: [],
      lines: [{ from: 1, to: 1 }],
    });
  });
});
