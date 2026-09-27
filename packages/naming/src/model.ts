/**
 * The naming step on a model (milestone 3 item 9, plan section 6 step 4, decision 0027): `name` asks
 * a language model, through the AI SDK, for the answer to a naming request, as structured output
 * against `ModelNaming` (`generateText` with `Output.object`), and checks what comes back: the
 * schema, its refinements included; that it answers every macro the request asks, by its name and
 * whether a command or an environment, once, and nothing else; that each partner a list names is
 * one of the template's commands; and that the preamble's parameters name settings the request has,
 * by plain keys. An answer that fails is asked again once, with its problems quoted back; one that
 * fails again throws.
 *
 * A request whose prompt is over the budget, counted in characters of what the model reads, is
 * asked in parts (`batchesOf`): each macro with the definitions it hands its work to, a definition
 * laid out once in each part that needs it, and the preamble's settings in the first part alone,
 * which takes what fits beside them. Each part has its own time limit, and is told to the caller as
 * it validates (`onPart`), so that a caller that files it loses nothing to a later part's failure;
 * the answers are merged in the request's order. The parts are laid out alike (`prompt.ts`), so
 * that a provider's cache of a prompt's start serves each; no provider's own cache is asked for.
 *
 * What it says of a failure names macros only by names that are plainly names, fields and counts,
 * and a provider's status and first line, key-like tokens taken out: never a request's text, the
 * model's own words, nor what the runtime says of a key it was given.
 *
 * The model comes in as a `LanguageModel`, so that this module never reads the environment and any
 * provider swaps in: `providers.ts` makes Gemini's. It stores nothing: the caller turns the answer
 * into stored answers (`storedAnswersOf`) and files them, after `checkRequest`, as decision 0024
 * has it. It imports the AI SDK, which the page never needs, so the package gives it by its own
 * path, `@resume-tools/naming/model`, for the naming service and the corpus runner.
 */

import {
  APICallError,
  generateText,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  RetryError,
} from "ai";
import { ModelNaming } from "./answer.ts";
import {
  askedOf,
  commandsOf,
  definitionOrder,
  INSTRUCTIONS,
  layOut,
  measure,
  retryText,
} from "./prompt.ts";
import type { NamingRequest, RequestMacro } from "./request.ts";

/**
 * The most characters one call's prompt may hold, the instructions and the laid-out request
 * together, and the budget when none is given: well inside what the providers read at once, a
 * million tokens for Gemini's Flash, and small enough that an answer stays well inside what they
 * write at once.
 */
export const BUDGET = 200_000;

/**
 * The most macros one call asks about, whatever their size, so that the answer, some hundreds of
 * characters a macro, stays well inside a model's output.
 */
export const BATCH_MACROS = 32;

/**
 * Why the naming step failed: the model gave no answer (`refused`); its answer did not validate,
 * after a retry (`invalid`); the call to its provider failed (`provider`); or the request, or the
 * answer, is too large for a call (`budget`).
 */
export const NAMING_ERRORS = ["refused", "invalid", "provider", "budget"] as const;
export type NamingErrorReason = (typeof NAMING_ERRORS)[number];

/** A macro of a part: its name, and whether a command or an environment. */
export interface PartMacro {
  of: "command" | "environment";
  name: string;
}

/** The part of a request whose asking failed: its number, from 1, of how many, and its macros. */
export interface FailedPart {
  index: number;
  count: number;
  macros: PartMacro[];
}

/**
 * What `name` throws: a plain-English message, which names macros and counts, never a request's
 * text, and why. `status` is the provider's HTTP status, where it answered with one. `part` is the
 * part whose asking failed, whose macros were sent and have no answer; none where the step failed
 * before it asked anything, as a request over the budget does.
 */
export class NamingError extends Error {
  readonly reason: NamingErrorReason;
  readonly status: number | undefined;
  readonly part: FailedPart | undefined;
  constructor(reason: NamingErrorReason, message: string, status?: number, part?: FailedPart) {
    super(message);
    this.name = "NamingError";
    this.reason = reason;
    this.status = status;
    this.part = part;
  }
}

