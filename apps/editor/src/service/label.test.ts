import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type Features, ROLES } from "../pdf/roles";
import { type KeyValue, KvRateStore } from "./kv";
import { handleLabel, LABEL_LIMITS, LABEL_ROUTE, LABEL_SAYS, type LabelDeps } from "./label";
import { LabelReply, MAX_LINES } from "./label-contract";
import { schemaOf } from "./label-model";
import { type Buckets, MemoryRateStore, type RateStore } from "./rate";

// Every line here is invented, and no test calls a provider: the model is the AI SDK's mock, which
// answers what each test gives it.

type Result = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

/** A reply the mock gives: a text. */
function reply(text: string): Result {
  return {
    content: text === "" ? [] : [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 400, noCache: 400, cacheRead: 0, cacheWrite: undefined },
      outputTokens: { total: 40, text: 40, reasoning: 0 },
    },
    warnings: [],
  };
}

/** A line of an invented resume, as the page sends it. */
function line(id: number, text: string, more: Partial<Features> = {}): Features {
  return {
    id,
    text,
    page: 1,
    column: 0,
    columns: 1,
    indent: 0,
    width: 200,
    size: 1,
    bold: false,
    italic: false,
    caps: false,
    bullet: false,
    rowIndex: 0,
    rowSize: 1,
    rule: false,
    links: 0,
    rows: 1,
    ...more,
  };
}

/** The invented texts, each of which must never reach a log, a store or a refusal. */
const TEXTS = [
  "Corvina Ashgrove",
  "corvina.ashgrove@example.invalid",
  "EXPERIENCE",
  "Lamplighter, Quillon Lantern Works",
  "Trimmed four hundred wicks a night along Ferrow Quay.",
];

const LINES: Features[] = [
  line(0, TEXTS[0] ?? "", { size: 2, bold: true }),
  line(1, TEXTS[1] ?? "", { links: 1 }),
  line(2, TEXTS[2] ?? "", { caps: true, bold: true, rule: true, gapAbove: 1.5 }),
  line(3, TEXTS[3] ?? "", { bold: true }),
  line(4, TEXTS[4] ?? "", { bullet: true, indent: 12 }),
];

const ROLES_OF_LINES = ["name", "contact", "section heading", "entry head", "bullet"] as const;

/** The model's answer for the invented lines, as the schema asks it: by each line's id. */
const answer = (roles: readonly string[] = ROLES_OF_LINES, lines = LINES) =>
  JSON.stringify(Object.fromEntries(lines.map((each, at) => [`L${each.id}`, roles[at]])));

/** A mock that answers every call with `text`. */
const answering = (text: string | (() => string) = answer()) =>
  new MockLanguageModelV4({
    modelId: "invented-model",
    doGenerate: async () => reply(typeof text === "string" ? text : text()),
  });

/** A mock that must not be asked. */
const idle = () =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("the model was asked");
    },
  });

/** The handler's dependencies, with the lines it logged. */
function depsOf(overrides: Partial<LabelDeps> = {}) {
  const logged: string[] = [];
  const deps: LabelDeps = {
    model: answering(),
    address: "203.0.113.7",
    rates: new MemoryRateStore(),
    limits: LABEL_LIMITS,
    now: () => 1_000_000,
    log: (text) => {
      logged.push(text);
    },
    ...overrides,
  };
  return { deps, logged };
}

/** A POST of `body` to the route, as JSON unless told otherwise. */
const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${LABEL_ROUTE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });

const asked = (lines: unknown = LINES) => post(JSON.stringify({ lines }));

