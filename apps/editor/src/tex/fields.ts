/**
 * Fields on a typeset page.
 *
 * The generated LaTeX wraps every render of an editable field in two markers, written
 * with `\special` as `rt:b:<id>` and `rt:e:<id>`. They pass through the engine untouched
 * and come out in the DVI at the positions where the field starts and ends. The first
 * copy of a field on the page is the field: every glyph that sits between its markers in
 * stream order belongs to it, and aligning those glyphs with the field's source text
 * gives each glyph its character offset.
 */

import type { DviPage, PageItem } from "./dvi";

export interface FieldGlyph {
  /** Index of the glyph in the page's item list. */
  item: number;
  /**
   * The other page items that draw this character: the accent TeX's `\accent` set over the
   * letter `item` draws, which reads with it as one accented letter (`collectFields`).
   */
  items?: number[];
  /** The text this glyph stands for, e.g. "fi" for a ligature; undefined when unknown. */
  text: string | undefined;
  /** Offset of the glyph's first character in the field's source text, once aligned. */
  offset: number;
  /** True for a hyphen TeX added at a line break, which has no source character. */
  inserted?: boolean;
}

export interface Field {
  id: string;
  glyphs: FieldGlyph[];
}

export const MARKER_BEGIN = "rt:b:";
export const MARKER_END = "rt:e:";

/**
 * What means nothing on a page, or what TeX would refuse: controls, format characters such as
 * zero-width joiners and U+FEFF, lone surrogates, which UTF-8 cannot encode, and the line and
 * paragraph separators. The generator leaves them out of the LaTeX and the aligner skips them in
 * a field's text, so the two agree on what sets no glyph.
 */
export const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;

/** Text a page item stands for, or undefined for items that are not glyphs. */
export interface GlyphTextOf {
  (item: PageItem): string | undefined;
  /**
   * The combining mark a glyph stands for when it is a spacing accent (its glyph name is in
   * `ACCENTS`), and undefined for any other item. Without it, no accent is paired with its letter.
   */
  accent?: (item: PageItem) => string | undefined;
}

/** A text of one letter, which an accent before it may go over. */
const LETTER = /^\p{L}$/u;

/**
 * Collect the glyphs of every marked field on a page, in stream order.
 *
 * The generator marks every render of a field, and the first copy in the page's stream order is
 * the field, the one the user edits. A render that never reaches the page, such as one in a PDF
 * string or one `\settowidth` only measures, leaves no markers, so a field whose first render is
 * one of those is found at the copy the page shows. A later begin marker for a field already
 * found opens a copy whose glyphs go to no field, so a link a header sets through both
 * `{{contacts}}` and `{{links}}` is found once, with the first copy's glyphs; the copy is opened
 * all the same, so that its end marker closes it and the nesting stays right.
 *
 * Markers are read case-insensitively and their ids lowercased. A template may set a field in
 * `\MakeUppercase`, which uppercases the markers' text along with the field's, and ids are
 * lowercase (decision 0006), so the id survives. Item 9 must read the paragraph special's id the
 * same way; its values are never uppercased, because `\rt@par` is protected and writes them when
 * it runs, after the case change.
 *
 * TeX's `\accent`, which OT1 sets every accented letter with and T1 the letters it has no glyph
 * for, puts the accent in the DVI first and the letter after it, as two glyphs. It centres the
 * accent over the letter (tex.web's `make_accent`): the accent moves right by half the letter's
 * width less its own, plus a little in a slanted font, and the letter goes back to where the
 * accent began. So a letter narrower than the accent starts after it, and a wider one before it,
 * by less than twice the accent's width for every accent and letter of every T1 and OT1 font the
 * page can draw (a dot over a W is the most, 1.83 widths in Avant Garde's oblique). A spacing
 * accent (`textOf.accent`) directly followed in the same field by a glyph whose text is a letter
 * and that starts within that span, from twice the accent's width before it to the end of its
 * advance, becomes one glyph whose text is the two composed (NFC), `é` for `\'e`: the letter's
 * item, with the accent's in `items`, so that a click on either lands on the character. The
 * position matters: OT1 sets `\textasciitilde` and `\textasciicircum` as the same accent glyphs
 * standing alone, and a letter after one of them starts where it ends, so `~mara` still reads as
 * typed; and the first letter of the next line, back at the left margin, starts far before an
 * accent that ended a line, unless the line held almost nothing else. An accent with no letter
 * over which it stands stays a glyph of its own. The accent may sit higher or lower than the
 * letter, in the box TeX shifts for a letter taller or shorter than the x-height, so the test does
 * not look at v. It needs the fonts' widths, so the page and the validation harness both parse
 * the DVI with them.
 */
