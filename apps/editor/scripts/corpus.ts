/**
 * The corpus of public LaTeX resumes the import pipeline is measured on (milestone 3 item 1,
 * decision 0017):
 *
 *   pnpm --filter @resume-tools/editor corpus collect
 *   pnpm --filter @resume-tools/editor corpus fetch [--only <id>]
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
 *                 whose repository is gone, private or blocked is reported unavailable. It takes the
 *                 token `gh` has, which it needs for GitHub's rate: one request for each document
 *   --only <id>   fetch that document only
 *
 * The documents are real people's resumes, so `.corpus/` is ignored by git, and the commands print
 * counts, repository names, paths, hashes and sizes, never a document's text, and every line they
 * print goes through `printable`, so that a file's name cannot put an escape to the terminal.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { collect, REASONS, type Reason } from "./corpus-collect.ts";
import { fetchCorpus } from "./corpus-fetch.ts";
import { GitHub } from "./corpus-github.ts";
import {
  CORPUS_DIR,
  FAMILIES,
  FETCH_REPORT_FILE,
  FetchReport,
  formatJson,
  isLive,
  MANIFEST_FILE,
  Manifest,
  parseJson,
  printable,
  writeAtomically,
} from "./corpus-manifest.ts";

const USAGE = "pnpm --filter @resume-tools/editor corpus collect | fetch [--only <id>]";

/** The corpus holds at least this many documents, and at least this many of them are `other`. */
const MIN_DOCUMENTS = 200;
const MIN_OTHER = 60;

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
  const token = ghToken();
  if (!token)
    throw new Error(
      "collect searches GitHub's code, which needs a token: run `gh auth login` first",
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
    github: new GitHub({ token: ghToken(), log: console.log }),
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

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { only: { type: "string" }, help: { type: "boolean", short: "h" } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const [command, ...rest] = positionals;
  if (rest.length > 0) throw new Error(`${rest.join(" ")} is not an option: ${USAGE}`);
  if (command === "fetch") return runFetch(values.only);
  if (command === "collect" && values.only === undefined) return runCollect();
  if (command === "collect") throw new Error("--only goes with fetch");
  throw new Error(command === undefined ? USAGE : `there is no command ${command}: ${USAGE}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.split("\n").map(printable).join("\n"));
  process.exitCode = 1;
});
