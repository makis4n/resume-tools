import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type DviFont, type PageItem, parseDvi } from "./dvi";
import { alignGlyphs, collectFields } from "./fields";
import { glyphText, textToCode } from "./glyphs";
import {
  badness,
  breakLines,
  type Face,
  FIL_GLUE,
  LATEX_PARAMS,
  lineRanges,
  type Node,
  paragraphNodes,
  spaceGlue,
  ZERO_GLUE,
} from "./linebreak";
import { applyLigKern, parseTfm, scaleTfm } from "./tfm";
import { parseType1 } from "./type1";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const PT = 65536;

describe("badness", () => {
  it("follows tex.web §108", () => {
    expect(badness(0, 100)).toBe(0);
    expect(badness(100, 0)).toBe(10000);
    expect(badness(100, 100)).toBe(100);
    expect(badness(50, 100)).toBe(12);
    expect(badness(1000, 100)).toBe(10000);
    // The large-argument branches agree with the small one where they overlap.
    expect(badness(7230584, 7230584)).toBe(100);
    expect(badness(7230585, 7230585)).toBe(100);
  });
});

/** Boxes of equal width joined by justifiable glue, for synthetic paragraphs. */
function words(widths: number[], glue = { width: 10, stretch: 5, shrink: 3 }): Node[] {
  const nodes: Node[] = [];
  let offset = 0;
  widths.forEach((w, i) => {
    if (i > 0) {
      nodes.push({
        kind: "glue",
        ...glue,
        stretchOrder: 0,
        shrinkOrder: 0,
        offset,
        end: offset + 1,
      });
      offset++;
    }
    nodes.push({ kind: "box", width: w, offset, end: offset + 1 });
    offset++;
  });
  return nodes;
}

describe("breakLines", () => {
  it("fits everything on one line when it fits", () => {
    const lines = breakLines(words([30, 30, 30]), {
      ...LATEX_PARAMS,
      lines: [{ indent: 0, width: 200 }],
    });
    expect(lines.map((l) => [l.from, l.breakAt])).toEqual([[0, 5]]);
    expect(lines[0]?.natural).toBe(110);
  });

  it("prefers two even lines over a full line and a short one", () => {
    // Greedy filling puts four words on line one (130 of 140) and leaves one word; TeX's
    // total-fit breaks 3 + 2 because the demerits of the stretched first line are lower
    // than those of a very loose... no: with parfillskip the last line is free, so the
    // choice is between (very loose 3-word line, free last) and (tight 4-word, free last).
    const lines = breakLines(words([30, 30, 30, 30, 30]), {
      ...LATEX_PARAMS,
      lines: [{ indent: 0, width: 140 }],
    });
    expect(lines.length).toBe(2);
  });

  it("never breaks where the previous node is discardable and honours penalties", () => {
    const nodes: Node[] = [
      { kind: "box", width: 30, offset: 0, end: 1 },
      { kind: "penalty", penalty: 10000 },
      {
        kind: "glue",
        width: 10,
        stretch: 5,
        shrink: 3,
        stretchOrder: 0,
        shrinkOrder: 0,
        offset: 1,
        end: 2,
      },
      { kind: "box", width: 30, offset: 2, end: 3 },
      {
        kind: "glue",
        width: 10,
        stretch: 5,
        shrink: 3,
        stretchOrder: 0,
        shrinkOrder: 0,
        offset: 3,
        end: 4,
      },
      { kind: "box", width: 30, offset: 4, end: 5 },
    ];
    const lines = breakLines(nodes, {
      ...LATEX_PARAMS,
      lines: [{ indent: 0, width: 75 }],
      tolerance: 10000,
    });
    // Line one cannot end at the glue after the infinite penalty, so it holds two words.
    expect(lines.map((l) => l.breakAt)).toEqual([4, 6]);
  });

  it("uses the emergency pass when nothing else fits", () => {
    const lines = breakLines(words([60, 60, 60]), {
      ...LATEX_PARAMS,
      lines: [{ indent: 0, width: 100 }],
      tolerance: 100,
      emergencyStretch: 50 * PT,
    });
    expect(lines.length).toBe(3);
  });
});

