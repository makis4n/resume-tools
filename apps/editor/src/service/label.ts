/**
 * The reading service's route that labels a PDF's lines (milestone 3 second pass, item 13):
 * `POST /v1/label`, one handler written against the fetch API, which the dev server's middleware
 * (`scripts/serve-label.ts`) and a Cloudflare Pages Function (`functions/v1/label.ts`) both serve,
 * as the first pass's naming service's was (decision 0028). It imports neither Node, nor Vite, nor
 * the Workers runtime: its host hands it the model or none, the client's address, a store for the
 * rate limit's buckets, the limits, a clock and a log.
 *
 * A request is taken in this order: its method and its content type; its address's rate limit,
 * looked at; its body, read no further than the cap; the contract's schema (`LabelRequest`); the
 * request counted, with the characters its prompt will send, in one write; then one call to the
 * model, stopped at `limits.modelMs`, whose reply is checked (`rolesOf`) before it is given back as
 * `LabelReply`.
 *
 * It is the first route built under the privacy rule of decision 0047: the person agreed to send
 * the lines, and the service keeps none of them. It has no cache, so nothing it is sent or the
 * model says is written anywhere; the rate limit's store holds an address's counts and nothing
 * else; and nothing of a request's text, nor of the model's, goes into a response or a log:
 * refusals are fixed sentences, the schema's problems are named by path in the schema's own
 * words, and a failure is logged by its kind or its class alone.
 */

import type { LanguageModel } from "ai";
import type { Features } from "../pdf/roles.ts";
import { type LabelRefusal, type LabelReply, LabelRequest } from "./label-contract.ts";
import { askRoles, INSTRUCTIONS, promptOf } from "./label-model.ts";
import { addressKey, classOf, peek, type RateLimits, type RateStore, take } from "./rate.ts";

export { LABEL_ROUTE } from "./label-contract.ts";

/** What the route takes of a request and an address. */
export interface LabelLimits extends RateLimits {
  /** The most bytes a request's body may hold. */
  bytes: number;
  /** How long the model may take over a request, in ms: under the page's own budget of 15 s. */
  modelMs: number;
}

/**
 * The limits by default: 512 KiB a request; ten requests at once, a hundred a day and two million
 * characters of prompts a day an address; and 14 s for the model, so that the route answers
 * before the page's 15 s budget runs out and the page's rules stand in.
 */
export const LABEL_LIMITS: LabelLimits = {
  bytes: 524_288,
  perMinute: 10,
  perDay: 100,
  charsPerDay: 2_000_000,
  modelMs: 14_000,
};

/** What the route's host gives it. */
export interface LabelDeps {
  /** The model asked; with none, the route refuses with 503 and the page's rules read the PDF. */
  model: Exclude<LanguageModel, string> | undefined;
  /** The client's address as the host reads it, which the rate limit keeps its buckets by. */
  address: string | undefined;
  /** Where each address's buckets are kept: counts and times, never a request's text. */
  rates: RateStore;
  limits: LabelLimits;
  /** The time, in milliseconds since the epoch. */
  now: () => number;
  /**
   * Told a line when something fails that is not the request's doing, by its kind or its class
   * alone: never a request's text, nor the model's, nor an address.
   */
  log?: (line: string, level: "info" | "warn") => void;
}

