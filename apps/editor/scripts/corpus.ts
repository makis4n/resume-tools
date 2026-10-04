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
 *   pnpm --filter @resume-tools/editor corpus seed [--json <file>] [--write]
 *   pnpm --filter @resume-tools/editor corpus name [--only <id>] [--json <file>] [--model]
 *   pnpm --filter @resume-tools/editor corpus assemble [--only <id>] [--json <file>]
 *   pnpm --filter @resume-tools/editor corpus leak [--only <id>] [--json <file>]
 *   pnpm --filter @resume-tools/editor corpus run [--only <id>] [--ids <file>] [--json <file>]
 *                 [--write-baseline]
 *   pnpm --filter @resume-tools/editor corpus compare <run.json> <run.json> [<run.json>...]
 *   pnpm --filter @resume-tools/editor corpus review export [--top <n>] [--out <dir>]
 *   pnpm --filter @resume-tools/editor corpus review check [--dir <dir>]
 *   pnpm --filter @resume-tools/editor corpus bench --model <id> [--only <id>] [--ids <file>]
 *                 [--json <file>] [--thinking <switch>] [--retries <n>]
 *   pnpm --filter @resume-tools/editor corpus bench <bench.json> [<bench.json>...]
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
 *                 (`scripts/corpus-oracle.ts`); then assemble each from the seed, validate it with
 *                 the checks and the harness, and print the fields found by the model's place
 *                 against the slots its port marks. It exits 1 when the samples cannot be fetched
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
 *   name          take every document whose body parses, build its naming request as `seed` builds a
 *                 sample's, in the same pool, and answer it macro by macro from the cache: the
 *                 committed answers under `corpus/answers/` first, then the model's own under
 *                 `.corpus/cache/<model id>/`, the model `NAMING_MODEL` names, qwen3.8:27b on
 *                 SoCLaaS with its thinking off when unset (decision 0044); print what each
 *                 document's macros came to and one table of them all, names of macros and counts
 *                 only (`scripts/corpus-name.ts`, decision 0027).
 *                 Without `--model` the macros the cache does not answer are counted missing
 *   --only <id>   that document only
 *   --json <file> write each document's row as JSON too, macros' names and numbers only
 *   --model       ask the model for them, once a request passes the privacy gate: none of the text
 *                 the builder knows as the document's is in it (`assertNoText`) and its keys hold
 *                 (`checkRequest`); and store its answers, a part at a time as each validates,
 *                 in the model's folder. It needs a SoCLaaS key in the environment, one line with no
 *                 spaces, `SOCLAAS_API_KEY` (decision 0036). Never in CI
 *   assemble      take every document whose body parses and whose macros have an answer under
 *                 `corpus/answers/`, probe it, assemble its package and document from the answer,
 *                 and validate them with the four checks and the harness (`src/import/assemble.ts`,
 *                 `validate.ts`), in the same pool, 900 s a document; print one table of what it
 *                 found, per family and in all, names and counts only, and keep each document's
 *                 assembly under `.corpus/assemble/` (`scripts/corpus-assemble.ts`, decision 0026).
 *                 It exits 1 when a successful import, one whose first check holds, lacks any of
 *                 the page size, the margins and the font size, the milestone's bar, and names
 *                 each such document by its id and the control it lacks (decision 0040)
 *   leak          take every document that compiles to a reference and whose body parses, build
 *                 its naming request as the import sends it (`importRequest`), with its sources
 *                 and its page's strings, and check it with the leak detector fed those, the texts
 *                 its preamble stores and the header's values the seed's answers find, in the
 *                 same pool; print
 *                 how many were checked, passed and failed, and refused for a page the detector
 *                 cannot read, and for each failure the macro and what kind of text is where,
 *                 never the text (`scripts/corpus-leak.ts`, decision 0033). It exits 1 when a
 *                 request holds its document's text, the builder made one its contract refuses, a
 *                 document crashed or timed out, or fewer documents were checked or refused than
 *                 have a reference, and takes about a minute for the corpus
 *   --only <id>   that document only, or the documents a comma separates, `jake-0001,altacv-0001`
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
 *   review export write, for each of the top templates of the last run's documents, a folder an
 *                 Opus agent reviews the answers from (decision 0037): the naming requests the
 *                 privacy gate passed, the answers the cache holds for its macros, and the checks'
 *                 findings reduced to reasons, macro names and counts, every file checked with the
 *                 leak detector against every document of its template (`scripts/corpus-review.ts`,
 *                 `corpus/REVIEW.md`). It reads the last run only when that run finished, read the
 *                 committed answers and the cache of the model `NAMING_MODEL` names, and kept
 *                 every document it took; else it says why in one line and stops
 *   --top <n>     how many templates, 20 unless given
 *   --out <dir>   the folder, `.review/` unless given, from where pnpm was run
 *   review check  for every reviewed answer under `corpus/answers/` that carries redefinitions,
 *                 run the assembly of every document the last run found holding its key, and say of
 *                 each redefinition whether it is kept, unproven or dropped, and why; it reads the
 *                 last run as the export does, and only one over every fetched document, and exits
 *                 1 when a redefinition is dropped or unproven, or an answer does not validate
 *   --dir <dir>   the review's export, whose templates the lines name, `.review/` unless given
 *   bench         measure a naming model on SoCLaaS (`scripts/corpus-bench.ts`, decision 0044):
 *                 take every fetched document through the first pass's whole import, in its child,
 *                 with the naming request the import sends, refused where the import's privacy
 *                 check refuses it, its macros answered from the model's own folder of
 *                 `.corpus/cache/` alone, the committed answers and every other model's cache left
 *                 out, and the model asked for every macro its folder does not answer, behind the
 *                 stricter check the first pass's run asked it behind, its answers filed in its
 *                 folder; print
 *                 each document's outcome and naming step, the run's table, and the candidate's:
 *                 the outcomes, the editable rate, the locked words by reason, each part's time
 *                 (the median, the 90th percentile and the slowest, with its document and number),
 *                 a request's parts together, the calls, the tokens and their reasoning, the
 *                 failures by kind, and the cost at the gateway's reference prices, which it never
 *                 bills; ids and counts only. A second run of the same model answers from its
 *                 folder, asks nothing, and says so. It needs SOCLAAS_API_KEY in the environment,
 *                 and stops, its table partial, once the gateway has failed three documents in a
 *                 row with a 429, a 5xx or another failure of the call. Never in CI
 *   --model <id>  the model, by its SoCLaaS id
 *   --only <id>   that document only, or the documents a comma separates
 *   --ids <file>  the documents a file names, one id a line, from where pnpm was run
 *   --json <file> write the candidate's summary and each document's row as JSON too, ids and
 *                 counts only
 *   --thinking <switch>  ask the model not to reason first, by `no-think` (a `/no_think` line
 *                 after the instructions), `template` (the chat template's `enable_thinking`
 *                 false) or `effort` (a reasoning effort of none), or let it reason (`on`); the
 *                 request, its gate, its prompt and the answer's schema stay as they are, and its
 *                 answers go in the model's folder. Unless given, the model is asked as the naming
 *                 step asks it everywhere: the default, qwen3.8:27b, with `template`
 *   --retries <n> how many times a failed call is tried again, 0 to 10, the runner's 4 unless given
 *   bench <bench.json> [<bench.json>...]  run nothing, and set the candidates' files side by side,
 *                 one column each, with the model the rule picks for the default: the highest
 *                 editable rate whose slowest part stays within the naming service's two minutes,
 *                 the faster on a tie
 *
 * The documents are real people's resumes, so `.corpus/` is ignored by git, and the commands print
 * counts, repository names, paths, hashes and sizes, never a document's text, and every line they
 * print goes through `printable`, so that a file's name cannot put an escape to the terminal.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AnswerSource } from "@resume-tools/naming";
