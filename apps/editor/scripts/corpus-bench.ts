/**
 * The naming model's benchmark (milestone 3 item 18, decision 0044): `corpus bench --model <id>`
 * takes the documents through `corpus run`'s pipeline, in its child (decision 0043), answering
 * each naming request from the model's own answers alone: the committed answers and every other
 * model's cache are left out, so that the model is asked for every macro its own folder does not
 * answer, behind the run's privacy gate and its stricter check, and its answers are filed in its
 * folder, `.corpus/cache/<id>/`, as the run files them. A second run of the same model answers from
 * that folder and asks nothing.
 *
 * What it reports of a candidate is `benchSummary`'s: the documents by outcome, as `outcomeOf`
 * gives them; the editable rate and the locked words by reason; the naming step's macros; each
 * part's time, its median, 90th percentile and slowest, with the slowest part's document and
 * number, and a request's parts together, which the naming service limits (decision 0028); the
 * calls, the tokens and their reasoning; the failures by kind; and the cost at the gateway's
 * reference prices, which it never bills. `chooseDefault` holds the candidates to the rule: the
 * highest editable rate whose slowest part stays within the service's two minutes, the faster on a
 * tie. Everything here names documents by id, and counts, kinds and milliseconds, never a
 * document's text.
 */

// Node runs this file by stripping its types, so it imports values only from files that import
// nothing Node lacks, and the editor's modules as types alone, with their real extensions.
import { THINKING_SWITCHES, type ThinkingSwitch } from "@resume-tools/naming/providers";
import { z } from "zod";
import type { LockReason } from "../src/import/assemble.ts";
import { LOCK_REASONS } from "./corpus-assemble.ts";
import { printable } from "./corpus-manifest.ts";
import { costOf, FAILURE_KINDS, type FailureKind, LIST_PRICES } from "./corpus-name.ts";
import {
  type Counted,
  RUN_OUTCOMES,
  type RunOutcome,
  type RunRow,
  type RunSummary,
  summaryOf,
} from "./corpus-run.ts";

/**
 * The naming service's two minutes for the model (decision 0028), which the rule holds a
 * candidate's slowest part to. The service gives them to a request's parts together, which the
 * summary reports beside (`requests`).
 */
export const PART_LIMIT_MS = 120_000;

/** The median of numbers: the middle one, or the mean of the two in the middle; none for none. */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * A percentile of numbers, by the nearest rank: the smallest of them that at least `p` percent of
 * them are at or under; none for none.
 */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

/**
 * A part the model was asked: its document, its number among the parts the document's step asked,
 * from 1, its time, its call and its retries, and its failure's kind, where it failed.
 */
export interface BenchPart {
  id: string;
  part: number;
  ms: number;
  failed?: FailureKind;
}

/** Every part the rows' naming steps asked, document by document, in the order asked. */
export function partsOf(rows: readonly RunRow[]): BenchPart[] {
  return rows.flatMap((row) =>
    (row.times.parts ?? []).map((ms, i) => {
      const failure = row.naming?.failure;
      return {
        id: row.id,
        part: i + 1,
        ms,
        ...(failure !== undefined && failure.part === i + 1 ? { failed: failure.kind } : {}),
      };
    }),
  );
}

/** What the benchmark found of a candidate, over the documents it took. */
export interface BenchSummary {
  model: string;
  /** How the model was asked not to reason first, where it was (`--thinking`). */
  thinking?: ThinkingSwitch;
  documents: number;
  outcomes: Record<RunOutcome, number>;
  /** The documents assembled, a success or partial, whose words the editable rate counts. */
  assembled: number;
  /** The run's two rates, in percent (`summaryOf`): the successes', and the editable words'. */
  rates: RunSummary["rates"];
  counted: Counted;
  locked: Partial<Record<LockReason, number>>;
  naming: {
    /** The macros and environments with a key, which the naming step answers. */
    macros: number;
    /** Answered from the model's own folder, filed by an earlier document or run. */
    cache: number;
    /** Asked of the model now, stored, never valid, and left with no answer. */
    asked: number;
    stored: number;
    invalid: number;
    missing: number;
    /** The requests the stricter check withheld from the model, the header's values given to it. */
    withheld: number;
    /** The documents whose request was asked of the model: an import that misses the cache. */
    imports: number;
  };
  parts: { count: number; median?: number; p90?: number; slowest?: BenchPart };
  /**
   * A document's parts together, as the naming service limits a request's (decision 0028): the
   * median over the documents that asked, and the slowest, its document and how many parts.
   */
  requests: { median?: number; slowest?: { id: string; ms: number; parts: number } };
  calls: number;
  tokens: { input: number; cached: number; output: number; reasoning: number };
  failures: Record<FailureKind, number>;
  /**
   * What the tokens would cost at the model's reference price (`LIST_PRICES`), in US dollars: in
   * all, and per import that asked. None without a price. The gateway bills nothing: its prices
   * count only toward a key's daily and monthly limits (decision 0036).
   */
  cost?: { read: string; total: number; perImport: number };
}

