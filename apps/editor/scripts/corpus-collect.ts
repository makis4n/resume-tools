/**
 * Collecting the corpus (milestone 3 item 1, decision 0017): which public LaTeX resumes on GitHub
 * the manifest names, and what of each.
 *
 * Candidates come from code search, eight queries of at most 1,000 files each, and from the forks
 * of the five upstream templates: sb2nov/resume and jakegut/resume, which are Jake's Resume and
 * its original, Awesome-CV, AltaCV and moderncv. One classifier reads each candidate's main file
 * and gives it a family (`classify`). A candidate qualifies when its main file is a whole document
 * of 1 KB to 200 KB in Latin script, outside the upstream repositories, and no copy of a main file
 * already taken or of any version of an upstream sample; a fork must also have been pushed to
 * after it was made, and differ from every version of its upstream's samples by more than ten
 * lines. A document of no family of its own, `other`, must look like a resume: named as one by its
 * repository or path, not slides, and naming two of a resume's headings. One document per
 * repository. Each family is capped, and candidates are taken in the order of their repositories'
 * names, so that a rerun takes the same ones.
 *
 * A document is pinned at the commit its repository's default branch is at: its main file, then
 * the classes, packages, sources and bibliographies it loads that its repository holds, followed
 * three files deep, and the names of the fonts and images beside the main file, never their
 * content. Nothing here prints a file's text: only counts, repository names, paths and sizes.
 */

