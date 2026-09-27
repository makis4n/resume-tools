/**
 * The naming step over the corpus (milestone 3 item 9, decision 0027): `corpus name` builds each
 * fetched document's naming request as `corpus seed` builds a sample's, in the same pool of child
 * processes (`corpus-name-child.ts`), and answers it macro by macro (`answerDocument`): from the
 * committed answers first, a person's, the seed's among them, then from the model's answers under
 * its own folder of `.corpus/cache/` (`answer-cache.ts`), each asked for the document's macro, so
 * that an answer another macro of the same key keeps is refused rather than taken; and, with
 * `--model` and a key, from the model, for the macros neither holds. Without `--model` those are
 * counted missing, and nothing is asked.
 *
 * Nothing is asked of a request that fails the privacy gate: `assertNoText` against its document,
 * which refuses it when it holds any text the builder knows as the document's, the body's tree,
 * the texts the preamble stores and the page's strings (decision 0029), and the header's values
 * once item 7 passes them, so that a name a preamble's own macro spells out is found where the page
 * shows it (`gatedRequest`); and `checkRequest`, which refuses it when its keys do not hold, so that
 * no answer is filed under another template's key. A page the detector cannot read refuses the
 * request before it is built. A real call happens only behind the flag, never in CI, and never for
 * a request the gate refuses. The model's answers are filed as each part of the request validates
 * (`storedAnswersOf`), one a key, under each macro's key, unreviewed, with the model's id as their
 * source.
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
  type ModelNaming,
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
import type { Intake } from "../src/import/intake.ts";
import type { HeaderValues, PageFonts } from "../src/import/naming.ts";
import type { Tree } from "../src/import/parse.ts";
import type { Probe } from "../src/import/probe.ts";
import type { Reference } from "../src/import/reference.ts";
import type { EngineSignatures } from "../src/import/signatures.ts";
import { FAMILIES, type Family, printable } from "./corpus-manifest.ts";
import { shownMacro } from "./corpus-parse.ts";
import { PROBE_LIMIT_MS } from "./corpus-probe.ts";

/** How long each part of a document's model step may take, its call and its retries together. */
export const MODEL_LIMIT_MS = 300_000;

/**
 * How long one document may take in the pool: the pipeline and the probe, then the model step. A
 * document of many parts that takes longer is stopped there, and keeps the parts it filed.
 */
export const NAME_LIMIT_MS = PROBE_LIMIT_MS + MODEL_LIMIT_MS;

/** How many times a call the provider failed is tried again, past a free tier's rate limits. */
export const MODEL_RETRIES = 4;

/**
 * How many documents in a row whose calls the provider failed stop the run's asking: a spent
 * quota fails every call after it, each only after its retries.
 */
export const PROVIDER_FAILURES = 3;

/** The variables the naming model's key is read from, the first set: ours, then the provider's. */
const KEY_VARIABLES = ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"] as const;

/**
 * The naming model's configuration from an environment: its key, `GEMINI_API_KEY` or the
 * provider's own name for it, `GOOGLE_GENERATIVE_AI_API_KEY`, and its id, `NAMING_MODEL` or the
 * default. The key is never printed: one of more than one line or with a space in it, as a key
 * file with a comment gives, is refused by the variable's name, since the runtime would quote it
 * whole in the error for a header it cannot send.
 */
