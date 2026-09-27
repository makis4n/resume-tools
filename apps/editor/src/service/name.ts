/**
 * The naming service (milestone 3 item 10, plan section 6 step 4, decision 0028): `POST /v1/name`,
 * one handler written against the fetch API, which serves the route in every setting: the dev
 * server's middleware (`scripts/serve-naming.ts`) with item 9's file cache, and a Cloudflare Pages
 * Function (`functions/v1/name.ts`) with KV. It imports neither Node, nor Vite, nor the Workers
 * runtime: its host hands it a cache for answers and one for preambles' answers, a model or none,
 * the client's address, a store for the rate limit's buckets, the limits and a clock.
 *
 * A request is taken in this order: its method and its content type; its address's rate limit; its
 * body, read no further than the cap; the contract's schema; and `checkRequest`, so that no answer
 * is filed under a key its request's definitions do not give. Each macro with a key is asked of the
 * cache as that macro (`answerFor`), so that an answer another macro filed under the key is given
 * under this one's name, or refused when it is another kind's or pairs a list the request has not;
 * the rest are asked of the model, in at most four parts and 400,000 characters, and filed as each
 * part validates, one answer a key and never over what a key holds. With no model they are named
 * as missing, so that the editor locks them. The reply gives each macro of the request its own
 * answer, named for it, since item 7 assembles by name (`reply.ts`).
 *
 * Nothing of a request's text, nor of the model's, goes into a response or a log: refusals are
 * fixed sentences, the schema's problems are named by path in the schema's own words, a
 * `NamingError` becomes a status and a sentence in place of its message, and anything else is
 * logged by its class alone; a filing is logged by its key alone.
 */

import {
  answerFor,
  checkRequest,
  type ModelNaming,
  NAMING_VERSION,
  NamingRequest,
  type PreambleAnswer,
  type RequestMacro,
  type RequestProblem,
  type StoredAnswer,
  sha256,
  storedAnswersOf,
} from "@resume-tools/naming";
import {
  type NameOptions,
  NamingError,
  type NamingErrorReason,
  name,
  narrow,
} from "@resume-tools/naming/model";
import {
  asksPreamble,
  type PreambleCache,
  preambleFrom,
  preambleKey,
  type StoredPreamble,
} from "./preamble.ts";
import { addressKey, classOf, type RateLimits, type RateStore, spend, take } from "./rate.ts";
import type { MissingMacro, NamingRefusal, NamingReply } from "./reply.ts";

/** The route the service answers, on the editor's own origin. */
export const ROUTE = "/v1/name";

/** What the service takes of a request and an address. */
export interface ServiceLimits extends RateLimits {
  /** The most bytes a request's body may hold. */
  bytes: number;
  /** How long the model may take over a request, its parts and their retries together, in ms. */
  modelMs: number;
  /** The most characters one call's prompt may hold; the naming module's own budget when unset. */
  budget?: number;
  /** The most parts a request's misses may be asked in. */
  parts: number;
  /** The most characters the prompts of a request's parts may hold together. */
  chars: number;
}

/**
 * The limits by default: a megabyte a request; ten requests at once, a hundred a day and two
 * million characters of prompts a day an address; four parts and 400,000 characters a request;
 * and two minutes for the model.
 */
export const LIMITS: ServiceLimits = {
  bytes: 1_048_576,
  perMinute: 10,
  perDay: 100,
  charsPerDay: 2_000_000,
  modelMs: 120_000,
  parts: 4,
  chars: 400_000,
};

/** How many times the AI SDK tries a failed call again for the service: once, where its own is twice. */
export const MAX_RETRIES = 1;

/**
 * Who filed an answer, and when, which a cache may keep beside it (KV's metadata): the time as ISO
 * 8601, the model's id, and the SHA-256 of the filing address's key (`addressKey`), never the
 * address, so that a bad batch can be found by any of them and removed.
 */
export interface Provenance {
  filedAt: string;
  model: string;
  by: string;
}

