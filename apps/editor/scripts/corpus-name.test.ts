import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  keyOf,
  type ModelAnswer,
  type ModelNaming,
  NAMING_VERSION,
  NamingRequest,
  requestKey,
  StoredAnswer,
  sha256,
} from "@resume-tools/naming";
import { DEFAULT_MODEL } from "@resume-tools/naming/providers";
import { MockLanguageModelV4 } from "ai/test";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../src/engine/node";
import type { EngineSession } from "../src/engine/session";
import { readTree } from "../src/import/fonts";
import { type Intake, intake } from "../src/import/intake";
import type { HeaderValues } from "../src/import/naming";
import * as naming from "../src/import/naming";
import { bodyOf, bodyOfText, buildTree, readBody } from "../src/import/parse";
import { probe, probeUses } from "../src/import/probe";
import { reference } from "../src/import/reference";
import { isRefusal } from "../src/import/refusal";
import { keysOf, signatures } from "../src/import/signatures";
import { FontLibrary } from "../src/page/fonts";
import { TexLiveIndex } from "../src/page/texlive";
import { FileAnswerCache, modelCacheDir } from "./answer-cache";
import {
  answerDocument,
  costOf,
  gatedRequest,
  LIST_PRICES,
  missingNames,
  type NameRow,
  nameLine,
  nameTable,
  namingConfig,
} from "./corpus-name";

// Every template, document, request, answer and key here is invented, and no test calls a
// provider: the model is the AI SDK's mock, which answers what each test gives it.

type Result = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
type Call = MockLanguageModelV4["doGenerateCalls"][number];

/** A reply the mock gives: a text, and the tokens it counts. */
function reply(text: string): Result {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 1200, noCache: 1000, cacheRead: 200, cacheWrite: undefined },
      outputTokens: { total: 400, text: 300, reasoning: 100 },
    },
    warnings: [],
  };
}

/** A mock that answers every call with `naming`. */
const answering = (naming: unknown) =>
  new MockLanguageModelV4({ doGenerate: async () => reply(JSON.stringify(naming)) });

/** A mock that must not be asked. */
const idle = () =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("the model was asked");
    },
  });

/** The text of a mocked call's user message: the laid-out request. */
function userText(call: Call | undefined): string {
  const user = call?.prompt.find((message) => message.role === "user");
  if (user === undefined) return "";
  return typeof user.content === "string"
    ? user.content
    : user.content.map((part) => ("text" in part ? part.text : "")).join("");
}

/** The macros a laid-out request asks, by their headings. */
const headingsOf = (text: string) =>
  [...text.matchAll(/^### (command|environment) "([^"]+)"$/gm)].map((found) => ({
    of: (found[1] ?? "command") as "command" | "environment",
    name: found[2] ?? "",
  }));

/** A mock that answers each macro every call asks by `answer`, and the preamble with nothing. */
const answeringEach = (answer: (macro: { of: string; name: string }) => ModelAnswer) =>
  new MockLanguageModelV4({
    doGenerate: async (options) =>
      reply(
        JSON.stringify({
          macros: headingsOf(userText(options as Call)).map((macro) => ({
            ...macro,
            answer: answer(macro),
          })),
          preamble: { parameters: [] },
        }),
      ),
  });

const made: string[] = [];

/** A new empty folder under the system's temporary one, removed after the test. */
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "resume-tools-name-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A cache over two new folders, as the runner's is over the committed answers and the ignored. */
const freshCache = () => new FileAnswerCache({ committed: folder(), writable: folder() });

const TEXTS = {
  cvsection: "macro:#1->\\section *{#1}",
  cventry: "macro:#1#2->\\cv@row {#1}{#2}",
  "cv@row": "macro:#1#2->\\textbf {#1}\\hfill #2",
};

/** An invented request: a section, an entry that hands its work to a row, and a data macro. */
async function inventedRequest(): Promise<NamingRequest> {
  const hash = {
    cvsection: await sha256(TEXTS.cvsection),
    cventry: await sha256(TEXTS.cventry),
    "cv@row": await sha256(TEXTS["cv@row"]),
  };
  const argument = (index: number) => ({ index, kind: "mandatory", verdict: "editable" });
  return NamingRequest.parse({
    version: NAMING_VERSION,
    engine: "pdftex",
    preamble: { settings: ["\\usepackage[margin=1in]{geometry}"] },
    macros: [
      {
        of: "command",
        name: "cvsection",
        signature: "m",
        key: await keyOf(NAMING_VERSION, hash.cvsection, []),
        dependencies: [],
        capped: false,
        arguments: [argument(1)],
        sites: [{ arguments: ["Xxxxxxxxxx"] }],
        calls: 1,
      },
      {
        of: "command",
        name: "cventry",
        signature: "m m",
        key: await keyOf(NAMING_VERSION, hash.cventry, [["cv@row", hash["cv@row"]]]),
        dependencies: ["cv@row"],
        capped: false,
        arguments: [argument(1), argument(2)],
        sites: [{ arguments: ["Xxxxxxxx Xxxx", "0000"] }],
        calls: 2,
      },
      {
        of: "command",
        name: "cvdata",
        signature: "",
        dependencies: [],
        capped: false,
        arguments: [],
        sites: [{ arguments: [] }],
        calls: 1,
      },
    ],
    definitions: [
      { kind: "definition", name: "cvsection", hash: hash.cvsection, text: TEXTS.cvsection },
      { kind: "definition", name: "cventry", hash: hash.cventry, text: TEXTS.cventry },
      { kind: "definition", name: "cv@row", hash: hash["cv@row"], text: TEXTS["cv@row"] },
      { kind: "data", name: "cvdata" },
    ],
  });
}