describe("paragraphNodes with Computer Modern", () => {
  const tfm = parseTfm(fixture("cmr10.tfm"));
  const metrics = scaleTfm(tfm, 10 * PT);
  const outlines = parseType1(fixture("cmr10.pfb"));
  const codes = textToCode(outlines.encoding);
  const face: Face = { tfm, metrics, codeFor: (ch) => codes.get(ch), hyphenChar: 45 };

  it("turns ligatures into one box that covers their characters", () => {
    const nodes = paragraphNodes("office", face);
    const boxes = nodes.filter((n) => n.kind === "box");
    // o, ffi, c, e: the three-letter ligature comes from two passes of the program.
    expect(boxes.map((b) => (b.kind === "box" ? [b.offset, b.end] : []))).toEqual([
      [0, 1],
      [1, 4],
      [4, 5],
      [5, 6],
    ]);
  });

  it("kerns pairs the font kerns", () => {
    const nodes = paragraphNodes("AV", face);
    expect(nodes.map((n) => n.kind)).toEqual(["box", "kern", "box"]);
    const kern = nodes[1];
    expect(kern?.kind === "kern" && kern.width < 0).toBe(true);
  });

  it("widens the space after a sentence and not after an initial", () => {
    const normal = spaceGlue(metrics, 1000);
    const [endSentence] = paragraphNodes("end. Next", face).filter((n) => n.kind === "glue");
    const [initial] = paragraphNodes("J. Doe", face).filter((n) => n.kind === "glue");
    expect(endSentence?.kind === "glue" && endSentence.width).toBe(
      normal.width + metrics.extraSpace,
    );
    expect(endSentence?.kind === "glue" && endSentence.stretch).toBe(normal.stretch * 3);
    expect(initial?.kind === "glue" && initial.width).toBe(normal.width);
  });

  it("adds a discretionary after an explicit hyphen but not after an en dash", () => {
    expect(paragraphNodes("re-use", face).some((n) => n.kind === "disc")).toBe(true);
    expect(paragraphNodes("2016 -- 2020", face).some((n) => n.kind === "disc")).toBe(false);
  });
});

