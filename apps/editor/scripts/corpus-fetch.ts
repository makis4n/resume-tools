/**
 * Fetching the corpus (milestone 3 item 1, decision 0017): every file the manifest names, from
 * GitHub at the document's pinned commit, into `<dir>/<id>/<path>`, eight at a time. Each file is
 * checked against its SHA-256 and size and written only when both match, under a name of its own
 * that is then renamed, so a file on disk is always one that verified. A file already there with
 * the right hash is kept, so a second run downloads nothing.
 *
 * Every run asks GitHub, once for each document, whether its repository is still there and public
 * and still the one collected, files on disk or not, so that a machine that fetched a document long
 * ago learns when it has gone, and a later `collect` there can replace it. A document whose
 * repository is gone, private, blocked or another one now, or one of whose files GitHub no longer
 * has, is unavailable, and its folder is removed: its owner took it down. A file that differs from
 * its hash is an error, and so is one that could not be downloaded at all.
 *
 * A folder holds one document's files: `.pinned` in it names the repository and commit they are
 * from, and a folder without it, or naming another, is emptied before a file is written, so that
 * files a document once under the same id left are never taken for this one's. Once every file
 * of a document verifies, whatever else its folder holds goes. A withdrawn document is not fetched
 * and its folder goes too. The report, `<dir>/fetch-report.json`, gives every document's state and
 * the repository and commit it is about, so that the runner leaves out what is unavailable. Only
 * paths, sizes and hashes are printed, never a file's content, and every line goes through
 * `printable`.
 */

import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type GitHub, Limiter, type Repository } from "./corpus-github.ts";
import {
  type CorpusFile,
  FETCH_STATES,
  FetchReport,
  type FetchState,
  formatJson,
  isLive,
  isSafePath,
  type LiveDocument,
  type Manifest,
  matchingEntries,
  PINNED,
  parseJson,
  printable,
  temporaryName,
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
  /** The file that is the problem, or none when it is the repository or the folder. */
  path?: string;
  message: string;
}

export interface Fetched {
  report: FetchReport;
  /** The documents this run fetched, and how many of them ended in each state. */
  documents: number;
  states: Record<FetchState, number>;
  /** The withdrawn documents it was asked for, which are never fetched. */
  withdrawn: number;
  /** How many repositories GitHub answered for, one for each document fetched. */
  checked: number;
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

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A document's folder in `dir`, or undefined when its id is not one the schema gives, which could
 * name a folder elsewhere: the folder is emptied and removed, so it must be the document's own.
 */
function folderOf(dir: string, id: string): string | undefined {
  const root = resolve(dir);
  const folder = resolve(root, id);
  return /^[a-z]+(?:-[a-z]+)*-\d{4}$/.test(id) && dirname(folder) === root ? folder : undefined;
}

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

/** Fetch one file of a document into its folder, and say what came of it. */
async function fetchFile(
  github: GitHub,
  folder: string,
  doc: LiveDocument,
  file: CorpusFile,
): Promise<"present" | "downloaded" | Omit<Problem, "id" | "repo">> {
  const { path } = file;
  const target = resolve(folder, ...path.split("/"));
  // The schema refused such a path already; this is the check before a file is written.
  if (!isSafePath(path) || !target.startsWith(`${folder}${sep}`))
    return { state: "failed", path, message: "is not a path in the document's folder" };
  if (await present(target, file)) return "present";
  let content: Uint8Array | "gone" | "too-large";
  try {
    // A file longer than its recorded size is not the file recorded: no more of it is read.
    content = await github.file(doc.repo, doc.commit, path, file.bytes);
  } catch (error) {
    return { state: "failed", path, message: messageOf(error) };
  }
  if (content === "gone") return { state: "unavailable", path, message: "is gone from GitHub" };
  if (content === "too-large")
    return { state: "mismatch", path, message: `is over its recorded ${file.bytes} bytes` };
  const digest = sha256(content);
  if (content.length !== file.bytes || digest !== file.sha256)
    return {
      state: "mismatch",
      path,
      message: `is ${content.length} bytes with SHA-256 ${digest}, not the recorded ${file.bytes} bytes and ${file.sha256}`,
    };
  try {
    await mkdir(dirname(target), { recursive: true });
    const partial = temporaryName(target);
    await writeFile(partial, content);
    await rename(partial, target);
  } catch (error) {
    return { state: "failed", path, message: `cannot be written: ${messageOf(error)}` };
  }
  return "downloaded";
}

/**
 * Remove what a document's folder holds that its entry does not name: a stopped run's partial
 * write, or whatever else was put there. Names are compared in NFC, as a disk may give them back
 * in another form than they were written in.
 */
async function removeUnnamed(folder: string, doc: LiveDocument) {
  const named = new Set(doc.files.map((file) => file.path.normalize("NFC")));
  // Whether the folder is left empty, and can go.
  const sweep = async (at: string): Promise<boolean> => {
    let empty = true;
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const inside = join(at, entry.name);
      const path = relative(folder, inside).split(sep).join("/").normalize("NFC");
      if (entry.isDirectory()) {
        if (await sweep(inside)) await rmdir(inside);
        else empty = false;
      } else if (path === PINNED || named.has(path)) empty = false;
      else await rm(inside, { force: true });
    }
    return empty;
  };
  await sweep(folder);
}

