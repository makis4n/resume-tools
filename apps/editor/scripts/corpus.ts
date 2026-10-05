/**
 * The corpus of public LaTeX resumes the import pipeline is measured on (milestone 3 item 1,
 * decision 0017):
 *
 *   pnpm --filter @resume-tools/editor corpus collect
 *   pnpm --filter @resume-tools/editor corpus fetch [--only <id>]
 *   pnpm --filter @resume-tools/editor corpus survey [--json <file>] [--tree <file>]
 *   pnpm --filter @resume-tools/editor corpus reference [--only <id>] [--json <file>]
 *   pnpm --filter @resume-tools/editor corpus parse [--only <id>] [--json <file>]
 *   pnpm --filter @resume-tools/editor corpus probe [--only <id>] [--json <file>]
 *   pnpm --filter @resume-tools/editor corpus oracle
 *   pnpm --filter @resume-tools/editor corpus fonts [--only <id>] [--json <file>]
 *   pnpm --filter @resume-tools/editor corpus run [--only <id>] [--ids <file>] [--json <file>]
 *                 [--write-baseline]
 *   pnpm --filter @resume-tools/editor corpus compare <run.json> <run.json> [<run.json>...]
 *   pnpm --filter @resume-tools/editor corpus checks --only <id>
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
 *   --tree <file> check the documents against another engine manifest's file list and table of
 *                 fonts, such as another checkout's, of layout 7 or later, from where pnpm was
 *                 run, in place of `.engine/`'s
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
 *   parse         take every document that compiles to a reference, ask the engine for the
 *                 signatures of what its body uses, parse its body into a tree, print the tree back,
 *                 and compile the printed body with the document's own preamble as the reference
 *                 was compiled, in the same pool; print one table of what became of them, and keep
 *                 under `.corpus/parse/` the printed document and its log for each round trip that
 *                 did not set the reference's glyphs (`scripts/corpus-parse.ts`, decision 0020)
 *   --only <id>   that document only
 *   --json <file> write each document's row as JSON too, macros' names and numbers only
 *   probe         take every document whose body parses, and probe which of its macros' arguments
 *                 and standard nodes the editor may mark (`src/import/probe.ts`), in the same
 *                 pool, 600 s a document; print one table of what it found, per family and in all,
 *                 names of macros and counts only, and keep each document's whole probe under
 *                 `.corpus/probe/` (`scripts/corpus-probe.ts`, decision 0022). It takes several
 *                 minutes, a XeTeX document's compiles being whole
 *   --only <id>   that document only
 *   --json <file> write each document's row as JSON too, macros' names and numbers only
 *   oracle        fetch the three launch templates' upstream samples that `corpus/oracle.json`
 *                 names into `.corpus/oracle/`, as `fetch` fetches a document, probe each, and print
 *                 the verdicts the oracle expects against those found, and how many disagree
 *                 (`scripts/corpus-oracle.ts`). It exits 1 when the samples cannot be fetched
 *   fonts         take every XeTeX document that compiles to a reference, and every pdfTeX one that
 *                 guards on the engine and loads a font package that loads fontspec on XeTeX, on
 *                 XeTeX, and rewrite its fonts by file, check the rewrite against the reference,
 *                 dump its preamble and compile its body from the format, in the same pool; print
 *                 one table of what became of them; and keep each document's logs under
 *                 `.corpus/fonts/` (`scripts/corpus-fonts.ts`, decision 0023). It takes a few minutes
 *   --only <id>   that document only
 *   --json <file> write each document's row as JSON too, names and numbers only
 *   run           take every fetched document through the import a person's browser runs
 *                 (`importResume`), in one mode: no answer is read and no model is asked, since a
 *                 `.tex` import names nothing (decision 0049); print each document's outcome,
 *                 success, partial, refused or where it stopped, its words in the report's three
 *                 shares, editable in place, through the retype and locked, its fields and its
 *                 groups, and one table per family and in all, with a headline of the shares and
 *                 the locked words by reason, names and counts only; keep each document's row,
 *                 counts only, under `.corpus/import-run/` (`scripts/corpus-import.ts`, the second
 *                 pass's item 6). A run over the whole corpus is held to `corpus/baseline.json`,
 *                 and exits 1 when its success rate falls more than a point under the baseline's
 *   --only <id>   that document only, or the documents a comma separates
 *   --ids <file>  the documents a file names, one id a line, from where pnpm was run
 *   --json <file> write each document's row as JSON too, ids and counts only, with the summary
 *   --write-baseline  write `corpus/baseline.json` from a run over the whole corpus, with the day
 *                 and the commit, as a pull request raises it by hand; never over a baseline the
 *                 run falls more than a point under, which a person lowers by editing the file
 *   --from <run.json> with --write-baseline, run nothing, and write the baseline from a finished
 *                 run's JSON over the whole corpus, as CI's run leaves it
 *                 The run takes as many children as the machine has cores, four at most; it writes
 *                 its JSON after each document, and on SIGINT or SIGTERM, as a CI step's time
 *                 running out sends, it stops, prints its table and writes its JSON for what it did,
 *                 and exits 1. A document that timed out counts in no success rate
 *   compare       say whether runs' JSON agree, times aside, each with the next, and where they do
 *                 not; it exits 1 when they differ
 *   checks        take the documents --only names, fetched ones or the oracle's samples, through
 *                 the import a browser runs, and again up to the checks, and say why the checks
 *                 refuse one: whether the model holds its outline with its fields and with every
 *                 field kept, and where not, why; and how the outline with every field kept
 *                 compiles, as the checks compile it and five other ways
 *                 (`scripts/corpus-checks.ts`, the follow-up to decision 0060). It prints ids,
 *                 reasons, steps, counts, command
 *                 and environment names, line numbers and kinds of error, never a word of a
 *                 document, and writes nothing
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
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import { readTree } from "../src/import/fonts.ts";
import { type ChecksRow, checksLines } from "./corpus-checks.ts";
import { collect, REASONS, type Reason } from "./corpus-collect.ts";
import { fetchCorpus } from "./corpus-fetch.ts";
import { type FontsChildRow, type FontsRow, fontsTable } from "./corpus-fonts.ts";
import { environmentToken, GitHub } from "./corpus-github.ts";
import {
  IMPORT_LIMIT_MS,
  type ImportChildRow,
  type ImportFile,
  type ImportRow,
  importHeadline,
  importLine,
  importSummary,
  importTable,
} from "./corpus-import.ts";
import {
  CORPUS_DIR,
  FAMILIES,
  FETCH_REPORT_FILE,
  FetchReport,
  formatJson,
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
import type { OracleDocument } from "./corpus-oracle.ts";
import {
  compare,
  ORACLE_DIR,
  ORACLE_FILE,
  Oracle,
  oracleDocument,
  oracleManifest,
  oracleTable,
} from "./corpus-oracle.ts";
import { type ParseChildRow, type ParseRow, parseNames, parseTable } from "./corpus-parse.ts";
import { pieceTables } from "./corpus-pieces.ts";
import {
  PROBE_LIMIT_MS,
  type ProbeChildRow,
  type ProbeRow,
  probeNames,
  probeTable,
} from "./corpus-probe.ts";
import {
  type ChildRow,
  LIMIT_MS,
  POOL_SIZE,
  type ReferenceRow,
  referenceNameLines,
  referenceNames,
  referenceTable,
  runPool,
  treeFonts,
  uploadOf,
} from "./corpus-reference.ts";
import {
  Baseline,
  baselineFromFile,
  baselineVerdict,
  changedPaths,
  commitOf,
  idsOf,
  nextBaseline,
  poolSize,
  runComparison,
} from "./corpus-run.ts";
import { surveyCorpus, surveyTable } from "./corpus-survey.ts";

const USAGE =
  "pnpm --filter @resume-tools/editor corpus collect | fetch [--only <id>] | survey [--json <file>] [--tree <file>] | reference [--only <id>] [--json <file>] | parse [--only <id>] [--json <file>] | probe [--only <id>] [--json <file>] | oracle | fonts [--only <id>] [--json <file>] | run [--only <id>] [--ids <file>] [--json <file>] [--write-baseline] | run --write-baseline --from <run.json> | compare <run.json> <run.json> [<run.json>...] | checks --only <id>";

/** The editor's folder, where git is asked for the commit a run is of. */
const APP = fileURLToPath(new URL("..", import.meta.url));

