/**
 * The whole import over the corpus (milestone 3 item 17, decision 0043): `corpus run` takes each
 * fetched document through every step in Node, on the engine session, in the reference runner's
 * pool of children (`runPool`), the child being `corpus assemble`'s (`corpus-assemble-child.ts`), so
 * that the run and the assembly share one pipeline: the intake, the reference compile, read in Latin
 * Modern where the page cannot draw its fonts, the signatures, the parse, the probe, the naming
 * request, built with the upload's sources, the page's strings and the header's values as the
 * import builds it, its answers, from the committed ones first and then the cache of the model
 * `NAMING_MODEL` names, unless `--committed-only`, and from the model only with `--allow-model` and
 * a key, behind the gate `corpus name --model` goes through; then the XeTeX rewrite, the assembly,
 * the four checks and the harness.
 *
 * What became of a document is one row, ids and counts only: its outcome, which `outcomeOf` gives
 * (the one place item 13's report takes over), its editable rate, its words and fields, editable and
 * locked by reason, its sections, controls, redefinitions, the harness's and the checks' findings,
 * its naming step, its compiles and the time each step took. The table adds them up per family and
 * in all, and the headline gives the shares and the locked words by reason. A `--committed-only` run
 * over the whole corpus is held to `corpus/baseline.json` (`baselineVerdict`); `corpus compare`
 * says whether runs agree, times aside (`runDifferences`).
 *
 * What is printed and written names documents by id, reasons, checks and controls, and counts,
 * never a document's text; each document's assembly and what the review reads of it (its request,
 * and its text for the export's leak check) stay under `.corpus/run/` alone.
 */

// Node runs this file by stripping its types, so it imports values only from files that import
// nothing Node lacks, and the editor's modules as types alone, with their real extensions.
import { availableParallelism } from "node:os";
import { z } from "zod";
import type { AssemblyChecks, LockReason } from "../src/import/assemble.ts";
import { ASSEMBLE_LIMIT_MS, assembleRow, LOCK_REASONS } from "./corpus-assemble.ts";
import { FAMILIES, type Family, printable } from "./corpus-manifest.ts";
import { MODEL_LIMIT_MS } from "./corpus-name.ts";
import { POOL_SIZE } from "./corpus-reference.ts";

/**
 * How long one document may take: its pipeline, its probe and its checks, as `corpus assemble`'s;
 * and with `--allow-model`, a model step's more, as `corpus name`'s.
 */
export const runLimitMs = (asking: boolean) => ASSEMBLE_LIMIT_MS + (asking ? MODEL_LIMIT_MS : 0);

/**
 * The share of a document's words that must be in editable fields for its import to be a success:
 * item 13's bar (plan section 5.7).
 */
export const SUCCESS_RATE = 0.9;

/**
 * What became of a document: a success or partial, as `outcomeOf` says; refused by a step, as the
 * Latin Modern swap, the naming request's builder, the XeTeX rewrite or the checks refuse one; or
 * where it stopped: the intake or the reference compile refused it (`no reference`), its body did
 * not parse, its body unmarked did not set its reference's glyphs (`baseline`), no macro it calls
 * has an answer, or its child timed out or died.
 */
export const RUN_OUTCOMES = [
  "success",
  "partial",
  "refused",
  "no reference",
  "not parsed",
  "baseline",
  "no answer",
  "timeout",
  "crashed",
] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** What an outcome is counted by: the words in editable fields, and all the words counted. */
export interface Counted {
  editable: number;
  all: number;
}

/** The rule `outcomeOf` holds a success to, as the table says it. */
export const OUTCOME_RULE = `the first check holds, and ${Math.round(SUCCESS_RATE * 100)}% of the words or more are editable`;

/**
 * What an import came to, its editable rate, and what the rate counts: the words in editable
 * fields over all the words the assembly counts, editable and locked, as decision 0026's table
 * counts them. For now a success is an import assembled whose first check holds and at least
 * SUCCESS_RATE of whose words are in editable fields (`OUTCOME_RULE`), and anything else assembled
 * is partial. The runner reads the outcome here alone, and adds up the counts it gives for the
 * corpus's rate, in the summary, the headline, the table and the baseline, so that item 13's report
 * replaces this function's body and nothing else.
 */
