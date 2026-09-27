/**
 * Reading the naming step's cache (milestone 3 item 6, decision 0024), and checking a request's
 * keys. A cache is anything that gives back what was put under a key: the committed answers under
 * `corpus/answers/`, the runner's ignored folder, the service's KV (items 9 and 10). What it gives
 * back is not trusted: `answerFor` returns an answer only when it is a stored answer this version
 * reads, given under the key asked for.
 */

import { StoredAnswer } from "./answer.ts";
import { type Dependency, keyOf, NAMING_VERSION, sha256 } from "./key.ts";
import type { NamingRequest, RequestMacro } from "./request.ts";

/** What a cache gives back under a key: a stored answer, its JSON, or nothing. */
export interface AnswerCache {
  get(key: string): unknown | Promise<unknown>;
}

/**
 * The answer a cache holds under `key`, when it holds one this naming version reads: a stored
 * answer, as an object or its JSON, of this version and given under that key. Anything else, an
 * older version's answer, one filed under another key or one that does not validate, is no answer,
 * and the caller asks again.
 */
export async function answerFor(
  cache: AnswerCache,
  key: string,
): Promise<StoredAnswer | undefined> {
  let held = await cache.get(key);
  if (held === undefined || held === null) return undefined;
  if (typeof held === "string") {
    try {
      held = JSON.parse(held);
    } catch {
      return undefined;
    }
  }
  const parsed = StoredAnswer.safeParse(held);
  if (!parsed.success) return undefined;
  if (parsed.data.version !== NAMING_VERSION || parsed.data.key !== key) return undefined;
  return parsed.data;
}

/**
 * A request macro's key, from the request alone: its own definition's hash and its dependencies'
 * that are code, by name, in its closure's order, under the request's version. Undefined for a
 * macro whose own definition is data, which has no key.
 */
export function requestKey(
  request: Pick<NamingRequest, "version" | "definitions">,
  macro: Pick<RequestMacro, "name" | "dependencies">,
): Promise<string> | undefined {
  const definitions = new Map(request.definitions.map((each) => [each.name, each]));
  const own = definitions.get(macro.name);
  if (own?.kind !== "definition") return undefined;
  const dependencies: Dependency[] = macro.dependencies.flatMap((name) => {
    const found = definitions.get(name);
    return found?.kind === "data" ? [] : [[name, found?.hash ?? null] as const];
  });
  return keyOf(request.version, own.hash, dependencies);
}

/** What `checkRequest` found wrong with a request: a definition's hash, or a macro's key. */
export interface RequestProblem {
  of: "definition" | "macro";
  name: string;
  problem: "hash" | "key";
}

/**
 * What a service checks of a request before it trusts its keys: that every definition's hash is
 * the SHA-256 of its text, and every macro's key the one its definitions give (`requestKey`). A
 * request whose keys hold lets its answers be stored for the next document with the same macros;
 * one whose keys do not could file an answer under another template's key.
 */
export async function checkRequest(request: NamingRequest): Promise<RequestProblem[]> {
  const problems: RequestProblem[] = [];
  for (const definition of request.definitions)
    if (definition.kind === "definition" && (await sha256(definition.text)) !== definition.hash)
      problems.push({ of: "definition", name: definition.name, problem: "hash" });
  for (const macro of request.macros) {
    const key = await requestKey(request, macro);
    if (key !== macro.key) problems.push({ of: "macro", name: macro.name, problem: "key" });
  }
  return problems;
}
