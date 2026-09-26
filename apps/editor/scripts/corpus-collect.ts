/**
 * Collecting the corpus (milestone 3 item 1, decision 0017): which public LaTeX resumes on GitHub
 * the manifest names, and what of each.
 *
 * Candidates come from code search, eight queries of at most 1,000 files each, of which only the
 * files in repositories GitHub marks public are kept, and from the forks of the five upstream
 * templates: sb2nov/resume and jakegut/resume, which are Jake's Resume and its original,
 * Awesome-CV, AltaCV and moderncv. One classifier reads each candidate's main file and gives it a
 * family (`classify`). A candidate qualifies when its repository is public and its main file is a
 * whole document of 1 KB to 200 KB in Latin script, outside the upstream repositories, and no copy
 * of a main file already taken or of any version of an upstream sample; a fork must also have been
 * pushed to after it was made, and differ from every version of its upstream's samples by more
 * than ten lines. A document of no family of its own, `other`, must look like a resume: named as
 * one by its repository or path, not slides, and naming two of a resume's headings. One document
 * per repository, known by GitHub's number for it as well as its name, so that a renamed one is
 * not taken twice: the first of its main files that qualifies, and none when that one's family is
 * full. Each family is capped, and candidates are taken in the order of the SHA-256 of their
 * repositories' names, which spreads them over GitHub and gives a rerun the same ones.
 *
 * A document is pinned at the commit its repository's default branch is at: its main file, then
 * the classes, packages, sources and bibliographies it loads that its repository holds, followed
 * three files deep, each read no further than the document's 2 MB, the names of the fonts beside
 * the main file and the count of its images, never their content. Before the manifest is written it
 * is checked against its schema, and a document it refuses is not taken. A document the last fetch
 * found unavailable is withdrawn, which frees its place in its family and never its id. Nothing
 * here prints a file's text: only counts, repository names, paths and sizes, and every line goes
 * through `printable`.
 */

import { isWholeDocument, type Reference, references } from "../src/import/source.ts";
import type { GitHub } from "./corpus-github.ts";
import { PER_PAGE } from "./corpus-github.ts";
import {
  type CorpusDocument,
  type CorpusFile,
  diskKey,
  extensionOf,
  FAMILIES,
  type Family,
  type FetchReport,
  FILE_EXTENSIONS,
  FONT_EXTENSIONS,
  firstCounters,
  IMAGE_EXTENSIONS,
  idOf,
  isLive,
  isSafePath,
  type LiveDocument,
  MAX_ASSETS,
  MAX_DOCUMENT_BYTES,
  MAX_FILES,
  Manifest,
  matchingEntries,
  printable,
  refusal,
} from "./corpus-manifest.ts";
import {
  classify,
  comparableLines,
  decode,
  differsByMoreThan,
  isSlides,
  namedAsResume,
  nonLatinShare,
  normalisedHash,
  resumeHeadings,
  sha256,
} from "./corpus-tex.ts";

/** A template whose repository the corpus follows forks of, and the family its documents are. */
export interface Upstream {
  repo: string;
  family: Family;
}

export const UPSTREAMS: readonly Upstream[] = [
  { repo: "sb2nov/resume", family: "jake" },
  { repo: "jakegut/resume", family: "jake" },
  { repo: "posquit0/Awesome-CV", family: "awesome-cv" },
  { repo: "liantze/AltaCV", family: "altacv" },
  { repo: "xdanaux/moderncv", family: "moderncv" },
];

/** The code searches candidates come from; GitHub serves the first 1,000 files of each. */
export const QUERIES: readonly string[] = [
  "resumeSubheading extension:tex",
  "altacv extension:tex",
  "awesome-cv extension:tex",
  "moderncv documentclass extension:tex",
  "europecv extension:tex",
  "filename:resume extension:tex",
  "filename:cv extension:tex",
  '"curriculum vitae" extension:tex',
];

/**
 * The most documents each family holds, so that `other`, the hand-rolled and messy documents that
 * decide the editable rate, is a third of the corpus.
 */
export const CAPS: Readonly<Record<Family, number>> = {
  jake: 50,
  "awesome-cv": 40,
  altacv: 20,
  moderncv: 30,
  europecv: 10,
  other: 70,
};

/** The most documents the corpus holds. */
export const TOTAL = 220;

