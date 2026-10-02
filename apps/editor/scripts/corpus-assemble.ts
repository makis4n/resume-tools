/**
 * Assembly over the corpus (milestone 3 item 7, decision 0026): `corpus assemble` takes each
 * fetched document in as the probe runner does (`corpus-probe.ts`), and for each whose body parses
 * and whose macros have an answer in `corpus/answers/` (the seed, until item 9's model answers the
 * rest), probes it, assembles its package and document from the answer (`src/import/assemble.ts`)
 * and validates them with the four checks and the harness (`src/import/validate.ts`); and prints one
 * table, per family and in all: the documents assembled, partial and refused, the fields editable,
 * required and locked by reason, item 13's report of each, its words read from the page, its rate
 * and whether it succeeds (`reportOf`, decision 0039), the controls proven and dropped and the
 * milestone's bar, page size, margins and font size proven on every successful import (decision
 * 0040), the harness's findings by check, and the compiles and times.
 *
 * The documents go to the reference runner's pool of child processes (`runPool`), with a longer
 * time than the probe's, since a document's probe and its checks both compile it, whole on XeTeX
 * until item 8. The child is `corpus-assemble-child.ts`, which `corpus oracle` uses too.
 *
 * What is printed and written names macros, reasons and counts, never a document's text; each
 * document's assembled package and document, which hold its text, stay under `.corpus/` alone.
 */

// Node runs this file by stripping its types, so it imports values only from files that import
// nothing Node lacks, and the editor's modules as types alone, with their real extensions.
import { type AnswerCache, answerFor, type StoredAnswer } from "@resume-tools/naming";
import type { AssemblyChecks, LockReason } from "../src/import/assemble.ts";
// The report imports nothing but types, so Node runs it as it is (decision 0039).
import { percent, type Report, SUCCESS_RATE } from "../src/import/report.ts";
import { FAMILIES, type Family, printable } from "./corpus-manifest.ts";

/** How long one document may take: its pipeline, its probe, its assembly and its checks. */
export const ASSEMBLE_LIMIT_MS = 900_000;

/** The reasons a field or a part is locked, in the order the table counts them. */
export const LOCK_REASONS: readonly LockReason[] = [
  "raw",
  "breaks",
  "vanished",
  "twice",
  "moved",
  "misaligned",
  "case",
  "split",
  "untested",
  "date",
  "shape",
  "unmapped",
  "differs",
  "text",
  "fields",
  "alignment",
];

/** The harness's checks, in the order the table counts their findings. */
export const CHECKS = [
  "dump",
  "compile",
  "converges",
  "controls",
  "edits",
  "pages",
  "fields",
  "alignment",
  "fonts",
  "special",
  "pdf",
] as const;

/**
 * The checks' own findings beside the harness's, in the order the table counts them: `stopped`,
 * `untested` and `unproven`, as `validate.ts` names them (`NOTES`), which this file cannot import.
 */
export const CHECK_NOTES = ["stopped", "untested", "unproven"] as const;

/** Why a control is dropped that the checks never tried, as `validate.ts` says it (`UNCHECKED`). */
export const UNCHECKED_WHY = "unchecked";

/**
 * The other reasons a control is dropped, or how they begin, as `validate.ts` says them
 * (`DROPPED`).
 */
export const DROPPED_WHY = {
  moves: "moves the original's page at the document's own value",
  stops: "stops the compile at ",
  same: "sets the same page at every value",
  layout: "sets another page than it asks at ",
  harness: "the harness finds it does not work",
} as const;

/**
 * Why a control was dropped, as the table and the runner's lines say it (decision 0040): a kind,
 * read from how the checks' reason begins, never the reason's words, which may quote TeX's log.
 */
export const DROP_KINDS = {
  moves: "its default moves the original's page",
  stops: "a value stops the compile",
  same: "every value sets the same page",
  layout: "a value sets another page than it asks",
  harness: "the harness finds it does not work",
  unchecked: "the checks stopped before the fourth",
  other: "another reason",
} as const;

export type DropKind = keyof typeof DROP_KINDS;

/** The kind of a control's drop, from the checks' reason (`DROPPED_WHY`, `UNCHECKED_WHY`). */
export function dropKind(why: string): DropKind {
  if (why === UNCHECKED_WHY) return "unchecked";
  if (why === DROPPED_WHY.moves) return "moves";
  if (why.startsWith(DROPPED_WHY.stops)) return "stops";
  if (why === DROPPED_WHY.same) return "same";
  if (why.startsWith(DROPPED_WHY.layout)) return "layout";
  if (why === DROPPED_WHY.harness) return "harness";
  return "other";
}

