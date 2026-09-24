/**
 * From the engine's DVI to a page the editor shows: fonts loaded, glyphs grouped into fields by
 * their markers and matched to each field's text, and the SVG drawn. This is the part of the
 * spike's page that survives; it runs the same in the browser and in Node.
 */

import { type DviDocument, type DviFont, type PageItem, parseDvi } from "../tex/dvi";
import { alignGlyphs, collectFields, type Field } from "../tex/fields";
import { glyphText } from "../tex/glyphs";
import { type PageSize, renderPage, US_LETTER } from "../tex/svg";
import { scaleTfm } from "../tex/tfm";
import type { FontLibrary, PageFont } from "./fonts";

export interface DrawnPage {
  svg: string;
  size: PageSize;
  /** The page's fields, each glyph given its offset in the field's text. */
  fields: Map<string, Field>;
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
 * Draw one page of a DVI. `texts` holds each field's text as the model has it; glyphs are
 * matched against it so a click can say which character it landed on.
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
  const widthsFor = (font: DviFont) => {
    const tfm = loaded.get(font.name)?.tfm;
    return tfm ? scaleTfm(tfm, font.scale).widths : undefined;
  };
  const doc: DviDocument = parseDvi(dvi, widthsFor);
  const page = doc.pages[pageIndex];
  if (!page) throw new Error(`the document has ${doc.pages.length} pages, not ${pageIndex + 1}`);

  const textOf = (item: PageItem) => {
    if (item.kind !== "glyph") return undefined;
    const font = doc.fonts.get(item.font);
    const name = font && loaded.get(font.name)?.outlines?.encoding[item.code];
    return name ? glyphText(name) : undefined;
  };
  const fields = collectFields(page, textOf);
  let unmatched = 0;
  for (const field of fields.values()) unmatched += alignGlyphs(field, texts.get(field.id) ?? "");

  const size = paperSize(page) ?? US_LETTER;
  const svg = renderPage(doc, page, {
    outlines: (name) => loaded.get(name)?.outlines,
    fields,
    size,
  });
  return { svg, size, fields, pageCount: doc.pages.length, unmatched, missingFonts };
}
