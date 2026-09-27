import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test } from "vitest";
import type { ModelNaming } from "./answer";
import { inventedAnswer, inventedNaming, inventedRequest } from "./invented";
import { BATCH_MACROS, batchesOf, NamingError, type NamingUsage, name } from "./model";
import { askedOf, INSTRUCTIONS, layOut } from "./prompt";

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

/** A mock that answers each part for exactly the macros its prompt asks, and the preamble once. */
function answering(preamble: ModelNaming["preamble"]) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      const text = messagesOf(options as Call).find((message) => message.role === "user")?.text;
      const asked = headings(text ?? "");
      return reply(
        JSON.stringify({
          macros: asked.map((macro) => ({ ...macro, answer: inventedAnswer(macro) })),
          preamble: text?.includes("## The preamble's settings") ? preamble : { parameters: [] },
        }),
      );
    },
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
      message: "The call to the model failed: socket hang up",
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
      // provider's cache of a prompt's start serves each part.
      const shared = [...text.matchAll(/^Definition "([^"]+)":/gm)].map((found) => found[1]);
      if (headings(text).some((macro) => macro.name.startsWith("cvextra")))
        expect(shared.slice(0, 2)).toEqual(["cv@style", "cv@shared"]);
    });
  });

  test("asks at most BATCH_MACROS macros a part, whatever their size", async () => {
    const request = await inventedRequest({ extra: 40, size: 10 });
    expect(batchesOf(request).map((part) => askedOf(part.request).length)).toEqual([
      BATCH_MACROS,
      askedOf(request).length - BATCH_MACROS,
    ]);
  });

  test("throws budget, before any call, for a macro over the budget on its own", async () => {
    const request = await inventedRequest({ extra: 1, size: 50_000 });
    const model = new MockLanguageModelV4({ doGenerate: async () => reply("{}") });
    await expect(
      name(request, { model, budget: INSTRUCTIONS.length + 20_000 }),
    ).rejects.toMatchObject({ reason: "budget" });
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
