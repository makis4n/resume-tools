/**
 * What leaves the browser, over the corpus (milestone 3 item 11, decision 0033): `corpus leak`
 * takes each fetched document in as the reference runner does (`corpus-reference.ts`), and for
 * each that compiles to a reference and whose body parses builds its naming request as the import
 * will (`src/import/naming.ts`): with the upload's sources, the page's strings its reference sets
 * (`pageStrings`), the texts its preamble stores, and the header's values the finder gives by the
 * seed's answers (`headerOf`). It checks each request with the leak detector, fed all of those
 * (`findLeaks`), and prints how many documents it checked, passed and failed, and for each failure
 * the macro, the kind of place and the kind of text, never the text. A document whose page the
 * detector cannot read is refused, as the import refuses it (`pageReadable`), and counted so, never
 * passed; so is one whose request holds only a single word the builder does not mask by, which the
 * check alone looks for, stricter on purpose (`withheld`): the gate refuses it, and nothing leaves.
 * It exits 1 when the proof shrinks or fails (`leakFailures`): a request holds text the builder
 * should have masked, the builder made a request its contract refuses, a document crashed or timed
 * out, or fewer documents were checked or refused than have a reference.
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
import type { HeaderValues, Leak, LeakKind, Origin, PageStrings } from "../src/import/naming.ts";
import { FAMILIES, type Family, printable } from "./corpus-manifest.ts";
import { shownMacro } from "./corpus-parse.ts";
import { runPool } from "./corpus-reference.ts";

/** The leak runner's child, which Node runs in each process of its pool. */
export const LEAK_CHILD = fileURLToPath(new URL("./corpus-leak-child.ts", import.meta.url));

/**
 * What became of a document: its request checked; refused, since its page is one the detector
 * cannot read; invalid, a request the contract refuses, which the builder threw; or why it has
 * none.
 */
export type LeakOutcome =
  | "checked"
  | "refused"
  | "invalid"
  | "no reference"
  | "not parsed"
  | "crashed"
  | "timeout";

/**
 * A leak as the runner reports it: the kind of place that holds it, the macro whose definition,
 * call site or signature that is, by its name when it is plainly one, the kind of text, and whether
 * it is a single word the builder does not mask by, which the check alone looks for (`Leak.alone`).
 */
