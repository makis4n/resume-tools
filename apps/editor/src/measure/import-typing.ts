/**
 * Typing on an imported resume (the perf run's lane D2): an import opened as the app opens it, then
 * its longest editable field edited, each edit timed from its command to its drawn page, as the
 * editor's own measurement times a built-in template's (`measure.ts`, decisions 0016 and 0066).
 *
 * An import is measured by `measureImport` (`import.ts`), which takes the files through the editor's
 * compile scheduler as the document list does and opens the document they come to, to its first
 * drawn page; once it is open, on the scheduler and the engine that imported it, as the app keeps
 * them, `typeIn` edits the field whose rows cost the most to lay out (`longestField`), its last
 * character retyped (`editCommand`) through the document's history under the import's package, so
 * that the edit is one the package takes, as a person's is. Each edit is split as the editor's own
 * measurements split it: the scheduler's pause, which waits for the typing to stop, the compile
 * and the draw; the page's own time (`Shown.ms`), the compile and the draw with the body's making
 * around them, is what the plan's 300 ms is judged on, the pause beside it, as decision 0016 has it.
 *
 * The same measurement runs in two places: `scripts/measure.ts --typing-imports` in Node, over
 * corpus resumes a file of ids names, and the app's `?measure=import-typing` page
 * (`ImportTypingPage.tsx`), on the worker, over the three upstream samples (`TYPING_SAMPLES`).
 * Neither prints a word of a resume: ids, families, counts and milliseconds only. This module
 * reaches for neither Node nor the browser.
 */

import { CommandError, History } from "../editor/document";
import type { Engine } from "../engine/session";
import type { RefusalReason } from "../import/refusal";
import {
  formatTime,
  type ImportHow,
  type ImportRefused,
  type ImportTime,
  isRefused,
  measureImport,
  type Opened,
} from "./import";
import {
  editCommand,
  formatMs,
  longestField,
  type MeasuredField,
  median,
  meets,
  TARGETS,
  table,
} from "./measure";

/** Edits timed on each imported resume, unless the caller says otherwise. */
export const TYPING_EDITS = 5;

/**
 * The upstream samples the browser's page types on, one for each launch template, by their ids in
 * `corpus/oracle.json`: the only resumes of the corpus's families anyone may read.
 */
export const TYPING_SAMPLES: readonly { id: string; name: string }[] = [
  { id: "jake-0000", name: "Jake's Resume" },
  { id: "altacv-0000", name: "AltaCV" },
  { id: "awesome-cv-0000", name: "Awesome-CV" },
];

/** The family an id names, as `corpus collect` gives ids: `other-0028` is of `other`. */
export const familyOf = (id: string) => id.replace(/-\d{4}$/, "");

/** One edit of an imported resume, from its command to its drawn page, and its parts, in ms. */
export interface TypingEdit {
  /** The whole: the command applied, the scheduler's pause, then its run to the drawn page. */
  ms: number;
  /** The whole less the page's own time: the pause before the compile, and the command. */
  pauseMs: number;
  /** The page's own time, as the scheduler times it (`Shown.ms`): what the plan's 300 ms judges. */
  pageMs: number;
  compileMs: number;
  drawMs: number;
  /** TeX's passes; one, unless the log asked for a rerun. */
  passes: number;
  /** The pages the edit's output set. */
  pages: number;
}

/**
 * What the typing came to: the edits of the field, or why none was timed: the page shows no
 * editable field, or the package refused the edit, as it refuses a person's.
 */
export type Typed =
  | { typed: true; field: MeasuredField; edits: TypingEdit[] }
  | { typed: false; why: "no field" | "edit refused"; pages: number };

/** An import and the typing on it, or the refusal that stopped the import. */
export type ImportTypingMeasured =
  | { refused: ImportRefused }
  | { import: ImportTime; typing: Typed };

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/**
 * Edit the opened document's longest field `edits` times, one edit after another, each waiting for
 * its page, through the document's history under the import's package, and time each from the
 * command to the page it brings, the scheduler's pause included, with its compiles and draws read
 * from the scheduler's requests and draws. None when the page shows no field to edit, or the
 * package refuses the edit.
 */
export async function typeIn(opened: Opened, edits: number): Promise<Typed> {
  if (!Number.isInteger(edits) || edits < 1) throw new Error("edits must be a whole number from 1");
  const { compiler, document, pkg, first, requests, draws, pageOf, now } = opened;
  const pages = first.page.pageCount;
  const field = longestField(document.resume, first.page);
  if (field === undefined) return { typed: false, why: "no field", pages };
  const history = new History(document, pkg);
  const timed: TypingEdit[] = [];
  for (let i = 0; i < edits; i++) {
    const [requested, drawn] = [requests.length, draws.length];
    const began = now();
    let next: typeof document;
    try {
      next = history.dispatch(editCommand(history.present, field.id));
    } catch (error) {
      if (error instanceof CommandError) return { typed: false, why: "edit refused", pages };
      throw error;
    }
    const edited = pageOf(next);
    compiler.update(next);
    const shown = await edited;
    const ms = now() - began;
    const compiles = requests.slice(requested).filter((each) => each.kind === "compile");
    timed.push({
      ms,
      pauseMs: Math.max(0, ms - shown.ms),
      pageMs: shown.ms,
      compileMs: sum(compiles.map((each) => each.ms)),
      drawMs: sum(draws.slice(drawn)),
      passes: sum(compiles.map((each) => each.passes?.length ?? 0)),
      pages: shown.page.pageCount,
    });
  }
  return { typed: true, field, edits: timed };
}

