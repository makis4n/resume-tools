/**
 * The corpus's manifest and the fetch's report (milestone 3 item 1, decision 0017).
 *
 * The corpus is a few hundred public LaTeX resumes: real people's documents, public by their
 * owners' choice and mostly under no licence, so the repository keeps their sources and never
 * their content. For each document the manifest names a public GitHub repository, by name and by
 * GitHub's number for it, the commit its default branch was at when the document was collected,
 * and each file to fetch with its size and SHA-256, so that `corpus.ts fetch` gets the same bytes
 * on every machine or refuses them. It names the fonts beside the document and only counts the
 * images, whose names can say whose they are. A document whose repository went away is withdrawn:
 * its entry keeps its id and family and nothing else, so that the id is never given again. What
 * `fetch` writes goes under `.corpus/`, which git ignores.
 *
 * Every path is a path in the repository, relative, with `/` between its parts; the schema refuses
 * any other, and a document two of whose paths would be one file on a disk that ignores case or
 * Unicode normalisation. `fetch` checks each path again before it writes, since a path becomes a
 * file on disk.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isSafePath as isSafeUploadPath } from "../src/import/paths.ts";

/** The committed manifest. */
export const MANIFEST_FILE = fileURLToPath(new URL("../corpus/manifest.json", import.meta.url));

/** Where `fetch` puts the documents, one folder per id, and its report. Ignored by git. */
export const CORPUS_DIR = fileURLToPath(new URL("../.corpus", import.meta.url));

/** The fetch's report, which says for every document whether it could be fetched. */
export const FETCH_REPORT_FILE = join(CORPUS_DIR, "fetch-report.json");

/**
 * The families a document belongs to: the four templates the corpus follows forks of, europecv,
 * and every other document, hand-rolled or from any other template.
 */
export const FAMILIES = ["jake", "awesome-cv", "altacv", "moderncv", "europecv", "other"] as const;
export type Family = (typeof FAMILIES)[number];

/**
 * What a document's files may be: TeX sources, classes and packages, the definition, option and
 * font definition files classes load, and bibliographies.
 */
export const FILE_EXTENSIONS: readonly string[] = [
  ".tex",
  ".cls",
  ".sty",
  ".def",
  ".clo",
  ".fd",
  ".bib",
];

/** The fonts a document's folder holds, which the manifest names and never fetches. */
export const FONT_EXTENSIONS: readonly string[] = [".otf", ".ttf", ".pfb"];

/** The images it holds, which the manifest counts and never names: a name can say whose they are. */
export const IMAGE_EXTENSIONS: readonly string[] = [
  ".png",
  ".jpg",
  ".jpeg",
  ".pdf",
  ".eps",
  ".svg",
];

/** A document's files, the main file among them, are at most this many. */
export const MAX_FILES = 40;
/** And at most this many bytes together. */
export const MAX_DOCUMENT_BYTES = 2_000_000;
/** A document names at most this many fonts. */
export const MAX_ASSETS = 200;

/** The file in a document's folder that names the repository and commit its files are from. */
export const PINNED = ".pinned";

/**
 * Whether a path is one the manifest may hold: relative, parts joined by `/`, none of them empty,
 * `.`, `..` or the marker file's name, and no backslash or control character anywhere, so that it
 * names a file inside the folder it is joined to on every system and never the marker. It is the
 * import pipeline's rule for a path in an upload (`src/import/paths.ts`), and the marker besides.
 */
export const isSafePath = (path: string): boolean =>
  isSafeUploadPath(path) && !path.split("/").includes(PINNED);

/** A path's extension in lower case with its dot, or "" when its name has none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * A path as a disk that ignores case and Unicode normalisation sees it, as macOS's and Windows'
 * do unless told otherwise: two paths with the same key are one file there.
 */
export const diskKey = (path: string) => path.normalize("NFC").toLowerCase();

/** The first of the paths that is one file with a path before it on such a disk, if any. */
export function collision(paths: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const path of paths) {
    const key = diskKey(path);
    if (seen.has(key)) return path;
    seen.add(key);
  }
  return undefined;
}

/**
 * Text as the terminal may be given it: every control character written as its code point, so
 * that a hostile file name cannot move the cursor, set the window's title or start any other
 * escape, and a line stays one line. Everything the corpus's scripts print goes through it.
 */
export const printable = (text: string) =>
  text.replace(
    /\p{Cc}/gu,
    (char) => `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`,
  );

const Path = z
  .string()
  .refine(
    isSafePath,
    "a path is relative and uses /, with no empty, . or .. part, no backslash and no control character",
  );

export const CorpusFile = z.strictObject({
  path: Path,
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "a SHA-256 is 64 lower-case hex digits"),
  bytes: z.number().int().nonnegative(),
});
export type CorpusFile = z.infer<typeof CorpusFile>;