describe("paragraphNodes over the text as the generator writes it", () => {
  const tfm = parseTfm(fixture("cmr10.tfm"));
  const metrics = scaleTfm(tfm, 10 * PT);
  const codes = textToCode(parseType1(fixture("cmr10.pfb")).encoding);
  const face: Face = { tfm, metrics, codeFor: (ch) => codes.get(ch), hyphenChar: 45 };
  const glues = (nodes: Node[]) => nodes.filter((n) => n.kind === "glue");
  const boxes = (nodes: Node[]) =>
    nodes.flatMap((n) => (n.kind === "box" ? [[n.offset, n.end, n.width]] : []));

  it("sets a no-break space as LaTeX's ~: a penalty of 10000 and a normal space", () => {
    // The generator writes U+00A0, U+202F and U+2007 as ~, \nobreakspace, which is \nobreak and a
    // control space: the interword glue at a space factor of 1000, even after a period.
    for (const tie of ["\u00a0", "\u202f", "\u2007"]) {
      const nodes = paragraphNodes(`Mr.${tie}Smith`, face);
      const at = nodes.findIndex((n) => n.kind === "penalty");
      expect(nodes[at], JSON.stringify(tie)).toEqual({ kind: "penalty", penalty: 10000 });
      expect(nodes[at + 1]).toEqual({
        kind: "glue",
        ...spaceGlue(metrics, 1000),
        offset: 3,
        end: 4,
      });
      expect(glues(nodes)).toHaveLength(1);
    }
    // A space and a tie are two glues, of which only the first, after a box, is a place to break.
    expect(paragraphNodes("a \u00a0b", face).map((n) => n.kind)).toEqual([
      "box",
      "glue",
      "penalty",
      "glue",
      "box",
    ]);
  });

  it("never breaks at a no-break space", () => {
    const narrow = { ...LATEX_PARAMS, lines: [{ indent: 0, width: 50 * PT }], rightSkip: FIL_GLUE };
    const rows = (text: string) => {
      const nodes = paragraphNodes(text, face);
      return lineRanges(nodes, breakLines(nodes, narrow), text.length).map((r) =>
        text.slice(r.from, r.to),
      );
    };
    expect(rows("aaaa bbbb cccc dddd")).toEqual(["aaaa bbbb ", "cccc dddd"]);
    expect(rows("aaaa bbbb\u00a0cccc dddd")).toEqual(["aaaa ", "bbbb\u00a0cccc ", "dddd"]);
  });

  it("sets nothing for what the generator leaves out, inside a word or between words", () => {
    // U+FEFF and the zero-width space never reach TeX, so "of\uFEFFfice" keeps its ffi ligature,
    // and a word runs on through one.
    expect(boxes(paragraphNodes("of\ufefffice", face)).map(([from, to]) => [from, to])).toEqual([
      [0, 1],
      [1, 5],
      [5, 6],
      [6, 7],
    ]);
    expect(glues(paragraphNodes("a\ufeffb", face))).toEqual([]);
    expect(glues(paragraphNodes("a \u200b b", face))).toHaveLength(1);
    // A vertical tab is a control the generator drops, where /\s/ would have made it a space.
    expect(glues(paragraphNodes("a\vb", face))).toEqual([]);
  });

  it("builds the glue between words from \\spaceskip and \\xspaceskip when they are set", () => {
    // ragged2e's \RaggedRight: the font's space with neither stretch nor shrink, widened after a
    // sentence as TeX widens any space when \xspaceskip is zero.
    const rigid = { ...ZERO_GLUE, width: metrics.space };
    const [space, sentence] = glues(paragraphNodes("One two. Three", face, { spaceSkip: rigid }));
    expect(space).toMatchObject({ width: metrics.space, stretch: 0, shrink: 0 });
    expect(sentence).toMatchObject({ width: metrics.space + metrics.extraSpace, stretch: 0 });
    const x = { ...FIL_GLUE, width: 5 * PT };
    const both = glues(paragraphNodes("One two. Three", face, { spaceSkip: rigid, xspaceSkip: x }));
    expect(both[1]).toMatchObject(x);
    expect(spaceGlue(metrics, 1000, { spaceSkip: ZERO_GLUE })).toEqual(spaceGlue(metrics, 1000));
  });

  it("sets an ellipsis as LaTeX's three periods, each followed by a kern", () => {
    // \textellipsis: .\kern\fontdimen3\font three times; a space after it follows a period.
    const nodes = paragraphNodes("so\u2026 then", face);
    const period = metrics.widths[codes.get(".") ?? -1] ?? 0;
    expect(nodes.slice(2, 8)).toEqual([
      { kind: "box", width: period, offset: 2, end: 3, code: codes.get(".") },
      { kind: "kern", width: metrics.stretch },
      { kind: "box", width: period, offset: 2, end: 3, code: codes.get(".") },
      { kind: "kern", width: metrics.stretch },
      { kind: "box", width: period, offset: 2, end: 3, code: codes.get(".") },
      { kind: "kern", width: metrics.stretch },
    ]);
    expect(glues(nodes)[0]).toMatchObject({ width: metrics.space + metrics.extraSpace });
  });

  it("measures a character the font lacks in another font of the field, apart from its run", () => {
    // LaTeX takes € from TS1 in a T1 paragraph: a box of that font, which ends the f's run, so the
    // f and the i beside it make no ligature.
    const euro = 7 * PT;
    const withEuro: Face = { ...face, widthOf: (ch) => (ch === "\u20ac" ? euro : undefined) };
    expect(boxes(paragraphNodes("f\u20aci", withEuro))).toEqual([
      [0, 1, metrics.widths[102]],
      [1, 2, euro],
      [2, 3, metrics.widths[105]],
    ]);
    // A character no font of the field has is dropped, as TeX drops it.
    expect(boxes(paragraphNodes("f\u20aci", face)).map(([from, to]) => [from, to])).toEqual([
      [0, 3],
    ]);
  });
});