export const MIN_MAIN_BYTES = 1_000;
export const MAX_MAIN_BYTES = 200_000;
/** A main file whose letters are this share or more outside Latin script is left out. */
export const MAX_NON_LATIN = 0.02;
/** A fork must differ from every version of its upstream's samples by more lines than this. */
export const FORK_LINES = 10;
/** How many files deep a document's loads are followed from its main file. */
export const DEPTH = 3;

/** Search pages per query: GitHub serves ten pages of 100. */
const SEARCH_PAGES = 10;
/** Fork pages per upstream, a bound that the largest, Awesome-CV's 53, is well within. */
const FORK_PAGES = 200;
/** How many candidates ahead of the one being considered have their main files read. */
const LOOKAHEAD = 16;
/** A run stops after this many candidates in a row failed on a request: GitHub is not answering. */
const FAILURES_IN_A_ROW = 10;

/** Why a candidate was not taken. */
export const REASONS = {
  upstream: "one of the five upstream repositories",
  "never-pushed": "a fork never pushed to after it was made",
  "no-document": "no main file with \\documentclass, \\begin{document} and \\end{document}",
  "too-small": "a main file under 1 KB",
  "too-large": "a main file over 200 KB",
  "not-latin": "2% or more of the main file's letters outside Latin script",
  duplicate: "a main file byte-identical to one taken or to a version of an upstream sample",
  "unmodified-fork": "a fork within ten lines of a version of its upstream's samples",
  "not-a-resume":
    "of family other and not named a resume or CV, or slides, or naming under two resume headings",
  "over-caps": "more than 40 files or 2 MB",
  collision: "two files that are one on a disk that ignores case",
  invalid: "a document the manifest's schema refuses",
  unavailable: "the repository or its file is gone, private, blocked, empty or too large to list",
  error: "a request failed",
} as const;
export type Reason = keyof typeof REASONS;

/**
 * How far a main file got through the checks when it failed one, so that a repository whose files
 * all fail is counted under the reason of the one that came closest.
 */
const PROGRESS: Readonly<Partial<Record<Reason, number>>> = {
  unavailable: 0,
  "no-document": 1,
  "too-small": 2,
  "too-large": 2,
  "not-latin": 3,
  duplicate: 4,
  "unmodified-fork": 5,
  "not-a-resume": 6,
  "over-caps": 6,
  collision: 6,
  invalid: 7,
};
const furthest = (so: Reason | undefined, now: Reason): Reason =>
  so === undefined || (PROGRESS[now] ?? 0) > (PROGRESS[so] ?? 0) ? now : so;

/** What a main file is judged against: what is already taken, and what its upstream holds. */
export interface Known {
  /** The normalised hashes of the main files taken and of every version of the upstream samples. */
  hashes: ReadonlySet<string>;
  /** For a fork of an upstream: every version of its samples, as `comparableLines` reads them. */
  versions?: readonly (readonly string[])[];
}

/**
 * Whether a file qualifies as a document's main file, and if so its family and normalised hash;
 * if not, why not. The checks run in the order `PROGRESS` gives. `place` is the repository's name
 * and the file's path, which must name an `other` document as a resume; the headings it must name
 * are counted over all its sources, once they are read (`documentFiles`).
 */
export function judgeMain(
  bytes: Uint8Array,
  known: Known,
  place: string,
): { family: Family; hash: string } | { reason: Reason } {
  const text = decode(bytes);
  if (!isWholeDocument(text)) return { reason: "no-document" };
  if (bytes.length < MIN_MAIN_BYTES) return { reason: "too-small" };
  if (bytes.length > MAX_MAIN_BYTES) return { reason: "too-large" };
  if (nonLatinShare(text) >= MAX_NON_LATIN) return { reason: "not-latin" };
  const hash = normalisedHash(bytes);
  if (known.hashes.has(hash)) return { reason: "duplicate" };
  if (known.versions) {
    const lines = comparableLines(text);
    if (known.versions.some((version) => !differsByMoreThan(lines, version, FORK_LINES)))
      return { reason: "unmodified-fork" };
  }
  const family = classify(text);
  if (family === "other" && (isSlides(text) || !namedAsResume(place)))
    return { reason: "not-a-resume" };
  return { family, hash };
}

const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const depthOf = (path: string) => path.split("/").length - 1;
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Whether a path may be a document's main file: a `.tex` file the manifest may hold, but not a
 * cover letter, which is not a resume whatever class it loads, and not a file of a TeX
 * distribution's tree, which is a package's own sample or documentation.
 */
