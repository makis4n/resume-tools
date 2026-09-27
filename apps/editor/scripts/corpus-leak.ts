/**
 * What leaves the browser, over the corpus (milestone 3 item 11, decision 0029): `corpus leak`
 * takes each fetched document in as the reference runner does (`corpus-reference.ts`), and for
 * each that compiles to a reference and whose body parses builds its naming request as the import
 * will (`src/import/naming.ts`): with the upload's sources, the page's strings its reference sets
 * (`pageStrings`), the texts its preamble stores, and the header's values the finder gives by the
 * seed's answers (`headerOf`). It checks each request with the leak detector, fed all of those
 * (`findLeaks`), and prints how many documents it checked, passed and failed, and for each failure
 * the macro, the kind of place and the kind of text, never the text; it exits 1 on any failure.
 *
 * The documents go to the reference runner's pool of child processes (`runPool`), one at a time
 * each, with LIMIT_MS each; the child is `corpus-leak-child.ts`, which leaves the probe's compiles
 * out, since what the probe decides goes in a request as a verdict from a closed list.
 *
 * What is printed and written names macros and counts, never a document's text: a macro's name
 * only when it is plainly one, and every line through `printable`.
 */

// Node runs this file by stripping its types, so it imports values only from files that import
// nothing Node lacks, and the editor's modules as types alone, with their real extensions.
import { fileURLToPath } from "node:url";
import type { NamingRequest } from "@resume-tools/naming";
import type { HeaderValues, Leak, LeakKind, Origin } from "../src/import/naming.ts";
import { FAMILIES, type Family, printable } from "./corpus-manifest.ts";
import { shownMacro } from "./corpus-parse.ts";
import { runPool } from "./corpus-reference.ts";

/** The leak runner's child, which Node runs in each process of its pool. */
export const LEAK_CHILD = fileURLToPath(new URL("./corpus-leak-child.ts", import.meta.url));

/** What became of a document: its request checked, or why it has none. */
export type LeakOutcome = "checked" | "no reference" | "not parsed" | "crashed" | "timeout";

/**
 * A leak as the runner reports it: the kind of place that holds it, the macro whose definition,
 * call site or signature that is, by its name when it is plainly one, and the kind of text.
 */
export interface LeakFinding {
  kind: LeakKind;
  macro?: string;
  origin: Origin;
}

/**
 * What a document's request holds, in numbers: its macros, its definitions and the document's own
 * among them, how many of those the document's values masked, and how many of those the page's
 * strings masked more of than the rest would have; and how many of the header's fields the finder
 * found.
 */
export interface LeakCounts {
  macros: number;
  definitions: number;
  own: number;
  masked: number;
  byPage: number;
  header: number;
}

/** A document as the leak runner leaves it: names and numbers only. */
export interface LeakRow {
  id: string;
  family: Family;
  outcome: LeakOutcome;
  engine?: "pdftex" | "xetex";
  counts?: LeakCounts;
  /** How many words, pairs of words and identifiers its page showed. */
  page?: { words: number; pairs: number; identifiers: number };
  /** What its request holds of its text; none when it passed. */
  findings?: LeakFinding[];
  /** Milliseconds its child took. */
  wall?: number;
}

/** A row as a child sends it, before the parent adds the document's id, its family and its time. */
export type LeakChildRow = Omit<LeakRow, "id" | "family" | "wall">;

/** The header's fields the finder may find, as `HeaderValues` has them. */
const HEADER_FIELDS = ["first", "last", "headline", "email", "phone", "location", "links"] as const;

/**
 * What a request holds, in numbers (`LeakCounts`): `request` built as the import builds it, and
 * `unpaged` the same without the page's strings; `meaning` is what the engine printed of a
 * definition, and `own` whether the upload defines its name.
 */
export function leakCounts(
  request: Pick<NamingRequest, "macros" | "definitions">,
  unpaged: Pick<NamingRequest, "definitions">,
  meaning: (name: string) => string | undefined,
  own: (name: string) => boolean,
  header: HeaderValues,
): LeakCounts {
  const without = new Map(
    unpaged.definitions.flatMap((each) =>
      each.kind === "definition" ? [[each.name, each.text] as const] : [],
    ),
  );
  let definitions = 0;
  let owned = 0;
  let masked = 0;
  let byPage = 0;
  for (const each of request.definitions) {
    if (each.kind !== "definition") continue;
    definitions++;
    if (!own(each.name)) continue;
    owned++;
    if (each.text !== meaning(each.name)) masked++;
    if (each.text !== without.get(each.name)) byPage++;
  }
  return {
    macros: request.macros.length,
    definitions,
    own: owned,
    masked,
    byPage,
    header: HEADER_FIELDS.filter((field) => header[field] !== undefined).length,
  };
}

/** A document's leaks as the runner reports them (`LeakFinding`), each once, in the request's order. */
export function leakFindings(leaks: readonly Leak[]): LeakFinding[] {
  const seen = new Set<string>();
  const findings: LeakFinding[] = [];
  for (const leak of leaks) {
    const macro = leak.macro === undefined ? undefined : shownMacro(leak.macro);
    const id = `${leak.kind}|${leak.macro ?? ""}|${leak.origin}`;
    if (seen.has(id)) continue;
    seen.add(id);
    findings.push({
      kind: leak.kind,
      ...(macro === undefined ? {} : { macro }),
      origin: leak.origin,
    });
  }
  return findings;
}

/**
 * Check every document of `documents` in the pool, `upload` giving each one's zip, and give each
 * one's row, sorted by id; `onRow` hears each as it ends.
 */
