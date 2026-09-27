/**
 * The naming step's cache key (milestone 3 item 6, decision 0024). What the model works out about
 * a template's macro is saved once and reused for every document with the same macro, keyed by a
 * hash of its normalised definition and its dependencies' (plan section 6.3): the definition is
 * TeX's own `\meaning` of the macro, with emails, links and phone numbers masked (decision 0020),
 * and its dependencies are the template's macros it names, closed over. The key also holds the
 * naming version, so that a change to what is asked or answered never reads an older answer.
 *
 * `keysOf` in the editor's `signatures.ts` builds every macro's key through `keyOf`, so there is
 * one function for it; the service and the corpus runner recompute a request's keys with it too.
 */

/**
 * The naming contract's version: part of every cache key. Bump it when the request, the answer or
 * what the prompt asks of them changes meaning, so that no answer given to an older question is
 * read as the answer to a newer one.
 */
export const NAMING_VERSION = 1;

/**
 * The SHA-256 of the naming step's prompt, its instructions and how it lays a request out
 * (`prompt.ts`), as the prompt's test computes it: an edit to the prompt fails that test until this
 * is its hash again, and whoever updates it decides whether the edit changes what the prompt asks,
 * which bumps NAMING_VERSION, so that answers to the old question are no longer read (decision
 * 0027). An edit that changes only how the same question is put keeps the version.
 */
export const PROMPT_HASH = "baf9b9bf1eab753d3b42db130aa486437b5a829860fecb9d46c3e99bb7a7647f";

/**
 * A dependency as a key takes it: its name, and the hash of its definition, or null when the
 * definition is missing, as the closure of a truncated printout can name one. A dependency that
 * holds data is left out of the key: which of a class's fields a preamble sets, and what it sets
 * them to, never moves a key.
 */
export type Dependency = readonly [name: string, hash: string | null];

/** The SHA-256 of a text in UTF-8, in lower-case hex, as the browser, Node and Workers compute it. */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A macro's cache key: the SHA-256 of the JSON of the naming version, the hash of its definition,
 * and its definition dependencies, each its name and hash, in the order of its closure. Two
 * documents whose class gives a macro the same definition and the same closure give it the same
 * key, whoever the person is.
 */
export function keyOf(
  version: number,
  hash: string,
  dependencies: readonly Dependency[],
): Promise<string> {
  return sha256(JSON.stringify([version, hash, dependencies]));
}

/**
 * An environment's cache key: `keyOf` over its `\begin` code's hash, with its `\end` code as
 * the first dependency, by its end name, and its closures' definitions after it.
 */
export function environmentKeyOf(
  version: number,
  beginHash: string,
  endName: string,
  endHash: string | null,
  dependencies: readonly Dependency[],
): Promise<string> {
  return keyOf(version, beginHash, [[endName, endHash], ...dependencies]);
}