export const mayBeMain = (path: string) =>
  isSafePath(path) &&
  extensionOf(path) === ".tex" &&
  !/letter/i.test(nameOf(path)) &&
  !path.split("/").some((part) => part.toLowerCase().startsWith("texmf"));

/**
 * The order a repository's candidate main files are tried in: the shallower first, then one named
 * as a resume or a CV, then by path.
 */
export function mainOrder(a: string, b: string): number {
  const named = (path: string) => (namedAsResume(nameOf(path)) ? 0 : 1);
  return depthOf(a) - depthOf(b) || named(a) - named(b) || byCodeUnits(a, b);
}

/**
 * The order candidates are considered in: by the SHA-256 of the repository's name, in lower case
 * since GitHub's names ignore case, which is as stable as the name's own order and does not favour
 * owners whose names begin with a digit or an a.
 */
export const candidateKey = (repo: string) => sha256(new TextEncoder().encode(repo.toLowerCase()));

/** The folders above a folder, the nearest first, ending with the repository's root, "". */
function ancestors(folder: string): string[] {
  const above: string[] = [];
  for (let at = folder; at !== ""; ) {
    at = folderOf(at);
    above.push(at);
  }
  return above;
}

/**
 * A name taken from a folder, with `.` and `..` worked out, as a path in the repository; undefined
 * when it would leave the repository or is not a path the manifest may hold.
 */
export function joinPath(folder: string, name: string): string | undefined {
  const parts: string[] = [];
  for (const part of [...folder.split("/"), ...name.split("/")]) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.pop() === undefined) return undefined;
  }
  const path = parts.join("/");
  return isSafePath(path) ? path : undefined;
}

/**
 * The file of the repository a reference names, if the repository has it. A class or package is
 * taken from the main file's folder, the folders above it or the caller's folder, or else from
 * wherever in the repository a file of its name is, the shallowest first; a source or bibliography
 * from the main file's folder, which is TeX's working folder, or else the caller's, the other way
 * round for `\subimport`. A name without an extension gets `.cls`, `.sty`, `.tex` or `.bib`, as
 * TeX gives it; one whose extension the corpus does not fetch is left out, and so is a path the
 * manifest may not hold, wherever it was found.
 */
export function resolveReference(
  reference: Reference,
  caller: string,
  main: string,
  files: ReadonlySet<string>,
): string | undefined {
  const mainFolder = folderOf(main);
  const callerFolder = folderOf(caller);
  const first = (paths: (string | undefined)[]) =>
    paths.find((path): path is string => path !== undefined && files.has(path));
  const { kind, name } = reference;
  if (kind === "class" || kind === "package") {
    const extension = kind === "class" ? ".cls" : ".sty";
    const file = name.endsWith(extension) ? name : `${name}${extension}`;
    if (file.includes("/"))
      return first([joinPath(mainFolder, file), joinPath(callerFolder, file)]);
    const near = [mainFolder, ...ancestors(mainFolder), callerFolder];
    return (
      first(near.map((folder) => joinPath(folder, file))) ??
      [...files]
        .filter((path) => nameOf(path) === file && isSafePath(path))
        .sort((a, b) => depthOf(a) - depthOf(b) || byCodeUnits(a, b))[0]
    );
  }
  const extension = kind === "bibliography" ? ".bib" : ".tex";
  const file =
    extensionOf(name) === extension ||
    (kind === "input" && FILE_EXTENSIONS.includes(extensionOf(name)))
      ? name
      : `${name}${extension}`;
  if (!FILE_EXTENSIONS.includes(extensionOf(file))) return undefined;
  const folders = reference.fromCaller ? [callerFolder, mainFolder] : [mainFolder, callerFolder];
  return first(folders.map((folder) => joinPath(folder, file)));
}

/**
 * The fonts in the main file's folder and the folders under it, by path, at most 200, and how
 * many images are there, which are counted and never named: an image's name, a photo's most of
 * all, can say whose it is. A PDF named as the main file is, beside it, is the document compiled,
 * not an image it shows.
 */
export function assetsOf(
  files: readonly string[],
  main: string,
): { assets: string[]; images: number } {
  const folder = folderOf(main);
  const output = joinPath(folder, `${nameOf(main).replace(/\.tex$/i, "")}.pdf`);
  const beside = files.filter(
    (path) =>
      (folder === "" || path.startsWith(`${folder}/`)) && path !== output && isSafePath(path),
  );
  return {
    assets: beside
      .filter((path) => FONT_EXTENSIONS.includes(extensionOf(path)))
      .sort(byCodeUnits)
      .slice(0, MAX_ASSETS),
    images: beside.filter((path) => IMAGE_EXTENSIONS.includes(extensionOf(path))).length,
  };
}

