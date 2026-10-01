/**
 * Assembly (milestone 3 item 7, plan section 6 step 6, decision 0026): an imported resume made into
 * a template package (decision 0006) and a document in the model, from the intake (decision 0019),
 * the reference, the body's tree and the engine's signatures (decision 0020), the probe's verdicts
 * (decision 0022) and the naming answer (decision 0024). Browser-safe: it reaches for neither Node
 * nor the DOM, and compiles nothing; `validate.ts` checks what it makes, and assembles again with
 * what the checks decide.
 *
 * **The package.** Its preamble is the document's own, rewritten only as far as the editor's loop
 * needs: the preamble's calls that store the header's text, which the answer names as header,
 * contact, link or other, are taken out, and set from the model before `\begin{document}`; hyperref
 * gets the dvipdfmx driver on pdfTeX and no bookmarks, and is loaded with `hidelinks` where the
 * reference compile's log shows the document never loads it, even late, as moderncv's class does at
 * the preamble's end; the reviewed answers' redefinitions go right after `\documentclass`; a class
 * size option becomes the font size control's slot, or the slot goes first among the class's
 * options where they name none, offering the sizes the class declares (`SIZE_OPTIONS`). The page
 * size and the margins go through geometry in the body's preamble region, each doing nothing at
 * the document's own value (decision 0040). An import keeps its fonts, so that the reference check
 * holds glyph for glyph; one set in Computer Modern's T1 or TS1 fonts, which the page cannot draw,
 * comes read with T1 and Latin Modern after its class, as every pdfTeX port takes them
 * (`inLatinModern`, decision 0009), and its preamble keeps the two lines with the rest. Its files
 * are the upload's class and style files, as text, with the configurations the reference compile
 * gave pdfTeX's DVI (decision 0019).
 * Its snippets are the template's own code, read from the body where the answer's kinds place the
 * model: a section's head and what frames its content, an entry's call and its bullets' list, which
 * every entry's snippet sets, a list's items, the header's calls; each field an argument of its
 * meaning as a typeset slot, beside a raw extras slot that holds the original bytes of an instance
 * the checks lock; every other argument the same bytes in every call where it is code, or an extras
 * slot of its own, with what a unit the user adds writes there (`defaults`). Comments never reach a
 * snippet, and nor does the body's text. It marks the slots the checks found required. Its source
 * is `main.tex`, and its id `import-` and twelve hex digits of the SHA-256 of the rest of it.
 *
 * **The document.** The model built from the tree through the answer: the header from its calls,
 * a name in one argument split at its last space, links of the kind the answer or their address
 * gives; sections with a role from the answer or the title; entries, bullets, items, labelled items
 * and paragraphs; dates read from the tree, in the one format the generator writes most of them
 * in, years alone read in any; each node with an id minted from where it
 * stands in the source. What a snippet cannot hold is kept: an argument or a list the checks lock,
 * in its node's extras, its node naming the slot kept (`kept`), which is then no field; and a part
 * of the body no snippet can express, a raw chunk or a call the answer does not place, as a locked
 * section where it stands. Every part kept is counted, and everything kept is kept LaTeX, or the
 * import is refused (`keep`).
 */

import {
  type ArgumentAnswer,
  type NamingAnswer,
  type ReviewedAnswer,
  type StoredAnswer,
  sha256,
} from "@resume-tools/naming";
import {
  type Dates,
  ENTRY_KEPT,
  type Entry,
  ExtraKey,
  type Extras,
  HEADER_KEPT,
  type Header,
  type Link,
  type LinkKind,
  LockedLatex,
  type Resume,
  type RichText,
  type Run,
  SECTION_KEPT,
  type Section,
  type SectionKind,
  type SectionRole,
} from "@resume-tools/resume-model";
import type { Document } from "../editor/document";
import type { Engine } from "../engine/session";
import { formatDates } from "../templates/dates";
import { isBlank } from "../templates/escape";
import {
  type ByRole,
  type DateFormat,
  IMPORTED_PREFIX,
  type RequiredPlace,
  type TemplatePackage,
  UNIT_KINDS,
  type UnitKind,
} from "../templates/package";
import { isSetter, maySetText, tightened } from "./candidates";
import { decodeText, type Intake } from "./intake";
import { withRedefinitions } from "./naming";
import {
  type Argument,
  bodyOf,
  bodyOfText,
  buildTree,
  type CallNode,
  type EnvironmentNode,
  type Node,
  readBody,
  type SectionNode,
  type Span,
  type TextNode,
  type Tree,
} from "./parse";
import { extensionOf } from "./paths";
import type { Probe, ProbeCandidate, Verdict } from "./probe";
import { COMPATIBILITY, type Reference } from "./reference";
import { type Refusal, refusal } from "./refusal";
import type { EngineSignatures, Layout } from "./signatures";
import { classOptions, documentClass } from "./source";
import {
  asLocked,
  comparable,
  extrasSlot,
  isKept,
  snippetText,
  templateText,
  withoutComments,
  wordsIn,
} from "./templating";
import type { XetexRewrite } from "./xetex";

// What assembly makes.

/**
 * Why a part of the document is kept out of the model, or locked: the probe's reasons (decision
 * 0022); a date the generator writes otherwise (`date`); a text its field cannot hold as the
 * template set it, marked in part or in more than one paragraph (`shape`); a part no snippet can
 * express as the upload wrote it (`unmapped`); the first check's difference (`differs`); the second
 * check's text that stops the compile (`text`); and the harness's `fields` and `alignment`.
 */
export type LockReason =
  | Exclude<Verdict, "editable" | "container">
  | "date"
  | "shape"
  | "unmapped"
  | "differs"
  | "text"
  | "fields"
  | "alignment";

/** A locked part of the document: where it stands in the source, its node, and how many words. */
export interface LockedPart {
  /** Where it stands: `b` or `p`, for the body or the preamble, and the offset it starts at. */
  at: string;
  /** A field's, a list's or a section's: its node's id, and the extras key that holds it. */
  node?: string;
  key?: string;
  kind: "field" | "list" | "section" | "header";
  reason: LockReason;
  words: number;
}

/**
 * What the checks decide, which the assembly takes again: redefinitions the reference check
 * refused, and where the rest go, right after `\documentclass` (`class`, the default) or, where a
 * compile after the class stops, as it does for a macro a package or the preamble defines, at the
 * preamble's end, right before `\begin{document}` (`preamble`, decision 0024); controls dropped,
 * field instances and whole slots locked with why, the slots that are required, and the kinds of
 * unit a new one of which, or the removal of one, stops the compile, which the package marks
 * (`fixed`) and the editor neither adds nor removes (decision 0038). A field instance
 * is named by where its content starts (`LockedPart.at` and its slot), a slot by its macro and
 * argument (`slotKey`).
 */
export interface Decisions {
  dropped?: readonly string[];
  placement?: "class" | "preamble";
  controls?: readonly ControlName[];
  instances?: Readonly<Record<string, LockReason>>;
  slots?: Readonly<Record<string, LockReason>>;
  required?: readonly string[];
  fixed?: readonly UnitKind[];
}

/** The style controls a package offers (decision 0006), but the date format, which is the generator's. */
export type ControlName = "pageSize" | "margins" | "fontSize" | "font" | "accent" | "density";

/** A field of the assembled document, as the checks mutate and lock it. */
export interface AssembledField {
  /** Its instance's name: where its content starts, and its slot (`Decisions.instances`). */
  at: string;
  /** Its slot's name: its macro and argument, or its standard node's kind (`Decisions.slots`). */
  slot: string;
  /** Its field's id in the document: `<node id>.<slot>`, or `header.<slot>`. */
  field: string;
  /** Its node's id, or `header`. */
  node: string;
  type: "text" | "rich" | "date";
  /** Whether its node keeps extras, so that an instance can be locked alone. */
  lockable: boolean;
  /** The list its instance is locked with where it cannot be locked alone. */
  list?: string;
  words: number;
  /** How it is set: typeset in its markers, raw where the page cannot mark it, or locked. */
  mode: "typeset" | "raw" | "locked";
  reason?: LockReason;
}

/**
 * What sets a run of the reference's glyphs in the document the assembly made (decision 0039):
 * its page, from 0, and its glyphs' places among the page's, from `from` to before `to`, as the
 * probe's runs have them; and an editable field, by its id (`field`), which the editor edits on
 * the page or, set raw, in the side panel; a locked part, by its place among the assembly's
 * (`part`, `Assembled.extras`); what the document keeps as the upload wrote it and no part counts,
 * with why (`kept`); or, with none of them, the template's own text, which no part of the
 * document's source sets, as a label, a separator, an icon or a page's number.
 */
export interface GlyphOwner {
  page: number;
  from: number;
  to: number;
  field?: string;
  part?: number;
  kept?: LockReason;
}

/** What the assembly and the checks found, for item 13's report and the corpus runner. */
export interface AssemblyChecks {
  /** `partial` when the first check's glyph stream differs with every lock it could make. */
  outcome: "assembled" | "partial";
  difference?: { kind: string; text: string };
  fields: {
    editable: number;
    raw: number;
    required: number;
    locked: Partial<Record<LockReason, number>>;
  };
  words: { editable: number; locked: Partial<Record<LockReason, number>> };
  sections: { mapped: number; locked: number };
  required: string[];
  controls: {
    offered: ControlName[];
    proven: ControlName[];
    dropped: { control: string; why: string }[];
  };
  redefinitions: { applied: string[]; dropped: string[]; placement: "class" | "preamble" };
  repeatable: { kind: string; added: boolean; removed: boolean }[];
  findings: { check: string; message: string; field?: string }[];
  compiles: number;
  ms: number;
  decisions: Decisions;
  /**
   * The fonts the upload's reference set that the page cannot draw, Computer Modern's in T1 and
   * TS1, where the import is read in Latin Modern (`inLatinModern`), by name; absent where it keeps
   * its fonts.
   */
  latinModern?: string[];
  /** Every field of the document, how it is set, and why where it is locked. */
  all: AssembledField[];
  /**
   * What sets each run of the reference's glyphs (`GlyphOwner`): the probe's runs, each read
   * through the field or the locked part of the document that holds the part of the source that
   * sets it (`ownersOf`), which item 13's report counts the page's words by. Absent from an
   * assembly made from a probe that gave no runs.
   */
  owners?: GlyphOwner[];
}

/** An imported resume assembled: the package, the document, what is locked, and the checks. */
export interface Assembled {
  package: TemplatePackage;
  document: Document;
  extras: LockedPart[];
  checks: AssemblyChecks;
}

export interface AssemblyOptions {
  decisions?: Decisions;
}

// The answer.

type Answer = StoredAnswer["answer"];

/** An answer by what it answers: `command|<name>` or `environment|<name>`. */
type Answers = ReadonlyMap<string, Answer>;

const commandAnswer = (answers: Answers, name: string) => answers.get(`command|${name}`);
const environmentAnswer = (answers: Answers, name: string) => answers.get(`environment|${name}`);

/** The redefinitions a reviewed answer carries. */
const redefinitionsOf = (answer: Answer): ReviewedAnswer["redefinitions"] =>
  "reviewed" in answer ? (answer.redefinitions ?? []) : [];

/** The kinds of a macro that set the header, and are taken out of the preamble when stored there. */
const HEADER_KINDS: ReadonlySet<string> = new Set(["header", "contact", "link"]);

/**
 * The probe's reasons that lock an argument in every call: whatever it holds fails the same way.
 * Not `case`: the aligner folds case, so an argument a class sets in capitals is editable, and the
 * overlay shows it so (decision 0022).
 */
const HARD: ReadonlySet<Verdict> = new Set(["breaks", "vanished", "twice", "misaligned", "split"]);

/** The probe's verdicts that leave an instance editable. */
const FINE: ReadonlySet<Verdict> = new Set(["editable", "container", "case"]);

// The context.

/** Everything the walk reads, and what it gathers. */
interface Context {
  intake: Intake;
  made: Reference;
  tree: Tree;
  source: string;
  found: EngineSignatures;
  probe: Probe;
  answers: Answers;
  engine: Engine;
  decisions: Required<Decisions>;
  /** The macros whose answers carry redefinitions that are applied: their slots are trusted. */
  trusted: ReadonlySet<string>;
  /** The probe's candidates, by where, kind and span. */
  candidates: ReadonlyMap<string, ProbeCandidate>;
  /** Each argument's bytes in every call, by `slotKey`: one value when every call gives the same. */
  constants: ReadonlyMap<string, ReadonlySet<string>>;
  /** Each slot's mode, from every call's verdict (`slotModes`). */
  modes: ReadonlyMap<string, { mode: AssembledField["mode"]; reason?: LockReason }>;
  dateFormat: DateFormat;
  preamble: { text: string; tree?: Tree; setters: readonly CallNode[] };
  ids: IdMint;
  locked: LockedPart[];
  fields: AssembledField[];
  /**
   * Where each field and each locked part stands in its source, the body's or the preamble's, from
   * its start to its end: what says which of them sets each glyph the probe found set by a part of
   * the source (`ownersOf`, item 13's report).
   */
  placed: Map<AssembledField | LockedPart, Placement>;
  /** Whether a date set from the model has a month, which the date format control changes. */
  monthly: boolean;
}

/** Where a field or a locked part stands: in the body's source or the preamble's, a span of it. */
interface Placement {
  where: "body" | "preamble";
  start: number;
  end: number;
}

/**
 * A locked part kept as the upload wrote it and counted (decision 0026), with where it stands in
 * its source (`Context.placed`), from `span`'s start to its end.
 */
function keepPart(ctx: Context, part: LockedPart, span: Span, where: "b" | "p" = "b") {
  ctx.locked.push(part);
  ctx.placed.set(part, {
    where: where === "p" ? "preamble" : "body",
    start: span.start,
    end: span.end,
  });
}

/** An argument's slot key: its macro, whether a command or an environment, and its place. */
export const slotKey = (of: "command" | "environment", name: string, index: number | string) =>
  `${of}|${name}|${index}`;

/** A candidate's key: where it is, its kind, and its span. */
const candidateKey = (where: string, kind: string, span: Span) =>
  `${where}|${kind}|${span.start}|${span.end}`;

/** Ids minted from where a node stands, so that assembling again gives the same ids. */
class IdMint {
  private readonly given = new Map<string, string>();
  private readonly taken = new Set<string>();

  /** An id of `prefix`, a dash and six lowercase letters and digits, the same for the same key. */
  id(prefix: string, key: string): string {
    const known = this.given.get(`${prefix}|${key}`);
    if (known !== undefined) return known;
    let seed = `${prefix}|${key}`;
    let id: string;
    do {
      id = `${prefix}-${fnv1a(seed).toString(36).padStart(7, "0").slice(-6)}`;
      seed += "'";
    } while (this.taken.has(id));
    this.taken.add(id);
    this.given.set(`${prefix}|${key}`, id);
    return id;
  }
}

/** FNV-1a, 32 bits, over UTF-16 code units: an id's digits, not a secret. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash;
}

// Reading the tree.

/** Whether a node is whitespace alone, which TeX reads as the gap it sits in. */
const isBlankText = (node: Node) =>
  node.kind === "text" &&
  node.runs.every((run) => run.text.trim() === "" && run.href === undefined);

/** A node's children and arguments' content, for walks that look inside it. */
function* inside(node: Node): Generator<Node> {
  if ("args" in node && node.args !== undefined)
    for (const arg of node.args) if (arg.content !== undefined) yield* arg.content;
  if (node.kind === "section") return;
  if ("content" in node && Array.isArray(node.content)) yield* node.content;
}

/** Every node of a list of nodes, and every node inside them. */
function* everyNode(nodes: readonly Node[]): Generator<Node> {
  for (const node of nodes) {
    yield node;
    yield* everyNode([...inside(node)]);
  }
}

/** The span of a list of nodes, from the first's start to the last's end. */
const spanOfNodes = (nodes: readonly Node[]): Span | undefined => {
  const first = nodes[0];
  const last = nodes.at(-1);
  return first === undefined || last === undefined
    ? undefined
    : { start: first.start, end: last.end };
};

/** An argument's content without the text nodes that are whitespace alone. */
const meaningful = (nodes: readonly Node[]) => nodes.filter((node) => !isBlankText(node));

/** A macro's answer's argument, by its place in the signature, in a section of `role`. */
function argumentAnswer(
  answer: Answer | undefined,
  index: number,
  role?: SectionRole,
): ArgumentAnswer | undefined {
  if (answer === undefined) return undefined;
  const variant = role === undefined ? undefined : answer.variants?.find((v) => v.role === role);
  return (variant?.arguments ?? answer.arguments).find((arg) => arg.index === index);
}

// Text and fields.

/** Text with the whitespace TeX reads as a space at its ends taken off, but a tie kept. */
const trimmed = (text: string) => text.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "");

/** A field's value as the model holds it, or why it cannot hold it. */
type Read =
  | { ok: true; value: string | RichText | Dates | undefined; wrap?: [string, string] }
  | { ok: false; reason: LockReason };

/**
 * The runs of a text node with the whitespace at its ends taken off, as a field holds them: the
 * page shows no space at a field's edge, and the snippet keeps the source's around it.
 */
function edgeTrimmed(runs: RichText): RichText {
  const out = runs.map((run) => ({ ...run }));
  while (out.length > 0 && trimmed(out[0]?.text ?? "") === "" && out[0]?.href === undefined)
    out.shift();
  while (out.length > 0 && trimmed(out.at(-1)?.text ?? "") === "" && out.at(-1)?.href === undefined)
    out.pop();
  const first = out[0];
  if (first !== undefined) first.text = first.text.replace(/^[ \t\n\r]+/, "");
  const last = out.at(-1);
  if (last !== undefined) last.text = last.text.replace(/[ \t\n\r]+$/, "");
  return out.filter((run) => run.text !== "" || run.href !== undefined);
}

/** A run without its false marks, as the model keeps one. */
const runOf = (run: Run): Run => ({
  text: run.text,
  ...(run.bold ? { bold: true } : {}),
  ...(run.italic ? { italic: true } : {}),
  ...(run.href === undefined ? {} : { href: run.href }),
});

/**
 * A text slot's value from its content: one text or date node, whose runs are all marked alike,
 * the generator's wrapper around the slot for the marks, `\textbf` outside `\textit` as it writes
 * rich text; or why the slot cannot hold it.
 */
function readText(content: readonly Node[]): Read {
  const nodes = meaningful(content);
  if (nodes.length === 0) return { ok: true, value: undefined };
  const [node] = nodes;
  if (nodes.length > 1 || node === undefined) return { ok: false, reason: "shape" };
  if (node.kind === "date") return { ok: true, value: trimmed(node.text) };
  if (node.kind !== "text") return { ok: false, reason: "shape" };
  const runs = edgeTrimmed(node.runs);
  if (runs.length === 0) return { ok: true, value: undefined };
  const first = runs[0] as Run;
  const alike = runs.every(
    (run) =>
      !!run.bold === !!first.bold && !!run.italic === !!first.italic && run.href === undefined,
  );
  if (!alike) return { ok: false, reason: "shape" };
  const text = runs.map((run) => run.text).join("");
  const open = `${first.bold ? "\\textbf{" : ""}${first.italic ? "\\textit{" : ""}`;
  const close = `${first.italic ? "}" : ""}${first.bold ? "}" : ""}`;
  return {
    ok: true,
    value: text,
    ...(open === "" ? {} : { wrap: [open, close] as [string, string] }),
  };
}

/** A rich slot's value from its content: one text node's runs, or why it cannot hold them. */
function readRich(content: readonly Node[]): Read {
  const nodes = meaningful(content);
  if (nodes.length === 0) return { ok: true, value: [] };
  const [node] = nodes;
  if (nodes.length > 1 || node === undefined) return { ok: false, reason: "shape" };
  if (node.kind === "date") return { ok: true, value: [{ text: trimmed(node.text) }] };
  if (node.kind !== "text") return { ok: false, reason: "shape" };
  return { ok: true, value: edgeTrimmed(node.runs).map(runOf) };
}

/** A date slot's value from its content: one date node, in the document's date format. */
function readDate(content: readonly Node[], format: DateFormat): Read {
  const nodes = meaningful(content);
  if (nodes.length === 0) return { ok: true, value: undefined };
  const [node] = nodes;
  if (nodes.length > 1 || node?.kind !== "date") return { ok: false, reason: "date" };
  if (formatDates(node.dates, format) !== trimmed(node.text)) return { ok: false, reason: "date" };
  return { ok: true, value: node.dates };
}

/** The words a list of nodes shows: its text and dates, however deep. */
function wordsOf(nodes: readonly Node[]): number {
  let words = 0;
  for (const node of everyNode(nodes)) {
    if (node.kind === "text") words += wordsIn(node.runs.map((run) => run.text).join(" "));
    else if (node.kind === "date") words += wordsIn(node.text);
  }
  return words;
}

// Templates.

/**
 * A snippet as it is built: template text, copied from the source (`templateText`), and tags; and
 * what one instance holds: its values by slot, its extras by key, the slots it keeps as the upload
 * had them (`kept`), and what a unit the user adds writes for each extras slot this one fills with
 * its own (`defaults`, decision 0026).
 */
