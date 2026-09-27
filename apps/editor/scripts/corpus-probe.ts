/**
 * The probe over the corpus (milestone 3 item 5, decision 0022): `corpus probe` takes each fetched
 * document in as the reference runner does (`corpus-reference.ts`), and for each whose body parses
 * (`corpus-parse.ts`) runs the probe (`src/import/probe.ts`), and prints one table of what it found,
 * per family and in all: the compiles each document took and how, its candidates' verdicts, its
 * macros' arguments' verdicts, its standard nodes, how much of the reference's text editable fields
 * cover, and the times.
 *
 * The documents go to the reference runner's pool of child processes (`runPool`), one at a time
 * each, with LIMIT_MS each, since a XeTeX document's probe compiles it whole up to 64 times; the
 * child is `corpus-probe-child.ts`, which `corpus oracle` uses too.
 *
 * What is printed and written names macros and counts, never a document's text: a macro's name only
 * when it is plainly one, and every line through `printable`. Each document's whole probe, which
 * holds its candidates' texts, is written under `.corpus/` alone.
 */

// Node runs this file by stripping its types, so it imports values only from files that import
// nothing Node lacks, and the editor's modules as types alone, with their real extensions.
import type { Aggregate, Probe, Reason, Verdict } from "../src/import/probe.ts";
import { FAMILIES, type Family, printable } from "./corpus-manifest.ts";
import { shownMacro } from "./corpus-parse.ts";

/** How long one document may take, the pipeline and the probe's compiles together. */
export const PROBE_LIMIT_MS = 600_000;

/** The verdicts, in the order the table counts them. */
export const VERDICTS: readonly Verdict[] = [
  "editable",
  "container",
  "raw",
  "breaks",
  "vanished",
  "twice",
  "moved",
  "misaligned",
  "case",
  "split",
  "untested",
];

/** The reasons a candidate is locked, which the table counts one by one. */
const REASONS: readonly Reason[] = VERDICTS.filter(
  (verdict): verdict is Reason => verdict !== "editable" && verdict !== "container",
);

/** What became of a document: probed, or why not. */
export type ProbeOutcome =
  /** Probed, its candidates settled or left untested. */
  | "probed"
  /** The reference compile refused it, so it never reached the parser. */
  | "no reference"
  /** The parser refused it, or the engine printed no signatures for it. */
  | "not parsed"
  /** The body, unmarked, did not set the reference's glyphs, so nothing could be probed. */
  | "baseline"
  /** Its child ran past its time, or died. */
  | "timeout"
  | "crashed";

/** A macro's or an environment's argument as a row keeps it: its name and verdict, no text. */
export interface ArgumentRow {
  of: "call" | "environment";
  name: string;
  index?: number;
  calls: number;
  verdict: Verdict;
  empty?: Verdict;
  /** How many of its calls came to each verdict. */
  counts: Partial<Record<Verdict, number>>;
  parts?: { total: number; editable: number };
}

/** One document's row: names of macros and numbers only, never its text. */
export interface ProbeRow {
  id: string;
  family: Family;
  outcome: ProbeOutcome;
  engine?: "pdftex" | "xetex";
  path?: Probe["path"];
  fallback?: Probe["fallback"];
  /** How the unmarked body from the format differed, for a document that fell back for it. */
  formatDifference?: string;
  /** Why nothing could be probed, for a document whose unmarked body differs. */
  baseline?: string;
  compiles?: number;
  /** The passes its compiles took in all: one each, and a second where the first changed a file. */
  passes?: number;
  /** Its candidates, by verdict. */
  candidates?: Partial<Record<Verdict, number>>;
  /** Its macros' and environments' arguments. */
  arguments?: ArgumentRow[];
  /** Its standard nodes, by kind: how many, how many editable, and the kind's verdict. */
  standard?: Record<string, { total: number; editable: number; verdict: Verdict }>;
  /** The reference's glyphs, those editable fields cover, and what sets the others. */
  glyphs?: { reference: number; covered: number; candidate: number; raw: number; chrome: number };
  /** Milliseconds: the dump, the baseline, the candidates' compiles, and the whole probe. */
  dumpMs?: number;
  baselineMs?: number;
  compileMs?: number;
  probeMs?: number;
  /** Milliseconds from the document's being sent to its child to its row coming back. */
  wall: number;
}

/** A row as a child sends it, before the parent adds the document's id, family and time. */
export type ProbeChildRow = Omit<ProbeRow, "id" | "family" | "wall">;

