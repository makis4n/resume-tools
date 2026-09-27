/**
 * What the probe (milestone 3 item 5, decision 0022) wraps in markers: the candidates, found in a
 * body's tree (`parse.ts`), and the source that wraps a set of them.
 *
 * A candidate is a part of the body a package could mark as a field, which the probe asks the
 * engine about: every argument of every call to a template macro and of every template
 * environment, and every standard node an assembled package marks anyway, a section's title, a
 * list item's text and its label, and a paragraph of rich text. Its text is its rich runs joined,
 * or a date as the document spells it, paragraphs apart by a space.
 *
 * A candidate that holds a raw chunk anywhere in it is not probed: it is locked (`raw`), and the
 * paragraphs of rich text inside it are candidates of their own, as the title and the subtitle of a
 * projects heading are either side of the `$|$` between them. Nor is one that holds structure,
 * another call that takes arguments, an environment, a list, an item or a section: it is a
 * `container`, as an entry's argument that holds its bullets' list is, whose parts are candidates
 * of their own. What is left holds text and dates alone, in groups and blocks, and calls that take
 * no argument, as an icon is, whose glyphs its field must then account for.
 *
 * A preamble sets a header through calls that store their arguments in macros, as Awesome-CV's
 * and moderncv's `\name{...}{...}` does, which the class sets when the body calls for the header.
 * A call at the preamble's top level to a template macro that stores each of its arguments before
 * anything else, and names none after (`isSetter`), is a candidate's too: the probe issues every
 * such call again after the preamble, each argument it wraps in its markers, which stores the same
 * text with them (`reissued`).
 *
 * Each candidate has an id the markers carry: lowercase letters, digits and dashes, from the index
 * of its call, environment, section, item or paragraph among those of its kind in the body, in the
 * order of the source, and its argument's place in the signature, from 1, as TeX numbers them:
 * `c12-3` is the twelfth call's third argument, `e2-1` an environment's, `s4` a section's title,
 * `i7` an item's text and `i7-l` its label, `t9` a paragraph, and `h1-2` and `ht3` a preamble
 * call's argument and a paragraph inside one. The same tree gives the same ids.
 *
 * Wrapping a candidate puts `\rtfield{<id>}{` and `}` around its span: an argument's content from
 * its first node to its last, so that the spaces around the text stay where TeX read them, or, for
 * an empty one, nothing at the start of its content; inside a group that is all of it, past the
 * spaces TeX passes over in vertical mode (`tightened`); and an argument given as one token,
 * without braces, in braces with its markers. Where the span ends in a control word, the spaces
 * after it, which TeX skipped, go inside, so that none of them is set after the field's end. Spans
 * never nest: a field holds no candidate, and one that would is a container or raw, never wrapped.
 */

import type { Argument, Node, RawWhy, Span, Tree } from "./parse";
import { readMeaning, type TemplateMacro, tokensOf } from "./signatures";

/** What a candidate is. */
export type CandidateKind = "argument" | "section" | "item" | "label" | "paragraph";

/** A candidate for a field, and what the probe needs to wrap it and read it back. */
export interface Candidate {
  id: string;
  kind: CandidateKind;
  /** Where its span is: the body, or a call of the preamble's the probe issues again. */
  where: "body" | "preamble";
  /** For an argument, whose it is: a template macro's call, or a template environment's. */
  of?: "call" | "environment";
  /**
   * The macro's or the environment's name for an argument, the section command's for a title, the
   * list's or the environment's an item is in for an item or a label, and none for a paragraph.
   */
  name: string;
  /** For an argument, its place in the signature, from 1, as TeX numbers parameters. */
  index?: number;
  /** The span it wraps, in the body's source or the preamble's. */
  start: number;
  end: number;
  /** An argument given as one token, without braces, which its markers go around in braces. */
  bare?: true;
  /** Its text: its runs joined, or a date as the document spells it, paragraphs apart by a space. */
  text: string;
  /** Whether its text is empty, or spaces alone. */
  empty: boolean;
  /** Why it is not probed: it holds a raw chunk, or it holds structure. */
  unprobed?: "raw" | "container";
  /** The candidate it is a part of, for a paragraph inside one that is not probed. */
  within?: string;
  /** For a preamble candidate, the index of its call in `Candidates.setters`. */
  call?: number;
}

