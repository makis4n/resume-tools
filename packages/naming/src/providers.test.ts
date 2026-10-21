import { generateText, jsonSchema, Output } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import {
  ANTHROPIC_URL,
  CLAUDE_MODEL,
  claudeModel,
  DEFAULT_MODEL,
  GEMINI_MODEL,
  googleModel,
  MODEL_THINKING,
  soclaasModel,
  THINKING_SWITCHES,
  withoutThinking,
} from "./providers";

// No test here calls a provider: a model is made, and never asked, or asked of a stand-in for
// `fetch` that answers in the provider's place.

/** The message `make` throws with, or undefined when it throws nothing. */
function thrownBy(make: () => unknown): string | undefined {
  try {
    make();
  } catch (thrown) {
    return (thrown as Error).message;
  }
  return undefined;
}

/**
 * What a call of a SoCLaaS model would send the gateway, read by a stand-in for `fetch` that
 * answers it, so that no provider is called: the request's body, as JSON.
 */
async function sentBy(
  make: (fetch: typeof globalThis.fetch) => ReturnType<typeof soclaasModel>,
): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  const fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: "invented",
        object: "chat.completion",
        created: 0,
        model: "invented",
        choices: [
          { index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
  await generateText({
    model: make(fetch),
    instructions: "Invented instructions.",
    messages: [{ role: "user", content: "An invented request." }],
    maxRetries: 0,
  });
  return body;
}

describe("SoCLaaS's model", () => {
  test("is made by its id, the benchmark's choice when none is given, with the key given", () => {
    const model = soclaasModel("invented-key");
    expect(DEFAULT_MODEL).toBe("qwen3.8:27b");
    expect(model).toMatchObject({ modelId: DEFAULT_MODEL, specificationVersion: "v4" });
    expect(String((model as { provider: string }).provider)).toMatch(/^soclaas/);
    expect(soclaasModel("invented-key", "qwen3.6:35b")).toMatchObject({ modelId: "qwen3.6:35b" });
  });

  test("asks the default with its thinking off by its chat template, as decision 0044 chose it", async () => {
    expect(MODEL_THINKING[DEFAULT_MODEL]).toBe("template");
    const sent = await sentBy((fetch) => soclaasModel("invented-key", undefined, { fetch }));
    expect(sent).toMatchObject({
      model: DEFAULT_MODEL,
      chat_template_kwargs: { enable_thinking: false },
    });
    // Another model is asked as it is, and so is the default when told to reason.
    const other = await sentBy((fetch) => soclaasModel("invented-key", "qwen3.6:35b", { fetch }));
    expect(other).toMatchObject({ model: "qwen3.6:35b" });
    expect(other).not.toHaveProperty("chat_template_kwargs");
    const reasoning = await sentBy((fetch) =>
      soclaasModel("invented-key", DEFAULT_MODEL, { thinking: false, fetch }),
    );
    expect(reasoning).not.toHaveProperty("chat_template_kwargs");
    // A switch given in place of the model's own.
    const effort = await sentBy((fetch) =>
      soclaasModel("invented-key", DEFAULT_MODEL, { thinking: "effort", fetch }),
    );
    expect(effort).toMatchObject({ reasoning_effort: "none" });
    expect(effort).not.toHaveProperty("chat_template_kwargs");
  });

  test("needs a key, and never falls back on one of the environment's", () => {
    expect(() => soclaasModel("")).toThrow("SoCLaaS's model needs an API key");
    expect(() => soclaasModel("   ")).toThrow("SoCLaaS's model needs an API key");
  });

  test("refuses a key that is not one word, and never says what it is", () => {
    for (const key of ["invented-key\n# a second line", "invented key"]) {
      const message = thrownBy(() => soclaasModel(key));
      expect(message).toBe("SoCLaaS's key is one line with no spaces");
      expect(message).not.toContain("invented");
    }
  });
});

describe("a model asked not to reason first", () => {
  /** A mock that answers every call, and what its one call was given. */
  async function called(how: (typeof THINKING_SWITCHES)[number]) {
    const mock = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "{}" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }),
    });
    await generateText({
      model: withoutThinking(mock, how),
      instructions: "Invented instructions.",
      messages: [{ role: "user", content: "An invented request." }],
      providerOptions: { soclaas: { user: "invented" } },
    });
    return mock.doGenerateCalls[0];
  }

  test("adds a /no_think line after the instructions, and leaves the request as it is", async () => {
    const call = await called("no-think");
    expect(call?.prompt[0]).toEqual({
      role: "system",
      content: "Invented instructions.\n/no_think",
    });
    expect(call?.prompt[1]).toMatchObject({ role: "user" });
    expect(call?.providerOptions).toEqual({ soclaas: { user: "invented" } });
  });

  test("or sets the chat template's enable_thinking false, or a reasoning effort of none", async () => {
    const template = await called("template");
    expect(template?.providerOptions).toEqual({
      soclaas: { user: "invented", chat_template_kwargs: { enable_thinking: false } },
    });
    expect(template?.prompt[0]).toEqual({ role: "system", content: "Invented instructions." });
    const effort = await called("effort");
    expect(effort?.providerOptions).toEqual({
      soclaas: { user: "invented", reasoningEffort: "none" },
    });
    expect(THINKING_SWITCHES).toEqual(["no-think", "template", "effort"]);
  });

  test("is made by soclaasModel with the switch, and keeps the model's id", () => {
    const model = soclaasModel("invented-key", "qwen3.8:27b", { thinking: "template" });
    expect(model).toMatchObject({ modelId: "qwen3.8:27b", specificationVersion: "v4" });
  });
});

