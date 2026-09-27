import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import type { ModelNaming } from "./answer";
import { inventedAnswer, inventedNaming, inventedRequest } from "./invented";
import { keyOf, NAMING_VERSION, sha256 } from "./key";
import { BATCH_MACROS, batchesOf, NamingError, type NamingUsage, name, narrow } from "./model";
import { askedOf, commandsOf, definitionOrder, INSTRUCTIONS, layOut } from "./prompt";
import { NamingRequest } from "./request";

// Every template, macro, call and answer here is invented, and no test calls a provider: the model
// is the AI SDK's mock, which answers what each test gives it.

type Result = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
type Call = MockLanguageModelV4["doGenerateCalls"][number];

/** A reply the mock gives: a text, how it finished, and the tokens it counts. */
function reply(text: string, finish: "stop" | "length" | "content-filter" = "stop"): Result {
  return {
    content: text === "" ? [] : [{ type: "text", text }],
    finishReason: { unified: finish, raw: undefined },
    usage: {
      inputTokens: { total: 1000, noCache: 800, cacheRead: 200, cacheWrite: undefined },
      outputTokens: { total: 300, text: 250, reasoning: 50 },
    },
    warnings: [],
  };
}

/** A mocked call's messages, each its role and its text. */
function messagesOf(call: Call | undefined): { role: string; text: string }[] {
  return (call?.prompt ?? []).map((message) => ({
    role: message.role,
    text:
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => ("text" in part ? part.text : "")).join(""),
  }));
}

/** The macros a laid-out part asks, by their headings. */
function headings(text: string): { of: "command" | "environment"; name: string }[] {
  return [...text.matchAll(/^### (command|environment) "([^"]+)"$/gm)].map((found) => ({
    of: found[1] as "command" | "environment",
    name: found[2] ?? "",
  }));
}

/** The answer to a part's prompt: each macro it asks, and the preamble where it asks it. */
function answerTo(options: unknown, preamble: ModelNaming["preamble"]): string {
  const text = messagesOf(options as Call).find((message) => message.role === "user")?.text;
  const asked = headings(text ?? "");
  return JSON.stringify({
    macros: asked.map((macro) => ({ ...macro, answer: inventedAnswer(macro) })),
    preamble: text?.includes("## The preamble's settings") ? preamble : { parameters: [] },
  });
}

/** A mock that answers each part for exactly the macros its prompt asks, and the preamble once. */
function answering(preamble: ModelNaming["preamble"]) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => reply(answerTo(options, preamble)),
  });
}