/** The candidates of a body, and the preamble's calls that store a header's text. */
export interface Candidates {
  candidates: Candidate[];
  /** The preamble's calls to macros that store their arguments, at its top level, in order. */
  setters: Span[];
  /** The raw chunks of the body that may set text, in the source's order, outermost only. */
  raw: RawChunk[];
}

/** A raw chunk of the body, which may explain glyphs no field covers. */
export interface RawChunk extends Span {
  why: RawWhy;
  name?: string;
}

/**
 * Commands that set no glyph, which a raw chunk of them alone cannot explain one by: spaces,
 * breaks, sizes, font switches, colours, rules and the page's layout. What else a raw chunk
 * holds may set glyphs, as mathematics, typewriter text or `\today` do.
 */
const SETS_NOTHING: ReadonlySet<string> = new Set([
  ...["vspace", "hspace", "vskip", "hskip", "kern", "\\", "newline", "linebreak", "par"],
  ...["smallskip", "medskip", "bigskip", "hfill", "vfill", "hfil", "vfil", "noindent"],
  ...["indent", "centering", "raggedright", "raggedleft", "newpage", "clearpage", "pagebreak"],
  ...["nopagebreak", "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large"],
  ...["Large", "LARGE", "huge", "Huge", "color", "normalfont", "rmfamily", "sffamily"],
  ...["mdseries", "upshape", "slshape", "scshape", "rm", "sf", "sl", "sc", "setlength"],
  ...["addtolength", "label", "phantomsection", "pagestyle", "thispagestyle", "rule", "hrule"],
  ...["vrule", "hline", "quad", "qquad", "enskip", "enspace", "thinspace", ",", ";", " "],
  ...["columnbreak", "vfilneg", "strut", "leavevmode", "relax", "ignorespaces", "unskip"],
]);

/** Whether a raw chunk may set glyphs of its own, and so explain some no field covers. */
export function maySetText(node: { why: RawWhy; name?: string }): boolean {
  if (node.why === "definition" || node.why === "skipped") return false;
  return node.why !== "command" || !SETS_NOTHING.has(node.name ?? "");
}

/** Whether an argument is one a field could be: given, and mandatory or optional, not a star. */
const isTextArgument = (arg: Argument) =>
  arg.present && (arg.kind === "mandatory" || arg.kind === "optional") && arg.content !== undefined;

/** Whether a call's arguments give any text: a call that takes none sets text of its own, if any. */
const takesArguments = (node: { args: readonly Argument[] }) => node.args.some(isTextArgument);

/**
 * Whether nodes hold structure: a call that is given arguments, an environment, a list, an item or
 * a section, anywhere in them, through groups, blocks and raw chunks' placed arguments.
 */
function holdsStructure(nodes: readonly Node[]): boolean {
  return nodes.some((node) => {
    switch (node.kind) {
      case "call":
        return takesArguments(node);
      case "environment":
      case "list":
      case "item":
      case "section":
        return true;
      case "group":
      case "block":
        return holdsStructure(node.content);
      case "raw":
        return (node.args ?? []).some(
          (arg) => arg.content !== undefined && holdsStructure(arg.content),
        );
      default:
        return false;
    }
  });
}

/** Whether nodes hold a raw chunk anywhere in them, through groups and blocks. */
function holdsRaw(nodes: readonly Node[]): boolean {
  return nodes.some(
    (node) =>
      node.kind === "raw" ||
      ((node.kind === "group" || node.kind === "block") && holdsRaw(node.content)),
  );
}

/** The text of nodes that hold text alone: their runs joined, and dates as they read. */
function textOf(nodes: readonly Node[]): string {
  const parts: string[] = [];
  const walk = (list: readonly Node[]) => {
    for (const node of list) {
      if (node.kind === "text") parts.push(node.runs.map((run) => run.text).join(""));
      else if (node.kind === "date") parts.push(node.text);
      else if (node.kind === "group" || node.kind === "block") walk(node.content);
    }
  };
  walk(nodes);
  return parts.join(" ");
}

/** Whether the brace at `open` is closed by the one at `close`, and by no brace before it. */
function closes(source: string, open: number, close: number): boolean {
  let depth = 0;
  for (let at = open; at <= close; at++) {
    const char = source[at];
    if (char === "\\") at++;
    else if (char === "%") {
      const newline = source.indexOf("\n", at);
      if (newline < 0 || newline > close) return false;
      at = newline;
    } else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return at === close;
  }
  return false;
}