/** A document taken and still there when it was last looked for. */
const LiveDocument = z
  .strictObject({
    id: z.string(),
    family: z.enum(FAMILIES),
    withdrawn: z.undefined().optional(),
    repo: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, "a repository is owner/name"),
    /** GitHub's number for the repository, which stays when the repository is renamed. */
    repoId: z.number().int().positive(),
    commit: z.string().regex(/^[0-9a-f]{40}$/, "a commit is 40 lower-case hex digits"),
    /** The SPDX id GitHub reports for the repository; null when it reports none or NOASSERTION. */
    license: z
      .string()
      .min(1)
      .refine((id) => id !== "NOASSERTION", "NOASSERTION is recorded as null")
      .nullable(),
    main: Path,
    files: z.array(CorpusFile).min(1).max(MAX_FILES),
    /** The fonts in the main file's folder and the folders under it, by path. */
    assets: z.array(Path).max(MAX_ASSETS),
    /** How many images are there, never which. */
    images: z.number().int().nonnegative(),
  })
  .superRefine((doc, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (doc.files[0]?.path !== doc.main) issue(`${doc.id}: the main file comes first`);
    const paths = doc.files.map((file) => file.path);
    if (new Set(paths).size !== paths.length) issue(`${doc.id}: a file is listed twice`);
    else {
      const same = collision(paths);
      if (same !== undefined)
        issue(`${doc.id}: ${same} is another of its files on a disk that ignores case`);
    }
    for (const path of paths)
      if (!FILE_EXTENSIONS.includes(extensionOf(path)))
        issue(`${doc.id}: ${path} is not a file the corpus fetches`);
    for (const path of doc.assets)
      if (!FONT_EXTENSIONS.includes(extensionOf(path))) issue(`${doc.id}: ${path} is not a font`);
    const bytes = doc.files.reduce((sum, file) => sum + file.bytes, 0);
    if (bytes > MAX_DOCUMENT_BYTES)
      issue(`${doc.id}: ${bytes} bytes of files, over ${MAX_DOCUMENT_BYTES}`);
  });
export type LiveDocument = z.infer<typeof LiveDocument>;

/**
 * A document withdrawn because its repository was gone, private or blocked when last fetched: its
 * id and family, which are never given to another, and nothing that says whose it was.
 */
const WithdrawnDocument = z.strictObject({
  id: z.string(),
  family: z.enum(FAMILIES),
  withdrawn: z.literal(true),
});
export type WithdrawnDocument = z.infer<typeof WithdrawnDocument>;

const CorpusDocument = z.discriminatedUnion("withdrawn", [LiveDocument, WithdrawnDocument]);
export type CorpusDocument = z.infer<typeof CorpusDocument>;

export const isLive = (doc: CorpusDocument): doc is LiveDocument => doc.withdrawn !== true;

/** The number an id counts to: `jake-0007` is 7. */
export const idNumber = (id: string) => Number(id.slice(id.lastIndexOf("-") + 1));

/** An id as `collect` gives it: the family, a dash and the counter in four digits. */
export const idOf = (family: Family, number: number) =>
  `${family}-${String(number).padStart(4, "0")}`;

export const Manifest = z
  .strictObject({
    version: z.literal(1),
    /** The day of the last collection that added or withdrew documents. */
    collected: z.iso.date(),
    /** Each family's next id number: an id is given once, and never again, withdrawn or not. */
    counters: z.record(z.enum(FAMILIES), z.number().int().positive()),
    /** In the order they were collected, which later collections append to. */
    documents: z.array(CorpusDocument),
  })
  .superRefine((manifest, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const ids = new Set<string>();
    const repos = new Set<string>();
    const repoIds = new Set<number>();
    for (const doc of manifest.documents) {
      const { id, family } = doc;
      if (!new RegExp(`^${family}-\\d{4}$`).test(id))
        issue(`${id}: an id is its family, a dash and four digits`);
      else if (idNumber(id) >= manifest.counters[family])
        issue(`${id}: the counter of ${family} is ${manifest.counters[family]}, not past it`);
      if (ids.has(id)) issue(`${id} is used twice`);
      ids.add(id);
      if (!isLive(doc)) continue;
      // One document per repository: GitHub's names ignore case, and a renamed one keeps its number.
      if (repos.has(doc.repo.toLowerCase())) issue(`${doc.repo} has two documents`);
      if (repoIds.has(doc.repoId)) issue(`repository ${doc.repoId} has two documents`);
      repos.add(doc.repo.toLowerCase());
      repoIds.add(doc.repoId);
    }
  });
export type Manifest = z.infer<typeof Manifest>;

