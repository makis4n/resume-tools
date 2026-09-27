/**
 * What the naming service answers (milestone 3 item 10, decision 0028): decision 0024's
 * `NamingAnswer`, and with it how many of the request's macros the cache answered (`hits`), how
 * many were asked of the model (`asked`), how many keys were left unfiled because the answers
 * under them disagree (`conflicts`), and the macros left with no answer (`missing`), which the
 * editor locks.
 *
 * `macros` holds one stored answer for each macro of the request that has one, named for that
 * macro and of its kind, its list's partners named as the request names them, whether the cache
 * gave it or the model did, and whether or not it was filed: item 7 assembles by `of` and `name`
 * (`command|<name>`), so a macro that shares its key with another, or that hits an answer another
 * template filed under the key, still finds its own. The preamble's answer is the model's when it
 * was asked, the one kept for the preamble when it was not, and empty when there is none.
 *
 * The handler writes it and the browser's client reads it, so this file imports the contract's
 * path alone, never the model's: the page never loads the AI SDK.
 */

import { Hash, MacroName, NamingAnswer, REQUEST_CAPS } from "@resume-tools/naming";
import { z } from "zod";

/** A macro of the request left with no answer: whether a command or an environment, its name, its key. */
export const MissingMacro = z.strictObject({
  of: z.enum(["command", "environment"]),
  name: MacroName,
  key: Hash,
});
export type MissingMacro = z.infer<typeof MissingMacro>;

/** The service's answer to a naming request. */
export const NamingReply = z.strictObject({
  ...NamingAnswer.shape,
  hits: z.int().min(0).max(REQUEST_CAPS.macros),
  asked: z.int().min(0).max(REQUEST_CAPS.macros),
  conflicts: z.int().min(0).max(REQUEST_CAPS.macros),
  missing: z.array(MissingMacro).max(REQUEST_CAPS.macros),
});
export type NamingReply = z.infer<typeof NamingReply>;

/**
 * What the service answers when it refuses a request: a sentence, and where the request has
 * problems, each by where it is and what is wrong, never by what it holds.
 */
export interface NamingRefusal {
  error: string;
  problems?: string[];
}
