/**
 * The body of an imported resume as a tree (milestone 3 item 4, plan section 6 step 2, decision
 * 0020): what the probe (item 5) wraps, the naming step (item 6) describes and the assembly (item 7)
 * maps onto the model, and what prints back to the bytes it came from (`print.ts`).
 *
 * The main file is split at `\begin{document}` and `\end{document}`, outside comments; the
 * preamble stays text. The body's `\input`, `\include` and `\subfile` of `.tex` files the job
 * holds are inlined, never a file of the tree, `\endinput` honoured where it begins a line and the
 * spaces TeX reads around a file kept, and the body remembers which spans came from which file
 * (`bodyOf`).
 *
 * unified-latex parses the body (`readBody`), with nothing attached; the parser then reads each
 * command's arguments (`arguments.ts`) by its table of standard commands (`standard.ts`) or by the
 * specification the engine gave for a template's (`signatures.ts`), and places what it reads:
 *
 * - **rich text**, one paragraph at a time, in the model's `RichText` (`richtext.ts`);
 * - **dates**, a whole text that reads as a date or a range (`dates.ts`);
 * - **sections**, `\section` and its kin, their titles placed as any argument is;
 * - **lists**, `itemize`, `enumerate` and `description`, with an item node for each `\item`;
 * - **template calls**, a call to a macro the engine says the template defines, each argument a
 *   subtree, the optional ones marked, and the star;
 * - **template environments**, one the engine says the template defines, its arguments and body;
 * - **groups** and **blocks**, a braced group or a standard environment such as `center`, or a
 *   declaration used as one, `small` or `bfseries`, whose content the parser places;
 * - and **raw chunks**, everything else, byte for byte: math, verbatim, `tabular` and the
 *   environments the table does not know, commands whose effect is not text, typewriter text, a
 *   paragraph an alignment's `&` is in, what a constant-false conditional skips, and any command
 *   the table does not know and the engine did not resolve, or resolved with a signature a group
 *   after the call belies. A raw chunk is the smallest node the parser cannot place: a raw command
 *   whose argument is text a page shows keeps that argument placed inside it.
 *
 * Every node keeps its span in the body, so that the printer gives back the bytes of what nobody
 * changed. A body past 5 MB, nested past 64 levels, or making a tree of more than 200,000 nodes or
 * 64 levels, is refused with a plain message; the parser's work grows linearly with the body, every
 * look ahead in it bounded.
 */

import type { Dates, RichText } from "@resume-tools/resume-model";
import type * as Ast from "@unified-latex/unified-latex-types";
import { parseMinimal } from "@unified-latex/unified-latex-util-parse";
import { visit } from "@unified-latex/unified-latex-util-visit";
import {
  isReadable,
  MAX_DELIMITED,
  type ReadArgument,
  readArguments,
  readSpec,
  spanOf,
  splitAt,
} from "./arguments";
import { readDates } from "./dates";
import { CAPS, decodeText, type Intake } from "./intake";
import { extensionOf, joinPath, nameOf } from "./paths";
import { type Refusal, refusedParse } from "./refusal";
import { changed, PLAIN, runsOf, type TextItem, type TextState, textItem } from "./richtext";
import { group as braced, maskComments } from "./source";
import { STANDARD, STANDARD_ENVIRONMENTS, type Standard } from "./standard";

// The body.

/** Where a part of the body came from: a file of the job, from an offset in it, or the parser. */
export interface BodySource {
  start: number;
  end: number;
  /** The file's path in the job, the main file's by its name; none for what the parser added. */
  file?: string;
  /** Where the part starts in that file. */
  offset?: number;
}

/** The main file split around its body, and the body with the files it inputs inlined. */
export interface Body {
  /** The main file before `\begin{document}`, which item 7 rewrites. */
  preamble: string;
  /** The main file up to and with `\begin{document}`. */
  before: string;
  /** The body, from after `\begin{document}` to before `\end{document}`, its inputs inlined. */
  text: string;
  /** The main file from `\end{document}` on. */
  after: string;
  /** Where each part of the body came from, in order, covering it. */
  sources: BodySource[];
}

/** The parser's caps: the body's size, and the tree's nodes and levels (decision 0020). */
export const PARSE_CAPS = {
  /** The body, inlined, in UTF-8: the intake's cap on an upload's text files together. */
  bodyBytes: CAPS.textBytes,
  nodes: 200_000,
  levels: 64,
} as const;

/** How deep inputs are inlined within inputs; one deeper is left as it is. */
const MAX_INPUT_DEPTH = 16;

const NO_BODY =
  "This resume could not be read: its main file does not both start and end its document.";
const TOO_LONG = `This resume is too long for this editor to read: its text is past ${PARSE_CAPS.bodyBytes / 1_000_000} MB.`;
const TOO_DEEP = "This resume nests its parts too deeply for this editor to read.";
const TOO_MANY = "This resume has too many parts for this editor to read.";
const UNREADABLE = "This resume could not be read by this editor.";

/** The parser's refusals, by the rule each is for: what the corpus runner counts them by. */
export const PARSE_REFUSALS = {
  body: NO_BODY,
  long: TOO_LONG,
  deep: TOO_DEEP,
  many: TOO_MANY,
  unreadable: UNREADABLE,
} as const;

/** The length of a text in UTF-8, counted without making the bytes. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Whether the backslash at `at` begins a command: the backslashes before it are even in number. */
function isCommandAt(text: string, at: number): boolean {
  let before = 0;
  for (let i = at - 1; i >= 0 && text.charCodeAt(i) === 92; i--) before++;
  return before % 2 === 0;
}

/** The first `\begin{document}` or `\end{document}` outside comments at or after `from`. */
function documentCommand(masked: string, which: "begin" | "end", from: number) {
  const pattern = new RegExp(`\\\\${which}\\s*\\{document\\}`, "g");
  pattern.lastIndex = from;
  for (let match = pattern.exec(masked); match; match = pattern.exec(masked))
    if (isCommandAt(masked, match.index)) return match;
  return undefined;
}

/** The files a preamble's `\includeonly` lets `\include` read, or undefined when it names none. */
function includeOnly(preamble: string): Set<string> | undefined {
  const masked = maskComments(preamble);
  let only: Set<string> | undefined;
  for (const match of masked.matchAll(/\\includeonly(?![A-Za-z@])/g)) {
    const list = braced(masked, match.index + match[0].length);
    if (list === undefined) continue;
    only = new Set(
      list.value
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== ""),
    );
  }
  return only;
}

/** A TeX `\input` name given without braces: spaces, then everything up to a space or a brace. */
const BARE_NAME = /[ \t]*([^\s{}\\%]+)/y;

/**
 * The job's path of a `.tex` file an input command names, or undefined for one that is not a
 * `.tex` file: `\include` always adds `.tex`, and `\input` and `\subfile` add it to a name without
 * an extension.
 */
function inputPath(command: string, name: string): string | undefined {
  const given = name.trim();
  const extension = extensionOf(given);
  const file =
    command === "include"
      ? `${given}.tex`
      : extension === ""
        ? `${given}.tex`
        : extension === ".tex"
          ? given
          : undefined;
  return file === undefined ? undefined : joinPath("", file);
}

/** An `\endinput` outside comments that begins its line, but for spaces before it. */
const END_INPUT = /(?:^|\n)[ \t]*\\endinput(?![A-Za-z@])/;

