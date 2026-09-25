/**
 * Fields on a typeset page.
 *
 * The generated LaTeX wraps each editable field in two markers, written with `\special`
 * as `rt:b:<id>` and `rt:e:<id>`. They pass through the engine untouched and come out
 * in the DVI at the positions where the field starts and ends. Every glyph that sits
 * between them in stream order belongs to the field, and aligning those glyphs with
 * the field's source text gives each glyph its character offset.
 */

import type { DviPage, PageItem } from "./dvi";

export interface FieldGlyph {
  /** Index of the glyph in the page's item list. */
  item: number;
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
export type GlyphTextOf = (item: PageItem) => string | undefined;

/**
 * Collect the glyphs of every marked field on a page, in stream order.
 *
 * Markers are read case-insensitively and their ids lowercased. A template may set a field in
 * `\MakeUppercase`, which uppercases the markers' text along with the field's, and ids are
 * lowercase (decision 0006), so the id survives. Item 9 must read the paragraph special's id the
 * same way; its values are never uppercased, because `\rt@par` is protected and writes them when
 * it runs, after the case change.
 */
export function collectFields(page: DviPage, textOf: GlyphTextOf): Map<string, Field> {
  const fields = new Map<string, Field>();
  const open: Field[] = [];
  page.items.forEach((item, index) => {
    if (item.kind === "special") {
      const begun = markerId(item.text, MARKER_BEGIN);
      const ended = begun === undefined ? markerId(item.text, MARKER_END) : undefined;
      if (begun !== undefined) {
        const field = fields.get(begun) ?? { id: begun, glyphs: [] };
        fields.set(begun, field);
        open.push(field);
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
    const field = open[open.length - 1];
    if (field) field.glyphs.push({ item: index, text: textOf(item), offset: -1 });
  });
  return fields;
}

/** The id a begin or end marker names, lowercased; undefined for any other special. */
function markerId(text: string, marker: string): string | undefined {
  if (text.slice(0, marker.length).toLowerCase() !== marker) return undefined;
  return text.slice(marker.length).toLowerCase();
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
 * that could not be matched.
 */
export function alignGlyphs(field: Field, text: string): number {
  let pos = 0;
  let unmatched = 0;
  for (const glyph of field.glyphs) {
    while (pos < text.length && SKIPPED.test(charAt(text, pos))) pos += charAt(text, pos).length;
    const g = glyph.text;
    if (g === undefined) {
      glyph.offset = pos;
      unmatched++;
      continue;
    }
    const candidates = LIGATURE_ALTERNATIVES[g] ?? [g];
    const matchAt = (at: number) => candidates.find((c) => text.startsWith(c, at));
    // The spellings are tried where the walk stands first, so "–" still matches the "--"
    // glyph, and only then past the characters that may set no glyph, a code point at a time.
    let at = pos;
    let match = matchAt(at);
    while (match === undefined && at < text.length && setsNoGlyph(charAt(text, at))) {
      at += charAt(text, at).length;
      match = matchAt(at);
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
  return unmatched;
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

/** Source spellings that produce a given glyph; the plain form first. */
const LIGATURE_ALTERNATIVES: Record<string, string[]> = {
  "--": ["--", "–"],
  "---": ["---", "—"],
  "``": ["``", "“", '"'],
  "''": ["''", "”", '"'],
  "'": ["'", "’"],
  "`": ["`", "‘"],
};
