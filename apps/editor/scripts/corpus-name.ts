/**
 * The naming step over the corpus (milestone 3 item 9, decision 0026): `corpus name` builds each
 * fetched document's naming request as `corpus seed` builds a sample's, in the same pool of child
 * processes (`corpus-name-child.ts`), and answers it macro by macro (`answerDocument`): from the
 * committed answers first, a person's, the seed's among them, then from the model's answers under
 * `.corpus/cache/` (`answer-cache.ts`), and, with `--model` and a key, from the model, for the
 * macros neither holds. Without `--model` those are counted missing, and nothing is asked.
 *
 * Nothing is asked of a request that fails the privacy gate: `assertNoText` against its document,
 * which refuses it when it holds any of the document's text, and `checkRequest`, which refuses it
 * when its keys do not hold, so that no answer is filed under another template's key. Until item
 * 11's corpus-wide leak test lands, a real call happens only behind the flag, never in CI, and
 * never for a request the gate refuses. The model's answers are stored (`storedAnswersOf`) under
 * each macro's key, unreviewed, with the model's id as their source.
 *
 * What is printed and written names macros and counts, never a request's text nor a document's:
 * a macro's name only when it is plainly one, the gate's and the step's reasons, which name where
 * and never what, and every line through `printable`. The table adds up, per family and in all,
 * the documents named, the macros answered and asked, the model calls, the tokens and what they
 * would cost at the model's list price (`LIST_PRICES`).
 */

// Node runs this file by stripping its types, so it imports values only from files that import
// nothing Node lacks, with their real extensions, and the editor's modules as types alone.
import {
  type AnswerCache,
  answerFor,
  checkRequest,
  type NamingRequest,
  type RequestMacro,
  storedAnswersOf,
} from "@resume-tools/naming";
import {
  type NameOptions,
  NamingError,
  type NamingErrorReason,
  type NamingUsage,
  name,
  narrow,
} from "@resume-tools/naming/model";
import { DEFAULT_MODEL } from "@resume-tools/naming/providers";
import { FAMILIES, type Family, printable } from "./corpus-manifest.ts";
import { shownMacro } from "./corpus-parse.ts";
import { PROBE_LIMIT_MS } from "./corpus-probe.ts";

/** How long a document's model step may take, its calls and their retries together. */
export const MODEL_LIMIT_MS = 300_000;

/** How long one document may take in the pool: the pipeline and the probe, then the model step. */
export const NAME_LIMIT_MS = PROBE_LIMIT_MS + MODEL_LIMIT_MS;

/** How many times a call the provider failed is tried again, past a free tier's rate limits. */
export const MODEL_RETRIES = 4;

/**
 * How many documents in a row whose calls the provider failed stop the run's asking: a spent
 * quota fails every call after it, each only after its retries.
 */
export const PROVIDER_FAILURES = 3;

/**
 * The naming model's configuration from an environment: its key, `GEMINI_API_KEY` or the
 * provider's own name for it, `GOOGLE_GENERATIVE_AI_API_KEY`, and its id, `NAMING_MODEL` or the
 * default. The key is never printed.
 */
export function namingConfig(env: Readonly<Record<string, string | undefined>>): {
  key?: string;
  id: string;
} {
  const key = [env.GEMINI_API_KEY, env.GOOGLE_GENERATIVE_AI_API_KEY]
    .map((each) => each?.trim() ?? "")
    .find((each) => each !== "");
  const id = env.NAMING_MODEL?.trim() || DEFAULT_MODEL;
  return { ...(key === undefined ? {} : { key }), id };
}

/** A model's list price, in US dollars a million tokens, and the day it was read. */
export interface ListPrice {
  read: string;
  input: number;
  /** Input read from the provider's cache. */
  cached: number;
  /** Output, thinking among it. */
  output: number;
}

/**
 * The list prices the table estimates cost at, by model id: Gemini 3.8 Flash's paid tier, as
 * Google's pricing page gave it on 2026-09-27, which holds through 2026-12-31 and doubles from
 * 2027-01-01. The free tier costs nothing within its limits; the estimate is what the same tokens
 * would cost past them.
 */
