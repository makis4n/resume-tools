/**
 * The naming step's cache on disk (milestone 3 item 9, decision 0027), the corpus runner's: an
 * `AnswerCache` over two folders, `<key>.json` a stored answer each. `corpus/answers/`, the
 * committed answers a person reviewed, the seed among them (decision 0024), is read and never
 * written; a folder of each model's own under `.corpus/cache/`, which git ignores, is where that
 * model's answers are filed and read back, so that a candidate model swapped in is asked afresh
 * rather than served another's answers, and each answer's source is the folder's model. `get`
 * looks in the committed folder first, so that a reviewed answer always wins; `put` files only a
 * stored answer this naming version reads, under its own key (`storable`), only in the model's
 * folder, and only under a key neither folder holds, never over another answer (decision 0028). A
 * key is 64 hex digits or no key at all, and a model's id names a folder and never a path, so no
 * key or id names a place elsewhere.
 *
 * It reads and writes files, so it lives with the editor's scripts: the package runs in the browser
 * and in a Worker too, where item 10's service keeps its answers in KV instead.
 */

// Node runs this file by stripping its types, so it imports values only from files that import
// nothing Node lacks, with their real extensions.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AnswerCache, type StoredAnswer, storable } from "@resume-tools/naming";
import { CORPUS_DIR, formatJson, writeAtomically } from "./corpus-manifest.ts";
import { ANSWERS_DIR } from "./corpus-seed.ts";

/** The models' answers, a folder a model, by key: under `.corpus/`, which git ignores. */
export const CACHE_DIR = join(CORPUS_DIR, "cache");

/** A key as the cache takes it: a SHA-256 in lower-case hex, and so a file's name and no path. */
const KEY = /^[0-9a-f]{64}$/;

/**
 * The folder a model's answers are filed in, under `root`: its id, each byte of it but a letter, a
 * digit, `.`, `-` and `_` written out as a URL writes it, so that `models/x:1` is one folder's name
 * and never a path. An id that is empty, or is `.` or `..`, a step of a path, is refused.
 */
export function modelCacheDir(id: string, root: string = CACHE_DIR): string {
  if (id === "" || id === "." || id === "..")
    throw new Error("A model's id names its answers' folder: it is not empty, `.` or `..`");
  const name = [...new TextEncoder().encode(id)]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /^[A-Za-z0-9._-]$/.test(char)
        ? char
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
  return join(root, name);
}

/**
 * The folders a cache reads and writes: the committed answers, and the folder it files in, given
 * as a folder, or as the model whose folder under `.corpus/cache/` it is (`modelCacheDir`).
 */
export type CacheFolders = { committed?: string } & (
  | { writable: string; model?: undefined }
  | { model: string; writable?: undefined }
);

/** The cache over the committed answers, read first and never written, and a model's folder. */
export class FileAnswerCache implements AnswerCache {
  readonly committed: string;
  readonly writable: string;

  constructor(folders: CacheFolders) {
    this.committed = folders.committed ?? ANSWERS_DIR;
    this.writable = folders.writable ?? modelCacheDir(folders.model ?? "");
  }

  /** The text of the file under `key`, the committed folder's first, or nothing. */
  get(key: string): string | undefined {
    if (!KEY.test(key)) return undefined;
    for (const dir of [this.committed, this.writable]) {
      const path = join(dir, `${key}.json`);
      if (existsSync(path)) return readFileSync(path, "utf8");
    }
    return undefined;
  }

  /**
   * Files a stored answer under its own key in the model's folder, when neither folder holds a file
   * under the key, and says whether it did: nothing is filed over another answer, a person's
   * reviewed one above all (decision 0028); two filings of one key at once may both write, the
   * later kept. Throws for anything but a stored answer under its own key.
   */
  put(key: string, answer: StoredAnswer): boolean {
    if (!KEY.test(key)) throw new Error("A stored answer's key is 64 lower-case hex digits");
    const text = formatJson(storable(key, answer));
    if (this.get(key) !== undefined) return false;
    writeAtomically(join(this.writable, `${key}.json`), text);
    return true;
  }
}
