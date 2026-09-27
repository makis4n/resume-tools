/**
 * Reading and filing the naming step's cache (milestone 3 items 6 and 9, decisions 0024 and 0027),
 * and checking a request's keys. A cache is anything that gives back what was put under a key: the
 * committed answers under `corpus/answers/`, the runner's ignored folder, the service's KV (item
 * 10). What it gives back is not trusted: `answerFor` returns an answer only when it is a stored
 * answer this version reads, given under the key asked for, and, asked for a document's macro, one
 * that fits it. What goes in is checked the same way (`storable`), and a model's answer becomes
 * stored answers only through `storedAnswersOf`, by the keys the request's own definitions give.
 */

import { type ListAnswer, type ModelNaming, type PartnerKeys, StoredAnswer } from "./answer.ts";
import { type Dependency, keyOf, NAMING_VERSION, sha256 } from "./key.ts";
import type { NamingRequest, RequestMacro } from "./request.ts";

/**
 * A cache of stored answers by key: `get` gives back a stored answer, its JSON, or nothing; `put`
 * files one under its key, and refuses anything that is not a stored answer under its own key. A
 * cache that files only under a key that holds nothing, as the editor's do (decision 0028), says
 * whether it filed: false when the key held an answer already.
 */
export interface AnswerCache {
  get(key: string): unknown | Promise<unknown>;
  put(key: string, answer: StoredAnswer): void | boolean | Promise<void | boolean>;
}

/**
 * The macro of a document an answer is asked for: its name, whether a command or an environment,
 * and the keys of its request's macros, by name, among which its list's partners are found.
 */
