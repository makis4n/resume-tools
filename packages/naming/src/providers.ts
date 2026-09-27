/**
 * The naming step's providers (milestone 3 item 9, decision 0026): the one place a model is made
 * for `name`, which takes any AI SDK `LanguageModel`. Gemini first, as plan section 6.4 expects:
 * `googleModel` makes one of Google's models by its id, with the key the caller gives, never one
 * read from the environment, so that its caller, the naming service or the corpus runner,
 * decides where the key comes from. The corpus runner takes the id from `NAMING_MODEL`, and the default
 * otherwise, so that a candidate swaps with a variable; item 18 adds the others it benchmarks.
 */

import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/**
 * The model the naming step asks when configuration names none: Gemini 3.8 Flash, the current
 * Flash model, which Google's free tier serves, as its models and pricing pages gave it on
 * 2026-09-27.
 */
export const DEFAULT_MODEL = "gemini-3.8-flash";

/**
 * Google's model of the id given, which calls Google's API with `apiKey`, the key the caller read:
 * the provider reads one from the environment only when given none, which this never does. An
 * empty key throws here rather than at Google.
 */
export function googleModel(
  apiKey: string,
  id: string = DEFAULT_MODEL,
): Exclude<LanguageModel, string> {
  if (apiKey.trim() === "") throw new Error("Gemini's model needs an API key");
  return createGoogle({ apiKey: apiKey.trim() })(id);
}
