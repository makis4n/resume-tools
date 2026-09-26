/**
 * The corpus of public LaTeX resumes the import pipeline is measured on (milestone 3 item 1,
 * decision 0017):
 *
 *   pnpm --filter @resume-tools/editor corpus collect
 *   pnpm --filter @resume-tools/editor corpus fetch [--only <id>]
 *   pnpm --filter @resume-tools/editor corpus survey [--json <file>] [--tree <file>]
 *   pnpm --filter @resume-tools/editor corpus reference [--only <id>] [--json <file>]
 *
 *   collect       build `corpus/manifest.json` from GitHub, or extend it: code search and the
 *                 upstream templates' forks give the candidates, public repositories only, and
 *                 the documents taken are appended under new ids, the ones already there kept as
 *                 they are but for those the last fetch found unavailable, which are withdrawn
 *                 (`scripts/corpus-collect.ts`). It needs a GitHub token, which it takes from
 *                 `gh auth token`, and takes 20 to 30 minutes, most of it waiting on code search's
 *                 10 requests a minute
 *   fetch         ask GitHub whether each document's repository is still there, download every
 *                 file the manifest names into `.corpus/<id>/<path>`, check each against its
 *                 SHA-256 and size, and write `.corpus/fetch-report.json`
 *                 (`scripts/corpus-fetch.ts`). A file already there with the right hash is kept.
 *                 It exits 1 when a file differs from its hash or cannot be downloaded; a document
 *                 whose repository is gone, private or blocked is reported unavailable. It needs a
 *                 token for GitHub's rate, one request for each document: the one `gh` has, or else
 *                 `GH_TOKEN` or `GITHUB_TOKEN` from the environment, as CI gives it
 *   --only <id>   fetch that document only
 *   survey        read every document the last fetch marks fetched, and the tree's file list in
 *                 `.engine/manifest.json`, and print one Markdown table of what the documents ask
 *                 of the engine: classes, packages, engines, fonts, and what the tree lacks
 *                 (`scripts/corpus-survey.ts`, decision 0018). It needs `.engine/`, which
 *                 `fetch-engine` builds
 *   --json <file> write each document's row as JSON too, from where pnpm was run
 *   --tree <file> check the documents against another engine manifest's file list, such as a
 *                 checkout's of an older layout, from where pnpm was run, in place of `.engine/`'s
 *   reference     take every document the last fetch marks fetched in as a zip of its files, and
 *                 compile it to the import pipeline's reference, or refuse it, on the engine in
 *                 `.engine/`, in a pool of four child processes with 90 s a document; print one
 *                 table of what became of them and, under it, every name a refusal gave with how
 *                 many documents gave it; and keep each document's log under `.corpus/reference/`
 *                 (`scripts/corpus-reference.ts`, decision 0019). It takes about a minute for the
 *                 corpus
 *   --only <id>   that document only
 *   --json <file> write each document's row as JSON too, names and numbers only, with every name
 *                 a refusal gave and its count, in place of the list under the table
 *
 * The documents are real people's resumes, so `.corpus/` is ignored by git, and the commands print
 * counts, repository names, paths, hashes and sizes, never a document's text, and every line they
 * print goes through `printable`, so that a file's name cannot put an escape to the terminal.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
// Node runs this file by stripping its types, so the type import needs its real extension.
import type { EngineManifest } from "../src/engine/manifest.ts";
import { fileKey, readTree } from "../src/import/fonts.ts";
import { collect, REASONS, type Reason } from "./corpus-collect.ts";
import { fetchCorpus } from "./corpus-fetch.ts";
import { environmentToken, GitHub } from "./corpus-github.ts";
import {
  CORPUS_DIR,
  FAMILIES,
  FETCH_REPORT_FILE,
  FetchReport,
  formatJson,
  isLive,
  MANIFEST_FILE,
  Manifest,
  matchingEntries,
  parseJson,
  printable,
  writeAtomically,
} from "./corpus-manifest.ts";
import {
  type ChildRow,
  LIMIT_MS,
  POOL_SIZE,
  type ReferenceRow,
  referenceNameLines,
  referenceNames,
  referenceTable,
  runPool,
  uploadOf,
} from "./corpus-reference.ts";
import { surveyCorpus, surveyTable } from "./corpus-survey.ts";

const USAGE =
  "pnpm --filter @resume-tools/editor corpus collect | fetch [--only <id>] | survey [--json <file>] [--tree <file>] | reference [--only <id>] [--json <file>]";

/** The engine's manifest, whose file list is the tree the survey checks documents against. */
const ENGINE_MANIFEST = fileURLToPath(new URL("../.engine/manifest.json", import.meta.url));

