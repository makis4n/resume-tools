import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import type { Engine as CompilerEngine } from "../editor/compiler";
import { fieldsOf, newDocument } from "../editor/document";
import { engineAvailable } from "../engine/node";
import type { CompileResult, DumpResult } from "../engine/session";
import { refusal } from "../import/refusal";
import type { Imported, ImportOutcome, ImportReport } from "../import/run";
import type { DrawnPage, FieldLayout } from "../page/draw";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { curated } from "../templates/curated";
import { JAKE_FORK } from "../test/jake-fork";
import { US_LETTER } from "../tex/svg";
import type { ImportTime } from "./import";
import {
  familyOf,
  familyTable,
  measureImportTyping,
  noneSkipped,
  percentile,
  skip,
  skippedCount,
  skippedLine,
  summaryLines,
  type TypingEdit,
  type TypingRow,
  typingStats,
  typingSummary,
  typingTable,
} from "./import-typing";
import { longestField } from "./measure";
import { engineManifest, importEngine, treeFonts } from "./node";

// Every resume here is invented: the fake engine's import comes to Jake's Resume's invented sample,
// and on the engine, the fork of Jake's Resume of invented words that the import's tests take.

const { package: jake, sample } = curated("jake");
const DOCUMENT = newDocument(jake.id, sample);

/** What an invented import comes to, as far as the measurement and the report read it. */
const IMPORTED: Imported = {
  package: jake,
  document: DOCUMENT,
  report: {
    engine: "pdftex",
    reference: { pages: [], images: [], bibliographyLeftOut: false },
    checks: {
      outcome: "assembled",
      fields: { editable: 40, raw: 0, required: 0, locked: {} },
      words: { editable: 40, locked: {} },
      controls: { offered: [], proven: [], dropped: [] },
      decisions: {},
      all: [],
    },
    locked: [],
    images: { replaced: [], dropped: [] },
    warnings: [],
    compiles: 2,
  } as unknown as ImportReport,
  upload: { files: [] },
  job: { files: {}, images: [] },
};

const FETCHED = { files: 0, bytes: 0, paths: [] };

/** A page as the fake draw makes it, one page long, showing `fields` with a layout each. */
function pageShowing(fields: readonly string[]): DrawnPage {
  return {
    svg: "<svg></svg>",
    size: US_LETTER,
    fields: new Map(fields.map((id) => [id, { layout: {} as FieldLayout }])) as DrawnPage["fields"],
    glyphs: [],
    pageCount: 1,
    unmatched: 0,
    missingFonts: new Map(),
    locked: new Map(),
  };
}

/** The fake draw never reads fonts. */
const NO_FONTS = () =>
  new FontLibrary(
    new TexLiveIndex({ release: "", layout: 0, bundles: [], files: {} }),
    async () => new Uint8Array(),
  );

/** A fake engine whose import comes to `outcome` at once, and whose compiles note their bodies. */
function fakeEngine(outcome: ImportOutcome) {
  const bodies: string[] = [];
  const engine: CompilerEngine = {
    start: async () => {},
    dump: async (): Promise<DumpResult> => ({
      ok: true,
      format: new Uint8Array([1]),
      ms: 1,
      log: "",
      fetched: FETCHED,
    }),
    putFormat: async () => {},
    forget: async () => {},
    compile: async (_kind, _format, body): Promise<CompileResult> => {
      bodies.push(body);
      return {
        ok: true,
        output: new Uint8Array([1]),
        pages: 1,
        passes: [5],
        log: "",
        fetched: FETCHED,
      };
    },
    pdf: async () => {
      throw new Error("no PDF is asked for");
    },
    importResume: async () => outcome,
    cancel: () => {},
    terminate: () => {},
  };
  return { engine, bodies };
}

describe("measureImportTyping", () => {
  async function measured(outcome: ImportOutcome, page: DrawnPage, edits = 3) {
    const { engine, bodies } = fakeEngine(outcome);
    const result = await measureImportTyping(
      {
        start: async () => engine,
        fonts: NO_FONTS,
        files: [{ name: "invented.zip", bytes: new Uint8Array([0x50, 0x4b]) }],
        draw: async () => page,
      },
      edits,
    );
    return { result, bodies };
  }

  it("edits the longest field the page shows, each edit through the scheduler to its page", async () => {
    const page = pageShowing([...fieldsOf(DOCUMENT.resume).keys()]);
    const { result, bodies } = await measured(IMPORTED, page);
    if ("refused" in result) throw new Error("refused");
    if (!result.typing.typed) throw new Error(`not typed: ${result.typing.why}`);
    expect(result.typing.field).toEqual(longestField(DOCUMENT.resume, page));
    expect(result.typing.field.kind).toBe("rich");
    expect(result.typing.edits).toHaveLength(3);
    // The page the import opened, then one compile an edit, each of the body as edited.
    expect(bodies).toHaveLength(4);
    expect(bodies[1]).not.toBe(bodies[0]);
    expect(bodies[2]).not.toBe(bodies[1]);
    for (const edit of result.typing.edits) {
      // The scheduler waits pdfTeX's pause, 100 ms, before an edit's compile.
      expect(edit.pauseMs).toBeGreaterThanOrEqual(90);
      expect(edit.pauseMs + edit.pageMs).toBeCloseTo(edit.ms, 6);
      expect(edit.compileMs).toBeLessThanOrEqual(edit.pageMs);
      expect(edit.drawMs).toBeLessThanOrEqual(edit.pageMs);
      expect(edit).toMatchObject({ passes: 1, pages: 1 });
    }
    // The import's own numbers are taken before the typing.
    expect(result.import.compiles).toBe(3);
  });

  it("times no edit when the page shows no field", async () => {
    const { result, bodies } = await measured(IMPORTED, pageShowing([]));
    if ("refused" in result) throw new Error("refused");
    expect(result.typing).toEqual({ typed: false, why: "no field", pages: 1 });
    expect(bodies).toHaveLength(1);
  });

  it("stops at the import's refusal", async () => {
    const { result } = await measured(refusal("probe"), pageShowing([]));
    expect("refused" in result && result.refused.refused.reason).toBe("probe");
  });
});

