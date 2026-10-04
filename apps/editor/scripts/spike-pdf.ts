/**
 * The PDF spike (milestone 3's second pass, item 3): reading PDFs by rules and by the hosted model,
 * measured on three sets, whose numbers set the second pass's PDF targets and the model's time
 * budget (docs/milestone-3-overhaul.md):
 *
 *   pnpm --filter @resume-tools/editor spike-pdf builtin [--model] [--again]
 *   pnpm --filter @resume-tools/editor spike-pdf other [--model] [--again] [--print]
 *   pnpm --filter @resume-tools/editor spike-pdf corpus [--only <ids>] [--ids <file>]
 *                 [--limit <n>] [--again] [--out <folder>]
 *   pnpm --filter @resume-tools/editor spike-pdf reader
 *   pnpm --filter @resume-tools/editor spike-pdf --report
 *
 *   builtin   the editor's own PDFs: each built-in template typesets each curated package's
 *             invented sample, by the engine in `.engine/`, into `spike-pdf/fixtures/builtin/`, and
 *             each PDF is read by the rules and scored against its resume (`spike-pdf/builtin.ts`)
 *   other     invented resumes printed by other tools, committed under `spike-pdf/fixtures/other/`
 *             with each one's source and truth, read by the rules and scored (`spike-pdf/print.ts`);
 *             two of them are held out, scored apart, never used to tune the rules
 *   --print   print the third set's PDFs again from their sources first, by Chrome and AppKit
 *   --model   ask the hosted model, SoCLaaS's `qwen3.8:27b` as decision 0044 asks it, for the
 *             roles of each PDF's lines too, and score its filing beside the rules'. It needs
 *             `SOCLAAS_API_KEY` in the environment, and reads only the invented sets' folders
 *             (`spike-pdf/model.ts`). A PDF the model has answered is not asked again; it stops
 *             asking after three gateway failures in a row
 *   --again   ask the model again, each call kept, as a further pass; or read a corpus document
 *             again, though it has its counts
 *   corpus    the corpus's documents that compile, made PDFs by the engine as the editor would and
 *             read by the rules alone, in a pool of four child processes, 120 s a document; each
 *             document's counts, ids and numbers only, under `.corpus/spike-pdf/`; documents that
 *             have them are skipped, so a run picks up where the last one stopped
 *   --only    those documents, a comma between ids; --ids, those a file names one a line
 *   --limit   read at most this many documents not yet read, for a run in chunks
 *   --out     keep the per-document counts in `.corpus/<folder>/` instead, a run of its own, and
 *             print its tables without writing them into `results.json`, which keeps the spike's
 *             own run (item 11 counted the columns, lines and blocks this way)
 *   reader    pdf.js's version, its browser build's size, and how it loads
 *   --report  print the tables again from `spike-pdf/fixtures/results.json`, reading nothing else
 *
 * Every run writes its set's part of `spike-pdf/fixtures/results.json` and prints the tables. The
 * corpus's part holds counts summed over its documents, never a document's text.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { brotliCompressSync, gzipSync, constants as zlib } from "node:zlib";
import { Resume } from "@resume-tools/resume-model";
import {
  CORPUS_DIR,
  FETCH_REPORT_FILE,
  FetchReport,
  isLive,
  MANIFEST_FILE,
  Manifest,
  matchingEntries,
  onlyIds,
  parseJson,
  writeAtomically,
} from "./corpus-manifest.ts";
import { runPool, treeFonts, uploadOf } from "./corpus-reference.ts";
import { BUILTIN_DIR, makeBuiltinPdfs } from "./spike-pdf/builtin.ts";
import type { CorpusCounts } from "./spike-pdf/counts.ts";
import { fileLines } from "./spike-pdf/file.ts";
import { layOut } from "./spike-pdf/layout.ts";
import { labelByModel, MODEL, truthPathOf } from "./spike-pdf/model.ts";
import { OTHER_DIR, printFixtures } from "./spike-pdf/print.ts";
import { readPdf } from "./spike-pdf/read.ts";
import {
  type CallRecord,
  type DocResult,
  HELD_OUT,
  type ReaderInfo,
  type Reading,
  type Results,
  summariseCorpus,
  summaryOf,
  tables,
} from "./spike-pdf/report.ts";
import { labelByRules, type Role } from "./spike-pdf/roles.ts";
import { scoreResume } from "./spike-pdf/score.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));

/** The spike's results, which each run writes its part of and `--report` reads. */
export const RESULTS_FILE = fileURLToPath(
  new URL("./spike-pdf/fixtures/results.json", import.meta.url),
);