import { MODEL_THINKING, THINKING_SWITCHES } from "@resume-tools/naming/providers";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import { readTree } from "../src/import/fonts.ts";
import { FileAnswerCache, modelCacheDir } from "./answer-cache.ts";
import {
  ASSEMBLE_LIMIT_MS,
  type AssembleChildRow,
  type AssembleRow,
  assembleTable,
  barFailureLines,
  barFailures,
  barLine,
  comparePlaces,
  type PlaceCount,
  placesTable,
  portPlaces,
  reportLine,
  reportSucceeded,
} from "./corpus-assemble.ts";
import {
  type BenchFile,
  benchHeadline,
  benchLine,
  benchSummary,
  benchTable,
  candidatesOf,
  chooseDefault,
} from "./corpus-bench.ts";
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
import { checkCorpus, leakFailures, leakLine, leakTable } from "./corpus-leak.ts";
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
import {
  NAME_LIMIT_MS,
  type NameChildRow,
  type NameRow,
  nameLine,
  nameTable,
  namingConfig,
  PROVIDER_FAILURES,
} from "./corpus-name.ts";
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
  treeFonts,
  uploadOf,
} from "./corpus-reference.ts";
import type { FindLeaks } from "./corpus-review.ts";
import {
  type Checked,
  carriersOf,
  exportPlan,
  type RunDocument,
  redefinitionVerdicts,
  runMismatch,
  verdictLine,
} from "./corpus-review.ts";
import {
  Baseline,
  baselineFromFile,
  baselineVerdict,
  changedPaths,
  commitOf,
  idsOf,
  nextBaseline,
  poolSize,
  type RefusalStep,
  type RunChildRow,
  type RunNaming,
  RunRecord,
  type RunRow,
  runDifferences,
  runHeadline,
  runLimitMs,
  runLine,
  runTable,
} from "./corpus-run.ts";
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
  "pnpm --filter @resume-tools/editor corpus collect | fetch [--only <id>] | survey [--json <file>] [--tree <file>] | reference [--only <id>] [--json <file>] | parse [--only <id>] [--json <file>] | probe [--only <id>] [--json <file>] | oracle | fonts [--only <id>] [--json <file>] | seed [--json <file>] [--write] | name [--only <id>] [--json <file>] [--model] | assemble [--only <id>] [--json <file>] | leak [--only <id>] [--json <file>] | run [--only <id>] [--ids <file>] [--json <file>] [--write-baseline] | run --write-baseline --from <run.json> | compare <run.json> <run.json> [<run.json>...] | review export [--top <n>] [--out <dir>] | review check [--dir <dir>] | bench --model <id> [--only <id>] [--ids <file>] [--json <file>] [--thinking <switch>] [--retries <n>] | bench <bench.json> [<bench.json>...]";

/** The editor, whose modules the review's export loads through Vite for the leak detector. */
const APP = fileURLToPath(new URL("..", import.meta.url));

/**
 * Where the first pass's run kept each document's assembly and what the review reads of it, which
 * hold its text (`RunDocument`): `.corpus/run/<id>/`, which the review still reads until the second
 * pass's item 17; `corpus run` keeps its rows under `.corpus/import-run/` since item 6.
 */
const RUN_KEPT = join(CORPUS_DIR, "run");

/** The baseline a run over the whole corpus is held to. */
const BASELINE_FILE = fileURLToPath(new URL("../corpus/baseline.json", import.meta.url));

/** Where the review's export goes unless `--out` says, which git ignores. */
const REVIEW_DIR = fileURLToPath(new URL("../.review", import.meta.url));

/** How many templates the review's export takes unless `--top` says: plan section 10's twenty. */
const REVIEW_TOP = 20;

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

/** The naming runner's child, which Node runs in each process of its pool. */
const NAME_CHILD = fileURLToPath(new URL("./corpus-name-child.ts", import.meta.url));

/** The seed's child, which Node runs in each process of its pool. */
const SEED_CHILD = fileURLToPath(new URL("./corpus-seed-child.ts", import.meta.url));

/** Where the probe runner keeps each document's whole probe, which holds its text. */
const PROBE_KEPT = join(CORPUS_DIR, "probe");

/** The fonts runner's child, which Node runs in each process of its pool. */
const FONTS_CHILD = fileURLToPath(new URL("./corpus-fonts-child.ts", import.meta.url));

/** Where the fonts runner keeps each document's logs, which quote its source. */
const FONTS_LOGS = join(CORPUS_DIR, "fonts");