/** One call's tokens: read, of them read from the provider's cache, and written, thinking among them. */
export interface NamingUsage {
  input: number;
  cached: number;
  output: number;
}

/** How `name` asks. */
export interface NameOptions {
  /** The model: an instance, never a name, which the AI SDK would send to its own gateway. */
  model: Exclude<LanguageModel, string>;
  /** The most characters a call's prompt may hold; BUDGET, and never more. */
  budget?: number;
  /** How many times the AI SDK tries a failed call again, its default 2. */
  maxRetries?: number;
  /** Stops every call the request makes. */
  abortSignal?: AbortSignal;
  /**
   * How long each part may take, its call and its retry together, in milliseconds: a limit of its
   * own for each part, so that a request of many parts is not stopped by one limit for them all.
   * None by default.
   */
  partTimeoutMs?: number;
  /** Options for the provider, as `{ google: { structuredOutputs: false } }`. */
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
  /** Told each call's tokens, whether its answer was taken or not. */
  onCall?: (usage: NamingUsage) => void;
  /**
   * The document's commands the request leaves out, which a list's answer may name as its partner:
   * those the cache answered. The prompt names them with the request's own (`commandsOf`).
   */
  partners?: readonly string[];
  /**
   * Told each part's answers once they validate, before the next part is asked, so that a caller
   * that files them loses none to a later part's failure, and asks only the parts left next time.
   */
  onPart?: (macros: ModelNaming["macros"]) => void | Promise<void>;
}

/** A part of a request, as one call asks it: the request narrowed, and whether it asks the preamble. */
export interface Part {
  request: NamingRequest;
  preamble: boolean;
}

/**
 * A request narrowed to some of its macros: those macros, the definitions they and their closures
 * name, and the preamble's settings, or none.
 */
export function narrow(
  request: NamingRequest,
  macros: readonly RequestMacro[],
  preamble = true,
): NamingRequest {
  const needed = new Set(macros.flatMap((macro) => [macro.name, ...macro.dependencies]));
  return {
    ...request,
    preamble: preamble ? request.preamble : { settings: [] },
    macros: [...macros],
    definitions: request.definitions.filter((each) => needed.has(each.name)),
  };
}

/** A macro's name as a message gives it: plainly a name, as the runner's `shownMacro` has it. */
const PLAIN_NAME = /^[A-Za-z@*]{1,63}$/;

/**
 * A macro as a message names it: whether a command or an environment, and its name when that is
 * plainly one; otherwise that it is not, since what the model wrote there may be anything, its
 * prompt echoed back among it, and a message is printed and kept.
 */
function shown(macro: { of?: unknown; name?: unknown }): string {
  const of = macro.of === "command" || macro.of === "environment" ? macro.of : ("macro" as const);
  return typeof macro.name === "string" && PLAIN_NAME.test(macro.name)
    ? `${of} "${macro.name}"`
    : `a ${of} whose name is not plain`;
}

/** A text of a message, cut short. */
const capped = (text: string, most = 200) =>
  text.length > most ? `${text.slice(0, most - 1)}…` : text;

/**
 * The parts a request is asked in: its asked macros in order, as many to a part as keep its prompt
 * within the budget and BATCH_MACROS, each part holding the definitions its macros hand their work
 * to, once, and the first alone the preamble's settings. The first part takes the macros that fit
 * beside the preamble, later ones too, and a macro too large for it starts the next part, so that
 * the order of the macros never makes a request too large. One part, for a request that fits.
 * Throws `budget` when a macro and its definitions are over the budget alone, or the preamble is.
 * `commands` are those the prompt names, the whole request's (`commandsOf`).
 */
