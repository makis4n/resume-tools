/**
 * The model's provider code (milestone 3 items 9 and 18, decisions 0027 and 0036): the one place an
 * AI SDK `LanguageModel` is made. `claudeModel` makes one of Anthropic's, which the PDF reading
 * asks first (decision 0109); `soclaasModel` one of SoCLaaS's, the School of Computing's
 * OpenAI-compatible gateway, whose calls bill nothing, asked behind it. `googleModel` keeps
 * Gemini, unused. Each takes the key its caller gives, never one read from the environment, so that its caller, the
 * service that labels a PDF's lines or `pdf-model`, decides where the key comes from. The default,
 * `qwen3.8:27b`, is asked with its thinking off (decision 0044). It was written for the first
 * pass's naming step, which the second pass's item 17 deleted (decision 0063); the PDF reading
 * reuses it (decision 0056), and the package keeps its name.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type LanguageModel, wrapLanguageModel } from "ai";

/** The gateway's OpenAI-compatible routes. */
export const SOCLAAS_URL = "https://soclaas-api.comp.nus.edu.sg/v1";

/** The provider's name, which the AI SDK reads its options under. */
const PROVIDER = "soclaas";

/**
 * The ways a Qwen 3 model on the gateway may be asked not to reason before it answers (item 18's
 * benchmark, decision 0044), as the model and the servers that host it take one: a `/no_think`
 * line after the instructions, the model's own switch (`no-think`); the chat template's
 * `enable_thinking` set false, as vLLM and SGLang take it (`template`); and a reasoning effort of
 * none, as OpenAI's API names it and Ollama takes it (`effort`). Each leaves the request, its prompt
 * and the answer's schema as they are.
 */
export const THINKING_SWITCHES = ["no-think", "template", "effort"] as const;
export type ThinkingSwitch = (typeof THINKING_SWITCHES)[number];

/** A model whose every call asks it not to reason first, by the switch given. */
export function withoutThinking(
  model: Exclude<LanguageModel, string>,
  how: ThinkingSwitch,
): Exclude<LanguageModel, string> {
  return wrapLanguageModel({
    model,
    middleware: {
      transformParams: async ({ params }) => {
        if (how === "no-think")
          return {
            ...params,
            prompt: params.prompt.map((message) =>
              message.role === "system"
                ? { ...message, content: `${message.content}\n/no_think` }
                : message,
            ),
          };
        return {
          ...params,
          providerOptions: {
            ...params.providerOptions,
            [PROVIDER]: {
              ...params.providerOptions?.[PROVIDER],
              ...(how === "template"
                ? { chat_template_kwargs: { enable_thinking: false } }
                : { reasoningEffort: "none" }),
            },
          },
        };
      },
    },
  });
}

/**
 * The model asked when configuration names none: `qwen3.8:27b`, the gateway's all-round model,
 * asked with its thinking off (`MODEL_THINKING`), as the first pass's benchmark chose it (decision
 * 0044), from which the PDF reading starts.
 */
export const DEFAULT_MODEL = "qwen3.8:27b";

/**
 * How a model is asked not to reason first, by its id (decision 0044): the default, by its chat
 * template's switch, as the first pass's benchmark chose it. Reasoning first, its every part of
 * the sample outran the runner's 300 s.
 */
export const MODEL_THINKING: Readonly<Record<string, ThinkingSwitch>> = {
  [DEFAULT_MODEL]: "template",
};

/** Gemini's model when `googleModel` is given no id: 3.8 Flash, as Google gave it on 2026-09-27. */
export const GEMINI_MODEL = "gemini-3.8-flash";

/**
 * A key as the caller read it, trimmed: an empty one throws here rather than at the provider, and
 * so does one of more than one line or with a space in it, as a key file with a comment gives,
 * whose value the runtime would quote in the error it throws for a header it cannot send; neither
 * message holds the key.
 */
function keyOf(apiKey: string, provider: string): string {
  const key = apiKey.trim();
  if (key === "") throw new Error(`${provider}'s model needs an API key`);
  if (/\s/.test(key)) throw new Error(`${provider}'s key is one line with no spaces`);
  return key;
}

/**
 * SoCLaaS's model of the id given, over its chat completions route, with `apiKey`, the key the
 * caller read. An answer's schema goes to the gateway as a JSON schema response format, which its
 * caller validates whatever the gateway does with it. Every call asks the model not to reason
 * first by the switch `MODEL_THINKING` gives its id, the default's included, or by `thinking`
 * where it is given; `thinking: false` leaves the model to reason, as the benchmark measures it so.
 * `fetch` stands in for the platform's, for a test that reads what would be sent.
 */
export function soclaasModel(
  apiKey: string,
  id: string = DEFAULT_MODEL,
  options: { thinking?: ThinkingSwitch | false; fetch?: typeof fetch } = {},
): Exclude<LanguageModel, string> {
  const model = createOpenAICompatible({
    name: PROVIDER,
    baseURL: SOCLAAS_URL,
    apiKey: keyOf(apiKey, "SoCLaaS"),
    supportsStructuredOutputs: true,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  }).chatModel(id);
  const thinking = options.thinking ?? MODEL_THINKING[id];
  return thinking === undefined || thinking === false ? model : withoutThinking(model, thinking);
}

/**
 * Claude's model when `claudeModel` is given no id: Haiku 5.5, the PDF reading's first model
 * (decision 0109), with SoCLaaS's behind it.
 */
export const CLAUDE_MODEL = "claude-haiku-5-5";

/** Anthropic's API, which Claude's model is always asked at. */
export const ANTHROPIC_URL = "https://api.anthropic.com/v1";

/**
 * Claude's model of the id given, over Anthropic's Messages API, with `apiKey`, the key the caller
 * read. An answer's schema goes as the API's structured output, and every call asks the model not
 * to think first, as SoCLaaS's default is asked (decision 0044): Haiku with its thinking off,
 * Sonnet 5.5, which cannot turn it off, with its lowest setting, which the provider puts in its
 * place; `thinking: true` leaves the model to think as it decides. Neither takes a temperature,
 * so a caller's is dropped here, before the provider would warn of it on every call. `fetch` stands
 * in for the platform's, for a test that reads what would be sent.
 */
export function claudeModel(
  apiKey: string,
  id: string = CLAUDE_MODEL,
  options: { thinking?: boolean; fetch?: typeof fetch } = {},
): Exclude<LanguageModel, string> {
  const model = createAnthropic({
    // Named here, since the provider would otherwise read ANTHROPIC_BASE_URL from the environment
    // and send the lines and the key wherever it pointed.
    baseURL: ANTHROPIC_URL,
    apiKey: keyOf(apiKey, "Claude"),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })(id);
  return wrapLanguageModel({
    model,
    middleware: {
      transformParams: async ({ params }) => ({
        ...params,
        temperature: undefined,
        ...(options.thinking === true
          ? {}
          : {
              providerOptions: {
                ...params.providerOptions,
                anthropic: { ...params.providerOptions?.anthropic, thinking: { type: "disabled" } },
              },
            }),
      }),
    },
  });
}

/** Google's model of the id given, which calls Google's API with `apiKey`, the key the caller read. */
export function googleModel(
  apiKey: string,
  id: string = GEMINI_MODEL,
): Exclude<LanguageModel, string> {
  return createGoogle({ apiKey: keyOf(apiKey, "Gemini") })(id);
}
