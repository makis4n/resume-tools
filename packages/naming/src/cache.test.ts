import { describe, expect, test } from "vitest";
import { type ModelAnswer, type ModelNaming, StoredAnswer } from "./answer";
import { type AnswerCache, answerFor, requestKey, storable, storedAnswersOf } from "./cache";
import { inventedAnswer, inventedNaming, inventedRequest } from "./invented";
import { keyOf, NAMING_VERSION, sha256 } from "./key";
import { NamingRequest } from "./request";

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

/** An invented request of commands that take no argument, each by its name and definition. */
async function commandsRequest(macros: { name: string; text: string }[]): Promise<NamingRequest> {
  const listed = await Promise.all(
    macros.map(async (macro) => ({ ...macro, hash: await sha256(macro.text) })),
  );
  return NamingRequest.parse({
    version: NAMING_VERSION,
    engine: "pdftex",
    family: "jake",
    preamble: { settings: [] },
    macros: await Promise.all(
      listed.map(async (macro) => ({
        of: "command",
        name: macro.name,
        signature: "",
        key: await keyOf(NAMING_VERSION, macro.hash, []),
        dependencies: [],
        capped: false,
        arguments: [],
        sites: [{ arguments: [] }],
        calls: 1,
      })),
    ),
    definitions: listed.map((macro) => ({
      kind: "definition",
      name: macro.name,
      hash: macro.hash,
      text: macro.text,
    })),
  });
}

const OPEN = "macro:->\\begin {itemize}\\setlength \\itemsep {0pt}";
const OPEN_TIGHT = "macro:->\\begin {itemize}\\setlength \\itemsep {-2pt}";
const CLOSE = "macro:->\\end {itemize}";

/** A list's opener, closed by `closer`, and a closer, opened by `opener`: a list of bullets. */
const opens = (closer: string): ModelAnswer => ({
  kind: "bulletList",
  arguments: [],
  repeatable: false,
  list: { does: "opens", closedBy: closer, holds: "bullet" },
});
const closes = (opener: string): ModelAnswer => ({
  kind: "bulletList",
  arguments: [],
  repeatable: false,
  list: { does: "closes", openedBy: opener },
});

/** A model's answer to commands, each by its name. */
const naming = (answers: Record<string, ModelAnswer>): ModelNaming => ({
  macros: Object.entries(answers).map(([name, answer]) => ({ of: "command", name, answer })),
  preamble: { parameters: [] },
});

