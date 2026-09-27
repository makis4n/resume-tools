import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  answerFor,
  type ModelAnswer,
  NAMING_VERSION,
  NamingRequest,
  StoredAnswer,
  sha256,
  storedAnswersOf,
} from "@resume-tools/naming";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test } from "vitest";
import { commandsRequest, inventedNaming, inventedRequest } from "./invented";
import {
  type KeyValue,
  KV_SHORTEST_TTL,
  KvAnswerCache,
  KvPreambleCache,
  KvRateStore,
  MODEL_ANSWER_TTL,
} from "./kv";
import { handleName, LIMITS, type NameDeps, type Provenance, ROUTE } from "./name";
import { preambleKey } from "./preamble";
import { take } from "./rate";
import { NamingReply } from "./reply";

// A namespace in memory that keeps to KV's rules as the stores meet them: a key takes one write a
// second, an expiry is a minute at least, and metadata a kilobyte at most. Every answer here is
// invented, but for the seed's committed answers for Jake's Resume's list macros.

type Options = { expirationTtl?: number; metadata?: unknown };

class FakeKv implements KeyValue {
  readonly values = new Map<string, string>();
  readonly options = new Map<string, Options | undefined>();
  private readonly written = new Map<string, number>();
  now = 0;
  writes = 0;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string, options?: Options): Promise<void> {
    const last = this.written.get(key);
    if (last !== undefined && this.now - last < 1000)
      throw new Error("KV PUT failed: 429 Too Many Requests");
    if (options?.expirationTtl !== undefined && options.expirationTtl < KV_SHORTEST_TTL)
      throw new Error("KV PUT failed: 400 Invalid expiration_ttl");
    if (JSON.stringify(options?.metadata ?? null).length > 1024)
      throw new Error("KV PUT failed: 413 Metadata too large");
    this.writes++;
    this.written.set(key, this.now);
    this.values.set(key, value);
    this.options.set(key, options);
  }

  /** The keys under a prefix. */
  keys(prefix: string): string[] {
    return [...this.values.keys()].filter((key) => key.startsWith(prefix));
  }
}

const T0 = 1_800_000_000_000;

