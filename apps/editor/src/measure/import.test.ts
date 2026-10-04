import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import type { Engine as CompilerEngine } from "../editor/compiler";
import { newDocument } from "../editor/document";
import { engineAvailable } from "../engine/node";
import type { CompileResult, DumpResult } from "../engine/session";
import type { Upload } from "../import/intake";
import { refusal } from "../import/refusal";
import { outcomeOf } from "../import/report";
import {
  IMPORT_STEPS,
  type Imported,
  type ImportOutcome,
  type ImportProgress,
  type ImportReport,
  type ImportStep,
} from "../import/run";
import type { DrawnPage } from "../page/draw";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { curated } from "../templates/curated";
import { generateFormat } from "../templates/generate";
import { JAKE_FORK } from "../test/jake-fork";
import { US_LETTER } from "../tex/svg";
import {
  type Heard,
  IMPORT_BAR,
  IMPORT_JUDGED_ON,
  IMPORT_SAMPLES,
  IMPORT_TARGET,
  type ImportMeasured,
  type ImportTime,
  importMedians,
  importMeets,
  importRuns,
  importTable,
  importVerdict,
  isRefused,
  measureImport,
  outcomeLine,
  type PartTime,
  partsOf,
} from "./import";
import { engineManifest, importEngine, treeFonts } from "./node";

// Every import here is invented: the fake engine's words and outcome, and on the engine, the fork of
// Jake's Resume of invented words that the import's own tests take (`../test/jake-fork.ts`).

/** What the import says as it goes: a step, the compiles so far, and whether one is under way. */
const said = (step: ImportStep, compiles: number, compiling: boolean): ImportProgress => ({
  step,
  label: IMPORT_STEPS[step],
  compiles,
  compiling,
});

describe("partsOf", () => {
  it("times each step from its first word to the next step's, and the wait before the first", () => {
    const heard: Heard[] = [
      { at: 110, progress: said("intake", 0, false) },
      { at: 112, progress: said("reference", 0, false) },
      // A compile, from its first word to its last.
      { at: 113, progress: said("reference", 1, true) },
      { at: 413, progress: said("reference", 1, false) },
      { at: 418, progress: said("validate", 1, false) },
      // A dump, which adds no compile, and then a compile.
      { at: 419, progress: said("validate", 1, true) },
      { at: 819, progress: said("validate", 1, false) },
      { at: 821, progress: said("validate", 2, true) },
      { at: 921, progress: said("validate", 2, false) },
    ];
    const parts = partsOf(100, heard, 924);
    expect(parts).toEqual([
      { part: "load", ms: 10, compiles: 0, dumps: 0, engineMs: 0 },
      { part: "intake", ms: 2, compiles: 0, dumps: 0, engineMs: 0 },
      { part: "reference", ms: 306, compiles: 1, dumps: 0, engineMs: 300 },
      { part: "validate", ms: 506, compiles: 1, dumps: 1, engineMs: 500 },
    ]);
    // The parts are the whole.
    expect(parts.reduce((sum, part) => sum + part.ms, 0)).toBe(824);
  });

  it("adds a step named again to its first, and gives the whole to the wait when nothing is said", () => {
    const heard: Heard[] = [
      { at: 0, progress: said("probe", 0, false) },
      { at: 5, progress: said("outline", 0, false) },
      { at: 7, progress: said("probe", 0, false) },
    ];
    expect(partsOf(0, heard, 10).map(({ part, ms }) => [part, ms])).toEqual([
      ["load", 0],
      ["probe", 8],
      ["outline", 2],
    ]);
    expect(partsOf(0, [], 25)).toEqual([
      { part: "load", ms: 25, compiles: 0, dumps: 0, engineMs: 0 },
    ]);
  });
});

const { package: jake, sample } = curated("jake");

/**
 * What an invented import of Jake's Resume's sample comes to, as far as the measurement and the
 * report read it: its words counted as its assembly counted them, 40 of 48 editable, so partial.
 */