describe("breaking the spike's three-line bullet where TeX did", () => {
  const TEXT =
    "Built a document pipeline that turns structured data into typeset pages, cutting the office's turnaround from days to minutes and removing a whole class of formatting errors, then wrote the runbook so the next team could operate it without help.";
  // Measured inside Jake's `\resumeItem` with `\message`: parshape 1, \@totalleftmargin, \linewidth,
  // \raggedright (rightskip and parfillskip 0pt plus 1fil), the LaTeX defaults otherwise.
  const params = {
    ...LATEX_PARAMS,
    lines: [{ indent: Math.round(34.93008 * PT), width: Math.round(507.09492 * PT) }],
    rightSkip: FIL_GLUE,
    parFillSkip: FIL_GLUE,
  };
  const tfm = parseTfm(fixture("cmr10.tfm"));
  const metrics = scaleTfm(tfm, 10 * PT);
  const outlines = parseType1(fixture("cmr10.pfb"));
  const codes = textToCode(outlines.encoding);
  const face: Face = { tfm, metrics, codeFor: (ch) => codes.get(ch), hyphenChar: 45 };

  // What TeX did, read back from the DVI: the field's glyphs grouped by baseline.
  const widthsFor = (font: DviFont) =>
    scaleTfm(parseTfm(fixture(`${font.name}.tfm`)), font.scale).widths;
  const doc = parseDvi(fixture("body.dvi"), widthsFor);
  const page = doc.pages[0];
  if (!page) throw new Error("fixture has no page");
  const textOf = (item: PageItem) => {
    if (item.kind !== "glyph") return undefined;
    const font = doc.fonts.get(item.font);
    if (font?.name !== "cmr10") return undefined;
    return glyphText(outlines.encoding[item.code] ?? "");
  };
  const field = collectFields(page, textOf).get("exp1-i1");
  if (!field) throw new Error("fixture has no exp1-i1 field");
  expect(alignGlyphs(field, TEXT)).toBe(0);
  const texLines: { from: number; to: number; natural: number }[] = [];
  for (const g of field.glyphs) {
    const item = page.items[g.item];
    if (item?.kind !== "glyph") continue;
    const line = texLines[texLines.length - 1];
    const v = item.v;
    const started =
      line && (page.items[field.glyphs[0]?.item ?? 0] as { v: number }).v !== undefined;
    void started;
    const last = texLines.length ? (texLines as { v?: number }[])[texLines.length - 1] : undefined;
    if (!last || last.v !== v) {
      texLines.push(Object.assign({ from: g.offset, to: g.offset, natural: 0 }, { v, h0: item.h }));
    }
    const cur = texLines[texLines.length - 1] as {
      from: number;
      to: number;
      natural: number;
      h0: number;
    };
    cur.to = g.offset + (g.text?.length ?? 1);
    cur.natural = item.h + item.width - cur.h0;
  }

  it("reads three lines back from the DVI", () => {
    expect(texLines.map((l) => [l.from, l.to])).toEqual([
      [0, 114],
      [115, 228],
      [229, 245],
    ]);
  });

  const nodes = paragraphNodes(TEXT, face);
  const lines = breakLines(nodes, params);
  const ranges = lineRanges(nodes, lines, TEXT.length);

  it("breaks at the same offsets", () => {
    // Ranges tile the text, so a line's end is the next line's start.
    expect(ranges.map((r) => [r.from, r.to])).toEqual([
      [0, 115],
      [115, 229],
      [229, 245],
    ]);
    expect(ranges.map((r) => r.from)).toEqual(texLines.map((l) => l.from));
  });

  it("measures each line to the scaled point", () => {
    // TeX shrank line two to the measure; the ragged lines keep their natural width.
    const set = lines.map((l) => Math.min(l.natural, l.width));
    expect(set).toEqual(texLines.map((l) => l.natural));
    expect(lines.map((l) => l.natural > l.width)).toEqual([false, true, false]);
  });
});

