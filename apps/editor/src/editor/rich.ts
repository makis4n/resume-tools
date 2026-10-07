/**
 * Rich fields in the editor: bullets, list items and paragraphs, whose text is runs that are plain
 * or bold, italic or a link, and nothing else (decision 0006). They are edited in Tiptap (plan
 * section 8.1, milestone 2 item 10), and this module is the pure part of that: the editor's
 * schema, a field's runs as a ProseMirror document and back, which font each variant of a field is
 * set in on the page, the runs as TeX sets them for the breaker, and where TeX's line breaks fall
 * in the document.
 *
 * A rich field is one paragraph, so its text is one string and a character's offset in it is its
 * offset in the runs joined, which is also how the generator names it to the page (decision 0007).
 */

import type { RichText, Run } from "@resume-tools/resume-model";
import type { JSONContent } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { FontVariant } from "../page/fontnames";
import { escapeText } from "../templates/escape";
import { linkAddress } from "../templates/generate";

/** A rich field's document: one paragraph, since Enter inserts nothing (decision 0004). */
const OneParagraph = Document.extend({ content: "paragraph" });

/**
 * A link with an address and nothing else. The address is kept as the user typed it, since the
 * generator decides what links (`linkAddress`, decision 0007), and it is not written into the
 * editor's DOM, where a browser could follow it. A link never opens on a click, never grows as the
 * user types past its end, and is never made from text that looks like an address, pasted or
 * typed: only the link control makes one.
 */
const AddressLink = Link.extend({
  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("href"),
        renderHTML: () => ({}),
      },
    };
  },
  renderHTML() {
    return ["a", 0];
  },
}).configure({
  openOnClick: false,
  enableClickSelection: false,
  autolink: false,
  linkOnPaste: false,
  isAllowedUri: () => true,
});

/** The Tiptap extensions that make a rich field's schema: a paragraph of text, bold, italic, link. */
export const RICH_SCHEMA = [OneParagraph, Paragraph, Text, Bold, Italic, AddressLink];

/** A run's marks as the model has them: set only when present, so runs compare as JSON does. */
function runOf(text: string, marks: readonly Mark[]): Run {
  const run: Run = { text };
  for (const mark of marks) {
    if (mark.type.name === "bold") run.bold = true;
    else if (mark.type.name === "italic") run.italic = true;
    else if (mark.type.name === "link") run.href = String(mark.attrs.href ?? "");
  }
  // The model's key order, so a run reads the same whichever order the marks came in.
  const { bold, italic, href } = run;
  return {
    text,
    ...(bold && { bold }),
    ...(italic && { italic }),
    ...(href !== undefined && { href }),
  };
}

const sameMarks = (a: Run, b: Run) =>
  a.bold === b.bold && a.italic === b.italic && a.href === b.href;

/**
 * The runs a rich field's document holds: each text node's text and marks, a text next to one with
 * the same marks joined to it, and no empty run. A run has `bold` and `italic` only when true and
 * `href` only on a link, so that runs that mean the same are the same JSON.
 */
export function docToRuns(doc: ProseMirrorNode): RichText {
  const runs: Run[] = [];
  doc.descendants((node) => {
    if (!node.isText || !node.text) return;
    const run = runOf(node.text, node.marks);
    const last = runs.at(-1);
    if (last && sameMarks(last, run)) last.text += run.text;
    else runs.push(run);
  });
  return runs;
}

/** A rich field's document for its runs: one paragraph of their texts, each with its marks. */
export function runsToDoc(runs: RichText): JSONContent {
  const content: JSONContent[] = runs
    .filter((run) => run.text !== "")
    .map((run) => {
      const marks: JSONContent["marks"] = [];
      if (run.bold) marks.push({ type: "bold" });
      if (run.italic) marks.push({ type: "italic" });
      if (run.href !== undefined) marks.push({ type: "link", attrs: { href: run.href } });
      return { type: "text", text: run.text, ...(marks.length > 0 && { marks }) };
    });
  return { type: "doc", content: [{ type: "paragraph", ...(content.length > 0 && { content }) }] };
}

/**
 * Which of a field's fonts a run is set in: what bold and italic choose. A link chooses none, as
 * `\href` changes no font, so a link's text is set in the variant of its bold and italic.
 */
export type Variant = FontVariant;

export const VARIANTS: readonly Variant[] = ["regular", "bold", "italic", "boldItalic"];

