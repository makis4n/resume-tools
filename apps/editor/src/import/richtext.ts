/**
 * Standard LaTeX decoded into the model's rich text (milestone 3 item 4, decision 0020): what the
 * parser's table (`standard.ts`) says is text, read off unified-latex's nodes as TeX reads them.
 *
 * The escapes, symbols and letters become their characters; the ligatures `--`, `---` and the
 * quotes become the dashes and curly quotes they set, and `~` a tie; an accent is composed with its
 * letter, where the generator writes the letter back as it is (`reproduces`); `\textbf`, `\textit`
 * and `\emph` mark their argument bold or italic, `\emph` and `\em` turning italic over, and
 * `\textsc` keeps its argument as text with no mark; `\bfseries`, `\itshape` and `\em` mark the
 * rest of the group they are in, and `\bf` and `\it`, which are `\normalfont` and one of them, clear
 * the other mark first, and only inside a group, since an argument is not one; `\href{url}{text}`
 * makes its text a link, `\url{x}` its address a linked text, and `\nolinkurl{x}` its address a
 * text alone; and `\\` inside a paragraph is a space, since a field is one paragraph. Whitespace is
 * TeX's: a run of spaces and a single line's end are one space, a blank line ends a paragraph, a
 * space after a control word is skipped, and a comment takes its line's end with it.
 *
 * Anything else, a command the table keeps raw, one the template defines, math, an environment, a
 * group holding any of these or a paragraph's end, is not text, and the decoder says so, so that
 * the parser places it as a node of its own. So is what the generator cannot write back as it
 * sets: an accent over nothing or over a letter the generator decomposes, and typewriter text. The
 * decoder reads the arguments of the commands it meets (`arguments.ts`), which the parser then
 * finds already read.
 */

import type { RichText } from "@resume-tools/resume-model";
import type * as Ast from "@unified-latex/unified-latex-types";
import { escapeText } from "../templates/escape";
import { type Read, readArguments, spanOf } from "./arguments";
import { type FontChange, type Mark, STANDARD } from "./standard";

/** The marks text is set with. */
export interface Marks {
  bold: boolean;
  italic: boolean;
  href?: string;
}

export const PLAIN: Marks = { bold: false, italic: false };

/**
 * A piece of decoded text: characters with their marks, of which those from a string of the
 * source (`literal`) take part in its ligatures with the string next to them; a space between
 * words, soft when it is whitespace in the source, which a run of spaces makes one, or hard; or
 * `\\`, which is a space inside a paragraph.
 */
export type Piece =
  | { kind: "text"; text: string; marks: Marks; literal?: { start: number; end: number } }
  | { kind: "space"; hard: boolean; marks: Marks }
  | { kind: "break"; marks: Marks };

/**
 * An item of a sequence of text, one node of the source and the arguments it read: its span and
 * its pieces. A space, a comment and a break that begin or end a paragraph are left out of the
 * paragraph's text (`edge`); a blank line ends one (`par`).
 */
export interface TextItem {
  start: number;
  end: number;
  pieces: Piece[];
  /**
   * What the item is at a paragraph's edge: nothing (a space, a comment or a group that sets
   * nothing), or `\\`, a break.
   */
  edge?: "space" | "break";
  /** The item ends the paragraph: a blank line. */
  par?: true;
}

/**
 * The state text is read in: its marks; whether it is inside a group, where declarations go; and
 * whether it is typewriter, as after `\ttfamily`, where nothing is text.
 */
export interface TextState {
  marks: Marks;
  grouped: boolean;
  typewriter?: boolean;
}

/** Groups whose content is known not to decode, so that none is read twice (`decodeGroup`). */
const undecodable = new WeakSet<Ast.Node>();

/** A text item found, whether TeX skips a space after it, and the index of the node after it. */
export interface Found {
  item: TextItem;
  skipsNext: boolean;
  next: number;
}

/**
 * The text item the node at `nodes[i]` makes, with the arguments it reads, or undefined when it
 * is not text. `skip` says whether a space here is skipped, as after a control word, and the
 * item says whether the next one is (`skipsNext`), and where the nodes after it start (`next`).
 */