/** Whether a row's naming step asked the model a part: an import that missed the cache. */
const asked = (row: Pick<RunRow, "times">) => (row.times.parts ?? []).length > 0;

/** A candidate's summary, from the rows of its benchmark. */
export function benchSummary(
  model: string,
  rows: readonly RunRow[],
  thinking?: ThinkingSwitch,
): BenchSummary {
  const run = summaryOf(rows);
  const sum = (pick: (row: RunRow) => number | undefined) =>
    rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
  const parts = partsOf(rows);
  const times = parts.map((each) => each.ms);
  const slowest = parts.reduce<BenchPart | undefined>(
    (most, each) => (most === undefined || each.ms > most.ms ? each : most),
    undefined,
  );
  const requests = rows.filter(asked).map((row) => {
    const each = row.times.parts ?? [];
    return { id: row.id, ms: each.reduce((all, ms) => all + ms, 0), parts: each.length };
  });
  const slowestRequest = requests.reduce<(typeof requests)[number] | undefined>(
    (most, each) => (most === undefined || each.ms > most.ms ? each : most),
    undefined,
  );
  const tokens = {
    input: sum((row) => row.naming?.tokens.input),
    cached: sum((row) => row.naming?.tokens.cached),
    output: sum((row) => row.naming?.tokens.output),
    reasoning: sum((row) => row.naming?.tokens.reasoning),
  };
  const imports = rows.filter(asked).length;
  const failures = Object.fromEntries(FAILURE_KINDS.map((kind) => [kind, 0])) as Record<
    FailureKind,
    number
  >;
  for (const row of rows) {
    const kind = row.naming?.failure?.kind;
    if (kind !== undefined) failures[kind]++;
  }
  const price = LIST_PRICES[model];
  const total = price === undefined ? undefined : costOf(tokens, price);
  const p50 = median(times);
  const p90 = percentile(times, 90);
  const requestMedian = median(requests.map((each) => each.ms));
  return {
    model,
    ...(thinking === undefined ? {} : { thinking }),
    documents: run.documents,
    outcomes: run.outcomes,
    assembled: run.outcomes.success + run.outcomes.partial,
    rates: run.rates,
    counted: run.counted,
    locked: run.locked,
    naming: {
      macros: sum((row) => row.naming?.macros),
      cache: sum((row) => row.naming?.model),
      asked: sum((row) => row.naming?.asked),
      stored: sum((row) => row.naming?.stored),
      invalid: sum((row) => row.naming?.invalid),
      missing: sum((row) => row.naming?.missing),
      withheld: rows.filter((row) => row.naming?.gate === "withholds").length,
      imports,
    },
    parts: {
      count: parts.length,
      ...(p50 === undefined ? {} : { median: p50 }),
      ...(p90 === undefined ? {} : { p90 }),
      ...(slowest === undefined ? {} : { slowest }),
    },
    requests: {
      ...(requestMedian === undefined ? {} : { median: requestMedian }),
      ...(slowestRequest === undefined ? {} : { slowest: slowestRequest }),
    },
    calls: sum((row) => row.naming?.calls),
    tokens,
    failures,
    ...(price === undefined || total === undefined
      ? {}
      : { cost: { read: price.read, total, perImport: imports === 0 ? 0 : total / imports } }),
  };
}

// The choice.