export function namingConfig(env: Readonly<Record<string, string | undefined>>): {
  key?: string;
  id: string;
} {
  const found = KEY_VARIABLES.map((variable) => ({
    variable,
    key: env[variable]?.trim() ?? "",
  })).find((each) => each.key !== "");
  if (found !== undefined && /\s/.test(found.key))
    throw new Error(`${found.variable} is not one line with no spaces, as a key is`);
  const id = env.NAMING_MODEL?.trim() || DEFAULT_MODEL;
  return { ...(found === undefined ? {} : { key: found.key }), id };
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
  /**
   * Of those, the ones whose key the cache holds another macro's answer under, a command's for an
   * environment or the other way round, or a list's whose partner the document has no macro of by
   * key (`answerFor`'s refusal): a miss, asked again, and never filed over what the cache holds.
   */
  refusedCache: number;
  /** The ones sent to the model, in the parts it was asked; none for a request refused first. */
  asked: number;
  /** Of those, the ones whose answers were filed, a part at a time as each validated. */
  stored: number;
  /**
   * Of those, the ones of the part whose answer never validated, and those whose list's partner
   * no command of the request is.
   */
  invalid: number;
  /**
   * The keys left unfiled because answers under them disagree: the model's for two macros of the
   * document that share one, or the model's for a macro the cache refused under it.
   */
  conflicts: number;
  /** The ones left with no answer, by name, a name only when it is plainly one. */
  missing: string[];
  /**
   * Why the request was not asked: the privacy gate refused it, its keys do not hold, or it is over
   * the budget before any call.
   */
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
  /** How long each part of the request may take (`NameOptions.partTimeoutMs`). */
  partTimeoutMs?: number;
}

/** A macro as a row names it: its name when it is plainly one, an environment's marked so. */
function shownName(macro: Pick<RequestMacro, "of" | "name">): string {
  const shown = shownMacro(macro.name);
  if (shown === undefined) return "a name that is not plain";
  return macro.of === "environment" ? `${shown.slice(1)} (environment)` : shown;
}

/** A macro's identity: its name, and whether a command or an environment. */
const identity = (macro: { of: string; name: string }) => `${macro.of}|${macro.name}`;

/** A reason as a row keeps it: a line, cut short, so that no message runs on in the table. */
const reasonOf = (message: string) => {
  const line = message.split("\n")[0] ?? "";
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
};

/**
 * A document's request answered macro by macro: each macro with a key from the cache, asked for
 * the document's macro (`answerFor`), and those the cache does not hold, or holds another macro's
 * answer for, once the request passes the privacy gate and its keys hold, from the model in one
 * call a part (`name`). Each part's answers are filed as it validates, one a key: the answers of
 * macros that share a key once all of them are in and agree, none where they disagree, and none
 * over what the cache refused, so that a later part's failure loses nothing already paid for.
 * Without a model, the misses are counted missing; so are they when the gate refuses the request
 * or the step fails, which the result says.
 */