/**
 * The service's cache of answers, by key (`AnswerCache`): `get` gives back what a key holds, and
 * `put` files an answer only under a key that holds nothing, with who filed it where the cache
 * keeps that, and says whether it filed.
 */
export interface ServiceCache {
  get(key: string): unknown | Promise<unknown>;
  put(key: string, answer: StoredAnswer, provenance?: Provenance): boolean | Promise<boolean>;
}

/** What the handler's host gives it. */
export interface NameDeps {
  /** Where answers are read and filed: item 9's file cache in development, KV on Pages. */
  cache: ServiceCache;
  /** Where the preambles' answers are read and filed: memory in development, KV on Pages. */
  preambles: PreambleCache;
  /** The model asked for what the cache does not hold; with none, those are named as missing. */
  model: NameOptions["model"] | undefined;
  /** The client's address as the host reads it, which the rate limit keeps its buckets by. */
  address: string | undefined;
  /** Where each address's buckets are kept. */
  rates: RateStore;
  limits: ServiceLimits;
  /** The time, in milliseconds since the epoch. */
  now: () => number;
  /**
   * Told a line when an answer is filed, by its key alone, and when something fails that is not
   * the request's doing, by its class alone; never a request's text, nor an address.
   */
  log?: (line: string, level: "info" | "warn") => void;
}

/** What each refusal says, whatever the request held. */
const SAYS = {
  method: "The naming route takes a POST.",
  type: "The naming route takes a request sent as application/json.",
  rate: "Too many naming requests from this address: try again after the seconds Retry-After gives.",
  large: "The request is larger than the naming route takes.",
  template: "The template is too large to name here.",
  text: "The request is not UTF-8 text.",
  json: "The request is not JSON.",
  schema: "The request is not a naming request this service reads.",
  keys: "The request's hashes or keys do not follow from its definitions.",
  failed: "The naming service failed.",
} as const;

/** What each `NamingError` becomes: a status, and a sentence in place of its message. */
const MODEL_ERRORS: Readonly<Record<NamingErrorReason, { status: number; says: string }>> = {
  provider: {
    status: 502,
    says: "The naming model could not be reached, or did not answer in time.",
  },
  invalid: { status: 422, says: "The naming model's answer did not validate." },
  refused: { status: 422, says: "The naming model gave no answer." },
  budget: { status: 413, says: "The request is too large for the naming model to answer." },
};

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(
  status: number,
  body: NamingReply | NamingRefusal,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...headers } });
}

function refuse(
  status: number,
  error: string,
  problems?: string[],
  headers?: Record<string, string>,
): Response {
  return json(status, problems === undefined ? { error } : { error, problems }, headers);
}

/** Whether a Content-Type names JSON, with or without parameters. */
const isJson = (type: string | null) =>
  type !== null && /^application\/json\s*(?:;|$)/i.test(type.trim());

/** The most problems a refusal lists. */
const PROBLEMS = 20;

/**
 * The schema's problems as lines: where each is, by the contract's field names and the places of
 * items in its lists, and what is wrong, in the schema's own words, which quote no value of the
 * request's but the names of fields the contract has not, which are left out.
 */
function problemsOf(
  issues: readonly { code: string; path: readonly PropertyKey[]; message: string }[],
): string[] {
  const lines = issues.slice(0, PROBLEMS).map((issue) => {
    const where = issue.path.length === 0 ? "the request" : issue.path.map(String).join(".");
    const what =
      issue.code === "unrecognized_keys"
        ? "holds a field the contract does not have"
        : issue.message;
    return `${where}: ${what}`;
  });
  if (issues.length > PROBLEMS) lines.push(`and ${issues.length - PROBLEMS} more`);
  return lines;
}

/** What `checkRequest` found, counted by kind. */
function keyProblems(problems: readonly RequestProblem[]): string[] {
  const hashes = problems.filter((each) => each.problem === "hash").length;
  const keys = problems.length - hashes;
  const lines: string[] = [];
  if (hashes > 0)
    lines.push(
      hashes === 1
        ? "1 definition's hash is not the SHA-256 of its text"
        : `${hashes} definitions' hashes are not the SHA-256 of their texts`,
    );
  if (keys > 0)
    lines.push(
      keys === 1
        ? "1 macro's key is not the one its definitions give"
        : `${keys} macros' keys are not the ones their definitions give`,
    );
  return lines;
}

