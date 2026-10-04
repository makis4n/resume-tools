/**
 * The outline, measured on the samples (milestone 3's second pass, item 2,
 * `docs/milestone-3-overhaul.md`): a spike, no editor work, whose numbers set the second pass's
 * `.tex` targets.
 *
 *   pnpm --filter @resume-tools/editor spike-outline [--ids <file>] [--only <id>] [--again]
 *                 [--children <n>] [--first <run.json>]
 *   pnpm --filter @resume-tools/editor spike-outline --report [--first <run.json>]
 *
 * It takes the oracle's three upstream samples, which `corpus oracle` fetched into `.corpus/oracle/`,
 * and the corpus's documents a file of ids names (`--ids`, one a line, as `corpus run --ids` takes
 * it) or `--only` names, one id or several a comma separates, through the import's pipeline up to
 * the probe, and builds and checks the outline of each, in a pool of children
 * (`spike-outline-child.ts`), 900 s a document. Each document's row, ids and counts only, goes to
 * `.corpus/spike-outline/<id>.json` as it ends, and a document whose row is there already is not
 * taken again unless `--again` says so, so that a run stopped short goes on where it stopped. It
 * prints a line a document, then the tables (`spike-outline-table.ts`): each document's, and the
 * words and the units by template family, with a row for each upstream sample and a total, beside
 * the first pass's editable share of the same documents. That comes from the JSON of the first
 * pass's `corpus run --committed-only --ids <file> --json <run.json>` over the same list, a mode
 * the run has no more (`--first`, `.corpus/spike-outline/first-pass.json` unless given) and, for
 * the samples, from item 13's report pinned to their hand counts (decision 0039).
 *
 *   --ids <file>    the corpus's documents a file names, one id a line, beside the samples
 *   --only <id>     that document alone, a sample or the corpus's, or those a comma separates
 *   --again         take a document again although its row is there
 *   --children <n>  how many children, 2 unless given: fewer than the corpus runners' four, since
 *                   the rows' times are what the import's time targets are set from
 *   --first <file>  the first pass's run, its `corpus run --committed-only`'s JSON
 *   --report        run nothing, and print the tables again from the rows there are
 *
 * The documents are real people's resumes, so what it prints and writes is ids and counts, never a
 * document's text, and every line goes through `printable`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import {
  CORPUS_DIR,
  type Family,
  FETCH_REPORT_FILE,
  FetchReport,
  isLive,
  type LiveDocument,
  MANIFEST_FILE,
  Manifest,
  matchingEntries,
  onlyIds,
  parseJson,
  printable,
  writeAtomically,
} from "./corpus-manifest.ts";
import { ORACLE_DIR, ORACLE_FILE, Oracle, oracleDocument } from "./corpus-oracle.ts";
import { runPool, treeFonts, uploadOf } from "./corpus-reference.ts";
import { idsOf, type RunFile } from "./corpus-run.ts";
import {
  documentTable,
  firstPassOf,
  importMs,
  type OutlineChildRow,
  type OutlineRow,
  percent,
  unitsTable,
  wordsTable,
} from "./spike-outline-table.ts";

/** Where each document's row goes, which holds ids and counts alone. */
export const OUTLINE_DIR = join(CORPUS_DIR, "spike-outline");

/** The first pass's run over the same documents, unless `--first` names another. */
const FIRST_PASS = join(OUTLINE_DIR, "first-pass.json");

/** The child, which Node runs in each process of the pool. */
const CHILD = fileURLToPath(new URL("./spike-outline-child.ts", import.meta.url));

/** The engine's manifest, whose tree the uploads take the fonts a document names from. */
const ENGINE_MANIFEST = fileURLToPath(new URL("../.engine/manifest.json", import.meta.url));

/** How long one document may take: the pipeline, the probe, check 1 and the units' trials. */
const LIMIT_MS = 900_000;

/** A document's row's file. */
const rowFile = (id: string) => join(OUTLINE_DIR, `${id}.json`);