export function collectFields(page: DviPage, textOf: GlyphTextOf): Map<string, Field> {
  const fields = new Map<string, Field>();
  // The copies open where the walk stands, the innermost last. A later copy of a field already
  // found has no field, so what it sets goes nowhere.
  const open: { id: string; field: Field | undefined }[] = [];
  // The combining mark of the accent each field's last glyph is, while it waits for a letter.
  const accents = new Map<Field, string>();
  page.items.forEach((item, index) => {
    if (item.kind === "special") {
      const begun = markerId(item.text, MARKER_BEGIN);
      const ended = begun === undefined ? markerId(item.text, MARKER_END) : undefined;
      if (begun !== undefined) {
        const field: Field | undefined = fields.has(begun) ? undefined : { id: begun, glyphs: [] };
        if (field) fields.set(begun, field);
        open.push({ id: begun, field });
      } else if (ended !== undefined) {
        for (let at = open.length - 1; at >= 0; at--) {
          if (open[at]?.id === ended) {
            open.splice(at, 1);
            break;
          }
        }
      }
      return;
    }
    if (item.kind !== "glyph" && item.kind !== "native") return;
    const field = open.at(-1)?.field;
    if (!field) return;
    const text = textOf(item);
    const mark = accents.get(field);
    accents.delete(field);
    const accent = field.glyphs.at(-1);
    const over = accent && page.items[accent.item];
    const under =
      over?.kind === "glyph" &&
      item.kind === "glyph" &&
      item.h >= over.h - 2 * over.width &&
      item.h < over.h + over.width;
    if (mark !== undefined && accent && under && text !== undefined && LETTER.test(text)) {
      const letter = { item: index, text: `${text}${mark}`.normalize("NFC"), offset: -1 };
      field.glyphs[field.glyphs.length - 1] = { ...letter, items: [accent.item] };
      return;
    }
    field.glyphs.push({ item: index, text, offset: -1 });
    const own = textOf.accent?.(item);
    if (own !== undefined) accents.set(field, own);
  });
  return fields;
}

/**
 * The id a begin or end marker names, lowercased; undefined for any other special. `marker` is
 * `MARKER_BEGIN` or `MARKER_END`, and the marker is read whatever its case.
 */
export function markerId(text: string, marker: string): string | undefined {
  if (text.slice(0, marker.length).toLowerCase() !== marker) return undefined;
  return text.slice(marker.length).toLowerCase();
}

/** What aligning a field's glyphs with its text found. */
export interface Alignment {
  /** Glyphs that could not be matched to a character of the text. */
  unmatched: number;
  /**
   * Where the walk stands when the glyphs run out: the index in the text just past the last
   * glyph it matched. What the text holds from here on is what the page does not show, so the
   * validation harness checks that none of it would set a glyph, which finds a field a template
   * cuts short, as truncate.sty does, where every glyph the page shows still matches.
   */
  covered: number;
}

/**
 * Give each glyph its character offset in the field's source text.
 *
 * TeX drops spaces (they become moves, not glyphs), turns some character pairs into
 * one ligature glyph, and may add a hyphen at a line break; and a field's text holds
 * characters that set no glyph at all, which the generator or TeX left out. The
 * alignment walks the text and the glyphs together. Before each glyph it skips
 * whitespace and the invisible characters. A glyph that does not match there is tried
 * past each character that may set no glyph where it stands, such as an emoji or a
 * letter of a script the fonts lack; an unmatched hyphen is a break TeX inserted; and
 * a glyph a few code units on resynchronises the walk. Returns the number of glyphs
 * that could not be matched, and how much of the text the glyphs account for.
 *
 * A run of such characters is read once, however many glyphs fail to match in it: a
 * glyph whose spellings all begin with printable ASCII, which no character of the run
 * is, can match only at the run's end, so only a glyph with a spelling outside ASCII,
 * such as an en dash, walks the run a character at a time.
 */