import type { GitHub } from "./corpus-github.ts";
import { PER_PAGE } from "./corpus-github.ts";
import {
  ASSET_EXTENSIONS,
  type CorpusDocument,
  type CorpusFile,
  extensionOf,
  FAMILIES,
  type Family,
  FILE_EXTENSIONS,
  isSafePath,
  MAX_ASSETS,
  MAX_DOCUMENT_BYTES,
  MAX_FILES,
  type Manifest,
} from "./corpus-manifest.ts";
import {
  classify,
  comparableLines,
  decode,
  differsByMoreThan,
  isSlides,
  isWholeDocument,
  namedAsResume,
  nonLatinShare,
  normalisedHash,
  type Reference,
  references,
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
/** How many candidates ahead of the one being considered have their main file read. */
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
  unavailable: "the repository or its file is gone, empty, blocked or too large to list",
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

/**
 * Whether a path may be a document's main file: a `.tex` file, but not a cover letter, which is
 * not a resume whatever class it loads, and not a file of a TeX distribution's tree, which is a
 * package's own sample or documentation.
 */
export const mayBeMain = (path: string) =>
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
 * TeX gives it; one whose extension the corpus does not fetch is left out.
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
        .filter((path) => nameOf(path) === file)
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
 * The fonts and images in the main file's folder and the folders under it, by path, at most 200.
 * A PDF named as the main file is, beside it, is the document compiled, not an image it shows.
 */
export function assetsOf(files: readonly string[], main: string): string[] {
  const folder = folderOf(main);
  const output = joinPath(folder, `${nameOf(main).replace(/\.tex$/i, "")}.pdf`);
  return files
    .filter(
      (path) =>
        (folder === "" || path.startsWith(`${folder}/`)) &&
        ASSET_EXTENSIONS.includes(extensionOf(path)) &&
        path !== output &&
        isSafePath(path),
    )
    .sort(byCodeUnits)
    .slice(0, MAX_ASSETS);
}

/**
 * A document's files: its main file, then every file of the repository it loads that the corpus
 * fetches, followed `DEPTH` files deep, each read at the commit, hashed and sized; and the text of
 * its `.tex` sources, for the checks, which is never kept. More than `MAX_FILES` files or
 * `MAX_DOCUMENT_BYTES` bytes is a reason not to take it.
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
  const queue = [{ path: main.path, depth: 0, text: decode(main.bytes) }];
  const sources = [queue[0]?.text ?? ""];
  for (let file = queue.shift(); file; file = queue.shift()) {
    if (file.depth >= DEPTH) continue;
    for (const reference of references(file.text)) {
      const path = resolveReference(reference, file.path, main.path, paths);
      if (path === undefined || seen.has(path)) continue;
      seen.add(path);
      if (files.length >= MAX_FILES || bytes + (sizes.get(path) ?? 0) > MAX_DOCUMENT_BYTES)
        return { reason: "over-caps" };
      const content = await github.file(at.repo, at.commit, path);
      if (!content) return { reason: "unavailable" };
      bytes += content.length;
      if (bytes > MAX_DOCUMENT_BYTES) return { reason: "over-caps" };
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
  const add = (bytes: Uint8Array | undefined) => {
    if (!bytes) return;
    const hash = normalisedHash(bytes);
    if (samples.hashes.has(hash)) return;
    samples.hashes.add(hash);
    samples.versions.push(comparableLines(decode(bytes)));
  };
  const paths: string[] = [];
  for (const { path } of tree.files) {
    if (extensionOf(path) !== ".tex" || (path.includes("/") && !path.startsWith("examples/")))
      continue;
    const bytes = await github.file(info.repo, head.commit, path);
    if (!bytes || !isWholeDocument(decode(bytes))) continue;
    paths.push(path);
    add(bytes);
  }
  const places = new Set(paths.flatMap((path) => [path, nameOf(path)]));
  for (const place of places) {
    const commits = await github.history(info.repo, place);
    for (const bytes of await Promise.all(commits.map((sha) => github.file(info.repo, sha, place))))
      add(bytes);
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

/** What considering a repository came to. */
type Outcome =
  | { taken: CorpusDocument }
  | { reason: Reason }
  | { full: Family; path: string }
  | { before: true };

export interface CollectOptions {
  github: GitHub;
  log: (line: string) => void;
  /** The day, as `collected` records it. */
  today: string;
  /** The manifest to extend, whose documents and ids stay as they are. */
  manifest?: Manifest;
  /** Documents the last fetch found unavailable, which leave room in their families. */
  unavailable?: ReadonlySet<string>;
  /** Called with the manifest after each document taken, so that a stopped run keeps its work. */
  save?: (manifest: Manifest) => void;
  upstreams?: readonly Upstream[];
  queries?: readonly string[];
  caps?: Readonly<Record<Family, number>>;
  total?: number;
}

export interface Collected {
  manifest: Manifest;
  added: CorpusDocument[];
  /** Candidate repositories, from code search and from the upstreams' forks. */
  candidates: { search: number; forks: number };
  /** Candidates not taken, by why. */
  rejected: Partial<Record<Reason, number>>;
  /** Candidates that qualified but found their family at its cap. */
  full: number;
  /** Candidates never considered, since every family was at its cap first. */
  left: number;
  /** Families short of their caps at the end, by how many documents. */
  short: Partial<Record<Family, number>>;
}

/**
 * Build or extend the manifest: every document it has stays, with its id, and new ones are
 * appended in the order they are taken, each family's ids counting on from its highest.
 */
export async function collect(options: CollectOptions): Promise<Collected> {
  const { github, log } = options;
  const upstreams = options.upstreams ?? UPSTREAMS;
  const queries = options.queries ?? QUERIES;
  const baseCaps = options.caps ?? CAPS;
  const caps: Record<Family, number> = { ...baseCaps };
  const total = options.total ?? TOTAL;
  const unavailable = options.unavailable ?? new Set<string>();
  const documents = [...(options.manifest?.documents ?? [])];
  const added: CorpusDocument[] = [];

  const counts = Object.fromEntries(FAMILIES.map((family) => [family, 0])) as Record<
    Family,
    number
  >;
  const counters = { ...counts };
  for (const doc of documents) {
    if (!unavailable.has(doc.id)) counts[doc.family]++;
    counters[doc.family] = Math.max(counters[doc.family], Number(doc.id.slice(-4)));
  }
  const size = () => FAMILIES.reduce((sum, family) => sum + counts[family], 0);
  const full = (family: Family) => counts[family] >= caps[family] || size() >= total;
  const done = () => FAMILIES.every(full);
  const repos = new Set(documents.map((doc) => doc.repo.toLowerCase()));
  const upstreamOf = new Map(upstreams.map((upstream) => [upstream.repo.toLowerCase(), upstream]));
  const rejected: Partial<Record<Reason, number>> = {};
  let notTaken = 0;
  let failures = 0;

  log("Reading the upstream templates' samples, in every version");
  const hashes = new Set<string>();
  const samples = new Map<Upstream, Samples>();
  for (const upstream of upstreams) {
    const read = await readSamples(github, upstream, log);
    samples.set(upstream, read);
    for (const hash of read.hashes) hashes.add(hash);
  }
  if (documents.length > 0) {
    log(`Reading the main files of the manifest's ${documents.length} documents`);
    const mains = await Promise.all(
      documents.map((doc) => github.file(doc.repo, doc.commit, doc.main)),
    );
    for (const bytes of mains) if (bytes) hashes.add(normalisedHash(bytes));
  }

  const candidates = new Map<string, Candidate>();
  const candidate = (repo: string) => {
    const key = repo.toLowerCase();
    const found = candidates.get(key) ?? { repo, paths: new Set<string>() };
    candidates.set(key, found);
    return found;
  };
  log("Searching GitHub's code, 10 requests a minute");
  for (const query of queries) {
    const before = candidates.size;
    let found = 0;
    for (let page = 1; page <= SEARCH_PAGES; page++) {
      const { total: matches, hits } = await github.searchCode(query, page);
      for (const hit of hits)
        if (extensionOf(hit.path) === ".tex") candidate(hit.repo).paths.add(hit.path);
      found += hits.length;
      // A page can come back short while more follow, when the search ran out of time.
      if (hits.length === 0 || page * PER_PAGE >= matches) break;
    }
    log(`  ${query}: ${found} files, ${candidates.size - before} repositories not seen before`);
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
  const order = [...candidates.values()].sort(
    (a, b) =>
      byCodeUnits(a.repo.toLowerCase(), b.repo.toLowerCase()) || byCodeUnits(a.repo, b.repo),
  );
  log(
    `${order.length} candidate repositories, ${fromSearch} from code search and ${order.length - fromSearch} forks, considered by name`,
  );

  /** Where the main file of a code search's candidate is, as far as the file at HEAD says. */
  const screen = async (
    found: Candidate,
  ): Promise<{ path: string; family: Family } | { reason: Reason }> => {
    let why: Reason | undefined;
    const paths = [...found.paths].filter(mayBeMain).sort(mainOrder);
    try {
      for (const path of paths) {
        const bytes = await github.file(found.repo, "HEAD", path);
        const verdict = bytes
          ? judgeMain(bytes, { hashes }, `${found.repo}/${path}`)
          : { reason: "unavailable" as const };
        if ("family" in verdict) return { path, family: verdict.family };
        why = furthest(why, verdict.reason);
      }
    } catch (error) {
      log(`  ${found.repo}: ${error instanceof Error ? error.message : error}`);
      return { reason: "error" };
    }
    return { reason: why ?? "no-document" };
  };
  const screens = new Map<Candidate, ReturnType<typeof screen>>();
  const screened = (found: Candidate) => {
    const running = screens.get(found) ?? screen(found);
    screens.set(found, running);
    return running;
  };
  const passedOver = (found: Candidate) =>
    repos.has(found.repo.toLowerCase()) || upstreamOf.has(found.repo.toLowerCase());

  /**
   * Pin a candidate at its default branch's head, and take the first of its main files that
   * qualifies, with what it loads: a fork's from its root and `examples/`, a code search's from
   * the files the search found, the one its screen chose first.
   */
  const examine = async (found: Candidate, chosen: string | undefined): Promise<Outcome> => {
    const info = await github.repository(found.repo);
    if (!info) return { reason: "unavailable" };
    // A repository renamed since the search is known by its new name.
    if (repos.has(info.repo.toLowerCase())) return { before: true };
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
      const bytes = await github.file(info.repo, head.commit, path);
      const verdict = bytes
        ? judgeMain(bytes, known, `${info.repo}/${path}`)
        : { reason: "unavailable" as const };
      if ("reason" in verdict) {
        why = furthest(why, verdict.reason);
        continue;
      }
      if (full(verdict.family)) return { full: verdict.family, path };
      const at = { repo: info.repo, commit: head.commit };
      const files = bytes && (await documentFiles(github, at, { path, bytes }, sizes));
      if (!files || "reason" in files) {
        why = furthest(why, files ? files.reason : "unavailable");
        continue;
      }
      // A resume names its sections, if not always in its main file.
      if (verdict.family === "other" && resumeHeadings(files.sources) < 2) {
        why = furthest(why, "not-a-resume");
        continue;
      }
      const { family, hash } = verdict;
      counters[family]++;
      const doc: CorpusDocument = {
        id: `${family}-${String(counters[family]).padStart(4, "0")}`,
        family,
        repo: info.repo,
        commit: head.commit,
        license: info.license,
        main: path,
        files: files.files,
        assets: assetsOf([...sizes.keys()], path),
      };
      documents.push(doc);
      added.push(doc);
      counts[family]++;
      repos.add(doc.repo.toLowerCase());
      hashes.add(hash);
      return { taken: doc };
    }
    return { reason: why ?? "no-document" };
  };

  const manifest = (): Manifest => ({
    version: 1,
    collected: added.length > 0 ? options.today : (options.manifest?.collected ?? options.today),
    documents,
  });
  /** `other` candidates passed over for a full family, in order, for when it gets more room. */
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
      if (keep && outcome.full === "other" && !found.fork)
        reserve.push({ found, path: outcome.path });
    }
  };
  /** Consider a candidate: `chosen` is a main file its screen chose earlier, `keep` whether to reserve it. */
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
      const first = chosen === undefined ? await screened(found) : { path: chosen };
      if ("reason" in first) settle(found, first, keep);
      else if ("family" in first && full(first.family))
        settle(found, { full: first.family, path: first.path }, keep);
      else settle(found, await examine(found, first.path), keep);
    } catch (error) {
      log(`  ${found.repo}: ${error instanceof Error ? error.message : error}`);
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
    candidates: { search: fromSearch, forks: order.length - fromSearch },
    rejected,
    full: notTaken,
    left,
    short,
  };
}