/** The run's child, which takes each document through the import a browser runs. */
const IMPORT_CHILD = fileURLToPath(new URL("./corpus-import-child.ts", import.meta.url));

/** Where the run keeps each document's row, counts only: a folder of its own. */
const IMPORT_KEPT = join(CORPUS_DIR, "import-run");

/** The assembly runner's child, which Node runs in each process of its pool, and the oracle's. */
const ASSEMBLE_CHILD = fileURLToPath(new URL("./corpus-assemble-child.ts", import.meta.url));

/** Where the assembly runner keeps each document's assembly, which holds its text. */
const ASSEMBLE_KEPT = join(CORPUS_DIR, "assemble");

/** The curated ports, whose `template.json` the oracle compares an assembly's fields with. */
const TEMPLATES = fileURLToPath(new URL("../src/templates/", import.meta.url));

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

/** An assembly's row, and its whole assembly kept under `dir`, from a child's reply or its fate. */
function assembleRowOf(
  task: { id: string },
  family: AssembleRow["family"],
  result: { reply?: unknown; timedOut?: boolean; wall: number },
  dir: string,
  probeDir?: string,
): { row: AssembleRow; probe?: ProbeChildRow; fields?: Record<string, PlaceCount> } {
  const reply = result.reply as
    | {
        row: AssembleChildRow;
        probe?: ProbeChildRow;
        probeDetail?: unknown;
        fields?: Record<string, PlaceCount>;
        detail?: unknown;
      }
    | undefined;
  if (reply?.detail !== undefined)
    writeAtomically(join(dir, `${task.id}.json`), `${JSON.stringify(reply.detail, null, 1)}\n`);
  // The oracle keeps each sample's whole probe beside, as its probe runner did.
  if (probeDir !== undefined && reply?.probeDetail !== undefined)
    writeAtomically(
      join(probeDir, `${task.id}.json`),
      `${JSON.stringify(reply.probeDetail, null, 1)}\n`,
    );
  return {
    row: {
      id: task.id,
      family,
      ...(reply?.row ?? { outcome: result.timedOut ? "timeout" : "crashed" }),
      wall: Math.round(result.wall),
    },
    ...(reply?.probe === undefined ? {} : { probe: reply.probe }),
    ...(reply?.fields === undefined ? {} : { fields: reply.fields }),
  };
}