/** An invented command: its name, its definition, how many arguments it takes, what it names. */
interface Command {
  name: string;
  text: string;
  arity?: number;
  dependencies?: string[];
}

/**
 * An invented request of commands, each with its key as its definitions give it, and the
 * definitions they hand their work to, `helpers`.
 */
async function commandsRequest(
  commands: readonly Command[],
  helpers: readonly Omit<Command, "arity">[] = [],
): Promise<NamingRequest> {
  const all = [...commands, ...helpers];
  const hashes = new Map(
    await Promise.all(all.map(async (each) => [each.name, await sha256(each.text)] as const)),
  );
  return NamingRequest.parse({
    version: NAMING_VERSION,
    engine: "pdftex",
    preamble: { settings: [] },
    macros: await Promise.all(
      commands.map(async (command) => {
        const arity = command.arity ?? 0;
        const dependencies = command.dependencies ?? [];
        return {
          of: "command",
          name: command.name,
          signature: Array.from({ length: arity }, () => "m").join(" "),
          key: await keyOf(
            NAMING_VERSION,
            hashes.get(command.name) ?? "",
            dependencies.map((name) => [name, hashes.get(name) ?? null] as const),
          ),
          dependencies,
          capped: false,
          arguments: Array.from({ length: arity }, (_, i) => ({
            index: i + 1,
            kind: "mandatory",
            verdict: "editable",
          })),
          sites: [{ arguments: Array.from({ length: arity }, () => "Xxxx") }],
          calls: 1,
        };
      }),
    ),
    definitions: all.map((each) => ({
      kind: "definition",
      name: each.name,
      hash: hashes.get(each.name),
      text: each.text,
    })),
  });
}