/**
 * What of a file's span TeX reads through `\input`: up to the line of its first `\endinput`
 * outside comments that begins a line, spaces aside, none of that line; or all of it. An
 * `\endinput` after something else on its line is not honoured, since it is most often a guard,
 * `\ifdefined\x\endinput\fi`, which reads the whole file the first time; the file is inlined whole,
 * and the command with it.
 */
function beforeEndInput(text: string, span: { start: number; end: number }) {
  const match = END_INPUT.exec(maskComments(text.slice(span.start, span.end)));
  if (match === null) return { ...span, cut: false };
  const end = span.start + match.index + (match[0][0] === "\n" ? 1 : 0);
  return { start: span.start, end, cut: true };
}

/** The rest of an input's line after its name when the input is the last thing on it. */
const LINE_REST = /^[ \t]*\n/;

/** A subfile's body: what lies between its own `\begin{document}` and `\end{document}`. */
function subfileBody(text: string): { start: number; end: number } | undefined {
  const masked = maskComments(text);
  const begin = documentCommand(masked, "begin", 0);
  if (begin === undefined) return undefined;
  const start = begin.index + begin[0].length;
  const end = documentCommand(masked, "end", start);
  return { start, end: end?.index ?? text.length };
}

/**
 * The main file's body, split at `\begin{document}` and `\end{document}` outside comments, with the
 * `.tex` files its `\input`, `\include` and `\subfile` name inlined, when the job holds them; or a
 * refusal when the main file does not start and end a document, or the body is past its cap.
 *
 * A file read in ends in a newline, one added where it lacks one, as TeX ends every line it reads
 * with a line's end, and an empty file is one empty line, a blank line. Where its input is the last
 * thing on its line, TeX reads the file's last line's end and then the input's own, two spaces in
 * a paragraph; the two newlines alone would be a blank line, which ends one, as would the input's
 * line left empty by a file `\endinput` ends on its first line, so an empty group goes before the
 * input's line's end, `{}`, which gives the second space and sets nothing. A bare name, `\input x`,
 * takes its line's end as its own end, and the file's last line's end stands for it. An `\include`
 * is inlined between two `\clearpage`s, as LaTeX reads one, or as the one `\clearpage` it leaves
 * when the preamble's `\includeonly` leaves it out. An input the job does not hold, a file of
 * another kind, one already being read, or one nested past 16 inputs stays as it is, a command in
 * the body.
 */
export function bodyOf(intake: Pick<Intake, "main" | "files">): Body | Refusal {
  const text = intake.main.text;
  const masked = maskComments(text);
  const begin = documentCommand(masked, "begin", 0);
  if (begin === undefined) return refusedParse(NO_BODY);
  const bodyStart = begin.index + begin[0].length;
  const end = documentCommand(masked, "end", bodyStart);
  if (end === undefined) return refusedParse(NO_BODY);
  const preamble = text.slice(0, begin.index);
  const only = includeOnly(preamble);
  const parts: string[] = [];
  const sources: BodySource[] = [];
  /** Each input's text, read once however many times the body inputs it. */
  const texts = new Map<string, string>();
  let length = 0;
  let bytes = 0;
  // A body past its cap stops growing at once, so that inputs repeated cannot run it up further.
  const emit = (part: string, file?: string, offset?: number) => {
    if (part === "" || bytes > PARSE_CAPS.bodyBytes) return;
    parts.push(part);
    sources.push({
      start: length,
      end: length + part.length,
      ...(file === undefined ? {} : { file, offset }),
    });
    length += part.length;
    bytes += utf8Length(part);
  };
  const inline = (
    source: string,
    pieces: readonly { start: number; end: number }[],
    file: string,
    stack: readonly string[],
  ) => {
    // The kept text, and where each part of it is in the file.
    const kept = pieces.map((piece) => source.slice(piece.start, piece.end)).join("");
    const emitKept = (from: number, to: number) => {
      let at = 0;
      for (const piece of pieces) {
        const size = piece.end - piece.start;
        const start = Math.max(from, at);
        const stop = Math.min(to, at + size);
        if (start < stop) emit(kept.slice(start, stop), file, piece.start + (start - at));
        at += size;
      }
    };
    const hidden = maskComments(kept);
    let at = 0;
    for (const match of hidden.matchAll(/\\(input|include|subfile)(?![A-Za-z@])/g)) {
      if (bytes > PARSE_CAPS.bodyBytes) return;
      if (match.index < at || !isCommandAt(hidden, match.index)) continue;
      const command = match[1] ?? "";
      const after = match.index + match[0].length;
      let name: { value: string; end: number; bare?: true } | undefined = braced(hidden, after);
      if (name === undefined && command === "input") {
        BARE_NAME.lastIndex = after;
        const bare = BARE_NAME.exec(hidden);
        if (bare) name = { value: bare[1] ?? "", end: after + bare[0].length, bare: true };
      }
      if (name === undefined) continue;
      const path = inputPath(command, name.value);
      const held = path === undefined ? undefined : intake.files[path];
      if (path === undefined || held === undefined || stack.includes(path)) continue;
      if (stack.length > MAX_INPUT_DEPTH) continue;
      emitKept(at, match.index);
      at = name.end;
      const excluded = command === "include" && only !== undefined && !only.has(name.value.trim());
      if (command === "include") emit("\\clearpage\n");
      if (excluded) continue;
      const content = texts.get(path) ?? decodeText(held);
      texts.set(path, content);
      const span =
        command === "subfile"
          ? (subfileBody(content) ?? { start: 0, end: content.length })
          : { start: 0, end: content.length };
      const from = length;
      const read = beforeEndInput(content, span);
      // An empty file is one empty line to TeX, which ends a paragraph, a blank line wherever the
      // input is; one `\endinput` ends on its first line is none.
      if (read.start === read.end && !read.cut && command !== "subfile")
        emit(parts.at(-1)?.endsWith("\n") ? "\n" : "\n\n");
      else inline(content, [read], path, [...stack, path]);
      const ended = length > from ? (parts.at(-1)?.endsWith("\n") ?? false) : undefined;
      if (command === "include") {
        if (ended === false) emit("\n");
        emit("\\clearpage\n");
        continue;
      }
      // An input last on its line: TeX reads a space for the file's last line's end and another
      // for the input's line's end, which an empty group before that line's end gives, where the
      // two line ends alone, or the input's line left empty, would make a blank line. A bare
      // name's end is that line's end, which TeX takes with the name: the file's stands for it.
      const rest = LINE_REST.exec(kept.slice(at, at + 256));
      if (rest === null) {
        if (ended === false) emit("\n");
      } else if (name.bare !== true) emit(ended === false ? "\n{}" : "{}");
      else if (ended !== false) at += rest[0].length;
    }
    emitKept(at, kept.length);
  };
  const main = nameOf(intake.main.path);
  inline(text, [{ start: bodyStart, end: end.index }], main, [main]);
  if (bytes > PARSE_CAPS.bodyBytes) return refusedParse(TOO_LONG);
  return {
    preamble,
    before: text.slice(0, bodyStart),
    text: parts.join(""),
    after: text.slice(end.index),
    sources,
  };
}

/** A body of text alone, one file's, for the tests and for callers with no intake. */
export function bodyOfText(text: string): Body {
  return {
    preamble: "",
    before: "",
    text,
    after: "",
    sources: text === "" ? [] : [{ start: 0, end: text.length, file: "", offset: 0 }],
  };
}

// Reading the body.

/** A body as unified-latex parsed it, which one tree is built from (`parseBody`). */
export interface ReadBody {
  body: Body;
  root: Ast.Root;
}