export function variantOf(run: { bold?: boolean; italic?: boolean }): Variant {
  if (run.bold) return run.italic ? "boldItalic" : "bold";
  return run.italic ? "italic" : "regular";
}

/** A glyph of a field as the page sets it: the offset of its character, and a name for its font. */
export interface PageGlyph {
  offset: number;
  font: string;
}

/** A character that is a letter or a digit, which says more of a run's font than a symbol does. */
const LETTER = /^[\p{L}\p{N}]$/u;

/**
 * The font each variant of a field is set in on the page, from the page's glyphs of the field and
 * the runs the page was compiled from, whose joined text the glyphs' offsets count through. Each
 * glyph goes to the variant of the run its character is in, and a variant gets the font that sets
 * the most of its letters and digits, then the most of its glyphs, then the first: a run's first
 * glyph may be a character LaTeX takes from a companion font, such as `€` from TS1, and a variant
 * set in TS1 would measure every letter as nothing, as item 9's reviewers found for fields. A
 * variant none of whose runs has a glyph on the page is left out, and takes another font until a
 * page sets it.
 */
export function variantFonts(runs: RichText, glyphs: readonly PageGlyph[]): Map<Variant, string> {
  const text = runs.map((run) => run.text).join("");
  // Where each run starts, and its variant, in order.
  const starts: number[] = [];
  let at = 0;
  for (const run of runs) {
    starts.push(at);
    at += run.text.length;
  }
  const variantAt = (offset: number): Variant | undefined => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((starts[middle] as number) <= offset) low = middle;
      else high = middle - 1;
    }
    const run = runs[low];
    return run && offset < text.length ? variantOf(run) : undefined;
  };
  const counts = new Map<
    Variant,
    Map<string, { letters: number; glyphs: number; order: number }>
  >();
  for (const glyph of glyphs) {
    const variant = variantAt(glyph.offset);
    if (variant === undefined) continue;
    const fonts = counts.get(variant) ?? new Map();
    counts.set(variant, fonts);
    const count = fonts.get(glyph.font) ?? { letters: 0, glyphs: 0, order: fonts.size };
    fonts.set(glyph.font, count);
    count.glyphs++;
    const code = text.codePointAt(glyph.offset);
    if (code !== undefined && LETTER.test(String.fromCodePoint(code))) count.letters++;
  }
  const table = new Map<Variant, string>();
  for (const [variant, fonts] of counts) {
    const [best] = [...fonts].sort(
      ([, a], [, b]) => b.letters - a.letters || b.glyphs - a.glyphs || a.order - b.order,
    );
    if (best) table.set(variant, best[0]);
  }
  return table;
}

/** A run of a rich field as TeX sets it, for the breaker (`FaceRun`). */
export interface BreakRun {
  text: string;
  variant: Variant;
  /** Whether TeX sets an italic correction where the run ends. */
  italicCorrection: boolean;
  /** Whether the run is a link the generator writes in `\href`, with its specials. */
  link: boolean;
}

/** A run as the generator writes it (`richLatex`): its LaTeX and what wraps it. */
interface Written {
  text: string;
  latex: string;
  bold: boolean;
  italic: boolean;
  linked: boolean;
}

/** Characters after which LaTeX sets no italic correction, `\nocorrlist`. */
const NO_CORRECTION = new Set([",", "."]);

/** What TeX reads first after a run when it is a command rather than a character. */
const COMMAND = "\\";

/**
 * A rich field's runs as TeX sets them, for the breaker: as the generator writes them, each run
 * wrapped in `\textbf`, `\textit` and `\href` for its marks (`richLatex`), and with the italic
 * corrections LaTeX sets at their edges.
 *
 * A run the generator writes as nothing, such as one of only invisible characters, wraps nothing;
 * and two runs neither of which is wrapped, such as a plain run next to a link whose address is not
 * linked (`linkAddress`), are one text to TeX, whose ligatures, kerns and spaces run on across
 * them, so they are one run here.
 *
 * LaTeX's `\textbf` and `\textit` end with `\/`, the italic correction of their last character,
 * unless the font after them is slanted or what follows is `,` or `.`; and `\textbf` starts with one
 * for the character before it, since it sets an upright font, unless its text starts with `,` or
 * `.` (`\check@icl`, `\check@icr` and `\maybe@ic` in the kernel's `ltfntcmd.dtx`). Inside `\href`
 * or `\textbf`, what follows is a command, so the correction is always set; at `\href`'s start and
 * end its specials stand between the run and the text beside it, so nothing reaches past them. A
 * run whose LaTeX is only spaces has no corrections, since LaTeX takes its text for `\space`.
 * `slanted` says whether a variant's font is slanted, as `\fontdimen1` does.
 *
 * The field's end marker stands in no correction's way: the field macro holds it back while LaTeX
 * reads what follows the field, and writes it after LaTeX's decision (decision 00XX). So the last
 * run's command decides on `after`, the LaTeX the template sets after the field, by its first
 * character: a command by default, as after a rich field in the built-in templates.
 */