export interface LeakFinding {
  kind: LeakKind;
  macro?: string;
  origin: Origin;
  alone?: true;
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
  /**
   * How many words, pairs of words, identifiers, numbers and letter-spaced words its page showed,
   * and how many glyphs it set and read.
   */
  page?: {
    words: number;
    pairs: number;
    identifiers: number;
    numbers: number;
    runs: number;
    glyphs: number;
    readable: number;
  };
  /** How many of its macros' names the request writes as placeholders, the person's words. */
  names?: number;
  /** What its request holds of its text; none when it passed. */
  findings?: LeakFinding[];
  /** Where an invalid request breaks its contract, by kind of place and macro, never what. */
  problems?: { kind: LeakKind | "request"; macro?: string }[];
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
 * definition, and `own` whether the upload defines its name, each asked by the document's name;
 * `real` gives the document's name of a name each request masks (`realName`).
 */
export function leakCounts(
  request: Pick<NamingRequest, "macros" | "definitions">,
  unpaged: Pick<NamingRequest, "definitions">,
  meaning: (name: string) => string | undefined,
  own: (name: string) => boolean,
  header: HeaderValues,
  real: { request: (name: string) => string; unpaged: (name: string) => string } = {
    request: (name) => name,
    unpaged: (name) => name,
  },
): LeakCounts {
  const without = new Map(
    unpaged.definitions.flatMap((each) =>
      each.kind === "definition" ? [[real.unpaged(each.name), each.text] as const] : [],
    ),
  );
  let definitions = 0;
  let owned = 0;
  let masked = 0;
  let byPage = 0;
  for (const each of request.definitions) {
    if (each.kind !== "definition") continue;
    definitions++;
    const name = real.request(each.name);
    if (!own(name)) continue;
    owned++;
    if (each.text !== meaning(name)) masked++;
    if (each.text !== without.get(name)) byPage++;
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
    const id = `${leak.kind}|${leak.macro ?? ""}|${leak.origin}|${leak.alone === true}`;
    if (seen.has(id)) continue;
    seen.add(id);
    findings.push({
      kind: leak.kind,
      ...(macro === undefined ? {} : { macro }),
      origin: leak.origin,
      ...(leak.alone === true ? { alone: true as const } : {}),
    });
  }
  return findings;
}

/**
 * Check every document of `documents` in the pool, `upload` giving each one's zip, and give each
 * one's row, sorted by id; `onRow` hears each as it ends, and `onPage`, when given, each page's
 * strings, which hold the document's text and are kept in memory alone, never printed or written.
 */
export async function checkCorpus(options: {
  documents: readonly { id: string; family: Family }[];
  upload: (id: string) => Uint8Array;
  onRow?: (row: LeakRow, done: number) => void;
  onPage?: (id: string, page: PageStrings) => void;
}): Promise<LeakRow[]> {
  const families = new Map(options.documents.map((doc) => [doc.id, doc.family]));
  const rows: LeakRow[] = [];
  await runPool({
    script: LEAK_CHILD,
    tasks: options.documents.map((doc) => ({
      id: doc.id,
      message: () => ({
        name: `${doc.id}.zip`,
        bytes: options.upload(doc.id),
        ...(options.onPage === undefined ? {} : { pages: true }),
      }),
    })),
    onResult: (task, result) => {
      const reply = result.reply as { row: LeakChildRow; page?: PageStrings } | undefined;
      if (reply?.page !== undefined) options.onPage?.(task.id, reply.page);
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

/**
 * Whether a document's request failed: it was checked, and holds text of its own the builder should
 * have masked, any but a single word it does not mask by.
 */
export const failed = (row: LeakRow) =>
  row.outcome === "checked" && (row.findings ?? []).some((finding) => finding.alone !== true);

/**
 * Whether the gate withholds a document's request: it was checked, and holds only single words the
 * builder does not mask by, which the check alone looks for (`Leak.alone`): the gate refuses it, as
 * the import's does, and nothing of it leaves.
 */
export const withheld = (row: LeakRow) =>
  row.outcome === "checked" && (row.findings ?? []).length > 0 && !failed(row);

/**
 * Why a run's proof failed or shrank, each a line, none when it holds: a request holds its
 * document's text; the builder made a request its contract refuses; a document crashed or timed
 * out; fewer documents were checked, or refused for a page the detector cannot read, than have a
 * reference, as when one does not parse; or none was checked at all.
 */
export function leakFailures(rows: readonly LeakRow[]): string[] {
  const count = (test: (row: LeakRow) => boolean) => rows.filter(test).length;
  const references = count((row) => row.outcome !== "no reference");
  const accounted = count((row) => row.outcome === "checked" || row.outcome === "refused");
  const failures: string[] = [];
  if (count(failed) > 0)
    failures.push("A naming request holds its document's text, as the lines above name.");
  if (count((row) => row.outcome === "invalid") > 0)
    failures.push(
      "The builder made a naming request its contract refuses, as the lines above name.",
    );
  if (count((row) => row.outcome === "crashed" || row.outcome === "timeout") > 0)
    failures.push("A document crashed or timed out, so its request went unchecked.");
  if (accounted < references)
    failures.push(
      `Of ${references} documents with a reference, ${accounted} were checked or refused: the check covers fewer than it should.`,
    );
  if (count((row) => row.outcome === "checked") === 0)
    failures.push("No document was checked, which proves nothing.");
  return failures;
}

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
const PLACES: Readonly<Record<LeakKind | "request", string>> = {
  "own definition": "the own definition of",
  "tree definition": "the tree's definition of",
  "call site": "a call site of",
  signature: "the signature of",
  setting: "a setting",
  class: "the class's name or an option",
  name: "a macro's name, which is not shown",
  request: "the request's fields of",
};

/** A leak as a line says it: the kind of text, and where, a macro by its name when it is plain. */
export function shownFinding(finding: LeakFinding): string {
  const named = finding.kind !== "setting" && finding.kind !== "class" && finding.kind !== "name";
  const macro =
    finding.macro === undefined ? "a macro whose name is not plain" : `\`${finding.macro}\``;
  const what =
    finding.alone === true
      ? `a single word of ${ORIGINS[finding.origin]}`
      : ORIGINS[finding.origin];
  return `${what} in ${PLACES[finding.kind]}${named ? ` ${macro}` : ""}`;
}

/** Where an invalid request breaks its contract, as a line says it: kinds of place and macros. */
function shownProblems(row: LeakRow): string {
  const shown = (row.problems ?? []).map((problem) => {
    const macro = problem.macro === undefined ? undefined : shownMacro(problem.macro);
    const named = problem.kind !== "setting" && problem.kind !== "class" && problem.kind !== "name";
    return `${PLACES[problem.kind]}${named ? ` ${macro === undefined ? "a macro whose name is not plain" : `\`${macro}\``}` : ""}`;
  });
  return [...new Set(shown)].join("; ");
}

/** A document's row as a line of progress: numbers and names only. */
export function leakLine(row: LeakRow): string {
  if (row.outcome === "refused")
    return `${row.engine}, refused: its page is set in fonts the detector cannot read`;
  if (row.outcome === "invalid")
    return `${row.engine}, INVALID: the request breaks its contract in ${shownProblems(row)}`;
  if (row.outcome !== "checked") return row.outcome;
  const findings = row.findings ?? [];
  const masked = row.counts === undefined ? "" : `, ${row.counts.masked} own masked`;
  if (findings.length === 0) return `${row.engine}, passes${masked}`;
  return `${row.engine}, ${failed(row) ? "FAILS" : "withheld by the gate"}: ${findings.map(shownFinding).join("; ")}`;
}

/**
 * The line the table ends with: how many documents have a reference, and of them how many were
 * checked, passed and failed, refused for a page the detector cannot read, invalid, not parsed,
 * and crashed or timed out.
 */
export function leakHeadline(rows: readonly LeakRow[]): string {
  const count = (...outcomes: LeakOutcome[]) =>
    rows.filter((row) => outcomes.includes(row.outcome)).length;
  const references = rows.length - count("no reference");
  return `${references} ${references === 1 ? "document" : "documents"} with a reference: ${count("checked")} checked, ${rows.filter(passed).length} passed, ${rows.filter(failed).length} failed, ${rows.filter(withheld).length} withheld by the gate for a single word the builder leaves, ${count("refused")} refused for pages the detector cannot read, ${count("invalid")} invalid, ${count("not parsed")} not parsed, ${count("crashed", "timeout")} crashed or timed out.`;
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
    line("Refused: a page the detector cannot read", outcome("refused")),
    line("**Invalid**: a request its contract refuses", outcome("invalid")),
    line("Checked", outcome("checked")),
    line("Passed", (list) => list.filter(passed).length),
    line(
      "Withheld by the gate: a single word the builder leaves",
      (list) => list.filter(withheld).length,
    ),
    line("**Failed**", (list) => list.filter(failed).length),
    line("Own definitions", (list) => sum(list, (counts) => counts.own)),
    line("Masked by the document's values", (list) => sum(list, (counts) => counts.masked)),
    line("Masked further by the page", (list) => sum(list, (counts) => counts.byPage)),
    line("Names written as placeholders", (list) =>
      list.reduce((total, row) => total + (row.names ?? 0), 0),
    ),
    line(
      "With the header's values found",
      (list) => list.filter((row) => (row.counts?.header ?? 0) > 0).length,
    ),
    "",
    ...rows
      .filter(failed)
      .map((row) => `${row.id}: ${(row.findings ?? []).map(shownFinding).join("; ")}.`),
    ...rows
      .filter(withheld)
      .map(
        (row) =>
          `${row.id}, withheld by the gate: ${(row.findings ?? []).map(shownFinding).join("; ")}.`,
      ),
    ...rows
      .filter((row) => row.outcome === "invalid")
      .map((row) => `${row.id}: the request breaks its contract in ${shownProblems(row)}.`),
    ...(rows.some((row) => row.outcome === "refused")
      ? [
          `Refused, their pages set in fonts the detector cannot read: ${rows
            .filter((row) => row.outcome === "refused")
            .map((row) => row.id)
            .join(", ")}.`,
        ]
      : []),
    leakHeadline(rows),
  ];
  return `${lines.map(printable).join("\n")}\n`;
}