/** What the rule says of each candidate, and the one it picks, if any. */
export interface Choice {
  chosen?: string;
  /** Each candidate, in the order given: whether its slowest part stays within the limit, and why. */
  verdicts: { model: string; within: boolean; why: string }[];
  line: string;
}

/** Seconds, as the table and the lines give them: one decimal. */
export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * Which candidate becomes the default (decision 0044): of those whose slowest part stays within the
 * limit, the naming service's two minutes, the highest editable rate, as the run's summary gives it
 * in percent to two decimals; on a tie, the faster, by the median part, then the 90th percentile,
 * then the slowest part; and on a tie of those too, the first by id, so that the order the
 * candidates come in decides nothing. A candidate that asked no part has no time to judge, as a
 * second run that answers from its cache, and is not chosen.
 */
export function chooseDefault(
  candidates: readonly BenchSummary[],
  limitMs: number = PART_LIMIT_MS,
): Choice {
  const verdicts = candidates.map((each) => {
    const slowest = each.parts.slowest;
    if (slowest === undefined)
      return {
        model: nameOf(each),
        within: false,
        why: "no part was asked, so there is no time to judge: its first run's file has them",
      };
    const within = slowest.ms <= limitMs;
    return {
      model: nameOf(each),
      within,
      why: `its slowest part took ${seconds(slowest.ms)} (${slowest.id}, part ${slowest.part}), ${within ? "within" : "over"} the ${seconds(limitMs)}`,
    };
  });
  const within = new Set(verdicts.filter((each) => each.within).map((each) => each.model));
  const order = (value: number | undefined) => value ?? Number.POSITIVE_INFINITY;
  const ranked = candidates
    .filter((each) => within.has(nameOf(each)))
    .sort(
      (a, b) =>
        b.rates.editable - a.rates.editable ||
        order(a.parts.median) - order(b.parts.median) ||
        order(a.parts.p90) - order(b.parts.p90) ||
        order(a.parts.slowest?.ms) - order(b.parts.slowest?.ms) ||
        (nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : 0),
    );
  const chosen = ranked[0];
  if (chosen === undefined)
    return {
      verdicts,
      line: `No candidate's slowest part stays within ${seconds(limitMs)}: the rule picks none.`,
    };
  const tied = ranked.filter((each) => each.rates.editable === chosen.rates.editable);
  return {
    chosen: nameOf(chosen),
    verdicts,
    line: `The default, by the rule: ${nameOf(chosen)}, ${chosen.rates.editable.toFixed(2)}% of the words editable${tied.length > 1 ? `, tied with ${tied.length - 1} more and the faster, its median part ${seconds(chosen.parts.median ?? 0)}` : ""}, its slowest part ${seconds(chosen.parts.slowest?.ms ?? 0)}, within ${seconds(limitMs)}.`,
  };
}

/** A candidate as the lines name it: its id, and its thinking switch, where it was asked so. */
export const nameOf = (summary: Pick<BenchSummary, "model" | "thinking">) =>
  `${summary.model}${summary.thinking === undefined ? "" : ` with thinking off (${summary.thinking})`}`;

// What is printed.

/** A count, as the table and the lines give one. */
const number = (value: number) => value.toLocaleString("en-GB");

/** A count and its noun, in the plural where it takes one. */
const plural = (count: number, noun: string) =>
  `${number(count)} ${count === 1 ? noun : `${noun}s`}`;

/** A word of a closed list as the table shows it, or a document's id. */
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9.:_-]{0,63}$/;

/** A row of the benchmark's per-document progress: its naming step, in counts and seconds. */
export function benchLine(row: RunRow): string {
  const naming = row.naming;
  if (naming === undefined) return "no naming step";
  const parts = row.times.parts ?? [];
  const tokens = naming.tokens;
  const failure = naming.failure;
  const asked =
    naming.asked === 0 && naming.calls === 0
      ? naming.gate === "withholds" && naming.missing > 0
        ? "withheld from the model by the stricter check"
        : `${plural(naming.model, "macro")} from its cache, nothing asked`
      : `${plural(naming.asked, "macro")} asked in ${plural(parts.length, "part")} (${parts.map(seconds).join(", ")}), ${naming.stored} stored, ${plural(naming.calls, "call")}, ${number(tokens.input)} tokens in, ${number(tokens.output)} out${tokens.reasoning === undefined ? "" : `, ${number(tokens.reasoning)} reasoning`}`;
  const failed =
    failure === undefined
      ? ""
      : `; failed, ${failure.kind}${failure.part === undefined ? "" : ` in part ${failure.part}`}: ${failure.message}`;
  return printable(`naming: ${asked}${failed}`);
}

