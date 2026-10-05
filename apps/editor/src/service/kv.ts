/**
 * The service's store on Cloudflare KV (milestone 3 item 10, decision 0028): the rate limit's
 * buckets, in the namespace the label route's Pages Function is bound to, `LABEL_KV`, under its
 * prefix. It takes any store with KV's `get` and `put`, which Workers' `KVNamespace` is, so it is
 * written and tested without the Workers runtime. The first pass's answer and preamble caches in
 * KV went with the naming step (decision 0063).
 *
 * KV is eventually consistent, a write seen at once where it was made and within a minute
 * elsewhere, and a key takes one write a second, so the rate limit holds only roughly.
 */

import type { Buckets, RateStore } from "./rate.ts";

/** The part of a KV namespace the store uses. */
export interface KeyValue {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
}

/** The shortest expiry KV takes, in seconds. */
export const KV_SHORTEST_TTL = 60;

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
      const { at, minute, day, chars } = JSON.parse(text) as Partial<
        Record<keyof Buckets, unknown>
      >;
      return typeof at === "number" &&
        typeof minute === "number" &&
        typeof day === "number" &&
        typeof chars === "number" &&
        [at, minute, day, chars].every(Number.isFinite)
        ? { at, minute, day, chars }
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