/** A command whose address hyperref reads with `%` as a character: `\href`, `\url`, `\nolinkurl`. */
const ADDRESS = /^\\(?:href|url|nolinkurl)(?![A-Za-z@])/;

/**
 * Where each line of a text ends, asked at places that only move forward: the index of the first
 * line's end at or after `at`, or the text's length. Each line's end is looked for once, so that
 * reading a line of many commands costs the line's length once, not once for each command.
 */
function lineEnds(text: string): (at: number) => number {
  let from = 0;
  let end = -1;
  return (at) => {
    if (at < from || at > end) {
      const newline = text.indexOf("\n", at);
      end = newline < 0 ? text.length : newline;
    }
    from = at;
    return end;
  };
}

/** The first `char` in `text` from `from` to before `to`, or -1. */
function charWithin(text: string, char: string, from: number, to: number): number {
  for (let i = from; i < to; i++) if (text[i] === char) return i;
  return -1;
}

/**
 * The body as unified-latex is given it, every character where it is: a line's end in `\r\n` a
 * space and a line's end, as TeX reads one line there, and a lone `\r` a line's end; and a `%` in
 * the braced address of `\href`, `\url` or `\nolinkurl` a character of the private use area,
 * which unified-latex does not take for a comment, as hyperref does not. Each line is read from
 * its start, so that an address's `%` does not hide what follows it on the line, and a comment
 * does; the parser reads an address's text from the body itself. An address, an `\href`'s options
 * and a `\verb`'s text are looked for on their line and MAX_DELIMITED characters on at most, so
 * that the text is read once.
 */
export function maskedForParse(text: string): string {
  const lines = text.replace(/\r\n?/g, (end) => (end.length === 2 ? " \n" : "\n"));
  const marks: number[] = [];
  const lineEnd = lineEnds(lines);
  let i = 0;
  while (i < lines.length) {
    const char = lines[i];
    if (char === "%") {
      const newline = lineEnd(i);
      if (newline >= lines.length) break;
      i = newline + 1;
    } else if (char === "\\") {
      const head = lines.slice(i, i + 12);
      const command = ADDRESS.exec(head);
      const verb = /^\\verb\*?([^A-Za-z\s*])/.exec(head);
      const stop = Math.min(lineEnd(i), i + MAX_DELIMITED);
      if (command !== null) i = addressEnd(lines, i + command[0].length, marks, stop);
      else if (verb !== null) {
        // `\verb`'s text is its own, a `%` in it no comment.
        const close = charWithin(lines, verb[1] ?? "", i + verb[0].length, stop);
        i = close >= 0 ? close + 1 : i + verb[0].length;
      } else i += 2;
    } else i++;
  }
  if (marks.length === 0) return lines;
  const chars = lines.split("");
  for (const at of marks) chars[at] = "\ue000";
  return chars.join("");
}

/**
 * Where an address command's braced address ends, from just after the command's name, past an
 * `\href`'s options: the `%` in it are added to `marks`. The address is on one line, as every
 * address is, and closes before `stop`; one that does not marks nothing, and reading goes on after
 * the name.
 */
function addressEnd(lines: string, from: number, marks: number[], stop: number): number {
  let at = from;
  while (lines[at] === " " || lines[at] === "\t") at++;
  if (lines[at] === "[") {
    const close = charWithin(lines, "]", at, stop);
    if (close < 0) return from;
    at = close + 1;
    while (lines[at] === " " || lines[at] === "\t") at++;
  }
  if (lines[at] !== "{") return from;
  const found: number[] = [];
  let depth = 0;
  for (let i = at; i < stop; i++) {
    const char = lines[i];
    if (char === "\\") i++;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      marks.push(...found);
      return i + 1;
    } else if (char === "%") found.push(i);
  }
  return from;
}

/**
 * How deep a text nests its groups and environments, read before unified-latex parses it, whose
 * parse recurses with them: past `limit` it stops counting and says so. Comments and `\verb` count
 * for nothing, a `\verb`'s text looked for as `maskedForParse` looks for it.
 */
export function nestsPast(text: string, limit: number): boolean {
  let depth = 0;
  const lineEnd = lineEnds(text);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 37) {
      // A comment runs to the line's end.
      const newline = lineEnd(i);
      if (newline >= text.length) break;
      i = newline;
    } else if (code === 92) {
      const next = text[i + 1];
      if (next === "{" || next === "}" || next === "\\" || next === "%") {
        i++;
        continue;
      }
      if (text.startsWith("begin", i + 1) && !/[A-Za-z@]/.test(text[i + 6] ?? "")) depth++;
      else if (text.startsWith("end", i + 1) && !/[A-Za-z@]/.test(text[i + 4] ?? "")) depth--;
      else if (text.startsWith("verb", i + 1) && !/[A-Za-z@]/.test(text[i + 5] ?? "")) {
        let at = i + 5;
        if (text[at] === "*") at++;
        const delimiter = text[at];
        const stop = Math.min(lineEnd(i), i + MAX_DELIMITED);
        const close = delimiter === undefined ? -1 : charWithin(text, delimiter, at + 1, stop);
        if (close >= 0) i = close;
      }
    } else if (code === 123) depth++;
    else if (code === 125) depth = Math.max(0, depth - 1);
    if (depth > limit) return true;
  }
  return false;
}

/**
 * The body parsed by unified-latex, with no arguments attached; or a refusal, when the body is
 * past its cap or nests past the tree's levels, which the parse would recurse through.
 */
export function readBody(body: Body): ReadBody | Refusal {
  if (utf8Length(body.text) > PARSE_CAPS.bodyBytes) return refusedParse(TOO_LONG);
  const masked = maskedForParse(body.text);
  if (nestsPast(masked, PARSE_CAPS.levels)) return refusedParse(TOO_DEEP);
  let root: Ast.Root;
  try {
    root = parseMinimal(masked);
  } catch {
    return refusedParse(UNREADABLE);
  }
  return { body, root };
}

/** What a body uses that the table does not know: the commands, and the environments it opens. */
export interface Uses {
  commands: string[];
  environments: string[];
}

/** A name the engine can be asked about: printable ASCII, none of it a line's end. */
const isAskable = (name: string) => /^[\x20-\x7e]+$/.test(name);

/**
 * The control sequences a body uses, outside mathematics, and the environments it opens, that the
 * table of standard commands does not know: what the engine is asked about (`signatures.ts`).
 */
export function usesOf(read: ReadBody): Uses {
  const commands = new Set<string>();
  const environments = new Set<string>();
  visit(read.root, (node, info) => {
    if (info.context.inMathMode || info.context.hasMathModeAncestor) return;
    if (node.type === "macro" && !STANDARD.has(node.content) && isAskable(node.content))
      commands.add(node.content);
    if (
      node.type === "environment" &&
      typeof node.env === "string" &&
      !STANDARD_ENVIRONMENTS.has(node.env) &&
      isAskable(node.env)
    )
      environments.add(node.env);
  });
  return { commands: [...commands].sort(), environments: [...environments].sort() };
}

// The tree.

/** A span of the body, from `start` to before `end`. */
export interface Span {
  start: number;
  end: number;
}

/**
 * A command's argument: whether it is mandatory, optional, a star or another token; whether the
 * source gives it; its delimiters; its span, delimiters included, and that of what it holds; and,
 * for one whose content the parser places, the nodes it holds. An argument with no `content` is
 * kept as it is, as a raw command's length or colour.
 */
