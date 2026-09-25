import { describe, expect, it } from "vitest";
import { breakLines, FIL_GLUE, LATEX_PARAMS, type Node } from "../tex/linebreak";
import { breakParams, type Paragraph, paragraphId, parseParagraph, startingAt } from "./paragraph";

const PT = 65536;

/** The special `\rt@par` writes for a bullet of Jake's Resume, as its page has it. */
const BULLET =
  "rt:p:fennel-1.text:hsize=542.02501pt;leftskip=0.0pt;rightskip=0.0pt plus 1.0fil;" +
  "parfillskip=0.0pt plus 1.0fil;pretolerance=100;tolerance=200;emergencystretch=0.0pt;" +
  "hangindent=0.0pt;hangafter=1;parshape=1;inner=0;shape=34.93008pt,507.09492pt";

/** The bullet's special with some values replaced, in decision 0007's order. */
function special(values: Record<string, string>, id = "fennel-1.text"): string {
  const pairs = BULLET.slice(BULLET.indexOf(":", 5) + 1)
    .split(";")
    .map((pair) => {
      const key = pair.slice(0, pair.indexOf("="));
      return `${key}=${values[key] ?? pair.slice(key.length + 1)}`;
    });
  return `rt:p:${id}:${pairs.join(";")}`;
}

const parsed = (values: Record<string, string>) => parseParagraph(special(values)) as Paragraph;

describe("parseParagraph", () => {
  it("reads every key of a bullet's special into scaled points and orders", () => {
    expect(parseParagraph(BULLET)).toEqual({
      id: "fennel-1.text",
      hsize: Math.round(542.02501 * PT),
      leftSkip: { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 },
      rightSkip: FIL_GLUE,
      parFillSkip: FIL_GLUE,
      pretolerance: 100,
      tolerance: 200,
      emergencyStretch: 0,
      hangIndent: 0,
      hangAfter: 1,
      shape: [{ indent: Math.round(34.93008 * PT), width: Math.round(507.09492 * PT) }],
      inner: false,
    });
  });

  it("reads glue and dimensions as \\the prints them", () => {
    const paragraph = parsed({
      leftskip: "3.33333pt plus 1.66666pt minus 1.11111pt",
      rightskip: "0.0pt plus -1.0fill minus 2.5filll",
      parfillskip: "0.0pt minus 1.0fil",
      emergencystretch: "-1.0pt",
      hangindent: "-12.5pt",
      pretolerance: "-1",
    });
    expect(paragraph.leftSkip).toEqual({
      width: 218453,
      stretch: 109226,
      stretchOrder: 0,
      shrink: 72818,
      shrinkOrder: 0,
    });
    expect(paragraph.rightSkip).toEqual({
      width: 0,
      stretch: -PT,
      stretchOrder: 2,
      shrink: 2.5 * PT,
      shrinkOrder: 3,
    });
    expect(paragraph.parFillSkip).toEqual({
      width: 0,
      stretch: 0,
      stretchOrder: 0,
      shrink: PT,
      shrinkOrder: 1,
    });
    expect(paragraph.emergencyStretch).toBe(-PT);
    expect(paragraph.hangIndent).toBe(-12.5 * PT);
    expect(paragraph.pretolerance).toBe(-1);
  });

  it("reads a shape of three lines, and none", () => {
    const three = parsed({ parshape: "3", shape: "0.0pt,200.0pt|20.0pt,180.0pt|-10.5pt,221.0pt" });
    expect(three.shape).toEqual([
      { indent: 0, width: 200 * PT },
      { indent: 20 * PT, width: 180 * PT },
      { indent: -10.5 * PT, width: 221 * PT },
    ]);
    expect(parsed({ parshape: "0", shape: "" }).shape).toEqual([]);
  });

  it("reads inner", () => {
    expect(parsed({ inner: "1" }).inner).toBe(true);
    expect(parsed({ inner: "0" }).inner).toBe(false);
  });

  it("reads the id whatever its case, and the values as they are", () => {
    const upper = `RT:P:FENNEL-1.TEXT:${BULLET.slice(BULLET.indexOf(":", 5) + 1)}`;
    expect(parseParagraph(upper)).toEqual(parseParagraph(BULLET));
    expect(paragraphId(upper)).toBe("fennel-1.text");
    expect(paragraphId("rt:b:fennel-1.text")).toBeUndefined();
    expect(paragraphId("rt:p:no-colon")).toBeUndefined();
  });

  it("refuses a special that is malformed", () => {
    const malformed = [
      "rt:b:fennel-1.text",
      "rt:p:fennel-1.text",
      BULLET.replace(";inner=0", ""),
      BULLET.replace("hsize=", "width="),
      BULLET.replace("tolerance=200;", "tolerance=200;tolerance=200;"),
      `${BULLET};extra=1`,
      special({ hsize: "12pc" }),
      special({ hsize: "12" }),
      special({ rightskip: "0.0pt plus 1.0fi" }),
      special({ tolerance: "200.0" }),
      special({ inner: "2" }),
      special({ inner: "constructor" }),
      special({ parshape: "2" }),
      special({ parshape: "0" }),
      special({ shape: "34.93008pt" }),
      special({ shape: "34.93008pt,507.09492pt,1.0pt" }),
    ];
    for (const text of malformed) expect(parseParagraph(text), text).toBeUndefined();
  });
});

