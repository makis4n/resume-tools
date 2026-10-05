/**
 * Measure the editor against the targets of plan section 4.3 (milestone 2 item 23, decision
 * 0016), in Node, for every curated package with its invented sample; or, with `--import`, an
 * import from the file to the page (milestone 3 item 19, decision 0045):
 *
 *   pnpm --filter @resume-tools/editor measure [--runs <n>] [--json <file>]
 *   pnpm --filter @resume-tools/editor measure --import [--engine <engine> | --pdf] [--runs <n>]
 *     [--json <file>]
 *   pnpm --filter @resume-tools/editor measure --typing-imports --ids <file> [--runs <n>]
 *     [--json <file>]
 *
 *   --runs <n>         edits to time per package, 10 by default; the overlay's row layout is timed
 *                      ten times as often. With --import, imports to time per sample, 5 by default
 *   --json <file>      write the numbers as JSON too, for the decision record
 *   --import           measure the import instead: a launch template's upstream sample, cached
 *   --engine <engine>  with --import, the one sample of pdftex or xetex, not both
 *   --pdf              with --import, the PDF import by rules alone, not the .tex samples
 *   --typing-imports   measure typing on imported corpus resumes instead, those --ids names; with
 *                      it, --runs is the edits timed per resume, 5 by default
 *   --ids <file>       with --typing-imports, the corpus resumes a file names, one id a line, from
 *                      where pnpm was run, as `corpus run --ids` takes them
 *
 * Each package gets an engine session and fonts of its own, as a first load does, and the editor's
 * compile scheduler drives them, as the app drives its worker: it opens the sample as a new
 * document, the overlay lays out the longest field's rows as on a keystroke, and that field is
 * edited through the document's history, each edit compiled and drawn (`src/measure/measure.ts`).
 * It prints a table per package and a summary against the targets. Sizes are bytes on disk: the
 * engine's `.wasm` and `.mjs`, the manifest, and the TeX Live files the engine and the fonts read;
 * what they compress to on the way is the CDN's to say (milestone 5). It needs `.engine/`, which
 * `fetch-engine` builds.
 *
 * With `--import`, the upstream samples of Jake's Resume on pdfTeX and of Awesome-CV on XeTeX,
 * which `corpus oracle` fetches into `.corpus/oracle/`, are each imported through the editor's
 * compile scheduler as an outline, which names nothing and sends nothing (decision 0049), their
 * report read as the app reads it, and opened to their first drawn page, a partial one without
 * waiting for a Continue (`src/measure/import.ts`, `src/measure/node.ts`). Each import is on an
 * engine started afresh, as a newly opened editor's worker is; one is imported first and not
 * counted, then `--runs` are timed. It prints, for each sample, its parts' medians, from the file to
 * the page, and the verdict against the bar, under 8 s, raised by decision 0045 from plan section
 * 4.3's 5 s, judged on pdfTeX; XeTeX's import is reported beside it, not judged.
 *
 * Beside them, unless `--engine` picks one sample, a PDF import by rules (the second pass's item
 * 18, `src/measure/pdf-import.ts`): the editor's own PDFs of the three built-in templates, each
 * typesetting its own invented sample, made first on the engine, and the invented resumes other
 * tools printed (`scripts/spike-pdf/fixtures/other/`), never a corpus resume, each read, laid out,
 * labelled by rules with a no on record, filed and made the review's draft, then the draft set on
 * its template to its first drawn page, on one engine shared by every page. One pass over them is
 * not counted, then `--runs` are timed. It prints each part's median and slowest, the whole's, the
 * page's beside it, a row a PDF, and the verdict against the target, under 1 s, judged on the
 * slowest import. No model is asked: the model's time is `pdf-model`'s, run by hand with the key.
 *
 * With `--typing-imports` (the perf run's lane D2), each corpus resume the file of ids names, which
 * the last `corpus fetch` fetched, is zipped as `corpus run` zips it (`uploadOf`) and imported
 * through the editor's compile scheduler as `--import` imports a sample, on an engine started
 * afresh, then opened, and its longest editable field edited `--runs` times on the same scheduler
 * and engine, as the app keeps them (`src/measure/import-typing.ts`): each edit timed from its
 * command to its drawn page, with the scheduler's pause, and split into the pause, the compile and
 * the draw. One at a time, so that nothing else runs while one is timed. It prints a row a resume
 * and a table by family, the share whose median edit is within plan section 4.3's 300 ms by the
 * page's own time, and the median, p90 and slowest; and counts the resumes it skipped: refused,
 * with no editable field, or failed. Ids, families, counts and milliseconds only: nothing a resume
 * says reaches the terminal or the JSON, not even what the editor logs while it works on one.
 *
 * The editor's modules are written for Vite, with extensionless imports, JSX, and JSON and `?raw`
 * imports, which Node cannot load. So this file, which Node runs as it is, loads them through
 * Vite's module runner with the app's own Vite config, the way Vitest loads the tests, and imports
 * nothing of the editor itself but types.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus, loadavg, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import type { Engine, Fetched } from "../src/engine/session.ts";
import type { ImportRuns, ImportTime } from "../src/measure/import.ts";
import type { TypingRow, TypingSkipped } from "../src/measure/import-typing.ts";
import type { FirstLoad, PackageNumbers, StepReads } from "../src/measure/measure.ts";
import type { PdfSample, PdfTime } from "../src/measure/pdf-import.ts";
import {
  CORPUS_DIR,
  FETCH_REPORT_FILE,
  FetchReport,
  isLive,
  type LiveDocument,
  MANIFEST_FILE,
  Manifest,
  matchingEntries,
  parseJson,
  printable,
} from "./corpus-manifest.ts";
import { treeFonts as treeFontFiles, uploadOf } from "./corpus-reference.ts";
import { idsOf } from "./corpus-run.ts";
import { sampleUpload } from "./serve-samples.ts";
import { OTHER_DIR } from "./spike-pdf/print.ts";

type Measure = typeof import("../src/measure/measure.ts");
type Imports = typeof import("../src/measure/import.ts");
type Typing = typeof import("../src/measure/import-typing.ts");
type PdfImports = typeof import("../src/measure/pdf-import.ts");
type PdfNode = typeof import("../src/pdf/node.ts");
type NodeImports = typeof import("../src/measure/node.ts");
type NodeEngine = typeof import("../src/engine/node.ts");
type Curated = typeof import("../src/templates/curated.ts");
type TexLive = typeof import("../src/page/texlive.ts");
type Runner = ReturnType<typeof createRunnableDevEnvironment>["runner"];

const APP = fileURLToPath(new URL("..", import.meta.url));

const USAGE = [
  "pnpm --filter @resume-tools/editor measure [--runs <n>] [--json <file>]",
  "pnpm --filter @resume-tools/editor measure --import [--engine <pdftex|xetex> | --pdf] [--runs <n>] [--json <file>]",
  "pnpm --filter @resume-tools/editor measure --typing-imports --ids <file> [--runs <n>] [--json <file>]",
].join("\n");

/** Edits timed per package when `--runs` does not say. */
const RUNS = 10;