export function textItem(
  nodes: Ast.Node[],
  i: number,
  state: TextState,
  source: string,
  skip: boolean,
): Found | undefined {
  const node = nodes[i];
  const span = spanOf(node);
  if (node === undefined || span === undefined || state.typewriter === true) return undefined;
  switch (node.type) {
    case "string":
      return {
        item: {
          ...span,
          pieces: [{ kind: "text", text: node.content, marks: state.marks, literal: span }],
        },
        skipsNext: false,
        next: i + 1,
      };
    case "whitespace":
      return {
        item: {
          ...span,
          pieces: skip ? [] : [{ kind: "space", hard: false, marks: state.marks }],
          edge: "space",
        },
        skipsNext: skip,
        next: i + 1,
      };
    case "comment": {
      // A comment on a line of its own follows the line's end before it, which is a space, but for
      // one a comment took; one after a space follows that space.
      const spaced =
        node.sameline === false
          ? nodes[i - 1]?.type !== "comment"
          : node.leadingWhitespace === true;
      return {
        item: {
          ...span,
          pieces: spaced && !skip ? [{ kind: "space", hard: false, marks: state.marks }] : [],
          edge: "space",
        },
        skipsNext: skip,
        next: i + 1,
      };
    }
    case "parbreak":
      return {
        item: { ...span, pieces: [], edge: "space", par: true },
        skipsNext: false,
        next: i + 1,
      };
    case "group": {
      // A group that sets nothing, `{}`, is no text at a paragraph's edge, as a space is not.
      const pieces = decodeGroup(node, state, source);
      return pieces === undefined
        ? undefined
        : {
            item: { ...span, pieces, ...(pieces.length === 0 ? { edge: "space" as const } : {}) },
            skipsNext: false,
            next: i + 1,
          };
    }
    case "macro":
      return macroItem(nodes, i, node, state, source);
    default:
      return undefined;
  }
}

/** Whether a command's name is a control word, after which TeX skips spaces. */
const isControlWord = (name: string) => /^[A-Za-z]+$/.test(name);

/** The item a standard text command makes, with its arguments; undefined for any other. */
function macroItem(
  nodes: Ast.Node[],
  i: number,
  node: Ast.Macro,
  state: TextState,
  source: string,
): Found | undefined {
  const standard = STANDARD.get(node.content);
  const span = spanOf(node);
  if (standard === undefined || span === undefined) return undefined;
  const role = standard.role;
  const textual =
    role.kind === "symbol" ||
    role.kind === "accent" ||
    role.kind === "mark" ||
    role.kind === "link" ||
    role.kind === "address" ||
    role.kind === "break" ||
    (role.kind === "declaration" && state.grouped);
  if (!textual) return undefined;
  const read = readArguments(nodes, i + 1, standard.spec, span.end, node);
  if (read === undefined || !read.complete) return undefined;
  const next = read.next;
  const end = read.args.reduce((last, arg) => (arg.present ? arg.end : last), span.end);
  const item = (pieces: Piece[], edge?: TextItem["edge"]): TextItem => ({
    start: span.start,
    end,
    pieces,
    ...(edge === undefined ? {} : { edge }),
  });
  // A control word with nothing after it, as `\ss` or `\bf`, has TeX skip the spaces after it; so
  // does an argument that is a control word alone, as `\i` in `\"\i ve`.
  const last = read.args.filter((arg) => arg.present).at(-1);
  const token = last?.open === "" ? last.content[0] : undefined;
  const skipsNext =
    (isControlWord(node.content) && end === span.end) ||
    (token?.type === "macro" && isControlWord(token.content));
  switch (role.kind) {
    case "symbol":
      return {
        item: item([{ kind: "text", text: role.text, marks: state.marks }]),
        skipsNext,
        next,
      };
    case "declaration": {
      // The declaration changes the marks of the rest of its group, which `decodeNodes` carries.
      state.marks = changed(state.marks, role.change);
      return { item: item([]), skipsNext, next };
    }
    case "accent": {
      // Over nothing, an accent sets a glyph of its own, which no character the generator writes
      // sets; over a letter, it is text only where the generator writes the letter back as it is.
      const base = plainOf(read, 0, state, source);
      if (base === undefined || base === "") return undefined;
      const letter = composed(base, role.mark, role.alone);
      if (!reproduces(letter)) return undefined;
      return {
        item: item([{ kind: "text", text: letter, marks: state.marks }]),
        skipsNext,
        next,
      };
    }
    case "mark": {
      const content = read.args[0]?.content ?? [];
      const pieces = decodeNodes(
        content,
        { marks: marked(state.marks, role.mark), grouped: true },
        source,
      );
      return pieces === undefined ? undefined : { item: item(pieces), skipsNext, next };
    }
    case "link": {
      const [options, url, text] = read.args;
      if (options?.present || url === undefined || text === undefined) return undefined;
      const href = addressOf(source.slice(url.innerStart, url.innerEnd));
      const pieces = decodeNodes(
        text.content,
        { marks: { ...state.marks, href }, grouped: true },
        source,
      );
      return pieces === undefined ? undefined : { item: item(pieces), skipsNext: false, next };
    }
    case "address": {
      const arg = read.args[0];
      if (arg === undefined) return undefined;
      const address = source.slice(arg.innerStart, arg.innerEnd).trim();
      const marks = role.link ? { ...state.marks, href: address } : state.marks;
      return { item: item([{ kind: "text", text: address, marks }]), skipsNext: false, next };
    }
    case "break": {
      const [star, length] = read.args;
      if (star?.present || length?.present) return undefined;
      return {
        item: item([{ kind: "break", marks: state.marks }], "break"),
        skipsNext: false,
        next,
      };
    }
    default:
      return undefined;
  }
}