export interface AskingMacro {
  name: string;
  of: "command" | "environment";
  partners: ReadonlyMap<string, string>;
  /**
   * Whether a partner no macro of the request is by key may be found by the name the answer gives
   * it, as a fork whose list's closer is another's definition keeps the list's names (decision
   * 0028): so unless false. The seed's check of its own files, whose partners' keys it writes,
   * passes false.
   */
  byName?: boolean;
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
 * holds for it (`partnerKeys`) among the request's macros, and named as the request names it, or,
 * where no macro of the request has that key, by the name the answer gives it (decision 0028). An
 * answer whose kind is not the macro's, or whose partner the request has no macro of by key or by
 * name, or holds no key for, is refused (`RefusedAnswer`): a fork that renames a list's two macros
 * keeps their answers, and so does a fork that keeps their names and makes the closer a bare
 * `\end{itemize}`; a template whose list's opener has another template's definition, and whose
 * closer has neither the definition nor the name of that list's closer, does not take its pairing.
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
    if (partner === undefined) return { answer: undefined, reason: "partner" };
    const names = [...macro.partners].flatMap(([name, each]) => (each === partner ? [name] : []));
    if (names.length > 0)
      // Two macros of one key have one definition: the one of the answer's name, where the request
      // has it, else the first.
      paired[which] = names.includes(named) ? named : (names[0] ?? named);
    // No macro of the request has the partner's key: a macro of the partner's name is it, as a
    // fork that changed the list's closer calls it still.
    else if (macro.byName !== false && macro.partners.has(named)) paired[which] = named;
    else return { answer: undefined, reason: "partner" };
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

/** A macro of a request, as what cannot be filed names it: its name, and its kind. */
export type FilingMacro = Pick<RequestMacro, "of" | "name">;

/**
 * What a model's answer to a request files: one stored answer a key, and what it leaves unfiled.
 * A key leaves the name out, so two macros of one definition and closure share one, and one file
 * serves both (decision 0024): their answers are filed once where they agree, and not at all where
 * they do not, since whichever were filed would be served to the other.
 */
export interface Filing {
  /** One stored answer for each key whose macros' answers agree, the first macro's by name. */
  answers: StoredAnswer[];
  /**
   * Each macro's own stored answer, named for it, in the request's order, whether its key's is
   * filed or not: what a caller that gives every macro its answer gives back (decision 0028).
   */
  answered: StoredAnswer[];
  /** The keys whose macros the model answered otherwise, each with its macros: none is filed. */
  conflicts: { key: string; macros: FilingMacro[] }[];
  /** The macros whose list names a partner no command of the request is: not filed. */
  invalid: FilingMacro[];
}

/**
 * A stored answer as answers under one key are compared: all of it but its name and the names its
 * list gives its partners, which may differ where the partners are one definition, as the partners'
 * keys, which are compared, say (`partnerKeys`); in an order of its own, so that the order its
 * fields were written in does not count.
 */
function comparable(stored: StoredAnswer): string {
  const { name: _name, answer, ...rest } = stored;
  const list =
    answer.list === undefined
      ? undefined
      : { ...answer.list, closedBy: undefined, openedBy: undefined };
  return JSON.stringify({ ...rest, answer: { ...answer, list } }, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  );
}

/**
 * The stored answers a model's answer to a request files (`Filing`): for each macro of the request
 * that has a key and an answer, by its name and whether a command or an environment, a stored
 * answer under the key its definitions give (`requestKey`), with its own definition's hash, the
 * dependencies its key is computed from, its name, the request's family, the answer, the keys of
 * the partners its list names, each a command of the request found by its name, `reviewed: false`,
 * and the model's id as its source (`answered`); then one a key, where the answers under it agree.
 * What the model answered of anything else, and the preamble's answer, which no key files, are
 * left out. It stores nothing: the caller files them, after `checkRequest` (decision 0024), and asks
 * the model again for the macros it cannot.
 */
export async function storedAnswersOf(
  request: NamingRequest,
  naming: ModelNaming,
  source: `model:${string}`,
): Promise<Filing> {
  const definitions = new Map(request.definitions.map((each) => [each.name, each]));
  const answers = new Map(naming.macros.map((each) => [`${each.of}|${each.name}`, each.answer]));
  // A list's partners are the request's commands, found by their keys (decision 0024).
  const commands = new Map<string, string>();
  for (const macro of request.macros) {
    const key = macro.of === "command" ? await requestKey(request, macro) : undefined;
    if (key !== undefined) commands.set(macro.name, key);
  }
  const byKey = new Map<string, { macros: FilingMacro[]; stored: StoredAnswer[] }>();
  const answered: StoredAnswer[] = [];
  const invalid: FilingMacro[] = [];
  for (const macro of request.macros) {
    const answer = answers.get(`${macro.of}|${macro.name}`);
    const own = definitions.get(macro.name);
    const key = await requestKey(request, macro);
    if (answer === undefined || own?.kind !== "definition" || key === undefined) continue;
    const partnerKeys: PartnerKeys = {};
    let partnerless = false;
    for (const which of ["closedBy", "openedBy"] as const) {
      const named = answer.list?.[which];
      if (named === undefined) continue;
      const partner = commands.get(named);
      if (partner === undefined) partnerless = true;
      else partnerKeys[which] = partner;
    }
    if (partnerless) {
      invalid.push({ of: macro.of, name: macro.name });
      continue;
    }
    const stored = StoredAnswer.parse({
      version: request.version,
      key,
      hash: own.hash,
      of: macro.of,
      name: macro.name,
      ...(request.family === undefined ? {} : { family: request.family }),
      answer,
      reviewed: false,
      source,
      dependencies: dependenciesOf(request, macro),
      ...(Object.keys(partnerKeys).length === 0 ? {} : { partnerKeys }),
    });
    answered.push(stored);
    const group = byKey.get(key) ?? { macros: [], stored: [] };
    group.macros.push({ of: macro.of, name: macro.name });
    group.stored.push(stored);
    byKey.set(key, group);
  }
  const filing: Filing = { answers: [], answered, conflicts: [], invalid };
  for (const [key, group] of byKey) {
    const [first] = group.stored;
    if (first === undefined) continue;
    const agreed = comparable(first);
    if (group.stored.every((each) => comparable(each) === agreed)) filing.answers.push(first);
    else filing.conflicts.push({ key, macros: group.macros });
  }
  return filing;
}

/**
 * The dependencies a request macro's key is computed from: its closure's definitions that are
 * code, each by its name and hash, in the closure's order, data left out (`keyOf`).
 */
function dependenciesOf(
  request: Pick<NamingRequest, "definitions">,
  macro: Pick<RequestMacro, "dependencies">,
): Dependency[] {
  const definitions = new Map(request.definitions.map((each) => [each.name, each]));
  return macro.dependencies.flatMap((name) => {
    const found = definitions.get(name);
    return found?.kind === "data" ? [] : [[name, found?.hash ?? null] as const];
  });
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
  const own = request.definitions.find((each) => each.name === macro.name);
  if (own?.kind !== "definition") return undefined;
  return keyOf(request.version, own.hash, dependenciesOf(request, macro));
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
