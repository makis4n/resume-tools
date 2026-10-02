/**
 * An import measured from the file to the page (milestone 3 item 19, decision 0045), against the
 * bar for a template already cached: under 8 s, raised by decision 0045 from plan section 4.3's
 * 5 s, and judged on pdfTeX alone; XeTeX's import is reported beside it, not judged.
 *
 * A launch template's upstream sample (`IMPORT_SAMPLES`), whose every macro the committed answers
 * name, goes to the editor's compile scheduler as the document list gives it a person's file
 * (`Compiler.importResume`), its report is read as the app reads it (`reportOfImport`), and the
 * document it comes to opens as the app opens it, to its first drawn page. A partial import, which
 * the app holds in the list for the person's Continue (decision 0039), goes straight on to its page
 * here. The same measurement runs in two places, as the editor's does (`measure.ts`):
 * `scripts/measure.ts --import` in Node, on a session of the engine in its own thread
 * (`node.ts`), and the app's `?measure=import` page (`ImportMeasurePage.tsx`), on the worker. Each
 * import gets an engine started afresh, as a newly opened editor's worker is, and fonts of its own,
 * as a new page's are, so that each pays what a person's first import in a tab pays, but for the
 * network: one import first, untimed, warms the HTTP cache (`importRuns`).
 *
 * The parts are read from what the import says as it goes, each step as it begins and each compile,
 * dump and PDF as it begins and ends (`ImportProgress`), and from the scheduler's requests and draw
 * for the page, so that they are the pipeline's own steps, whatever it gains later, and nothing here
 * repeats one. This module reaches for neither Node nor the browser, and takes nothing of the
 * pipeline but its types, its steps' names, its test for a refusal and its report, which imports
 * nothing but types, as the app does, so that the page's bundle stays without it: the pipeline runs
 * in the worker, or in Node (`node.ts`).
 */

import { Compiler, type Engine as CompilerEngine, type Shown } from "../editor/compiler";
import type { Document } from "../editor/document";
import type { CompileResult, Engine } from "../engine/session";
import type { AssemblyChecks } from "../import/assemble";
import type { Upload } from "../import/intake";
import { isRefusal, type Refusal } from "../import/refusal";
import { percent, type ReportOutcome, reportOfImport } from "../import/report";
import {
  IMPORT_STEPS,
  type ImportProgress,
  type ImportStep,
  type NamingOutcome,
} from "../import/run";
import { drawPage } from "../page/draw";
import type { FontLibrary } from "../page/fonts";
import { formatMs, median, meets, TARGETS, table } from "./measure";

/**
 * The upstream samples the import is measured on, one for each engine, by their ids in
 * `corpus/oracle.json`: Jake's Resume on pdfTeX, which the bar is judged on, and Awesome-CV on
 * XeTeX, reported beside it, as the milestone has it.
 */
export const IMPORT_SAMPLES: Readonly<Record<Engine, { id: string; name: string }>> = {
  pdftex: { id: "jake-0000", name: "Jake's Resume" },
  xetex: { id: "awesome-cv-0000", name: "Awesome-CV" },
};

/** Imports timed after the one that warms up, unless the caller says otherwise. */
export const IMPORT_RUNS = 5;

/**
 * A part of an import: loading what it runs with, at the worker's first import (`load`); each of
 * the pipeline's steps; its report read, which says whether it waits for the person (`report`); and
 * the document opened to its first drawn page (`page`).
 */
export type ImportPart = "load" | ImportStep | "report" | "page";

/** What each part is, in the words of the import's progress line where it has one. */
export const PART_LABELS: Readonly<Record<ImportPart, string>> = {
  load: "Loading the import's code and the tree's fonts, at the worker's first import",
  ...IMPORT_STEPS,
  report: "Reading the import's report: its words' editable share, and whether it is partial",
  page: "Opening the document: its report read again for its locked parts' names, its format put in place, its body compiled, its page drawn",
};

/** A part's time, what it asked of the engine, and how much of the time the engine took. */
export interface PartTime {
  part: ImportPart;
  ms: number;
  compiles: number;
  /** The engine's other requests: TeX's format dumps and xdvipdfmx's PDFs. */
  dumps: number;
  /** Of `ms`, the engine's: the compiles, dumps and PDFs, each from its start to its end. */
  engineMs: number;
}

