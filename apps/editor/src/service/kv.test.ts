import {
  answerFor,
  NAMING_VERSION,
  type StoredAnswer,
  storedAnswersOf,
} from "@resume-tools/naming";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test } from "vitest";
import { inventedNaming, inventedRequest } from "./invented";
import { type KeyValue, KV_SHORTEST_TTL, KvAnswerCache, KvRateStore } from "./kv";
import { handleName, LIMITS, ROUTE } from "./name";
import { take } from "./rate";
import { NamingReply } from "./reply";

// A namespace in memory that keeps to KV's rules as the stores meet them: a key takes one write a
// second, and an expiry is a minute at least. Every answer here is invented.

class FakeKv implements KeyValue {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number | undefined>();
  private readonly written = new Map<string, number>();
  now = 0;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const last = this.written.get(key);
    if (last !== undefined && this.now - last < 1000)
      throw new Error("KV PUT failed: 429 Too Many Requests");
    if (options?.expirationTtl !== undefined && options.expirationTtl < KV_SHORTEST_TTL)
      throw new Error("KV PUT failed: 400 Invalid expiration_ttl");
    this.written.set(key, this.now);
    this.values.set(key, value);
    this.ttls.set(key, options?.expirationTtl);
  }
}

describe("the answer cache on KV", () => {
  test("files a stored answer under answer:<key>, for good, and gives it back as answerFor takes it", async () => {
    const request = await inventedRequest();
    const [stored] = await storedAnswersOf(request, inventedNaming(), "model:invented-model");
    if (stored === undefined) throw new Error("no answer");
    const kv = new FakeKv();
    const cache = new KvAnswerCache(kv);
    expect(await answerFor(cache, stored.key)).toBeUndefined();
    await cache.put(stored.key, stored);
    expect([...kv.values.keys()]).toEqual([`answer:${stored.key}`]);
    expect(kv.ttls.get(`answer:${stored.key}`)).toBeUndefined();
    expect(await answerFor(cache, stored.key)).toEqual(stored);
    // What a namespace holds is not trusted: another version's answer is no answer.
    kv.values.set(
      `answer:${"d".repeat(64)}`,
      JSON.stringify({ ...stored, key: "d".repeat(64), version: NAMING_VERSION + 1 }),
    );
    expect(await answerFor(cache, "d".repeat(64))).toBeUndefined();
  });

  test("files nothing but a stored answer under its own key, and reads no key that is not a hash", async () => {
    const request = await inventedRequest();
    const [stored] = await storedAnswersOf(request, inventedNaming(), "model:invented-model");
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

describe("the rate limit's buckets on KV", () => {
  test("are kept under rate:<address> until they would be full, a minute at least", async () => {
    const kv = new FakeKv();
    const store = new KvRateStore(kv);
    expect(await take(store, "192.0.2.10", 1_800_000_000_000, LIMITS)).toEqual({ allowed: true });
    expect(JSON.parse(kv.values.get("rate:192.0.2.10") ?? "")).toEqual({
      at: 1_800_000_000_000,
      minute: 9,
      day: 99,
    });
    expect(kv.ttls.get("rate:192.0.2.10")).toBe(864);
    // Buckets full again in six seconds are kept a minute, KV's shortest.
    await take(store, "198.51.100.7", 1_800_000_000_000, { perMinute: 10, perDay: 1_000_000 });
    expect(kv.ttls.get("rate:198.51.100.7")).toBe(KV_SHORTEST_TTL);
  });

  test("refuse for a second a request KV will not count, as a second write to a key within a second", async () => {
    const kv = new FakeKv();
    const store = new KvRateStore(kv);
    expect(await take(store, "a", 1_800_000_000_000, LIMITS)).toEqual({ allowed: true });
    expect(await take(store, "a", 1_800_000_000_000, LIMITS)).toEqual({
      allowed: false,
      retryAfter: 1,
    });
    kv.now = 1000;
    expect(await take(store, "a", 1_800_000_001_000, LIMITS)).toEqual({ allowed: true });
  });

  test("read what is not buckets as none", async () => {
    const kv = new FakeKv();
    const store = new KvRateStore(kv);
    for (const text of ["not json", "{}", JSON.stringify({ at: 1, minute: "9", day: 9 }), "null"]) {
      kv.values.set("rate:a", text);
      expect(await store.get("a"), text).toBeUndefined();
    }
  });
});

describe("the route on KV", () => {
  test("files the model's answers in the namespace and answers the same request from it next", async () => {
    const request = JSON.stringify(await inventedRequest());
    const kv = new FakeKv();
    const model = new MockLanguageModelV4({
      modelId: "invented-model",
      doGenerate: async () => ({
        content: [{ type: "text", text: JSON.stringify(inventedNaming()) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: undefined },
          outputTokens: { total: 300, text: 300, reasoning: 0 },
        },
        warnings: [],
      }),
    });
    const ask = async (now: number) => {
      kv.now = now;
      const response = await handleName(
        new Request(`http://localhost${ROUTE}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: request,
        }),
        {
          cache: new KvAnswerCache(kv),
          rates: new KvRateStore(kv),
          model,
          address: "192.0.2.10",
          limits: LIMITS,
          now: () => 1_800_000_000_000 + now,
        },
      );
      return NamingReply.parse(await response.json());
    };
    expect(await ask(0)).toMatchObject({ hits: 0, asked: 3 });
    expect([...kv.values.keys()].filter((key) => key.startsWith("answer:"))).toHaveLength(3);
    expect(await ask(2000)).toMatchObject({ hits: 3, asked: 0 });
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