export function breakRuns(
  runs: RichText,
  slanted: (variant: Variant) => boolean,
  after: string = COMMAND,
): BreakRun[] {
  const written: Written[] = [];
  for (const run of runs) {
    const latex = escapeText(run.text);
    const sets = latex !== "";
    const next: Written = {
      text: run.text,
      latex,
      bold: sets && run.bold === true,
      italic: sets && run.italic === true,
      linked: sets && run.href !== undefined && linkAddress(run.href) !== undefined,
    };
    const last = written.at(-1);
    if (last && !wrapped(last) && !wrapped(next)) {
      last.text += next.text;
      last.latex += next.latex;
    } else written.push(next);
  }
  const blank = (run: Written) => run.latex.trim() === "";
  // What TeX reads first after each run: the next run's command, or its first character, or what
  // follows the field, past runs the generator writes as nothing. Found in one walk from the end,
  // as the last run that sets anything before each is in one walk from the start, so that a field
  // of many runs costs time in proportion to them.
  const following: string[] = [];
  let next = after.slice(0, 1) || COMMAND;
  for (let k = written.length - 1; k >= 0; k--) {
    following[k] = next;
    const run = written[k] as Written;
    if (wrapped(run)) next = COMMAND;
    else if (run.latex !== "") next = run.latex[0] as string;
  }
  const before: (Written | undefined)[] = [];
  let setting: Written | undefined;
  for (const [k, run] of written.entries()) {
    before[k] = setting;
    if (!blank(run)) setting = run;
  }
  const corrects = (font: Variant, next: string) => !slanted(font) && !NO_CORRECTION.has(next);
  // The correction a run's own commands set at its end.
  const closing = (k: number): boolean => {
    const run = written[k] as Written;
    if (blank(run) || !(run.bold || run.italic)) return false;
    // In `\textbf{\textit{...}}`, `\textit` ends in the bold font, before `\textbf`'s own end.
    if (run.bold && run.italic && corrects("bold", COMMAND)) return true;
    // Inside `\href`, hyperref's own command follows.
    return corrects("regular", run.linked ? COMMAND : (following[k] as string));
  };
  // The correction a run's first command sets after the text before it, where that text is not
  // a link, whose closing special would stand between.
  const opening = (k: number): boolean => {
    const run = written[k] as Written;
    if (blank(run) || run.linked || !(run.bold || run.italic)) return false;
    const previous = before[k];
    if (previous === undefined || previous.linked) return false;
    // `\textbf` sets the upright bold font first, and then reads its text, or `\textit`.
    const first = run.bold && run.italic ? COMMAND : (run.latex[0] ?? COMMAND);
    return corrects(run.bold ? "bold" : "italic", first);
  };
  return written.map((run, k) => ({
    text: run.text,
    variant: variantOf(run),
    italicCorrection: closing(k) || (k + 1 < written.length && opening(k + 1)),
    link: run.linked,
  }));
}

/** Whether the generator wraps a run in a command. */
const wrapped = (run: Written) => run.bold || run.italic || run.linked;

/** Where a rich field's text starts in its document: right after the paragraph opens. */
export const TEXT_START = 1;

/**
 * Where TeX's lines fall in a rich field's document, for lines that tile its text (`lineRanges`):
 * each line's range, and a break at the start of each line after the first, which is after the
 * space TeX broke at, so that the space stays at the end of its line.
 */
export function linePositions<Line extends { from: number; to: number }>(
  lines: readonly Line[],
): { breaks: number[]; lines: Line[] } {
  return {
    breaks: lines.slice(1).map((line) => TEXT_START + line.from),
    lines: lines.map((line) => ({
      ...line,
      from: TEXT_START + line.from,
      to: TEXT_START + line.to,
    })),
  };
}