describe("naming a request on a model", () => {
  test("asks once, with the instructions and the request laid out, and gives back the answer", async () => {
    const request = await inventedRequest();
    const naming = inventedNaming(request);
    const model = new MockLanguageModelV4({
      doGenerate: async () => reply(JSON.stringify(naming)),
    });
    const calls: NamingUsage[] = [];
    expect(await name(request, { model, onCall: (usage) => calls.push(usage) })).toEqual(naming);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(messagesOf(model.doGenerateCalls[0])).toEqual([
      { role: "system", text: INSTRUCTIONS },
      { role: "user", text: layOut(request) },
    ]);
    // The answer is asked as structured output, against the schema.
    expect(model.doGenerateCalls[0]?.responseFormat).toMatchObject({
      type: "json",
      name: "naming",
    });
    expect(calls).toEqual([{ input: 1000, cached: 200, output: 300 }]);
  });

  test("asks again with the problems quoted back when an answer leaves a macro out, and takes the fix", async () => {
    const request = await inventedRequest();
    const naming = inventedNaming(request);
    const missing = {
      ...naming,
      macros: naming.macros.filter((each) => each.name !== "cvsection"),
    };
    const model = new MockLanguageModelV4({
      doGenerate: [reply(JSON.stringify(missing)), reply(JSON.stringify(naming))],
    });
    expect(await name(request, { model })).toEqual(naming);
    expect(model.doGenerateCalls).toHaveLength(2);
    const second = messagesOf(model.doGenerateCalls[1]);
    expect(second.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(second[1]?.text).toBe(layOut(request));
    expect(second[2]?.text).toBe(JSON.stringify(missing));
    expect(second[3]?.text).toContain('- no answer for command "cvsection"');
  });

  test("throws invalid when the answer never validates, after one retry, and counts both calls", async () => {
    const request = await inventedRequest();
    const naming = inventedNaming(request);
    const wrong = {
      ...naming,
      macros: [
        ...naming.macros.map((each) =>
          each.name === "cventry"
            ? {
                ...each,
                answer: {
                  ...each.answer,
                  arguments: [{ index: 1, meaning: "title", slot: "phone" }],
                },
              }
            : each,
        ),
        { of: "command", name: "cvnowhere", answer: inventedAnswer({ of: "command", name: "x" }) },
      ],
    };
    const model = new MockLanguageModelV4({ doGenerate: async () => reply(JSON.stringify(wrong)) });
    const calls: NamingUsage[] = [];
    const error = await name(request, { model, onCall: (usage) => calls.push(usage) }).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(NamingError);
    expect(error).toMatchObject({ reason: "invalid" });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(calls).toHaveLength(2);
    // The schema's refinement is quoted back by the macro and the field.
    const retry = messagesOf(model.doGenerateCalls[1]).at(-1)?.text;
    expect(retry).toContain(
      '- the answer for command "cventry", at answer.arguments.0.slot: a entry has no slot phone',
    );
    // A second answer the schema takes is checked for the macros asked, and names what it adds.
    const extra = { ...naming, macros: [...naming.macros, wrong.macros.at(-1)] };
    const again = new MockLanguageModelV4({ doGenerate: async () => reply(JSON.stringify(extra)) });
    await expect(name(request, { model: again })).rejects.toThrow(
      'an answer for command "cvnowhere", which was not asked',
    );
  });

  test("takes an answer that is not JSON as a problem to quote back", async () => {
    const request = await inventedRequest();
    const model = new MockLanguageModelV4({
      doGenerate: [reply("Here are the names."), reply(JSON.stringify(inventedNaming(request)))],
    });
    expect(await name(request, { model })).toEqual(inventedNaming(request));
    expect(messagesOf(model.doGenerateCalls[1]).at(-1)?.text).toContain("- the answer is not JSON");
  });

  test("throws provider when the call fails, with the provider's status and never the request", async () => {
    const request = await inventedRequest();
    const failing = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: "The invented service is unavailable",
          url: "https://invalid.example/v1",
          requestBodyValues: { contents: layOut(request) },
          statusCode: 503,
        });
      },
    });
    const error = await name(request, { model: failing, maxRetries: 0 }).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(NamingError);
    expect(error).toMatchObject({
      reason: "provider",
      status: 503,
      message: "The model's provider answered HTTP 503: The invented service is unavailable",
    });
    const broken = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("socket hang up");
      },
    });
    await expect(name(request, { model: broken })).rejects.toMatchObject({
      reason: "provider",
      message: "The call to the model failed (Error)",
    });
    // A model's name would go to the AI SDK's own gateway: the step takes a model alone.
    await expect(name(request, { model: "invented-model" as never })).rejects.toMatchObject({
      reason: "provider",
    });
  });

  test("throws refused when the provider filters the answer, and budget when it is cut off", async () => {
    const request = await inventedRequest();
    const filtered = new MockLanguageModelV4({
      doGenerate: async () => reply("", "content-filter"),
    });
    await expect(name(request, { model: filtered })).rejects.toMatchObject({ reason: "refused" });
    const cut = new MockLanguageModelV4({
      doGenerate: async () => reply('{"macros": [', "length"),
    });
    await expect(name(request, { model: cut })).rejects.toMatchObject({ reason: "budget" });
    expect(cut.doGenerateCalls).toHaveLength(1);
  });
});