export const LIST_PRICES: Readonly<Record<string, ListPrice>> = {
  "gemini-3.8-flash": { read: "2026-09-27", input: 0.75, cached: 0.075, output: 3.75 },
};

/** What tokens cost at a list price, in US dollars. */
export function costOf(tokens: NamingUsage, price: ListPrice): number {
  const fresh = Math.max(0, tokens.input - tokens.cached);
  return (fresh * price.input + tokens.cached * price.cached + tokens.output * price.output) / 1e6;
}

/** What became of one document's request: its macros, where their answers came from, and why not. */
export interface Answered {
  /** The request's macros and environments that have a key: those the naming step answers. */
  macros: number;
  /** Of those, the ones the cache answered: a person's reviewed answers, and the model's. */
  hits: { reviewed: number; model: number };
  /** The ones asked of the model, and of them those whose answers were stored. */
  asked: number;
  stored: number;
  /** The ones left with no answer, by name, a name only when it is plainly one. */
  missing: string[];
  /** Why the request was not asked: the privacy gate refused it, or its keys do not hold. */
  refused?: string;
  /** Why the model's answer was not taken: the naming step's reason, and its message. */
  failed?: { reason: NamingErrorReason; message: string };
  /** The model calls the answer took, and their tokens. */
  calls: number;
  tokens: NamingUsage;
}

/** How a document's request is answered. */
export interface AnswerOptions {
  cache: AnswerCache;
  /**
   * The privacy gate: throws when the request holds any of the document's text, as `assertNoText`
   * does, whose message names what kind of text is where and never the text.
   */
  gate: () => void;
  /** The model to ask for what the cache does not answer, and its id; none, and nothing is asked. */
  model?: { model: NameOptions["model"]; id: string };
  budget?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
}

/** A macro as a row names it: its name when it is plainly one, an environment's marked so. */
function shownName(macro: Pick<RequestMacro, "of" | "name">): string {
  const shown = shownMacro(macro.name);
  if (shown === undefined) return "a name that is not plain";
  return macro.of === "environment" ? `${shown.slice(1)} (environment)` : shown;
}

/**
 * A document's request answered macro by macro: each macro with a key from the cache, and those
 * the cache does not hold, once the request passes the privacy gate and its keys hold, from the
 * model in one call a part (`name`), the answers stored under their keys. Without a model, those
 * are counted missing; so are they when the gate refuses the request or the step fails, which the
 * result says.
 */