/**
 * What a call of a Claude model would send Anthropic's API, read by a stand-in for `fetch` that
 * answers it in the Messages API's form, so that no provider is called: the request's body, as
 * JSON. The call asks for an object of an invented schema at temperature 0, as the label route does.
 */
async function sentToClaude(
  make: (fetch: typeof globalThis.fetch) => ReturnType<typeof claudeModel>,
): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  const fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: "invented",
        type: "message",
        role: "assistant",
        model: "invented",
        content: [{ type: "text", text: '{"L0":"name"}' }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
  await generateText({
    model: make(fetch),
    instructions: "Invented instructions.",
    messages: [{ role: "user", content: "An invented request." }],
    output: Output.object({
      schema: jsonSchema({
        type: "object",
        properties: { L0: { type: "string", enum: ["name", "bullet"] } },
        required: ["L0"],
        additionalProperties: false,
      }),
      name: "roles",
    }),
    temperature: 0,
    maxRetries: 0,
  });
  return body;
}

describe("Claude's model", () => {
  test("is made by its id, Haiku 5.5 when none is given, with the key given", () => {
    expect(CLAUDE_MODEL).toBe("claude-haiku-5-5");
    expect(claudeModel("invented-key")).toMatchObject({
      modelId: CLAUDE_MODEL,
      specificationVersion: "v4",
    });
    expect(claudeModel("invented-key", "claude-sonnet-5-5")).toMatchObject({
      modelId: "claude-sonnet-5-5",
    });
  });

  test("asks for the schema as a structured output, with no temperature and no thinking", async () => {
    const sent = await sentToClaude((fetch) => claudeModel("invented-key", undefined, { fetch }));
    expect(sent).toMatchObject({
      model: CLAUDE_MODEL,
      thinking: { type: "disabled" },
      output_config: { format: { type: "json_schema" } },
    });
    expect(sent).not.toHaveProperty("temperature");
    expect(sent).not.toHaveProperty("tool_choice");
  });

  test("asks Sonnet 5.5, which cannot turn its thinking off, with its lowest setting", async () => {
    const sent = await sentToClaude((fetch) =>
      claudeModel("invented-key", "claude-sonnet-5-5", { fetch }),
    );
    expect(sent).toMatchObject({ model: "claude-sonnet-5-5", thinking: { type: "between_tools" } });
  });

  test("is asked at Anthropic's API, whatever ANTHROPIC_BASE_URL says", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://gateway.invalid/v1");
    try {
      let url = "";
      await sentToClaude((fetch) =>
        claudeModel("invented-key", undefined, {
          fetch: (input, init) => {
            url = String(input);
            return fetch(input, init);
          },
        }),
      );
      expect(url).toBe(`${ANTHROPIC_URL}/messages`);
      vi.stubEnv("ANTHROPIC_BASE_URL", "");
      expect(() => claudeModel("invented-key")).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("leaves the model to think when told to", async () => {
    const sent = await sentToClaude((fetch) =>
      claudeModel("invented-key", undefined, { thinking: true, fetch }),
    );
    expect(sent).not.toHaveProperty("thinking");
  });

  test("needs a key, and refuses one that is not one word without saying what it is", () => {
    expect(() => claudeModel("")).toThrow("Claude's model needs an API key");
    const message = thrownBy(() => claudeModel("invented key"));
    expect(message).toBe("Claude's key is one line with no spaces");
    expect(message).not.toContain("invented");
  });
});

describe("Gemini's model", () => {
  test("is made by its id, 3.8 Flash when none is given, with the key given", () => {
    const model = googleModel("invented-key");
    expect(GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(model).toMatchObject({ modelId: GEMINI_MODEL, specificationVersion: "v4" });
    expect(String((model as { provider: string }).provider)).toMatch(/^google/);
    expect(googleModel("invented-key", "gemini-3.7-flash")).toMatchObject({
      modelId: "gemini-3.7-flash",
    });
  });

  test("needs a key, and refuses one that is not one word without saying what it is", () => {
    expect(() => googleModel("")).toThrow("Gemini's model needs an API key");
    const message = thrownBy(() => googleModel("invented key"));
    expect(message).toBe("Gemini's key is one line with no spaces");
    expect(message).not.toContain("invented");
  });
});
