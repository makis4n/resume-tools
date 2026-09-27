import {
  type NamingRequest,
  NamingRequest as NamingRequestSchema,
  StoredAnswer,
  storedAnswersOf,
} from "@resume-tools/naming";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test } from "vitest";
import { inventedNaming, inventedRequest, memoryCache, SITES, TEXTS } from "./invented";
import { handleName, LIMITS, type NameDeps, ROUTE } from "./name";
import { MemoryRateStore } from "./rate";
import { NamingReply } from "./reply";

// Every template, request and answer here is invented, and no test calls a provider: the model is
// the AI SDK's mock, which answers what each test gives it.

type Result = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

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

/** The handler's dependencies for a test, with the lines it logs. */
function depsOf(overrides: Partial<NameDeps> = {}): NameDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    cache: memoryCache(),
    model: undefined,
    address: "192.0.2.10",
    rates: new MemoryRateStore(),
    limits: LIMITS,
    now: () => 1_800_000_000_000,
    log: (line) => lines.push(line),
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

describe("the naming route", () => {
  test("answers from the cache alone when it holds every macro, and asks the model nothing", async () => {
    const request = await inventedRequest();
    const cache = memoryCache();
    const stored = await storedAnswersOf(request, inventedNaming(), "model:invented-model");
    for (const each of stored) cache.put(each.key, each);
    const model = idle();
    const deps = depsOf({ cache, model });
    const { status, text, json } = await read(
      await handleName(post(JSON.stringify(request)), deps),
    );
    expect(status).toBe(200);
    expect(model.doGenerateCalls).toHaveLength(0);
    const answer = NamingReply.parse(json);
    expect(answer).toEqual({
      version: 1,
      macros: stored,
      preamble: { parameters: [] },
      hits: 3,
      asked: 0,
      missing: [],
    });
    expectNoEcho(text, request);
  });

  test("asks the model once for what the cache lacks, files it, and answers the same request from the cache next", async () => {
    const request = await inventedRequest();
    const cache = memoryCache();
    const model = answering(inventedNaming());
    const deps = depsOf({ cache, model });
    const first = await read(await handleName(post(JSON.stringify(request)), deps));
    expect(first.status).toBe(200);
    expect(model.doGenerateCalls).toHaveLength(1);
    const answer = NamingReply.parse(first.json);
    expect(answer).toMatchObject({ hits: 0, asked: 3, missing: [] });
    expect(answer.preamble).toEqual(inventedNaming().preamble);
    const keyed = request.macros.filter((macro) => macro.key !== undefined);
    expect(answer.macros.map((each) => [each.of, each.name, each.key])).toEqual(
      keyed.map((macro) => [macro.of, macro.name, macro.key]),
    );
    // Filed under their keys, the model's and unreviewed.
    expect([...cache.held.keys()].sort()).toEqual(keyed.map((macro) => macro.key).sort());
    for (const each of answer.macros)
      expect(StoredAnswer.parse(cache.held.get(each.key))).toMatchObject({
        reviewed: false,
        source: "model:invented-model",
      });
    expectNoEcho(first.text, request);
    const second = await read(await handleName(post(JSON.stringify(request)), deps));
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(NamingReply.parse(second.json)).toMatchObject({
      macros: answer.macros,
      hits: 3,
      asked: 0,
      missing: [],
    });
    // The macro whose own definition holds data has no key: it is never asked, nor missing.
    const user = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(user).toContain('### command \\"cventry\\"');
    expect(user).not.toContain('### command \\"cvtagline\\"');
  });

  test("names what it cannot answer when no model is configured, and files nothing", async () => {
    const request = await inventedRequest();
    const cache = memoryCache();
    const [section] = await storedAnswersOf(request, inventedNaming(), "model:invented-model");
    if (section === undefined) throw new Error("no answer");
    cache.put(section.key, section);
    const { status, json } = await read(
      await handleName(post(JSON.stringify(request)), depsOf({ cache })),
    );
    expect(status).toBe(200);
    expect(NamingReply.parse(json)).toEqual({
      version: 1,
      macros: [section],
      preamble: { parameters: [] },
      hits: 1,
      asked: 0,
      missing: request.macros
        .filter((macro) => macro.key !== undefined && macro.name !== "cvsection")
        .map((macro) => ({ of: macro.of, name: macro.name, key: macro.key })),
    });
    expect(cache.puts).toBe(1);
  });

  test("files one answer to a key, the first the model gives, as a later hit gives it", async () => {
    const request = await inventedRequest();
    // A second command whose definition and closure are the section's: it has the section's key.
    const twin = NamingRequestSchema.parse({
      ...request,
      macros: [...request.macros, { ...request.macros[0], name: "cvheading" }],
      definitions: [
        ...request.definitions,
        { ...request.definitions.find((each) => each.name === "cvsection"), name: "cvheading" },
      ],
    });
    const naming = inventedNaming();
    const model = answering({
      ...naming,
      macros: [
        ...naming.macros,
        {
          of: "command",
          name: "cvheading",
          answer: { kind: "other", arguments: [], repeatable: false },
        },
      ],
    });
    const cache = memoryCache();
    const deps = depsOf({ cache, model });
    const first = NamingReply.parse(
      (await read(await handleName(post(JSON.stringify(twin)), deps))).json,
    );
    expect(first).toMatchObject({ hits: 0, asked: 4, missing: [] });
    expect(first.macros.map((each) => each.name)).toEqual(["cvsection", "cventry", "cvitems"]);
    expect(cache.puts).toBe(3);
    const second = NamingReply.parse(
      (await read(await handleName(post(JSON.stringify(twin)), deps))).json,
    );
    expect(second).toMatchObject({ macros: first.macros, hits: 4, asked: 0 });
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
    // Two addresses of one IPv6 /64 draw on one pair of buckets.
    const one = { ...limits, perMinute: 1 };
    const v6 = async (address: string) =>
      (await handleName(post(request), depsOf({ rates, limits: one, address, now: () => now })))
        .status;
    expect(await v6("2001:db8:5:6::a")).toBe(200);
    expect(await v6("2001:db8:5:6:ffff:1:2:3")).toBe(429);
    expect(await v6("2001:db8:5:7::a")).toBe(200);
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
        put: () => undefined,
      },
    });
    const failed = await read(await handleName(post(JSON.stringify(request)), broken));
    expect([failed.status, failed.json]).toEqual([500, { error: "The naming service failed." }]);
    expect(broken.lines).toEqual(["The naming service failed: Error."]);
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
    expect(unfiled.lines).toEqual(
      Array(3).fill("The naming service could not file an answer: TypeError."),
    );
  });
});