export interface Argument extends Span {
  kind: "mandatory" | "optional" | "star" | "token";
  present: boolean;
  open: string;
  close: string;
  innerStart: number;
  innerEnd: number;
  content?: Node[];
}

export interface TextNode extends Span {
  kind: "text";
  runs: RichText;
}

/** A whole text that reads as a date or a range, and the text as it reads. */
export interface DateNode extends Span {
  kind: "date";
  dates: Dates;
  text: string;
}

export interface SectionNode extends Span {
  kind: "section";
  name: string;
  /** `\part` -1, `\chapter` 0, `\section` 1, `\subsection` 2, and so on. */
  level: number;
  star: boolean;
  /** The star, the optional title for the contents, and the title. */
  args: Argument[];
  /** The title's nodes: its last argument's content. */
  title: Node[];
}

/** `itemize`, `enumerate` or `description`: its options, and its content, items among it. */
export interface ListNode extends Span {
  kind: "list";
  name: string;
  args: Argument[];
  content: Node[];
}

/** An `\item`: its label, when it has one, and its content up to the next. */
export interface ItemNode extends Span {
  kind: "item";
  args: Argument[];
  content: Node[];
}

/** A call to a macro the template defines, each argument a subtree. */
export interface CallNode extends Span {
  kind: "call";
  name: string;
  star: boolean;
  args: Argument[];
}

/** An environment the template defines: its arguments, and its body, items among it. */
export interface EnvironmentNode extends Span {
  kind: "environment";
  name: string;
  args: Argument[];
  content: Node[];
}

/** A braced group whose content the parser places, as one holding a call or a size. */
export interface GroupNode extends Span {
  kind: "group";
  content: Node[];
}

/** A standard environment whose body the parser places, as `center` or `minipage`. */
export interface BlockNode extends Span {
  kind: "block";
  name: string;
  args: Argument[];
  content: Node[];
}

/**
 * Why a chunk is raw: a command whose effect is not text (`command`), one the table does not know
 * and the engine did not resolve (`unknown`), or one it resolved with no arguments it can read
 * (`unresolved`); a definition in TeX's syntax (`definition`); an environment the parser does not
 * place (`environment`); mathematics (`math`); verbatim text (`verbatim`); typewriter text, which
 * the model has no mark for (`typewriter`); what a constant-false conditional skips (`skipped`);
 * or an alignment's cells, a template environment's body that is one or a paragraph with an
 * alignment's `&` in it (`alignment`).
 */
export type RawWhy =
  | "command"
  | "unknown"
  | "unresolved"
  | "definition"
  | "environment"
  | "math"
  | "verbatim"
  | "typewriter"
  | "skipped"
  | "alignment";

/** A chunk the parser keeps byte for byte, and, for a command, what it read of its arguments. */
export interface RawNode extends Span {
  kind: "raw";
  why: RawWhy;
  /** The command's or environment's name. */
  name?: string;
  args?: Argument[];
  /**
   * A call to a template macro whose signature takes no mandatory argument, or ends in an optional
   * one, and which a group follows: a signature the group belies, as a macro that hands its
   * arguments on to another has, so the call and the groups after it are kept raw, unresolved.
   */
  suspect?: true;
}

export type Node =
  | TextNode
  | DateNode
  | SectionNode
  | ListNode
  | ItemNode
  | CallNode
  | EnvironmentNode
  | GroupNode
  | BlockNode
  | RawNode;

/** The body as a tree: its text, and its nodes. */
export interface Tree extends Span {
  kind: "body";
  /** The body's text, which every span is of. */
  source: string;
  content: Node[];
  /** How many nodes the tree holds, and how deep the deepest is. */
  nodes: number;
  levels: number;
}

/** What the engine said of a command or an environment, as far as the parser needs it. */
export interface Known {
  kind: "template" | "standard" | "undefined" | "primitive" | "char" | "register" | "other";
  /** Its arguments, in xparse's syntax, when they could be read. */
  spec?: string;
}

/**
 * What the engine said of the names a body uses (`signatures.ts`), as far as the parser needs it:
 * and the template's macros' meanings, which say whether an environment is an alignment.
 */
export interface Signatures {
  commands: Readonly<Record<string, Known>>;
  environments: Readonly<Record<string, Known>>;
  // TODO(merge): part A keeps a data macro's text out of its record; the parser reads meanings
  // only of an environment's own macros, which are never data, so a record without one is fine.
  macros?: Readonly<Record<string, { meaning?: string }>>;
}

/**
 * What the engine said of a name, when it said anything: its own entry only, so that a name such
 * as `constructor` finds nothing in a plain object's prototype.
 */
const known = (
  table: Readonly<Record<string, Known>> | undefined,
  name: string,
): Known | undefined =>
  table !== undefined && Object.hasOwn(table, name) ? table[name] : undefined;

/** Thrown to stop building a tree at its caps; the refusal is its message. */
class Capped extends Error {}

interface Context {
  source: string;
  signatures: Signatures | undefined;
  count: { nodes: number; levels: number };
  level: number;
}

/**
 * A body's tree, its commands' arguments read by the table and by what the engine said of the
 * template's; or a refusal when the tree is past its caps. A body read once builds one tree, since
 * reading arguments takes them out of unified-latex's nodes.
 */
export function buildTree(read: ReadBody, signatures?: Signatures): Tree | Refusal {
  const context: Context = {
    source: read.body.text,
    signatures,
    count: { nodes: 0, levels: 0 },
    level: 0,
  };
  let content: Node[];
  try {
    content = sequence(read.root.content, context, { marks: PLAIN, grouped: false });
  } catch (error) {
    if (error instanceof Capped) return refusedParse(error.message);
    if (error instanceof RangeError) return refusedParse(TOO_DEEP);
    throw error;
  }
  return {
    kind: "body",
    source: read.body.text,
    start: 0,
    end: read.body.text.length,
    content,
    nodes: context.count.nodes,
    levels: context.count.levels,
  };
}

/** A body's tree (`readBody`, then `buildTree`), or a refusal. */
export function parseBody(body: Body, signatures?: Signatures): Tree | Refusal {
  const read = readBody(body);
  return "refused" in read ? read : buildTree(read, signatures);
}

/** A node made, counted against the cap, at the context's level. */
function made<T extends Node>(context: Context, node: T): T {
  if (++context.count.nodes > PARSE_CAPS.nodes) throw new Capped(TOO_MANY);
  if (context.level > context.count.levels) context.count.levels = context.level;
  return node;
}

/** The context one level down, past which the tree is refused. */
function deeper(context: Context): Context {
  const level = context.level + 1;
  if (level > PARSE_CAPS.levels) throw new Capped(TOO_DEEP);
  return { ...context, level };
}

/**
 * A sequence of nodes placed: text gathered into paragraphs, and every other node placed on its
 * own, in order. A node that starts before the last one placed ended, as unified-latex gives some
 * verbatim commands' parts, is inside it, and passed over.
 *
 * Three things change what follows them in the sequence. A font declaration the model has no
 * mark for changes the marks after it inside a group, as `\scshape` clears italic, and stays raw.
 * `\ttfamily` and `\tt` make the rest of the sequence typewriter, one raw chunk with them, and
 * the rest of a list's items too, which share its state. And `\iffalse`, up to the `\else` or
 * `\fi` that ends what it skips, nesting counted, is one raw chunk, as is what an `\iftrue` skips
 * from its `\else`; the branch TeX takes is placed as any content is.
 */