/** The lines under a candidate's table: what it came to, its time, its cost, and what to know. */
export function benchHeadline(summary: BenchSummary): string[] {
  const { parts, requests, naming, cost } = summary;
  const time =
    parts.slowest === undefined
      ? `Nothing was asked of ${nameOf(summary)}: every macro with an answer came from its own folder, as a second run of the same model answers, so this run has no part's time, no call and no token; the first run's file holds them.`
      : `${plural(parts.count, "part")} asked: the median ${seconds(parts.median ?? 0)}, the 90th percentile ${seconds(parts.p90 ?? 0)}, the slowest ${seconds(parts.slowest.ms)} (${parts.slowest.id}, part ${parts.slowest.part}${parts.slowest.failed === undefined ? "" : `, ${parts.slowest.failed}`}); a request's parts together, the median ${seconds(requests.median ?? 0)} and the slowest ${seconds(requests.slowest?.ms ?? 0)} (${requests.slowest?.id ?? ""}, ${plural(requests.slowest?.parts ?? 0, "part")}).`;
  const money =
    cost === undefined
      ? `No reference price is recorded for ${summary.model}.`
      : `At the gateway's reference prices, read ${cost.read}, the tokens come to $${cost.total.toFixed(2)}, $${cost.perImport.toFixed(4)} an import that asked; the gateway bills nothing, and its prices count only toward a key's limits.`;
  const failures = FAILURE_KINDS.filter((kind) => summary.failures[kind] > 0).map(
    (kind) => `${kind} ${summary.failures[kind]}`,
  );
  return [
    `${nameOf(summary)}: ${plural(summary.documents, "document")}, ${summary.outcomes.success} success, ${summary.outcomes.partial} partial, ${summary.outcomes.refused} refused; ${summary.rates.editable.toFixed(2)}% of the ${plural(summary.counted.all, "word")} of the ${plural(summary.assembled, "document")} assembled editable on the page.`,
    `${plural(naming.macros, "macro")} with a key: ${number(naming.cache)} from its own folder, ${number(naming.asked)} asked, ${number(naming.stored)} stored, ${number(naming.invalid)} invalid, ${number(naming.missing)} missing; ${plural(naming.imports, "import")} asked the model, ${plural(summary.calls, "call")}, ${number(summary.tokens.input)} tokens in, ${number(summary.tokens.output)} out, ${number(summary.tokens.reasoning)} of them reasoning.`,
    time,
    failures.length === 0 ? "No part failed." : `Failed, by kind: ${failures.join(", ")}.`,
    money,
  ].map(printable);
}

/**
 * The candidates side by side, one column each, as one Markdown table: the outcomes, the editable
 * rate and the locked words, the naming step, the times, the calls and tokens, the failures by
 * kind, the cost, and whether the slowest part stays within the limit. Ids, counts and seconds.
 */
