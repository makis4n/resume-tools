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
import {
  alignGlyphs,
  collectFields,
  type Field,
  type GlyphTextOf,
  MARKER_BEGIN,
  markerId,
} from "../tex/fields";
import { accentMark, glyphOf } from "../tex/glyphs";
import { INCH, type PageSize, paperSizeOf, renderPage, US_LETTER } from "../tex/svg";
import { scaleTfm } from "../tex/tfm";
import type { FontLibrary, PageFont } from "./fonts";
import { paragraphId } from "./paragraph";

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

/** A font a field's glyphs are set in, and how much of the field it sets. */
export interface FieldFont {
  /** The TeX font, as the page loaded it. */
  font: PageFont;
  /** The size the page uses it at, in TeX points. */
  size: number;
  /** How many of the field's glyphs it sets. */
  glyphs: number;
  /** How many of those stand for letters or digits. */
  letters: number;
}

/**
 * What the editing overlay needs to set a field where TeX set it (item 9): the paragraph TeX set
 * it in, the fonts of its glyphs, where its first glyph is, and what the page shows around it
 * that says where its lines start.
 */
export interface FieldLayout {
  /**
   * The field's paragraph special, `rt:p:<id>:` and its values (decision 0007): the first after
   * the field's begin marker and before its first glyph. Undefined when the page has none there.
   */
  paragraph: string | undefined;
  /**
   * The fonts the field's glyphs are set in, the one that sets the most of its letters and digits
   * first, then the one with more glyphs, then the one that comes first. LaTeX sets a field's
   * text in one font and takes a few characters from another, such as `€`, `×` or `•` from
   * TS1 in a T1 paragraph, so the first glyph's font may be one that has no letters at all.
   */
  fonts: FieldFont[];
  /**
   * The first of `fonts`, the field's letter font, and its size in TeX points: the overlay
   * measures the field in it and sets its rows in its web font.
   */
  font: PageFont;
  size: number;
  /** The first glyph's origin on its baseline, in TeX points from the page's top-left corner. */
  x: number;
  y: number;
  /**
   * Where the field's second line starts on the page: the x of its first glyph there, in TeX
   * points; undefined when the page shows the field on one line. A paragraph's lines after its
   * first start at its left edge and their indent, so this says where its first line starts too.
   */
  secondLine: number | undefined;
  /**
   * The x of each glyph and drawn rule on the first glyph's baseline, in TeX points, ascending,
   * whichever field or column it belongs to: what a field shown on one line guesses its line's
   * start from. A glyph or rule is on the baseline of the first the page sets within half a point
   * of it, the nearest when there are two, and the fields on one baseline share it.
   */
  baseline: readonly number[];
}

/**
 * A field on the page: its glyphs, and how the overlay sets it, when its first glyph is a glyph
 * and a font of its glyphs loaded. The layout is optional so that a page's fields as
 * `collectFields` gives them, which is all `fieldsShown` reads, still pass for a page's.
 */
export interface PageField extends Field {
  layout?: FieldLayout;
}

export interface DrawnPage {
  svg: string;
  size: PageSize;
  /** The page's fields, each glyph given its offset in the field's text. */
  fields: Map<string, PageField>;
  /** Every Type 1 glyph drawn, in the order the SVG paints them, one for each of its glyphs. */
  glyphs: GlyphBox[];
  /** Pages in the whole document, for the warning when a resume spills onto a second one. */
  pageCount: number;
  /** Glyphs in fields that could not be matched to a character of the field's text. */
  unmatched: number;
  /** TeX fonts the page uses that it could not draw, with the reason. */
  missingFonts: Map<string, string>;
}

/**
 * The page size a page's specials give, in TeX points: `papersize=` as geometry and hyperref
 * write it for pdfTeX, or `pdf:pagesize` as XeTeX and the xetex/dvipdfmx driver write it instead.
 * `paperSizeOf` reads both, so the page, the PDF and the harness's PDF check agree on the size.
 */