function sequence(nodes: Ast.Node[], context: Context, state: TextState): Node[] {
  const out: Node[] = [];
  let items: TextItem[] = [];
  let skip = false;
  let reached = -1;
  /** What an `\iftrue` skips, found with it: from its `\else` to its `\fi`, by index. */
  let skipped: Map<number, number> | undefined;
  /** The conditionals' `\else` and `\fi`, matched once, at the first constant one. */
  let conditionals: Map<number, Matched> | undefined;
  // Appended a node at a time: a spread of a long list would pass each as an argument.
  const add = (nodes: readonly Node[]) => {
    for (const node of nodes) out.push(node);
  };
  const flush = () => {
    if (items.length > 0) add(paragraphs(items, context));
    items = [];
  };
  if (state.typewriter === true) return rawRun(nodes, 0, nodes.length, "typewriter", context);
  for (let i = 0; i < nodes.length; ) {
    const node = nodes[i];
    const span = spanOf(node);
    if (node === undefined || span === undefined || span.start < reached) {
      i++;
      continue;
    }
    const role = node.type === "macro" ? STANDARD.get(node.content)?.role : undefined;
    const skippedTo = skipped?.get(i);
    if (role?.kind === "conditional") conditionals ??= matchConditionals(nodes, context);
    const branch =
      skippedTo === undefined && role?.kind === "conditional"
        ? branchOf(conditionals?.get(i), role.value)
        : undefined;
    if (skippedTo !== undefined || role?.kind === "typewriter" || branch !== undefined) {
      flush();
      skip = false;
      if (role?.kind === "typewriter" && skippedTo === undefined) {
        state.typewriter = true;
        add(rawRun(nodes, i, nodes.length, "typewriter", context));
        break;
      }
      // A constant conditional: what it skips raw, the `\iftrue` alone when it skips nothing yet.
      const to = skippedTo ?? branch?.skipsTo ?? i;
      if (branch?.skips !== undefined)
        (skipped ??= new Map()).set(branch.skips.from, branch.skips.to);
      add(
        rawRun(
          nodes,
          i,
          to + 1,
          skippedTo !== undefined || to > i ? "skipped" : "command",
          context,
        ),
      );
      reached = spanOf(nodes[to])?.end ?? span.end;
      i = to + 1;
      continue;
    }
    const found = textItem(nodes, i, state, context.source, skip);
    if (found !== undefined) {
      items.push(found.item);
      skip = found.skipsNext;
      reached = found.item.end;
      i = found.next;
      continue;
    }
    flush();
    skip = false;
    const placed = place(nodes, i, context, state);
    add(placed.nodes);
    if (role?.kind === "raw" && role.change !== undefined && state.grouped)
      state.marks = changed(state.marks, role.change);
    reached = placed.nodes.reduce((end, each) => Math.max(end, each.end), span.end);
    i = Math.max(placed.next, i + 1);
  }
  flush();
  return out;
}

/**
 * The nodes from `from` to before `to` as one raw chunk, the spaces and comments at either end
 * left out, or none when there is nothing else; `name` the first's, a command's or an
 * environment's.
 */
function rawRun(
  nodes: readonly Ast.Node[],
  from: number,
  to: number,
  why: RawWhy,
  context: Context,
): Node[] {
  const kept = (node: Ast.Node | undefined) =>
    node !== undefined &&
    node.type !== "whitespace" &&
    node.type !== "comment" &&
    node.type !== "parbreak";
  let first = from;
  while (first < to && !kept(nodes[first])) first++;
  let last = to - 1;
  while (last >= first && !kept(nodes[last])) last--;
  const start = spanOf(nodes[first]);
  const end = spanOf(nodes[last]);
  if (first > last || start === undefined || end === undefined) return [];
  const head = nodes[first];
  const name =
    head?.type === "macro" ? head.content : head?.type === "environment" ? head.env : undefined;
  return [
    made(context, {
      kind: "raw",
      why,
      ...(typeof name === "string" ? { name } : {}),
      start: start.start,
      end: end.end,
    } satisfies RawNode),
  ];
}

/** TeX's conditionals, and e-TeX's and pdfTeX's, which TeX counts when it skips a branch. */
const CONDITIONALS: ReadonlySet<string> = new Set([
  ...["if", "ifcat", "ifnum", "ifdim", "ifodd", "ifvmode", "ifhmode", "ifmmode", "ifinner"],
  ...["ifvoid", "ifhbox", "ifvbox", "ifx", "ifeof", "iftrue", "iffalse", "ifcase", "ifdefined"],
  ...["ifcsname", "iffontchar", "ifincsname", "ifpdfprimitive", "ifprimitive", "ifpdfabsnum"],
  ...["ifpdfabsdim", "ifabsnum", "ifabsdim"],
]);

/**
 * Whether a command is a conditional TeX counts when it skips: one of its own, or one the engine
 * says is a primitive whose name starts with `if`, as `\newif` makes one.
 */
const isConditional = (name: string, context: Context) =>
  CONDITIONALS.has(name) ||
  (name.startsWith("if") && known(context.signatures?.commands, name)?.kind === "primitive");

/** A conditional's `\else` and `\fi` among the nodes after it, by index, nesting counted. */
interface Matched {
  otherwise?: number;
  fi?: number;
}

/**
 * Every conditional among a sequence's nodes with its `\else` and `\fi` there, found in one pass
 * with a stack, as TeX counts them when it skips; one whose `\fi` is not there has none.
 */
function matchConditionals(nodes: readonly Ast.Node[], context: Context): Map<number, Matched> {
  const matched = new Map<number, Matched>();
  const open: Matched[] = [];
  nodes.forEach((node, j) => {
    if (node?.type !== "macro") return;
    if (isConditional(node.content, context)) {
      const entry: Matched = {};
      matched.set(j, entry);
      open.push(entry);
    } else if (node.content === "else") {
      const top = open.at(-1);
      if (top !== undefined) top.otherwise ??= j;
    } else if (node.content === "fi") {
      const top = open.pop();
      if (top !== undefined) top.fi = j;
    }
  });
  return matched;
}

/**
 * What a constant conditional skips, given its `\else` and `\fi`: `\iffalse` skips to its `\else`
 * or its `\fi` (`skipsTo`, the index of the one it skips to, which it takes), and `\iftrue` from
 * its `\else` to its `\fi` (`skips`), or nothing. Undefined when its `\fi` is not among the nodes
 * after it, as when it closes in another group: it stays as it is.
 */
function branchOf(
  matched: Matched | undefined,
  value: boolean,
): { skipsTo?: number; skips?: { from: number; to: number } } | undefined {
  const fi = matched?.fi;
  if (fi === undefined) return undefined;
  const otherwise = matched?.otherwise;
  if (!value) return { skipsTo: otherwise ?? fi };
  return otherwise === undefined ? {} : { skips: { from: otherwise, to: fi } };
}

/** Whether a text item holds an alignment's `&`, one of the source's, not the escape `\&`. */
const aligns = (item: TextItem) =>
  item.pieces.some(
    (piece) => piece.kind === "text" && piece.literal !== undefined && piece.text.includes("&"),
  );

/**
 * Text items as paragraphs, a blank line ending one: each paragraph's text from its first item
 * that is not a space, a comment or a break to its last, which is a date when all of it reads as
 * one and it has no mark, and a text otherwise; a break at a paragraph's edge is raw, since it is
 * no space between words there. A paragraph that holds an alignment's `&` is an alignment's
 * cells, as a template's `tabular` sets them, and raw.
 */
