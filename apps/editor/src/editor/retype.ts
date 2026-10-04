/**
 * Retyping a locked part's words (milestone 3 item 16, decision 0042).
 *
 * A locked part of an imported resume is LaTeX kept as the upload wrote it, which nothing edits
 * (decisions 0025 and 0041). Much of what such a part sets is still plain text in its LaTeX: a
 * heading's name, a skills list, a paragraph. So where the page's glyphs of a part line up with
 * runs of plain text in its LaTeX, the person may type new words over those runs, and nothing else:
 * the new words are escaped as a field's text is (`escapeText`, decision 0007), so that nothing
 * typed can become a command, open a group, start a comment or enter math, and they replace the
 * run's bytes in the part's LaTeX. The document then compiles in its own job, as any edit does, and
 * the change is kept only when it compiles, the page outside the part is the page before it to the
 * glyph (`outsideDifference` in `retype-check.ts`, the import's own comparison), and the part shows
 * the words typed (`showsTyped`); otherwise it is taken back, and the person reads why in plain
 * words. No model is asked anything and nothing leaves the browser: the words typed go into the
 * document, which is compiled and kept in this browser alone.
 *
 * The reading of a part's LaTeX (`piecesOf`) is deliberately narrow. A run of plain text ends at
 * anything TeX reads otherwise: a command, a brace, a comment, math, an alignment tab or a blank
 * line. The arguments of commands that set no text where they stand, as a link's address, a length
 * or an environment's name, are not runs at all, and neither is anything a command reads as it
 * stands, as a URL. A run right after a command's name, with no space between, is never offered,
 * since what is typed there would run into the name. The page's glyphs of the part are then lined up
 * with the runs in order (`alignPieces`); a run that does not line up is left as it is, and a part
 * none of whose runs with a letter or a digit lines up is not offered at all, with a reason the
 * person can read.
 */

import type { LockedSection } from "@resume-tools/resume-model";
import { FIRST_WORDS } from "../import/report";
import type { DrawnPage, GlyphBox } from "../page/draw";
import { isKeptId } from "../page/kept";
import { escapeText } from "../templates/escape";
import { INVISIBLE } from "../tex/fields";
import { type Command, CommandError, type Document, type History } from "./document";
import { type KeptEdit, type KeptSegment, keptSegments, outlineOf, writtenFields } from "./outline";

/** A run of plain text in a part's LaTeX. */
export interface Piece {
  /** Where its text stands in the LaTeX, from `start` to `end`, the whitespace around it left out. */
  start: number;
  end: number;
  /** Its text as the person reads it: whitespace one space, escapes, dashes and quotes read. */
  text: string;
  /**
   * Whether it starts right where a command's name or an accent ends, with no space between, as
   * `\small123` or `\'e`, where what is typed would run into the command: such a run is never
   * offered.
   */
  joined: boolean;
}

/**
 * Commands whose arguments set no text where they stand, or set it as they read it rather than as
 * text, by the number of brace groups that follow the name, past any bracketed options: a link's
 * address, a length, a colour, a label, a file, a counter, a definition, a URL.
 */
const SKIPPED_ARGUMENTS: Readonly<Record<string, number>> = {
  begin: 1,
  end: 1,
  vspace: 1,
  hspace: 1,
  href: 1,
  hyperlink: 1,
  hypertarget: 1,
  color: 1,
  textcolor: 1,
  colorbox: 1,
  fcolorbox: 2,
  pagecolor: 1,
  definecolor: 3,
  includegraphics: 1,
  label: 1,
  ref: 1,
  pageref: 1,
  eqref: 1,
  cite: 1,
  setlength: 2,
  addtolength: 2,
  settowidth: 2,
  setcounter: 2,
  addtocounter: 2,
  fontsize: 2,
  linespread: 1,
  rule: 2,
  raisebox: 1,
  parbox: 1,
  multicolumn: 2,
  input: 1,
  include: 1,
  usepackage: 1,
  newcommand: 2,
  renewcommand: 2,
  providecommand: 2,
  newenvironment: 3,
  renewenvironment: 3,
  ensuremath: 1,
  url: 1,
  path: 1,
  nolinkurl: 1,
};

/** Environments whose further arguments, past the name, set no text: a table's columns, a width. */
const ENVIRONMENT_ARGUMENTS: Readonly<Record<string, number>> = {
  tabular: 1,
  "tabular*": 2,
  tabularx: 2,
  tabulary: 2,
  longtable: 1,
  array: 1,
  minipage: 1,
  multicols: 1,
  "multicols*": 1,
  paracol: 1,
  wrapfigure: 2,
  adjustwidth: 2,
  list: 2,
};