export function outcomeOf(assembled: { checks: Pick<AssemblyChecks, "outcome" | "words"> }): {
  outcome: "success" | "partial";
  rate: number;
  counted: Counted;
} {
  const { outcome, words } = assembled.checks;
  const locked = Object.values(words.locked).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const counted = { editable: words.editable, all: words.editable + locked };
  const rate = counted.all === 0 ? 0 : counted.editable / counted.all;
  return {
    outcome: outcome === "assembled" && rate >= SUCCESS_RATE ? "success" : "partial",
    rate,
    counted,
  };
}

/** A rate as a row keeps it: four decimals, so that the JSON reads, and two runs compare. */
const kept = (rate: number) => Math.round(rate * 10_000) / 10_000;

/**
 * The step that refused a document the pipeline took past its parse: the Latin Modern swap, the
 * naming request's builder, the XeTeX rewrite of its fonts or its check, or the validation, the
 * assembly and its checks. The child says it beside its rows, for `corpus review check`.
 */
export type RefusalStep = "latinModern" | "request" | "fonts" | "checks";

/** The naming step of a document, in counts: where its macros' answers came from, and the gate's word. */
export interface RunNaming {
  /** The request's macros and environments with a key: those the naming step answers. */
  macros: number;
  /** Answered from the committed answers, a person's or the review's, and from the model's cache. */
  reviewed: number;
  model: number;
  /** Whose key the cache holds another macro's answer under: a miss (`answerFor`'s refusal). */
  refused: number;
  /** Left with no answer. */
  missing: number;
  /** Asked of the model now, stored, never valid, and keys in conflict (`corpus name`'s counts). */
  asked: number;
  stored: number;
  invalid: number;
  conflicts: number;
  /** Why the model's answer was not taken, as the naming step's reason. */
  failed?: string;
  calls: number;
  tokens: { input: number; cached: number; output: number };
  /** Whether the privacy gate passes the request, or withholds it (`assertNoText`). */
  gate: "passes" | "withholds";
}

/** Milliseconds each step took, and the document's time in all; what `runDifferences` sets aside. */
export interface RunTimes {
  reference?: number;
  latinModern?: number;
  parse?: number;
  probe?: number;
  naming?: number;
  fonts?: number;
  checks?: number;
  /** From the document's being sent to its child to its row coming back. */
  wall: number;
}

/** One document's row: names of reasons, checks and controls, and numbers, never its text. */
export interface RunRow {
  id: string;
  family: Family;
  outcome: RunOutcome;
  engine?: "pdftex" | "xetex";
  /** Why a step refused it, the refusal's reason: a word of a closed list. */
  refused?: string;
  /** For one refused for a font the page cannot draw, the font: a name from the tree, no text. */
  font?: string;
  /** For one whose first check differs, the kind of its first difference. */
  difference?: string;
  /** Its editable rate, and what the rate counts, as `outcomeOf` gives them. */
  rate?: number;
  counted?: Counted;
  naming?: RunNaming;
  fields?: {
    editable: number;
    raw: number;
    required: number;
    locked: Partial<Record<LockReason, number>>;
  };
  words?: { editable: number; locked: Partial<Record<LockReason, number>> };
  sections?: { mapped: number; locked: number };
  controls?: { proven: string[]; dropped: string[] };
  redefinitions?: { applied: number; dropped: number };
  /** The harness's findings and the checks' own, by check. */
  findings?: Partial<Record<string, number>>;
  /** The kinds of unit whose adding or removing stopped the compile, and those the editor cannot add. */
  unrepeatable?: string[];
  fixed?: string[];
  /** Whether it is read in Latin Modern, its Computer Modern in T1 or TS1 being fonts the page cannot draw. */
  latinModern?: boolean;
  /** The probe's compiles, where it ran, and the checks', where they did. */
  compiles?: { probe: number; checks?: number };
  times: RunTimes;
}

/** A row as the child sends it, before the parent adds the document's id, family and time. */
export type RunChildRow = Omit<RunRow, "id" | "family" | "times"> & {
  times: Omit<RunTimes, "wall">;
};

/**
 * An assembled document's row, as the child sends it: `assembleRow`'s counts, and the outcome and
 * the rate `outcomeOf` gives.
 */
