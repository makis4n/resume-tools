/**
 * `POST /v1/label` on Cloudflare Pages (milestone 3 second pass, item 13): the reading service's
 * handler that labels a PDF's lines (`src/service/label.ts`), with its rate limit's buckets in the
 * KV namespace bound as `LABEL_KV`, under `label-rate:`, the models' keys and ids from the
 * function's environment, and the client's address from `CF-Connecting-IP`. It keeps nothing it is
 * sent: no cache is bound, and the log takes fixed lines alone. Deploying it is milestone 5's;
 * `../README.md` says how it is meant to be bound. Pages makes a route of every script in this
 * folder, so the code it runs and its tests live under `src/service/`.
 */

import { labelModels } from "../../src/service/config.ts";
import { KvRateStore } from "../../src/service/kv.ts";
import { handleLabel, LABEL_LIMITS } from "../../src/service/label.ts";

/** What the function is bound to. */
interface Env {
  LABEL_KV: KVNamespace;
  SOCLAAS_API_KEY?: string;
  PDF_LABEL_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  PDF_LABEL_CLAUDE_MODEL?: string;
}

export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  handleLabel(request, {
    rates: new KvRateStore(env.LABEL_KV, "label-rate:"),
    ...labelModels(env),
    address: request.headers.get("CF-Connecting-IP") ?? undefined,
    limits: LABEL_LIMITS,
    now: Date.now,
    log: (line, level) => (level === "warn" ? console.error(line) : console.log(line)),
  });