describe("a model's answer, stored", () => {
  test("gives a stored answer for each macro with a key, by the key its definitions give", async () => {
    const request = await inventedRequest();
    const { answers, conflicts, invalid } = await storedAnswersOf(
      request,
      inventedNaming(request),
      "model:invented-model",
    );
    expect(conflicts).toEqual([]);
    expect(invalid).toEqual([]);
    const keyed = request.macros.filter((macro) => macro.key !== undefined);
    expect(answers.map((each) => `${each.of} ${each.name}`)).toEqual(
      keyed.map((macro) => `${macro.of} ${macro.name}`),
    );
    for (const [i, each] of answers.entries()) {
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
      // The dependencies its key is computed from, data left out, so that the key can be checked
      // and the answer filed again under a new version's key.
      const code = (macro?.dependencies ?? []).filter((name) =>
        request.definitions.some((each) => each.name === name && each.kind === "definition"),
      );
      expect(each.dependencies?.map(([name]) => name)).toEqual(code);
      expect(await keyOf(NAMING_VERSION, each.hash, each.dependencies ?? [])).toBe(each.key);
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
    const { answers } = await storedAnswersOf(request, partial, "model:invented-model");
    expect(answers.map((each) => `${each.of} ${each.name}`)).toEqual([
      "command cvname",
      "command cvheader",
      "command cvsection",
      "environment cvitems",
    ]);
  });

  test("files a list's partners by their keys, which answerFor finds them by", async () => {
    const request = await commandsRequest([
      { name: "cvlistopen", text: OPEN },
      { name: "cvlistclose", text: CLOSE },
    ]);
    const [opener, closer] = request.macros;
    const { answers, invalid } = await storedAnswersOf(
      request,
      naming({ cvlistopen: opens("cvlistclose"), cvlistclose: closes("cvlistopen") }),
      "model:invented-model",
    );
    expect(invalid).toEqual([]);
    expect(answers.map((each) => each.partnerKeys)).toEqual([
      { closedBy: closer?.key },
      { openedBy: opener?.key },
    ]);
    const cache = memoryCache();
    for (const each of answers) await cache.put(each.key, each);
    const partners = new Map(request.macros.map((macro) => [macro.name, macro.key ?? ""]));
    for (const macro of request.macros)
      expect(
        await answerFor(cache, macro.key ?? "", { name: macro.name, of: macro.of, partners }),
      ).toMatchObject({ name: macro.name, reviewed: false });
    // A partner no command of the request is: that answer is not filed, and is said to be invalid.
    const lost = await storedAnswersOf(
      request,
      naming({ cvlistopen: opens("cvnowhere"), cvlistclose: closes("cvlistopen") }),
      "model:invented-model",
    );
    expect(lost.answers.map((each) => each.name)).toEqual(["cvlistclose"]);
    expect(lost.invalid).toEqual([{ of: "command", name: "cvlistopen" }]);
  });

  test("files one answer a key: macros of one key answered alike once, answered otherwise none", async () => {
    // Four entries of one definition, as a fork's awards, teaching, admin and memberships.
    const TEXT = "macro:#1->\\textbf {#1}\\hfill ";
    const four = await commandsRequest(
      ["cvaward", "cvteaching", "cvadmin", "cvmembership"].map((name) => ({ name, text: TEXT })),
    );
    const entry = (role?: "awards" | "experience" | "other"): ModelAnswer => ({
      kind: "entry",
      arguments: [],
      repeatable: true,
      ...(role === undefined ? {} : { role }),
    });
    const alike = await storedAnswersOf(
      four,
      naming({ cvaward: entry(), cvteaching: entry(), cvadmin: entry(), cvmembership: entry() }),
      "model:invented-model",
    );
    expect(alike.answers.map((each) => each.name)).toEqual(["cvaward"]);
    expect(alike.conflicts).toEqual([]);
    const otherwise = await storedAnswersOf(
      four,
      naming({
        cvaward: entry("awards"),
        cvteaching: entry("experience"),
        cvadmin: entry("other"),
        cvmembership: entry("other"),
      }),
      "model:invented-model",
    );
    expect(otherwise.answers).toEqual([]);
    expect(otherwise.conflicts).toEqual([
      {
        key: four.macros[0]?.key,
        macros: ["cvaward", "cvteaching", "cvadmin", "cvmembership"].map((name) => ({
          of: "command",
          name,
        })),
      },
    ]);
    // Two lists whose closers share a definition: their partners' names may differ where the
    // partners share a key, but not their keys.
    const twins = await commandsRequest([
      { name: "cvastart", text: OPEN },
      { name: "cvbstart", text: OPEN },
      { name: "cvaend", text: CLOSE },
      { name: "cvbend", text: CLOSE },
    ]);
    const paired = await storedAnswersOf(
      twins,
      naming({
        cvastart: opens("cvaend"),
        cvbstart: opens("cvbend"),
        cvaend: closes("cvastart"),
        cvbend: closes("cvbstart"),
      }),
      "model:invented-model",
    );
    expect(paired.answers.map((each) => each.name)).toEqual(["cvastart", "cvaend"]);
    expect(paired.conflicts).toEqual([]);
    const apart = await commandsRequest([
      { name: "cvheadingstart", text: OPEN },
      { name: "cvitemstart", text: OPEN_TIGHT },
      { name: "cvheadingend", text: CLOSE },
      { name: "cvitemend", text: CLOSE },
    ]);
    const split = await storedAnswersOf(
      apart,
      naming({
        cvheadingstart: opens("cvheadingend"),
        cvitemstart: opens("cvitemend"),
        cvheadingend: closes("cvheadingstart"),
        cvitemend: closes("cvitemstart"),
      }),
      "model:invented-model",
    );
    expect(split.answers.map((each) => each.name)).toEqual(["cvheadingstart", "cvitemstart"]);
    expect(split.conflicts.map((each) => each.macros.map((macro) => macro.name))).toEqual([
      ["cvheadingend", "cvitemend"],
    ]);
  });

  test("is filed by a cache and read back under its key, and nothing else is filed", async () => {
    const request = await inventedRequest();
    const cache = memoryCache();
    const { answers: stored } = await storedAnswersOf(
      request,
      inventedNaming(request),
      "model:invented-model",
    );
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