export function runRowOf(
  assembled: { checks: AssemblyChecks },
  engine: "pdftex" | "xetex",
  more: { naming?: RunNaming; probeCompiles: number; times: RunChildRow["times"] },
): RunChildRow {
  const { outcome, rate, counted } = outcomeOf(assembled);
  const row = assembleRow(assembled.checks, engine, { answered: 0, unanswered: 0 });
  return {
    outcome,
    engine,
    ...(row.difference === undefined ? {} : { difference: row.difference }),
    rate: kept(rate),
    counted,
    ...(more.naming === undefined ? {} : { naming: more.naming }),
    ...(row.fields === undefined ? {} : { fields: row.fields }),
    ...(row.words === undefined ? {} : { words: row.words }),
    ...(row.sections === undefined ? {} : { sections: row.sections }),
    controls: { proven: row.controls?.proven ?? [], dropped: row.controls?.dropped ?? [] },
    redefinitions: {
      applied: row.redefinitions?.applied.length ?? 0,
      dropped: row.redefinitions?.dropped.length ?? 0,
    },
    findings: row.findings ?? {},
    unrepeatable: row.unrepeatable ?? [],
    fixed: row.fixed ?? [],
    ...(row.latinModern === true ? { latinModern: true } : {}),
    compiles: { probe: more.probeCompiles, checks: row.compiles ?? 0 },
    times: more.times,
  };
}

// The summary.

/** Whether a document was assembled: a success or partial. */
export const assembled = (row: Pick<RunRow, "outcome">) =>
  row.outcome === "success" || row.outcome === "partial";

/**
 * What a run came to in all: the documents by outcome; what `outcomeOf` counted over the documents
 * assembled, added up, and the words the assembly locked in them, by reason; and the two rates, in
 * percent.
 */
export interface RunSummary {
  documents: number;
  outcomes: Record<RunOutcome, number>;
  counted: Counted;
  locked: Partial<Record<LockReason, number>>;
  /**
   * The share of the documents that are a success, of those that did not time out, which a machine's
   * speed decides and count in no rate; and of what `outcomeOf` counted that is editable.
   */
  rates: { success: number; editable: number };
}

/** A percentage as the summary keeps it: two decimals. */
const percent = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((10_000 * part) / whole) / 100;

export function summaryOf(rows: readonly RunRow[]): RunSummary {
  const outcomes = Object.fromEntries(RUN_OUTCOMES.map((each) => [each, 0])) as Record<
    RunOutcome,
    number
  >;
  for (const row of rows) outcomes[row.outcome]++;
  const counted: Counted = { editable: 0, all: 0 };
  const locked: Partial<Record<LockReason, number>> = {};
  for (const row of rows.filter(assembled)) {
    counted.editable += row.counted?.editable ?? 0;
    counted.all += row.counted?.all ?? 0;
    for (const [reason, n] of Object.entries(row.words?.locked ?? {}) as [LockReason, number][])
      locked[reason] = (locked[reason] ?? 0) + n;
  }
  return {
    documents: rows.length,
    outcomes,
    counted,
    locked: Object.fromEntries(
      LOCK_REASONS.flatMap((each) => (locked[each] ? [[each, locked[each]]] : [])),
    ),
    rates: {
      success: percent(outcomes.success, rows.length - outcomes.timeout),
      editable: percent(counted.editable, counted.all),
    },
  };
}

/** A count and its noun, in the plural where it takes one. */
const plural = (count: number, noun: string) =>
  `${count.toLocaleString("en-GB")} ${count === 1 ? noun : `${noun}s`}`;

/** A share as the headline shows it. */
const shown = (value: number) => `${value.toFixed(1)}%`;

/**
 * The headline under the table: the documents, the success, partial and other shares, where the
 * others stopped, the editable rate over the documents assembled, and the locked words by reason.
 */