/** The engine's tree, whose files the reference runner puts in a zip for the fonts it names. */
const ENGINE_FILES = fileURLToPath(new URL("../.engine/files", import.meta.url));

/** The reference runner's child, which Node runs in each process of its pool. */
const REFERENCE_CHILD = fileURLToPath(new URL("./corpus-reference-child.ts", import.meta.url));

/** Where the reference runner keeps each document's log, which quotes its source. */
const REFERENCE_LOGS = join(CORPUS_DIR, "reference");

/** The corpus holds at least this many documents, and at least this many of them are `other`. */
const MIN_DOCUMENTS = 200;
const MIN_OTHER = 60;

/**
 * The token for GitHub's API: the one `gh` holds, or failing that `GH_TOKEN` or `GITHUB_TOKEN`
 * from the environment, as CI gives one; none when there is none. It is never printed.
 */
const githubToken = () => ghToken() ?? environmentToken(process.env);

/** The token `gh` holds, or none when gh is missing or logged out. It is never printed. */
function ghToken(): string | undefined {
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return token === "" ? undefined : token;
  } catch {
    return undefined;
  }
}

const readManifest = () => parseJson(Manifest, readFileSync(MANIFEST_FILE, "utf8"), MANIFEST_FILE);

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

/** Print lines as the terminal may be given them (`printable`). */
const print = (lines: string[]) => console.log(lines.map(printable).join("\n"));

/** Counts as "a 3, b 2", the largest first. */
function tally(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .map(([value, count]) => `${value} ${count}`)
    .join(", ");
}

async function runCollect() {
  const token = githubToken();
  if (!token)
    throw new Error(
      "collect searches GitHub's code, which needs a token: run `gh auth login`, or set GH_TOKEN",
    );
  const manifest = existsSync(MANIFEST_FILE) ? readManifest() : undefined;
  const report = existsSync(FETCH_REPORT_FILE)
    ? parseJson(FetchReport, readFileSync(FETCH_REPORT_FILE, "utf8"), FETCH_REPORT_FILE)
    : undefined;
  // The manifest is written only as its schema takes it; collect never hands it one it refuses.
  const save = (next: Manifest) => writeAtomically(MANIFEST_FILE, formatJson(Manifest.parse(next)));
  const result = await collect({
    github: new GitHub({ token, log: console.log }),
    log: console.log,
    today: new Date().toISOString().slice(0, 10),
    manifest,
    report,
    save,
  });
  save(result.manifest);

  const documents = result.manifest.documents.filter(isLive);
  const withdrawn = result.manifest.documents.length - documents.length;
  const files = documents.flatMap((doc) => doc.files);
  const family = (name: string) => documents.filter((doc) => doc.family === name).length;
  const rejected = Object.entries(result.rejected) as [Reason, number][];
  print([
    "",
    `${documents.length} documents, ${result.added.length} of them added now: ${FAMILIES.map((name) => `${name} ${family(name)}`).join(", ")}`,
    `Withdrawn: ${withdrawn}, ${result.withdrawn.length} of them now`,
    `Licences: ${tally(documents.map((doc) => doc.license ?? "none"))}`,
    `Files: ${files.length}, ${megabytes(files.reduce((sum, file) => sum + file.bytes, 0))}; fonts named: ${documents.reduce((sum, doc) => sum + doc.assets.length, 0)}; images counted: ${documents.reduce((sum, doc) => sum + doc.images, 0)}`,
    `Candidates: ${result.candidates.search} repositories from code search, ${result.candidates.forks} forks; ${result.hidden} ${result.hidden === 1 ? "file" : "files"} code search found in repositories that are not public left out`,
    `Not taken: ${rejected.reduce((sum, [, count]) => sum + count, 0)} rejected, ${result.full} with their family full, ${result.left} not considered once every family was full`,
    ...rejected
      .sort(([, a], [, b]) => b - a)
      .map(([reason, count]) => `  ${count} ${REASONS[reason]}`),
    ...Object.entries(result.short).map(
      ([name, count]) => `${name} is ${count} short of its cap: there are not enough candidates`,
    ),
  ]);
  if (documents.length < MIN_DOCUMENTS || family("other") < MIN_OTHER) {
    console.error(
      `The corpus needs ${MIN_DOCUMENTS} documents, ${MIN_OTHER} of them other; add queries and collect again`,
    );
    process.exitCode = 1;
  }
}

