/**
 * A body's tree printed back to source (milestone 3 item 4, decision 0020): the body's own bytes
 * for every span nobody replaced, so that a tree printed as the parser made it is the inlined body
 * exactly, and the probe (item 5) and the assembly (item 7) can splice what they make at a node's
 * or an argument's span.
 *
 * A node's bytes are its children's, each printed in turn, and the body's between them, its
 * command's name, its delimiters and its spaces; a node with no children, a raw chunk, a text or a
 * date, is its span's bytes. The walk goes as deep as the tree, which the parser caps at 64 levels.
 *
 * Printed as the parser made it, a tree gives back its bytes whatever it got wrong, so the corpus
 * runner prints it a second way too (`regenerate`): every text and every date as the generator
 * writes what the model holds of it, a text's runs escaped as the generator escapes a rich field
 * (`escape.ts`), bold, italic and links written as it writes them, and a date formatted as it
 * formats one (`templates/dates.ts`) in the format the date is spelled in. What that sets the
 * reference's glyphs for is what the model can hold of the body as it is.
 */

import type { Dates, RichText } from "@resume-tools/resume-model";
import type { Engine } from "../engine/session";
import { formatDates } from "../templates/dates";
import { escapeText, escapeUrl, type TextFonts } from "../templates/escape";
import { linkAddress } from "../templates/generate";
import type { DateFormat } from "../templates/package";
import { type RunBreaks, runBreaks, runBreaksWithin } from "../tex/runs";
import type { Argument, Node, Tree } from "./parse";

/** What a caller puts in the place of a node or an argument, or undefined to keep its bytes. */
export type Replace = (part: Node | Argument) => string | undefined;

/** A node's or an argument's parts that are printed in turn, in the order of the body. */
function partsOf(part: Node | Argument): (Node | Argument)[] {
  switch (part.kind) {
    case "mandatory":
    case "optional":
      return part.content ?? [];
    case "star":
    case "token":
    case "text":
    case "date":
      return [];
    case "raw":
      return (part.args ?? []).filter((arg) => arg.present);
    case "group":
      return part.content;
    case "section":
    case "call":
      return part.args.filter((arg) => arg.present);
    case "list":
    case "environment":
    case "block":
    case "item":
      return [...part.args.filter((arg) => arg.present), ...part.content];
  }
}

/**
 * The source a tree prints to: the body's bytes, with what `replace` gives in the place of any node
 * or argument it names. With no `replace`, the inlined body as it was parsed.
 */
export function print(tree: Tree, replace?: Replace): string {
  const out: string[] = [];
  const source = tree.source;
  const walk = (part: Node | Argument) => {
    const replaced = replace?.(part);
    if (replaced !== undefined) {
      out.push(replaced);
      return;
    }
    let at = part.start;
    for (const child of partsOf(part)) {
      out.push(source.slice(at, child.start));
      walk(child);
      at = child.end;
    }
    out.push(source.slice(at, part.end));
  };
  let at = tree.start;
  for (const node of tree.content) {
    out.push(source.slice(at, node.start));
    walk(node);
    at = node.end;
  }
  out.push(source.slice(at, tree.end));
  return out.join("");
}

// Regenerating.

/** The four formats the generator writes a date in (`DateFormat`). */
const FORMATS: readonly DateFormat[] = ["MMM yyyy", "MMMM yyyy", "MM/yyyy", "yyyy"];

/**
 * A XeTeX document's fonts, as regenerating takes them: every character its text holds, which the
 * reference set with those fonts, so that the text stays composed as the generator keeps it for
 * XeTeX's fonts, and none is left out.
 */
const EVERY_CHARACTER: TextFonts = { covers: () => true, lacks: () => {} };

/** How the generator escapes a text for a document on an engine (`escapeText`). */
export function escaperFor(engine: Engine): (text: string) => string {
  return engine === "xetex"
    ? (text) => escapeText(text, EVERY_CHARACTER)
    : (text) => escapeText(text);
}

/**
 * Text as the generator escapes a slot's (`generate.ts`'s `escapeRun`), cut as `cut` says: with a
 * break opportunity before each of its breaks, where a run with no space would pass
 * `UNBROKEN_RUN` characters, and without the accents past `MAX_MARKS` on one letter.
 */