export function runHeadline(rows: readonly RunRow[]): string[] {
  const summary = summaryOf(rows);
  const { outcomes } = summary;
  // A document that timed out counts in no share: a machine's speed decides it.
  const n = summary.documents - outcomes.timeout;
  const rest = n - outcomes.success - outcomes.partial;
  const share = (count: number) => shown(n === 0 ? 0 : (100 * count) / n);
  const reasons = (Object.entries(summary.locked) as [LockReason, number][])
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .map(([reason, count]) => `${reason} ${count.toLocaleString("en-GB")}`);
  return [
    `${plural(summary.documents, "document")}, ${outcomes.timeout} of which timed out and ${outcomes.timeout === 1 ? "counts" : "count"} in no share; of the ${n} others, ${outcomes.success} success (${share(outcomes.success)}), ${outcomes.partial} partial (${share(outcomes.partial)}), ${rest} refused or stopped (${share(rest)}): ${outcomes.refused} refused, ${outcomes["no reference"]} with no reference, ${outcomes["not parsed"]} not parsed, ${outcomes.baseline} not probed, ${outcomes["no answer"]} with no answer, ${outcomes.crashed} died.`,
    `Words in editable fields: ${shown(summary.rates.editable)} of ${plural(summary.counted.all, "word")} in the ${plural(outcomes.success + outcomes.partial, "document")} assembled${reasons.length === 0 ? "." : `; locked, by reason: ${reasons.join(", ")}.`}`,
  ].map(printable);
}

// The table.

const COLUMNS = [...FAMILIES, "all"] as const;

/** The median of numbers, or undefined for none. */
function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** A word of a closed list as the table shows it: letters, dashes and dots, and nothing else. */
const PLAIN = /^[A-Za-z][A-Za-z.-]{0,31}$/;

/** The steps whose times the table gives, in the pipeline's order. */
const STEPS = ["reference", "latinModern", "parse", "probe", "naming", "fonts", "checks"] as const;

/**
 * What the run came to, as one Markdown table, per family and in all: the outcomes, and where the
 * others stopped; the words in editable fields and the words locked by reason; the fields, the
 * sections, the controls and the findings; the naming step; and the compiles and times. Names of
 * reasons, checks and controls, and numbers, only.
 */
