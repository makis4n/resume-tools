/**
 * The service's model, from its host's variables (milestone 3 item 10, decision 0028): the dev
 * server's, which Vite's `loadEnv` reads from the editor's `.env` files and environment, and the
 * Pages Function's environment. The key is `SOCLAAS_API_KEY`, SoCLaaS's (decision 0036), which
 * `pdf-model` reads too, so that one variable serves both; `PDF_LABEL_MODEL` picks the model by its
 * id, `DEFAULT_MODEL` when unset. Neither ever has the `VITE_` prefix, which would put the key in
 * the page, and nothing here says a key's value.
 */

import { DEFAULT_MODEL, soclaasModel } from "@resume-tools/naming/providers";

/** The variable the key is read from. */
export const KEY_VARIABLE = "SOCLAAS_API_KEY";

/** The variable the label route's model id is read from (milestone 3 second pass, item 13). */
export const LABEL_MODEL_VARIABLE = "PDF_LABEL_MODEL";

/** The variables the label route reads: the one key, and its model's id. */
export type LabelEnv = Partial<Record<typeof KEY_VARIABLE | typeof LABEL_MODEL_VARIABLE, string>>;

/** The id of the model the label route asks: `PDF_LABEL_MODEL`, or the default. */
export const labelModelIdOf = (env: LabelEnv) => env[LABEL_MODEL_VARIABLE]?.trim() || DEFAULT_MODEL;

/**
 * The model the route that labels a PDF's lines asks, or none when no key is set, so that the
 * route refuses and the page's rules read the PDF. The key is read on the server side alone.
 * Throws, naming the variable and never its value, for an id that is not plainly one, or a key that
 * is not one line.
 */
export function labelModel(env: LabelEnv): ReturnType<typeof soclaasModel> | undefined {
  const id = labelModelIdOf(env);
  if (!/^[A-Za-z0-9._:/@-]{1,128}$/.test(id))
    throw new Error(`${LABEL_MODEL_VARIABLE} is not a model's id: letters, digits and ._:/@- only`);
  const key = env[KEY_VARIABLE]?.trim() ?? "";
  if (key === "") return undefined;
  if (/\s/.test(key))
    throw new Error(`${KEY_VARIABLE} holds a space or a line break: set it on one line`);
  return soclaasModel(key, id);
}