describe("line ranges tile the text", () => {
  const tfm = parseTfm(fixture("cmr10.tfm"));
  const metrics = scaleTfm(tfm, 10 * PT);
  const codes = textToCode(parseType1(fixture("cmr10.pfb")).encoding);
  const face: Face = { tfm, metrics, codeFor: (ch) => codes.get(ch), hyphenChar: 45 };
  const narrow = { ...LATEX_PARAMS, lines: [{ indent: 0, width: 60 * PT }], rightSkip: FIL_GLUE };
  const rangesOf = (text: string, params = narrow) => {
    const nodes = paragraphNodes(text, face);
    return lineRanges(nodes, breakLines(nodes, params), text.length);
  };
  const roundTrip = (text: string) =>
    rangesOf(text)
      .map((r) => text.slice(r.from, r.to))
      .join("");

  it("keeps leading and trailing whitespace and characters without a glyph", () => {
    for (const text of [
      " Built a document ",
      "\u201cBest\u201d award for the build \u2192",
      "🚀🚀🚀",
      "",
    ])
      expect(roundTrip(text), JSON.stringify(text)).toBe(text);
  });

  it("puts nothing between lines broken at a hyphen", () => {
    const text = "state-of-the-art pipeline work";
    const ranges = rangesOf(text);
    expect(ranges.length).toBeGreaterThan(1);
    expect(roundTrip(text)).toBe(text);
    expect(ranges.some((r) => text[r.to - 1] === "-")).toBe(true);
  });

  it("counts offsets in UTF-16 units", () => {
    const text = "Shipped 🚀 the pipeline rewrite end to end";
    const ranges = rangesOf(text);
    expect(ranges[ranges.length - 1]?.to).toBe(text.length);
    const boxes = paragraphNodes(text, face).filter((n) => n.kind === "box");
    const the = boxes.find((b) => b.kind === "box" && text.slice(b.offset, b.end) === "t");
    expect(the?.kind === "box" && the.offset).toBe(text.indexOf("the"));
  });

  it("gives a Unicode dash the width of its ligature spelling", () => {
    const width = (text: string) =>
      paragraphNodes(text, face).reduce((w, n) => w + ("width" in n ? n.width : 0), 0);
    expect(width("a\u2013b")).toBe(width("a--b"));
    expect(width("a\u2014b")).toBe(width("a---b"));
    expect(width("\u201cx\u201d")).toBe(width("``x''"));
    expect(width("it\u2019s")).toBe(width("it's"));
  });

  it("charges final hyphen demerits at the paragraph's end like TeX", () => {
    // Justified at 259pt, TeX prefers "…through a" / "re-org" over ending the first line
    // at the hyphen of "re-org", because a hyphenated last-but-one line costs 5000 more.
    const text = "Led the twenty-person build-and-release group through a re-org";
    const ranges = rangesOf(text, { ...LATEX_PARAMS, lines: [{ indent: 0, width: 259 * PT }] });
    expect(ranges.map((r) => text.slice(r.from, r.to))).toEqual([
      "Led the twenty-person build-and-release group through a ",
      "re-org",
    ]);
  });
});

describe("guards against crafted fonts", () => {
  it("stops a ligature program that never settles", () => {
    const tfm = parseTfm(fixture("cmr10.tfm"));
    // A program for 'A' whose only instruction replaces the left character with itself.
    const looped = {
      ...tfm,
      ligKern: [{ skip: 0, next: 65, op: 1, remainder: 65 }],
      chars: tfm.chars.map((c, i) => (i + tfm.bc === 65 && c ? { ...c, tag: 1, remainder: 0 } : c)),
    };
    expect(() => applyLigKern(looped, [65, 65])).toThrow(/does not terminate/);
  });

  it("rejects a TFM whose tables do not add up", () => {
    const bytes = fixture("cmr10.tfm").slice();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(2, 60000); // lh
    expect(() => parseTfm(bytes)).toThrow(/do not add up/);
  });
});