export function runTable(rows: readonly RunRow[]): string {
  const of = (column: (typeof COLUMNS)[number]) =>
    rows.filter((row) => column === "all" || row.family === column);
  const line = (label: string, values: readonly (number | string)[]) =>
    `| ${label} | ${values.join(" | ")} |`;
  const count = (label: string, test: (row: RunRow) => boolean) =>
    line(
      label,
      COLUMNS.map((column) => of(column).filter(test).length),
    );
  const sum = (label: string, pick: (row: RunRow) => number) =>
    line(
      label,
      COLUMNS.map((column) => of(column).reduce((total, row) => total + pick(row), 0)),
    );
  const share = (label: string, part: (row: RunRow) => number, whole: (row: RunRow) => number) =>
    line(
      label,
      COLUMNS.map((column) => {
        const total = of(column).reduce((all, row) => all + whole(row), 0);
        const some = of(column).reduce((all, row) => all + part(row), 0);
        return total === 0 ? "" : `${Math.round((100 * some) / total)}%`;
      }),
    );
  const middle = (label: string, pick: (row: RunRow) => number | undefined, unit = "") =>
    line(
      label,
      COLUMNS.map((column) => {
        const value = median(of(column).flatMap((row) => pick(row) ?? []));
        return value === undefined ? "" : `${Math.round(value)}${unit}`;
      }),
    );
  const most = (label: string, pick: (row: RunRow) => number | undefined, unit = "") =>
    line(
      label,
      COLUMNS.map((column) => {
        const values = of(column).flatMap((row) => pick(row) ?? []);
        return values.length === 0 ? "" : `${Math.round(Math.max(...values))}${unit}`;
      }),
    );
  const section = (label: string) =>
    line(
      `**${label}**`,
      COLUMNS.map(() => ""),
    );
  const present = (names: Iterable<string>) =>
    [...new Set(names)].filter((each) => PLAIN.test(each)).sort();
  const refusals = present(
    rows.flatMap((row) => (row.outcome === "refused" && row.refused ? [row.refused] : [])),
  );
  const stoppedAt = present(
    rows.flatMap((row) => (row.outcome === "no reference" && row.refused ? [row.refused] : [])),
  );
  const differences = present(rows.flatMap((row) => row.difference ?? []));
  const reasons = LOCK_REASONS.filter((reason) =>
    rows.some((row) => (row.words?.locked[reason] ?? 0) > 0),
  );
  const partsLocked = LOCK_REASONS.filter((reason) =>
    rows.some((row) => (row.fields?.locked[reason] ?? 0) > 0),
  );
  const controls = ["pageSize", "margins", "fontSize", "font", "accent", "density"];
  const dropped = controls.filter((name) =>
    rows.some((row) => row.controls?.dropped.includes(name)),
  );
  const findings = present(rows.flatMap((row) => Object.keys(row.findings ?? {})));
  const failures = present(rows.flatMap((row) => row.naming?.failed ?? []));
  const lines = [
    line("", COLUMNS),
    `|---|${COLUMNS.map(() => "--:").join("|")}|`,
    count("Documents", () => true),
    count(`**Success**: ${OUTCOME_RULE}`, (row) => row.outcome === "success"),
    count("**Partial**: assembled, short of a success", (row) => row.outcome === "partial"),
    count(
      "Partial: the first check differs",
      (row) => row.outcome === "partial" && row.difference !== undefined,
    ),
    ...differences.map((kind) =>
      count(`Partial, the first difference: \`${kind}\``, (row) => row.difference === kind),
    ),
    count("**Refused** by a step", (row) => row.outcome === "refused"),
    ...refusals.map((reason) =>
      count(`Refused: \`${reason}\``, (row) => row.outcome === "refused" && row.refused === reason),
    ),
    count(
      "No reference: the intake or the reference compile refused it",
      (row) => row.outcome === "no reference",
    ),
    ...stoppedAt.map((reason) =>
      count(
        `No reference: \`${reason}\``,
        (row) => row.outcome === "no reference" && row.refused === reason,
      ),
    ),
    count("Not parsed", (row) => row.outcome === "not parsed"),
    count(
      "Not probed: the body unmarked did not set the reference's glyphs",
      (row) => row.outcome === "baseline",
    ),
    count("No answer for any macro the body calls", (row) => row.outcome === "no answer"),
    count("Timed out: counted in no rate", (row) => row.outcome === "timeout"),
    count("Died", (row) => row.outcome === "crashed"),
    count("Read in Latin Modern", (row) => assembled(row) && row.latinModern === true),
    section("Words, of the documents assembled"),
    share(
      "In editable fields, as `outcomeOf` counts them",
      (row) => (assembled(row) ? (row.counted?.editable ?? 0) : 0),
      (row) => (assembled(row) ? (row.counted?.all ?? 0) : 0),
    ),
    sum("All, as `outcomeOf` counts them", (row) => (assembled(row) ? (row.counted?.all ?? 0) : 0)),
    ...reasons.map((reason) =>
      sum(`Locked: \`${reason}\``, (row) =>
        assembled(row) ? (row.words?.locked[reason] ?? 0) : 0,
      ),
    ),
    section("Fields"),
    sum("Editable", (row) => row.fields?.editable ?? 0),
    sum("Raw: set, and edited in the panel alone", (row) => row.fields?.raw ?? 0),
    sum("Required", (row) => row.fields?.required ?? 0),
    ...partsLocked.map((reason) =>
      sum(`Parts locked: \`${reason}\``, (row) => row.fields?.locked[reason] ?? 0),
    ),
    sum("Sections mapped onto the model", (row) => row.sections?.mapped ?? 0),
    sum("Sections locked", (row) => row.sections?.locked ?? 0),
    section("Controls and redefinitions, documents"),
    ...controls.map((name) =>
      count(`\`${name}\` proven`, (row) => row.controls?.proven.includes(name) === true),
    ),
    ...dropped.map((name) =>
      count(`\`${name}\` dropped`, (row) => row.controls?.dropped.includes(name) === true),
    ),
    count("Redefinitions applied", (row) => (row.redefinitions?.applied ?? 0) > 0),
    count("Redefinitions dropped", (row) => (row.redefinitions?.dropped ?? 0) > 0),
    section("Findings, documents"),
    ...findings.map((check) => count(`\`${check}\``, (row) => (row.findings?.[check] ?? 0) > 0)),
    count(
      "No finding, the harness's or the checks'",
      (row) => assembled(row) && Object.keys(row.findings ?? {}).length === 0,
    ),
    count(
      "A unit added or removed stops the compile",
      (row) => (row.unrepeatable ?? []).length > 0,
    ),
    section("The naming step"),
    sum("Macros and environments to answer", (row) => row.naming?.macros ?? 0),
    sum("Answered from the committed answers", (row) => row.naming?.reviewed ?? 0),
    sum("Answered from the model's cache", (row) => row.naming?.model ?? 0),
    sum(
      "Refused from the cache: another macro's answer under its key",
      (row) => row.naming?.refused ?? 0,
    ),
    sum("Asked of the model now", (row) => row.naming?.asked ?? 0),
    sum("Stored now", (row) => row.naming?.stored ?? 0),
    sum("Missing: no answer", (row) => row.naming?.missing ?? 0),
    count("Requests the privacy gate withholds", (row) => row.naming?.gate === "withholds"),
    ...failures.map((reason) =>
      count(`The model's answer failed: \`${reason}\``, (row) => row.naming?.failed === reason),
    ),
    sum("Model calls", (row) => row.naming?.calls ?? 0),
    section("Compiles and time"),
    middle("Compiles of the probe, median", (row) => row.compiles?.probe),
    middle("Compiles of the checks, median", (row) =>
      assembled(row) ? row.compiles?.checks : undefined,
    ),
    most("Compiles of the checks, most", (row) =>
      assembled(row) ? row.compiles?.checks : undefined,
    ),
    ...STEPS.map((step) => middle(`\`${step}\`, median`, (row) => row.times[step], " ms")),
    middle("A document, median", (row) => row.times.wall, " ms"),
    most("A document, slowest", (row) => row.times.wall, " ms"),
  ];
  return `${lines.map(printable).join("\n")}\n`;
}