/**
 * A probe's row: its counts and its macros' names, never a candidate's text. A document the probe
 * could not probe, its unmarked body not setting the reference's glyphs, has no verdicts to count,
 * and its row says why and how long it took alone.
 */
export function probeRow(found: Probe): ProbeChildRow {
  if (found.baseline !== undefined)
    return {
      outcome: "baseline",
      engine: found.engine,
      path: found.path,
      ...(found.fallback === undefined ? {} : { fallback: found.fallback }),
      ...(found.formatDifference === undefined ? {} : { formatDifference: found.formatDifference }),
      baseline: found.baseline,
      ...(found.dumpMs === undefined ? {} : { dumpMs: Math.round(found.dumpMs) }),
      baselineMs: Math.round(found.baselineMs),
      probeMs: Math.round(found.ms),
    };
  const candidates: Partial<Record<Verdict, number>> = {};
  for (const each of found.candidates)
    candidates[each.verdict] = (candidates[each.verdict] ?? 0) + 1;
  const standard: Record<string, { total: number; editable: number; verdict: Verdict }> = {};
  for (const each of found.standard)
    standard[each.name] = {
      total: each.calls,
      editable: each.counts.editable ?? 0,
      verdict: each.verdict,
    };
  const glyphs = {
    reference: found.glyphs.reference,
    covered: found.glyphs.covered,
    candidate: 0,
    raw: 0,
    chrome: 0,
  };
  for (const run of found.uncovered) glyphs[run.by] += run.to - run.from;
  return {
    outcome: "probed",
    engine: found.engine,
    path: found.path,
    ...(found.fallback === undefined ? {} : { fallback: found.fallback }),
    ...(found.formatDifference === undefined ? {} : { formatDifference: found.formatDifference }),
    compiles: found.compiles,
    passes: found.passes,
    candidates,
    arguments: found.macros.map(argumentRow),
    standard,
    glyphs,
    ...(found.dumpMs === undefined ? {} : { dumpMs: Math.round(found.dumpMs) }),
    baselineMs: Math.round(found.baselineMs),
    compileMs: Math.round(found.compileMs),
    probeMs: Math.round(found.ms),
  };
}

