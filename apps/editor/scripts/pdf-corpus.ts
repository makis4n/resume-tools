/**
 * How well the rules read the corpus's PDFs (milestone 3 second pass, item 15), run by hand as the
 * corpus run is, and never in CI: the corpus's documents that compile are made PDFs by the engine,
 * as the editor exports one, and read by the editor's reader and its rules alone, which is what a
 * person who says no to the hosted model gets. No corpus document is ever given to a model.
 *
 *   pnpm --filter @resume-tools/editor pdf-corpus [--only <ids>] [--ids <file>] [--limit <n>]
 *                 [--again] [--out <folder>]
 *
 *   --only    those documents, a comma between ids; --ids, those a file names one a line
 *   --limit   read at most this many documents not yet read, for a run in chunks
 *   --again   read a document again, though it has its counts
 *   --out     keep the per-document counts in `.corpus/<folder>/` instead of `.corpus/pdf-corpus/`
 *
 * It runs a pool of four child processes, 120 s a document (`pdf-corpus-child.ts`). Each
 * document's counts, its id, its family and numbers only, go to `.corpus/pdf-corpus/<id>.json`,
 * and their sum to `summary.json` beside them; documents that have counts are skipped, so a run
 * picks up where the last one stopped. It prints, a document a line, what became of it in counts,
 * then the tables of every document read so far and the owner's targets for this set, each met or
 * not (docs/milestone-3-overhaul.md, "For a PDF import"): words read, words that land, the share
 * in a recognised place and in the catch-all, columns, refusals and times. It never prints, keeps
 * or sends a document's text.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
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
import { type CorpusCounts, corpusTable, summariseCorpus, targetLines } from "./pdf-counts.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const CHILD = fileURLToPath(new URL("./pdf-corpus-child.ts", import.meta.url));

/** Where the per-document counts go by default, under `.corpus/`. */
export const PDF_CORPUS_FOLDER = "pdf-corpus";

/** How long a document may take, its compile, its PDF and its reading together. */
const LIMIT_MS = 120_000;

const USAGE =
  "pnpm --filter @resume-tools/editor pdf-corpus [--only <ids>] [--ids <file>] [--limit <n>] [--again] [--out <folder>]";

interface Options {
  only?: string;
  ids?: string;
  limit?: number;
  again: boolean;
  out: string;
}

/** The folder `--out` names under `.corpus/`: a plain name, so that it stays there. */
export function outFolder(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
    throw new Error(`--out takes a folder's name of small letters, digits and dashes, not ${name}`);
  return join(CORPUS_DIR, name);
}

function optionsOf(args: string[]): Options {
  const { values } = parseArgs({
    args,
    options: {
      only: { type: "string" },
      ids: { type: "string" },
      limit: { type: "string" },
      again: { type: "boolean" },
      out: { type: "string" },
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
    ...(values.only === undefined ? {} : { only: values.only }),
    ...(ids === undefined ? {} : { ids }),
    ...(limit === undefined ? {} : { limit }),
    again: values.again ?? false,
    out: values.out ?? PDF_CORPUS_FOLDER,
  };
}

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

/** A document's line: what became of it, in counts. */
function lineOf(counts: CorpusCounts): string {
  if (counts.outcome !== "read")
    return `not read: ${counts.outcome}${counts.failure === undefined ? "" : ` (${counts.failure})`}${counts.pdfError === undefined ? "" : ` (${counts.pdfError})`}`;
  const words = counts.words;
  const time = Math.round((counts.readMs ?? 0) + (counts.rulesMs ?? 0));
  return `read, ${counts.pages} pages, ${counts.columns} columns, ${counts.lines} lines, ${counts.sections} sections, ${words?.landed}/${words?.read} words land, ${words?.recognised} recognised, ${words?.unfiled} in the catch-all, ${time} ms`;
}

async function main() {
  const options = optionsOf(process.argv.slice(2));
  const engineManifest = join(APP, ".engine", "manifest.json");
  if (!existsSync(engineManifest)) throw new Error("There is no .engine/: run fetch-engine first.");
  const engine = JSON.parse(readFileSync(engineManifest, "utf8")) as {
    files: Record<string, number>;
  };
  const documents = corpusDocuments(options);
  if (documents.length === 0) throw new Error("No fetched document to read: run `corpus fetch`.");
  const out = outFolder(options.out);
  mkdirSync(out, { recursive: true });
  const done = (id: string) => existsSync(join(out, `${id}.json`));
  let todo = documents.filter((doc) => options.again || !done(doc.id));
  if (options.limit !== undefined) todo = todo.slice(0, options.limit);
  const treeFont = treeFonts(engine.files);
  const families = new Map(documents.map((doc) => [doc.id, doc.family]));
  console.log(
    `${documents.length} documents, ${documents.length - documents.filter((doc) => !done(doc.id)).length} read before; reading ${todo.length}, four at a time, ${LIMIT_MS / 1000} s each at most, counts under .corpus/${options.out}/`,
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
    limitMs: LIMIT_MS,
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
      console.log(`${count}/${todo.length} ${task.id}: ${lineOf(counts)}`);
    },
  });
  // The summary, of every document read so far.
  const all = documents.flatMap((doc) => {
    const file = join(out, `${doc.id}.json`);
    if (!existsSync(file)) return [];
    return [
      JSON.parse(readFileSync(file, "utf8")) as {
        id: string;
        family: string;
        counts: CorpusCounts;
      },
    ];
  });
  const summary = summariseCorpus(all);
  writeAtomically(
    join(out, "summary.json"),
    `${JSON.stringify({ at: new Date().toISOString(), summary }, null, 2)}\n`,
  );
  console.log(`\n${corpusTable(summary).join("\n")}\n\n${targetLines(summary).join("\n")}`);
  const left = documents.filter((doc) => !done(doc.id)).length;
  if (left > 0)
    console.log(`\n${left} documents are not read yet: run the command again to go on.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