/** A row as a line of progress: its outcome, and numbers, never text. */
export function runLine(row: RunRow): string {
  const engine = row.engine === undefined ? "" : `${row.engine}, `;
  const why = row.refused !== undefined && PLAIN.test(row.refused) ? ` (${row.refused})` : "";
  if (!assembled(row)) return printable(`${engine}${row.outcome}${why}`);
  const difference =
    row.difference !== undefined && PLAIN.test(row.difference)
      ? `, the first check differs (${row.difference})`
      : "";
  return printable(
    `${engine}${row.outcome}${difference}, ${Math.round(100 * (row.rate ?? 0))}% of ${plural(row.counted?.all ?? 0, "word")} editable, ${plural(row.fields?.editable ?? 0, "field")} editable, ${row.compiles?.checks ?? 0} compiles, ${Math.round(row.times.wall / 1000)} s`,
  );
}

// The run's file.

/** What answers a run reads, and whether it asks the model. */
export interface RunMode {
  /** The committed answers alone, or with the model's cache. */
  answers: "committed" | "cache";
  /** The model whose cache folder is read, with `answers: "cache"`. */
  cache: string | null;
  /** The model asked for what the cache does not answer, with `--allow-model`. */
  asked: string | null;
  /** Every fetched document, or those `--only` or `--ids` name. */
  documents: "all" | "some";
}

/** The run's JSON: its mode, its summary, and a row a document. */
export interface RunFile {
  version: 1;
  /** The day it started, and the commit it ran at, which a baseline adopted from the file names. */
  at: { date: string; commit: string | null };
  tree: { layout: number; files: number };
  limitMs: number;
  mode: RunMode;
  /** Whether every document it took is in it: a run a signal stopped writes what it did. */
  complete: boolean;
  summary: RunSummary;
  documents: RunRow[];
}

