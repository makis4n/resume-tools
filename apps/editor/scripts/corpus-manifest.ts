/**
 * The corpus's manifest and the fetch's report (milestone 3 item 1, decision 0017).
 *
 * The corpus is a few hundred public LaTeX resumes: real people's documents, public by their
 * owners' choice and mostly under no licence, so the repository keeps their sources and never
 * their content. For each document the manifest names a GitHub repository, the commit its default
 * branch was at when the document was collected, and each file to fetch with its size and SHA-256,
 * so that `corpus.ts fetch` gets the same bytes on every machine or refuses them. What `fetch`
 * writes goes under `.corpus/`, which git ignores.
 *
 * Every path is a path in the repository, relative, with `/` between its parts; the schema refuses
 * any other, and `fetch` checks each again before it writes, since a path becomes a file on disk.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

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

/** What an asset may be: a font file or an image. Assets are named, never fetched. */
export const ASSET_EXTENSIONS: readonly string[] = [
  ".otf",
  ".ttf",
  ".pfb",
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
/** A document names at most this many assets. */
export const MAX_ASSETS = 200;

/**
 * Whether a path is one the manifest may hold: relative, parts joined by `/`, none of them empty,
 * `.` or `..`, and no backslash or control character anywhere, so that it names a file inside the
 * folder it is joined to on every system.
 */
export function isSafePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\") || /\p{Cc}/u.test(path))
    return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** A path's extension in lower case with its dot, or "" when its name has none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

const Path = z
  .string()
  .refine(
    isSafePath,
    "a path is relative and uses /, with no empty, . or .. part, no backslash and no control character",
  );

const CorpusFile = z.strictObject({
  path: Path,
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "a SHA-256 is 64 lower-case hex digits"),
  bytes: z.number().int().nonnegative(),
});
export type CorpusFile = z.infer<typeof CorpusFile>;

const CorpusDocument = z
  .strictObject({
    id: z.string(),
    family: z.enum(FAMILIES),
    repo: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, "a repository is owner/name"),
    commit: z.string().regex(/^[0-9a-f]{40}$/, "a commit is 40 lower-case hex digits"),
    /** The SPDX id GitHub reports for the repository; null when it reports none or NOASSERTION. */
    license: z
      .string()
      .min(1)
      .refine((id) => id !== "NOASSERTION", "NOASSERTION is recorded as null")
      .nullable(),
    main: Path,
    files: z.array(CorpusFile).min(1).max(MAX_FILES),
    assets: z.array(Path).max(MAX_ASSETS),
  })
  .superRefine((doc, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (!new RegExp(`^${doc.family}-\\d{4}$`).test(doc.id))
      issue(`${doc.id}: an id is its family, a dash and four digits`);
    if (doc.files[0]?.path !== doc.main) issue(`${doc.id}: the main file comes first`);
    const paths = doc.files.map((file) => file.path);
    if (new Set(paths).size !== paths.length) issue(`${doc.id}: a file is listed twice`);
    for (const path of paths)
      if (!FILE_EXTENSIONS.includes(extensionOf(path)))
        issue(`${doc.id}: ${path} is not a file the corpus fetches`);
    for (const path of doc.assets)
      if (!ASSET_EXTENSIONS.includes(extensionOf(path)))
        issue(`${doc.id}: ${path} is not a font or an image`);
    const bytes = doc.files.reduce((sum, file) => sum + file.bytes, 0);
    if (bytes > MAX_DOCUMENT_BYTES)
      issue(`${doc.id}: ${bytes} bytes of files, over ${MAX_DOCUMENT_BYTES}`);
  });
export type CorpusDocument = z.infer<typeof CorpusDocument>;

export const Manifest = z
  .strictObject({
    version: z.literal(1),
    /** The day of the last collection that added documents. */
    collected: z.iso.date(),
    /** In the order they were collected, which later collections append to. */
    documents: z.array(CorpusDocument),
  })
  .superRefine((manifest, ctx) => {
    const ids = new Set<string>();
    const repos = new Set<string>();
    for (const { id, repo } of manifest.documents) {
      if (ids.has(id)) ctx.addIssue({ code: "custom", message: `${id} is used twice` });
      // One document per repository, and GitHub's names ignore case.
      if (repos.has(repo.toLowerCase()))
        ctx.addIssue({ code: "custom", message: `${repo} has two documents` });
      ids.add(id);
      repos.add(repo.toLowerCase());
    }
  });
export type Manifest = z.infer<typeof Manifest>;

/**
 * What the last fetch found for each document: `fetched`, every file present and verified;
 * `unavailable`, a file or the repository is gone; `mismatch`, a file differs from its hash;
 * `failed`, a file could not be downloaded; `pending`, not fetched yet. `paths` names the files
 * that made a document other than fetched.
 */
export const FETCH_STATES = ["fetched", "unavailable", "mismatch", "failed", "pending"] as const;
export type FetchState = (typeof FETCH_STATES)[number];

export const FetchReport = z.strictObject({
  version: z.literal(1),
  documents: z.array(
    z.strictObject({
      id: z.string(),
      state: z.enum(FETCH_STATES),
      paths: z.array(z.string()).optional(),
    }),
  ),
});
export type FetchReport = z.infer<typeof FetchReport>;

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
 * Write a file under another name and rename it into place, so that a run stopped while writing
 * leaves the old file or the new one, never part of one. Its folder is made if need be.
 */
export function writeAtomically(file: string, data: string | Uint8Array) {
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.partial-${process.pid}`;
  writeFileSync(partial, data);
  renameSync(partial, file);
}