export async function answerDocument(
  request: NamingRequest,
  options: AnswerOptions,
): Promise<Answered> {
  const keyed = request.macros.filter((macro) => macro.key !== undefined);
  const answered: Answered = {
    macros: keyed.length,
    hits: { reviewed: 0, model: 0 },
    refusedCache: 0,
    asked: 0,
    stored: 0,
    invalid: 0,
    conflicts: 0,
    missing: [],
    calls: 0,
    tokens: { input: 0, cached: 0, output: 0 },
  };
  // A list's partners are the document's commands, found by their keys (decision 0024).
  const partners = new Map(
    keyed.flatMap((macro) =>
      macro.of === "command" && macro.key !== undefined ? [[macro.name, macro.key] as const] : [],
    ),
  );
  const misses: RequestMacro[] = [];
  // Keys under which the cache holds another macro's answer: never filed over.
  const taken = new Set<string>();
  for (const macro of keyed) {
    const key = macro.key ?? "";
    const found = await answerFor(options.cache, key, { name: macro.name, of: macro.of, partners });
    if (found === undefined) misses.push(macro);
    else if (found.answer === undefined) {
      answered.refusedCache++;
      taken.add(key);
      misses.push(macro);
    } else if (found.reviewed) answered.hits.reviewed++;
    else answered.hits.model++;
  }
  answered.missing = misses.map(shownName);
  if (misses.length === 0) return answered;
  try {
    options.gate();
  } catch (error) {
    return {
      ...answered,
      refused: reasonOf(
        error instanceof Error ? error.message : "The privacy gate refused the request.",
      ),
    };
  }
  if (options.model === undefined) return answered;
  const problems = await checkRequest(request);
  if (problems.length > 0)
    return {
      ...answered,
      refused: `The request's keys do not hold: ${problems.map((each) => `${each.of} ${shownMacro(each.name) ?? "a name that is not plain"} (${each.problem})`).join(", ")}.`,
    };
  const source = `model:${options.model.id}` as const;
  // The macros asked by key, so that the answers of macros that share one are filed together.
  const byKey = new Map<string, RequestMacro[]>();
  for (const macro of misses) {
    const key = macro.key ?? "";
    byKey.set(key, [...(byKey.get(key) ?? []), macro]);
  }
  const given = new Map<string, ModelNaming["macros"][number]>();
  const decided = new Set<string>();
  const filed = new Set<string>();
  /** A part's answers, filed as they validate: each key once all its macros are answered. */
  const file = async (macros: ModelNaming["macros"]) => {
    answered.asked += macros.length;
    for (const each of macros) given.set(identity(each), each);
    const ready = [...byKey].filter(
      ([key, group]) => !decided.has(key) && group.every((macro) => given.has(identity(macro))),
    );
    for (const [key] of ready) decided.add(key);
    const filing = await storedAnswersOf(
      request,
      {
        macros: ready.flatMap(([, group]) =>
          group.flatMap((macro) => {
            const answer = given.get(identity(macro));
            return answer === undefined ? [] : [answer];
          }),
        ),
        preamble: { parameters: [] },
      },
      source,
    );
    answered.invalid += filing.invalid.length;
    answered.conflicts += filing.conflicts.length;
    for (const each of filing.answers) {
      if (taken.has(each.key)) {
        answered.conflicts++;
        continue;
      }
      await options.cache.put(each.key, each);
      for (const macro of byKey.get(each.key) ?? []) filed.add(identity(macro));
    }
    answered.stored = filed.size;
  };
  try {
    await name(narrow(request, misses), {
      model: options.model.model,
      partners: [...partners.keys()],
      onCall: (usage) => {
        answered.calls++;
        answered.tokens.input += usage.input;
        answered.tokens.cached += usage.cached;
        answered.tokens.output += usage.output;
      },
      onPart: file,
      ...(options.budget === undefined ? {} : { budget: options.budget }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
      ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
      ...(options.partTimeoutMs === undefined ? {} : { partTimeoutMs: options.partTimeoutMs }),
    });
  } catch (error) {
    if (!(error instanceof NamingError)) throw error;
    const part = error.part;
    // A request over the budget is refused before any call; any other failure is a part's.
    if (part === undefined && error.reason === "budget") answered.refused = reasonOf(error.message);
    else {
      answered.failed = { reason: error.reason, message: reasonOf(error.message) };
      answered.asked += part?.macros.length ?? 0;
      if (error.reason === "invalid") answered.invalid += part?.macros.length ?? 0;
    }
  }
  answered.missing = misses.filter((macro) => !filed.has(identity(macro))).map(shownName);
  return answered;
}

/** The naming module's functions a document's request is built and gated with. */
type Naming = Pick<
  typeof import("../src/import/naming.ts"),
  "assertNoText" | "buildRequest" | "pageStrings" | "sourcesOf"
>;

/**
 * What a document's request is built from, as the runner's child takes it through the pipeline,
 * and the header's values once item 7 finds them.
 */
export interface NamingInputs {
  tree: Tree;
  found: EngineSignatures;
  probed: Pick<Probe, "macros" | "candidates">;
  preamble: string;
  taken: Intake;
  made: Reference;
  fonts: PageFonts;
  header?: HeaderValues;
}

/**
 * A document's request as the runner builds it, and its privacy gate: built with the upload's
 * sources and the page's strings, read with the upload's fonts first as the reference read them
 * (`pageStrings`), as `corpus leak` builds it (decision 0029); and the gate, `assertNoText` fed the
 * same, the body's tree and the texts the preamble stores, so that a name a macro of the preamble
 * writes, which no body text names, is masked where the page shows it and refused where it is not.
 * A page the detector cannot read refuses the request (`refused`, the builder's message).
 */
export async function gatedRequest(
  naming: Naming,
  inputs: NamingInputs,
): Promise<
  | { request: NamingRequest; names: ReadonlyMap<string, string>; gate: () => void }
  | { refused: string }
> {
  const { tree, found, probed, preamble, taken, made, fonts } = inputs;
  const sources = naming.sourcesOf(taken);
  const page = await naming.pageStrings(made, fonts, taken.files);
  const header = inputs.header === undefined ? {} : { header: inputs.header };
  const built = await naming.buildRequest(tree, found, probed, preamble, {
    sources,
    page,
    ...header,
  });
  if ("refused" in built) return { refused: built.message };
  const document = {
    tree,
    stored: probed.candidates.filter((each) => each.where === "preamble").map((each) => each.text),
    sources,
    page,
    names: built.names,
    ...header,
  };
  return { ...built, gate: () => naming.assertNoText(built.request, document) };
}

/**
 * What became of a document in `corpus name`: its request answered; refused, its page set in fonts
 * the detector cannot read, the reason in `refused`; or why there is none.
 */
export interface NameRow extends Partial<Answered> {
  id: string;
  family: Family;
  outcome: "requested" | "refused" | "no reference" | "not parsed" | "crashed" | "timeout";
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
  if (row.outcome === "refused")
    return `${row.engine ?? "unknown engine"}, refused: ${row.refused ?? "no reason"}`;
  if (row.outcome !== "requested") return row.outcome;
  const hits = (row.hits?.reviewed ?? 0) + (row.hits?.model ?? 0);
  const refusedCache = row.refusedCache ?? 0;
  const parts = [
    `${row.engine ?? "unknown engine"}, ${counted(row.macros ?? 0, "macro")}, ${hits} from the cache${refusedCache > 0 ? `, ${refusedCache} refused there` : ""}`,
  ];
  const asked = row.asked ?? 0;
  const conflicts = row.conflicts ?? 0;
  if (asked > 0 || (row.calls ?? 0) > 0)
    parts.push(
      `${asked} asked, ${row.stored ?? 0} stored, ${row.invalid ?? 0} invalid${conflicts > 0 ? `, ${counted(conflicts, "key")} in conflict` : ""}; ${counted(row.calls ?? 0, "call")}, ${row.tokens?.input ?? 0} tokens in (${row.tokens?.cached ?? 0} cached), ${row.tokens?.output ?? 0} out`,
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
 * the cache and by the model, those the cache refused, those missing, the keys in conflict, the
 * requests refused and the steps that failed, and the model's calls and tokens; then the headline,
 * with the cost at the model's list price when one was asked, and the macros most often missing.
 * Names and numbers only.
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
    count(
      "Not built: no reference, not parsed, a page the detector cannot read, timed out or died",
      (row) => !requested(row),
    ),
    count("Named: every macro and environment answered", named),
    sum("Macros and environments to answer", (row) => row.macros ?? 0),
    sum("Answered from the cache: reviewed", (row) => row.hits?.reviewed ?? 0),
    sum("Answered from the cache: the model's", (row) => row.hits?.model ?? 0),
    sum(
      "Refused from the cache: another macro's answer under its key",
      (row) => row.refusedCache ?? 0,
    ),
    sum("Asked of the model now", (row) => row.asked ?? 0),
    sum("Stored now", (row) => row.stored ?? 0),
    sum("Asked, and not stored", unstored),
    sum("Of them, invalid: the answer never validated", (row) => row.invalid ?? 0),
    sum(
      "Keys in conflict: answers under one key that disagree, none stored",
      (row) => row.conflicts ?? 0,
    ),
    sum("Missing: no answer", (row) => row.missing?.length ?? 0),
    count(
      "Requests refused: the privacy gate, the keys or the budget",
      (row) => row.refused !== undefined,
    ),
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