export function paperSize(page: { items: PageItem[] }): PageSize | undefined {
  return paperSizeOf(page.items);
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

/** A rule a page draws, in TeX points from the page's top-left corner, as a glyph's box is. */
export interface RuleBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A glyph a rule is drawn across, and the rule. */
export interface RuleCrossing {
  rule: RuleBox;
  glyph: GlyphBox;
}

/**
 * Every glyph a rule is drawn across on a page. A rule is one the SVG draws, with a width and a
 * height, and it crosses a glyph where it overlaps the glyph's box by more than an edge, so that
 * none crosses a glyph with no outline, whose box is empty. `glyphs` are the boxes `drawPage`
 * gives the page at `pageIndex`. A rule across a glyph strikes through text the user reads and
 * clicks, as a section title's rule does when the space after the title is less than the
 * template's macros take back and the line under the title is set over the rule; so Jake's round
 * trip checks each density with this, and the validation harness can check any package's page
 * with it.
 */
export function ruleCrossings(
  doc: DviDocument,
  glyphs: readonly GlyphBox[],
  pageIndex = 0,
): RuleCrossing[] {
  const page = doc.pages[pageIndex];
  if (!page) throw new Error(`the document has ${doc.pages.length} pages, not ${pageIndex + 1}`);
  const pt = pointsPerUnit(doc);
  const crossings: RuleCrossing[] = [];
  for (const item of page.items) {
    // The same test the SVG makes before it draws a rule.
    if (item.kind !== "rule" || item.width <= 0 || item.height <= 0) continue;
    const rule: RuleBox = {
      left: INCH + item.h * pt,
      top: INCH + (item.v - item.height) * pt,
      right: INCH + (item.h + item.width) * pt,
      bottom: INCH + item.v * pt,
    };
    for (const glyph of glyphs) {
      const across = Math.min(rule.right, glyph.right) > Math.max(rule.left, glyph.left);
      const through = Math.min(rule.bottom, glyph.bottom) > Math.max(rule.top, glyph.top);
      if (across && through) crossings.push({ rule, glyph });
    }
  }
  return crossings;
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

/** How far from a baseline a glyph or rule may sit and still be on it, in TeX points. */
const ON_BASELINE = 0.5;

/** A glyph's text that stands for letters or digits, a ligature's included. */
const LETTERS = /^[\p{L}\p{N}]+$/u;

/**
 * The fonts a field's glyphs are set in, with how many glyphs and letters each sets, in the order
 * `FieldLayout.fonts` gives them. A font that did not load is left out.
 */
function fontsOf(
  doc: DviDocument,
  page: DviPage,
  loaded: ReadonlyMap<string, PageFont>,
  field: Field,
): FieldFont[] {
  const counts = new Map<number, { glyphs: number; letters: number; order: number }>();
  for (const glyph of field.glyphs) {
    const item = page.items[glyph.item];
    if (item?.kind !== "glyph") continue;
    const count = counts.get(item.font) ?? { glyphs: 0, letters: 0, order: counts.size };
    count.glyphs++;
    if (glyph.text !== undefined && LETTERS.test(glyph.text)) count.letters++;
    counts.set(item.font, count);
  }
  const pt = pointsPerUnit(doc);
  return [...counts]
    .sort(([, a], [, b]) => b.letters - a.letters || b.glyphs - a.glyphs || a.order - b.order)
    .flatMap(([number, { glyphs, letters }]) => {
      const dviFont = doc.fonts.get(number);
      const font = dviFont && loaded.get(dviFont.name);
      return dviFont && font ? [{ font, size: dviFont.scale * pt, glyphs, letters }] : [];
    });
}

/**
 * How the overlay sets each field of a page (`FieldLayout`), or undefined for a field whose first
 * glyph is not a glyph, or none of whose fonts loaded. It walks the page once, whatever the number
 * of fields: a page may hold thousands, and each is laid out after every edit's compile.
 */
function layoutsOf(
  doc: DviDocument,
  page: DviPage,
  loaded: ReadonlyMap<string, PageFont>,
  fields: ReadonlyMap<string, Field>,
): Map<string, FieldLayout | undefined> {
  const pt = pointsPerUnit(doc);
  // The fields each item is the first glyph of.
  const firsts = new Map<number, string[]>();
  for (const field of fields.values()) {
    const first = field.glyphs[0];
    if (first) append(firsts, first.item, field.id);
  }
  // A field's paragraph special is the first after its first begin marker and before its first
  // glyph. Everything drawn goes to its baseline as the walk meets it, and each field's first
  // glyph says which baseline is the field's.
  const paragraphs = new Map<string, string>();
  const begun = new Set<string>();
  const waiting = new Set<string>();
  const baselines = new Baselines(ON_BASELINE / pt);
  const baselineOf = new Map<string, Baseline>();
  page.items.forEach((item, index) => {
    // The fields whose first glyph this is.
    const startsHere = firsts.get(index) ?? [];
    for (const id of startsHere) waiting.delete(id);
    if (item.kind === "special") {
      const begin = markerId(item.text, MARKER_BEGIN);
      if (begin !== undefined && !begun.has(begin)) {
        begun.add(begin);
        waiting.add(begin);
      }
      const id = begin === undefined ? paragraphId(item.text) : undefined;
      if (id !== undefined && waiting.delete(id)) paragraphs.set(id, item.text);
    } else if (
      item.kind === "glyph" ||
      (item.kind === "rule" && item.width > 0 && item.height > 0)
    ) {
      const baseline = baselines.at(item.v);
      baseline.h.push(item.h);
      for (const id of startsHere) baselineOf.set(id, baseline);
    }
  });
  /** A baseline's x, in points and in order, sorted the first time a field asks for them. */
  const sorted = (baseline: Baseline | undefined): readonly number[] => {
    if (baseline === undefined) return [];
    baseline.x ??= baseline.h.map((h) => INCH + h * pt).sort((a, b) => a - b);
    return baseline.x;
  };
  const layouts = new Map<string, FieldLayout | undefined>();
  for (const [id, field] of fields) {
    const first = field.glyphs[0];
    const item = first && page.items[first.item];
    const fonts = fontsOf(doc, page, loaded, field);
    const [primary] = fonts;
    if (item?.kind !== "glyph" || !primary) {
      layouts.set(id, undefined);
      continue;
    }
    layouts.set(id, {
      paragraph: paragraphs.get(id),
      fonts,
      font: primary.font,
      size: primary.size,
      x: INCH + item.h * pt,
      y: INCH + item.v * pt,
      secondLine: secondLineOf(page, field, item.v, primary.size / 2 / pt, pt),
      baseline: sorted(baselineOf.get(id)),
    });
  }
  return layouts;
}

/** Add `value` to the list `key` holds in `lists`. */
function append<K, V>(lists: Map<K, V[]>, key: K, value: V) {
  const list = lists.get(key);
  if (list) list.push(value);
  else lists.set(key, [value]);
}

/** The glyphs and rules a page draws on one baseline. */
interface Baseline {
  /** The baseline, the v of the first glyph or rule on it, in DVI units. */
  v: number;
  /** The h of each glyph and rule on it, in DVI units, in the order the page sets them. */
  h: number[];
  /** Their x in TeX points, ascending, once a field has asked. */
  x?: number[];
}

/**
 * A page's baselines, gathered in one walk over its items, so that finding what shares a field's
 * baseline costs the same however close together a page sets its baselines: a template may
 * raise each of thousands of glyphs by a scaled point more than the last, and a window of half a
 * point gathered and sorted anew for each baseline cost 2.2 s to draw such a page. A glyph or
 * rule goes to the nearest baseline already met within `within` of it, or starts one of its own.
 * Each baseline is kept under its v quantised to steps of `within`: two v in one step lie within
 * `within` of each other, so a step holds at most one baseline, and the only baselines that can
 * be near enough to a v are those of its own step and the two beside it.
 */
class Baselines {
  private readonly steps = new Map<number, Baseline>();

  constructor(private readonly within: number) {}

  /** The baseline a glyph or rule at `v` is on, in DVI units. */
  at(v: number): Baseline {
    const step = Math.floor(v / this.within);
    let nearest: Baseline | undefined;
    for (let near = step - 1; near <= step + 1; near++) {
      const baseline = this.steps.get(near);
      const distance = baseline === undefined ? Number.POSITIVE_INFINITY : Math.abs(baseline.v - v);
      if (distance <= this.within && (!nearest || distance < Math.abs(nearest.v - v)))
        nearest = baseline;
    }
    if (nearest) return nearest;
    const baseline: Baseline = { v, h: [] };
    this.steps.set(step, baseline);
    return baseline;
  }
}

/**
 * Where a field's second line starts, in TeX points: the x of the first of its glyphs, in the
 * order TeX set them, that sits a line below its first, more than `gap` DVI units down, half the
 * font's size, so that an accent TeX lowered over an empty box is not taken for one. Undefined
 * when the field's glyphs run out on its first line, or go up instead, to the top of the next
 * column or page.
 */
function secondLineOf(
  page: DviPage,
  field: Field,
  v: number,
  gap: number,
  pt: number,
): number | undefined {
  for (const glyph of field.glyphs) {
    const item = page.items[glyph.item];
    if (item?.kind !== "glyph" || Math.abs(item.v - v) <= gap) continue;
    return item.v > v ? INCH + item.h * pt : undefined;
  }
  return undefined;
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

  const found = collectFields(page, glyphTextOf(doc, loaded));
  let unmatched = 0;
  for (const field of found.values()) unmatched += alignGlyphs(field, texts.get(field.id) ?? "");
  const layouts = layoutsOf(doc, page, loaded, found);
  const fields = new Map<string, PageField>();
  for (const [id, field] of found) fields.set(id, { ...field, layout: layouts.get(id) });

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
