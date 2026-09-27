/**
 * The parser over the corpus (milestone 3 item 4, decision 0020): `corpus parse` takes each fetched
 * document in as the reference runner does (`corpus-reference.ts`), and for each that compiles to a
 * reference asks the engine for its signatures (`src/import/signatures.ts`), parses its body into a
 * tree (`src/import/parse.ts`), prints the tree back (`src/import/print.ts`), and compiles the
 * printed body with the document's own preamble as the reference was compiled, to see whether it
 * sets the reference's glyphs, twice: printed byte for byte, which says the body was split and
 * inlined as TeX reads it and the tree lost nothing; and regenerated, every text and date as the
 * generator writes what the model holds of it (`regenerate`), which says the tree read them right,
 * since a tree that is wrong prints back its bytes all the same. It prints one table of what
 * became of them, per family and in all: with the calls it kept raw because a group after them
 * belies their signature, and, for each two documents that hold the same class or style file byte
 * for byte and give it the same options, whether the file's macros both call get the same keys
 * (`keysOf`) in both, as item 6's cache needs.
 *
 * The documents go to the reference runner's pool of child processes (`runPool`), one at a time
 * each, with LIMIT_MS each; the child is `corpus-parse-child.ts`.
 *
 * What is printed and written names macros and counts, never a document's text: a macro's name
 * only when it is plainly one, and every line through `printable`; a class or style file by its
 * hash, never its name.
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

/**
 * A class or style file the document's job holds, or the class it loads from the tree: the SHA-256
 * of its bytes; the SHA-256 of what the document gives it that changes what its macros become
 * (`settingOf`); the keys of the macros it defines that the body calls and the preamble does not
 * define again (`fileMacros`), by name; and those of them whose closure holds a macro the preamble
 * defines, whose key the preamble moves (`movedByPreamble`).
 */
