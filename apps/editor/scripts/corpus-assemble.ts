/**
 * Assembly over the corpus (milestone 3 item 7, decision 0026): `corpus assemble` takes each
 * fetched document in as the probe runner does (`corpus-probe.ts`), and for each whose body parses
 * and whose macros have an answer in `corpus/answers/` (the seed, until item 9's model answers the
 * rest), probes it, assembles its package and document from the answer (`src/import/assemble.ts`)
 * and validates them with the four checks and the harness (`src/import/validate.ts`); and prints one
 * table, per family and in all: the documents assembled, partial and refused, the fields editable,
 * required and locked by reason, the controls proven and dropped and the milestone's bar, page size,
 * margins and font size proven on every successful import (decision 0040), the harness's findings
 * by check, and the compiles and times.
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
const CHECKS = [
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

/** The style controls, in the order the table counts them. */
const CONTROLS = ["pageSize", "margins", "fontSize", "font", "accent", "density"] as const;

/**
 * The controls the milestone's bar asks of every successful import (decision 0040): the page size,
 * the margins and the font size, each proven by the fourth check, which compiled every value it
 * offers and saw the page change.
 */
export const BAR_CONTROLS = ["pageSize", "margins", "fontSize"] as const;

export type BarControl = (typeof BAR_CONTROLS)[number];

/**
 * Whether a document is a successful import for the bar, until item 13's rule gives what a
 * success is: an assembly whose first check holds, its reference's glyphs set with the fields it
 * has (`assembled`); a partial one, one refused and one that never got so far are not.
 */
export const firstCheckHolds = (row: Pick<AssembleRow, "outcome">) => row.outcome === "assembled";

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
 * Where the corpus misses the milestone's bar (decision 0040): each successful import, by its
 * document's id, and each of the bar's controls it lacks, a line of each; none when every
 * successful import has all three. `successful` is the rule of what a success is, the first check
 * holding until item 13's lands (`firstCheckHolds`), which item 17's runner passes in its place.
 */
export function barFailures(
  rows: readonly Pick<AssembleRow, "id" | "outcome" | "controls">[],
  successful: (row: Pick<AssembleRow, "id" | "outcome" | "controls">) => boolean = firstCheckHolds,
): { id: string; control: BarControl }[] {
  return rows
    .filter(successful)
    .flatMap((row) => barControls(row).lacking.map((control) => ({ id: row.id, control })));
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
  words?: { editable: number; locked: Partial<Record<LockReason, number>> };
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
  /** The kinds of unit the package marks the editor cannot add (`fixed`). */
  fixed?: string[];
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

/** A validation's row: its counts and names, never a field's text. */
export function assembleRow(
  checks: AssemblyChecks,
  engine: "pdftex" | "xetex",
  answered: { answered: number; unanswered: number; answersRefused?: number },
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
 * cannot mark them, required and locked by reason, and their words; the sections mapped and locked;
 * the controls proven and dropped, and the milestone's bar (`barControls`, decision 0040): the
 * documents with the page size, the margins and the font size all proven, and the successful ones
 * lacking any, and which; the redefinitions dropped; the harness's findings by check, and
 * the checks' own; the kinds of unit that stop the compile; and the compiles and times.
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
      "Words in editable fields",
      (row) => row.words?.editable ?? 0,
      (row) => (row.words?.editable ?? 0) + lockedWords(row),
    ),
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
      "The bar: a successful import, its first check holding, lacking one",
      (row) => firstCheckHolds(row) && barControls(row).lacking.length > 0,
    ),
    ...BAR_CONTROLS.map((control) =>
      count(
        `The bar: a successful import lacking \`${control}\``,
        (row) => firstCheckHolds(row) && barControls(row).lacking.includes(control),
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
      count(`The editor cannot add: \`${kind}\``, (row) => (row.fixed ?? []).includes(kind)),
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
      `| ${sample.template} | **outcome** | | ${row?.outcome ?? "none"}${row?.difference === undefined ? "" : `, the first difference: ${row.difference}`}${row?.refused === undefined ? "" : ` (${row.refused})`}; harness: ${findings === "" ? "no finding" : findings}; ${row?.compiles ?? 0} compiles |`,
    );
    for (const line of sample.lines)
      rows.push(`| ${line.template} | \`${line.place}\` | ${line.port} | ${line.found} |`);
  }
  return `${rows.map(printable).join("\n")}\n`;
}