export async function answerDocument(
  request: NamingRequest,
  options: AnswerOptions,
): Promise<Answered> {
  const keyed = request.macros.filter((macro) => macro.key !== undefined);
  const answered: Answered = {
    macros: keyed.length,
    hits: { reviewed: 0, model: 0 },
    asked: 0,
    stored: 0,
    missing: [],
    calls: 0,
    tokens: { input: 0, cached: 0, output: 0 },
  };
  const misses: RequestMacro[] = [];
  for (const macro of keyed) {
    const found = await answerFor(options.cache, macro.key ?? "");
    if (found === undefined) misses.push(macro);
    else if (found.reviewed) answered.hits.reviewed++;
    else answered.hits.model++;
  }
  answered.missing = misses.map(shownName);
  if (misses.length === 0) return answered;
  try {
    options.gate();
  } catch (error) {
    return {
      ...answered,
      refused: error instanceof Error ? error.message : "The privacy gate refused the request.",
    };
  }
  if (options.model === undefined) return answered;
  const problems = await checkRequest(request);
  if (problems.length > 0)
    return {
      ...answered,
      refused: `The request's keys do not hold: ${problems.map((each) => `${each.of} ${shownMacro(each.name) ?? "a name that is not plain"} (${each.problem})`).join(", ")}.`,
    };
  const part = narrow(request, misses);
  answered.asked = misses.length;
  try {
    const naming = await name(part, {
      model: options.model.model,
      onCall: (usage) => {
        answered.calls++;
        answered.tokens.input += usage.input;
        answered.tokens.cached += usage.cached;
        answered.tokens.output += usage.output;
      },
      ...(options.budget === undefined ? {} : { budget: options.budget }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
      ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
    });
    const stored = await storedAnswersOf(part, naming, `model:${options.model.id}`);
    for (const each of stored) await options.cache.put(each.key, each);
    const filed = new Set(stored.map((each) => each.key));
    answered.stored = stored.length;
    answered.missing = misses.filter((macro) => !filed.has(macro.key ?? "")).map(shownName);
  } catch (error) {
    if (!(error instanceof NamingError)) throw error;
    answered.failed = { reason: error.reason, message: error.message };
  }
  return answered;
}

/** What became of a document in `corpus name`: its request answered, or why there is none. */
export interface NameRow extends Partial<Answered> {
  id: string;
  family: Family;
  outcome: "requested" | "no reference" | "not parsed" | "crashed" | "timeout";
  engine?: "pdftex" | "xetex";
}

/** A row as a child sends it, before the parent adds the document's id and family. */
export type NameChildRow = Omit<NameRow, "id" | "family">;

/** A count and its noun, in the plural where it takes one. */
const counted = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`;

/** Whether a row's document is named: its request built, and every macro with a key answered. */
const named = (row: NameRow) =>
  row.outcome === "requested" && (row.missing?.length ?? 0) === 0 && row.failed === undefined;

/** A row as a line of progress: numbers, reasons and the names of macros, never text. */
export function nameLine(row: NameRow): string {
  if (row.outcome !== "requested") return row.outcome;
  const hits = (row.hits?.reviewed ?? 0) + (row.hits?.model ?? 0);
  const parts = [
    `${row.engine ?? "unknown engine"}, ${counted(row.macros ?? 0, "macro")}, ${hits} from the cache`,
  ];
  const asked = row.asked ?? 0;
  const stored = row.stored ?? 0;
  // Invalid: asked, and not stored because the answer never validated; a failed call is not.
  const invalid = row.failed?.reason === "invalid" ? asked - stored : 0;
  if (asked > 0)
    parts.push(
      `${asked} asked, ${stored} stored, ${invalid} invalid; ${counted(row.calls ?? 0, "call")}, ${row.tokens?.input ?? 0} tokens in (${row.tokens?.cached ?? 0} cached), ${row.tokens?.output ?? 0} out`,
    );
  if (row.refused !== undefined) parts.push(`refused: ${row.refused}`);
  if (row.failed !== undefined) parts.push(`${row.failed.reason}: ${row.failed.message}`);
  const missing = row.missing ?? [];
  if (missing.length > 0) parts.push(`${missing.length} missing: ${missing.join(", ")}`);
  return parts.join("; ");
}

/** How many names the list under the table gives; the JSON has them all. */
export const TOP_MISSING = 15;

/** The macros left with no answer, each with how many documents it is missing from, most first. */
export function missingNames(rows: readonly NameRow[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of rows)
    for (const each of new Set(row.missing ?? [])) counts.set(each, (counts.get(each) ?? 0) + 1);
  return [...counts].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
}

const COLUMNS = [...FAMILIES, "all"] as const;

/**
 * The runner's table: per family and in all, the documents, those named, the macros answered from
 * the cache and by the model, those missing, the requests refused and the steps that failed, and
 * the model's calls and tokens; then the headline, with the cost at the model's list price when
 * one was asked, and the macros most often missing. Names and numbers only.
 */
export function nameTable(rows: readonly NameRow[], model?: string): string {
  const of = (column: (typeof COLUMNS)[number]) =>
    rows.filter((row) => column === "all" || row.family === column);
  const line = (label: string, values: readonly (number | string)[]) =>
    `| ${label} | ${values.join(" | ")} |`;
  const count = (label: string, test: (row: NameRow) => boolean) =>
    line(
      label,
      COLUMNS.map((column) => of(column).filter(test).length),
    );
  const sum = (label: string, pick: (row: NameRow) => number) =>
    line(
      label,
      COLUMNS.map((column) => of(column).reduce((total, row) => total + pick(row), 0)),
    );
  const requested = (row: NameRow) => row.outcome === "requested";
  const unstored = (row: NameRow) => (row.asked ?? 0) - (row.stored ?? 0);
  const lines = [
    line("", COLUMNS),
    `|---|${COLUMNS.map(() => "--:").join("|")}|`,
    count("Documents", () => true),
    count("Requests built", requested),
    count("Not built: no reference, not parsed, timed out or died", (row) => !requested(row)),
    count("Named: every macro and environment answered", named),
    sum("Macros and environments to answer", (row) => row.macros ?? 0),
    sum("Answered from the cache: reviewed", (row) => row.hits?.reviewed ?? 0),
    sum("Answered from the cache: the model's", (row) => row.hits?.model ?? 0),
    sum("Asked of the model now", (row) => row.asked ?? 0),
    sum("Stored now", (row) => row.stored ?? 0),
    sum("Asked, and not stored", unstored),
    sum("Of them, invalid: the answer never validated", (row) =>
      row.failed?.reason === "invalid" ? unstored(row) : 0,
    ),
    sum("Missing: no answer", (row) => row.missing?.length ?? 0),
    count("Requests the privacy gate refused", (row) => row.refused !== undefined),
    count("Requests whose answer failed", (row) => row.failed !== undefined),
    sum("Model calls", (row) => row.calls ?? 0),
    sum("Input tokens", (row) => row.tokens?.input ?? 0),
    sum("Input tokens from the provider's cache", (row) => row.tokens?.cached ?? 0),
    sum("Output tokens, thinking among them", (row) => row.tokens?.output ?? 0),
  ];
  const tokens = rows.reduce<NamingUsage>(
    (total, row) => ({
      input: total.input + (row.tokens?.input ?? 0),
      cached: total.cached + (row.tokens?.cached ?? 0),
      output: total.output + (row.tokens?.output ?? 0),
    }),
    { input: 0, cached: 0, output: 0 },
  );
  const answered = rows.reduce(
    (total, row) => total + (row.hits?.reviewed ?? 0) + (row.hits?.model ?? 0) + (row.stored ?? 0),
    0,
  );
  const stored = rows.reduce((total, row) => total + (row.stored ?? 0), 0);
  const calls = rows.reduce((total, row) => total + (row.calls ?? 0), 0);
  const price = model === undefined ? undefined : LIST_PRICES[model];
  const cost =
    model === undefined
      ? "No model was asked: --model asks it, with a key."
      : price === undefined
        ? `No list price is recorded for ${model}.`
        : `About $${costOf(tokens, price).toFixed(2)} at ${model}'s list price, read ${price.read}.`;
  const missing = missingNames(rows);
  const failures = new Map<string, number>();
  for (const row of rows)
    if (row.failed !== undefined)
      failures.set(row.failed.reason, (failures.get(row.failed.reason) ?? 0) + 1);
  lines.push(
    "",
    `${rows.filter(named).length} of ${counted(rows.filter(requested).length, "document")} named; ${counted(answered, "macro")} answered, ${stored} of them by the model now; ${counted(calls, "model call")}, ${tokens.input + tokens.output} tokens. ${cost}`,
  );
  if (failures.size > 0)
    lines.push(
      `Failed, by reason: ${[...failures].map(([reason, n]) => `${reason} ${n}`).join(", ")}.`,
    );
  if (missing.length > 0)
    lines.push(
      `Missing, by the documents missing it: ${missing
        .slice(0, TOP_MISSING)
        .map(([each, n]) => `${each} ${n}`)
        .join(
          ", ",
        )}${missing.length > TOP_MISSING ? `, and ${missing.length - TOP_MISSING} more` : ""}.`,
    );
  return `${lines.map(printable).join("\n")}\n`;
}
