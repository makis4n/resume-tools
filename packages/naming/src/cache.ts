/**
 * Reading and filing the naming step's cache (milestone 3 items 6 and 9, decisions 0024 and 0026),
 * and checking a request's keys. A cache is anything that gives back what was put under a key: the
 * committed answers under `corpus/answers/`, the runner's ignored folder, the service's KV (item
 * 10). What it gives back is not trusted: `answerFor` returns an answer only when it is a stored
 * answer this version reads, given under the key asked for, and, asked for a document's macro, one
 * that fits it. What goes in is checked the same way (`storable`), and a model's answer becomes
 * stored answers only through `storedAnswersOf`, by the keys the request's own definitions give.
 */

import { type ListAnswer, type ModelNaming, StoredAnswer } from "./answer.ts";
import { type Dependency, keyOf, NAMING_VERSION, sha256 } from "./key.ts";
import type { NamingRequest, RequestMacro } from "./request.ts";

/**
 * A cache of stored answers by key: `get` gives back a stored answer, its JSON, or nothing; `put`
 * files one under its key, and refuses anything that is not a stored answer under its own key.
 */
export interface AnswerCache {
  get(key: string): unknown | Promise<unknown>;
  put(key: string, answer: StoredAnswer): void | Promise<void>;
}

/**
 * The macro of a document an answer is asked for: its name, whether a command or an environment,
 * and the keys of its request's macros, by name, among which its list's partners are found.
 */
export interface AskingMacro {
  name: string;
  of: "command" | "environment";
  partners: ReadonlyMap<string, string>;
}

/**
 * No answer for the macro that asked, though the cache holds a valid one under its key, and why:
 * the answer's list names a partner no macro of the request is by key (`partner`), or the answer
 * is an environment's and a command asked, or the other way round (`kind`).
 */
export interface RefusedAnswer {
  answer: undefined;
  reason: "partner" | "kind";
}

/**
 * The answer a cache holds under `key`, when it holds one this naming version reads: a stored
 * answer, as an object or its JSON, of this version, given under that key, and whose dependencies,
 * where it names them, give that key (`keyOf`). Anything else, an older version's answer, one filed
 * under another key or one that does not validate, is no answer, and the caller asks again.
 *
 * Asked for a document's macro (`macro`), it gives the answer as that macro's: named as the macro
 * is, since a key leaves the name out and another template may give the same definition another
 * name; of the macro's kind; and with each partner its list names found by the key the answer
 * holds for it (`partnerKeys`) among the request's macros, and named as the request names it. An
 * answer whose kind is not the macro's, or whose partner the request has no macro of, or holds no
 * key for, is refused (`RefusedAnswer`): a fork that renames a list's two macros keeps their answers,
 * and one whose closer is a bare `\end{itemize}` that another template's list ends with does not
 * take that list's pairing.
 */
export function answerFor(
  cache: Pick<AnswerCache, "get">,
  key: string,
): Promise<StoredAnswer | undefined>;
export function answerFor(
  cache: Pick<AnswerCache, "get">,
  key: string,
  macro: AskingMacro,
): Promise<StoredAnswer | RefusedAnswer | undefined>;
export async function answerFor(
  cache: Pick<AnswerCache, "get">,
  key: string,
  macro?: AskingMacro,
): Promise<StoredAnswer | RefusedAnswer | undefined> {
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
  const stored = parsed.data;
  if (stored.version !== NAMING_VERSION || stored.key !== key) return undefined;
  if (
    stored.dependencies !== undefined &&
    (await keyOf(stored.version, stored.hash, stored.dependencies)) !== key
  )
    return undefined;
  if (macro === undefined) return stored;
  if (stored.of !== macro.of) return { answer: undefined, reason: "kind" };
  const list = stored.answer.list;
  if (list === undefined) return { ...stored, name: macro.name };
  const paired: ListAnswer = { ...list };
  for (const which of ["closedBy", "openedBy"] as const) {
    const named = list[which];
    if (named === undefined) continue;
    const partner = stored.partnerKeys?.[which];
    const names = [...macro.partners].flatMap(([name, each]) => (each === partner ? [name] : []));
    if (partner === undefined || names.length === 0)
      return { answer: undefined, reason: "partner" };
    // Two macros of one key have one definition: the one of the answer's name, where the request
    // has it, else the first.
    paired[which] = names.includes(named) ? named : (names[0] ?? named);
  }
  return { ...stored, name: macro.name, answer: { ...stored.answer, list: paired } };
}

/**
 * What a cache's `put` files under `key`: the answer, when it is a stored answer this naming version
 * reads and `key` is its own; otherwise it throws, saying what is wrong by the field, never by a
 * value. Every cache checks with it, so that none holds what `answerFor` would not give back.
 */
export function storable(key: string, answer: unknown): StoredAnswer {
  const parsed = StoredAnswer.safeParse(answer);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Not a stored answer: ${issue?.path.map(String).join(".") || "the answer"}: ${issue?.message ?? "does not validate"}`,
    );
  }
  if (parsed.data.version !== NAMING_VERSION || parsed.data.key !== key)
    throw new Error("A stored answer is filed under its own key, and of this naming version");
  return parsed.data;
}

/**
 * The stored answers a model's answer to a request gives: for each macro of the request that has a
 * key and an answer, by its name and whether a command or an environment, a stored answer under the
 * key its definitions give (`requestKey`), with its own definition's hash, its name, the request's
 * family, the answer, `reviewed: false`, and the model's id as its source. What the model answered
 * of anything else, and the preamble's answer, which no key files, are left out. It stores nothing:
 * the caller files them, after `checkRequest` (decision 0024).
 */
export async function storedAnswersOf(
  request: NamingRequest,
  naming: ModelNaming,
  source: `model:${string}`,
): Promise<StoredAnswer[]> {
  const definitions = new Map(request.definitions.map((each) => [each.name, each]));
  const answers = new Map(naming.macros.map((each) => [`${each.of}|${each.name}`, each.answer]));
  const stored: StoredAnswer[] = [];
  for (const macro of request.macros) {
    const answer = answers.get(`${macro.of}|${macro.name}`);
    const own = definitions.get(macro.name);
    const key = await requestKey(request, macro);
    if (answer === undefined || own?.kind !== "definition" || key === undefined) continue;
    stored.push(
      StoredAnswer.parse({
        version: request.version,
        key,
        hash: own.hash,
        of: macro.of,
        name: macro.name,
        ...(request.family === undefined ? {} : { family: request.family }),
        answer,
        reviewed: false,
        source,
      }),
    );
  }
  return stored;
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
 * What a service checks of a request before it stores its answers: that every definition's hash
 * is the SHA-256 of its text, and every macro's key the one its definitions give (`requestKey`).
 * It proves that a request's keys follow from the definitions it carries, and no more: not that
 * those are the document's, nor that its call sites are, since a request that carries upstream
 * Awesome-CV's definitions and any calls passes it and files its answers under Awesome-CV's keys
 * for every later import. So a service stores what a model answered as unreviewed
 * (`reviewed: false`), item 7 checks every answer it assembles against the document's own
 * reference, whoever gave it, and the service caps and rate-limits what one client may store.
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