function escapeRun(
  text: string,
  escape: (text: string) => string,
  cut: RunBreaks = runBreaks(text),
): string {
  if (cut.breaks.length === 0 && cut.surplus.length === 0) return escape(text);
  let latex = "";
  let from = 0;
  let next = 0;
  const piece = (to: number) => {
    let kept = "";
    let at = from;
    for (; next < cut.surplus.length && (cut.surplus[next] as number) < to; next++) {
      const skipped = cut.surplus[next] as number;
      const mark = String.fromCodePoint(text.codePointAt(skipped) ?? 0);
      kept += text.slice(at, skipped);
      at = skipped + mark.length;
    }
    return escape(kept + text.slice(at, to));
  };
  for (const at of cut.breaks) {
    latex += `${piece(at)}\\allowbreak `;
    from = at;
  }
  return latex + piece(text.length);
}

/**
 * Rich text as the generator writes it (`generate.ts`'s `richLatex`), run by run: escaped, bold
 * outside italic, and a link outside both, to the address `linkAddress` gives, or its text alone
 * when the editor does not link the address.
 */
export function richLatex(runs: RichText, escape: (text: string) => string): string {
  let latex = "";
  const cut = runBreaks(runs.map((run) => run.text).join(""));
  let from = 0;
  for (const run of runs) {
    const to = from + run.text.length;
    let part = escapeRun(run.text, escape, runBreaksWithin(cut, from, to));
    from = to;
    if (part === "") continue;
    if (run.italic) part = `\\textit{${part}}`;
    if (run.bold) part = `\\textbf{${part}}`;
    const address = run.href === undefined ? undefined : linkAddress(run.href);
    if (address !== undefined) part = `\\href{${escapeUrl(address)}}{${part}}`;
    if (part.startsWith("`") && /[?!]$/.test(latex)) latex += "{}";
    latex += part;
  }
  return latex;
}

/**
 * The format a date's text is spelled in, of the four the generator formats dates in: the one it
 * would write the same text in, or undefined when it would write none of them so.
 */
export function spellingOf(dates: Dates, text: string): DateFormat | undefined {
  return FORMATS.find((format) => formatDates(dates, format) === text);
}

/** Whether the text before `at` ends in a control word: letters after a backslash that is one. */
function endsInControlWord(source: string, at: number): boolean {
  let start = at;
  while (start > 0 && /[A-Za-z]/.test(source[start - 1] ?? "")) start--;
  if (start === at || source[start - 1] !== "\\") return false;
  let backslashes = 1;
  while (start - 1 - backslashes >= 0 && source[start - 1 - backslashes] === "\\") backslashes++;
  return backslashes % 2 === 1;
}

/**
 * Regenerated source put at a node's span as TeX reads it there: after a control word, braces
 * before a letter or a space, which would join its name or be skipped; and where the node ended in
 * a control word, which had TeX skip the spaces after it, `\relax` after it, which does the same.
 */
function spliced(source: string, node: Node, latex: string): string {
  const before = /^[A-Za-z\s]/.test(latex) && endsInControlWord(source, node.start) ? "{}" : "";
  const after =
    endsInControlWord(source, node.end) && /^\s/.test(source.slice(node.end, node.end + 1))
      ? "\\relax"
      : "";
  return `${before}${latex}${after}`;
}

/**
 * The source a tree prints to with every text and date as the generator writes what the model
 * holds of it, for a document on `engine`: a text's runs as rich text (`richLatex`), escaped as the
 * generator escapes for that engine; a date formatted in the format it is spelled in
 * (`spellingOf`), or its own bytes when it is spelled in none; and the rest the body's bytes.
 */
export function regenerate(tree: Tree, engine: Engine): string {
  const escape = escaperFor(engine);
  return print(tree, (part) => {
    if (part.kind === "text") return spliced(tree.source, part, richLatex(part.runs, escape));
    if (part.kind !== "date") return undefined;
    const format = spellingOf(part.dates, part.text);
    return format === undefined
      ? undefined
      : spliced(tree.source, part, escapeRun(formatDates(part.dates, format), escape));
  });
}
