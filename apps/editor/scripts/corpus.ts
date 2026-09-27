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
 *   seed          fetch the oracle's samples as `oracle` does, run each through the probe and the
 *                 naming request, built with the header's values the sample's calls give, and
 *                 print each sample's macros and environments with their hashes, keys and
 *                 verdicts, whether `corpus/answers/` holds an answer for each that validates,
 *                 whose hash is the macro's and that is filed under item 4's key, and what
 *                 `--write` would change (`scripts/corpus-seed.ts`, decision 0024). It exits 1
 *                 when one has none, a key moved, a file is not as `--write` writes it, or the
 *                 samples cannot be fetched
 *   --json <file> write each sample's macros as JSON too: names, hashes, keys and verdicts
 *   --write       write every answer file under item 4's key, with the dependencies the key is
 *                 computed from and its list's partners' keys, moving a file whose key changed,
 *                 as after a naming version's bump or an upgrade of the tree
 *
 * The documents are real people's resumes, so `.corpus/` is ignored by git, and the commands print
 * counts, repository names, paths, hashes and sizes, never a document's text, and every line they
 * print goes through `printable`, so that a file's name cannot put an escape to the terminal.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
// Node runs this file by stripping its types, so the type import needs its real extension.
import type { EngineManifest } from "../src/engine/manifest.ts";
import { fileKey, readTree } from "../src/import/fonts.ts";
import { collect, REASONS, type Reason } from "./corpus-collect.ts";
import { fetchCorpus } from "./corpus-fetch.ts";
import { type FontsChildRow, type FontsRow, fontsTable } from "./corpus-fonts.ts";
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
  uploadOf,
} from "./corpus-reference.ts";
import {
  ANSWERS_DIR,
  answersFolder,
  type SeedChildRow,
  type SeedRow,
  seedPlan,
  seedStates,
  seedTable,
} from "./corpus-seed.ts";
import { surveyCorpus, surveyTable } from "./corpus-survey.ts";

const USAGE =
  "pnpm --filter @resume-tools/editor corpus collect | fetch [--only <id>] | survey [--json <file>] [--tree <file>] | reference [--only <id>] [--json <file>] | parse [--only <id>] [--json <file>] | probe [--only <id>] [--json <file>] | oracle | fonts [--only <id>] [--json <file>] | seed [--json <file>] [--write]";

/** The engine's manifest, whose file list is the tree the survey checks documents against. */
const ENGINE_MANIFEST = fileURLToPath(new URL("../.engine/manifest.json", import.meta.url));

/** The engine's tree, whose files the reference runner puts in a zip for the fonts it names. */
const ENGINE_FILES = fileURLToPath(new URL("../.engine/files", import.meta.url));

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

/** The seed's child, which Node runs in each process of its pool. */
const SEED_CHILD = fileURLToPath(new URL("./corpus-seed-child.ts", import.meta.url));

/** Where the probe runner keeps each document's whole probe, which holds its text. */
const PROBE_KEPT = join(CORPUS_DIR, "probe");

/** The fonts runner's child, which Node runs in each process of its pool. */
const FONTS_CHILD = fileURLToPath(new URL("./corpus-fonts-child.ts", import.meta.url));

/** Where the fonts runner keeps each document's logs, which quote its source. */
const FONTS_LOGS = join(CORPUS_DIR, "fonts");

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