export async function checkCorpus(options: {
  documents: readonly { id: string; family: Family }[];
  upload: (id: string) => Uint8Array;
  onRow?: (row: LeakRow, done: number) => void;
}): Promise<LeakRow[]> {
  const families = new Map(options.documents.map((doc) => [doc.id, doc.family]));
  const rows: LeakRow[] = [];
  await runPool({
    script: LEAK_CHILD,
    tasks: options.documents.map((doc) => ({
      id: doc.id,
      message: () => ({ name: `${doc.id}.zip`, bytes: options.upload(doc.id) }),
    })),
    onResult: (task, result) => {
      const reply = result.reply as { row: LeakChildRow } | undefined;
      const row: LeakRow = {
        id: task.id,
        family: families.get(task.id) ?? "other",
        ...(reply?.row ?? { outcome: result.timedOut ? "timeout" : "crashed" }),
        wall: Math.round(result.wall),
      };
      rows.push(row);
      options.onRow?.(row, rows.length);
    },
  });
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Whether a document's request passed: it was checked, and holds none of its text. */
export const passed = (row: LeakRow) =>
  row.outcome === "checked" && (row.findings ?? []).length === 0;

/** Whether a document's request failed: it was checked, and holds some of its text. */
export const failed = (row: LeakRow) =>
  row.outcome === "checked" && (row.findings ?? []).length > 0;

/** What a kind of text is, as the table says it. */
const ORIGINS: Readonly<Record<Origin, string>> = {
  text: "the body's text",
  link: "a link's address",
  date: "a date",
  raw: "a raw chunk's text",
  header: "a header value",
  stored: "a stored text",
  page: "the page's text",
};

/** What kind of place holds a leak, as the table says it, before the macro's name. */
const PLACES: Readonly<Record<LeakKind, string>> = {
  "own definition": "the own definition of",
  "tree definition": "the tree's definition of",
  "call site": "a call site of",
  signature: "the signature of",
  setting: "a setting",
  class: "the class's name or an option",
};

/** A leak as a line says it: the kind of text, and where, a macro by its name when it is plain. */
export function shownFinding(finding: LeakFinding): string {
  const named = finding.kind !== "setting" && finding.kind !== "class";
  const macro =
    finding.macro === undefined ? "a macro whose name is not plain" : `\`${finding.macro}\``;
  return `${ORIGINS[finding.origin]} in ${PLACES[finding.kind]}${named ? ` ${macro}` : ""}`;
}

/** A document's row as a line of progress: numbers and names only. */
export function leakLine(row: LeakRow): string {
  if (row.outcome !== "checked") return row.outcome;
  const findings = row.findings ?? [];
  const masked = row.counts === undefined ? "" : `, ${row.counts.masked} own masked`;
  return findings.length === 0
    ? `${row.engine}, passes${masked}`
    : `${row.engine}, FAILS: ${findings.map(shownFinding).join("; ")}`;
}

/** The line the table ends with: how many documents were checked, and how many passed and failed. */
export function leakHeadline(rows: readonly LeakRow[]): string {
  const checked = rows.filter((row) => row.outcome === "checked").length;
  return `${checked} ${checked === 1 ? "document" : "documents"} checked: ${rows.filter(passed).length} passed, ${rows.filter(failed).length} failed.`;
}

const COLUMNS = [...FAMILIES, "all"] as const;

/**
 * The leak runner's table: per family and in all, what became of the documents, how many
 * requests passed and failed, and how many of their own definitions the documents' values masked,
 * and the page's strings more of; then each failure's leaks, and the headline (`leakHeadline`).
 */
export function leakTable(rows: readonly LeakRow[]): string {
  const of = (column: (typeof COLUMNS)[number]) =>
    column === "all" ? rows : rows.filter((row) => row.family === column);
  const sum = (list: readonly LeakRow[], count: (counts: LeakCounts) => number) =>
    list.reduce((total, row) => total + (row.counts === undefined ? 0 : count(row.counts)), 0);
  const line = (label: string, cell: (list: readonly LeakRow[]) => number) =>
    `| ${label} | ${COLUMNS.map((column) => cell(of(column))).join(" | ")} |`;
  const outcome =
    (...outcomes: LeakOutcome[]) =>
    (list: readonly LeakRow[]) =>
      list.filter((row) => outcomes.includes(row.outcome)).length;
  const lines = [
    `| | ${COLUMNS.join(" | ")} |`,
    `|---|${COLUMNS.map(() => "---").join("|")}|`,
    line("Documents", (list) => list.length),
    line("No reference", outcome("no reference")),
    line("Not parsed", outcome("not parsed")),
    line("Crashed or timed out", outcome("crashed", "timeout")),
    line("Checked", outcome("checked")),
    line("Passed", (list) => list.filter(passed).length),
    line("**Failed**", (list) => list.filter(failed).length),
    line("Own definitions", (list) => sum(list, (counts) => counts.own)),
    line("Masked by the document's values", (list) => sum(list, (counts) => counts.masked)),
    line("Masked further by the page", (list) => sum(list, (counts) => counts.byPage)),
    line(
      "With the header's values found",
      (list) => list.filter((row) => (row.counts?.header ?? 0) > 0).length,
    ),
    "",
    ...rows
      .filter(failed)
      .map((row) => `${row.id}: ${(row.findings ?? []).map(shownFinding).join("; ")}.`),
    leakHeadline(rows),
  ];
  return `${lines.map(printable).join("\n")}\n`;
}