/** Where the corpus's per-document counts go: ids and numbers only. */
const CORPUS_OUT = join(CORPUS_DIR, "spike-pdf");

/** The folder `--out` names under `.corpus/`: a plain name, so that it stays there. */
function corpusOut(options: Options): string {
  if (options.out === undefined) return CORPUS_OUT;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.out))
    throw new Error(
      `--out takes a folder's name of small letters, digits and dashes, not ${options.out}`,
    );
  return join(CORPUS_DIR, options.out);
}

const CHILD = fileURLToPath(new URL("./spike-pdf/corpus-child.ts", import.meta.url));

/**
 * The third set's resumes held out: written, printed and scored once after the rules were set,
 * never used to tune them, so that their score says how the rules read a layout they have not
 * seen. The other six were the rules' debugging set, with the first set.
 */
const HELD_OUT_FIXTURES = new Set(["chrome-right-sidebar", "textutil-table"]);

/** How long a corpus document may take, its compile, its PDF and its reading together. */
const CORPUS_LIMIT_MS = 120_000;

const USAGE = [
  "pnpm --filter @resume-tools/editor spike-pdf builtin [--model] [--again]",
  "pnpm --filter @resume-tools/editor spike-pdf other [--model] [--again] [--print]",
  "pnpm --filter @resume-tools/editor spike-pdf corpus [--only <ids>] [--ids <file>] [--limit <n>] [--again] [--out <folder>]",
  "pnpm --filter @resume-tools/editor spike-pdf reader",
  "pnpm --filter @resume-tools/editor spike-pdf --report",
].join("\n");

function readResults(): Results {
  if (!existsSync(RESULTS_FILE)) return { version: 1 };
  return JSON.parse(readFileSync(RESULTS_FILE, "utf8")) as Results;
}

/**
 * Write one part of the results, the file read again just before, so that two runs of different
 * sets at once each keep the other's part. Gives back the results as written.
 */
function writePart<K extends Exclude<keyof Results, "version">>(
  part: K,
  value: Results[K],
): Results {
  const results = readResults();
  results[part] = value;
  const rounded = (_: string, number: unknown) =>
    typeof number === "number" && !Number.isInteger(number) ? Math.round(number * 10) / 10 : number;
  writeFileSync(RESULTS_FILE, `${JSON.stringify(results, rounded, 2)}\n`);
  return results;
}

/** The commit the run ran at, `+dirty` when a file differs from it. */
function commitOf(): string {
  try {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: APP,
      encoding: "utf8",
    });
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: APP, encoding: "utf8" });
    return `${head.trim()}${dirty.trim() === "" ? "" : "+dirty"}`;
  } catch {
    return "unknown";
  }
}

// The invented sets.

/** An invented PDF of the first or third set: its id, its group, its PDF and its truth. */
interface Invented {
  id: string;
  group: string;
  pdf: string;
}

/** Read an invented PDF by the rules, and file and score it. */
async function readByRules(doc: Invented): Promise<DocResult> {
  const truth = Resume.parse(JSON.parse(readFileSync(truthPathOf(doc.pdf), "utf8")));
  const read = await readPdf(new Uint8Array(readFileSync(doc.pdf)));
  if ("refused" in read) throw new Error(`${doc.id} was refused: ${read.refused}`);
  const started = performance.now();
  const layout = layOut(read);
  const roles = labelByRules(layout);
  const filed = fileLines(layout, roles);
  const rulesMs = performance.now() - started;
  return {
    id: doc.id,
    group: doc.group,
    pages: layout.pages.length,
    lines: layout.lines.length,
    columns: Math.max(1, ...layout.pages.map((page) => page.columns)),
    icons: layout.icons,
    hyphenJoins: layout.hyphenJoins,
    readMs: read.ms,
    rulesMs,
    rules: readingOf(truth, layout, roles),
  };
}

/** A reading of an invented PDF, from its lines' roles: filed, counted and scored. */
function readingOf(
  truth: Resume,
  layout: ReturnType<typeof layOut>,
  roles: readonly Role[],
): Reading {
  const filed = fileLines(layout, roles);
  const score = scoreResume(truth, filed.resume);
  return {
    words: filed.words,
    flags: {
      dateAsText: filed.flags.filter((flag) => flag.kind === "date-as-text").length,
      unfiled: filed.flags.filter((flag) => flag.kind === "unfiled").length,
    },
    score: summaryOf(score),
    wrong: score.fields
      .filter((field) => !field.right)
      .map(({ kind, truth: text, read }) => ({
        kind,
        truth: text,
        ...(read === undefined ? {} : { read }),
      })),
  };
}

