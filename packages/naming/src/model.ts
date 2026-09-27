/**
 * The naming step on a model (milestone 3 item 9, plan section 6 step 4, decision 0026): `name` asks
 * a language model, through the AI SDK, for the answer to a naming request, as structured output
 * against `ModelNaming` (`generateText` with `Output.object`), and checks what comes back: the
 * schema, its refinements included, and that it answers every macro the request asks, by its name
 * and whether a command or an environment, once, and nothing else. An answer that fails is asked
 * again once, with its problems quoted back; one that fails again throws.
 *
 * A request whose prompt is over the budget, counted in characters of what the model reads, is
 * asked in parts (`batchesOf`): each macro with the definitions it hands its work to, a definition
 * laid out once in each part that needs it, and the preamble's settings in the first part alone;
 * the answers are merged. The parts are laid out alike (`prompt.ts`), so that a provider's cache of
 * a prompt's start serves each; no provider's own cache is asked for.
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
import { askedOf, definitionOrder, INSTRUCTIONS, layOut, measure, retryText } from "./prompt.ts";
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

/**
 * What `name` throws: a plain-English message, which names macros and counts, never a request's
 * text, and why. `status` is the provider's HTTP status, where it answered with one.
 */
export class NamingError extends Error {
  readonly reason: NamingErrorReason;
  readonly status: number | undefined;
  constructor(reason: NamingErrorReason, message: string, status?: number) {
    super(message);
    this.name = "NamingError";
    this.reason = reason;
    this.status = status;
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
  abortSignal?: AbortSignal;
  /** Options for the provider, as `{ google: { structuredOutputs: false } }`. */
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
  /** Told each call's tokens, whether its answer was taken or not. */
  onCall?: (usage: NamingUsage) => void;
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

/**
 * The parts a request is asked in: its asked macros in order, as many to a part as keep its prompt
 * within the budget and BATCH_MACROS, each part holding the definitions its macros hand their work
 * to, once, and the first alone the preamble's settings. One part, for a request that fits. Throws
 * `budget` when a macro and its definitions are over the budget alone, or the preamble is.
 */
export function batchesOf(request: NamingRequest, budget: number = BUDGET): Part[] {
  const limit = Math.min(budget, BUDGET);
  const size = measure(request);
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
  const add = (part: Open, macro: RequestMacro, chars: number) => {
    part.macros.push(macro);
    part.own.add(macro.name);
    part.shared.delete(macro.name);
    for (const name of macro.dependencies)
      if (defined.has(name) && !part.own.has(name)) part.shared.add(name);
    part.chars += chars;
  };
  const parts: Open[] = [];
  let current = open(true);
  if (current.chars > limit)
    throw new NamingError(
      "budget",
      `The request's preamble is over the budget of ${limit} characters on its own`,
    );
  for (const macro of askedOf(request)) {
    let chars = cost(current, macro);
    if (
      current.macros.length > 0 &&
      (current.chars + chars > limit || current.macros.length >= BATCH_MACROS)
    ) {
      parts.push(current);
      current = open(false);
      chars = cost(current, macro);
    }
    if (current.chars + chars > limit)
      throw new NamingError(
        "budget",
        `The ${macro.of} "${macro.name}" and the definitions it hands its work to are over the budget of ${limit} characters on their own`,
      );
    add(current, macro, chars);
  }
  parts.push(current);
  return parts.map((part) => ({
    request: narrow(request, part.macros, part.preamble),
    preamble: part.preamble,
  }));
}

/** A macro as the problems name it: whether a command or an environment, and its name. */
const shown = (macro: { of: string; name: string }) => `${macro.of} "${macro.name}"`;

/** A macro's identity in an answer: its name, and whether a command or an environment. */
const identity = (macro: { of: string; name: string }) => `${macro.of}|${macro.name}`;

/**
 * What is wrong with an answer's coverage of the macros asked: one it does not answer, one it
 * answers twice, and one it answers that was not asked, each named.
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

/** A schema's problem with an answer, by the macro it is in where it is in one, and its field. */
function described(issue: { path: PropertyKey[]; message: string }, value: unknown): string {
  const [first, index, ...rest] = issue.path;
  const where = (path: PropertyKey[]) => path.map(String).join(".");
  if (first === "macros" && typeof index === "number") {
    const macros = (value as { macros?: unknown } | null)?.macros;
    const macro = Array.isArray(macros) ? (macros[index] as { of?: unknown; name?: unknown }) : {};
    const named =
      typeof macro?.of === "string" && typeof macro?.name === "string"
        ? `the answer for ${shown({ of: macro.of, name: macro.name })}`
        : `answer ${index + 1} of macros`;
    return `${named}${rest.length === 0 ? "" : `, at ${where(rest)}`}: ${issue.message}`;
  }
  return `${issue.path.length === 0 ? "the answer" : where(issue.path)}: ${issue.message}`;
}

/**
 * An answer checked: the schema's problems, its refinements among them, by macro and field; or,
 * when it validates, the macros asked that it leaves out, answers twice or adds.
 */
function checked(
  value: unknown,
  asked: readonly RequestMacro[],
): { naming?: ModelNaming; problems: string[] } {
  const parsed = ModelNaming.safeParse(value);
  if (!parsed.success)
    return { problems: parsed.error.issues.map((issue) => described(issue, value)) };
  const problems = coverage(parsed.data, asked);
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

/** The first line of a provider's message, cut short. */
function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

/** A failed call as a NamingError: the provider's status and first line, never the request. */
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
  return new NamingError(
    "provider",
    `The call to the model failed: ${firstLine(last instanceof Error ? last.message : String(last))}`,
  );
}

/** What one call gave back: the answer's value and text, or problems found before any value. */
interface Reply {
  value?: unknown;
  text?: string;
  problems: string[];
}

/** One call: the instructions, the messages, and the answer as structured output. */
async function call(messages: ModelMessage[], options: NameOptions): Promise<Reply> {
  try {
    const result = await generateText({
      model: options.model,
      instructions: INSTRUCTIONS,
      messages,
      output: Output.object({ schema: ModelNaming, name: "naming" }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
      ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
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
 * One part asked: its prompt, then, when the answer does not validate or does not cover the part's
 * macros exactly, once more with the answer and its problems quoted back.
 */
async function ask(
  part: Part,
  order: ReadonlyMap<string, number>,
  options: NameOptions,
): Promise<ModelNaming> {
  const prompt = layOut(part.request, { preamble: part.preamble, order });
  const asked = askedOf(part.request);
  let messages: ModelMessage[] = [{ role: "user", content: prompt }];
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await call(messages, options);
    const found: { naming?: ModelNaming; problems: string[] } =
      reply.value === undefined ? { problems: reply.problems } : checked(reply.value, asked);
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
}

/**
 * The model's answer to a naming request, already validated by the caller: an answer for each
 * macro and environment it asks, those with a key, and the preamble's. Asked in parts when its
 * prompt is over the budget (`batchesOf`), the answers merged in the request's order, the preamble's
 * from the first part. Throws a `NamingError` that says why when the model gives no answer, its
 * answer does not validate after a retry, the call fails, or the request is too large to ask.
 */
export async function name(request: NamingRequest, options: NameOptions): Promise<ModelNaming> {
  if (typeof options.model === "string")
    throw new NamingError("provider", "The naming step takes a model, not a model's name");
  const parts = batchesOf(request, options.budget);
  const order = definitionOrder(request);
  const answers: ModelNaming[] = [];
  for (const part of parts) answers.push(await ask(part, order, options));
  const naming: ModelNaming = {
    macros: answers.flatMap((answer) => answer.macros),
    preamble: answers[0]?.preamble ?? { parameters: [] },
  };
  const problems = coverage(naming, askedOf(request));
  if (problems.length > 0)
    throw new NamingError("invalid", `The model's answers do not add up: ${problems[0]}`);
  return naming;
}
