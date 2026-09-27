import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ModelAnswer,
  type ModelNaming,
  type NamingRequest,
  NamingRequest as NamingRequestSchema,
  StoredAnswer,
  storedAnswersOf,
} from "@resume-tools/naming";
import { batchesOf } from "@resume-tools/naming/model";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test } from "vitest";
import {
  commandsRequest,
  inventedNaming,
  inventedRequest,
  memoryCache,
  SITES,
  TEXTS,
} from "./invented";
import { handleName, LIMITS, type NameDeps, ROUTE, type ServiceCache } from "./name";
import { MemoryPreambleCache, preambleKey } from "./preamble";
import { MemoryRateStore } from "./rate";
import { NamingReply } from "./reply";

// Every template, request and answer here is invented, but for the meanings of Jake's Resume's list
// macros, public template code, which the committed seed answers; no test calls a provider: the
// model is the AI SDK's mock, which answers what each test gives it.

type Result = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
type Prompt = MockLanguageModelV4["doGenerateCalls"][number]["prompt"];

/** A reply the mock gives: a text, and how it finished. */
function reply(text: string, finish: "stop" | "length" | "content-filter" = "stop"): Result {
  return {
    content: text === "" ? [] : [{ type: "text", text }],
    finishReason: { unified: finish, raw: undefined },
    usage: {
      inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: undefined },
      outputTokens: { total: 300, text: 300, reasoning: 0 },
    },
    warnings: [],
  };
}

/** A mock that answers every call with `naming`. */
const answering = (naming: unknown) =>
  new MockLanguageModelV4({
    modelId: "invented-model",
    doGenerate: async () => reply(JSON.stringify(naming)),
  });

/** A mock that must not be asked. */
const idle = () =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("the model was asked");
    },
  });

/** The user's text of a call's prompt. */
const userText = (prompt: Prompt) =>
  prompt
    .filter((message) => message.role === "user")
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => ("text" in part ? part.text : "")).join(""),
    )
    .join("\n");

/** The characters of a call's prompt, the instructions among them. */
const charsOf = (prompt: Prompt) =>
  prompt.reduce(
    (sum, message) =>
      sum +
      (typeof message.content === "string"
        ? message.content.length
        : message.content.map((part) => ("text" in part ? part.text : "")).join("").length),
    0,
  );

/** The macros a laid-out part asks, by their headings. */
const headings = (text: string) =>
  [...text.matchAll(/^### (command|environment) "([^"]+)"$/gm)].map((found) => ({
    of: found[1] as "command" | "environment",
    name: found[2] ?? "",
  }));

/** An answer that sets none of the resume's text. */
const OTHER: ModelAnswer = { kind: "other", arguments: [], repeatable: false };

/** The invented answer for a macro of the invented request, by its name, or `other`. */
const inventedOf = (macro: { name: string }): ModelAnswer =>
  inventedNaming().macros.find((each) => each.name === macro.name)?.answer ?? OTHER;

/**
 * A mock that answers each part for exactly the macros its prompt asks, each as `answerOf` says,
 * and, where the part asks the preamble, `preamble`.
 */
function answeringEach(
  answerOf: (macro: { of: string; name: string }) => ModelAnswer,
  preamble: ModelNaming["preamble"] = { parameters: [] },
) {
  return new MockLanguageModelV4({
    modelId: "invented-model",
    doGenerate: async (options) => {
      const text = userText(options.prompt);
      return reply(
        JSON.stringify({
          macros: headings(text).map((macro) => ({ ...macro, answer: answerOf(macro) })),
          preamble: text.includes("## The preamble's settings") ? preamble : { parameters: [] },
        }),
      );
    },
  });
}

/** The handler's dependencies for a test, with the lines it logs, each after its level. */
function depsOf(overrides: Partial<NameDeps> = {}): NameDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    cache: memoryCache(),
    preambles: new MemoryPreambleCache(),
    model: undefined,
    address: "192.0.2.10",
    rates: new MemoryRateStore(),
    limits: LIMITS,
    now: () => 1_800_000_000_000,
    log: (line, level) => lines.push(`${level}: ${line}`),
    lines,
    ...overrides,
  };
}

/** A POST to the route, as JSON unless the headers say otherwise. */
function post(
  body: BodyInit | null,
  init: RequestInit & { duplex?: "half" } = {},
  headers: Record<string, string> = { "Content-Type": "application/json" },
): Request {
  return new Request(`http://localhost${ROUTE}`, { method: "POST", headers, body, ...init });
}

/** A response's status, text and JSON. */
async function read(response: Response) {
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) as Record<string, unknown> };
}

/** A request answered: its status, and its reply, which must be one. */
async function named(request: NamingRequest, deps: NameDeps) {
  const response = await read(await handleName(post(JSON.stringify(request)), deps));
  return { ...response, reply: NamingReply.parse(response.json) };
}

