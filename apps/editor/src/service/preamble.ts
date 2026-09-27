/**
 * The preamble's answer, kept (milestone 3 item 10, decision 0028). No macro's key files the
 * preamble's answer, which the model gives with the first part of every request it is asked; so a
 * request whose every macro the cache answers would have none, and the style controls found on a
 * template's first import would be gone on the next. The service keeps each answer by the key of
 * the preamble it answers, `preamble:<key>` on KV, the SHA-256 of the naming version, the class and
 * the settings as the request holds them, masked; and asks the model for the preamble alone when
 * every macro hits and no answer is kept. Like an answer, it is filed only under a key that holds
 * nothing, and what a cache gives back is checked before it is given.
 *
 * It holds no Node and no Workers code: the handler and both hosts' stores use it.
 */

import {
  AnswerSource,
  Hash,
  NAMING_VERSION,
  type NamingRequest,
  PreambleAnswer,
  sha256,
} from "@resume-tools/naming";
import { PLAIN_KEY } from "@resume-tools/naming/model";
import { z } from "zod";
import type { Provenance } from "./name.ts";

/** A preamble's answer as a cache keeps it: the version, its key, the model that gave it, the answer. */
export const StoredPreamble = z.strictObject({
  version: z.literal(NAMING_VERSION),
  key: Hash,
  source: AnswerSource,
  preamble: PreambleAnswer,
});
export type StoredPreamble = z.infer<typeof StoredPreamble>;

/**
 * Where the preambles' answers are kept, by `preambleKey`: `get` gives back what is kept, as an
 * object or its JSON, or nothing; `put` files an answer only under a key that holds nothing, and
 * says whether it did.
 */
export interface PreambleCache {
  get(key: string): unknown | Promise<unknown>;
  put(key: string, stored: StoredPreamble, provenance?: Provenance): boolean | Promise<boolean>;
}

/** Whether a request's preamble has anything to answer: settings, or the class's options. */
export const asksPreamble = (request: Pick<NamingRequest, "preamble">) =>
  request.preamble.settings.length > 0 || (request.preamble.class?.options.length ?? 0) > 0;

/**
 * The key a request's preamble is answered under: the SHA-256 of the JSON of the naming version,
 * the class's name and options, and the settings, masked as the request holds them.
 */
export function preambleKey(request: Pick<NamingRequest, "preamble">): Promise<string> {
  const { class: documentClass, settings } = request.preamble;
  return sha256(
    JSON.stringify([
      NAMING_VERSION,
      documentClass?.name ?? null,
      documentClass?.options ?? [],
      settings,
    ]),
  );
}

/**
 * The preamble's answer a cache held under `key`, when it is one for the request: a stored
 * preamble of this version, filed under that key, whose every parameter names a setting the
 * request has, by a plain key, as `name` checks the model's. Anything else is none.
 */
export function preambleFrom(
  held: unknown,
  key: string,
  request: Pick<NamingRequest, "preamble">,
): PreambleAnswer | undefined {
  let value = held;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  const parsed = StoredPreamble.safeParse(value);
  if (!parsed.success || parsed.data.key !== key) return undefined;
  const settings = request.preamble.settings.length;
  const fits = parsed.data.preamble.parameters.every(
    (parameter) =>
      (parameter.setting === undefined || parameter.setting < settings) &&
      (parameter.key === undefined || PLAIN_KEY.test(parameter.key)),
  );
  return fits ? parsed.data.preamble : undefined;
}

/**
 * Preambles' answers in memory, for the dev server, which asks again once a template after it
 * restarts, and the tests: each filed once, and counted.
 */
export class MemoryPreambleCache implements PreambleCache {
  readonly held = new Map<string, StoredPreamble>();
  puts = 0;

  get(key: string): StoredPreamble | undefined {
    return this.held.get(key);
  }

  put(key: string, stored: StoredPreamble): boolean {
    if (this.held.has(key)) return false;
    this.puts++;
    this.held.set(key, StoredPreamble.parse(stored));
    return true;
  }
}