describe("a request over the budget", () => {
  test("is asked in parts that cover every macro once, the preamble in the first alone", async () => {
    const request = await inventedRequest({ extra: 12, size: 3000 });
    const budget = INSTRUCTIONS.length + 12_000;
    const parts = batchesOf(request, budget);
    expect(parts.length).toBeGreaterThan(2);
    const preamble = inventedNaming(request).preamble;
    const model = answering(preamble);
    const naming = await name(request, { model, budget });
    const asked = askedOf(request).map((macro) => `${macro.of} ${macro.name}`);
    // The answers are merged in the request's order, the preamble's from the first part.
    expect(naming.macros.map((each) => `${each.of} ${each.name}`)).toEqual(asked);
    expect(naming.preamble).toEqual(preamble);
    const prompts = model.doGenerateCalls.map(messagesOf);
    expect(prompts).toHaveLength(parts.length);
    const users = prompts.map(
      (messages) => messages.find((each) => each.role === "user")?.text ?? "",
    );
    // Each macro is asked in one part exactly.
    expect(
      users.flatMap((text) => headings(text).map((macro) => `${macro.of} ${macro.name}`)).sort(),
    ).toEqual([...asked].sort());
    const byName = new Map(request.macros.map((macro) => [macro.name, macro]));
    users.forEach((text, i) => {
      const messages = prompts[i] ?? [];
      // Each call's prompt is within the budget, the instructions counted.
      expect(messages.reduce((sum, each) => sum + each.text.length, 0)).toBeLessThanOrEqual(budget);
      // The first part alone holds the preamble's settings.
      expect(text.includes("[0] \\usepackage[margin=0.5in, top=1cm]{geometry}"), `part ${i}`).toBe(
        i === 0,
      );
      // Each part holds the definitions its macros hand their work to, once each.
      for (const macro of headings(text))
        for (const dependency of byName.get(macro.name)?.dependencies ?? [])
          expect(text.split(`Definition "${dependency}":`).length, dependency).toBe(2);
      // The definitions most macros share come first in every part, in the same order, so that a
      // provider's cache of a prompt's start serves each part; and every part names the same
      // commands, the whole request's.
      const shared = [...text.matchAll(/^Definition "([^"]+)":/gm)].map((found) => found[1]);
      if (headings(text).some((macro) => macro.name.startsWith("cvextra")))
        expect(shared.slice(0, 2)).toEqual(["cv@style", "cv@shared"]);
      expect(text).toContain(
        `names: ${commandsOf(request)
          .map((each) => `"${each}"`)
          .join(", ")}.`,
      );
    });
  });

  test("asks at most BATCH_MACROS macros a part, whatever their size", async () => {
    const request = await inventedRequest({ extra: 40, size: 10 });
    expect(batchesOf(request).map((part) => askedOf(part.request).length)).toEqual([
      BATCH_MACROS,
      askedOf(request).length - BATCH_MACROS,
    ]);
  });

  test("opens a part for the first macro too, where it fits alone but not beside the preamble", async () => {
    const request = await firstPartRequest();
    const [big, small] = request.macros;
    if (big === undefined || small === undefined) throw new Error("no macros");
    const alone =
      INSTRUCTIONS.length +
      layOut(narrow(request, [big], false), {
        preamble: false,
        order: definitionOrder(request),
        commands: commandsOf(request),
      }).length;
    // Either order: the preamble's part takes what fits beside it, and the large macro a part
    // of its own.
    for (const macros of [
      [big, small],
      [small, big],
    ]) {
      const parts = batchesOf({ ...request, macros }, alone + 100);
      expect(parts.map((part) => part.request.macros.map((macro) => macro.name))).toEqual([
        ["cvsmall"],
        ["cvbig"],
      ]);
      expect(parts.map((part) => part.preamble)).toEqual([true, false]);
    }
    // One over the budget on its own still throws.
    expect(() => batchesOf(request, alone - 1)).toThrow(/too small for command "cvbig"/);
  });

  test("throws budget, before any call, for a macro over the budget on its own", async () => {
    const request = await inventedRequest({ extra: 1, size: 50_000 });
    const model = new MockLanguageModelV4({ doGenerate: async () => reply("{}") });
    const error = await name(request, { model, budget: INSTRUCTIONS.length + 20_000 }).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toMatchObject({ reason: "budget", part: undefined });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  test("tells each part's answers once they validate, and names the part that fails", async () => {
    const request = await inventedRequest({ extra: 40, size: 10 });
    expect(batchesOf(request).map((part) => askedOf(part.request).length)).toEqual([32, 13]);
    const preamble = inventedNaming(request).preamble;
    // The second part's answers give an entry a slot it has not, every time.
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        const text = answerTo(options, preamble);
        return reply(
          text.includes('"parameters":[]')
            ? text.replaceAll('"slot":"title"', '"slot":"phone"')
            : text,
        );
      },
    });
    const told: string[][] = [];
    const error = await name(request, {
      model,
      onPart: (macros) => {
        told.push(macros.map((each) => each.name));
      },
    }).catch((thrown: unknown) => thrown);
    expect(told.map((each) => each.length)).toEqual([32]);
    expect(error).toBeInstanceOf(NamingError);
    expect(error).toMatchObject({ reason: "invalid", part: { index: 2, count: 2 } });
    expect((error as NamingError).part?.macros).toHaveLength(13);
    expect((error as NamingError).message).toMatch(
      /^Part 2 of 2: The model's answer did not validate after a retry: /,
    );
    expect(model.doGenerateCalls).toHaveLength(3);
  });

  test("gives each part a limit of its own, which stops a part that takes longer", async () => {
    const request = await inventedRequest({ extra: 40, size: 10 });
    const preamble = inventedNaming(request).preamble;
    /** A mock that answers each part after `ms`, unless its call is stopped first. */
    const slow = (ms: number) =>
      new MockLanguageModelV4({
        doGenerate: async (options) => {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            options.abortSignal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(options.abortSignal?.reason);
              },
              { once: true },
            );
          });
          return reply(answerTo(options, preamble));
        },
      });
    /** The fake clock moved on by `ms`, a little at a time, so that each part starts its own. */
    const advance = async (ms: number) => {
      for (let passed = 0; passed < ms; passed += 10) await vi.advanceTimersByTimeAsync(10);
    };
    vi.useFakeTimers();
    try {
      // Two parts of 700 ms each, 1,400 in all, each within its own limit of 1,000.
      const both = name(request, { model: slow(700), partTimeoutMs: 1000, maxRetries: 0 });
      await advance(1500);
      expect((await both).macros).toHaveLength(askedOf(request).length);
      // A part of 1,200 ms is stopped at its limit, and the error says which part.
      const long = name(request, { model: slow(1200), partTimeoutMs: 1000, maxRetries: 0 }).catch(
        (thrown: unknown) => thrown,
      );
      await advance(1300);
      expect(await long).toMatchObject({
        reason: "provider",
        message: "Part 1 of 2: The call to the model was stopped before it answered",
        part: { index: 1, count: 2 },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a model's words, in what the step says", () => {
  test("never echo a key or a message the step does not know, and keep a provider's line short", async () => {
    const request = await inventedRequest();
    const KEY = "INVENTED-KEY-0123456789abcdef";
    const throwing = (error: unknown) =>
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw error;
        },
      });
    // A key with a line break in it fails the runtime's check of a header, which quotes the value.
    const header = await name(request, {
      model: throwing(
        new TypeError(`Headers.append: "${KEY}\n# rotated" is an invalid header value.`),
      ),
      maxRetries: 0,
    }).catch((thrown: unknown) => thrown);
    expect(header).toMatchObject({
      reason: "provider",
      message: "The call to the model failed: the key is not a single line",
    });
    // Anything else that is no API's answer is named by its class alone.
    const other = await name(request, {
      model: throwing(new Error(`socket closed after ${KEY}`)),
      maxRetries: 0,
    }).catch((thrown: unknown) => thrown);
    expect(other).toMatchObject({
      reason: "provider",
      message: "The call to the model failed (Error)",
    });
    // An API's answer: its status and its first line, key-like tokens taken out, cut short.
    const api = await name(request, {
      model: throwing(
        new APICallError({
          message: `Invalid key AIzaInventedNotAKey and ${"q".repeat(40)}: ${"word ".repeat(80)}\n${KEY}`,
          url: "https://invalid.example/v1",
          requestBodyValues: {},
          statusCode: 400,
        }),
      ),
      maxRetries: 0,
    }).catch((thrown: unknown) => thrown);
    expect(api).toMatchObject({ reason: "provider", status: 400 });
    const message = (api as Error).message;
    expect(
      message.startsWith(
        "The model's provider answered HTTP 400: Invalid key <key> and <key>: word",
      ),
    ).toBe(true);
    for (const leak of ["AIza", "qqqq", KEY]) expect(message).not.toContain(leak);
    expect(message.length).toBeLessThanOrEqual(
      "The model's provider answered HTTP 400: ".length + 200,
    );
  });

  test("name a macro only by a plain name, and never quote what the model wrote", async () => {
    const request = await inventedRequest();
    const naming = inventedNaming(request);
    // A model that echoes its prompt as a macro's name, and adds a field named with its words.
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        const text = messagesOf(options as Call).find((each) => each.role === "user")?.text ?? "";
        const at = text.indexOf('Definition "');
        const [first, ...rest] = naming.macros;
        return reply(
          JSON.stringify({
            ...naming,
            macros: [{ ...first, name: text.slice(at, at + 5000) }, ...rest],
            "Definition of the person": 1,
          }),
        );
      },
    });
    const error = await name(request, { model }).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ reason: "invalid" });
    const message = (error as Error).message;
    expect(message.length).toBeLessThan(400);
    for (const leak of ["Definition", "macro:", "cv@style", "person"])
      expect(message).not.toContain(leak);
    const retry = messagesOf(model.doGenerateCalls[1]).at(-1)?.text ?? "";
    expect(retry).toContain("- the answer for a command whose name is not plain, at name:");
    expect(retry).toContain("- the answer: fields the contract has not");
    expect(retry).not.toContain("Definition");
    // The budget's message names a macro the same way.
    const big = await inventedRequest({ extra: 1, size: 50_000 });
    const renamed = {
      ...big,
      macros: big.macros.map((macro) =>
        macro.name === "cvextraa" ? { ...macro, name: "cvextra Quill" } : macro,
      ),
      definitions: big.definitions.map((each) =>
        each.name === "cvextraa" ? { ...each, name: "cvextra Quill" } : each,
      ),
    };
    expect(() => batchesOf(renamed, INSTRUCTIONS.length + 20_000)).toThrow(
      "too small for a command whose name is not plain",
    );
  });

  test("refuse a list's partner no command of the request is, and a preamble's key that is not a plain name", async () => {
    const request = await inventedRequest();
    const naming = inventedNaming(request);
    const INJECTED = "endcvitems}\\immediate\\write18{touch /tmp/invented}\\iffalse{";
    const poisoned = {
      ...naming,
      macros: naming.macros.map((each) =>
        each.name === "cvitems"
          ? {
              ...each,
              answer: {
                kind: "bulletList",
                arguments: [],
                repeatable: false,
                list: { does: "opens", closedBy: INJECTED, holds: "bullet" },
              },
            }
          : each.name === "cvsection"
            ? {
                ...each,
                answer: {
                  ...each.answer,
                  list: { does: "closes", openedBy: "a macro no request has" },
                },
              }
            : each,
      ),
    };
    const model = new MockLanguageModelV4({
      doGenerate: async () => reply(JSON.stringify(poisoned)),
    });
    const error = await name(request, { model }).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ reason: "invalid" });
    expect(model.doGenerateCalls).toHaveLength(2);
    const retry = messagesOf(model.doGenerateCalls[1]).at(-1)?.text ?? "";
    expect(retry).toContain(
      `- the answer for environment "cvitems" names, as its list's closedBy, no command of the template's`,
    );
    expect(retry).toContain(
      `- the answer for command "cvsection" names, as its list's openedBy, no command of the template's`,
    );
    for (const leak of ["write18", "no request has"]) {
      expect(retry).not.toContain(leak);
      expect((error as Error).message).not.toContain(leak);
    }
    // A command of the document that the request leaves out, one the cache answered, is a partner.
    const closes = {
      ...naming,
      macros: naming.macros.map((each) =>
        each.name === "cvsection"
          ? {
              ...each,
              answer: { ...each.answer, list: { does: "closes", openedBy: "cvsectionstart" } },
            }
          : each,
      ),
    };
    const paired = new MockLanguageModelV4({
      doGenerate: async () => reply(JSON.stringify(closes)),
    });
    expect(await name(request, { model: paired, partners: ["cvsectionstart"] })).toEqual(closes);
    expect(messagesOf(paired.doGenerateCalls[0])[1]?.text).toContain(
      'names: "cvname", "cvheader", "cvsection", "cventry", "cvsectionstart".',
    );
    // The preamble's parameters: a key is a plain name, and a setting one the request has.
    const keyed = {
      ...naming,
      preamble: {
        parameters: [
          { parameter: "margins", setting: 0, command: "usepackage", key: "margin}\\input{x}" },
          { parameter: "accent", setting: 7, command: "definecolor", key: "accent" },
        ],
      },
    };
    const keys = new MockLanguageModelV4({ doGenerate: async () => reply(JSON.stringify(keyed)) });
    await expect(name(request, { model: keys })).rejects.toMatchObject({ reason: "invalid" });
    const quoted = messagesOf(keys.doGenerateCalls[1]).at(-1)?.text ?? "";
    expect(quoted).toContain(
      "- preamble.parameters.0.key: a key is a plain name, of letters, digits, @, dots, hyphens and underscores",
    );
    expect(quoted).toContain(
      "- preamble.parameters.1.setting: the request has no setting of that number",
    );
    expect(quoted).not.toContain("\\input");
  });
});