/**
 * A document's files: its main file, then every file of the repository it loads that the corpus
 * fetches, followed `DEPTH` files deep, each read at the commit, hashed and sized; and the text of
 * its `.tex` sources, for the checks, which is never kept. More than `MAX_FILES` files or
 * `MAX_DOCUMENT_BYTES` bytes is a reason not to take it, found before more than the bytes left are
 * read, and so are two files that would be one on a disk that ignores case.
 */
export async function documentFiles(
  github: GitHub,
  at: { repo: string; commit: string },
  main: { path: string; bytes: Uint8Array },
  sizes: ReadonlyMap<string, number>,
): Promise<{ files: CorpusFile[]; sources: string[] } | { reason: Reason }> {
  const files: CorpusFile[] = [
    { path: main.path, sha256: sha256(main.bytes), bytes: main.bytes.length },
  ];
  let bytes = main.bytes.length;
  const paths = new Set(sizes.keys());
  const seen = new Set([main.path]);
  const onDisk = new Set([diskKey(main.path)]);
  const queue = [{ path: main.path, depth: 0, text: decode(main.bytes) }];
  const sources = [queue[0]?.text ?? ""];
  for (let file = queue.shift(); file; file = queue.shift()) {
    if (file.depth >= DEPTH) continue;
    for (const reference of references(file.text)) {
      const path = resolveReference(reference, file.path, main.path, paths);
      if (path === undefined || seen.has(path)) continue;
      seen.add(path);
      if (onDisk.has(diskKey(path))) return { reason: "collision" };
      onDisk.add(diskKey(path));
      if (files.length >= MAX_FILES || bytes + (sizes.get(path) ?? 0) > MAX_DOCUMENT_BYTES)
        return { reason: "over-caps" };
      const content = await github.file(at.repo, at.commit, path, MAX_DOCUMENT_BYTES - bytes);
      if (content === "gone") return { reason: "unavailable" };
      if (content === "too-large") return { reason: "over-caps" };
      bytes += content.length;
      files.push({ path, sha256: sha256(content), bytes: content.length });
      if (extensionOf(path) === ".bib") continue;
      const text = decode(content);
      queue.push({ path, depth: file.depth + 1, text });
      if (extensionOf(path) === ".tex") sources.push(text);
    }
  }
  return { files, sources };
}

/** An upstream's samples: every version of each, as the checks read them. */
interface Samples {
  hashes: Set<string>;
  versions: string[][];
}

/**
 * An upstream template's samples, the whole documents at its root and under `examples/`, in every
 * version its default branch has had, from its latest 100 commits to each: where it is now and, for
 * one under `examples/`, at the root, where an older layout may have kept it. A fork made years ago
 * and never edited holds an old version, which is as much the upstream's sample as the current one.
 */
async function readSamples(github: GitHub, upstream: Upstream, log: (line: string) => void) {
  const info = await github.repository(upstream.repo);
  const head = info && (await github.head(info.repo, info.defaultBranch));
  const tree = info && head && (await github.tree(info.repo, head.tree));
  if (!info || !head || !tree)
    throw new Error(`the upstream ${upstream.repo} cannot be read from GitHub`);
  const samples: Samples = { hashes: new Set(), versions: [] };
  const add = (bytes: Uint8Array | string) => {
    if (typeof bytes === "string") return;
    const hash = normalisedHash(bytes);
    if (samples.hashes.has(hash)) return;
    samples.hashes.add(hash);
    samples.versions.push(comparableLines(decode(bytes)));
  };
  const paths: string[] = [];
  for (const { path } of tree.files) {
    if (extensionOf(path) !== ".tex" || (path.includes("/") && !path.startsWith("examples/")))
      continue;
    const bytes = await github.file(info.repo, head.commit, path, MAX_MAIN_BYTES);
    if (typeof bytes === "string" || !isWholeDocument(decode(bytes))) continue;
    paths.push(path);
    add(bytes);
  }
  const places = new Set(paths.flatMap((path) => [path, nameOf(path)]));
  for (const place of places) {
    const commits = await github.history(info.repo, place);
    const versions = commits.map((sha) => github.file(info.repo, sha, place, MAX_MAIN_BYTES));
    for (const bytes of await Promise.all(versions)) add(bytes);
  }
  log(
    `  ${info.repo} at ${head.commit.slice(0, 7)}: ${paths.length} ${paths.length === 1 ? "sample" : "samples"}, ${samples.versions.length} versions`,
  );
  return samples;
}