/** Environments whose whole content is no text: math, and what is read as it stands. */
const SKIPPED_ENVIRONMENTS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
  "math",
  "displaymath",
  "verbatim",
  "verbatim*",
  "lstlisting",
  "minted",
  "comment",
]);

/** The control symbols that set a character, which a run of text may hold. */
const ESCAPED = new Set(["&", "%", "$", "#", "_", "{", "}"]);

/** The control symbols that put an accent over what follows. */
const ACCENTS = new Set(["'", "`", "^", '"', "~", "=", "."]);

/** The commands of one letter that put an accent over what follows, as `\c{c}` and `\v r`. */
const LETTER_ACCENTS = new Set(["H", "c", "v", "u", "r", "d", "b", "t", "k"]);

const LETTER = /[A-Za-z@]/;
const BLANK = /[ \t\r\n]/;

/**
 * The runs of plain text in a part's LaTeX, in order (the module's comment). Nothing of what a
 * command reads is a run: its name, its bracketed options, and the arguments of the commands in
 * `SKIPPED_ARGUMENTS`; nor is a comment, math, `\verb`, or the content of an environment in
 * `SKIPPED_ENVIRONMENTS`. A run ends at a brace, a bracket, a command (but for the escapes of a
 * character, `\&` and the like, which it holds), an alignment tab, `#`, `^`, `_`, `%`, `$`, and a
 * blank line.
 */
export function piecesOf(latex: string): Piece[] {
  const pieces: Piece[] = [];
  const n = latex.length;
  let start = -1;
  // Where the last command's name or accent ended, which a run starting there is joined to.
  let commandEnd = -1;
  let joined = false;
  const flush = (end: number) => {
    if (start < 0) return;
    let last = end;
    while (last > start && BLANK.test(latex[last - 1] ?? "")) last--;
    if (last > start)
      pieces.push({ start, end: last, text: shownText(latex.slice(start, last)), joined });
    start = -1;
  };
  /** Past whitespace from `at`, and a bracketed option or a star, as many as there are. */
  const pastOptions = (from: number): number => {
    let at = from;
    for (;;) {
      let next = at;
      while (next < n && BLANK.test(latex[next] ?? "")) next++;
      if (latex[next] === "*") {
        at = next + 1;
        continue;
      }
      if (latex[next] !== "[") return at;
      const close = groupEnd(latex, next, "[", "]");
      if (close < 0) return at;
      at = close + 1;
    }
  };
  /** Past `count` brace groups from `from`, each after whitespace and options. */
  const pastGroups = (from: number, count: number): number => {
    let at = from;
    for (let k = 0; k < count; k++) {
      let next = pastOptions(at);
      while (next < n && BLANK.test(latex[next] ?? "")) next++;
      if (latex[next] !== "{") {
        // A control word as the argument, as `\setlength\parskip`, or a single character.
        if (latex[next] === "\\") {
          let end = next + 1;
          if (LETTER.test(latex[end] ?? "")) while (end < n && LETTER.test(latex[end] ?? "")) end++;
          else end++;
          at = end;
          continue;
        }
        return at;
      }
      const close = groupEnd(latex, next, "{", "}");
      if (close < 0) return n;
      at = close + 1;
    }
    return at;
  };
  /**
   * Past what an accent at `from` goes over: a brace group, as `\"{u}` or `\c{c}`, which is no run,
   * or else, past spaces, as an accent's argument skips them, the letter it goes over, where the run
   * that starts is then joined to the accent and never offered, as `\"u` and `\v r`. Either way the
   * accent's glyph stands apart from every run offered, so that no retype moves it.
   */
  const pastAccented = (from: number): number => {
    let next = from;
    while (next < n && BLANK.test(latex[next] ?? "")) next++;
    if (latex[next] !== "{") return next;
    const close = groupEnd(latex, next, "{", "}");
    return close < 0 ? n : close + 1;
  };
  let at = 0;
  while (at < n) {
    const char = latex[at] as string;
    if (char === "\\") {
      const next = latex[at + 1];
      if (next === undefined) {
        flush(at);
        at++;
        continue;
      }
      if (LETTER.test(next)) {
        flush(at);
        let end = at + 1;
        while (end < n && LETTER.test(latex[end] ?? "")) end++;
        const name = latex.slice(at + 1, end);
        if (name === "verb") {
          // `\verb` and its text, between two of the character after it.
          const delimiter = latex[end] === "*" ? latex[end + 1] : latex[end];
          const open = latex[end] === "*" ? end + 1 : end;
          const close = delimiter === undefined ? -1 : latex.indexOf(delimiter, open + 1);
          at = close < 0 ? n : close + 1;
          commandEnd = at;
          continue;
        }
        if (name === "begin") {
          const close = environmentAt(latex, end);
          if (close !== undefined) {
            const { environment, after } = close;
            if (SKIPPED_ENVIRONMENTS.has(environment)) {
              const ending = latex.indexOf(`\\end{${environment}}`, after);
              at = ending < 0 ? n : ending + `\\end{${environment}}`.length;
            } else at = pastGroups(pastOptions(after), ENVIRONMENT_ARGUMENTS[environment] ?? 0);
            at = pastOptions(at);
            commandEnd = at;
            continue;
          }
        }
        if (LETTER_ACCENTS.has(name)) {
          at = pastAccented(end);
          commandEnd = at;
          continue;
        }
        const skipped = SKIPPED_ARGUMENTS[name];
        at =
          skipped === undefined ? (latex[end] === "*" ? end + 1 : end) : pastGroups(end, skipped);
        if (skipped === undefined) at = pastOptionsAfterName(latex, at);
        commandEnd = at;
        continue;
      }
      if (ESCAPED.has(next)) {
        if (start < 0) {
          start = at;
          joined = at === commandEnd;
        }
        at += 2;
        continue;
      }
      // Any other control symbol: a line break, a space of its own, an accent, math's delimiters.
      flush(at);
      if (next === "(" || next === "[") {
        const close = latex.indexOf(next === "(" ? "\\)" : "\\]", at + 2);
        at = close < 0 ? n : close + 2;
        commandEnd = -1;
        continue;
      }
      at += 2;
      if (next === "\\") at = pastOptionsAfterName(latex, at);
      if (ACCENTS.has(next)) at = pastAccented(at);
      commandEnd = ACCENTS.has(next) ? at : -1;
      continue;
    }
    if (char === "%") {
      flush(at);
      const line = latex.indexOf("\n", at);
      at = line < 0 ? n : line + 1;
      continue;
    }
    if (char === "$") {
      flush(at);
      const display = latex[at + 1] === "$";
      const close = latex.indexOf(display ? "$$" : "$", at + (display ? 2 : 1));
      at = close < 0 ? n : close + (display ? 2 : 1);
      continue;
    }
    if ("{}[]&#^_".includes(char)) {
      flush(at);
      at++;
      continue;
    }
    if (char === "\n" && blankLineAt(latex, at)) {
      flush(at);
      at++;
      continue;
    }
    if (start < 0) {
      if (BLANK.test(char)) {
        at++;
        continue;
      }
      start = at;
      joined = at === commandEnd;
    }
    at++;
  }
  flush(n);
  return pieces;
}