/** An aggregate as a row keeps it. */
function argumentRow(each: Aggregate): ArgumentRow {
  return {
    of: each.of === "environment" ? "environment" : "call",
    name: each.name,
    ...(each.index === undefined ? {} : { index: each.index }),
    calls: each.calls,
    verdict: each.verdict,
    ...(each.empty === undefined ? {} : { empty: each.empty }),
    counts: each.counts,
    ...(each.parts === undefined ? {} : { parts: each.parts }),
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

/** An argument as the table names it: `\name #2`, or an environment's `{name} #1`. */
export function shownArgument(
  argument: Pick<ArgumentRow, "of" | "name" | "index">,
): string | undefined {
  const shown =
    argument.of === "environment"
      ? /^[A-Za-z@*]{1,63}$/.test(argument.name)
        ? `{${argument.name}}`
        : undefined
      : shownMacro(argument.name);
  return shown === undefined ? undefined : `${shown} #${argument.index ?? "?"}`;
}

/** How many argument names the table lists under each heading; the JSON has them all. */
export const TOP_ARGUMENTS = 15;

/** Whether a document was probed, so that its verdicts count. */
const probed = (row: ProbeRow) => row.outcome === "probed";

/** Every locked argument's name and verdict, with how many documents lock it so, the most first. */
function lockedTally(rows: readonly ProbeRow[]): [string, number][] {
  const tally = new Map<string, number>();
  for (const row of rows.filter(probed))
    for (const name of new Set(
      (row.arguments ?? []).flatMap((each) => {
        const shown = shownArgument(each);
        return shown === undefined || !REASONS.includes(each.verdict as Reason)
          ? []
          : [`${shown}: ${each.verdict}`];
      }),
    ))
      tally.set(name, (tally.get(name) ?? 0) + 1);
  return [...tally].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
}

/** Every argument's name that is editable in some document, with how many, the most first. */
function editableTally(rows: readonly ProbeRow[]): [string, number][] {
  const tally = new Map<string, number>();
  for (const row of rows.filter(probed))
    for (const name of new Set(
      (row.arguments ?? []).flatMap((each) => {
        const shown = shownArgument(each);
        return shown === undefined || each.verdict !== "editable" ? [] : [shown];
      }),
    ))
      tally.set(name, (tally.get(name) ?? 0) + 1);
  return [...tally].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Every locked argument's name and verdict with its count, and every editable one's, for the
 * JSON: of the documents probed alone.
 */
export function probeNames(rows: readonly ProbeRow[]): {
  locked: Record<string, number>;
  editable: Record<string, number>;
} {
  return {
    locked: Object.fromEntries(lockedTally(rows)),
    editable: Object.fromEntries(editableTally(rows)),
  };
}

/**
 * Whether a macro or an environment is editable throughout in a document: every argument of it
 * editable, or a container holding structure, and at least one editable.
 */
function editableMacros(row: ProbeRow): { called: number; editable: number } {
  const byMacro = new Map<string, ArgumentRow[]>();
  for (const each of row.arguments ?? []) {
    const key = `${each.of}|${each.name}`;
    const list = byMacro.get(key) ?? [];
    list.push(each);
    byMacro.set(key, list);
  }
  let editable = 0;
  for (const list of byMacro.values())
    if (
      list.every((each) => each.verdict === "editable" || each.verdict === "container") &&
      list.some((each) => each.verdict === "editable")
    )
      editable++;
  return { called: byMacro.size, editable };
}

/**
 * What probing the corpus came to, as one Markdown table, per family and in all: the documents
 * whose body parsed, those probed, and why others were not; the compiles each took, from its
 * format or whole, their passes, and whether the budget ran out; its candidates by verdict; its
 * macros' and environments' arguments by verdict, and the macros every argument of which is
 * editable; its standard nodes editable; the share of the reference's glyphs editable fields
 * cover, and what sets the rest; and the times. What a document has verdicts for counts only when
 * it was probed. Under the table, the locked arguments the most documents give, with their
 * verdict, and the editable ones.
 */
export function probeTable(rows: readonly ProbeRow[]): string {
  const all = (column: (typeof COLUMNS)[number]) =>
    rows.filter((row) => column === "all" || row.family === column);
  const of = (column: (typeof COLUMNS)[number]) => all(column).filter(probed);
  const line = (label: string, values: readonly (number | string)[]) =>
    `| ${label} | ${values.join(" | ")} |`;
  const count = (label: string, test: (row: ProbeRow) => boolean) =>
    line(
      label,
      COLUMNS.map((column) => all(column).filter(test).length),
    );
  const sum = (label: string, pick: (row: ProbeRow) => number) =>
    line(
      label,
      COLUMNS.map((column) => of(column).reduce((total, row) => total + pick(row), 0)),
    );
  const middle = (label: string, pick: (row: ProbeRow) => number | undefined, unit = "") =>
    line(
      label,
      COLUMNS.map((column) => {
        const value = median(of(column).flatMap((row) => pick(row) ?? []));
        return value === undefined ? "" : `${Math.round(value)}${unit}`;
      }),
    );
  const most = (label: string, pick: (row: ProbeRow) => number | undefined, unit = "") =>
    line(
      label,
      COLUMNS.map((column) => {
        const values = of(column).flatMap((row) => pick(row) ?? []);
        return values.length === 0 ? "" : `${Math.round(Math.max(...values))}${unit}`;
      }),
    );
  const share = (
    label: string,
    part: (row: ProbeRow) => number,
    whole: (row: ProbeRow) => number,
  ) =>
    line(
      label,
      COLUMNS.map((column) => {
        const total = of(column).reduce((sum, row) => sum + whole(row), 0);
        const some = of(column).reduce((sum, row) => sum + part(row), 0);
        return total === 0 ? "" : `${Math.round((100 * some) / total)}%`;
      }),
    );
  const ratio = (label: string, pick: (row: ProbeRow) => { total: number; editable: number }) =>
    line(
      label,
      COLUMNS.map((column) => {
        const total = of(column).reduce((sum, row) => sum + pick(row).total, 0);
        const editable = of(column).reduce((sum, row) => sum + pick(row).editable, 0);
        return total === 0 ? "0" : `${editable} of ${total}`;
      }),
    );
  const section = (label: string) =>
    line(
      `**${label}**`,
      COLUMNS.map(() => ""),
    );
  const verdicts = (row: ProbeRow, verdict: Verdict) => row.candidates?.[verdict] ?? 0;
  const argumentsBy = (row: ProbeRow, verdict: Verdict) =>
    (row.arguments ?? []).filter((each) => each.verdict === verdict).length;
  const standard = (kind: string) => (row: ProbeRow) =>
    row.standard?.[kind] ?? { total: 0, editable: 0 };
  const locked = lockedTally(rows).slice(0, TOP_ARGUMENTS);
  const editable = editableTally(rows).slice(0, TOP_ARGUMENTS);
  const lines = [
    line("", COLUMNS),
    `|---|${COLUMNS.map(() => "--:").join("|")}|`,
    count(
      "Documents whose body parsed",
      (row) => row.outcome === "probed" || row.outcome === "baseline",
    ),
    count("Probed", probed),
    count(
      "Not probed: the body unmarked did not set the reference's glyphs",
      (row) => row.outcome === "baseline",
    ),
    count("Timed out or died", (row) => row.outcome === "timeout" || row.outcome === "crashed"),
    count("Path: from the document's format", (row) => probed(row) && row.path === "format"),
    count(
      "Path: whole compiles, XeTeX",
      (row) => probed(row) && row.path === "whole" && row.engine === "xetex",
    ),
    count(
      "Path: whole compiles, the preamble did not dump",
      (row) => probed(row) && row.fallback === "dump",
    ),
    count(
      "Path: whole compiles, the format did not set the reference's glyphs",
      (row) => probed(row) && row.fallback === "baseline",
    ),
    middle("Compiles per document, median", (row) => row.compiles),
    most("Compiles per document, most", (row) => row.compiles),
    share(
      "Compiles that took a second pass",
      (row) => (row.passes === undefined ? 0 : row.passes - (row.compiles ?? 0)),
      (row) => row.compiles ?? 0,
    ),
    count("The budget ran out", (row) => probed(row) && verdicts(row, "untested") > 0),
    section("Candidates"),
    sum("In all", (row) => VERDICTS.reduce((total, verdict) => total + verdicts(row, verdict), 0)),
    ...VERDICTS.map((verdict) =>
      sum(verdict === "editable" ? "Editable" : `\`${verdict}\``, (row) => verdicts(row, verdict)),
    ),
    section("Macros' and environments' arguments, per document"),
    sum("In all", (row) => row.arguments?.length ?? 0),
    ...VERDICTS.map((verdict) =>
      sum(verdict === "editable" ? "Editable" : `\`${verdict}\``, (row) =>
        argumentsBy(row, verdict),
      ),
    ),
    sum(
      "Editable, but not when empty",
      (row) =>
        (row.arguments ?? []).filter(
          (each) => each.verdict === "editable" && each.empty !== undefined,
        ).length,
    ),
    ratio("Macros and environments every argument of which is editable", (row) => {
      const found = editableMacros(row);
      return { total: found.called, editable: found.editable };
    }),
    section("Standard nodes, editable"),
    ratio("Section titles", standard("section")),
    ratio("List items' text", standard("item")),
    ratio("List items' labels", standard("label")),
    ratio("Paragraphs", standard("paragraph")),
    section("The reference's glyphs"),
    sum("In all", (row) => row.glyphs?.reference ?? 0),
    share(
      "Covered by editable fields",
      (row) => row.glyphs?.covered ?? 0,
      (row) => row.glyphs?.reference ?? 0,
    ),
    share(
      "Set by a locked candidate",
      (row) => row.glyphs?.candidate ?? 0,
      (row) => row.glyphs?.reference ?? 0,
    ),
    share(
      "Set by a raw chunk",
      (row) => row.glyphs?.raw ?? 0,
      (row) => row.glyphs?.reference ?? 0,
    ),
    share(
      "Set by the template alone",
      (row) => row.glyphs?.chrome ?? 0,
      (row) => row.glyphs?.reference ?? 0,
    ),
    section("Time"),
    middle("The dump, median", (row) => row.dumpMs, " ms"),
    most("The dump, slowest", (row) => row.dumpMs, " ms"),
    middle("The probe, median", (row) => row.probeMs, " ms"),
    most("The probe, slowest", (row) => row.probeMs, " ms"),
    ...(locked.length === 0
      ? []
      : [
          section("Locked arguments, by the argument and its verdict: documents"),
          ...locked.map(([name]) =>
            count(`\`${name}\``, (row) =>
              (row.arguments ?? []).some(
                (each) => `${shownArgument(each)}: ${each.verdict}` === name,
              ),
            ),
          ),
        ]),
    ...(editable.length === 0
      ? []
      : [
          section("Editable arguments, by the argument: documents"),
          ...editable.map(([name]) =>
            count(`\`${name}\``, (row) =>
              (row.arguments ?? []).some(
                (each) => shownArgument(each) === name && each.verdict === "editable",
              ),
            ),
          ),
        ]),
  ];
  return `${lines.map(printable).join("\n")}\n`;
}