/**
 * Imports timed per sample when `--runs` does not say, as `src/measure/import.ts`'s `IMPORT_RUNS`
 * has it: the options are read before Vite's runner can load that module.
 */
const IMPORT_RUNS = 5;

/**
 * Edits timed per imported resume when `--runs` does not say, as `src/measure/import-typing.ts`'s
 * `TYPING_EDITS` has it.
 */
const TYPING_EDITS = 5;

const ENGINES: readonly Engine[] = ["pdftex", "xetex"];

interface Options {
  runs: number;
  json: string | undefined;
  /** Whether to measure the import, on which engines' samples, and whether a PDF's by rules. */
  import: boolean;
  engines: readonly Engine[];
  pdf: boolean;
  /** With `--typing-imports`, the file of corpus ids to import and type on. */
  typing: string | undefined;
  help: boolean;
}

/**
 * The command's options: what to measure, how many edits or imports to time, and where to write
 * the JSON, if anywhere.
 */
function optionsOf(args: string[]): Options {
  const { values } = parseArgs({
    args,
    options: {
      runs: { type: "string" },
      json: { type: "string" },
      import: { type: "boolean" },
      engine: { type: "string" },
      pdf: { type: "boolean" },
      "typing-imports": { type: "boolean" },
      ids: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const imports = values.import ?? false;
  const typingImports = values["typing-imports"] ?? false;
  if (typingImports && (imports || values.engine !== undefined || values.pdf))
    throw new Error(
      "--typing-imports measures typing on imported resumes: give no --import with it",
    );
  if (typingImports && values.ids === undefined)
    throw new Error("--typing-imports takes the resumes to import in a file: give --ids <file>");
  if (values.ids !== undefined && !typingImports)
    throw new Error("--ids names the resumes typing is measured on: give --typing-imports with it");
  const runs =
    values.runs === undefined
      ? typingImports
        ? TYPING_EDITS
        : imports
          ? IMPORT_RUNS
          : RUNS
      : Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error(`--runs takes a whole number from 1, not ${values.runs}`);
  if (values.engine !== undefined && !imports)
    throw new Error("--engine picks the sample an import is measured on: give --import with it");
  if (values.pdf && !imports)
    throw new Error("--pdf picks the PDF import by rules alone: give --import with it");
  if (values.pdf && values.engine !== undefined)
    throw new Error("--pdf measures the PDF import alone, which --engine does not pick: give one");
  const engines = values.pdf
    ? []
    : values.engine === undefined
      ? ENGINES
      : ENGINES.filter((e) => e === values.engine);
  if (!values.pdf && engines.length === 0)
    throw new Error(`--engine takes ${ENGINES.join(" or ")}, not ${values.engine}`);
  // The PDF import goes beside both samples, or alone with --pdf; --engine picks one sample alone.
  const pdf = imports && values.engine === undefined;
  // pnpm runs the script in the editor's folder; a path is the caller's, from where pnpm was run.
  const callers = (path: string) => resolve(process.env.INIT_CWD ?? ".", path);
  const json = values.json === undefined ? undefined : callers(values.json);
  const typing = values.ids === undefined ? undefined : callers(values.ids);
  return { runs, json, import: imports, engines, pdf, typing, help: values.help ?? false };
}

/** The machine the numbers were taken on, which they mean nothing without. */
function machine() {
  const [cpu] = cpus();
  return {
    cpu: cpu?.model ?? "an unknown processor",
    cores: cpus().length,
    memoryGiB: Math.round(totalmem() / 2 ** 30),
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
    /** The one-minute load average as the run starts, which says how busy the machine was. */
    load: loadavg()[0] ?? 0,
  };
}

/** A read as the JSON keeps it: how many files and bytes, without the paths. */
const count = ({ files, bytes }: Fetched) => ({ files, bytes });

/** What a step read, as the JSON keeps it. */
const countStep = ({ tex, fonts }: StepReads) => ({
  tex: count(tex),
  fonts: { files: fonts.size, bytes: [...fonts.values()].reduce((sum, bytes) => sum + bytes, 0) },
});

/** The numbers as the JSON keeps them, milliseconds to a microsecond. */
function json(
  measure: Measure,
  about: ReturnType<typeof machine>,
  runs: number,
  measured: { numbers: PackageNumbers; load: FirstLoad }[],
  verdicts: ReturnType<Measure["verdicts"]>,
): string {
  const report = {
    date: new Date().toISOString(),
    machine: about,
    runs,
    packages: measured.map(({ numbers, load }) => ({
      ...numbers,
      dump: { ...numbers.dump, read: count(numbers.dump.read) },
      open: { ...numbers.open, read: count(numbers.open.read) },
      reads: {
        open: countStep(numbers.reads.open),
        overlay: countStep(numbers.reads.overlay),
        edits: countStep(numbers.reads.edits),
        fit: countStep(numbers.reads.fit),
      },
      firstLoad: load,
      openingTheField: measure.overlayFonts(numbers),
    })),
    summary: verdicts.map(({ target, values }) => ({ ...target, values })),
  };
  return written(report);
}

/** A report as the JSON keeps it, milliseconds to a microsecond. */
function written(report: unknown): string {
  const rounded = (_: string, value: unknown) =>
    typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 1000) / 1000 : value;
  return `${JSON.stringify(report, rounded, 2)}\n`;
}

/** What `--import` measured of a sample, and the machine's load as it started and ended. */
interface SampleMeasured {
  engine: Engine;
  load: { start: number; end: number };
  warm: ImportTime;
  runs: ImportTime[];
}

/** What `--import` measured of the PDF import by rules, and the machine's load as it started and ended. */
interface PdfMeasured {
  load: { start: number; end: number };
  /** How long the engine the pages share took to start, once, before the PDFs were made. */
  startMs: number;
  warm: PdfTime[];
  runs: PdfTime[];
}

/**
 * The import's numbers as the JSON keeps them: each sample's imports, and their medians; and the
 * PDF import's, with no text of any PDF, only its id.
 */
function importJson(
  imports: Imports,
  pdfImports: PdfImports,
  about: ReturnType<typeof machine>,
  runs: number,
  measured: readonly SampleMeasured[],
  pdf: PdfMeasured | undefined,
): string {
  return written({
    date: new Date().toISOString(),
    machine: about,
    runs,
    ...(pdf === undefined
      ? {}
      : {
          pdf: {
            load: pdf.load,
            startMs: pdf.startMs,
            pdfs: [...new Set(pdf.runs.map((run) => run.id))],
            medians: pdfImports.pdfMedians(pdf.runs),
            target: { ...pdfImports.PDF_RULES_TARGET, ...pdfImports.pdfMeets(pdf.runs) },
            warm: pdf.warm,
            runs: pdf.runs,
          },
        }),
    samples: measured.map(({ engine, load, warm, runs: timed }) => {
      const medians = imports.importMedians(timed);
      return {
        ...imports.IMPORT_SAMPLES[engine],
        engine,
        load,
        medians,
        target: { ...imports.IMPORT_TARGET, ...imports.importMeets(timed, "node", engine) },
        warm,
        runs: timed,
      };
    }),
  });
}

/** Every curated package measured, as decision 0016 has it. */
async function measurePackages(runner: Runner, options: Options) {
  const measure = await runner.import<Measure>("/src/measure/measure.ts");
  const { ENGINE_DIR, engineAvailable, startNodeSession } =
    await runner.import<NodeEngine>("/src/engine/node.ts");
  if (!engineAvailable())
    throw new Error("There is no .engine/ to measure with: run fetch-engine first.");
  const { CURATED } = await runner.import<Curated>("/src/templates/curated.ts");
  const { TexLiveIndex } = await runner.import<TexLive>("/src/page/texlive.ts");

  const manifestPath = join(ENGINE_DIR, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as EngineManifest;
  const sizes = {
    engine: statSync(join(ENGINE_DIR, "busytex.wasm")).size,
    loader: statSync(join(ENGINE_DIR, "busytex.mjs")).size,
    manifest: statSync(manifestPath).size,
  };
  const about = machine();
  const layouts = options.runs * measure.LAYOUTS_PER_EDIT;
  console.log(
    `On ${about.cpu} (${about.cores} cores, ${about.memoryGiB} GiB), ${about.platform}, Node ${about.node}, load ${about.load.toFixed(1)}: ${options.runs} edits and ${layouts} row layouts per package\n`,
  );

  const measured: { numbers: PackageNumbers; load: FirstLoad }[] = [];
  for (const { package: pkg, sample } of CURATED.values()) {
    // A session and fonts of the package's own, so that what they read is a first load's.
    const session = await startNodeSession();
    const tree = {
      index: new TexLiveIndex(manifest),
      read: async (path: string) => readFileSync(join(ENGINE_DIR, "files", path)),
    };
    const numbers = await measure.measurePackage(session, tree, pkg, sample, options.runs);
    const load = measure.firstLoad(numbers, sizes);
    measured.push({ numbers, load });
    console.log(`${pkg.name} (${pkg.id}, ${pkg.engine})`);
    console.log(`${measure.packageTable(numbers, load)}\n`);
  }

  const verdicts = measure.verdicts(measured);
  console.log("Against plan section 4.3");
  console.log(measure.summaryTable(verdicts));
  console.log(
    [
      "",
      "An edit is timed from its command to its drawn page; the scheduler's pause before the",
      "compile, which waits for the typing to stop, is not in it. Sizes are uncompressed;",
      "the CDN compresses them (milestone 5).",
    ].join("\n"),
  );
  if (options.json !== undefined) {
    writeFileSync(options.json, json(measure, about, options.runs, measured, verdicts));
    console.log(`\nThe numbers are in ${options.json}`);
  }
}

/**
 * The import measured from the file to the page, on each engine's upstream sample, as decision
 * 0045 has it: one import not counted, then `runs` timed, each on an engine started afresh.
 */
async function measureImports(runner: Runner, options: Options) {
  const imports = await runner.import<Imports>("/src/measure/import.ts");
  const { engineAvailable } = await runner.import<NodeEngine>("/src/engine/node.ts");
  if (!engineAvailable())
    throw new Error("There is no .engine/ to measure with: run fetch-engine first.");
  const node = await runner.import<NodeImports>("/src/measure/node.ts");
  const manifest = node.engineManifest();
  // Every sample is read before any is measured, so that one not fetched says so at once.
  const uploads = options.engines.map((engine) => ({
    engine,
    upload: sampleUpload(imports.IMPORT_SAMPLES[engine].id),
  }));
  const others = options.pdf ? otherPdfs() : [];
  const about = machine();
  console.log(
    `On ${about.cpu} (${about.cores} cores, ${about.memoryGiB} GiB), ${about.platform}, Node ${about.node}, load ${about.load.toFixed(1)}: ${options.runs} imports timed per sample${options.pdf ? " and per PDF" : ""}, after one not counted\n`,
  );

  const measured: SampleMeasured[] = [];
  for (const { engine, upload } of uploads) {
    const sample = imports.IMPORT_SAMPLES[engine];
    const start = loadavg()[0] ?? 0;
    console.log(`${sample.name} (${sample.id}, ${engine}), the load ${start.toFixed(1)}`);
    let index = 0;
    const once = async () => {
      const measuredOnce = await imports.measureImport({
        start: () => node.importEngine(manifest),
        fonts: () => node.treeFonts(manifest),
        files: [upload],
      });
      const which = index === 0 ? "warm-up, not counted" : `${index} of ${options.runs}`;
      const took = imports.isRefused(measuredOnce)
        ? "refused"
        : imports.formatTime(measuredOnce.ms);
      console.log(`  ${which}: ${took}`);
      return measuredOnce;
    };
    const done: ImportRuns | undefined = await imports.importRuns(once, options.runs, (each) => {
      index = each;
    });
    if (done === undefined) continue;
    if ("refused" in done) {
      const { reason, message } = done.refused.refused;
      throw new Error(`${sample.id} was refused (${reason}): ${message}`);
    }
    const end = loadavg()[0] ?? 0;
    measured.push({ engine, load: { start, end }, warm: done.warm, runs: done.runs });
    console.log(`${imports.importTable(engine, done.runs, "node")}`);
    console.log(`The load ${end.toFixed(1)} as the imports ended.\n`);
  }
  if (uploads.length > 0)
    console.log(
      [
        "Each import built its outline with no naming step and sent nothing. The bar is judged on",
        "pdfTeX, and XeTeX is reported beside it, not judged; it is under",
        `${imports.IMPORT_TARGET.limit / 1000} s, raised by decision 0045 from the plan's 5 s.`,
      ].join("\n"),
    );
  const pdfImports = await runner.import<PdfImports>("/src/measure/pdf-import.ts");
  let pdf: PdfMeasured | undefined;
  if (options.pdf) {
    if (uploads.length > 0) console.log("");
    pdf = await measurePdfs(runner, pdfImports, node, manifest, others, options.runs);
  }
  if (options.json !== undefined) {
    writeFileSync(
      options.json,
      importJson(imports, pdfImports, about, options.runs, measured, pdf),
    );
    console.log(`\nThe numbers are in ${options.json}`);
  }
}

/**
 * The invented resumes other tools printed, each `resume.pdf` in a folder of the PDF spike's third
 * set, with its truth beside it: never a corpus resume. Read before anything is measured, so that
 * one missing says so at once.
 */
function otherPdfs(): PdfSample[] {
  return readdirSync(OTHER_DIR)
    .filter((name) => existsSync(join(OTHER_DIR, name, "resume.pdf")))
    .sort()
    .map((name) => ({
      id: name,
      set: "other" as const,
      bytes: new Uint8Array(readFileSync(join(OTHER_DIR, name, "resume.pdf"))),
    }));
}

/**
 * The PDF import by rules, on the built-in templates' PDFs, made first on the engine, and on
 * `others`: one pass not counted, then `runs` timed, every page on one engine started once.
 */
async function measurePdfs(
  runner: Runner,
  pdfImports: PdfImports,
  node: NodeImports,
  manifest: EngineManifest,
  others: readonly PdfSample[],
  runs: number,
): Promise<PdfMeasured> {
  const { readPdf } = await runner.import<PdfNode>("/src/pdf/node.ts");
  const starting = performance.now();
  // One engine for every page: Node compiles the engine afresh at each start, 3.4 s, where a
  // browser keeps it compiled (decision 0045), and the page part times the draft's own requests.
  const engine = await node.importEngine(manifest);
  const startMs = performance.now() - starting;
  const builtin = await pdfImports.builtinPdfs(engine, node.treeFonts(manifest));
  const pdfs = [...builtin, ...others];
  const start = loadavg()[0] ?? 0;
  console.log(
    `The PDF import by rules on ${pdfs.length} invented PDFs, the load ${start.toFixed(1)}; the engine the pages share started in ${pdfImports.formatTime(startMs)}`,
  );
  const done = await pdfImports.pdfRuns(
    pdfs,
    (pdf) =>
      pdfImports.measurePdfImport(pdf, {
        read: (bytes) => readPdf(bytes),
        page: { engine: async () => engine, fonts: () => node.treeFonts(manifest) },
      }),
    runs,
    (pass) =>
      console.log(`  ${pass === 0 ? "warm-up pass, not counted" : `pass ${pass} of ${runs}`}`),
  );
  if (done === undefined) throw new Error("the PDF imports stopped");
  if ("refused" in done) {
    const { id, refused } = done.refused;
    throw new Error(`the invented PDF ${id} was refused (${refused.reason}): ${refused.message}`);
  }
  const end = loadavg()[0] ?? 0;
  console.log(pdfImports.pdfTable(done.runs, "node"));
  console.log(`The load ${end.toFixed(1)} as the imports ended.`);
  engine.terminate();
  return { load: { start, end }, startMs, warm: done.warm, runs: done.runs };
}

/**
 * The corpus resumes a file of ids names, each of which the last fetch must have fetched, in the
 * file's order, as `corpus run --ids` takes them.
 */
function corpusDocuments(idsFile: string): LiveDocument[] {
  const ids = idsOf(readFileSync(idsFile, "utf8"));
  if (ids.length === 0) throw new Error("the --ids file names no resume");
  const manifest = parseJson(Manifest, readFileSync(MANIFEST_FILE, "utf8"), MANIFEST_FILE);
  const report = existsSync(FETCH_REPORT_FILE)
    ? parseJson(FetchReport, readFileSync(FETCH_REPORT_FILE, "utf8"), FETCH_REPORT_FILE)
    : undefined;
  const entries = matchingEntries(manifest, report);
  const fetched = new Map(
    manifest.documents
      .filter(isLive)
      .filter((doc) => entries.get(doc.id)?.state === "fetched")
      .map((doc) => [doc.id, doc] as const),
  );
  const unknown = ids.filter((id) => !fetched.has(id));
  if (unknown.length > 0)
    throw new Error(
      `${unknown.join(", ")} ${unknown.length === 1 ? "is no document" : "are no documents"} the last fetch fetched`,
    );
  return ids.map((id) => fetched.get(id) as LiveDocument);
}

/**
 * Run `work` with the console silent: the editor logs, for developers, what may quote the resume
 * it works on, a page's left-out words or a compile's log, which must never reach the terminal.
 */
async function silently<T>(work: () => Promise<T>): Promise<T> {
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const kept = methods.map((name) => [name, console[name]] as const);
  for (const name of methods) console[name] = () => {};
  try {
    return await work();
  } finally {
    for (const [name, method] of kept) console[name] = method;
  }
}

/** Typing on imported corpus resumes, as `--typing-imports` measures it. */
async function measureTyping(runner: Runner, idsFile: string, options: Options) {
  const typing = await runner.import<Typing>("/src/measure/import-typing.ts");
  const { formatMs } = await runner.import<Measure>("/src/measure/measure.ts");
  const { engineAvailable } = await runner.import<NodeEngine>("/src/engine/node.ts");
  if (!engineAvailable())
    throw new Error("There is no .engine/ to measure with: run fetch-engine first.");
  const node = await runner.import<NodeImports>("/src/measure/node.ts");
  const manifest = node.engineManifest();
  const documents = corpusDocuments(idsFile);
  const treeFont = treeFontFiles(manifest.files);
  // Each line made printable apart, so that a table keeps its line breaks.
  const say = (text: string) => console.log(text.split("\n").map(printable).join("\n"));
  const about = machine();
  say(
    `On ${about.cpu} (${about.cores} cores, ${about.memoryGiB} GiB), ${about.platform}, Node ${about.node}, load ${about.load.toFixed(1)}: ${documents.length} corpus ${documents.length === 1 ? "resume" : "resumes"} imported one at a time, then ${options.runs} edits of each one's longest editable field\n`,
  );
  const rows: TypingRow[] = [];
  const skipped: TypingSkipped = typing.noneSkipped();
  const outcomes: { id: string; family: string; outcome: string; load: number }[] = [];
  for (const [index, doc] of documents.entries()) {
    const load = loadavg()[0] ?? 0;
    const files = [
      {
        name: `${doc.id}.zip`,
        bytes: uploadOf(
          doc,
          (path) => new Uint8Array(readFileSync(join(CORPUS_DIR, doc.id, ...path.split("/")))),
          treeFont,
        ),
      },
    ];
    let measured: Awaited<ReturnType<Typing["measureImportTyping"]>> | "failed";
    try {
      measured = await silently(() =>
        typing.measureImportTyping(
          {
            start: () => node.importEngine(manifest),
            fonts: () => node.treeFonts(manifest),
            files,
          },
          options.runs,
        ),
      );
    } catch {
      // What went wrong may quote the resume, so it goes unsaid.
      measured = "failed";
    }
    const where = `${index + 1}/${documents.length} ${doc.id} (${doc.family})`;
    let outcome: string;
    if (measured === "failed") outcome = "failed";
    else if ("refused" in measured) outcome = `refused (${measured.refused.refused.reason})`;
    else if (!measured.typing.typed) outcome = measured.typing.why;
    else {
      const row = typing.typingRow(doc.id, doc.family, {
        import: measured.import,
        typing: measured.typing,
      });
      rows.push(row);
      const stats = typing.typingStats(row.edits);
      outcome = `typed: median ${formatMs(stats.median)}, slowest ${formatMs(stats.slowest)}, with the pause ${formatMs(stats.withPause)}; ${stats.pages} ${stats.pages === 1 ? "page" : "pages"}`;
    }
    if (measured === "failed" || "refused" in measured || !measured.typing.typed)
      typing.skip(skipped, measured);
    outcomes.push({ id: doc.id, family: doc.family, outcome, load });
    say(`${where}: ${outcome}, the load ${load.toFixed(1)}`);
  }
  const end = loadavg()[0] ?? 0;
  say("");
  if (rows.length > 0) {
    say(typing.typingTable(rows));
    say("");
    say(typing.familyTable(rows));
    say("");
  }
  for (const line of typing.summaryLines(rows, skipped)) say(line);
  say(`The load ${end.toFixed(1)} as the last resume ended.`);
  if (options.json !== undefined) {
    writeFileSync(
      options.json,
      written({
        date: new Date().toISOString(),
        machine: about,
        runs: options.runs,
        load: { start: about.load, end },
        resumes: documents.length,
        typed: rows.length,
        skipped: { ...skipped, count: typing.skippedCount(skipped) },
        summary: typing.typingSummary(rows) ?? null,
        families: [...new Set(rows.map((row) => row.family))].sort().map((family) => ({
          family,
          ...typing.typingSummary(rows.filter((row) => row.family === family)),
        })),
        outcomes,
        documents: rows.map((row) => ({ ...row, stats: typing.typingStats(row.edits) })),
      }),
    );
    say(`\nThe numbers are in ${options.json}`);
  }
}

async function main() {
  const options = optionsOf(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  // Vite's server-side environment on its own, with no dev server around it, so that no file
  // watcher, dependency optimiser or socket runs while the measurements do, and nothing is
  // written.
  const config = await resolveConfig(
    {
      root: APP,
      logLevel: "warn",
      // opentype.js's `main` is a bundle Node cannot take named imports from; Vite takes its ES
      // module instead, as the app's build does.
      ssr: { noExternal: ["opentype.js"] },
    },
    "serve",
  );
  const environment = createRunnableDevEnvironment("ssr", config, { hot: false });
  await environment.init();
  const { runner } = environment;
  try {
    if (options.typing !== undefined) await measureTyping(runner, options.typing, options);
    else if (options.import) await measureImports(runner, options);
    else await measurePackages(runner, options);
  } finally {
    await environment.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