async function runFetch(only: string | undefined) {
  const result = await fetchCorpus({
    github: new GitHub({ token: githubToken(), log: console.log }),
    manifest: readManifest(),
    dir: CORPUS_DIR,
    only,
    log: console.log,
  });
  const { states } = result;
  print([
    `${result.documents} ${result.documents === 1 ? "document" : "documents"}: ${states.fetched} fetched, ${states.unavailable} unavailable, ${states.mismatch} with a file that differs from its hash, ${states.failed} failed; ${result.checked} ${result.checked === 1 ? "repository" : "repositories"} checked; ${result.files} ${result.files === 1 ? "file" : "files"}, ${megabytes(result.bytes)}, ${result.downloaded} of them downloaded now${result.withdrawn > 0 ? `; ${result.withdrawn} withdrawn, not fetched` : ""}`,
  ]);
  if (states.mismatch > 0 || states.failed > 0) {
    console.error(
      "A file differs from the manifest's hash or could not be downloaded; nothing of it was written",
    );
    process.exitCode = 1;
  }
}

function runSurvey(json: string | undefined, tree: string | undefined) {
  if (tree === undefined && !existsSync(ENGINE_MANIFEST))
    throw new Error(
      "survey checks documents against the tree's file list in .engine/manifest.json: run fetch-engine first",
    );
  const engine = JSON.parse(readFileSync(tree ?? ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const manifest = readManifest();
  const report = existsSync(FETCH_REPORT_FILE)
    ? parseJson(FetchReport, readFileSync(FETCH_REPORT_FILE, "utf8"), FETCH_REPORT_FILE)
    : undefined;
  const survey = surveyCorpus({
    manifest,
    report,
    tree: readTree(engine.files),
    read: (doc, file) => {
      try {
        return readFileSync(join(CORPUS_DIR, doc.id, ...file.path.split("/")));
      } catch {
        return undefined;
      }
    },
  });
  print(surveyTable(survey).trimEnd().split("\n"));
  if (json !== undefined)
    writeAtomically(
      json,
      formatJson({
        version: 1,
        tree: { layout: engine.layout, files: Object.keys(engine.files).length },
        skipped: survey.skipped,
        documents: survey.documents,
      }),
    );
  if (survey.documents.length === 0) {
    console.error("No document is fetched: run `corpus fetch` first");
    process.exitCode = 1;
  }
}

/**
 * The tree's font files by name, without the extension, in lower case: OpenType and TrueType for
 * a font the manifest names as either, and Type 1 for one it names as `.pfb`.
 */
function treeFonts(files: Readonly<Record<string, number>>) {
  const found = new Map<string, string>();
  for (const path of Object.keys(files)) {
    const kind = /\/fonts\/(?:opentype|truetype)\/.*\.(?:otf|ttf)$/i.test(path)
      ? "outline"
      : /\/fonts\/type1\/.*\.pfb$/i.test(path)
        ? "pfb"
        : undefined;
    const key = kind && `${kind}:${fileKey(path)}`;
    if (key && !found.has(key)) found.set(key, path);
  }
  return (name: string) => {
    const kind = /\.pfb$/i.test(name) ? "pfb" : "outline";
    const path = found.get(`${kind}:${fileKey(name)}`);
    return path === undefined ? undefined : new Uint8Array(readFileSync(join(ENGINE_FILES, path)));
  };
}

async function runReference(only: string | undefined, json: string | undefined) {
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("reference compiles on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const manifest = readManifest();
  const report = existsSync(FETCH_REPORT_FILE)
    ? parseJson(FetchReport, readFileSync(FETCH_REPORT_FILE, "utf8"), FETCH_REPORT_FILE)
    : undefined;
  const entries = matchingEntries(manifest, report);
  const fetched = manifest.documents
    .filter(isLive)
    .filter((doc) => entries.get(doc.id)?.state === "fetched");
  const documents = only === undefined ? fetched : fetched.filter((doc) => doc.id === only);
  if (documents.length === 0)
    throw new Error(
      only === undefined
        ? "No document is fetched: run `corpus fetch` first"
        : `${only} is no document the last fetch fetched`,
    );
  const treeFont = treeFonts(engine.files);
  const tasks = documents.map((doc) => ({
    id: doc.id,
    message: () => ({
      name: `${doc.id}.zip`,
      bytes: uploadOf(
        doc,
        (path) => new Uint8Array(readFileSync(join(CORPUS_DIR, doc.id, ...path.split("/")))),
        treeFont,
      ),
    }),
  }));
  const families = new Map(documents.map((doc) => [doc.id, doc.family]));
  const rows: ReferenceRow[] = [];
  const started = performance.now();
  print([
    `${documents.length} ${documents.length === 1 ? "document" : "documents"}, ${POOL_SIZE} at a time, ${LIMIT_MS / 1000} s each at most`,
  ]);
  await runPool({
    script: REFERENCE_CHILD,
    tasks,
    onResult: (task, result) => {
      const reply = result.reply as { row: ChildRow; log?: string } | undefined;
      const row: ReferenceRow = {
        id: task.id,
        family: families.get(task.id) ?? "other",
        ...(reply?.row ??
          (result.timedOut
            ? { outcome: "timeout" }
            : { outcome: "stopped", stopped: "its child process died" })),
        wall: Math.round(result.wall),
      };
      rows.push(row);
      if (reply?.log !== undefined)
        writeAtomically(join(REFERENCE_LOGS, `${task.id}.log`), reply.log);
      const what =
        row.outcome === "reference"
          ? `reference, ${row.engine}, ${row.pages} ${row.pages === 1 ? "page" : "pages"}, ${row.ms} ms`
          : `refused: ${row.outcome}${row.name === undefined ? "" : ` (${row.name})`}${row.stopped === undefined ? "" : `, ${row.stopped}`}`;
      print([`${rows.length}/${documents.length} ${task.id}: ${what}`]);
    },
  });
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const minutes = (performance.now() - started) / 60_000;
  print(["", ...referenceTable(rows).trimEnd().split("\n")]);
  // The table lists the names most documents give; all of them go under it, or in the JSON.
  if (json === undefined) print(["", ...referenceNameLines(rows)]);
  print(["", `Took ${minutes.toFixed(1)} min.`]);
  if (json !== undefined)
    writeAtomically(
      json,
      formatJson({
        version: 1,
        tree: { layout: engine.layout, files: Object.keys(engine.files).length },
        limitMs: LIMIT_MS,
        names: referenceNames(rows),
        documents: rows,
      }),
    );
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      only: { type: "string" },
      json: { type: "string" },
      tree: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const [command, ...rest] = positionals;
  if (rest.length > 0) throw new Error(`${rest.join(" ")} is not an option: ${USAGE}`);
  if (
    command !== "collect" &&
    command !== "fetch" &&
    command !== "survey" &&
    command !== "reference"
  )
    throw new Error(command === undefined ? USAGE : `there is no command ${command}: ${USAGE}`);
  if (values.only !== undefined && command !== "fetch" && command !== "reference")
    throw new Error("--only goes with fetch or reference");
  if (values.json !== undefined && command !== "survey" && command !== "reference")
    throw new Error("--json goes with survey or reference");
  if (values.tree !== undefined && command !== "survey") throw new Error("--tree goes with survey");
  if (command === "fetch") return runFetch(values.only);
  if (command === "collect") return runCollect();
  // pnpm runs the script in the editor's folder; a path is the caller's, from where pnpm was run.
  const caller = (path: string | undefined) =>
    path === undefined ? undefined : resolve(process.env.INIT_CWD ?? ".", path);
  if (command === "reference") return runReference(values.only, caller(values.json));
  return runSurvey(caller(values.json), caller(values.tree));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.split("\n").map(printable).join("\n"));
  process.exitCode = 1;
});
