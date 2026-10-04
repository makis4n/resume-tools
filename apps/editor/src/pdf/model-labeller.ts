/**
 * The hosted model as a labeller (milestone 3 second pass, item 13): it stands in for the first
 * step of item 12's reading, through its seam (`Labeller`), and for nothing else. With a yes on
 * record (`consent.ts`), it sends the lines' text and features, `featuresOf` them and nothing more,
 * to the reading service's route on the editor's own origin (`POST /v1/label`), which asks the
 * model and answers one role a line from the closed list.
 *
 * It falls back to the rules, through `labelLines`, for each cause, with the cause kept for the
 * review: no yes on record, read afresh before anything is sent (`no consent`); a request that
 * reaches nothing (`unreachable`); the service's refusals, by their status: too many requests
 * (429, `busy`), no model set up (503, `not set up`), a request it will not take (400 or 413,
 * `too long`), and any other (`failed`); no answer within the time budget, 15 s from the start,
 * the owner's, or the service's own 504 (`timeout`); and a reply that is not one role from the
 * list for each line (422, `wrong form`). A stop the caller asks for is the caller's, and is not a
 * fallback. A line's text is sent cut to its first `LABEL_TEXT_CHARS` characters (`featuresOf`).
 */

import { LABEL_ROUTE, LabelReply } from "../service/label-contract.ts";
import type { PdfConsent } from "./consent.ts";
import { featuresOf, type Labeller, LabellerFallback } from "./label.ts";

/** How long the model may take, from the call's start to its reply read, in ms: the owner's 15 s. */
export const MODEL_BUDGET_MS = 15_000;

/** The part of `fetch` the labeller uses. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ModelLabellerOptions {
  /** The person's answer, read before every call: anything but yes sends nothing. */
  consent: { get(): PdfConsent | undefined };
  /** Stands in for the platform's `fetch`, for a test that reads what would be sent. */
  fetch?: FetchLike;
  /** The time budget, in ms; the owner's 15 s by default. */
  budgetMs?: number;
}

/** The labeller that asks the reading service's model, with the person's agreement. */
export function modelLabeller(options: ModelLabellerOptions): Labeller {
  const budget = options.budgetMs ?? MODEL_BUDGET_MS;
  return {
    by: "model",
    async label(input, { signal }) {
      // Nothing is made, let alone sent, before a yes.
      if (options.consent.get() !== "yes") throw new LabellerFallback("no consent");
      // No lines, nothing to send: the service takes a request of one line at least.
      if (input.lines.length === 0) return [];
      const send = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
      const body = JSON.stringify({ lines: featuresOf(input) });
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, budget);
      const stop = () => controller.abort();
      signal?.addEventListener("abort", stop);
      if (signal?.aborted) controller.abort();
      let reply: unknown;
      let status: number;
      try {
        const response = await send(LABEL_ROUTE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal,
          cache: "no-store",
          credentials: "same-origin",
        });
        status = response.status;
        // The reply is read within the budget too; a reply that is not JSON is of the wrong form.
        if (response.ok) {
          const text = await response.text();
          try {
            reply = JSON.parse(text);
          } catch {
            reply = undefined;
          }
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new LabellerFallback(timedOut ? "timeout" : "unreachable");
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
      }
      if (signal?.aborted) throw signal.reason;
      if (status === 422) throw new LabellerFallback("wrong form");
      if (status === 504) throw new LabellerFallback("timeout");
      if (status === 400 || status === 413) throw new LabellerFallback("too long");
      if (status === 429) throw new LabellerFallback("busy");
      if (status === 503) throw new LabellerFallback("not set up");
      if (status !== 200) throw new LabellerFallback("failed");
      const parsed = LabelReply.safeParse(reply);
      if (!parsed.success || parsed.data.roles.length !== input.lines.length)
        throw new LabellerFallback("wrong form");
      return parsed.data.roles;
    },
  };
}
