/**
 * The PDF spike's hosted model (item 3, a first cut of item 13): SoCLaaS's `qwen3.8:27b`, asked as
 * the provider code makes it (`soclaasModel`, thinking off, decision 0044), says what each line of
 * a PDF is, given the lines' text and features, with the roles as a JSON schema's enum on every
 * line's key, so that a reply that keeps to the schema is valid by construction. The filing step
 * after it is the rules' own (`file.ts`).
 *
 * The model reads only the invented sets. `labelByModel` takes a PDF's path, not its lines, and
 * refuses before it reads anything any path that is not a PDF under the invented sets' own folders
 * with its truth beside it (`assertInvented`): no corpus resume, and nothing made from one, is ever
 * sent. A test holds it.
 *
 * What it records of a call: how long it took, the tokens, and a failure's kind, never the reply's
 * or the request's text, and never the key.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { DEFAULT_MODEL, soclaasModel } from "@resume-tools/naming/providers";
import { APICallError, generateText, jsonSchema, NoObjectGeneratedError, Output } from "ai";
import { INSTRUCTIONS, promptOf, rolesOf, schemaOf } from "../../src/service/label-model.ts";
import { BUILTIN_DIR } from "./builtin.ts";
import { type Layout, layOut } from "./layout.ts";
import { OTHER_DIR } from "./print.ts";
import { readPdf } from "./read.ts";
import { type Features, featuresOf, type Role } from "./roles.ts";

/** The model the spike asks: the provider code's default, decision 0044's. */
export const MODEL = DEFAULT_MODEL;

/** How long a call may take before it is stopped and counted a timeout: well past the budget. */
export const CALL_LIMIT_MS = 180_000;

/** The kinds of a call's failure. */
export const FAILURES = [
  "timeout",
  "wrong form",
  "gateway down",
  "rate limited",
  "key refused",
  "no answer",
  "other",
] as const;
export type Failure = (typeof FAILURES)[number];

/** The invented sets' own folders: the only places a PDF the model reads may be. */
export const INVENTED_DIRS: readonly string[] = [BUILTIN_DIR, OTHER_DIR];

/** Why a path was refused before anything was read or sent. */
export class NotInvented extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotInvented";
  }
}

/** The truth beside an invented PDF: `<name>.truth.json` in the first set, `truth.json` in the third. */
export function truthPathOf(pdf: string): string {
  const name = basename(pdf, ".pdf");
  const own = join(dirname(pdf), `${name}.truth.json`);
  return existsSync(own) ? own : join(dirname(pdf), "truth.json");
}

/**
 * The real path of an invented PDF, or a `NotInvented` thrown: the path, its links followed, must
 * be a `.pdf` file inside one of the invented sets' folders, their links followed too, with its
 * truth beside it, and nowhere under a `.corpus` folder.
 */
export function assertInvented(path: string, roots: readonly string[] = INVENTED_DIRS): string {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    throw new NotInvented("The model reads only a PDF of the invented sets, and this is no file.");
  }
  const inside = roots.some((root) => {
    let realRoot: string;
    try {
      realRoot = realpathSync(root);
    } catch {
      return false;
    }
    return real.startsWith(realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`);
  });
  if (!inside || real.split(sep).includes(".corpus") || !real.endsWith(".pdf"))
    throw new NotInvented("The model reads only a PDF of the invented sets' own folders.");
  if (!existsSync(truthPathOf(real)))
    throw new NotInvented("The model reads only an invented PDF with its truth beside it.");
  return real;
}

// The prompt, the schema and the check of a reply are the reading service's now (item 13).
export { INSTRUCTIONS, promptOf, rolesOf, schemaOf };

/** What one call to the model came to. */
export interface ModelCall {
  /** Milliseconds from the call's start to its answer or its failure. */
  ms: number;
  roles?: Role[];
  failure?: Failure;
  /** The provider's status, where it answered with one. */
  status?: number;
  tokens?: { input: number; output: number; reasoning?: number };
}

/** A call's failure's kind, from what the AI SDK threw. */
export function failureOf(
  error: unknown,
  timedOut: boolean,
): { failure: Failure; status?: number } {
  if (timedOut) return { failure: "timeout" };
  if (NoObjectGeneratedError.isInstance(error)) return { failure: "wrong form" };
  const call = APICallError.isInstance(error)
    ? error
    : error instanceof Error && APICallError.isInstance(error.cause)
      ? error.cause
      : undefined;
  const status = call?.statusCode;
  if (status === 429) return { failure: "rate limited", status };
  if (status === 401 || status === 403) return { failure: "key refused", status };
  if (status !== undefined && status >= 500) return { failure: "gateway down", status };
  if (call !== undefined && status === undefined) return { failure: "gateway down" };
  if (status !== undefined) return { failure: "other", status };
  return { failure: "other" };
}

export interface ModelOptions {
  /** The SoCLaaS key, as the caller read it from its environment. */
  apiKey: string;
  model?: string;
  limitMs?: number;
  /** Stands in for the platform's `fetch`, for a test that reads what would be sent. */
  fetch?: typeof fetch;
}

/**
 * Ask the model what each line of an invented PDF is. Refuses, with `NotInvented` and before it
 * reads the file, a path outside the invented sets' folders (`assertInvented`); then reads the PDF
 * from that path, lays it out, and asks. Gives back the layout, for the filing step, and the call.
 */
export async function labelByModel(
  pdfPath: string,
  options: ModelOptions,
): Promise<{ layout: Layout; features: Features[]; call: ModelCall }> {
  const real = assertInvented(pdfPath);
  const read = await readPdf(new Uint8Array(readFileSync(real)));
  if ("refused" in read) throw new Error(`the invented PDF ${basename(real)} was refused`);
  const layout = layOut(read);
  const features = featuresOf(layout);
  const model = soclaasModel(
    options.apiKey,
    options.model ?? MODEL,
    options.fetch === undefined ? {} : { fetch: options.fetch },
  );
  const limit = options.limitMs ?? CALL_LIMIT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limit);
  const started = performance.now();
  try {
    const result = await generateText({
      model,
      instructions: INSTRUCTIONS,
      messages: [{ role: "user", content: promptOf(features) }],
      output: Output.object({ schema: jsonSchema(schemaOf(features)), name: "roles" }),
      maxRetries: 0,
      abortSignal: controller.signal,
    });
    const ms = performance.now() - started;
    const reasoning = result.usage.outputTokenDetails?.reasoningTokens;
    const tokens = {
      input: result.usage.inputTokens ?? 0,
      output: result.usage.outputTokens ?? 0,
      ...(reasoning === undefined ? {} : { reasoning }),
    };
    let reply: unknown;
    try {
      reply = result.output;
    } catch {
      return { layout, features, call: { ms, failure: "no answer", tokens } };
    }
    const roles = rolesOf(features, reply);
    return {
      layout,
      features,
      call: roles === undefined ? { ms, failure: "wrong form", tokens } : { ms, roles, tokens },
    };
  } catch (error) {
    const ms = performance.now() - started;
    return { layout, features, call: { ms, ...failureOf(error, timedOut) } };
  } finally {
    clearTimeout(timer);
  }
}
