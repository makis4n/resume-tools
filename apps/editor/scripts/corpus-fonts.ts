/**
 * The XeTeX rewrite over the corpus (milestone 3 item 8, decision 0023): `corpus fonts` takes each
 * document that compiles to a reference on XeTeX, and each pdfTeX document that guards on the
 * engine and loads a font package that loads fontspec on XeTeX, compiled to a reference on XeTeX
 * for this, rewrites its fonts by file (`src/import/xetex.ts`), checks the rewrite against the
 * reference, dumps its preamble and compiles its body from the format (`src/import/xetex-check.ts`),
 * and prints one table of what became of them, per family and in all.
 *
 * It runs in the same pool of child processes as `corpus reference` (`corpus-reference.ts`), each
 * with an engine session of its own (`corpus-fonts-child.ts`), with the same time limit a document.
 * What is printed and written names fonts, features, packages and families, and counts, never a
 * document's text; a document's logs, which quote its source, are written under `.corpus/` alone.
 */

import { FAMILIES, type Family, printable } from "./corpus-manifest.ts";
import { shownName } from "./corpus-survey.ts";

/** Which documents the runner takes: XeTeX's, and pdfTeX's that guard on the engine, on XeTeX. */
export type Taken = "xetex" | "either";

/** What became of a document. */
export type FontsOutcome =
  /** Rewritten, and the whole document, the dump and the body from the format all matched. */
  | "rewritten"
  /** Refused by the rewrite or its check: a font, a feature, glyphs that differ, or a stop. */
  | "font"
  | "feature"
  | "difference"
  | "stopped"
  /** No reference on XeTeX, which only a pdfTeX document taken on XeTeX can lack here. */
  | "no-reference"
  /** Past the time limit, or its child died. */
  | "timeout"
  | "crashed";

/** One document's row: names and numbers only, never its text. */
export interface FontsRow {
  id: string;
  family: Family;
  taken: Taken;
  outcome: FontsOutcome;
  /** The font, feature or package a refusal names, as shown (`shownName`). */
  name?: string;
  /** Families and shapes the rewrite declared, and the kinds of feature they carry, each a family. */
  families?: number;
  shapes?: number;
  features?: Record<string, number>;
  /** Whether a difference in mathematics alone was let pass. */
  maths?: boolean;
  /** Milliseconds: the reference's compile, the whole document's, the dump, the body's. */
  referenceMs?: number;
  wholeMs?: number;
  dumpMs?: number;
  bodyMs?: number;
  /** The format's size, in bytes. */
  formatBytes?: number;
  /** Milliseconds from the document's being sent to its child to its row coming back. */
  wall: number;
}

/** A row as a child sends it, before the parent adds the document's id, family and time. */
export type FontsChildRow = Omit<FontsRow, "id" | "family" | "wall">;

/** A name as a row keeps it: plainly a name, or `(unprintable name)` (`shownName`). */
export const rowName = (name: string | undefined) =>
  name === undefined ? undefined : /^\\[A-Za-z@]{1,63}$/.test(name) ? name : shownName(name);

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

const REFUSED: readonly [FontsOutcome, string][] = [
  ["font", "Refused: a font the tree lacks"],
  ["feature", "Refused: a feature or package the rewrite cannot reproduce"],
  ["difference", "Refused: glyphs that come out otherwise"],
  ["stopped", "Refused: a compile or dump that stopped once rewritten"],
];

/**
 * What the rewrite made of the corpus, as one Markdown table, per family and in all: the documents
 * taken and how, those rewritten and matched and those refused for each reason, with what each
 * refusal names; the dump's time and the format's size; the body's compile from the format against
 * the whole document's; the families and shapes declared; and the kinds of feature carried. Every
 * line is one line, whatever a name holds (`printable`).
 */