/**
 * A request's body, or undefined when it holds more than `cap` bytes: refused by its declared
 * length before a byte is read, and otherwise as soon as what has arrived passes the cap, the rest
 * left unread.
 */
async function readCapped(request: Request, cap: number): Promise<Uint8Array | undefined> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > cap) {
    await request.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/**
 * Whether this process has said that the rate limit's store failed. A store that fails lets every
 * request through uncounted, which the process says once, by the error's class, and never again,
 * so that a spent quota does not write a line a request.
 */
let rateStoreFailed = false;

function rateFailed(deps: NameDeps, failed: string) {
  if (rateStoreFailed) return;
  rateStoreFailed = true;
  deps.log?.(
    `The naming route's rate limit could not use its store (${failed}): requests go on uncounted.`,
    "warn",
  );
}

/** A macro of the request that the naming step answers: one with a key. */
type Keyed = RequestMacro & { key: string };

/** A macro's identity: whether a command or an environment, and its name. */
const identity = (macro: { of: string; name: string }) => `${macro.of}|${macro.name}`;

/** A cache read once a key for a request: twins' second look is the first's. */
function readOnce(cache: Pick<ServiceCache, "get">): Pick<ServiceCache, "get"> {
  const reads = new Map<string, Promise<unknown>>();
  return {
    get(key) {
      let read = reads.get(key);
      if (read === undefined) {
        read = Promise.resolve(cache.get(key));
        reads.set(key, read);
      }
      return read;
    },
  };
}

/** An answer filed, logged by its key alone; one the cache fails to file is still given. */
async function fileAnswer(deps: NameDeps, stored: StoredAnswer, provenance: Provenance) {
  try {
    if (await deps.cache.put(stored.key, stored, provenance))
      deps.log?.(`The naming service filed an answer under ${stored.key}.`, "info");
  } catch (error) {
    deps.log?.(`The naming service could not file an answer: ${classOf(error)}.`, "warn");
  }
}

/** A preamble's answer filed as an answer is. */
async function filePreamble(
  deps: NameDeps,
  key: string,
  preamble: PreambleAnswer,
  provenance: Provenance,
) {
  try {
    const stored: StoredPreamble = {
      version: NAMING_VERSION,
      key,
      source: `model:${provenance.model}`,
      preamble,
    };
    if (await deps.preambles.put(key, stored, provenance))
      deps.log?.(`The naming service filed a preamble's answer under ${key}.`, "info");
  } catch (error) {
    deps.log?.(`The naming service could not file a preamble's answer: ${classOf(error)}.`, "warn");
  }
}

/** What the model gave a request: each macro's own answer, the preamble's, and what it counted. */
interface Asked {
  answers: Map<string, StoredAnswer>;
  preamble: PreambleAnswer;
  asked: number;
  conflicts: number;
}

/** What the model is asked for a request: its misses, or none and the preamble alone. */
interface Asking {
  request: NamingRequest;
  misses: Keyed[];
  /** The request's commands' keys, by name, among which a list's partners are. */
  partners: ReadonlyMap<string, string>;
  /** The keys whose answer the cache holds for another macro: never filed over. */
  taken: ReadonlySet<string>;
  /** The key the preamble's answer is filed under, where the request's preamble asks one. */
  preambleAt: string | undefined;
  /** The address's key, which the characters sent are taken from. */
  address: string;
}

/**
 * The model asked for a request's misses, or for its preamble alone, in at most `limits.parts`
 * parts and `limits.chars` characters, which it refuses before any call. Each part is filed as it
 * validates: its macros' answers, a key once all its macros are answered and agree, never under a
 * key the cache holds another macro's answer under, and the preamble's with the part that asks it;
 * and the characters its calls sent are taken from the address's day. Every macro asked is then
 * given its own answer, whatever was filed. What fails is the `NamingError` that says why.
 */
async function askModel(
  asking: Asking,
  model: NameOptions["model"],
  deps: NameDeps,
): Promise<Asked | NamingError> {
  const { request, misses, taken, preambleAt } = asking;
  const source = `model:${model.modelId}` as const;
  const by = await sha256(asking.address);
  // The macros asked by key, so that the answers of macros that share one are filed together.
  const byKey = new Map<string, Keyed[]>();
  for (const macro of misses) byKey.set(macro.key, [...(byKey.get(macro.key) ?? []), macro]);
  const told = new Map<string, ModelNaming["macros"][number]>();
  const decided = new Set<string>();
  let conflicts = 0;
  // The characters the calls sent, not yet taken from the address's day.
  let sent = 0;
  const charge = async () => {
    const failed = await spend(deps.rates, asking.address, sent, deps.now(), deps.limits);
    sent = 0;
    if (failed !== undefined) rateFailed(deps, failed);
  };
  const file = async (macros: ModelNaming["macros"], preamble: PreambleAnswer | undefined) => {
    await charge();
    const provenance = { filedAt: new Date(deps.now()).toISOString(), model: model.modelId, by };
    for (const each of macros) told.set(identity(each), each);
    const ready = [...byKey].filter(
      ([key, group]) => !decided.has(key) && group.every((macro) => told.has(identity(macro))),
    );
    for (const [key] of ready) decided.add(key);
    const filing = await storedAnswersOf(
      request,
      {
        macros: ready.flatMap(([, group]) =>
          group.flatMap((macro) => {
            const answer = told.get(identity(macro));
            return answer === undefined ? [] : [answer];
          }),
        ),
        preamble: { parameters: [] },
      },
      source,
    );
    // A key the cache holds another macro's answer under is never filed over, and counts, as a key
    // whose macros the model answered otherwise does, as a conflict.
    const filed = filing.answers.filter((each) => !taken.has(each.key));
    conflicts += filing.conflicts.length + filing.answers.length - filed.length;
    await Promise.all(filed.map((each) => fileAnswer(deps, each, provenance)));
    if (preamble !== undefined && preambleAt !== undefined)
      await filePreamble(deps, preambleAt, preamble, provenance);
  };
  let naming: ModelNaming;
  try {
    naming = await name(narrow(request, misses), {
      model,
      abortSignal: AbortSignal.timeout(deps.limits.modelMs),
      maxRetries: MAX_RETRIES,
      maxParts: deps.limits.parts,
      maxChars: deps.limits.chars,
      partners: [...asking.partners.keys()],
      onCall: (_, chars) => {
        sent += chars;
      },
      onPart: file,
      ...(deps.limits.budget === undefined ? {} : { budget: deps.limits.budget }),
    });
  } catch (error) {
    await charge();
    if (error instanceof NamingError) return error;
    throw error;
  }
  await charge();
  // Each macro asked has its own answer, named for it, filed or not (decision 0028).
  const { answered } = await storedAnswersOf(request, naming, source);
  return {
    answers: new Map(answered.map((each) => [identity(each), each])),
    preamble: naming.preamble,
    asked: misses.length,
    conflicts,
  };
}

/**
 * A checked request answered: each macro with a key from the cache, asked as that macro, then
 * those it does not hold, or holds another macro's answer for, from the model, or the preamble
 * alone when every macro hits and its answer is not kept; with no model the misses are missing.
 * The reply gives each macro its own answer, named for it, and the preamble's.
 */
async function answer(request: NamingRequest, deps: NameDeps, address: string): Promise<Response> {
  const keyed = request.macros.filter((macro): macro is Keyed => macro.key !== undefined);
  // A list's partners are the request's commands, found by their keys (decision 0024), or by the
  // names the answer gives them where no command has the key (decision 0028).
  const partners = new Map(
    keyed.flatMap((macro) => (macro.of === "command" ? [[macro.name, macro.key] as const] : [])),
  );
  const cache = readOnce(deps.cache);
  const answers = new Map<string, StoredAnswer>();
  const taken = new Set<string>();
  const misses: Keyed[] = [];
  let hits = 0;
  for (const macro of keyed) {
    const found = await answerFor(cache, macro.key, { name: macro.name, of: macro.of, partners });
    if (found === undefined) misses.push(macro);
    else if (found.answer === undefined) {
      taken.add(macro.key);
      misses.push(macro);
    } else {
      hits++;
      answers.set(identity(macro), found);
    }
  }
  const preambleAt = asksPreamble(request) ? await preambleKey(request) : undefined;
  const model = deps.model;
  let preamble: PreambleAnswer | undefined;
  // The preamble's answer kept, where the model is not to be asked the misses, which it answers
  // with.
  if (preambleAt !== undefined && (misses.length === 0 || model === undefined))
    preamble = preambleFrom(await deps.preambles.get(preambleAt), preambleAt, request);
  let asked = 0;
  let conflicts = 0;
  if (model !== undefined && (misses.length > 0 || (preambleAt !== undefined && !preamble))) {
    const got = await askModel(
      { request, misses, partners, taken, preambleAt, address },
      model,
      deps,
    );
    if (got instanceof NamingError) {
      // Asked for the preamble alone, the model's failure leaves the reply without its answer;
      // asked for macros, it is the reply.
      if (misses.length > 0) {
        if (got.reason === "budget" && got.part === undefined) return refuse(413, SAYS.template);
        const { status, says } = MODEL_ERRORS[got.reason];
        return refuse(status, says);
      }
      deps.log?.(
        `The naming service answered without a preamble's answer: the model's step failed (${got.reason}).`,
        "warn",
      );
    } else {
      for (const [id, each] of got.answers) if (!answers.has(id)) answers.set(id, each);
      preamble = got.preamble;
      asked = got.asked;
      conflicts = got.conflicts;
    }
  }
  const macros: StoredAnswer[] = [];
  const missing: MissingMacro[] = [];
  for (const macro of keyed) {
    const found = answers.get(identity(macro));
    if (found === undefined) missing.push({ of: macro.of, name: macro.name, key: macro.key });
    else macros.push(found);
  }
  return json(200, {
    version: NAMING_VERSION,
    macros,
    preamble: preamble ?? { parameters: [] },
    hits,
    asked,
    conflicts,
    missing,
  });
}

/** A request taken past its method and content type: the rate limit, the body, the checks. */
async function received(request: Request, deps: NameDeps): Promise<Response> {
  const address = addressKey(deps.address);
  const decision = await take(deps.rates, address, deps.now(), deps.limits);
  if (!decision.allowed)
    return refuse(429, SAYS.rate, undefined, { "Retry-After": String(decision.retryAfter) });
  if (decision.failed !== undefined) rateFailed(deps, decision.failed);
  const body = await readCapped(request, deps.limits.bytes);
  if (body === undefined) return refuse(413, SAYS.large);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body);
  } catch {
    return refuse(400, SAYS.text);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return refuse(400, SAYS.json);
  }
  const parsed = NamingRequest.safeParse(value);
  if (!parsed.success) return refuse(400, SAYS.schema, problemsOf(parsed.error.issues));
  const problems = await checkRequest(parsed.data);
  if (problems.length > 0) return refuse(400, SAYS.keys, keyProblems(problems));
  return answer(parsed.data, deps, address);
}

/**
 * `POST /v1/name`: a naming request answered, as `NamingReply`, or refused with a status and a
 * sentence (decision 0028 lists them). It never throws: what fails that is not the request's doing
 * is a 500, logged by the error's class alone.
 */
export async function handleName(request: Request, deps: NameDeps): Promise<Response> {
  if (request.method !== "POST") return refuse(405, SAYS.method, undefined, { Allow: "POST" });
  if (!isJson(request.headers.get("content-type"))) return refuse(415, SAYS.type);
  try {
    return await received(request, deps);
  } catch (error) {
    deps.log?.(`The naming service failed: ${classOf(error)}.`, "warn");
    return refuse(500, SAYS.failed);
  }
}