/**
 * A span as a field's markers go around it: inside a group that is all of it, and inside the
 * spaces and comments at its start and the spaces at its end, so that a group's first space, which
 * TeX passes over in vertical mode, is not set after the field's begin marker has started a
 * paragraph (`\rtfield` begins with `\leavevmode`).
 */
export function tightened(source: string, span: Span): Span {
  let { start, end } = span;
  for (;;) {
    for (;;) {
      while (start < end && /\s/.test(source[start] ?? "")) start++;
      if (source[start] !== "%") break;
      const newline = source.indexOf("\n", start);
      if (newline < 0 || newline >= end) break;
      start = newline + 1;
    }
    while (end > start && /\s/.test(source[end - 1] ?? "")) end--;
    if (end - start < 2 || source[start] !== "{" || !closes(source, start, end - 1)) break;
    start++;
    end--;
  }
  return { start, end };
}

/** The span of nodes, from the first's start to the last's end; none for no nodes. */
function spanOf(nodes: readonly Node[]): Span | undefined {
  const first = nodes[0];
  const last = nodes.at(-1);
  return first === undefined || last === undefined
    ? undefined
    : { start: first.start, end: last.end };
}

/**
 * Whether a template macro stores its arguments, as a preamble's `\name{...}{...}` does for the
 * header the class sets later: its replacement text begins, spaces aside, with `\def` or `\gdef`,
 * either after `\global` or `\long`, a control sequence and a group holding one parameter alone,
 * for each of its parameters once; and what follows names no parameter, so that it works from what
 * was stored, as Awesome-CV's `\mobile` makes the `tel:` address from the number it stored. Such a
 * macro does the same when it is called again with the same arguments, so the probe can issue its
 * calls again after the preamble. A macro with an optional argument, or xparse's, is not read, and
 * its calls are not candidates.
 */
