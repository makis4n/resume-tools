/**
 * The naming service's stores on Cloudflare KV (milestone 3 item 10, decision 0028): the answer
 * cache and the rate limit's buckets, both in the one namespace the Pages Function is bound to,
 * `NAMING_KV`, under a prefix each. They take any store with KV's `get` and `put`, which Workers'
 * `KVNamespace` is, so they are written and tested without the Workers runtime.
 *
 * KV is eventually consistent: a write is seen at once where it was made and within a minute
 * elsewhere, and a key takes one write a second. The cache minds neither, since an answer filed
 * twice is the same answer; the rate limit holds only roughly (decision 0028).
 */

import { type AnswerCache, type StoredAnswer, storable } from "@resume-tools/naming";
import type { Buckets, RateStore } from "./rate.ts";

/** The part of a KV namespace the stores use. */
export interface KeyValue {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** The shortest expiry KV takes, in seconds. */
export const KV_SHORTEST_TTL = 60;

/** A key as the cache takes it: a SHA-256 in lower-case hex. */
const KEY = /^[0-9a-f]{64}$/;

/**
 * The answer cache on KV: a stored answer's JSON under `answer:<key>`, for good until milestone 5
 * decides what is evicted. What it gives back is checked by `answerFor`, as every cache's is, and
 * what it files by `storable`.
 */
export class KvAnswerCache implements AnswerCache {
  readonly kv: KeyValue;
  readonly prefix: string;

  constructor(kv: KeyValue, prefix = "answer:") {
    this.kv = kv;
    this.prefix = prefix;
  }

  async get(key: string): Promise<string | undefined> {
    if (!KEY.test(key)) return undefined;
    return (await this.kv.get(`${this.prefix}${key}`)) ?? undefined;
  }

  async put(key: string, answer: StoredAnswer): Promise<void> {
    if (!KEY.test(key)) throw new Error("A stored answer's key is 64 lower-case hex digits");
    await this.kv.put(`${this.prefix}${key}`, JSON.stringify(storable(key, answer)));
  }
}

/**
 * The rate limit's buckets on KV: under `rate:<address key>`, expiring once they would be full
 * again, or after a minute, KV's shortest. What cannot be read as buckets is none.
 */
export class KvRateStore implements RateStore {
  readonly kv: KeyValue;
  readonly prefix: string;

  constructor(kv: KeyValue, prefix = "rate:") {
    this.kv = kv;
    this.prefix = prefix;
  }

  async get(address: string): Promise<Buckets | undefined> {
    const text = await this.kv.get(`${this.prefix}${address}`);
    if (text === null) return undefined;
    try {
      const { at, minute, day } = JSON.parse(text) as Partial<Record<keyof Buckets, unknown>>;
      return typeof at === "number" &&
        typeof minute === "number" &&
        typeof day === "number" &&
        [at, minute, day].every(Number.isFinite)
        ? { at, minute, day }
        : undefined;
    } catch {
      return undefined;
    }
  }

  async put(address: string, buckets: Buckets, seconds: number): Promise<void> {
    await this.kv.put(`${this.prefix}${address}`, JSON.stringify(buckets), {
      expirationTtl: Math.max(KV_SHORTEST_TTL, Math.ceil(seconds)),
    });
  }
}