/**
 * Ask the model for each document's roles, unless an earlier run has its answer, and keep every
 * call. Stops asking after three gateway failures in a row, as the benchmark does (decision 0044).
 */
async function askModel(
  docs: readonly Invented[],
  results: DocResult[],
  previous: readonly DocResult[] | undefined,
  again: boolean,
) {
  const apiKey = process.env.SOCLAAS_API_KEY ?? "";
  if (apiKey.trim() === "") {
    console.log("No SOCLAAS_API_KEY in the environment: the model is not asked.");
    for (const result of results) {
      const before = previous?.find((each) => each.id === result.id)?.model;
      if (before) result.model = before;
    }
    return;
  }
  let downInARow = 0;
  for (const doc of docs) {
    const result = results.find((each) => each.id === doc.id);
    if (result === undefined) continue;
    const before = previous?.find((each) => each.id === doc.id)?.model;
    if (before !== undefined) result.model = before;
    if (!again && before?.reading !== undefined) {
      console.log(`  ${doc.id}: answered before, not asked`);
      continue;
    }
    if (downInARow >= 3) {
      console.log(`  ${doc.id}: not asked, the gateway failed three times in a row`);
      continue;
    }
    const truth = Resume.parse(JSON.parse(readFileSync(truthPathOf(doc.pdf), "utf8")));
    const started = performance.now();
    const { layout, features, call } = await labelByModel(doc.pdf, { apiKey });
    const record: CallRecord = {
      at: new Date().toISOString(),
      ms: call.ms,
      lines: features.length,
      ...(call.failure === undefined ? {} : { failure: call.failure }),
      ...(call.status === undefined ? {} : { status: call.status }),
      ...(call.tokens === undefined ? {} : { tokens: call.tokens }),
    };
    const model = (result.model ??= { model: MODEL, calls: [] });
    model.calls.push(record);
    if (call.roles !== undefined) {
      model.reading = readingOf(truth, layout, call.roles);
      model.labelMs = performance.now() - started;
      record.fields = model.reading.score.all;
      downInARow = 0;
    } else if (call.failure === "gateway down" || call.failure === "rate limited") downInARow++;
    const said =
      call.roles !== undefined
        ? `${(call.ms / 1000).toFixed(1)} s, fields right ${model.reading?.score.all.right}/${model.reading?.score.all.total}`
        : `${(call.ms / 1000).toFixed(1)} s, failed: ${call.failure}${call.status === undefined ? "" : ` (${call.status})`}`;
    console.log(`  ${doc.id}: ${features.length} lines, ${said}`);
  }
}

async function runInvented(set: "builtin" | "other", options: Options) {
  const results = readResults();
  let docs: Invented[];
  if (set === "builtin") {
    const made = await makeBuiltinPdfs((line) => console.log(`  ${line}`));
    docs = made.map((pdf) => ({ id: pdf.id, group: pdf.template, pdf: pdf.pdf }));
  } else {
    if (options.print) printFixtures((line) => console.log(`  ${line}`));
    docs = readdirSync(OTHER_DIR)
      .filter((name) => existsSync(join(OTHER_DIR, name, "resume.pdf")))
      .sort()
      .map((name) => ({
        id: name,
        group: HELD_OUT_FIXTURES.has(name) ? HELD_OUT : name.slice(0, name.indexOf("-")),
        pdf: join(OTHER_DIR, name, "resume.pdf"),
      }));
  }
  // pdf.js loads, and starts its worker, with the first PDF it reads: that read is timed apart.
  const first = docs[0];
  let coldMs: number | undefined;
  if (first !== undefined) {
    const started = performance.now();
    await readPdf(new Uint8Array(readFileSync(first.pdf)));
    coldMs = performance.now() - started;
    console.log(`  pdf.js's first read, its loading with it: ${Math.round(coldMs)} ms`);
  }
  const documents: DocResult[] = [];
  for (const doc of docs) {
    const result = await readByRules(doc);
    documents.push(result);
    console.log(
      `  ${doc.id}: rules ${result.rules.score.all.right}/${result.rules.score.all.total} fields, ${result.rules.words.landed}/${result.rules.words.read} words land, ${Math.round(result.rulesMs)} ms`,
    );
  }
  if (options.model) {
    console.log(`Asking ${MODEL} on SoCLaaS:`);
    await askModel(docs, documents, results[set]?.documents, options.again);
  } else
    for (const result of documents) {
      const before = results[set]?.documents.find((each) => each.id === result.id)?.model;
      if (before) result.model = before;
    }
  const written = writePart(set, {
    at: new Date().toISOString(),
    commit: commitOf(),
    ...(coldMs === undefined ? {} : { coldMs }),
    documents,
  });
  console.log(`\n${tables(written)}`);
}