/** The style controls, in the order the tables, this one's and item 17's runner's, count them. */
export const CONTROLS = ["pageSize", "margins", "fontSize", "font", "accent", "density"] as const;

/**
 * The controls the milestone's bar asks of every successful import (decision 0040): the page size,
 * the margins and the font size, each proven by the fourth check, which compiled every value it
 * offers and saw the page change.
 */
export const BAR_CONTROLS = ["pageSize", "margins", "fontSize"] as const;

export type BarControl = (typeof BAR_CONTROLS)[number];

/**
 * Whether a document's first check holds: an assembly whose regenerated document set its
 * reference's glyphs (`assembled`); a partial one, one refused and one that never got so far do
 * not. Until item 13 it was what a success was, for the bar.
 */
export const firstCheckHolds = (row: Pick<AssembleRow, "outcome">) => row.outcome === "assembled";

/**
 * Whether a document is a successful import, as item 13's report says (decision 0039): its first
 * check holds and at least `SUCCESS_RATE` of its words on the page are editable. What the bar
 * holds to page size, margins and font size (decision 0040).
 */
export const reportSucceeded = (row: Pick<AssembleRow, "report">) =>
  row.report?.outcome === "succeeded";

/**
 * What item 13's report made of a document (decision 0039), in counts alone: whether it succeeds,
 * its rate to four places, its words on the page by where they are, editable, of them in the side
 * panel alone, locked by reason, the body's and the template's own, and how many locked parts and
 * things left out the person reads; never a part's words, which are the document's.
 */
export interface ReportRow {
  outcome: Report["outcome"];
  rate: number;
  words: {
    editable: number;
    panel: number;
    locked: Partial<Record<LockReason, number>>;
    body: number;
    template: number;
  };
  parts: number;
  dropped: number;
}

/** A document's report as its row keeps it (`ReportRow`): counts, never words. */
export function reportRow(report: Report): ReportRow {
  return {
    outcome: report.outcome,
    rate: Math.round(report.rate * 10_000) / 10_000,
    words: {
      editable: report.words.editable,
      panel: report.words.panel,
      locked: { ...report.words.byReason },
      body: report.words.body,
      template: report.words.template,
    },
    parts: report.locked.length,
    dropped: report.dropped.length,
  };
}

/** Which of the bar's controls a document's row proves, and which it lacks, in the bar's order. */
export function barControls(row: Pick<AssembleRow, "controls">): {
  proven: BarControl[];
  lacking: BarControl[];
} {
  const proven = new Set(row.controls?.proven ?? []);
  return {
    proven: BAR_CONTROLS.filter((control) => proven.has(control)),
    lacking: BAR_CONTROLS.filter((control) => !proven.has(control)),
  };
}

/**
 * The bar as a document's line says it (decision 0040): which of the page size, the margins and
 * the font size its row proves, and for a successful import each it lacks, with the kind of why it
 * was dropped (`DROP_KINDS`), or "not offered", never the checks' words.
 */
export function barLine(row: Pick<AssembleRow, "controls">, successful: boolean): string {
  const { proven, lacking } = barControls(row);
  const why = (control: BarControl) => {
    const kind = row.controls?.why?.[control];
    return `${control} (${kind === undefined ? "not offered" : DROP_KINDS[kind]})`;
  };
  return `${proven.length === 0 ? "none" : proven.join(" ")} proven${lacking.length === 0 || !successful ? "" : `, lacking ${lacking.map(why).join(", ")}`}`;
}

/**
 * Where the corpus misses the milestone's bar (decision 0040): each successful import, by its
 * document's id, and each of the bar's controls it lacks, a line of each; none when every
 * successful import has all three. `successful` is the rule of what a success is, over the
 * runner's own rows: item 13's report's (decision 0039), as `corpus assemble` reads it from its
 * rows (`reportSucceeded`) and item 17's runner from `outcomeOf`, which reads the same report.
 */
export function barFailures<Row extends Pick<AssembleRow, "id" | "controls">>(
  rows: readonly Row[],
  successful: (row: Row) => boolean,
): { id: string; control: BarControl }[] {
  return rows
    .filter((row) => successful(row))
    .flatMap((row) => barControls(row).lacking.map((control) => ({ id: row.id, control })));
}

/**
 * The lines a runner fails with when the corpus misses the bar (decision 0040): how many controls
 * of successful imports are not proven, and each, by the document's id and the control alone.
 */
export function barFailureLines(
  failures: readonly { id: string; control: BarControl }[],
): string[] {
  return [
    `The bar: ${failures.length} ${failures.length === 1 ? "control" : "controls"} of successful imports not proven`,
    ...failures.map((failure) => `${failure.id}: ${failure.control}`),
  ];
}

