/**
 * An imported `.tex` resume in its own shape (the second pass's item 5, decision 0049): its
 * outline, built from the parser's tree (decision 0020) and the probe's verdicts (decision 0022),
 * with no naming step and no assembly, and the package it is set with. The spike that measured it
 * is `scripts/spike-outline*.ts` (decision 0050), whose builder this is.
 *
 * - **Fields.** Every piece of text the probe proved editable is a field, where it stands in the
 *   person's LaTeX: each text or date its candidate holds (`leavesOf`), a text as rich text, its
 *   bold, italic and links kept, and a date as plain text, its text as it reads. The generator
 *   writes a field escaped in the editor's marker, as it writes a slot (decision 0007), so that
 *   what a person types later never acts as LaTeX. A candidate whose text the parser spread over
 *   leaves and the bytes between them, as a title holding an icon's command, is a field for each
 *   leaf and kept text between them; one that a leaf crosses the edge of stays kept text.
 * - **Kept text.** Everything else, the upload's own LaTeX, byte for byte: what a field's leaf
 *   spans is the only part of the body that changes, and the spaces TeX skipped after a leaf that
 *   ends in a control word, which go with it so that none is set after its marker.
 * - **Groups of units.** A list's items are a group, and so is a run of calls to the same command,
 *   each with what follows it up to the next (`groupsOf`), each unit carrying the kept text that
 *   parts it from the one before. A group whose units do not each balance as TeX reads them, which
 *   the model refuses, is kept as its parts, with no group.
 * - **The preamble's values.** A value the preamble stores, as Awesome-CV's `\name{...}{...}`
 *   stores the name, is a field through the preamble's call issued again after the preamble, as
 *   the probe issues it (`reissued`), which the outline holds before `\begin{document}`.
 *
 * The outline holds everything after the preamble: the calls issued again, `\begin{document}`, the
 * body and `\end{document}`. Its package (`outlinePackage`) holds the preamble, rewritten only as
 * far as the editor's loop needs, and a document snippet of `{{sections}}`. It is checked against
 * the model's schema, which refuses kept text that holds the editor's own macros or markers, a
 * piece that ends in an escaping backslash, and braces that do not balance (decision 0049): an
 * upload that makes one is refused (`keep`). Braces the upload leaves open, as the model reads
 * them, are closed after `\end{document}`, where TeX never reads them (`closeOpenBraces`): the
 * model's reading of the outline then balances, TeX reads the upload's own, and the checks compile
 * it and judge its page.
 *
 * Nothing here compiles: the checks compile the outline (`checks.ts`). Nothing here reaches the
 * network.
 */

import {
  type OutlinePart,
  OutlineSection,
  type OutlineUnit,
  outlineNodes,
  outlineOpenBraces,
  Resume,
  type RichText,
} from "@resume-tools/resume-model";
import type * as Ast from "@unified-latex/unified-latex-types";
import { parseMinimal } from "@unified-latex/unified-latex-util-parse";
import { isRetype, retypeOf, spelledFrom } from "../editor/retype";
import type { Engine } from "../engine/session";
import type { GlyphBox } from "../page/draw";
import {
  type FontFamily,
  IMPORTED_PREFIX,
  TemplatePackage,
  UNIT_KINDS,
} from "../templates/package";
import { type Candidate, wrapEnd } from "./candidates";
import { decodeText } from "./intake";
import {
  type Argument,
  maskedForParse,
  type Node,
  type Span,
  type TextNode,
  type Tree,
} from "./parse";
import { extensionOf } from "./paths";
import type { ProbeCandidate, UncoveredRun } from "./probe";
import { COMPATIBILITY, type GlyphStream, type Reference } from "./reference";
import { type GlyphOwner, type LockReason, ownRunningLines, pageWords } from "./report";
import {
  runsOf as decodedRuns,
  type Marks,
  PLAIN,
  type TextItem,
  type TextState,
  textItem,
} from "./richtext";
import { type EngineSignatures, replacementOf } from "./signatures";
import { snippetText } from "./templating";

// The tree.

/** A text or a date: the leaves a field's text is read from. */
export type Leaf = Extract<Node, { kind: "text" | "date" }>;

/** Whether an argument could be a field: given, mandatory or optional, and placed. */
const isTextArgument = (arg: Argument) =>
  arg.present && (arg.kind === "mandatory" || arg.kind === "optional") && arg.content !== undefined;

/** The node lists a node holds, in the source's order: its arguments' content, then its own. */
function childrenOf(node: Node): (readonly Node[])[] {
  const placed = (args: readonly Argument[]) =>
    args.flatMap((arg) => (arg.present && arg.content !== undefined ? [arg.content] : []));
  switch (node.kind) {
    case "text":
    case "date":
      return [];
    case "group":
      return [node.content];
    case "raw":
      return placed(node.args ?? []);
    case "call":
    case "section":
      return placed(node.args);
    case "list":
    case "environment":
    case "block":
    case "item":
      return [...placed(node.args), node.content];
  }
}

/** Every text and date of a tree, in the source's order. */
export function leavesOf(tree: Pick<Tree, "content">): Leaf[] {
  const found: Leaf[] = [];
  // A stack of its own, so that a deep tree costs no deep recursion.
  const stack: (readonly Node[])[] = [tree.content];
  for (let nodes = stack.pop(); nodes !== undefined; nodes = stack.pop())
    for (const node of nodes)
      if (node.kind === "text" || node.kind === "date") found.push(node);
      else stack.push(...childrenOf(node));
  return found.sort((a, b) => a.start - b.start);
}

// Groups of units.

/** A unit of a group: where it starts, where its own content ends, and where the next starts. */
export interface Unit {
  start: number;
  end: number;
  next: number;
}

/**
 * Something that repeats: a list's items (`list`), or a run of calls to the same command, each with
 * what follows it up to the next (`run`), by the list's or the command's name; with what parts its
 * last unit from the one before it, which a copy of it is put in after.
 */
export interface Group {
  kind: "list" | "run";
  name: string;
  units: Unit[];
  gap: string;
}

/**
 * A level's elements: a node, or what a template macro that begins an environment begins, up to
 * the macro that ends it, as Jake's Resume's `\resumeItemListStart` and `\resumeItemListEnd` open
 * and close a list among their siblings.
 */
type Element =
  | { kind: "node"; node: Node }
  | { kind: "bracket"; open: Node; inner: Element[]; close?: Node };

const startOf = (element: Element) =>
  element.kind === "node" ? element.node.start : element.open.start;

function endOf(element: Element): number {
  if (element.kind === "node") return element.node.end;
  const last = element.inner.at(-1);
  return element.close?.end ?? (last === undefined ? element.open.end : endOf(last));
}

/** A head of a unit: a section, or a call to a template macro that is given text. */
const isHead = (node: Node) =>
  node.kind === "section" || (node.kind === "call" && node.args.some(isTextArgument));

