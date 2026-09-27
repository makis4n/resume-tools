/**
 * The naming service's model, from its host's variables (milestone 3 item 10, decision 0028): the
 * dev server's, which Vite's `loadEnv` reads from the editor's `.env` files and environment, and the
 * Pages Function's environment. The key is `GOOGLE_GENERATIVE_AI_API_KEY`, the provider's own name
 * for it, which the corpus runner reads too, so that one variable serves both; `NAMING_MODEL` picks
 * the model by its id, `DEFAULT_MODEL` when unset. Neither ever has the `VITE_` prefix, which would
 * put the key in the page, and nothing here says a key's value.
 */

import { AnswerSource } from "@resume-tools/naming";
import type { NameOptions } from "@resume-tools/naming/model";
import { DEFAULT_MODEL, googleModel } from "@resume-tools/naming/providers";

/** The variable the key is read from. */
export const KEY_VARIABLE = "GOOGLE_GENERATIVE_AI_API_KEY";

/** The variables the service reads. */
export type NamingEnv = Partial<Record<typeof KEY_VARIABLE | "NAMING_MODEL", string>>;

/** The id of the model the variables pick: `NAMING_MODEL`, or the default. */
export const modelIdOf = (env: NamingEnv) => env.NAMING_MODEL?.trim() || DEFAULT_MODEL;

/**
 * The model the service asks, or none when no key is set, so that the route answers from the cache
 * alone. Throws, naming the variable and never its value, for a model's id that no stored answer's
 * source could name, or a key that is not one line.
 */
export function namingModel(env: NamingEnv): NameOptions["model"] | undefined {
  const id = modelIdOf(env);
  if (!AnswerSource.safeParse(`model:${id}`).success)
    throw new Error("NAMING_MODEL is not a model's id: letters, digits and ._:/@- only");
  const key = env[KEY_VARIABLE]?.trim() ?? "";
  if (key === "") return undefined;
  if (/\s/.test(key))
    throw new Error(`${KEY_VARIABLE} holds a space or a line break: set it on one line`);
  return googleModel(key, id);
}