/** Invented edits of a resume, each `ms` by the page's own time, after a 100 ms pause. */
const edits = (...ms: number[]): TypingEdit[] =>
  ms.map((page) => ({
    ms: page + 100,
    pauseMs: 100,
    pageMs: page,
    compileMs: page * 0.6,
    drawMs: page * 0.3,
    passes: 1,
    pages: 1,
  }));

/** An invented resume typed on. */
const row = (id: string, ...ms: number[]): TypingRow => ({
  id,
  family: familyOf(id),
  engine: "pdftex",
  field: { kind: "rich", characters: 120 },
  edits: edits(...ms),
  import: { ms: 4200, compiles: 30 },
});

describe("the typing's numbers", () => {
  const rows = [
    row("jake-0001", 80, 90, 100),
    row("other-0001", 200, 250, 400),
    row("other-0002", 310, 320, 330),
    row("moderncv-0001", 120, 140, 900),
  ];

  it("takes a resume's medians and slowest, with and without the pause", () => {
    expect(typingStats(edits(80, 100, 90))).toEqual({
      median: 90,
      slowest: 100,
      pause: 100,
      compile: 54,
      draw: 27,
      withPause: 190,
      slowestWithPause: 200,
      pages: 1,
      reran: 0,
    });
  });

  it("takes the percentile by the nearest rank", () => {
    const ten = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    expect(percentile(ten, 0.9)).toBe(9);
    expect(percentile(ten, 0.5)).toBe(5);
    expect(percentile([42], 0.9)).toBe(42);
  });

  it("judges each resume's median edit against 300 ms by the page's own time", () => {
    expect(typingSummary(rows)).toEqual({
      resumes: 4,
      under: 3,
      share: 0.75,
      median: (140 + 250) / 2,
      p90: 320,
      slowest: 320,
      slowestEdit: 900,
      withPause: { median: (240 + 350) / 2, p90: 420, slowest: 420 },
    });
    expect(typingSummary([])).toBeUndefined();
  });

  it("lays out a row a resume and a row a family, ids and numbers only", () => {
    expect(typingTable(rows)).toMatch(
      /\nother-0002 +other +pdftex +1 +rich, 120 ch +320 ms +330 ms +100 ms +192 ms +96 ms +420 ms +4\.20 s, 30 compiles/,
    );
    const families = familyTable(rows);
    expect(families).toMatch(/\nother +2 +1 \(50%\) +285 ms +320 ms +320 ms +385 ms/);
    expect(families).toMatch(/\nall +4 +3 \(75%\) +195 ms +320 ms +320 ms +295 ms$/);
  });

  it("counts what it skipped, by why", () => {
    const skipped = noneSkipped();
    skip(skipped, "failed");
    skip(skipped, { refused: { refused: refusal("probe"), startMs: 1, parts: [] } });
    skip(skipped, { refused: { refused: refusal("probe"), startMs: 1, parts: [] } });
    skip(skipped, {
      import: {} as ImportTime,
      typing: { typed: false, why: "no field", pages: 1 },
    });
    expect(skippedCount(skipped)).toBe(4);
    expect(skippedLine(skipped)).toBe(
      "Skipped 4: refused 2 (probe 2), no editable field 1, the edit refused 0, failed 1.",
    );
    expect(skippedLine(noneSkipped())).toBe("None skipped.");
    const lines = summaryLines(rows, skipped);
    expect(lines[0]).toBe(
      "3 of 4 resumes (75%) edit to the page within 300 ms by the page's own time, the median edit of each.",
    );
    expect(lines[1]).toBe(
      "Their medians: median 195 ms, p90 320 ms, slowest 320 ms; the slowest single edit 900 ms.",
    );
    expect(summaryLines([], noneSkipped())[0]).toBe("No resume was typed on.");
  });
});

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("measureImportTyping, on the engine", () => {
  it("types on an invented fork of Jake's Resume once it is imported", async () => {
    const manifest = engineManifest();
    const result = await measureImportTyping(
      {
        start: () => importEngine(manifest),
        fonts: () => treeFonts(manifest),
        files: [{ name: "resume.tex", bytes: strToU8(JAKE_FORK) }],
      },
      2,
    );
    if ("refused" in result) throw new Error(`refused: ${result.refused.refused.message}`);
    if (!result.typing.typed) throw new Error(`not typed: ${result.typing.why}`);
    expect(result.typing.edits).toHaveLength(2);
    for (const edit of result.typing.edits) {
      expect(edit.compileMs).toBeGreaterThan(0);
      expect(edit.drawMs).toBeGreaterThan(0);
      expect(edit.compileMs + edit.drawMs).toBeLessThanOrEqual(edit.pageMs);
      expect(edit.pageMs).toBeLessThan(edit.ms);
      expect(edit.pages).toBe(1);
    }
  }, 60_000);
});