/** An assembly's row as a line of progress: numbers only. */
function assembleLine(row: AssembleRow): string {
  if (row.outcome !== "assembled" && row.outcome !== "partial")
    return `${row.outcome}${row.refused === undefined ? "" : ` (${row.refused})`}`;
  const locked = Object.values(row.fields?.locked ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
  // The milestone's bar (decision 0040): which of page size, margins and font size are proven, and
  // for a successful import, as item 13's report says (decision 0039), why each it lacks is
  // lacking, by the kind of why alone.
  return `${row.engine}, ${row.outcome}${row.difference === undefined ? "" : ` (${row.difference})`}, ${row.fields?.editable ?? 0} editable, ${locked} locked, ${row.compiles ?? 0} compiles, ${row.validateMs ?? 0} ms; the report: ${reportLine(row.report)}; the bar: ${barLine(row, reportSucceeded(row))}`;
}

async function runAssemble(only: string | undefined, json: string | undefined) {
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("assemble compiles on the engine in .engine/: run fetch-engine first");
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
  const rows: AssembleRow[] = [];
  const started = performance.now();
  print([
    `${documents.length} ${documents.length === 1 ? "document" : "documents"}, ${POOL_SIZE} at a time, ${ASSEMBLE_LIMIT_MS / 1000} s each at most`,
  ]);
  await runPool({
    script: ASSEMBLE_CHILD,
    tasks,
    limitMs: ASSEMBLE_LIMIT_MS,
    onResult: (task, result) => {
      const { row } = assembleRowOf(task, families.get(task.id) ?? "other", result, ASSEMBLE_KEPT);
      rows.push(row);
      print([`${rows.length}/${documents.length} ${task.id}: ${assembleLine(row)}`]);
    },
  });
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const minutes = (performance.now() - started) / 60_000;
  print(["", ...assembleTable(rows).trimEnd().split("\n")]);
  print(["", `Took ${minutes.toFixed(1)} min.`]);
  if (json !== undefined)
    writeAtomically(
      json,
      formatJson({
        version: 1,
        tree: { layout: engine.layout, files: Object.keys(engine.files).length },
        limitMs: ASSEMBLE_LIMIT_MS,
        documents: rows,
      }),
    );
  // The milestone's bar (decision 0040): every successful import, as item 13's report says
  // (decision 0039), has its page size, margins and font size proven, or the run fails, naming each
  // it misses by the document's id and control.
  const failures = barFailures(rows, reportSucceeded);
  if (failures.length > 0) {
    console.error(barFailureLines(failures).map(printable).join("\n"));
    process.exitCode = 1;
  }
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
  const assembled = new Map<string, { row: AssembleRow; fields?: Record<string, PlaceCount> }>();
  await runPool({
    script: ASSEMBLE_CHILD,
    tasks,
    limitMs: ASSEMBLE_LIMIT_MS,
    onResult: (task, result) => {
      const family = oracle.documents.find((doc) => doc.id === task.id)?.family ?? "other";
      const found = assembleRowOf(
        task,
        family,
        result,
        join(ORACLE_DIR, "assemble"),
        join(ORACLE_DIR, "probe"),
      );
      const row: ProbeRow = {
        id: task.id,
        family,
        ...(found.probe ?? { outcome: result.timedOut ? "timeout" : "crashed" }),
        wall: Math.round(result.wall),
      };
      rows.set(task.id, row);
      assembled.set(task.id, {
        row: found.row,
        ...(found.fields === undefined ? {} : { fields: found.fields }),
      });
      print([`${task.id}: ${probeLine(row)}; ${assembleLine(found.row)}`]);
    },
  });
  const lines = oracle.documents.flatMap((doc) => compare(doc, rows.get(doc.id)));
  print(["", ...oracleTable(lines).trimEnd().split("\n")]);
  const samples = oracle.documents.map((doc) => {
    const port = JSON.parse(readFileSync(join(TEMPLATES, doc.family, "template.json"), "utf8"));
    const found = assembled.get(doc.id);
    return {
      template: doc.family,
      ...(found === undefined ? {} : { row: found.row }),
      lines: comparePlaces(doc.family, portPlaces(port), found?.fields),
    };
  });
  print(["", ...placesTable(samples).trimEnd().split("\n")]);
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

async function runName(only: string | undefined, json: string | undefined, model: boolean) {
  const config = namingConfig(process.env);
  if (model && config.key === undefined)
    throw new Error(
      "name --model asks SoCLaaS, which needs a key: set SOCLAAS_API_KEY in the environment",
    );
  // The model's id names its answers' folder, which the run reads whether it asks the model or not.
  if (!AnswerSource.safeParse(`model:${config.id}`).success)
    throw new Error("NAMING_MODEL is not a model's id: letters, digits and ._:/@- only");
  modelCacheDir(config.id);
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("name builds each request on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const documents = fetchedDocuments(only);
  const treeFont = treeFonts(engine.files);
  // The parent stops asking once the provider has failed documents in a row: a spent quota fails
  // every call after it. Each task's message is made as it is sent, so it asks or not by then.
  let asking = model;
  let failures = 0;
  const tasks = documents.map((doc) => ({
    id: doc.id,
    message: () => ({
      name: `${doc.id}.zip`,
      bytes: uploadOf(
        doc,
        (path) => new Uint8Array(readFileSync(join(CORPUS_DIR, doc.id, ...path.split("/")))),
        treeFont,
      ),
      ...(asking ? { model: config.id } : {}),
    }),
  }));
  const families = new Map(documents.map((doc) => [doc.id, doc.family]));
  const rows: NameRow[] = [];
  const started = performance.now();
  print([
    `${documents.length} ${documents.length === 1 ? "document" : "documents"}, ${POOL_SIZE} at a time, ${NAME_LIMIT_MS / 1000} s each at most; the committed answers and ${config.id}'s; ${model ? `asking ${config.id} for what they do not answer` : "no model asked"}`,
  ]);
  await runPool({
    script: NAME_CHILD,
    tasks,
    limitMs: NAME_LIMIT_MS,
    onResult: (task, result) => {
      const reply = result.reply as { row: NameChildRow } | undefined;
      const row: NameRow = {
        id: task.id,
        family: families.get(task.id) ?? "other",
        ...(reply?.row ?? { outcome: result.timedOut ? "timeout" : "crashed" }),
      };
      rows.push(row);
      print([`${rows.length}/${documents.length} ${task.id}: ${nameLine(row)}`]);
      if (row.failed?.reason === "provider") failures++;
      else if ((row.calls ?? 0) > 0) failures = 0;
      if (asking && failures >= PROVIDER_FAILURES) {
        asking = false;
        print([
          `The provider failed ${PROVIDER_FAILURES} documents in a row: the documents not yet sent are not asked`,
        ]);
      }
    },
  });
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const minutes = (performance.now() - started) / 60_000;
  print([
    "",
    ...nameTable(rows, model ? config.id : undefined)
      .trimEnd()
      .split("\n"),
  ]);
  print(["", `Took ${minutes.toFixed(1)} min.`]);
  if (json !== undefined)
    writeAtomically(
      json,
      formatJson({
        version: 1,
        tree: { layout: engine.layout, files: Object.keys(engine.files).length },
        limitMs: NAME_LIMIT_MS,
        model: model ? config.id : null,
        cache: config.id,
        documents: rows,
      }),
    );
}

async function runLeak(only: string | undefined, json: string | undefined) {
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("leak compiles on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const documents = fetchedDocuments(only);
  const treeFont = treeFonts(engine.files);
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const started = performance.now();
  print([
    `${documents.length} ${documents.length === 1 ? "document" : "documents"}, ${POOL_SIZE} at a time, ${LIMIT_MS / 1000} s each at most`,
  ]);
  const rows = await checkCorpus({
    documents,
    upload: (id) => {
      const doc = byId.get(id);
      if (doc === undefined) throw new Error(`${id} is no document of the run`);
      return uploadOf(
        doc,
        (path) => new Uint8Array(readFileSync(join(CORPUS_DIR, doc.id, ...path.split("/")))),
        treeFont,
      );
    },
    onRow: (row, done) => print([`${done}/${documents.length} ${row.id}: ${leakLine(row)}`]),
  });
  const minutes = (performance.now() - started) / 60_000;
  print(["", ...leakTable(rows).trimEnd().split("\n"), "", `Took ${minutes.toFixed(1)} min.`]);
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
  const failures = leakFailures(rows);
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  }
}

/** The baseline, which must parse whatever the run; the placeholder's run is null. */
const readBaseline = () => parseJson(Baseline, readFileSync(BASELINE_FILE, "utf8"), BASELINE_FILE);

/**
 * The commit this checkout is at, and the paths that differ from it, the baseline's aside: a tracked
 * file changed, or a file git does not track, as an answer not yet committed under
 * `corpus/answers/`, which a run reads though the commit lacks it (`changedPaths`).
 */
function checkout(): { commit: string; changed: string[] } {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: APP, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const commit = git("rev-parse", "HEAD").trim();
  return { commit, changed: changedPaths(git("status", "--porcelain")) };
}

/** The record of the last run, beside the documents it kept (`RunRecord`). */
const RUN_RECORD = join(RUN_KEPT, "run.json");

/** The last run's record, or none when there is none, or it is not one. */
function readRunRecord(): RunRecord | undefined {
  try {
    return RunRecord.parse(JSON.parse(readFileSync(RUN_RECORD, "utf8")));
  } catch {
    return undefined;
  }
}

/** What the last run kept of a document for the review, or none. */
function keptDocument(id: string): RunDocument | undefined {
  const file = join(RUN_KEPT, id, "review.json");
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as RunDocument;
  } catch {
    return undefined;
  }
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
 * The documents a run or a benchmark takes: every fetched one, those `--only` names, or those a
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

function runCompare(files: readonly string[]) {
  if (files.length < 2) throw new Error("compare takes two runs' JSON or more");
  const runs = files.map((file) => JSON.parse(readFileSync(file, "utf8")) as unknown);
  let differ = false;
  for (let i = 1; i < runs.length; i++) {
    const found = runDifferences(runs[i - 1], runs[i]);
    const pair = `Runs ${i} and ${i + 1}`;
    if (found.length === 0) {
      const count = (runs[i] as { documents?: unknown[] }).documents?.length ?? 0;
      print([`${pair} agree on ${count} ${count === 1 ? "document" : "documents"}, times aside.`]);
      continue;
    }
    differ = true;
    print([
      `${pair} differ in ${found.length} ${found.length === 1 ? "place" : "places"}, times aside:`,
      ...found.slice(0, 100).map((line) => `  ${line}`),
      ...(found.length > 100 ? [`  and ${found.length - 100} more`] : []),
    ]);
  }
  if (differ) process.exitCode = 1;
}

/**
 * The failures of a document's call that stop a benchmark once the gateway has given them to
 * PROVIDER_FAILURES documents in a row: its 429, a rate or a key's daily budget, its 5xx, and any
 * other failure of the call, a wrong key's 401 among them; never a part that ran out of its time,
 * nor an answer that did not validate, which measure the model.
 */
const STOPPING: ReadonlySet<string> = new Set(["429", "5xx", "provider"]);

/**
 * `bench --model <id>`: the model measured on its own answers over the documents (decision 0044),
 * as `run` takes them, the committed answers and every other model's cache left out; each
 * document's row as the run's, the run's table, and the candidate's table and lines, ids and counts
 * only; and with `--json`, its file (`BenchFile`). It stops, its table partial, when a signal comes
 * or the gateway has failed documents in a row, and then exits 1.
 */
async function runBench(options: {
  model: string;
  only?: string;
  ids?: string;
  json?: string;
  thinking?: string;
  retries?: string;
}) {
  const id = options.model.trim();
  if (!AnswerSource.safeParse(`model:${id}`).success)
    throw new Error("--model is not a model's id: letters, digits and ._:/@- only");
  modelCacheDir(id);
  const asked = THINKING_SWITCHES.find((each) => each === options.thinking);
  if (options.thinking !== undefined && options.thinking !== "on" && asked === undefined)
    throw new Error(`--thinking takes one of ${THINKING_SWITCHES.join(", ")} or on`);
  // The switch the model is asked with: the one given, none for `on`, and otherwise the one the
  // naming step asks it with everywhere (`MODEL_THINKING`), the default's (decision 0044).
  const thinking = options.thinking === "on" ? undefined : (asked ?? MODEL_THINKING[id]);
  const retries = options.retries === undefined ? undefined : Number(options.retries);
  if (retries !== undefined && !(Number.isInteger(retries) && retries >= 0 && retries <= 10))
    throw new Error("--retries takes a whole number from 0 to 10");
  const config = namingConfig(process.env);
  if (config.key === undefined)
    throw new Error(
      "bench asks SoCLaaS, which needs a key: set SOCLAAS_API_KEY in the environment",
    );
  if (options.only !== undefined && options.ids !== undefined)
    throw new Error("--only and --ids each name the documents to run: pass one");
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("bench compiles on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const documents = takenDocuments(options.only, options.ids);
  const whole = options.only === undefined && options.ids === undefined;
  const treeFont = treeFonts(engine.files);
  const tasks = documents.map((doc) => ({
    id: doc.id,
    message: () => ({
      name: `${doc.id}.zip`,
      bytes: corpusUpload(doc, treeFont),
      answers: {
        model: id,
        ask: true,
        own: true,
        thinking: thinking ?? false,
        ...(retries === undefined ? {} : { retries }),
      },
    }),
  }));
  const families = new Map(documents.map((doc) => [doc.id, doc.family]));
  const rows: RunRow[] = [];
  const started = performance.now();
  const limitMs = runLimitMs(true);
  const size = poolSize();
  const at = { date: new Date().toISOString().slice(0, 10), commit: headCommit() };
  let stopped: string | undefined;
  /**
   * The benchmark's JSON, from the documents ended so far, sorted by id: written after each, so
   * that a run stopped or killed leaves what it did, and once more at its end, finished or not.
   */
  const written = (complete: boolean) => {
    if (options.json === undefined) return;
    const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const file: BenchFile = {
      version: 1,
      at,
      model: id,
      ...(thinking === undefined ? {} : { thinking }),
      ...(retries === undefined ? {} : { retries }),
      tree: { layout: engine.layout, files: Object.keys(engine.files).length },
      limitMs,
      documents: whole ? "all" : "some",
      complete,
      ...(stopped === undefined ? {} : { stopped }),
      summary: benchSummary(id, sorted, thinking),
      rows: sorted,
    };
    writeAtomically(options.json, formatJson(file));
  };
  print([
    `${documents.length} ${documents.length === 1 ? "document" : "documents"}, ${size} at a time, ${limitMs / 1000} s each at most; ${id}'s own answers alone, the committed answers and every other model's cache left out; asking ${id} for every macro its folder does not answer${thinking === undefined ? "" : `, with thinking off (${thinking})`}${retries === undefined ? "" : `, a failed call tried ${retries} more ${retries === 1 ? "time" : "times"}`}`,
  ]);
  const controller = new AbortController();
  const stop = (why: string) => {
    if (controller.signal.aborted) return;
    stopped = why;
    print([`${why}: the documents not ended are left undone`]);
    controller.abort();
  };
  const signalled = (signal: NodeJS.Signals) => stop(`Stopped by ${signal}`);
  process.once("SIGINT", signalled);
  process.once("SIGTERM", signalled);
  // The documents in a row whose call the gateway failed, and the kinds it failed them with.
  let failing: string[] = [];
  // What each document's naming step came to, as its child said it once the step ended: a row's
  // own where the document ends, and kept for one whose child is killed later, in its checks, so
  // that its parts' times count.
  const said = new Map<string, { naming: RunNaming; parts?: number[] }>();
  try {
    await runPool({
      script: ASSEMBLE_CHILD,
      tasks,
      size,
      limitMs,
      signal: controller.signal,
      onMessage: (task, message) => {
        const step = message as { type?: unknown; naming?: RunNaming; parts?: number[] };
        if (step.type === "naming" && step.naming !== undefined)
          said.set(task.id, {
            naming: step.naming,
            ...(step.parts === undefined ? {} : { parts: step.parts }),
          });
      },
      onResult: (task, result) => {
        const reply = result.reply as { run?: RunChildRow } | undefined;
        const { times, ...fields } = reply?.run ?? {
          outcome: result.timedOut ? ("timeout" as const) : ("crashed" as const),
          times: {},
        };
        const early = reply?.run === undefined ? said.get(task.id) : undefined;
        const row: RunRow = {
          id: task.id,
          family: families.get(task.id) ?? "other",
          ...fields,
          ...(early === undefined ? {} : { naming: early.naming }),
          times: {
            ...times,
            ...(early?.parts === undefined ? {} : { parts: early.parts }),
            wall: Math.round(result.wall),
          },
        };
        rows.push(row);
        written(false);
        print([
          `${rows.length}/${documents.length} ${task.id}: ${runLine(row)}; ${benchLine(row)}`,
        ]);
        const kind = row.naming?.failure?.kind;
        if (kind !== undefined && STOPPING.has(kind)) failing.push(kind);
        else if ((row.naming?.calls ?? 0) > 0) failing = [];
        if (failing.length >= PROVIDER_FAILURES)
          stop(
            `The gateway failed ${PROVIDER_FAILURES} documents in a row (${failing.join(", ")}): the benchmark stops, its table partial${failing.includes("429") ? "; a 429 that persists is the key's daily budget, which resets at 00:00 UTC, when the same command asks only what the model's folder does not answer" : ""}`,
          );
      },
    });
  } finally {
    process.off("SIGINT", signalled);
    process.off("SIGTERM", signalled);
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const minutes = (performance.now() - started) / 60_000;
  const summary = benchSummary(id, rows, thinking);
  print([
    "",
    ...runTable(rows).trimEnd().split("\n"),
    "",
    ...runHeadline(rows),
    "",
    ...benchTable([summary]).trimEnd().split("\n"),
    "",
    ...benchHeadline(summary),
    ...(stopped === undefined ? [] : [`${stopped}.`]),
    "",
    `Took ${minutes.toFixed(1)} min.`,
  ]);
  written(stopped === undefined);
  if (stopped !== undefined) process.exitCode = 1;
}

/**
 * `bench <bench.json>...`: nothing run; the candidates' files side by side, one column each, each
 * summarised again from its rows, what to know of them, and the model the rule picks for the
 * default (`chooseDefault`).
 */
function runBenchCompare(files: readonly string[]) {
  const { summaries, notes } = candidatesOf(
    files.map((file) => JSON.parse(readFileSync(file, "utf8")) as unknown),
  );
  const choice = chooseDefault(summaries);
  print([
    ...benchTable(summaries).trimEnd().split("\n"),
    "",
    ...notes,
    ...choice.verdicts.map((each) => `${each.model}: ${each.why}.`),
    choice.line,
  ]);
}

/**
 * The editor's modules the review needs, loaded through Vite's module runner with the app's own
 * config, as the children load them: the leak detector, which needs no engine.
 */
async function leakDetector(): Promise<{ findLeaks: FindLeaks; close: () => Promise<void> }> {
  const { createRunnableDevEnvironment, resolveConfig } = await import("vite");
  const config = await resolveConfig(
    { root: APP, logLevel: "silent", ssr: { noExternal: ["opentype.js"] } },
    "serve",
  );
  const environment = createRunnableDevEnvironment("ssr", config, { hot: false });
  await environment.init();
  const naming =
    await environment.runner.import<typeof import("../src/import/naming.ts")>(
      "/src/import/naming.ts",
    );
  return { findLeaks: naming.findLeaks, close: () => environment.close() };
}

/**
 * Whether a folder is absent, empty, or an earlier export, which holds its index and template
 * folders and nothing else: one the export may write over, and no other.
 */
function exportFolder(dir: string): boolean {
  if (!existsSync(dir)) return true;
  const entries = readdirSync(dir);
  if (entries.length === 0) return true;
  if (!entries.every((entry) => entry === "index.json" || /^\d{2,}-[a-z-]+$/.test(entry)))
    return false;
  try {
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as {
      version?: unknown;
      rule?: unknown;
    };
    return index.version === 1 && typeof index.rule === "string";
  } catch {
    return false;
  }
}

/**
 * The documents the last run kept, for the review's export or its check; or, where they cannot serve
 * it, an error that says why in one line (`runMismatch`): no run recorded, one unfinished, one that
 * read other answers than the review does, one that took fewer documents than the check needs, or a
 * document another run kept.
 */
function lastRun(
  purpose: "export" | "check",
  model: string,
  fetched: readonly LiveDocument[],
): RunDocument[] {
  const record = readRunRecord();
  const live = new Set(fetched.map((doc) => doc.id));
  const ids = (record?.ids ?? []).filter((id) => live.has(id));
  const kept = new Map(ids.map((id) => [id, keptDocument(id)] as const));
  const mismatch = runMismatch({
    record: record === undefined ? undefined : { ...record, ids },
    purpose,
    model,
    fetched: [...live],
    stamps: new Map(ids.map((id) => [id, kept.get(id)?.run] as const)),
  });
  if (mismatch !== undefined) throw new Error(mismatch);
  return ids.flatMap((id) => kept.get(id) ?? []);
}

async function runReviewExport(top: number, out: string) {
  if (!Number.isInteger(top) || top < 1) throw new Error("--top takes a whole number of templates");
  if (!exportFolder(out))
    throw new Error(
      "--out names a folder that holds files and no review export: name an empty or new one",
    );
  const config = namingConfig(process.env);
  if (!AnswerSource.safeParse(`model:${config.id}`).success)
    throw new Error("NAMING_MODEL is not a model's id: letters, digits and ._:/@- only");
  const fetched = fetchedDocuments(undefined);
  const documents = lastRun("export", config.id, fetched);
  const cache = new FileAnswerCache({ model: config.id });
  const detector = await leakDetector();
  let plan: Awaited<ReturnType<typeof exportPlan>>;
  try {
    plan = await exportPlan({
      documents,
      top,
      cache: (key) => cache.get(key),
      findLeaks: detector.findLeaks,
      fetched: fetched.length,
    });
  } finally {
    await detector.close();
  }
  rmSync(out, { recursive: true, force: true });
  for (const file of plan.files) writeAtomically(join(out, ...file.path.split("/")), file.text);
  const inFolder = (folder: string, part: string) =>
    plan.files.filter((file) => file.path.startsWith(`${folder}/${part}/`)).length;
  print([
    `${documents.length} of ${fetched.length} fetched documents kept by the last run, ${documents.filter((doc) => doc.request !== undefined).length} with a naming request; the committed answers and ${config.id}'s cache`,
    ...plan.templates.map(
      (template) =>
        `${template.folder}: ${template.documents.length} ${template.documents.length === 1 ? "document" : "documents"}, ${template.keys.length} keys, ${counted(inFolder(template.folder, "requests"), "request")} and ${counted(inFolder(template.folder, "answers"), "answer")} written`,
    ),
    ...plan.withheld.map(
      (each) =>
        `${each.folder}: not written, ${each.kinds[0] === "unchecked" ? "the run kept no text of a document of it to check against" : `the leak check found a document's text in its summary: ${each.kinds.join("; ")}`}`,
    ),
    `Wrote ${plan.files.length} files to ${out}, each checked with the leak detector against every document of its template.`,
  ]);
}

/** The export's templates by the keys their summaries list, from the folder `review export` wrote. */
function exportedTemplates(dir: string): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  let index: { templates?: { folder?: unknown }[] };
  try {
    index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  } catch {
    return byKey;
  }
  for (const template of index.templates ?? []) {
    const folder = template.folder;
    if (typeof folder !== "string" || !/^\d{2,}-[a-z-]+$/.test(folder)) continue;
    try {
      const summary = JSON.parse(readFileSync(join(dir, folder, "template.json"), "utf8")) as {
        macros?: { key?: unknown }[];
      };
      for (const macro of summary.macros ?? [])
        if (typeof macro.key === "string")
          byKey.set(macro.key, [...(byKey.get(macro.key) ?? []), folder]);
    } catch {}
  }
  return byKey;
}

async function runReviewCheck(dir: string) {
  const config = namingConfig(process.env);
  if (!AnswerSource.safeParse(`model:${config.id}`).success)
    throw new Error("NAMING_MODEL is not a model's id: letters, digits and ._:/@- only");
  if (!existsSync(ENGINE_MANIFEST))
    throw new Error("review check compiles on the engine in .engine/: run fetch-engine first");
  const engine = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8")) as EngineManifest;
  const folder = answersFolder();
  const { carriers, others, invalid } = await carriersOf(
    folder.keys.map((key) => ({ key, text: folder.read(key) ?? "" })),
  );
  const fetched = fetchedDocuments(undefined);
  const kept = lastRun("check", config.id, fetched);
  const holders = new Map<string, string[]>();
  for (const doc of kept)
    for (const macro of doc.request?.macros ?? [])
      if (macro.key !== undefined)
        holders.set(macro.key, [...new Set([...(holders.get(macro.key) ?? []), doc.id])]);
  const wanted = new Set(carriers.flatMap((carrier) => holders.get(carrier.key) ?? []));
  const documents = fetched.filter((doc) => wanted.has(doc.id));
  const treeFont = treeFonts(engine.files);
  print([
    `${carriers.length} reviewed ${carriers.length === 1 ? "answer carries" : "answers carry"} redefinitions, and ${others} ${others === 1 ? "carries" : "carry"} none; the last run kept ${kept.length} of ${fetched.length} fetched documents, of which ${documents.length} hold their keys, each assembled again with the committed answers and ${config.id}'s cache, ${poolSize()} at a time`,
  ]);
  const results = new Map<string, Checked>();
  await runPool({
    script: ASSEMBLE_CHILD,
    tasks: documents.map((doc) => ({
      id: doc.id,
      message: () => ({
        name: `${doc.id}.zip`,
        bytes: corpusUpload(doc, treeFont),
        answers: { model: config.id },
        review: true,
      }),
    })),
    size: poolSize(),
    limitMs: runLimitMs(false),
    onResult: (task, result) => {
      const reply = result.reply as
        | {
            run?: RunChildRow;
            review?: Partial<RunDocument>;
            refusal?: { step: RefusalStep; reason: string };
          }
        | undefined;
      const outcome = reply?.run?.outcome ?? (result.timedOut ? "timeout" : "crashed");
      const notes = reply?.review?.notes;
      results.set(task.id, {
        id: task.id,
        outcome,
        applied: notes?.redefinitions.applied ?? [],
        dropped: notes?.redefinitions.dropped ?? [],
        checks: notes?.checks ?? [],
        ...(reply?.refusal === undefined ? {} : { refused: reply.refusal }),
      });
      print([`${results.size}/${documents.length} ${task.id}: ${outcome}`]);
    },
  });
  const verdicts = redefinitionVerdicts({
    carriers,
    holders,
    results,
    templates: exportedTemplates(dir),
  });
  const dropped = verdicts.filter((verdict) => verdict.verdict === "dropped").length;
  const unproven = verdicts.filter((verdict) => verdict.verdict === "unproven").length;
  print(["", ...verdicts.map(verdictLine)]);
  const problems = [
    ...(invalid.length > 0
      ? [
          `${invalid.length} answer ${invalid.length === 1 ? "file does" : "files do"} not validate, or ${invalid.length === 1 ? "is" : "are"} not filed under ${invalid.length === 1 ? "its" : "their"} key: ${invalid.join(", ")}.`,
        ]
      : []),
    ...(dropped > 0
      ? [
          `${dropped} ${dropped === 1 ? "redefinition is" : "redefinitions are"} dropped: take ${dropped === 1 ? "it" : "them"} out of the answers, and list ${dropped === 1 ? "it" : "them"} in the pull request.`,
        ]
      : []),
    ...(unproven > 0
      ? [
          `${unproven} ${unproven === 1 ? "redefinition is" : "redefinitions are"} unproven, no corpus document applying ${unproven === 1 ? "it" : "them"}: list ${unproven === 1 ? "it" : "them"} in the pull request for a person to judge, or take ${unproven === 1 ? "it" : "them"} out.`,
        ]
      : []),
  ];
  print([
    "",
    `${verdicts.length} ${verdicts.length === 1 ? "redefinition" : "redefinitions"}: ${verdicts.length - dropped - unproven} kept, ${unproven} unproven, ${dropped} dropped.`,
  ]);
  if (problems.length > 0) {
    console.error(problems.map(printable).join("\n"));
    process.exitCode = 1;
  }
}

async function main() {
  const args = process.argv.slice(2);
  // `bench` names its model, `--model <id>`, where `name --model` is a flag: the command, which
  // comes first, says which.
  const benching = args[0] === "bench";
  const { values, positionals } = parseArgs({
    args,
    options: {
      only: { type: "string" },
      ids: { type: "string" },
      json: { type: "string" },
      tree: { type: "string" },
      model: benching ? { type: "string" } : { type: "boolean" },
      write: { type: "boolean" },
      "write-baseline": { type: "boolean" },
      from: { type: "string" },
      top: { type: "string" },
      out: { type: "string" },
      dir: { type: "string" },
      thinking: { type: "string" },
      retries: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const [command, ...rest] = positionals;
  // `compare` takes files, `bench` files to set side by side, and `review` what it does; every
  // other command takes no more.
  const review = command === "review" ? rest[0] : undefined;
  if (command === "review" && review !== "export" && review !== "check")
    throw new Error(`review is followed by export or check: ${USAGE}`);
  if (command !== "compare" && command !== "bench" && rest.length > (command === "review" ? 1 : 0))
    throw new Error(
      `${rest.slice(command === "review" ? 1 : 0).join(" ")} is not an option: ${USAGE}`,
    );
  if (
    command !== "collect" &&
    command !== "fetch" &&
    command !== "survey" &&
    command !== "reference" &&
    command !== "parse" &&
    command !== "probe" &&
    command !== "assemble" &&
    command !== "oracle" &&
    command !== "fonts" &&
    command !== "seed" &&
    command !== "name" &&
    command !== "leak" &&
    command !== "run" &&
    command !== "compare" &&
    command !== "review" &&
    command !== "bench"
  )
    throw new Error(command === undefined ? USAGE : `there is no command ${command}: ${USAGE}`);
  if (
    values.only !== undefined &&
    command !== "fetch" &&
    command !== "reference" &&
    command !== "parse" &&
    command !== "probe" &&
    command !== "fonts" &&
    command !== "name" &&
    command !== "assemble" &&
    command !== "leak" &&
    command !== "run" &&
    command !== "bench"
  )
    throw new Error(
      "--only goes with fetch, reference, parse, probe, fonts, name, assemble, leak, run or bench",
    );
  if (
    values.json !== undefined &&
    command !== "survey" &&
    command !== "reference" &&
    command !== "parse" &&
    command !== "probe" &&
    command !== "fonts" &&
    command !== "seed" &&
    command !== "name" &&
    command !== "assemble" &&
    command !== "leak" &&
    command !== "run" &&
    command !== "bench"
  )
    throw new Error(
      "--json goes with survey, reference, parse, probe, fonts, seed, name, assemble, leak, run or bench",
    );
  if (values.model !== undefined && command !== "name" && command !== "bench")
    throw new Error("--model goes with name, or bench with a model's id");
  if (values.tree !== undefined && command !== "survey") throw new Error("--tree goes with survey");
  if (values.write === true && command !== "seed") throw new Error("--write goes with seed");
  if (values.ids !== undefined && command !== "run" && command !== "bench")
    throw new Error("--ids goes with run or bench");
  for (const option of ["thinking", "retries"] as const)
    if (values[option] !== undefined && (command !== "bench" || typeof values.model !== "string"))
      throw new Error(`--${option} goes with bench --model <id>`);
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
  if ((values.top !== undefined || values.out !== undefined) && review !== "export")
    throw new Error("--top and --out go with review export");
  if (values.dir !== undefined && review !== "check")
    throw new Error("--dir goes with review check");
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
  if (command === "bench") {
    const files = rest.map((file) => caller(file) ?? file);
    if (typeof values.model !== "string") {
      if (files.length === 0)
        throw new Error(
          `bench takes --model <id>, or benchmarks' files to set side by side: ${USAGE}`,
        );
      if ([values.only, values.ids, values.json].some((each) => each !== undefined))
        throw new Error("bench <bench.json>... runs nothing, and takes no other option");
      return runBenchCompare(files);
    }
    if (files.length > 0)
      throw new Error(
        "bench --model <id> measures a model, and bench <bench.json>... sets files side by side: pass one or the other",
      );
    return runBench({
      model: values.model,
      ...(values.only === undefined ? {} : { only: values.only }),
      ...(values.ids === undefined ? {} : { ids: caller(values.ids) }),
      ...(values.json === undefined ? {} : { json: caller(values.json) }),
      ...(values.thinking === undefined ? {} : { thinking: values.thinking }),
      ...(values.retries === undefined ? {} : { retries: values.retries }),
    });
  }
  if (review === "export")
    return runReviewExport(
      values.top === undefined ? REVIEW_TOP : Number(values.top),
      caller(values.out) ?? REVIEW_DIR,
    );
  if (review === "check") return runReviewCheck(caller(values.dir) ?? REVIEW_DIR);
  if (command === "reference") return runReference(values.only, caller(values.json));
  if (command === "parse") return runParse(values.only, caller(values.json));
  if (command === "probe") return runProbe(values.only, caller(values.json));
  if (command === "assemble") return runAssemble(values.only, caller(values.json));
  if (command === "oracle") return runOracle();
  if (command === "fonts") return runFonts(values.only, caller(values.json));
  if (command === "seed") return runSeed(caller(values.json), values.write === true);
  if (command === "name") return runName(values.only, caller(values.json), values.model === true);
  if (command === "leak") return runLeak(values.only, caller(values.json));
  return runSurvey(caller(values.json), caller(values.tree));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.split("\n").map(printable).join("\n"));
  process.exitCode = 1;
});
