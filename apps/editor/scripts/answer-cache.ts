/**
 * The naming step's cache on disk (milestone 3 item 9, decision 0026), the corpus runner's: an
 * `AnswerCache` over two folders, `<key>.json` a stored answer each. `corpus/answers/`, the
 * committed answers a person reviewed, the seed among them (decision 0024), is read and never
 * written; `.corpus/cache/`, which git ignores, is where the model's answers are filed and read
 * back. `get` looks in the committed folder first, so that a reviewed answer always wins; `put`
 * files only a stored answer this naming version reads, under its own key (`storable`), and only in
 * the ignored folder. A key is 64 hex digits or no key at all, so no key names a path elsewhere.
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

/** The model's answers, by key: under `.corpus/`, which git ignores. */
export const CACHE_DIR = join(CORPUS_DIR, "cache");

/** A key as the cache takes it: a SHA-256 in lower-case hex, and so a file's name and no path. */
const KEY = /^[0-9a-f]{64}$/;

/** The folders a cache reads and writes: the committed answers, and the ignored cache. */
export interface CacheFolders {
  committed?: string;
  writable?: string;
}

/** The cache over the committed answers, read first and never written, and the ignored folder. */
export class FileAnswerCache implements AnswerCache {
  readonly committed: string;
  readonly writable: string;

  constructor(folders: CacheFolders = {}) {
    this.committed = folders.committed ?? ANSWERS_DIR;
    this.writable = folders.writable ?? CACHE_DIR;
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

  /** Files a stored answer under its own key in the ignored folder; throws for anything else. */
  put(key: string, answer: StoredAnswer): void {
    if (!KEY.test(key)) throw new Error("A stored answer's key is 64 lower-case hex digits");
    writeAtomically(join(this.writable, `${key}.json`), formatJson(storable(key, answer)));
  }
}
