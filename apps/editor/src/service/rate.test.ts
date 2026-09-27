import { describe, expect, test } from "vitest";
import {
  addressKey,
  type Buckets,
  MemoryRateStore,
  type RateStore,
  refill,
  spend,
  take,
} from "./rate";

// The addresses here are from the ranges set aside for documentation (RFC 5737 and RFC 3849).

const LIMITS = { perMinute: 10, perDay: 100, charsPerDay: 2_000_000 };
const T0 = 1_800_000_000_000;

describe("an address's key", () => {
  test("is an IPv4 address as it is, and an IPv6 address by its /48, written out in full", () => {
    expect(addressKey("192.0.2.10")).toBe("192.0.2.10");
    expect(addressKey("::ffff:192.0.2.10")).toBe("192.0.2.10");
    expect(addressKey("2001:db8:5:6::a")).toBe("2001:0db8:0005::/48");
    expect(addressKey("2001:DB8:5:ffff:ffff:1:2:3")).toBe("2001:0db8:0005::/48");
    expect(addressKey("fe80::1%en0")).toBe("fe80:0000:0000::/48");
    expect(addressKey("::1")).toBe("0000:0000:0000::/48");
    expect(addressKey("1:2:3:4:5:6:7:8")).toBe("0001:0002:0003::/48");
  });

  test("is one key for no address, and anything else as it is, cut short", () => {
    expect(addressKey(undefined)).toBe("unknown");
    expect(addressKey("  ")).toBe("unknown");
    expect(addressKey("1::2::3")).toBe("1::2::3");
    expect(addressKey("x".repeat(80))).toBe("x".repeat(64));
  });

  test("gives every /64 of one /48 the same buckets, as a subscriber given a /48 holds them all", async () => {
    // The review's shape: 2,000 /64s of one /48, each asking once at the same moment.
    const store = new MemoryRateStore();
    let allowed = 0;
    for (let subnet = 1; subnet <= 2000; subnet++)
      if (
        (await take(store, addressKey(`2001:db8:aa:${subnet.toString(16)}::1`), T0, LIMITS)).allowed
      )
        allowed++;
    expect(allowed).toBe(LIMITS.perMinute);
    // Another /48 has buckets of its own.
    expect((await take(store, addressKey("2001:db8:ab::1"), T0, LIMITS)).allowed).toBe(true);
  });
});

describe("the buckets", () => {
  test("let a burst of perMinute through, then one each 60/perMinute seconds", async () => {
    const store = new MemoryRateStore();
    for (let i = 0; i < 10; i++)
      expect(await take(store, "a", T0, LIMITS), `request ${i}`).toEqual({ allowed: true });
    expect(await take(store, "a", T0, LIMITS)).toEqual({ allowed: false, retryAfter: 6 });
    expect(await take(store, "a", T0 + 5_999, LIMITS)).toEqual({ allowed: false, retryAfter: 1 });
    // After exactly the wait it gave, a request goes through, and the next waits again.
    expect(await take(store, "a", T0 + 6_000, LIMITS)).toEqual({ allowed: true });
    expect(await take(store, "a", T0 + 6_000, LIMITS)).toEqual({ allowed: false, retryAfter: 6 });
    // Another address is untouched.
    expect(await take(store, "b", T0, LIMITS)).toEqual({ allowed: true });
  });

  test("let perDay through in a day, and then say how long until the day's bucket holds one", async () => {
    const store = new MemoryRateStore();
    const limits = { ...LIMITS, perMinute: 100, perDay: 5 };
    for (let i = 0; i < 5; i++) expect((await take(store, "a", T0, limits)).allowed).toBe(true);
    expect(await take(store, "a", T0, limits)).toEqual({ allowed: false, retryAfter: 86_400 / 5 });
    expect((await take(store, "a", T0 + (86_400 / 5) * 1000, limits)).allowed).toBe(true);
  });

  test("fill no faster than their rate, never past full, and not at all for a clock gone back", () => {
    const held: Buckets = { at: T0, minute: 0, day: 50, chars: -100_000 };
    expect(refill(undefined, T0, LIMITS)).toEqual({
      at: T0,
      minute: 10,
      day: 100,
      chars: 2_000_000,
    });
    expect(refill(held, T0 + 3_000, LIMITS)).toEqual({
      at: T0 + 3_000,
      minute: 0.5,
      day: 50 + 3 * (100 / 86_400),
      chars: -100_000 + 3 * (2_000_000 / 86_400),
    });
    expect(refill(held, T0 + 3_600_000, LIMITS)).toMatchObject({ minute: 10 });
    // A day pays a day's characters: what was owed is owed less, and never more than full.
    expect(refill(held, T0 + 86_400_000, LIMITS)).toMatchObject({ chars: 1_900_000 });
    expect(refill(held, T0 + 2 * 86_400_000, LIMITS)).toMatchObject({ chars: 2_000_000 });
    expect(refill(held, T0 - 60_000, LIMITS)).toEqual(held);
  });

  test("take the characters a request's calls sent from its day, and refuse its next while they are spent", async () => {
    const store = new MemoryRateStore();
    const limits = { ...LIMITS, charsPerDay: 1_000_000 };
    expect(await take(store, "a", T0, limits)).toEqual({ allowed: true });
    // One request's calls may send more than the day holds: the bucket goes below nothing.
    expect(await spend(store, "a", 1_200_000, T0 + 1000, limits)).toBeUndefined();
    // 200,000 characters owed, less a second's worth, and one to hold, at a million a day.
    expect(await take(store, "a", T0 + 2000, limits)).toEqual({
      allowed: false,
      retryAfter: Math.ceil(((200_001 - 1_000_000 / 86_400) * 86_400) / 1_000_000),
    });
    expect((await take(store, "a", T0 + 2000 + 17_280_000, limits)).allowed).toBe(true);
    // Nothing sent takes nothing, and touches no store.
    const untouched: RateStore = {
      get: () => {
        throw new Error("read");
      },
      put: () => {
        throw new Error("written");
      },
    };
    expect(await spend(untouched, "a", 0, T0, limits)).toBeUndefined();
  });

  test("tell the store how long until they are full", async () => {
    const kept: number[] = [];
    const store: RateStore = {
      get: () => undefined,
      put: (_, __, seconds) => {
        kept.push(seconds);
      },
    };
    await take(store, "a", T0, LIMITS);
    // One token of a hundred a day is 864 seconds to fill; one of ten a minute, 6.
    expect(kept).toEqual([864]);
  });

  test("let a request through uncounted when the store cannot read or keep them, and name what it threw", async () => {
    // The review's shape: a namespace whose day's writes are spent, then one whose reads are.
    const unwritable: RateStore = {
      get: () => undefined,
      put: () => {
        throw new Error("KV put() limit exceeded for the day.");
      },
    };
    for (let hour = 0; hour < 3; hour++)
      expect(await take(unwritable, `192.0.2.${10 + hour}`, T0 + hour * 3_600_000, LIMITS)).toEqual(
        { allowed: true, failed: "Error" },
      );
    const unreadable: RateStore = {
      get: async () => {
        throw new TypeError("KV GET failed: 429 Too Many Requests");
      },
      put: () => undefined,
    };
    expect(await take(unreadable, "a", T0, LIMITS)).toEqual({ allowed: true, failed: "TypeError" });
    expect(await spend(unwritable, "a", 10, T0, LIMITS)).toBe("Error");
  });
});