export function isSetter(macro: TemplateMacro | { kind: "data" } | undefined): boolean {
  if (macro === undefined || macro.kind === "data") return false;
  const meaning = readMeaning(macro.meaning);
  if (meaning.kind !== "macro" || !/^(?:#\d)+$/.test(meaning.parameters)) return false;
  const parameters = meaning.parameters.length / 2;
  const tokens = tokensOf(meaning.replacement).filter(
    (token) => !(token.kind === "char" && token.text === " "),
  );
  const stored = new Set<string>();
  let at = 0;
  for (;;) {
    let next = at;
    while (tokens[next]?.kind === "cs" && /^(?:global|long)$/.test(nameOf(tokens[next]))) next++;
    const [def, target, open, parameter, close] = tokens.slice(next, next + 5);
    const assigns =
      def?.kind === "cs" &&
      /^g?def$/.test(def.name) &&
      target?.kind === "cs" &&
      open?.kind === "open" &&
      parameter?.kind === "parameter" &&
      parameter.text !== "##" &&
      !stored.has(parameter.text) &&
      close?.kind === "close";
    if (!assigns) break;
    stored.add(parameter.text);
    at = next + 5;
  }
  if (stored.size !== parameters) return false;
  return tokens.slice(at).every((token) => token.kind !== "parameter" || token.text === "##");
}

const nameOf = (token: { kind: string; name?: string } | undefined) => token?.name ?? "";

/** Options for finding candidates. */
export interface CandidateOptions {
  /** The preamble's tree, whose calls to `setters` at its top level are candidates. */
  preamble?: Tree;
  /** The template macros that store their arguments (`isSetter`), by name. */
  setters?: ReadonlySet<string>;
}

/**
 * Every candidate of a body's tree, in the order of the source, and the preamble's calls to the
 * macros that store a header's text, whose arguments are candidates too (`CandidateOptions`).
 */
export function candidatesOf(tree: Tree, options: CandidateOptions = {}): Candidates {
  const candidates: Candidate[] = [];
  const raw: RawChunk[] = [];
  const counts = { call: 0, environment: 0, section: 0, item: 0, text: 0, preamble: 0, part: 0 };

  /** A paragraph of rich text, a text or a date node no field holds. */
  const paragraph = (
    node: Node & { kind: "text" | "date" },
    where: Candidate["where"],
    within?: string,
  ) => {
    const text = textOf([node]);
    const id = where === "preamble" ? `ht${++counts.part}` : `t${++counts.text}`;
    const source = where === "preamble" ? (options.preamble?.source ?? "") : tree.source;
    const span = tightened(source, node);
    candidates.push({
      id,
      kind: "paragraph",
      where,
      name: "",
      start: span.start,
      end: span.end,
      text,
      empty: text.trim() === "",
      ...(within === undefined ? {} : { within }),
    });
  };

  /**
   * A candidate whose content is `content`: a field when it holds text alone, and otherwise one
   * that is not probed, whose parts are walked for candidates of their own.
   */
  const part = (
    base: Omit<Candidate, "start" | "end" | "text" | "empty" | "unprobed">,
    content: readonly Node[],
    empty: Span,
    bare: boolean,
  ) => {
    const unprobed = holdsStructure(content) ? "container" : holdsRaw(content) ? "raw" : undefined;
    const spanned = spanOf(content);
    const source = base.where === "preamble" ? (options.preamble?.source ?? "") : tree.source;
    const span = spanned === undefined || bare ? (spanned ?? empty) : tightened(source, spanned);
    const text = unprobed === undefined ? textOf(content) : "";
    candidates.push({
      ...base,
      start: span.start,
      end: span.end,
      ...(bare ? { bare: true as const } : {}),
      text,
      empty: unprobed === undefined && text.trim() === "",
      ...(unprobed === undefined ? {} : { unprobed }),
    });
    if (unprobed !== undefined) walk(content, base.where, base.id, undefined);
  };

  /** An argument's candidate: the span of its content, or where its content would start. */
  const argument = (
    base: Omit<Candidate, "start" | "end" | "text" | "empty" | "unprobed">,
    arg: Argument,
  ) =>
    part(
      base,
      arg.content ?? [],
      { start: arg.innerStart, end: arg.innerStart },
      arg.open === "" && (arg.content?.length ?? 0) > 0,
    );

  const walk = (
    nodes: readonly Node[],
    where: Candidate["where"],
    within: string | undefined,
    list: string | undefined,
  ) => {
    for (const node of nodes) {
      switch (node.kind) {
        case "call": {
          const n = ++counts.call;
          node.args.forEach((arg, i) => {
            if (!isTextArgument(arg)) return;
            argument(
              {
                id: `c${n}-${i + 1}`,
                kind: "argument",
                where,
                of: "call",
                name: node.name,
                index: i + 1,
                ...inside(within),
              },
              arg,
            );
          });
          break;
        }
        case "environment": {
          const n = ++counts.environment;
          node.args.forEach((arg, i) => {
            if (!isTextArgument(arg)) return;
            argument(
              {
                id: `e${n}-${i + 1}`,
                kind: "argument",
                where,
                of: "environment",
                name: node.name,
                index: i + 1,
                ...inside(within),
              },
              arg,
            );
          });
          walk(node.content, where, within, node.name);
          break;
        }
        case "section": {
          const n = ++counts.section;
          const title = node.args.at(-1);
          if (title !== undefined && isTextArgument(title))
            argument(
              { id: `s${n}`, kind: "section", where, name: node.name, ...inside(within) },
              title,
            );
          break;
        }
        case "list":
          walk(node.content, where, within, node.name);
          break;
        case "item": {
          const n = ++counts.item;
          const label = node.args[0];
          if (label !== undefined && isTextArgument(label))
            argument(
              { id: `i${n}-l`, kind: "label", where, name: list ?? "", ...inside(within) },
              label,
            );
          const end = node.content.at(-1)?.end ?? node.end;
          part(
            { id: `i${n}`, kind: "item", where, name: list ?? "", ...inside(within) },
            node.content,
            { start: end, end },
            false,
          );
          break;
        }
        case "group":
        case "block":
          walk(node.content, where, within, list);
          break;
        case "raw":
          if (where === "body" && maySetText(node))
            raw.push({
              start: node.start,
              end: node.end,
              why: node.why,
              ...(node.name === undefined ? {} : { name: node.name }),
            });
          for (const arg of node.args ?? [])
            if (arg.present && arg.content !== undefined) walk(arg.content, where, within, list);
          break;
        case "text":
        case "date":
          paragraph(node, where, within);
          break;
      }
    }
  };

  walk(tree.content, "body", undefined, undefined);
  const setters: Span[] = [];
  const known = options.setters ?? new Set<string>();
  for (const node of options.preamble?.content ?? []) {
    if (node.kind !== "call" || !known.has(node.name)) continue;
    const call = setters.length;
    setters.push({ start: node.start, end: node.end });
    const n = ++counts.preamble;
    node.args.forEach((arg, i) => {
      if (!isTextArgument(arg)) return;
      argument(
        {
          id: `h${n}-${i + 1}`,
          kind: "argument",
          where: "preamble",
          of: "call",
          name: node.name,
          index: i + 1,
          call,
        },
        arg,
      );
    });
  }
  // A preamble call's parts carry the index of the call, as its arguments do; a part comes after
  // the candidate it is inside.
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  for (const candidate of candidates)
    if (candidate.where === "preamble" && candidate.call === undefined) {
      const owner = candidate.within === undefined ? undefined : byId.get(candidate.within);
      if (owner?.call !== undefined) candidate.call = owner.call;
    }
  // A raw chunk inside another's placed argument is the outer one's to explain. The walk meets
  // them in the source's order, each outer one before those inside it.
  const outermost: RawChunk[] = [];
  let reach = -1;
  for (const chunk of raw) {
    if (chunk.end <= reach) continue;
    outermost.push(chunk);
    reach = chunk.end;
  }
  return { candidates, setters, raw: outermost };
}

/** The `within` of a candidate inside another that is not probed. */
const inside = (within: string | undefined) => (within === undefined ? {} : { within });

/** The characters of a control word's name. */
const LETTER = /[A-Za-z@]/;

/**
 * Where a span to be wrapped ends: its end, or, where it ends in a control word, past the spaces
 * and the one line's end after it, which TeX skipped, so that none of them is set after the
 * field's end marker; never past `limit`.
 */
function wrapEnd(source: string, end: number, limit: number): number {
  let start = end;
  while (start > 0 && LETTER.test(source[start - 1] ?? "")) start--;
  if (start === end || source[start - 1] !== "\\") return end;
  let backslashes = 1;
  while (source[start - 1 - backslashes] === "\\") backslashes++;
  if (backslashes % 2 === 0) return end;
  let at = end;
  while (at < limit && (source[at] === " " || source[at] === "\t")) at++;
  if (source[at] === "\n" && at < limit) {
    at++;
    while (at < limit && (source[at] === " " || source[at] === "\t")) at++;
    // A blank line after it is a paragraph's end, which TeX does not skip.
    if (source[at] === "\n" || source[at] === "\r") return end;
  }
  return Math.min(at, limit);
}

/**
 * A source with each of `wrapped`, whose spans are of it, in its markers: `\rtfield{<id>}{...}`,
 * the prelude's marker macro, in braces for an argument given without them. Spans that would
 * overlap an earlier one are left as they are, which the candidates' spans never do.
 */
export function marked(source: string, wrapped: readonly Candidate[]): string {
  const sorted = [...wrapped].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let at = 0;
  sorted.forEach((candidate, i) => {
    if (candidate.start < at) return;
    const next = sorted[i + 1]?.start ?? source.length;
    const end =
      candidate.end === candidate.start
        ? candidate.end
        : wrapEnd(source, candidate.end, Math.max(candidate.end, next));
    const [open, close] = candidate.bare ? ["{", "}"] : ["", ""];
    out += `${source.slice(at, candidate.start)}${open}\\rtfield{${candidate.id}}{${source.slice(candidate.start, end)}}${close}`;
    at = end;
  });
  return out + source.slice(at);
}

/**
 * The preamble's calls that store a header's text, issued again in order, each on a line, with
 * the arguments `wrapped` holds in their markers, so that the macros they store hold the text in
 * them; nothing when `wrapped` holds none of the preamble's candidates. Issued after the preamble,
 * where every call has been made once already, each stores what it stored, marked or not, and the
 * last call to a macro still wins.
 */
export function reissued(
  preamble: string,
  setters: readonly Span[],
  wrapped: readonly Candidate[],
): string {
  const ours = wrapped.filter((candidate) => candidate.where === "preamble");
  if (ours.length === 0) return "";
  return setters
    .map((call) => {
      const inside = ours
        .filter((candidate) => candidate.start >= call.start && candidate.end <= call.end)
        .map((candidate) => ({
          ...candidate,
          start: candidate.start - call.start,
          end: candidate.end - call.start,
        }));
      return `${marked(preamble.slice(call.start, call.end), inside)}\n`;
    })
    .join("");
}