function paragraphs(items: readonly TextItem[], context: Context): Node[] {
  const out: Node[] = [];
  let from = 0;
  for (let i = 0; i <= items.length; i++) {
    if (i < items.length && !items[i]?.par) continue;
    const paragraph = items.slice(from, i);
    from = i + 1;
    const first = paragraph.findIndex((item) => item.edge === undefined);
    let last = paragraph.length - 1;
    while (last >= 0 && paragraph[last]?.edge !== undefined) last--;
    const breakAt = (item: TextItem) =>
      made(context, {
        kind: "raw",
        why: "command",
        name: "\\",
        start: item.start,
        end: item.end,
      } satisfies RawNode);
    const edges = (list: readonly TextItem[]) => {
      for (const item of list) if (item.edge === "break") out.push(breakAt(item));
    };
    if (first < 0) {
      edges(paragraph);
      continue;
    }
    edges(paragraph.slice(0, first));
    const inside = paragraph.slice(first, last + 1);
    const start = inside[0]?.start ?? 0;
    const end = inside.at(-1)?.end ?? start;
    if (inside.some(aligns))
      out.push(made(context, { kind: "raw", why: "alignment", start, end } satisfies RawNode));
    else {
      const runs = runsOf(inside.flatMap((item) => item.pieces));
      if (runs.length > 0) out.push(textOrDate(runs, start, end, context));
    }
    edges(paragraph.slice(last + 1));
  }
  return out;
}

/** Text as a date node when all of it reads as a date or a range and it has no mark. */
function textOrDate(runs: RichText, start: number, end: number, context: Context): Node {
  const plain = runs.every((run) => !run.bold && !run.italic && run.href === undefined);
  const text = runs.map((run) => run.text).join("");
  const dates = plain ? readDates(text) : undefined;
  return dates === undefined
    ? made(context, { kind: "text", runs, start, end } satisfies TextNode)
    : made(context, { kind: "date", dates, text: text.trim(), start, end } satisfies DateNode);
}

/** What placing a node made, and the index of the node after what it took. */
interface Placed {
  nodes: Node[];
  next: number;
}

/** Place the node at `nodes[i]`, which is not text. */
function place(nodes: Ast.Node[], i: number, context: Context, state: TextState): Placed {
  const node = nodes[i] as Ast.Node;
  const span = spanOf(node) ?? { start: 0, end: 0 };
  const rawNode = (why: RawWhy, name?: string): Placed => ({
    nodes: [made(context, { kind: "raw", why, ...(name ? { name } : {}), ...span })],
    next: i + 1,
  });
  switch (node.type) {
    case "macro":
      return placeMacro(nodes, i, node, context, state);
    case "group": {
      const inner = deeper(context);
      return {
        nodes: [
          made(context, {
            kind: "group",
            ...span,
            content: sequence(node.content, inner, { ...state, grouped: true }),
          } satisfies GroupNode),
        ],
        next: i + 1,
      };
    }
    case "environment":
      return placeEnvironment(nodes, i, node, context, state);
    case "mathenv":
    case "inlinemath":
    case "displaymath":
      return rawNode("math");
    case "verb":
    case "verbatim":
      return rawNode("verbatim", node.env);
    default:
      return rawNode("unknown");
  }
}

/** An argument of the tree from one read, its content placed when `place` gives it. */
function argumentOf(read: ReadArgument, content?: Node[]): Argument {
  return {
    kind: read.kind,
    present: read.present,
    start: read.start,
    end: read.end,
    open: read.open,
    close: read.close,
    innerStart: read.innerStart,
    innerEnd: read.innerEnd,
    ...(content === undefined ? {} : { content }),
  };
}

/** Where a command ends: at its last argument the source gives, or at its name. */
const endAfter = (args: readonly ReadArgument[], end: number) =>
  args.reduce((last, arg) => (arg.present ? Math.max(last, arg.end) : last), end);

/**
 * A command's arguments placed: those `placed` names, or every one with content when it is
 * undefined, as a template call's; the rest kept as they are. A star or a token holds nothing.
 * Each argument is read in a state of its own, so that a declaration in one stays in it.
 */
function placedArguments(
  args: readonly ReadArgument[],
  context: Context,
  state: TextState,
  placed?: readonly number[],
): Argument[] {
  const inner = deeper(context);
  return args.map((arg, index) => {
    const places =
      arg.present &&
      (arg.kind === "mandatory" || arg.kind === "optional") &&
      (placed === undefined || placed.includes(index));
    return argumentOf(arg, places ? sequence(arg.content, inner, { ...state }) : undefined);
  });
}

/** Place a command: by the table's role, or as the engine said, or raw. */
function placeMacro(
  nodes: Ast.Node[],
  i: number,
  node: Ast.Macro,
  context: Context,
  state: TextState,
): Placed {
  const name = node.content;
  const span = spanOf(node) ?? { start: 0, end: 0 };
  const leaf = (why: RawWhy): Placed => ({
    nodes: [made(context, { kind: "raw", why, name, ...span } satisfies RawNode)],
    next: i + 1,
  });
  const rawWith = (standard: Standard, placed?: readonly number[]): Placed => {
    const read = readArguments(nodes, i + 1, standard.spec, span.end, node);
    if (read === undefined) return leaf("command");
    return {
      nodes: [
        made(context, {
          kind: "raw",
          why: "command",
          name,
          start: span.start,
          end: endAfter(read.args, span.end),
          args: placedArguments(read.args, context, { marks: PLAIN, grouped: true }, placed ?? []),
        } satisfies RawNode),
      ],
      next: read.next,
    };
  };
  const standard = STANDARD.get(name);
  if (standard !== undefined) {
    const role = standard.role;
    switch (role.kind) {
      case "section":
        return placeSection(nodes, i, node, role.level, context);
      case "item":
        return placeItem(nodes, i, node, context, state);
      case "definition":
        return placeDefinition(nodes, i, node, context);
      case "quantity":
        return placeQuantity(nodes, i, node, context);
      case "mark":
        return rawWith(standard, [0]);
      case "link":
        return rawWith(standard, [2]);
      case "raw":
        return rawWith(standard, role.content);
      default:
        // Text that did not decode, as an accent over a command, or a declaration outside a group.
        return rawWith(standard);
    }
  }
  const said = known(context.signatures?.commands, name);
  if (said === undefined) return leaf("unknown");
  if (said.kind === "register" || said.kind === "primitive")
    return placeQuantity(nodes, i, node, context, said.kind === "primitive");
  if (said.spec === undefined || !isReadable(said.spec))
    return leaf(said.kind === "template" ? "unresolved" : "unknown");
  const read = readArguments(nodes, i + 1, said.spec, span.end, node);
  if (read === undefined) return leaf("unresolved");
  const end = endAfter(read.args, span.end);
  if (said.kind !== "template" || !read.complete)
    return {
      nodes: [
        made(context, {
          kind: "raw",
          why: said.kind === "template" ? "unresolved" : "command",
          name,
          start: span.start,
          end,
          args: read.args.map((arg) => argumentOf(arg)),
        } satisfies RawNode),
      ],
      next: read.next,
    };
  const belied = openEnded(said.spec) ? groupsAfter(nodes, read.next) : undefined;
  const last = belied?.args.at(-1);
  if (belied !== undefined && last !== undefined)
    return {
      nodes: [
        made(context, {
          kind: "raw",
          why: "unresolved",
          name,
          start: span.start,
          end: last.end,
          args: [...read.args, ...belied.args].map((arg) => argumentOf(arg)),
          suspect: true,
        } satisfies RawNode),
      ],
      next: belied.next,
    };
  return {
    nodes: [
      made(context, {
        kind: "call",
        name,
        star: read.args.some((arg) => arg.kind === "star" && arg.present),
        start: span.start,
        end,
        args: placedArguments(read.args, context, { marks: PLAIN, grouped: false }),
      } satisfies CallNode),
    ],
    next: read.next,
  };
}

