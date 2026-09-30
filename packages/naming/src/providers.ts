/**
 * The naming step's providers (milestone 3 items 9 and 18, decisions 0027 and 0036): the one place
 * a model is made for `name`, which takes any AI SDK `LanguageModel`. SoCLaaS first, the School of
 * Computing's OpenAI-compatible gateway, whose calls bill nothing: `soclaasModel` makes one of its
 * models by its id. `googleModel` keeps Gemini, the fallback should the public launch not use the
 * school's gateway. Each takes the key its caller gives, never one read from the environment, so
 * that its caller, the naming service or the corpus runner, decides where the key comes from. The
 * id comes from `NAMING_MODEL`, and the default otherwise, so that a candidate swaps with a
 * variable, as item 18's benchmark swaps them.
 */

import { createGoogle } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

/** The gateway's OpenAI-compatible routes. */
export const SOCLAAS_URL = "https://soclaas-api.comp.nus.edu.sg/v1";

/**
 * The model the naming step asks when configuration names none: `qwen3.8:27b`, the gateway's
 * all-round model in its catalog of 2026-09-05, until item 18's benchmark picks the default.
 */
export const DEFAULT_MODEL = "qwen3.8:27b";

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
 * caller read. The answer's schema goes to the gateway as a JSON schema response format, which
 * `name` validates whatever the gateway does with it.
 */
export function soclaasModel(
  apiKey: string,
  id: string = DEFAULT_MODEL,
): Exclude<LanguageModel, string> {
  return createOpenAICompatible({
    name: "soclaas",
    baseURL: SOCLAAS_URL,
    apiKey: keyOf(apiKey, "SoCLaaS"),
    supportsStructuredOutputs: true,
  }).chatModel(id);
}

/** Google's model of the id given, which calls Google's API with `apiKey`, the key the caller read. */
export function googleModel(
  apiKey: string,
  id: string = GEMINI_MODEL,
): Exclude<LanguageModel, string> {
  return createGoogle({ apiKey: keyOf(apiKey, "Gemini") })(id);
}