export function batchesOf(
  request: NamingRequest,
  budget: number = BUDGET,
  commands: readonly string[] = commandsOf(request),
): Part[] {
  const limit = Math.min(budget, BUDGET);
  const size = measure(request, commands);
  const defined = new Set(request.definitions.map((each) => each.name));
  interface Open {
    macros: RequestMacro[];
    /** The asked macros' names, whose definitions their own pieces hold. */
    own: Set<string>;
    /** The definitions laid out apart, each once. */
    shared: Set<string>;
    chars: number;
    preamble: boolean;
  }
  const open = (preamble: boolean): Open => ({
    macros: [],
    own: new Set(),
    shared: new Set(),
    chars: size.fixed(preamble),
    preamble,
  });
  /** What a macro adds to a part: its piece, and its dependencies the part does not hold yet. */
  const cost = (part: Open, macro: RequestMacro) => {
    let chars = size.macro(macro);
    if (part.shared.has(macro.name)) chars -= size.definition(macro.name);
    for (const name of new Set(macro.dependencies))
      if (name !== macro.name && defined.has(name) && !part.shared.has(name) && !part.own.has(name))
        chars += size.definition(name);
    return chars;
  };
  const add = (part: Open, macro: RequestMacro) => {
    part.chars += cost(part, macro);
    part.macros.push(macro);
    part.own.add(macro.name);
    part.shared.delete(macro.name);
    for (const name of macro.dependencies)
      if (defined.has(name) && !part.own.has(name)) part.shared.add(name);
  };
  /** Whether a macro fits in a part: within the budget, and the part not full. */
  const fits = (part: Open, macro: RequestMacro) =>
    part.chars + cost(part, macro) <= limit && part.macros.length < BATCH_MACROS;
  const first = open(true);
  if (first.chars > limit)
    throw new NamingError(
      "budget",
      `The request's preamble is over the budget of ${limit} characters on its own`,
    );
  const parts = [first];
  let current = first;
  for (const macro of askedOf(request)) {
    const into = [current, first].find((part) => fits(part, macro));
    if (into !== undefined) {
      add(into, macro);
      continue;
    }
    current = open(false);
    parts.push(current);
    if (current.chars + cost(current, macro) > limit)
      throw new NamingError(
        "budget",
        `The budget of ${limit} characters is too small for ${shown(macro)} and the definitions it hands its work to, on their own`,
      );
    add(current, macro);
  }
  return parts.map((part) => ({
    request: narrow(request, part.macros, part.preamble),
    preamble: part.preamble,
  }));
}

/** A macro's identity in an answer: its name, and whether a command or an environment. */
const identity = (macro: { of: string; name: string }) => `${macro.of}|${macro.name}`;

/**
 * What is wrong with an answer's coverage of the macros asked: one it does not answer, one it
 * answers twice, and one it answers that was not asked, each named as a message names a macro.
 */
export function coverage(
  naming: Pick<ModelNaming, "macros">,
  asked: readonly Pick<RequestMacro, "of" | "name">[],
): string[] {
  const wanted = new Set(asked.map(identity));
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const each of naming.macros) {
    const id = identity(each);
    if (!wanted.has(id)) problems.push(`an answer for ${shown(each)}, which was not asked`);
    else if (seen.has(id)) problems.push(`two answers for ${shown(each)}`);
    seen.add(id);
  }
  for (const macro of asked)
    if (!seen.has(identity(macro))) problems.push(`no answer for ${shown(macro)}`);
  return problems;
}

/**
 * A key of the preamble's answer: an option or a name, as `margin`, `11pt` or `awesome-red`, which
 * item 7 writes into a control's snippet, so nothing that TeX reads as more than a name.
 */
const PLAIN_KEY = /^[A-Za-z0-9@][A-Za-z0-9@._-]{0,63}$/;

/**
 * What an answer must fit of its request, past the schema: the commands a list's partner may be,
 * and, for the part that asks the preamble, how many settings the request has.
 */
interface Fit {
  commands: ReadonlySet<string>;
  settings?: number;
}

