/**
 * From the engine's DVI to a page the editor shows: fonts loaded, glyphs grouped into fields by
 * their markers and matched to each field's text, and the SVG drawn. This is the part of the
 * spike's page that survives; it runs the same in the browser and in Node.
 */

import {
  type DviDocument,
  type DviPage,
  type PageItem,
  parseDvi,
  pointsPerUnit,
  type WidthProvider,
} from "../tex/dvi";
import { alignGlyphs, collectFields, type Field, type GlyphTextOf } from "../tex/fields";
import { accentMark, glyphOf } from "../tex/glyphs";
import { INCH, type PageSize, renderPage, US_LETTER } from "../tex/svg";
import { scaleTfm } from "../tex/tfm";
import type { FontLibrary, PageFont } from "./fonts";

/**
 * Where a drawn glyph sits, in TeX points from the page's top-left corner. The box is the glyph's
 * outline box, which is also what a click lands on in the SVG; a glyph with no outline has an
 * empty box at its origin.
 */
export interface GlyphBox {
  /** The glyph's origin on its baseline, where the SVG places it. */
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** The field the glyph belongs to and its character offset there, if it is in one. */
  field?: string;
  offset?: number;
}

export interface DrawnPage {
  svg: string;
  size: PageSize;
  /** The page's fields, each glyph given its offset in the field's text. */
  fields: Map<string, Field>;
  /** Every Type 1 glyph drawn, in the order the SVG paints them, one for each of its glyphs. */
  glyphs: GlyphBox[];
  /** Pages in the whole document, for the warning when a resume spills onto a second one. */
  pageCount: number;
  /** Glyphs in fields that could not be matched to a character of the field's text. */
  unmatched: number;
  /** TeX fonts the page uses that it could not draw, with the reason. */
  missingFonts: Map<string, string>;
}

const UNITS: Record<string, number> = {
  pt: 1,
  bp: 72.27 / 72,
  in: 72.27,
  mm: 72.27 / 25.4,
  cm: 72.27 / 2.54,
};

/** The page size a `papersize=` special gives, in TeX points, as geometry and hyperref write it. */
export function paperSize(page: { items: PageItem[] }): PageSize | undefined {
  for (const item of page.items) {
    if (item.kind !== "special" || !item.text.startsWith("papersize=")) continue;
    const dims = item.text
      .slice("papersize=".length)
      .split(",")
      .map((dim) => /^\s*([\d.]+)\s*([a-z]{2})\s*$/.exec(dim));
    const [w, h] = dims.map((m) =>
      m ? Number(m[1]) * (UNITS[m[2] as string] ?? Number.NaN) : Number.NaN,
    );
    if (w && h && Number.isFinite(w) && Number.isFinite(h)) return { width: w, height: h };
  }
  return undefined;
}

/**
 * The size in force on a page. geometry and hyperref write the size on the first page only, so
 * a later page takes it from the closest page before it that has one.
 */
function sizeOf(doc: DviDocument, pageIndex: number): PageSize {
  for (let i = pageIndex; i >= 0; i--) {
    const page = doc.pages[i];
    const size = page && paperSize(page);
    if (size) return size;
  }
  return US_LETTER;
}

/** The glyph a click at (x, y), in TeX points, lands on: the last one painted that covers it. */
export function glyphAt(glyphs: GlyphBox[], x: number, y: number): GlyphBox | undefined {
  for (let i = glyphs.length - 1; i >= 0; i--) {
    const g = glyphs[i] as GlyphBox;
    if (x >= g.left && x <= g.right && y >= g.top && y <= g.bottom) return g;
  }
  return undefined;
}

/**
 * The ids of the fields a page shows: those with a glyph on it, which a click can land on. A field
 * whose text sets no glyph, such as a name in a script the fonts lack, still has its markers on
 * the page with nothing between them, so it is in `fields` but not here; a field on a later page,
 * which the editor does not draw, is in neither. The side panel gives an input to a filled field
 * the page leaves out, since the page offers no way to edit it.
 */
export function fieldsShown(page: Pick<DrawnPage, "fields">): Set<string> {
  const shown = new Set<string>();
  for (const field of page.fields.values()) if (field.glyphs.length > 0) shown.add(field.id);
  return shown;
}

/**
 * The text each glyph of a document stands for, which `collectFields` gives a field's glyphs:
 * what its font says the code's glyph stands for (`PageFont.text`), and, for a spacing accent,
 * the combining mark `collectFields` composes with the letter under it. `loaded` holds the fonts
 * that loaded, by name; a glyph from any other font, or from one without outlines, has no text,
 * and so matches no character of a field's text. The validation harness names glyphs with this.
 */
