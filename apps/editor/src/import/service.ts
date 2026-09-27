/**
 * The naming service's client, in the browser (milestone 3 item 10, decision 0028): an import sends
 * its naming request to the editor's own origin, `POST /v1/name`, which the dev server answers in
 * development and a Pages Function in production, so that there is no second origin and no key in
 * the page. It gives back the service's reply, checked against its schema (`NamingReply`), or throws
 * a `NamingServiceError` whose message says in plain English what went wrong, from the status
 * alone: a person reads it, so it never quotes the reply, and never holds LaTeX. Item 12's import
 * screen calls it.
 */

import type { NamingRequest } from "@resume-tools/naming";
import { NamingReply } from "../service/reply";

/** The route the service answers, relative to the page. */
export const NAMING_ROUTE = "/v1/name";

/** The part of `fetch` the client uses. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Why the naming service gave no answer: the status it answered with, or 0 when no reply came, and
 * for a 429 how many seconds it asked to wait, when it said.
 */
export class NamingServiceError extends Error {
  readonly status: number;
  readonly retryAfter: number | undefined;

  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.name = "NamingServiceError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** A count of a unit, in the plural where it takes one. */
const counted = (count: number, unit: string) => `${count} ${count === 1 ? unit : `${unit}s`}`;

/** Seconds as a person reads them: in seconds, minutes or hours, rounded up. */
const seconds = (count: number) =>
  count < 60
    ? counted(count, "second")
    : count < 3600
      ? counted(Math.ceil(count / 60), "minute")
      : counted(Math.ceil(count / 3600), "hour");

/** What a status means to the person importing. */
function meaning(status: number, retryAfter: number | undefined): string {
  if (status === 400 || status === 405 || status === 415)
    return "The naming service could not read what the editor sent it. This is a fault in the editor, not in your resume.";
  if (status === 413) return "This template is too large for the naming service.";
  if (status === 422)
    return "The naming service could not work out what this template's parts are.";
  if (status === 429)
    return retryAfter === undefined
      ? "Too many imports in a short time. Try again in a minute."
      : `Too many imports in a short time. Try again in ${seconds(retryAfter)}.`;
  if (status === 502 || status === 503 || status === 504)
    return "The naming service could not reach its model. Try again later.";
  if (status >= 500) return "The naming service failed. Try again later.";
  return `The naming service answered with an error (HTTP ${status}).`;
}

/** A Retry-After header's whole seconds, when it gives them. */
function retryAfterOf(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim() ?? "";
  return /^\d{1,9}$/.test(value) ? Number(value) : undefined;
}

/**
 * The naming service's reply to a request: posted to `/v1/name` as JSON, and checked against
 * `NamingReply`. Throws a `NamingServiceError` when no reply comes, the reply is not a 200, or it
 * cannot be read; an abort through `signal` is thrown as it comes, so that a cancel is not taken for
 * a failure.
 */
export async function nameOnService(
  request: NamingRequest,
  fetchLike: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
): Promise<NamingReply> {
  let response: Response;
  try {
    response = await fetchLike(NAMING_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new NamingServiceError(
      0,
      "The naming service could not be reached. Check the connection and try again.",
    );
  }
  if (response.status !== 200) {
    const retryAfter = retryAfterOf(response);
    await response.body?.cancel().catch(() => undefined);
    throw new NamingServiceError(response.status, meaning(response.status, retryAfter), retryAfter);
  }
  let reply: unknown;
  try {
    reply = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    reply = undefined;
  }
  const parsed = NamingReply.safeParse(reply);
  if (!parsed.success)
    throw new NamingServiceError(response.status, "The naming service's answer could not be read.");
  return parsed.data;
}
