import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerFor, NAMING_VERSION, type StoredAnswer } from "@resume-tools/naming";
import { afterEach, describe, expect, test } from "vitest";
import { CACHE_DIR, FileAnswerCache, modelCacheDir } from "./answer-cache";
import { CORPUS_DIR } from "./corpus-manifest";
import { ANSWERS_DIR } from "./corpus-seed";

// The answers here are invented, for an invented macro; nothing is anyone's.

const KEY = "a".repeat(64);

/** An invented stored answer under `key`, as the model's would be filed. */
function stored(key = KEY, extra: Partial<StoredAnswer> = {}): StoredAnswer {
  return {
    version: NAMING_VERSION,
    key,
    hash: "b".repeat(64),
    of: "command",
    name: "cventry",
    answer: {
      kind: "entry",
      arguments: [{ index: 1, meaning: "title", slot: "title", blank: "empty" }],
      repeatable: true,
    },
    reviewed: false,
    source: "model:invented-model",
    ...extra,
  } as StoredAnswer;
}

const made: string[] = [];

/** A new empty folder under the system's temporary one, removed after the test. */
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "resume-tools-answers-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the answers cache on disk", () => {
  test("reads the committed answers, and writes a model's to a folder of its own under .corpus/cache/", () => {
    const cache = new FileAnswerCache({ model: "invented-model" });
    expect(cache.committed).toBe(ANSWERS_DIR);
    expect(cache.writable).toBe(join(CACHE_DIR, "invented-model"));
    expect(CACHE_DIR.startsWith(CORPUS_DIR)).toBe(true);
    // A model's id names a folder and never a path: its separators are written out, and an id
    // that is a step of a path is refused.
    expect(modelCacheDir("models/invented:1@x", "/invented")).toBe(
      join("/invented", "models%2Finvented%3A1%40x"),
    );
    for (const id of ["", ".", ".."]) expect(() => modelCacheDir(id)).toThrow("A model's id");
  });

  test("files a stored answer under its key, and reads it back as answerFor takes it", async () => {
    const cache = new FileAnswerCache({ committed: folder(), writable: folder() });
    expect(cache.get(KEY)).toBeUndefined();
    cache.put(KEY, stored());
    expect(readdirSync(cache.writable)).toEqual([`${KEY}.json`]);
    expect(await answerFor(cache, KEY)).toEqual(stored());
    // Filed as the repository writes JSON, so that a person can read it.
    expect(readFileSync(join(cache.writable, `${KEY}.json`), "utf8")).toMatch(/^\{\n {2}"version"/);
  });

  test("reads the committed answer first, and never writes where it reads it", async () => {
    const committed = folder();
    const reviewed = stored(KEY, {
      answer: { ...stored().answer, reviewed: true } as StoredAnswer["answer"],
      reviewed: true,
      source: "seed",
    });
    writeFileSync(join(committed, `${KEY}.json`), JSON.stringify(reviewed));
    const cache = new FileAnswerCache({ committed, writable: folder() });
    cache.put(KEY, stored());
    expect(await answerFor(cache, KEY)).toMatchObject({ reviewed: true, source: "seed" });
    expect(readdirSync(committed)).toEqual([`${KEY}.json`]);
    expect(JSON.parse(readFileSync(join(committed, `${KEY}.json`), "utf8"))).toEqual(reviewed);
  });

  test("never files over an answer either folder holds, and says whether it filed", () => {
    const committed = folder();
    const cache = new FileAnswerCache({ committed, writable: folder() });
    expect(cache.put(KEY, stored())).toBe(true);
    const text = readFileSync(join(cache.writable, `${KEY}.json`), "utf8");
    // Another model's reading of the same key, later: the first stays.
    const later = stored(KEY, { name: "cvheading", source: "model:another-model" });
    expect(cache.put(KEY, later)).toBe(false);
    expect(readFileSync(join(cache.writable, `${KEY}.json`), "utf8")).toBe(text);
    // Nor under a key the committed answers hold, which the cache reads first.
    const other = "d".repeat(64);
    writeFileSync(join(committed, `${other}.json`), JSON.stringify(stored(other)));
    expect(cache.put(other, stored(other))).toBe(false);
    expect(readdirSync(cache.writable)).toEqual([`${KEY}.json`]);
  });

  test("reads a model's folder alone, the committed answers left out, as the benchmark reads it", async () => {
    const committed = folder();
    const reviewed = stored(KEY, {
      answer: { ...stored().answer, reviewed: true } as StoredAnswer["answer"],
      reviewed: true,
      source: "seed",
    });
    writeFileSync(join(committed, `${KEY}.json`), JSON.stringify(reviewed));
    const own = new FileAnswerCache({ committed, writable: folder(), own: true });
    expect(own.own).toBe(true);
    expect(own.get(KEY)).toBeUndefined();
    expect(await answerFor(own, KEY)).toBeUndefined();
    // The model's answer is filed in its folder though the committed one holds the key, which it
    // never writes; and never over the model's own.
    expect(own.put(KEY, stored())).toBe(true);
    expect(own.put(KEY, stored(KEY, { source: "model:another-model" }))).toBe(false);
    expect(readdirSync(own.writable)).toEqual([`${KEY}.json`]);
    expect(await answerFor(own, KEY)).toEqual(stored());
    expect(JSON.parse(readFileSync(join(committed, `${KEY}.json`), "utf8"))).toEqual(reviewed);
    // A cache over both folders, as the run reads them, still serves the committed answer first.
    const both = new FileAnswerCache({ committed, writable: own.writable });
    expect(both.own).toBe(false);
    expect(await answerFor(both, KEY)).toMatchObject({ reviewed: true, source: "seed" });
  });

  test("refuses anything but a stored answer under its own key, and a key that is a path", () => {
    const cache = new FileAnswerCache({ committed: folder(), writable: folder() });
    const other = "c".repeat(64);
    const refused: [string, unknown][] = [
      [other, stored()],
      [KEY, { ...stored(), version: NAMING_VERSION + 1 }],
      [KEY, { ...stored(), reviewed: true }],
      [KEY, { ...stored(), extra: "a field the contract has not" }],
      [KEY, { answer: "not an answer" }],
      ["../escaped", stored("../escaped")],
    ];
    for (const [key, answer] of refused)
      expect(() => cache.put(key, answer as StoredAnswer), key.slice(0, 8)).toThrow();
    expect(readdirSync(cache.writable)).toEqual([]);
    // A key that is no hash is no file's name, wherever it points.
    const outside = folder();
    mkdirSync(join(outside, "inside"));
    writeFileSync(join(outside, "escaped.json"), JSON.stringify(stored()));
    const inside = new FileAnswerCache({
      committed: join(outside, "inside"),
      writable: join(outside, "inside"),
    });
    expect(inside.get("../escaped")).toBeUndefined();
  });
});
