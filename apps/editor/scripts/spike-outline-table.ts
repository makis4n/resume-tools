/**
 * The outline spike's rows and tables (`spike-outline.ts`): what each document came to, ids and
 * counts only, and the tables by template family, with a row for each upstream sample and a total,
 * beside the first pass's editable share of the same documents.
 *
 * Node runs this file as it is, from the parent, so it imports nothing of the editor but types.
 */

import { FAMILIES, type Family, printable } from "./corpus-manifest.ts";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { Words } from "./spike-outline-build.ts";

/** What became of a document: measured, or where it stopped. */
export type OutlineOutcome =
  | "measured"
  | "no reference"
  | "refused"
  | "not parsed"
  | "baseline"
  | "timeout"
  | "crashed";

/** One document's row, ids and counts only, as the parent writes it under `.corpus/spike-outline/`. */
export interface OutlineRow {
  version: 1;
  id: string;
  family: Family;
  /** One of the oracle's three upstream samples, rather than a corpus document. */
  sample: boolean;
  outcome: OutlineOutcome;
  /** Why a step refused it: a word of a closed list. */
  refused?: string;
  engine?: "pdftex" | "xetex";
  /** How the probe compiled it: from its own format, or whole. */
  path?: "format" | "whole";
  latinModern?: boolean;
  /** The reference's glyphs, and those the probe's editable candidates cover (decision 0022). */
  glyphs?: { reference: number; covered: number };
  /** The probe's candidates: editable, locked, holding structure, and by verdict. */
  candidates?: {
    editable: number;
    locked: number;
    container: number;
    verdicts?: Record<string, number>;
  };
  /**
   * The fields: the probe's editable candidates, those check 1 made kept text and why, those left,
   * and those whose text could not be written from their leaves, which kept their own bytes.
   */
  fields?: { probed: number; kept: Record<string, number>; final: number; unclean: number };
  words?: Words;
  /**
   * The groups of units, lists and runs, their units, those of one unit and those whose last unit
   * holds a field; how many take a copy of the last unit, a removal of the first and of the last;
   * and the trials the budget left untried.
   */
  groups?: {
    found: number;
    lists: number;
    runs: number;
    units: number;
    single: number;
    withField: number;
    copy: number;
    first: number;
    last: number;
    /** Groups that take all three, which the editor may add to and remove from (item 6). */
    all?: number;
    untried: number;
    /**
     * How many groups' trials of each kind came to each verdict (`TrialVerdict`): the rest of the
     * page in its order, or reflowed, which both keep it; stopped; or broken; or untried.
     */
    verdicts?: Record<string, Record<string, number>>;
    /** Each trial that did not keep the page: its group by its command's name, its units, why. */
    failing?: {
      group: string;
      units: number;
      kind: string;
      verdict: string;
      /**
       * For a trial that broke the page alone, its glyphs lost, left and added (`brokenBy`), and
       * how many pages more or fewer than the reference's its output has.
       */
      glyphs?: { lost: number; left: number; added: number; pages: number };
    }[];
  };
  /**
   * Compiles: the probe's, the baseline compiled again for its auxiliary files, check 1's and the
   * units' trials'.
   */
  compiles?: { probe: number; again: number; check1: number; units: number };
  /** Milliseconds of each step, and of the whole in the child. */
  ms?: Partial<
    Record<
      "reference" | "latinModern" | "parse" | "probe" | "again" | "check1" | "units" | "words",
      number
    >
  > & {
    total: number;
  };
  /** Milliseconds from the document's being sent to its child to its row coming back. */
  wall: number;
}

/** A row as the child sends it, before the parent adds the document's id, family and time. */
export type OutlineChildRow = Omit<OutlineRow, "version" | "id" | "family" | "sample" | "wall">;

/**
 * The first pass's words of each document, editable in fields the page opens and the resume's:
 * from `corpus run --committed-only`'s JSON for the corpus's documents, and for the upstream
 * samples the hand counts `scripts/corpus-oracle.test.ts` pins its report to (decision 0039).
 */
export type FirstPass = ReadonlyMap<string, { editable: number; all: number } | "none">;

/** The upstream samples' first pass: item 13's report, pinned to the hand counts (decision 0039). */
export const SAMPLE_FIRST_PASS: Readonly<Record<string, { editable: number; all: number }>> = {
  "jake-0000": { editable: 323, all: 389 },
  "altacv-0000": { editable: 67, all: 232 },
  "awesome-cv-0000": { editable: 1023, all: 1287 },
};