const headName = (node: Node) =>
  node.kind === "section" ? `section:${node.name}` : node.kind === "call" ? node.name : "";

/**
 * The groups of units of a body's tree (the plan's item 5), found by shape alone:
 *
 * - A level is a list of sibling nodes, in which a template macro whose definition begins an
 *   environment opens a bracket that the one that ends it closes (`replacementOf`, one level);
 *   the body, each bracket's inside and every node's content and arguments are levels.
 * - A list's items, wherever they stand, are a group.
 * - At a level, the repeated head that comes first, a section or a call to a template macro given
 *   text, makes a run: each of its calls with what follows it up to the next. The last runs to the
 *   level's end where the run is of sections, or where a unit before it holds a head of another
 *   command, as AltaCV's sections hold its events; otherwise it stops before the next head of
 *   another command, which starts a run of its own. Each unit, and what stands before the run and
 *   after it, are levels of their own.
 */
export function groupsOf(
  tree: Pick<Tree, "source" | "content">,
  macros: EngineSignatures["macros"],
): Group[] {
  const groups: Group[] = [];
  const nets = new Map<string, number>();
  /** How many environments a call's macro begins and does not end, by its definition. */
  const net = (node: Node) => {
    if (node.kind !== "call") return 0;
    let found = nets.get(node.name);
    if (found === undefined) {
      const text = replacementOf(macros, node.name) ?? "";
      found = (text.match(/\\begin\s*\{/g) ?? []).length - (text.match(/\\end\s*\{/g) ?? []).length;
      nets.set(node.name, found);
    }
    return found;
  };
  const elementsOf = (nodes: readonly Node[]): Element[] => {
    const root: Element[] = [];
    const open: Extract<Element, { kind: "bracket" }>[] = [];
    for (const node of nodes) {
      const n = net(node);
      const into = open.at(-1)?.inner ?? root;
      if (n > 0) {
        const bracket: Extract<Element, { kind: "bracket" }> = {
          kind: "bracket",
          open: node,
          inner: [],
        };
        into.push(bracket);
        open.push(bracket);
      } else if (n < 0 && open.length > 0) {
        const closed = open.pop();
        if (closed !== undefined) closed.close = node;
      } else into.push({ kind: "node", node });
    }
    return root;
  };
  const gapOf = (units: readonly Unit[]) => {
    const before = units.at(-2);
    const last = units.at(-1);
    return before === undefined || last === undefined
      ? "\n"
      : tree.source.slice(before.end, last.start);
  };
  const descend = (element: Element) => {
    const nodes =
      element.kind === "node"
        ? [element.node]
        : [element.open, ...(element.close === undefined ? [] : [element.close])];
    for (const node of nodes) for (const list of childrenOf(node)) level(elementsOf(list));
    if (element.kind === "bracket") level(element.inner);
  };
  const level = (elements: readonly Element[]): void => {
    if (elements.length === 0) return;
    const at = new Map<string, number[]>();
    elements.forEach((element, i) => {
      if (element.kind !== "node" || !isHead(element.node)) return;
      const name = headName(element.node);
      at.set(name, [...(at.get(name) ?? []), i]);
    });
    let lead: string | undefined;
    for (const [name, places] of at)
      if (places.length >= 2 && (lead === undefined || (places[0] ?? 0) < (at.get(lead)?.[0] ?? 0)))
        lead = name;
    const places = lead === undefined ? undefined : at.get(lead);
    if (lead === undefined || places === undefined) {
      const items = elements.flatMap((element) =>
        element.kind === "node" && element.node.kind === "item" ? [element.node] : [],
      );
      if (items.length > 0) {
        const units = items.map((item, i) => ({
          start: item.start,
          end: item.end,
          next: items[i + 1]?.start ?? item.end,
        }));
        groups.push({ kind: "list", name: "item", units, gap: gapOf(units) });
      }
      for (const element of elements) descend(element);
      return;
    }
    const other = (element: Element | undefined) =>
      element?.kind === "node" && isHead(element.node) && headName(element.node) !== lead;
    const holds = places
      .slice(0, -1)
      .some((from, i) => elements.slice(from + 1, places[i + 1]).some((element) => other(element)));
    const last = places.at(-1) ?? 0;
    let end = elements.length;
    if (!lead.startsWith("section:") && !holds)
      for (let i = last + 1; i < elements.length; i++)
        if (other(elements[i])) {
          end = i;
          break;
        }
    const spans = places.map((from, i) => elements.slice(from, places[i + 1] ?? end));
    const units = spans.map((span, i) => {
      const first = span[0] as Element;
      const own = span.at(-1) as Element;
      const next = spans[i + 1]?.[0];
      return {
        start: startOf(first),
        end: endOf(own),
        next: next === undefined ? endOf(own) : startOf(next),
      };
    });
    groups.push({ kind: "run", name: lead, units, gap: gapOf(units) });
    level(elements.slice(0, places[0]));
    for (const span of spans) {
      const head = span[0];
      if (head !== undefined) descend(head);
      level(span.slice(1));
    }
    level(elements.slice(end));
  };
  level(elementsOf(tree.content));
  return groups;
}

// The outline.

/** The id of the outline's section, the one section an imported `.tex` holds. */
export const OUTLINE_ID = "outline";

/**
 * A field where it stands in a source: its id, the span its marker takes the place of, its leaf's
 * own end, before the spaces TeX skipped after it, and what it holds.
 */
interface Spot {
  id: string;
  /** The probe's candidate it is a field of. */
  candidate: string;
  start: number;
  end: number;
  leafEnd: number;
  part: Extract<OutlinePart, { kind: "text" | "rich" }>;
}

/** Whether a text holds something to set: a field of spaces alone is written as nothing. */
const holdsText = (text: string) => text.trim() !== "";

/**
 * Whether a leaf's source breaks its line or its paragraph, with `\\`, `\newline`, `\par` or
 * a blank line, which the parser reads as a space and a field, one paragraph, writes as one: the
 * generator would set it on one line, as the spike found Jake's skills set (decision 0050). Its
 * lines may each be a field still (`linesOf`).
 */
const breaksLine = (latex: string) =>
  /\\\\|\\(?:newline|linebreak|par)(?![A-Za-z@])|\n[ \t]*\r?\n/.test(latex);

/** Whether a leaf's source ends a paragraph, with `\par` or a blank line, which no field holds. */
const endsParagraph = (latex: string) => /\\par(?![A-Za-z@])|\n[ \t]*\r?\n/.test(latex);

/** The marks a leaf's text may be read in, its group's declarations having set them before it. */
const MARKS: readonly Marks[] = [
  PLAIN,
  { bold: true, italic: false },
  { bold: false, italic: true },
  { bold: true, italic: true },
];

/** Whether two rich texts are the same, run by run, as the model holds them (`runsOf`). */
const sameRuns = (a: RichText, b: RichText) =>
  JSON.stringify(runsOf(a)) === JSON.stringify(runsOf(b));

/**
 * The raw commands that set nothing and leave TeX where it was on its line, a line's text going on
 * past them: spaces, glue, and `\newline` and `\linebreak`, after which TeX is still in the
 * paragraph in every environment (the kernel's `\newline` is the plain `\\`). A raw `\\*` or
 * `\\[2pt]` is not among them: in `center`, `flushleft`, `flushright` and after `\centering`,
 * `\raggedright` or `\raggedleft` it ends the paragraph, and a first line after it, emptied, would
 * leave the next break nothing to end.
 */
const ON_THE_LINE: ReadonlySet<string> = new Set([
  ...["hfill", "hfil", "hss", "hspace", "hskip", "kern", "quad", "qquad", "enspace", "enskip"],
  ...["thinspace", "negthinspace", "space", " ", ",", "/", "@", "nobreak", "newline"],
  ...["linebreak", "allowbreak", "relax", "unskip"],
]);

/**
 * The leaves of a tree that certainly follow text set on their own line: a text or a date before
 * them in the same list, with nothing between but commands that leave TeX on the line
 * (`ON_THE_LINE`) and no paragraph's end. Any other leaf may begin a paragraph, where TeX is still
 * between paragraphs, and a `\\` with nothing set before it stops the compile.
 */
export function midLineLeaves(tree: Pick<Tree, "source" | "content">): Set<Leaf> {
  const found = new Set<Leaf>();
  const stack: (readonly Node[])[] = [tree.content];
  for (let nodes = stack.pop(); nodes !== undefined; nodes = stack.pop()) {
    let set = false;
    let end = -1;
    for (const node of nodes) {
      const between = end < 0 ? "" : tree.source.slice(end, node.start);
      if (endsParagraph(between)) set = false;
      if (node.kind === "text" || node.kind === "date") {
        if (set) found.add(node);
        set = true;
      } else if (!(node.kind === "raw" && ON_THE_LINE.has(node.name ?? ""))) set = false;
      end = node.end;
      stack.push(...childrenOf(node));
    }
  }
  return found;
}

/** A leaf's lines (`linesOf`), and the text of a first line kept as the upload wrote it. */
interface Lines {
  lines: Leaf[];
  kept?: { runs: RichText; start: number };
}

/**
 * A text kept at the start of a candidate the outline holds in part (`linesOf`), by its candidate,
 * for the report's count (`ownersOf`, `reachOf`): its text, which the count lines up with the
 * candidate's glyphs where it has them (`leadingOf`), and the glyphs it sets at most where they do
 * not line up (`glyphsAtMost`). The outline notes it on the probe's own candidate, which the
 * report's count is given too; nothing else reads it.
 */
interface Lead {
  text: string;
  most: number;
}
const LEADS = new WeakMap<object, Lead>();

/** What may stand between a candidate's start and a first line kept as text: nothing set. */
const LEADING = /^(?:\s|\{|%[^\n]*(?:\n|$))*$/;

/**
 * The most glyphs a text sets (`LEADS`), where its glyphs do not line up with it: every character
 * but a space, one more for a letter past ASCII, which OT1 sets as an accent and its letter, two
 * more for an ellipsis, which it sets as three points, and one a word for a hyphen TeX may add
 * where it breaks the line. A ligature sets fewer, so the count errs towards kept text; only a word
 * TeX breaks twice, in a column narrower than it, sets more.
 */
function glyphsAtMost(text: string): number {
  let n = text.split(/\s+/u).filter((word) => word !== "").length;
  for (const char of text.normalize("NFC")) {
    if (/\s/u.test(char)) continue;
    n += char === "…" ? 3 : /\p{L}/u.test(char) && char > "\u{7f}" ? 2 : 1;
  }
  return n;
}

/** A text item read again (`readItems`), the marks it was read in and its node's index. */
interface ReadItem {
  item: TextItem;
  marks: Marks;
  node: number;
}

/**
 * The text items of nodes, each with the marks it was read in, read as the parser reads a
 * paragraph's (`textItem`), in `state`, which the reading changes as a declaration does; or
 * undefined where one is not text or ends a paragraph.
 */
function readItems(nodes: Ast.Node[], state: TextState, latex: string): ReadItem[] | undefined {
  const items: ReadItem[] = [];
  let skip = false;
  for (let i = 0; i < nodes.length; ) {
    const marks = { ...state.marks };
    const found = textItem(nodes, i, state, latex, skip);
    if (found === undefined || found.item.par === true) return undefined;
    items.push({ item: found.item, marks, node: i });
    skip = found.skipsNext;
    i = found.next;
  }
  return items;
}

/** Whether a text item holds a break, its own or inside it. */
const holdsBreak = (item: TextItem) => item.pieces.some((piece) => piece.kind === "break");

/**
 * The lines of a text leaf whose source breaks its line (`breaksLine`), each a leaf of its own, or
 * undefined where they cannot be told apart. The leaf's source is read again as the parser read
 * it (`textItem`), item by item, in the marks and the group a reading gives the leaf's own runs
 * back in, and cut at each `\\` among its own items, or among a group's where that group is all the
 * leaf holds, as `\item{...}` in Jake's skills block, whose braces then stay kept text around the
 * lines. Each line's text is its items from its first that is not a space, a comment or a break to
 * its last, as a paragraph's is (decision 0020), so that the break, its spaces and comments are
 * kept text between two lines' fields, and a field's markers never hold one. A line of nothing,
 * between two breaks or past one at an end, is no leaf.
 *
 * Undefined, and the leaf kept text as before: a date, a source that ends a paragraph, a break
 * inside a mark's argument or inside a group beside other text (`\textbf{a \\ b}`, `c {a \\ b}`),
 * which a field's markers could only part with braces between them, and a source the reading does
 * not give the leaf's own runs back for. A leaf whose source breaks no line of its own, as one
 * whose `\\` is in a comment, is its one line.
 */
function linesOf(source: string, leaf: Leaf, midLine: boolean): Lines | undefined {
  if (leaf.kind !== "text") return undefined;
  const latex = source.slice(leaf.start, leaf.end);
  if (endsParagraph(latex)) return undefined;
  let root: Ast.Node[];
  try {
    root = parseMinimal(maskedForParse(latex)).content;
  } catch {
    return undefined;
  }
  for (const grouped of [false, true])
    for (const marks of MARKS) {
      let nodes = root;
      let items = readItems(nodes, { marks: { ...marks }, grouped }, latex);
      if (
        items === undefined ||
        !sameRuns(decodedRuns(items.flatMap((each) => each.item.pieces)), leaf.runs)
      )
        continue;
      // Into a group that is all the leaf holds and holds its breaks, its braces kept around them.
      for (;;) {
        const own = items.filter((each) => each.item.edge === undefined);
        const [only] = own;
        const node = only === undefined ? undefined : nodes[only.node];
        if (own.length !== 1 || only === undefined || node?.type !== "group") break;
        if (!holdsBreak(only.item)) break;
        nodes = node.content;
        items = readItems(nodes, { marks: { ...only.marks }, grouped: true }, latex);
        if (items === undefined) return undefined;
      }
      // A break inside an item of its own, a group's or a mark's, has no edge a marker can take.
      if (items.some((each) => each.item.edge !== "break" && holdsBreak(each.item)))
        return undefined;
      const lines: TextNode[] = [];
      let kept: Lines["kept"];
      const breaks = items.some((each) => each.item.edge === "break");
      let from = 0;
      for (let i = 0; i <= items.length; i++) {
        if (i < items.length && items[i]?.item.edge !== "break") continue;
        // A first line that may begin its line stays kept text: empty, it would leave its break
        // nothing to end, which stops the compile (`midLine`). A later line is a field, though in
        // `center`, `flushleft`, `flushright` and after `\centering`, `\raggedright` or
        // `\raggedleft`, where `\\` ends the paragraph, it begins one too: emptied, it stops the
        // compile the same way, and check 2 finds its candidate required, every field of it.
        const first = from === 0;
        const line = items.slice(from, i).map((each) => each.item);
        from = i + 1;
        const begin = line.findIndex((item) => item.edge === undefined);
        let last = line.length - 1;
        while (last >= 0 && line[last]?.edge !== undefined) last--;
        if (begin < 0) continue;
        const inside = line.slice(begin, last + 1);
        const runs = decodedRuns(inside.flatMap((item) => item.pieces));
        const start = leaf.start + (inside[0]?.start ?? 0);
        if (first && breaks && !midLine) {
          kept = { runs, start };
          continue;
        }
        lines.push({ kind: "text", runs, start, end: leaf.start + (inside.at(-1)?.end ?? 0) });
      }
      return { lines, ...(kept === undefined ? {} : { kept }) };
    }
  return undefined;
}

/**
 * The fields of a source: each editable candidate's leaves where they stand (the module's comment),
 * in the order of the source. A leaf that holds the candidate's whole span, as a text whose braces
 * the candidate's span is inside, is the field; otherwise every leaf inside its span is one, and a
 * leaf that crosses its edge leaves the candidate kept text. A leaf whose source breaks a line
 * (`breaksLine`) is a field a line, the breaks kept text between them, and where its lines cannot
 * be told apart (`linesOf`) it leaves the candidate kept text. A leaf of spaces alone is kept, since
 * a blank field is written as nothing. A field's span runs past the spaces TeX skipped after a
 * leaf that ends in a control word, up to the next field, so that none is set after its marker.
 */
function spotsOf(
  source: string,
  leaves: readonly Leaf[],
  candidates: readonly Candidate[],
  midLine: ReadonlySet<Leaf> = new Set(),
): Spot[] {
  const found: Omit<Spot, "end">[] = [];
  const sorted = [...candidates].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const candidate of sorted) {
    if (candidate.empty || candidate.end <= candidate.start) continue;
    const touching = leaves.filter(
      (leaf) => leaf.end > candidate.start && leaf.start < candidate.end,
    );
    const holding = touching.find(
      (leaf) => leaf.start <= candidate.start && leaf.end >= candidate.end,
    );
    let whole: Leaf[];
    if (holding !== undefined) whole = [holding];
    else if (touching.every((leaf) => leaf.start >= candidate.start && leaf.end <= candidate.end))
      whole = touching;
    else continue;
    const chosen: Leaf[] = [];
    let split = true;
    let lead: Lead | undefined;
    for (const [k, leaf] of whole.entries()) {
      const found: Lines | undefined = breaksLine(source.slice(leaf.start, leaf.end))
        ? linesOf(source, leaf, midLine.has(leaf))
        : { lines: [leaf] };
      // A first line kept as text is the candidate's start, nothing before it but spaces, a
      // comment and braces, or the candidate is kept whole: the report counts it by its glyphs.
      const kept = found?.kept;
      if (
        found === undefined ||
        (kept !== undefined && (k > 0 || !LEADING.test(source.slice(candidate.start, kept.start))))
      )
        split = false;
      else {
        chosen.push(...found.lines);
        if (kept !== undefined) {
          const text = kept.runs.map((run) => run.text).join("");
          lead = { text, most: glyphsAtMost(text) };
        }
      }
    }
    if (!split) continue;
    if (lead !== undefined) LEADS.set(candidate, lead);
    else LEADS.delete(candidate);
    const own = chosen.filter((leaf) =>
      leaf.kind === "date"
        ? holdsText(leaf.text)
        : holdsText(leaf.runs.map((run) => run.text).join("")),
    );
    own.forEach((leaf, k) => {
      const id = own.length === 1 ? candidate.id : `${candidate.id}-p${k + 1}`;
      // An argument given as one token, without braces, takes braces of its own with its marker.
      const bare = candidate.bare === true && own.length === 1 && leaf.start <= candidate.start;
      const part: Spot["part"] =
        leaf.kind === "date"
          ? { kind: "text", id, text: leaf.text, ...(bare ? { bare } : {}) }
          : { kind: "rich", id, text: runsOf(leaf.runs), ...(bare ? { bare } : {}) };
      found.push({ id, candidate: candidate.id, start: leaf.start, leafEnd: leaf.end, part });
    });
  }
  found.sort((a, b) => a.start - b.start);
  const spots: Spot[] = [];
  let reach = -1;
  found.forEach((spot, i) => {
    // Leaves never overlap; one that would is left kept text.
    if (spot.start < reach) return;
    const next = found[i + 1]?.start ?? source.length;
    const end = wrapEnd(source, spot.leafEnd, Math.max(spot.leafEnd, next));
    spots.push({ ...spot, end });
    reach = end;
  });
  return spots;
}

/** A leaf's runs as the model holds rich text: its text, bold, italic and link, nothing else. */
function runsOf(runs: RichText): RichText {
  return runs.map((run) => ({
    text: run.text,
    ...(run.bold === true ? { bold: true } : {}),
    ...(run.italic === true ? { italic: true } : {}),
    ...(run.href === undefined ? {} : { href: run.href }),
  }));
}

/** Whether a piece of LaTeX ends in a backslash no backslash escapes, which would take what follows. */
const endsEscaping = (latex: string) => (/\\+$/.exec(latex)?.[0].length ?? 0) % 2 === 1;

/** A group as the outline places it: its units' spans and the gaps between them. */
interface Placed {
  start: number;
  end: number;
  units: Unit[];
}

/** Whether a group's parts are an outline's the model takes: every unit balances, and the rest. */
const groupTaken = (group: OutlinePart) =>
  OutlineSection.safeParse({
    kind: "outline",
    id: OUTLINE_ID,
    title: "",
    role: "other",
    parts: [group],
  }).success;

/** How the outline of a source is written: its source, its fields and its groups, and the ids. */
interface Writer {
  source: string;
  spots: readonly Spot[];
  groups: readonly Placed[];
  /** The next group's number, for its id and its units'. */
  count: { groups: number };
  /** The fields written, by their candidate's id: the first field of each. */
  written: Map<string, string>;
  /** How many groups and units were written. */
  made: { groups: number; units: number };
  /** Each group written, by its id, and its units' spans in the source. */
  placed: Map<string, readonly Unit[]>;
}

/**
 * The outline's parts for the span `range` of a writer's source: its kept text byte for byte, each
 * field inside it where it stands, and each group whose units lie inside it, outermost first, its
 * units each written the same way, but those of `skip`, the groups the span is inside of already,
 * as a group of one unit is inside its unit, and those written as their parts. A field that a
 * group's unit would cut, or that would follow kept text ending in an escaping backslash, is kept
 * text; a group the model refuses is written as its parts, with no group (`groupTaken`).
 */
function partsIn(
  writer: Writer,
  range: Span,
  skip: ReadonlySet<Placed> = new Set(),
): OutlinePart[] {
  const { source } = writer;
  const parts: OutlinePart[] = [];
  let at = range.start;
  const keep = (to: number) => {
    if (to <= at) return;
    const latex = source.slice(at, to);
    const last = parts.at(-1);
    if (last?.kind === "kept") last.latex += latex;
    else parts.push({ kind: "kept", latex });
    at = to;
  };
  const inside = (span: Span) => span.start >= range.start && span.end <= range.end;
  const groups = writer.groups.filter((group) => !skip.has(group) && inside(group));
  // The outermost: a group no other group here holds, the first of two that span the same.
  const holds = (other: Placed, group: Placed) =>
    other.start <= group.start &&
    other.end >= group.end &&
    (other.start < group.start ||
      other.end > group.end ||
      groups.indexOf(other) < groups.indexOf(group));
  const outer = groups.filter(
    (group) => !groups.some((other) => other !== group && holds(other, group)),
  );
  type Step = { kind: "group"; group: Placed } | { kind: "spot"; spot: Spot };
  const steps: Step[] = [
    ...outer.map((group): Step => ({ kind: "group", group })),
    ...writer.spots
      .filter(
        (spot) =>
          inside(spot) && !outer.some((group) => spot.end > group.start && spot.start < group.end),
      )
      .map((spot): Step => ({ kind: "spot", spot })),
  ].sort(
    (a, b) =>
      (a.kind === "group" ? a.group.start : a.spot.start) -
      (b.kind === "group" ? b.group.start : b.spot.start),
  );
  for (const step of steps) {
    if (step.kind === "spot") {
      const { spot } = step;
      if (spot.start < at) continue;
      keep(spot.start);
      const last = parts.at(-1);
      if (last?.kind === "kept" && endsEscaping(last.latex)) continue;
      parts.push(spot.part);
      writer.written.set(spot.candidate, writer.written.get(spot.candidate) ?? spot.id);
      at = spot.end;
      continue;
    }
    const { group } = step;
    if (group.start < at) continue;
    keep(group.start);
    const n = ++writer.count.groups;
    const id = `g${n}`;
    const within = new Set([...skip, group]);
    const units: OutlineUnit[] = group.units.map((unit, i) => {
      const previous = group.units[i - 1];
      const second = group.units[1];
      const gap =
        previous !== undefined
          ? source.slice(previous.end, unit.start)
          : second !== undefined
            ? source.slice(unit.end, second.start)
            : "\n";
      return { id: `${id}-u${i + 1}`, gap, parts: partsIn(writer, unit, within) };
    });
    const part: OutlinePart = { kind: "group", id, units };
    if (groupTaken(part)) {
      parts.push(part);
      writer.placed.set(id, group.units);
      writer.made.groups++;
      writer.made.units += units.length;
      at = group.end;
      continue;
    }
    // The model refuses it: its units' parts, as they were just written, stand with no group, each
    // after the kept text that parted it from the one before, so that nothing is written twice and
    // a refusal deep in nested groups costs no more than the groups themselves.
    const flat: OutlinePart[] = units.flatMap((unit, i) => [
      ...(i === 0 || unit.gap === "" ? [] : [{ kind: "kept" as const, latex: unit.gap }]),
      ...unit.parts,
    ]);
    for (const each of flat) {
      const last = parts.at(-1);
      if (each.kind === "kept" && last?.kind === "kept") last.latex += each.latex;
      else parts.push(each.kind === "kept" ? { ...each } : each);
    }
    at = group.end;
  }
  keep(range.end);
  return parts;
}

/** What the outline is built from. */
export interface OutlineInput {
  /** The body's tree, whose source is the body from after `\begin{document}`, inputs inlined. */
  tree: Tree;
  /**
   * The preamble's tree and its calls that store a header's text (`Candidates.setters`), whose
   * editable candidates are fields through the calls issued again.
   */
  preamble?: { tree: Tree; setters: readonly Span[] };
  /** The probe's candidates, with their verdicts. */
  candidates: readonly ProbeCandidate[];
  /**
   * The candidates the import's checks keep as text though the probe found them editable, by id:
   * their bytes are kept as the upload wrote them, as any other kept text's.
   */
  kept?: ReadonlySet<string>;
  /** The engine's signatures' macros, which say which template macros open and close a list. */
  macros: EngineSignatures["macros"];
  /** `\begin{document}` and `\end{document}`, as the main file writes them. */
  begin: string;
  end: string;
}

/** An outline, and what it holds. */
export interface Outline {
  parts: OutlinePart[];
  /** Each candidate that is a field, by its id, and its first field's id. */
  fields: ReadonlyMap<string, string>;
  /** Each field, by its id, and the candidate it is a field of. */
  owners: ReadonlyMap<string, string>;
  /**
   * Each group of the body, by its id, and its units' spans in the body's source, which say what a
   * unit's removal takes out of the page (the second pass's item 6).
   */
  groups: ReadonlyMap<string, readonly Unit[]>;
  /** How many fields, groups and units it holds. */
  counts: { fields: number; groups: number; units: number };
}

/** How many fields an outline's parts hold, groups' among them. */
function fieldCount(parts: readonly OutlinePart[]): number {
  let n = 0;
  const stack: (readonly OutlinePart[])[] = [parts];
  for (let list = stack.pop(); list !== undefined; list = stack.pop())
    for (const part of list)
      if (part.kind === "text" || part.kind === "rich") n++;
      else if (part.kind === "group") for (const unit of part.units) stack.push(unit.parts);
  return n;
}

/**
 * The outline of an imported resume (the module's comment): the preamble's calls that store a
 * header's text, issued again with their fields, each on a line, where any of their candidates is
 * editable; `\begin{document}`; the body, its fields where they stand and its groups of units; and
 * `\end{document}`.
 */
export function buildOutline(input: OutlineInput): Outline {
  const editable = input.candidates.filter(
    (each) => each.verdict === "editable" && input.kept?.has(each.id) !== true,
  );
  const written = new Map<string, string>();
  const made = { groups: 0, units: 0 };
  const count = { groups: 0 };
  const placed = new Map<string, readonly Unit[]>();
  const spotted = new Map<string, string>();
  const parts: OutlinePart[] = [];
  const add = (more: readonly OutlinePart[]) => {
    for (const part of more) {
      const last = parts.at(-1);
      if (part.kind === "kept" && last?.kind === "kept") last.latex += part.latex;
      else parts.push(part.kind === "kept" ? { ...part } : part);
    }
  };
  const { preamble } = input;
  const ours = editable.filter((each) => each.where === "preamble");
  if (preamble !== undefined && ours.length > 0) {
    const writer: Writer = {
      source: preamble.tree.source,
      spots: spotsOf(
        preamble.tree.source,
        leavesOf(preamble.tree),
        ours,
        midLineLeaves(preamble.tree),
      ),
      groups: [],
      count,
      written,
      made,
      placed,
    };
    for (const spot of writer.spots) spotted.set(spot.id, spot.candidate);
    for (const call of preamble.setters) {
      add(partsIn(writer, call));
      add([{ kind: "kept", latex: "\n" }]);
    }
  }
  add([{ kind: "kept", latex: input.begin }]);
  const { tree } = input;
  const groups: Placed[] = groupsOf(tree, input.macros).flatMap((group) => {
    const first = group.units[0];
    const last = group.units.at(-1);
    return first === undefined || last === undefined
      ? []
      : [{ start: first.start, end: last.end, units: group.units }];
  });
  const writer: Writer = {
    source: tree.source,
    spots: spotsOf(
      tree.source,
      leavesOf(tree),
      editable.filter((each) => each.where === "body"),
      midLineLeaves(tree),
    ),
    groups,
    count,
    written,
    made,
    placed,
  };
  for (const spot of writer.spots) spotted.set(spot.id, spot.candidate);
  add(partsIn(writer, { start: 0, end: tree.source.length }));
  add([{ kind: "kept", latex: input.end }]);
  closeOpenBraces(parts, input.end);
  // The fields and groups the parts hold: a group the model refused is written as its parts, and
  // what was placed inside it before is not there.
  const owners = new Map<string, string>();
  const spans = new Map<string, readonly Unit[]>();
  for (const step of outlineNodes(parts)) {
    if (step.kind !== "part") continue;
    const { part } = step;
    if (part.kind === "group") {
      const units = placed.get(part.id);
      if (units !== undefined) spans.set(part.id, units);
    } else if (part.kind === "text" || part.kind === "rich") {
      const candidate = spotted.get(part.id);
      if (candidate !== undefined) owners.set(part.id, candidate);
    }
  }
  return {
    parts,
    fields: written,
    owners,
    groups: spans,
    counts: { fields: fieldCount(parts), groups: made.groups, units: made.units },
  };
}

/** The most braces an outline closes for its upload: as many as the parser lets a body nest. */
const MAX_CLOSED = 64;

/**
 * Close, after `\end{document}`, the braces an outline's parts leave open as the model reads them
 * (`outlineOpenBraces`), so that the model holds the outline (the follow-up to decision 0060,
 * `other-0052`). They are a group the upload opens and never closes, as a `{%` whose `}` is in its
 * comment does, which TeX leaves open to `\end{document}`; or a `{` the model counts that TeX
 * never opens, in a `\verb` or a skipped conditional. TeX stops reading at `\end{document}`, so
 * it never reads the braces closed after it: the page is the upload's, settings in an open group
 * still hold as the last page is shipped out, and a brace TeX never opened is never closed twice.
 * Nothing is done to parts that balance, close a brace they never opened, or leave more than
 * `MAX_CLOSED` open, which the model goes on refusing.
 */
function closeOpenBraces(parts: OutlinePart[], end: string) {
  const open = outlineOpenBraces(parts);
  const last = parts.at(-1);
  if (open === undefined || open === 0 || open > MAX_CLOSED) return;
  if (last?.kind !== "kept" || !last.latex.endsWith(end)) return;
  last.latex = `${last.latex}${"}".repeat(open)}`;
}

/**
 * The resume an outline is: a header with no name and no link, which an imported `.tex` keeps in
 * its own LaTeX, and the outline, its one section; or undefined where the model refuses it, as it
 * refuses kept text that holds the editor's own macros or markers, or braces that do not balance.
 */
export function outlineResume(parts: OutlinePart[]): Resume | undefined {
  const read = Resume.safeParse({
    version: 1,
    header: { name: { first: "", last: "" }, links: [] },
    sections: [{ kind: "outline", id: OUTLINE_ID, title: "", role: "other", parts }],
  });
  return read.success ? read.data : undefined;
}

// The package.

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

/** The upload's files a package keeps, as text, by their extension: its classes and styles. */
const PACKAGE_FILES = [".cls", ".sty", ".clo", ".def", ".fd", ".cfg"];

/**
 * The preamble's text with its comments blanked, each character a space, so that a setting read
 * from it is never one a comment holds.
 */
const settingsText = (preamble: string) =>
  preamble.replace(
    /(^|[^\\])((?:\\\\)*)(%.*)$/gm,
    (_, before: string, slashes: string, comment: string) =>
      `${before}${slashes}${" ".repeat(comment.length)}`,
  );

/** What an outline's package is made from. */
export interface OutlinePackageInput {
  engine: Engine;
  /** The main file's preamble, a XeTeX document's with its fonts rewritten to files. */
  preamble: string;
  /** The job's files, by their paths in it, the upload's and a XeTeX rewrite's. */
  files: Readonly<Record<string, Uint8Array>>;
  /** A XeTeX rewrite's families, declared by file after the preamble. */
  fonts?: readonly FontFamily[];
  /** The reference, whose log says whether the document loads hyperref. */
  reference: Pick<Reference, "log">;
}

/** The SHA-256 of a text, as hex. */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The package an outline is set with: the document's preamble, every byte as the document has it
 * but that a `{{` that would begin a tag is broken and control characters go (`snippetText`), with
 * hyperref's lines (`hyperrefLines`) and, where the preamble ends with `@` a letter, its category
 * kept for the body; the upload's classes, styles and the files its preamble inputs, as text, at
 * the job's top; a XeTeX rewrite's families; no control; a document snippet that is the outline
 * alone, `{{sections}}`; and every kind of unit fixed, since nothing of the shared structure, a
 * header's name or link, a section or an entry, reaches the page of an outline (item 8 adds and
 * removes the outline's own units). Its id is `import-` and twelve hex digits of the SHA-256 of the
 * rest of it, so that the same preamble gives the same package, and the same formats.
 */
export async function outlinePackage(input: OutlinePackageInput): Promise<TemplatePackage> {
  const { engine, preamble } = input;
  const atLetter = /\\makeatletter(?![A-Za-z])/.test(settingsText(preamble));
  const hyperref = hyperrefLines(engine, loadsHyperref(input.reference));
  const text = [
    hyperref.before,
    snippetText(preamble).replace(/\s*$/, ""),
    ...(hyperref.after === "" ? [] : [hyperref.after]),
    ...(atLetter ? ["\\expandafter\\chardef\\csname import@at\\endcsname=\\catcode`\\@"] : []),
    "",
  ].join("\n");
  const inputs = new Set(
    [...settingsText(preamble).matchAll(/\\(?:input|include)\s*\{([^}]*)\}/g)].map((found) => {
      const name = (found[1] ?? "").trim();
      return extensionOf(name) === "" ? `${name}.tex` : name;
    }),
  );
  const files: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(input.files)) {
    if (path.includes("/")) continue;
    if (PACKAGE_FILES.includes(extensionOf(path).toLowerCase()) || inputs.has(path))
      files[path] = decodeText(bytes);
  }
  for (const [name, latex] of Object.entries(COMPATIBILITY[engine])) files[name] ??= latex;
  const fields: Omit<TemplatePackage, "id"> = {
    version: 1,
    name: "Imported resume",
    engine,
    // The template's, never the upload's own file name, which is the person's as often as not.
    source: { url: "main.tex", license: "", attribution: "" },
    files,
    ...(input.fonts === undefined || input.fonts.length === 0 ? {} : { fonts: [...input.fonts] }),
    preamble: text,
    controls: {},
    snippets: {
      document: `${atLetter ? "\\catcode`\\@=\\csname import@at\\endcsname\\relax\n" : ""}{{sections}}`,
      header: "",
      link: { other: "{{label}}" },
      section: { entries: "", list: "", labelled: "", paragraph: "" },
      entry: "",
      bullet: "",
      item: "",
      labelledItem: "",
      separators: {
        sections: "\n",
        links: "\n",
        contacts: "\n",
        entries: "\n",
        bullets: "\n",
        items: "\n",
      },
    },
    fixed: [...UNIT_KINDS],
  };
  const hash = await sha256(JSON.stringify(fields));
  return TemplatePackage.parse({ id: `${IMPORTED_PREFIX}${hash.slice(0, 12)}`, ...fields });
}

