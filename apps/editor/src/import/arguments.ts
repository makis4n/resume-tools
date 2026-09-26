/**
 * Reading a command's arguments off unified-latex's nodes by an argument specification, as TeX
 * reads them, with where each argument is in the body (milestone 3 item 4, decision 0020).
 *
 * unified-latex's own reader (`gobbleSingleArgument`) finds a bracketed or otherwise delimited
 * argument; around it this reads what TeX reads and it does not. TeX takes one token for an
 * argument that is not braced, so a word after an accent gives its first letter and the rest stays
 * text (`\'etude`). TeX passes over spaces and comments before an argument, but not a blank line,
 * which is a paragraph's end. And every argument keeps its span in the body, delimiters and all,
 * so that the printer can give back its bytes and a later step splice at it.
 *
 * Reading leaves the array it reads where it is and says where the arguments end (`next`): taking
 * the nodes out, as unified-latex's reader does, costs the length of the array for every command,
 * which a body of many short calls makes quadratic. The one change it makes is where a token is
 * split off a string, whose rest takes the string's place. It keeps what it read for the command
 * (`readArguments`), so that a command whose text cannot be decoded is placed with the arguments
 * already read, and none is read twice.
 */

import type * as Ast from "@unified-latex/unified-latex-types";
import { type ArgSpecAst, parse as parseSpec } from "@unified-latex/unified-latex-util-argspec";
import { gobbleSingleArgument } from "@unified-latex/unified-latex-util-arguments";

/** An argument as read: what kind it is, whether the source gives it, and where it is. */
export interface ReadArgument {
  kind: "mandatory" | "optional" | "star" | "token";
  /** Whether the source gives it; a mandatory argument is always given, or reading stopped. */
  present: boolean;
  /** Its span, delimiters included; an absent one is empty, where it would have started. */
  start: number;
  end: number;
  /** Its delimiters, `{` and `}` or `[` and `]`, or empty for a single token or a star. */
  open: string;
  close: string;
  /** The nodes it holds, between its delimiters: a group's content, or the one token. */
  content: Ast.Node[];
  /** The span of what it holds, between its delimiters. */
  innerStart: number;
  innerEnd: number;
}

/** A command's arguments as read, whether every mandatory one was there, and where they end. */
export interface Read {
  args: ReadArgument[];
  /** False when a mandatory argument was missing: reading stopped there. */
  complete: boolean;
  /** The index in the array read of the first node after the arguments. */
  next: number;
}

/** The start and end of a node in the body, or undefined for one unified-latex gave none. */
export function spanOf(node: Ast.Node | undefined): { start: number; end: number } | undefined {
  if (node === undefined || typeof node !== "object" || node.position === undefined)
    return undefined;
  return { start: node.position.start.offset, end: node.position.end.offset };
}

/** A node's start in the body; -1 for one without a position. */
export const startOf = (node: Ast.Node | undefined) => spanOf(node)?.start ?? -1;

/** A node's end in the body; -1 for one without a position. */
export const endOf = (node: Ast.Node | undefined) => spanOf(node)?.end ?? -1;

const specs = new Map<string, ArgSpecAst.Node[] | undefined>();

/** The kinds of argument this reader takes. */
const READABLE = new Set(["mandatory", "optional", "optionalStar", "optionalToken"]);

/**
 * An argument specification as unified-latex reads it, or undefined for one it cannot read or
 * whose arguments this reader does not take: verbatim, until a delimiter, embellishments.
 */
export function readSpec(spec: string): ArgSpecAst.Node[] | undefined {
  if (specs.has(spec)) return specs.get(spec);
  let nodes: ArgSpecAst.Node[] | undefined;
  try {
    nodes = parseSpec(spec);
  } catch {
    nodes = undefined;
  }
  if (nodes?.some((node) => !READABLE.has(node.type))) nodes = undefined;
  specs.set(spec, nodes);
  return nodes;
}

/** Whether a specification can be read whole. */
export const isReadable = (spec: string) => readSpec(spec) !== undefined;

const reads = new WeakMap<Ast.Node, Read>();

/**
 * The arguments of a command whose next node is `nodes[at]`, by a specification: a macro's, at
 * `at - 1`, or an environment's, whose content `nodes` is, from 0. `from` is where the command
 * ends in the body, where an argument the source leaves out is taken to be. Undefined when the
 * specification cannot be read. A command read before, its `owner` given, gives back what it read
 * the first time.
 */
export function readArguments(
  nodes: Ast.Node[],
  at: number,
  spec: string,
  from: number,
  owner?: Ast.Node,
): Read | undefined {
  if (owner !== undefined) {
    const done = reads.get(owner);
    if (done !== undefined) return done;
  }
  const parts = readSpec(spec);
  if (parts === undefined) return undefined;
  const args: ReadArgument[] = [];
  let complete = true;
  let where = from;
  let next = at;
  for (const part of parts) {
    const found = readOne(nodes, next, part, where);
    if (found === undefined) {
      complete = false;
      break;
    }
    args.push(found.arg);
    next = found.next;
    if (found.arg.present) where = found.arg.end;
  }
  const read = { args, complete, next };
  if (owner !== undefined) reads.set(owner, read);
  return read;
}

/** Whether a node is one TeX passes over before an argument: a space or a comment. */
const skippable = (node: Ast.Node | undefined) =>
  node !== undefined &&
  typeof node === "object" &&
  (node.type === "whitespace" || node.type === "comment");