// The corpus.

/** The fetched documents, or those `--only` or `--ids` names. */
function corpusDocuments(options: Options) {
  const manifest = parseJson(Manifest, readFileSync(MANIFEST_FILE, "utf8"), MANIFEST_FILE);
  const report = existsSync(FETCH_REPORT_FILE)
    ? parseJson(FetchReport, readFileSync(FETCH_REPORT_FILE, "utf8"), FETCH_REPORT_FILE)
    : undefined;
  const entries = matchingEntries(manifest, report);
  const fetched = manifest.documents
    .filter(isLive)
    .filter((doc) => entries.get(doc.id)?.state === "fetched");
  const wanted = new Set([
    ...(options.only === undefined ? [] : onlyIds(options.only)),
    ...(options.ids === undefined
      ? []
      : readFileSync(options.ids, "utf8")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== "" && !line.startsWith("#"))),
  ]);
  return wanted.size === 0 ? fetched : fetched.filter((doc) => wanted.has(doc.id));
}

async function runCorpus(options: Options) {
  const engineManifest = join(APP, ".engine", "manifest.json");
  if (!existsSync(engineManifest)) throw new Error("There is no .engine/: run fetch-engine first.");
  const engine = JSON.parse(readFileSync(engineManifest, "utf8")) as {
    files: Record<string, number>;
  };
  const documents = corpusDocuments(options);
  if (documents.length === 0) throw new Error("No fetched document to read: run `corpus fetch`.");
  const out = corpusOut(options);
  mkdirSync(out, { recursive: true });
  const done = (id: string) => existsSync(join(out, `${id}.json`));
  let todo = documents.filter((doc) => options.again || !done(doc.id));
  if (options.limit !== undefined) todo = todo.slice(0, options.limit);
  const treeFont = treeFonts(engine.files);
  const families = new Map(documents.map((doc) => [doc.id, doc.family]));
  console.log(
    `${documents.length} documents, ${documents.length - documents.filter((doc) => !done(doc.id)).length} read before; reading ${todo.length}, four at a time, ${CORPUS_LIMIT_MS / 1000} s each at most`,
  );
  let count = 0;
  await runPool({
    script: CHILD,
    tasks: todo.map((doc) => ({
      id: doc.id,
      message: () => ({
        name: `${doc.id}.zip`,
        bytes: uploadOf(
          doc,
          (path) => new Uint8Array(readFileSync(join(CORPUS_DIR, doc.id, ...path.split("/")))),
          treeFont,
        ),
      }),
    })),
    limitMs: CORPUS_LIMIT_MS,
    onResult: (task, result) => {
      const reply = result.reply as { counts?: CorpusCounts } | undefined;
      const counts: CorpusCounts = reply?.counts ?? {
        outcome: result.timedOut ? "timeout" : "crashed",
      };
      writeAtomically(
        join(out, `${task.id}.json`),
        `${JSON.stringify({ id: task.id, family: families.get(task.id) ?? "other", counts }, null, 2)}\n`,
      );
      count++;
      const words = counts.words;
      const what =
        counts.outcome === "read"
          ? `read, ${counts.pages} pages, ${counts.columns} columns, ${counts.lines} lines, ${counts.blocks} blocks, ${counts.sections} sections, ${words?.landed}/${words?.read} words land, ${words?.recognised} recognised`
          : `not read: ${counts.outcome}${counts.failure === undefined ? "" : ` (${counts.failure})`}`;
      console.log(`${count}/${todo.length} ${task.id}: ${what}`);
    },
  });
  // The summary, of every document read so far.
  const all = documents.flatMap((doc) => {
    const file = join(out, `${doc.id}.json`);
    if (!existsSync(file)) return [];
    const kept = JSON.parse(readFileSync(file, "utf8")) as {
      id: string;
      family: string;
      counts: CorpusCounts;
    };
    return [kept];
  });
  const part = { at: new Date().toISOString(), commit: commitOf(), summary: summariseCorpus(all) };
  const written =
    options.out === undefined
      ? writePart("corpus", part)
      : ({ version: 1, corpus: part } satisfies Results);
  const left = documents.filter((doc) => !done(doc.id)).length;
  console.log(`\n${tables(written)}`);
  if (left > 0)
    console.log(`\n${left} documents are not read yet: run the command again to go on.`);
}