/** The baseline a run over the whole corpus is held to. */
const BASELINE_FILE = fileURLToPath(new URL("../corpus/baseline.json", import.meta.url));

/** The engine's manifest, whose file list is the tree the survey checks documents against. */
const ENGINE_MANIFEST = fileURLToPath(new URL("../.engine/manifest.json", import.meta.url));

/** The reference runner's child, which Node runs in each process of its pool. */
const REFERENCE_CHILD = fileURLToPath(new URL("./corpus-reference-child.ts", import.meta.url));

/** Where the reference runner keeps each document's log, which quotes its source. */
const REFERENCE_LOGS = join(CORPUS_DIR, "reference");

/** The parse runner's child, which Node runs in each process of its pool. */
const PARSE_CHILD = fileURLToPath(new URL("./corpus-parse-child.ts", import.meta.url));

/**
 * Where the parse runner keeps, for a round trip that did not set the reference's glyphs, the
 * printed document and its log, which quote the source.
 */
const PARSE_KEPT = join(CORPUS_DIR, "parse");

/** The probe runner's child, which Node runs in each process of its pool, and the oracle's. */
const PROBE_CHILD = fileURLToPath(new URL("./corpus-probe-child.ts", import.meta.url));

/** Where the probe runner keeps each document's whole probe, which holds its text. */
const PROBE_KEPT = join(CORPUS_DIR, "probe");

