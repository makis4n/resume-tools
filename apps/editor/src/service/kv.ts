/**
 * The naming service's stores on Cloudflare KV (milestone 3 item 10, decision 0028): the answer
 * cache, the preambles' answers and the rate limit's buckets, all in the one namespace the Pages
 * Function is bound to, `NAMING_KV`, under a prefix each. They take any store with KV's `get` and
 * `put`, which Workers' `KVNamespace` is, so they are written and tested without the Workers
 * runtime.
 *
 * KV has one value a key, and no write that checks what the key holds: an answer is filed only
 * where a read finds the key empty, so that nothing is filed over another answer, a person's
 * reviewed one above all; two filings of one key within the moment between the read and the write
 * can both write, the later kept, which decision 0028 accepts. KV is eventually consistent, a
 * write seen at once where it was made and within a minute elsewhere, and a key takes one write a
 * second, so the rate limit holds only roughly.
 */

import { type StoredAnswer, storable } from "@resume-tools/naming";
import type { Provenance, ServiceCache } from "./name.ts";
import { type PreambleCache, StoredPreamble } from "./preamble.ts";
import type { Buckets, RateStore } from "./rate.ts";

/** The part of a KV namespace the stores use. */
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

/** How long a model's answer is kept, in seconds: 90 days, after which it is asked again. */
export const MODEL_ANSWER_TTL = 90 * 86_400;

/** A key as the cache takes it: a SHA-256 in lower-case hex. */
const KEY = /^[0-9a-f]{64}$/;

/**
 * The answer cache on KV: a stored answer's JSON under `answer:<key>`, a model's for 90 days and a
 * person's reviewed one for good, with who filed it (`Provenance`) as the key's metadata. What it
 * gives back is checked by `answerFor`, as every cache's is, and what it files by `storable`; it
 * files only under a key that holds nothing, and says whether it filed.
 */
export class KvAnswerCache implements ServiceCache {
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

  async put(key: string, answer: StoredAnswer, provenance?: Provenance): Promise<boolean> {
    if (!KEY.test(key)) throw new Error("A stored answer's key is 64 lower-case hex digits");
    const value = JSON.stringify(storable(key, answer));
    const at = `${this.prefix}${key}`;
    if ((await this.kv.get(at)) !== null) return false;
    await this.kv.put(at, value, {
      ...(answer.reviewed ? {} : { expirationTtl: MODEL_ANSWER_TTL }),
      ...(provenance === undefined ? {} : { metadata: provenance }),
    });
    return true;
  }
}

/**
 * The preambles' answers on KV: under `preamble:<key>`, the key the SHA-256 of the preamble's
 * masked class and settings (`preambleKey`), for 90 days, with who filed each as its metadata, and
 * only under a key that holds nothing, as the answers are.
 */
export class KvPreambleCache implements PreambleCache {
  readonly kv: KeyValue;
  readonly prefix: string;

  constructor(kv: KeyValue, prefix = "preamble:") {
    this.kv = kv;
    this.prefix = prefix;
  }

  async get(key: string): Promise<string | undefined> {
    if (!KEY.test(key)) return undefined;
    return (await this.kv.get(`${this.prefix}${key}`)) ?? undefined;
  }

  async put(key: string, stored: StoredPreamble, provenance?: Provenance): Promise<boolean> {
    if (!KEY.test(key) || stored.key !== key)
      throw new Error("A preamble's answer is filed under its own key");
    const value = JSON.stringify(StoredPreamble.parse(stored));
    const at = `${this.prefix}${key}`;
    if ((await this.kv.get(at)) !== null) return false;
    await this.kv.put(at, value, {
      expirationTtl: MODEL_ANSWER_TTL,
      ...(provenance === undefined ? {} : { metadata: provenance }),
    });
    return true;
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