/**
 * The fetched documents, or the one `--only` names, as the reference, parse, probe and fonts
 * runners take them.
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
  const documents = only === undefined ? fetched : fetched.filter((doc) => doc.id === only);
  if (documents.length === 0)
    throw new Error(
      only === undefined
        ? "No document is fetched: run `corpus fetch` first"
        : `${only} is no document the last fetch fetched`,
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

async function runSeed(json: string | undefined, write: boolean) {
  const oracle = await fetchOracle();
  if (oracle === undefined) return;
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("seed compiles on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const treeFont = treeFonts(engine.files);
  const tasks = oracle.documents.map((doc) => ({
    id: doc.id,
    message: () => ({
      name: `${doc.id}.zip`,
      bytes: sampleUpload(doc, treeFont),
      family: doc.family,
    }),
  }));
  const rows = new Map<string, SeedRow>();
  await runPool({
    script: SEED_CHILD,
    tasks,
    limitMs: PROBE_LIMIT_MS,
    onResult: (task, result) => {
      const family = oracle.documents.find((doc) => doc.id === task.id)?.family ?? "other";
      const reply = result.reply as
        | { row: SeedChildRow; logs?: Record<string, string> }
        | undefined;
      // A compile's log quotes the sample, so it is kept under .corpus/ alone.
      for (const [which, log] of Object.entries(reply?.logs ?? {}))
        writeAtomically(join(ORACLE_DIR, "seed", `${task.id}-${which}.log`), log);
      const row: SeedRow = {
        id: task.id,
        family,
        ...(reply?.row ?? { outcome: result.timedOut ? "timeout" : "crashed" }),
      };
      rows.set(task.id, row);
      print([`${task.id}: ${row.outcome}, ${row.macros?.length ?? 0} macros and environments`]);
    },
  });
  const ordered = oracle.documents.flatMap((doc) => {
    const row = rows.get(doc.id);
    return row === undefined ? [] : [row];
  });
  let folder = answersFolder();
  const plan = await seedPlan(ordered, folder);
  if (write) {
    // Every file is written before any it moved from is removed, and none another write takes.
    const targets = new Set(plan.writes.map((each) => each.to));
    for (const each of plan.writes)
      writeAtomically(join(ANSWERS_DIR, `${each.to}.json`), each.text);
    for (const each of plan.writes)
      if (each.from !== each.to && !targets.has(each.from))
        rmSync(join(ANSWERS_DIR, `${each.from}.json`));
    folder = answersFolder();
  }
  const states = await seedStates(ordered, folder.read);
  const { table, problems } = seedTable(ordered, states, folder.keys, { ...plan, written: write });
  print(["", ...table.trimEnd().split("\n")]);
  if (json !== undefined) writeAtomically(json, formatJson({ version: 1, documents: ordered }));
  if (problems > 0) {
    console.error(
      "The seed has a problem: a macro whose answer is missing, does not validate or is not filed under its request's key, a redefinition that stops a compile, or an answer file `corpus seed --write` would write",
    );
    process.exitCode = 1;
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      only: { type: "string" },
      json: { type: "string" },
      tree: { type: "string" },
      write: { type: "boolean" },
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
    command !== "reference" &&
    command !== "parse" &&
    command !== "probe" &&
    command !== "oracle" &&
    command !== "fonts" &&
    command !== "seed"
  )
    throw new Error(command === undefined ? USAGE : `there is no command ${command}: ${USAGE}`);
  if (
    values.only !== undefined &&
    command !== "fetch" &&
    command !== "reference" &&
    command !== "parse" &&
    command !== "probe" &&
    command !== "fonts"
  )
    throw new Error("--only goes with fetch, reference, parse, probe or fonts");
  if (
    values.json !== undefined &&
    command !== "survey" &&
    command !== "reference" &&
    command !== "parse" &&
    command !== "probe" &&
    command !== "fonts" &&
    command !== "seed"
  )
    throw new Error("--json goes with survey, reference, parse, probe, fonts or seed");
  if (values.tree !== undefined && command !== "survey") throw new Error("--tree goes with survey");
  if (values.write === true && command !== "seed") throw new Error("--write goes with seed");
  if (command === "fetch") return runFetch(values.only);
  if (command === "collect") return runCollect();
  // pnpm runs the script in the editor's folder; a path is the caller's, from where pnpm was run.
  const caller = (path: string | undefined) =>
    path === undefined ? undefined : resolve(process.env.INIT_CWD ?? ".", path);
  if (command === "reference") return runReference(values.only, caller(values.json));
  if (command === "parse") return runParse(values.only, caller(values.json));
  if (command === "probe") return runProbe(values.only, caller(values.json));
  if (command === "oracle") return runOracle();
  if (command === "fonts") return runFonts(values.only, caller(values.json));
  if (command === "seed") return runSeed(caller(values.json), values.write === true);
  return runSurvey(caller(values.json), caller(values.tree));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.split("\n").map(printable).join("\n"));
  process.exitCode = 1;
});
