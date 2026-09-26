/**
 * The parser over the corpus (milestone 3 item 4, decision 0020): `corpus parse` takes each fetched
 * document in as the reference runner does (`corpus-reference.ts`), and for each that compiles to a
 * reference asks the engine for its signatures (`src/import/signatures.ts`), parses its body into a
 * tree (`src/import/parse.ts`), prints the tree back (`src/import/print.ts`), and compiles the
 * printed body with the document's own preamble as the reference was compiled, to see whether it
 * sets the reference's glyphs. It prints one table of what became of them, per family and in all.
 *
 * The documents go to the reference runner's pool of child processes (`runPool`), one at a time
 * each, with LIMIT_MS each; the child is `corpus-parse-child.ts`.
 *
 * What is printed and written names macros and counts, never a document's text: a macro's name
 * only when it is plainly one, and every line through `printable`.
 */

// Node runs this file by stripping its types, so it imports values only from files that import
// nothing Node lacks, and the editor's modules as types alone, with their real extensions.
import type { Argument, Node, Tree } from "../src/import/parse.ts";
import type { DifferenceKind } from "../src/import/reference.ts";
import type { EngineSignatures, Resolution } from "../src/import/signatures.ts";
import { FAMILIES, type Family, printable } from "./corpus-manifest.ts";

/** How a template macro's arguments were read, in the table's order (`signatures.ts`). */
const RESOLUTIONS: readonly Resolution[] = [
  "meaning",
  "optional",
  "robust",
  "xparse",
  "unresolved",
];

/** What became of a document: parsed, or why not. */
export type ParseOutcome =
  /** Parsed, printed back and compiled again. */
  | "parsed"
  /** The reference compile refused it, so it never reached the parser. */
  | "no reference"
  /** The parser refused it, at its caps or for want of a body. */
  | "refused"
  /** The engine printed no signatures: the compile that prints them stopped. */
  | "signatures"
  /** Its child ran past its time, or died. */
  | "timeout"
  | "crashed";

/** How a document's printed body came out when compiled again. */
export type RoundTrip = "same" | "differs" | "stopped";

/** Characters of the body: all of it, and in rich text, template calls' arguments and raw chunks. */
export interface Characters {
  body: number;
  text: number;
  calls: number;
  raw: number;
}

/** One document's row: names of macros and numbers only, never its text. */
export interface ParseRow {
  id: string;
  family: Family;
  outcome: ParseOutcome;
  /** For a document the parser refused, which rule: its body, its length, its depth, its size. */
  refused?: string;
  engine?: "pdftex" | "xetex";
  /** Whether the tree printed back to the inlined body, byte for byte. */
  printed?: boolean;
  roundTrip?: RoundTrip;
  /** The first difference's kind, for a round trip that differs. */
  difference?: DifferenceKind;
  /** The template macros the body calls, by how their arguments were read. */
  templates?: Record<Resolution, number>;
  /** The template macros the body calls whose arguments could not be read, and why. */
  unresolved?: { name: string; why: string }[];
  /** The template environments the body opens. */
  environments?: number;
  /** Every template macro the compile printed, closures included. */
  macros?: number;
  /** Names the body uses that are undefined when its preamble ends. */
  undefined?: number;
  /** Those names, as they are. */
  undefinedNames?: string[];
  /** Whether the compile that prints signatures stopped at its cap. */
  truncated?: boolean;
  chars?: Characters;
  dates?: number;
  nodes?: number;
  levels?: number;
  /** Milliseconds: parsing (reading and building the tree), and the signatures' two compiles. */
  parseMs?: number;
  signaturesMs?: number;
  /** Milliseconds from the document's being sent to its child to its row coming back. */
  wall: number;
}

/** A row as a child sends it, before the parent adds the document's id, family and time. */
export type ParseChildRow = Omit<ParseRow, "id" | "family" | "wall">;

/** The kinds of first difference the table counts apart; the rest are counted together. */
const COUNTED_DIFFERENCES: readonly DifferenceKind[] = ["glyph", "position", "special"];

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

/** A macro's name as the table prints it: a backslash and the name, when it is plainly one. */
export function shownMacro(name: string): string | undefined {
  return /^[A-Za-z@*]{1,63}$/.test(name) ? `\\${name}` : undefined;
}

const LABELS: Readonly<Record<Resolution, string>> = {
  meaning: "from its meaning",
  optional: "from the optional-argument form",
  robust: "from the robust form",
  xparse: "from xparse",
  unresolved: "unresolved",
};

/** How many unresolved macros' names the table lists; `parseNames` gives them all. */
export const TOP_UNRESOLVED = 15;

/**
 * Every template macro the documents call whose arguments could not be read, with how many
 * documents call it, the most first and then by name.
 */
function unresolvedTally(rows: readonly ParseRow[]): [string, number][] {
  const tally = new Map<string, number>();
  for (const row of rows)
    for (const name of new Set((row.unresolved ?? []).map((each) => each.name))) {
      const shown = shownMacro(name);
      if (shown !== undefined) tally.set(shown, (tally.get(shown) ?? 0) + 1);
    }
  return [...tally].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
}