export function glyphTextOf(doc: DviDocument, loaded: ReadonlyMap<string, PageFont>): GlyphTextOf {
  const fontOf = (item: PageItem) => {
    const font = item.kind === "glyph" ? doc.fonts.get(item.font) : undefined;
    return font && loaded.get(font.name);
  };
  const textOf = (item: PageItem) =>
    item.kind === "glyph" ? fontOf(item)?.text(item.code) : undefined;
  const accent = (item: PageItem) => {
    const name = item.kind === "glyph" ? fontOf(item)?.outlines?.encoding[item.code] : undefined;
    return name === undefined ? undefined : accentMark(name);
  };
  return Object.assign(textOf, { accent });
}

/** The box of every Type 1 glyph on a page, with its field, for each glyph the SVG draws. */
function glyphBoxes(
  doc: DviDocument,
  page: DviPage,
  fonts: Map<string, PageFont>,
  fields: Map<string, Field>,
): GlyphBox[] {
  const pt = pointsPerUnit(doc);
  const fieldOf = new Map<number, { field: string; offset: number }>();
  for (const field of fields.values())
    for (const g of field.glyphs)
      for (const item of [g.item, ...(g.items ?? [])])
        fieldOf.set(item, { field: field.id, offset: g.offset });
  const boxes: GlyphBox[] = [];
  page.items.forEach((item, index) => {
    if (item.kind !== "glyph") return;
    const font = doc.fonts.get(item.font);
    const outlines = font && fonts.get(font.name)?.outlines;
    const glyph = outlines && glyphOf(outlines, item.code);
    // The same test the SVG makes before it draws a glyph.
    if (!font || !glyph) return;
    const s = (font.scale * pt) / 1000;
    const x = INCH + item.h * pt;
    const y = INCH + item.v * pt;
    const [xMin, yMin, xMax, yMax] = glyph.b ?? [0, 0, 0, 0];
    boxes.push({
      x,
      y,
      left: x + xMin * s,
      top: y - yMax * s,
      right: x + xMax * s,
      bottom: y - yMin * s,
      ...fieldOf.get(index),
    });
  });
  return boxes;
}

/**
 * Each font's widths at the size a DVI uses it, from the fonts that loaded, which `parseDvi` moves
 * right by after each glyph. Where a glyph starts decides where it is drawn and whether an accent
 * before it stands over it (`collectFields`), so the page and the validation harness both parse
 * a DVI with these. A font that did not load moves by nothing.
 */
export function widthsOf(loaded: ReadonlyMap<string, PageFont>): WidthProvider {
  return (font) => {
    const tfm = loaded.get(font.name)?.tfm;
    return tfm ? scaleTfm(tfm, font.scale).widths : undefined;
  };
}

/**
 * Draw one page of a DVI. `texts` holds each field's text as the model has it; glyphs are
 * matched against it so a click can say which character it landed on. A font the page cannot
 * draw, or whose outlines cannot be read this time, is left out and named in `missingFonts`,
 * while its metrics still place every glyph after its own; the next draw reads it again. It
 * rejects when a font's metrics, the font map or the glyph list cannot be read, since a page
 * drawn without them would put glyphs in the wrong places or name them wrongly with no error, and
 * the caller keeps the page it had.
 */
export async function drawPage(
  dvi: Uint8Array,
  fonts: FontLibrary,
  texts: ReadonlyMap<string, string>,
  pageIndex = 0,
): Promise<DrawnPage> {
  // Fonts are defined at the end of a DVI too; a first pass without widths finds their names.
  const names = [...new Set([...parseDvi(dvi, () => undefined).fonts.values()].map((f) => f.name))];
  const loaded = new Map<string, PageFont>();
  const missingFonts = new Map<string, string>();
  await Promise.all(
    names.map(async (name) => {
      const font = await fonts.load(name);
      if (!font) missingFonts.set(name, "TeX Live has no TFM for it");
      else {
        loaded.set(name, font);
        if (font.missing) missingFonts.set(name, font.missing);
      }
    }),
  );
  const doc: DviDocument = parseDvi(dvi, widthsOf(loaded));
  const page = doc.pages[pageIndex];
  if (!page) throw new Error(`the document has ${doc.pages.length} pages, not ${pageIndex + 1}`);

  const fields = collectFields(page, glyphTextOf(doc, loaded));
  let unmatched = 0;
  for (const field of fields.values()) unmatched += alignGlyphs(field, texts.get(field.id) ?? "");

  const size = sizeOf(doc, pageIndex);
  const svg = renderPage(doc, page, {
    outlines: (name) => loaded.get(name)?.outlines,
    fields,
    size,
  });
  return {
    svg,
    size,
    fields,
    glyphs: glyphBoxes(doc, page, loaded, fields),
    pageCount: doc.pages.length,
    unmatched,
    missingFonts,
  };
}