/** An id as the corpus and the oracle name documents. */
const ID = /^[a-z]+(?:-[a-z]+)*-\d{4}$/;

/** Print lines as the terminal may be given them (`printable`). */
const print = (lines: string[]) => console.log(lines.map(printable).join("\n"));

/** A document to take: its id, family, whether it is an upstream sample, and its zip. */
interface Taken {
  id: string;
  family: Family;
  sample: boolean;
  zip: () => Uint8Array;
}

/** The oracle's upstream samples, from `.corpus/oracle/`, each only when every file is there. */
function samples(oracle: Oracle, treeFont: (name: string) => Uint8Array | undefined): Taken[] {
  return oracle.documents.flatMap((doc) => {
    const there = doc.files.every((file) =>
      existsSync(join(ORACLE_DIR, doc.id, ...file.path.split("/"))),
    );
    if (!there) {
      print([`${doc.id}: not in .corpus/oracle/; run \`corpus oracle\` once to fetch it`]);
      return [];
    }
    return [
      {
        id: doc.id,
        family: doc.family,
        sample: true,
        zip: () =>
          uploadOf(
            oracleDocument(doc),
            (path) => new Uint8Array(readFileSync(join(ORACLE_DIR, doc.id, ...path.split("/")))),
            treeFont,
          ),
      },
    ];
  });
}

/** The corpus's documents `ids` names, each of which the last fetch must have fetched. */
function corpusDocuments(
  ids: readonly string[],
  treeFont: (name: string) => Uint8Array | undefined,
): Taken[] {
  if (ids.length === 0) return [];
  const manifest = parseJson(Manifest, readFileSync(MANIFEST_FILE, "utf8"), MANIFEST_FILE);
  const report = existsSync(FETCH_REPORT_FILE)
    ? parseJson(FetchReport, readFileSync(FETCH_REPORT_FILE, "utf8"), FETCH_REPORT_FILE)
    : undefined;
  const entries = matchingEntries(manifest, report);
  const fetched = new Map<string, LiveDocument>(
    manifest.documents
      .filter(isLive)
      .filter((doc) => entries.get(doc.id)?.state === "fetched")
      .map((doc) => [doc.id, doc]),
  );
  const unknown = ids.filter((id) => !fetched.has(id));
  if (unknown.length > 0)
    throw new Error(`${unknown.join(", ")}: no document the last fetch fetched`);
  return ids.map((id) => {
    const doc = fetched.get(id) as LiveDocument;
    return {
      id,
      family: doc.family,
      sample: false,
      zip: () =>
        uploadOf(
          doc,
          (path) => new Uint8Array(readFileSync(join(CORPUS_DIR, doc.id, ...path.split("/")))),
          treeFont,
        ),
    };
  });
}