/** What became of a document: assembled, partial, refused, or why it never got so far. */
export type AssembleOutcome =
  | "assembled"
  | "partial"
  | "refused"
  | "no answer"
  | "no reference"
  | "not parsed"
  | "baseline"
  | "timeout"
  | "crashed";

/** One document's row: names of reasons, checks and controls, and numbers, never its text. */
export interface AssembleRow {
  id: string;
  family: Family;
  outcome: AssembleOutcome;
  engine?: "pdftex" | "xetex";
  /** Why the assembly or the checks refused it. */
  refused?: string;
  /** For one refused for a font the page cannot draw, the font: a name from the tree, no text. */
  font?: string;
  /** For a partial one, the kind of the first check's first difference. */
  difference?: string;
  /**
   * The body's template macros with an answer, and without; and of those without, how many the
   * cache holds an answer for that does not fit the document's macro (`answerFor`'s refusal).
   */
  answered?: number;
  unanswered?: number;
  answersRefused?: number;
  fields?: {
    editable: number;
    raw: number;
    required: number;
    locked: Partial<Record<LockReason, number>>;
  };
  /** The words in editable fields and locked by reason, as the assembly counts them in the source. */
  words?: { editable: number; locked: Partial<Record<LockReason, number>> };
  /** Item 13's report: its outcome, its rate and its words read from the page (decision 0039). */
  report?: ReportRow;
  sections?: { mapped: number; locked: number };
  /**
   * The controls proven and dropped, and of those dropped, those the checks never tried, and the
   * kind of why each was dropped (`dropKind`), never the checks' words.
   */
  controls?: {
    proven: string[];
    dropped: string[];
    unchecked?: string[];
    why?: Partial<Record<string, DropKind>>;
  };
  redefinitions?: { applied: string[]; dropped: string[]; placement?: "class" | "preamble" };
  /** The harness's findings, by check. */
  findings?: Partial<Record<string, number>>;
  /** The repeatable kinds whose unit added or removed stopped the compile. */
  unrepeatable?: string[];
  /** The kinds of unit the package marks, which the editor neither adds nor removes (`fixed`). */
  fixed?: string[];
  /**
   * For each section of a kind whose removal stopped the compile, what frames it, never its text
   * (`SectionRemoval`, decision 0038).
   */
  removals?: SectionRemoval[];
  /**
   * Whether the package sets the document in Latin Modern in T1, its Computer Modern in T1 or TS1
   * being fonts the page cannot draw (`latinModern`, decision 0026).
   */
  latinModern?: boolean;
  compiles?: number;
  /** Milliseconds: the probe, and the assembly with its checks. */
  probeMs?: number;
  validateMs?: number;
  /** Milliseconds from the document's being sent to its child to its row coming back. */
  wall: number;
}

/** A row as a child sends it, before the parent adds the document's id, family and time. */
export type AssembleChildRow = Omit<AssembleRow, "id" | "family" | "wall">;

/**
 * One section of a kind whose removal stopped the compile, as the runner tells it, by structure
 * alone: its kind; whether it is the first, the last, the only or another of its kind, and where it
 * stands among the document's sections; whether the document compiles with it alone removed, and
 * when not, the error's class, never TeX's words; what stands between its head and its content
 * (`before`: an environment, a list the answer names, another call, or nothing), and of the macros
 * it calls, whether one begins an environment its definition does not end, and what the answers
 * say of it (`opener`: a list's opener, another answer, no answer, or no such macro); whether its
 * head's snippet begins one (`headOpens`); how many environments `before` begins and does not end,
 * by its macros' definitions (`opens`); whether it keeps anything after its content (`after`);
 * where what ends such an environment stands (`closer`): in what it keeps after its content, in
 * the locked section right after it, in what the next section keeps before its head or its
 * content, or none of those; how many that part ends (`closes`); and whether it calls the closer
 * an answer names for a list `before` opens (`named`).
 */
export interface SectionRemoval {
  kind: string;
  of: "only" | "first" | "last" | "middle";
  at: number;
  sections: number;
  compiles: boolean;
  error?: string;
  before: "environment" | "list" | "call" | "none";
  opener: "list" | "answered" | "unanswered" | "none";
  headOpens: boolean;
  opens: number;
  after: boolean;
  closer: "after" | "locked" | "next" | "none";
  closes: number;
  named: boolean;
}

/** A compile's error as a class, never TeX's words, which may quote the document. */
export function errorClass(error: string | undefined): string {
  const text = error ?? "";
  if (/ended by \\end/.test(text)) return "an environment ended by another's end";
  if (/Lonely \\item|missing \\item/i.test(text)) return "an item outside a list";
  if (/Too many \}'s|Extra \}/.test(text)) return "a brace closed twice";
  if (/Extra \\end|\\begin\{[^}]*\} on input line/.test(text)) return "an end with no begin";
  if (/alignment tab/.test(text)) return "an alignment tab out of place";
  if (/Undefined control sequence/.test(text)) return "an undefined command";
  if (/Emergency stop|File ended/.test(text)) return "the file ended inside something";
  return "another error";
}

