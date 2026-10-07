/**
 * How far the page's glyphs are from where the PDF shows them (decision 00XX): the DVI's glyphs, as
 * `parseDvi` places them, against the text operators of the PDF xdvipdfmx made of the same DVI
 * (`shownTexts`). Tests and the transform lane's corpus script read it; it gives offsets and
 * counts, never a glyph's text.
 */

import { type DviDocument, pointsPerUnit } from "../tex/dvi";
import { INCH } from "../tex/svg";
import { type TransformKind, turned } from "../tex/transforms";
import { mediaBoxes, shownTexts } from "../validate/pdf";

/** One text operator of the PDF and the page's glyphs it shows. */
export interface OperatorOffset {
  /** The kind of transformation its glyphs are set inside, or none. */
  kind: TransformKind | undefined;
  /** How many glyphs it shows. */
  glyphs: number;
  /** How far its first glyph's origin is from the page's, in TeX points. */
  start: number;
  /** How far the end of its last glyph's advance is from the page's, in TeX points, where known. */
  end?: number;
}

/** What `pdfOffsets` found. */
export interface PdfOffsets {
  operators: OperatorOffset[];
  /** The PDF's operators whose glyphs could not be found in the page's, in order. */
  unaligned: number;
}

/** How many of the page's glyphs a PDF's operator is looked for past where the last one ended. */
const WINDOW = 64;

/**
 * How many glyphs an operator must show to be looked for among all the page's glyphs not yet
 * matched, where it is not found past the last: a form's text comes where the PDF writes the form,
 * not where the page sets it, and a short run of codes could be found in the wrong place.
 */
const ANYWHERE = 4;

/**
 * Each text operator of `pdf` with the TeX font glyphs of `doc` it shows: the operators and the
 * glyphs taken in order, each operator's codes matched to the next glyphs' codes, those of a glyph
 * the PDF does not show passed over; one not found there, among all the glyphs not yet matched,
 * where it shows enough of them (`ANYWHERE`) and they are found once. `doc` must be parsed with its fonts' widths for
 * `end`.
 */
export function pdfOffsets(doc: DviDocument, pdf: Uint8Array): PdfOffsets {
  const pt = pointsPerUnit(doc);
  const bp = INCH / 72;
  const heights = mediaBoxes(pdf).map((box) => box.height);
  const glyphs = doc.pages.flatMap((page, index) =>
    page.items.flatMap((item) => (item.kind === "glyph" ? [{ item, page: index }] : [])),
  );
  const operators: OperatorOffset[] = [];
  let unaligned = 0;
  let next = 0;
  const taken: boolean[] = [];
  for (const shown of shownTexts(pdf)) {
    const codes = [...shown.text].map((char) => char.charCodeAt(0));
    if (codes.length === 0) continue;
    const matches = (at: number) =>
      codes.every((code, i) => glyphs[at + i]?.item.code === code && !taken[at + i]);
    let found = -1;
    for (let at = next; at < Math.min(glyphs.length, next + WINDOW) && found < 0; at++)
      if (matches(at)) found = at;
    const inOrder = found >= 0;
    if (!inOrder && codes.length >= ANYWHERE) {
      // Only where the codes are found once: a run found twice could be either.
      const places: number[] = [];
      for (let at = 0; at < glyphs.length && places.length < 2; at++)
        if (matches(at)) places.push(at);
      if (places.length === 1) found = places[0] ?? -1;
    }
    if (found < 0) {
      unaligned++;
      continue;
    }
    for (let i = 0; i < codes.length; i++) taken[found + i] = true;
    if (inOrder) next = found + codes.length;
    const first = glyphs[found];
    const last = glyphs[found + codes.length - 1];
    if (first === undefined || last === undefined) continue;
    const height = heights[first.page] ?? heights[0] ?? 0;
    const x = INCH + first.item.h * pt;
    const y = INCH + first.item.v * pt;
    const start = Math.hypot(x - shown.x * bp, y - (height - shown.y) * bp);
    let end: number | undefined;
    if (shown.end !== undefined) {
      const matrix = last.item.transform?.matrix;
      const advance = matrix ? turned(matrix, last.item.width, 0) : { x: last.item.width, y: 0 };
      const ex = INCH + (last.item.h + advance.x) * pt;
      const ey = INCH + (last.item.v + advance.y) * pt;
      end = Math.hypot(ex - shown.end.x * bp, ey - (height - shown.end.y) * bp);
    }
    operators.push({
      kind: first.item.transform?.kind,
      glyphs: codes.length,
      start,
      ...(end === undefined ? {} : { end }),
    });
  }
  return { operators, unaligned };
}

/** The most an operator of a kind is off, at its start or its end, and how many glyphs it shows. */
export function worstOf(
  found: PdfOffsets,
  kind: TransformKind | undefined,
): { operators: number; glyphs: number; max: number } {
  const of = found.operators.filter((each) => each.kind === kind);
  return {
    operators: of.length,
    glyphs: of.reduce((sum, each) => sum + each.glyphs, 0),
    max: Math.max(
      0,
      ...of.flatMap((each) => [each.start, ...(each.end === undefined ? [] : [each.end])]),
    ),
  };
}