class Template {
  readonly parts: string[] = [];
  readonly values: Record<string, unknown> = {};
  readonly extras: Record<string, string> = {};
  readonly kept = new Set<string>();
  readonly defaults: Record<string, string> = {};

  /** Source copied as template text. */
  text(source: string) {
    if (source !== "") this.parts.push(templateText(source));
    return this;
  }

  /** Text the assembly writes itself, as it stands. */
  code(snippet: string) {
    this.parts.push(snippet);
    return this;
  }

  /**
   * An extras slot and what this instance holds in it: nothing where it holds nothing, unless
   * `always`, for an extra every unit of the upload has, empty or not, whose default a unit the
   * user adds writes instead, so that the upload's own empty one writes nothing.
   */
  extra(key: string, bytes: string, always = false) {
    if (!ExtraKey.safeParse(key).success) throw new Error(`not an extras key: ${key}`);
    this.parts.push(extrasSlot(key));
    if (bytes !== "" || always) this.extras[key] = bytes;
    return this;
  }

  snippet(): string {
    return this.parts.join("");
  }
}

/**
 * What a unit the user adds writes for an argument each unit of the upload keeps in its extras,
 * by the answer's blank rule (decision 0024): `kept`, the first call's bytes, which the first unit
 * gives, as a length or an icon every call gives its own; `empty`, the argument's delimiters with
 * nothing inside, or nothing inside the ones the snippet writes itself; `absent`, nothing, the
 * argument left out. Where the answer says nothing, a code-like argument is kept, an optional one
 * or a star left out, and any other empty, so that no text of the person's is copied to a new unit.
 */
function defaultOf(
  blank: ArgumentAnswer["blank"],
  argument: { bytes: string; empty: string; code: boolean; optional: boolean },
): string {
  const rule = blank ?? (argument.code ? "kept" : argument.optional ? "absent" : "empty");
  return rule === "kept" ? argument.bytes : rule === "empty" ? argument.empty : "";
}

/** The node kinds a field's instance can be locked alone in: those that keep extras. */
type Holder = "header" | "section" | "entry" | "none";

/**
 * A field as a template places it: its slot, as its slot's mode has it, typeset in the generator's
 * wrapper for its marks or raw, or nothing when every instance is locked, since whatever a new unit
 * held there would fail as the originals did; and, where its node keeps extras, the extras slot
 * beside it and what this instance holds there, its original bytes when it is locked.
 */
interface Placed {
  slot: string;
  extra: string;
  bytes: string;
  set: boolean;
  reason?: LockReason;
}

/**
 * A field's slot and extras for one instance (`Placed`), its value put in the template's values
 * when it is set, and the field recorded, with where it stands and why it is locked, if it is.
 */
