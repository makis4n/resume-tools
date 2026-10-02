/**
 * Measure the editor against the targets of plan section 4.3 (milestone 2 item 23, decision
 * 0016), in Node, for every curated package with its invented sample; or, with `--import`, an
 * import from the file to the page (milestone 3 item 19, decision 0045):
 *
 *   pnpm --filter @resume-tools/editor measure [--runs <n>] [--json <file>]
 *   pnpm --filter @resume-tools/editor measure --import [--engine <engine>] [--runs <n>]
 *     [--json <file>]
 *
 *   --runs <n>         edits to time per package, 10 by default; the overlay's row layout is timed
 *                      ten times as often. With --import, imports to time per sample, 5 by default
 *   --json <file>      write the numbers as JSON too, for the decision record
 *   --import           measure the import instead: a launch template's upstream sample, cached
 *   --engine <engine>  with --import, the one sample of pdftex or xetex, not both
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
 * which `corpus oracle` fetches into `.corpus/oracle/` and whose every macro the committed answers
 * name, are each imported through the editor's compile scheduler, their report read as the app
 * reads it, and opened to their first drawn page, a partial one without waiting for a Continue, the
 * naming step answered from the committed answers alone, as the dev server answers with no key, so
 * that no model is asked (`src/measure/import.ts`, `src/measure/node.ts`). Each import is on an
 * engine started afresh, as a newly opened editor's worker is; one is imported first and not
 * counted, then `--runs` are timed. It prints, for each sample, its parts' medians, from the file to
 * the page, and the verdict against the bar, under 8 s, raised by decision 0045 from plan section
 * 4.3's 5 s, judged on pdfTeX; XeTeX's import is reported beside it, not judged.
 *
 * The editor's modules are written for Vite, with extensionless imports, JSX, and JSON and `?raw`
 * imports, which Node cannot load. So this file, which Node runs as it is, loads them through
 * Vite's module runner with the app's own Vite config, the way Vitest loads the tests, and imports
 * nothing of the editor itself but types.
 */

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus, loadavg, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import type { Engine, Fetched } from "../src/engine/session.ts";
import type { ImportRuns, ImportTime } from "../src/measure/import.ts";
import type { FirstLoad, PackageNumbers, StepReads } from "../src/measure/measure.ts";
import { sampleUpload } from "./serve-samples.ts";

type Measure = typeof import("../src/measure/measure.ts");
type Imports = typeof import("../src/measure/import.ts");
type NodeImports = typeof import("../src/measure/node.ts");
type NodeEngine = typeof import("../src/engine/node.ts");
type Curated = typeof import("../src/templates/curated.ts");
type TexLive = typeof import("../src/page/texlive.ts");
type Runner = ReturnType<typeof createRunnableDevEnvironment>["runner"];

const APP = fileURLToPath(new URL("..", import.meta.url));

const USAGE = [
  "pnpm --filter @resume-tools/editor measure [--runs <n>] [--json <file>]",
  "pnpm --filter @resume-tools/editor measure --import [--engine <pdftex|xetex>] [--runs <n>] [--json <file>]",
].join("\n");

/** Edits timed per package when `--runs` does not say. */
const RUNS = 10;

/**
 * Imports timed per sample when `--runs` does not say, as `src/measure/import.ts`'s `IMPORT_RUNS`
 * has it: the options are read before Vite's runner can load that module.
 */
const IMPORT_RUNS = 5;

const ENGINES: readonly Engine[] = ["pdftex", "xetex"];

interface Options {
  runs: number;
  json: string | undefined;
  /** Whether to measure the import, and on which engines' samples. */
  import: boolean;
  engines: readonly Engine[];
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
      help: { type: "boolean", short: "h" },
    },
  });
  const imports = values.import ?? false;
  const runs = values.runs === undefined ? (imports ? IMPORT_RUNS : RUNS) : Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error(`--runs takes a whole number from 1, not ${values.runs}`);
  if (values.engine !== undefined && !imports)
    throw new Error("--engine picks the sample an import is measured on: give --import with it");
  const engines =
    values.engine === undefined ? ENGINES : ENGINES.filter((e) => e === values.engine);
  if (engines.length === 0)
    throw new Error(`--engine takes ${ENGINES.join(" or ")}, not ${values.engine}`);
  // pnpm runs the script in the editor's folder; a path is the caller's, from where pnpm was run.
  const json =
    values.json === undefined ? undefined : resolve(process.env.INIT_CWD ?? ".", values.json);
  return { runs, json, import: imports, engines, help: values.help ?? false };
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

/** The import's numbers as the JSON keeps them: each sample's imports, and their medians. */
function importJson(
  imports: Imports,
  about: ReturnType<typeof machine>,
  runs: number,
  measured: readonly SampleMeasured[],
): string {
  return written({
    date: new Date().toISOString(),
    machine: about,
    runs,
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
      "compile, which waits for the typing to stop, is not in it. The slow-laptop target counts",
      "only on a 2019 laptop. Sizes are uncompressed; the CDN compresses them (milestone 5).",
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
  const about = machine();
  console.log(
    `On ${about.cpu} (${about.cores} cores, ${about.memoryGiB} GiB), ${about.platform}, Node ${about.node}, load ${about.load.toFixed(1)}: ${options.runs} imports timed per sample, after one not counted\n`,
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
  console.log(
    [
      "The naming step answered from the committed answers alone, as the dev server does with no",
      "key, and asked no model. The bar is judged on pdfTeX, and XeTeX is reported beside it, not",
      `judged; it is under ${imports.IMPORT_TARGET.limit / 1000} s, raised by decision 0045 from the plan's 5 s.`,
    ].join("\n"),
  );
  if (options.json !== undefined) {
    writeFileSync(options.json, importJson(imports, about, options.runs, measured));
    console.log(`\nThe numbers are in ${options.json}`);
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
    if (options.import) await measureImports(runner, options);
    else await measurePackages(runner, options);
  } finally {
    await environment.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