/** One import, from the file to the page. */
export interface ImportTime {
  /** How long the engine took to start before the import, which a worker already running skips. */
  startMs: number;
  /** In order, each part once. */
  parts: PartTime[];
  /** From the files given to the page drawn: the parts added up, the start not among them. */
  ms: number;
  /** The import's compiles and the page's. */
  compiles: number;
  engine: Engine;
  naming: NamingOutcome;
  outcome: AssemblyChecks["outcome"];
  /** The import's fields: editable, whatever their kind, and locked, whatever the reason. */
  fields: { editable: number; locked: number };
  /**
   * Its report, as the app reads it (decision 0039): its body's words' editable share, and whether
   * it succeeded, or is partial, which the app holds in the list for the person's Continue.
   */
  report: { outcome: ReportOutcome; rate: number };
  /**
   * The page: its format put in place, dumped or taken from the import (decision 0045), and which;
   * the compile's passes and the draw; and the pages it set.
   */
  page: { formatMs: number; dumped: boolean; passes: number[]; drawMs: number; pages: number };
}

/** An import the pipeline refused: why, as a person reads it, and the parts it got through. */
export interface ImportRefused {
  refused: Refusal;
  startMs: number;
  parts: PartTime[];
}

export type ImportMeasured = ImportTime | ImportRefused;

export const isRefused = (measured: ImportMeasured): measured is ImportRefused =>
  "refused" in measured;

/** A word the import said as it went, and when the measurement heard it. */
export interface Heard {
  at: number;
  progress: ImportProgress;
}

/**
 * The parts of an import, from when it was asked for (`began`) to its outcome (`ended`), read from
 * what it said as it went: the wait for its first word, while the worker loads the import's code and
 * the tree's fonts at its first import (`load`); then each step, from the word that began it to the
 * next step's, with the compiles and the dumps or PDFs it began, and the time the engine took, from
 * each one's first word to its last. A request of the engine that adds to the count of compiles is a
 * compile; one that does not is a dump or a PDF. A step named again later adds to its first. The
 * parts add up to the whole, `ended` less `began`.
 */
export function partsOf(began: number, heard: readonly Heard[], ended: number): PartTime[] {
  const parts = new Map<ImportPart, PartTime>();
  const add = (time: PartTime) => {
    const before = parts.get(time.part);
    parts.set(time.part, {
      part: time.part,
      ms: (before?.ms ?? 0) + time.ms,
      compiles: (before?.compiles ?? 0) + time.compiles,
      dumps: (before?.dumps ?? 0) + time.dumps,
      engineMs: (before?.engineMs ?? 0) + time.engineMs,
    });
  };
  const load = (heard[0]?.at ?? ended) - began;
  add({ part: "load", ms: load, compiles: 0, dumps: 0, engineMs: 0 });
  // `compiles` counts every compile so far, one under way among them, so a step's are what it adds.
  let counted = 0;
  heard.forEach(({ at, progress }, i) => {
    const ms = (heard[i + 1]?.at ?? ended) - at;
    const compiles = Math.max(0, progress.compiles - counted);
    counted = Math.max(counted, progress.compiles);
    const asked = progress.compiling;
    add({
      part: progress.step,
      ms,
      compiles,
      dumps: asked && compiles === 0 ? 1 : 0,
      engineMs: asked ? ms : 0,
    });
  });
  return [...parts.values()];
}

/** How an import is measured: where its engine and fonts come from, and what it imports. */
export interface ImportHow {
  /**
   * An engine started afresh, as a new worker is, and ready: the worker's client in the browser, a
   * session of the engine in Node. How long it takes is the import's `startMs`.
   */
  start(): Promise<CompilerEngine>;
  /** The fonts the page is drawn with, a library of their own, as a new page's are. */
  fonts(): FontLibrary;
  /** The files, as a person gives them to the document list. */
  files: readonly Upload[];
  /** How the page is drawn; the editor's way by default. */
  draw?: typeof drawPage;
  /** The clock, in milliseconds; `performance.now` by default. */
  now?: () => number;
}

/** A request the scheduler made of the engine for the page, as the measurement notes it. */
interface Noted {
  kind: "dump" | "putFormat" | "compile" | "pdf";
  ms: number;
  passes?: number[];
}