/**
 * What the schema cannot check of an answer, since it takes the request: that each partner a list
 * names is one of the template's commands (decision 0024), and that each of the preamble's
 * parameters names a setting the request has by a plain key. Each named by macro and field, never
 * by what the model wrote there.
 */
function misfits(naming: ModelNaming, fit: Fit): string[] {
  const problems: string[] = [];
  for (const each of naming.macros)
    for (const which of ["closedBy", "openedBy"] as const) {
      const named = each.answer.list?.[which];
      if (named !== undefined && !fit.commands.has(named))
        problems.push(
          `the answer for ${shown(each)} names, as its list's ${which}, no command of the template's`,
        );
    }
  const settings = fit.settings;
  if (settings !== undefined)
    naming.preamble.parameters.forEach((parameter, i) => {
      if (parameter.key !== undefined && !PLAIN_KEY.test(parameter.key))
        problems.push(
          `preamble.parameters.${i}.key: a key is a plain name, of letters, digits, @, dots, hyphens and underscores`,
        );
      if (parameter.setting !== undefined && parameter.setting >= settings)
        problems.push(
          `preamble.parameters.${i}.setting: the request has no setting of that number`,
        );
    });
  return problems;
}

/**
 * A schema's problem with an answer, by the macro it is in where it is in one, and its field; a
 * field the model added is said to be one, never named, since its name is the model's words.
 */
function described(
  issue: { code?: string; path: PropertyKey[]; message: string },
  value: unknown,
): string {
  const message =
    issue.code === "unrecognized_keys" ? "fields the contract has not" : issue.message;
  const [first, index, ...rest] = issue.path;
  const where = (path: PropertyKey[]) => path.map(String).join(".");
  if (first === "macros" && typeof index === "number") {
    const macros = (value as { macros?: unknown } | null)?.macros;
    const macro = Array.isArray(macros) ? (macros[index] as { of?: unknown; name?: unknown }) : {};
    const named =
      typeof macro?.of === "string" && typeof macro?.name === "string"
        ? `the answer for ${shown(macro)}`
        : `answer ${index + 1} of macros`;
    return capped(`${named}${rest.length === 0 ? "" : `, at ${where(rest)}`}: ${message}`);
  }
  return capped(`${issue.path.length === 0 ? "the answer" : where(issue.path)}: ${message}`);
}

/**
 * An answer checked: the schema's problems, its refinements among them, by macro and field; or,
 * when it validates, the macros asked that it leaves out, answers twice or adds, and what it does
 * not fit of the request (`misfits`).
 */
function checked(
  value: unknown,
  asked: readonly RequestMacro[],
  fit: Fit,
): { naming?: ModelNaming; problems: string[] } {
  const parsed = ModelNaming.safeParse(value);
  if (!parsed.success)
    return { problems: parsed.error.issues.map((issue) => described(issue, value)) };
  const problems = [...coverage(parsed.data, asked), ...misfits(parsed.data, fit)];
  return problems.length > 0 ? { problems } : { naming: parsed.data, problems };
}

/** A call's tokens, as the AI SDK counts them. */
function usageOf(usage: LanguageModelUsage | undefined): NamingUsage {
  return {
    input: usage?.inputTokens ?? 0,
    cached: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    output: usage?.outputTokens ?? 0,
  };
}

/** What a provider's line may quote of a key: Google's, and any run of 30 letters and digits. */
const KEY_LIKE = /AIza[0-9A-Za-z_-]*|[A-Za-z0-9]{30,}/g;

/** The first line of a provider's message, key-like tokens taken out, cut short. */
function firstLine(text: string): string {
  return capped((text.split(/\r?\n/)[0] ?? "").trim().replace(KEY_LIKE, "<key>"));
}

/** An error's class, by its name where that is plainly one: never what it says. */
function classOf(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name) ? name : "an error";
}