/** The reply's answers as item 7 looks them up: by `of|name` (assemble.ts, `answersOf`). */
const byName = (reply: NamingReply) =>
  new Map(reply.macros.map((each) => [`${each.of}|${each.name}`, each]));

/** The request's own texts: its definitions, its calls with letters in them, and its settings. */
function textsOf(request: NamingRequest): string[] {
  return [
    ...request.definitions.flatMap((each) => (each.kind === "definition" ? [each.text] : [])),
    ...request.macros
      .flatMap((macro) => macro.sites.flatMap((site) => [...site.arguments, site.body]))
      .filter((each): each is string => typeof each === "string" && /[Xx]{3}/.test(each)),
    ...request.preamble.settings,
  ];
}

/** That a response holds none of the request's texts, as written or as JSON escapes them. */
function expectNoEcho(text: string, request: NamingRequest) {
  for (const piece of textsOf(request)) {
    expect(text, piece).not.toContain(piece);
    expect(text, piece).not.toContain(JSON.stringify(piece).slice(1, -1));
  }
}

/** The invented request with a second command of the section's definition and closure: its key. */
async function twinRequest(): Promise<NamingRequest> {
  const request = await inventedRequest();
  return NamingRequestSchema.parse({
    ...request,
    macros: [...request.macros, { ...request.macros[0], name: "cvheading" }],
    definitions: [
      ...request.definitions,
      { ...request.definitions.find((each) => each.name === "cvsection"), name: "cvheading" },
    ],
  });
}

/** The committed answers, the seed among them, as the dev server reads them first; never written. */
function seedCache(): ServiceCache & { puts: number } {
  const dir = fileURLToPath(new URL("../../corpus/answers/", import.meta.url));
  return {
    puts: 0,
    get(key) {
      const path = join(dir, `${key}.json`);
      return /^[0-9a-f]{64}$/.test(key) && existsSync(path)
        ? readFileSync(path, "utf8")
        : undefined;
    },
    put() {
      this.puts++;
      return false;
    },
  };
}

/** Jake's Resume's list macros as TeX prints their meanings, whose answers the seed commits. */
const JAKE_LISTS = {
  resumeSubHeadingListStart: "\\long macro:->\\begin {itemize}[leftmargin=0.15in, label={}]",
  resumeSubHeadingListEnd: "\\long macro:->\\end {itemize}",
  resumeItemListStart: "\\long macro:->\\begin {itemize}",
  resumeItemListEnd: "\\long macro:->\\end {itemize}\\vspace {-5pt}",
};

/**
 * The review's Jake fork: Jake's four list macros, the item list's closer a bare `\end{itemize}`,
 * the sub-heading list's closer's definition, and so its key.
 */
const jakeFork = () =>
  commandsRequest(
    Object.entries({
      ...JAKE_LISTS,
      resumeItemListEnd: JAKE_LISTS.resumeSubHeadingListEnd,
    }).map(([name, text]) => ({ name, text })),
    [],
    { family: "jake" },
  );

/** A list's opener, closed by `closer`, holding `holds`, and a closer, opened by `opener`. */
const opens = (closer: string, holds: "entry" | "bullet"): ModelAnswer => ({
  kind: "layout",
  arguments: [],
  repeatable: false,
  list: { does: "opens", closedBy: closer, holds },
});
const closes = (opener: string): ModelAnswer => ({
  kind: "layout",
  arguments: [],
  repeatable: false,
  list: { does: "closes", openedBy: opener },
});