/**
 * Past the optional arguments and star that may follow a command's name, where they follow it
 * directly or after spaces, as `\item[label]` or `\\[2pt]`: bracketed options are no text of
 * the run they would otherwise start.
 */
function pastOptionsAfterName(latex: string, from: number): number {
  let at = from;
  for (;;) {
    let next = at;
    while (next < latex.length && (latex[next] === " " || latex[next] === "\t")) next++;
    if (latex[next] === "*") {
      at = next + 1;
      continue;
    }
    if (latex[next] !== "[") return at;
    const close = groupEnd(latex, next, "[", "]");
    if (close < 0) return at;
    at = close + 1;
  }
}

/** The index of the bracket that closes the one at `open`, nested ones counted; -1 when none. */
function groupEnd(latex: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  for (let at = open; at < latex.length; at++) {
    const char = latex[at];
    if (char === "\\") {
      at++;
      continue;
    }
    if (char === "%") {
      const line = latex.indexOf("\n", at);
      if (line < 0) return -1;
      at = line;
      continue;
    }
    if (char === opener) depth++;
    else if (char === closer && --depth === 0) return at;
  }
  return -1;
}

/** The environment `\begin` at `from` opens, by its name, and where its name's group ends. */
function environmentAt(
  latex: string,
  from: number,
): { environment: string; after: number } | undefined {
  let at = from;
  while (at < latex.length && BLANK.test(latex[at] ?? "")) at++;
  if (latex[at] !== "{") return undefined;
  const close = latex.indexOf("}", at);
  if (close < 0) return undefined;
  return { environment: latex.slice(at + 1, close).trim(), after: close + 1 };
}

/** Whether the line's end at `at` is followed, past spaces, by another: a blank line, a `\par`. */
function blankLineAt(latex: string, at: number): boolean {
  let next = at + 1;
  while (
    next < latex.length &&
    (latex[next] === " " || latex[next] === "\t" || latex[next] === "\r")
  )
    next++;
  return latex[next] === "\n";
}

/**
 * A run's text as the person reads it: its whitespace one space, a tie a space that does not
 * break, an escaped character the character, and TeX's dashes and double quotes the characters
 * they set.
 */