/** The counters of a manifest that has no documents yet: every family starts at 1. */
export const firstCounters = () =>
  Object.fromEntries(FAMILIES.map((family) => [family, 1])) as Record<Family, number>;

/**
 * What the last fetch found for each document: `fetched`, every file present and verified;
 * `unavailable`, the repository is gone, private, blocked or another one now, or a file is gone;
 * `mismatch`, a file differs from its hash; `failed`, a request failed; `pending`, not fetched yet.
 * Each entry names the repository and commit it is about, so that it is not taken for a document
 * a later manifest gives the same id; `paths` names the files that made a document other than
 * fetched. A withdrawn document is not fetched and has no entry.
 */
export const FETCH_STATES = ["fetched", "unavailable", "mismatch", "failed", "pending"] as const;
export type FetchState = (typeof FETCH_STATES)[number];

const ReportEntry = z.strictObject({
  id: z.string(),
  repo: z.string(),
  commit: z.string(),
  state: z.enum(FETCH_STATES),
  paths: z.array(z.string()).optional(),
});
export type ReportEntry = z.infer<typeof ReportEntry>;

export const FetchReport = z.strictObject({
  version: z.literal(1),
  documents: z.array(ReportEntry),
});
export type FetchReport = z.infer<typeof FetchReport>;

/**
 * The report's entries that are about the manifest's documents as it has them now, by id: an entry
 * whose repository or commit differs from its document's is about another document, and is left
 * out, and so is one for an id the manifest does not have or has withdrawn.
 */
export function matchingEntries(
  manifest: Manifest,
  report: FetchReport | undefined,
): Map<string, ReportEntry> {
  const live = new Map(manifest.documents.filter(isLive).map((doc) => [doc.id, doc]));
  const entries = new Map<string, ReportEntry>();
  for (const entry of report?.documents ?? []) {
    const doc = live.get(entry.id);
    if (doc && doc.repo === entry.repo && doc.commit === entry.commit) entries.set(entry.id, entry);
  }
  return entries;
}

/** Parse a manifest or a report from its text, naming the file in what it refuses. */
export function parseJson<T>(schema: z.ZodType<T>, text: string, file: string): T {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not JSON: ${error instanceof Error ? error.message : error}`);
  }
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`${file} is refused:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/** What a schema refuses in a value, on one line; empty when it takes it. */
export function refusal<T>(schema: z.ZodType<T>, value: unknown): string {
  const result = schema.safeParse(value);
  return result.success
    ? ""
    : result.error.issues
        .map((issue) =>
          issue.path.length > 0 ? `${issue.message} at ${issue.path.join(".")}` : issue.message,
        )
        .join("; ");
}

/**
 * JSON as Biome formats it, so that `pnpm format` leaves a written manifest as it is: two spaces
 * of indentation, every object expanded, and an array of scalars on one line when that line,
 * indentation and comma included, fits in 100 columns, else one item a line.
 */
export function formatJson(value: unknown): string {
  const lines = (item: unknown, indent: string, head: string, tail: string): string[] => {
    if (Array.isArray(item)) {
      if (item.length === 0) return [`${indent}${head}[]${tail}`];
      if (item.every((each) => each === null || typeof each !== "object")) {
        const line = `${indent}${head}[${item.map((each) => JSON.stringify(each)).join(", ")}]${tail}`;
        if ([...line].length <= 100) return [line];
      }
      return [
        `${indent}${head}[`,
        ...item.flatMap((each, i) =>
          lines(each, `${indent}  `, "", i < item.length - 1 ? "," : ""),
        ),
        `${indent}]${tail}`,
      ];
    }
    if (item !== null && typeof item === "object") {
      const entries = Object.entries(item).filter(([, each]) => each !== undefined);
      if (entries.length === 0) return [`${indent}${head}{}${tail}`];
      return [
        `${indent}${head}{`,
        ...entries.flatMap(([key, each], i) =>
          lines(each, `${indent}  `, `${JSON.stringify(key)}: `, i < entries.length - 1 ? "," : ""),
        ),
        `${indent}}${tail}`,
      ];
    }
    return [`${indent}${head}${JSON.stringify(item)}${tail}`];
  };
  return `${lines(value, "", "", "").join("\n")}\n`;
}

/**
 * The name a file is written under before it is renamed into place: its own, beside it, so that
 * two writes, of one process or of two, never share one.
 */
export const temporaryName = (file: string) => `${file}.${randomBytes(6).toString("hex")}.partial`;

/**
 * Write a file under another name and rename it into place, so that a run stopped while writing
 * leaves the old file or the new one, never part of one. Its folder is made if need be.
 */
export function writeAtomically(file: string, data: string | Uint8Array) {
  mkdirSync(dirname(file), { recursive: true });
  const partial = temporaryName(file);
  writeFileSync(partial, data);
  renameSync(partial, file);
}