describe("the naming route", () => {
  test("answers from the cache alone when it holds every macro and the preamble's answer, and asks and files nothing", async () => {
    const request = await inventedRequest();
    const cache = memoryCache();
    const { answers: stored } = await storedAnswersOf(
      request,
      inventedNaming(),
      "model:invented-model",
    );
    for (const each of stored) cache.put(each.key, each);
    const preambles = new MemoryPreambleCache();
    const key = await preambleKey(request);
    preambles.put(key, {
      version: 1,
      key,
      source: "model:invented-model",
      preamble: inventedNaming().preamble,
    });
    const model = idle();
    const deps = depsOf({ cache, preambles, model });
    const { status, text, reply } = await named(request, deps);
    expect(status).toBe(200);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(reply).toEqual({
      version: 1,
      macros: stored,
      preamble: inventedNaming().preamble,
      hits: 3,
      asked: 0,
      conflicts: 0,
      missing: [],
    });
    expect([cache.puts, preambles.puts]).toEqual([3, 1]);
    expectNoEcho(text, request);
  });

  test("asks the model once for what the cache lacks, files it, and answers the same request from the cache next", async () => {
    const request = await inventedRequest();
    const cache = memoryCache();
    const preambles = new MemoryPreambleCache();
    const model = answering(inventedNaming());
    const deps = depsOf({ cache, preambles, model });
    const first = await named(request, deps);
    expect(first.status).toBe(200);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(first.reply).toMatchObject({ hits: 0, asked: 3, conflicts: 0, missing: [] });
    expect(first.reply.preamble).toEqual(inventedNaming().preamble);
    const keyed = request.macros.filter((macro) => macro.key !== undefined);
    expect(first.reply.macros.map((each) => [each.of, each.name, each.key])).toEqual(
      keyed.map((macro) => [macro.of, macro.name, macro.key]),
    );
    // Filed under their keys, the model's and unreviewed, and the preamble's under its own.
    expect([...cache.held.keys()].sort()).toEqual(keyed.map((macro) => macro.key).sort());
    for (const each of first.reply.macros)
      expect(StoredAnswer.parse(cache.held.get(each.key))).toMatchObject({
        reviewed: false,
        source: "model:invented-model",
      });
    expect([...preambles.held.keys()]).toEqual([await preambleKey(request)]);
    // One line a filing, by its key alone.
    expect(deps.lines.sort()).toEqual(
      [
        ...keyed.map((macro) => `info: The naming service filed an answer under ${macro.key}.`),
        `info: The naming service filed a preamble's answer under ${await preambleKey(request)}.`,
      ].sort(),
    );
    expectNoEcho(first.text, request);
    const second = await named(request, deps);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(second.reply).toEqual({ ...first.reply, hits: 3, asked: 0 });
    // The macro whose own definition holds data has no key: it is never asked, nor missing.
    const user = userText(model.doGenerateCalls[0]?.prompt ?? []);
    expect(user).toContain('### command "cventry"');
    expect(user).not.toContain('### command "cvtagline"');
  });

  test("names what it cannot answer when no model is configured, and files nothing", async () => {
    const request = await inventedRequest();
    const cache = memoryCache();
    const {
      answers: [section],
    } = await storedAnswersOf(request, inventedNaming(), "model:invented-model");
    if (section === undefined) throw new Error("no answer");
    cache.put(section.key, section);
    const { status, reply } = await named(request, depsOf({ cache }));
    expect(status).toBe(200);
    expect(reply).toEqual({
      version: 1,
      macros: [section],
      preamble: { parameters: [] },
      hits: 1,
      asked: 0,
      conflicts: 0,
      missing: request.macros
        .filter((macro) => macro.key !== undefined && macro.name !== "cvsection")
        .map((macro) => ({ of: macro.of, name: macro.name, key: macro.key })),
    });
    expect(cache.puts).toBe(1);
  });

  test("asks the model for a preamble alone when every macro hits and its answer is not kept, and keeps it", async () => {
    const request = await inventedRequest();
    const cache = memoryCache();
    const { answers } = await storedAnswersOf(request, inventedNaming(), "model:invented-model");
    for (const each of answers) cache.put(each.key, each);
    const preambles = new MemoryPreambleCache();
    const model = answeringEach(inventedOf, inventedNaming().preamble);
    const deps = depsOf({ cache, preambles, model });
    const first = await named(request, deps);
    expect(first.reply).toMatchObject({
      preamble: inventedNaming().preamble,
      hits: 3,
      asked: 0,
      missing: [],
    });
    // One call, which asks no macro and lays the settings out.
    expect(model.doGenerateCalls).toHaveLength(1);
    const user = userText(model.doGenerateCalls[0]?.prompt ?? []);
    expect(headings(user)).toEqual([]);
    expect(user).toContain("[0] \\geometry{margin=0.7in}");
    expect(preambles.puts).toBe(1);
    // The next import of the template asks nothing, and has the same preamble's answer.
    const second = await named(request, deps);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(second.reply).toEqual(first.reply);
    // A kept answer that names a setting the request has not is none, and the model is asked.
    const key = await preambleKey(request);
    const wrong = new MemoryPreambleCache();
    wrong.put(key, {
      version: 1,
      key,
      source: "model:invented-model",
      preamble: { parameters: [{ parameter: "margins", setting: 9, command: "geometry" }] },
    });
    const again = await named(request, depsOf({ cache, preambles: wrong, model }));
    expect(again.reply.preamble).toEqual(inventedNaming().preamble);
    expect(model.doGenerateCalls).toHaveLength(2);
    // A model that fails on the preamble alone leaves the reply without its answer, and no more.
    const failing = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: "Invented refusal",
          url: "https://invalid.example/v1",
          requestBodyValues: {},
          statusCode: 403,
        });
      },
    });
    const failed = depsOf({ cache, model: failing });
    const without = await named(request, failed);
    expect(without.status).toBe(200);
    expect(without.reply).toMatchObject({ preamble: { parameters: [] }, hits: 3, missing: [] });
    expect(failed.lines).toEqual([
      "warn: The naming service answered without a preamble's answer: the model's step failed (provider).",
    ]);
  });

  test("gives each macro of one key the model's answer as its own, and files it once where they agree", async () => {
    // The review's twin: \cvheading has \cvsection's definition and closure, and so its key.
    const twin = await twinRequest();
    const alike = answeringEach((macro) =>
      macro.name === "cvheading" ? inventedOf({ name: "cvsection" }) : inventedOf(macro),
    );
    const cache = memoryCache();
    const preambles = new MemoryPreambleCache();
    const first = await named(twin, depsOf({ cache, preambles, model: alike }));
    expect(first.reply).toMatchObject({ hits: 0, asked: 4, conflicts: 0, missing: [] });
    // Item 7 finds an answer for every macro the request names, under its own name.
    expect(first.reply.macros.map((each) => each.name)).toEqual([
      "cvsection",
      "cventry",
      "cvitems",
      "cvheading",
    ]);
    expect(byName(first.reply).get("command|cvheading")?.answer.kind).toBe("section");
    expect(cache.puts).toBe(3);
    // Next time both hit the one answer, each under its own name, and nothing is asked.
    const second = await named(twin, depsOf({ cache, preambles, model: idle() }));
    expect(second.reply).toMatchObject({ hits: 4, asked: 0 });
    expect(second.reply.macros.map((each) => each.name)).toEqual(
      first.reply.macros.map((each) => each.name),
    );
  });

  test("gives each macro of one key the model's answer as its own where they disagree, files neither, and counts the conflict", async () => {
    const twin = await twinRequest();
    const otherwise = answeringEach((macro) =>
      macro.name === "cvheading" ? OTHER : inventedOf(macro),
    );
    const cache = memoryCache();
    const { reply } = await named(twin, depsOf({ cache, model: otherwise }));
    expect(reply).toMatchObject({ hits: 0, asked: 4, conflicts: 1, missing: [] });
    const answers = byName(reply);
    expect(answers.get("command|cvsection")?.answer.kind).toBe("section");
    expect(answers.get("command|cvheading")?.answer.kind).toBe("other");
    expect([...cache.held.values()].map((each) => (each as StoredAnswer).name).sort()).toEqual([
      "cventry",
      "cvitems",
    ]);
  });

  test("gives a macro that hits another template's answer under its key that answer under its own name", async () => {
    const request = await inventedRequest();
    const cache = memoryCache();
    const { answers } = await storedAnswersOf(request, inventedNaming(), "model:invented-model");
    for (const each of answers) cache.put(each.key, each);
    // A document whose section command is \cvheading, of \cvsection's definition and closure.
    const renamed = NamingRequestSchema.parse({
      ...request,
      macros: request.macros.map((macro) =>
        macro.name === "cvsection" ? { ...macro, name: "cvheading" } : macro,
      ),
      definitions: request.definitions.map((each) =>
        each.name === "cvsection" ? { ...each, name: "cvheading" } : each,
      ),
    });
    const { reply } = await named(renamed, depsOf({ cache }));
    expect(reply).toMatchObject({ hits: 3, asked: 0, missing: [] });
    expect(byName(reply).get("command|cvheading")).toMatchObject({
      name: "cvheading",
      answer: { kind: "section" },
    });
    expect(byName(reply).has("command|cvsection")).toBe(false);
  });

  test("answers the review's Jake fork from the seed, both lists' macros under their own names, with no model and nothing filed", async () => {
    const fork = await jakeFork();
    const cache = seedCache();
    const model = idle();
    const { reply } = await named(fork, depsOf({ cache, model }));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(reply).toMatchObject({ hits: 4, asked: 0, missing: [] });
    const answers = byName(reply);
    // The item list's opener is paired with the fork's closer by the name the seed gives it,
    // since the fork's closer has the other list's key.
    expect(answers.get("command|resumeItemListStart")).toMatchObject({
      reviewed: true,
      answer: { kind: "bulletList", list: { does: "opens", closedBy: "resumeItemListEnd" } },
    });
    expect(answers.get("command|resumeItemListEnd")).toMatchObject({
      name: "resumeItemListEnd",
      answer: { list: { does: "closes" } },
    });
    expect(answers.get("command|resumeSubHeadingListStart")?.answer.list).toMatchObject({
      closedBy: "resumeSubHeadingListEnd",
    });
    expect(cache.puts).toBe(0);
  });

  test("takes a list's answer another template pairs for a miss, gives the model's, and never files over it", async () => {
    // The review's invented template whose list wrappers are a bare \begin{itemize} and
    // \end{itemize}: the seed's keys of Jake's item list's opener and sub-heading list's closer.
    const request = await commandsRequest([
      { name: "skillsStart", text: JAKE_LISTS.resumeItemListStart },
      { name: "skillsEnd", text: JAKE_LISTS.resumeSubHeadingListEnd },
    ]);
    const cache = seedCache();
    const alone = await named(request, depsOf({ cache }));
    expect(alone.reply).toMatchObject({ macros: [], hits: 0, asked: 0 });
    expect(alone.reply.missing.map((each) => each.name)).toEqual(["skillsStart", "skillsEnd"]);
    const model = answeringEach((macro) =>
      macro.name === "skillsStart" ? opens("skillsEnd", "bullet") : closes("skillsStart"),
    );
    const { reply } = await named(request, depsOf({ cache, model }));
    expect(reply).toMatchObject({ hits: 0, asked: 2, conflicts: 2, missing: [] });
    expect(reply.macros.map((each) => [each.name, each.reviewed, each.answer.list])).toEqual([
      ["skillsStart", false, { does: "opens", closedBy: "skillsEnd", holds: "bullet" }],
      ["skillsEnd", false, { does: "closes", openedBy: "skillsStart" }],
    ]);
    expect(cache.puts).toBe(0);
  });

  test("gives twin lists of one request each its own answer, whatever the filing keeps", async () => {
    // The review's two lists whose openers and closers share their definitions.
    const request = await commandsRequest(
      ["jobsStart", "skillsStart", "jobsEnd", "skillsEnd"].map((name) => ({
        name,
        text: name.endsWith("Start") ? "macro:->\\begin {itemize}\\small " : "macro:->\\par ",
      })),
    );
    const model = answeringEach(
      (macro) =>
        ({
          jobsStart: opens("jobsEnd", "entry"),
          skillsStart: opens("skillsEnd", "bullet"),
          jobsEnd: closes("jobsStart"),
          skillsEnd: closes("skillsStart"),
        })[macro.name] ?? OTHER,
    );
    const cache = memoryCache();
    const { reply } = await named(request, depsOf({ cache, model }));
    expect(reply.macros.map((each) => [each.name, each.answer.list])).toEqual([
      ["jobsStart", { does: "opens", closedBy: "jobsEnd", holds: "entry" }],
      ["skillsStart", { does: "opens", closedBy: "skillsEnd", holds: "bullet" }],
      ["jobsEnd", { does: "closes", openedBy: "jobsStart" }],
      ["skillsEnd", { does: "closes", openedBy: "skillsStart" }],
    ]);
    // The openers disagree and are not filed; the closers agree, and are filed once.
    expect(reply.conflicts).toBe(1);
    expect([...cache.held.values()].map((each) => (each as StoredAnswer).name)).toEqual([
      "jobsEnd",
    ]);
  });

  test("refuses a body over the cap with 413 before it parses a byte of it", async () => {
    const request = await inventedRequest();
    const limits = { ...LIMITS, bytes: 4096 };
    // Past the cap and not JSON: refused for its size, not its form.
    const large = await read(await handleName(post("{".repeat(4097)), depsOf({ limits })));
    expect(large.status).toBe(413);
    expect(large.json).toEqual({ error: "The request is larger than the naming route takes." });
    // Exactly the cap is read.
    const padded = JSON.stringify(request).padEnd(4096, " ");
    const fits = await handleName(
      post(padded),
      depsOf({ limits: { ...limits, bytes: padded.length } }),
    );
    expect(fits.status).toBe(200);
    // A declared length past the cap is refused before the body is read at all.
    let pulled = 0;
    let dropped = false;
    // A stream that fills itself only when read, so that a pull is a read.
    const unread = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled++;
          throw new Error("the body was read");
        },
        cancel() {
          dropped = true;
        },
      },
      { highWaterMark: 0 },
    );
    const declared = await handleName(
      post(
        unread,
        { duplex: "half" },
        {
          "Content-Type": "application/json",
          "Content-Length": "4097",
        },
      ),
      depsOf({ limits }),
    );
    expect(declared.status).toBe(413);
    expect([pulled, dropped]).toEqual([0, true]);
    // A body that never ends is read to the cap and no further, and the rest is let go.
    let sent = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1024;
        controller.enqueue(new Uint8Array(1024).fill(0x20));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await handleName(post(endless, { duplex: "half" }), depsOf({ limits }));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThanOrEqual(4096 + 2 * 1024);
  });

  test("refuses a request whose hashes or keys do not hold with 400, counting them and quoting nothing", async () => {
    const request = await inventedRequest();
    // A macro's key made up, and a definition changed after its hash was taken.
    const tampered = structuredClone(request);
    const [first] = tampered.macros;
    if (first === undefined) throw new Error("no macro");
    first.key = "e".repeat(64);
    const row = tampered.definitions.find((each) => each.name === "cv@row");
    if (row?.kind !== "definition") throw new Error("no row");
    row.text = `${row.text}\\relax `;
    const model = idle();
    const deps = depsOf({ model });
    const { status, text, json } = await read(
      await handleName(post(JSON.stringify(tampered)), deps),
    );
    expect(status).toBe(400);
    expect(json).toEqual({
      error: "The request's hashes or keys do not follow from its definitions.",
      problems: [
        "1 definition's hash is not the SHA-256 of its text",
        "1 macro's key is not the one its definitions give",
      ],
    });
    expect(model.doGenerateCalls).toHaveLength(0);
    expectNoEcho(text, tampered);
    expect(text).not.toContain("cvsection");
  });

  test("refuses what is not a naming request with 400, naming the schema's problems by path and none of its text", async () => {
    const request = await inventedRequest();
    const leaky = structuredClone(request) as NamingRequest & Record<string, unknown>;
    const [first] = leaky.macros;
    if (first?.sites[0] === undefined) throw new Error("no site");
    first.sites[0].arguments = ["Quill Invented"];
    leaky["Larkspur Lane 12"] = "Harbour City";
    const { status, text, json } = await read(
      await handleName(post(JSON.stringify(leaky)), depsOf()),
    );
    expect(status).toBe(400);
    expect(json).toEqual({
      error: "The request is not a naming request this service reads.",
      problems: expect.arrayContaining([
        "the request: holds a field the contract does not have",
        "macros.0.sites.0.arguments.0: a call site holds a letter other than x or X, or a digit other than 0",
      ]),
    });
    for (const piece of ["Quill", "Invented", "Larkspur", "Harbour"])
      expect(text).not.toContain(piece);
    // Not JSON, and not UTF-8, are said as much.
    expect((await read(await handleName(post('{"version": 1'), depsOf()))).json).toEqual({
      error: "The request is not JSON.",
    });
    const bytes = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    expect((await read(await handleName(post(bytes), depsOf()))).json).toEqual({
      error: "The request is not UTF-8 text.",
    });
  });

  test("gives the model's failures a status and a sentence, and says nothing of what it wrote", async () => {
    const request = await inventedRequest();
    const naming = inventedNaming();
    const cases: [MockLanguageModelV4, number, string][] = [
      [
        new MockLanguageModelV4({ doGenerate: async () => reply("", "content-filter") }),
        422,
        "The naming model gave no answer.",
      ],
      [
        // An answer that leaves every macro out, twice, and names one that was never asked.
        answering({
          ...naming,
          macros: [{ of: "command", name: "cvnowhere", answer: naming.macros[0]?.answer }],
        }),
        422,
        "The naming model's answer did not validate.",
      ],
      [
        new MockLanguageModelV4({
          doGenerate: async () => {
            throw new APICallError({
              message: "Invented refusal quoting cvnowhere",
              url: "https://invalid.example/v1",
              requestBodyValues: { contents: TEXTS.cventry },
              statusCode: 403,
            });
          },
        }),
        502,
        "The naming model could not be reached, or did not answer in time.",
      ],
      [
        new MockLanguageModelV4({
          doGenerate: async () => reply('{"macros": [ "cvnowhere', "length"),
        }),
        413,
        "The request is too large for the naming model to answer.",
      ],
    ];
    for (const [model, status, error] of cases) {
      const cache = memoryCache();
      const response = await read(
        await handleName(post(JSON.stringify(request)), depsOf({ cache, model })),
      );
      expect([response.status, response.json]).toEqual([status, { error }]);
      expect(response.text).not.toContain("cvnowhere");
      expectNoEcho(response.text, request);
      expect(cache.puts).toBe(0);
    }
  });

  test("tries a failed call once more, not twice, before it says the model could not be reached", async () => {
    const request = await inventedRequest();
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: "Invented overload",
          url: "https://invalid.example/v1",
          requestBodyValues: {},
          statusCode: 503,
          // Retried at once, rather than after the SDK's two seconds.
          responseHeaders: { "retry-after-ms": "0" },
        });
      },
    });
    const response = await handleName(post(JSON.stringify(request)), depsOf({ model }));
    expect(response.status).toBe(502);
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  test("refuses the review's amplification, 512 macros on one huge shared definition, with 413 before any call", async () => {
    const shared = `macro:->${"\\relax ".repeat(26_000)}`.slice(0, 180_000);
    const request = await commandsRequest(
      Array.from({ length: 512 }, (_, i) => ({
        name: `zzm${i}`,
        text: `macro:->\\zz@base ${"\\hskip 1pt ".repeat(50)}% ${i}`.slice(0, 600),
        dependencies: ["zz@base"],
      })),
      [{ name: "zz@base", text: shared }],
    );
    const body = JSON.stringify(request);
    const model = idle();
    const cache = memoryCache();
    const rates = new MemoryRateStore();
    const deps = depsOf({ model, cache, rates });
    const response = await read(await handleName(post(body), deps));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect([response.status, response.json]).toEqual([
      413,
      { error: "The template is too large to name here." },
    ]);
    expect(cache.puts).toBe(0);
    // No character was sent, and none is taken from the address's day.
    expect(rates.get("192.0.2.10")?.chars).toBe(LIMITS.charsPerDay);
    // Within the body's cap, and many more parts than a request may be asked in.
    expect(body.length).toBeLessThan(LIMITS.bytes);
    expect(batchesOf(request).length).toBeGreaterThan(20);
  });

  test("refuses with 413 before any call a request of few parts that sends more than 400,000 characters", async () => {
    // Three macros of 150,000 characters each: three parts, 480,000 characters or so in all.
    const request = await commandsRequest(
      ["cvbiga", "cvbigb", "cvbigc"].map((name, i) => ({
        name,
        text: `macro:->${`\\hskip ${i}pt `.repeat(15_000)}`.slice(0, 150_000),
      })),
    );
    const model = idle();
    const response = await read(await handleName(post(JSON.stringify(request)), depsOf({ model })));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect([response.status, response.json]).toEqual([
      413,
      { error: "The template is too large to name here." },
    ]);
    const parts = batchesOf(request);
    expect(parts).toHaveLength(3);
    expect(parts.reduce((sum, part) => sum + part.chars, 0)).toBeGreaterThan(LIMITS.chars);
  });

  test("takes what the model was sent from the address's day, and refuses its next request while it is spent", async () => {
    // A day of exactly what the invented request's call sends.
    const probe = answering(inventedNaming());
    await named(await inventedRequest(), depsOf({ model: probe }));
    const sent = charsOf(probe.doGenerateCalls[0]?.prompt ?? []);
    const limits = { ...LIMITS, charsPerDay: sent };
    const rates = new MemoryRateStore();
    let now = 1_800_000_000_000;
    const ask = async (address: string) =>
      handleName(
        post(JSON.stringify(await inventedRequest())),
        depsOf({ model: answering(inventedNaming()), rates, limits, address, now: () => now }),
      );
    expect((await ask("192.0.2.10")).status).toBe(200);
    const spent = await ask("192.0.2.10");
    expect(spent.status).toBe(429);
    expect(rates.get("192.0.2.10")?.chars).toBeCloseTo(0, 6);
    const wait = Number(spent.headers.get("retry-after"));
    expect(wait).toBe(Math.ceil(86_400 / sent));
    // Another address has a day of its own; this one may ask again once it holds a character.
    expect((await ask("198.51.100.7")).status).toBe(200);
    now += wait * 1000;
    expect((await ask("192.0.2.10")).status).toBe(200);
  });

  test("files each part as it validates, so that a later part's failure loses none, and the next request asks the rest", async () => {
    // Six macros of 20,000 characters, three to a part of 75,000.
    const request = await commandsRequest(
      Array.from({ length: 6 }, (_, i) => ({
        name: `cvpart${String.fromCharCode(97 + i)}`,
        text: `macro:->${`\\kern ${i}pt `.repeat(2000)}`.slice(0, 20_000),
      })),
    );
    const parts = batchesOf(request, 75_000);
    expect(parts.map((part) => part.request.macros.length)).toEqual([3, 3]);
    const first = new Set(parts[0]?.request.macros.map((macro) => macro.name));
    const limits = { ...LIMITS, budget: 75_000 };
    // The second part's answers give an entry a slot it has not, every time.
    const failing = answeringEach((macro) =>
      first.has(macro.name)
        ? OTHER
        : ({
            kind: "entry",
            arguments: [{ index: 1, meaning: "title", slot: "phone" }],
            repeatable: true,
          } as ModelAnswer),
    );
    const cache = memoryCache();
    const response = await read(
      await handleName(post(JSON.stringify(request)), depsOf({ cache, limits, model: failing })),
    );
    expect([response.status, response.json]).toEqual([
      422,
      { error: "The naming model's answer did not validate." },
    ]);
    expect([...cache.held.values()].map((each) => (each as StoredAnswer).name).sort()).toEqual(
      [...first].sort(),
    );
    const { reply } = await named(
      request,
      depsOf({ cache, limits, model: answeringEach(() => OTHER) }),
    );
    expect(reply).toMatchObject({ hits: first.size, asked: 6 - first.size, missing: [] });
  });

  test("limits each address with 429 and Retry-After, and lets it in again as its buckets fill", async () => {
    const request = JSON.stringify(await inventedRequest());
    let now = 1_800_000_000_000;
    const rates = new MemoryRateStore();
    const limits = { ...LIMITS, perMinute: 2, perDay: 3 };
    const ask = async (address: string) => {
      const response = await handleName(
        post(request),
        depsOf({ rates, limits, address, now: () => now }),
      );
      return {
        status: response.status,
        retry: response.headers.get("retry-after"),
        text: await response.text(),
      };
    };
    expect((await ask("192.0.2.10")).status).toBe(200);
    expect((await ask("192.0.2.10")).status).toBe(200);
    const limited = await ask("192.0.2.10");
    expect(limited).toMatchObject({ status: 429, retry: "30" });
    expect(JSON.parse(limited.text)).toEqual({
      error:
        "Too many naming requests from this address: try again after the seconds Retry-After gives.",
    });
    // Another address has buckets of its own.
    expect((await ask("198.51.100.7")).status).toBe(200);
    now += 29_000;
    expect(await ask("192.0.2.10")).toMatchObject({ status: 429, retry: "1" });
    now += 1_000;
    expect((await ask("192.0.2.10")).status).toBe(200);
    // Three in a day: the minute's bucket is full again, the day's is not.
    now += 60_000;
    const day = await ask("192.0.2.10");
    expect(day.status).toBe(429);
    const wait = Number(day.retry);
    expect(wait).toBeGreaterThan(28_000);
    expect(wait).toBeLessThanOrEqual(86_400 / 3);
    now += wait * 1000;
    expect((await ask("192.0.2.10")).status).toBe(200);
    // Addresses of one IPv6 /48, in two of its /64s, draw on one pair of buckets.
    const one = { ...limits, perMinute: 1 };
    const v6 = async (address: string) =>
      (await handleName(post(request), depsOf({ rates, limits: one, address, now: () => now })))
        .status;
    expect(await v6("2001:db8:5:6::a")).toBe(200);
    expect(await v6("2001:db8:5:6:ffff:1:2:3")).toBe(429);
    expect(await v6("2001:db8:5:7::a")).toBe(429);
    expect(await v6("2001:db8:6::a")).toBe(200);
  });

  test("lets requests through when the rate limit's store fails, and says so once, by the error's class alone", async () => {
    const request = JSON.stringify(await inventedRequest());
    const broken = {
      get: () => {
        throw new Error("KV GET failed: 429 Too Many Requests for rate:192.0.2.10");
      },
      put: () => {
        throw new Error("KV put() limit exceeded for the day.");
      },
    };
    const lines: string[] = [];
    for (const address of ["192.0.2.10", "198.51.100.7", "203.0.113.9"]) {
      const deps = depsOf({ rates: broken, address });
      expect((await handleName(post(request), deps)).status, address).toBe(200);
      lines.push(...deps.lines);
    }
    expect(lines).toEqual([
      "warn: The naming route's rate limit could not use its store (Error): requests go on uncounted.",
    ]);
  });

  test("refuses another method with 405 and another content type with 415", async () => {
    const request = JSON.stringify(await inventedRequest());
    const get = await handleName(new Request(`http://localhost${ROUTE}`), depsOf());
    expect([get.status, get.headers.get("allow")]).toEqual([405, "POST"]);
    // A form's or a plain text's content type, which a page on another site could send without asking.
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "application/jsonx"]) {
      const response = await handleName(post(request, {}, { "Content-Type": type }), depsOf());
      expect(response.status, type).toBe(415);
    }
    const charset = await handleName(
      post(request, {}, { "Content-Type": "application/json; charset=utf-8" }),
      depsOf(),
    );
    expect(charset.status).toBe(200);
  });

  test("answers 500 when its cache fails, logs the error's class alone, and still answers when only filing fails", async () => {
    const request = await inventedRequest();
    const broken = depsOf({
      cache: {
        get: () => {
          throw new Error(`The cache held ${TEXTS.cventry}`);
        },
        put: () => false,
      },
    });
    const failed = await read(await handleName(post(JSON.stringify(request)), broken));
    expect([failed.status, failed.json]).toEqual([500, { error: "The naming service failed." }]);
    expect(broken.lines).toEqual(["warn: The naming service failed: Error."]);
    const unfiled = depsOf({
      cache: {
        get: () => undefined,
        put: () => {
          throw new TypeError(`Could not file ${SITES.cventry[0]}`);
        },
      },
      model: answering(inventedNaming()),
    });
    const answered = await read(await handleName(post(JSON.stringify(request)), unfiled));
    expect(answered.status).toBe(200);
    expect(NamingReply.parse(answered.json).macros).toHaveLength(3);
    expect(unfiled.lines.filter((line) => line.startsWith("warn"))).toEqual(
      Array(3).fill("warn: The naming service could not file an answer: TypeError."),
    );
  });
});