export function alignField(field: Field, text: string): Alignment {
  let pos = 0;
  let unmatched = 0;
  // The end of the run of characters that may set no glyph from `pos` on: the first index at or
  // after it whose character is printable ASCII, or the text's end. Every character before it
  // sets no glyph, so it holds until `pos` passes it and is recomputed only then.
  let runEnd = -1;
  for (const glyph of field.glyphs) {
    while (pos < text.length && SKIPPED.test(charAt(text, pos))) pos += charAt(text, pos).length;
    const g = glyph.text;
    if (g === undefined) {
      glyph.offset = pos;
      unmatched++;
      continue;
    }
    const candidates = spellingsOf(g);
    const matchAt = (at: number) => candidates.find((c) => text.startsWith(c, at));
    // The spellings are tried where the walk stands first, so "–" still matches the "--"
    // glyph, and only then past the characters that may set no glyph.
    let at = pos;
    let match = matchAt(at);
    if (match === undefined) {
      if (runEnd < pos) runEnd = endOfRun(text, pos);
      if (candidates.every(beginsWithGlyph)) {
        // No character of the run is a spelling's first, so only its end can match.
        at = runEnd;
        match = matchAt(at);
      } else {
        // A spelling outside ASCII, such as "–" or "’", may match anywhere in the run, which
        // is walked a code point at a time.
        while (match === undefined && at < runEnd) {
          at += charAt(text, at).length;
          match = matchAt(at);
        }
      }
    }
    if (match !== undefined) {
      glyph.offset = at;
      pos = at + match.length;
    } else if (g === "-") {
      // A hyphen TeX inserted at a line break: it belongs to the character before it.
      glyph.offset = Math.max(0, pos - 1);
      glyph.inserted = true;
    } else {
      // Try to resynchronise a little further on; otherwise count it as unmatched.
      const ahead = [1, 2, 3].find((k) => text.startsWith(g, pos + k));
      if (ahead !== undefined) {
        glyph.offset = pos + ahead;
        pos += ahead + g.length;
      } else {
        glyph.offset = pos;
        unmatched++;
      }
    }
  }
  return { unmatched, covered: pos };
}

/** Give each glyph its character offset, as `alignField` does, and count those it cannot place. */
export function alignGlyphs(field: Field, text: string): number {
  return alignField(field, text).unmatched;
}

/** What the walk skips before every glyph: whitespace, which TeX sets as glue, and INVISIBLE. */
const SKIPPED = new RegExp(`\\s|${INVISIBLE.source}`, "u");

/** The code point at `at`, as a string of one or two code units. */
const charAt = (text: string, at: number) => String.fromCodePoint(text.codePointAt(at) ?? 0);

/**
 * Whether a character may set no glyph where it stands: what the walk skips, and anything
 * outside ASCII, which pdfTeX drops when LaTeX has no definition for it or the encoding no glyph.
 */
const setsNoGlyph = (char: string) => (char.codePointAt(0) ?? 0) > 0x7f || SKIPPED.test(char);

/** Whether a spelling begins with a character that sets a glyph: printable ASCII. */
const beginsWithGlyph = (spelling: string) => !setsNoGlyph(charAt(spelling, 0));

/** The first index at or after `from` whose character sets a glyph, or the text's end. */
function endOfRun(text: string, from: number): number {
  let at = from;
  while (at < text.length && setsNoGlyph(charAt(text, at))) at += charAt(text, at).length;
  return at;
}

/**
 * The spellings a glyph's text may have in a field's text: a ligature's alternatives, or the text
 * itself and, for a composed letter such as the `é` an accent and its letter make, the letter
 * decomposed, as a model holds a letter typed with a combining mark.
 */
function spellingsOf(text: string): readonly string[] {
  const alternatives = LIGATURE_ALTERNATIVES.get(text);
  if (alternatives) return alternatives;
  const decomposed = text.normalize("NFD");
  return decomposed === text ? [text] : [text, decomposed];
}

/**
 * Source spellings that produce a given glyph, the plain form first. A map, since it is looked up
 * by a glyph's text, which may be any word a glyph name spells, `constructor` among them.
 */
const LIGATURE_ALTERNATIVES: ReadonlyMap<string, readonly string[]> = new Map([
  ["--", ["--", "–"]],
  ["---", ["---", "—"]],
  ["``", ["``", "“", '"']],
  ["''", ["''", "”", '"']],
  ["'", ["'", "’"]],
  ["`", ["`", "‘"]],
  // T1 sets Đ (`\DJ`) with the glyph it sets Ð (`\DH`) with, at 208, which its fonts name Eth.
  ["\u{d0}", ["\u{d0}", "\u{110}"]],
]);