/**
 * The engine as the scheduler gets it: every request passed on, and each dump, format, compile and
 * PDF noted with how long it took, from the call to its answer, a compile with its passes. The
 * import itself is passed on as it is: its own progress times it.
 */
function noted(engine: CompilerEngine, now: () => number, note: (noted: Noted) => void) {
  const timed =
    <A extends unknown[], R>(kind: Noted["kind"], call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const started = now();
      const result = await call(...args);
      const passes = kind === "compile" ? (result as CompileResult).passes : undefined;
      note({ kind, ms: now() - started, ...(passes === undefined ? {} : { passes }) });
      return result;
    };
  const { importResume, cancel, dropFormat } = engine;
  const passed: CompilerEngine = {
    start: () => engine.start(),
    dump: timed("dump", (...args: Parameters<CompilerEngine["dump"]>) => engine.dump(...args)),
    putFormat: timed("putFormat", (...args: Parameters<CompilerEngine["putFormat"]>) =>
      engine.putFormat(...args),
    ),
    forget: (job) => engine.forget(job),
    compile: timed("compile", (...args: Parameters<CompilerEngine["compile"]>) =>
      engine.compile(...args),
    ),
    pdf: timed("pdf", (...args: Parameters<CompilerEngine["pdf"]>) => engine.pdf(...args)),
    terminate: () => engine.terminate(),
  };
  if (importResume !== undefined)
    passed.importResume = (files, onProgress) => importResume.call(engine, files, onProgress);
  if (cancel !== undefined) passed.cancel = () => cancel.call(engine);
  if (dropFormat !== undefined)
    passed.dropFormat = (kind, name) => dropFormat.call(engine, kind, name);
  return passed;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/**
 * Import the files on an engine started afresh, through the editor's compile scheduler, as the
 * document list does, read the import's report, and open the document they come to, as the app
 * opens it, to its first drawn page, whether the report is partial or not; or stop at the import's
 * refusal. The engine's start is timed apart, before the import is asked for; the import by its own
 * progress (`partsOf`); the report from the import's outcome; and the page from there to the page
 * drawn, with the scheduler's requests and draw for it. Nothing is kept: the scheduler, and the
 * engine with it, are closed at the end. Throws when the page cannot be made, with the scheduler's
 * message, and when the engine fails.
 */
export async function measureImport(how: ImportHow): Promise<ImportMeasured> {
  const now = how.now ?? (() => performance.now());
  const starting = now();
  const engine = await how.start();
  const startMs = now() - starting;
  const requests: Noted[] = [];
  const draws: number[] = [];
  const draw = how.draw ?? drawPage;
  const timedDraw: typeof drawPage = async (...args) => {
    const started = now();
    try {
      return await draw(...args);
    } finally {
      draws.push(now() - started);
    }
  };
  let waiting:
    | { doc: Document; resolve: (shown: Shown) => void; reject: (error: Error) => void }
    | undefined;
  const compiler = new Compiler(
    () => noted(engine, now, (each) => requests.push(each)),
    how.fonts(),
    {
      page: (shown) => {
        if (waiting?.doc !== shown.document) return;
        waiting.resolve(shown);
        waiting = undefined;
      },
      error: (message) => {
        waiting?.reject(new Error(`The imported document's page could not be made: ${message}`));
        waiting = undefined;
      },
      busy: () => {},
    },
    { draw: timedDraw },
  );
  try {
    const heard: Heard[] = [];
    const began = now();
    const outcome = await compiler.importResume(how.files, (progress) =>
      heard.push({ at: now(), progress }),
    ).done;
    const imported = now();
    const parts = partsOf(began, heard, imported);
    if (isRefusal(outcome)) return { refused: outcome, startMs, parts };

    // Its report, as the app reads it between the import's outcome and the page (decision 0039):
    // whether it succeeded, or is partial, which the app holds in the list for the person's
    // Continue before it keeps and opens the document. The measurement goes straight on: what the
    // person takes to read the report and continue is theirs, not the machine's.
    const report = reportOfImport(outcome);
    const reported = now();
    parts.push({ part: "report", ms: reported - imported, compiles: 0, dumps: 0, engineMs: 0 });

    const [requested, drawn] = [requests.length, draws.length];
    const document = outcome.document;
    const shown = new Promise<Shown>((resolve, reject) => {
      waiting = { doc: document, resolve, reject };
    });
    // The app reads the report again as it opens an imported document, for the names its side panel
    // gives the locked parts (`lockedWordsFrom`, decision 0041), and then opens it.
    reportOfImport(outcome);
    compiler.open(outcome.package, document, outcome.job);
    const { page } = await shown;
    const ended = now();
    const made = requests.slice(requested);
    const compiles = made.filter((each) => each.kind === "compile");
    const others = made.filter((each) => each.kind === "dump" || each.kind === "pdf");
    // The format the page compiles from: dumped, or handed over by the import (decision 0045).
    const formats = made.filter((each) => each.kind === "dump" || each.kind === "putFormat");
    parts.push({
      part: "page",
      ms: ended - reported,
      compiles: compiles.length,
      dumps: others.length,
      engineMs: sum([...compiles, ...others].map((each) => each.ms)),
    });
    const { checks, naming } = outcome.report;
    return {
      startMs,
      parts,
      ms: ended - began,
      compiles: outcome.report.compiles + compiles.length,
      engine: outcome.package.engine,
      naming,
      outcome: checks.outcome,
      fields: {
        editable: checks.fields.editable,
        locked: sum(Object.values(checks.fields.locked)),
      },
      report: { outcome: report.outcome, rate: report.rate },
      page: {
        formatMs: sum(formats.map((each) => each.ms)),
        dumped: formats.some((each) => each.kind === "dump"),
        passes: compiles.flatMap((each) => each.passes ?? []),
        drawMs: sum(draws.slice(drawn)),
        pages: page.pageCount,
      },
    };
  } finally {
    compiler.close();
    // An engine the scheduler never took is stopped too; stopping one twice does nothing.
    engine.terminate();
  }
}

/** What `importRuns` came to: the timed imports, or the refusal that stopped them. */
export type ImportRuns =
  | { warm: ImportTime; runs: ImportTime[] }
  | { refused: ImportRefused; warm: boolean };

/**
 * Measure an import `runs` times, after one more that is not counted: the first import fetches what
 * the HTTP cache does not hold yet, which the plan's bar leaves out, and lets the runtime settle.
 * `before` hears each import as it starts, the first `0`, the warm-up; `live` stops the runs between
 * two imports when it turns false, and the result is undefined then. A refusal stops them too, and
 * is what they come to.
 */
export async function importRuns(
  once: () => Promise<ImportMeasured>,
  runs: number,
  before: (index: number) => void = () => {},
  live: () => boolean = () => true,
): Promise<ImportRuns | undefined> {
  if (!Number.isInteger(runs) || runs < 1) throw new Error("runs must be a whole number from 1");
  before(0);
  const warm = await once();
  if (isRefused(warm)) return { refused: warm, warm: true };
  const timed: ImportTime[] = [];
  for (let i = 1; i <= runs; i++) {
    if (!live()) return undefined;
    before(i);
    const measured = await once();
    if (isRefused(measured)) return { refused: measured, warm: false };
    timed.push(measured);
  }
  return { warm, runs: timed };
}

/** The medians of some imports: each part's, in the first import's order, and the whole's. */
export interface ImportMedians {
  parts: PartTime[];
  ms: number;
  slowest: number;
  fastest: number;
  startMs: number;
  /** Each import's whole with its engine's start, the median of those. */
  withStartMs: number;
  /** The median of the import's `load`, the wait for the worker to load the import's code. */
  loadMs: number;
  /**
   * Each import's whole with its engine's start and without its `load`, the median of those: what
   * the browser's import is judged on (`importVerdict`).
   */
  withStartWithoutLoadMs: number;
  compiles: number;
  dumps: number;
  engineMs: number;
}

/** The medians of `runs`, which are at least one. */
export function importMedians(runs: readonly ImportTime[]): ImportMedians {
  const [first] = runs;
  if (first === undefined) throw new Error("there are no imports to take the medians of");
  const partOf = (run: ImportTime, part: ImportPart, pick: (time: PartTime) => number) => {
    const time = run.parts.find((each) => each.part === part);
    return time === undefined ? 0 : pick(time);
  };
  const of = (part: ImportPart, pick: (time: PartTime) => number) =>
    median(runs.map((run) => partOf(run, part, pick)));
  const wholes = runs.map((run) => run.ms);
  const total = (run: ImportTime, pick: (time: PartTime) => number) => sum(run.parts.map(pick));
  const load = (run: ImportTime) => partOf(run, "load", (time) => time.ms);
  return {
    parts: first.parts.map(({ part }) => ({
      part,
      ms: of(part, (time) => time.ms),
      compiles: of(part, (time) => time.compiles),
      dumps: of(part, (time) => time.dumps),
      engineMs: of(part, (time) => time.engineMs),
    })),
    ms: median(wholes),
    slowest: Math.max(...wholes),
    fastest: Math.min(...wholes),
    startMs: median(runs.map((run) => run.startMs)),
    withStartMs: median(runs.map((run) => run.ms + run.startMs)),
    loadMs: median(runs.map(load)),
    withStartWithoutLoadMs: median(runs.map((run) => run.ms + run.startMs - load(run))),
    compiles: median(runs.map((run) => run.compiles)),
    dumps: median(runs.map((run) => total(run, (time) => time.dumps))),
    engineMs: median(runs.map((run) => total(run, (time) => time.engineMs))),
  };
}

/** A duration as the import's table gives it: seconds from one, milliseconds below. */
export function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : formatMs(ms);
}

