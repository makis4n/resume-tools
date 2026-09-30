/**
 * `POST /v1/name` on Cloudflare Pages (milestone 3 item 10, decision 0028): the naming service's
 * handler (`src/service/name.ts`), with its answers, the preambles' answers and its rate limit's
 * buckets in the KV namespace bound as `NAMING_KV`, the model's key and id from the function's
 * environment, and the client's address from `CF-Connecting-IP`. Deploying it is milestone 5's;
 * `../README.md` says how it is meant to be bound. Pages makes a route of every script in this
 * folder, so no other script goes in it: the code it runs and its tests live under `src/service/`.
 */

import { namingModel } from "../../src/service/config.ts";
import { KvAnswerCache, KvPreambleCache, KvRateStore } from "../../src/service/kv.ts";
import { handleName, LIMITS } from "../../src/service/name.ts";

/** What the function is bound to. */
interface Env {
  NAMING_KV: KVNamespace;
  SOCLAAS_API_KEY?: string;
  NAMING_MODEL?: string;
}

export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  handleName(request, {
    cache: new KvAnswerCache(env.NAMING_KV),
    preambles: new KvPreambleCache(env.NAMING_KV),
    rates: new KvRateStore(env.NAMING_KV),
    model: namingModel(env),
    address: request.headers.get("CF-Connecting-IP") ?? undefined,
    limits: LIMITS,
    now: Date.now,
    log: (line, level) => (level === "warn" ? console.error(line) : console.log(line)),
  });