function putField(
  ctx: Context,
  template: Template,
  options: {
    where: "b" | "p";
    content: readonly Node[];
    /** The span its slot takes the place of. */
    span: Span;
    /** The bytes a locked instance keeps, the span's by default. */
    original?: Span;
    slot: string;
    key: string;
    slotKey: string;
    type: AssembledField["type"];
    holder: Holder;
    node: string;
    field: string;
    /** The candidate's kind, to read the probe's verdict of this instance. */
    candidate: string;
    /** For a contact or a link, whose markers a raw slot keeps out of an address. */
    rawable?: boolean;
    /** The list the instance is locked with when its node keeps no extras. */
    list?: string;
    /** The instance's value, when read otherwise than from its content (a name's two parts). */
    read?: Read;
  },
): Placed {
  const { where, content, span, slot, key, slotKey: slotName, type, holder } = options;
  const source = where === "p" ? (ctx.preamble.tree?.source ?? "") : ctx.source;
  const at = `${where}${span.start}.${slot}`;
  const read =
    options.read ??
    (type === "text"
      ? readText(content)
      : type === "rich"
        ? readRich(content)
        : readDate(content, ctx.dateFormat));
  const words = wordsOf(content);
  const mode = ctx.modes.get(slotName);
  const candidate = ctx.candidates.get(
    candidateKey(where === "p" ? "preamble" : "body", options.candidate, span),
  );
  const empty = meaningful(content).length === 0;
  // A slot set raw where the page cannot mark it, a contact's text its address is built from, is
  // locked where its place cannot take it raw.
  const rawMode = mode?.mode === "raw";
  const slotLocked =
    ctx.decisions.slots[slotName] ??
    (mode?.mode === "locked" || (rawMode && options.rawable !== true) ? mode?.reason : undefined);
  let reason: LockReason | undefined = slotLocked ?? ctx.decisions.instances[at];
  if (reason === undefined && !read.ok) reason = read.reason;
  // What the probe found of this instance: any failure locks it, a hard one its slot as well, but
  // the failure its slot is set raw for.
  if (
    reason === undefined &&
    !empty &&
    candidate !== undefined &&
    !ctx.trusted.has(macroOf(slotName))
  ) {
    const verdict = candidate.verdict;
    if (!FINE.has(verdict) && !(rawMode && verdict === mode?.reason))
      reason = verdict as LockReason;
  }
  const raw = reason === undefined && rawMode && options.rawable === true;
  const lockable = holder !== "none";
  const original = options.original ?? span;
  const placement: Placement = {
    where: where === "p" ? "preamble" : "body",
    start: span.start,
    end: span.end,
  };
  const wrap = read.ok ? read.wrap : undefined;
  let placed = "";
  if (slotLocked === undefined)
    placed = raw
      ? `{{&${slot}}}`
      : wrap === undefined
        ? `{{${slot}}}`
        : `{{#${slot}}}${snippetText(wrap[0])}{{${slot}}}${snippetText(wrap[1])}{{/${slot}}}`;
  if (reason === undefined && read.ok && read.value !== undefined) {
    template.values[slot] = read.value;
    const dates = type === "date" ? (read.value as Dates) : undefined;
    const month = (date: string | undefined) => date !== undefined && /^\d{4}-\d{2}$/.test(date);
    if (dates !== undefined && (month(dates.start) || month(dates.end))) ctx.monthly = true;
  }
  const field: AssembledField = {
    at,
    slot: slotName,
    field: options.field,
    node: options.node,
    type,
    lockable,
    ...(options.list === undefined ? {} : { list: options.list }),
    words,
    mode: reason !== undefined ? "locked" : raw ? "raw" : "typeset",
    ...(reason === undefined ? {} : { reason }),
  };
  ctx.fields.push(field);
  ctx.placed.set(field, placement);
  if (reason !== undefined && words > 0 && lockable)
    keepPart(
      ctx,
      {
        at: `${where}${span.start}`,
        node: options.node,
        key,
        kind: holder === "header" ? "header" : "field",
        reason,
        words,
      },
      { start: Math.min(span.start, original.start), end: Math.max(span.end, original.end) },
      where,
    );
  // A locked instance is kept, not editable: its node names the slot kept, so that the generator
  // sets its extra alone and the editor opens nothing on it (decision 0026).
  if (reason !== undefined && lockable) template.kept.add(slot);
  return {
    slot: placed,
    extra: lockable ? extrasSlot(key) : "",
    bytes: lockable && reason !== undefined ? source.slice(original.start, original.end) : "",
    set: reason === undefined,
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * A placed field's extras slot, with this instance's bytes, where its node keeps extras: a locked
 * instance's always, empty or not, so that a slot's default never stands in for it.
 */
function putExtra(template: Template, placed: Placed, key: string) {
  if (placed.extra !== "") template.extra(key, placed.bytes, !placed.set);
}

/** An argument's span of content, tightened as the probe wraps it (`tightened`). */
function contentSpan(source: string, arg: Argument): Span {
  const span = spanOfNodes(arg.content ?? []);
  if (span === undefined) return { start: arg.innerStart, end: arg.innerStart };
  return arg.open === "" ? span : tightened(source, span);
}

/** The meanings of an argument that sets none of the resume's text: code the template reads. */
const CODE_MEANINGS: ReadonlySet<string> = new Set(["key", "length", "icon", "colour"]);

/**
 * The text a piece of LaTeX shows, near enough to find a word of the person's in it: its comments,
 * its commands' names and its environments' names left out.
 */
function visibleText(latex: string): string {
  return withoutComments(latex)
    .replace(/\\(?:begin|end)\s*\{[^}]*\}/g, " ")
    .replace(/\\[A-Za-z@]+/g, " ")
    .replace(/\\./g, " ");
}

/** Whether LaTeX shows a word, three letters or more, as layout the answer names may not. */
const showsWord = (latex: string) => /\p{L}{3,}/u.test(visibleText(latex));

/**
 * An argument as its call's template writes it, when it is no field (decision 0026). The body's
 * text never reaches a snippet: the argument is the template's own text only where every call gives
 * it alike and it is code, by its answer's meaning (a key, a length, an icon or a colour), by its
 * call's being layout and showing no word, or by holding no letter or digit at all, as a star or an
 * empty group does, or an argument no call gives. Anything else each unit keeps in its extras, with
 * a locked part that counts its words, and a unit the user adds writes the answer's blank for it
 * (`defaultOf`); a node that keeps no extras, a bullet's, an item's or a link's, cannot, and the
 * call does not fit (false).
 */
function putConstant(
  ctx: Context,
  template: Template,
  arg: Argument,
  call: { name: string; index: number; of?: "command" | "environment" },
  options: {
    where: "b" | "p";
    key: string;
    holder: Holder;
    node: string;
    answered?: ArgumentAnswer | undefined;
    layout?: boolean;
  },
): boolean {
  const source = options.where === "p" ? (ctx.preamble.tree?.source ?? "") : ctx.source;
  const values = ctx.constants.get(slotKey(call.of ?? "command", call.name, call.index));
  const bytes = arg.present ? source.slice(arg.start, arg.end) : "";
  const meaning = options.answered?.meaning;
  const coded =
    (meaning !== undefined && CODE_MEANINGS.has(meaning)) ||
    (options.layout === true && !showsWord(bytes));
  const code = coded || wordsIn(visibleText(bytes)) === 0;
  if (values !== undefined && values.size === 1 && code) {
    // Every call gives it alike: the template's own, as a key or a length is.
    if (arg.present && arg.open === "" && /[A-Za-z@]$/.test(template.snippet())) template.code(" ");
    template.text(bytes);
    return true;
  }
  if (options.holder === "none") return false;
  template.extra(options.key, bytes, true);
  const open = arg.open === "" ? "{" : arg.open;
  const close = arg.close === "" ? "}" : arg.close;
  template.defaults[options.key] = defaultOf(options.answered?.blank, {
    bytes,
    empty: arg.kind === "mandatory" || arg.kind === "optional" ? `${open}${close}` : "",
    code: coded,
    optional: arg.kind !== "mandatory",
  });
  const words = arg.content === undefined ? wordsIn(visibleText(bytes)) : wordsOf(arg.content);
  if (!coded && words > 0)
    keepPart(
      ctx,
      {
        at: `${options.where}${arg.start}`,
        node: options.node,
        key: options.key,
        kind: options.holder === "header" ? "header" : "field",
        reason: "unmapped",
        words,
      },
      arg,
      options.where,
    );
  return true;
}

/** A slot the snippet language gives a kind of place, by the answer's slot name. */
type SlotOf = { slot: string; type: AssembledField["type"] };

/** The text, rich and date slots of an entry, a section, a bullet, a labelled item and the header. */
const ENTRY_SLOTS: Readonly<Record<string, SlotOf>> = {
  title: { slot: "title", type: "text" },
  subtitle: { slot: "subtitle", type: "text" },
  place: { slot: "place", type: "text" },
  dates: { slot: "dates", type: "date" },
};

/**
 * A call's template, argument by argument: the command, a star, each argument in its delimiters, a
 * field where the answer gives one of `slots`, parts where it gives parts, a container `inner`
 * fills, and otherwise the same bytes in every call or an extra. Spaces between arguments go, as TeX
 * skips them. An optional argument that is a field sits in a block of its own, so that a call that
 * leaves it out leaves its brackets out; a locked one keeps its brackets in its extra.
 */
function callTemplate(
  ctx: Context,
  template: Template,
  call: { name: string; args: readonly Argument[] },
  options: {
    where: "b" | "p";
    answer: Answer | undefined;
    role?: SectionRole;
    slots: Readonly<Record<string, SlotOf>>;
    holder: Holder;
    node: string;
    fieldOf: (slot: string) => string;
    keyPrefix?: string;
    /** A container argument, by its answer's slot, which the caller fills. */
    inner?: (slot: string, arg: Argument, template: Template) => boolean;
    rawable?: boolean;
    list?: string;
    /** The probe's kind of candidate its fields are: an argument's, or a section's title. */
    candidate?: string;
  },
): boolean {
  const source = options.where === "p" ? (ctx.preamble.tree?.source ?? "") : ctx.source;
  template.code(`\\${call.name}`);
  const prefix = options.keyPrefix ?? "";
  let ok = true;
  const constant = (arg: Argument, index: number, answered: ArgumentAnswer | undefined) => {
    const put = putConstant(
      ctx,
      template,
      arg,
      { name: call.name, index },
      {
        where: options.where,
        key: `${prefix}a${index}`,
        holder: options.holder,
        node: options.node,
        answered,
        layout: options.answer?.kind === "layout",
      },
    );
    if (!put) ok = false;
  };
  call.args.forEach((arg, i) => {
    const index = i + 1;
    const answered = argumentAnswer(options.answer, index, options.role);
    const slotName = slotKey("command", call.name, index);
    if (arg.kind === "star") {
      constant(arg, index, answered);
      return;
    }
    const wanted = answered?.slot === undefined ? undefined : options.slots[answered.slot];
    const container = answered?.slot !== undefined && wanted === undefined;
    if (container && options.inner !== undefined) {
      if (!arg.present || arg.content === undefined) {
        ok = false;
        return;
      }
      template.code(arg.open === "" ? "{" : arg.open);
      if (!options.inner(answered?.slot ?? "", arg, template)) ok = false;
      template.code(arg.close === "" ? "}" : arg.close);
      return;
    }
    if (wanted !== undefined) {
      const optional = arg.kind === "optional";
      if (!arg.present) {
        // A mandatory argument a call leaves out cannot be: the parser keeps such a call raw.
        if (!optional) ok = false;
        else template.code(`{{#${wanted.slot}}}[{{${wanted.slot}}}]{{/${wanted.slot}}}`);
        if (optional && options.holder !== "none") template.extra(`${prefix}${wanted.slot}`, "");
        return;
      }
      if (arg.content === undefined) {
        // A field the parser could not read, whose bytes the unit keeps: not editable.
        constant(arg, index, answered);
        if (options.holder !== "none") template.kept.add(wanted.slot);
        return;
      }
      const blank = meaningful(arg.content).length === 0 && arg.innerEnd > arg.innerStart;
      const span = blank
        ? { start: arg.innerStart, end: arg.innerStart }
        : contentSpan(source, arg);
      const placed = putField(ctx, template, {
        where: options.where,
        content: arg.content,
        span,
        ...(optional ? { original: { start: arg.start, end: arg.end } } : {}),
        slot: wanted.slot,
        key: `${prefix}${wanted.slot}`,
        slotKey: slotName,
        type: wanted.type,
        holder: options.holder,
        node: options.node,
        field: options.fieldOf(wanted.slot),
        candidate: options.candidate ?? "argument",
        ...(options.rawable === undefined ? {} : { rawable: options.rawable }),
        ...(options.list === undefined ? {} : { list: options.list }),
      });
      if (!placed.set && options.holder === "none") ok = false;
      const open = arg.open === "" ? "{" : arg.open;
      const close = arg.close === "" ? "}" : arg.close;
      // A slot locked in every instance has no slot in the snippet, its extra alone: a unit the user
      // adds writes the answer's blank for it, the first call's bytes where it says kept.
      if (placed.slot === "" && placed.extra !== "")
        template.defaults[`${prefix}${wanted.slot}`] = defaultOf(answered?.blank, {
          bytes: blank ? source.slice(arg.innerStart, arg.innerEnd) : placed.bytes,
          empty: optional ? `${open}${close}` : "",
          code: false,
          optional,
        });
      if (optional) {
        if (placed.slot !== "") {
          template.code(`{{#${wanted.slot}}}${open}`);
          template.text(source.slice(arg.innerStart, span.start));
          template.code(placed.slot);
          template.text(source.slice(span.end, arg.innerEnd));
          template.code(`${close}{{/${wanted.slot}}}`);
        }
        putExtra(template, placed, `${prefix}${wanted.slot}`);
        return;
      }
      template.code(open);
      template.text(source.slice(arg.innerStart, span.start));
      template.code(placed.slot);
      // An argument of spaces alone keeps them beside the slot, as a macro may test it for being
      // empty and read a space as something.
      if (blank && placed.extra !== "")
        template.extra(`${prefix}${wanted.slot}`, source.slice(arg.innerStart, arg.innerEnd));
      else putExtra(template, placed, `${prefix}${wanted.slot}`);
      template.text(source.slice(blank ? arg.innerEnd : span.end, arg.innerEnd));
      template.code(close);
      return;
    }
    if (answered?.parts !== undefined && arg.present && arg.content !== undefined) {
      if (!putParts(ctx, template, arg, answered, options, slotName)) ok = false;
      return;
    }
    constant(arg, index, answered);
  });
  return ok;
}

/**
 * An argument that holds several fields, the answer's parts, as Jake's projects heading holds its
 * title and subtitle either side of a `$|$`: each text node the next part's field, the rest the
 * template's text, a part after the first in a block with what stands before it, so that a unit
 * that leaves it out leaves that out too, and a locked one keeps both in its extra. An argument
 * whose parts do not fit keeps its bytes in the extras, the whole of it locked.
 */
function putParts(
  ctx: Context,
  template: Template,
  arg: Argument,
  answered: ArgumentAnswer,
  options: {
    where: "b" | "p";
    holder: Holder;
    node: string;
    fieldOf: (slot: string) => string;
    keyPrefix?: string;
  },
  slotName: string,
): boolean {
  const source = options.where === "p" ? (ctx.preamble.tree?.source ?? "") : ctx.source;
  const content = arg.content ?? [];
  const parts = answered.parts ?? [];
  const texts = content.filter((node) => node.kind === "text" && !isBlankText(node));
  const prefix = options.keyPrefix ?? "";
  const whole = `${prefix}a${answered.index}`;
  const fits =
    options.holder !== "none" &&
    texts.length === parts.length &&
    parts.every((part) => part.slot !== undefined && ENTRY_SLOTS[part.slot] !== undefined) &&
    content.every((node) => node.kind === "text" || node.kind === "raw");
  const open = arg.open === "" ? "{" : arg.open;
  const close = arg.close === "" ? "}" : arg.close;
  template.code(open);
  if (!fits) {
    const bytes = source.slice(arg.innerStart, arg.innerEnd);
    template.extra(whole, bytes, true);
    template.code(close);
    // Every part's field is kept with the argument, and a unit the user adds writes its blank.
    for (const part of parts) if (part.slot !== undefined) template.kept.add(part.slot);
    template.defaults[whole] = defaultOf(answered.blank, {
      bytes,
      empty: "",
      code: false,
      optional: false,
    });
    const words = wordsOf(content);
    if (words > 0)
      keepPart(
        ctx,
        {
          at: `${options.where}${arg.innerStart}`,
          node: options.node,
          key: whole,
          kind: "field",
          reason: "shape",
          words,
        },
        { start: arg.innerStart, end: arg.innerEnd },
        options.where,
      );
    return options.holder !== "none";
  }
  let at = arg.innerStart;
  let part = 0;
  for (const node of texts) {
    const slot = ENTRY_SLOTS[parts[part]?.slot ?? ""] as SlotOf;
    const span = tightened(source, node);
    const placed = putField(ctx, template, {
      where: options.where,
      content: [node],
      span,
      original: { start: part === 0 ? span.start : at, end: span.end },
      slot: slot.slot,
      key: `${prefix}${slot.slot}`,
      slotKey: `${slotName}|${slot.slot}`,
      type: slot.type,
      holder: options.holder,
      node: options.node,
      field: options.fieldOf(slot.slot),
      candidate: "paragraph",
    });
    if (part === 0) {
      template.text(source.slice(at, span.start));
      template.code(placed.slot);
    } else if (placed.slot !== "") {
      template.code(`{{#${slot.slot}}}`);
      template.text(source.slice(at, span.start));
      template.code(`${placed.slot}{{/${slot.slot}}}`);
    }
    putExtra(template, placed, `${prefix}${slot.slot}`);
    at = span.end;
    part++;
  }
  template.text(source.slice(at, arg.innerEnd));
  template.code(close);
  return true;
}

// Building the context.

/**
 * The answers by what they answer, `command|<name>` or `environment|<name>`, each as the cache
 * gave it for the document's macro (`answerFor`, decision 0024), so under the document's names; and
 * a command's closer of its opener's kind, as decision 0024 has it, where the answers give it
 * another: the list it closes is its opener's, whichever way round the two answers name it.
 */
export function answersOf(answer: NamingAnswer): Map<string, Answer> {
  const answers = new Map<string, Answer>();
  for (const stored of answer.macros) {
    const key = `${stored.of}|${stored.name}`;
    if (!answers.has(key)) answers.set(key, stored.answer);
  }
  for (const [id, each] of answers) {
    const list = each.list;
    if (!id.startsWith("command|") || list === undefined) continue;
    const partner = list.does === "opens" ? list.closedBy : list.openedBy;
    const other = partner === undefined ? undefined : answers.get(`command|${partner}`);
    if (other === undefined) continue;
    const [opener, closer, closerId] =
      list.does === "opens" ? [each, other, `command|${partner}`] : [other, each, id];
    if (opener.list?.does === "opens" && closer.kind !== opener.kind)
      answers.set(closerId, { ...closer, kind: opener.kind });
  }
  return answers;
}

/**
 * Each template macro's arguments' bytes in every call of the body and the preamble, by slot key,
 * as TeX reads them (`comparable`): an argument every call gives alike is the template's own.
 */
function constantsOf(trees: readonly Tree[]): Map<string, Set<string>> {
  const constants = new Map<string, Set<string>>();
  const add = (key: string, value: string) => {
    const values = constants.get(key) ?? new Set<string>();
    values.add(value);
    constants.set(key, values);
  };
  for (const tree of trees)
    for (const node of everyNode(tree.content)) {
      if (node.kind !== "call" && node.kind !== "environment" && node.kind !== "section") continue;
      const of = node.kind === "environment" ? "environment" : "command";
      node.args.forEach((arg, i) =>
        add(
          slotKey(of, node.name, i + 1),
          arg.present ? comparable(tree.source.slice(arg.start, arg.end)) : "",
        ),
      );
    }
  return constants;
}

/** The generator's date formats, its default first. */
const DATE_FORMATS: readonly DateFormat[] = ["MMM yyyy", "MMMM yyyy", "MM/yyyy", "yyyy"];

/**
 * The date format the generator writes most of the body's dates in, of its four, which the
 * document keeps; a date spelled otherwise is locked (`readDate`). A date of years alone reads
 * the same in every format, and counts for each. `MMM yyyy`, the generator's default, when no
 * format writes more dates than it does.
 */
function dateFormatOf(tree: Tree): DateFormat {
  const counts = new Map<DateFormat, number>();
  for (const node of everyNode(tree.content)) {
    if (node.kind !== "date") continue;
    const text = trimmed(node.text);
    for (const format of DATE_FORMATS)
      if (formatDates(node.dates, format) === text)
        counts.set(format, (counts.get(format) ?? 0) + 1);
  }
  let best: DateFormat = "MMM yyyy";
  let most = 0;
  for (const format of DATE_FORMATS) {
    const count = counts.get(format) ?? 0;
    if (count > most) {
      best = format;
      most = count;
    }
  }
  return best;
}

/**
 * Each slot's mode from every call's verdict (decision 0022): locked in every instance where any
 * call's argument fails in a way whatever it held would, the compile stopping, the markers lost,
 * doubled, split or its glyphs not its text; raw where that is a contact's or a link's text used
 * twice, as its address is built from it, so that the panel still edits it (`twice`); typeset
 * otherwise, an instance that moved the page or was never settled locked alone. A macro whose
 * answer carries a redefinition that is applied is trusted: its port's fix is what the probe did
 * not see, and the harness's fields and alignment checks judge it instead.
 */
function slotModes(
  probe: Probe,
  answers: Answers,
  trusted: ReadonlySet<string>,
): Map<string, { mode: AssembledField["mode"]; reason?: LockReason }> {
  const modes = new Map<string, { mode: AssembledField["mode"]; reason?: LockReason }>();
  for (const candidate of probe.candidates) {
    if (
      candidate.kind !== "argument" ||
      candidate.of === undefined ||
      candidate.index === undefined
    )
      continue;
    if (candidate.empty || !HARD.has(candidate.verdict)) continue;
    const of = candidate.of === "call" ? "command" : "environment";
    const key = slotKey(of, candidate.name, candidate.index);
    if (trusted.has(key) || modes.has(key)) continue;
    const answer = answers.get(`${of}|${candidate.name}`);
    const rawable =
      candidate.verdict === "twice" &&
      (answer?.kind === "contact" || answer?.kind === "link" || answer?.kind === "header");
    modes.set(
      key,
      rawable
        ? { mode: "raw", reason: "twice" }
        : { mode: "locked", reason: candidate.verdict as LockReason },
    );
  }
  return modes;
}

/** The probe's candidates by where they are, their kind and their span. */
function candidatesByPlace(probe: Probe): Map<string, ProbeCandidate> {
  const found = new Map<string, ProbeCandidate>();
  for (const candidate of probe.candidates) {
    const kind =
      candidate.kind === "paragraph"
        ? "paragraph"
        : candidate.kind === "argument"
          ? "argument"
          : candidate.kind;
    found.set(candidateKey(candidate.where, kind, candidate), candidate);
  }
  return found;
}

/**
 * The preamble's tree, and its calls at the top level to template macros that store their
 * arguments (`isSetter`), which the probe issued again and the assembly takes out and sets from
 * the model.
 */
function preambleOf(
  text: string,
  found: EngineSignatures,
): { text: string; tree?: Tree; setters: CallNode[] } {
  const read = readBody(bodyOfText(text));
  if ("refused" in read) return { text, setters: [] };
  const tree = buildTree(read, found);
  if ("refused" in tree) return { text, setters: [] };
  const setters = tree.content.filter(
    (node): node is CallNode =>
      node.kind === "call" &&
      Object.hasOwn(found.commands, node.name) &&
      found.commands[node.name]?.kind === "template" &&
      isSetter(Object.hasOwn(found.macros, node.name) ? found.macros[node.name] : undefined),
  );
  return { text, tree, setters };
}

// Template code.

/** A number or a length, braced or not, as a group of the template's own holds one. */
const NUMBER = /^\s*[{[]?\s*-?\d*\.?\d+\s*(?:pt|em|ex|cm|mm|in|bp|sp|cc|dd|pc)?\s*[}\]]?\s*$/;

/** A macro's id in the answers and the trusted set: `command|<name>` or `environment|<name>`. */
const macroOf = (slot: string) => slot.split("|").slice(0, 2).join("|");

/**
 * Whether a node shows a word of the person's in its arguments, however deep: a word of three
 * letters or more in a text, or a date, which a call the answer calls layout may not hold and stay
 * the template's code (decision 0026).
 */
function showsWordIn(node: Node): boolean {
  for (const each of everyNode([...inside(node)]))
    if (
      each.kind === "date" ||
      (each.kind === "text" && /\p{L}{3,}/u.test(each.runs.map((run) => run.text).join(" ")))
    )
      return true;
  return false;
}

/**
 * Whether a node of the body is the template's own code, which a snippet may hold as it stands: it
 * sets none of the person's text. Whitespace; a raw chunk that sets nothing, spacing, a size, a
 * rule or a definition (`maySetText`), holding no text; a call the answer says is layout, or the
 * header's call that holds none of its fields, as `\makecvheader`, where it shows no word, since
 * the body's text never reaches a snippet whatever the answer says: one that shows a word is a
 * locked section where it stands; and a call no argument of which holds text.
 */
function isCode(ctx: Context, node: Node): boolean {
  if (isBlankText(node)) return true;
  // A number or a length in braces, as an environment's argument its signature did not show, as
  // paracol's column count is: the template's, not the person's.
  if (node.kind === "text" && NUMBER.test(ctx.source.slice(node.start, node.end))) return true;
  if (node.kind === "raw") {
    if (maySetText(node)) return false;
    return wordsOf([...inside(node)]) === 0;
  }
  if (node.kind === "call" || node.kind === "environment") {
    const answer =
      node.kind === "call"
        ? commandAnswer(ctx.answers, node.name)
        : environmentAnswer(ctx.answers, node.name);
    if (answer?.kind === "layout" && node.kind === "call") return !showsWordIn(node);
    if (
      answer?.kind === "header" &&
      answer.arguments.every((arg) => headerSlotOf(arg) === undefined)
    )
      return node.kind === "call" && !showsWordIn(node);
    if (node.kind === "call") return wordsOf([...inside(node)]) === 0 && answer === undefined;
  }
  return false;
}

// The header.

/** The header's slots a header or contact call fills, by the answer's slot name. */
const HEADER_SLOTS: Readonly<Record<string, SlotOf>> = {
  first: { slot: "first", type: "text" },
  last: { slot: "last", type: "text" },
  headline: { slot: "headline", type: "text" },
  email: { slot: "email", type: "text" },
  phone: { slot: "phone", type: "text" },
  location: { slot: "location", type: "text" },
};

/**
 * The header's slot an argument fills: its own; or, for a name given whole whose answer maps it to
 * the first name and the last a space apart, as AltaCV's `\name` (decision 0024), the first, which
 * the split at its last space fills with the last beside it.
 */
function headerSlotOf(arg: ArgumentAnswer): string | undefined {
  if (arg.slot !== undefined) return arg.slot;
  const parts = arg.parts?.map((part) => part.slot);
  return parts?.length === 2 && parts[0] === "first" && parts[1] === "last" ? "first" : undefined;
}

/** The header's links' run among the decisions, as the checks lock it whole. */
export const LINKS = "h.links";

/** A link's kind from its address, for a macro that takes any: its site's, or a website. */
export function kindOfAddress(href: string): LinkKind {
  const address = href.trim().toLowerCase();
  if (/(^|[/.])linkedin\.com(\/|$)/.test(address)) return "linkedin";
  if (/(^|[/.])github\.com(\/|$)/.test(address)) return "github";
  if (/(^|[/.])(twitter|x)\.com(\/|$)/.test(address)) return "twitter";
  if (/(^|[/.])orcid\.org(\/|$)/.test(address)) return "orcid";
  if (/^(https?:\/\/|www\.)/.test(address)) return "website";
  return "other";
}

/** What the header's template makes: its snippet, the model's header, and its links' snippets. */
interface HeaderOut {
  snippet: string;
  header: Header;
  links: Map<LinkKind, string>;
  linksSeparator: string;
  /** The words its locked parts hold. */
}

/**
 * The header's snippet and the model's header, from the header's calls: the preamble's that store
 * the header's text (`setters`), each issued again, and the body's region of header calls, the
 * nodes between them with them. A header or contact call's fields go to the header's slots, a name
 * in one argument split at its last space, each field once, a second of one kept in the extras;
 * link calls in a run, nothing but spaces between them, are `{{links}}`, each through its kind's
 * snippet; a call the answer gives the header's contacts to is read through; the template's code
 * stays as it is; and anything else is kept in the header's extras, as the header's own bytes.
 */
function headerOf(
  ctx: Context,
  setters: readonly CallNode[],
  region: readonly Node[] | undefined,
): HeaderOut {
  const template = new Template();
  const header: Header = { name: { first: "", last: "" }, links: [] };
  const filled = new Set<string>();
  const links = new Map<LinkKind, string>();
  let linksSeparator = "\n";
  let linksPlaced = false;
  // Whether a run of links is kept whole, which, where no other run is `{{links}}`, the header keeps.
  let linksKept = false;
  let counter = 0;
  const node = "header";

  /** A field of the header, placed once; a second of one is kept whole in the extras. */
  const call = (at: CallNode, where: "b" | "p") => {
    const source = where === "p" ? (ctx.preamble.tree?.source ?? "") : ctx.source;
    const answer = commandAnswer(ctx.answers, at.name);
    const prefix = `c${++counter}-`;
    if (answer === undefined) {
      template.extra(`${prefix}all`, source.slice(at.start, at.end));
      // Kept as the upload wrote it, so counted as kept, as every part kept is (decision 0026).
      const words = wordsOf([at]);
      if (words > 0)
        keepPart(
          ctx,
          {
            at: `${where}${at.start}`,
            node,
            key: `${prefix}all`,
            kind: "header",
            reason: "unmapped",
            words,
          },
          at,
          where,
        );
      return;
    }
    const slots: Record<string, SlotOf> = {};
    for (const arg of answer.arguments) {
      const own = headerSlotOf(arg);
      const name = answer.kind === "contact" && own === "text" ? (answer.contact ?? "") : own;
      if (name === undefined || HEADER_SLOTS[name] === undefined || filled.has(name)) continue;
      slots[own ?? ""] = HEADER_SLOTS[name];
      filled.add(name);
      // A name given whole fills the last name too, which no other call then fills.
      if (arg.slot === undefined && name === "first") filled.add("last");
    }
    // A name in one argument is split at its last space, the first name before it.
    const oneName =
      answer.arguments.some((arg) => headerSlotOf(arg) === "first") &&
      !answer.arguments.some((arg) => headerSlotOf(arg) === "last");
    const rawable = answer.kind === "contact" || answer.kind === "link" || answer.kind === "header";
    template.code(`\\${at.name}`);
    at.args.forEach((arg, i) => {
      const index = i + 1;
      const answered = answer.arguments.find((each) => each.index === index);
      const own = answered === undefined ? undefined : headerSlotOf(answered);
      const wanted = own === undefined ? undefined : slots[own];
      if (answered?.slot === "contacts" && arg.present && arg.content !== undefined) {
        template.code(arg.open === "" ? "{" : arg.open);
        walk(arg.content, where, arg.innerStart, arg.innerEnd);
        template.code(arg.close === "" ? "}" : arg.close);
        return;
      }
      if (wanted === undefined || !arg.present || arg.content === undefined) {
        // An argument with no header slot, or a second value for a slot another call filled: the
        // template's own where it is code, and otherwise kept in the header's extras, its words
        // counted as locked (`putConstant`).
        putConstant(
          ctx,
          template,
          arg,
          { name: at.name, index },
          { where, key: `${prefix}a${index}`, holder: "header", node, answered },
        );
        // A field the parser could not read, whose bytes the header keeps: not editable.
        if (wanted !== undefined && arg.present) template.kept.add(wanted.slot);
        return;
      }
      const span = contentSpan(source, arg);
      let read: Read | undefined;
      if (oneName && wanted.slot === "first") {
        const whole = readText(arg.content);
        if (whole.ok && typeof whole.value === "string") {
          const space = whole.value.lastIndexOf(" ");
          const first = space < 0 ? whole.value : whole.value.slice(0, space);
          const last = space < 0 ? "" : whole.value.slice(space + 1);
          read = { ok: true, value: first, ...(whole.wrap ? { wrap: whole.wrap } : {}) };
          if (last !== "") template.values.last = last;
        } else read = whole;
      }
      const placed = putField(ctx, template, {
        where,
        content: arg.content,
        span,
        slot: wanted.slot,
        key: `${prefix}${wanted.slot}`,
        slotKey: slotKey("command", at.name, index),
        type: wanted.type,
        holder: "header",
        node,
        field: `header.${wanted.slot}`,
        candidate: "argument",
        rawable,
        ...(read === undefined ? {} : { read }),
      });
      const split = oneName && wanted.slot === "first" && placed.slot !== "";
      const slot = split
        ? placed.slot
            .replace("{{first}}", "{{first}}{{#last}} {{last}}{{/last}}")
            .replace("{{&first}}", "{{&first}}{{#last}} {{&last}}{{/last}}")
        : placed.slot;
      if (!placed.set) delete template.values.last;
      // A name in one argument kept as the upload had it keeps the last name with the first.
      if (!placed.set && oneName && wanted.slot === "first") template.kept.add("last");
      // The last name the split gives is a field of the same argument, locked with it.
      const first = ctx.fields.at(-1);
      if (split && placed.set && typeof template.values.last === "string" && first !== undefined) {
        first.words = wordsIn(String(template.values.first ?? ""));
        const last = { ...first, field: "header.last", words: wordsIn(template.values.last) };
        ctx.fields.push(last);
        const placement = ctx.placed.get(first);
        if (placement !== undefined) ctx.placed.set(last, placement);
      }
      template.code(arg.open === "" ? "{" : arg.open);
      template.text(source.slice(arg.innerStart, span.start));
      template.code(slot);
      putExtra(template, placed, `${prefix}${wanted.slot}`);
      template.text(source.slice(span.end, arg.innerEnd));
      template.code(arg.close === "" ? "}" : arg.close);
    });
  };

  /** A run of link calls, `{{links}}`, each link's snippet its kind's; false when they differ. */
  const linkRun = (run: readonly CallNode[], where: "b" | "p", gaps: readonly string[]) => {
    const source = where === "p" ? (ctx.preamble.tree?.source ?? "") : ctx.source;
    const snapshot = ctx.fields.length;
    const made: { kind: LinkKind; snippet: string; link: Link; set: boolean }[] = [];
    for (const each of run) {
      const answer = commandAnswer(ctx.answers, each.name);
      const id = ctx.ids.id("lnk", `${where}${each.start}`);
      const link = new Template();
      const set = callTemplate(ctx, link, each, {
        where,
        answer,
        slots: { label: { slot: "label", type: "text" } },
        holder: "none",
        node: id,
        fieldOf: (slot) => `${id}.${slot}`,
        rawable: true,
        list: LINKS,
        inner: (slot, arg, inner) => {
          if (slot !== "href") return false;
          inner.code("{{&href}}");
          link.values.href = trimmed(source.slice(arg.innerStart, arg.innerEnd));
          return true;
        },
      });
      const href = typeof link.values.href === "string" ? link.values.href : "";
      // The answer's kind, or, for a macro that takes any address, the kind its address gives.
      const kind: LinkKind = answer?.link ?? kindOfAddress(href);
      made.push({
        kind,
        snippet: link.snippet(),
        link: {
          id,
          kind,
          label: typeof link.values.label === "string" ? link.values.label : "",
          href,
        },
        set,
      });
    }
    const separators = new Set(gaps.map((gap) => comparable(gap)));
    const agree =
      ctx.decisions.instances[LINKS] === undefined &&
      separators.size <= 1 &&
      made.every(
        (each) =>
          each.set &&
          (links.get(each.kind) === undefined ||
            comparable(links.get(each.kind) ?? "") === comparable(each.snippet)),
      ) &&
      made.every((each, i) =>
        made
          .slice(0, i)
          .every(
            (other) =>
              other.kind !== each.kind || comparable(other.snippet) === comparable(each.snippet),
          ),
      );
    // A run kept whole has no fields: its links are not in the model, and it is locked for the
    // checks' reason, or its first locked link's, or else for its shape (decision 0026).
    const why = agree
      ? undefined
      : (ctx.decisions.instances[LINKS] ??
        ctx.fields.slice(snapshot).find((field) => field.reason)?.reason ??
        "shape");
    if (!agree) {
      ctx.fields.length = snapshot;
      linksKept = true;
    }
    return {
      made,
      agree,
      why: why ?? "shape",
      separator: gaps[0] === undefined ? "\n" : templateText(gaps[0]),
    };
  };

  /** A region's nodes in turn, with the gaps between them, from `from` to `to`. */
  const walk = (nodes: readonly Node[], where: "b" | "p", from: number, to: number) => {
    const source = where === "p" ? (ctx.preamble.tree?.source ?? "") : ctx.source;
    let at = from;
    for (let i = 0; i < nodes.length; i++) {
      const each = nodes[i] as Node;
      template.text(source.slice(at, each.start));
      at = each.end;
      const answer = each.kind === "call" ? commandAnswer(ctx.answers, each.name) : undefined;
      if (each.kind === "call" && answer?.kind === "link" && !linksPlaced) {
        // The run: link calls with nothing but spaces and comments between them.
        const run: CallNode[] = [each];
        const gaps: string[] = [];
        let j = i + 1;
        while (j < nodes.length) {
          const next = nodes[j] as Node;
          if (next.kind === "call" && commandAnswer(ctx.answers, next.name)?.kind === "link") {
            gaps.push(source.slice((run.at(-1) as CallNode).end, next.start));
            run.push(next);
            j++;
            continue;
          }
          if (isBlankText(next)) {
            j++;
            continue;
          }
          break;
        }
        const { made, agree, why, separator } = linkRun(run, where, gaps);
        const last = run.at(-1) as CallNode;
        if (agree) {
          linksPlaced = true;
          linksSeparator = separator;
          for (const each of made) {
            links.set(each.kind, each.snippet);
            header.links.push(each.link);
          }
          template.code("{{links}}");
          template.extra("links", "");
        } else {
          template.extra(`n${++counter}`, source.slice(each.start, last.end));
          const words = wordsOf(run);
          if (words > 0)
            keepPart(
              ctx,
              {
                at: `${where}${each.start}`,
                node,
                key: `n${counter}`,
                kind: "header",
                reason: why,
                words,
              },
              { start: each.start, end: last.end },
              where,
            );
        }
        at = last.end;
        i = j - 1;
        continue;
      }
      if (
        each.kind === "call" &&
        answer !== undefined &&
        (answer.kind === "header" || answer.kind === "contact") &&
        !isCode(ctx, each)
      ) {
        call(each, where);
        continue;
      }
      if (isCode(ctx, each)) {
        template.text(source.slice(each.start, each.end));
        continue;
      }
      template.extra(`n${++counter}`, source.slice(each.start, each.end));
      const words = wordsOf([each]);
      if (words > 0)
        keepPart(
          ctx,
          {
            at: `${where}${each.start}`,
            node,
            key: `n${counter}`,
            kind: "header",
            reason: "unmapped",
            words,
          },
          each,
          where,
        );
    }
    template.text(source.slice(at, to));
  };

  // The preamble's calls, each on a line; its link calls in a run, as the body's are.
  for (let i = 0; i < setters.length; i++) {
    const setter = setters[i] as CallNode;
    const isLink = (each: CallNode | undefined) =>
      each !== undefined && commandAnswer(ctx.answers, each.name)?.kind === "link";
    if (!isLink(setter) || linksPlaced) {
      if (isLink(setter)) {
        // A link after the header's run of them, which `{{links}}` has set: kept as it was.
        template.extra(`n${++counter}`, ctx.preamble.text.slice(setter.start, setter.end));
        const words = wordsOf([setter]);
        if (words > 0)
          keepPart(
            ctx,
            {
              at: `p${setter.start}`,
              node,
              key: `n${counter}`,
              kind: "header",
              reason: "unmapped",
              words,
            },
            setter,
            "p",
          );
      } else call(setter, "p");
      template.code("\n");
      continue;
    }
    let j = i;
    while (isLink(setters[j + 1])) j++;
    const run = setters.slice(i, j + 1);
    const { made, agree, why } = linkRun(
      run,
      "p",
      run.slice(1).map(() => "\n"),
    );
    if (agree) {
      linksPlaced = true;
      linksSeparator = "\n";
      for (const each of made) {
        links.set(each.kind, each.snippet);
        header.links.push(each.link);
      }
      template.code("{{links}}");
      template.extra("links", "");
    } else
      for (const each of run) {
        template.extra(`n${++counter}`, ctx.preamble.text.slice(each.start, each.end));
        template.code("\n");
        const words = wordsOf([each]);
        if (words > 0)
          keepPart(
            ctx,
            { at: `p${each.start}`, node, key: `n${counter}`, kind: "header", reason: why, words },
            each,
            "p",
          );
      }
    template.code("\n");
    i = j;
  }
  const first = region?.[0];
  const last = region?.at(-1);
  if (region !== undefined && first !== undefined && last !== undefined)
    walk(region, "b", first.start, last.end);

  const values = template.values;
  header.name.first = typeof values.first === "string" ? values.first : "";
  header.name.last = typeof values.last === "string" ? values.last : "";
  for (const field of ["headline", "email", "phone", "location"] as const) {
    const value = values[field];
    if (typeof value === "string" && !isBlank(value)) header[field] = value;
  }
  if (Object.keys(template.extras).length > 0) header.extras = { ...template.extras };
  // Links kept whole, with none the header's snippet sets as `{{links}}`: a link added would not show.
  if (linksKept && !linksPlaced) template.kept.add("links");
  const kept = keptOf(template.kept, HEADER_KEPT);
  if (kept !== undefined) header.kept = kept;
  return { snippet: template.snippet(), header, links, linksSeparator };
}

/**
 * The slots a node keeps as the upload had it (decision 0026), of those its kind may name, in the
 * model's order; undefined for none, so that a node that keeps none has no `kept`.
 */
function keptOf<T extends string>(kept: ReadonlySet<string>, slots: readonly T[]): T[] | undefined {
  const found = slots.filter((slot) => kept.has(slot));
  return found.length === 0 ? undefined : found;
}

// Sections.

/** Keywords of a section's title, and the role each gives, the first that matches. */
const ROLE_WORDS: readonly [RegExp, SectionRole][] = [
  [/summary|profile|about|objective|overview|introduction/i, "summary"],
  [/experience|employment|work|career|positions?|internships?/i, "experience"],
  [/education|academic|studies|qualifications|schooling|degrees?/i, "education"],
  [/projects?|portfolio/i, "projects"],
  [/skills?|technical|technolog|competenc|expertise|tools/i, "skills"],
  [/awards?|honou?rs?|achievements?|certificat|prizes?|scholarships?/i, "awards"],
  [/publications?|papers?|research|talks|presentations/i, "publications"],
  [/languages?/i, "languages"],
];

/** A section's role: the one its content's answer names, else the one its title says, else other. */
function roleOf(title: string, hinted: SectionRole | undefined): SectionRole {
  if (hinted !== undefined) return hinted;
  for (const [words, role] of ROLE_WORDS) if (words.test(title)) return role;
  return "other";
}

/** Whether a node heads a section: a standard section of the heads' level, or the answer's section. */
function isHead(ctx: Context, node: Node, level: number): boolean {
  if (node.kind === "section") return node.level === level;
  return node.kind === "call" && commandAnswer(ctx.answers, node.name)?.kind === "section";
}

/** The level the heads of a list of nodes have: the least a standard section of it has. */
function headLevel(nodes: readonly Node[]): number {
  let level = Number.POSITIVE_INFINITY;
  for (const node of nodes) if (node.kind === "section" && node.level < level) level = node.level;
  return level;
}

/** The snippets a unit proposes, by key, which fit the package's when each is new or the same. */
type Proposal = Map<string, string>;

/**
 * The package's snippets as the sections propose them, each the first that fits. An entry's
 * snippet compares with its bullets' block aside, since an entry with no bullets shows none of its
 * frame, and one that shows the frame takes the place of one that does not.
 */
class Registry {
  readonly snippets = new Map<string, string>();
  /**
   * What a unit the user adds writes for an extras slot each unit of the upload fills, by the
   * snippet's place and role, `entry:<role>` or `section:<role>`: the first unit's, which the
   * proposals do not compare, since each upload's first call gives its own (decision 0026).
   */
  readonly defaults = new Map<string, Record<string, string>>();

  /** A unit's defaults under `key`, each where no unit has given one for its extras key yet. */
  addDefaults(key: string, defaults: Readonly<Record<string, string>> | undefined) {
    const there = this.defaults.get(key) ?? {};
    for (const [slot, latex] of Object.entries(defaults ?? {}))
      if (!Object.hasOwn(there, slot)) there[slot] = latex;
    this.defaults.set(key, there);
  }

  /** How a snippet under `key` compares with another. */
  private static shape(key: string, snippet: string) {
    return comparable(key.startsWith("entry:") ? withoutFrame(snippet) : snippet);
  }

  /** Whether every snippet of a proposal is new, or reads to TeX as the one there (`comparable`). */
  fits(proposal: Proposal): boolean {
    for (const [key, snippet] of proposal) {
      const there = this.snippets.get(key);
      if (there !== undefined && Registry.shape(key, there) !== Registry.shape(key, snippet))
        return false;
    }
    return true;
  }

  add(proposal: Proposal) {
    for (const [key, snippet] of proposal) {
      const there = this.snippets.get(key);
      const framed = key.startsWith("entry:") && there !== undefined && bulletsOf(there) === "";
      if (there === undefined || (framed && bulletsOf(snippet) !== ""))
        this.snippets.set(key, snippet);
    }
  }
}

/** A bullet list as a unit reads it: its frame, its bullets' snippet and separator, and bullets. */
interface BulletList {
  /** The frame, with `{{bullets}}` in it where the bullets go. */
  frame: string;
  bullet: string;
  separator: string;
  bullets: { id: string; text: RichText }[];
  /** Whether every bullet reads as the first's snippet sets it, a rich text alone. */
  ok: boolean;
  /** Why a list that is not ok is kept whole: the checks' decision, or its first locked bullet's. */
  why?: LockReason;
  /** The bullets' words. */
  words: number;
  /** Where the list stands in the body's source, from its opener's start to its closer's end. */
  span: Span;
}

/**
 * The bullets a list sets: the items of a standard list, of a template environment the answer says
 * sets bullets, or the answer's bullet calls between an opener and its closer. A bullet is one
 * paragraph of rich text; a list whose bullets are not, or whose snippets or separators differ,
 * is not ok, and its unit keeps its bytes in the extras.
 */
function bulletListOf(
  ctx: Context,
  items: readonly Node[],
  frame: { open: Span; close: Span },
  owner: string,
  role: SectionRole,
): BulletList {
  // `owner` is the list's name among the decisions, as the checks lock it: where it stands.
  const decided = ctx.decisions.instances[owner];
  const source = ctx.source;
  const snapshot = { fields: ctx.fields.length, locked: ctx.locked.length };
  const bullets: BulletList["bullets"] = [];
  let bullet: string | undefined;
  let ok = true;
  const separators: string[] = [];
  let previous: Node | undefined;
  const words = wordsOf(items);
  for (const item of items) {
    if (isBlankText(item)) continue;
    if (previous !== undefined) separators.push(source.slice(previous.end, item.start));
    previous = item;
    const id = ctx.ids.id("bul", `b${item.start}`);
    const template = new Template();
    if (item.kind === "item" && item.args.every((arg) => !arg.present)) {
      const span = spanOfNodes(meaningful(item.content));
      const tight =
        span === undefined ? { start: item.end, end: item.end } : tightened(source, span);
      template.text(source.slice(item.start, tight.start));
      const placed = putField(ctx, template, {
        where: "b",
        content: item.content,
        span: tight,
        slot: "text",
        key: "text",
        slotKey: `standard|item|${role}`,
        type: "rich",
        holder: "none",
        node: id,
        field: `${id}.text`,
        candidate: "item",
        list: owner,
      });
      template.code(placed.slot);
      template.text(source.slice(tight.end, span?.end ?? tight.end));
      if (!placed.set || placed.slot === "") ok = false;
    } else if (item.kind === "call" && commandAnswer(ctx.answers, item.name)?.kind === "bullet") {
      const set = callTemplate(ctx, template, item, {
        where: "b",
        answer: commandAnswer(ctx.answers, item.name),
        slots: { text: { slot: "text", type: "rich" } },
        holder: "none",
        node: id,
        fieldOf: (slot) => `${id}.${slot}`,
        list: owner,
      });
      if (!set) ok = false;
    } else {
      ok = false;
      continue;
    }
    const snippet = template.snippet();
    if (bullet === undefined) bullet = snippet;
    else if (comparable(bullet) !== comparable(snippet)) ok = false;
    const text = template.values.text;
    bullets.push({ id, text: Array.isArray(text) ? (text as RichText) : [] });
  }
  const gaps = new Set(separators.map(comparable));
  if (gaps.size > 1) ok = false;
  const separator = separators[0] === undefined ? "\n" : templateText(separators[0]) || "\n";
  const frameText = `${templateText(source.slice(frame.open.start, frame.open.end))}{{bullets}}${templateText(source.slice(frame.close.start, frame.close.end))}`;
  const kept = ok && bullets.length > 0 && decided === undefined;
  // A list kept whole has no fields: its bullets are not in the model.
  const why = kept
    ? undefined
    : (decided ?? ctx.fields.slice(snapshot.fields).find((field) => field.reason)?.reason);
  if (!kept) {
    ctx.fields.length = snapshot.fields;
    ctx.locked.length = snapshot.locked;
  }
  return {
    frame: frameText,
    bullet: bullet ?? "\\item {{text}}",
    separator,
    bullets,
    ok: kept,
    ...(why === undefined ? {} : { why }),
    words,
    span: { start: frame.open.start, end: frame.close.end },
  };
}

/**
 * A bullet list that starts a list of nodes at `i`: the answer's opener and the bullets up to its
 * closer, a standard list, or a template environment that sets bullets; with where it ends.
 */
function bulletsAt(
  ctx: Context,
  nodes: readonly Node[],
  i: number,
): { items: Node[]; open: Span; close: Span; end: number } | undefined {
  const node = nodes[i];
  if (node === undefined) return undefined;
  if (node.kind === "list" && (node.name === "itemize" || node.name === "enumerate")) {
    const first = node.content.find((each) => !isBlankText(each));
    const last = [...node.content].reverse().find((each) => !isBlankText(each));
    if (first === undefined || last === undefined) return undefined;
    return {
      items: node.content,
      open: { start: node.start, end: first.start },
      close: { start: last.end, end: node.end },
      end: i + 1,
    };
  }
  if (
    node.kind === "environment" &&
    environmentAnswer(ctx.answers, node.name)?.kind === "bulletList"
  ) {
    const first = node.content.find((each) => !isBlankText(each));
    const last = [...node.content].reverse().find((each) => !isBlankText(each));
    if (first === undefined || last === undefined) return undefined;
    return {
      items: node.content,
      open: { start: node.start, end: first.start },
      close: { start: last.end, end: node.end },
      end: i + 1,
    };
  }
  if (node.kind === "call") {
    const answer = commandAnswer(ctx.answers, node.name);
    if (answer?.list?.does !== "opens" || answer.kind !== "bulletList") return undefined;
    const j = closerOf(nodes, i, answer.list.closedBy);
    const each = nodes[j];
    if (each !== undefined) {
      const inner = nodes.slice(i + 1, j);
      const first = inner.find((one) => !isBlankText(one));
      const last = [...inner].reverse().find((one) => !isBlankText(one));
      return {
        items: inner,
        open: { start: node.start, end: first?.start ?? each.start },
        close: { start: last?.end ?? node.end, end: each.end },
        end: j + 1,
      };
    }
  }
  return undefined;
}

/** What a section's content is, as the parse reads it, and where it ends in the section's nodes. */
interface Content {
  kind: SectionKind;
  /** The frame the content's units go in, with the list slot where they go. */
  frame: string;
  /** The units' snippet key and snippets, and the separator between them. */
  proposal: Proposal;
  /** The section's model content. */
  build: (section: { id: string; title: string; role: SectionRole; extras?: Extras }) => Section;
  /** Whether the content is kept in the extras, its units not fitting their snippets. */
  locked: boolean;
  span: Span;
  end: number;
  words: number;
  /** What an entry the user adds writes for an extras slot each entry fills (decision 0026). */
  defaults?: Record<string, string>;
  /** The section's slots its content keeps as the upload had them: its text, or its items. */
  kept?: readonly string[];
}

/**
 * The entries a section holds from `i`: the answer's opener, or an environment that holds entries,
 * or entry calls one after another; each entry its call and the bullet list after it or in its
 * argument, and between two entries the same code, as a divider, or nothing.
 */
function entriesAt(
  ctx: Context,
  nodes: readonly Node[],
  i: number,
  role: SectionRole,
  owner: string,
): Content | undefined {
  const node = nodes[i];
  if (node === undefined) return undefined;
  let units: readonly Node[];
  let open: Span;
  let close: Span;
  let end: number;
  const answer =
    node.kind === "call"
      ? commandAnswer(ctx.answers, node.name)
      : node.kind === "environment"
        ? environmentAnswer(ctx.answers, node.name)
        : undefined;
  if (answer?.list?.does === "opens" && answer.list.holds === "entry" && node.kind === "call") {
    const j = closerOf(nodes, i, answer.list.closedBy);
    if (j < 0) return undefined;
    units = nodes.slice(i + 1, j);
    const first = units.find((each) => !isBlankText(each));
    const last = [...units].reverse().find((each) => !isBlankText(each));
    open = { start: node.start, end: first?.start ?? (nodes[j] as Node).start };
    close = { start: last?.end ?? node.end, end: (nodes[j] as Node).end };
    end = j + 1;
  } else if (
    node.kind === "environment" &&
    answer?.list?.does === "opens" &&
    answer.list.holds === "entry"
  ) {
    units = node.content;
    const first = units.find((each) => !isBlankText(each));
    const last = [...units].reverse().find((each) => !isBlankText(each));
    open = { start: node.start, end: first?.start ?? node.end };
    close = { start: last?.end ?? node.start, end: node.end };
    end = i + 1;
  } else if (node.kind === "call" && answer?.kind === "entry") {
    // Entries one after another, with no list around them: as far as they go.
    let j = i;
    let last = i;
    while (j < nodes.length) {
      const each = nodes[j] as Node;
      if (each.kind === "call" && commandAnswer(ctx.answers, each.name)?.kind === "entry") {
        const bullets = bulletsAt(ctx, nodes, nextNonBlank(nodes, j + 1));
        last = bullets === undefined ? j : bullets.end - 1;
        j = last + 1;
        // Between two entries, the same code, as a divider, or nothing.
        let k = j;
        while (
          k < nodes.length &&
          isCode(ctx, nodes[k] as Node) &&
          !isEntryCall(ctx, nodes[k] as Node)
        )
          k++;
        if (k < nodes.length && isEntryCall(ctx, nodes[k] as Node)) {
          j = k;
          continue;
        }
        break;
      }
      break;
    }
    units = nodes.slice(i, last + 1);
    open = { start: node.start, end: node.start };
    close = { start: (nodes[last] as Node).end, end: (nodes[last] as Node).end };
    end = last + 1;
  } else return undefined;

  // The entries, each with its bullets, and what stands between them.
  const proposal: Proposal = new Map();
  const entries: Entry[] = [];
  const separators: string[] = [];
  let entryKind: string | undefined;
  let defaults: Record<string, string> | undefined;
  let ok = true;
  const snapshot = { fields: ctx.fields.length, locked: ctx.locked.length };
  let j = 0;
  let previousEnd: number | undefined;
  while (j < units.length) {
    const each = units[j] as Node;
    if (isBlankText(each)) {
      j++;
      continue;
    }
    if (!isEntryCall(ctx, each)) {
      if (previousEnd !== undefined && isCode(ctx, each)) {
        j++;
        continue;
      }
      ok = false;
      break;
    }
    const call = each as CallNode;
    if (previousEnd !== undefined) separators.push(ctx.source.slice(previousEnd, call.start));
    const id = ctx.ids.id("ent", `b${call.start}`);
    const entryAnswer = commandAnswer(ctx.answers, call.name);
    const template = new Template();
    let bullets: BulletList | undefined;
    let bulletsBytes = "";
    // Bullets in an argument, as Awesome-CV's `\cventry` takes them.
    const set = callTemplate(ctx, template, call, {
      where: "b",
      answer: entryAnswer,
      role,
      slots: ENTRY_SLOTS,
      holder: "entry",
      node: id,
      fieldOf: (slot) => `${id}.${slot}`,
      inner: (slot, arg, inner) => {
        if (slot !== "bullets") return false;
        const content = arg.content ?? [];
        const at = nextNonBlank(content, 0);
        const found = at < content.length ? bulletsAt(ctx, content, at) : undefined;
        const rest = found === undefined ? content : content.slice(found.end);
        if (meaningful(content).length === 0) {
          // Nothing but spaces: kept as they are, since a macro that tests its argument for being
          // empty, as `\cventry` does, reads a space as something.
          inner.code("{{#bullets}}{{/bullets}}");
          inner.extra("bullets", ctx.source.slice(arg.innerStart, arg.innerEnd));
          return true;
        }
        if (found === undefined || meaningful(rest).length > 0) {
          // Not a clean list: kept as the upload had it, and its words counted as locked.
          inner.extra("bullets", ctx.source.slice(arg.innerStart, arg.innerEnd));
          inner.kept.add("bullets");
          const words = wordsOf(content);
          if (words > 0)
            keepPart(
              ctx,
              {
                at: `b${arg.innerStart}`,
                node: id,
                key: "bullets",
                kind: "list",
                reason: "unmapped",
                words,
              },
              { start: arg.innerStart, end: arg.innerEnd },
            );
          return true;
        }
        bullets = bulletListOf(ctx, found.items, found, `b${call.start}.bullets`, role);
        const lead = ctx.source.slice(arg.innerStart, found.open.start);
        const tail = ctx.source.slice(found.close.end, arg.innerEnd);
        inner.code("{{#bullets}}");
        inner.text(lead);
        inner.code(bullets.frame);
        inner.text(tail);
        inner.code("{{/bullets}}");
        bulletsBytes = ctx.source.slice(arg.innerStart, arg.innerEnd);
        inner.extra("bullets", bullets.ok ? "" : bulletsBytes);
        if (!bullets.ok) inner.kept.add("bullets");
        return true;
      },
    });
    let unitEnd = call.end;
    // Bullets after the call, as Jake's Resume and AltaCV set them.
    if (entryAnswer?.arguments.every((arg) => arg.slot !== "bullets") ?? true) {
      const at = nextNonBlank(units, j + 1);
      const found = at < units.length ? bulletsAt(ctx, units, at) : undefined;
      if (found !== undefined) {
        bullets = bulletListOf(ctx, found.items, found, `b${call.start}.bullets`, role);
        template.code("{{#bullets}}");
        template.text(ctx.source.slice(call.end, found.open.start));
        template.code(bullets.frame);
        template.code("{{/bullets}}");
        bulletsBytes = ctx.source.slice(call.end, found.close.end);
        template.extra("bullets", bullets.ok ? "" : bulletsBytes);
        if (!bullets.ok) template.kept.add("bullets");
        unitEnd = found.close.end;
        j = found.end - 1;
      } else {
        template.code("{{#bullets}}{{/bullets}}");
        template.extra("bullets", "");
      }
    }
    j++;
    previousEnd = unitEnd;
    if (!set) {
      ok = false;
      break;
    }
    // Entries compare with their bullets' frame aside, since one with no bullets shows none; the
    // frame is the first entry's with bullets, and those of the others must read the same.
    const snippet = template.snippet();
    const kind = `entry:${role}`;
    const shape = withoutFrame(snippet);
    if (entryKind === undefined) entryKind = shape;
    else if (comparable(entryKind) !== comparable(shape)) {
      ok = false;
      break;
    }
    if (bulletsOf(snippet) !== "") {
      const frameKey = `bullets:${role}`;
      const frame = proposal.get(frameKey);
      if (frame !== undefined && comparable(frame) !== comparable(bulletsOf(snippet))) {
        ok = false;
        break;
      }
      proposal.set(frameKey, bulletsOf(snippet));
      proposal.set(kind, snippet);
    } else if (!proposal.has(kind)) proposal.set(kind, snippet);
    const list = bullets as BulletList | undefined;
    if (list !== undefined && !list.ok && list.words > 0)
      keepPart(
        ctx,
        {
          at: `b${call.start}`,
          node: id,
          key: "bullets",
          kind: "list",
          reason: list.why ?? "shape",
          words: list.words,
        },
        list.span,
      );
    if (list !== undefined && list.ok) {
      proposal.set(`bullet:${role}`, list.bullet);
      proposal.set(`sep:bullets:${role}`, list.separator);
    }
    const values = template.values;
    const text = (slot: string) =>
      typeof values[slot] === "string" ? (values[slot] as string) : undefined;
    const kept = keptOf(template.kept, ENTRY_KEPT);
    const entry: Entry = {
      id,
      title: text("title") ?? "",
      ...(text("subtitle") === undefined ? {} : { subtitle: text("subtitle") as string }),
      ...(text("place") === undefined ? {} : { place: text("place") as string }),
      ...(values.dates === undefined ? {} : { dates: values.dates as Dates }),
      bullets: list !== undefined && list.ok ? list.bullets : [],
      ...(Object.keys(template.extras).length === 0 ? {} : { extras: { ...template.extras } }),
      ...(kept === undefined ? {} : { kept }),
    };
    entries.push(entry);
    // What an entry the user adds writes for the arguments each entry keeps: the first's, which
    // gives the first call's bytes where the answer says kept.
    defaults ??= { ...template.defaults };
  }
  if (!ok || entries.length === 0) {
    ctx.fields.length = snapshot.fields;
    ctx.locked.length = snapshot.locked;
    return undefined;
  }
  const gaps = new Set(separators.map(comparable));
  if (gaps.size > 1) {
    ctx.fields.length = snapshot.fields;
    ctx.locked.length = snapshot.locked;
    return undefined;
  }
  proposal.set(
    `sep:entries:${role}`,
    separators[0] === undefined ? "\n" : templateText(separators[0]) || "\n",
  );
  const frame = `${templateText(ctx.source.slice(open.start, open.end))}{{entries}}${templateText(ctx.source.slice(close.start, close.end))}`;
  const span = { start: node.start, end: (nodes[end - 1] as Node).end };
  return {
    kind: "entries",
    frame: `{{#entries}}${frame}{{/entries}}{{&x.entries}}`,
    proposal,
    build: (section) => ({ ...section, kind: "entries", entries }),
    locked: false,
    span,
    end,
    words: wordsOf(nodes.slice(i, end)),
    defaults: defaults ?? {},
  };
}

/** The bullets' block of an entry's snippet, what stands inside `{{#bullets}}`, or nothing. */
function bulletsOf(snippet: string): string {
  const found = /\{\{#bullets\}\}([\s\S]*?)\{\{\/bullets\}\}/.exec(snippet);
  return found?.[1] ?? "";
}

/** An entry's snippet with its bullets' block emptied, as entries compare. */
const withoutFrame = (snippet: string) =>
  snippet.replace(/\{\{#bullets\}\}[\s\S]*?\{\{\/bullets\}\}/, "{{#bullets}}{{/bullets}}");

/** Whether a text ends in a control word, after which TeX skips spaces and a line's end. */
function endsInControlWord(text: string): boolean {
  const word = /\\+([A-Za-z@]+)$/.exec(text);
  return word !== null && (word[0].length - (word[1]?.length ?? 0)) % 2 === 1;
}

/** Whether a node is a call the answer says sets an entry. */
const isEntryCall = (ctx: Context, node: Node) =>
  node.kind === "call" && commandAnswer(ctx.answers, node.name)?.kind === "entry";

/** Whether an answer opens a list of items or bullets, which a section may hold alone. */
const isItemsOpener = (answer: Answer | undefined) =>
  answer?.list?.does === "opens" &&
  (answer.list.holds === "bullet" || answer.list.holds === "labelledItem");

/**
 * Where the call that closes the list the call at `i` opens stands, among `nodes`: the first call to
 * `closer` that is not a nested list's, as a template that opens its bullets' list with the macro
 * that opens its entries', as an older Jake's Resume does, closes each; or -1.
 */
function closerOf(nodes: readonly Node[], i: number, closer: string | undefined): number {
  const opener = (nodes[i] as CallNode).name;
  let depth = 0;
  for (let j = i + 1; j < nodes.length; j++) {
    const each = nodes[j] as Node;
    if (each.kind !== "call") continue;
    if (each.name === opener && opener !== closer) depth++;
    else if (each.name === closer) {
      if (depth === 0) return j;
      depth--;
    }
  }
  return -1;
}

/** The first node from `i` that is not whitespace alone, or the list's length. */
function nextNonBlank(nodes: readonly Node[], i: number): number {
  let j = i;
  while (j < nodes.length && isBlankText(nodes[j] as Node)) j++;
  return j;
}

/**
 * The items a section holds from `i`: a standard list, whose items are a list's or, with labels, a
 * labelled list's; an environment that holds the answer's labelled items or bullets; or the
 * answer's labelled item or bullet calls one after another, as AltaCV's tags. Each item is one
 * paragraph of rich text, a label a text; the items' snippets and the gaps between them the same.
 */
function itemsAt(
  ctx: Context,
  nodes: readonly Node[],
  i: number,
  role: SectionRole,
  owner: string,
): Content | undefined {
  const node = nodes[i];
  if (node === undefined) return undefined;
  let units: readonly Node[];
  let open: Span;
  let close: Span;
  let end = i + 1;
  const bounds = (content: readonly Node[], outer: Span) => {
    const first = content.find((each) => !isBlankText(each));
    const last = [...content].reverse().find((each) => !isBlankText(each));
    return {
      open: { start: outer.start, end: first?.start ?? outer.end },
      close: { start: last?.end ?? outer.start, end: outer.end },
    };
  };
  if (node.kind === "list") {
    units = node.content;
    ({ open, close } = bounds(units, node));
  } else if (node.kind === "environment") {
    const answer = environmentAnswer(ctx.answers, node.name);
    const holds = answer?.list?.holds;
    if (answer?.list?.does !== "opens" || (holds !== "labelledItem" && holds !== "bullet"))
      return undefined;
    units = node.content;
    ({ open, close } = bounds(units, node));
  } else if (node.kind === "call" && isItemsOpener(commandAnswer(ctx.answers, node.name))) {
    // The answer's opener, as a bullets' list a section holds alone, and its items to its closer.
    const j = closerOf(nodes, i, commandAnswer(ctx.answers, node.name)?.list?.closedBy);
    const closing = nodes[j];
    if (closing === undefined) return undefined;
    units = nodes.slice(i + 1, j);
    ({ open, close } = bounds(units, { start: node.start, end: closing.end }));
    end = j + 1;
  } else if (node.kind === "call") {
    const kind = commandAnswer(ctx.answers, node.name)?.kind;
    if (kind !== "labelledItem" && kind !== "bullet") return undefined;
    let j = i;
    let last = i;
    while (j < nodes.length) {
      const each = nodes[j] as Node;
      if (each.kind === "call" && commandAnswer(ctx.answers, each.name)?.kind === kind) {
        last = j;
        j = nextNonBlank(nodes, j + 1);
        continue;
      }
      break;
    }
    units = nodes.slice(i, last + 1);
    open = { start: node.start, end: node.start };
    close = { start: (nodes[last] as Node).end, end: (nodes[last] as Node).end };
    end = last + 1;
  } else return undefined;

  const snapshot = { fields: ctx.fields.length, locked: ctx.locked.length };
  const items: { id: string; label?: string; text: RichText }[] = [];
  const separators: string[] = [];
  let labelled: boolean | undefined;
  let itemSnippet: string | undefined;
  let ok = true;
  let previous: Node | undefined;
  for (const unit of units) {
    if (isBlankText(unit)) continue;
    if (previous !== undefined) separators.push(ctx.source.slice(previous.end, unit.start));
    previous = unit;
    const id = ctx.ids.id("itm", `b${unit.start}`);
    const template = new Template();
    let isLabelled = false;
    if (unit.kind === "item") {
      const label = unit.args[0];
      isLabelled = label !== undefined && label.present;
      const span = spanOfNodes(meaningful(unit.content));
      const tight =
        span === undefined ? { start: unit.end, end: unit.end } : tightened(ctx.source, span);
      if (isLabelled && label !== undefined && label.content !== undefined) {
        const labelSpan = contentSpan(ctx.source, label);
        template.text(ctx.source.slice(unit.start, label.innerStart));
        template.text(ctx.source.slice(label.innerStart, labelSpan.start));
        const placed = putField(ctx, template, {
          where: "b",
          content: label.content,
          span: labelSpan,
          slot: "label",
          key: "label",
          slotKey: `standard|label|${role}`,
          type: "text",
          holder: "none",
          node: id,
          field: `${id}.label`,
          candidate: "label",
          list: `b${node.start}.items`,
        });
        if (!placed.set || placed.slot === "") ok = false;
        template.code(placed.slot);
        template.text(ctx.source.slice(labelSpan.end, tight.start));
      } else template.text(ctx.source.slice(unit.start, tight.start));
      const placed = putField(ctx, template, {
        where: "b",
        content: unit.content,
        span: tight,
        slot: "text",
        key: "text",
        slotKey: `standard|item|${role}`,
        type: "rich",
        holder: "none",
        node: id,
        field: `${id}.text`,
        candidate: "item",
        list: `b${node.start}.items`,
      });
      if (!placed.set || placed.slot === "") ok = false;
      template.code(placed.slot);
      template.text(ctx.source.slice(tight.end, span?.end ?? tight.end));
    } else if (unit.kind === "call") {
      const answer = commandAnswer(ctx.answers, unit.name);
      if (answer?.kind !== "labelledItem" && answer?.kind !== "bullet") {
        ok = false;
        break;
      }
      isLabelled = answer.kind === "labelledItem";
      const set = callTemplate(ctx, template, unit, {
        where: "b",
        answer,
        role,
        slots: { label: { slot: "label", type: "text" }, text: { slot: "text", type: "rich" } },
        holder: "none",
        node: id,
        fieldOf: (slot) => `${id}.${slot}`,
        list: `b${node.start}.items`,
      });
      if (!set) ok = false;
    } else {
      ok = false;
      break;
    }
    if (labelled === undefined) labelled = isLabelled;
    else if (labelled !== isLabelled) ok = false;
    const snippet = template.snippet();
    if (itemSnippet === undefined) itemSnippet = snippet;
    else if (comparable(itemSnippet) !== comparable(snippet)) ok = false;
    const values = template.values;
    items.push({
      id,
      ...(isLabelled ? { label: typeof values.label === "string" ? values.label : "" } : {}),
      text: Array.isArray(values.text) ? (values.text as RichText) : [],
    });
  }
  if (items.length === 0) {
    ctx.fields.length = snapshot.fields;
    ctx.locked.length = snapshot.locked;
    return undefined;
  }
  if (new Set(separators.map(comparable)).size > 1) ok = false;
  const decided = ctx.decisions.instances[`b${node.start}.items`];
  if (decided !== undefined) ok = false;
  const kind: SectionKind = labelled === true ? "labelled" : "list";
  const frame = `${templateText(ctx.source.slice(open.start, open.end))}{{items}}${templateText(ctx.source.slice(close.start, close.end))}`;
  const span = { start: node.start, end: (nodes[end - 1] as Node).end };
  const words = wordsOf(nodes.slice(i, end));
  const proposal: Proposal = new Map();
  if (ok) {
    proposal.set(`${kind === "labelled" ? "labelledItem" : "item"}:${role}`, itemSnippet ?? "");
    proposal.set(
      `sep:items:${role}`,
      separators[0] === undefined ? "\n" : templateText(separators[0]) || "\n",
    );
  } else {
    // Items the section's snippet cannot set as the upload did: the whole list in the extras, for
    // the checks' reason, or its first locked item's.
    const why = decided ?? ctx.fields.slice(snapshot.fields).find((field) => field.reason)?.reason;
    ctx.fields.length = snapshot.fields;
    ctx.locked.length = snapshot.locked;
    keepPart(
      ctx,
      {
        at: `b${node.start}`,
        node: owner,
        key: "items",
        kind: "list",
        reason: why ?? "shape",
        words,
      },
      span,
    );
  }
  return {
    kind,
    frame: `{{#items}}${frame}{{/items}}{{&x.items}}`,
    proposal,
    build: (section) =>
      kind === "labelled"
        ? {
            ...section,
            kind: "labelled",
            items: ok
              ? items.map((item) => ({ id: item.id, label: item.label ?? "", text: item.text }))
              : [],
          }
        : {
            ...section,
            kind: "list",
            items: ok ? items.map((item) => ({ id: item.id, text: item.text })) : [],
          },
    locked: !ok,
    span,
    end,
    words,
    ...(ok ? {} : { kept: ["items"] }),
  };
}

/**
 * The paragraph a section holds from `i`: one paragraph of rich text, or an environment the answer
 * says sets a paragraph holding one.
 */
function paragraphAt(
  ctx: Context,
  nodes: readonly Node[],
  i: number,
  role: SectionRole,
  owner: string,
): Content | undefined {
  const node = nodes[i];
  if (node === undefined) return undefined;
  let text: TextNode | undefined;
  let open: Span;
  let close: Span;
  if (node.kind === "text" && !isBlankText(node)) {
    text = node;
    open = { start: node.start, end: node.start };
    close = { start: node.end, end: node.end };
  } else if (
    node.kind === "environment" &&
    environmentAnswer(ctx.answers, node.name)?.kind === "paragraph"
  ) {
    const inner = meaningful(node.content);
    if (inner.length !== 1 || inner[0]?.kind !== "text") return undefined;
    text = inner[0];
    open = { start: node.start, end: text.start };
    close = { start: text.end, end: node.end };
  } else return undefined;
  const template = new Template();
  const span = tightened(ctx.source, text);
  template.text(ctx.source.slice(open.end, span.start));
  const placed = putField(ctx, template, {
    where: "b",
    content: [text],
    span,
    original: { start: node.start, end: node.end },
    slot: "text",
    key: "text",
    slotKey: `standard|paragraph|${role}`,
    type: "rich",
    holder: "section",
    node: owner,
    field: `${owner}.text`,
    candidate: "paragraph",
  });
  template.code(placed.slot);
  template.text(ctx.source.slice(span.end, close.start));
  const value = template.values.text;
  return {
    kind: "paragraph",
    frame: `{{#text}}${templateText(ctx.source.slice(open.start, open.end))}${template.snippet()}${templateText(ctx.source.slice(close.start, close.end))}{{/text}}{{&x.text}}`,
    proposal: new Map(),
    build: (section) => ({
      ...section,
      kind: "paragraph",
      text: Array.isArray(value) ? (value as RichText) : [],
      ...(placed.bytes === "" ? {} : { extras: { ...(section.extras ?? {}), text: placed.bytes } }),
    }),
    locked: false,
    span: { start: node.start, end: node.end },
    end: i + 1,
    words: wordsOf([node]),
    ...(placed.set ? {} : { kept: ["text"] }),
  };
}

/** The frame a kind's content goes in when no section of a role shows one: plain LaTeX. */
const GENERIC_FRAMES: Readonly<Record<SectionKind, string>> = {
  entries: "{{#entries}}\n{{entries}}\n{{/entries}}{{&x.entries}}",
  list: "{{#items}}\n\\begin{itemize}\n{{items}}\n\\end{itemize}\n{{/items}}{{&x.items}}",
  labelled: "{{#items}}\n\\begin{itemize}\n{{items}}\n\\end{itemize}\n{{/items}}{{&x.items}}",
  paragraph: "{{#text}}\n{{text}}\\par\n{{/text}}{{&x.text}}",
};

/** The snippets a unit kind takes when no unit of the document shows its own: plain LaTeX. */
const GENERIC_UNITS = {
  entry:
    "\\par\\noindent{{title}}{{#subtitle}}, {{subtitle}}{{/subtitle}}{{#place}}, {{place}}{{/place}}{{#dates}} \\hfill {{dates}}{{/dates}}\\par\n{{#bullets}}\n\\begin{itemize}\n{{bullets}}\n\\end{itemize}\n{{/bullets}}",
  bullet: "\\item {{text}}",
  item: "\\item {{text}}",
  labelledItem: "\\item {{#label}}\\textbf{{{label}}}: {{/label}}{{text}}",
  head: "\\section*{{{title}}}",
} as const;

/** A section read from its head, where its content ends, and the loose nodes after it. */
interface SectionOut {
  section: Section;
  proposal: Proposal;
  /** Where its head and content end in the source. */
  end: number;
  /** The nodes after its content, up to the next head, which stand as locked sections. */
  rest: Node[];
}

/**
 * A section from its head at `i` up to the next head at `next`: the head's call, its title a
 * field; what stands between the head and the content, kept in the section's extras (`before`);
 * then its content, entries, items or a paragraph, the first that starts there or after; and what
 * is left after the content, which the caller keeps as locked sections. A section whose snippets do
 * not fit those of its kind and role already taken is none: the caller keeps the whole as a locked
 * section.
 */
function sectionAt(
  ctx: Context,
  registry: Registry,
  nodes: readonly Node[],
  i: number,
  next: number,
): SectionOut | undefined {
  const head = nodes[i] as SectionNode | CallNode;
  const id = ctx.ids.id("sec", `b${head.start}`);
  const snapshot = { fields: ctx.fields.length, locked: ctx.locked.length };
  const answer = head.kind === "call" ? commandAnswer(ctx.answers, head.name) : undefined;
  const titleIndex =
    head.kind === "section"
      ? head.args.length
      : (answer?.arguments.find((arg) => arg.slot === "title")?.index ?? 0);
  const titleArg = head.args[titleIndex - 1];
  const titleText = titleArg?.content === undefined ? undefined : readText(titleArg.content);
  const title = titleText?.ok && typeof titleText.value === "string" ? titleText.value : "";
  // The role its content's answers name, a projects heading's or an awards table's, else its title's.
  let hinted: SectionRole | undefined;
  for (const node of everyNode(nodes.slice(i + 1, next))) {
    const found =
      node.kind === "call"
        ? commandAnswer(ctx.answers, node.name)
        : node.kind === "environment"
          ? environmentAnswer(ctx.answers, node.name)
          : undefined;
    if (found?.role !== undefined) {
      hinted = found.role;
      break;
    }
  }
  const role = roleOf(title, hinted);
  const headTemplate = new Template();
  const headOk = callTemplate(ctx, headTemplate, head, {
    where: "b",
    answer:
      head.kind === "section"
        ? {
            kind: "section",
            repeatable: true,
            arguments: [{ index: head.args.length, meaning: "title", slot: "title" }],
          }
        : answer,
    slots: { title: { slot: "title", type: "text" } },
    holder: "section",
    node: id,
    fieldOf: (slot) => `${id}.${slot}`,
    candidate: head.kind === "section" ? "section" : "argument",
  });
  if (!headOk) {
    ctx.fields.length = snapshot.fields;
    ctx.locked.length = snapshot.locked;
    return undefined;
  }
  // The content: the first structure that starts after the head, what stands before it kept.
  let content: Content | undefined;
  /** Where the content starts among the nodes, once it is found. */
  let contentAt = -1;
  for (let k = nextNonBlank(nodes, i + 1); k < next && content === undefined; k++) {
    content =
      entriesAt(ctx, nodes.slice(0, next), k, role, id) ??
      itemsAt(ctx, nodes.slice(0, next), k, role, id) ??
      paragraphAt(ctx, nodes.slice(0, next), k, role, id);
    if (content !== undefined) {
      const before = ctx.source.slice(head.end, (nodes[k] as Node).start);
      if (!isKept(before)) content = undefined;
      else if (content !== undefined) {
        contentAt = k;
        content = { ...content, span: { start: (nodes[k] as Node).start, end: content.span.end } };
        if (before !== "") headTemplate.values.before = before;
        const words = wordsOf(nodes.slice(i + 1, k));
        if (words > 0)
          keepPart(
            ctx,
            {
              at: `b${(nodes[i + 1] as Node).start}`,
              node: id,
              key: "before",
              kind: "section",
              reason: "unmapped",
              words,
            },
            { start: head.end, end: (nodes[k] as Node).start },
          );
      }
    }
  }
  const kind: SectionKind = content?.kind ?? "entries";
  const proposal: Proposal = new Map(content?.proposal ?? []);
  proposal.set(`head:${kind}:${role}`, headTemplate.snippet());
  if (content !== undefined) proposal.set(`frame:${kind}:${role}`, content.frame);
  if (!registry.fits(proposal)) {
    ctx.fields.length = snapshot.fields;
    ctx.locked.length = snapshot.locked;
    return undefined;
  }
  registry.add(proposal);
  registry.addDefaults(`section:${role}`, headTemplate.defaults);
  if (content?.kind === "entries") registry.addDefaults(`entry:${role}`, content.defaults);
  const extras: Record<string, string> = { ...headTemplate.extras };
  if (typeof headTemplate.values.before === "string") extras.before = headTemplate.values.before;
  const base = {
    id,
    title: typeof headTemplate.values.title === "string" ? headTemplate.values.title : "",
    role,
    ...(Object.keys(extras).length === 0 ? {} : { extras }),
  };
  const section: Section =
    content === undefined ? { ...base, kind: "entries", entries: [] } : content.build(base);
  // A content kept whole in the extras, its units not fitting their snippets.
  if (content?.locked === true) {
    const key = kind === "paragraph" ? "text" : kind === "entries" ? "entries" : "items";
    section.extras = {
      ...(section.extras ?? {}),
      [key]: ctx.source.slice(content.span.start, content.span.end),
    };
  }
  // What the section keeps as the upload had it, its title or its content, is no field of it.
  if (section.kind !== "locked") {
    const kept = keptOf(
      new Set([...headTemplate.kept, ...(content?.kept ?? [])]),
      SECTION_KEPT[section.kind],
    );
    if (kept !== undefined) section.kept = kept as typeof section.kept;
  }
  const end = content === undefined ? i + 1 : content.end;
  // A list the section opens between its head and its content, as a Jake fork opens its skills'
  // items with its entries' opener, closes after its content, and its closer would stand in the
  // locked section that follows: removing the section would take the opener and leave the closer,
  // which stops the compile. So the section keeps what stands after its content up to that closer
  // as its own, in its extras (`after`), and the two are removed and moved as one (decision 0038).
  let last = end;
  const closes = contentAt < 0 ? -1 : lastCloser(ctx, nodes.slice(0, next), i + 1, contentAt, end);
  if (closes >= 0) {
    const after = ctx.source.slice((nodes[end - 1] as Node).end, (nodes[closes] as Node).end);
    if (isKept(after)) {
      section.extras = { ...(section.extras ?? {}), after };
      const run = nodes.slice(end, closes + 1);
      const words = wordsOf(run);
      const first = run.find((node) => !isBlankText(node)) ?? (nodes[closes] as Node);
      if (words > 0)
        keepPart(
          ctx,
          {
            at: `b${first.start}`,
            node: id,
            key: "after",
            kind: "section",
            reason: "unmapped",
            words,
          },
          { start: (nodes[end - 1] as Node).end, end: (nodes[closes] as Node).end },
        );
      last = closes + 1;
    }
  }
  return {
    section,
    proposal,
    end: (nodes[last - 1] as Node).end,
    rest: nodes.slice(last, next).filter((node) => !isBlankText(node)),
  };
}

/**
 * Where, among `nodes`, the last closer stands of the lists the nodes from `from` to before
 * `until` open and do not close before `beyond`: a call the answer says opens a list, whose closer
 * comes at or after `beyond`; or -1 when none does (decision 0038). What stands between a
 * section's head and its content, and the sections' region, each ask it of the lists they open.
 */
function lastCloser(
  ctx: Context,
  nodes: readonly Node[],
  from: number,
  until: number,
  beyond: number,
): number {
  let found = -1;
  for (let o = from; o < until; o++) {
    const node = nodes[o];
    if (node?.kind !== "call") continue;
    const list = commandAnswer(ctx.answers, node.name)?.list;
    if (list?.does !== "opens") continue;
    const j = closerOf(nodes, o, list.closedBy);
    if (j >= beyond) found = Math.max(found, j);
  }
  return found;
}

// The document.

/** What the body's layout gives: the document snippet, the header's snippet and model, the sections. */
interface BodyOut {
  document: string;
  header: HeaderOut;
  sections: Section[];
  separator: string;
  registry: Registry;
}

/**
 * The nodes that hold the sections: the body's top level, or the one environment or block there
 * whose content holds every head, as AltaCV's `paracol` does; with the heads' level.
 */
function containerOf(ctx: Context): { nodes: readonly Node[]; node?: Node; level: number } {
  const top = ctx.tree.content;
  const level = headLevel(top);
  if (top.some((node) => isHead(ctx, node, level))) return { nodes: top, level };
  const holders = top.filter(
    (node) =>
      (node.kind === "environment" || node.kind === "block") &&
      node.content.some((each) => isHead(ctx, each, headLevel(node.content))),
  );
  const [holder] = holders;
  if (holders.length !== 1 || holder === undefined || !("content" in holder))
    return { nodes: top, level };
  // Beside the container, nothing but the template's code and the header's calls, which a
  // snippet sets around `{{sections}}`; anything else and the top level holds the sections.
  const isHeaderCall = (node: Node) => {
    const kind = node.kind === "call" ? commandAnswer(ctx.answers, node.name)?.kind : undefined;
    return kind !== undefined && HEADER_KINDS.has(kind) && !isCode(ctx, node);
  };
  const at = top.indexOf(holder);
  const first = top.findIndex(isHeaderCall);
  const last = top.length - 1 - [...top].reverse().findIndex(isHeaderCall);
  const beside = top.every((node, i) => {
    if (node === holder || isCode(ctx, node)) return true;
    // What the header's region takes: from before its first call to its last, before the container.
    return first >= 0 && i <= last && last < at;
  });
  if (!beside) return { nodes: top, level };
  const content = (holder as EnvironmentNode).content;
  return { nodes: content, node: holder, level: headLevel(content) };
}

/**
 * The document's layout: `{{header}}` where the header's calls are, or before `\begin{document}`
 * for the preamble's; the sections' region, from the first node after the header that is not the
 * template's code to the last, in their container, as `{{sections}}`; and the template's code
 * around them as it stands. Each section read from its head (`sectionAt`); anything else in the
 * region a locked section where it stands, the nodes between two sections one, or kept in the
 * extras of the section before it where `\rtlocked` cannot take it (`asLocked`).
 */
function bodyOf_(ctx: Context): BodyOut | Refusal {
  const registry = new Registry();
  const { nodes: held, node: container, level } = containerOf(ctx);
  const top = ctx.tree.content;
  const source = ctx.source;
  const headerSetters = ctx.preamble.setters.filter((call) => {
    const kind = commandAnswer(ctx.answers, call.name)?.kind;
    return kind !== undefined && (HEADER_KINDS.has(kind) || kind === "other");
  });
  const inPreamble = headerSetters.length > 0;

  // The header's region in the body: from its first call to its last, before the sections.
  const firstHead = held.findIndex((node) => isHead(ctx, node, level));
  const containerAt = container === undefined ? -1 : top.indexOf(container);
  const limit = containerAt >= 0 ? containerAt : firstHead < 0 ? top.length : firstHead;
  let regionFrom = -1;
  let regionTo = -1;
  if (!inPreamble)
    for (let i = 0; i < limit; i++) {
      const node = top[i] as Node;
      const kind = node.kind === "call" ? commandAnswer(ctx.answers, node.name)?.kind : undefined;
      if (kind !== undefined && HEADER_KINDS.has(kind) && !isCode(ctx, node)) {
        if (regionFrom < 0) regionFrom = i;
        regionTo = i;
      }
    }
  // What stands before the header's calls, not the template's code, is the header's too.
  if (regionFrom > 0)
    for (let i = 0; i < regionFrom; i++)
      if (!isCode(ctx, top[i] as Node)) {
        regionFrom = i;
        break;
      }
  const region = regionFrom < 0 ? undefined : top.slice(regionFrom, regionTo + 1);
  const header = headerOf(ctx, headerSetters, region);

  // The sections' region, in the container: its first and last nodes that are not code.
  const skip = (node: Node) =>
    container === undefined && region !== undefined && region.includes(node);
  const inRegion = held.filter((node) => !skip(node));
  let from = inRegion.findIndex((node) => !isCode(ctx, node));
  let to = inRegion.length - 1;
  while (to >= 0 && isCode(ctx, inRegion[to] as Node)) to--;
  if (from < 0) from = inRegion.length;
  // A list the region opens and the template's code after it closes, as the entries' list a Jake
  // fork's last section opens and `\resumeSubHeadingListEnd` after it closes, is the last unit's:
  // the region runs to its closer, so that the unit keeps the closer and goes with it, as one
  // before another section does, where the closer left in the document snippet stopped the compile
  // once the unit was removed (decision 0038).
  const closes = lastCloser(ctx, inRegion, from, to + 1, to + 1);
  if (closes >= 0) to = closes;
  const units = inRegion.slice(from, to + 1);

  // The sections and the locked parts between them, and the gaps between them all.
  // Each section keeps the gap before it, as the upload has it, in its extras (`lead`), and a
  // locked one in its LaTeX, so that the sections' separator is nothing and every gap, a space or
  // a paragraph's end, stays as TeX read it: the first's is the document snippet's.
  const sections: Section[] = [];
  let lastEnd: number | undefined;
  // After a locked part that ends in a control word, TeX skipped the spaces and the line's end
  // that followed it, which after `\rtlocked`'s closing brace it would read: the gap drops its
  // spaces and comments out its line's end.
  let afterWord = false;
  const leadOf = (start: number) => {
    const gap = lastEnd === undefined ? "" : source.slice(lastEnd, start);
    if (!afterWord) return gap;
    afterWord = false;
    const spaces = gap.replace(/^[ \t]+/, "");
    return /^\r?\n/.test(spaces) ? `%${spaces}` : spaces;
  };
  const place = (section: Section, start: number, end: number) => {
    const lead = leadOf(start);
    if (lead !== "" && section.kind !== "locked")
      section.extras = { lead, ...(section.extras ?? {}) };
    sections.push(section);
    lastEnd = end;
  };
  const lockRun = (run: readonly Node[]): Refusal | undefined => {
    const first = run[0];
    const last = run.at(-1);
    if (first === undefined || last === undefined) return undefined;
    const latex = source.slice(first.start, last.end);
    const kept = asLocked(`${leadOf(first.start)}${latex}`);
    const words = wordsOf(run);
    const word = kept !== undefined && endsInControlWord(kept);
    const locked = kept === undefined ? undefined : word ? kept : `${kept}%`;
    // `\rtlocked` takes the part as an argument, where every `%` is a comment (`LockedLatex`).
    if (locked !== undefined && LockedLatex.safeParse(locked).success) {
      const id = ctx.ids.id("lock", `b${first.start}`);
      sections.push({
        kind: "locked",
        id,
        title: "",
        role: "other",
        latex: locked,
      });
      lastEnd = last.end;
      afterWord = word;
      if (words > 0)
        keepPart(
          ctx,
          { at: `b${first.start}`, node: id, kind: "section", reason: "unmapped", words },
          { start: first.start, end: last.end },
        );
      return undefined;
    }
    // What `\rtlocked` cannot take stays in the extras of the section before it, where it is
    // written as it stands, outside any argument.
    const previous = sections.at(-1);
    if (previous === undefined || previous.kind === "locked" || !isKept(latex))
      return refusal("keep");
    previous.extras = {
      ...(previous.extras ?? {}),
      after: `${previous.extras?.after ?? ""}${source.slice(lastEnd ?? first.start, last.end)}`,
    };
    lastEnd = last.end;
    if (words > 0)
      keepPart(
        ctx,
        {
          at: `b${first.start}`,
          node: previous.id,
          key: "after",
          kind: "section",
          reason: "unmapped",
          words,
        },
        { start: first.start, end: last.end },
      );
    return undefined;
  };
  let run: Node[] = [];
  const flush = (): Refusal | undefined => {
    const refused = lockRun(run);
    run = [];
    return refused;
  };
  for (let i = 0; i < units.length; ) {
    const node = units[i] as Node;
    if (!isHead(ctx, node, level)) {
      if (!isBlankText(node)) run.push(node);
      i++;
      continue;
    }
    const refused = flush();
    if (refused !== undefined) return refused;
    let next = i + 1;
    while (next < units.length && !isHead(ctx, units[next] as Node, level)) next++;
    const read = sectionAt(ctx, registry, units, i, next);
    if (read === undefined) {
      // A section its kind's snippets cannot set as the upload did: locked whole.
      run = units.slice(i, next).filter((each) => !isBlankText(each));
      const locked = flush();
      if (locked !== undefined) return locked;
    } else {
      place(read.section, node.start, read.end);
      run = [...read.rest];
      const refused2 = flush();
      if (refused2 !== undefined) return refused2;
    }
    i = next;
  }
  const refused = flush();
  if (refused !== undefined) return refused;

  const separator = "";

  // The document snippet: the body's code around the header and the sections.
  const document = new Template();
  if (inPreamble) document.code("{{header}}\n");
  document.code("\\begin{document}");
  let at = ctx.tree.start;
  const firstUnit = units[0];
  const lastUnit = units.at(-1);
  const put = (node: Node) => {
    document.text(source.slice(at, node.start));
    at = node.end;
  };
  let headerPut = inPreamble;
  const sectionsAt = (open: number, close: number) => {
    if (!headerPut) {
      document.code("{{header}}");
      headerPut = true;
    }
    document.text(source.slice(at, open));
    // After a last locked part that ends in a control word, as between two sections (`leadOf`).
    document.code(
      afterWord && /^[ \t]*\r?\n/.test(source.slice(close)) ? "{{sections}}%" : "{{sections}}",
    );
    at = close;
  };
  const walkCode = (list: readonly Node[], closeAt?: number) => {
    for (const node of list) {
      if (region?.[0] === node) {
        document.text(source.slice(at, node.start));
        document.code("{{header}}");
        headerPut = true;
        at = (region.at(-1) as Node).end;
        continue;
      }
      if (region?.includes(node)) continue;
      if (node === container && container !== undefined) {
        put(node);
        at = node.start;
        const inner = (container as EnvironmentNode).content;
        const open = firstUnit?.start ?? inner[0]?.start ?? container.end;
        const beforeUnits = inner.filter((each) => each.end <= open);
        for (const each of beforeUnits) {
          document.text(source.slice(at, each.start));
          document.text(source.slice(each.start, each.end));
          at = each.end;
        }
        if (firstUnit !== undefined && lastUnit !== undefined)
          sectionsAt(firstUnit.start, lastUnit.end);
        for (const each of inner.filter((one) => one.start >= (lastUnit?.end ?? open))) {
          document.text(source.slice(at, each.start));
          document.text(source.slice(each.start, each.end));
          at = each.end;
        }
        document.text(source.slice(at, container.end));
        at = container.end;
        continue;
      }
      if (container === undefined && node === firstUnit && lastUnit !== undefined) {
        sectionsAt(node.start, lastUnit.end);
        continue;
      }
      if (container === undefined && units.includes(node)) continue;
      document.text(source.slice(at, node.start));
      document.text(source.slice(node.start, node.end));
      at = node.end;
    }
    if (closeAt !== undefined) document.text(source.slice(at, closeAt));
  };
  walkCode(top, ctx.tree.end);
  if (!headerPut) document.code("{{header}}");
  if (units.length === 0) document.code("{{sections}}");
  document.code("\\end{document}");
  return { document: document.snippet(), header, sections, separator, registry };
}

// The package.

/** The families' names as a package's name shows them. */
const FAMILY_NAMES: Readonly<Record<string, string>> = {
  jake: "Jake's Resume",
  "awesome-cv": "Awesome-CV",
  altacv: "AltaCV",
  moderncv: "moderncv",
  europecv: "europecv",
};

/** The extensions of the upload's text files a package keeps: classes, styles and their kin. */
const PACKAGE_FILES = [".cls", ".sty", ".clo", ".def", ".fd", ".cfg"];

/**
 * The preamble's text with its comments blanked, each character a space, so that a setting read
 * from it stands where it stands in the preamble.
 */
const settingsText = (preamble: string) =>
  preamble.replace(
    /(^|[^\\])((?:\\\\)*)(%.*)$/gm,
    (_, before: string, slashes: string, comment: string) =>
      `${before}${slashes}${" ".repeat(comment.length)}`,
  );

/** An edit of the preamble: the span it replaces, and the text in its place, a snippet's already. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * Where the font size control sets the class's size in `\documentclass` (decision 0040): its size
 * option, `11pt` or `10.5pt`, whose place the control's slot takes, with the size it names; or,
 * where its options name no size, the place the slot goes, first among them, in brackets of its own
 * where the class is given none. Undefined for a preamble with no `\documentclass`.
 */
function sizePlace(preamble: string): { edit: Edit; named?: number } | undefined {
  const text = settingsText(preamble);
  const found = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{/.exec(text);
  if (found === null) return undefined;
  const options = found[1];
  if (options === undefined) {
    const at = found.index + "\\documentclass".length;
    return { edit: { start: at, end: at, text: "[{{fontSize}}pt]" } };
  }
  const optionsAt = found.index + found[0].indexOf("[") + 1;
  const option = /(^|,)(\s*)((\d+(?:\.\d+)?)pt)\s*(?=,|$)/.exec(options);
  if (option === null)
    return {
      edit: {
        start: optionsAt,
        end: optionsAt,
        text: options.trim() === "" ? "{{fontSize}}pt" : "{{fontSize}}pt,",
      },
    };
  const start = optionsAt + option.index + (option[1] ?? "").length + (option[2] ?? "").length;
  const named = option[3] ?? "";
  return {
    edit: { start, end: start + named.length, text: "{{fontSize}}pt" },
    named: Number(option[4]),
  };
}

/**
 * The names the signatures step is asked of for the sizes a class declares (decision 0026): LaTeX
 * keeps a class option's code as `\ds@<option>`, which the engine finds defined for a size the
 * class, or a class it passes its options to, declares, and undefined for one it would ignore, as
 * `article` ignores 10.5pt with a warning. From 8 to 14 points in half points; the font size
 * control offers those from 9 to 12.
 */
export const SIZE_OPTIONS: readonly string[] = Array.from(
  { length: 13 },
  (_, i) => `ds@${8 + i / 2}pt`,
);

/**
 * The sizes the font size control may offer, 9 to 12 points in half points, that the class
 * declares, as the signatures step found `\ds@<size>pt` defined (`SIZE_OPTIONS`), since a size the
 * class does not declare sets its own default size; and where the step was not asked of them,
 * `article`'s three, 10, 11 and 12, which the fourth check holds to the page as any (decision 0040).
 */
function offeredSizes(found: EngineSignatures): number[] {
  if (!SIZE_OPTIONS.some((name) => Object.hasOwn(found.commands, name))) return [10, 11, 12];
  const sizes: number[] = [];
  for (let size = 9; size <= 12; size += 0.5) {
    const name = `ds@${size}pt`;
    const signature = Object.hasOwn(found.commands, name) ? found.commands[name] : undefined;
    if (signature !== undefined && signature.kind !== "undefined") sizes.push(size);
  }
  return sizes;
}

/**
 * The document's own size among those the control offers (decision 0040): the size the engine
 * found the class set (`Layout.size`), the one whose normal size is within a tenth of a point of
 * it, as `11pt` sets 10.95, whatever the class's options name, since the page is set at that size
 * where the two disagree, as a class that ignores the size it is given sets another; and none where
 * the class declares no such size, since the control's default would then set another page. Where
 * the engine found no layout, the size the options name, where the class declares it.
 */
function ownSize(
  named: number | undefined,
  layout: Layout | undefined,
  sizes: readonly number[],
): number | undefined {
  if (layout !== undefined) return sizes.find((size) => Math.abs(size - layout.size) < 0.1);
  return named !== undefined && sizes.includes(named) ? named : undefined;
}

/** TeX's points to the inch. */
const POINTS_PER_INCH = 72.27;

/** A margin or a size as the generator renders a control's value: to the tenth, `0.5`, `1`. */
const shownValue = (value: number) => String(Math.round(value * 10) / 10);

/**
 * The margins control's default (decision 0040): the document's own left margin, as the engine
 * found it at `\begin{document}` (`Layout.left`), or where it found none, the one margin geometry's
 * options give; to the nearest tenth of an inch the control offers, from 0.4 to 1. None where
 * neither says, as for an import whose signatures were made by hand.
 */
function ownMargin(layout: Layout | undefined, preamble: string): number | undefined {
  const geometry = geometryOptions(preamble);
  const given =
    layout === undefined
      ? (inches(geometry?.get("margin")) ??
        inches(geometry?.get("left")) ??
        inches(geometry?.get("lmargin")))
      : layout.left / POINTS_PER_INCH;
  if (given === undefined || !Number.isFinite(given)) return undefined;
  return Math.min(1, Math.max(0.4, Math.round(given * 10) / 10));
}

/**
 * What geometry is told besides a page's margins, so that it sets the text block where they say:
 * no `\\hoffset` or `\\voffset`, which a document may place its page with and geometry would
 * count once more, as `\\oddsidemargin` is the left margin less an inch and the offsets; head,
 * foot and marginal notes outside the body; no binding offset; and the text's height as the margins
 * leave it, not rounded to its lines (decision 0040).
 */
const GEOMETRY_RESETS = "hoffset=0pt,voffset=0pt,ignoreall,bindingoffset=0pt,heightrounded=false";

/**
 * The margins control's snippet (decision 0040), in the body's preamble region: nothing at the
 * document's own value, `own`, which TeX compares the value with, so that the unchanged control is
 * the original to the byte whatever margins the document has, geometry's or the class's; at any
 * other, one margin on every side of the text block, reissued to geometry where the class or the
 * preamble loaded it, after the document's own, and geometry loaded with it where nothing did,
 * with what else geometry must be told to set it (`GEOMETRY_RESETS`). The space after the
 * comparison ends its dimension, so that TeX does not expand what follows looking for one, and the
 * branch taken runs outside the conditional, as a package loaded inside one might not.
 */
export function marginsSnippet(own: number): string {
  const options = `margin={{value}}in,${GEOMETRY_RESETS}`;
  return [
    `\\ifdim{{value}}in=${shownValue(own)}in `,
    "\\expandafter\\csname @gobble\\expandafter\\endcsname",
    "\\else\\expandafter\\csname @firstofone\\expandafter\\endcsname\\fi",
    "{\\csname @ifpackageloaded\\endcsname{geometry}",
    `{\\geometry{${options}}}{\\usepackage[${options}]{geometry}}}`,
  ].join("");
}

/**
 * The page size control's snippet for the paper the document is not on (decision 0040), in the
 * body's preamble region: the margins the document has, each side's of its text block and its
 * head's and foot's, measured as TeX finds them there, then given to geometry with the paper,
 * reissued where the class or the preamble loaded it and loaded with them where nothing did, with
 * what else geometry must be told to set them (`GEOMETRY_RESETS`); so that the text keeps its own
 * margins on the other paper, where geometry's own layout, or the options it was given before a
 * document adjusted its page by hand, would set others.
 */
export function pageSizeSnippet(paper: "letter" | "a4"): string {
  const margins = [
    "left=\\the\\dimexpr1in+\\hoffset+\\oddsidemargin\\relax",
    "right=\\the\\dimexpr\\paperwidth-1in-\\hoffset-\\oddsidemargin-\\textwidth\\relax",
    "top=\\the\\dimexpr1in+\\voffset+\\topmargin+\\headheight+\\headsep\\relax",
    "bottom=\\the\\dimexpr\\paperheight-1in-\\voffset-\\topmargin-\\headheight-\\headsep-\\textheight\\relax",
    "headheight=\\the\\headheight",
    "headsep=\\the\\headsep",
    "footskip=\\the\\footskip",
    GEOMETRY_RESETS,
  ].join(",");
  return [
    `\\xdef\\rtimportlayout{${margins}}`,
    "\\csname @ifpackageloaded\\endcsname{geometry}",
    `{\\expandafter\\geometry\\expandafter{\\rtimportlayout,${paper}paper}}`,
    `{\\expandafter\\usepackage\\expandafter[\\rtimportlayout,${paper}paper]{geometry}}`,
  ].join("");
}

/** The keys and values of a key-value list, as geometry's options give them. */
function keyValues(list: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of list.split(",")) {
    const [key, ...rest] = part.split("=");
    const name = key?.trim();
    if (name) values.set(name, rest.join("=").trim());
  }
  return values;
}

/** geometry's options in the preamble, all of them, the package's and `\geometry`'s. */
function geometryOptions(preamble: string): Map<string, string> | undefined {
  const text = settingsText(preamble);
  let found = false;
  const options = new Map<string, string>();
  for (const match of text.matchAll(/\\usepackage\s*(?:\[([^\]]*)\])?\s*\{geometry\}/g)) {
    found = true;
    for (const [key, value] of keyValues(match[1] ?? "")) options.set(key, value);
  }
  for (const match of text.matchAll(/\\(?:geometry|newgeometry)\s*\{([^}]*)\}/g)) {
    found = true;
    for (const [key, value] of keyValues(match[1] ?? "")) options.set(key, value);
  }
  return found ? options : undefined;
}

/** A length as inches, from a value geometry takes: `0.5in`, `1.27cm`, `12.7mm`, `36pt`. */
function inches(value: string | undefined): number | undefined {
  const found = /^\s*(\d*\.?\d+)\s*(in|cm|mm|pt|bp)\s*$/.exec(value ?? "");
  if (found === null) return undefined;
  const number = Number(found[1]);
  const per: Record<string, number> = {
    in: 1,
    cm: 1 / 2.54,
    mm: 1 / 25.4,
    pt: 1 / 72.27,
    bp: 1 / 72,
  };
  return number * (per[found[2] ?? ""] ?? Number.NaN);
}

/** The page size a document has: its class's or geometry's paper, or its reference's size. */
function paperOf(preamble: string, made: Reference): "letter" | "a4" | undefined {
  const words = new Set([
    ...classOptions(preamble),
    ...[...(geometryOptions(preamble)?.keys() ?? [])],
    ...[...(geometryOptions(preamble)?.entries() ?? [])].flatMap(([key, value]) =>
      key === "paper" || key === "papername" ? [value] : [],
    ),
  ]);
  if (words.has("a4paper")) return "a4";
  if (words.has("letterpaper")) return "letter";
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  if (near(made.size.width, 614.295) && near(made.size.height, 794.97)) return "letter";
  if (near(made.size.width, 597.50787) && near(made.size.height, 845.04684)) return "a4";
  return undefined;
}

/**
 * The generic controls and those the answer's preamble parameters give, with their defaults, and
 * where the font size control's slot goes in the preamble (decision 0040). The page size and the
 * margins go through geometry in the body's preamble region, geometry loaded there where nothing
 * loaded it and reissued where the class or the preamble did, each at the document's own value
 * setting nothing, so that the unchanged control is the original to the byte; the font size is the
 * class's option, format-bound (decision 0006), at the sizes the class declares.
 */
function controlsOf(
  ctx: Context,
  preamble: string,
  answer: NamingAnswer,
): { controls: TemplatePackage["controls"]; size?: Edit } {
  // The date format, where a date with a month is set from the model: a document whose dates are
  // kept as the upload wrote them, or are years alone, has none the control could change.
  const controls: TemplatePackage["controls"] = ctx.monthly
    ? { dateFormat: { default: ctx.dateFormat } }
    : {};
  const dropped = new Set(ctx.decisions.controls);
  const paper = paperOf(preamble, ctx.made);
  if (paper !== undefined && !dropped.has("pageSize")) {
    const other = paper === "letter" ? "a4" : "letter";
    controls.pageSize = {
      default: paper,
      apply: { [paper]: "", [other]: pageSizeSnippet(other) } as Record<"letter" | "a4", string>,
    };
  }
  // Every document has margins, the class's where nothing else sets them: the control starts at
  // the document's own, which it leaves as they are, and sets one margin on every side at any other.
  const margin = ownMargin(ctx.found.layout, preamble);
  if (margin !== undefined && !dropped.has("margins"))
    controls.margins = { default: margin, apply: marginsSnippet(margin) };
  // The class's size option, where it names one the class declares, or the document's own size
  // among them where it names none, or one the class ignores: with every other size the class
  // declares. A class declaring none, or not the document's size, offers no control, since the
  // page would not follow it; nor does one declaring the document's size alone, which leaves
  // nothing to choose. Whether the page follows the option at all, the fourth check proves.
  const place = sizePlace(preamble);
  const sizes = place === undefined ? [] : offeredSizes(ctx.found);
  const own = place === undefined ? undefined : ownSize(place.named, ctx.found.layout, sizes);
  if (own !== undefined && sizes.length > 1 && !dropped.has("fontSize"))
    controls.fontSize = { default: own, apply: "", format: true, sizes };
  for (const parameter of answer.preamble.parameters) {
    if (dropped.has(parameter.parameter as ControlName)) continue;
    const text = settingsText(preamble);
    if (
      parameter.parameter === "accent" &&
      parameter.key !== undefined &&
      controls.accent === undefined
    ) {
      const hex = colourOf(text, parameter.key);
      if (hex !== undefined)
        controls.accent = {
          default: hex,
          apply: `\\definecolor{${snippetText(parameter.key)}}{HTML}{{{value}}}`,
        };
    }
    if (parameter.parameter === "density" && controls.density === undefined) {
      const spread = /\\linespread\s*\{\s*(\d*\.?\d+)\s*\}/.exec(text);
      const factor = spread === null ? 1 : Number(spread[1]);
      const scaled = (by: number) =>
        `\\linespread{${Math.round(factor * by * 1000) / 1000}}\\selectfont`;
      if (parameter.command === "linespread" && factor > 0)
        controls.density = {
          default: "normal",
          apply: { compact: scaled(0.9), normal: "", relaxed: scaled(1.1) },
        };
    }
    if (parameter.parameter === "font" && controls.font === undefined && ctx.engine === "pdftex")
      controls.font = {
        default: "own",
        choices: [
          { id: "own", name: "As imported", apply: "" },
          {
            id: "charter",
            name: "Charter",
            apply: "\\renewcommand{\\rmdefault}{bch}\\renewcommand{\\familydefault}{\\rmdefault}",
          },
          {
            id: "palatino",
            name: "Palatino",
            apply: "\\renewcommand{\\rmdefault}{ppl}\\renewcommand{\\familydefault}{\\rmdefault}",
          },
          {
            id: "helvetica",
            name: "Helvetica",
            apply: "\\renewcommand{\\sfdefault}{phv}\\renewcommand{\\familydefault}{\\sfdefault}",
          },
        ],
      };
  }
  return {
    controls,
    ...(controls.fontSize === undefined || place === undefined ? {} : { size: place.edit }),
  };
}

/** A colour the preamble defines, as `#RRGGBB`, from xcolor's HTML, RGB, rgb or gray models. */
function colourOf(preamble: string, name: string): string | undefined {
  const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(
    `\\\\definecolor\\s*\\{\\s*${quoted}\\s*\\}\\s*\\{\\s*(\\w+)\\s*\\}\\s*\\{([^}]*)\\}`,
  ).exec(preamble);
  if (found === null) return undefined;
  const model = found[1] ?? "";
  const values = (found[2] ?? "").split(",").map((each) => each.trim());
  const byte = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  if (model === "HTML" && /^[0-9A-Fa-f]{6}$/.test(values[0] ?? ""))
    return `#${(values[0] ?? "").toUpperCase()}`;
  if (model === "RGB" && values.length === 3)
    return `#${values
      .map((v) => byte(Number(v)))
      .join("")
      .toUpperCase()}`;
  if (model === "rgb" && values.length === 3)
    return `#${values
      .map((v) => byte(Number(v) * 255))
      .join("")
      .toUpperCase()}`;
  if (model === "gray" && values.length === 1) {
    const level = byte(Number(values[0]) * 255);
    return `#${level}${level}${level}`.toUpperCase();
  }
  return undefined;
}

/**
 * Whether the document loads hyperref itself, as its reference compile's log shows: in its
 * preamble, or later, as moderncv's class does at the preamble's end, where hyperref loaded by the
 * rewrite first would clash with the options it asks for.
 */
export const loadsHyperref = (made: Pick<Reference, "log">) => /hyperref\.sty/.test(made.log);

/**
 * What the preamble's rewrite does to hyperref, a line before `\documentclass` and one after the
 * preamble: its dvipdfmx driver on pdfTeX, so that xdvipdfmx makes the PDF's links from the DVI
 * (decision 0008), and no bookmarks, whose cost grows with a title's square; and hyperref loaded
 * with `hidelinks` where the document does not load it (`loaded`), so that a link a user types
 * links. The checks compile the original with the same two lines, to tell what they change from
 * what the rest of the rewrite does.
 */
export function hyperrefLines(engine: Engine, loaded: boolean): { before: string; after: string } {
  const options = engine === "pdftex" ? "dvipdfmx,bookmarks=false" : "bookmarks=false";
  return {
    before: `\\PassOptionsToPackage{${options}}{hyperref}`,
    after: loaded
      ? ""
      : "\\csname @ifpackageloaded\\endcsname{hyperref}{}{\\usepackage[hidelinks]{hyperref}}",
  };
}

/**
 * The package's preamble: the document's, the preamble's header calls taken out, the class's size
 * option the font size control's slot, or the slot put first among its options where they name no
 * size (`sizePlace`), the redefinitions after `\documentclass`, hyperref's driver and bookmarks
 * passed before it and hyperref loaded with `hidelinks` where nothing loads it, and `@`'s category
 * where the preamble ends kept for the body, which may rely on `\makeatletter`; every other byte
 * as the document has it, but that a `{{` that would begin a tag is broken.
 */
function preambleText(
  ctx: Context,
  removed: readonly Span[],
  size: Edit | undefined,
  redefinitions: readonly { name: string; latex: string }[],
): { preamble: string; at: boolean } {
  const text = ctx.preamble.text;
  const edits: Edit[] = removed.map((span) => ({ ...span, text: "" }));
  if (size !== undefined) edits.push(size);
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const edit of edits) {
    if (edit.start < at) continue;
    out += snippetText(text.slice(at, edit.start)) + edit.text;
    at = edit.end;
  }
  out += snippetText(text.slice(at));
  const kept = redefinitions.map((each) => ({ name: each.name, latex: snippetText(each.latex) }));
  const redefined = placed(out, kept, ctx.decisions.placement);
  const atLetter = /\\makeatletter(?![A-Za-z])/.test(settingsText(text));
  const hyperref = hyperrefLines(ctx.engine, loadsHyperref(ctx.made));
  const preamble = [
    hyperref.before,
    redefined.replace(/\s*$/, ""),
    ...(hyperref.after === "" ? [] : [hyperref.after]),
    ...(atLetter ? ["\\expandafter\\chardef\\csname import@at\\endcsname=\\catcode`\\@"] : []),
    "",
  ].join("\n");
  return { preamble, at: atLetter };
}

/**
 * A preamble with the redefinitions where `placement` puts them, through `withRedefinitions` as
 * decision 0024 has item 7 put them: right after `\documentclass`, or at the preamble's end, where
 * `\begin{document}` follows it; the preamble as it is when it has no `\documentclass` to put them
 * by.
 */
function placed(
  preamble: string,
  redefinitions: readonly { name: string; latex: string }[],
  placement: "class" | "preamble",
): string {
  if (placement === "class") return withRedefinitions(preamble, redefinitions) ?? preamble;
  const begin = "\\begin{document}";
  const text = `${preamble.replace(/\s*$/, "")}\n${begin}`;
  const put = withRedefinitions(text, redefinitions, { placement });
  return put === undefined ? preamble : put.slice(0, -begin.length);
}

/** The upload's files a package keeps, as text: its classes and styles, and what its preamble inputs. */
function filesOf(ctx: Context, rewrite: XetexRewrite | undefined): Record<string, string> {
  const files: Record<string, string> = {};
  const inputs = new Set(
    [...settingsText(ctx.preamble.text).matchAll(/\\(?:input|include)\s*\{([^}]*)\}/g)].map(
      (found) => {
        const name = (found[1] ?? "").trim();
        return extensionOf(name) === "" ? `${name}.tex` : name;
      },
    ),
  );
  for (const [path, bytes] of Object.entries(ctx.intake.files)) {
    if (path.includes("/")) continue;
    if (PACKAGE_FILES.includes(extensionOf(path).toLowerCase()) || inputs.has(path))
      files[path] = decodeText(bytes);
  }
  for (const [path, bytes] of Object.entries(rewrite?.files ?? {}))
    if (!path.includes("/")) files[path] = decodeText(bytes);
  for (const [name, text] of Object.entries(COMPATIBILITY[ctx.engine])) files[name] ??= text;
  return files;
}

/**
 * A snippet that may depend on a section's role, from the registry's snippets under `prefix:<role>`:
 * the same one for every role when they read alike, or the first as the default and a variant for
 * each role whose differs; `generic` when no unit shows one.
 */
function byRole(registry: Registry, prefix: string, generic: string): ByRole<string> {
  const found: [SectionRole, string][] = [];
  for (const [key, snippet] of registry.snippets)
    if (key.startsWith(`${prefix}:`))
      found.push([key.slice(prefix.length + 1) as SectionRole, snippet]);
  const [first] = found;
  if (first === undefined) return generic;
  if (found.every(([, snippet]) => comparable(snippet) === comparable(first[1]))) return first[1];
  const variants: Partial<Record<SectionRole, string>> = {};
  for (const [role, snippet] of found)
    if (comparable(snippet) !== comparable(first[1])) variants[role] = snippet;
  return { default: first[1], ...variants };
}

/**
 * Every entry's snippet with a list for the bullets a user adds (decision 0026). An entry of a role
 * whose upload's entries set no bullets takes the list another role's entries of the same macro
 * set theirs in, with that role's bullet and separator where it has none of its own; else the list
 * the answer pairs, a bullets' opener and its closer, or an environment, that take no argument;
 * else it sets none, and the package says its role's entries take no bullets. Each role's snippet
 * is changed in place in the registry, and the result is whether each role's entries take bullets.
 */
function framedEntries(ctx: Context, registry: Registry): Map<SectionRole, boolean> {
  const takes = new Map<SectionRole, boolean>();
  const entries = [...registry.snippets].filter(([key]) => key.startsWith("entry:"));
  const macro = (snippet: string) => /^\\([A-Za-z@]+)/.exec(snippet)?.[1];
  for (const [key, snippet] of entries) {
    const role = key.slice("entry:".length) as SectionRole;
    if (bulletsOf(snippet) !== "") {
      takes.set(role, true);
      continue;
    }
    const donor = entries.find(
      ([other, each]) => other !== key && macro(each) === macro(snippet) && bulletsOf(each) !== "",
    );
    let frame: string | undefined;
    if (donor !== undefined) {
      frame = bulletsOf(donor[1]);
      const from = donor[0].slice("entry:".length);
      for (const prefix of ["bullet", "sep:bullets"]) {
        const there = registry.snippets.get(`${prefix}:${from}`);
        if (there !== undefined && !registry.snippets.has(`${prefix}:${role}`))
          registry.snippets.set(`${prefix}:${role}`, there);
      }
    } else frame = pairedList(ctx);
    takes.set(role, frame !== undefined);
    if (frame !== undefined) registry.snippets.set(key, withFrame(snippet, frame));
  }
  return takes;
}

/** An entry's snippet with `frame` in its bullets' block, which it adds before its bullets' extra. */
function withFrame(snippet: string, frame: string): string {
  const block = `{{#bullets}}${frame}{{/bullets}}`;
  if (snippet.includes("{{#bullets}}{{/bullets}}"))
    return snippet.replace("{{#bullets}}{{/bullets}}", () => block);
  const extra = extrasSlot("bullets");
  return snippet.includes(extra)
    ? snippet.replace(extra, () => `${block}${extra}`)
    : `${snippet}${block}`;
}

/**
 * The bullets' list the answer pairs, as an entry's snippet sets it after the entry: the first
 * bullets' opener with its closer, or environment, whose names are letters and which take no
 * argument; or none.
 */
function pairedList(ctx: Context): string | undefined {
  const takesNothing = (record: Readonly<Record<string, { spec?: string }>>, name: string) =>
    /^[A-Za-z]+$/.test(name) && Object.hasOwn(record, name) && record[name]?.spec === "";
  for (const [id, answer] of ctx.answers) {
    if (answer.kind !== "bulletList" || answer.list?.does !== "opens") continue;
    const [of, name = ""] = id.split("|");
    if (of === "environment") {
      if (takesNothing(ctx.found.environments, name))
        return `\n\\begin{${name}}\n{{bullets}}\n\\end{${name}}`;
      continue;
    }
    const closer = answer.list.closedBy ?? "";
    if (takesNothing(ctx.found.commands, name) && takesNothing(ctx.found.commands, closer))
      return `\n\\${name}\n{{bullets}}\n\\${closer}`;
  }
  return undefined;
}

/**
 * Whether each role's entries take bullets, as the package says it (decision 0026): nothing where
 * every role's do; else the default the first role's, which a role without a snippet of its own
 * takes as it takes its snippet (`byRole`), and each role that differs.
 */
function entryBulletsOf(takes: ReadonlyMap<SectionRole, boolean>): ByRole<boolean> | undefined {
  const all = [...takes];
  const [first] = all;
  if (first === undefined || all.every(([, each]) => each)) return undefined;
  if (all.every(([, each]) => each === first[1])) return first[1];
  const variants: Partial<Record<SectionRole, boolean>> = {};
  for (const [role, each] of all) if (each !== first[1]) variants[role] = each;
  return { default: first[1], ...variants };
}

/** Defaults by role, always as a default and a variant for each role whose own differ. */
type RoleDefaults = { default: Record<string, string> } & Partial<
  Record<SectionRole, Record<string, string>>
>;

/**
 * The defaults the registry holds for a place, `entry` or `section`, by role (decision 0026): the
 * first role's as the default, which a role with no snippet of its own takes as it takes its
 * snippet, and each other role's whose differ, none among them, since a role's snippet is its own
 * and a key another's gives no default for may stand in it; none where no role has any.
 */
function defaultsOf(registry: Registry, place: "entry" | "section"): RoleDefaults | undefined {
  const found: [SectionRole, Record<string, string>][] = [];
  for (const [key, defaults] of registry.defaults)
    if (key.startsWith(`${place}:`))
      found.push([key.slice(place.length + 1) as SectionRole, defaults]);
  const [first] = found;
  if (first === undefined || found.every(([, each]) => Object.keys(each).length === 0))
    return undefined;
  const same = (a: Record<string, string>, b: Record<string, string>) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  const variants: Partial<Record<SectionRole, Record<string, string>>> = {};
  for (const [role, defaults] of found.slice(1))
    if (!same(defaults, first[1])) variants[role] = defaults;
  return { default: first[1], ...variants };
}

/** A section kind's snippet by role: each role's head, what stands before, its frame, and after. */
function sectionSnippets(registry: Registry, kind: SectionKind): ByRole<string> {
  const heads = new Map<SectionRole, string>();
  let anyHead: string | undefined;
  for (const [key, snippet] of registry.snippets) {
    if (!key.startsWith("head:")) continue;
    anyHead ??= snippet;
    const [, of, role] = key.split(":");
    if (of === kind) heads.set(role as SectionRole, snippet);
  }
  const frames = new Map<SectionRole, string>();
  for (const [key, snippet] of registry.snippets) {
    const [what, of, role] = key.split(":");
    if (what === "frame" && of === kind) frames.set(role as SectionRole, snippet);
  }
  const anyFrame = frames.values().next().value;
  const compose = (head: string, frame: string | undefined) =>
    `{{&x.lead}}${head}{{&x.before}}${frame ?? anyFrame ?? GENERIC_FRAMES[kind]}{{&x.after}}`;
  const composed = new Registry();
  for (const [role, head] of heads)
    composed.snippets.set(`s:${role}`, compose(head, frames.get(role)));
  return byRole(composed, "s", compose(anyHead ?? GENERIC_UNITS.head, undefined));
}

/**
 * The package, its id `import-` and twelve hex digits of the SHA-256 of the rest of it as JSON,
 * so that the same template gives the same package, and the same formats, whoever imports it.
 */
async function packageOf(fields: Omit<TemplatePackage, "id">): Promise<TemplatePackage> {
  const hash = await sha256(JSON.stringify(fields));
  return { id: `${IMPORTED_PREFIX}${hash.slice(0, 12)}`, ...fields };
}

// The entry.

/**
 * Assemble an imported resume into a package and a document (decision 0026), or refuse it: from
 * its intake, its reference, its body's tree and the engine's signatures of the body's and the
 * preamble's names, its probe, the naming answer, and for XeTeX the rewrite of its fonts, when item
 * 8 made one. `options.decisions` are what the checks decided, which `validate.ts` assembles again
 * with; the ids are minted from where each node stands, so that the same resume gives the same.
 */
export async function assemble(
  intake: Intake,
  made: Reference,
  tree: Tree,
  found: EngineSignatures,
  probe: Probe,
  answer: NamingAnswer,
  rewrite?: XetexRewrite,
  options: AssemblyOptions = {},
): Promise<Assembled | Refusal> {
  const body = bodyOf(intake);
  if ("refused" in body) return body;
  if (body.text !== tree.source) throw new Error("the tree is not of the intake's body");
  const decisions: Required<Decisions> = {
    dropped: options.decisions?.dropped ?? [],
    placement: options.decisions?.placement ?? "class",
    controls: options.decisions?.controls ?? [],
    instances: options.decisions?.instances ?? {},
    slots: options.decisions?.slots ?? {},
    required: options.decisions?.required ?? [],
    fixed: options.decisions?.fixed ?? [],
  };
  const answers = answersOf(answer);
  const dropped = new Set(decisions.dropped);
  // The redefinitions the answers carry, each once by its name, but those a check refused; and the
  // macros whose answers carry any that stay, which the probe did not see fixed.
  const redefinitions: { name: string; latex: string }[] = [];
  const trusted = new Set<string>();
  for (const [macro, each] of answers) {
    const carried = redefinitionsOf(each) ?? [];
    const kept = carried.filter((one) => !dropped.has(one.name));
    if (kept.length > 0 && kept.length === carried.length) trusted.add(macro);
    for (const one of kept)
      if (!redefinitions.some((other) => other.name === one.name)) redefinitions.push(one);
  }
  const preambleText0 = rewrite?.preamble ?? body.preamble;
  const preamble = preambleOf(preambleText0, found);
  const ctx: Context = {
    intake,
    made,
    tree,
    source: tree.source,
    found,
    probe,
    answers,
    engine: made.engine,
    decisions,
    trusted,
    candidates: candidatesByPlace(probe),
    constants: constantsOf(preamble.tree === undefined ? [tree] : [tree, preamble.tree]),
    modes: new Map(),
    dateFormat: dateFormatOf(tree),
    preamble,
    ids: new IdMint(),
    locked: [],
    fields: [],
    placed: new Map(),
    monthly: false,
  };
  ctx.modes = slotModes(
    probe,
    answers,
    new Set([...trusted].flatMap((macro) => slotsOf(probe, macro))),
  );
  const laid = bodyOf_(ctx);
  if ("refused" in laid) return laid;
  const { header, sections, registry } = laid;

  // The preamble's header calls, taken out: they are set from the model before the document.
  const removed = preamble.setters
    .filter((call) => {
      const kind = commandAnswer(answers, call.name)?.kind;
      return kind !== undefined && (HEADER_KINDS.has(kind) || kind === "other");
    })
    .map((call) => ({ start: call.start, end: call.end }));
  const { controls, size } = controlsOf(ctx, preambleText0, answer);
  const { preamble: preambleSnippet, at } = preambleText(ctx, removed, size, redefinitions);

  // A link of a kind the document has none of goes through the template's own macro where one
  // takes any address, and through `\href` otherwise.
  const anyAddress = [...header.links.values()].find((snippet) => snippet.includes("{{&href}}"));
  const links: TemplatePackage["snippets"]["link"] = {
    other:
      header.links.get("other") ??
      anyAddress ??
      "{{#href}}\\href{{{&href}}}{{{label}}}{{/href}}{{^href}}{{label}}{{/href}}",
  };
  for (const [kind, snippet] of header.links) if (kind !== "other") links[kind] = snippet;
  // Every entry's snippet sets the bullets a user adds, or the package says it does not.
  const entryBullets = entryBulletsOf(framedEntries(ctx, registry));
  const entryDefaults = defaultsOf(registry, "entry");
  const sectionDefaults = defaultsOf(registry, "section");
  const resume: Resume = { version: 1, header: header.header, sections };
  const required = requiredOf(ctx, resume);
  const fields: Omit<TemplatePackage, "id"> = {
    version: 1,
    name:
      FAMILY_NAMES[classFamily(preambleText0, tree, answers)] ??
      documentClass(preambleText0) ??
      "Imported",
    engine: made.engine,
    // The template's, never the upload's own file name, which is the person's as often as not:
    // two uploads of one template share a package whatever their main files are called.
    source: { url: MAIN_FILE, license: "", attribution: "" },
    files: filesOf(ctx, rewrite),
    ...(rewrite === undefined || rewrite.fonts.length === 0 ? {} : { fonts: rewrite.fonts }),
    preamble: preambleSnippet,
    controls,
    snippets: {
      document: `${at ? "\\catcode`\\@=\\csname import@at\\endcsname\\relax\n" : ""}${laid.document}`,
      header: header.snippet,
      link: links,
      section: {
        entries: sectionSnippets(registry, "entries"),
        list: sectionSnippets(registry, "list"),
        labelled: sectionSnippets(registry, "labelled"),
        paragraph: sectionSnippets(registry, "paragraph"),
      },
      entry: byRole(registry, "entry", GENERIC_UNITS.entry),
      bullet: byRole(registry, "bullet", GENERIC_UNITS.bullet),
      item: byRole(registry, "item", GENERIC_UNITS.item),
      labelledItem: byRole(registry, "labelledItem", GENERIC_UNITS.labelledItem),
      separators: {
        sections: laid.separator,
        links: header.linksSeparator,
        contacts: "\n",
        entries: byRole(registry, "sep:entries", "\n"),
        bullets: byRole(registry, "sep:bullets", "\n"),
        items: byRole(registry, "sep:items", "\n"),
      },
      ...(entryDefaults === undefined && sectionDefaults === undefined
        ? {}
        : {
            defaults: {
              ...(entryDefaults === undefined ? {} : { entry: entryDefaults }),
              ...(sectionDefaults === undefined ? {} : { section: sectionDefaults }),
            },
          }),
      ...(entryBullets === undefined ? {} : { entryBullets }),
    },
    ...(required === undefined ? {} : { required }),
    // The kinds of unit the third check found a new one of stops the compile, in the order the
    // editor names them, so that the same decisions hash the same.
    ...(decisions.fixed.length === 0
      ? {}
      : { fixed: UNIT_KINDS.filter((kind) => decisions.fixed.includes(kind)) }),
  };
  // Every extra, locked part and default is kept LaTeX, as the model and the package take it: one
  // they would refuse, as a list past the cap, is a part this editor cannot keep (decision 0026).
  if (!keptEverywhere(resume, fields)) return refusal("keep");
  const pkg = await packageOf(fields);
  const document: Document = { version: 1, template: pkg.id, resume, controls: {} };
  return {
    package: pkg,
    document,
    extras: ctx.locked,
    checks: checksOf(ctx, pkg, sections, redefinitions),
  };
}

/** The name an imported package gives its source: the template's main file, whatever the upload's is. */
export const MAIN_FILE = "main.tex";

/**
 * Whether every extra of a resume, every locked section and every default of its package is kept
 * LaTeX (`KeptLatex`), a locked section's as `\rtlocked`'s argument takes it (`LockedLatex`): what the
 * assembly copied from the upload, a list kept whole, the growing `after`, an argument's bytes, is
 * held to the cap and the rules the model holds a stored document to.
 */
function keptEverywhere(resume: Resume, pkg: Omit<TemplatePackage, "id">): boolean {
  const kept = (extras: Readonly<Record<string, string>> | undefined) =>
    Object.values(extras ?? {}).every(isKept);
  if (!kept(resume.header.extras)) return false;
  for (const section of resume.sections) {
    if (!kept(section.extras)) return false;
    if (section.kind === "locked" && !LockedLatex.safeParse(section.latex).success) return false;
    if (section.kind === "entries" && !section.entries.every((entry) => kept(entry.extras)))
      return false;
  }
  const defaults = pkg.snippets.defaults;
  for (const roles of [defaults?.entry, defaults?.section])
    for (const each of Object.values(roles ?? {})) if (!kept(each)) return false;
  return true;
}

/** The places of a resume's nodes, by id, as the package's required slots name them. */
function placesOf(resume: Resume): Map<string, RequiredPlace> {
  const places = new Map<string, RequiredPlace>([["header", "header"]]);
  for (const link of resume.header.links) places.set(link.id, "link");
  for (const section of resume.sections) {
    if (section.kind === "locked") continue;
    places.set(section.id, "section");
    if (section.kind === "entries")
      for (const entry of section.entries) {
        places.set(entry.id, "entry");
        for (const bullet of entry.bullets) places.set(bullet.id, "bullet");
      }
    else if (section.kind === "list") for (const item of section.items) places.set(item.id, "item");
    else if (section.kind === "labelled")
      for (const item of section.items) places.set(item.id, "labelledItem");
  }
  return places;
}

/** The slots each place of a package may require. */
const REQUIRABLE: Readonly<Record<RequiredPlace, readonly string[]>> = {
  header: ["first", "last", "headline", "email", "phone", "location"],
  link: ["label"],
  section: ["title", "text"],
  entry: ["title", "subtitle", "place", "dates"],
  bullet: ["text"],
  item: ["text"],
  labelledItem: ["label", "text"],
};

/**
 * The slots the package requires (decision 0026): of the fields the checks found stop the compile
 * when empty and nothing else (`Decisions.required`, by macro and argument), each by the snippet
 * that sets it and its slot there, which the editor refuses to empty; none where none is required.
 */
function requiredOf(ctx: Context, resume: Resume): TemplatePackage["required"] | undefined {
  const wanted = new Set(ctx.decisions.required);
  if (wanted.size === 0) return undefined;
  const places = placesOf(resume);
  const found = new Map<RequiredPlace, Set<string>>();
  for (const field of ctx.fields) {
    if (field.mode === "locked" || !wanted.has(field.slot)) continue;
    const place = places.get(field.node);
    const slot = field.field.slice(field.field.lastIndexOf(".") + 1);
    if (place === undefined || !REQUIRABLE[place].includes(slot)) continue;
    found.set(place, (found.get(place) ?? new Set()).add(slot));
  }
  if (found.size === 0) return undefined;
  const required: Record<string, string[]> = {};
  for (const [place, slots] of Object.entries(REQUIRABLE) as [RequiredPlace, string[]][]) {
    const named = slots.filter((slot) => found.get(place)?.has(slot));
    if (named.length > 0) required[place] = named;
  }
  return required as TemplatePackage["required"];
}

/** The slots of a trusted macro that the probe has verdicts for. */
function slotsOf(probe: Probe, macro: string): string[] {
  const [of, name] = macro.split("|");
  return probe.candidates
    .filter(
      (each) =>
        each.kind === "argument" &&
        each.name === name &&
        each.index !== undefined &&
        (each.of === "call" ? "command" : "environment") === of,
    )
    .map((each) => slotKey(of as "command" | "environment", name ?? "", each.index as number));
}

/** The family a document is of, as the naming request reads it: its class, or Jake's calls. */
function classFamily(preamble: string, tree: Tree, answers: Answers): string {
  const name = documentClass(preamble)?.toLowerCase() ?? "";
  if (FAMILY_NAMES[name] !== undefined) return name;
  for (const node of everyNode(tree.content))
    if (
      node.kind === "call" &&
      node.name === "resumeSubheading" &&
      answers.has("command|resumeSubheading")
    )
      return "jake";
  return name;
}

/** What the assembly found, before any check: its fields, sections, controls and redefinitions. */
function checksOf(
  ctx: Context,
  pkg: TemplatePackage,
  sections: readonly Section[],
  redefinitions: readonly { name: string }[],
): AssemblyChecks {
  const locked: Partial<Record<LockReason, number>> = {};
  const lockedWords: Partial<Record<LockReason, number>> = {};
  let editable = 0;
  let editableWords = 0;
  let raw = 0;
  for (const field of ctx.fields) {
    if (field.mode === "typeset") {
      editable++;
      editableWords += field.words;
    } else if (field.mode === "raw") raw++;
  }
  for (const part of ctx.locked) {
    locked[part.reason] = (locked[part.reason] ?? 0) + 1;
    lockedWords[part.reason] = (lockedWords[part.reason] ?? 0) + part.words;
  }
  const offered = (Object.keys(pkg.controls) as (ControlName | "dateFormat")[]).filter(
    (name): name is ControlName => name !== "dateFormat",
  );
  const owners = ownersOf(ctx);
  return {
    outcome: "assembled",
    fields: { editable, raw, required: ctx.decisions.required.length, locked },
    words: { editable: editableWords, locked: lockedWords },
    sections: {
      mapped: sections.filter((section) => section.kind !== "locked").length,
      locked: sections.filter((section) => section.kind === "locked").length,
    },
    required: [...ctx.decisions.required],
    controls: { offered, proven: [...offered], dropped: [] },
    redefinitions: {
      applied: redefinitions.map((each) => each.name),
      dropped: [...ctx.decisions.dropped],
      placement: ctx.decisions.placement,
    },
    repeatable: [],
    findings: [],
    compiles: 0,
    ms: 0,
    decisions: ctx.decisions,
    all: ctx.fields,
    ...(owners === undefined ? {} : { owners }),
  };
}

/**
 * What sets each run of the reference's glyphs in the document assembled (decision 0039), from the
 * probe's runs (`Probe.runs`), each set by a candidate, a raw chunk or the template's own text
 * (decision 0022). A run a part of the source sets is the innermost editable field that holds that
 * part, as the probe's editable candidate is the field the assembly made of it; else the innermost
 * locked part that holds it, a field's kept instance, a list kept whole, a header's extra or a
 * locked section; else the locked field that holds it, which keeps no part; and else something the
 * document keeps as the upload wrote it and no part counts (`unmapped`), so that no word of the
 * document's own counts as the template's. A run of the template's own text has no owner. Runs
 * side by side with one owner are one.
 */
function ownersOf(ctx: Context): GlyphOwner[] | undefined {
  const runs = ctx.probe.runs;
  if (runs === undefined) return undefined;
  const candidates = new Map(ctx.probe.candidates.map((each) => [each.id, each]));
  const inPreamble = preambleSpans(ctx);
  const fields = ctx.fields.flatMap((field) => {
    const placement = ctx.placed.get(field);
    return placement === undefined ? [] : [{ ...placement, field }];
  });
  const parts = ctx.locked.flatMap((part, index) => {
    const placement = ctx.placed.get(part);
    return placement === undefined ? [] : [{ ...placement, index }];
  });
  /** The shortest of `units` that holds all of `span`, if any does. */
  const innermostOf = <T extends Placement>(units: readonly T[], span: Placement) => {
    let best: T | undefined;
    for (const unit of units)
      if (
        unit.where === span.where &&
        unit.start <= span.start &&
        span.end <= unit.end &&
        (best === undefined || unit.end - unit.start < best.end - best.start)
      )
        best = unit;
    return best;
  };
  const editable = fields.filter(({ field }) => field.mode !== "locked");
  const locked = fields.filter(({ field }) => field.mode === "locked");
  const owners: GlyphOwner[] = [];
  for (const run of runs) {
    const candidate = run.candidate === undefined ? undefined : candidates.get(run.candidate);
    const span: Placement | undefined =
      run.by === "raw" && run.raw !== undefined
        ? { where: "body", start: run.raw.start, end: run.raw.end }
        : run.by === "candidate" && candidate !== undefined
          ? candidate.where === "body"
            ? { where: "body", start: candidate.start, end: candidate.end }
            : inPreamble(candidate)
          : undefined;
    // The template's own text has no owner; what a part of the document's source sets has one.
    let owner: Pick<GlyphOwner, "field" | "part" | "kept"> = {};
    if (span !== undefined) {
      const field = innermostOf(editable, span);
      const part = field === undefined ? innermostOf(parts, span) : undefined;
      const kept =
        field === undefined && part === undefined ? innermostOf(locked, span) : undefined;
      owner =
        field !== undefined
          ? { field: field.field.field }
          : part !== undefined
            ? { part: part.index }
            : { kept: kept?.field.reason ?? "unmapped" };
    } else if (run.by !== "chrome") owner = { kept: "unmapped" };
    const last = owners.at(-1);
    if (
      last !== undefined &&
      last.page === run.page &&
      last.to === run.from &&
      last.field === owner.field &&
      last.part === owner.part &&
      last.kept === owner.kept
    )
      last.to = run.to;
    else owners.push({ page: run.page, from: run.from, to: run.to, ...owner });
  }
  return owners;
}

/**
 * Where a span of the upload's own preamble, the probe's, stands in the assembly's: the same, but
 * for a XeTeX import, whose preamble is the rewrite's (decision 0023), its fonts declared by file,
 * so that what follows a font's command stands elsewhere. A span inside one of the preamble's
 * storing calls is moved as far as the call is, the calls taken in turn where the two preambles
 * write them alike, as the rewrite leaves them; one outside them, or in a call the rewrite
 * changed, has no place.
 */
function preambleSpans(ctx: Context): (span: Span) => Placement | undefined {
  const own = bodyOf(ctx.intake);
  const at = (span: Span): Placement => ({ where: "preamble", ...span });
  if ("refused" in own || own.preamble === ctx.preamble.text) return (span) => at(span);
  const before = preambleOf(own.preamble, ctx.found).setters;
  const after = ctx.preamble.setters;
  const moves: { start: number; end: number; by: number }[] = [];
  let j = 0;
  for (const call of before) {
    const text = own.preamble.slice(call.start, call.end);
    let k = j;
    while (k < after.length) {
      const other = after[k] as CallNode;
      if (ctx.preamble.text.slice(other.start, other.end) === text) break;
      k++;
    }
    if (k === after.length) continue;
    moves.push({ start: call.start, end: call.end, by: (after[k] as CallNode).start - call.start });
    j = k + 1;
  }
  return (span) => {
    const move = moves.find((each) => each.start <= span.start && span.end <= each.end);
    return move === undefined
      ? undefined
      : at({ start: span.start + move.by, end: span.end + move.by });
  };
}

/**
 * The preamble's calls that store the header's text, which the package takes out and sets from the
 * model before `\begin{document}`: their bytes, in order, for a compile of the original body from
 * the package's format, which needs them issued as the preamble issued them.
 */
export function takenOut(
  intake: Intake,
  found: EngineSignatures,
  answer: NamingAnswer,
  rewrite?: XetexRewrite,
): string[] {
  const body = bodyOf(intake);
  if ("refused" in body) return [];
  const text = rewrite?.preamble ?? body.preamble;
  const answers = answersOf(answer);
  return preambleOf(text, found)
    .setters.filter((call) => {
      const kind = commandAnswer(answers, call.name)?.kind;
      return kind !== undefined && (HEADER_KINDS.has(kind) || kind === "other");
    })
    .map((call) => text.slice(call.start, call.end));
}
