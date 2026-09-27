/**
 * The naming service's model, from its host's variables (milestone 3 item 10, decision 0028): the
 * dev server's, which Vite's `loadEnv` reads from the editor's `.env` files and environment, and the
 * Pages Function's environment. The key is `NAMING_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY`, the
 * provider's own name for it, read when the first is unset; `NAMING_MODEL` picks the model by its
 * id, `DEFAULT_MODEL` when unset. None of them ever has the `VITE_` prefix, which would put the key
 * in the page, and nothing here says a key's value.
 */

import { AnswerSource } from "@resume-tools/naming";
import type { NameOptions } from "@resume-tools/naming/model";
import { DEFAULT_MODEL, googleModel } from "@resume-tools/naming/providers";

/** The variables the key is read from, the first that is set. */
export const KEY_VARIABLES = ["NAMING_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"] as const;

/** The variables the service reads. */
export type NamingEnv = Partial<Record<(typeof KEY_VARIABLES)[number] | "NAMING_MODEL", string>>;

/**
 * The model the service asks, or none when no key is set, so that the route answers from the cache
 * alone. Throws, naming the variable and never its value, for a model's id that no stored answer's
 * source could name, or a key that is not one line.
 */
export function namingModel(env: NamingEnv): NameOptions["model"] | undefined {
  const id = env.NAMING_MODEL?.trim() || DEFAULT_MODEL;
  if (!AnswerSource.safeParse(`model:${id}`).success)
    throw new Error("NAMING_MODEL is not a model's id: letters, digits and ._:/@- only");
  const key = KEY_VARIABLES.map((variable) => env[variable]?.trim() ?? "").find(
    (each) => each !== "",
  );
  if (key === undefined) return undefined;
  if (/\s/.test(key))
    throw new Error("The naming model's key holds a space or a line break: set it on one line");
  return googleModel(key, id);
}