// The reader.

function runReader() {
  const require = createRequire(join(APP, "package.json"));
  const pkgFile = require.resolve("pdfjs-dist/package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as { version: string; license: string };
  const root = resolve(pkgFile, "..");
  const sizes = [
    "build/pdf.min.mjs",
    "build/pdf.worker.min.mjs",
    "legacy/build/pdf.min.mjs",
    "legacy/build/pdf.worker.min.mjs",
  ].map((file) => {
    const bytes = readFileSync(join(root, file));
    return {
      file: `pdfjs-dist/${file}`,
      raw: bytes.length,
      gzip: gzipSync(bytes, { level: 9 }).length,
      brotli: brotliCompressSync(bytes, {
        params: { [zlib.BROTLI_PARAM_QUALITY]: 11 },
      }).length,
    };
  });
  const optional: ReaderInfo["optional"] = [];
  try {
    const canvasFile = require.resolve("@napi-rs/canvas/package.json", { paths: [root] });
    const canvas = JSON.parse(readFileSync(canvasFile, "utf8")) as { version: string };
    const folder = resolve(canvasFile, "..", "..");
    const size = (path: string): number => {
      const stat = statSync(path);
      return stat.isDirectory()
        ? readdirSync(path).reduce((sum, name) => sum + size(join(path, name)), 0)
        : stat.size;
    };
    // The package and the native binary pnpm picked for this machine, beside it.
    const bytes = readdirSync(folder)
      .filter((name) => name.startsWith("canvas"))
      .reduce((sum, name) => sum + size(join(folder, name)), 0);
    optional.push({
      package: "@napi-rs/canvas",
      version: canvas.version,
      bytes,
      loadedInNode: true,
    });
  } catch {
    // No canvas package: nothing to say.
  }
  const reader: ReaderInfo = {
    package: "pdfjs-dist",
    version: pkg.version,
    license: pkg.license,
    sizes,
    loading: [
      'In the browser: ES modules. The main module starts a module worker from the worker\'s file (`new Worker(url, { type: "module" })`, `GlobalWorkerOptions.workerSrc`), or takes a worker the page made (`workerPort`); the parsing runs in the worker.',
      "In Node, as this spike reads: the legacy build, its worker loaded in the same thread by a dynamic `import()` (a fake worker); no worker thread.",
      "Reading text needs no WASM and nothing fetched: the `wasm/` decoders are for JBIG2, JPEG 2000 and colour profiles, and CMaps and standard fonts are fetched only from the URLs a caller gives, which this spike gives none.",
    ],
    optional,
  };
  writePart("reader", reader);
  console.log(tables({ version: 1, reader }));
}

// The command.

interface Options {
  command?: string;
  model: boolean;
  again: boolean;
  print: boolean;
  only?: string;
  ids?: string;
  limit?: number;
  out?: string;
  report: boolean;
}

function optionsOf(args: string[]): Options {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      model: { type: "boolean" },
      again: { type: "boolean" },
      print: { type: "boolean" },
      only: { type: "string" },
      ids: { type: "string" },
      limit: { type: "string" },
      out: { type: "string" },
      report: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
    throw new Error(`--limit takes a whole number from 1, not ${values.limit}`);
  // pnpm runs the script in the editor's folder; a path is the caller's, from where pnpm was run.
  const ids =
    values.ids === undefined ? undefined : resolve(process.env.INIT_CWD ?? ".", values.ids);
  return {
    ...(positionals[0] === undefined ? {} : { command: positionals[0] }),
    model: values.model ?? false,
    again: values.again ?? false,
    print: values.print ?? false,
    ...(values.only === undefined ? {} : { only: values.only }),
    ...(ids === undefined ? {} : { ids }),
    ...(limit === undefined ? {} : { limit }),
    ...(values.out === undefined ? {} : { out: values.out }),
    report: values.report ?? false,
  };
}

async function main() {
  const options = optionsOf(process.argv.slice(2));
  if (options.report) {
    if (!existsSync(RESULTS_FILE)) throw new Error("There are no results yet: run a set first.");
    console.log(tables(readResults()));
    return;
  }
  switch (options.command) {
    case "builtin":
    case "other":
      await runInvented(options.command, options);
      return;
    case "corpus":
      await runCorpus(options);
      return;
    case "reader":
      runReader();
      return;
    default:
      throw new Error(USAGE);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