/**
 * A validation's row: its counts and names, never a field's text; with item 13's report of it,
 * where the caller read one (`reportOf`, decision 0039), in counts alone (`reportRow`).
 */
export function assembleRow(
  checks: AssemblyChecks,
  engine: "pdftex" | "xetex",
  answered: { answered: number; unanswered: number; answersRefused?: number },
  report?: Report,
): AssembleChildRow {
  const findings: Partial<Record<string, number>> = {};
  for (const finding of checks.findings)
    findings[finding.check] = (findings[finding.check] ?? 0) + 1;
  return {
    outcome: checks.outcome,
    engine,
    ...(checks.difference === undefined ? {} : { difference: checks.difference.kind }),
    ...answered,
    fields: checks.fields,
    words: checks.words,
    ...(report === undefined ? {} : { report: reportRow(report) }),
    sections: checks.sections,
    controls: {
      proven: checks.controls.proven,
      dropped: checks.controls.dropped.map((each) => each.control),
      unchecked: checks.controls.dropped
        .filter((each) => each.why === UNCHECKED_WHY)
        .map((each) => each.control),
      why: Object.fromEntries(
        checks.controls.dropped.flatMap((each) =>
          (CONTROLS as readonly string[]).includes(each.control)
            ? [[each.control, dropKind(each.why)]]
            : [],
        ),
      ),
    },
    redefinitions: checks.redefinitions,
    findings,
    unrepeatable: checks.repeatable
      .filter((each) => !each.added || !each.removed)
      .map((each) => each.kind),
    fixed: [...(checks.decisions.fixed ?? [])],
    ...(checks.latinModern === undefined ? {} : { latinModern: true }),
    compiles: checks.compiles,
    validateMs: Math.round(checks.ms),
  };
}

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

/** A font's name as the table shows it: a TFM's name from the tree, letters, digits and dashes. */
const FONT_NAME = /^[A-Za-z0-9._-]{1,64}$/;

/** A kind of unit as the table shows it: `entry`, `section.list` and the like, and nothing else. */
const UNIT_NAME = /^[A-Za-z]{1,16}(\.[A-Za-z]{1,16})?$/;

/** A redefinition's or a macro's name as the table shows it, when it is plainly one. */
const shownName = (name: string) => (/^[A-Za-z@*]{1,63}$/.test(name) ? `\\${name}` : undefined);

/**
 * What assembling the corpus came to, as one Markdown table, per family and in all: the documents
 * that reached the assembly and why others did not, those assembled, partial with the kind of the
 * first difference, set in Latin Modern, and refused; the fields editable, raw where the page
 * cannot mark them, required and locked by reason, and their words, as the source counts them;
 * item 13's report (decision 0039): the documents that succeed and the partial ones, and the words
 * read from the page, editable, locked by reason and the template's own; the sections mapped and
 * locked; the controls proven and dropped, and the milestone's bar (`barControls`, decision 0040):
 * the documents with the page size, the margins and the font size all proven, and the successful
 * ones, as the report says, lacking any, and which; the redefinitions dropped; the harness's
 * findings by check, and the checks' own; the kinds of unit that stop the compile; and the
 * compiles and times.
 */