/**
 * A failed call as a NamingError: an API's status and first line, or a sentence of this module's.
 * What the runtime says of anything else may quote what it was given, a key among it, since a key
 * with a line break fails the check of a header, whose message holds the header's value: that is
 * said to be the key's fault, and the rest named by its class alone.
 */
function providerError(error: unknown): NamingError {
  const last = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(last)) {
    const status = last.statusCode;
    return new NamingError(
      "provider",
      `The model's provider answered${status === undefined ? " with no status" : ` HTTP ${status}`}: ${firstLine(last.message)}`,
      status,
    );
  }
  if (last instanceof Error && (last.name === "AbortError" || last.name === "TimeoutError"))
    return new NamingError("provider", "The call to the model was stopped before it answered");
  if (last instanceof TypeError && /header/i.test(last.message))
    return new NamingError(
      "provider",
      "The call to the model failed: the key is not a single line",
    );
  return new NamingError("provider", `The call to the model failed (${classOf(last)})`);
}

/** What one call gave back: the answer's value and text, or problems found before any value. */
interface Reply {
  value?: unknown;
  text?: string;
  problems: string[];
}

/** One call: the instructions, the messages, and the answer as structured output. */
async function call(
  messages: ModelMessage[],
  options: NameOptions,
  abortSignal: AbortSignal | undefined,
): Promise<Reply> {
  try {
    const result = await generateText({
      model: options.model,
      instructions: INSTRUCTIONS,
      messages,
      output: Output.object({ schema: ModelNaming, name: "naming" }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
      ...(abortSignal === undefined ? {} : { abortSignal }),
      ...(options.providerOptions === undefined
        ? {}
        : { providerOptions: options.providerOptions }),
    });
    options.onCall?.(usageOf(result.usage));
    if (result.finishReason === "content-filter")
      throw new NamingError("refused", "The model's provider filtered its answer out");
    let value: unknown;
    try {
      value = result.output;
    } catch (error) {
      if (NoOutputGeneratedError.isInstance(error))
        throw new NamingError(
          "refused",
          `The model gave no answer: it finished with ${result.finishReason}`,
        );
      throw error;
    }
    return { value, text: result.text, problems: [] };
  } catch (error) {
    if (error instanceof NamingError) throw error;
    if (NoObjectGeneratedError.isInstance(error)) {
      options.onCall?.(usageOf(error.usage));
      if (error.finishReason === "length")
        throw new NamingError(
          "budget",
          "The model's answer was cut off at its output limit: ask with a smaller budget",
        );
      if (error.finishReason === "content-filter")
        throw new NamingError("refused", "The model's provider filtered its answer out");
      const text = error.text ?? "";
      try {
        return { value: JSON.parse(text), text, problems: [] };
      } catch {
        return { text, problems: ["the answer is not JSON"] };
      }
    }
    if (NoOutputGeneratedError.isInstance(error))
      throw new NamingError("refused", "The model gave no answer");
    throw providerError(error);
  }
}

/**
 * A part's limit: a signal that stops its calls once `partTimeoutMs` has passed since the part
 * began, or when the caller's stops them, and what ends its timer once the part is done. The timer
 * is the platform's `setTimeout`, so that a test's fake clock moves it.
 */
function partLimit(options: NameOptions): { signal: AbortSignal | undefined; done: () => void } {
  const ms = options.partTimeoutMs;
  if (ms === undefined) return { signal: options.abortSignal, done: () => undefined };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("The part took longer than its limit", "TimeoutError")),
    ms,
  );
  const signal =
    options.abortSignal === undefined
      ? controller.signal
      : AbortSignal.any([options.abortSignal, controller.signal]);
  return { signal, done: () => clearTimeout(timer) };
}

/** How a request's parts are asked: alike, and each by its number. */
interface Asking {
  order: ReadonlyMap<string, number>;
  commands: readonly string[];
  partners: ReadonlySet<string>;
  /** How many settings the request has, which the preamble's parameters index. */
  settings: number;
  index: number;
  count: number;
}