/** A repository that might hold a document. */
interface Candidate {
  repo: string;
  /** The `.tex` files code search found in it. */
  paths: Set<string>;
  /** For a fork of an upstream: which, and whether anything was pushed to it after it was made. */
  fork?: { upstream: Upstream; pushed: boolean };
}

/** A main file a code search's candidate's screen passed, and its family. */
interface Passed {
  path: string;
  family: Family;
}

/** What screening a code search's candidate came to. */
type Screen = { passed: Passed[]; complete: boolean } | { reason: Reason };

/**
 * What considering a repository came to. `full` is a repository the first of whose main files to
 * qualify is of a full family, or could only be; `reserve` says whether it could be `other`, which
 * may get more room at the end.
 */
type Outcome =
  | { taken: LiveDocument }
  | { reason: Reason }
  | { full: Family; path: string; reserve: boolean }
  | { before: true };

export interface CollectOptions {
  github: GitHub;
  log: (line: string) => void;
  /** The day, as `collected` records it. */
  today: string;
  /** The manifest to extend, whose documents and ids stay as they are, but for withdrawals. */
  manifest?: Manifest;
  /**
   * The last fetch's report: a document it found unavailable, by an entry about the document the
   * manifest has under that id, is withdrawn, and leaves room in its family.
   */
  report?: FetchReport;
  /** Called with the manifest after each change, so that a stopped run keeps its work. */
  save?: (manifest: Manifest) => void;
  upstreams?: readonly Upstream[];
  queries?: readonly string[];
  caps?: Readonly<Record<Family, number>>;
  total?: number;
}

export interface Collected {
  manifest: Manifest;
  added: LiveDocument[];
  /** The ids withdrawn by this run. */
  withdrawn: string[];
  /** Candidate repositories, from code search and from the upstreams' forks. */
  candidates: { search: number; forks: number };
  /** Files code search found in repositories that are not public, which were left out. */
  hidden: number;
  /** Candidates not taken, by why. */
  rejected: Partial<Record<Reason, number>>;
  /** Candidates that qualified, or could only have, but found their family at its cap. */
  full: number;
  /** Candidates never considered, since every family was at its cap first. */
  left: number;
  /** Families short of their caps at the end, by how many documents. */
  short: Partial<Record<Family, number>>;
}

/**
 * Build or extend the manifest: every document it has stays, with its id, but for the ones the
 * last fetch found unavailable, which are withdrawn; new ones are appended in the order they are
 * taken, under ids from each family's counter, which never gives an id twice.
 */