// What the report counts.

/** The texts of each page's glyphs, by the index the probe's runs count them by. */
const glyphTexts = (reference: Pick<GlyphStream, "pages">) =>
  reference.pages.map((page) =>
    page.items.flatMap((item) => (item.kind === "glyph" ? [item.text] : [])),
  );

/**
 * How many of each run's glyphs a candidate the outline holds in part keeps at its start as kept
 * text (`LEADS`), counted through its runs in the page's order, for those of `fielded`: a first
 * line the outline kept as the upload wrote it. Its glyphs are those that spell its text from the
 * candidate's first, a hyphen TeX added among them (`spelledFrom`), where `texts` gives the
 * page's glyphs and they spell it; otherwise the most it sets (`glyphsAtMost`).
 */
function leadingOf(
  runs: readonly UncoveredRun[],
  candidates: readonly Pick<ProbeCandidate, "id">[],
  fielded: (id: string) => boolean,
  texts?: readonly (readonly (string | undefined)[])[],
): Map<UncoveredRun, number> {
  const leads = new Map<string, Lead>();
  for (const each of candidates) {
    const lead = LEADS.get(each);
    if (lead !== undefined && fielded(each.id)) leads.set(each.id, lead);
  }
  const found = new Map<UncoveredRun, number>();
  if (leads.size === 0) return found;
  const ordered = runs
    .filter((run) => run.by === "candidate" && leads.has(run.candidate ?? ""))
    .sort((a, b) => a.page - b.page || a.from - b.from);
  const left = new Map<string, number>();
  for (const [id, lead] of leads) {
    let n = 0;
    if (texts !== undefined) {
      const drawn = ordered
        .filter((run) => run.candidate === id)
        .flatMap((run) => {
          const row = texts[run.page] ?? [];
          return row.slice(Math.max(0, run.from), Math.min(run.to, row.length));
        });
      n = spelledFrom(lead.text, drawn);
    }
    left.set(id, n > 0 ? n : lead.most);
  }
  for (const run of ordered) {
    const id = run.candidate ?? "";
    const n = Math.min(left.get(id) ?? 0, Math.max(0, run.to - run.from));
    if (n <= 0) continue;
    found.set(run, n);
    left.set(id, (left.get(id) ?? 0) - n);
  }
  return found;
}