/** Every name the documents use undefined when the preamble ends, with how many documents do. */
function undefinedTally(rows: readonly ParseRow[]): [string, number][] {
  const tally = new Map<string, number>();
  for (const row of rows)
    for (const name of new Set(row.undefinedNames ?? [])) {
      const shown = shownMacro(name);
      if (shown !== undefined) tally.set(shown, (tally.get(shown) ?? 0) + 1);
    }
  return [...tally].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Every unresolved macro's name with how many documents call it (`unresolvedTally`), and every
 * name undefined when the preamble ends with how many use it, for the JSON.
 */
export function parseNames(rows: readonly ParseRow[]): {
  unresolved: Record<string, number>;
  undefined: Record<string, number>;
} {
  return {
    unresolved: Object.fromEntries(unresolvedTally(rows)),
    undefined: Object.fromEntries(undefinedTally(rows)),
  };
}

/**
 * What parsing the corpus came to, as one Markdown table, per family and in all: the documents
 * that reached the parser, how many it parsed, refused or could not get signatures for, how many
 * printed back byte for byte, and how many round trips set the reference's glyphs or differ, and
 * how first; the template macros the bodies call, by how their arguments were read, per document
 * and in all; the environments, the macros found with their closures, the names undefined when the
 * preamble ends; the share of the bodies' characters in rich text, in template calls' arguments
 * and in raw chunks; the dates read; and the parse's median and slowest time. Under it, why the
 * unresolved macros are, and the names most documents call unresolved.
 */
export function parseTable(rows: readonly ParseRow[]): string {
  const of = (column: (typeof COLUMNS)[number]) =>
    rows.filter((row) => column === "all" || row.family === column);
  const line = (label: string, values: readonly (number | string)[]) =>
    `| ${label} | ${values.join(" | ")} |`;
  const count = (label: string, test: (row: ParseRow) => boolean) =>
    line(
      label,
      COLUMNS.map((column) => of(column).filter(test).length),
    );
  const sum = (label: string, pick: (row: ParseRow) => number) =>
    line(
      label,
      COLUMNS.map((column) => of(column).reduce((total, row) => total + pick(row), 0)),
    );
  const middle = (label: string, pick: (row: ParseRow) => number | undefined, unit = "") =>
    line(
      label,
      COLUMNS.map((column) => {
        const value = median(of(column).flatMap((row) => pick(row) ?? []));
        return value === undefined ? "" : `${Math.round(value)}${unit}`;
      }),
    );
  const share = (label: string, pick: (chars: Characters) => number) =>
    line(
      label,
      COLUMNS.map((column) => {
        const parsed = of(column).flatMap((row) => row.chars ?? []);
        const body = parsed.reduce((total, chars) => total + chars.body, 0);
        const part = parsed.reduce((total, chars) => total + pick(chars), 0);
        return body === 0 ? "" : `${Math.round((100 * part) / body)}%`;
      }),
    );
  const section = (label: string) =>
    line(
      `**${label}**`,
      COLUMNS.map(() => ""),
    );
  const parsed = (row: ParseRow) => row.outcome === "parsed";
  const templates = (row: ParseRow) =>
    RESOLUTIONS.reduce((total, how) => total + (row.templates?.[how] ?? 0), 0);
  const whys = [
    ...new Set(rows.flatMap((row) => (row.unresolved ?? []).map((each) => each.why))),
  ].sort();
  const top = unresolvedTally(rows).slice(0, TOP_UNRESOLVED);
  const undefinedTop = undefinedTally(rows).slice(0, TOP_UNRESOLVED);
  const lines = [
    line("", COLUMNS),
    `|---|${COLUMNS.map(() => "--:").join("|")}|`,
    count("Documents with a reference", (row) => row.outcome !== "no reference"),
    count("Parsed", parsed),
    count("Refused by the parser", (row) => row.outcome === "refused"),
    count(
      "No signatures: the compile that prints them stopped",
      (row) => row.outcome === "signatures",
    ),
    count("Timed out or died", (row) => row.outcome === "timeout" || row.outcome === "crashed"),
    count("Printed back byte for byte", (row) => row.printed === true),
    count("Round trip sets the reference's glyphs", (row) => row.roundTrip === "same"),
    count("Round trip differs", (row) => row.roundTrip === "differs"),
    ...COUNTED_DIFFERENCES.map((kind) =>
      count(`Round trip differs first in a ${kind}`, (row) => row.difference === kind),
    ),
    count(
      "Round trip differs first otherwise: pages, size, count, rule",
      (row) =>
        row.roundTrip === "differs" &&
        row.difference !== undefined &&
        !COUNTED_DIFFERENCES.includes(row.difference),
    ),
    count("Round trip did not compile", (row) => row.roundTrip === "stopped"),
    section("Template macros the body calls"),
    sum("In all", templates),
    middle("Per document, median", (row) => (parsed(row) ? templates(row) : undefined)),
    ...RESOLUTIONS.map((how) =>
      sum(`Arguments read ${LABELS[how]}`, (row) => row.templates?.[how] ?? 0),
    ),
    sum("Template environments the body opens", (row) => row.environments ?? 0),
    middle("Template macros with their closures, per document, median", (row) =>
      parsed(row) ? row.macros : undefined,
    ),
    count("Signatures stopped at the cap of names", (row) => row.truncated === true),
    sum("Names undefined when the preamble ends", (row) => row.undefined ?? 0),
    section("The body's characters"),
    share("In rich text and dates", (chars) => chars.text),
    share("In template calls' arguments", (chars) => chars.calls),
    share("In raw chunks", (chars) => chars.raw),
    sum("Dates read", (row) => row.dates ?? 0),
    middle("Parse time, median", (row) => row.parseMs, " ms"),
    line(
      "Parse time, slowest",
      COLUMNS.map((column) => {
        const times = of(column).flatMap((row) => row.parseMs ?? []);
        return times.length === 0 ? "" : `${Math.round(Math.max(...times))} ms`;
      }),
    ),
    middle("Signatures' two compiles, median", (row) => row.signaturesMs, " ms"),
    ...(whys.length === 0
      ? []
      : [
          section("Unresolved, by why"),
          ...whys.map((why) =>
            sum(why, (row) => (row.unresolved ?? []).filter((each) => each.why === why).length),
          ),
        ]),
    ...(top.length === 0
      ? []
      : [
          section("Unresolved, by the macro"),
          ...top.map(([name]) =>
            count(`\`${name}\``, (row) =>
              (row.unresolved ?? []).some((each) => shownMacro(each.name) === name),
            ),
          ),
        ]),
    ...(undefinedTop.length === 0
      ? []
      : [
          section("Undefined when the preamble ends, by the command"),
          ...undefinedTop.map(([name]) =>
            count(`\`${name}\``, (row) =>
              (row.undefinedNames ?? []).some((each) => shownMacro(each) === name),
            ),
          ),
        ]),
  ];
  return `${lines.map(printable).join("\n")}\n`;
}

// A document's row.

/** How much of a body is in rich text, in template calls' arguments and in raw chunks. */
export function charactersOf(tree: Tree): Characters {
  let text = 0;
  let calls = 0;
  let raw = 0;
  const spans = (args: readonly Argument[]) =>
    args.reduce((total, arg) => total + (arg.present ? arg.end - arg.start : 0), 0);
  const walk = (nodes: readonly Node[]) => {
    for (const node of nodes) visit(node);
  };
  const inside = (args: readonly Argument[]) => {
    for (const arg of args) if (arg.present && arg.content !== undefined) walk(arg.content);
  };
  const visit = (node: Node) => {
    switch (node.kind) {
      case "call":
        calls += spans(node.args);
        return;
      case "environment":
        calls += spans(node.args);
        walk(node.content);
        return;
      case "text":
      case "date":
        text += node.end - node.start;
        return;
      case "raw": {
        const placed = (node.args ?? []).filter((arg) => arg.present && arg.content !== undefined);
        raw += node.end - node.start - spans(placed);
        inside(placed);
        return;
      }
      case "section":
        inside(node.args);
        return;
      case "group":
        walk(node.content);
        return;
      default:
        inside(node.args);
        walk(node.content);
    }
  };
  walk(tree.content);
  return { body: tree.source.length, text, calls, raw };
}

/** How many date nodes a tree holds, in arguments and all. */
export function datesOf(tree: Tree): number {
  let dates = 0;
  const walk = (nodes: readonly Node[]) => {
    for (const node of nodes) {
      if (node.kind === "date") dates++;
      if ("args" in node) for (const arg of node.args ?? []) walk(arg.content ?? []);
      if ("content" in node) walk(node.content);
    }
  };
  walk(tree.content);
  return dates;
}

/**
 * The part of a row that the signatures give: the template macros the body calls by how their
 * arguments were read, those unresolved by name and why, the template environments, the template
 * macros found with their closures, and the names undefined when the preamble ends.
 */
export function signatureCounts(
  signatures: EngineSignatures,
): Pick<
  ParseChildRow,
  | "templates"
  | "unresolved"
  | "environments"
  | "macros"
  | "undefined"
  | "undefinedNames"
  | "truncated"
> {
  const templates = Object.fromEntries(RESOLUTIONS.map((how) => [how, 0])) as Record<
    Resolution,
    number
  >;
  const unresolved: { name: string; why: string }[] = [];
  const undefinedNames: string[] = [];
  for (const [name, signature] of Object.entries(signatures.commands)) {
    if (signature.kind === "undefined") undefinedNames.push(name);
    if (signature.kind !== "template") continue;
    templates[signature.how]++;
    if (signature.how === "unresolved") unresolved.push({ name, why: signature.why ?? "" });
  }
  return {
    templates,
    unresolved,
    environments: Object.values(signatures.environments).filter((each) => each.kind === "template")
      .length,
    macros: Object.keys(signatures.macros).length,
    undefined: undefinedNames.length,
    undefinedNames,
    truncated: signatures.truncated,
  };
}
