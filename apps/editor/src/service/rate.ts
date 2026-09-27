/**
 * The naming service's rate limit (milestone 3 item 10, decision 0028): three buckets for each
 * client address. Two count requests, one that holds `perMinute` and fills again over a minute, the
 * other `perDay` over a day, so that by default an address makes ten requests at once, then one
 * every six seconds, and a hundred in a day. The third counts the characters of the prompts the
 * model is sent for the address, `charsPerDay` over a day, two million by default: a request takes
 * a token from each request bucket before its body is read, and is refused while the characters are
 * spent; what its model calls send is taken from the third as each part is answered (`spend`), and
 * may take it below nothing, which the address then waits out. An IPv6 address draws on the
 * buckets of its /48, which one subscriber may be given whole, and an IPv4 address written as IPv6
 * on its IPv4 address's.
 *
 * The buckets are kept in a `RateStore`, by address: memory in the dev server and the tests, KV on
 * Pages (`kv.ts`), where two requests at once can read the same buckets, so that the limit there
 * holds roughly; decision 0028 says what milestone 5 puts in its place. A store that fails, to read
 * or to write, lets the request through uncounted, and says so, rather than refuse every address
 * for what is no address's doing. This file holds no Node and no Workers code: it runs in both.
 */

/**
 * How much an address may ask: requests at once, filling again over a minute, and in a day; and
 * the characters of the prompts the model may be sent for it in a day.
 */
export interface RateLimits {
  perMinute: number;
  perDay: number;
  charsPerDay: number;
}

/**
 * An address's buckets: the requests and the characters each held after it was last drawn on, and
 * when that was. The characters may be below nothing, when a request's calls sent more than they
 * held.
 */
export interface Buckets {
  /** Milliseconds since the epoch. */
  at: number;
  minute: number;
  day: number;
  chars: number;
}

/**
 * Where buckets are kept, by an address's key (`addressKey`). `put` is told how many seconds until
 * the buckets would be full again, after which a store may forget them, and throws when it cannot
 * keep them, as KV does for a second write to a key within a second, or once its day's writes are
 * spent.
 */
export interface RateStore {
  get(address: string): Buckets | undefined | Promise<Buckets | undefined>;
  put(address: string, buckets: Buckets, seconds: number): void | Promise<void>;
}

/**
 * Whether a request may go on, or in how many whole seconds it may; and, when the store failed and
 * the request goes on uncounted, the class of what it threw, never its message.
 */
export type RateDecision =
  | { allowed: true; failed?: string }
  | { allowed: false; retryAfter: number };

const MINUTE = 60;
const DAY = 86_400;

/** A token, less the rounding that adding up fractions of one leaves. */
const WHOLE = 1 - 1e-9;

const clamp = (tokens: number, most: number) => Math.min(most, Math.max(0, tokens));

/** An error's class, by its name where that is plainly one: never what it says. */
export const classOf = (error: unknown) =>
  error instanceof Error && /^[A-Za-z]{1,64}$/.test(error.name) ? error.name : "an error";

/**
 * An address's buckets now: those held, each filled for the time since at its own rate and never
 * past full, or all full when none are held. The characters' bucket, which may be below nothing, is
 * filled from where it is. A clock that went back fills nothing.
 */
export function refill(held: Buckets | undefined, now: number, limits: RateLimits): Buckets {
  if (held === undefined)
    return { at: now, minute: limits.perMinute, day: limits.perDay, chars: limits.charsPerDay };
  const seconds = Math.max(0, now - held.at) / 1000;
  return {
    at: Math.max(now, held.at),
    minute: clamp(held.minute + (seconds * limits.perMinute) / MINUTE, limits.perMinute),
    day: clamp(held.day + (seconds * limits.perDay) / DAY, limits.perDay),
    chars: Math.min(limits.charsPerDay, held.chars + (seconds * limits.charsPerDay) / DAY),
  };
}

/** Seconds until a bucket holding `tokens` holds a whole one. */
const waitFor = (tokens: number, capacity: number, period: number) =>
  tokens >= WHOLE ? 0 : ((1 - tokens) * period) / capacity;

/** Seconds until every bucket is full, when a store may forget them. */
function untilFull(buckets: Buckets, limits: RateLimits): number {
  return Math.ceil(
    Math.max(
      ((limits.perMinute - buckets.minute) * MINUTE) / limits.perMinute,
      ((limits.perDay - buckets.day) * DAY) / limits.perDay,
      ((limits.charsPerDay - buckets.chars) * DAY) / limits.charsPerDay,
    ),
  );
}

/**
 * A request from the address whose key is `address`: allowed, with a token taken from each of its
 * request buckets, or refused, with the whole seconds until both hold one and its characters are no
 * longer spent. A store that cannot read or keep the buckets lets the request through uncounted,
 * and the decision names what it threw.
 */
export async function take(
  store: RateStore,
  address: string,
  now: number,
  limits: RateLimits,
): Promise<RateDecision> {
  let held: Buckets | undefined;
  try {
    held = await store.get(address);
  } catch (error) {
    return { allowed: true, failed: classOf(error) };
  }
  const buckets = refill(held, now, limits);
  if (buckets.minute < WHOLE || buckets.day < WHOLE || buckets.chars < WHOLE) {
    const wait = Math.max(
      waitFor(buckets.minute, limits.perMinute, MINUTE),
      waitFor(buckets.day, limits.perDay, DAY),
      waitFor(buckets.chars, limits.charsPerDay, DAY),
    );
    return { allowed: false, retryAfter: Math.max(1, Math.ceil(wait)) };
  }
  const spent: Buckets = {
    ...buckets,
    minute: Math.max(0, buckets.minute - 1),
    day: Math.max(0, buckets.day - 1),
  };
  try {
    await store.put(address, spent, untilFull(spent, limits));
  } catch (error) {
    return { allowed: true, failed: classOf(error) };
  }
  return { allowed: true };
}

/**
 * The characters a request's model calls sent, taken from its address's day: its buckets read,
 * filled, the characters taken, below nothing if they must, and kept. What a failing store threw is
 * given back by its class, and the characters go uncounted.
 */
export async function spend(
  store: RateStore,
  address: string,
  chars: number,
  now: number,
  limits: RateLimits,
): Promise<string | undefined> {
  if (chars <= 0) return undefined;
  try {
    const buckets = refill(await store.get(address), now, limits);
    const spent: Buckets = { ...buckets, chars: buckets.chars - chars };
    await store.put(address, spent, untilFull(spent, limits));
    return undefined;
  } catch (error) {
    return classOf(error);
  }
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
 * its IPv4 address; an IPv6 address by its /48, written out in full, since one subscriber may be
 * given a /48, a /56 or a /60, each many /64s, and could otherwise take fresh buckets for every
 * /64 of it; anything else as it is, cut to 64 characters; and one key, `unknown`, for every
 * request whose host gave no address.
 */
export function addressKey(address: string | undefined): string {
  const text = (address ?? "").trim().toLowerCase();
  if (text === "") return "unknown";
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4?.[1] !== undefined) return v4[1];
  const groups = ipv6Groups(text.split("%")[0] ?? "");
  return groups === undefined ? text.slice(0, 64) : `${groups.slice(0, 3).join(":")}::/48`;
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