function shownText(raw: string): string {
  return raw
    .replace(/[ \t\r\n]+/g, " ")
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/~/g, " ")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/``/g, "“")
    .replace(/''/g, "”");
}

/** Whitespace and what sets no glyph, which a glyph stream does not hold. */
const UNSET = new RegExp(`\\s|${INVISIBLE.source}`, "gu");

/**
 * A text as the page's glyphs and a run's text are compared: no space, the case folded, TeX's
 * spellings of dashes and quotes and the characters they set alike, composed. A class may set a
 * part in capitals or small capitals, which the page reads as the letters' own case or not.
 */
export function canonical(text: string): string {
  return text
    .normalize("NFC")
    .replace(UNSET, "")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/``|''|[“”„"]/g, '"')
    .replace(/[‘’`]/g, "'")
    .toLowerCase();
}

/** A glyph whose text the page cannot read, as an icon's, which matches no character typed. */
const UNREAD = "�";

/** A glyph's text as `canonical` compares it, or `UNREAD`. */
const glyphCanonical = (text: string | undefined) =>
  text === undefined ? UNREAD : canonical(text) || "";

/** The glyphs a run spans among a part's: from `from` up to `to`. */
export interface Span {
  from: number;
  to: number;
}

/**
 * How far past the end of the last run lined up a short run is looked for among a part's glyphs:
 * what a command sets between two runs, a separator, an icon, a date a class sets first, is a few
 * glyphs, and a short run found further on is more likely another run's text than its own.
 */
const SKIP = 48;

/** A run this long is looked for anywhere after the last run lined up. */
const LONG = 12;

/**
 * Where the glyph `glyphs[at]` and those after it spell `text` (`canonical`): the number of glyphs
 * they take, or 0 when they do not. A hyphen glyph the text has no hyphen for, past the first, is
 * one TeX added at a line's end, and goes with the text.
 */
function spelledAt(text: string, glyphs: readonly string[], at: number): number {
  let k = 0;
  let index = at;
  while (k < text.length) {
    const glyph = glyphs[index];
    if (glyph === undefined) return 0;
    if (glyph === "") {
      index++;
      continue;
    }
    if (text.startsWith(glyph, k)) {
      k += glyph.length;
      index++;
    } else if (glyph === "-" && index > at) index++;
    else return 0;
  }
  return index - at;
}

/**
 * Each run lined up with a part's glyphs, in order, or undefined where it does not line up: a run
 * is found at the first glyph from where the last one ended that spells it, within `SKIP` glyphs
 * unless it is `LONG`, and a run the next one spells the same and is found at the same glyph is
 * left to the next, as a link's address written as its label is left to the label, which is what
 * the page sets.
 */
export function alignPieces(
  pieces: readonly Pick<Piece, "text">[],
  glyphs: readonly string[],
): (Span | undefined)[] {
  const texts = pieces.map((piece) => canonical(piece.text));
  const spans: (Span | undefined)[] = [];
  let cursor = 0;
  for (const [index, text] of texts.entries()) {
    if (text === "") {
      spans.push(undefined);
      continue;
    }
    const last = text.length >= LONG ? glyphs.length : Math.min(glyphs.length, cursor + SKIP + 1);
    let found: Span | undefined;
    for (let at = cursor; at < last && found === undefined; at++) {
      const taken = spelledAt(text, glyphs, at);
      if (taken > 0) found = { from: at, to: at + taken };
    }
    const next = texts[index + 1];
    if (found !== undefined && next === text && spelledAt(next, glyphs, found.from) > 0)
      found = undefined;
    spans.push(found);
    if (found !== undefined) cursor = found.to;
  }
  return spans;
}

/** The glyphs a locked part sets, on every page, in the order the pages paint them. */
export function partGlyphs(pages: readonly Pick<DrawnPage, "glyphs">[], part: string): GlyphBox[] {
  const id = part.toLowerCase();
  return pages.flatMap((page) => page.glyphs.filter((glyph) => glyph.locked === id));
}

/** A run the person may retype: the run, its text, and the part's glyphs it spans on the page. */
export interface RetypePiece extends Piece, Span {}

/** What a locked part offers to retype, read from its LaTeX and the page drawn of the document. */
export interface Retype {
  /** The locked section's id. */
  part: string;
  /** The runs offered, in order. */
  pieces: RetypePiece[];
  /** The part's glyphs as the page drew them, as `canonical` reads each, to check against after. */
  glyphs: string[];
}

/** Why a locked part offers nothing to retype, in plain words. */
export const NOT_RETYPED = {
  notShown: "It shows no words on the page.",
  notPlain: "Its words are not written as plain text in your file, so they cannot be changed here.",
} as const;

/** Whether a text holds a letter or a digit: only such a run is offered. */
const WORDS = /[\p{L}\p{N}]/u;

/**
 * What a locked section offers to retype on the pages drawn of its document (the module's comment),
 * or why it offers nothing: no glyph of it is drawn, or none of its runs with a letter or a digit
 * lines up with them, or every such run is joined to a command.
 */
export function retypeOf(
  section: Pick<LockedSection, "id" | "latex">,
  pages: readonly Pick<DrawnPage, "glyphs">[],
): Retype | { reason: string } {
  return retypeOn(section.id, section.latex, partGlyphs(pages, section.id));
}

/**
 * What a part offers to retype (`retypeOf`), from its LaTeX and its glyphs drawn, in the order the
 * pages paint them; with `within`, only a run that lies within one of the ranges it gives of the
 * LaTeX, which a segment of an outline's kept text gives as its pieces of kept text (`KeptSegment`).
 */
function retypeOn(
  part: string,
  latex: string,
  drawn: readonly Pick<GlyphBox, "text">[],
  within?: (start: number, end: number) => boolean,
): Retype | { reason: string } {
  if (drawn.length === 0) return { reason: NOT_RETYPED.notShown };
  const glyphs = drawn.map((glyph) => glyphCanonical(glyph.text));
  const pieces = piecesOf(latex);
  const spans = alignPieces(pieces, glyphs);
  const offered: RetypePiece[] = [];
  pieces.forEach((piece, index) => {
    const span = spans[index];
    if (
      span !== undefined &&
      !piece.joined &&
      WORDS.test(piece.text) &&
      (within === undefined || within(piece.start, piece.end))
    )
      offered.push({ ...piece, ...span });
  });
  if (offered.length === 0) return { reason: NOT_RETYPED.notPlain };
  return { part, pieces: offered, glyphs };
}

/**
 * The piece of kept text of `segment` a run from `start` to `end` of its LaTeX lies within, by its
 * index, or undefined where the run crosses from one piece to the next, or lies in what the
 * generator writes beside kept text, as a field's braces: such a run is not offered, since a retype
 * changes one piece of kept text and nothing else.
 */
function keptPieceOf(segment: KeptSegment, start: number, end: number): number | undefined {
  for (const [index, piece] of segment.pieces.entries()) {
    const from = segment.starts[index] ?? 0;
    if (start >= from && end <= from + piece.latex.length)
      return piece.at === undefined ? undefined : index;
  }
  return undefined;
}

/**
 * What a segment of an outline's kept text offers to retype on the pages drawn of its document
 * (the second pass's item 7): as a locked part, from its LaTeX and its glyphs (`retypeOf`), a run
 * offered only where it lies within one piece of kept text (`keptPieceOf`). `drawn` holds every
 * segment's glyphs, by its id, in the order the pages paint them (`keptGlyphs`).
 */
export function retypeKeptOf(
  segment: KeptSegment,
  drawn: ReadonlyMap<string, readonly GlyphBox[]>,
): Retype | { reason: string } {
  return retypeOn(
    segment.id,
    segment.latex,
    drawn.get(segment.id) ?? [],
    (start, end) => keptPieceOf(segment, start, end) !== undefined,
  );
}

/** The glyphs of every segment of kept text drawn on `pages`, by its id, as `partGlyphs` reads one. */
export function keptGlyphs(pages: readonly Pick<DrawnPage, "glyphs">[]): Map<string, GlyphBox[]> {
  const found = new Map<string, GlyphBox[]>();
  for (const page of pages)
    for (const glyph of page.glyphs)
      if (glyph.locked !== undefined && isKeptId(glyph.locked)) {
        const list = found.get(glyph.locked) ?? [];
        list.push(glyph);
        found.set(glyph.locked, list);
      }
  return found;
}

/** Whether `retypeOf` found something to retype. */
export const isRetype = (found: Retype | { reason: string }): found is Retype => "pieces" in found;

/**
 * What each locked section of a document offers to retype on its pages (`retypeOf`), by id; and
 * for an outline, what each segment of its kept text offers (`retypeKeptOf`), by the segment's id.
 */
export function retypesOf(
  document: Document,
  pages: readonly Pick<DrawnPage, "glyphs">[],
): Map<string, Retype | { reason: string }> {
  const found = new Map<string, Retype | { reason: string }>();
  for (const section of document.resume.sections)
    if (section.kind === "locked") found.set(section.id, retypeOf(section, pages));
    else if (section.kind === "outline") {
      const drawn = keptGlyphs(pages);
      for (const segment of keptSegments(section))
        found.set(segment.id, retypeKeptOf(segment, drawn));
    }
  return found;
}

/** Letters and digits alone, as a part's name and its glyphs are compared (`namesOnPage`). */
const lettersOf = (text: string) => canonical(text).replace(/[^\p{L}\p{N}]/gu, "");

/**
 * The side panel's names of a document's locked parts (`lockedWordsOf`, decision 0041), as the page
 * shows each now: the import report's name for a part while its words are still on the page, and
 * once a retype has replaced them, as decision 0042 lets it, the first words of its runs offered
 * (`FIRST_WORDS` of them, and an ellipsis after), or none, which the panel shows as kept as it was.
 * A part no page draws keeps the report's name. No name holds a backslash or a brace.
 */
export function namesOnPage(
  names: ReadonlyMap<string, string>,
  pages: readonly Pick<DrawnPage, "glyphs">[],
  retypes: ReadonlyMap<string, Retype | { reason: string }>,
): Map<string, string> {
  const shown = new Map<string, string>();
  for (const [part, name] of names) {
    const drawn = partGlyphs(pages, part);
    const wanted = lettersOf(name);
    const letters = lettersOf(drawn.map((glyph) => glyph.text ?? "").join(""));
    if (drawn.length === 0 || wanted === "" || letters.includes(wanted)) {
      shown.set(part, name);
      continue;
    }
    const found = retypes.get(part);
    if (found === undefined || !isRetype(found)) continue;
    const words = found.pieces
      .map((piece) => piece.text)
      .join(" ")
      .replace(/[\\{}]/g, " ")
      .split(/\s+/)
      .filter((word) => word !== "");
    if (words.length === 0) continue;
    const first = words.slice(0, FIRST_WORDS).join(" ");
    shown.set(part, words.length > FIRST_WORDS ? `${first}…` : first);
  }
  return shown;
}

/**
 * What the person typed as LaTeX: its whitespace one space and none at its ends, and escaped as a
 * field's text is (`escapeText`, decision 0007), so that every character either sets as itself or
 * is left out, and none can call a command, open or close a group, start a comment or enter math.
 */
export function escapeTyped(text: string): string {
  return escapeText(text.replace(/[ \t\r\n]+/g, " ").trim());
}

/** The text a run is typed as, trimmed as `escapeTyped` trims it, for telling whether it changed. */
const typed = (text: string) => text.replace(/[ \t\r\n]+/g, " ").trim();

/**
 * A part's LaTeX with the runs the person retyped replaced (`texts`, one for each of `retype`'s
 * pieces, in order): each changed run's bytes, its whitespace around it kept, become what was typed,
 * escaped (`escapeTyped`). Undefined when nothing changed.
 */
export function retyped(
  latex: string,
  retype: Retype,
  texts: readonly string[],
): string | undefined {
  let changed = latex;
  let any = false;
  for (let index = retype.pieces.length - 1; index >= 0; index--) {
    const piece = retype.pieces[index] as RetypePiece;
    const text = texts[index];
    if (text === undefined || typed(text) === typed(piece.text)) continue;
    // Typed otherwise but written the same, as with a character escaping drops or composes.
    const escaped = escapeTyped(text);
    if (escaped === latex.slice(piece.start, piece.end)) continue;
    changed = changed.slice(0, piece.start) + escaped + changed.slice(piece.end);
    any = true;
  }
  return any ? changed : undefined;
}

/**
 * The edits of an outline's kept text that retype `segment`'s runs as `texts` (one for each of
 * `retype`'s pieces, in order), as `retyped` retypes a locked part's LaTeX: each changed run's bytes,
 * in the piece of kept text it lies within, become what was typed, escaped. Undefined when nothing
 * changed.
 */
export function retypedKept(
  segment: KeptSegment,
  retype: Retype,
  texts: readonly string[],
): KeptEdit[] | undefined {
  const changed = new Map<number, string>();
  for (let index = retype.pieces.length - 1; index >= 0; index--) {
    const piece = retype.pieces[index] as RetypePiece;
    const text = texts[index];
    if (text === undefined || typed(text) === typed(piece.text)) continue;
    const escaped = escapeTyped(text);
    if (escaped === segment.latex.slice(piece.start, piece.end)) continue;
    const at = keptPieceOf(segment, piece.start, piece.end);
    if (at === undefined) continue;
    const from = segment.starts[at] ?? 0;
    const latex = changed.get(at) ?? segment.pieces[at]?.latex ?? "";
    changed.set(at, latex.slice(0, piece.start - from) + escaped + latex.slice(piece.end - from));
  }
  if (changed.size === 0) return undefined;
  return [...changed].flatMap(([at, latex]) => {
    const where = segment.pieces[at]?.at;
    return where === undefined ? [] : [{ at: where, latex }];
  });
}

/**
 * Whether the part's glyphs on the pages after a retype spell what the person asked for: its glyphs
 * before, each retyped run's replaced by what was typed (`canonical`), hyphens aside, since TeX may
 * break a word of the part at another place now.
 */
export function showsTyped(
  retype: Retype,
  texts: readonly string[],
  pages: readonly Pick<DrawnPage, "glyphs">[],
): boolean {
  const changes = new Map<number, RetypePiece & { text: string }>();
  retype.pieces.forEach((piece, index) => {
    const text = texts[index];
    if (text !== undefined && typed(text) !== typed(piece.text))
      changes.set(piece.from, { ...piece, text });
  });
  let expected = "";
  for (let at = 0; at < retype.glyphs.length; ) {
    const change = changes.get(at);
    if (change !== undefined) {
      expected += canonical(change.text);
      at = change.to;
    } else expected += retype.glyphs[at++];
  }
  const after = partGlyphs(pages, retype.part)
    .map((glyph) => glyphCanonical(glyph.text))
    .join("");
  const unhyphened = (text: string) => text.replace(/-/g, "");
  return unhyphened(after) === unhyphened(expected);
}

/** What the person reads when a retype is taken back, by why; never TeX's words. */
export const RETYPE_REFUSED = {
  stopped: "That text stopped the page from being made, so it was taken back.",
  moved:
    "That text moved what is around this part on the page, so it was taken back. Try fewer or shorter words.",
  shown: "That text did not come out on the page as it was typed, so it was taken back.",
  failed: "The page could not be checked with that text, so it was taken back.",
  refused: "That text cannot be kept in this part.",
} as const;

/** Why a retype was taken back (`RETYPE_REFUSED`). */
export type RetypeRefusal = keyof typeof RETYPE_REFUSED;

/**
 * Whether the page outside a part is the page before a retype of it, from the two outputs: the
 * import's comparison of glyph streams with the part's own glyphs, rules and specials left out of
 * both (`retype-check.ts`, which the app loads when the first retype is checked, since it reads the
 * output as the import does). True when nothing outside it changed.
 */
export type OutsideCheck = (
  before: Uint8Array,
  after: Uint8Array,
  part: string,
  outline?: readonly string[],
) => Promise<boolean>;

/** A page as the guard reads it: its document, its pages, and the output they were drawn from. */
export interface Paged {
  document: Document;
  pages: readonly Pick<DrawnPage, "glyphs">[];
  output?: Uint8Array;
}

/** A retype applied and waiting for its page. */
interface Pending {
  history: History;
  /** The document before it, which a page showed, and after it, which is compiling. */
  before: Document;
  after: Document;
  retype: Retype;
  texts: readonly string[];
  /** The output the page before it was drawn from, which the page after it is compared with. */
  output: Uint8Array;
  /**
   * For a segment of an outline's kept text, the outline's fields the generator writes, which the
   * outputs' segments are read by (`writtenFields`, `keptSets`).
   */
  outline?: readonly string[];
}

/**
 * The command that retypes `retype`'s runs as `texts` in `document`: of a locked section's LaTeX,
 * or of a segment of an outline's kept text, with the outline's fields the generator writes, which
 * its check reads the outputs by; `unchanged` where nothing would change, and undefined where the
 * document has no such part.
 */
function commandOf(
  document: Document,
  retype: Retype,
  texts: readonly string[],
): { command: Command; outline?: readonly string[] } | "unchanged" | undefined {
  if (isKeptId(retype.part)) {
    const outline = outlineOf(document.resume);
    const segment = outline && keptSegments(outline).find((each) => each.id === retype.part);
    if (outline === undefined || segment === undefined) return undefined;
    const kept = retypedKept(segment, retype, texts);
    if (kept === undefined) return "unchanged";
    return {
      command: { type: "retypeKept", section: outline.id, kept },
      outline: writtenFields(outline),
    };
  }
  const section = document.resume.sections.find(
    (each) => each.kind === "locked" && each.id === retype.part,
  );
  if (section?.kind !== "locked") return undefined;
  const latex = retyped(section.latex, retype, texts);
  if (latex === undefined) return "unchanged";
  return { command: { type: "retype", section: retype.part, latex } };
}

/** What became of a retype once its page came, or did not. */
export type RetypeVerdict = { kept: true } | { kept: false; why: RetypeRefusal };

/**
 * The retype of a locked part, from the person's words to a document kept or taken back (the
 * module's comment). It applies the retype as one step of the history, which is not saved until
 * its page comes and passes; the app compiles the document as any edit, and tells the guard of its
 * page, or that its compile stopped or failed. A retype that does not pass is taken back, the step
 * dropped from the history with nothing to redo (`History.takeBack`), and the app shows the
 * document before it again. While one waits, the app takes no other edit, so that the page that
 * comes is the retype's alone.
 */
export class RetypeGuard {
  private pending: Pending | undefined;
  /**
   * The document of a retype cancelled while it compiled, whose page, or whose stop, may still
   * land: it is dropped (`discards`), so that a cancelled retype's page is never shown either.
   */
  private cancelled: Document | undefined;

  constructor(private readonly outside: OutsideCheck) {}

  /** Whether a retype waits for its page, which the app takes no other edit during. */
  holds(): boolean {
    return this.pending !== undefined;
  }

  /** Whether `document` is the waiting retype's, whose page the app shows only once it passes. */
  waitsFor(document: Document): boolean {
    return this.pending?.after === document;
  }

  /**
   * Retype a part: `texts` for `retype`'s pieces, on `history`, whose present the page `shown`
   * shows. The document after it, which the app compiles and does not save; `unchanged` where
   * nothing was changed; or why it cannot be, as a text the part cannot keep (`refused`), or no page
   * of the present document to compare with (`failed`).
   */
  start(
    history: History,
    retype: Retype,
    texts: readonly string[],
    shown: Paged,
  ): Document | "unchanged" | { why: RetypeRefusal } {
    const before = history.present;
    if (this.pending !== undefined || shown.document !== before || shown.output === undefined)
      return { why: "failed" };
    const found = commandOf(before, retype, texts);
    if (found === undefined) return { why: "failed" };
    if (found === "unchanged") return "unchanged";
    const { command, outline } = found;
    let after: Document;
    try {
      after = history.dispatch(command);
    } catch (error) {
      if (error instanceof CommandError) return { why: "refused" };
      throw error;
    }
    // A document the same as before is no step of the history, and nothing to check or take back.
    if (after === before) return "unchanged";
    this.cancelled = undefined;
    this.pending = {
      history,
      before,
      after,
      retype,
      texts,
      output: shown.output,
      ...(outline === undefined ? {} : { outline }),
    };
    return after;
  }

  /**
   * A page came: undefined unless it is the waiting retype's, which is then checked, kept or taken
   * back. The verdict comes once the check is done; the app saves a kept retype and shows a taken
   * back one's document again.
   */
  async paged(shown: Paged): Promise<RetypeVerdict | undefined> {
    const pending = this.pending;
    if (pending === undefined || shown.document !== pending.after) return undefined;
    let unchanged = false;
    try {
      unchanged =
        shown.output !== undefined &&
        (await this.outside(pending.output, shown.output, pending.retype.part, pending.outline));
    } catch (error) {
      console.error("The page outside the part could not be compared:", error);
      if (this.pending !== pending) return undefined;
      return this.takeBack(pending, "failed");
    }
    // Forgotten meanwhile, as when another document opened.
    if (this.pending !== pending) return undefined;
    if (!unchanged) return this.takeBack(pending, "moved");
    if (!showsTyped(pending.retype, pending.texts, shown.pages))
      return this.takeBack(pending, "shown");
    this.pending = undefined;
    return { kept: true };
  }

  /** The compile of `document` stopped: the waiting retype's, which is taken back. */
  stopped(document: Document): RetypeVerdict | undefined {
    const pending = this.pending;
    if (pending === undefined || document !== pending.after) return undefined;
    return this.takeBack(pending, "stopped");
  }

  /** No page came, for another reason than TeX's: the waiting retype, if any, is taken back. */
  failed(): RetypeVerdict | undefined {
    const pending = this.pending;
    return pending === undefined ? undefined : this.takeBack(pending, "failed");
  }

  /** The person cancelled the retype waiting for its page, which is taken back; whether one was. */
  cancel(): boolean {
    const pending = this.pending;
    if (pending === undefined) return false;
    this.takeBack(pending, "failed");
    this.cancelled = pending.after;
    return true;
  }

  /**
   * Whether a page, a stop or a failure of `document` is a cancelled retype's, which the app drops:
   * its compile was in flight when it was cancelled, and lands all the same.
   */
  discards(document: Document): boolean {
    return this.cancelled !== undefined && document === this.cancelled;
  }

  /** Let go of the waiting retype, as when another document opens: nothing of it is saved. */
  forget(): void {
    this.pending = undefined;
    this.cancelled = undefined;
  }

  private takeBack(pending: Pending, why: RetypeRefusal): RetypeVerdict {
    this.pending = undefined;
    if (pending.history.present === pending.after) pending.history.takeBack();
    return { kept: false, why };
  }
}
