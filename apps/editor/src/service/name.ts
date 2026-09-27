/**
 * The naming service (milestone 3 item 10, plan section 6 step 4, decision 0028): `POST /v1/name`,
 * one handler written against the fetch API, which serves the route in every setting: the dev
 * server's middleware (`scripts/serve-naming.ts`) with item 9's file cache, and a Cloudflare Pages
 * Function (`functions/v1/name.ts`) with KV. It imports neither Node, nor Vite, nor the Workers
 * runtime: its host hands it a cache, a model or none, the client's address, a store for the rate
 * limit's buckets, the limits and a clock.
 *
 * A request is taken in this order: its method and its content type; its address's rate limit; its
 * body, read no further than the cap; the contract's schema; and `checkRequest`, so that no answer
 * is filed under a key its request's definitions do not give. Each macro with a key is looked up in
 * the cache by its key, and those it does not hold are asked of the model in one `name` call, as the
 * corpus runner asks them, and filed under their keys; with no model they are named as missing, so
 * that the editor locks them. The answer is decision 0024's `NamingAnswer`, with how many of its
 * answers came from the cache and from the model, and what is missing (`reply.ts`).
 *
 * Nothing of a request's text, nor of the model's, goes into a response or a log: refusals are
 * fixed sentences, the schema's problems are named by path in the schema's own words, a
 * `NamingError` becomes a status and a sentence in place of its message, and anything else is
 * logged by its class alone.
 */

import {
  type AnswerCache,
  answerFor,
  checkRequest,
  type ModelNaming,
  NAMING_VERSION,
  NamingRequest,
  type PreambleAnswer,
  type RequestMacro,
  type RequestProblem,
  type StoredAnswer,
  storedAnswersOf,
} from "@resume-tools/naming";
import {
  type NameOptions,
  NamingError,
  type NamingErrorReason,
  name,
  narrow,
} from "@resume-tools/naming/model";
import { addressKey, type RateLimits, type RateStore, take } from "./rate.ts";
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
}

/**
 * The limits by default: a megabyte a request, ten requests at once and a hundred a day an
 * address, and two minutes for the model.
 */
export const LIMITS: ServiceLimits = {
  bytes: 1_048_576,
  perMinute: 10,
  perDay: 100,
  modelMs: 120_000,
};

/** What the handler's host gives it. */
export interface NameDeps {
  /** Where answers are read and filed: item 9's file cache in development, KV on Pages. */
  cache: AnswerCache;
  /** The model asked for what the cache does not hold; with none, those are named as missing. */
  model: NameOptions["model"] | undefined;
  /** The client's address as the host reads it, which the rate limit keeps its buckets by. */
  address: string | undefined;
  /** Where each address's buckets are kept. */
  rates: RateStore;
  limits: ServiceLimits;
  /** The time, in milliseconds since the epoch. */
  now: () => number;
  /** Told a line when something fails that is not the request's doing; never a request's text. */
  log?: (line: string) => void;
}

/** What each refusal says, whatever the request held. */
const SAYS = {
  method: "The naming route takes a POST.",
  type: "The naming route takes a request sent as application/json.",
  rate: "Too many naming requests from this address: try again after the seconds Retry-After gives.",
  large: "The request is larger than the naming route takes.",
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

/** An error as a log line names it: its class, when that is a plain name, and nothing it says. */
const kindOf = (error: unknown) =>
  error instanceof Error && /^[A-Za-z]{1,64}$/.test(error.name) ? error.name : "an error";

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

/** A macro of the request that the naming step answers: one with a key. */
type Keyed = RequestMacro & { key: string };

/**
 * A checked request answered: each macro with a key from the cache, then those it does not hold
 * from the model in one call, filed under their keys, one answer to a key, the first the model
 * gives, as a later hit would give it; with no model they are missing.
 */
async function answer(request: NamingRequest, deps: NameDeps): Promise<Response> {
  const keyed = request.macros.filter((macro): macro is Keyed => macro.key !== undefined);
  const keys = [...new Set(keyed.map((macro) => macro.key))];
  const held = await Promise.all(keys.map((key) => answerFor(deps.cache, key)));
  const answers = new Map<string, StoredAnswer>();
  keys.forEach((key, i) => {
    const found = held[i];
    if (found !== undefined) answers.set(key, found);
  });
  const misses = keyed.filter((macro) => !answers.has(macro.key));
  const hits = keyed.length - misses.length;
  let preamble: PreambleAnswer = { parameters: [] };
  let asked = 0;
  if (misses.length > 0 && deps.model !== undefined) {
    const part = narrow(request, misses);
    let naming: ModelNaming;
    try {
      naming = await name(part, {
        model: deps.model,
        abortSignal: AbortSignal.timeout(deps.limits.modelMs),
        ...(deps.limits.budget === undefined ? {} : { budget: deps.limits.budget }),
      });
    } catch (error) {
      if (!(error instanceof NamingError)) throw error;
      const { status, says } = MODEL_ERRORS[error.reason];
      return refuse(status, says);
    }
    asked = misses.length;
    preamble = naming.preamble;
    const filed: StoredAnswer[] = [];
    for (const each of await storedAnswersOf(part, naming, `model:${deps.model.modelId}`)) {
      if (answers.has(each.key)) continue;
      answers.set(each.key, each);
      filed.push(each);
    }
    // An answer the cache could not file is still given: the next request asks for it again.
    await Promise.all(
      filed.map(async (each) => {
        try {
          await deps.cache.put(each.key, each);
        } catch (error) {
          deps.log?.(`The naming service could not file an answer: ${kindOf(error)}.`);
        }
      }),
    );
  }
  const macros: StoredAnswer[] = [];
  const missing: MissingMacro[] = [];
  const given = new Set<string>();
  for (const macro of keyed) {
    const found = answers.get(macro.key);
    if (found === undefined) missing.push({ of: macro.of, name: macro.name, key: macro.key });
    else if (!given.has(macro.key)) {
      given.add(macro.key);
      macros.push(found);
    }
  }
  return json(200, { version: NAMING_VERSION, macros, preamble, hits, asked, missing });
}

/** A request taken past its method and content type: the rate limit, the body, the checks. */
async function received(request: Request, deps: NameDeps): Promise<Response> {
  const decision = await take(deps.rates, addressKey(deps.address), deps.now(), deps.limits);
  if (!decision.allowed)
    return refuse(429, SAYS.rate, undefined, { "Retry-After": String(decision.retryAfter) });
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
  return answer(parsed.data, deps);
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
    deps.log?.(`The naming service failed: ${kindOf(error)}.`);
    return refuse(500, SAYS.failed);
  }
}