/**
 * What sets each run of the reference's glyphs, as the report reads it (`GlyphOwner`): the probe's
 * runs, each a field's where its candidate is one (`Outline.fields`), by the field's name; kept
 * text where it is not, with the reason the import's checks kept it for (`checked`), or the probe's,
 * `shape` for an editable candidate the outline could not make a field, and `raw` for a raw chunk;
 * and the template's own text otherwise.
 */
export function ownersOf(
  runs: readonly UncoveredRun[],
  candidates: readonly ProbeCandidate[],
  fields: ReadonlyMap<string, string>,
  checked: ReadonlyMap<string, LockReason> = new Map(),
  reference?: Pick<GlyphStream, "pages">,
): GlyphOwner[] {
  const byId = new Map(candidates.map((each) => [each.id, each]));
  const leading = leadingOf(
    runs,
    candidates,
    (id) => fields.has(id),
    reference === undefined ? undefined : glyphTexts(reference),
  );
  return runs.flatMap((run): GlyphOwner[] => {
    const at = { page: run.page, from: run.from, to: run.to };
    if (run.by === "raw") return [{ ...at, kept: "raw" }];
    if (run.by !== "candidate" || run.candidate === undefined) return [];
    const field = fields.get(run.candidate);
    // A first line kept as text, at the start of a candidate the outline holds in part.
    const lead = leading.get(run);
    if (field !== undefined && lead !== undefined)
      return [
        { ...at, to: run.from + lead, kept: "shape" },
        ...(run.from + lead < run.to
          ? [{ ...at, from: run.from + lead, field: `${field}.text` }]
          : []),
      ];
    if (field !== undefined) return [{ ...at, field: `${field}.text` }];
    const verdict = byId.get(run.candidate)?.verdict;
    const reason: LockReason =
      checked.get(run.candidate) ??
      (verdict === undefined || verdict === "editable" || verdict === "container"
        ? "shape"
        : verdict);
    return [{ ...at, kept: reason }];
  });
}

