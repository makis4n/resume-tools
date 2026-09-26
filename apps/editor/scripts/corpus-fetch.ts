/**
 * Fetching the corpus (milestone 3 item 1, decision 0017): every file the manifest names, from
 * GitHub at the document's pinned commit, into `<dir>/<id>/<path>`, eight at a time. Each file is
 * checked against its SHA-256 and size and written only when both match, under another name that
 * is then renamed, so a file on disk is always one that verified. A file already there with the
 * right hash is kept, so a second run downloads nothing.
 *
 * A file GitHub no longer has, or whose repository is gone, makes its document unavailable; a file
 * that differs from its hash is an error, and so is one that could not be downloaded at all. The
 * report, `<dir>/fetch-report.json`, gives every document's state, so that the runner leaves out
 * what is unavailable. Only paths, sizes and hashes are printed, never a file's content.
 */

import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { type GitHub, Limiter } from "./corpus-github.ts";
import {
  type CorpusDocument,
  type CorpusFile,
  FETCH_STATES,
  FetchReport,
  type FetchState,
  formatJson,
  isSafePath,
  type Manifest,
  parseJson,
  writeAtomically,
} from "./corpus-manifest.ts";
import { sha256 } from "./corpus-tex.ts";

export interface FetchOptions {
  github: GitHub;
  manifest: Manifest;
  /** The folder the documents go in: `.corpus/`, or a test's own. */
  dir: string;
  /** Fetch this document only; the report keeps what it said of the others. */
  only?: string;
  log: (line: string) => void;
  /** Files fetched at once, 8 unless said. */
  concurrency?: number;
}

/** A document that is not fetched, and why. */
export interface Problem {
  id: string;
  repo: string;
  state: Exclude<FetchState, "fetched" | "pending">;
  path: string;
  message: string;
}

export interface Fetched {
  report: FetchReport;
  /** The documents this run fetched, and how many of them ended in each state. */
  documents: number;
  states: Record<FetchState, number>;
  /** Every file those documents name, and their bytes, and how many were downloaded this time. */
  files: number;
  bytes: number;
  downloaded: number;
  problems: Problem[];
}

/**
 * A document's state is the first of these any of its files came to, so that a document with a
 * mismatch is a mismatch whatever else; with none of them it is fetched.
 */
const RANK = ["mismatch", "failed", "unavailable"] as const;

/** Whether a file is on disk as a regular file with the manifest's size and hash. */
async function present(target: string, file: CorpusFile): Promise<boolean> {
  try {
    const entry = await lstat(target);
    if (!entry.isFile() || entry.size !== file.bytes) return false;
    return sha256(await readFile(target)) === file.sha256;
  } catch {
    return false;
  }
}

/** Fetch one file of a document, and say what came of it. */
async function fetchFile(
  github: GitHub,
  dir: string,
  doc: CorpusDocument,
  file: CorpusFile,
): Promise<"present" | "downloaded" | Omit<Problem, "id" | "repo">> {
  const { path } = file;
  const folder = resolve(dir, doc.id);
  const target = resolve(folder, ...path.split("/"));
  // The schema refused such a path already; this is the check before a file is written.
  if (!isSafePath(path) || !target.startsWith(`${folder}${sep}`))
    return { state: "failed", path, message: "is not a path in the document's folder" };
  if (await present(target, file)) return "present";
  let content: Uint8Array | undefined;
  try {
    content = await github.file(doc.repo, doc.commit, path);
  } catch (error) {
    return {
      state: "failed",
      path,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (!content) return { state: "unavailable", path, message: "is gone from GitHub" };
  const digest = sha256(content);
  if (content.length !== file.bytes || digest !== file.sha256)
    return {
      state: "mismatch",
      path,
      message: `is ${content.length} bytes with SHA-256 ${digest}, not the recorded ${file.bytes} bytes and ${file.sha256}`,
    };
  await mkdir(dirname(target), { recursive: true });
  const partial = `${target}.partial-${process.pid}`;
  await writeFile(partial, content);
  await rename(partial, target);
  return "downloaded";
}

/** The report a previous run left, or none if there is none or it cannot be read. */
function previousReport(file: string): FetchReport | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return parseJson(FetchReport, readFileSync(file, "utf8"), file);
  } catch {
    return undefined;
  }
}

/** Fetch the manifest's documents, or one of them, and write the report. */
export async function fetchCorpus(options: FetchOptions): Promise<Fetched> {
  const { github, manifest, dir, log } = options;
  const chosen =
    options.only === undefined
      ? manifest.documents
      : manifest.documents.filter((doc) => doc.id === options.only);
  if (options.only !== undefined && chosen.length === 0)
    throw new Error(`the manifest has no document ${options.only}`);

  const problems: Problem[] = [];
  let downloaded = 0;
  const limiter = new Limiter(options.concurrency ?? 8);
  await Promise.all(
    chosen.flatMap((doc) =>
      doc.files.map((file) =>
        limiter.run(async () => {
          const result = await fetchFile(github, dir, doc, file);
          if (result === "downloaded") downloaded++;
          else if (result !== "present") {
            problems.push({ id: doc.id, repo: doc.repo, ...result });
            log(`${doc.id} ${doc.repo}: ${result.path} ${result.message}`);
          }
        }),
      ),
    ),
  );

  const states = Object.fromEntries(FETCH_STATES.map((state) => [state, 0])) as Record<
    FetchState,
    number
  >;
  const file = join(dir, "fetch-report.json");
  const entries = new Map(previousReport(file)?.documents.map((entry) => [entry.id, entry]));
  for (const doc of chosen) {
    const own = problems.filter((problem) => problem.id === doc.id);
    const state = RANK.find((rank) => own.some((problem) => problem.state === rank)) ?? "fetched";
    states[state]++;
    const paths = own.map((problem) => problem.path).sort();
    entries.set(doc.id, paths.length > 0 ? { id: doc.id, state, paths } : { id: doc.id, state });
  }
  const report: FetchReport = {
    version: 1,
    documents: manifest.documents.map(
      (doc) => entries.get(doc.id) ?? { id: doc.id, state: "pending" },
    ),
  };
  writeAtomically(file, formatJson(report));

  const files = chosen.flatMap((doc) => doc.files);
  return {
    report,
    documents: chosen.length,
    states,
    files: files.length,
    bytes: files.reduce((sum, each) => sum + each.bytes, 0),
    downloaded,
    problems: problems.sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : a.path < b.path ? -1 : 1,
    ),
  };
}