describe("breakParams", () => {
  const hsize = 400 * PT;
  const lines = (values: Record<string, string>) =>
    breakParams(parsed({ hsize: "400.0pt", parshape: "0", shape: "", ...values })).lines;

  it("takes the lines from the shape, and the rest from the special and LaTeX", () => {
    const params = breakParams(parsed({ tolerance: "1000", emergencystretch: "3.0pt" }));
    expect(params.lines).toEqual([
      { indent: Math.round(34.93008 * PT), width: Math.round(507.09492 * PT) },
    ]);
    expect(params.tolerance).toBe(1000);
    expect(params.pretolerance).toBe(100);
    expect(params.emergencyStretch).toBe(3 * PT);
    expect(params.rightSkip).toEqual(FIL_GLUE);
    expect(params.linePenalty).toBe(LATEX_PARAMS.linePenalty);
    expect(params.adjDemerits).toBe(LATEX_PARAMS.adjDemerits);
    expect(params.doubleHyphenDemerits).toBe(LATEX_PARAMS.doubleHyphenDemerits);
    expect(params.finalHyphenDemerits).toBe(LATEX_PARAMS.finalHyphenDemerits);
  });

  it("sets every line \\hsize wide without hanging indentation", () => {
    expect(lines({})).toEqual([{ indent: 0, width: hsize }]);
    expect(lines({ hangafter: "-3" })).toEqual([{ indent: 0, width: hsize }]);
  });

  it("hangs lines after the first \\hangafter, or the first -\\hangafter lines", () => {
    const hung = { indent: 20 * PT, width: hsize - 20 * PT };
    const full = { indent: 0, width: hsize };
    expect(lines({ hangindent: "20.0pt", hangafter: "1" })).toEqual([full, hung]);
    expect(lines({ hangindent: "20.0pt", hangafter: "0" })).toEqual([hung]);
    expect(lines({ hangindent: "20.0pt", hangafter: "-2" })).toEqual([hung, hung, full]);
  });

  it("hangs a negative indent on the right, as TeX does", () => {
    const hung = { indent: 0, width: hsize - 20 * PT };
    expect(lines({ hangindent: "-20.0pt", hangafter: "-1" })).toEqual([
      hung,
      { indent: 0, width: hsize },
    ]);
  });

  it("spells out no more hanging lines than a page could hold", () => {
    expect(lines({ hangindent: "20.0pt", hangafter: "2147483647" })).toHaveLength(257);
  });
});

describe("startingAt", () => {
  const params = breakParams(parseParagraph(BULLET) as Paragraph);
  const [line] = params.lines;
  if (!line) throw new Error("the bullet has no line");

  it("shortens the first line of a field that starts after other text, and only that one", () => {
    const shifted = startingAt(params, 60 * PT);
    expect(shifted.lines).toEqual([
      { indent: line.indent + 60 * PT, width: line.width - 60 * PT },
      line,
    ]);
    // Words of 160 pt: three fit on the bullet's line, two after 60 pt of it, three on the next.
    const words: Node[] = [];
    for (let i = 0; i < 8; i++) {
      if (i > 0)
        words.push({
          kind: "glue",
          width: 3 * PT,
          stretch: PT,
          shrink: PT,
          stretchOrder: 0,
          shrinkOrder: 0,
          offset: 2 * i - 1,
          end: 2 * i,
        });
      words.push({ kind: "box", width: 160 * PT, offset: 2 * i, end: 2 * i + 1 });
    }
    const counts = (lines: ReturnType<typeof breakLines>) =>
      lines.map((l) => words.slice(l.from, l.breakAt).filter((n) => n.kind === "box").length);
    expect(counts(breakLines(words, params))).toEqual([3, 3, 2]);
    expect(counts(breakLines(words, shifted))).toEqual([2, 3, 3]);
  });

  it("keeps the later lines of a longer shape", () => {
    const shape = breakParams(
      parsed({ parshape: "3", shape: "0.0pt,200.0pt|20.0pt,180.0pt|40.0pt,160.0pt" }),
    );
    expect(startingAt(shape, 50 * PT).lines).toEqual([
      { indent: 50 * PT, width: 150 * PT },
      { indent: 20 * PT, width: 180 * PT },
      { indent: 40 * PT, width: 160 * PT },
    ]);
  });

  it("changes nothing for a field at its line's start", () => {
    expect(startingAt(params, 0)).toBe(params);
  });
});