export function benchTable(
  summaries: readonly BenchSummary[],
  limitMs: number = PART_LIMIT_MS,
): string {
  const line = (label: string, values: readonly (number | string)[]) =>
    `| ${label} | ${values.join(" | ")} |`;
  const each = (label: string, pick: (summary: BenchSummary) => number | string) =>
    line(label, summaries.map(pick));
  const section = (label: string) =>
    line(
      `**${label}**`,
      summaries.map(() => ""),
    );
  const share = (count: number, of: number) =>
    of === 0 ? number(count) : `${number(count)} (${((100 * count) / of).toFixed(1)}%)`;
  const counted = (summary: BenchSummary) => summary.documents - summary.outcomes.timeout;
  const time = (ms: number | undefined) => (ms === undefined ? "" : seconds(ms));
  const reasons = LOCK_REASONS.filter((reason) =>
    summaries.some((summary) => (summary.locked[reason] ?? 0) > 0),
  );
  const lines = [
    line(
      "",
      summaries.map((summary) =>
        PLAIN.test(summary.model)
          ? `\`${summary.model}\`${summary.thinking === undefined ? "" : `, thinking off (${summary.thinking})`}`
          : "a model",
      ),
    ),
    `|---|${summaries.map(() => "--:").join("|")}|`,
    each("Documents", (summary) => number(summary.documents)),
    each("Success", (summary) => share(summary.outcomes.success, counted(summary))),
    each("Partial", (summary) => share(summary.outcomes.partial, counted(summary))),
    each("Refused by a step", (summary) => share(summary.outcomes.refused, counted(summary))),
    each("No answer for any macro the body calls", (summary) =>
      share(summary.outcomes["no answer"], counted(summary)),
    ),
    each("Stopped before the naming step: no reference, not parsed or not probed", (summary) =>
      number(
        summary.outcomes["no reference"] +
          summary.outcomes["not parsed"] +
          summary.outcomes.baseline,
      ),
    ),
    each("Timed out or died: counted in no share", (summary) =>
      number(summary.outcomes.timeout + summary.outcomes.crashed),
    ),
    each(
      "**Editable rate**: words editable on the page, of the documents assembled, as `outcomeOf` counts them",
      (summary) => `${summary.rates.editable.toFixed(2)}%`,
    ),
    each("Words counted, of the documents assembled", (summary) => number(summary.counted.all)),
    ...reasons.map((reason) =>
      each(`Words locked: \`${reason}\``, (summary) => number(summary.locked[reason] ?? 0)),
    ),
    section("The naming step"),
    each("Macros and environments with a key", (summary) => number(summary.naming.macros)),
    each("Answered from its own folder", (summary) => number(summary.naming.cache)),
    each("Asked of the model", (summary) => number(summary.naming.asked)),
    each("Stored", (summary) => number(summary.naming.stored)),
    each("Invalid: the answer never validated", (summary) => number(summary.naming.invalid)),
    each("Missing: no answer", (summary) => number(summary.naming.missing)),
    each("Requests withheld by the stricter check", (summary) => number(summary.naming.withheld)),
    each("Imports that asked the model", (summary) => number(summary.naming.imports)),
    section("Time"),
    each("Parts asked", (summary) => number(summary.parts.count)),
    each("A part, median", (summary) => time(summary.parts.median)),
    each("A part, 90th percentile", (summary) => time(summary.parts.p90)),
    each("A part, slowest", (summary) => time(summary.parts.slowest?.ms)),
    each("The slowest part: its document and number", (summary) => {
      const slowest = summary.parts.slowest;
      return slowest === undefined || !PLAIN.test(slowest.id)
        ? ""
        : `${slowest.id}, ${slowest.part}${slowest.failed === undefined ? "" : `, ${slowest.failed}`}`;
    }),
    each("A request's parts together, median", (summary) => time(summary.requests.median)),
    each("A request's parts together, slowest", (summary) => {
      const slowest = summary.requests.slowest;
      return slowest === undefined || !PLAIN.test(slowest.id)
        ? ""
        : `${seconds(slowest.ms)} (${slowest.id})`;
    }),
    section("Calls and tokens"),
    each("Model calls", (summary) => number(summary.calls)),
    each("Tokens in", (summary) => number(summary.tokens.input)),
    each("Tokens out, reasoning among them", (summary) => number(summary.tokens.output)),
    each("Of them, reasoning, as the gateway counts it", (summary) =>
      number(summary.tokens.reasoning),
    ),
    section("Failures, by kind"),
    ...FAILURE_KINDS.map((kind) =>
      each(`\`${kind}\``, (summary) => number(summary.failures[kind])),
    ),
    section("Cost at the reference prices; the gateway bills nothing"),
    each("In all", (summary) =>
      summary.cost === undefined ? "" : `$${summary.cost.total.toFixed(2)}`,
    ),
    each("An import that asked", (summary) =>
      summary.cost === undefined ? "" : `$${summary.cost.perImport.toFixed(4)}`,
    ),
    each(`**The slowest part within ${seconds(limitMs)}**`, (summary) =>
      summary.parts.slowest === undefined
        ? "no part"
        : summary.parts.slowest.ms <= limitMs
          ? "yes"
          : "no",
    ),
  ];
  return `${lines.map(printable).join("\n")}\n`;
}

