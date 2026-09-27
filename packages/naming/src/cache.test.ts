import { describe, expect, test } from "vitest";
import { StoredAnswer } from "./answer";
import { type AnswerCache, answerFor, requestKey, storable, storedAnswersOf } from "./cache";
import { inventedAnswer, inventedNaming, inventedRequest } from "./invented";
import { NAMING_VERSION } from "./key";

// The template, its macros and the answers here are invented; nothing is anyone's.

/** A cache in memory that files what `storable` takes, as every cache does. */
function memoryCache(): AnswerCache & { held: Map<string, unknown> } {
  const held = new Map<string, unknown>();
  return {
    held,
    get: (key) => held.get(key),
    put: (key, answer) => {
      held.set(key, storable(key, answer));
    },
  };
}

describe("a model's answer, stored", () => {
  test("gives a stored answer for each macro with a key, by the key its definitions give", async () => {
    const request = await inventedRequest();
    const naming = inventedNaming(request);
    const stored = await storedAnswersOf(request, naming, "model:invented-model");
    const keyed = request.macros.filter((macro) => macro.key !== undefined);
    expect(stored.map((each) => `${each.of} ${each.name}`)).toEqual(
      keyed.map((macro) => `${macro.of} ${macro.name}`),
    );
    for (const [i, each] of stored.entries()) {
      const macro = keyed[i];
      const own = request.definitions.find((definition) => definition.name === macro?.name);
      expect(StoredAnswer.parse(each)).toEqual(each);
      expect(each).toMatchObject({
        version: NAMING_VERSION,
        key: macro?.key,
        hash: own?.kind === "definition" ? own.hash : undefined,
        family: "jake",
        reviewed: false,
        source: "model:invented-model",
      });
      expect(each.key).toBe(await requestKey(request, macro ?? { name: "", dependencies: [] }));
      expect(each.answer).toEqual(inventedAnswer(each));
    }
  });

  test("leaves out what the request does not ask, and what the model did not answer", async () => {
    const request = await inventedRequest();
    const naming = inventedNaming(request);
    const partial = {
      ...naming,
      macros: [
        ...naming.macros.filter((each) => each.name !== "cventry"),
        {
          of: "command" as const,
          name: "cvnowhere",
          answer: inventedAnswer({ of: "command", name: "x" }),
        },
        // A command answered where the request has the environment.
        {
          of: "command" as const,
          name: "cvitems",
          answer: inventedAnswer({ of: "command", name: "x" }),
        },
      ],
    };
    const stored = await storedAnswersOf(request, partial, "model:invented-model");
    expect(stored.map((each) => `${each.of} ${each.name}`)).toEqual([
      "command cvname",
      "command cvheader",
      "command cvsection",
      "environment cvitems",
    ]);
  });

  test("is filed by a cache and read back under its key, and nothing else is filed", async () => {
    const request = await inventedRequest();
    const cache = memoryCache();
    const stored = await storedAnswersOf(request, inventedNaming(request), "model:invented-model");
    for (const each of stored) await cache.put(each.key, each);
    for (const each of stored) expect(await answerFor(cache, each.key)).toEqual(each);
    const [first] = stored;
    if (first === undefined) throw new Error("nothing stored");
    const other = "c".repeat(64);
    const refused: [string, unknown][] = [
      [other, first],
      [first.key, { ...first, version: NAMING_VERSION + 1 }],
      [first.key, { ...first, reviewed: true }],
      [first.key, { ...first, source: "seed" }],
      [first.key, "not an answer"],
    ];
    for (const [key, answer] of refused)
      expect(() => cache.put(key, answer as StoredAnswer), `${key.slice(0, 4)}`).toThrow();
    expect(cache.held.has(other)).toBe(false);
    // What is wrong is named by the field, never by a value.
    expect(() => storable(first.key, { ...first, name: "" })).toThrow(
      /^Not a stored answer: name: /,
    );
  });
});