/** Fetch a document, as the module's comment says, and say what came of it. */
async function fetchDocument(
  github: GitHub,
  dir: string,
  doc: LiveDocument,
  limiter: Limiter,
): Promise<{ state: FetchState; problems: Problem[]; downloaded: number; checked: boolean }> {
  const problem = (state: Problem["state"], message: string): Problem => ({
    id: doc.id,
    repo: doc.repo,
    state,
    message,
  });
  const folder = folderOf(dir, doc.id);
  if (!folder)
    return {
      state: "failed",
      problems: [problem("failed", "is not an id a folder is made for")],
      downloaded: 0,
      checked: false,
    };
  let info: Repository | undefined;
  try {
    info = await limiter.run(() => github.repository(doc.repo));
  } catch (error) {
    return {
      state: "failed",
      problems: [problem("failed", messageOf(error))],
      downloaded: 0,
      checked: false,
    };
  }
  try {
    if (!info || info.id !== doc.repoId) {
      await rm(folder, { recursive: true, force: true });
      const why = info ? "is another repository now" : "is gone, private or blocked";
      return {
        state: "unavailable",
        problems: [problem("unavailable", why)],
        downloaded: 0,
        checked: true,
      };
    }
    const pinned = `${doc.repo} ${doc.commit}\n`;
    const marker = join(folder, PINNED);
    if ((await readFile(marker, "utf8").catch(() => "")) !== pinned) {
      await rm(folder, { recursive: true, force: true });
      await mkdir(folder, { recursive: true });
      await writeFile(marker, pinned);
    }
    let downloaded = 0;
    const problems: Problem[] = [];
    await Promise.all(
      doc.files.map((file) =>
        limiter.run(async () => {
          const result = await fetchFile(github, folder, doc, file);
          if (result === "downloaded") downloaded++;
          else if (result !== "present") problems.push({ id: doc.id, repo: doc.repo, ...result });
        }),
      ),
    );
    const state = RANK.find((rank) => problems.some((each) => each.state === rank)) ?? "fetched";
    if (state === "unavailable") await rm(folder, { recursive: true, force: true });
    if (state === "fetched") await removeUnnamed(folder, doc);
    return { state, problems, downloaded, checked: true };
  } catch (error) {
    return {
      state: "failed",
      problems: [problem("failed", `its folder cannot be written: ${messageOf(error)}`)],
      downloaded: 0,
      checked: true,
    };
  }
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
  const { github, manifest, dir } = options;
  const log = (line: string) => options.log(printable(line));
  const chosen =
    options.only === undefined
      ? manifest.documents
      : manifest.documents.filter((doc) => doc.id === options.only);
  if (options.only !== undefined && chosen.length === 0)
    throw new Error(`the manifest has no document ${options.only}`);

  // A withdrawn document's files go: its owner took it down.
  const withdrawn = chosen.filter((doc) => !isLive(doc));
  for (const doc of withdrawn) {
    const folder = folderOf(dir, doc.id);
    if (folder) await rm(folder, { recursive: true, force: true });
  }
  const live = chosen.filter(isLive);
  const limiter = new Limiter(options.concurrency ?? 8);
  const results = await Promise.all(
    live.map(async (doc) => {
      const result = await fetchDocument(github, dir, doc, limiter);
      for (const each of result.problems)
        log(
          `${each.id} ${each.repo}: ${each.path === undefined ? "" : `${each.path} `}${each.message}`,
        );
      return { doc, ...result };
    }),
  );

  const states = Object.fromEntries(FETCH_STATES.map((state) => [state, 0])) as Record<
    FetchState,
    number
  >;
  const file = join(dir, "fetch-report.json");
  // What the last report said of the other documents stays, where it is about them as they are.
  const entries = matchingEntries(manifest, previousReport(file));
  for (const { doc, state, problems } of results) {
    states[state]++;
    const paths = problems.flatMap((each) => (each.path === undefined ? [] : [each.path])).sort();
    const { id, repo, commit } = doc;
    entries.set(id, { id, repo, commit, state, ...(paths.length > 0 ? { paths } : {}) });
  }
  const report: FetchReport = {
    version: 1,
    documents: manifest.documents
      .filter(isLive)
      .map(
        ({ id, repo, commit }) =>
          entries.get(id) ?? { id, repo, commit, state: "pending" as const },
      ),
  };
  writeAtomically(file, formatJson(report));

  const files = live.flatMap((doc) => doc.files);
  return {
    report,
    documents: live.length,
    states,
    withdrawn: withdrawn.length,
    checked: results.filter((each) => each.checked).length,
    files: files.length,
    bytes: files.reduce((sum, each) => sum + each.bytes, 0),
    downloaded: results.reduce((sum, each) => sum + each.downloaded, 0),
    problems: results
      .flatMap((each) => each.problems)
      .sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : (a.path ?? "") < (b.path ?? "") ? -1 : 1,
      ),
  };
}