/** A part's failure, as the part's: the part's macros, and its number where there are several. */
function inPart(error: NamingError, part: FailedPart): NamingError {
  const where = part.count > 1 ? `Part ${part.index} of ${part.count}: ` : "";
  return new NamingError(error.reason, `${where}${error.message}`, error.status, part);
}

/**
 * One part asked, within its own limit: its prompt, then, when the answer does not validate, does
 * not cover the part's macros exactly or does not fit the request, once more with the answer and
 * its problems quoted back. What it throws names the part.
 */
async function ask(part: Part, asking: Asking, options: NameOptions): Promise<ModelNaming> {
  const prompt = layOut(part.request, {
    preamble: part.preamble,
    order: asking.order,
    commands: asking.commands,
  });
  const asked = askedOf(part.request);
  const fit: Fit = {
    commands: asking.partners,
    ...(part.preamble ? { settings: asking.settings } : {}),
  };
  const limit = partLimit(options);
  try {
    let messages: ModelMessage[] = [{ role: "user", content: prompt }];
    let problems: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await call(messages, options, limit.signal);
      const found: { naming?: ModelNaming; problems: string[] } =
        reply.value === undefined ? { problems: reply.problems } : checked(reply.value, asked, fit);
      if (found.naming !== undefined) return found.naming;
      problems = found.problems;
      messages =
        reply.text === undefined || reply.text.trim() === ""
          ? [{ role: "user", content: `${prompt}\n\n${retryText(problems)}` }]
          : [
              { role: "user", content: prompt },
              { role: "assistant", content: reply.text },
              { role: "user", content: retryText(problems) },
            ];
    }
    throw new NamingError(
      "invalid",
      `The model's answer did not validate after a retry: ${problems.length} ${problems.length === 1 ? "problem" : "problems"}, the first ${problems[0] ?? "unknown"}`,
    );
  } catch (error) {
    if (!(error instanceof NamingError)) throw error;
    throw inPart(error, {
      index: asking.index,
      count: asking.count,
      macros: asked.map((macro) => ({ of: macro.of, name: macro.name })),
    });
  } finally {
    limit.done();
  }
}

/**
 * The model's answer to a naming request, already validated by the caller: an answer for each
 * macro and environment it asks, those with a key, and the preamble's. Asked in parts when its
 * prompt is over the budget (`batchesOf`), each told to `onPart` once it validates, the answers
 * merged in the request's order, the preamble's from the first part. Throws a `NamingError` that
 * says why, and which part, when the model gives no answer, its answer does not validate after a
 * retry, the call fails, or the request is too large to ask.
 */
export async function name(request: NamingRequest, options: NameOptions): Promise<ModelNaming> {
  if (typeof options.model === "string")
    throw new NamingError("provider", "The naming step takes a model, not a model's name");
  const commands = commandsOf(request, options.partners);
  const parts = batchesOf(request, options.budget, commands);
  const alike = {
    order: definitionOrder(request),
    commands,
    partners: new Set(commands),
    settings: request.preamble.settings.length,
    count: parts.length,
  };
  const answers: ModelNaming[] = [];
  for (const [i, part] of parts.entries()) {
    const answer = await ask(part, { ...alike, index: i + 1 }, options);
    answers.push(answer);
    await options.onPart?.(answer.macros);
  }
  const rank = new Map(askedOf(request).map((macro, i) => [identity(macro), i]));
  const place = (macro: { of: string; name: string }) => rank.get(identity(macro)) ?? rank.size;
  const naming: ModelNaming = {
    macros: answers.flatMap((answer) => answer.macros).sort((a, b) => place(a) - place(b)),
    preamble: answers[0]?.preamble ?? { parameters: [] },
  };
  const problems = coverage(naming, askedOf(request));
  if (problems.length > 0)
    throw new NamingError("invalid", `The model's answers do not add up: ${problems[0]}`);
  return naming;
}