/** The page's words, each set down to what sets most of its glyphs, as the report counts them. */
export interface Words {
  /** The resume's: every word of the page but the template's own. */
  body: number;
  /** In a candidate the probe found editable. */
  probe: number;
  /** In a field of the outline. */
  fields: number;
  /** In kept text whose words line up with runs of plain text the retype offers (decision 0042). */
  retype: number;
  /** In kept text the retype does not reach. */
  locked: number;
  /** The template's own text, no word of the resume's. */
  template: number;
}

/** What `reachOf` and `wordsOf` read the page's words from. */
export interface WordsInput {
  reference: Pick<GlyphStream, "pages">;
  runs: readonly UncoveredRun[];
  candidates: readonly Pick<ProbeCandidate, "id" | "where" | "start" | "end" | "verdict">[];
  fields: ReadonlySet<string>;
  sources: { body: string; preamble: string };
}

/**
 * The page's words, and what sets each glyph, as `wordsOf` counts them: each page's words
 * (`pageWords`); each glyph's owner by a key, a field's (`f:`, by its candidate), a kept part's
 * (`p:`, a candidate's or a raw chunk's) or the template's (`t`), a running line a kept part sets
 * that part's on every page (`ownRunningLines`); and which glyphs of kept text the retype reaches
 * (`reached`): a kept part's LaTeX's runs of plain text lined up with its glyphs in the order the
 * pages paint them (`retypeOf`, decision 0042).
 */