export function fontsTable(rows: readonly FontsRow[]): string {
  const of = (column: (typeof COLUMNS)[number]) =>
    rows.filter((row) => column === "all" || row.family === column);
  const line = (label: string, values: readonly (number | string)[]) =>
    `| ${label} | ${values.join(" | ")} |`;
  const count = (label: string, test: (row: FontsRow) => boolean) =>
    line(
      label,
      COLUMNS.map((column) => of(column).filter(test).length),
    );
  const sum = (label: string, pick: (row: FontsRow) => number | undefined) =>
    line(
      label,
      COLUMNS.map((column) => of(column).reduce((total, row) => total + (pick(row) ?? 0), 0)),
    );
  const measure = (
    label: string,
    pick: (row: FontsRow) => number | undefined,
    reduce: (values: number[]) => number | undefined,
    unit: (value: number) => string,
  ) =>
    line(
      label,
      COLUMNS.map((column) => {
        const values = of(column).flatMap((row) => {
          const value = row.outcome === "rewritten" ? pick(row) : undefined;
          return value === undefined ? [] : [value];
        });
        const value = reduce(values);
        return value === undefined ? "" : unit(value);
      }),
    );
  const ms = (value: number) => `${Math.round(value)} ms`;
  const mb = (value: number) => `${(value / 1e6).toFixed(2)} MB`;
  const slowest = (values: number[]) => (values.length === 0 ? undefined : Math.max(...values));
  const section = (label: string) =>
    line(
      `**${label}**`,
      COLUMNS.map(() => ""),
    );
  const rewritten = (row: FontsRow) => row.outcome === "rewritten";
  const named = (outcome: FontsOutcome, label: string) => {
    const tally = new Map<string, number>();
    for (const row of rows)
      if (row.outcome === outcome && row.name !== undefined)
        tally.set(row.name, (tally.get(row.name) ?? 0) + 1);
    const names = [...tally].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
    if (names.length === 0) return [];
    return [
      section(label),
      ...names.map(([name]) =>
        count(`\`${name}\``, (row) => row.outcome === outcome && row.name === name),
      ),
    ];
  };
  const kinds = [...new Set(rows.flatMap((row) => Object.keys(row.features ?? {})))].sort();
  const lines = [
    line("", COLUMNS),
    `|---|${COLUMNS.map(() => "--:").join("|")}|`,
    count("Documents taken: XeTeX, with a reference", (row) => row.taken === "xetex"),
    count(
      "Documents taken: pdfTeX guarded on the engine, with font packages, on XeTeX",
      (row) => row.taken === "either",
    ),
    count("Rewritten, dumped, and matched the reference twice", rewritten),
    count(
      "... with mathematics alone set otherwise",
      (row) => rewritten(row) && row.maths === true,
    ),
    ...REFUSED.map(([outcome, label]) => count(label, (row) => row.outcome === outcome)),
    count("No reference on XeTeX", (row) => row.outcome === "no-reference"),
    count(
      "Timed out, or its child died",
      (row) => row.outcome === "timeout" || row.outcome === "crashed",
    ),
    measure("Dump, median", (row) => row.dumpMs, median, ms),
    measure("Dump, slowest", (row) => row.dumpMs, slowest, ms),
    measure("Format, median size", (row) => row.formatBytes, median, mb),
    measure("Body from the format, median", (row) => row.bodyMs, median, ms),
    measure("Whole document from the stock format, median", (row) => row.wholeMs, median, ms),
    measure("Reference compile, median", (row) => row.referenceMs, median, ms),
    sum("Families declared", (row) => (rewritten(row) ? row.families : undefined)),
    sum("Shapes declared", (row) => (rewritten(row) ? row.shapes : undefined)),
    ...(kinds.length === 0
      ? []
      : [
          section("Families carrying a feature, by kind, in rewritten documents"),
          ...kinds.map((kind) =>
            sum(`\`${kind}\``, (row) => (rewritten(row) ? row.features?.[kind] : undefined)),
          ),
        ]),
    ...named("font", "Fonts the tree lacks"),
    ...named("feature", "Features and packages the rewrite cannot reproduce"),
    ...named("difference", "Fonts whose glyphs come out otherwise"),
  ];
  return `${lines.map(printable).join("\n")}\n`;
}
