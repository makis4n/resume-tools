/**
 * The import over the corpus, in its one mode (the second pass's item 6): `corpus run` takes each
 * fetched document through the import a person's browser runs (`importResume`, decision 0049), in
 * Node, on the engine session, in the reference runner's pool of children (`runPool`), the child
 * being `corpus-import-child.ts`: the intake, the reference compile, the fonts, the signatures, the
 * parse, the probe, the outline and its four checks. Nothing is named, no answer is read and no
 * model is asked, so there is no mode to choose: the first pass's committed answers and its model
 * leave the run (decision 0055).
 *
 * What became of a document is one row, ids and counts only: its outcome, success or partial as
 * item 13's report says (`reportOfImport`, decision 0039), or where it stopped; its words in the
 * report's three shares, editable in place, changeable through the retype and locked, by reason;
 * its fields, required and kept by the checks, by reason; its groups, fixed by reason, and the
 * trials that kept the page; its compiles and the time each step took. The table adds them up per
 * family and in all, and the headline gives the shares. A run over the whole corpus is held to
 * `corpus/baseline.json` (`baselineVerdict`); `corpus compare` says whether runs agree, times aside.
 *
 * What is printed and written names documents by id, reasons, steps and counts, never a document's
 * text; each document's row is kept under `.corpus/import-run/`, a folder of the run's own.
 */

// Node runs this file by stripping its types, so it imports values only from files that import
// nothing Node lacks, and the editor's modules as types alone, with their real extensions.
import type { RefusalReason } from "../src/import/refusal.ts";
// The report imports nothing but types, so Node runs it as it is (decision 0039).
import { LOCK_WHY, type LockReason, SUCCESS_RATE } from "../src/import/report.ts";
import type { ImportStep } from "../src/import/run.ts";
import { earlyHeadline, earlyOf } from "./corpus-early.ts";
import { FAMILIES, type Family, printable } from "./corpus-manifest.ts";

/** How long one document may take: its pipeline, its probe and its checks. */
export const IMPORT_LIMIT_MS = 900_000;

/** The reasons a word or a field is locked or kept, in the order the table counts them. */
export const LOCK_REASONS = Object.keys(LOCK_WHY) as LockReason[];

/** Why the checks found a group fixed, in the order the table counts them. */
export const FIXED = ["copy", "removal", "untried", "stops"] as const;

/**
 * What became of a document: a success or partial, as item 13's report says; refused by a step
 * after the reference; or where it stopped: the intake or the reference compile refused it (`no
 * reference`), its body did not parse (`not parsed`), its body unmarked did not set its
 * reference's glyphs (`baseline`), or its child timed out or died.
 */
export const IMPORT_OUTCOMES = [
  "success",
  "partial",
  "refused",
  "no reference",
  "not parsed",
  "baseline",
  "timeout",
  "crashed",
] as const;
export type ImportOutcome = (typeof IMPORT_OUTCOMES)[number];

/** The steps of an import whose times a row keeps, in the pipeline's order (`IMPORT_STEPS`). */
export const STEPS = [
  "intake",
  "reference",
  "fonts",
  "rewrite",
  "signatures",
  "parse",
  "probe",
  "outline",
  "validate",
] as const satisfies readonly ImportStep[];

/** A document's words as item 13's report counts them, the template's own aside. */
export interface ImportWords {
  body: number;
  editable: number;
  retype: number;
  locked: number;
  byReason: Partial<Record<LockReason, number>>;
}

/** One document's row: names of reasons and steps, and numbers, never its text. */
export interface ImportRow {
  id: string;
  family: Family;
  outcome: ImportOutcome;
  engine?: "pdftex" | "xetex";
  /** Why a step refused it, the refusal's reason, and the step it refused at. */
  refused?: RefusalReason;
  step?: ImportStep;
  /** For one whose page differs from its reference's, the kind of its first difference. */
  difference?: string;
  /** Its words' share editable in place, which the success bar reads, and its words. */
  rate?: number;
  words?: ImportWords;
  /** Its fields: in the outline, required, and the probe's editable ones the checks kept, by why. */
  fields?: {
    editable: number;
    required: number;
    kept: Partial<Record<LockReason, number>>;
    /** The candidates each of check 2's texts stopped the compile with. */
    stops: { long: number; special: number; empty: number };
    /** Whether they take letters of other scripts, Greek and Cyrillic, each tried apart. */
    scripts: { greek: boolean; cyrillic: boolean };
  };
  /** Its groups of units, their units, those fixed by why, and those each kind of trial kept. */
  groups?: {
    found: number;
    units: number;
    fixed: Partial<Record<(typeof FIXED)[number], number>>;
    trials: { copy: number; first: number; last: number };
  };
  /** Whether it is read in Latin Modern, its Computer Modern in T1 or TS1 fonts the page lacks. */
  latinModern?: boolean;
  /** Its compiles in all, and the checks'. */
  compiles?: { all: number; checks: number };
  /** Milliseconds: each step's, the import's in all, and from being sent to its row coming back. */
  times: { steps?: Partial<Record<ImportStep, number>>; import?: number; wall: number };
}

