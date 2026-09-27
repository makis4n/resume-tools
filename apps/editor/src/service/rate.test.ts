import { describe, expect, test } from "vitest";
import { addressKey, type Buckets, MemoryRateStore, type RateStore, refill, take } from "./rate";

// The addresses here are from the ranges set aside for documentation (RFC 5737 and RFC 3849).

const LIMITS = { perMinute: 10, perDay: 100 };
const T0 = 1_800_000_000_000;

describe("an address's key", () => {
  test("is an IPv4 address as it is, and an IPv6 address by its /64, written out in full", () => {
    expect(addressKey("192.0.2.10")).toBe("192.0.2.10");
    expect(addressKey("::ffff:192.0.2.10")).toBe("192.0.2.10");
    expect(addressKey("2001:db8:5:6::a")).toBe("2001:0db8:0005:0006::/64");
    expect(addressKey("2001:DB8:5:6:ffff:1:2:3")).toBe("2001:0db8:0005:0006::/64");
    expect(addressKey("fe80::1%en0")).toBe("fe80:0000:0000:0000::/64");
    expect(addressKey("::1")).toBe("0000:0000:0000:0000::/64");
    expect(addressKey("1:2:3:4:5:6:7:8")).toBe("0001:0002:0003:0004::/64");
  });

  test("is one key for no address, and anything else as it is, cut short", () => {
    expect(addressKey(undefined)).toBe("unknown");
    expect(addressKey("  ")).toBe("unknown");
    expect(addressKey("1::2::3")).toBe("1::2::3");
    expect(addressKey("x".repeat(80))).toBe("x".repeat(64));
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
    const limits = { perMinute: 100, perDay: 5 };
    for (let i = 0; i < 5; i++) expect((await take(store, "a", T0, limits)).allowed).toBe(true);
    expect(await take(store, "a", T0, limits)).toEqual({ allowed: false, retryAfter: 86_400 / 5 });
    expect((await take(store, "a", T0 + (86_400 / 5) * 1000, limits)).allowed).toBe(true);
  });

  test("fill no faster than their rate, never past full, and not at all for a clock gone back", () => {
    const held: Buckets = { at: T0, minute: 0, day: 50 };
    expect(refill(undefined, T0, LIMITS)).toEqual({ at: T0, minute: 10, day: 100 });
    expect(refill(held, T0 + 3_000, LIMITS)).toEqual({
      at: T0 + 3_000,
      minute: 0.5,
      day: 50 + 3 * (100 / 86_400),
    });
    expect(refill(held, T0 + 3_600_000, LIMITS)).toMatchObject({ minute: 10 });
    expect(refill(held, T0 - 60_000, LIMITS)).toEqual(held);
  });

  test("tell the store how long until they are full, and refuse for a second a request whose buckets it cannot keep", async () => {
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
    const full: RateStore = {
      get: () => undefined,
      put: () => {
        throw new Error("KV PUT failed: 429 Too Many Requests");
      },
    };
    expect(await take(full, "a", T0, LIMITS)).toEqual({ allowed: false, retryAfter: 1 });
  });
});