/** What each refusal says, whatever the request held. */
export const LABEL_SAYS = {
  method: "The label route takes a POST.",
  type: "The label route takes a request sent as application/json.",
  rate: "Too many requests to read a PDF from this address: try again after the seconds Retry-After gives.",
  uncounted:
    "The reading service could not count this request: try again after the seconds Retry-After gives.",
  large: "The request is larger than the label route takes.",
  text: "The request is not UTF-8 text.",
  json: "The request is not JSON.",
  schema: "The request is not a label request this service reads.",
  none: "The reading service has no model to ask.",
  invalid: "The reading model's answer was not one role for each line.",
  provider: "The reading model could not be reached.",
  timeout: "The reading model did not answer in time.",
  failed: "The reading service failed.",
} as const;

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(
  status: number,
  body: LabelReply | LabelRefusal,
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
 * request's. A field the contract has not is named by its place alone.
 */
function problemsOf(
  issues: readonly { code: string; path: readonly PropertyKey[]; message: string }[],
): string[] {
  const lines = issues.slice(0, PROBLEMS).map((issue) => {
    const where = issue.path.length === 0 ? "the request" : issue.path.map(String).join(".");
    const what =
      issue.code === "unrecognized_keys"
        ? "holds a field the contract does not have"
        : issue.code === "invalid_value"
          ? "is not one of the values the contract allows"
          : issue.message;
    return `${where}: ${what}`;
  });
  if (issues.length > PROBLEMS) lines.push(`and ${issues.length - PROBLEMS} more`);
  return lines;
}

/**
 * A request's body, or undefined when it holds more than `cap` bytes: refused by its declared
 * length before a byte is read, and otherwise as soon as what has arrived passes the cap.
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
 * Whether this process has said that the rate limit's store failed: said once, by class. Unlike the
 * first pass's naming route, the label route fails closed: a request it cannot count is refused
 * with 429 and the model is not asked, since on KV a write refused within a second would otherwise
 * let a burst through uncounted (item 13's review).
 */
let rateStoreFailed = false;

function rateFailed(deps: LabelDeps, failed: string) {
  if (rateStoreFailed) return;
  rateStoreFailed = true;
  deps.log?.(
    `The label route's rate limit could not use its store (${failed}): requests it cannot count are refused.`,
    "warn",
  );
}

/** A refusal for an address past its limits, with the seconds it may try again after. */
const tooMany = (retryAfter: number) =>
  refuse(429, LABEL_SAYS.rate, undefined, { "Retry-After": String(retryAfter) });

/** A refusal for a request the rate limit could not count: try again in a second. */
const uncounted = () => refuse(429, LABEL_SAYS.uncounted, undefined, { "Retry-After": "1" });

/** A checked request asked of the model: its roles, or a refusal that says why there are none. */
async function answer(
  lines: readonly Features[],
  model: Exclude<LanguageModel, string>,
  deps: LabelDeps,
): Promise<Response> {
  const asked = await askRoles(lines, model, AbortSignal.timeout(deps.limits.modelMs));
  if ("roles" in asked) return json(200, { roles: asked.roles });
  deps.log?.(`The label route's model gave no roles (${asked.failure}).`, "warn");
  if (asked.failure === "timeout") return refuse(504, LABEL_SAYS.timeout);
  if (asked.failure === "provider") return refuse(502, LABEL_SAYS.provider);
  return refuse(422, LABEL_SAYS.invalid);
}

/**
 * A request taken past its method and content type. Its address's buckets are looked at first, and
 * an address past its limits is refused before its body is read; then the body and the checks; and
 * then the request is counted, in one write of its address's buckets: a token from each request
 * bucket, and, for a request the model will be asked, the characters its prompt will send. One
 * write a request, since KV refuses a second write to a key within a second, which once left the
 * characters uncounted (item 13's review). A refused request is counted too, with no characters.
 * A request the store cannot count is refused with 429, and the model is not asked: fail closed.
 */
async function received(request: Request, deps: LabelDeps): Promise<Response> {
  const address = addressKey(deps.address);
  const before = await peek(deps.rates, address, deps.now(), deps.limits);
  if (!before.allowed) return tooMany(before.retryAfter);
  if (before.failed !== undefined) {
    rateFailed(deps, before.failed);
    return uncounted();
  }
  const count = async (chars: number) => {
    const decision = await take(deps.rates, address, deps.now(), deps.limits, chars);
    if (decision.allowed && decision.failed !== undefined) rateFailed(deps, decision.failed);
    return decision;
  };
  const refused = async (status: number, error: string, problems?: string[]) => {
    await count(0);
    return refuse(status, error, problems);
  };
  const body = await readCapped(request, deps.limits.bytes);
  if (body === undefined) return refused(413, LABEL_SAYS.large);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body);
  } catch {
    return refused(400, LABEL_SAYS.text);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return refused(400, LABEL_SAYS.json);
  }
  const parsed = LabelRequest.safeParse(value);
  if (!parsed.success) return refused(400, LABEL_SAYS.schema, problemsOf(parsed.error.issues));
  if (deps.model === undefined) return refused(503, LABEL_SAYS.none);
  const { lines } = parsed.data;
  // What the call sends, taken from the address's day before it is sent, in the request's one write.
  const decision = await count(INSTRUCTIONS.length + promptOf(lines).length);
  if (!decision.allowed) return tooMany(decision.retryAfter);
  // Not counted, so not asked: a burst that the store refuses to write gets no model calls.
  if (decision.failed !== undefined) return uncounted();
  return answer(lines, deps.model, deps);
}

/**
 * `POST /v1/label`: a PDF's lines labelled, as `LabelReply`, one role of `ROLES` a line, or refused
 * with a status and a fixed sentence. It never throws: what fails that is not the request's doing
 * is a 500, logged by the error's class alone.
 */
export async function handleLabel(request: Request, deps: LabelDeps): Promise<Response> {
  if (request.method !== "POST")
    return refuse(405, LABEL_SAYS.method, undefined, { Allow: "POST" });
  if (!isJson(request.headers.get("content-type"))) return refuse(415, LABEL_SAYS.type);
  try {
    return await received(request, deps);
  } catch (error) {
    deps.log?.(`The label route failed: ${classOf(error)}.`, "warn");
    return refuse(500, LABEL_SAYS.failed);
  }
}