/** What the naming step came to, in a few words. */
function namingLine(naming: NamingOutcome): string {
  if ("failed" in naming) return `the naming service failed (${naming.failed})`;
  const { hits, asked, missing } = naming;
  return `${hits} of the template's macros named from the cache, ${asked} asked of a model, ${missing} left unnamed`;
}

/** What an import came to, which every timed import should share, in a sentence. */
export function outcomeLine(time: ImportTime): string {
  const pages = `${time.page.pages} ${time.page.pages === 1 ? "page" : "pages"}`;
  const { outcome, rate } = time.report;
  return [
    `${time.outcome}: ${time.fields.editable} fields editable and ${time.fields.locked} locked`,
    `reported ${outcome}, ${percent(rate)} of the words editable on the page`,
    namingLine(time.naming),
    `the document opened on ${pages}`,
  ].join("; ");
}

/**
 * Why some imports were not a template already cached, the bar's case, or undefined when every one
 * was: the naming service failed, asked a model, or left a macro unnamed in one of them.
 */
export function notCached(runs: readonly ImportTime[]): string | undefined {
  for (const { naming } of runs) {
    if ("failed" in naming) return `the naming service failed: ${naming.failed}`;
    if (naming.asked > 0) return `${naming.asked} of the template's macros were asked of a model`;
    if (naming.missing > 0) return `${naming.missing} of the template's macros were left unnamed`;
  }
  return undefined;
}

