/**
 * The service's models, from its host's variables (milestone 3 item 10, decision 0028): the dev
 * server's, which Vite's `loadEnv` reads from the editor's `.env` files and environment, and the
 * Pages Function's environment. Claude is asked first and SoCLaaS behind it (decision 0109):
 * `ANTHROPIC_API_KEY` is Claude's key, and `PDF_LABEL_CLAUDE_MODEL` picks its model by its id,
 * `CLAUDE_MODEL` when unset; `SOCLAAS_API_KEY` is SoCLaaS's (decision 0036), and `PDF_LABEL_MODEL`
 * picks its model, `DEFAULT_MODEL` when unset. `pdf-model` reads the same keys. With one key alone,
 * its model is asked alone. None ever has the `VITE_` prefix, which would put a key in the page,
 * and nothing here says a key's value.
 */

import {
  CLAUDE_MODEL,
  claudeModel,
  DEFAULT_MODEL,
  soclaasModel,
} from "@resume-tools/naming/providers";
import type { LabelDeps } from "./label.ts";

/** The variable SoCLaaS's key is read from. */
export const KEY_VARIABLE = "SOCLAAS_API_KEY";

/** The variable Claude's key is read from (decision 0109). */
export const CLAUDE_KEY_VARIABLE = "ANTHROPIC_API_KEY";

/** The variable the label route's SoCLaaS model id is read from (milestone 3 second pass, item 13). */
export const LABEL_MODEL_VARIABLE = "PDF_LABEL_MODEL";

/** The variable the label route's Claude model id is read from (decision 0109). */
export const CLAUDE_MODEL_VARIABLE = "PDF_LABEL_CLAUDE_MODEL";

/** The variables the label route reads: the two keys, and their models' ids. */
export type LabelEnv = Partial<
  Record<
    | typeof KEY_VARIABLE
    | typeof CLAUDE_KEY_VARIABLE
    | typeof LABEL_MODEL_VARIABLE
    | typeof CLAUDE_MODEL_VARIABLE,
    string
  >
>;

/** Whether a model's id is Claude's, which `pdf-model` asks with Claude's key. */
export const isClaude = (id: string) => id.startsWith("claude-");

/** The id of the SoCLaaS model the label route asks: `PDF_LABEL_MODEL`, or the default. */
export const labelModelIdOf = (env: LabelEnv) => env[LABEL_MODEL_VARIABLE]?.trim() || DEFAULT_MODEL;

/** The id of the Claude model the label route asks: `PDF_LABEL_CLAUDE_MODEL`, or the default. */
export const claudeModelIdOf = (env: LabelEnv) =>
  env[CLAUDE_MODEL_VARIABLE]?.trim() || CLAUDE_MODEL;

/**
 * A variable's id, checked: throws, naming the variable and never a value, for an id that is not
 * plainly one.
 */
function checkedId(variable: string, id: string): string {
  if (!/^[A-Za-z0-9._:/@-]{1,128}$/.test(id))
    throw new Error(`${variable} is not a model's id: letters, digits and ._:/@- only`);
  return id;
}

/** A variable's key, trimmed, or undefined when unset: throws for one that is not one line. */
function keyOf(env: LabelEnv, variable: typeof KEY_VARIABLE | typeof CLAUDE_KEY_VARIABLE) {
  const key = env[variable]?.trim() ?? "";
  if (key === "") return undefined;
  if (/\s/.test(key))
    throw new Error(`${variable} holds a space or a line break: set it on one line`);
  return key;
}

/**
 * The models the route that labels a PDF's lines asks, the key being read on the server side
 * alone: Claude's first where its key is set, and SoCLaaS's as the fallback, or as the one model
 * where Claude's key is not set; none where neither is, so that the route refuses and the page's
 * rules read the PDF. Throws, naming the variable and never its value, for an id that is not
 * plainly one, or a key that is not one line.
 */
export function labelModels(env: LabelEnv): Pick<LabelDeps, "model" | "fallback"> {
  const claudeId = checkedId(CLAUDE_MODEL_VARIABLE, claudeModelIdOf(env));
  const soclaasId = checkedId(LABEL_MODEL_VARIABLE, labelModelIdOf(env));
  const claudeKey = keyOf(env, CLAUDE_KEY_VARIABLE);
  const soclaasKey = keyOf(env, KEY_VARIABLE);
  const claude = claudeKey === undefined ? undefined : claudeModel(claudeKey, claudeId);
  const soclaas = soclaasKey === undefined ? undefined : soclaasModel(soclaasKey, soclaasId);
  return claude === undefined
    ? { model: soclaas, fallback: undefined }
    : { model: claude, fallback: soclaas };
}