/**
 * Whether a signature leaves a call open to a group after it: it takes no mandatory argument, or
 * ends in an optional one, as the signature of a macro that hands its arguments on to another,
 * `\ding` to `\Pisymbol{pzd}`, or looks ahead for them, reads from its meaning.
 */
function openEnded(spec: string): boolean {
  // TODO(merge): part A marks a signature whose delegated tail did not resolve `tail:
  // unresolved`; the call to one a group follows is as suspect whatever its spec, and `Known`
  // should carry the mark for `placeMacro` to test here.
  const parts = readSpec(spec) ?? [];
  return !parts.some((part) => part.type === "mandatory") || parts.at(-1)?.type === "optional";
}

/**
 * The groups right after a call, spaces and comments between them, as TeX would read them as its
 * arguments, and the index after the last; none when a group does not come next.
 */
function groupsAfter(nodes: Ast.Node[], at: number): { args: ReadArgument[]; next: number } {
  const args: ReadArgument[] = [];
  let next = at;
  for (let j = at; j < nodes.length; j++) {
    const node = nodes[j];
    if (node?.type === "whitespace" || node?.type === "comment") continue;
    const span = spanOf(node);
    if (node?.type !== "group" || span === undefined) break;
    args.push({
      kind: "mandatory",
      present: true,
      ...span,
      open: "{",
      close: "}",
      content: node.content,
      innerStart: span.start + 1,
      innerEnd: span.end - 1,
    });
    next = j + 1;
  }
  return { args, next };
}

/** A section: its star, its optional title for the contents, and its title, placed. */
function placeSection(
  nodes: Ast.Node[],
  i: number,
  node: Ast.Macro,
  level: number,
  context: Context,
): Placed {
  const span = spanOf(node) ?? { start: 0, end: 0 };
  const read = readArguments(nodes, i + 1, "s o m", span.end, node);
  if (read === undefined || !read.complete)
    return {
      nodes: [made(context, { kind: "raw", why: "command", name: node.content, ...span })],
      next: i + 1,
    };
  const args = placedArguments(read.args, context, { marks: PLAIN, grouped: true });
  return {
    nodes: [
      made(context, {
        kind: "section",
        name: node.content,
        level,
        star: read.args[0]?.present === true,
        start: span.start,
        end: endAfter(read.args, span.end),
        args,
        title: args.at(-1)?.content ?? [],
      } satisfies SectionNode),
    ],
    next: read.next,
  };
}

/**
 * An `\item` outside a list the parser knows, as between a template's commands that open and
 * close one: its label, and its content, the text and raw chunks after it up to the next `\item`,
 * a paragraph's end or anything else the parser places.
 */
function placeItem(
  nodes: Ast.Node[],
  i: number,
  node: Ast.Macro,
  context: Context,
  state: TextState,
): Placed {
  const span = spanOf(node) ?? { start: 0, end: 0 };
  const read = readArguments(nodes, i + 1, "o", span.end, node);
  const from = read?.next ?? i + 1;
  let stop = from;
  while (stop < nodes.length && isItemContent(nodes[stop], context)) stop++;
  const inner = deeper(context);
  const args = labelOf(read?.args ?? [], inner, state);
  const content = sequence(nodes.slice(from, stop), inner, state);
  const end = Math.max(endAfter(read?.args ?? [], span.end), content.at(-1)?.end ?? 0);
  return {
    nodes: [made(context, { kind: "item", start: span.start, end, args, content })],
    next: stop,
  };
}

/**
 * An `\item`'s label placed, in a state of its own, since LaTeX sets it in a box: a declaration
 * in it marks nothing after it.
 */
function labelOf(args: readonly ReadArgument[], context: Context, state: TextState): Argument[] {
  return args.map((arg) =>
    argumentOf(
      arg,
      arg.present ? sequence(arg.content, context, { ...state, grouped: true }) : undefined,
    ),
  );
}

/**
 * Whether a node goes on an `\item`'s content outside a list: text and the commands the table
 * keeps raw, but not another `\item`, a paragraph's end, a section, an environment, or a call.
 */
function isItemContent(node: Ast.Node | undefined, context: Context): boolean {
  if (node === undefined || typeof node !== "object") return false;
  if (node.type === "parbreak" || node.type === "environment") return false;
  if (node.type !== "macro") return true;
  const standard = STANDARD.get(node.content);
  if (standard !== undefined)
    return standard.role.kind !== "item" && standard.role.kind !== "section";
  return known(context.signatures?.commands, node.content)?.kind !== "template";
}

/**
 * A definition in TeX's syntax, kept whole as one raw chunk: `\def`, `\edef`, `\gdef` or `\xdef`,
 * the name, its parameter text and its body in braces; `\let`, the name, an optional `=` and the
 * token it takes. Anything else after the command, it alone.
 */
function placeDefinition(nodes: Ast.Node[], i: number, node: Ast.Macro, context: Context): Placed {
  const span = spanOf(node) ?? { start: 0, end: 0 };
  const skip = (at: number) => {
    let j = at;
    while (nodes[j]?.type === "whitespace" || nodes[j]?.type === "comment") j++;
    return j;
  };
  let j = skip(i + 1);
  let end = span.end;
  let taken = i + 1;
  if (nodes[j]?.type === "macro") {
    end = spanOf(nodes[j])?.end ?? end;
    j++;
    if (node.content === "let") {
      j = skip(j);
      const equals = nodes[j];
      if (equals?.type === "string" && equals.content.startsWith("=")) {
        if (splitAt(nodes, j, 1) === equals) j++;
        j = skip(j);
      }
      const token = nodes[j];
      const target = token?.type === "string" ? splitAt(nodes, j, 1) : token;
      if (target !== undefined && target.type !== "parbreak") {
        end = spanOf(target)?.end ?? end;
        taken = target === token ? j + 1 : j;
      }
    } else if (node.content !== "futurelet") {
      // The parameter text, up to the body's group, on the same paragraph.
      let k = j;
      while (k < nodes.length && nodes[k]?.type !== "group" && nodes[k]?.type !== "parbreak") k++;
      if (nodes[k]?.type === "group") {
        end = spanOf(nodes[k])?.end ?? end;
        taken = k + 1;
      }
    }
  }
  return {
    nodes: [
      made(context, {
        kind: "raw",
        why: "definition",
        name: node.content,
        start: span.start,
        end,
      } satisfies RawNode),
    ],
    next: taken,
  };
}

/** A number as TeX reads one: digits with a point or a comma, and the signs before them. */
const DIGITS = "(?:[-+][ \\t]*)*(?:\\d+(?:[.,]\\d*)?|[.,]\\d+)";

/** A unit of TeX's, glue's infinities among them, or a register a number multiplies. */
const UNIT =
  "(?:[ \\t]*(?:true[ \\t]*)?(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu|px|fil{1,3})|\\\\[A-Za-z@]+)";