/**
 * The bar for an import of a template already cached: under 8 s, which the owner raised on
 * 2 October 2026 from plan section 4.3's 5 s (decision 0045).
 */
export const IMPORT_TARGET = TARGETS.importCached;

/**
 * The engine the bar is judged on, as milestone 3's decisions have it; an import on the other is
 * reported beside the bar, not judged, as the plan lets XeTeX feel slower.
 */
export const IMPORT_JUDGED_ON: Engine = "pdftex";

/** The line the import's verdict comes under, which says what the bar is and where it came from. */
export const IMPORT_BAR = `Against the bar: under ${IMPORT_TARGET.limit / 1000} s, raised by decision 0045 from the plan's 5 s`;

/**
 * Where an import was measured, which says what the bar is judged on: in Node, the import from the
 * file to the page, without the engine's start, which compiles the engine afresh where Chrome keeps
 * it compiled; in the browser, with the engine's start, which a person whose list shows no document
 * waits for, since the app starts no engine then, and without `load`, which the dev server makes
 * slow by serving the pipeline's modules one by one where a build serves one chunk (decision 0045).
 */
export type Where = "node" | "browser";

/**
 * What the bar is judged on, and whether it is met; or why it is not judged: not a cache hit, or
 * an engine the bar is not judged on (`IMPORT_JUDGED_ON`), whose time is then reported.
 */
export type ImportJudged =
  | { judged: false; why: string }
  | { judged: false; reported: true; ms: number }
  | { judged: true; ms: number; met: boolean };