export function assembleTable(rows: readonly AssembleRow[]): string {
  const of = (column: (typeof COLUMNS)[number]) =>
    rows.filter((row) => column === "all" || row.family === column);
  const line = (label: string, values: readonly (number | string)[]) =>
    `| ${label} | ${values.join(" | ")} |`;
  const count = (label: string, test: (row: AssembleRow) => boolean) =>
    line(
      label,
      COLUMNS.map((column) => of(column).filter(test).length),
    );
  const sum = (label: string, pick: (row: AssembleRow) => number) =>
    line(
      label,
      COLUMNS.map((column) => of(column).reduce((total, row) => total + pick(row), 0)),
    );
  const middle = (label: string, pick: (row: AssembleRow) => number | undefined, unit = "") =>
    line(
      label,
      COLUMNS.map((column) => {
        const value = median(of(column).flatMap((row) => pick(row) ?? []));
        return value === undefined ? "" : `${Math.round(value)}${unit}`;
      }),
    );
  const most = (label: string, pick: (row: AssembleRow) => number | undefined, unit = "") =>
    line(
      label,
      COLUMNS.map((column) => {
        const values = of(column).flatMap((row) => pick(row) ?? []);
        return values.length === 0 ? "" : `${Math.round(Math.max(...values))}${unit}`;
      }),
    );
  const share = (
    label: string,
    part: (row: AssembleRow) => number,
    whole: (row: AssembleRow) => number,
  ) =>
    line(
      label,
      COLUMNS.map((column) => {
        const total = of(column).reduce((sum, row) => sum + whole(row), 0);
        const some = of(column).reduce((sum, row) => sum + part(row), 0);
        return total === 0 ? "" : `${Math.round((100 * some) / total)}%`;
      }),
    );
  const section = (label: string) =>
    line(
      `**${label}**`,
      COLUMNS.map(() => ""),
    );
  const done = (row: AssembleRow) => row.outcome === "assembled" || row.outcome === "partial";
  const lockedWords = (row: AssembleRow) =>
    Object.values(row.words?.locked ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
  const refusals = [...new Set(rows.flatMap((row) => row.refused ?? []))].sort();
  const fonts = [
    ...new Set(
      rows.flatMap((row) => (row.font !== undefined && FONT_NAME.test(row.font) ? [row.font] : [])),
    ),
  ].sort();
  const differences = [...new Set(rows.flatMap((row) => row.difference ?? []))].sort();
  const fixed = [
    ...new Set(rows.flatMap((row) => (row.fixed ?? []).filter((kind) => UNIT_NAME.test(kind)))),
  ].sort();
  const redefinitions = [
    ...new Set(
      rows.flatMap((row) =>
        (row.redefinitions?.dropped ?? []).flatMap((name) => shownName(name) ?? []),
      ),
    ),
  ].sort();
  // The reasons some document's report locks a word on its page for, in the table's order.
  const pageReasons = LOCK_REASONS.filter((reason) =>
    rows.some((row) => (row.report?.words.locked[reason] ?? 0) > 0),
  );
  // Each control with each kind of why it was dropped that some document gives, in their orders.
  const drops = CONTROLS.flatMap((name) =>
    (Object.keys(DROP_KINDS) as DropKind[])
      .filter((kind) => rows.some((row) => row.controls?.why?.[name] === kind))
      .map((kind) => [name, kind] as const),
  );
  const lines = [
    line("", COLUMNS),
    `|---|${COLUMNS.map(() => "--:").join("|")}|`,
    count(
      "Documents whose body parsed",
      (row) => row.outcome !== "no reference" && row.outcome !== "not parsed",
    ),
    count(
      "Not probed: the body unmarked did not set the reference's glyphs",
      (row) => row.outcome === "baseline",
    ),
    count("No answer for any macro the body calls", (row) => row.outcome === "no answer"),
    count("Assembled and checked", done),
    count("Assembled: the first check holds", (row) => row.outcome === "assembled"),
    count("Partial: the first check differs", (row) => row.outcome === "partial"),
    ...differences.map((kind) =>
      count(`Partial, the first difference: \`${kind}\``, (row) => row.difference === kind),
    ),
    count(
      "Set in Latin Modern: Computer Modern in T1 or TS1, which the page cannot draw",
      (row) => done(row) && row.latinModern === true,
    ),
    count("Refused", (row) => row.outcome === "refused"),
    ...refusals.flatMap((reason) => [
      count(`Refused: ${reason}`, (row) => row.refused === reason),
      ...(reason === "font"
        ? fonts.map((font) => count(`Refused: font \`${font}\``, (row) => row.font === font))
        : []),
    ]),
    count("Timed out or died", (row) => row.outcome === "timeout" || row.outcome === "crashed"),
    sum("Template macros with an answer", (row) => row.answered ?? 0),
    sum("Template macros with none", (row) => row.unanswered ?? 0),
    sum(
      "Template macros with none: the answer held is another kind's, or its partner is not theirs",
      (row) => row.answersRefused ?? 0,
    ),
    section("Fields"),
    sum("Editable", (row) => row.fields?.editable ?? 0),
    sum("Raw: set, and edited in the panel alone", (row) => row.fields?.raw ?? 0),
    sum("Required", (row) => row.fields?.required ?? 0),
    ...LOCK_REASONS.map((reason) =>
      sum(`Parts locked: \`${reason}\``, (row) => row.fields?.locked[reason] ?? 0),
    ),
    share(
      "Words in editable fields, counted in the source",
      (row) => row.words?.editable ?? 0,
      (row) => (row.words?.editable ?? 0) + lockedWords(row),
    ),
    section("The report, its words read from the page"),
    count(
      `Succeeded: the first check holds, and ${percent(SUCCESS_RATE)} of the words or more are editable on the page`,
      reportSucceeded,
    ),
    count("Partial: under the bar, or the first check differs", (row) =>
      done(row) ? row.report?.outcome === "partial" : false,
    ),
    share(
      "Words editable on the page",
      (row) => row.report?.words.editable ?? 0,
      (row) => row.report?.words.body ?? 0,
    ),
    sum("Words of the resume's", (row) => row.report?.words.body ?? 0),
    sum("Words editable on the page, in all", (row) => row.report?.words.editable ?? 0),
    sum("Words editable in the side panel alone", (row) => row.report?.words.panel ?? 0),
    ...pageReasons.map((reason) =>
      sum(`Words locked: \`${reason}\``, (row) => row.report?.words.locked[reason] ?? 0),
    ),
    sum("Words of the template's own", (row) => row.report?.words.template ?? 0),
    section("Sections"),
    sum("Mapped onto the model", (row) => row.sections?.mapped ?? 0),
    sum("Locked", (row) => row.sections?.locked ?? 0),
    section("Controls, documents"),
    ...CONTROLS.map((name) =>
      count(`\`${name}\` proven`, (row) => (row.controls?.proven ?? []).includes(name)),
    ),
    ...CONTROLS.map((name) =>
      count(`\`${name}\` dropped`, (row) => (row.controls?.dropped ?? []).includes(name)),
    ),
    ...drops.map(([name, kind]) =>
      count(
        `\`${name}\` dropped: ${DROP_KINDS[kind]}`,
        (row) => row.controls?.why?.[name] === kind,
      ),
    ),
    count(
      "Dropped unchecked: the checks stopped before the fourth",
      (row) => (row.controls?.unchecked ?? []).length > 0,
    ),
    count(
      "The bar: page size, margins and font size all proven",
      (row) => done(row) && barControls(row).lacking.length === 0,
    ),
    count(
      "The bar: a successful import, as the report says, lacking one",
      (row) => reportSucceeded(row) && barControls(row).lacking.length > 0,
    ),
    ...BAR_CONTROLS.map((control) =>
      count(
        `The bar: a successful import lacking \`${control}\``,
        (row) => reportSucceeded(row) && barControls(row).lacking.includes(control),
      ),
    ),
    section("Redefinitions, documents"),
    count(
      "Applied after `\\documentclass`",
      (row) =>
        done(row) &&
        (row.redefinitions?.applied.length ?? 0) > 0 &&
        row.redefinitions?.placement !== "preamble",
    ),
    count(
      "Applied before `\\begin{document}`: a compile after the class stopped",
      (row) =>
        done(row) &&
        (row.redefinitions?.applied.length ?? 0) > 0 &&
        row.redefinitions?.placement === "preamble",
    ),
    ...redefinitions.map((name) =>
      count(`Dropped: \`${name}\``, (row) =>
        (row.redefinitions?.dropped ?? []).some((each) => shownName(each) === name),
      ),
    ),
    section("The harness's findings, documents"),
    ...CHECKS.map((check) => count(`\`${check}\``, (row) => (row.findings?.[check] ?? 0) > 0)),
    section("The checks' own findings, documents"),
    ...CHECK_NOTES.map((note) => count(`\`${note}\``, (row) => (row.findings?.[note] ?? 0) > 0)),
    count(
      "No finding, the harness's or the checks'",
      (row) => done(row) && Object.keys(row.findings ?? {}).length === 0,
    ),
    section("Repeatable units, documents"),
    count(
      "A unit added or removed stops the compile",
      (row) => (row.unrepeatable ?? []).length > 0,
    ),
    ...fixed.map((kind) =>
      count(`The editor neither adds nor removes: \`${kind}\``, (row) =>
        (row.fixed ?? []).includes(kind),
      ),
    ),
    section("Compiles and time"),
    middle("Compiles, median", (row) => (done(row) ? row.compiles : undefined)),
    most("Compiles, most", (row) => (done(row) ? row.compiles : undefined)),
    middle("The probe, median", (row) => row.probeMs, " ms"),
    middle("Assembly and checks, median", (row) => row.validateMs, " ms"),
    most("Assembly and checks, slowest", (row) => row.validateMs, " ms"),
  ];
  return `${lines.map(printable).join("\n")}\n`;
}

// The answers.

/** A request's macro as the runner asks the cache for it. */
interface Asked {
  of: "command" | "environment";
  name: string;
  key?: string;
  calls: number;
}

/**
 * The answers a cache holds for a request's macros (decision 0024), each asked for by its key as
 * the document's macro (`answerFor`), so that an answer comes named as the document names the
 * macro, and its list's partners are the request's commands, found by their keys; an answer the
 * cache holds but refuses for the macro, another kind's or naming a partner the request has no
 * macro of, is no answer, and the macro stays as the probe left it. And how many of the body's
 * macros have one, how many have none, and of those how many the cache refused.
 */
export async function answersFor(
  macros: readonly Asked[],
  cache: Pick<AnswerCache, "get">,
): Promise<{ found: StoredAnswer[]; answered: number; unanswered: number; refused: number }> {
  const partners = new Map(
    macros.flatMap((macro) =>
      macro.of === "command" && macro.key !== undefined ? [[macro.name, macro.key] as const] : [],
    ),
  );
  const found: StoredAnswer[] = [];
  let answered = 0;
  let unanswered = 0;
  let refused = 0;
  for (const macro of macros) {
    const given =
      macro.key === undefined
        ? undefined
        : await answerFor(cache, macro.key, { name: macro.name, of: macro.of, partners });
    const stored = given === undefined || "reason" in given ? undefined : given;
    if (stored !== undefined) found.push(stored);
    if (macro.key === undefined || macro.calls === 0) continue;
    if (stored !== undefined) answered++;
    else {
      unanswered++;
      if (given !== undefined) refused++;
    }
  }
  return { found, answered, unanswered, refused };
}

// The model's places, for the oracle's comparison with the ports.

/** How the fields of one of the model's places came out: editable, raw, or locked by reason. */
export interface PlaceCount {
  editable: number;
  raw: number;
  locked: Partial<Record<LockReason, number>>;
}

/** An imported resume's nodes as the places are read from them: ids and kinds alone. */
interface Nodes {
  header: { links: readonly { id: string }[] };
  sections: readonly (
    | { kind: "locked"; id: string }
    | {
        kind: "entries";
        id: string;
        entries: readonly { id: string; bullets: readonly { id: string }[] }[];
      }
    | { kind: "list" | "labelled"; id: string; items: readonly { id: string }[] }
    | { kind: "paragraph"; id: string }
  )[];
}

/** The kinds of node the assembly mints ids for, by their prefixes. */
const ID_KINDS: Readonly<Record<string, string>> = {
  lnk: "link",
  sec: "section",
  ent: "entry",
  bul: "bullet",
  itm: "item",
  lock: "locked",
};

/** A node's kind from its id's prefix, `lnk-` a link's, or the prefix where it names none. */
const kindOfId = (id: string) => {
  const prefix = id.slice(0, Math.max(0, id.indexOf("-")));
  return (Object.hasOwn(ID_KINDS, prefix) ? ID_KINDS[prefix] : undefined) ?? (prefix || id);
};

/**
 * The fields of an imported resume by the model's place they fill, `header.first`, `section.title`,
 * `entry.dates`, `bullet.text`, `item.text`, `labelledItem.label` and the like, and how each came
 * out; from the checks' fields and the resume's ids, never a field's text.
 */
export function fieldsFound(
  resume: Nodes,
  all: readonly { field: string; mode: "typeset" | "raw" | "locked"; reason?: LockReason }[],
): Record<string, PlaceCount> {
  const kinds = new Map<string, string>();
  for (const link of resume.header.links) kinds.set(link.id, "link");
  for (const section of resume.sections) {
    kinds.set(section.id, section.kind === "paragraph" ? "paragraph" : "section");
    if (section.kind === "entries")
      for (const entry of section.entries) {
        kinds.set(entry.id, "entry");
        for (const bullet of entry.bullets) kinds.set(bullet.id, "bullet");
      }
    else if (section.kind === "list" || section.kind === "labelled")
      for (const item of section.items)
        kinds.set(item.id, section.kind === "list" ? "item" : "labelledItem");
  }
  const found: Record<string, PlaceCount> = {};
  for (const field of all) {
    const dot = field.field.lastIndexOf(".");
    const node = field.field.slice(0, dot);
    const slot = field.field.slice(dot + 1);
    // A node the resume does not hold is filed under the kind its id's prefix names, never under
    // another place's (decision 0026).
    const kind = node === "header" ? "header" : (kinds.get(node) ?? kindOfId(node));
    const place = kind === "paragraph" && slot === "title" ? "section.title" : `${kind}.${slot}`;
    const count = (found[place] ??= { editable: 0, raw: 0, locked: {} });
    if (field.mode === "typeset") count.editable++;
    else if (field.mode === "raw") count.raw++;
    else if (field.reason !== undefined)
      count.locked[field.reason] = (count.locked[field.reason] ?? 0) + 1;
  }
  return found;
}

/** A curated package's snippets as the port comparison reads them, from its `template.json`. */
interface PortSnippets {
  snippets: {
    header: string;
    contact?: Partial<Record<string, string>>;
    link: Partial<Record<string, string>>;
    section: Record<string, string | Record<string, string>>;
    entry: string | Record<string, string>;
    bullet: string | Record<string, string>;
    item: string | Record<string, string>;
    labelledItem: string | Record<string, string>;
  };
}

/**
 * The places a port marks: every typeset slot of its snippets, by the model's place it fills; a
 * contact's text through `{{contacts}}` as the header's field it is.
 */
export function portPlaces(port: PortSnippets): Set<string> {
  const places = new Set<string>();
  const typeset = (snippet: string | Record<string, string> | undefined) => {
    const texts =
      snippet === undefined ? [] : typeof snippet === "string" ? [snippet] : Object.values(snippet);
    const slots = new Set<string>();
    for (const text of texts)
      for (const found of text.matchAll(/\{\{\s*([A-Za-z]+)\s*\}\}/g)) slots.add(found[1] ?? "");
    return slots;
  };
  const { snippets } = port;
  for (const slot of typeset(snippets.header))
    if (["first", "last", "headline", "email", "phone", "location"].includes(slot))
      places.add(`header.${slot}`);
  const listed = typeset(snippets.header);
  if (listed.has("contacts"))
    for (const [field, snippet] of Object.entries(snippets.contact ?? {}))
      if (snippet !== undefined && typeset(snippet).has("text")) places.add(`header.${field}`);
  if (listed.has("links") || listed.has("contacts"))
    for (const snippet of Object.values(snippets.link))
      if (snippet !== undefined && typeset(snippet).has("label")) places.add("link.label");
  for (const [kind, snippet] of Object.entries(snippets.section)) {
    const slots = typeset(snippet);
    if (slots.has("title")) places.add("section.title");
    if (kind === "paragraph" && slots.has("text")) places.add("paragraph.text");
  }
  for (const slot of typeset(snippets.entry))
    if (["title", "subtitle", "place", "dates"].includes(slot)) places.add(`entry.${slot}`);
  if (typeset(snippets.bullet).has("text")) places.add("bullet.text");
  if (typeset(snippets.item).has("text")) places.add("item.text");
  for (const slot of typeset(snippets.labelledItem))
    if (slot === "label" || slot === "text") places.add(`labelledItem.${slot}`);
  return places;
}

/** One line of the oracle's comparison of the fields found with the port's slots. */
export interface PlaceLine {
  template: string;
  place: string;
  port: "marks" | "omits";
  found: string;
}

/** A place's count as the comparison shows it: editable, raw and locked by reason. */
function shownCount(count: PlaceCount | undefined): string {
  if (count === undefined) return "absent";
  const parts = [
    ...(count.editable > 0 ? [`${count.editable} editable`] : []),
    ...(count.raw > 0 ? [`${count.raw} raw`] : []),
    ...Object.entries(count.locked).map(([reason, n]) => `${n} locked (${reason})`),
  ];
  return parts.length === 0 ? "none" : parts.join(", ");
}

/** The fields an oracle sample's assembly found, against the places its port marks, a line each. */
export function comparePlaces(
  template: string,
  port: ReadonlySet<string>,
  found: Readonly<Record<string, PlaceCount>> | undefined,
): PlaceLine[] {
  const places = [...new Set([...port, ...Object.keys(found ?? {})])].sort();
  return places.map((place) => ({
    template,
    place,
    port: port.has(place) ? "marks" : "omits",
    found: shownCount(found?.[place]),
  }));
}

/**
 * Item 13's report of a document as a line of the runners says it (decision 0039): succeeded or
 * partial, its rate, and its editable words of the resume's on the page; or none.
 */
export function reportLine(report: ReportRow | undefined): string {
  if (report === undefined) return "none";
  return `${report.outcome} at ${percent(report.rate)}, ${report.words.editable} of ${report.words.body} words editable on the page`;
}

/** The oracle's assemblies as a Markdown table: each sample's outcome, and its fields by place. */
export function placesTable(
  samples: readonly { template: string; row?: AssembleRow; lines: readonly PlaceLine[] }[],
): string {
  const rows = ["| Template | Place | Port | Found |", "|---|---|---|---|"];
  for (const sample of samples) {
    const row = sample.row;
    const findings = Object.entries(row?.findings ?? {})
      .map(([check, n]) => `${check} ${n}`)
      .join(", ");
    rows.push(
      `| ${sample.template} | **outcome** | | ${row?.outcome ?? "none"}${row?.difference === undefined ? "" : `, the first difference: ${row.difference}`}${row?.refused === undefined ? "" : ` (${row.refused})`}; report: ${reportLine(row?.report)}; harness: ${findings === "" ? "no finding" : findings}; ${row?.compiles ?? 0} compiles |`,
    );
    for (const line of sample.lines)
      rows.push(`| ${line.template} | \`${line.place}\` | ${line.port} | ${line.found} |`);
  }
  return `${rows.map(printable).join("\n")}\n`;
}