/**
 * Import the files as `measureImport` does, open what they come to, then time `edits` edits of its
 * longest field on the same scheduler and engine (`typeIn`); or stop at the import's refusal. Throws
 * when a page cannot be made, with the scheduler's message, which may quote the resume: a caller
 * over corpus resumes says nothing of it.
 */
export async function measureImportTyping(
  how: Omit<ImportHow, "opened">,
  edits = TYPING_EDITS,
): Promise<ImportTypingMeasured> {
  let typing: Typed | undefined;
  const measured = await measureImport({
    ...how,
    opened: async (opened) => {
      typing = await typeIn(opened, edits);
    },
  });
  if (isRefused(measured)) return { refused: measured };
  if (typing === undefined) throw new Error("the document opened without its typing timed");
  return { import: measured, typing };
}

/** A resume typed on, as the tables take it: ids, counts and times, never a word of it. */
export interface TypingRow {
  id: string;
  family: string;
  engine: Engine;
  field: { kind: MeasuredField["kind"]; characters: number };
  edits: TypingEdit[];
  /** The import before the typing: from the file to the first page, and its compiles. */
  import: { ms: number; compiles: number };
}

/** The row of an import typed on, under its id and family. */
export function typingRow(
  id: string,
  family: string,
  measured: { import: ImportTime; typing: Typed & { typed: true } },
): TypingRow {
  const { field, edits } = measured.typing;
  return {
    id,
    family,
    engine: measured.import.engine,
    field: { kind: field.kind, characters: field.length },
    edits,
    import: { ms: measured.import.ms, compiles: measured.import.compiles },
  };
}

/** A row's edits in short: medians of each part, the slowest, and the pages. */
export interface TypingStats {
  /** The page's own time, the median and the slowest of the edits. */
  median: number;
  slowest: number;
  pause: number;
  compile: number;
  draw: number;
  /** The whole, from the command, the pause included: the median and the slowest. */
  withPause: number;
  slowestWithPause: number;
  /** The most pages an edit set. */
  pages: number;
  /** The edits that took a second pass. */
  reran: number;
}

export function typingStats(edits: readonly TypingEdit[]): TypingStats {
  const of = (pick: (edit: TypingEdit) => number) => edits.map(pick);
  return {
    median: median(of((edit) => edit.pageMs)),
    slowest: Math.max(...of((edit) => edit.pageMs)),
    pause: median(of((edit) => edit.pauseMs)),
    compile: median(of((edit) => edit.compileMs)),
    draw: median(of((edit) => edit.drawMs)),
    withPause: median(of((edit) => edit.ms)),
    slowestWithPause: Math.max(...of((edit) => edit.ms)),
    pages: Math.max(...of((edit) => edit.pages)),
    reran: edits.filter((edit) => edit.passes > 1).length,
  };
}

/**
 * The value at a share of some numbers, by the nearest rank: the 90th percentile of ten numbers is
 * the ninth smallest.
 */
export function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) throw new Error("there are no values to take a percentile of");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(share * sorted.length)));
  return sorted[rank - 1] as number;
}

/**
 * Some rows in short: how many, the share whose median edit is within the plan's 300 ms by the
 * page's own time, and the median, the 90th percentile and the slowest of their medians, with and
 * without the pause; the slowest single edit too.
 */
export interface TypingSummary {
  resumes: number;
  under: number;
  share: number;
  median: number;
  p90: number;
  slowest: number;
  slowestEdit: number;
  withPause: { median: number; p90: number; slowest: number };
}

export function typingSummary(rows: readonly TypingRow[]): TypingSummary | undefined {
  if (rows.length === 0) return undefined;
  const stats = rows.map((row) => typingStats(row.edits));
  const medians = stats.map((each) => each.median);
  const paused = stats.map((each) => each.withPause);
  const under = medians.filter((value) => meets(TARGETS.typical, value)).length;
  return {
    resumes: rows.length,
    under,
    share: under / rows.length,
    median: median(medians),
    p90: percentile(medians, 0.9),
    slowest: Math.max(...medians),
    slowestEdit: Math.max(...stats.map((each) => each.slowest)),
    withPause: {
      median: median(paused),
      p90: percentile(paused, 0.9),
      slowest: Math.max(...paused),
    },
  };
}