describe("the label route", () => {
  test("answers one role a line, in the lines' order, from the closed list", async () => {
    const { deps } = depsOf();
    const response = await handleLabel(asked(), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = LabelReply.parse(await response.json());
    expect(body.roles).toEqual(ROLES_OF_LINES);
  });

  test("asks the model once, at temperature 0, with the roles as an enum on every line's key", async () => {
    const model = answering();
    const { deps } = depsOf({ model });
    expect((await handleLabel(asked(), deps)).status).toBe(200);
    expect(model.doGenerateCalls).toHaveLength(1);
    const call = model.doGenerateCalls[0];
    expect(call?.temperature).toBe(0);
    expect(call?.responseFormat).toMatchObject({ type: "json", schema: schemaOf(LINES) });
    const schema = schemaOf(LINES);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["L0", "L1", "L2", "L3", "L4"]);
    for (const property of Object.values(schema.properties))
      expect(property.enum).toEqual([...ROLES]);
  });

  test("checks the model's reply, and refuses one of another form with 422", async () => {
    const wrong = [
      // A role the list has not.
      answer(["name", "contact", "heading", "entry head", "bullet"]),
      // A line left out.
      JSON.stringify({ L0: "name", L1: "contact", L2: "section heading", L3: "entry head" }),
      // A key no line has.
      JSON.stringify({ ...JSON.parse(answer()), L9: "date" }),
      // A list in place of the object.
      JSON.stringify([...ROLES_OF_LINES]),
      // No JSON at all.
      "name, contact, section heading",
      "",
    ];
    for (const text of wrong) {
      const { deps } = depsOf({ model: answering(text) });
      const response = await handleLabel(asked(), deps);
      expect(response.status, text).toBe(422);
      expect(await response.json()).toEqual({ error: LABEL_SAYS.invalid });
    }
  });

  test("says when the model failed or ran past its time, without saying what it was sent", async () => {
    const failing = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: `Invented failure quoting ${TEXTS[0]}`,
          url: "https://invalid.example/v1",
          requestBodyValues: { text: TEXTS[4] },
          statusCode: 503,
        });
      },
    });
    const failed = await handleLabel(asked(), depsOf({ model: failing }).deps);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: LABEL_SAYS.provider });

    const slow = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise<Result>((_, reject) => {
          abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
        }),
    });
    const late = await handleLabel(
      asked(),
      depsOf({ model: slow, limits: { ...LABEL_LIMITS, modelMs: 20 } }).deps,
    );
    expect(late.status).toBe(504);
    expect(await late.json()).toEqual({ error: LABEL_SAYS.timeout });
  });

  test("refuses with 503, and asks nothing, when it has no model", async () => {
    const response = await handleLabel(asked(), depsOf({ model: undefined }).deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: LABEL_SAYS.none });
  });

  test("takes a POST of JSON alone, under its cap, of the contract's form", async () => {
    const model = idle();
    const { deps } = depsOf({ model });
    const get = new Request(`http://localhost${LABEL_ROUTE}`);
    const refusedGet = await handleLabel(get, deps);
    expect(refusedGet.status).toBe(405);
    expect(refusedGet.headers.get("allow")).toBe("POST");
    expect((await handleLabel(post("{}", { "Content-Type": "text/plain" }), deps)).status).toBe(
      415,
    );
    const large = "x".repeat(LABEL_LIMITS.bytes + 1);
    expect((await handleLabel(post(large), deps)).status).toBe(413);
    expect((await handleLabel(post(new Uint8Array([0xff, 0xfe, 0x00])), deps)).status).toBe(400);
    expect((await handleLabel(post("{ not json"), deps)).status).toBe(400);
    const wrongForms: unknown[] = [
      {},
      { lines: [] },
      { lines: LINES, document: TEXTS[0] },
      { lines: [{ ...LINES[0], [TEXTS[3] ?? ""]: true }] },
      { lines: [{ ...LINES[0], size: "large" }] },
      { lines: [LINES[0], LINES[0]] },
      { lines: Array.from({ length: MAX_LINES + 1 }, (_, id) => line(id, "x")) },
    ];
    for (const value of wrongForms) {
      const response = await handleLabel(post(JSON.stringify(value)), deps);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string; problems: string[] };
      expect(body.error).toBe(LABEL_SAYS.schema);
      for (const text of TEXTS) expect(JSON.stringify(body)).not.toContain(text);
    }
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe("the label route's rate limit", () => {
  test("refuses an address past its requests a minute with 429 and Retry-After, and asks nothing more", async () => {
    const model = answering();
    const { deps } = depsOf({ model, limits: { ...LABEL_LIMITS, perMinute: 2 } });
    expect((await handleLabel(asked(), deps)).status).toBe(200);
    expect((await handleLabel(asked(), deps)).status).toBe(200);
    const refused = await handleLabel(asked(), deps);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await refused.json()).toEqual({ error: LABEL_SAYS.rate });
    expect(model.doGenerateCalls).toHaveLength(2);
    // Another address has buckets of its own.
    expect((await handleLabel(asked(), { ...deps, address: "198.51.100.4" })).status).toBe(200);
  });

  test("takes what each call sends from the address's day, and refuses once it is spent", async () => {
    const model = answering();
    const { deps } = depsOf({ model, limits: { ...LABEL_LIMITS, charsPerDay: 1_000 } });
    expect((await handleLabel(asked(), deps)).status).toBe(200);
    expect((await handleLabel(asked(), deps)).status).toBe(429);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  test("on KV, which takes one write a key a second, charges the characters and refuses once they are spent", async () => {
    // KV's own rule, as kv.test.ts's FakeKv holds it: a second write to a key within a second fails.
    const written = new Map<string, number>();
    const values = new Map<string, string>();
    let now = 1_800_000_000_000;
    let refusedWrites = 0;
    const kv: KeyValue = {
      get: async (key) => values.get(key) ?? null,
      put: async (key, value) => {
        const last = written.get(key);
        if (last !== undefined && now - last < 1000) {
          refusedWrites++;
          throw new Error("KV PUT failed: 429 Too Many Requests");
        }
        written.set(key, now);
        values.set(key, value);
      },
    };
    const model = answering();
    const { deps } = depsOf({
      model,
      rates: new KvRateStore(kv, "label-rate:"),
      limits: { ...LABEL_LIMITS, charsPerDay: 3_000 },
      now: () => now,
    });
    const statuses: number[] = [];
    for (let at = 0; at < 5; at++) {
      statuses.push((await handleLabel(asked(), deps)).status);
      // One request every ten seconds, well inside the minute's ten.
      now += 10_000;
    }
    expect(statuses.slice(0, 1)).toEqual([200]);
    expect(statuses).toContain(429);
    expect(statuses.filter((status) => status === 200).length).toBeLessThan(5);
    expect(model.doGenerateCalls.length).toBe(statuses.filter((status) => status === 200).length);
    // KV never refused a write: one write a request.
    expect(refusedWrites).toBe(0);
    const buckets = JSON.parse(values.get("label-rate:203.0.113.7") ?? "{}") as Buckets;
    expect(buckets.chars).toBeLessThan(1);
  });

  test("fails closed: a request its store cannot count is refused with 429, and the model is not asked", async () => {
    const unreadable: RateStore = {
      get: () => {
        throw new TypeError(`store failure quoting ${TEXTS[1]}`);
      },
      put: () => undefined,
    };
    const unwritable: RateStore = {
      get: () => undefined,
      put: () => {
        throw new RangeError(`put failure quoting ${TEXTS[2]}`);
      },
    };
    for (const rates of [unreadable, unwritable]) {
      const model = answering();
      const { deps, logged } = depsOf({ model, rates });
      const response = await handleLabel(asked(), deps);
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("1");
      expect(await response.json()).toEqual({ error: LABEL_SAYS.uncounted });
      expect(model.doGenerateCalls).toHaveLength(0);
      for (const text of TEXTS) expect(logged.join("\n")).not.toContain(text);
    }
  });

  test("on KV, a burst within a second gets what the limits allow, the rest 429 and no model call", async () => {
    // KV's rule, as kv.test.ts's FakeKv holds it: a second write to a key within a second fails.
    const written = new Map<string, number>();
    const values = new Map<string, string>();
    let now = 1_800_000_000_000;
    const kv: KeyValue = {
      get: async (key) => values.get(key) ?? null,
      put: async (key, value) => {
        const last = written.get(key);
        if (last !== undefined && now - last < 1000)
          throw new Error("KV PUT failed: 429 Too Many Requests");
        written.set(key, now);
        values.set(key, value);
      },
    };
    const model = answering();
    const { deps } = depsOf({ model, rates: new KvRateStore(kv, "label-rate:"), now: () => now });
    const statuses: number[] = [];
    // Three seconds, each a junk request that writes the key, then twenty valid ones within it.
    for (let second = 0; second < 3; second++) {
      statuses.push((await handleLabel(post("{junk"), deps)).status);
      for (let at = 0; at < 20; at++) {
        now += 10;
        statuses.push((await handleLabel(asked(), deps)).status);
      }
      now += 1_000;
    }
    const served = statuses.filter((status) => status === 200).length;
    // At most one counted write a second, and never past the minute's ten.
    expect(served).toBeLessThanOrEqual(3);
    expect(served).toBeLessThanOrEqual(LABEL_LIMITS.perMinute);
    expect(statuses.filter((status) => status === 429).length).toBe(60 - served);
    expect(model.doGenerateCalls).toHaveLength(served);
  });
});

describe("the label route keeps no text", () => {
  const consoleLines: string[] = [];
  let caches: { open: ReturnType<typeof vi.fn>; match: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    consoleLines.length = 0;
    for (const method of ["log", "info", "warn", "error", "debug", "trace"] as const)
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleLines.push(args.map(String).join(" "));
      });
    // A Workers-style cache, which the route must never open or write.
    caches = { open: vi.fn(), match: vi.fn() };
    vi.stubGlobal("caches", caches);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("logs none of the lines' text, nor the model's, on any path, and writes no cache", async () => {
    const stored: { address: string; buckets: Buckets }[] = [];
    const rates: RateStore = {
      held: new Map<string, Buckets>(),
      get(address: string) {
        return (this as unknown as { held: Map<string, Buckets> }).held.get(address);
      },
      put(address: string, buckets: Buckets) {
        stored.push({ address, buckets });
        (this as unknown as { held: Map<string, Buckets> }).held.set(address, buckets);
      },
    } as RateStore;
    const logged: string[] = [];
    const log = (text: string) => {
      logged.push(text);
    };
    const models = [
      answering(),
      answering(`{"L0": "${TEXTS[0]}"}`),
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw new APICallError({
            message: `Invented failure quoting ${TEXTS[3]}`,
            url: "https://invalid.example/v1",
            requestBodyValues: { text: TEXTS[4] },
            statusCode: 500,
          });
        },
      }),
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw new Error(`An unexpected failure quoting ${TEXTS[2]}`);
        },
      }),
    ];
    const bodies: string[] = [];
    for (const model of models) {
      const response = await handleLabel(asked(), {
        model,
        address: "203.0.113.7",
        rates,
        limits: LABEL_LIMITS,
        now: () => 1_000_000,
        log,
      });
      if (response.status !== 200) bodies.push(await response.text());
    }
    // A failure that is not the request's doing, by the store, quoting the text.
    const throwing: RateStore = {
      get: () => undefined,
      put: () => {
        throw new RangeError(`put failure quoting ${TEXTS[4]}`);
      },
    };
    const failedModel = answering();
    const failed = await handleLabel(asked(), {
      model: failedModel,
      address: "203.0.113.7",
      rates: throwing,
      limits: LABEL_LIMITS,
      now: () => 1_000_000,
      log,
    });
    expect(failed.status).toBe(429);
    expect(failedModel.doGenerateCalls).toHaveLength(0);
    expect(logged.length).toBeGreaterThan(0);
    const everything = [...logged, ...consoleLines, ...bodies].join("\n");
    for (const text of TEXTS) expect(everything).not.toContain(text);
    // The store holds counts and times by address, and nothing else.
    expect(stored.length).toBeGreaterThan(0);
    for (const { address, buckets } of stored) {
      expect(address).toBe("203.0.113.7");
      expect(Object.keys(buckets).sort()).toEqual(["at", "chars", "day", "minute"]);
      for (const value of Object.values(buckets)) expect(typeof value).toBe("number");
    }
    expect(caches.open).not.toHaveBeenCalled();
    expect(caches.match).not.toHaveBeenCalled();
  });
});
