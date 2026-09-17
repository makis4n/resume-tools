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

/** Text a page item stands for, or undefined for items that are not glyphs. */
export type GlyphTextOf = (item: PageItem) => string | undefined;

/** Collect the glyphs of every marked field on a page, in stream order. */
export function collectFields(page: DviPage, textOf: GlyphTextOf): Map<string, Field> {
  const fields = new Map<string, Field>();
  const open: Field[] = [];
  page.items.forEach((item, index) => {
    if (item.kind === "special") {
      if (item.text.startsWith(MARKER_BEGIN)) {
        const id = item.text.slice(MARKER_BEGIN.length);
        const field = fields.get(id) ?? { id, glyphs: [] };
        fields.set(id, field);
        open.push(field);
      } else if (item.text.startsWith(MARKER_END)) {
        const id = item.text.slice(MARKER_END.length);
        for (let at = open.length - 1; at >= 0; at--) {
          if (open[at]?.id === id) {
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

/**
 * Give each glyph its character offset in the field's source text.
 *
 * TeX drops spaces (they become moves, not glyphs), turns some character pairs into
 * one ligature glyph, and may add a hyphen at a line break. The alignment walks the
 * text and the glyphs together, skipping whitespace in the text and accepting an
 * unmatched hyphen as a break inserted by TeX. Returns the number of glyphs that
 * could not be matched.
 */
export function alignGlyphs(field: Field, text: string): number {
  let pos = 0;
  let unmatched = 0;
  const skipSpaces = () => {
    while (pos < text.length && /\s/.test(text[pos] as string)) pos++;
  };
  for (const glyph of field.glyphs) {
    skipSpaces();
    const g = glyph.text;
    if (g === undefined) {
      glyph.offset = pos;
      unmatched++;
      continue;
    }
    const candidates = LIGATURE_ALTERNATIVES[g] ?? [g];
    const match = candidates.find((c) => text.startsWith(c, pos));
    if (match !== undefined) {
      glyph.offset = pos;
      pos += match.length;
    } else if (g === "-") {
      // A hyphen TeX inserted at a line break: it belongs to the character before it.
      glyph.offset = Math.max(0, pos - 1);
      glyph.inserted = true;
    } else {
      // Try to resynchronise a little further on; otherwise count it as unmatched.
      const ahead = text.indexOf(g, pos);
      if (ahead >= 0 && ahead - pos <= 3) {
        glyph.offset = ahead;
        pos = ahead + g.length;
      } else {
        glyph.offset = pos;
        unmatched++;
      }
    }
  }
  return unmatched;
}

/** Source spellings that produce a given glyph; the plain form first. */
const LIGATURE_ALTERNATIVES: Record<string, string[]> = {
  "--": ["--", "–"],
  "---": ["---", "—"],
  "``": ["``", "“", '"'],
  "''": ["''", "”", '"'],
  "'": ["'", "’"],
  "`": ["`", "‘"],
};