/** An invented request whose first macro fits in a part alone but not beside the preamble. */
async function firstPartRequest(): Promise<NamingRequest> {
  const bigText = `macro:#1->\\relax ${"\\hskip 1pt ".repeat(4000)}`;
  const smallText = "macro:#1->\\textbf {#1}";
  const settings = Array.from(
    { length: 40 },
    (_, i) => `\\setlength{\\parskip}{${i % 9}pt}${" ".repeat(400)}`,
  );
  const hash = { big: await sha256(bigText), small: await sha256(smallText) };
  const macro = (name: string, key: string) => ({
    of: "command",
    name,
    signature: "m",
    key,
    dependencies: [],
    capped: false,
    arguments: [{ index: 1, kind: "mandatory", verdict: "editable" }],
    sites: [{ arguments: ["Xxxx"] }],
    calls: 1,
  });
  return NamingRequest.parse({
    version: NAMING_VERSION,
    engine: "pdftex",
    preamble: { class: { name: "xxxxxxx", options: ["11pt"] }, settings },
    macros: [
      macro("cvbig", await keyOf(NAMING_VERSION, hash.big, [])),
      macro("cvsmall", await keyOf(NAMING_VERSION, hash.small, [])),
    ],
    definitions: [
      { kind: "definition", name: "cvbig", hash: hash.big, text: bigText },
      { kind: "definition", name: "cvsmall", hash: hash.small, text: smallText },
    ],
  });
}