export function reachOf(input: WordsInput): {
  pages: ReturnType<typeof pageWords>;
  owners: string[][];
  reached: boolean[][];
} {
  const { reference, runs, fields, sources } = input;
  const byId = new Map(input.candidates.map((each) => [each.id, each]));
  const lowered = `${sources.body}\n${sources.preamble}`.toLowerCase();
  const pages = pageWords(reference, (before, after) =>
    lowered.includes(`${before}-${after}`.toLowerCase()),
  );
  const glyphs = reference.pages.map((page) =>
    page.items.flatMap((item) => (item.kind === "glyph" ? [item] : [])),
  );
  const owners = pages.map((read) => new Array<string>(read.texts.length).fill("t"));
  const leading = leadingOf(runs, input.candidates, (id) => fields.has(id), glyphTexts(reference));
  for (const run of runs) {
    const row = owners[run.page];
    if (row === undefined) continue;
    const lead = leading.get(run) ?? 0;
    const key =
      run.by === "candidate" && run.candidate !== undefined
        ? fields.has(run.candidate)
          ? `f:${run.candidate}`
          : `p:c:${run.candidate}`
        : run.by === "raw" && run.raw !== undefined
          ? `p:r:${run.raw.start}:${run.raw.end}`
          : "t";
    for (let at = Math.max(0, run.from); at < Math.min(run.to, row.length); at++)
      row[at] = at < run.from + lead ? `p:c:${run.candidate}` : key;
  }
  ownRunningLines(glyphs, owners);
  /** A kept part's LaTeX, from its owner's key. */
  const latexOf = (key: string): string | undefined => {
    if (key.startsWith("p:r:")) {
      const [start, end] = key.slice(4).split(":").map(Number);
      return sources.body.slice(start, end);
    }
    const candidate = byId.get(key.slice(4));
    return candidate === undefined
      ? undefined
      : sources[candidate.where].slice(candidate.start, candidate.end);
  };
  // Each kept part's glyphs, in the order the pages paint them, and those the retype reaches.
  const parts = new Map<string, { page: number; at: number }[]>();
  owners.forEach((row, page) =>
    row.forEach((key, at) => {
      if (!key.startsWith("p:")) return;
      const list = parts.get(key) ?? [];
      list.push({ page, at });
      parts.set(key, list);
    }),
  );
  const reached = owners.map((row) => new Array<boolean>(row.length).fill(false));
  for (const [key, places] of parts) {
    const latex = latexOf(key);
    if (latex === undefined) continue;
    const drawn = places.map(
      ({ page, at }) => ({ text: glyphs[page]?.[at]?.text, locked: "part" }) as GlyphBox,
    );
    const found = retypeOf({ id: "part", latex }, [{ glyphs: drawn }]);
    if (!isRetype(found)) continue;
    for (const piece of found.pieces)
      for (let k = piece.from; k < piece.to; k++) {
        const place = places[k];
        const row = place === undefined ? undefined : reached[place.page];
        if (place !== undefined && row !== undefined) row[place.at] = true;
      }
  }
  return { pages, owners, reached };
}