/** Marks with a mark set: bold, italic, `\emph`'s italic turned over, or none. */
function marked(marks: Marks, mark: Mark): Marks {
  if (mark === "bold") return { ...marks, bold: true };
  if (mark === "italic") return { ...marks, italic: true };
  if (mark === "emph") return { ...marks, italic: !marks.italic };
  return marks;
}

/** Marks as a font declaration leaves them: those it clears cleared, then its mark set. */
export function changed(marks: Marks, change: FontChange): Marks {
  const cleared =
    change.clear === "all"
      ? { ...marks, bold: false, italic: false }
      : change.clear === "bold"
        ? { ...marks, bold: false }
        : change.clear === "italic"
          ? { ...marks, italic: false }
          : marks;
  return change.mark === undefined ? cleared : marked(cleared, change.mark);
}

/**
 * Whether the generator writes a composed letter back as the one character it is, so that it sets
 * what the accent command set: it does for the letters of Latin-1, of Latin Extended-A and the few
 * past them LaTeX defines, but on pdfTeX decomposes every other (`escapeText`), as `\d{a}`'s `ạ` or
 * a stacked accent's `ễ`, and leaves a mark nothing composes with, as `\t{oo}`'s tie, to a font.
 */
export function reproduces(letter: string): boolean {
  return escapeText(letter) === letter && !/\p{M}/u.test(letter);
}

/**
 * A group's pieces, its declarations kept inside it, or undefined when it does not decode: a
 * group that holds anything but text, or a paragraph's end, since a field is one paragraph.
 */
function decodeGroup(node: Ast.Group, state: TextState, source: string): Piece[] | undefined {
  if (undecodable.has(node)) return undefined;
  const pieces = decodeNodes(node.content, { ...state, grouped: true }, source);
  if (pieces === undefined) undecodable.add(node);
  return pieces;
}

/**
 * The pieces of a sequence of nodes that is all text within one paragraph, or undefined when it
 * is not: the content of a group or of a mark's argument.
 */
export function decodeNodes(
  nodes: Ast.Node[],
  state: TextState,
  source: string,
): Piece[] | undefined {
  const local: TextState = { ...state };
  const pieces: Piece[] = [];
  let skip = false;
  for (let i = 0; i < nodes.length; ) {
    const found = textItem(nodes, i, local, source, skip);
    if (found === undefined || found.item.par) return undefined;
    for (const piece of found.item.pieces) pieces.push(piece);
    skip = found.skipsNext;
    i = found.next;
  }
  return pieces;
}