/** The rows there are, the corpus's documents by id and then the samples. */
function savedRows(): OutlineRow[] {
  if (!existsSync(OUTLINE_DIR)) return [];
  const rows = readdirSync(OUTLINE_DIR)
    .filter((name) => name.endsWith(".json") && ID.test(name.slice(0, -".json".length)))
    .map((name) => JSON.parse(readFileSync(join(OUTLINE_DIR, name), "utf8")) as OutlineRow)
    .filter((row) => row.version === 1);
  return rows.sort(
    (a, b) => Number(a.sample) - Number(b.sample) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** A row as a line of progress: counts only. */
function line(row: OutlineRow): string {
  if (row.outcome !== "measured")
    return `${row.outcome}${row.refused === undefined ? "" : ` (${row.refused})`}`;
  const words = row.words;
  const groups = row.groups;
  const compiles = row.compiles;
  return `${row.engine}, ${words === undefined ? "" : `${words.body} words: ${percent(words.fields, words.body)} in fields, ${percent(words.retype, words.body)} the retype reaches, ${percent(words.locked, words.body)} locked`}; ${groups?.found ?? 0} groups, copy ${groups?.copy ?? 0}, first ${groups?.first ?? 0}, last ${groups?.last ?? 0}; ${compiles === undefined ? 0 : compiles.probe + compiles.check1 + compiles.units} compiles, ${((importMs(row) ?? 0) / 1000).toFixed(1)} s`;
}

/** The tables, from the rows there are and the first pass's run. */
function report(first: string) {
  const run = existsSync(first) ? (JSON.parse(readFileSync(first, "utf8")) as RunFile) : undefined;
  if (run === undefined)
    print([`No first pass's run at ${first}: its column reads ? for the corpus's documents`]);
  const passes = firstPassOf(run);
  const rows = savedRows();
  print([
    "",
    ...documentTable(rows, passes).trimEnd().split("\n"),
    "",
    ...wordsTable(rows, passes).trimEnd().split("\n"),
    "",
    ...unitsTable(rows).trimEnd().split("\n"),
  ]);
}

async function main() {
  const { values } = parseArgs({
    options: {
      ids: { type: "string" },
      only: { type: "string" },
      again: { type: "boolean", default: false },
      children: { type: "string" },
      first: { type: "string" },
      report: { type: "boolean", default: false },
    },
    strict: true,
  });
  // Paths from where pnpm was run, as the corpus's commands take them.
  const from = (path: string) => resolve(process.env.INIT_CWD ?? process.cwd(), path);
  const first = values.first === undefined ? FIRST_PASS : from(values.first);
  if (values.report) return report(first);
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("the spike compiles on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const treeFont = treeFonts(engine.files);
  if (values.ids !== undefined && values.only !== undefined)
    throw new Error("--only and --ids each name the documents to take: pass one");
  // `--only` names every document it takes, a sample or the corpus's; otherwise the samples, and
  // the corpus's documents `--ids` names.
  const only = values.only === undefined ? undefined : new Set(onlyIds(values.only));
  const ids =
    only !== undefined
      ? [...only]
      : values.ids === undefined
        ? []
        : idsOf(readFileSync(from(values.ids), "utf8"));
  const children = values.children === undefined ? 2 : Number(values.children);
  if (!Number.isInteger(children) || children < 1 || children > 8)
    throw new Error("--children is a whole number from 1 to 8");
  const oracle = parseJson(Oracle, readFileSync(ORACLE_FILE, "utf8"), ORACLE_FILE);
  const sampleIds = new Set(oracle.documents.map((doc) => doc.id));
  const documents = [
    ...samples(oracle, treeFont).filter((doc) => only === undefined || only.has(doc.id)),
    ...corpusDocuments(
      ids.filter((id) => !sampleIds.has(id)),
      treeFont,
    ),
  ];
  const todo = documents.filter((doc) => values.again || !existsSync(rowFile(doc.id)));
  print([
    `${documents.length} documents, ${documents.length - todo.length} done already; ${todo.length} to take, ${children} at a time, ${LIMIT_MS / 1000} s each at most`,
  ]);
  const byId = new Map(todo.map((doc) => [doc.id, doc]));
  let ended = 0;
  await runPool({
    script: CHILD,
    size: children,
    limitMs: LIMIT_MS,
    tasks: todo.map((doc) => ({
      id: doc.id,
      message: () => ({ name: `${doc.id}.zip`, bytes: doc.zip() }),
    })),
    onResult: (task, result) => {
      const doc = byId.get(task.id);
      const reply = result.reply as { row?: OutlineChildRow } | undefined;
      const row: OutlineRow = {
        version: 1,
        id: task.id,
        family: doc?.family ?? "other",
        sample: doc?.sample ?? false,
        ...(reply?.row ?? { outcome: result.timedOut ? "timeout" : "crashed" }),
        wall: Math.round(result.wall),
      };
      writeAtomically(rowFile(task.id), `${JSON.stringify(row, null, 1)}\n`);
      print([`${++ended}/${todo.length} ${task.id}: ${line(row)}`]);
    },
  });
  report(first);
}

main().catch((error: unknown) => {
  console.error(printable(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