/** Some imports on an engine against the bar, for where they were measured (`Where`). */
export function importMeets(
  runs: readonly ImportTime[],
  where: Where,
  engine: Engine,
): ImportJudged {
  const why = notCached(runs);
  if (why !== undefined) return { judged: false, why };
  const medians = importMedians(runs);
  const ms = where === "node" ? medians.ms : medians.withStartWithoutLoadMs;
  if (engine !== IMPORT_JUDGED_ON) return { judged: false, reported: true, ms };
  return { judged: true, ms, met: meets(IMPORT_TARGET, ms) };
}

/**
 * The import's verdict against its bar (`IMPORT_TARGET`), for the engine it ran on and where it
 * was measured (`Where`): met or missed on pdfTeX, reported and not judged on XeTeX.
 */
export function importVerdict(runs: readonly ImportTime[], where: Where, engine: Engine): string {
  const verdict = importMeets(runs, where, engine);
  const on =
    where === "node"
      ? "from the file to the page, without the engine's start"
      : "with the engine's start, without loading the import's code";
  const said = verdict.judged
    ? `${formatTime(verdict.ms)} ${verdict.met ? "met" : "missed"}, ${on}`
    : "reported" in verdict
      ? `${formatTime(verdict.ms)} reported, not judged, since the bar is judged on pdfTeX; ${on}`
      : `not a cache hit, so not judged: ${verdict.why}`;
  return table([[IMPORT_TARGET.path, `under ${IMPORT_TARGET.limit / 1000} s`, said]]);
}

/**
 * The table of an import's parts, each a median of `runs`, then the whole, the engine's start apart,
 * what each import came to, whether its report holds it for the person's Continue in the app, and
 * the verdict, as the Node command prints it and the browser's page shows it.
 */
export function importTable(engine: Engine, runs: readonly ImportTime[], where: Where): string {
  const sample = IMPORT_SAMPLES[engine];
  const medians = importMedians(runs);
  const [first] = runs;
  const shared = first === undefined ? "" : outcomeLine(first);
  const differ = runs.some((run) => outcomeLine(run) !== shared);
  const passes = first?.page.passes.length ?? 0;
  const formatHow = runs.every((run) => !run.page.dumped)
    ? "taken from the import's checks"
    : runs.every((run) => run.page.dumped)
      ? "dumped"
      : "dumped or taken from the import's checks";
  const page = [
    `The page, medians: its format ${formatHow} in ${formatTime(median(runs.map((run) => run.page.formatMs)))}`,
    `its body compiled in ${formatTime(median(runs.map((run) => sum(run.page.passes))))} over ${passes} ${passes === 1 ? "pass" : "passes"}`,
    `its page drawn in ${formatTime(median(runs.map((run) => run.page.drawMs)))}.`,
  ].join(", ");
  const loaded =
    where === "browser"
      ? [
          `Without load, which the dev server serves module by module where a build serves one chunk, and with the engine's start: ${formatTime(medians.withStartWithoutLoadMs)}.`,
        ]
      : [];
  // A partial import waits in the app's list for the person's Continue (decision 0039).
  const waits = runs.some((run) => run.report.outcome === "partial")
    ? [
        "The report is partial: in the app the person reads it after the report part and clicks Continue before the page part; the measurement goes straight on, so the whole leaves their time out.",
      ]
    : [];
  return [
    `${sample.name}'s upstream sample (${sample.id}), imported on ${engine}: the median of ${runs.length} imports`,
    table([
      ["Part", "Median", "Compiles", "Dumps, PDFs", "In the engine", "What"],
      ...medians.parts.map(({ part, ms, compiles, dumps, engineMs }) => [
        part,
        formatTime(ms),
        String(compiles),
        String(dumps),
        formatTime(engineMs),
        PART_LABELS[part],
      ]),
      [
        "whole",
        formatTime(medians.ms),
        String(medians.compiles),
        String(medians.dumps),
        formatTime(medians.engineMs),
        `From the file to the page; from ${formatTime(medians.fastest)} to ${formatTime(medians.slowest)}`,
      ],
      [
        "start",
        formatTime(medians.startMs),
        "",
        "",
        "",
        "The engine's start before the import, as a new worker's; not in the whole",
      ],
    ]),
    "",
    `Each import: ${shared}${differ ? ", and not every import alike" : ""}.`,
    ...waits,
    page,
    ...loaded,
    "",
    IMPORT_BAR,
    importVerdict(runs, where, engine),
  ].join("\n");
}