/** An argument's text with no marks, for an accent to go over; undefined when it is not text. */
function plainOf(read: Read, index: number, state: TextState, source: string): string | undefined {
  const content = read.args[index]?.content ?? [];
  const pieces = decodeNodes(content, { marks: PLAIN, grouped: state.grouped }, source);
  if (pieces === undefined) return undefined;
  return runsOf(pieces)
    .map((run) => run.text)
    .join("");
}

/**
 * A letter with an accent composed over it: the combining mark after its first character, the
 * dotless `ı` and `ȷ` taken for `i` and `j` as LaTeX's `\'\i` means, and the whole composed
 * (NFC); over nothing, the accent alone.
 */
export function composed(base: string, mark: string, alone: string): string {
  const letters = base.replace(/^ı/, "i").replace(/^ȷ/, "j");
  const first = String.fromCodePoint(letters.codePointAt(0) ?? 0);
  if (letters === "") return alone;
  return `${first}${mark}${letters.slice(first.length)}`.normalize("NFC");
}

/** An address as `\href` reads it: hyperref turns its escaped characters back. */
export function addressOf(source: string): string {
  return source.trim().replace(/\\([#$%&_{}~])/g, "$1");
}

/**
 * TeX's ligatures and the tie in a run of the source's characters: `---` and `--` the em and en
 * dash, ``` `` ``` and `''` the curly double quotes, `` ` `` and `'` the single ones, `?``
 * and `!`` the inverted marks, and `~` a no-break space.
 */
export function ligatures(text: string): string {
  return text
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/``/g, "“")
    .replace(/''/g, "”")
    .replace(/\?`/g, "¿")
    .replace(/!`/g, "¡")
    .replace(/`/g, "‘")
    .replace(/'/g, "’")
    .replace(/~/g, " ");
}

const sameMarks = (a: Marks, b: Marks) =>
  a.bold === b.bold && a.italic === b.italic && a.href === b.href;

/**
 * Pieces as the model's rich text: the source's characters that are next to each other in it
 * joined and their ligatures made; a run of soft spaces and breaks one space, which a hard space
 * does not join; and pieces of the same marks one run, a mark there only when it is set.
 */
export function runsOf(pieces: readonly Piece[]): RichText {
  const texts: { text: string; marks: Marks }[] = [];
  let literal: { text: string; marks: Marks; end: number } | undefined;
  let spaced = false;
  const flushLiteral = () => {
    if (literal !== undefined) texts.push({ text: ligatures(literal.text), marks: literal.marks });
    literal = undefined;
  };
  for (const piece of pieces) {
    if (piece.kind === "text" && piece.literal !== undefined) {
      const joins =
        literal !== undefined &&
        literal.end === piece.literal.start &&
        sameMarks(literal.marks, piece.marks);
      if (literal !== undefined && joins) {
        literal.text += piece.text;
        literal.end = piece.literal.end;
      } else {
        flushLiteral();
        literal = { text: piece.text, marks: piece.marks, end: piece.literal.end };
      }
      spaced = false;
      continue;
    }
    flushLiteral();
    if (piece.kind === "text") {
      if (piece.text === "") continue;
      texts.push({ text: piece.text, marks: piece.marks });
      spaced = false;
    } else if (piece.kind === "space" && piece.hard) {
      texts.push({ text: " ", marks: piece.marks });
      spaced = false;
    } else if (!spaced) {
      texts.push({ text: " ", marks: piece.marks });
      spaced = true;
    }
  }
  flushLiteral();
  const merged: { text: string; marks: Marks }[] = [];
  for (const text of texts) {
    const last = merged.at(-1);
    if (text.text === "") continue;
    if (last !== undefined && sameMarks(last.marks, text.marks)) last.text += text.text;
    else merged.push({ ...text });
  }
  return merged.map(({ text, marks }) => ({
    text,
    ...(marks.bold ? { bold: true } : {}),
    ...(marks.italic ? { italic: true } : {}),
    ...(marks.href === undefined ? {} : { href: marks.href }),
  }));
}
