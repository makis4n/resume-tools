/**
 * The naming service's rate limit (milestone 3 item 10, decision 0028): two token buckets for each
 * client address, one that holds `perMinute` requests and fills again over a minute, the other
 * `perDay` over a day, so that by default an address makes ten requests at once, then one every six
 * seconds, and a hundred in a day. A request takes a token from both, or is refused with how many
 * seconds until both hold one. An IPv6 address draws on the buckets of its /64, which one
 * subscriber is given whole, and an IPv4 address written as IPv6 on its IPv4 address's.
 *
 * The buckets are kept in a `RateStore`, by address: memory in the dev server and the tests, KV on
 * Pages (`kv.ts`), where two requests at once can read the same buckets, so that the limit there
 * holds roughly; decision 0028 says what milestone 5 puts in its place. This file holds no Node and
 * no Workers code: it runs in both.
 */

/** How many requests an address may make: at once, filling again over a minute, and in a day. */
export interface RateLimits {
  perMinute: number;
  perDay: number;
}

/** An address's two buckets: the tokens each held after its last request, and when that was. */
export interface Buckets {
  /** Milliseconds since the epoch. */
  at: number;
  minute: number;
  day: number;
}

/**
 * Where buckets are kept, by an address's key (`addressKey`). `put` is told how many seconds until
 * the buckets would be full again, after which a store may forget them, and throws when it cannot
 * keep them, as KV does for a second write to a key within a second.
 */
export interface RateStore {
  get(address: string): Buckets | undefined | Promise<Buckets | undefined>;
  put(address: string, buckets: Buckets, seconds: number): void | Promise<void>;
}

/** Whether a request may go on, or in how many whole seconds it may. */
export type RateDecision = { allowed: true } | { allowed: false; retryAfter: number };

const MINUTE = 60;
const DAY = 86_400;

/** A token, less the rounding that adding up fractions of one leaves. */
const WHOLE = 1 - 1e-9;

const clamp = (tokens: number, most: number) => Math.min(most, Math.max(0, tokens));

/**
 * An address's buckets now: those held, each filled for the time since at its own rate and never
 * past full, or both full when none are held. A clock that went back fills nothing.
 */
export function refill(held: Buckets | undefined, now: number, limits: RateLimits): Buckets {
  if (held === undefined) return { at: now, minute: limits.perMinute, day: limits.perDay };
  const seconds = Math.max(0, now - held.at) / 1000;
  return {
    at: Math.max(now, held.at),
    minute: clamp(held.minute + (seconds * limits.perMinute) / MINUTE, limits.perMinute),
    day: clamp(held.day + (seconds * limits.perDay) / DAY, limits.perDay),
  };
}

/** Seconds until a bucket holding `tokens` holds a whole one. */
const waitFor = (tokens: number, capacity: number, period: number) =>
  tokens >= WHOLE ? 0 : ((1 - tokens) * period) / capacity;

/** Seconds until both buckets are full, when a store may forget them. */
function untilFull(buckets: Buckets, limits: RateLimits): number {
  return Math.ceil(
    Math.max(
      ((limits.perMinute - buckets.minute) * MINUTE) / limits.perMinute,
      ((limits.perDay - buckets.day) * DAY) / limits.perDay,
    ),
  );
}

/**
 * A request from the address whose key is `address`: allowed, with a token taken from each of its
 * buckets, or refused, with the whole seconds until both hold one. A store that cannot keep the
 * spent buckets refuses the request for a second, rather than let it through uncounted.
 */
export async function take(
  store: RateStore,
  address: string,
  now: number,
  limits: RateLimits,
): Promise<RateDecision> {
  const buckets = refill(await store.get(address), now, limits);
  if (buckets.minute < WHOLE || buckets.day < WHOLE) {
    const wait = Math.max(
      waitFor(buckets.minute, limits.perMinute, MINUTE),
      waitFor(buckets.day, limits.perDay, DAY),
    );
    return { allowed: false, retryAfter: Math.max(1, Math.ceil(wait)) };
  }
  const spent: Buckets = {
    at: buckets.at,
    minute: Math.max(0, buckets.minute - 1),
    day: Math.max(0, buckets.day - 1),
  };
  try {
    await store.put(address, spent, untilFull(spent, limits));
  } catch {
    return { allowed: false, retryAfter: 1 };
  }
  return { allowed: true };
}

/** An IPv6 address's eight groups, each four hex digits, or undefined for text that is not one. */
function ipv6Groups(text: string): string[] | undefined {
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const groupsOf = (half: string) => (half === "" ? [] : half.split(":"));
  const head = groupsOf(halves[0] ?? "");
  const tail = halves.length === 2 ? groupsOf(halves[1] ?? "") : [];
  const elided = 8 - head.length - tail.length;
  if (halves.length === 1 ? elided !== 0 : elided < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? elided : 0).fill("0"), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return groups.map((group) => group.padStart(4, "0"));
}

/**
 * The key an address's buckets are kept by: an IPv4 address as it is, and one written as IPv6 as
 * its IPv4 address; an IPv6 address by its /64, written out in full, since one subscriber is given
 * a whole /64 and could otherwise take a fresh bucket for every request; anything else as it is,
 * cut to 64 characters; and one key, `unknown`, for every request whose host gave no address.
 */
export function addressKey(address: string | undefined): string {
  const text = (address ?? "").trim().toLowerCase();
  if (text === "") return "unknown";
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4?.[1] !== undefined) return v4[1];
  const groups = ipv6Groups(text.split("%")[0] ?? "");
  return groups === undefined ? text.slice(0, 64) : `${groups.slice(0, 4).join(":")}::/64`;
}

/** Buckets in memory, for the dev server and the tests: forgotten when the process ends. */
export class MemoryRateStore implements RateStore {
  private readonly held = new Map<string, Buckets>();

  get(address: string): Buckets | undefined {
    return this.held.get(address);
  }

  put(address: string, buckets: Buckets): void {
    this.held.set(address, buckets);
  }
}
