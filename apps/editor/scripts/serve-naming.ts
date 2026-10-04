/**
 * The naming route in the dev server (milestone 3 item 10, decision 0028): `POST /v1/name`,
 * answered by the service's handler (`src/service/name.ts`) as a middleware, so that development
 * runs no second process and the page calls its own origin, as it will in production. The handler
 * is written against the fetch API: this converts Node's request to a `Request`, whose body is a
 * stream the handler reads no faster than it takes it, and no further than its cap, and converts
 * the `Response` back.
 *
 * The key is read on the server side alone: `SOCLAAS_API_KEY` (decision 0036), the name the
 * corpus runner reads too, from the editor's `.env` files and environment by Vite's `loadEnv`,
 * never under the `VITE_` prefix, which would put it in the page; `NAMING_MODEL` picks the model.
 * With no key the route answers from the cache alone and names what it could not answer, and the
 * dev server says so in one line when it starts. The cache is item 9's file cache: the committed
 * answers, read first and never written, then the model's folder under `.corpus/cache/`, which the
 * runner files that model's answers in too, and where the route files the model's, never over
 * another answer. The preambles' answers are kept in memory, and asked again once a template after
 * a restart.
 */

import { loadEnv, type Plugin } from "vite";
import { KEY_VARIABLE, modelIdOf, type NamingEnv, namingModel } from "../src/service/config.ts";
import {
  handleName,
  LIMITS,
  type NameDeps,
  ROUTE,
  type ServiceCache,
  type ServiceLimits,
} from "../src/service/name.ts";
import { MemoryPreambleCache, type PreambleCache } from "../src/service/preamble.ts";
import { MemoryRateStore, type RateStore } from "../src/service/rate.ts";
import { FileAnswerCache } from "./answer-cache.ts";
import { type Incoming, send, toRequest } from "./serve-fetch.ts";

/** The prefixes of the variables the route reads: its key's, and its model's. */
const PREFIXES = ["NAMING_", "SOCLAAS_"];

/** What the dev server says when it has no key. */
export const CACHE_ALONE = `The naming route, /v1/name, serves the cache alone: set ${KEY_VARIABLE} in apps/editor/.env to ask the model for what it does not hold.`;

/** How the route is set up: each part is taken from the editor when not given, as by the tests. */
export interface ServeNamingOptions {
  /** The variables the key and the model come from, in place of the editor's. */
  env?: NamingEnv;
  /** The model, or null for none, in place of the one the variables make. */
  model?: NameDeps["model"] | null;
  cache?: ServiceCache;
  preambles?: PreambleCache;
  rates?: RateStore;
  limits?: ServiceLimits;
  now?: () => number;
}

/**
 * The naming route on the dev server, and never in vitest's own server, which loads the app's
 * config in the mode `test`: `POST /v1/name` through the handler, with the model the variables
 * make, item 9's file cache over the committed answers and the model's folder, the preambles'
 * answers and each address's buckets in memory.
 */
export function serveNaming(options: ServeNamingOptions = {}): Plugin {
  return {
    name: "naming-service",
    apply: (_, env) => env.command === "serve" && env.mode !== "test",
    configureServer(server) {
      const { logger } = server.config;
      const env = options.env ?? loadEnv(server.config.mode, server.config.envDir, PREFIXES);
      const model = options.model === undefined ? namingModel(env) : (options.model ?? undefined);
      const deps: Omit<NameDeps, "address"> = {
        cache: options.cache ?? new FileAnswerCache({ model: model?.modelId ?? modelIdOf(env) }),
        preambles: options.preambles ?? new MemoryPreambleCache(),
        model,
        rates: options.rates ?? new MemoryRateStore(),
        limits: options.limits ?? LIMITS,
        now: options.now ?? Date.now,
        log: (line, level) => (level === "warn" ? logger.warn(line) : logger.info(line)),
      };
      logger.info(
        model === undefined
          ? CACHE_ALONE
          : `The naming route, /v1/name, asks ${model.modelId} for what the cache does not hold.`,
      );
      server.middlewares.use(ROUTE, (req: Incoming, res, next) => {
        // Connect also hands a route such as "/v1/name" the paths "/v1/name/x" and "/v1/name.x".
        if ((req.originalUrl ?? "").split("?")[0] !== ROUTE) return next();
        void (async () => {
          try {
            await send(
              res,
              await handleName(toRequest(req, ROUTE), {
                ...deps,
                address: req.socket.remoteAddress,
              }),
            );
          } catch {
            logger.warn("The naming route could not convert a request or its answer.");
            if (res.headersSent) res.destroy();
            else {
              res.statusCode = 500;
              res.end();
            }
          }
        })();
      });
    },
  };
}