/** The fonts runner's child, which Node runs in each process of its pool. */
const FONTS_CHILD = fileURLToPath(new URL("./corpus-fonts-child.ts", import.meta.url));

/** Where the fonts runner keeps each document's logs, which quote its source. */
const FONTS_LOGS = join(CORPUS_DIR, "fonts");

/** The checks' diagnostic's child, which says why the checks refuse a document. */
const CHECKS_CHILD = fileURLToPath(new URL("./corpus-checks-child.ts", import.meta.url));

/** The run's child, which takes each document through the import a browser runs. */
const IMPORT_CHILD = fileURLToPath(new URL("./corpus-import-child.ts", import.meta.url));

/** Where the run keeps each document's row, counts only: a folder of its own. */
const IMPORT_KEPT = join(CORPUS_DIR, "import-run");

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

/** A count and its noun, in the plural where it takes one. */
const counted = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`;

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
  // The survey names a document's fonts from the manifest's table of the tree's, which a manifest
  // written before layout 7 has not (decision 0023).
  if (typeof engine.fonts !== "object" || engine.fonts === null)
    throw new Error(
      tree === undefined
        ? "the engine's manifest in .engine/ has no table of the tree's fonts: run fetch-engine again"
        : `the engine manifest --tree names is layout ${engine.layout}, which has no table of the tree's fonts: the survey takes layout 7 or later`,
    );
  const manifest = readManifest();
  const report = existsSync(FETCH_REPORT_FILE)
    ? parseJson(FetchReport, readFileSync(FETCH_REPORT_FILE, "utf8"), FETCH_REPORT_FILE)
    : undefined;
  const survey = surveyCorpus({
    manifest,
    report,
    tree: readTree(engine.files, engine.fonts),
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
 * The fetched documents, or those `--only` names, one id or several a comma separates, as the
 * reference, parse, probe, fonts, assemble and leak runners take them.
 */
function fetchedDocuments(only: string | undefined) {
  const manifest = readManifest();
  const report = existsSync(FETCH_REPORT_FILE)
    ? parseJson(FetchReport, readFileSync(FETCH_REPORT_FILE, "utf8"), FETCH_REPORT_FILE)
    : undefined;
  const entries = matchingEntries(manifest, report);
  const fetched = manifest.documents
    .filter(isLive)
    .filter((doc) => entries.get(doc.id)?.state === "fetched");
  if (only === undefined) {
    if (fetched.length === 0) throw new Error("No document is fetched: run `corpus fetch` first");
    return fetched;
  }
  const wanted = new Set(onlyIds(only));
  if (wanted.size === 0) throw new Error("--only names no document");
  const documents = fetched.filter((doc) => wanted.has(doc.id));
  const missing = [...wanted].filter((id) => !documents.some((doc) => doc.id === id));
  if (missing.length > 0)
    throw new Error(
      `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} no document the last fetch fetched`,
    );
  return documents;
}

async function runReference(only: string | undefined, json: string | undefined) {
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("reference compiles on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const documents = fetchedDocuments(only);
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

async function runParse(only: string | undefined, json: string | undefined) {
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("parse compiles on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const documents = fetchedDocuments(only);
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
  const rows: ParseRow[] = [];
  const started = performance.now();
  print([
    `${documents.length} ${documents.length === 1 ? "document" : "documents"}, ${POOL_SIZE} at a time, ${LIMIT_MS / 1000} s each at most`,
  ]);
  await runPool({
    script: PARSE_CHILD,
    tasks,
    onResult: (task, result) => {
      const reply = result.reply as
        | { row: ParseChildRow; document?: string; log?: string }
        | undefined;
      const row: ParseRow = {
        id: task.id,
        family: families.get(task.id) ?? "other",
        ...(reply?.row ?? { outcome: result.timedOut ? "timeout" : "crashed" }),
        wall: Math.round(result.wall),
      };
      rows.push(row);
      if (reply?.document !== undefined)
        writeAtomically(join(PARSE_KEPT, `${task.id}.tex`), reply.document);
      if (reply?.log !== undefined) writeAtomically(join(PARSE_KEPT, `${task.id}.log`), reply.log);
      const what =
        row.outcome === "parsed"
          ? `${row.engine}, ${row.roundTrip}${row.difference === undefined ? "" : ` (${row.difference})`}${row.printed ? "" : ", printed differently"}, parse ${row.parseMs} ms`
          : `${row.outcome}${row.refused === undefined ? "" : ` (${row.refused})`}`;
      print([`${rows.length}/${documents.length} ${task.id}: ${what}`]);
    },
  });
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const minutes = (performance.now() - started) / 60_000;
  print(["", ...parseTable(rows).trimEnd().split("\n")]);
  print(["", `Took ${minutes.toFixed(1)} min.`]);
  if (json !== undefined)
    writeAtomically(
      json,
      formatJson({
        version: 1,
        tree: { layout: engine.layout, files: Object.keys(engine.files).length },
        limitMs: LIMIT_MS,
        names: parseNames(rows),
        documents: rows,
      }),
    );
}

/** A probe's row, and its whole probe kept under `dir`, from a child's reply or its fate. */
function probeRowOf(
  task: { id: string },
  family: ProbeRow["family"],
  result: { reply?: unknown; timedOut?: boolean; wall: number },
  dir: string,
): ProbeRow {
  const reply = result.reply as { row: ProbeChildRow; detail?: unknown } | undefined;
  if (reply?.detail !== undefined)
    writeAtomically(join(dir, `${task.id}.json`), `${JSON.stringify(reply.detail, null, 1)}\n`);
  return {
    id: task.id,
    family,
    ...(reply?.row ?? { outcome: result.timedOut ? "timeout" : "crashed" }),
    wall: Math.round(result.wall),
  };
}

/** A probe's row as a line of progress: numbers only. */
function probeLine(row: ProbeRow): string {
  if (row.outcome !== "probed")
    return `${row.outcome}${row.baseline === undefined ? "" : ` (${row.baseline})`}`;
  const all = Object.values(row.candidates ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
  return `${row.engine}, ${row.path}${row.fallback === undefined ? "" : ` (${row.fallback})`}, ${row.compiles} compiles, ${row.candidates?.editable ?? 0} of ${all} candidates editable, ${row.probeMs} ms`;
}

async function runProbe(only: string | undefined, json: string | undefined) {
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("probe compiles on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const documents = fetchedDocuments(only);
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
  const rows: ProbeRow[] = [];
  const started = performance.now();
  print([
    `${documents.length} ${documents.length === 1 ? "document" : "documents"}, ${POOL_SIZE} at a time, ${PROBE_LIMIT_MS / 1000} s each at most`,
  ]);
  await runPool({
    script: PROBE_CHILD,
    tasks,
    limitMs: PROBE_LIMIT_MS,
    onResult: (task, result) => {
      const row = probeRowOf(task, families.get(task.id) ?? "other", result, PROBE_KEPT);
      rows.push(row);
      print([`${rows.length}/${documents.length} ${task.id}: ${probeLine(row)}`]);
    },
  });
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const minutes = (performance.now() - started) / 60_000;
  print(["", ...probeTable(rows).trimEnd().split("\n")]);
  print(["", `Took ${minutes.toFixed(1)} min.`]);
  if (json !== undefined)
    writeAtomically(
      json,
      formatJson({
        version: 1,
        tree: { layout: engine.layout, files: Object.keys(engine.files).length },
        limitMs: PROBE_LIMIT_MS,
        names: probeNames(rows),
        documents: rows,
      }),
    );
}

/**
 * The oracle, its samples fetched into `.corpus/oracle/` and checked; or undefined, the exit code
 * set and why said, when they could not be fetched as it names them.
 */
async function fetchOracle(): Promise<Oracle | undefined> {
  const oracle = parseJson(Oracle, readFileSync(ORACLE_FILE, "utf8"), ORACLE_FILE);
  const fetched = await fetchCorpus({
    github: new GitHub({ token: githubToken(), log: console.log }),
    manifest: oracleManifest(oracle, new Date().toISOString().slice(0, 10)),
    dir: ORACLE_DIR,
    log: console.log,
  });
  if (fetched.states.fetched < oracle.documents.length) {
    const offline = fetched.problems.some((problem) => problem.state === "failed");
    console.error(
      [
        offline
          ? "The oracle's samples could not be fetched: GitHub could not be reached, so this machine may have no network"
          : "The oracle's samples could not be fetched as corpus/oracle.json names them",
        ...fetched.problems.map(
          (problem) =>
            `  ${problem.id}${problem.path === undefined ? "" : ` ${problem.path}`}: ${problem.message}`,
        ),
      ]
        .map(printable)
        .join("\n"),
    );
    process.exitCode = 1;
    return undefined;
  }
  return oracle;
}

/** An oracle sample's zip, as a person would upload it, from `.corpus/oracle/`. */
function sampleUpload(doc: OracleDocument, treeFont: (name: string) => Uint8Array | undefined) {
  return uploadOf(
    oracleDocument(doc),
    (path) => new Uint8Array(readFileSync(join(ORACLE_DIR, doc.id, ...path.split("/")))),
    treeFont,
  );
}

async function runOracle() {
  const oracle = await fetchOracle();
  if (oracle === undefined) return;
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("oracle compiles on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const treeFont = treeFonts(engine.files);
  const tasks = oracle.documents.map((doc) => ({
    id: doc.id,
    message: () => ({ name: `${doc.id}.zip`, bytes: sampleUpload(doc, treeFont) }),
  }));
  const rows = new Map<string, ProbeRow>();
  await runPool({
    script: PROBE_CHILD,
    tasks,
    limitMs: PROBE_LIMIT_MS,
    onResult: (task, result) => {
      const family = oracle.documents.find((doc) => doc.id === task.id)?.family ?? "other";
      const row = probeRowOf(task, family, result, join(ORACLE_DIR, "probe"));
      rows.set(task.id, row);
      print([`${task.id}: ${probeLine(row)}`]);
    },
  });
  const lines = oracle.documents.flatMap((doc) => compare(doc, rows.get(doc.id)));
  print(["", ...oracleTable(lines).trimEnd().split("\n")]);
}

async function runFonts(only: string | undefined, json: string | undefined) {
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("fonts compiles on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const documents = fetchedDocuments(only);
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
  const rows: FontsRow[] = [];
  const started = performance.now();
  print([
    `${documents.length} ${documents.length === 1 ? "document" : "documents"}, ${POOL_SIZE} at a time, ${LIMIT_MS / 1000} s each at most`,
  ]);
  let seen = 0;
  await runPool({
    script: FONTS_CHILD,
    tasks,
    onResult: (task, result) => {
      seen++;
      const reply = result.reply as
        | { row?: FontsChildRow; logs?: Record<string, string> }
        | undefined;
      // A child that timed out or died did not say whether it took the document: its row is
      // counted as that alone (`FontsRow.taken`).
      const row: FontsChildRow | undefined =
        reply?.row ??
        (result.timedOut
          ? { outcome: "timeout" }
          : reply === undefined
            ? { outcome: "crashed" }
            : undefined);
      for (const [kind, log] of Object.entries(reply?.logs ?? {}))
        if (log !== "") writeAtomically(join(FONTS_LOGS, `${task.id}.${kind}.log`), log);
      if (row === undefined) return;
      const full: FontsRow = {
        id: task.id,
        family: families.get(task.id) ?? "other",
        ...row,
        wall: Math.round(result.wall),
      };
      rows.push(full);
      print([
        `${seen}/${documents.length} ${task.id}: ${full.taken === undefined ? "" : `${full.taken}, `}${full.outcome}${full.name === undefined ? "" : ` (${full.name})`}`,
      ]);
    },
  });
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const minutes = (performance.now() - started) / 60_000;
  print(["", ...fontsTable(rows).trimEnd().split("\n"), "", `Took ${minutes.toFixed(1)} min.`]);
  if (json !== undefined)
    writeAtomically(
      json,
      formatJson({
        version: 1,
        tree: { layout: engine.layout, files: Object.keys(engine.files).length },
        limitMs: LIMIT_MS,
        documents: rows,
      }),
    );
}

/** The baseline, which must parse whatever the run; the placeholder's run is null. */
const readBaseline = () => parseJson(Baseline, readFileSync(BASELINE_FILE, "utf8"), BASELINE_FILE);

/**
 * The commit this checkout is at, and the paths that differ from it, the baseline's aside: a tracked
 * file changed, or a file git does not track (`changedPaths`).
 */
function checkout(): { commit: string; changed: string[] } {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: APP, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const commit = git("rev-parse", "HEAD").trim();
  return { commit, changed: changedPaths(git("status", "--porcelain")) };
}

/** A document's zip, as a person would upload it, from `.corpus/`. */
function corpusUpload(doc: LiveDocument, treeFont: (name: string) => Uint8Array | undefined) {
  return uploadOf(
    doc,
    (path) => new Uint8Array(readFileSync(join(CORPUS_DIR, doc.id, ...path.split("/")))),
    treeFont,
  );
}

/**
 * The documents a run takes: every fetched one, those `--only` names, or those a
 * file of ids names (`--ids`), each of which the last fetch must have fetched.
 */
function takenDocuments(only: string | undefined, idsFile: string | undefined) {
  const documents = fetchedDocuments(only);
  if (idsFile === undefined) return documents;
  const ids = idsOf(readFileSync(idsFile, "utf8"));
  const fetched = new Set(documents.map((doc) => doc.id));
  const unknown = ids.filter((id) => !fetched.has(id));
  if (unknown.length > 0)
    throw new Error(
      `${unknown.join(", ")} ${unknown.length === 1 ? "is no document" : "are no documents"} the last fetch fetched`,
    );
  return documents.filter((doc) => ids.includes(doc.id));
}

/**
 * The commit this checkout is at, with `+dirty` after it when a file differs from it, an untracked
 * one among them (`commitOf`, decision 0044); or none where git cannot say.
 */
function headCommit(): string | null {
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: APP,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    const commit = git("rev-parse", "HEAD").trim();
    if (!/^[0-9a-f]{40}$/.test(commit)) return null;
    return commitOf(commit, git("status", "--porcelain"));
  } catch {
    return null;
  }
}

/**
 * `--write-baseline --from <run.json>`: the baseline from a run's file, as CI's run leaves it, and
 * nothing run (`baselineFromFile`); never over one the run falls under, and exit 1 when none is
 * written.
 */
function adoptBaseline(from: string) {
  const next = baselineFromFile(
    JSON.parse(readFileSync(from, "utf8")),
    readBaseline(),
    importSummary,
    2,
  );
  if (next.baseline !== undefined) writeAtomically(BASELINE_FILE, formatJson(next.baseline));
  print([next.line]);
  if (next.baseline === undefined) process.exitCode = 1;
}

async function runRun(options: {
  only?: string;
  ids?: string;
  json?: string;
  writeBaseline: boolean;
  from?: string;
}) {
  if (options.from !== undefined) return adoptBaseline(options.from);
  if (options.only !== undefined && options.ids !== undefined)
    throw new Error("--only and --ids each name the documents to run: pass one");
  const whole = options.only === undefined && options.ids === undefined;
  if (options.writeBaseline && !whole)
    throw new Error("--write-baseline takes a run over the whole corpus");
  const baseline = readBaseline();
  const origin = options.writeBaseline ? checkout() : undefined;
  if (origin !== undefined && origin.changed.length > 0)
    throw new Error(
      `--write-baseline records the commit the run is of, and ${origin.changed.length} ${origin.changed.length === 1 ? "file differs" : "files differ"} from it, untracked ones among them: commit or remove them first`,
    );
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("run compiles on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const documents = takenDocuments(options.only, options.ids);
  const treeFont = treeFonts(engine.files);
  const tasks = documents.map((doc) => ({
    id: doc.id,
    message: () => ({ name: `${doc.id}.zip`, bytes: corpusUpload(doc, treeFont) }),
  }));
  const families = new Map(documents.map((doc) => [doc.id, doc.family]));
  const rows: ImportRow[] = [];
  const started = performance.now();
  const size = poolSize();
  const at = { date: new Date().toISOString().slice(0, 10), commit: headCommit() };
  /**
   * The run's JSON, from the documents ended so far, sorted by id: written after each, so that a
   * run stopped or killed leaves what it did, and once more, finished, at its end.
   */
  const written = (complete: boolean) => {
    if (options.json === undefined) return;
    const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const file: ImportFile = {
      version: 2,
      at,
      tree: { layout: engine.layout, files: Object.keys(engine.files).length },
      limitMs: IMPORT_LIMIT_MS,
      mode: { documents: whole ? "all" : "some" },
      complete,
      summary: importSummary(sorted),
      documents: sorted,
    };
    writeAtomically(options.json, formatJson(file));
  };
  print([
    `${documents.length} ${documents.length === 1 ? "document" : "documents"}, ${size} at a time, ${IMPORT_LIMIT_MS / 1000} s each at most; the import a browser runs, which names nothing and asks no model`,
  ]);
  // A signal, as a CI step's time running out sends, stops the pool, and the run ends as it would,
  // with the table and the JSON of what it did, and exits 1.
  const controller = new AbortController();
  const stop = (signal: NodeJS.Signals) => {
    if (controller.signal.aborted) return;
    print([`Stopped by ${signal}: the documents not ended are left undone`]);
    controller.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await runPool({
      script: IMPORT_CHILD,
      tasks,
      size,
      limitMs: IMPORT_LIMIT_MS,
      signal: controller.signal,
      onResult: (task, result) => {
        const reply = result.reply as { row?: ImportChildRow } | undefined;
        const { times, ...fields } = reply?.row ?? {
          outcome: result.timedOut ? ("timeout" as const) : ("crashed" as const),
          times: {},
        };
        const row: ImportRow = {
          id: task.id,
          family: families.get(task.id) ?? "other",
          ...fields,
          times: { ...times, wall: Math.round(result.wall) },
        };
        rows.push(row);
        // Each document's row, counts only, in a folder of the run's own.
        writeAtomically(join(IMPORT_KEPT, `${row.id}.json`), formatJson(row));
        written(false);
        print([`${rows.length}/${documents.length} ${task.id}: ${importLine(row)}`]);
      },
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  const stopped = controller.signal.aborted;
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const minutes = (performance.now() - started) / 60_000;
  const summary = importSummary(rows);
  const verdict = stopped
    ? {
        failed: false,
        line: `Not held to corpus/baseline.json: the run stopped after ${rows.length} of ${documents.length} documents.`,
      }
    : baselineVerdict(summary, baseline, { whole });
  print([
    "",
    ...importTable(rows).trimEnd().split("\n"),
    "",
    ...pieceTables(rows).trimEnd().split("\n"),
    "",
    ...importHeadline(rows),
    verdict.line,
    "",
    `Took ${minutes.toFixed(1)} min.`,
  ]);
  written(!stopped);
  if (origin !== undefined && !stopped) {
    // Never over a baseline the run falls short of: a person lowers one by editing it in a pull
    // request (`nextBaseline`).
    const next = nextBaseline({
      summary,
      baseline,
      scope: { whole },
      date: at.date,
      commit: origin.commit,
    });
    if (next.baseline !== undefined) writeAtomically(BASELINE_FILE, formatJson(next.baseline));
    print([next.line]);
  }
  if (stopped || verdict.failed) {
    console.error(printable(verdict.line));
    process.exitCode = 1;
  }
}

/**
 * `checks --only <id>`: each document it names, a fetched one or one of the oracle's samples, taken
 * through the checks' diagnostic's child, one at a time, and its lines printed: ids, reasons,
 * counts, names and numbers alone (`corpus-checks.ts`). Nothing is written.
 */
async function runChecks(only: string | undefined) {
  if (only === undefined) throw new Error("checks takes --only <id>, one id or several");
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("checks compiles on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const treeFont = treeFonts(engine.files);
  const oracle = existsSync(ORACLE_FILE)
    ? parseJson(Oracle, readFileSync(ORACLE_FILE, "utf8"), ORACLE_FILE)
    : undefined;
  const samples = new Map((oracle?.documents ?? []).map((doc) => [doc.id, doc]));
  const ids = onlyIds(only);
  const corpus = ids.some((id) => !samples.has(id))
    ? fetchedDocuments(ids.filter((id) => !samples.has(id)).join(","))
    : [];
  const tasks = ids.map((id) => {
    const sample = samples.get(id);
    const doc = corpus.find((each) => each.id === id);
    return {
      id,
      message: () => ({
        name: `${id}.zip`,
        bytes:
          sample !== undefined
            ? sampleUpload(sample, treeFont)
            : corpusUpload(doc as LiveDocument, treeFont),
      }),
    };
  });
  await runPool({
    script: CHECKS_CHILD,
    tasks,
    size: 1,
    limitMs: IMPORT_LIMIT_MS,
    onResult: (task, result) => {
      const row = (result.reply as { row?: ChecksRow } | undefined)?.row;
      print(
        row === undefined
          ? [`${task.id}: ${result.timedOut ? "timed out" : "its child died"}`]
          : checksLines(row),
      );
    },
  });
}

function runCompare(files: readonly string[]) {
  if (files.length < 2) throw new Error("compare takes two runs' JSON or more");
  const runs = files.map((file) => JSON.parse(readFileSync(file, "utf8")) as unknown);
  let differ = false;
  for (let i = 1; i < runs.length; i++) {
    const { differences: found, lacking } = runComparison(runs[i - 1], runs[i]);
    const pair = `Runs ${i} and ${i + 1}`;
    // The fields one run has and the other lacks throughout, as an older run lacks a newer one's,
    // are named, and not compared.
    const aside =
      lacking.length === 0
        ? "times aside"
        : `times aside, and the fields only one of them has: ${lacking.join(", ")}`;
    if (found.length === 0) {
      const count = (runs[i] as { documents?: unknown[] }).documents?.length ?? 0;
      print([`${pair} agree on ${count} ${count === 1 ? "document" : "documents"}, ${aside}.`]);
      continue;
    }
    differ = true;
    print([
      `${pair} differ in ${found.length} ${found.length === 1 ? "place" : "places"}, ${aside}:`,
      ...found.slice(0, 100).map((line) => `  ${line}`),
      ...(found.length > 100 ? [`  and ${found.length - 100} more`] : []),
    ]);
  }
  if (differ) process.exitCode = 1;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      only: { type: "string" },
      ids: { type: "string" },
      json: { type: "string" },
      tree: { type: "string" },
      "write-baseline": { type: "boolean" },
      from: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const [command, ...rest] = positionals;
  // `compare` takes files; every other command takes no more.
  if (command !== "compare" && rest.length > 0)
    throw new Error(`${rest.join(" ")} is not an option: ${USAGE}`);
  if (
    command !== "collect" &&
    command !== "fetch" &&
    command !== "survey" &&
    command !== "reference" &&
    command !== "parse" &&
    command !== "probe" &&
    command !== "oracle" &&
    command !== "fonts" &&
    command !== "run" &&
    command !== "compare" &&
    command !== "checks"
  )
    throw new Error(command === undefined ? USAGE : `there is no command ${command}: ${USAGE}`);
  if (
    values.only !== undefined &&
    command !== "fetch" &&
    command !== "reference" &&
    command !== "parse" &&
    command !== "probe" &&
    command !== "fonts" &&
    command !== "run" &&
    command !== "checks"
  )
    throw new Error("--only goes with fetch, reference, parse, probe, fonts, run or checks");
  if (
    values.json !== undefined &&
    command !== "survey" &&
    command !== "reference" &&
    command !== "parse" &&
    command !== "probe" &&
    command !== "fonts" &&
    command !== "run"
  )
    throw new Error("--json goes with survey, reference, parse, probe, fonts or run");
  if (values.tree !== undefined && command !== "survey") throw new Error("--tree goes with survey");
  if (values.ids !== undefined && command !== "run") throw new Error("--ids goes with run");
  if (values["write-baseline"] !== undefined && command !== "run")
    throw new Error("--write-baseline goes with run");
  if (values.from !== undefined && (command !== "run" || values["write-baseline"] !== true))
    throw new Error("--from goes with run --write-baseline");
  if (
    values.from !== undefined &&
    [values.only, values.ids, values.json].some((each) => each !== undefined)
  )
    throw new Error(
      "run --write-baseline --from <run.json> runs nothing, and takes no other option",
    );
  if (command === "fetch") return runFetch(values.only);
  if (command === "collect") return runCollect();
  // pnpm runs the script in the editor's folder; a path is the caller's, from where pnpm was run.
  const caller = (path: string | undefined) =>
    path === undefined ? undefined : resolve(process.env.INIT_CWD ?? ".", path);
  if (command === "run")
    return runRun({
      ...(values.only === undefined ? {} : { only: values.only }),
      ...(values.ids === undefined ? {} : { ids: caller(values.ids) }),
      ...(values.json === undefined ? {} : { json: caller(values.json) }),
      writeBaseline: values["write-baseline"] === true,
      ...(values.from === undefined ? {} : { from: caller(values.from) }),
    });
  if (command === "compare") return runCompare(rest.map((file) => caller(file) ?? file));
  if (command === "reference") return runReference(values.only, caller(values.json));
  if (command === "parse") return runParse(values.only, caller(values.json));
  if (command === "probe") return runProbe(values.only, caller(values.json));
  if (command === "oracle") return runOracle();
  if (command === "checks") return runChecks(values.only);
  if (command === "fonts") return runFonts(values.only, caller(values.json));
  return runSurvey(caller(values.json), caller(values.tree));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.split("\n").map(printable).join("\n"));
  process.exitCode = 1;
});