/** A value's differences from another, each a path and the two values, times aside. */
function differences(a: unknown, b: unknown, path: string, out: string[]) {
  if (a === b) return;
  const bothObjects = a !== null && b !== null && typeof a === "object" && typeof b === "object";
  if (!bothObjects || Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: ${JSON.stringify(a) ?? "absent"} against ${JSON.stringify(b) ?? "absent"}`);
    return;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const key of keys)
    differences(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      `${path}.${key}`,
      out,
    );
}

/** A run's JSON, loosely read: what `runDifferences` compares. */
const LooseRun = z.looseObject({
  at: z.unknown().optional(),
  documents: z.array(z.looseObject({ id: z.string(), times: z.unknown().optional() })),
});

/**
 * Where two runs' JSON differ, times aside: each document's by its id, its `times` left out, and
 * everything else of the file; each a line naming the path and the two values, which are counts and
 * the words of closed lists. None when they agree.
 */
export function runDifferences(first: unknown, second: unknown): string[] {
  const a = LooseRun.parse(first);
  const b = LooseRun.parse(second);
  const out: string[] = [];
  // When and at which commit a run ran is no result of it, as its times are not.
  const { documents: rowsA, at: _atA, ...restA } = a;
  const { documents: rowsB, at: _atB, ...restB } = b;
  differences(restA, restB, "run", out);
  const byId = (rows: typeof rowsA) =>
    new Map(rows.map(({ times: _times, ...row }) => [row.id, row] as const));
  const one = byId(rowsA);
  const two = byId(rowsB);
  for (const id of [...new Set([...one.keys(), ...two.keys()])].sort())
    differences(one.get(id), two.get(id), id, out);
  return out.map(printable);
}

// What `.corpus/run/` holds.

/**
 * The record of the last run under `.corpus/run/run.json`: a stamp of its own, which each document's
 * `review.json` it keeps carries too; what answers it read, the committed alone or with a model's
 * cache, and the model it asked, if any; whether it took every fetched document or some, and which;
 * and whether it finished. The review's export and check read it (`runMismatch`).
 */
export const RunRecord = z.strictObject({
  version: z.literal(1),
  stamp: z.string().min(1).max(64),
  answers: z.enum(["committed", "cache"]),
  cache: z.string().nullable(),
  asked: z.string().nullable(),
  documents: z.enum(["all", "some"]),
  ids: z.array(z.string()),
  complete: z.boolean(),
});
export type RunRecord = z.infer<typeof RunRecord>;

// The baseline.

/** The baseline a `--committed-only` run over the whole corpus is held to. */
export const Baseline = z.strictObject({
  version: z.literal(1),
  /** None yet: the placeholder, which nothing is compared with. */
  run: z
    .strictObject({
      date: z.iso.date(),
      commit: z.string().regex(/^[0-9a-f]{40}$/),
      documents: z.int().min(1),
      /** The documents that timed out, which count in neither its success rate nor a run's. */
      timeouts: z.int().min(0),
      success: z.int().min(0),
      rates: z.strictObject({
        success: z.number().min(0).max(100),
        editable: z.number().min(0).max(100),
      }),
    })
    .nullable(),
});
export type Baseline = z.infer<typeof Baseline>;

/** How far under the baseline's success rate a run may fall, in points, before it fails. */
export const BASELINE_SLACK = 1;

/**
 * What a run's summary says against the baseline, in one line, and whether the run fails: only a
 * `--committed-only` run over the whole corpus is compared, and it fails when its success rate falls
 * more than BASELINE_SLACK points under the baseline's; a baseline with no run is none yet.
 */
export function baselineVerdict(
  summary: Pick<RunSummary, "documents" | "outcomes">,
  baseline: Baseline,
  scope: { committedOnly: boolean; whole: boolean },
): { compared: boolean; failed: boolean; line: string } {
  if (!scope.committedOnly || !scope.whole)
    return {
      compared: false,
      failed: false,
      line: "Not held to corpus/baseline.json: only a --committed-only run over the whole corpus is.",
    };
  const base = baseline.run;
  if (base === null)
    return {
      compared: false,
      failed: false,
      line: "No baseline yet: corpus/baseline.json holds no run, so nothing is compared.",
    };
  // A document that timed out counts in no rate: a machine's speed decides it.
  const counted = summary.documents - summary.outcomes.timeout;
  const rate = counted === 0 ? 0 : (100 * summary.outcomes.success) / counted;
  const of = `the baseline's ${shown(base.rates.success)} (${base.date}, ${base.commit.slice(0, 7)})`;
  if (rate < base.rates.success - BASELINE_SLACK)
    return {
      compared: true,
      failed: true,
      line: `The success rate, ${shown(rate)}, fell more than ${BASELINE_SLACK} point under ${of}.`,
    };
  return {
    compared: true,
    failed: false,
    line: `The success rate, ${shown(rate)}, holds against ${of}${rate > base.rates.success ? ": a pull request raises the baseline by hand" : ""}.`,
  };
}

/** The baseline a run gives: its summary's rates, the day and the commit. */
export function baselineOf(summary: RunSummary, date: string, commit: string): Baseline {
  return Baseline.parse({
    version: 1,
    run: {
      date,
      commit,
      documents: summary.documents,
      timeouts: summary.outcomes.timeout,
      success: summary.outcomes.success,
      rates: summary.rates,
    },
  });
}

/**
 * What `--write-baseline` does with a run's summary: the baseline to write, or why none is. Only a
 * `--committed-only` run over the whole corpus gives one, and never one whose success rate falls more
 * than BASELINE_SLACK points under the baseline it would replace: a person lowers a baseline by
 * editing the file in a pull request, where it is read, and never by running the corpus.
 */
export function nextBaseline(input: {
  summary: RunSummary;
  baseline: Baseline;
  scope: { committedOnly: boolean; whole: boolean };
  date: string;
  commit: string;
}): { baseline?: Baseline; line: string } {
  if (!input.scope.committedOnly || !input.scope.whole)
    return {
      line: "corpus/baseline.json is not written: only a --committed-only run over the whole corpus gives one.",
    };
  const verdict = baselineVerdict(input.summary, input.baseline, input.scope);
  if (verdict.failed)
    return {
      line: "corpus/baseline.json is not written: the run falls more than a point under it, and a baseline is lowered only by a pull request that edits it.",
    };
  return {
    baseline: baselineOf(input.summary, input.date, input.commit),
    line: `Wrote corpus/baseline.json from the run, at ${input.commit.slice(0, 7)}.`,
  };
}

/**
 * What `--write-baseline --from <run.json>` does with a run's file, as CI's run leaves it: the
 * baseline it gives, or why none, as `nextBaseline` has it, the run's summary counted again from its
 * rows, its day and its commit its own; only a file of a finished `--committed-only` run over the
 * whole corpus, which names its commit, gives one.
 */
export function baselineFromFile(
  file: unknown,
  baseline: Baseline,
): { baseline?: Baseline; line: string } {
  const run = z
    .looseObject({
      at: z.strictObject({ date: z.iso.date(), commit: z.string().regex(/^[0-9a-f]{40}$/) }),
      mode: z.looseObject({ answers: z.string(), documents: z.string() }),
      complete: z.literal(true),
      documents: z.array(z.looseObject({ id: z.string(), outcome: z.enum(RUN_OUTCOMES) })),
    })
    .safeParse(file);
  if (!run.success)
    return {
      line: "corpus/baseline.json is not written: the file is no finished run's, naming its commit.",
    };
  return nextBaseline({
    summary: summaryOf(run.data.documents as unknown as RunRow[]),
    baseline,
    scope: {
      committedOnly: run.data.mode.answers === "committed",
      whole: run.data.mode.documents === "all",
    },
    date: run.data.at.date,
    commit: run.data.at.commit,
  });
}

/**
 * How many children a run takes at once: the reference runner's four, or fewer on a machine with
 * fewer cores, as a private repository's free runner, which has two.
 */
export const poolSize = (cores = availableParallelism()) => Math.max(1, Math.min(POOL_SIZE, cores));

/** The baseline's own file, from the repository's top, as `git status` names it. */
const BASELINE_PATH = "apps/editor/corpus/baseline.json";

/**
 * The paths `git status --porcelain` names, the baseline's own aside: tracked files changed, and
 * files git does not track, as an answer written under `corpus/answers/` and not yet committed is,
 * which a run reads all the same; what git ignores it names none of.
 */
export function changedPaths(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3))
    .filter((path) => path !== BASELINE_PATH);
}

// The documents a run takes.

/** An id, as the manifest gives them: a family, a dash and four digits. */
const ID = /^[a-z][a-z-]*-\d{4}$/;

/**
 * The ids a file names for `--ids`: one a line, blank lines and lines from `#` aside; a line that
 * is no id is an error, named by its number, never its text.
 */
export function idsOf(text: string): string[] {
  const ids: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") return;
    if (!ID.test(line)) throw new Error(`line ${i + 1} of the --ids file is not a document's id`);
    if (!ids.includes(line)) ids.push(line);
  });
  return ids;
}