/**
 * What the spike reads of a first pass's run's JSON, which `--first` names and no command writes
 * since the second pass's item 17: each document's id, and its words as its report counted them,
 * where it assembled.
 */
export interface FirstPassRun {
  documents: readonly { id: string; counted?: { editable: number; all: number } }[];
}

/**
 * The first pass's words of each document a run's JSON holds, and of the samples: a document it
 * assembled with what its report counted, and one it did not, refused, unanswered or timed out,
 * as `none`, none of its words editable.
 */
export function firstPassOf(
  run: FirstPassRun | undefined,
): Map<string, { editable: number; all: number } | "none"> {
  const found = new Map<string, { editable: number; all: number } | "none">(
    Object.entries(SAMPLE_FIRST_PASS),
  );
  for (const row of run?.documents ?? [])
    found.set(
      row.id,
      row.counted === undefined ? "none" : { editable: row.counted.editable, all: row.counted.all },
    );
  return found;
}

/** The import's own time, without what only the spike adds: the baseline again and the words. */
export const importMs = (row: OutlineRow) => {
  const ms = row.ms;
  if (ms === undefined) return undefined;
  return ms.total - (ms.again ?? 0) - (ms.words ?? 0);
};

/** Whether a document was measured, so that its counts count. */
const measured = (row: OutlineRow) => row.outcome === "measured";

/** A share in whole per cent, rounded down as the report shows its rate, or a dash for none. */
export const percent = (part: number, whole: number) =>
  whole === 0 ? "–" : `${Math.floor((100 * part) / whole + 1e-9)}%`;

/** A median, or undefined for none. */
function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Seconds, to a tenth. */
const seconds = (ms: number | undefined) =>
  ms === undefined ? "–" : `${(ms / 1000).toFixed(1)} s`;

/** The first pass's editable words of a document, and its resume's, a document it did not import counting the spike's. */
function firstOf(row: OutlineRow, first: FirstPass): { editable: number; all: number } | undefined {
  const found = first.get(row.id);
  if (found === undefined) return undefined;
  if (found === "none") return { editable: 0, all: row.words?.body ?? 0 };
  return found;
}

/** A sum over rows. */
const sum = (rows: readonly OutlineRow[], pick: (row: OutlineRow) => number | undefined) =>
  rows.reduce((total, row) => total + (pick(row) ?? 0), 0);

/** Each document's line, ids and counts only. */
export function documentTable(rows: readonly OutlineRow[], first: FirstPass): string {
  const lines = [
    "| Document | Engine | Words | In fields | Retype reaches | Locked | First pass | Groups | Copy | Remove first | Remove last | All three | Compiles | Time |",
    "|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|",
  ];
  for (const row of rows) {
    if (!measured(row)) {
      lines.push(
        `| ${row.id} | ${row.engine ?? ""} | ${row.outcome}${row.refused === undefined ? "" : ` (${row.refused})`} | | | | | | | | | | | ${seconds(row.wall)} |`,
      );
      continue;
    }
    const words = row.words as Words;
    const pass = firstOf(row, first);
    const groups = row.groups;
    const compiles = row.compiles;
    lines.push(
      `| ${row.id} | ${row.engine === "xetex" ? "XeTeX" : "pdfTeX"} | ${words.body} | ${percent(words.fields, words.body)} | ${percent(words.retype, words.body)} | ${percent(words.locked, words.body)} | ${pass === undefined ? "?" : percent(pass.editable, pass.all)} | ${groups?.found ?? 0} | ${groups?.copy ?? 0} | ${groups?.first ?? 0} | ${groups?.last ?? 0} | ${groups?.all ?? "?"} | ${compiles === undefined ? "" : compiles.probe + compiles.check1 + compiles.units} | ${seconds(importMs(row))} |`,
    );
  }
  return `${lines.map(printable).join("\n")}\n`;
}

/** A row of the family tables: its label, and the rows it adds up. */
interface Column {
  label: string;
  rows: readonly OutlineRow[];
}

/**
 * The rows the tables add up: each family of the corpus's documents, the corpus's documents
 * together, each upstream sample, and every document together.
 */