/** A value: a number and its unit, a number alone, or a register alone, its signs before it. */
const VALUE = `(?:${DIGITS}${UNIT}?|(?:[-+][ \\t]*)*\\\\[A-Za-z@]+)`;

/**
 * The quantity TeX reads after a primitive or a register: an optional `=`, `to` or `spread` for a
 * box, and a value, then any `plus` and `minus` parts of glue.
 */
const QUANTITY = new RegExp(
  `^(?:[ \\t]*=)?[ \\t]*(?:(?:to|spread)[ \\t]*)?${VALUE}(?:[ \\t]+(?:plus|minus)[ \\t]*${VALUE})*`,
);

/**
 * A number TeX reads after a primitive the table does not list, as `\hyphenpenalty=10000` or
 * `\char65`: an optional `=` and a number, with a unit when one follows, but never a command,
 * which such a primitive may be followed by for a reason of its own.
 */
const NUMBER = new RegExp(
  `^(?:[ \\t]*=)?[ \\t]*${DIGITS}(?:[ \\t]*(?:true[ \\t]*)?(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu|px))?`,
);

/**
 * A primitive or a register and the quantity after it, as one raw chunk: a primitive the table
 * does not list as taking one (`primitive`) takes a number only (`NUMBER`).
 */
function placeQuantity(
  nodes: Ast.Node[],
  i: number,
  node: Ast.Macro,
  context: Context,
  primitive = false,
): Placed {
  const span = spanOf(node) ?? { start: 0, end: 0 };
  const after = context.source.slice(span.end, span.end + 200);
  const match = (primitive ? NUMBER : QUANTITY).exec(after);
  const stop = span.end + (match?.[0].length ?? 0);
  let j = i + 1;
  let end = span.end;
  while (j < nodes.length) {
    const next = spanOf(nodes[j]);
    if (next === undefined || next.start >= stop) break;
    if (next.end > stop) {
      // A string that runs past the quantity gives up its first part, and keeps the rest.
      const taken = splitAt(nodes, j, stop - next.start);
      if (taken !== undefined) end = spanOf(taken)?.end ?? end;
      break;
    }
    end = next.end;
    j++;
  }
  return {
    nodes: [
      made(context, {
        kind: "raw",
        why: "command",
        name: node.content,
        start: span.start,
        end,
      } satisfies RawNode),
    ],
    next: j,
  };
}

/** Where an environment's `\begin{name}` ends, which its arguments follow. */
function beginEnd(source: string, start: number): number {
  const match = /^\\begin\s*\{[^}]*\}/.exec(source.slice(start, start + 256));
  return start + (match?.[0].length ?? 0);
}

/** A meaning that begins an alignment: `tabular` and its kin, `array`, `longtable`, `\halign`. */
const ALIGNMENT =
  /\\begin \{(?:tabular\*?|tabularx|tabulary|array|longtable)\}|\\(?:tabular|tabularx|tabulary|array|longtable|halign)(?![A-Za-z@])/;

/**
 * Whether a template environment is an alignment, as a `skills` environment that opens a
 * `tabular` is: its own macros' meanings, `\x`, `\endx` and those they hand their work to, name
 * one. Its body is then cells, raw, where text would read `&` as a character.
 */
function isAlignment(name: string, context: Context): boolean {
  const macros = context.signatures?.macros;
  if (macros === undefined) return false;
  const own = [name, `end${name}`].flatMap((each) => [
    each,
    `${each} `,
    `\\${each}`,
    `${each} code`,
  ]);
  return [
    ...own,
    ...["code", "end", "end aux", "end code"].map((part) => `environment ${name} ${part}`),
  ].some((each) => {
    const meaning = Object.hasOwn(macros, each) ? macros[each]?.meaning : undefined;
    return meaning !== undefined && ALIGNMENT.test(meaning);
  });
}

/** Place an environment: a list, a block, raw, the template's, or raw for want of knowing it. */
function placeEnvironment(
  nodes: Ast.Node[],
  i: number,
  node: Ast.Environment,
  context: Context,
  state: TextState,
): Placed {
  const span = spanOf(node) ?? { start: 0, end: 0 };
  const name = typeof node.env === "string" ? node.env : "";
  const leaf = (why: RawWhy): Placed => ({
    nodes: [made(context, { kind: "raw", why, name, ...span } satisfies RawNode)],
    next: i + 1,
  });
  const standard = STANDARD_ENVIRONMENTS.get(name);
  const said = standard === undefined ? known(context.signatures?.environments, name) : undefined;
  const spec =
    standard !== undefined && standard.role !== "raw"
      ? standard.spec
      : said?.kind === "template"
        ? said.spec
        : undefined;
  if (spec === undefined) return leaf(said?.kind === "template" ? "unresolved" : "environment");
  const read = readArguments(node.content, 0, spec, beginEnd(context.source, span.start), node);
  if (read === undefined || !read.complete)
    return leaf(said?.kind === "template" ? "unresolved" : "environment");
  const bodyNodes = node.content.slice(read.next);
  const inner = deeper(context);
  // A template environment's arguments are placed as a call's are; a standard one's are options.
  const args = placedArguments(
    read.args,
    context,
    { marks: PLAIN, grouped: false },
    standard === undefined ? undefined : [],
  );
  // A declaration used as an environment marks its body as it marks what follows it.
  const change = standard?.change;
  const body = {
    ...state,
    marks: change === undefined ? state.marks : changed(state.marks, change),
    grouped: true,
  };
  if (standard === undefined && isAlignment(name, context))
    return {
      nodes: [
        made(context, {
          kind: "environment",
          name,
          ...span,
          args,
          content: rawRun(bodyNodes, 0, bodyNodes.length, "alignment", inner),
        } satisfies EnvironmentNode),
      ],
      next: i + 1,
    };
  if (standard?.role === "block")
    return {
      nodes: [
        made(context, {
          kind: "block",
          name,
          ...span,
          args,
          content: sequence(bodyNodes, inner, body),
        } satisfies BlockNode),
      ],
      next: i + 1,
    };
  const content = withItems(bodyNodes, inner, body);
  return {
    nodes: [
      made(
        context,
        standard?.role === "list"
          ? ({ kind: "list", name, ...span, args, content } satisfies ListNode)
          : ({ kind: "environment", name, ...span, args, content } satisfies EnvironmentNode),
      ),
    ],
    next: i + 1,
  };
}

/**
 * A list's or a template environment's content: what comes before its first `\item`, and an item
 * for each, its label and everything after it up to the next.
 */
function withItems(nodes: Ast.Node[], context: Context, state: TextState): Node[] {
  const at: number[] = [];
  nodes.forEach((node, index) => {
    if (node?.type === "macro" && node.content === "item") at.push(index);
  });
  if (at.length === 0) return sequence(nodes, context, state);
  const out = sequence(nodes.slice(0, at[0]), context, state);
  const inner = deeper(context);
  at.forEach((index, k) => {
    const node = nodes[index] as Ast.Macro;
    const span = spanOf(node) ?? { start: 0, end: 0 };
    const segment = nodes.slice(index + 1, at[k + 1] ?? nodes.length);
    const read = readArguments(segment, 0, "o", span.end, node);
    const args = labelOf(read?.args ?? [], inner, state);
    const content = sequence(segment.slice(read?.next ?? 0), inner, state);
    const end = Math.max(endAfter(read?.args ?? [], span.end), content.at(-1)?.end ?? 0);
    out.push(made(context, { kind: "item", start: span.start, end, args, content }));
  });
  return out;
}
