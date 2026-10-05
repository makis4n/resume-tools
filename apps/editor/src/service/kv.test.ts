import { describe, expect, test } from "vitest";
import { type KeyValue, KV_SHORTEST_TTL, KvRateStore } from "./kv";
import { type RateLimits, take } from "./rate";

// A namespace in memory that keeps to KV's rules as the store meets them: a key takes one write a
// second, an expiry is a minute at least, and metadata a kilobyte at most.

type Options = { expirationTtl?: number; metadata?: unknown };

class FakeKv implements KeyValue {
  readonly values = new Map<string, string>();
  readonly options = new Map<string, Options | undefined>();
  private readonly written = new Map<string, number>();
  now = 0;

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
    this.written.set(key, this.now);
    this.values.set(key, value);
    this.options.set(key, options);
  }
}

const T0 = 1_800_000_000_000;

/** Invented limits: ten requests a minute, a hundred a day, two million characters a day. */
const LIMITS: RateLimits = { perMinute: 10, perDay: 100, charsPerDay: 2_000_000 };

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