export interface HeldFile {
  hash: string;
  setting: string;
  macros: Record<string, string>;
  moved?: string[];
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
  /** The round trip of the tree printed byte for byte. */
  roundTrip?: RoundTrip;
  /** The first difference's kind, for a round trip that differs. */
  difference?: DifferenceKind;
  /** The round trip of the tree with its texts and dates regenerated (`regenerate`). */
  regenerated?: RoundTrip;
  /** The first difference's kind, for a regenerated round trip that differs. */
  regeneratedDifference?: DifferenceKind;
  /** Calls kept raw because a group after them belies their signature (`RawNode.suspect`). */
  suspects?: number;
  /** The class and style files the job holds, and its class from the tree, by hash, with keys. */
  files?: HeldFile[];
  /** The template macros the body calls, by how their arguments were read. */
  templates?: Record<Resolution, number>;
  /** The template macros the body calls whose arguments could not be read, and why. */
  unresolved?: { name: string; why: string }[];
  /** The template macros the body calls whose tail could not be read (`tail`), by name. */
  tails?: string[];
  /** The template macros the body calls whose arguments a package's table gave (`packages.ts`). */
  packages?: number;
  /** The template environments the body opens. */
  environments?: number;
  /** Every template macro the compile printed, closures included. */
  macros?: number;
  /** Of them, those that hold data, whose text the signatures never keep. */
  data?: number;
  /** The placeholders that mask an email, a link or a phone number in the definitions. */
  placeholders?: number;
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
  /** Of the signatures' time, the two compiles' passes alone; the rest reads what they print. */
  signaturesPassesMs?: number;
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

/** Every template macro the documents call whose tail could not be read, with how many do. */
function tailTally(rows: readonly ParseRow[]): [string, number][] {
  const tally = new Map<string, number>();
  for (const row of rows)
    for (const name of new Set(row.tails ?? [])) {
      const shown = shownMacro(name);
      if (shown !== undefined) tally.set(shown, (tally.get(shown) ?? 0) + 1);
    }
  return [...tally].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Every unresolved macro's name with how many documents call it (`unresolvedTally`), every macro
 * whose tail could not be read with how many call it, and every name undefined when the preamble
 * ends with how many use it, for the JSON.
 */
export function parseNames(rows: readonly ParseRow[]): {
  unresolved: Record<string, number>;
  tails: Record<string, number>;
  undefined: Record<string, number>;
} {
  return {
    unresolved: Object.fromEntries(unresolvedTally(rows)),
    tails: Object.fromEntries(tailTally(rows)),
    undefined: Object.fromEntries(undefinedTally(rows)),
  };
}

/**
 * Two documents that hold one class or style file byte for byte, and give it the same setting:
 * their families, how many of the file's macros both bodies call, those whose keys differ between
 * the two, and of those, the ones neither preamble moves (`HeldFile.moved`), which the key
 * invariant says there are none of.
 */
export interface FilePair {
  families: [Family, Family];
  common: number;
  differing: string[];
  unexplained: string[];
}

/**
 * Every two documents that hold a class or style file byte for byte and give it the same setting
 * (`settingOf`), a pair for each such file they share, and how the keys of the file's macros both
 * bodies call compare: item 6's cache holds only where a file byte for byte the same, given the
 * same options, gives its macros the same keys in every document that holds it.
 */
export function filePairs(rows: readonly ParseRow[]): FilePair[] {
  const holders = new Map<string, { family: Family; file: HeldFile }[]>();
  for (const row of rows) {
    const seen = new Set<string>();
    for (const file of row.files ?? []) {
      const held = `${file.hash} ${file.setting}`;
      if (seen.has(held)) continue;
      seen.add(held);
      const list = holders.get(held) ?? [];
      list.push({ family: row.family, file });
      holders.set(held, list);
    }
  }
  const pairs: FilePair[] = [];
  for (const list of holders.values())
    for (const [a, first] of list.entries())
      for (const second of list.slice(a + 1)) {
        const names = Object.keys(first.file.macros).filter((name) =>
          Object.hasOwn(second.file.macros, name),
        );
        const differing = names
          .filter((name) => first.file.macros[name] !== second.file.macros[name])
          .sort();
        const moved = new Set([...(first.file.moved ?? []), ...(second.file.moved ?? [])]);
        pairs.push({
          families: [first.family, second.family],
          common: names.length,
          differing,
          unexplained: differing.filter((name) => !moved.has(name)),
        });
      }
  return pairs;
}

/**
 * Every macro whose keys differ in two documents sharing its file, by the name it is called by
 * (`baseName`), with in how many pairs.
 */
function differingTally(pairs: readonly FilePair[]): [string, number][] {
  const tally = new Map<string, number>();
  for (const pair of pairs)
    for (const shown of new Set(pair.differing.map((name) => shownMacro(baseName(name))))) {
      if (shown !== undefined) tally.set(shown, (tally.get(shown) ?? 0) + 1);
    }
  return [...tally].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * What parsing the corpus came to, as one Markdown table, per family and in all: the documents
 * that reached the parser, how many it parsed, refused or could not get signatures for, how many
 * printed back byte for byte; how many round trips set the reference's glyphs or differ, and how
 * first, printed byte for byte and regenerated; the template macros the bodies call, by how their
 * arguments were read, per document and in all, those a package's table gave or whose tail could
 * not be read, and the calls kept raw because a group after them belies their signature; the
 * environments, the macros found with their closures, those that hold data and the placeholders
 * in the definitions, the names undefined when the preamble ends; for each two documents that
 * share a class or style file byte for byte, and give it the same setting, whether the keys of its
 * macros both call are the same; the share of the bodies' characters in rich text, in template
 * calls' arguments and in raw chunks; the dates read; and the median and slowest time of the
 * parse and of the signatures' two compiles. Under it, why the unresolved macros are, the names
 * most documents call unresolved or with a tail it could not read, the names undefined when the
 * preamble ends, and the macros whose keys differ in a shared file.
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
  const slowest = (label: string, pick: (row: ParseRow) => number | undefined) =>
    line(
      label,
      COLUMNS.map((column) => {
        const times = of(column).flatMap((row) => pick(row) ?? []);
        return times.length === 0 ? "" : `${Math.round(Math.max(...times))} ms`;
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
  /** A round trip's lines: how many set the reference's glyphs, differ, and how, or stopped. */
  const trip = (
    label: string,
    outcome: (row: ParseRow) => RoundTrip | undefined,
    first: (row: ParseRow) => DifferenceKind | undefined,
  ) => [
    count(`Round trip ${label} sets the reference's glyphs`, (row) => outcome(row) === "same"),
    count(`Round trip ${label} differs`, (row) => outcome(row) === "differs"),
    ...COUNTED_DIFFERENCES.map((kind) =>
      count(`Round trip ${label} differs first in a ${kind}`, (row) => first(row) === kind),
    ),
    count(`Round trip ${label} differs first otherwise: pages, size, count, rule`, (row) => {
      const kind = first(row);
      return (
        outcome(row) === "differs" && kind !== undefined && !COUNTED_DIFFERENCES.includes(kind)
      );
    }),
    count(`Round trip ${label} did not compile`, (row) => outcome(row) === "stopped"),
  ];
  /** A count of the pairs of documents sharing a file, a pair in a family's column when both are. */
  const pairs = filePairs(rows);
  const pairCount = (label: string, test: (pair: FilePair) => boolean) =>
    line(
      label,
      COLUMNS.map(
        (column) =>
          pairs.filter(
            (pair) =>
              test(pair) &&
              (column === "all" || pair.families.every((family) => family === column)),
          ).length,
      ),
    );
  const parsed = (row: ParseRow) => row.outcome === "parsed";
  const templates = (row: ParseRow) =>
    RESOLUTIONS.reduce((total, how) => total + (row.templates?.[how] ?? 0), 0);
  const whys = [
    ...new Set(rows.flatMap((row) => (row.unresolved ?? []).map((each) => each.why))),
  ].sort();
  const top = unresolvedTally(rows).slice(0, TOP_UNRESOLVED);
  const tailTop = tailTally(rows).slice(0, TOP_UNRESOLVED);
  const undefinedTop = undefinedTally(rows).slice(0, TOP_UNRESOLVED);
  const differingTop = differingTally(pairs).slice(0, TOP_UNRESOLVED);
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
    ...trip(
      "byte for byte",
      (row) => row.roundTrip,
      (row) => row.difference,
    ),
    ...trip(
      "regenerated",
      (row) => row.regenerated,
      (row) => row.regeneratedDifference,
    ),
    section("Template macros the body calls"),
    sum("In all", templates),
    middle("Per document, median", (row) => (parsed(row) ? templates(row) : undefined)),
    ...RESOLUTIONS.map((how) =>
      sum(`Arguments read ${LABELS[how]}`, (row) => row.templates?.[how] ?? 0),
    ),
    sum("Arguments a package's table gave", (row) => row.packages ?? 0),
    sum("A tail whose arguments could not be read", (row) => row.tails?.length ?? 0),
    sum("Calls kept raw: a group after them belies their signature", (row) => row.suspects ?? 0),
    sum("Template environments the body opens", (row) => row.environments ?? 0),
    middle("Template macros with their closures, per document, median", (row) =>
      parsed(row) ? row.macros : undefined,
    ),
    sum("Template macros with their closures, in all", (row) => row.macros ?? 0),
    sum("Of them, holding data", (row) => row.data ?? 0),
    sum("Placeholders for an email, a link or a phone number", (row) => row.placeholders ?? 0),
    count("Signatures stopped at the cap of names", (row) => row.truncated === true),
    sum("Names undefined when the preamble ends", (row) => row.undefined ?? 0),
    section("Two documents sharing a class or style file byte for byte, and its setting"),
    pairCount("Pairs of documents, a pair for each such file", () => true),
    pairCount(
      "The file's macros both call have the same keys",
      (pair) => pair.common > 0 && pair.differing.length === 0,
    ),
    pairCount(
      "Other keys, each where a preamble defines a macro it hands its work to",
      (pair) => pair.differing.length > 0 && pair.unexplained.length === 0,
    ),
    pairCount("Other keys otherwise", (pair) => pair.unexplained.length > 0),
    pairCount("They call none of the file's macros in common", (pair) => pair.common === 0),
    section("The body's characters"),
    share("In rich text and dates", (chars) => chars.text),
    share("In template calls' arguments", (chars) => chars.calls),
    share("In raw chunks", (chars) => chars.raw),
    sum("Dates read", (row) => row.dates ?? 0),
    middle("Parse time, median", (row) => row.parseMs, " ms"),
    slowest("Parse time, slowest", (row) => row.parseMs),
    middle("Signatures' two compiles, median", (row) => row.signaturesMs, " ms"),
    slowest("Signatures' two compiles, slowest", (row) => row.signaturesMs),
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
    ...(tailTop.length === 0
      ? []
      : [
          section("A tail whose arguments could not be read, by the macro"),
          ...tailTop.map(([name]) =>
            count(`\`${name}\``, (row) =>
              (row.tails ?? []).some((each) => shownMacro(each) === name),
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
    ...(differingTop.length === 0
      ? []
      : [
          section("Other keys in a shared file, by the macro: pairs"),
          ...differingTop.map(([name]) =>
            pairCount(`\`${name}\``, (pair) =>
              pair.differing.some((each) => shownMacro(baseName(each)) === name),
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

/** How many calls a tree keeps raw because a group after them belies their signature. */
export function suspectsOf(tree: Tree): number {
  let suspects = 0;
  const walk = (nodes: readonly Node[]) => {
    for (const node of nodes) {
      if (node.kind === "raw" && node.suspect === true) suspects++;
      if ("args" in node) for (const arg of node.args ?? []) walk(arg.content ?? []);
      if ("content" in node) walk(node.content);
    }
  };
  walk(tree.content);
  return suspects;
}

/** The commands that define a macro, followed by its name, braced or not. */
const DEFINES_MACRO =
  /\\(?:[gex]?def|let|(?:new|renew|provide)command\*?|DeclareRobustCommand\*?|(?:New|Renew|Provide|Declare)(?:Expandable)?DocumentCommand)\s*\{?\s*\\([A-Za-z@]+)/g;

/** The commands that define an environment, followed by its name in braces. */
const DEFINES_ENVIRONMENT =
  /\\(?:(?:new|renew)environment\*?|(?:New|Renew|Provide|Declare)DocumentEnvironment)\s*\{([A-Za-z@*]+)\}/g;

/** A source's text with its comments taken out, line by line. */
const uncommented = (text: string) => text.replace(/(^|[^\\])((?:\\\\)*)%.*$/gm, "$1$2");

/**
 * The macros a class or style file, or a preamble, defines, by the names its definitions outside
 * comments give them: `\def`, `\let` and their kin, `\newcommand` and its kin, xparse's, and an
 * environment's `\x` and `\endx`. The text is read for names alone; what each macro is comes from
 * the engine.
 */
export function definedNames(text: string): Set<string> {
  const code = uncommented(text);
  const names = new Set<string>();
  for (const match of code.matchAll(DEFINES_MACRO)) names.add(match[1] ?? "");
  for (const match of code.matchAll(DEFINES_ENVIRONMENT))
    for (const name of [match[1] ?? "", `end${match[1] ?? ""}`]) names.add(name);
  names.delete("");
  return names;
}

/**
 * The name a template macro's record is kept under, as a shape hands its work on (`signatures.ts`):
 * the robust command's `\x `, the optional argument's `\\x`, xparse's `\x code` and an
 * environment's code, all read as `x`.
 */
export function baseName(name: string): string {
  const environment = /^environment (.+?) (?:code|end|end aux|end code)$/.exec(name);
  if (environment !== null) return environment[1] ?? name;
  return name
    .replace(/^\\/, "")
    .replace(/ code$/, "")
    .trimEnd();
}

/**
 * The template macros a body calls, by the names the signatures keep them under: each template
 * command it calls, and each template environment it opens, `\x` and `\endx`.
 */
export function calledNames(signatures: Pick<EngineSignatures, "commands" | "environments">) {
  const called = new Set<string>();
  for (const [name, signature] of Object.entries(signatures.commands))
    if (signature.kind === "template") called.add(name);
  for (const [name, signature] of Object.entries(signatures.environments))
    if (signature.kind === "template") for (const each of [name, `end${name}`]) called.add(each);
  return called;
}

/**
 * The keys (`keysOf`) of the macros a file defines (`definedNames`) that the body calls
 * (`calledNames`), but for those its preamble defines again, which are the preamble's: what two
 * documents holding the file byte for byte, and giving it the same setting, should give the same
 * keys. A key is its closure's, so a macro a called one hands its work to counts in it.
 */
export function fileMacros(
  keys: Readonly<Record<string, string>>,
  defined: ReadonlySet<string>,
  called: ReadonlySet<string>,
  redefined: ReadonlySet<string> = new Set(),
): Record<string, string> {
  const macros: Record<string, string> = {};
  for (const name of called) {
    const base = baseName(name);
    const key = Object.hasOwn(keys, name) ? keys[name] : undefined;
    if (key !== undefined && defined.has(base) && !redefined.has(base)) macros[name] = key;
  }
  return macros;
}

/**
 * Of a file's macros the body calls (`fileMacros`), those whose closure holds a definition the
 * preamble defines, as a preamble's `\renewcommand{\cvsectionfont}` moves the key of the
 * `\cvsection` that hands its work to it: the preamble's doing, not the file's. A macro that holds
 * data takes no part in a key, so it moves none.
 */
export function movedByPreamble(
  signatures: Pick<EngineSignatures, "macros">,
  names: Iterable<string>,
  redefined: ReadonlySet<string>,
): string[] {
  const of = (name: string) =>
    Object.hasOwn(signatures.macros, name) ? signatures.macros[name] : undefined;
  return [...names].filter((name) => {
    const macro = of(name);
    return (
      macro !== undefined &&
      macro.kind !== "data" &&
      macro.dependencies.some(
        (dependency) => of(dependency)?.kind !== "data" && redefined.has(baseName(dependency)),
      )
    );
  });
}

/** A `\documentclass` or `\usepackage` option list, in order, its spaces and empty ones dropped. */
const optionsOf = (list: string | undefined) =>
  (list ?? "")
    .split(",")
    .map((option) => option.replace(/\s+/g, ""))
    .filter((option) => option !== "");

/** The class a preamble loads, by its name, when it names one. */
export function documentClassOf(preamble: string): string | undefined {
  const found = /\\documentclass\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/.exec(uncommented(preamble));
  const name = found?.[1]?.trim();
  return name === undefined || name === "" ? undefined : name;
}

/**
 * What a document gives a class or style file that changes what the file's macros become, as a
 * text the runner hashes: the class's options, which every package sees too; the options the
 * preamble loads the file itself with, by `\usepackage` or `\RequirePackage`; moderncv's style and
 * colour (`\moderncvstyle`, `\moderncvcolor`, or `\moderncvtheme`); and the engine, since a class
 * may define a macro one way for pdfTeX and another for XeTeX.
 */
export function settingOf(preamble: string, file: string, engine: string): string {
  const code = uncommented(preamble);
  const name = file.replace(/^.*\//, "").replace(/\.(?:cls|sty)$/i, "");
  const documentClass = /\\documentclass\s*(?:\[([^\]]*)\]\s*)?\{([^}]*)\}/.exec(code);
  const own = [
    ...code.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[([^\]]*)\]\s*)?\{([^}]*)\}/g),
  ]
    .filter((found) => (found[2] ?? "").split(",").some((each) => each.trim() === name))
    .map((found) => optionsOf(found[1]));
  const style = [...code.matchAll(/\\moderncv(style|theme)\s*(?:\[([^\]]*)\]\s*)?\{([^}]*)\}/g)];
  const colour = [...code.matchAll(/\\moderncvcolou?r\s*\{([^}]*)\}/g)];
  return JSON.stringify({
    options: optionsOf(documentClass?.[1]),
    own,
    style: style.map((found) => [found[1], optionsOf(found[2]), found[3]?.trim()]),
    colour: colour.map((found) => found[1]?.trim()),
    engine,
  });
}

/** A placeholder that masks what item 11's patterns find in a definition (`signatures.ts`). */
const PLACEHOLDER = /<(?:email|link|phone)_*>/g;

/**
 * The part of a row that the signatures give: the template macros the body calls by how their
 * arguments were read, those unresolved by name and why, those whose tail could not be read by
 * name, and how many a package's table gave; the template environments; the template macros found
 * with their closures, those that hold data, and the placeholders in the definitions; and the
 * names undefined when the preamble ends.
 */
export function signatureCounts(
  signatures: EngineSignatures,
): Pick<
  ParseChildRow,
  | "templates"
  | "unresolved"
  | "tails"
  | "packages"
  | "environments"
  | "macros"
  | "data"
  | "placeholders"
  | "undefined"
  | "undefinedNames"
  | "truncated"
> {
  const templates = Object.fromEntries(RESOLUTIONS.map((how) => [how, 0])) as Record<
    Resolution,
    number
  >;
  const unresolved: { name: string; why: string }[] = [];
  const tails: string[] = [];
  let packages = 0;
  const undefinedNames: string[] = [];
  for (const [name, signature] of Object.entries(signatures.commands)) {
    if (signature.kind === "undefined") undefinedNames.push(name);
    if (signature.kind !== "template") continue;
    templates[signature.how]++;
    if (signature.how === "unresolved") unresolved.push({ name, why: signature.why ?? "" });
    if (signature.tail === "unresolved") tails.push(name);
    if (signature.package !== undefined) packages++;
  }
  let data = 0;
  let placeholders = 0;
  for (const macro of Object.values(signatures.macros)) {
    if (macro.kind === "data") data++;
    else placeholders += macro.meaning.match(PLACEHOLDER)?.length ?? 0;
  }
  return {
    templates,
    unresolved,
    tails,
    packages,
    environments: Object.values(signatures.environments).filter((each) => each.kind === "template")
      .length,
    macros: Object.keys(signatures.macros).length,
    data,
    placeholders,
    undefined: undefinedNames.length,
    undefinedNames,
    truncated: signatures.truncated,
  };
}