const IMPORTED: Imported = {
  package: jake,
  document: newDocument(jake.id, sample),
  report: {
    engine: "pdftex",
    reference: { pages: [], images: [], bibliographyLeftOut: false },
    checks: {
      outcome: "assembled",
      fields: { editable: 40, raw: 2, required: 0, locked: { text: 3, date: 2 } },
      words: { editable: 40, locked: { text: 6, date: 2 } },
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

/** A page as the fake draw makes it, one page long, with no field. */
const PAGE: DrawnPage = {
  svg: "<svg></svg>",
  size: US_LETTER,
  fields: new Map(),
  glyphs: [],
  pageCount: 1,
  unmatched: 0,
  missingFonts: new Map(),
  locked: new Map(),
};

/** The fake draw never reads fonts. */
const NO_FONTS = () =>
  new FontLibrary(
    new TexLiveIndex({ release: "", layout: 0, bundles: [], files: {} }),
    async () => new Uint8Array(),
  );

/**
 * A fake engine on a fake clock: its import says what `words` give, each moving the clock on by
 * its time, after `load` ms of silence, and comes to `outcome`; each dump, compile and draw takes
 * the time given. It notes its requests, and whether it was stopped.
 */
function fakeEngine(
  clock: { now: number },
  outcome: ImportOutcome,
  words: readonly [ImportProgress, number][],
) {
  const calls: string[] = [];
  const engine: CompilerEngine = {
    start: async () => {
      calls.push("start");
    },
    dump: async (_kind, name): Promise<DumpResult> => {
      calls.push(`dump ${name}`);
      clock.now += 200;
      return { ok: true, format: new Uint8Array([1, 2, 3]), ms: 200, log: "", fetched: FETCHED };
    },
    putFormat: async () => {
      calls.push("put");
    },
    forget: async (job) => {
      calls.push(`forget ${job}`);
    },
    compile: async (_kind, format): Promise<CompileResult> => {
      calls.push(`compile ${format}`);
      clock.now += 120;
      return {
        ok: true,
        output: new Uint8Array([1]),
        pages: 1,
        passes: [70, 50],
        log: "",
        fetched: FETCHED,
      };
    },
    pdf: async () => {
      throw new Error("no PDF is asked for");
    },
    importResume: async (files: readonly Upload[], onProgress) => {
      calls.push(`import ${files.map((file) => file.name).join(", ")}`);
      clock.now += 10;
      for (const [progress, ms] of words) {
        onProgress(progress);
        clock.now += ms;
      }
      return outcome;
    },
    cancel: () => {
      calls.push("cancel");
    },
    terminate: () => {
      calls.push("terminate");
    },
  };
  return { engine, calls };
}

/** The words of an invented import: two steps, a compile and a dump among them. */
const WORDS: [ImportProgress, number][] = [
  [said("intake", 0, false), 2],
  [said("reference", 0, false), 1],
  [said("reference", 1, true), 300],
  [said("reference", 1, false), 5],
  [said("validate", 1, false), 1],
  [said("validate", 1, true), 400],
  [said("validate", 1, false), 2],
  [said("validate", 2, true), 100],
  [said("validate", 2, false), 3],
];

/** The upload the fake engine is given. */
const FILES: Upload[] = [{ name: "invented.zip", bytes: new Uint8Array([0x50, 0x4b]) }];

describe("measureImport", () => {
  /** Measure an import on a fake engine whose start takes 50 ms, and draw in 30. */
  async function measured(outcome: ImportOutcome) {
    const clock = { now: 1000 };
    const { engine, calls } = fakeEngine(clock, outcome, WORDS);
    const result = await measureImport({
      start: async () => {
        clock.now += 50;
        return engine;
      },
      fonts: NO_FONTS,
      files: FILES,
      draw: async () => {
        clock.now += 30;
        return PAGE;
      },
      now: () => clock.now,
    });
    return { result, calls };
  }

  it("times the engine's start apart, the import by what it said, its report, and the page it opens", async () => {
    const { result, calls } = await measured(IMPORTED);
    if (isRefused(result)) throw new Error("refused");
    expect(result.startMs).toBe(50);
    expect(result.parts).toEqual([
      { part: "load", ms: 10, compiles: 0, dumps: 0, engineMs: 0 },
      { part: "intake", ms: 2, compiles: 0, dumps: 0, engineMs: 0 },
      { part: "reference", ms: 306, compiles: 1, dumps: 0, engineMs: 300 },
      { part: "validate", ms: 506, compiles: 1, dumps: 1, engineMs: 500 },
      // The report, read with no request of the engine, which the fake clock does not see.
      { part: "report", ms: 0, compiles: 0, dumps: 0, engineMs: 0 },
      // The format dumped, the body compiled, the page drawn.
      { part: "page", ms: 350, compiles: 1, dumps: 1, engineMs: 320 },
    ]);
    expect(result.ms).toBe(1174);
    // The report as the app reads it: partial, so the app would wait for a Continue, which the
    // measurement does not.
    expect(result.report).toEqual({ outcome: "partial", rate: 40 / 48 });
    expect(result.page).toEqual({
      formatMs: 200,
      dumped: true,
      passes: [70, 50],
      drawMs: 30,
      pages: 1,
    });
    expect(result).toMatchObject({
      compiles: 3,
      engine: "pdftex",
      outcome: "assembled",
      fields: { editable: 40, locked: 5 },
    });
    // The scheduler imported the files, then opened the document it came to, as the app does, and
    // the engine was stopped at the end.
    const { name } = generateFormat(jake, IMPORTED.document.controls);
    expect(calls.slice(0, 4)).toEqual([
      "import invented.zip",
      "start",
      `dump ${name}`,
      `compile ${name}`,
    ]);
    expect(calls.at(-1)).toBe("terminate");
  });

  it("opens on the format the import hands over, put in place, not dumped", async () => {
    const { name } = generateFormat(jake, IMPORTED.document.controls);
    const handed: Imported = {
      ...IMPORTED,
      formats: [{ name, format: new Uint8Array([7, 7, 7]) }],
    };
    const { result, calls } = await measured(handed);
    if (isRefused(result)) throw new Error("refused");
    expect(calls.slice(0, 4)).toEqual(["import invented.zip", "start", "put", `compile ${name}`]);
    // No dump: the page is the compile and the draw.
    expect(result.parts.at(-1)).toEqual({
      part: "page",
      ms: 150,
      compiles: 1,
      dumps: 0,
      engineMs: 120,
    });
    expect(result.page).toMatchObject({ formatMs: 0, dumped: false });
  });

  it("stops at a refusal, with the parts it got through", async () => {
    const { result, calls } = await measured(refusal("probe"));
    expect(isRefused(result)).toBe(true);
    if (!isRefused(result)) return;
    expect(result.refused.reason).toBe("probe");
    expect(result.parts.map((part) => part.part)).toEqual([
      "load",
      "intake",
      "reference",
      "validate",
    ]);
    // Nothing opened.
    expect(calls.some((call) => call.startsWith("compile"))).toBe(false);
    expect(calls.at(-1)).toBe("terminate");
  });
});

/** An invented import's time: its parts as given, its whole their sum. */
function timed(parts: [PartTime["part"], number, number][], startMs = 300): ImportTime {
  const all = parts.map(([part, ms, compiles]) => ({
    part,
    ms,
    compiles,
    dumps: 0,
    engineMs: ms / 2,
  }));
  return {
    startMs,
    parts: all,
    ms: all.reduce((sum, part) => sum + part.ms, 0),
    compiles: all.reduce((sum, part) => sum + part.compiles, 0),
    engine: "pdftex",
    outcome: "assembled",
    fields: { editable: 40, locked: 5 },
    report: { outcome: "succeeded", rate: 0.95 },
    page: { formatMs: 300, dumped: true, passes: [80, 70], drawMs: 40, pages: 1 },
  };
}

describe("importRuns", () => {
  it("imports once to warm up, uncounted, then times as many as asked", async () => {
    const heard: number[] = [];
    let made = 0;
    const done = await importRuns(
      async () => timed([["reference", 100 + made++, 1]]),
      3,
      (index) => heard.push(index),
    );
    expect(heard).toEqual([0, 1, 2, 3]);
    if (done === undefined || "refused" in done) throw new Error("no runs");
    expect(done.warm.ms).toBe(100);
    expect(done.runs.map((run) => run.ms)).toEqual([101, 102, 103]);
  });

  it("stops at a refusal, and when it is no longer wanted", async () => {
    const refused: ImportMeasured = { refused: refusal("probe"), startMs: 1, parts: [] };
    const first = await importRuns(async () => refused, 3);
    expect(first).toEqual({ refused, warm: true });
    let made = 0;
    const later = await importRuns(async () => (made++ < 2 ? timed([]) : refused), 3);
    expect(later).toEqual({ refused, warm: false });
    expect(
      await importRuns(
        async () => timed([]),
        3,
        undefined,
        () => false,
      ),
    ).toBeUndefined();
    await expect(importRuns(async () => timed([]), 0)).rejects.toThrow("whole number from 1");
  });
});

describe("the import's table", () => {
  const runs = [
    timed([
      ["load", 20, 0],
      ["reference", 400, 1],
      ["validate", 3000, 30],
      ["page", 500, 1],
    ]),
    timed([
      ["load", 30, 0],
      ["reference", 380, 1],
      ["validate", 3100, 30],
      ["page", 520, 1],
    ]),
    timed(
      [
        ["load", 10, 0],
        ["reference", 420, 1],
        ["validate", 4900, 30],
        ["page", 540, 1],
      ],
      900,
    ),
  ];

  it("takes each part's median, and the whole's, with and without the engine's start", () => {
    const medians = importMedians(runs);
    expect(medians.parts.map(({ part, ms }) => [part, ms])).toEqual([
      ["load", 20],
      ["reference", 400],
      ["validate", 3100],
      ["page", 520],
    ]);
    expect(medians).toMatchObject({
      ms: 4030,
      fastest: 3920,
      slowest: 5870,
      startMs: 300,
      withStartMs: 4330,
      loadMs: 20,
      // 4200, 4300 and 6760: each whole with its start, less its load.
      withStartWithoutLoadMs: 4300,
      compiles: 32,
    });
    expect(() => importMedians([])).toThrow("no imports");
  });

  it("lays out a row a part, the whole and the start, and judges the whole against the bar", () => {
    const text = importTable("pdftex", runs, "node");
    const lines = text.split("\n");
    expect(lines[0]).toBe(
      "Jake's Resume's upstream sample (jake-0000), imported on pdftex: the median of 3 imports",
    );
    expect(lines[1]).toMatch(/^Part +Median +Compiles +Dumps, PDFs +In the engine +What$/);
    expect(text).toMatch(/\nvalidate +3\.10 s +30 +0 +1\.55 s +Checking the imported resume\n/);
    expect(text).toMatch(
      /\nwhole +4\.03 s +32 .*From the file to the page; from 3\.92 s to 5\.87 s\n/,
    );
    expect(text).toMatch(/\nstart +300 ms +The engine's start before the import/);
    expect(text).toContain(`Each import: ${outcomeLine(runs[0] as ImportTime)}.`);
    expect(text).toContain("The page, medians: its format dumped in 300 ms");
    expect(text).not.toContain("Without load");
    // The bar is under 8 s, raised by decision 0045 from the plan's 5 s.
    expect(IMPORT_TARGET.limit).toBe(8000);
    expect(text).toContain(
      "\n\nAgainst the bar: under 8 s, raised by decision 0045 from the plan's 5 s\n",
    );
    expect(text).toMatch(
      /Import, template already cached +under 8 s +4\.03 s met, from the file to the page, without the engine's start$/,
    );
    expect(IMPORT_SAMPLES.xetex.id).toBe("awesome-cv-0000");
  });

  it("says that a partial import waits in the app for the person's Continue, and none else", () => {
    const waits = "The report is partial: in the app the person reads it after the report part";
    expect(importTable("pdftex", runs, "node")).not.toContain(waits);
    const partial = runs.map((run) => ({
      ...run,
      report: { outcome: "partial" as const, rate: 0.8333 },
    }));
    const text = importTable("pdftex", partial, "node");
    expect(text).toContain(
      `${waits} and clicks Continue before the page part; the measurement goes straight on, so the whole leaves their time out.`,
    );
    expect(text).toContain("reported partial, 83% of the words editable on the page");
    // Judged as before: the machine's time from the file to the page.
    expect(text).toMatch(/under 8 s +4\.03 s met/);
  });

  it("judges the browser's with the engine's start and without its load", () => {
    const text = importTable("pdftex", runs, "browser");
    expect(text).toContain(
      "Without load, which the dev server serves module by module where a build serves one chunk, and with the engine's start: 4.30 s.",
    );
    expect(text).toMatch(
      /Import, template already cached +under 8 s +4\.30 s met, with the engine's start, without loading the import's code$/,
    );
    // A start that takes the browser's past the bar, where Node's is judged without it.
    const started = [timed([["validate", 7600, 30]], 600)];
    expect(importMeets(started, "node", "pdftex")).toEqual({ judged: true, ms: 7600, met: true });
    expect(importMeets(started, "browser", "pdftex")).toEqual({
      judged: true,
      ms: 8200,
      met: false,
    });
  });

  it("says when the bar is missed", () => {
    const slow = [timed([["validate", 8200, 30]], 100)];
    expect(importVerdict(slow, "node", "pdftex")).toMatch(
      /8\.20 s missed, from the file to the page/,
    );
    const near = [timed([["validate", 7950, 30]], 100)];
    expect(importVerdict(near, "node", "pdftex")).toMatch(/7\.95 s met, from the file to the page/);
    expect(importVerdict(near, "browser", "pdftex")).toMatch(
      /8\.05 s missed, with the engine's start/,
    );
    // Under the bar it was raised from, as decision 0045 has it: 5 s is no longer missed.
    expect(importVerdict([timed([["validate", 5410, 30]])], "node", "pdftex")).toMatch(
      /5\.41 s met/,
    );
  });

  it("reports XeTeX's import beside the bar, judged on pdfTeX alone", () => {
    expect(IMPORT_JUDGED_ON).toBe("pdftex");
    // Over the bar on XeTeX is neither met nor missed: the plan lets XeTeX feel slower.
    const slow = [
      timed(
        [
          ["probe", 51900, 37],
          ["validate", 20800, 76],
        ],
        300,
      ),
    ];
    expect(importMeets(slow, "node", "xetex")).toEqual({
      judged: false,
      reported: true,
      ms: 72700,
    });
    expect(importMeets(slow, "browser", "xetex")).toEqual({
      judged: false,
      reported: true,
      ms: 73000,
    });
    expect(importVerdict(slow, "node", "xetex")).toMatch(
      /under 8 s +72\.70 s reported, not judged, since the bar is judged on pdfTeX; from the file to the page, without the engine's start$/,
    );
    expect(importVerdict(slow, "browser", "xetex")).toMatch(
      /73\.00 s reported, not judged, since the bar is judged on pdfTeX; with the engine's start/,
    );
    for (const where of ["node", "browser"] as const) {
      const text = importTable("xetex", slow, where);
      expect(text).toContain("Awesome-CV's upstream sample (awesome-cv-0000), imported on xetex");
      expect(text).toContain(IMPORT_BAR);
      expect(text).not.toMatch(/\b(met|missed)\b/);
    }
  });

  it("words what an import came to", () => {
    expect(outcomeLine(runs[0] as ImportTime)).toBe(
      "assembled: 40 fields editable and 5 locked; reported succeeded, 95% of the words editable on the page; the document opened on 1 page",
    );
  });
});

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("measureImport, on the engine", () => {
  it("measures an invented fork of Jake's Resume from the file to the page", async () => {
    const manifest = engineManifest();
    const result = await measureImport({
      start: () => importEngine(manifest),
      fonts: () => treeFonts(manifest),
      files: [{ name: "resume.tex", bytes: strToU8(JAKE_FORK) }],
    });
    if (isRefused(result)) throw new Error(`refused: ${result.refused.message}`);
    // Every step the pipeline takes on pdfTeX, in its order, then the report and the page.
    expect(result.parts.map((part) => part.part)).toEqual([
      "load",
      "intake",
      "reference",
      "fonts",
      "signatures",
      "parse",
      "probe",
      "outline",
      "validate",
      "report",
      "page",
    ]);
    expect(result.outcome).toBe("assembled");
    // The report's outcome is its own bar's verdict on its rate, as the app reads it.
    expect(result.report.rate).toBeGreaterThan(0);
    expect(result.report.rate).toBeLessThanOrEqual(1);
    expect(result.report.outcome).toBe(outcomeOf(result.report.rate, true));
    const add = (pick: (part: PartTime) => number) =>
      result.parts.reduce((sum, part) => sum + pick(part), 0);
    expect(add((part) => part.compiles)).toBe(result.compiles);
    expect(add((part) => part.ms)).toBeCloseTo(result.ms, 6);
    for (const part of result.parts) expect(part.engineMs).toBeLessThanOrEqual(part.ms);
    // The page: the package's format taken from the checks, not dumped again (decision 0045), one
    // compile of two passes, drawn on one page.
    const page = result.parts.at(-1);
    expect(page).toMatchObject({ part: "page", compiles: 1, dumps: 0 });
    expect(result.page.dumped).toBe(false);
    expect(result.page.passes).toHaveLength(2);
    expect(result.page.pages).toBe(1);
  }, 60_000);
});