function columnsOf(rows: readonly OutlineRow[]): Column[] {
  const corpus = rows.filter((row) => !row.sample);
  const samples = rows.filter((row) => row.sample);
  return [
    ...FAMILIES.flatMap((family) => {
      const ofFamily = corpus.filter((row) => row.family === family);
      return ofFamily.length === 0 ? [] : [{ label: family, rows: ofFamily }];
    }),
    ...(corpus.length === 0 ? [] : [{ label: "The corpus's documents", rows: corpus }]),
    ...samples.map((row) => ({ label: `${row.id} (upstream)`, rows: [row] })),
    { label: "All", rows },
  ];
}

/**
 * The words by template family, with a row for each upstream sample and for every document: the
 * documents measured of those taken; the resume's words, and their shares in fields, in kept text
 * the retype reaches, and locked; the documents at the 90% bar; the probe's share of the
 * reference's glyphs (decision 0022's 73%) and of the words, before check 1; and the first pass's
 * editable share of the same documents' words, a document it did not import counting none.
 */
export function wordsTable(rows: readonly OutlineRow[], first: FirstPass): string {
  const lines = [
    "| | Documents | Resume's words | In fields | Retype reaches | Locked | At 90% | Probe: glyphs | Probe: words | First pass |",
    "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|",
  ];
  for (const column of columnsOf(rows)) {
    const done = column.rows.filter(measured);
    const words = (pick: (each: Words) => number) =>
      sum(done, (row) => (row.words === undefined ? 0 : pick(row.words)));
    const body = words((each) => each.body);
    const at90 = done.filter(
      (row) =>
        row.words !== undefined && row.words.body > 0 && row.words.fields >= 0.9 * row.words.body,
    ).length;
    const passes = done.flatMap((row) => {
      const found = firstOf(row, first);
      return found === undefined ? [] : [found];
    });
    const firstShare =
      passes.length < done.length
        ? "?"
        : percent(
            passes.reduce((total, each) => total + each.editable, 0),
            passes.reduce((total, each) => total + each.all, 0),
          );
    lines.push(
      `| ${column.label} | ${done.length} of ${column.rows.length} | ${body} | ${percent(
        words((each) => each.fields),
        body,
      )} | ${percent(
        words((each) => each.retype),
        body,
      )} | ${percent(
        words((each) => each.locked),
        body,
      )} | ${at90} | ${percent(
        sum(done, (row) => row.glyphs?.covered),
        sum(done, (row) => row.glyphs?.reference),
      )} | ${percent(
        words((each) => each.probe),
        body,
      )} | ${firstShare} |`,
    );
  }
  return `${lines.map(printable).join("\n")}\n`;
}

/**
 * The units and the time by template family, as the words: the groups found and their units, how
 * many take a copy of their last unit and a removal of their first and of their last; the
 * documents by engine; and the compiles and the import's time, its median and its slowest.
 */
export function unitsTable(rows: readonly OutlineRow[]): string {
  const lines = [
    "| | Groups | Units | Copy | Remove first | Remove last | All three | Engine | Compiles, median | Time, median | Time, slowest |",
    "|---|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|",
  ];
  for (const column of columnsOf(rows)) {
    const done = column.rows.filter(measured);
    const groups = (pick: (each: NonNullable<OutlineRow["groups"]>) => number) =>
      sum(done, (row) => (row.groups === undefined ? 0 : pick(row.groups)));
    const found = groups((each) => each.found);
    const engines = (["pdftex", "xetex"] as const)
      .map((engine) => [engine, done.filter((row) => row.engine === engine).length] as const)
      .filter(([, n]) => n > 0)
      .map(([engine, n]) => `${engine === "xetex" ? "XeTeX" : "pdfTeX"} ${n}`)
      .join(", ");
    const compiles = done.flatMap((row) =>
      row.compiles === undefined
        ? []
        : [row.compiles.probe + row.compiles.check1 + row.compiles.units],
    );
    const times = done.flatMap((row) => {
      const ms = importMs(row);
      return ms === undefined ? [] : [ms];
    });
    const middle = median(compiles);
    lines.push(
      `| ${column.label} | ${found} | ${groups((each) => each.units)} | ${groups((each) => each.copy)} | ${groups((each) => each.first)} | ${groups((each) => each.last)} | ${groups((each) => each.all ?? 0)} | ${engines} | ${middle === undefined ? "–" : Math.round(middle)} | ${seconds(median(times))} | ${seconds(times.length === 0 ? undefined : Math.max(...times))} |`,
    );
  }
  return `${lines.map(printable).join("\n")}\n`;
}
