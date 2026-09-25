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
  richParagraphNodes,
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

describe("richParagraphNodes over runs in several fonts", () => {
  // Computer Modern's roman, bold and italic share OT1's layout for letters, so cmr10's glyph
  // names give the codes of all three.
  const codes = textToCode(parseType1(fixture("cmr10.pfb")).encoding);
  const faceOf = (name: string): Face => {
    const tfm = parseTfm(fixture(`${name}.tfm`));
    return { tfm, metrics: scaleTfm(tfm, 10 * PT), codeFor: (ch) => codes.get(ch), hyphenChar: 45 };
  };
  const roman = faceOf("cmr10");
  const bold = faceOf("cmbx10");
  const italic = faceOf("cmti10");
  const boxes = (nodes: Node[]) =>
    nodes.flatMap((n) => (n.kind === "box" ? [[n.offset, n.end, n.width]] : []));
  const glues = (nodes: Node[]) => nodes.filter((n) => n.kind === "glue");
  const widthOf = (face: Face, ch: string) => face.metrics.widths[codes.get(ch) ?? -1];

  it("sets a bold word in the middle of a line in the bold face's widths", () => {
    const nodes = richParagraphNodes([
      { text: "Led the ", face: roman },
      { text: "migration", face: bold },
      { text: " of it", face: roman },
    ]);
    const set = boxes(nodes);
    const inBold = set.filter(([from]) => (from as number) >= 8 && (from as number) < 17);
    expect(inBold.map(([from]) => from)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16]);
    for (const [from, , width] of inBold) {
      const ch = "Led the migration of it"[from as number] as string;
      expect(width, ch).toBe(widthOf(bold, ch));
      expect(width, ch).not.toBe(widthOf(roman, ch));
    }
    // The words on either side keep the roman widths.
    expect(set[0]).toEqual([0, 1, widthOf(roman, "L")]);
    expect(set.at(-1)).toEqual([22, 23, widthOf(roman, "t")]);
  });

  it("gives offsets over the joined text, which the lines tile", () => {
    const runs = [
      { text: "Rebuilt the ", face: roman },
      { text: "pipe", face: bold },
      { text: "line so", face: italic },
      { text: "\u00a0releases ship", face: roman },
      { text: " weekly without a manual step.", face: bold },
    ];
    const text = runs.map((run) => run.text).join("");
    const nodes = richParagraphNodes(runs);
    const offsets = nodes.flatMap((n) => (n.kind === "box" || n.kind === "glue" ? [n] : []));
    for (const [i, node] of offsets.entries()) {
      expect(node.offset).toBeLessThan(node.end);
      expect(node.offset).toBeGreaterThanOrEqual(offsets[i - 1]?.end ?? 0);
    }
    expect([offsets[0]?.offset, offsets.at(-1)?.end]).toEqual([0, text.length]);
    const narrow = { ...LATEX_PARAMS, lines: [{ indent: 0, width: 80 * PT }], rightSkip: FIL_GLUE };
    const ranges = lineRanges(nodes, breakLines(nodes, narrow), text.length);
    expect(ranges.length).toBeGreaterThan(2);
    expect(ranges.map((r) => text.slice(r.from, r.to)).join("")).toBe(text);
  });

  it("makes no ligature or kern across a run boundary inside a word", () => {
    const whole = boxes(richParagraphNodes([{ text: "office", face: roman }]));
    expect(whole.map(([from, to]) => [from, to])).toEqual([
      [0, 1],
      [1, 4],
      [4, 5],
      [5, 6],
    ]);
    // Split between the two f's, the first stays a letter and the second makes fi with the i.
    const split = boxes(
      richParagraphNodes([
        { text: "of", face: roman },
        { text: "fice", face: roman },
      ]),
    );
    expect(split.map(([from, to]) => [from, to])).toEqual([
      [0, 1],
      [1, 2],
      [2, 4],
      [4, 5],
      [5, 6],
    ]);
    // A and V kern in one run, and not across two.
    const kerns = (nodes: Node[]) => nodes.filter((n) => n.kind === "kern");
    expect(kerns(richParagraphNodes([{ text: "AV", face: roman }]))).toHaveLength(1);
    const apart = [
      { text: "A", face: roman },
      { text: "V", face: roman },
    ];
    expect(kerns(richParagraphNodes(apart))).toHaveLength(0);
  });

  it("takes a space's glue from its own run's font, and the space factor across runs", () => {
    const boldSpace = spaceGlue(bold.metrics, 1000);
    expect(boldSpace.width).not.toBe(spaceGlue(roman.metrics, 1000).width);
    const before = richParagraphNodes([
      { text: "Led ", face: bold },
      { text: "teams", face: roman },
    ]);
    const after = richParagraphNodes([
      { text: "Led", face: roman },
      { text: " teams", face: bold },
    ]);
    for (const nodes of [before, after]) expect(glues(nodes)).toMatchObject([boldSpace]);
    // The period ends a bold run, and the space after it, in the roman run, is a sentence's.
    const sentence = richParagraphNodes([
      { text: "Shipped.", face: bold },
      { text: " Then", face: roman },
    ]);
    expect(glues(sentence)[0]?.width).toBe(roman.metrics.space + roman.metrics.extraSpace);
  });

  it("sets spaces on both sides of a boundary as two glues, only the first a place to break", () => {
    const nodes = richParagraphNodes([
      { text: "aaaa bbbb ", face: roman },
      { text: " cccc dddd", face: bold },
    ]);
    expect(nodes.map((n) => n.kind)).toEqual([
      "box",
      "box",
      "box",
      "box",
      "glue",
      ...Array(4).fill("box"),
      "glue",
      "glue",
      ...Array(4).fill("box"),
      "glue",
      ...Array(4).fill("box"),
    ]);
  });

  it("sets an italic correction where LaTeX's \\/ puts it", () => {
    const kernAfter = (nodes: Node[], offset: number) => {
      const at = nodes.findIndex((n) => n.kind === "box" && n.end === offset);
      return nodes[at + 1];
    };
    const ic = italic.metrics.italics[codes.get("t") ?? -1] as number;
    expect(ic).toBeGreaterThan(0);
    const correction = { kind: "kern", width: ic };
    // After the last letter, before a space in either run, and before a no-break space's penalty.
    const cases = [
      [
        { text: "fast", face: italic, italicCorrection: true },
        { text: " car", face: roman },
      ],
      [
        { text: "fast ", face: italic, italicCorrection: true },
        { text: "car", face: roman },
      ],
      [
        { text: "fast\u00a0", face: italic, italicCorrection: true },
        { text: "car", face: roman },
      ],
    ];
    for (const runs of cases) {
      const nodes = richParagraphNodes(runs);
      expect(kernAfter(nodes, 4), JSON.stringify(runs[0]?.text)).toEqual(correction);
    }
    // Nothing after a hyphen's discretionary or an ellipsis's kern, or when LaTeX sets none.
    for (const text of ["well-", "so\u2026"]) {
      const nodes = richParagraphNodes([{ text, face: italic, italicCorrection: true }]);
      expect(
        nodes.filter((n) => n.kind === "kern" && n.width === ic),
        text,
      ).toEqual([]);
    }
    const none = richParagraphNodes([
      { text: "fast", face: italic },
      { text: " car", face: roman },
    ]);
    expect(kernAfter(none, 4)?.kind).toBe("glue");
  });

  it("breaks at a kern that comes before a space, as TeX breaks after an ellipsis", () => {
    const narrow = { ...LATEX_PARAMS, lines: [{ indent: 0, width: 40 * PT }], rightSkip: FIL_GLUE };
    for (const runs of [
      [{ text: "Wait\u2026 then go on", face: roman }],
      [
        { text: "Waited", face: italic, italicCorrection: true },
        { text: " then go on", face: roman },
      ],
    ]) {
      const text = runs.map((run) => run.text).join("");
      const nodes = richParagraphNodes(runs);
      const lines = breakLines(nodes, narrow);
      expect(nodes[lines[0]?.breakAt ?? -1]?.kind, text).toBe("kern");
      const ranges = lineRanges(nodes, lines, text.length);
      expect(text.slice(ranges[0]?.from, ranges[0]?.to), text).toBe(
        text.slice(0, text.indexOf(" ") + 1),
      );
    }
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