// The benchmark's file.

/** A benchmark's JSON: the model, what it took, whether it finished, its summary and its rows. */
export interface BenchFile {
  version: 1;
  /** The day it started, and the commit it ran at. */
  at: { date: string; commit: string | null };
  model: string;
  /**
   * How the model was asked not to reason first, and how many times a failed call was tried
   * again, where the run said (`--thinking`, `--retries`).
   */
  thinking?: ThinkingSwitch;
  retries?: number;
  tree: { layout: number; files: number };
  limitMs: number;
  /** Every fetched document, or those `--only` or `--ids` name. */
  documents: "all" | "some";
  /** Whether every document it took is in it, and why not, where it stopped short. */
  complete: boolean;
  stopped?: string;
  summary: BenchSummary;
  rows: RunRow[];
}

/** A benchmark's file, loosely read: what the candidates' comparison reads of it. */
const LooseBench = z.looseObject({
  version: z.literal(1),
  model: z.string().min(1),
  thinking: z.enum(THINKING_SWITCHES).optional(),
  complete: z.boolean(),
  documents: z.enum(["all", "some"]),
  rows: z.array(
    z.looseObject({
      id: z.string(),
      outcome: z.enum(RUN_OUTCOMES),
      times: z.looseObject({}),
    }),
  ),
});

/**
 * The candidates of benchmarks' files, one column a model, each summarised again from its rows;
 * and what to know of them. Files of one model, in the order they ran, make one column: a later
 * run answers from the model's folder what an earlier one asked, the sample's documents in the
 * whole corpus's run, or those a run stopped by the key's daily budget had done before the next
 * day's, so each document's row is the last that asked the model a part, or else its last. A
 * column whose files did not finish, or that took other documents than the first, is said to be.
 */
export function candidatesOf(files: readonly unknown[]): {
  summaries: BenchSummary[];
  notes: string[];
} {
  const read = files.map((file, i) => {
    const parsed = LooseBench.safeParse(file);
    if (!parsed.success) throw new Error(`file ${i + 1} is no benchmark's file`);
    return { ...parsed.data, rows: parsed.data.rows as unknown as RunRow[] };
  });
  interface Column {
    files: typeof read;
    rows: Map<string, RunRow>;
  }
  // A model asked with its thinking off is a column of its own.
  const columns = new Map<string, Column>();
  const columnOf = (file: (typeof read)[number]) => `${file.model}|${file.thinking ?? ""}`;
  for (const file of read) {
    const column: Column = columns.get(columnOf(file)) ?? { files: [], rows: new Map() };
    column.files.push(file);
    for (const row of file.rows) {
      const before = column.rows.get(row.id);
      if (before === undefined || asked(row) || !asked(before)) column.rows.set(row.id, row);
    }
    columns.set(columnOf(file), column);
  }
  const notes: string[] = [];
  const idsOf = (rows: Iterable<string>) => [...rows].sort().join(",");
  const first = [...columns.values()][0];
  const summaries: BenchSummary[] = [];
  for (const column of columns.values()) {
    const { model, thinking } = column.files[0] ?? { model: "", thinking: undefined };
    const name = PLAIN.test(model) ? nameOf({ model, thinking }) : "a model";
    if (column.files.length > 1)
      notes.push(
        `${name}'s column joins ${column.files.length} files, each document's row the last that asked the model.`,
      );
    const whole = column.files.some((file) => file.complete && file.documents === "all");
    if (!column.files.every((file) => file.complete) && !whole)
      notes.push(`${name}'s benchmark did not finish: its column is partial.`);
    if (first !== undefined && idsOf(column.rows.keys()) !== idsOf(first.rows.keys()))
      notes.push(`${name} was measured on other documents than the first candidate.`);
    const rows = [...column.rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    summaries.push(benchSummary(model, rows, thinking));
  }
  return { summaries, notes: notes.map(printable) };
}