/** A row as the child sends it, before the parent adds the document's id, family and time. */
export type ImportChildRow = Omit<ImportRow, "id" | "family" | "times"> & {
  times: Omit<ImportRow["times"], "wall">;
};

/** The outcome of a refusal, by the step it came at and its reason. */
export function refusedOutcome(step: ImportStep, reason: RefusalReason): ImportOutcome {
  if (step === "intake" || step === "reference") return "no reference";
  if (reason === "parse") return "not parsed";
  if (reason === "probe") return "baseline";
  return "refused";
}

/** Whether a document was imported: a success or partial. */
export const imported = (row: Pick<ImportRow, "outcome">) =>
  row.outcome === "success" || row.outcome === "partial";

// The summary.

/** What a run came to in all. */
export interface ImportSummary {
  documents: number;
  outcomes: Record<ImportOutcome, number>;
  /** The words of the documents imported, added up, in the report's three shares and by reason. */
  words: ImportWords;
  /**
   * The share of the documents that are a success, of those that did not time out, which a
   * machine's speed decides and count in no rate; and the words' three shares, in percent.
   */
  rates: { success: number; editable: number; retype: number; locked: number };
}

/** A percentage as the summary keeps it: two decimals. */
const percent = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((10_000 * part) / whole) / 100;

export function importSummary(rows: readonly ImportRow[]): ImportSummary {
  const outcomes = Object.fromEntries(IMPORT_OUTCOMES.map((each) => [each, 0])) as Record<
    ImportOutcome,
    number
  >;
  // A row of an outcome the outline's run never gives, as a first pass's file holds, is no count.
  for (const row of rows) if (row.outcome in outcomes) outcomes[row.outcome]++;
  const words: ImportWords = { body: 0, editable: 0, retype: 0, locked: 0, byReason: {} };
  for (const row of rows.filter(imported)) {
    const each = row.words;
    if (each === undefined) continue;
    words.body += each.body;
    words.editable += each.editable;
    words.retype += each.retype;
    words.locked += each.locked;
    for (const [reason, n] of Object.entries(each.byReason) as [LockReason, number][])
      words.byReason[reason] = (words.byReason[reason] ?? 0) + n;
  }
  words.byReason = Object.fromEntries(
    LOCK_REASONS.flatMap((each) => (words.byReason[each] ? [[each, words.byReason[each]]] : [])),
  );
  return {
    documents: rows.length,
    outcomes,
    words,
    rates: {
      success: percent(outcomes.success, rows.length - outcomes.timeout),
      editable: percent(words.editable, words.body),
      retype: percent(words.retype, words.body),
      locked: percent(words.locked, words.body),
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
 * others stopped, the words' three shares over the documents imported, and the locked words by
 * reason.
 */
export function importHeadline(rows: readonly ImportRow[]): string[] {
  const summary = importSummary(rows);
  const { outcomes, rates, words } = summary;
  // A document that timed out counts in no share: a machine's speed decides it.
  const n = summary.documents - outcomes.timeout;
  const rest = n - outcomes.success - outcomes.partial;
  const share = (count: number) => shown(n === 0 ? 0 : (100 * count) / n);
  const reasons = (Object.entries(words.byReason) as [LockReason, number][])
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .map(([reason, count]) => `${reason} ${count.toLocaleString("en-GB")}`);
  return [
    `${plural(summary.documents, "document")}, ${outcomes.timeout} of which timed out and ${outcomes.timeout === 1 ? "counts" : "count"} in no share; of the ${n} others, ${outcomes.success} success (${share(outcomes.success)}), ${outcomes.partial} partial (${share(outcomes.partial)}), ${rest} refused or stopped (${share(rest)}): ${outcomes.refused} refused, ${outcomes["no reference"]} with no reference, ${outcomes["not parsed"]} not parsed, ${outcomes.baseline} not probed, ${outcomes.crashed} died.`,
    `Words of the ${plural(outcomes.success + outcomes.partial, "document")} imported, ${plural(words.body, "word")}: ${shown(rates.editable)} editable in place, ${shown(rates.retype)} through the retype, ${shown(rates.locked)} locked${reasons.length === 0 ? "." : `, by reason: ${reasons.join(", ")}.`}`,
    // When the page opened, and every field, before the checks ended (decision 00XX).
    ...earlyHeadline(rows),
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
const PLAIN = /^[A-Za-z][A-Za-z. -]{0,31}$/;

/**
 * What the run came to, as one Markdown table, per family and in all: the outcomes, and where the
 * others stopped; the words' three shares and the locked words by reason; the fields, the groups
 * and the trials; and the compiles and times. Names of reasons and steps, and numbers, only.
 */
export function importTable(rows: readonly ImportRow[]): string {
  const of = (column: (typeof COLUMNS)[number]) =>
    rows.filter((row) => column === "all" || row.family === column);
  const line = (label: string, values: readonly (number | string)[]) =>
    `| ${label} | ${values.join(" | ")} |`;
  const count = (label: string, test: (row: ImportRow) => boolean) =>
    line(
      label,
      COLUMNS.map((column) => of(column).filter(test).length),
    );
  const sum = (label: string, pick: (row: ImportRow) => number) =>
    line(
      label,
      COLUMNS.map((column) => of(column).reduce((total, row) => total + pick(row), 0)),
    );
  const share = (label: string, part: (row: ImportRow) => number) =>
    line(
      label,
      COLUMNS.map((column) => {
        const total = of(column).reduce((all, row) => all + (row.words?.body ?? 0), 0);
        const some = of(column).reduce((all, row) => all + part(row), 0);
        return total === 0 ? "" : `${Math.round((100 * some) / total)}%`;
      }),
    );
  const middle = (label: string, pick: (row: ImportRow) => number | undefined, unit = "") =>
    line(
      label,
      COLUMNS.map((column) => {
        const value = median(of(column).flatMap((row) => pick(row) ?? []));
        return value === undefined ? "" : `${Math.round(value)}${unit}`;
      }),
    );
  const most = (label: string, pick: (row: ImportRow) => number | undefined, unit = "") =>
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
  const refusals = present(rows.flatMap((row) => (row.refused ? [row.refused] : [])));
  const differences = present(rows.flatMap((row) => row.difference ?? []));
  const lockedBy = LOCK_REASONS.filter((reason) =>
    rows.some((row) => (row.words?.byReason[reason] ?? 0) > 0),
  );
  const keptBy = LOCK_REASONS.filter((reason) =>
    rows.some((row) => (row.fields?.kept[reason] ?? 0) > 0),
  );
  const lines = [
    line("", COLUMNS),
    `|---|${COLUMNS.map(() => "--:").join("|")}|`,
    count("Documents", () => true),
    count(
      `**Success**: the page holds, and ${Math.round(SUCCESS_RATE * 100)}% of the words or more are editable in place`,
      (row) => row.outcome === "success",
    ),
    count("**Partial**: imported, short of a success", (row) => row.outcome === "partial"),
    count(
      "Partial: the page differs",
      (row) => row.outcome === "partial" && row.difference !== undefined,
    ),
    ...differences.map((kind) =>
      count(`Partial, the first difference: \`${kind}\``, (row) => row.difference === kind),
    ),
    count("**Refused** by a step", (row) => row.outcome === "refused"),
    count(
      "No reference: the intake or the reference compile refused it",
      (row) => row.outcome === "no reference",
    ),
    ...refusals.map((reason) =>
      count(`Refused or stopped: \`${reason}\``, (row) => row.refused === reason),
    ),
    count("Not parsed", (row) => row.outcome === "not parsed"),
    count(
      "Not probed: the body unmarked did not set the reference's glyphs",
      (row) => row.outcome === "baseline",
    ),
    count("Timed out: counted in no rate", (row) => row.outcome === "timeout"),
    count("Died", (row) => row.outcome === "crashed"),
    count("Read in Latin Modern", (row) => imported(row) && row.latinModern === true),
    section("Words, of the documents imported"),
    share("Editable in place", (row) => (imported(row) ? (row.words?.editable ?? 0) : 0)),
    share("Through the retype", (row) => (imported(row) ? (row.words?.retype ?? 0) : 0)),
    share("Locked", (row) => (imported(row) ? (row.words?.locked ?? 0) : 0)),
    sum("All", (row) => (imported(row) ? (row.words?.body ?? 0) : 0)),
    ...lockedBy.map((reason) =>
      sum(`Locked: \`${reason}\``, (row) =>
        imported(row) ? (row.words?.byReason[reason] ?? 0) : 0,
      ),
    ),
    count(
      `Documents with ${Math.round(SUCCESS_RATE * 100)}% or more editable in place`,
      (row) => imported(row) && (row.rate ?? 0) >= SUCCESS_RATE,
    ),
    section("Fields"),
    sum("In the outline", (row) => row.fields?.editable ?? 0),
    sum("Required: they stop the page when empty", (row) => row.fields?.required ?? 0),
    ...keptBy.map((reason) =>
      sum(`Kept as text by the checks: \`${reason}\``, (row) => row.fields?.kept[reason] ?? 0),
    ),
    ...(["long", "special", "empty"] as const).map((text) =>
      sum(`Stop the compile with the ${text} text`, (row) => row.fields?.stops[text] ?? 0),
    ),
    count("Documents whose fonts lack Greek", (row) => row.fields?.scripts.greek === false),
    count("Documents whose fonts lack Cyrillic", (row) => row.fields?.scripts.cyrillic === false),
    section("Groups of units"),
    sum("Groups", (row) => row.groups?.found ?? 0),
    sum("Units", (row) => row.groups?.units ?? 0),
    sum("A copy of the last unit keeps the page", (row) => row.groups?.trials.copy ?? 0),
    sum("The first unit's removal keeps it", (row) => row.groups?.trials.first ?? 0),
    sum("The last unit's removal keeps it", (row) => row.groups?.trials.last ?? 0),
    ...FIXED.map((why) => sum(`Fixed: \`${why}\``, (row) => row.groups?.fixed[why] ?? 0)),
    section("Compiles and time"),
    middle("Compiles, median", (row) => row.compiles?.all),
    middle("Compiles of the checks, median", (row) => row.compiles?.checks),
    most("Compiles of the checks, most", (row) => row.compiles?.checks),
    ...STEPS.map((step) => middle(`\`${step}\`, median`, (row) => row.times.steps?.[step], " ms")),
    middle("An import, median", (row) => (imported(row) ? row.times.import : undefined), " ms"),
    most("An import, slowest", (row) => (imported(row) ? row.times.import : undefined), " ms"),
    middle(
      "Its page opened, median",
      (row) => (imported(row) ? earlyOf(row).page : undefined),
      " ms",
    ),
    most(
      "Its page opened, slowest",
      (row) => (imported(row) ? earlyOf(row).page : undefined),
      " ms",
    ),
    most(
      "Every field open, slowest",
      (row) => (imported(row) ? earlyOf(row).unlocked : undefined),
      " ms",
    ),
    middle("A document, median", (row) => row.times.wall, " ms"),
  ];
  return `${lines.map(printable).join("\n")}\n`;
}

/** A row as a line of progress: its outcome and numbers, never text. */
export function importLine(row: ImportRow): string {
  const engine = row.engine === undefined ? "" : `${row.engine}, `;
  if (!imported(row)) {
    const why =
      row.refused === undefined
        ? ""
        : ` (${row.refused}${row.step === undefined ? "" : ` at ${row.step}`})`;
    return printable(`${engine}${row.outcome}${why}`);
  }
  const words = row.words;
  const of = (n: number) =>
    words === undefined || words.body === 0 ? 0 : Math.round((100 * n) / words.body);
  const difference =
    row.difference !== undefined && PLAIN.test(row.difference)
      ? `, the page differs (${row.difference})`
      : "";
  const fixed = Object.values(row.groups?.fixed ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
  return printable(
    `${engine}${row.outcome}${difference}, ${plural(words?.body ?? 0, "word")}: ${of(words?.editable ?? 0)}% in place, ${of(words?.retype ?? 0)}% retype, ${of(words?.locked ?? 0)}% locked; ${plural(row.fields?.editable ?? 0, "field")}, ${row.fields?.required ?? 0} required; ${plural(row.groups?.found ?? 0, "group")}, ${fixed} fixed; ${row.compiles?.all ?? 0} compiles, ${((row.times.import ?? 0) / 1000).toFixed(1)} s`,
  );
}

// The run's file.

/**
 * The run's JSON: which documents it took, its summary, and a row a document, in the shape `corpus
 * compare` reads (`runDifferences`); version 2, the outline's import, where the first pass's runs
 * were version 1.
 */
export interface ImportFile {
  version: 2;
  /** The day it started, and the commit it ran at, which a baseline adopted from the file names. */
  at: { date: string; commit: string | null };
  tree: { layout: number; files: number };
  limitMs: number;
  /** Every fetched document, or those `--only` or `--ids` name. */
  mode: { documents: "all" | "some" };
  /** Whether every document it took is in it: a run a signal stopped writes what it did. */
  complete: boolean;
  summary: ImportSummary;
  documents: ImportRow[];
}
