/**
 * The label route in the dev server (milestone 3 second pass, item 13): `POST /v1/label`, answered
 * by the reading service's handler (`src/service/label.ts`) as a middleware, so that development
 * runs no second process and the page calls its own origin, as it will in production (decision
 * 0028).
 *
 * The keys are read on the server side alone: `ANTHROPIC_API_KEY`, Claude's, asked first (decision
 * 0109), and `SOCLAAS_API_KEY` (decision 0036), asked behind it, from the editor's `.env` files and
 * environment by Vite's `loadEnv`, never under the `VITE_` prefix, which would put a key in the
 * page, the shell's over the files'; `PDF_LABEL_CLAUDE_MODEL` and `PDF_LABEL_MODEL` pick the
 * models. With no key the route refuses with 503 and the page's rules read the PDF, and the dev
 * server says so in one line when it starts. The rate limit's buckets are kept in memory. Nothing
 * the route is sent is kept or logged.
 */

import { loadEnv, type Plugin } from "vite";
import {
  CLAUDE_KEY_VARIABLE,
  KEY_VARIABLE,
  type LabelEnv,
  labelModels,
} from "../src/service/config.ts";
import {
  handleLabel,
  LABEL_LIMITS,
  LABEL_ROUTE,
  type LabelDeps,
  type LabelLimits,
} from "../src/service/label.ts";
import { MemoryRateStore, type RateStore } from "../src/service/rate.ts";
import { type Incoming, send, toRequest } from "./serve-fetch.ts";

/**
 * The prefixes of the variables the route reads: its keys', and its models'. Vite's `loadEnv` takes
 * the shell's over the editor's `.env` files', so a key can be given for one run on the command
 * line, and a key exported for other tools is taken too (decision 0109).
 */
const PREFIXES = ["SOCLAAS_", "ANTHROPIC_", "PDF_LABEL_"];

/** What the dev server says when it has no key. */
export const NO_MODEL = `The label route, ${LABEL_ROUTE}, has no model: set ${CLAUDE_KEY_VARIABLE} or ${KEY_VARIABLE} in apps/editor/.env for a PDF's lines to be read by the model; until then the rules read them.`;

/** How the route is set up: each part is taken from the editor when not given, as by the tests. */
export interface ServeLabelOptions {
  /** The variables the key and the model come from, in place of the editor's. */
  env?: LabelEnv;
  /** The model, or null for none, in place of the ones the variables make, with no fallback. */
  model?: LabelDeps["model"] | null;
  rates?: RateStore;
  limits?: LabelLimits;
  now?: () => number;
}

/**
 * The label route on the dev server, and never in vitest's own server, which loads the app's config
 * in the mode `test`: `POST /v1/label` through the handler, with the model the variables make and
 * each address's buckets in memory.
 */
export function serveLabel(options: ServeLabelOptions = {}): Plugin {
  return {
    name: "label-service",
    apply: (_, env) => env.command === "serve" && env.mode !== "test",
    configureServer(server) {
      const { logger } = server.config;
      const env = options.env ?? loadEnv(server.config.mode, server.config.envDir, PREFIXES);
      const { model, fallback } =
        options.model === undefined
          ? labelModels(env)
          : { model: options.model ?? undefined, fallback: undefined };
      const deps: Omit<LabelDeps, "address"> = {
        model,
        fallback,
        rates: options.rates ?? new MemoryRateStore(),
        limits: options.limits ?? LABEL_LIMITS,
        now: options.now ?? Date.now,
        log: (line, level) => (level === "warn" ? logger.warn(line) : logger.info(line)),
      };
      logger.info(
        model === undefined
          ? NO_MODEL
          : `The label route, ${LABEL_ROUTE}, asks ${model.modelId} what a PDF's lines are${fallback === undefined ? "" : `, then ${fallback.modelId} should it give no answer`}.`,
      );
      server.middlewares.use(LABEL_ROUTE, (req: Incoming, res, next) => {
        // Connect also hands a route such as "/v1/label" the paths "/v1/label/x" and "/v1/label.x".
        if ((req.originalUrl ?? "").split("?")[0] !== LABEL_ROUTE) return next();
        void (async () => {
          try {
            await send(
              res,
              await handleLabel(toRequest(req, LABEL_ROUTE), {
                ...deps,
                address: req.socket.remoteAddress,
              }),
            );
          } catch {
            logger.warn("The label route could not convert a request or its answer.");
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