/**
 * The glyphs of kept text the retype reaches (`reachOf`), as runs of them on each page, which the
 * report counts the words the retype reaches by (`AssemblyChecks.retype`).
 */
export function reachedRuns(
  reached: readonly (readonly boolean[])[],
): { page: number; from: number; to: number }[] {
  const found: { page: number; from: number; to: number }[] = [];
  reached.forEach((row, page) => {
    let from = -1;
    for (let at = 0; at <= row.length; at++) {
      if (row[at] === true) {
        if (from < 0) from = at;
      } else if (from >= 0) {
        found.push({ page, from, to: at });
        from = -1;
      }
    }
  });
  return found;
}

/**
 * The page's words (`pageWords`, decision 0039), each set down to what sets most of its glyphs, as
 * the probe's runs say (`Probe.runs`): a field of the outline (`fields`, by candidate's id); kept
 * text, a locked candidate, an editable one the outline keeps, or a raw chunk; or the template's
 * own text (`reachOf`, which `reach` is where the caller has read it already). A word of kept text
 * whose glyphs are most of them in a run the retype offers is one the retype reaches. As the spike
 * counted them (decision 0050).
 */
export function wordsOf(input: WordsInput, reach = reachOf(input)): Words {
  const byId = new Map(input.candidates.map((each) => [each.id, each]));
  const { pages, owners, reached } = reach;
  const words: Words = { body: 0, probe: 0, fields: 0, retype: 0, locked: 0, template: 0 };
  pages.forEach((read, page) => {
    const row = owners[page] ?? [];
    for (const word of read.words) {
      const tally = new Map<string, number>();
      for (const at of word.glyphs) {
        const key = row[at] ?? "t";
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      let key = "t";
      let most = 0;
      for (const [each, n] of tally)
        if (n > most) {
          key = each;
          most = n;
        }
      if (key === "t") {
        words.template++;
        continue;
      }
      words.body++;
      if (key.startsWith("f:")) {
        words.fields++;
        words.probe++;
        continue;
      }
      if (key.startsWith("p:c:") && byId.get(key.slice(4))?.verdict === "editable") words.probe++;
      const hit = word.glyphs.filter((at) => reached[page]?.[at] === true).length;
      if (2 * hit > word.glyphs.length) words.retype++;
      else words.locked++;
    }
  });
  return words;
}