/** The resumes no edit was timed on, by why: refused by a reason, no field, refused edit, failed. */
export interface TypingSkipped {
  refused: Partial<Record<RefusalReason, number>>;
  noField: number;
  editRefused: number;
  /** The import, or a page, failed; what it said may quote the resume, so it goes unsaid. */
  failed: number;
}

export const noneSkipped = (): TypingSkipped => ({
  refused: {},
  noField: 0,
  editRefused: 0,
  failed: 0,
});

/** Note why a resume was skipped. */
export function skip(skipped: TypingSkipped, measured: ImportTypingMeasured | "failed") {
  if (measured === "failed") skipped.failed++;
  else if ("refused" in measured) {
    const { reason } = measured.refused.refused;
    skipped.refused[reason] = (skipped.refused[reason] ?? 0) + 1;
  } else if (!measured.typing.typed) {
    if (measured.typing.why === "no field") skipped.noField++;
    else skipped.editRefused++;
  }
}

/** How many were skipped in all. */
export const skippedCount = (skipped: TypingSkipped) =>
  sum(Object.values(skipped.refused)) + skipped.noField + skipped.editRefused + skipped.failed;

/** A share as a table gives it. */
const shareOf = (value: number) => `${(value * 100).toFixed(0)}%`;

/** The table of rows, one a resume: its id, family, engine, pages, field, and its edits' parts. */
export function typingTable(rows: readonly TypingRow[]): string {
  return table([
    [
      "Id",
      "Family",
      "Engine",
      "Pages",
      "Field",
      "Edit, median",
      "Slowest",
      "Pause",
      "Compile",
      "Draw",
      "With the pause",
      "Import",
    ],
    ...rows.map((row) => {
      const stats = typingStats(row.edits);
      return [
        row.id,
        row.family,
        row.engine,
        String(stats.pages),
        `${row.field.kind}, ${row.field.characters} ch`,
        formatMs(stats.median),
        formatMs(stats.slowest),
        formatMs(stats.pause),
        formatMs(stats.compile),
        formatMs(stats.draw),
        formatMs(stats.withPause),
        `${formatTime(row.import.ms)}, ${row.import.compiles} compiles`,
      ];
    }),
  ]);
}

/** The table of rows by family, and in all: each a summary (`typingSummary`). */
export function familyTable(rows: readonly TypingRow[]): string {
  const families = [...new Set(rows.map((row) => row.family))].sort();
  const line = (name: string, of: readonly TypingRow[]) => {
    const summary = typingSummary(of);
    if (summary === undefined) return [name, "0", "-", "-", "-", "-", "-"];
    return [
      name,
      String(summary.resumes),
      `${summary.under} (${shareOf(summary.share)})`,
      formatMs(summary.median),
      formatMs(summary.p90),
      formatMs(summary.slowest),
      formatMs(summary.withPause.median),
    ];
  };
  return table([
    ["Family", "Resumes", "Under 300 ms", "Median", "p90", "Slowest", "With the pause"],
    ...families.map((family) =>
      line(
        family,
        rows.filter((row) => row.family === family),
      ),
    ),
    line("all", rows),
  ]);
}

/** What was skipped, in a sentence. */
export function skippedLine(skipped: TypingSkipped): string {
  const refused = Object.entries(skipped.refused)
    .sort(([a, x], [b, y]) => (y as number) - (x as number) || (a < b ? -1 : 1))
    .map(([reason, count]) => `${reason} ${count}`);
  const total = skippedCount(skipped);
  if (total === 0) return "None skipped.";
  return [
    `Skipped ${total}:`,
    `refused ${sum(Object.values(skipped.refused))}${refused.length > 0 ? ` (${refused.join(", ")})` : ""},`,
    `no editable field ${skipped.noField}, the edit refused ${skipped.editRefused}, failed ${skipped.failed}.`,
  ].join(" ");
}

/** The summary's lines: the share within 300 ms and the spread, against the plan's target. */
export function summaryLines(rows: readonly TypingRow[], skipped: TypingSkipped): string[] {
  const summary = typingSummary(rows);
  const lines =
    summary === undefined
      ? ["No resume was typed on."]
      : [
          `${summary.under} of ${summary.resumes} resumes (${shareOf(summary.share)}) edit to the page within 300 ms by the page's own time, the median edit of each.`,
          `Their medians: median ${formatMs(summary.median)}, p90 ${formatMs(summary.p90)}, slowest ${formatMs(summary.slowest)}; the slowest single edit ${formatMs(summary.slowestEdit)}.`,
          `With the scheduler's pause, from the command: median ${formatMs(summary.withPause.median)}, p90 ${formatMs(summary.withPause.p90)}, slowest ${formatMs(summary.withPause.slowest)}.`,
        ];
  return [
    ...lines,
    skippedLine(skipped),
    "An edit retypes the last character of the longest editable field the page shows. The page's own time is the compile and the draw with the body's making around them, as decisions 0016 and 0066 judge it; the pause, which waits for the typing to stop, is beside it.",
  ];
}