export async function collect(options: CollectOptions): Promise<Collected> {
  const { github } = options;
  const log = (line: string) => options.log(printable(line));
  const upstreams = options.upstreams ?? UPSTREAMS;
  const queries = options.queries ?? QUERIES;
  const baseCaps = options.caps ?? CAPS;
  const caps: Record<Family, number> = { ...baseCaps };
  const total = options.total ?? TOTAL;
  const counters = { ...(options.manifest?.counters ?? firstCounters()) };
  const added: LiveDocument[] = [];

  // A document the last fetch found unavailable is withdrawn: its entry keeps its id and family,
  // so that the id is never given again, and nothing that says whose it was.
  const entries = options.manifest ? matchingEntries(options.manifest, options.report) : undefined;
  const withdrawn: string[] = [];
  const documents: CorpusDocument[] = (options.manifest?.documents ?? []).map((doc) => {
    if (!isLive(doc) || entries?.get(doc.id)?.state !== "unavailable") return doc;
    log(`${doc.id} ${doc.repo}: withdrawn, since the last fetch found it unavailable`);
    withdrawn.push(doc.id);
    return { id: doc.id, family: doc.family, withdrawn: true };
  });
  const taken = documents.filter(isLive);

  const counts = Object.fromEntries(FAMILIES.map((family) => [family, 0])) as Record<
    Family,
    number
  >;
  for (const doc of taken) counts[doc.family]++;
  const size = () => FAMILIES.reduce((sum, family) => sum + counts[family], 0);
  const full = (family: Family) => counts[family] >= caps[family] || size() >= total;
  const done = () => FAMILIES.every(full);
  const repos = new Set(taken.map((doc) => doc.repo.toLowerCase()));
  const repoIds = new Set(taken.map((doc) => doc.repoId));
  const upstreamOf = new Map(upstreams.map((upstream) => [upstream.repo.toLowerCase(), upstream]));
  const rejected: Partial<Record<Reason, number>> = {};
  let notTaken = 0;
  let failures = 0;

  const manifest = (): Manifest => ({
    version: 1,
    collected:
      added.length > 0 || withdrawn.length > 0
        ? options.today
        : (options.manifest?.collected ?? options.today),
    counters: { ...counters },
    documents: [...documents],
  });
  if (withdrawn.length > 0) options.save?.(manifest());

  log("Reading the upstream templates' samples, in every version");
  const hashes = new Set<string>();
  const samples = new Map<Upstream, Samples>();
  for (const upstream of upstreams) {
    const read = await readSamples(github, upstream, log);
    samples.set(upstream, read);
    for (const hash of read.hashes) hashes.add(hash);
  }
  if (taken.length > 0) {
    log(`Reading the main files of the manifest's ${taken.length} documents`);
    const mains = await Promise.all(
      taken.map((doc) => github.file(doc.repo, doc.commit, doc.main, MAX_MAIN_BYTES)),
    );
    for (const bytes of mains) if (typeof bytes !== "string") hashes.add(normalisedHash(bytes));
  }

  const candidates = new Map<string, Candidate>();
  const candidate = (repo: string) => {
    const key = repo.toLowerCase();
    const found = candidates.get(key) ?? { repo, paths: new Set<string>() };
    candidates.set(key, found);
    return found;
  };
  log("Searching GitHub's code, 10 requests a minute");
  let hidden = 0;
  for (const query of queries) {
    const before = candidates.size;
    let found = 0;
    let unlisted = 0;
    for (let page = 1; page <= SEARCH_PAGES; page++) {
      const { total: matches, hits, hidden: left } = await github.searchCode(query, page);
      for (const hit of hits)
        if (extensionOf(hit.path) === ".tex") candidate(hit.repo).paths.add(hit.path);
      found += hits.length;
      unlisted += left;
      // A page can come back short while more follow, when the search ran out of time.
      if (hits.length + left === 0 || page * PER_PAGE >= matches) break;
    }
    hidden += unlisted;
    const fresh = plural(candidates.size - before, "repository", "repositories");
    const left =
      unlisted > 0 ? `, ${plural(unlisted, "file")} in repositories not public left out` : "";
    log(`  ${query}: ${plural(found, "file")}, ${fresh} not seen before${left}`);
  }
  const fromSearch = candidates.size;
  log("Listing the upstream templates' forks");
  for (const upstream of upstreams) {
    let listed = 0;
    let pushed = 0;
    for (let page = 1; page <= FORK_PAGES; page++) {
      const forks = await github.forks(upstream.repo, page);
      for (const fork of forks) {
        const since =
          fork.pushedAt !== null && Date.parse(fork.pushedAt) > Date.parse(fork.createdAt);
        candidate(fork.repo).fork = { upstream, pushed: since };
        listed++;
        if (since) pushed++;
      }
      if (forks.length < PER_PAGE) break;
    }
    log(`  ${upstream.repo}: ${listed} forks, ${pushed} of them pushed to after they were made`);
  }
  const order = [...candidates.values()]
    .map((found) => ({ found, key: candidateKey(found.repo) }))
    .sort((a, b) => byCodeUnits(a.key, b.key) || byCodeUnits(a.found.repo, b.found.repo))
    .map(({ found }) => found);
  log(
    `${order.length} candidate repositories, ${fromSearch} from code search and ${order.length - fromSearch} forks, considered in the order of their names' SHA-256`,
  );

  /**
   * Which of a code search's candidate's main files pass the checks at HEAD, and their families,
   * in the order they are tried. It stops at one whose family has room, since the candidate is
   * examined then, and says whether it read them all.
   */
  const screen = async (found: Candidate): Promise<Screen> => {
    let why: Reason | undefined;
    const passed: Passed[] = [];
    const paths = [...found.paths].filter(mayBeMain).sort(mainOrder);
    try {
      for (const path of paths) {
        const bytes = await github.file(found.repo, "HEAD", path, MAX_MAIN_BYTES);
        const verdict =
          typeof bytes === "string"
            ? { reason: bytes === "gone" ? ("unavailable" as const) : ("too-large" as const) }
            : judgeMain(bytes, { hashes }, `${found.repo}/${path}`);
        if ("reason" in verdict) {
          why = furthest(why, verdict.reason);
          continue;
        }
        passed.push({ path, family: verdict.family });
        if (!full(verdict.family)) return { passed, complete: false };
      }
    } catch (error) {
      log(`  ${found.repo}: ${messageOf(error)}`);
      return { reason: "error" };
    }
    return passed.length > 0 ? { passed, complete: true } : { reason: why ?? "no-document" };
  };
  const screens = new Map<Candidate, Promise<Screen>>();
  const screened = (found: Candidate) => {
    const running = screens.get(found) ?? screen(found);
    screens.set(found, running);
    return running;
  };
  const passedOver = (found: Candidate) =>
    repos.has(found.repo.toLowerCase()) || upstreamOf.has(found.repo.toLowerCase());

  /**
   * Pin a candidate at its default branch's head, and take the first of its main files that
   * qualifies, with what it loads, unless its family is full: a fork's from its root and
   * `examples/`, a code search's from the files the search found, the one its screen passed first.
   */
  const examine = async (found: Candidate, chosen: string | undefined): Promise<Outcome> => {
    const info = await github.repository(found.repo);
    if (!info) return { reason: "unavailable" };
    // A repository taken before, under this name or one it has been renamed from since.
    if (repoIds.has(info.id) || repos.has(info.repo.toLowerCase())) return { before: true };
    if (upstreamOf.has(info.repo.toLowerCase())) return { reason: "upstream" };
    const upstream =
      found.fork?.upstream ?? (info.source ? upstreamOf.get(info.source.toLowerCase()) : undefined);
    const head = await github.head(info.repo, info.defaultBranch);
    const tree = head && (await github.tree(info.repo, head.tree));
    if (!head || !tree || tree.truncated) return { reason: "unavailable" };
    const sizes = new Map(tree.files.map((file) => [file.path, file.size]));
    const mains = (
      found.fork
        ? [...sizes.keys()].filter(
            (path) => mayBeMain(path) && (!path.includes("/") || path.startsWith("examples/")),
          )
        : [...found.paths].filter((path) => mayBeMain(path) && sizes.has(path))
    ).sort((a, b) => Number(b === chosen) - Number(a === chosen) || mainOrder(a, b));
    if (mains.length === 0) return { reason: found.fork ? "no-document" : "unavailable" };
    const known: Known = { hashes, versions: upstream && samples.get(upstream)?.versions };
    let why: Reason | undefined;
    for (const path of mains) {
      if ((sizes.get(path) ?? 0) > MAX_MAIN_BYTES) {
        why = furthest(why, "too-large");
        continue;
      }
      const bytes = await github.file(info.repo, head.commit, path, MAX_MAIN_BYTES);
      if (typeof bytes === "string") {
        why = furthest(why, bytes === "gone" ? "unavailable" : "too-large");
        continue;
      }
      const verdict = judgeMain(bytes, known, `${info.repo}/${path}`);
      if ("reason" in verdict) {
        why = furthest(why, verdict.reason);
        continue;
      }
      const at = { repo: info.repo, commit: head.commit };
      const files = await documentFiles(github, at, { path, bytes }, sizes);
      if ("reason" in files) {
        why = furthest(why, files.reason);
        continue;
      }
      // A resume names its sections, if not always in its main file.
      if (verdict.family === "other" && resumeHeadings(files.sources) < 2) {
        why = furthest(why, "not-a-resume");
        continue;
      }
      const { family, hash } = verdict;
      const doc: LiveDocument = {
        id: idOf(family, counters[family]),
        family,
        repo: info.repo,
        repoId: info.id,
        commit: head.commit,
        license: info.license,
        main: path,
        files: files.files,
        ...assetsOf([...sizes.keys()], path),
      };
      // The manifest is written only as its schema takes it: a document it refuses is not taken.
      const refused = refusal(Manifest, {
        ...manifest(),
        counters: { ...counters, [family]: counters[family] + 1 },
        documents: [...documents, doc],
      });
      if (refused !== "") {
        log(`  ${info.repo} ${path}: the manifest's schema refuses it: ${refused}`);
        why = furthest(why, "invalid");
        continue;
      }
      // This is the repository's document: if its family is full, the repository is not taken.
      if (full(family)) return { full: family, path, reserve: family === "other" };
      counters[family]++;
      documents.push(doc);
      added.push(doc);
      counts[family]++;
      repos.add(doc.repo.toLowerCase());
      repoIds.add(doc.repoId);
      hashes.add(hash);
      return { taken: doc };
    }
    return { reason: why ?? "no-document" };
  };

  /** Candidates passed over while `other` was full that could be `other`, for when it gets more room. */
  const reserve: { found: Candidate; path: string }[] = [];
  const settle = (found: Candidate, outcome: Outcome, keep: boolean) => {
    if ("taken" in outcome) {
      const { id, repo, main, files, license } = outcome.taken;
      const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
      log(
        `${id} ${repo} ${main}: ${files.length} ${files.length === 1 ? "file" : "files"}, ${(bytes / 1e3).toFixed(1)} KB, ${license ?? "no licence"}`,
      );
      options.save?.(manifest());
    } else if ("reason" in outcome) rejected[outcome.reason] = (rejected[outcome.reason] ?? 0) + 1;
    if ("reason" in outcome && outcome.reason === "error") {
      if (++failures >= FAILURES_IN_A_ROW)
        throw new Error(`${failures} candidates in a row failed on a request; stopping`);
    } else failures = 0;
    if ("full" in outcome) {
      notTaken++;
      if (keep && outcome.reserve && !found.fork) reserve.push({ found, path: outcome.path });
    }
  };
  /**
   * Consider a candidate: `chosen` is a main file its screen passed first, when it is examined
   * again at the end, and `keep` whether to reserve it for `other`.
   */
  const consider = async (found: Candidate, chosen?: string, keep = true) => {
    try {
      if (found.fork) {
        if (!found.fork.pushed) settle(found, { reason: "never-pushed" }, keep);
        // A fork is examined only while its upstream's family has room, as it is almost always
        // of that family; examining one costs three requests of the hourly 5,000.
        else if (full(found.fork.upstream.family)) notTaken++;
        else settle(found, await examine(found, undefined), keep);
        return;
      }
      if (chosen !== undefined) return settle(found, await examine(found, chosen), keep);
      const first = await screened(found);
      if ("reason" in first) return settle(found, first, keep);
      const [lead] = first.passed;
      if (!lead) return settle(found, { reason: "no-document" }, keep);
      // Examining a candidate takes it, if at all, as the family of a file its screen passed, so
      // when the screen read every file and each one it passed is of a full family, examining it
      // could take nothing, and costs three requests of the hourly 5,000 to find so.
      if (first.complete && first.passed.every(({ family }) => full(family))) {
        const other = first.passed.some(({ family }) => family === "other");
        return settle(found, { full: lead.family, path: lead.path, reserve: other }, keep);
      }
      settle(found, await examine(found, lead.path), keep);
    } catch (error) {
      log(`  ${found.repo}: ${messageOf(error)}`);
      return settle(found, { reason: "error" }, keep);
    }
  };

  let left = 0;
  for (const [index, found] of order.entries()) {
    if (done()) {
      left = order.length - index;
      break;
    }
    for (const next of order.slice(index, index + LOOKAHEAD))
      if (!next.fork && !passedOver(next)) void screened(next);
    if (passedOver(found)) {
      if (upstreamOf.has(found.repo.toLowerCase())) settle(found, { reason: "upstream" }, true);
    } else await consider(found);
    screens.delete(found);
    if ((index + 1) % 500 === 0)
      log(`  ${index + 1} of ${order.length} candidates considered, ${size()} documents`);
  }
  // Screens started ahead of where the run stopped have nothing left to decide.
  await Promise.allSettled(screens.values());

  // Every candidate has been considered and a family is still short of its cap: `other` takes
  // the room it leaves, from the candidates it passed over for being full, in the same order.
  const shortfall = FAMILIES.filter((family) => family !== "other").reduce(
    (sum, family) => sum + Math.max(0, caps[family] - counts[family]),
    0,
  );
  if (left === 0 && shortfall > 0 && reserve.length > 0) {
    caps.other += shortfall;
    log(`Other families are ${shortfall} short of their caps; other takes their room`);
    for (const { found, path } of reserve) {
      if (full("other")) break;
      notTaken--;
      await consider(found, path, false);
    }
  }
  const short: Partial<Record<Family, number>> = {};
  for (const family of FAMILIES)
    if (counts[family] < baseCaps[family]) short[family] = baseCaps[family] - counts[family];
  return {
    manifest: manifest(),
    added,
    withdrawn,
    candidates: { search: fromSearch, forks: order.length - fromSearch },
    hidden,
    rejected,
    full: notTaken,
    left,
    short,
  };
}
