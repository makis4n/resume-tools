import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Resume } from "@resume-tools/resume-model";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { type DrawnPage, drawPage } from "../page/draw";
import { FontLibrary } from "../page/fonts";
import { breakParams, type Paragraph, parseParagraph } from "../page/paragraph";
import { TexLiveIndex } from "../page/texlive";
import { curated } from "../templates/curated";
import { generateBody, generateFormat } from "../templates/generate";
import { defaultControls } from "../templates/package";
import { PRELUDE } from "../templates/prelude";
import { textToCode } from "../tex/glyphs";
import { type Face, LATEX_PARAMS } from "../tex/linebreak";
import { parseTfm, scaleTfm } from "../tex/tfm";
import { parseType1 } from "../tex/type1";
import { datesCommand, layoutRows, type Row, rowOf, settingFor } from "./Overlay";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../tex/fixtures/${name}`, import.meta.url)));
const PT = 65536;

/** cmr10 at 10 pt from the fixtures, which the spike measured Jake's bullets in. */
function cmr10(): Face {
  const tfm = parseTfm(fixture("cmr10.tfm"));
  const codes = textToCode(parseType1(fixture("cmr10.pfb")).encoding);
  return { tfm, metrics: scaleTfm(tfm, 10 * PT), codeFor: (ch) => codes.get(ch), hyphenChar: 45 };
}

/** The spike's three-line bullet, set in Jake's `\resumeItem`. */
const BULLET =
  "Built a document pipeline that turns structured data into typeset pages, cutting the office's turnaround from days to minutes and removing a whole class of formatting errors, then wrote the runbook so the next team could operate it without help.";

/** The paragraph special of a bullet in Jake's `\resumeItem`, as `\rt@par` writes it. */
const BULLET_PARAGRAPH = parseParagraph(
  "rt:p:fennel-1.text:hsize=542.02501pt;leftskip=0.0pt;rightskip=0.0pt plus 1.0fil;" +
    "parfillskip=0.0pt plus 1.0fil;pretolerance=100;tolerance=200;emergencystretch=0.0pt;" +
    "hangindent=0.0pt;hangafter=1;parshape=1;inner=0;shape=34.93008pt,507.09492pt",
) as Paragraph;

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

  it("sets a field TeX never breaks on one row, and an empty field on one empty row", () => {
    expect(layoutRows(BULLET, face, undefined)).toEqual([
      { from: 0, to: BULLET.length, wordSpacingSp: 0 },
    ]);
    expect(layoutRows("", face, params)).toEqual([{ from: 0, to: 0, wordSpacingSp: 0 }]);
  });

  it("breaks a keystroke's text again well within a frame", () => {
    // What a keystroke costs besides the DOM: the bullet's nodes, breaks and rows, each time.
    const times: number[] = [];
    for (let i = 0; i < 25; i++) {
      const typed = `${BULLET.slice(0, 100 + i)}x${BULLET.slice(100 + i)}`;
      const started = performance.now();
      layoutRows(typed, face, params);
      times.push(performance.now() - started);
    }
    const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? Infinity;
    expect(median).toBeLessThan(50);
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

  it("keeps a start stored as a year, and reads an end that is not a month as none", () => {
    expect(datesCommand("marginalia.dates", "2023", "present")).toMatchObject({
      dates: { start: "2023", end: "present" },
    });
    expect(datesCommand("marginalia.dates", "2023-01", "")).toMatchObject({
      dates: { start: "2023-01" },
    });
  });

  it("sends nothing without a start", () => {
    expect(datesCommand("fennel.dates", "", "2023-02")).toBeUndefined();
    expect(datesCommand("fennel.dates", "2020-13", undefined)).toBeUndefined();
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
  return { rows: rowStarts(text, rows), page: pageLines(page, id), setting };
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

  describe("on Jake's Resume", () => {
    const { package: pkg, sample } = curated("jake");
    const values = defaultControls(pkg);
    const format = generateFormat(pkg, values);

    /** The page of a resume set with Jake's Resume, and its fields' texts. */
    async function jake(resume: Resume, job: string) {
      const dumped = session.dump(pkg.engine, format.name, format.preamble, format.files);
      if (!dumped.ok) throw new Error(dumped.error);
      const body = generateBody(pkg, resume, values);
      const result = session.compile(pkg.engine, format.name, body.latex, { job, maxPasses: 3 });
      if (!result.output) throw new Error(result.error);
      return { page: await drawPage(result.output, fonts, body.texts), texts: body.texts };
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
    const latex = [
      "\\documentclass{article}\\usepackage[T1]{fontenc}\\usepackage{lmodern}",
      PRELUDE,
      "\\hyphenpenalty=10000\\parindent=0pt\\begin{document}",
      `{\\hangindent=3em\\hangafter=1 ${field("hang.text")}\\par}`,
      `{\\parshape 3 0pt 250pt 20pt 230pt 40pt 210pt ${field("shape.text")}\\par}`,
      `{\\hangindent=-6em\\hangafter=-2 ${field("right.text")}\\par}`,
      `Skills and tools: ${field("mid.text")}\\par`,
      `{\\raggedright ${field("ragged.text")}\\par}`,
      "\\end{document}",
    ].join("\n");
    const compiled = session.compile("pdftex", "stock", latex, { job: "overlay-shapes" });
    if (!compiled.output) throw new Error(compiled.error);
    const page = await drawPage(compiled.output, fonts, texts);
    expect(page.missingFonts).toEqual(new Map());
    for (const [id, text] of texts) {
      const { rows, page: lines, setting } = compare(page, id, text);
      expect(lines.length, id).toBeGreaterThan(1);
      expect(rows, id).toEqual(lines);
      expect(setting.params, id).toBeDefined();
    }
  }, 60_000);
});