/** A name of letters for the `i`th of many invented commands. */
const lettered = (i: number) =>
  `cvrow${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;

/** An entry's answer, its first argument its title, of a section role where one is given. */
const entry = (role?: "awards" | "experience" | "other"): ModelAnswer => ({
  kind: "entry",
  arguments: [{ index: 1, meaning: "title", slot: "title", blank: "empty" }],
  repeatable: true,
  ...(role === undefined ? {} : { role }),
});

/** An invented answer to the invented request. */
const NAMING: ModelNaming = {
  macros: [
    {
      of: "command",
      name: "cvsection",
      answer: {
        kind: "section",
        arguments: [{ index: 1, meaning: "title", slot: "title", blank: "empty" }],
        repeatable: true,
      },
    },
    {
      of: "command",
      name: "cventry",
      answer: {
        kind: "entry",
        arguments: [
          { index: 1, meaning: "title", slot: "title", blank: "empty" },
          { index: 2, meaning: "dates", slot: "dates", blank: "empty" },
        ],
        repeatable: true,
      },
    },
  ],
  preamble: { parameters: [{ parameter: "margins", setting: 0, command: "usepackage" }] },
};

const passes = () => undefined;

/** No step asked of the model: nothing asked, stored, refused or in conflict. */
const NOTHING_ASKED = {
  refusedCache: 0,
  asked: 0,
  stored: 0,
  invalid: 0,
  conflicts: 0,
  calls: 0,
  tokens: { input: 0, cached: 0, output: 0 },
};

describe("answering a document's request", () => {
  test("counts what the cache does not answer missing, and asks nothing, without a model", async () => {
    const request = await inventedRequest();
    const answered = await answerDocument(request, { cache: freshCache(), gate: passes });
    expect(answered).toEqual({
      macros: 2,
      hits: { reviewed: 0, model: 0 },
      ...NOTHING_ASKED,
      missing: ["\\cvsection", "\\cventry"],
    });
  });

  test("asks the model for what the cache does not answer, stores it, and hits it next time", async () => {
    const request = await inventedRequest();
    const cache = freshCache();
    // A person's reviewed answer for the section, as the committed folder holds the seed's.
    const [section] = NAMING.macros;
    const reviewed = {
      version: NAMING_VERSION,
      key: request.macros[0]?.key,
      hash: await sha256(TEXTS.cvsection),
      of: "command",
      name: "cvsection",
      answer: { ...section?.answer, reviewed: true },
      reviewed: true,
      source: "seed",
    };
    writeFileSync(join(cache.committed, `${reviewed.key}.json`), JSON.stringify(reviewed));
    const model = answering({ ...NAMING, macros: NAMING.macros.slice(1) });
    const answered = await answerDocument(request, {
      cache,
      gate: passes,
      model: { model, id: "invented-model" },
    });
    expect(answered).toEqual({
      macros: 2,
      hits: { reviewed: 1, model: 0 },
      ...NOTHING_ASKED,
      asked: 1,
      stored: 1,
      missing: [],
      calls: 1,
      tokens: { input: 1200, cached: 200, output: 400 },
    });
    // Only the macro the cache did not answer was asked, and its answer filed under its key.
    const asked = userText(model.doGenerateCalls[0]);
    expect(asked).toContain('### command "cventry"');
    expect(asked).not.toContain('### command "cvsection"');
    const key = request.macros[1]?.key ?? "";
    expect(readdirSync(cache.writable)).toEqual([`${key}.json`]);
    expect(
      StoredAnswer.parse(JSON.parse(readFileSync(join(cache.writable, `${key}.json`), "utf8"))),
    ).toMatchObject({ key, name: "cventry", reviewed: false, source: "model:invented-model" });
    const again = await answerDocument(request, {
      cache,
      gate: passes,
      model: { model: idle(), id: "invented-model" },
    });
    expect(again).toMatchObject({ hits: { reviewed: 1, model: 1 }, asked: 0, calls: 0 });
  });

  test("asks nothing of a request the privacy gate refuses, or whose keys do not hold", async () => {
    const request = await inventedRequest();
    const model = idle();
    const refused = await answerDocument(request, {
      cache: freshCache(),
      gate: () => {
        throw new Error("The naming request holds the document's text (text) in setting 1.");
      },
      model: { model, id: "invented-model" },
    });
    expect(refused).toMatchObject({
      asked: 0,
      refused: "The naming request holds the document's text (text) in setting 1.",
      missing: ["\\cvsection", "\\cventry"],
    });
    // A definition changed after its hash was taken: the macros that name it would file an answer
    // under a key their definitions do not give.
    const changed = structuredClone(request);
    const row = changed.definitions.find((each) => each.name === "cv@row");
    if (row?.kind === "definition") row.text = `${row.text} `;
    const keys = await answerDocument(changed, {
      cache: freshCache(),
      gate: passes,
      model: { model, id: "invented-model" },
    });
    expect(keys.refused).toBe("The request's keys do not hold: definition \\cv@row (hash).");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  test("stores nothing when the model's answer never validates, and says why", async () => {
    const request = await inventedRequest();
    const cache = freshCache();
    const answered = await answerDocument(request, {
      cache,
      gate: passes,
      model: { model: answering({ ...NAMING, macros: [] }), id: "invented-model" },
    });
    expect(answered).toMatchObject({
      asked: 2,
      stored: 0,
      invalid: 2,
      calls: 2,
      failed: { reason: "invalid" },
      missing: ["\\cvsection", "\\cventry"],
    });
    expect(answered.failed?.message).toContain('no answer for command "cvsection"');
    expect(readdirSync(cache.writable)).toEqual([]);
  });

  test("says why the step failed without the model's words", async () => {
    const request = await inventedRequest();
    // A model that echoes its prompt's definitions as a macro's name.
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        const text = userText(options as Call);
        const at = text.indexOf("## The definitions");
        const [first, ...rest] = NAMING.macros;
        return reply(
          JSON.stringify({
            ...NAMING,
            macros: [{ ...first, name: text.slice(at, at + 5000) }, ...rest],
          }),
        );
      },
    });
    const answered = await answerDocument(request, {
      cache: freshCache(),
      gate: passes,
      model: { model, id: "invented-model" },
    });
    expect(answered.failed?.reason).toBe("invalid");
    const line = nameLine({
      id: "invented-0001",
      family: "other",
      outcome: "requested",
      engine: "pdftex",
      ...answered,
    });
    for (const leak of ["macro:", "Definition", "\\textbf", "## The"])
      expect(line).not.toContain(leak);
    expect(line.length).toBeLessThan(600);
  });
});

describe("the cache, asked for a document's macro", () => {
  /** A person's answer, filed as the seed files one, under the key of `text` and no closure. */
  async function seedShaped(
    of: "command" | "environment",
    name: string,
    text: string,
    answer: ModelAnswer,
    partnerKeys?: { openedBy?: string; closedBy?: string },
  ) {
    const hash = await sha256(text);
    return {
      version: NAMING_VERSION,
      key: await keyOf(NAMING_VERSION, hash, []),
      hash,
      of,
      name,
      family: "jake",
      answer: { ...answer, reviewed: true },
      reviewed: true,
      source: "seed",
      dependencies: [],
      ...(partnerKeys === undefined ? {} : { partnerKeys }),
    };
  }

  test("refuses another kind's answer, and a list's another template pairs, as misses", async () => {
    const committed = folder();
    // An environment's answer, whose begin code a command of another template has as its own.
    const PARAGRAPH = "macro:->\\par \\small ";
    const environment = await seedShaped("environment", "cvinventedparagraph", PARAGRAPH, {
      kind: "paragraph",
      arguments: [],
      repeatable: false,
    });
    // A list's closer, a bare end of a list, which its own template's opener opens.
    const END = "macro:->\\end {itemize}";
    const closer = await seedShaped(
      "command",
      "cvinventedlistend",
      END,
      {
        kind: "layout",
        arguments: [],
        repeatable: false,
        list: { does: "closes", openedBy: "cvinventedliststart" },
      },
      { openedBy: "e".repeat(64) },
    );
    for (const each of [environment, closer])
      writeFileSync(join(committed, `${each.key}.json`), JSON.stringify(each));
    const request = await commandsRequest([
      { name: "cvline", text: PARAGRAPH },
      { name: "cvlistend", text: END },
    ]);
    const cache = new FileAnswerCache({ committed, writable: folder() });
    const answered = await answerDocument(request, { cache, gate: passes });
    expect(answered).toMatchObject({
      macros: 2,
      hits: { reviewed: 0, model: 0 },
      refusedCache: 2,
      asked: 0,
      missing: ["\\cvline", "\\cvlistend"],
    });
    // Asked of the model, they are answered, and never filed over what another macro keeps there.
    const model = answeringEach(() => ({ kind: "layout", arguments: [], repeatable: false }));
    const asked = await answerDocument(request, {
      cache,
      gate: passes,
      model: { model, id: "invented-model" },
    });
    expect(asked).toMatchObject({
      refusedCache: 2,
      asked: 2,
      stored: 0,
      conflicts: 2,
      missing: ["\\cvline", "\\cvlistend"],
    });
    expect(readdirSync(cache.writable)).toEqual([]);
  });

  test("files one answer a key, and none for macros of one key the model answered otherwise", async () => {
    // Four commands of one definition, as a fork's awards, teaching, admin and memberships.
    const TEXT = "\\long macro:#1->\\textbf {#1}\\hfill ";
    const names = ["cvaward", "cvteaching", "cvadmin", "cvmembership"];
    const request = await commandsRequest(names.map((name) => ({ name, text: TEXT, arity: 1 })));
    const ROLES: Record<string, "awards" | "experience" | "other"> = {
      cvaward: "awards",
      cvteaching: "experience",
      cvadmin: "other",
      cvmembership: "other",
    };
    const cache = freshCache();
    const otherwise = answeringEach((macro) => entry(ROLES[macro.name]));
    const first = await answerDocument(request, {
      cache,
      gate: passes,
      model: { model: otherwise, id: "invented-model" },
    });
    expect(first).toMatchObject({
      asked: 4,
      stored: 0,
      invalid: 0,
      conflicts: 1,
      missing: names.map((name) => `\\${name}`),
    });
    expect(readdirSync(cache.writable)).toEqual([]);
    // Nothing was filed, so the next run asks again, where one answer would have served all four.
    const second = await answerDocument(request, {
      cache,
      gate: passes,
      model: { model: otherwise, id: "invented-model" },
    });
    expect(second).toMatchObject({ hits: { reviewed: 0, model: 0 }, asked: 4, conflicts: 1 });
    // Answered alike, one file serves the four.
    const alike = freshCache();
    const filed = await answerDocument(request, {
      cache: alike,
      gate: passes,
      model: { model: answeringEach(() => entry()), id: "invented-model" },
    });
    expect(filed).toMatchObject({ asked: 4, stored: 4, conflicts: 0, missing: [] });
    expect(readdirSync(alike.writable)).toHaveLength(1);
    const again = await answerDocument(request, {
      cache: alike,
      gate: passes,
      model: { model: idle(), id: "invented-model" },
    });
    expect(again).toMatchObject({ hits: { reviewed: 0, model: 4 }, asked: 0 });
  });

  test("files a list's pair with the dependencies its keys are computed from, and its partners' keys", async () => {
    const STYLE = "macro:->\\small ";
    const request = await commandsRequest(
      [
        {
          name: "cvliststart",
          text: "macro:->\\cv@liststyle \\begin {itemize}",
          dependencies: ["cv@liststyle"],
        },
        { name: "cvlistend", text: "macro:->\\end {itemize}" },
      ],
      [{ name: "cv@liststyle", text: STYLE }],
    );
    const [start, end] = request.macros;
    const model = answeringEach((macro) => ({
      kind: "bulletList",
      arguments: [],
      repeatable: false,
      list:
        macro.name === "cvliststart"
          ? { does: "opens", closedBy: "cvlistend", holds: "bullet" }
          : { does: "closes", openedBy: "cvliststart" },
    }));
    const cache = freshCache();
    const answered = await answerDocument(request, {
      cache,
      gate: passes,
      model: { model, id: "invented-model" },
    });
    expect(answered).toMatchObject({ asked: 2, stored: 2, missing: [] });
    const file = (key: string | undefined) =>
      StoredAnswer.parse(JSON.parse(readFileSync(join(cache.writable, `${key}.json`), "utf8")));
    expect(file(start?.key)).toMatchObject({
      dependencies: [["cv@liststyle", await sha256(STYLE)]],
      partnerKeys: { closedBy: end?.key },
    });
    expect(file(end?.key)).toMatchObject({
      dependencies: [],
      partnerKeys: { openedBy: start?.key },
    });
    const again = await answerDocument(request, {
      cache,
      gate: passes,
      model: { model: idle(), id: "invented-model" },
    });
    expect(again).toMatchObject({ hits: { reviewed: 0, model: 2 }, refusedCache: 0, asked: 0 });
  });

  test("keeps each model's answers in a folder of its own, so that a candidate is asked afresh", async () => {
    const request = await inventedRequest();
    const committed = folder();
    const root = folder();
    const cacheOf = (id: string) =>
      new FileAnswerCache({ committed, writable: modelCacheDir(id, root) });
    const first = answering(NAMING);
    expect(
      await answerDocument(request, {
        cache: cacheOf("gemini-3.8-flash"),
        gate: passes,
        model: { model: first, id: "gemini-3.8-flash" },
      }),
    ).toMatchObject({ asked: 2, stored: 2 });
    const candidate = answering(NAMING);
    const swapped = await answerDocument(request, {
      cache: cacheOf("gemini-3.7-flash"),
      gate: passes,
      model: { model: candidate, id: "gemini-3.7-flash" },
    });
    expect(swapped).toMatchObject({ hits: { reviewed: 0, model: 0 }, asked: 2, stored: 2 });
    expect(candidate.doGenerateCalls).toHaveLength(1);
    expect(readdirSync(root).sort()).toEqual(["gemini-3.7-flash", "gemini-3.8-flash"]);
  });
});

describe("a request asked in parts", () => {
  test("files each part as it validates, and counts what was sent, filed and invalid", async () => {
    const names = Array.from({ length: 45 }, (_, i) => lettered(i));
    const request = await commandsRequest(
      names.map((name, i) => ({ name, text: `macro:#1->\\textbf {#1}\\kern ${i}sp `, arity: 1 })),
    );
    // The second part's answers give an entry a slot it has not, every time.
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        const text = userText(options as Call);
        const second = text.includes("Its settings are asked in another part");
        return reply(
          JSON.stringify({
            macros: headingsOf(text).map((macro) => ({
              ...macro,
              answer: second
                ? { ...entry(), arguments: [{ index: 1, meaning: "title", slot: "phone" }] }
                : entry(),
            })),
            preamble: { parameters: [] },
          }),
        );
      },
    });
    const cache = freshCache();
    const answered = await answerDocument(request, {
      cache,
      gate: passes,
      model: { model, id: "invented-model" },
    });
    expect(answered).toMatchObject({
      asked: 45,
      stored: 32,
      invalid: 13,
      conflicts: 0,
      calls: 3,
      failed: { reason: "invalid" },
    });
    expect(answered.failed?.message).toMatch(/^Part 2 of 2: /);
    expect(answered.missing).toEqual(names.slice(32).map((name) => `\\${name}`));
    expect(readdirSync(cache.writable)).toHaveLength(32);
    // The next run asks only the part still missing.
    const again = await answerDocument(request, {
      cache,
      gate: passes,
      model: { model: answeringEach(() => entry()), id: "invented-model" },
    });
    expect(again).toMatchObject({
      hits: { reviewed: 0, model: 32 },
      asked: 13,
      stored: 13,
      calls: 1,
      missing: [],
    });
  });

  test("counts a request over the budget before any call as refused, and asks nothing", async () => {
    const request = await commandsRequest([
      { name: "cvhuge", text: `macro:#1->${"\\hskip 1pt ".repeat(15_000)}`, arity: 1 },
      { name: "cvsmall", text: "macro:#1->\\textbf {#1}", arity: 1 },
    ]);
    const model = idle();
    const answered = await answerDocument(request, {
      cache: freshCache(),
      gate: passes,
      model: { model, id: "invented-model" },
      budget: 100_000,
    });
    expect(answered).toMatchObject({ asked: 0, stored: 0, invalid: 0, calls: 0 });
    expect(answered.failed).toBeUndefined();
    expect(answered.refused).toMatch(
      /budget of 100000 characters is too small for command "cvhuge"/,
    );
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe("the runner's configuration and prices", () => {
  test("takes the key from SOCLAAS_API_KEY alone and the model's id from NAMING_MODEL", () => {
    expect(namingConfig({})).toEqual({ id: DEFAULT_MODEL });
    expect(DEFAULT_MODEL).toBe("qwen3.8:27b");
    expect(namingConfig({ SOCLAAS_API_KEY: " invented-key " })).toEqual({
      key: "invented-key",
      id: DEFAULT_MODEL,
    });
    expect(
      namingConfig({ SOCLAAS_API_KEY: "another-invented-key", NAMING_MODEL: "qwen3.6:35b" }),
    ).toEqual({ key: "another-invented-key", id: "qwen3.6:35b" });
    // Gemini's names, which the runner read before SoCLaaS, are no longer read (decision 0036).
    expect(
      namingConfig({
        GEMINI_API_KEY: "invented-key",
        GOOGLE_GENERATIVE_AI_API_KEY: "invented-key",
      }),
    ).toEqual({ id: DEFAULT_MODEL });
  });

  test("refuses a key that is not one line with no spaces, and never says what it is", () => {
    for (const [name, key] of [
      ["SOCLAAS_API_KEY", "INVENTED-KEY-0123456789abcdef\n# rotated 2026-09"],
      ["SOCLAAS_API_KEY", "INVENTED KEY"],
    ] as const) {
      const error = (() => {
        try {
          namingConfig({ [name]: key });
        } catch (thrown) {
          return thrown as Error;
        }
      })();
      expect(error?.message).toBe(`${name} is not one line with no spaces, as a key is`);
      expect(error?.message).not.toContain("INVENTED");
    }
  });

  test("estimates the cost of tokens at the model's list price, with the day it was read", () => {
    const tokens = { input: 1_000_000, cached: 200_000, output: 100_000 };
    // SoCLaaS's reference price counts cached input as any other: 1,000,000 in and 100,000 out.
    const soclaas = LIST_PRICES[DEFAULT_MODEL];
    expect(soclaas?.read).toBe("2026-09-27");
    if (soclaas !== undefined) expect(costOf(tokens, soclaas)).toBeCloseTo(0.195 + 0.09, 10);
    // Gemini's: 800,000 fresh tokens in, 200,000 from the cache, and 100,000 out.
    const gemini = LIST_PRICES["gemini-3.8-flash"];
    expect(gemini?.read).toBe("2026-09-27");
    if (gemini !== undefined) expect(costOf(tokens, gemini)).toBeCloseTo(0.6 + 0.015 + 0.375, 10);
  });
});

describe("the runner's table", () => {
  const rows: NameRow[] = [
    {
      id: "jake-0001",
      family: "jake",
      outcome: "requested",
      engine: "pdftex",
      macros: 5,
      hits: { reviewed: 5, model: 0 },
      ...NOTHING_ASKED,
      missing: [],
    },
    {
      id: "jake-0002",
      family: "jake",
      outcome: "requested",
      engine: "pdftex",
      macros: 6,
      hits: { reviewed: 3, model: 0 },
      refusedCache: 1,
      asked: 3,
      stored: 2,
      invalid: 0,
      conflicts: 1,
      missing: ["\\cvline"],
      calls: 1,
      tokens: { input: 12_000, cached: 4000, output: 3000 },
    },
    {
      id: "altacv-0001",
      family: "altacv",
      outcome: "requested",
      engine: "pdftex",
      macros: 5,
      hits: { reviewed: 3, model: 0 },
      ...NOTHING_ASKED,
      missing: ["\\cvevent", "\\cvtag"],
      refused: "The naming request holds the document's text (text) in setting 3.",
    },
    {
      id: "other-0001",
      family: "other",
      outcome: "requested",
      engine: "xetex",
      macros: 3,
      hits: { reviewed: 0, model: 1 },
      refusedCache: 0,
      asked: 2,
      stored: 0,
      invalid: 2,
      conflicts: 0,
      missing: ["\\cvevent", "cvlist (environment)"],
      failed: { reason: "invalid", message: "The model's answer did not validate after a retry" },
      calls: 2,
      tokens: { input: 8000, cached: 0, output: 1000 },
    },
    { id: "other-0002", family: "other", outcome: "no reference" },
    { id: "awesome-cv-0001", family: "awesome-cv", outcome: "timeout" },
  ];

  test("adds up each family's documents, answers, refusals, calls and tokens", () => {
    const table = nameTable(rows, DEFAULT_MODEL);
    expect(table).toContain(
      "|  | jake | awesome-cv | altacv | moderncv | europecv | other | all |",
    );
    expect(table).toContain("| Documents | 2 | 1 | 1 | 0 | 0 | 2 | 6 |");
    expect(table).toContain("| Requests built | 2 | 0 | 1 | 0 | 0 | 1 | 4 |");
    expect(table).toContain(
      "| Named: every macro and environment answered | 1 | 0 | 0 | 0 | 0 | 0 | 1 |",
    );
    expect(table).toContain("| Macros and environments to answer | 11 | 0 | 5 | 0 | 0 | 3 | 19 |");
    expect(table).toContain("| Answered from the cache: reviewed | 8 | 0 | 3 | 0 | 0 | 0 | 11 |");
    expect(table).toContain("| Answered from the cache: the model's | 0 | 0 | 0 | 0 | 0 | 1 | 1 |");
    expect(table).toContain(
      "| Refused from the cache: another macro's answer under its key | 1 | 0 | 0 | 0 | 0 | 0 | 1 |",
    );
    expect(table).toContain("| Asked of the model now | 3 | 0 | 0 | 0 | 0 | 2 | 5 |");
    expect(table).toContain("| Stored now | 2 | 0 | 0 | 0 | 0 | 0 | 2 |");
    expect(table).toContain("| Asked, and not stored | 1 | 0 | 0 | 0 | 0 | 2 | 3 |");
    expect(table).toContain(
      "| Of them, invalid: the answer never validated | 0 | 0 | 0 | 0 | 0 | 2 | 2 |",
    );
    expect(table).toContain(
      "| Keys in conflict: answers under one key that disagree, none stored | 1 | 0 | 0 | 0 | 0 | 0 | 1 |",
    );
    expect(nameLine(rows[3] as NameRow)).toContain("2 asked, 0 stored, 2 invalid; 2 calls");
    expect(table).toContain("| Missing: no answer | 1 | 0 | 2 | 0 | 0 | 2 | 5 |");
    expect(table).toContain(
      "| Requests refused: the privacy gate, the keys or the budget | 0 | 0 | 1 | 0 | 0 | 0 | 1 |",
    );
    expect(table).toContain("| Model calls | 1 | 0 | 0 | 0 | 0 | 2 | 3 |");
    expect(table).toContain("| Input tokens | 12000 | 0 | 0 | 0 | 0 | 8000 | 20000 |");
    // The headline: documents named, macros answered, calls, tokens, and the cost at list price.
    const cost = costOf(
      { input: 20_000, cached: 4000, output: 4000 },
      LIST_PRICES[DEFAULT_MODEL] ?? { read: "", input: 0, cached: 0, output: 0 },
    );
    expect(table).toContain(
      `1 of 4 documents named; 14 macros answered, 2 of them by the model now; 3 model calls, 24000 tokens. About $${cost.toFixed(2)} at ${DEFAULT_MODEL}'s list price, read 2026-09-27.`,
    );
    expect(table).toContain("Failed, by reason: invalid 1.");
    expect(table).toContain(
      "Missing, by the documents missing it: \\cvevent 2, \\cvline 1, \\cvtag 1, cvlist (environment) 1.",
    );
    expect(missingNames(rows)[0]).toEqual(["\\cvevent", 2]);
  });

  test("says no model was asked, without one, and prints a row as names and numbers", () => {
    expect(nameTable(rows)).toContain("No model was asked: --model asks it, with a key.");
    expect(nameTable(rows, "invented-model")).toContain(
      "No list price is recorded for invented-model.",
    );
    expect(nameLine(rows[1] as NameRow)).toBe(
      "pdftex, 6 macros, 3 from the cache, 1 refused there; 3 asked, 2 stored, 0 invalid, 1 key in conflict; 1 call, 12000 tokens in (4000 cached), 3000 out; 1 missing: \\cvline",
    );
    expect(nameLine(rows[2] as NameRow)).toBe(
      "pdftex, 5 macros, 3 from the cache; refused: The naming request holds the document's text (text) in setting 3.; 2 missing: \\cvevent, \\cvtag",
    );
    expect(nameLine(rows[5] as NameRow)).toBe("timeout");
    // A document whose page the detector cannot read is refused before its request is built.
    expect(
      nameLine({
        id: "other-0003",
        family: "other",
        outcome: "refused",
        engine: "pdftex",
        refused: "This resume's text is set in fonts this editor cannot read yet.",
      }),
    ).toBe("pdftex, refused: This resume's text is set in fonts this editor cannot read yet.");
  });
});

describe("the name command", () => {
  const SCRIPT = fileURLToPath(new URL("./corpus.ts", import.meta.url));
  /** The command, run with no naming key in its environment, whatever this machine's has. */
  const run = (env: Record<string, string>, ...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, SOCLAAS_API_KEY: "", ...env },
    });

  test("refuses to ask a model with no key, or one no source can name, before anything else", () => {
    const keyless = run({}, "name", "--model");
    expect(keyless.status).toBe(1);
    expect(keyless.stderr).toContain("name --model asks SoCLaaS, which needs a key");
    const badId = run(
      { SOCLAAS_API_KEY: "invented-key", NAMING_MODEL: "an id with spaces" },
      "name",
      "--model",
    );
    expect(badId.status).toBe(1);
    expect(badId.stderr).toContain("NAMING_MODEL is not a model's id");
    // A key of two lines, as a key file with a comment gives, is refused and never printed, before
    // any document is read: no document here is one.
    const twoLines = run(
      { SOCLAAS_API_KEY: "invented-key-0123\n# a second line" },
      "name",
      "--only",
      "invented-0000",
    );
    expect(twoLines.status).toBe(1);
    expect(twoLines.stderr).toContain("SOCLAAS_API_KEY is not one line with no spaces");
    expect(twoLines.stderr).not.toContain("invented-key-0123");
    expect(run({}, "probe", "--model").stderr).toContain("--model goes with name");
    expect(run({}, "--help").stdout).toContain("| name [--only <id>] [--json <file>] [--model]");
  });
});