/** The index of the first node at or after `at` that is not a space or a comment. */
function past(nodes: readonly Ast.Node[], at: number): number {
  let i = at;
  while (skippable(nodes[i])) i++;
  return i;
}

/**
 * Split a string node at `i` after its first `take` code units: the first part is given back, and
 * the rest takes the node's place in the array, each with its span, as TeX takes one token where
 * an argument is not braced. The node itself when it is that long exactly; undefined when it is
 * not a string, or shorter.
 */
export function splitAt(nodes: Ast.Node[], i: number, take: number): Ast.String | undefined {
  const node = nodes[i];
  if (node?.type !== "string" || node.position === undefined || take <= 0) return undefined;
  if (node.content.length < take) return undefined;
  if (node.content.length === take) return node;
  const start = node.position.start;
  const cut = start.offset + take;
  const first: Ast.String = {
    type: "string",
    content: node.content.slice(0, take),
    position: {
      start,
      end: { offset: cut, line: start.line, column: start.column + take },
    },
  };
  nodes[i] = {
    type: "string",
    content: node.content.slice(take),
    position: {
      start: { offset: cut, line: start.line, column: start.column + take },
      end: node.position.end,
    },
  };
  return first;
}

/** The length in code units of a string's first character, a surrogate pair counting as one. */
const firstLength = (text: string) => {
  const code = text.codePointAt(0);
  return code !== undefined && code > 0xffff ? 2 : 1;
};

/** An argument as read, with the index after it. */
interface Found {
  arg: ReadArgument;
  next: number;
}

/**
 * Read one argument at `at`; undefined for a mandatory one not there. One left out is empty at
 * `where`, the end of what came before it, and takes no node.
 */
function readOne(
  nodes: Ast.Node[],
  at: number,
  part: ArgSpecAst.Node,
  where: number,
): Found | undefined {
  const skipsSpace = !("noLeadingWhitespace" in part && part.noLeadingWhitespace === true);
  const i = skipsSpace ? past(nodes, at) : at;
  const target = nodes[i];
  const absent = (kind: ReadArgument["kind"], open = "", close = ""): Found => ({
    arg: {
      kind,
      present: false,
      start: where,
      end: where,
      open,
      close,
      content: [],
      innerStart: where,
      innerEnd: where,
    },
    next: at,
  });
  /** An argument of one node, a token or a group, which reading goes on after. */
  const single = (
    kind: ReadArgument["kind"],
    node: Ast.Node,
    delimiters: [open: string, close: string],
    content: Ast.Node[],
    next: number,
  ): Found => {
    const span = spanOf(node) ?? { start: where, end: where };
    const [open, close] = delimiters;
    return {
      arg: {
        kind,
        present: true,
        ...span,
        open,
        close,
        content,
        innerStart: span.start + open.length,
        innerEnd: span.end - close.length,
      },
      next,
    };
  };
  if (part.type === "optionalStar" || part.type === "optionalToken") {
    const token = part.type === "optionalStar" ? "*" : part.token;
    const kind = part.type === "optionalStar" ? "star" : "token";
    if (target?.type !== "string" || !target.content.startsWith(token)) return absent(kind);
    const taken = splitAt(nodes, i, token.length);
    if (taken === undefined) return absent(kind);
    return single(kind, taken, ["", ""], [taken], taken === target ? i + 1 : i);
  }
  if (part.type !== "mandatory" && part.type !== "optional") return undefined;
  const open = part.openBrace;
  const close = part.closeBrace;
  if (part.type === "mandatory" && open === "{") {
    // A braced group, or else one token: a string's first character, or a command alone.
    if (target === undefined || typeof target !== "object") return undefined;
    if (target.type === "group")
      return single("mandatory", target, ["{", "}"], target.content, i + 1);
    if (target.type === "macro") return single("mandatory", target, ["", ""], [target], i + 1);
    if (target.type !== "string") return undefined;
    const taken = splitAt(nodes, i, firstLength(target.content));
    if (taken === undefined) return undefined;
    return single("mandatory", taken, ["", ""], [taken], taken === target ? i + 1 : i);
  }
  // A delimited argument, `[...]` or another pair, which unified-latex's reader matches, given
  // only the nodes up to the first that closes it, so that it takes none out of the array.
  const kind = part.type === "optional" ? "optional" : "mandatory";
  const missing = () => (kind === "optional" ? absent(kind, open, close) : undefined);
  if (target?.type !== "string" || !target.content.startsWith(open)) return missing();
  const first = splitAt(nodes, i, open.length);
  if (first === undefined) return missing();
  const rest = first === target ? i + 1 : i;
  let stop = rest;
  for (; stop < nodes.length; stop++) {
    const node = nodes[stop];
    if (node?.type === "parbreak") return missing();
    if (node?.type === "string" && node.content.startsWith(close)) break;
  }
  const closing = splitAt(nodes, stop, close.length);
  if (closing === undefined) return missing();
  // unified-latex's reader takes what it reads out of the window it is given.
  const window = [first, ...nodes.slice(rest, stop), closing];
  const size = window.length;
  const { argument, nodesRemoved } = gobbleSingleArgument(window, part, 0);
  if (argument === null || nodesRemoved !== size) return missing();
  return {
    arg: {
      kind,
      present: true,
      start: startOf(first),
      end: endOf(closing),
      open,
      close,
      content: argument.content,
      innerStart: endOf(first),
      innerEnd: startOf(closing),
    },
    // A closing token split off a longer string leaves the rest in its place, read next.
    next: nodes[stop] === closing ? stop + 1 : stop,
  };
}