/** A mock that answers each part for the macros its prompt asks, each call taking two seconds. */
function answeringEach(kv: FakeKv, answerOf: (macro: { name: string }) => ModelAnswer) {
  const preamble = inventedNaming().preamble;
  return new MockLanguageModelV4({
    modelId: "invented-model",
    doGenerate: async (options) => {
      kv.now += 2000;
      const text = options.prompt
        .flatMap((message) =>
          message.role === "user" && typeof message.content !== "string"
            ? message.content.map((part) => ("text" in part ? part.text : ""))
            : [],
        )
        .join("");
      const macros = [...text.matchAll(/^### (command|environment) "([^"]+)"$/gm)].map((found) => ({
        of: found[1],
        name: found[2] ?? "",
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              macros: macros.map((macro) => ({ ...macro, answer: answerOf(macro) })),
              preamble: text.includes("[0] \\geometry") ? preamble : { parameters: [] },
            }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: undefined },
          outputTokens: { total: 300, text: 300, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

/** The invented answer for a macro, by its name, or `other`. */
const inventedOf = (macro: { name: string }): ModelAnswer =>
  inventedNaming().macros.find((each) => each.name === macro.name)?.answer ?? {
    kind: "other",
    arguments: [],
    repeatable: false,
  };

/** The route on one namespace, as the Pages Function binds it, with the lines it logs. */
function onKv(kv: FakeKv, overrides: Partial<NameDeps> = {}): NameDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    cache: new KvAnswerCache(kv),
    preambles: new KvPreambleCache(kv),
    rates: new KvRateStore(kv),
    model: undefined,
    address: "192.0.2.10",
    limits: LIMITS,
    now: () => T0 + kv.now,
    log: (line, level) => lines.push(`${level}: ${line}`),
    lines,
    ...overrides,
  };
}

/** A request posted to the route, and its reply, which must be one. */
async function named(request: NamingRequest, deps: NameDeps) {
  const response = await handleName(
    new Request(`http://localhost${ROUTE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }),
    deps,
  );
  return { status: response.status, reply: NamingReply.parse(await response.json()) };
}

/** A person's reviewed answer, as milestone 5 uploads the committed ones, from a model's. */
const reviewedOf = (stored: StoredAnswer) =>
  StoredAnswer.parse({
    ...stored,
    answer: { ...stored.answer, reviewed: true },
    reviewed: true,
    source: "seed",
  });

describe("the answer cache on KV", () => {
  test("files a model's answer under answer:<key> for 90 days, with who filed it, and gives it back as answerFor takes it", async () => {
    const request = await inventedRequest();
    const {
      answers: [stored],
    } = await storedAnswersOf(request, inventedNaming(), "model:invented-model");
    if (stored === undefined) throw new Error("no answer");
    const kv = new FakeKv();
    const cache = new KvAnswerCache(kv);
    expect(await answerFor(cache, stored.key)).toBeUndefined();
    const provenance: Provenance = {
      filedAt: "2027-01-15T08:00:00.000Z",
      model: "invented-model",
      by: "a".repeat(64),
    };
    expect(await cache.put(stored.key, stored, provenance)).toBe(true);
    expect(kv.keys("")).toEqual([`answer:${stored.key}`]);
    expect(kv.options.get(`answer:${stored.key}`)).toEqual({
      expirationTtl: MODEL_ANSWER_TTL,
      metadata: provenance,
    });
    expect(MODEL_ANSWER_TTL).toBe(90 * 86_400);
    expect(await answerFor(cache, stored.key)).toEqual(stored);
    // A person's reviewed answer is kept for good.
    const other = new FakeKv();
    await new KvAnswerCache(other).put(stored.key, reviewedOf(stored));
    expect(other.options.get(`answer:${stored.key}`)).toEqual({});
    // What a namespace holds is not trusted: another version's answer is no answer.
    kv.values.set(
      `answer:${"d".repeat(64)}`,
      JSON.stringify({ ...stored, key: "d".repeat(64), version: NAMING_VERSION + 1 }),
    );
    expect(await answerFor(cache, "d".repeat(64))).toBeUndefined();
  });

  test("never files over what a key holds, a person's reviewed answer above all", async () => {
    // The review's shape: a model's answer put under the key of an uploaded reviewed one.
    const request = await inventedRequest();
    const {
      answers: [stored],
    } = await storedAnswersOf(request, inventedNaming(), "model:invented-model");
    if (stored === undefined) throw new Error("no answer");
    const kv = new FakeKv();
    const cache = new KvAnswerCache(kv);
    const reviewed = reviewedOf(stored);
    kv.values.set(`answer:${stored.key}`, JSON.stringify(reviewed));
    expect(await cache.put(stored.key, stored)).toBe(false);
    expect(kv.writes).toBe(0);
    expect(await answerFor(cache, stored.key)).toEqual(reviewed);
  });

  test("files nothing but a stored answer under its own key, and reads no key that is not a hash", async () => {
    const request = await inventedRequest();
    const {
      answers: [stored],
    } = await storedAnswersOf(request, inventedNaming(), "model:invented-model");
    if (stored === undefined) throw new Error("no answer");
    const kv = new FakeKv();
    const cache = new KvAnswerCache(kv);
    await expect(cache.put("c".repeat(64), stored)).rejects.toThrow();
    await expect(
      cache.put(stored.key, { ...stored, reviewed: true } as StoredAnswer),
    ).rejects.toThrow();
    await expect(cache.put("../escaped", stored)).rejects.toThrow();
    expect(kv.values.size).toBe(0);
    kv.values.set("answer:../escaped", JSON.stringify(stored));
    expect(await cache.get("../escaped")).toBeUndefined();
  });
});

describe("the preambles' answers on KV", () => {
  test("are filed under preamble:<key> for 90 days, once, and read back", async () => {
    const request = await inventedRequest();
    const key = await preambleKey(request);
    const kv = new FakeKv();
    const preambles = new KvPreambleCache(kv);
    const stored = {
      version: NAMING_VERSION,
      key,
      source: "model:invented-model",
      preamble: inventedNaming().preamble,
    } as const;
    expect(await preambles.put(key, stored)).toBe(true);
    expect(kv.options.get(`preamble:${key}`)).toEqual({ expirationTtl: MODEL_ANSWER_TTL });
    expect(JSON.parse((await preambles.get(key)) ?? "")).toEqual(stored);
    kv.now = 5000;
    expect(await preambles.put(key, { ...stored, preamble: { parameters: [] } })).toBe(false);
    expect(JSON.parse((await preambles.get(key)) ?? "")).toEqual(stored);
    await expect(preambles.put("e".repeat(64), stored)).rejects.toThrow();
    expect(await preambles.get("../escaped")).toBeUndefined();
  });
});

describe("the rate limit's buckets on KV", () => {
  test("are kept under rate:<address> until they would be full, a minute at least", async () => {
    const kv = new FakeKv();
    const store = new KvRateStore(kv);
    expect(await take(store, "192.0.2.10", T0, LIMITS)).toEqual({ allowed: true });
    expect(JSON.parse(kv.values.get("rate:192.0.2.10") ?? "")).toEqual({
      at: T0,
      minute: 9,
      day: 99,
      chars: LIMITS.charsPerDay,
    });
    expect(kv.options.get("rate:192.0.2.10")).toEqual({ expirationTtl: 864 });
    // Buckets full again in six seconds are kept a minute, KV's shortest.
    await take(store, "198.51.100.7", T0, { ...LIMITS, perDay: 1_000_000 });
    expect(kv.options.get("rate:198.51.100.7")).toEqual({ expirationTtl: KV_SHORTEST_TTL });
  });

  test("let a request KV will not count through, as a second write to a key within a second", async () => {
    const kv = new FakeKv();
    const store = new KvRateStore(kv);
    expect(await take(store, "a", T0, LIMITS)).toEqual({ allowed: true });
    expect(await take(store, "a", T0, LIMITS)).toEqual({ allowed: true, failed: "Error" });
    kv.now = 1000;
    expect(await take(store, "a", T0 + 1000, LIMITS)).toEqual({ allowed: true });
  });

  test("read what is not buckets as none", async () => {
    const kv = new FakeKv();
    const store = new KvRateStore(kv);
    for (const text of [
      "not json",
      "{}",
      JSON.stringify({ at: 1, minute: "9", day: 9, chars: 9 }),
      JSON.stringify({ at: 1, minute: 9, day: 9 }),
      "null",
    ]) {
      kv.values.set("rate:a", text);
      expect(await store.get("a"), text).toBeUndefined();
    }
  });
});

describe("the route on KV", () => {
  test("files the model's answers with who filed them, one line a key, and answers the same request from the namespace next, writing only its bucket", async () => {
    const request = await inventedRequest();
    const kv = new FakeKv();
    const model = answeringEach(kv, inventedOf);
    const deps = onKv(kv, { model });
    const first = await named(request, deps);
    expect(first.reply).toMatchObject({ hits: 0, asked: 3, conflicts: 0 });
    const keyed = request.macros.flatMap((macro) => (macro.key === undefined ? [] : [macro.key]));
    expect(kv.keys("answer:").sort()).toEqual(keyed.map((key) => `answer:${key}`).sort());
    // Filed when its part validated, the call's two seconds after the request came.
    const provenance = {
      filedAt: new Date(T0 + 2000).toISOString(),
      model: "invented-model",
      by: await sha256("192.0.2.10"),
    };
    for (const key of keyed)
      expect(kv.options.get(`answer:${key}`)).toEqual({
        expirationTtl: MODEL_ANSWER_TTL,
        metadata: provenance,
      });
    expect(kv.keys("preamble:")).toEqual([`preamble:${await preambleKey(request)}`]);
    // What the call sent is taken from the address's day, after the call.
    const buckets = JSON.parse(kv.values.get("rate:192.0.2.10") ?? "");
    expect(buckets.chars).toBeLessThan(LIMITS.charsPerDay - 10_000);
    // One line a filing, by its key alone: no address, and no answer's words.
    expect(deps.lines.filter((line) => line.includes("answer under"))).toEqual(
      expect.arrayContaining(
        keyed.map((key) => `info: The naming service filed an answer under ${key}.`),
      ),
    );
    expect(deps.lines.join("\n")).not.toMatch(/192\.0\.2|cvsection|section/);
    // A request that every cache answers writes its rate bucket alone.
    kv.now += 2000;
    const writes = kv.writes;
    const second = await named(request, onKv(kv, { model }));
    expect(second.reply).toMatchObject({ hits: 3, asked: 0, preamble: inventedNaming().preamble });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(kv.writes - writes).toBe(1);
  });

  test("gives a request that lists a reviewed answer's macro as the other kind the model's answer, and never files it over the reviewed one", async () => {
    // The review's shape: the key leaves the kind out, so the same definitions give the same key.
    const request = await inventedRequest();
    const {
      answers: [section],
    } = await storedAnswersOf(request, inventedNaming(), "model:invented-model");
    if (section === undefined) throw new Error("no answer");
    const kv = new FakeKv();
    const reviewed = reviewedOf(section);
    kv.values.set(`answer:${section.key}`, JSON.stringify(reviewed));
    const flipped = NamingRequest.parse({
      ...request,
      macros: request.macros.map((macro) =>
        macro.key === section.key ? { ...macro, of: "environment" } : macro,
      ),
    });
    const model = answeringEach(kv, inventedOf);
    const { reply } = await named(flipped, onKv(kv, { model }));
    expect(reply).toMatchObject({ hits: 0, asked: 3, conflicts: 1 });
    expect(reply.macros.find((each) => each.name === "cvsection")).toMatchObject({
      of: "environment",
      reviewed: false,
    });
    expect(JSON.parse(kv.values.get(`answer:${section.key}`) ?? "")).toEqual(reviewed);
  });

  test("answers the review's Jake fork from the uploaded seed with no model call, and files nothing over it", async () => {
    const JAKE = {
      resumeSubHeadingListStart: "\\long macro:->\\begin {itemize}[leftmargin=0.15in, label={}]",
      resumeSubHeadingListEnd: "\\long macro:->\\end {itemize}",
      resumeItemListStart: "\\long macro:->\\begin {itemize}",
      resumeItemListEnd: "\\long macro:->\\end {itemize}\\vspace {-5pt}",
    };
    const kv = new FakeKv();
    // KV as milestone 5's upload of the committed answers leaves it.
    const upstream = await commandsRequest(
      Object.entries(JAKE).map(([name, text]) => ({ name, text })),
    );
    for (const macro of upstream.macros) {
      const file = fileURLToPath(
        new URL(`../../corpus/answers/${macro.key}.json`, import.meta.url),
      );
      kv.values.set(`answer:${macro.key}`, readFileSync(file, "utf8"));
    }
    const uploaded = new Map(kv.values);
    // The fork's item list's closer is a bare \end{itemize}, the sub-heading list's closer's key.
    const fork = await commandsRequest(
      Object.entries({ ...JAKE, resumeItemListEnd: JAKE.resumeSubHeadingListEnd }).map(
        ([name, text]) => ({ name, text }),
      ),
    );
    const model = answeringEach(kv, () => {
      throw new Error("the model was asked");
    });
    const { reply } = await named(fork, onKv(kv, { model }));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(reply).toMatchObject({ hits: 4, asked: 0, missing: [] });
    expect(reply.macros.map((each) => [each.name, each.reviewed])).toEqual(
      Object.keys(JAKE).map((name) => [name, true]),
    );
    expect(kv.keys("answer:").map((key) => kv.values.get(key))).toEqual([...uploaded.values()]);
  });

  test("goes on answering when the namespace's writes are spent", async () => {
    // The review's shape: every write fails, as once the free plan's day of writes is spent.
    const request = await inventedRequest();
    const kv = new FakeKv();
    kv.put = async () => {
      throw new Error("KV put() limit exceeded for the day.");
    };
    for (const [i, address] of ["192.0.2.10", "198.51.100.7", "2001:db8::1"].entries()) {
      kv.now = i * 3_600_000;
      const deps = onKv(kv, { address });
      const response = await handleName(
        new Request(`http://localhost${ROUTE}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        }),
        deps,
      );
      expect(response.status, address).toBe(200);
      expect(response.headers.get("retry-after")).toBeNull();
      expect(deps.lines.join("\n")).not.toMatch(/192\.0\.2|198\.51|2001/);
    }
  });
});