describe.skipIf(!engineAvailable())("corpus name, on the invented pdfTeX document", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let tree: ReturnType<typeof readTree>;
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    tree = readTree(manifest.files, manifest.fonts);
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 60_000);

  /** The invented class and document of `naming.test.ts`'s end-to-end requests. */
  const CLASS = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedprobe}[2026/09/27 an invented class for the naming step's tests]
\LoadClass{article}
\RequirePackage[hidelinks]{hyperref}
\newcommand{\cvname}[2]{\def\@cvfirst{#1}\def\@cvlast{#2}}
\newcommand{\cvheader}{{\Large\@cvfirst\ \@cvlast}\par}
\newcommand{\cvplain}[1]{\textbf{#1}\par}
\newcommand{\cvmail}[1]{\href{mailto:#1}{#1}\par}
\newcommand{\cvgap}[1]{\hspace{#1}Invented gap\par}
\newcommand{\cventry}[3]{\textbf{#1}\hfill\textit{#3}\par #2\par}
\newenvironment{cvitems}{\begin{itemize}}{\end{itemize}}
\newcommand{\cvcontact}{{\Large Wren Larkfield}\par}
\newcommand{\cvsign}[1]{\par\textit{Wrenfield}#1\par}
`;

  const BODY = String.raw`\begin{document}
\cvheader
\cvplain{Invented plain words}
\cvmail{quill@example.invalid}
\cventry{Invented Role}{Larkspur Labs, Harbour City}{June 2020 -- Present}
\begin{cvitems}
\item Built the invented typesetter.
\end{cvitems}
\cvgap{2em}
\end{document}
`;

  /** A fixed answer for the invented class's macros, as a model would give it. */
  const FIXED: ModelNaming = {
    macros: [
      {
        of: "command",
        name: "cvname",
        answer: {
          kind: "header",
          arguments: [
            { index: 1, meaning: "title", slot: "first", blank: "empty" },
            { index: 2, meaning: "title", slot: "last", blank: "empty" },
          ],
          repeatable: false,
        },
      },
      {
        of: "command",
        name: "cvheader",
        answer: { kind: "header", arguments: [], repeatable: false },
      },
      {
        of: "command",
        name: "cvplain",
        answer: {
          kind: "paragraph",
          arguments: [{ index: 1, meaning: "text", slot: "text", blank: "empty" }],
          repeatable: false,
        },
      },
      {
        of: "command",
        name: "cvmail",
        answer: {
          kind: "contact",
          contact: "email",
          arguments: [{ index: 1, meaning: "text", slot: "text", blank: "empty" }],
          repeatable: false,
        },
      },
      {
        of: "command",
        name: "cventry",
        answer: {
          kind: "entry",
          arguments: [
            { index: 1, meaning: "title", slot: "title", blank: "empty" },
            { index: 2, meaning: "subtitle", slot: "subtitle", blank: "empty" },
            { index: 3, meaning: "dates", slot: "dates", blank: "empty" },
          ],
          repeatable: true,
        },
      },
      {
        of: "environment",
        name: "cvitems",
        answer: {
          kind: "bulletList",
          arguments: [],
          repeatable: false,
          list: { does: "opens", holds: "bullet" },
        },
      },
      {
        of: "command",
        name: "cvgap",
        answer: {
          kind: "layout",
          arguments: [{ index: 1, meaning: "length", blank: "kept" }],
          repeatable: false,
        },
      },
    ],
    preamble: { parameters: [] },
  };

  /**
   * The invented upload through the pipeline to its request and its gate, as the runner's child
   * takes it (`gatedRequest`), with the upload's sources and the page's strings; and with the
   * header's values, when given, as item 7 will find them. `lines` go before the body's end.
   */
  async function requested(header?: HeaderValues, lines = "") {
    const main = `\\documentclass{inventedprobe}\n\\cvname{Quill}{Invented}\n${BODY.replace("\\end{document}", `${lines}\\end{document}`)}`;
    const zipped = { "cv.tex": strToU8(main), "inventedprobe.cls": strToU8(CLASS) };
    const taken = intake({ name: "invented.zip", bytes: zipSync(zipped) }, { tree });
    if (isRefusal(taken)) throw new Error(`refused at intake: ${taken.message}`);
    const made = await reference(session, fonts, taken as Intake);
    if (isRefusal(made)) throw new Error(`refused: ${made.message}`);
    const body = bodyOf(taken);
    if (isRefusal(body)) throw new Error(body.message);
    const read = readBody(body);
    if (isRefusal(read)) throw new Error(read.message);
    const preamble = readBody(bodyOfText(body.preamble));
    const found = await signatures(
      session,
      taken,
      made,
      body,
      probeUses(read, isRefusal(preamble) ? undefined : preamble),
    );
    if (isRefusal(found)) throw new Error("no signatures");
    const built = buildTree(read, found);
    if (isRefusal(built)) throw new Error(built.message);
    const probed = await probe(session, fonts, taken, made, built, found);
    if (probed.format !== undefined) session.dropFormat("pdftex", probed.format);
    const inputs = { tree: built, found, probed, preamble: body.preamble, taken, made, fonts };
    const gated = await gatedRequest(naming, {
      ...inputs,
      ...(header === undefined ? {} : { header }),
    });
    if ("refused" in gated) throw new Error(gated.refused);
    return { ...gated, found, inputs };
  }

  test("builds the request and gates it with the page, as the child does", async () => {
    // Item 9's review: the class hard-codes a name and a word of the person's in macros the body
    // calls, which neither the body's text nor a stored text names. The page shows them: the
    // name's pair masks `\cvcontact`, and the gate, stricter on purpose, finds the word alone in
    // `\cvsign`, which the builder does not mask by a single word of the page's (decision 0033).
    const { request, gate, inputs } = await requested(undefined, "\\cvcontact\n\\cvsign{}\n");
    const contact = request.definitions.find((each) => each.name === "cvcontact");
    expect(contact?.kind === "definition" && contact.text).toBe(
      "\\long macro:->{\\Large Xxxx Xxxxxxxxx}\\par ",
    );
    const answered = await answerDocument(request, {
      cache: freshCache(),
      gate,
      model: { model: idle(), id: "invented-model" },
    });
    expect(answered).toMatchObject({ macros: 9, asked: 0, stored: 0, calls: 0 });
    expect(answered.refused).toMatch(/\(page\) in the definition of cvsign\.$/);
    // Without the page, as the child built it before, the name went out, and the gate saw neither
    // macro: only the surname the preamble stores, in `\cvgap`, which the page now masks.
    const sources = naming.sourcesOf(inputs.taken);
    const unpaged = await naming.buildRequest(
      inputs.tree,
      inputs.found,
      inputs.probed,
      inputs.preamble,
      { sources },
    );
    if ("refused" in unpaged) throw new Error(unpaged.message);
    const bare = unpaged.request.definitions.find((each) => each.name === "cvcontact");
    expect(bare?.kind === "definition" && bare.text).toBe(
      "\\long macro:->{\\Large Wren Larkfield}\\par ",
    );
    const stored = inputs.probed.candidates
      .filter((each) => each.where === "preamble")
      .map((each) => each.text);
    const leaks = naming.findLeaks(unpaged.request, { tree: inputs.tree, sources, stored });
    expect(leaks.map((leak) => `${leak.macro} ${leak.origin}`)).toEqual(["cvgap stored"]);
  }, 60_000);

  test("stores a fixed model answer under the keys item 4 gives, and hits it the next time", async () => {
    // With the name, as item 7 will find it, and the page, the builder masks the surname `\cvgap`
    // holds, which the page shows beside the class's word.
    const { request, found, gate } = await requested({ first: "Quill", last: "Invented" });
    expect(request.macros.map((macro) => `${macro.of} ${macro.name}`)).toEqual(
      FIXED.macros.map((macro) => `${macro.of} ${macro.name}`),
    );
    const cache = freshCache();
    const model = answering(FIXED);
    const answered = await answerDocument(request, {
      cache,
      gate,
      model: { model, id: "invented-model" },
    });
    expect(answered).toMatchObject({ macros: 7, asked: 7, stored: 7, missing: [], calls: 1 });
    expect(answered.refused).toBeUndefined();
    expect(answered.failed).toBeUndefined();
    // Each answer is filed under its macro's key, the one its definitions give; a command's whose
    // definition the document's text left alone is the one item 4 gives, which a fork's request
    // finds. `\cvgap`'s holds the invented last name, which the request masks, so its key is the
    // document's own (decision 0024).
    const keys = await keysOf(found);
    const filed = readdirSync(cache.writable).map((file) => file.replace(/\.json$/, ""));
    const expected: string[] = [];
    for (const macro of request.macros) {
      const key = await requestKey(request, macro);
      expect(macro.key, macro.name).toBe(key);
      if (macro.of === "command")
        expect(key === keys[macro.name], macro.name).toBe(macro.name !== "cvgap");
      expected.push(key ?? "");
      const answer = StoredAnswer.parse(
        JSON.parse(readFileSync(join(cache.writable, `${key}.json`), "utf8")),
      );
      expect(answer).toMatchObject({ key, name: macro.name, of: macro.of, reviewed: false });
    }
    expect(filed.sort()).toEqual(expected.sort());
    const again = await answerDocument(request, {
      cache,
      gate,
      model: { model: idle(), id: "invented-model" },
    });
    expect(again).toMatchObject({ hits: { reviewed: 0, model: 7 }, asked: 0, calls: 0 });
  }, 60_000);
});
