/**
 * From the engine's DVI to a page the editor shows: fonts loaded, glyphs grouped into fields by
 * their markers and matched to each field's text, and the SVG drawn. This is the part of the
 * spike's page that survives; it runs the same in the browser and in Node.
 *
 * XeTeX's XDV sets text in native fonts as well (decision 0014): runs of glyphs of an OpenType or
 * TrueType file, placed one by one. Each glyph of a run is drawn from the file's outline, hit-tested
 * by its box, and read as the character the file's character map gives it, so that it belongs to
 * a field, and has an offset in the field's text, as a TeX font's glyph does.
 *
 * An imported resume's locked parts are read from their lock markers too (`locked.ts`, decision
 * 0041): no field, but placed in blocks, for the lock the page shows over them.
 */

import {
  type DviDocument,
  type DviPage,
  type NativeFont,
  type PageItem,
  parseDvi,
  pointsPerUnit,
  type WidthProvider,
} from "../tex/dvi";
import {
  alignField,
  collectFields,
  type Field,
  type Fold,
  type GlyphTextOf,
  MARKER_BEGIN,
  markerId,
} from "../tex/fields";
import { accentMark, glyphOf } from "../tex/glyphs";
import { glyphKey, INCH, type PageSize, paperSizeOf, renderPage, US_LETTER } from "../tex/svg";
import { scaleTfm } from "../tex/tfm";
import type { FontLibrary, NativePageFont, PageFont } from "./fonts";
import { blocksOf, type LockedRegion, type LockedSet, lockedSets, type Placed } from "./locked";
import { type NativeFontFile, nativeFileName, singleFeaturesOn } from "./native";
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
  /**
   * The font the glyph is drawn from and its size in TeX points: a TeX font's name, as the SVG's
   * `data-font` gives it, or a native font's file's name (`nativeFileName`), as the field's
   * layout names it; a rich field's runs are set in several fonts, which the overlay reads from
   * the glyphs of each (item 10).
   */
  font: string;
  size: number;
  /** The field the glyph belongs to and its character offset there, if it is in one. */
  field?: string;
  offset?: number;
  /** The locked part the glyph belongs to, if it is in one (decision 0041). */
  locked?: string;
}

/**
 * A font a field's glyphs are set in: a TeX font, or a native font XeTeX set from its file, which
 * the overlay measures and shows in their own ways (`kind`).
 */
export type LayoutFont = PageFont | NativePageFont;

/** A font a field's glyphs are set in, and how much of the field it sets. */
export interface FieldFont {
  /** The font, as the page loaded it. */
  font: LayoutFont;
  /** The size the page uses it at, in TeX points. */
  size: number;
  /**
   * How much XeTeX stretches a native font's glyphs across, which scales their advances and the
   * space's, from the XDV's font (`extend=`); left out when it does not.
   */
  extend?: number;
  /**
   * How much XeTeX slants a native font's glyphs, from the XDV's font (`slant=`), which moves no
   * glyph and adds to `\fontdimen1`, which LaTeX reads to set italic corrections; left out when it
   * does not.
   */
  slant?: number;
  /**
   * What XeTeX adds after each glyph of a word but its last, and to the space, in TeX points, from
   * the features its family loads the file with (`letterspace=`, a hundredth of the size for 1),
   * which the XDV does not record (`DrawOptions.features`); left out when it adds nothing.
   */
  letterSpace?: number;
  /**
   * The features of `SINGLE_FEATURES` XeTeX sets a native font's glyphs with, as small capitals
   * are set with `smcp`, from those its family and shape load its file with, which the XDV does not
   * record (`nativeFeatures`): the overlay measures its characters as the glyphs they substitute
   * and sets its rows with them (decision 0023). Left out when there are none.
   */
  features?: readonly string[];
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
   * measures the field in it and sets its rows in its web font. For a native font, the file and
   * the size XeTeX set the field's first glyphs in, and how it stretched and letterspaced them
   * (`FieldFont`).
   */
  font: LayoutFont;
  size: number;
  extend?: number;
  slant?: number;
  letterSpace?: number;
  features?: readonly string[];
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
  /**
   * The case the page sets the field in when it is not the text's own, as a class that sets a
   * title through `\MakeUppercase` sets it in capitals (`Alignment.folded`, decision 0021): the
   * overlay measures and shows the field's text in it, and keeps the text's own case for what the
   * user types; `mixed` for glyphs of both cases, which the overlay shows as typed. Left out when
   * the page sets the text as it stands.
   */
  folded?: Fold;
}

/**
 * A field on the page: its glyphs, and how the overlay sets it, when its first glyph is a glyph,
 * a TeX font's or a native run's, and a font of its glyphs loaded. The layout is optional so that
 * a page's fields as `collectFields` gives them, which is all `fieldsShown` reads, still pass for
 * a page's.
 */
export interface PageField extends Field {
  layout?: FieldLayout;
}

export interface DrawnPage {
  svg: string;
  size: PageSize;
  /** The page's fields, each glyph given its offset in the field's text. */
  fields: Map<string, PageField>;
  /**
   * The document's locked parts (decision 0041), by id, in the order its output first sets them,
   * each placed in blocks on this page, where the page shows its lock, and in none where it is all
   * on another.
   */
  locked: Map<string, LockedRegion>;
  /**
   * Every glyph drawn, a TeX font's or a native font's, in the order the SVG paints them, one for
   * each of its glyphs.
   */
  glyphs: GlyphBox[];
  /** Pages in the whole document, for the warning when a resume spills onto a second one. */
  pageCount: number;
  /** Glyphs in fields that could not be matched to a character of the field's text. */
  unmatched: number;
  /**
   * Fonts the page uses that it could not draw, with the reason: TeX fonts by name, and native
   * fonts by their file's name.
   */
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
 * The ids of the fields the pages show: those with a glyph on one of them, which a click can land
 * on. A field whose text sets no glyph, such as a name in a script the fonts lack, still has its
 * markers on its page with nothing between them, so it is in that page's `fields` but not here.
 * The editor draws every page (decision 0046), so a field on a later page is shown as one on the
 * first is. The side panel gives an input to a filled field the pages leave out, since they offer
 * no way to edit it.
 */
export function fieldsShown(...pages: Pick<DrawnPage, "fields">[]): Set<string> {
  const shown = new Set<string>();
  for (const page of pages)
    for (const field of page.fields.values()) if (field.glyphs.length > 0) shown.add(field.id);
  return shown;
}

/**
 * The file a native font of a document is read from, when one loaded and it is the file's first
 * face, which is the only one opentype.js reads; a later face of a collection is another font.
 */
function fileOf(
  def: NativeFont | undefined,
  natives: ReadonlyMap<string, NativePageFont>,
): NativeFontFile | undefined {
  return def?.index === 0 ? natives.get(nativeFileName(def.name))?.file : undefined;
}

/**
 * Why the page cannot draw the glyphs of a native font of a document, or undefined when it can:
 * the tree has no file by its name, the file cannot be read, or XeTeX set it in a way the page
 * does not draw, from a face of a collection other than the first, or emboldened, which
 * xdvipdfmx strokes and the page draws as boxes rather than as shapes that differ from the PDF.
 * `font` is what `FontLibrary.loadNative` gave for its file.
 */
export function nativeProblem(
  def: NativeFont,
  font: NativePageFont | undefined,
): string | undefined {
  if (font === undefined) return `TeX Live has no ${nativeFileName(def.name)}`;
  if (font.file === undefined) return font.missing ?? "it cannot be read";
  if (def.index !== 0)
    return `XeTeX set face ${def.index} of it, and the page draws only the first`;
  if (def.embolden) return "XeTeX emboldens it, which the page draws as boxes";
  return undefined;
}

/**
 * The text each glyph of a document stands for, which `collectFields` gives a field's glyphs:
 * what its font says the code's glyph stands for (`PageFont.text`), and, for a spacing accent,
 * the combining mark `collectFields` composes with the letter under it. `loaded` holds the fonts
 * that loaded, by name; a glyph from any other font, or from one without outlines, has no text,
 * and so matches no character of a field's text. A glyph of a native run reads as its file says
 * (`NativeFontFile.textOf`), when the file, by its name in `natives`, loaded, and stands for the
 * file's other characters for it as well (`alternatives`). `features` are the ways the package
 * loads each file, by its name (`DrawOptions.features`): a glyph a single substitution makes
 * reads as the glyph it is made from only for the features one of its file's ways turns on, and
 * for every one when they are not given, as for a reference, whose fonts fontspec loaded. The
 * validation harness names glyphs with this.
 */
export function glyphTextOf(
  doc: DviDocument,
  loaded: ReadonlyMap<string, PageFont>,
  natives: ReadonlyMap<string, NativePageFont> = new Map(),
  features?: ReadonlyMap<string, readonly string[]>,
): GlyphTextOf {
  const fontOf = (item: PageItem) => {
    const font = item.kind === "glyph" ? doc.fonts.get(item.font) : undefined;
    return font && loaded.get(font.name);
  };
  // The features of SINGLE_FEATURES each file is loaded with, by its name, once each.
  const turnedOn = new Map<string, string[]>();
  const featuresOf = (file: string): string[] | undefined => {
    if (features === undefined) return undefined;
    let on = turnedOn.get(file);
    if (on === undefined) {
      on = [...new Set((features.get(file) ?? []).flatMap((way) => singleFeaturesOn(way)))];
      turnedOn.set(file, on);
    }
    return on;
  };
  /** Every text a native run's glyph stands for, as its file reads it. */
  const nativeTexts = (item: PageItem, glyph?: number): readonly string[] => {
    if (item.kind !== "native" || glyph === undefined) return [];
    const run = item.glyphs[glyph];
    const def = doc.nativeFonts.get(item.font);
    const file = fileOf(def, natives);
    return (run && file?.textsOf(run.id, featuresOf(nativeFileName(def?.name ?? "")))) ?? [];
  };
  const textOf = (item: PageItem, glyph?: number) =>
    item.kind === "glyph" ? fontOf(item)?.text(item.code) : nativeTexts(item, glyph)[0];
  const accent = (item: PageItem) => {
    const name = item.kind === "glyph" ? fontOf(item)?.outlines?.encoding[item.code] : undefined;
    return name === undefined ? undefined : accentMark(name);
  };
  const alternatives = (item: PageItem, glyph?: number) => nativeTexts(item, glyph).slice(1);
  return Object.assign(textOf, { accent, alternatives });
}

/**
 * The box of every glyph on a page the SVG draws, a TeX font's or a native run's, with its field,
 * or its locked part from `locked`, by `glyphKey`, in the order the SVG paints them. A native
 * glyph's box is its outline's, scaled to the font's size and stretched and slanted as xdvipdfmx
 * stretches and slants it, as the SVG draws it. Each box is put in `keyed` under its glyph's key.
 */
function glyphBoxes(
  doc: DviDocument,
  page: DviPage,
  fonts: ReadonlyMap<string, PageFont>,
  natives: ReadonlyMap<string, NativePageFont>,
  fields: Map<string, Field>,
  locked: ReadonlyMap<string, string>,
  keyed: Map<string, GlyphBox>,
): GlyphBox[] {
  const pt = pointsPerUnit(doc);
  const fieldOf = new Map<string, { field: string; offset: number }>();
  for (const field of fields.values())
    for (const g of field.glyphs) {
      const own = { field: field.id, offset: g.offset };
      fieldOf.set(glyphKey(g.item, g.glyph), own);
      for (const item of g.items ?? []) fieldOf.set(glyphKey(item), own);
    }
  /** What a glyph is of: its field and offset, or else its locked part, as the SVG marks it. */
  const ownerOf = (key: string) => {
    const field = fieldOf.get(key);
    if (field !== undefined) return field;
    const part = locked.get(key);
    return part === undefined ? undefined : { locked: part };
  };
  const boxes: GlyphBox[] = [];
  const push = (key: string, box: GlyphBox) => {
    boxes.push(box);
    keyed.set(key, box);
  };
  page.items.forEach((item, index) => {
    if (item.kind === "native") {
      const def = doc.nativeFonts.get(item.font);
      const file = fileOf(def, natives);
      // The same test the SVG makes before it draws a run's glyphs.
      if (!def || !file || def.embolden || !(file.unitsPerEm > 0)) return;
      const s = (def.size * pt) / file.unitsPerEm;
      const extend = (def.extend ?? 65536) / 65536;
      const slant = (def.slant ?? 0) / 65536;
      item.glyphs.forEach((g, glyph) => {
        // A glyph with no outline is not drawn, and has no box, and nor is the font's .notdef.
        const box = g.id === 0 ? undefined : file.boxOf(g.id);
        if (box === undefined) return;
        const [xMin, yMin, xMax, yMax] = box;
        const across = [xMin, xMax].flatMap((x) => [yMin, yMax].map((y) => extend * x + slant * y));
        const x = INCH + (item.h + g.x) * pt;
        const y = INCH + (item.v + g.y) * pt;
        const key = glyphKey(index, glyph);
        push(key, {
          x,
          y,
          left: x + Math.min(...across) * s,
          top: y - yMax * s,
          right: x + Math.max(...across) * s,
          bottom: y - yMin * s,
          font: nativeFileName(def.name),
          size: def.size * pt,
          ...ownerOf(key),
        });
      });
      return;
    }
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
    const key = glyphKey(index);
    push(key, {
      x,
      y,
      left: x + xMin * s,
      top: y - yMax * s,
      right: x + xMax * s,
      bottom: y - yMin * s,
      font: font.name,
      size: font.scale * pt,
      ...ownerOf(key),
    });
  });
  return boxes;
}

/** The size a rule of a locked part is taken to be set at, in TeX points, before any glyph of it. */
const RULE_SIZE = 10;

/**
 * Each locked part of a document (`lockedSets`) as the page `pageIndex` shows it: its blocks there
 * (`blocksOf`), from the boxes of its glyphs the page draws, `keyed` by `glyphKey`, and of its
 * rules. A rule is taken to be at the size of the part's glyph before it, as far as how far up it
 * goes from one to the next.
 */
function regionsOf(
  doc: DviDocument,
  sets: ReadonlyMap<string, LockedSet>,
  pageIndex: number,
  keyed: ReadonlyMap<string, GlyphBox>,
): Map<string, LockedRegion> {
  const pt = pointsPerUnit(doc);
  const page = doc.pages[pageIndex];
  const regions = new Map<string, LockedRegion>();
  for (const set of sets.values()) {
    const placed: Placed[] = [];
    let size = RULE_SIZE;
    for (const each of set.items) {
      if (each.page !== pageIndex) continue;
      const resumes = each.resumes === true;
      if (each.kind === "glyph") {
        const box = keyed.get(glyphKey(each.item, each.glyph));
        if (box === undefined) continue;
        const { left, top, right, bottom } = box;
        size = box.size;
        placed.push({ left, top, right, bottom, baseline: box.y, size, resumes });
        continue;
      }
      const rule = page?.items[each.item];
      if (rule?.kind !== "rule") continue;
      const bottom = INCH + rule.v * pt;
      placed.push({
        left: INCH + rule.h * pt,
        top: INCH + (rule.v - rule.height) * pt,
        right: INCH + (rule.h + rule.width) * pt,
        bottom,
        baseline: bottom,
        size,
        resumes,
      });
    }
    regions.set(set.id, { id: set.id, blocks: blocksOf(placed) });
  }
  return regions;
}

/**
 * Where a glyph of a page sits, in DVI units from the DVI's origin: a TeX font's glyph where its
 * item is, and the glyph `glyph` of a native run at the run's place and its own offset. Undefined
 * for anything else.
 */
function originOf(
  item: PageItem | undefined,
  glyph: number | undefined,
): { h: number; v: number } | undefined {
  if (item?.kind === "glyph") return { h: item.h, v: item.v };
  const run = item?.kind === "native" && glyph !== undefined ? item.glyphs[glyph] : undefined;
  return run && item ? { h: item.h + run.x, v: item.v + run.y } : undefined;
}

/** How far from a baseline a glyph or rule may sit and still be on it, in TeX points. */
const ON_BASELINE = 0.5;

/** A glyph's text that stands for letters or digits, a ligature's included. */
const LETTERS = /^[\p{L}\p{N}]+$/u;

/**
 * The fonts a field's glyphs are set in, with how many glyphs and letters each sets, in the order
 * `FieldLayout.fonts` gives them. A font that did not load is left out, and so is a native font
 * whose file the page cannot read (`fileOf`), which the overlay could not measure.
 */
function fontsOf(
  doc: DviDocument,
  page: DviPage,
  loaded: ReadonlyMap<string, PageFont>,
  natives: ReadonlyMap<string, NativePageFont>,
  field: Field,
  features: ReadonlyMap<number, string>,
): FieldFont[] {
  const pt = pointsPerUnit(doc);
  // By the DVI's font number, which a TeX font and a native one share, and kind apart all the same.
  const counts = new Map<string, FieldFont & { order: number }>();
  for (const glyph of field.glyphs) {
    const item = page.items[glyph.item];
    let key: string;
    let font: LayoutFont | undefined;
    let size: number;
    const spacing: Pick<FieldFont, "extend" | "slant" | "letterSpace" | "features"> = {};
    if (item?.kind === "glyph") {
      const def = doc.fonts.get(item.font);
      key = `tex:${item.font}`;
      font = def && loaded.get(def.name);
      size = (def?.scale ?? 0) * pt;
    } else if (item?.kind === "native") {
      const def = doc.nativeFonts.get(item.font);
      const file = nativeFileName(def?.name ?? "");
      key = `native:${item.font}`;
      font = fileOf(def, natives) ? natives.get(file) : undefined;
      size = (def?.size ?? 0) * pt;
      const extend = (def?.extend ?? 65536) / 65536;
      const slant = (def?.slant ?? 0) / 65536;
      const letterSpace = letterSpaceOf(features.get(item.font), size);
      const on = singleFeaturesOn(features.get(item.font));
      if (extend !== 1) spacing.extend = extend;
      if (slant !== 0) spacing.slant = slant;
      if (letterSpace !== 0) spacing.letterSpace = letterSpace;
      if (on.length > 0) spacing.features = on;
    } else continue;
    if (font === undefined) continue;
    const count = counts.get(key) ?? {
      font,
      size,
      ...spacing,
      glyphs: 0,
      letters: 0,
      order: counts.size,
    };
    count.glyphs++;
    if (glyph.text !== undefined && LETTERS.test(glyph.text)) count.letters++;
    counts.set(key, count);
  }
  return [...counts.values()]
    .sort((a, b) => b.letters - a.letters || b.glyphs - a.glyphs || a.order - b.order)
    .map(({ order: _, ...font }) => font);
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
  natives: ReadonlyMap<string, NativePageFont>,
  fields: ReadonlyMap<string, Field>,
  features: ReadonlyMap<string, readonly string[]>,
): Map<string, FieldLayout | undefined> {
  const pt = pointsPerUnit(doc);
  const loadedWith = nativeFeatures(doc, page, natives, features);
  // The fields each item is the first glyph of, or holds the first glyph of, in a native run.
  const firsts = new Map<number, { id: string; glyph: number | undefined }[]>();
  for (const field of fields.values()) {
    const first = field.glyphs[0];
    if (first) append(firsts, first.item, { id: field.id, glyph: first.glyph });
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
    for (const { id } of startsHere) waiting.delete(id);
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
      for (const { id } of startsHere) baselineOf.set(id, baseline);
    } else if (item.kind === "native") {
      item.glyphs.forEach((g, glyph) => {
        const baseline = baselines.at(item.v + g.y);
        baseline.h.push(item.h + g.x);
        for (const first of startsHere)
          if (first.glyph === glyph) baselineOf.set(first.id, baseline);
      });
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
    const at = first && originOf(page.items[first.item], first.glyph);
    const fonts = fontsOf(doc, page, loaded, natives, field, loadedWith);
    const [primary] = fonts;
    if (at === undefined || !primary) {
      layouts.set(id, undefined);
      continue;
    }
    layouts.set(id, {
      paragraph: paragraphs.get(id),
      fonts,
      font: primary.font,
      size: primary.size,
      ...(primary.extend === undefined ? {} : { extend: primary.extend }),
      ...(primary.slant === undefined ? {} : { slant: primary.slant }),
      ...(primary.letterSpace === undefined ? {} : { letterSpace: primary.letterSpace }),
      ...(primary.features === undefined ? {} : { features: primary.features }),
      x: INCH + at.h * pt,
      y: INCH + at.v * pt,
      secondLine: secondLineOf(page, field, at.v, primary.size / 2 / pt, pt),
      baseline: sorted(baselineOf.get(id)),
    });
  }
  return layouts;
}

/**
 * The features each native font of a page is loaded with, by its number in the XDV, of those the
 * package loads its file with (`DrawOptions.features`). The XDV names a font's file and size and
 * not its features, so a file loaded two ways, as a family's upright and its small capitals load
 * one file, is told apart by the glyphs the page sets in it (decision 0023): the way whose single
 * substitutions (`NativeFontFile.substitute`) make the most of them from the characters they read
 * as, the first of two that make as many. A file loaded one way is loaded that way.
 */
function nativeFeatures(
  doc: DviDocument,
  page: DviPage,
  natives: ReadonlyMap<string, NativePageFont>,
  features: ReadonlyMap<string, readonly string[]>,
): Map<number, string> {
  const glyphs = new Map<number, Set<number>>();
  for (const item of page.items) {
    if (item.kind !== "native") continue;
    const ids = glyphs.get(item.font) ?? new Set<number>();
    for (const { id } of item.glyphs) ids.add(id);
    glyphs.set(item.font, ids);
  }
  const chosen = new Map<number, string>();
  for (const [font, ids] of glyphs) {
    const def = doc.nativeFonts.get(font);
    const ways = features.get(nativeFileName(def?.name ?? "")) ?? [];
    const file = fileOf(def, natives);
    let best = ways[0];
    if (file !== undefined && ways.length > 1) {
      let most = -1;
      for (const way of ways) {
        const on = singleFeaturesOn(way);
        let made = 0;
        for (const id of ids)
          if (
            file.textsOf(id).some((text) => {
              const glyph = file.glyphFor(text);
              return glyph !== undefined && file.substitute(glyph, on) === id;
            })
          )
            made++;
        if (made > most) {
          most = made;
          best = way;
        }
      }
    }
    if (best !== undefined) chosen.set(font, best);
  }
  return chosen;
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
    const at = originOf(page.items[glyph.item], glyph.glyph);
    if (at === undefined || Math.abs(at.v - v) <= gap) continue;
    return at.v > v ? INCH + at.h * pt : undefined;
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

/** What a page is drawn with besides its output, its fonts and its fields' texts. */
export interface DrawOptions {
  /**
   * The XeTeX features each native font file is loaded with, by the file's name, from the
   * package's `fonts` section (`fontFeatures`): every way its shapes load it, as a family's upright
   * and its small capitals load one file two ways, of which a font's glyphs tell (`nativeFeatures`).
   * What XeTeX letterspaces a font by, and the features that substitute its glyphs, which the XDV
   * does not record, are read from them for the overlay (`FieldFont.letterSpace`, decision 0014,
   * and `FieldFont.features`, decision 0023), and a glyph a substitution makes reads as the glyph
   * it is made from only for the features they turn on (`glyphTextOf`): a file they leave out, for
   * none. Left out, every feature counts.
   */
  features?: ReadonlyMap<string, readonly string[]>;
}

/**
 * What XeTeX's `letterspace=` among a font's features adds after a glyph, in points at `size`:
 * the value is in hundredths of the size, as XeTeX reads it; 0 without one.
 */
export function letterSpaceOf(features: string | undefined, size: number): number {
  const value = /(?:^|;)letterspace=(-?[\d.]+)/.exec(features ?? "")?.[1];
  const hundredths = value === undefined ? 0 : Number.parseFloat(value);
  return Number.isFinite(hundredths) ? (hundredths / 100) * size : 0;
}

/**
 * A DVI read once for all its pages: its fonts loaded, those the page cannot draw named, its
 * locked parts read (`lockedSets`), and what each glyph stands for, which drawing each page shares.
 */
interface Prepared {
  doc: DviDocument;
  loaded: Map<string, PageFont>;
  natives: Map<string, NativePageFont>;
  missingFonts: Map<string, string>;
  sets: Map<string, LockedSet>;
  textOf: GlyphTextOf;
}

/**
 * Read a DVI as `drawPage` draws it: its fonts loaded, which a first pass without widths names,
 * since a DVI defines them at its end too, and the document parsed again with their widths.
 */
async function prepare(
  dvi: Uint8Array,
  fonts: FontLibrary,
  options: DrawOptions,
): Promise<Prepared> {
  const defined = parseDvi(dvi, () => undefined);
  const names = [...new Set([...defined.fonts.values()].map((f) => f.name))];
  const files = [...new Set([...defined.nativeFonts.values()].map((f) => nativeFileName(f.name)))];
  const loaded = new Map<string, PageFont>();
  const natives = new Map<string, NativePageFont>();
  const missingFonts = new Map<string, string>();
  await Promise.all([
    ...names.map(async (name) => {
      const font = await fonts.load(name);
      if (!font) missingFonts.set(name, "TeX Live has no TFM for it");
      else {
        loaded.set(name, font);
        if (font.missing) missingFonts.set(name, font.missing);
      }
    }),
    ...files.map(async (name) => {
      const font = await fonts.loadNative(name);
      if (font) natives.set(name, font);
    }),
  ]);
  for (const def of defined.nativeFonts.values()) {
    const problem = nativeProblem(def, natives.get(nativeFileName(def.name)));
    if (problem !== undefined) missingFonts.set(nativeFileName(def.name), problem);
  }
  const doc: DviDocument = parseDvi(dvi, widthsOf(loaded));
  const textOf = glyphTextOf(doc, loaded, natives, options.features);
  return { doc, loaded, natives, missingFonts, sets: lockedSets(doc), textOf };
}

/** Draw the page `pageIndex` of a prepared DVI (`prepare`), as `drawPage` describes. */
function drawPrepared(
  prepared: Prepared,
  texts: ReadonlyMap<string, string>,
  pageIndex: number,
  options: DrawOptions,
): DrawnPage {
  const { doc, loaded, natives, sets } = prepared;
  const page = doc.pages[pageIndex];
  if (!page) throw new Error(`the document has ${doc.pages.length} pages, not ${pageIndex + 1}`);

  const found = collectFields(page, prepared.textOf);
  let unmatched = 0;
  const folds = new Map<string, Fold>();
  for (const field of found.values()) {
    const alignment = alignField(field, texts.get(field.id) ?? "");
    unmatched += alignment.unmatched;
    if (alignment.folded !== undefined) folds.set(field.id, alignment.folded);
  }
  const layouts = layoutsOf(doc, page, loaded, natives, found, options.features ?? new Map());
  const fields = new Map<string, PageField>();
  for (const [id, field] of found) {
    const layout = layouts.get(id);
    const folded = folds.get(id);
    fields.set(id, { ...field, layout: layout && folded ? { ...layout, folded } : layout });
  }

  // The locked parts' glyphs and rules on this page, by their keys, and the part each is of.
  const lockedGlyphs = new Map<string, string>();
  for (const set of sets.values())
    for (const each of set.items)
      if (each.page === pageIndex) lockedGlyphs.set(glyphKey(each.item, each.glyph), set.id);
  const keyed = new Map<string, GlyphBox>();
  const glyphs = glyphBoxes(doc, page, loaded, natives, fields, lockedGlyphs, keyed);
  const locked = regionsOf(doc, sets, pageIndex, keyed);

  const size = sizeOf(doc, pageIndex);
  const svg = renderPage(doc, page, {
    outlines: (name) => loaded.get(name)?.outlines,
    native: (font) => fileOf(font, natives),
    fields,
    locked: {
      glyphs: lockedGlyphs,
      blocks: new Map([...locked.values()].map((region) => [region.id, region.blocks])),
    },
    size,
    ids: pageIndex === 0 ? "" : `p${pageIndex}-`,
  });
  return {
    svg,
    size,
    fields,
    locked,
    glyphs,
    pageCount: doc.pages.length,
    unmatched,
    missingFonts: new Map(prepared.missingFonts),
  };
}

/**
 * Draw one page of a DVI, or of XeTeX's XDV. `texts` holds each field's text as the model has
 * it; glyphs are matched against it, folded to the page's case where that is not the text's own
 * (`FieldLayout.folded`), so a click can say which character it landed on. A locked part is read
 * from its markers, and placed on this page (`DrawnPage.locked`). A font the page cannot draw, or
 * whose outlines cannot be read this time, is left out and named in
 * `missingFonts`, while its metrics still place every glyph after its own; the next draw reads it
 * again. A native font the page cannot draw (`nativeProblem`) is drawn as boxes, one for each of
 * its runs, and named there too, by its file's name. It rejects when a font's metrics, the font
 * map or the glyph list cannot be read, since a page drawn without them would put glyphs in the
 * wrong places or name them wrongly with no error, and the caller keeps the page it had. A page
 * after the first names its glyphs' shapes apart (`RenderOptions.ids`), so that every page can
 * stand in one document (decision 0046).
 */
export async function drawPage(
  dvi: Uint8Array,
  fonts: FontLibrary,
  texts: ReadonlyMap<string, string>,
  pageIndex = 0,
  options: DrawOptions = {},
): Promise<DrawnPage> {
  return drawPrepared(await prepare(dvi, fonts, options), texts, pageIndex, options);
}

/**
 * Draw every page of a DVI, in order, each as `drawPage` draws it (decision 0046): the editor shows
 * them one under the other. The DVI is read, and its fonts loaded, once for all of them, so that a
 * one-page document costs what `drawPage` costs, and each page after it only its own drawing.
 */
export async function drawPages(
  dvi: Uint8Array,
  fonts: FontLibrary,
  texts: ReadonlyMap<string, string>,
  options: DrawOptions = {},
): Promise<DrawnPage[]> {
  const prepared = await prepare(dvi, fonts, options);
  return prepared.doc.pages.map((_, index) => drawPrepared(prepared, texts, index, options));
}

/**
 * Every page of a DVI drawn with `draw`, one page at a time, as `drawPages` draws them: the first,
 * which says how many there are, then the rest. For a draw given in the place of `drawPage`, as a
 * test's or a measurement's, which takes a page's index.
 */
export async function drawEach(
  draw: typeof drawPage,
  dvi: Uint8Array,
  fonts: FontLibrary,
  texts: ReadonlyMap<string, string>,
  options: DrawOptions = {},
): Promise<DrawnPage[]> {
  const first = await draw(dvi, fonts, texts, 0, options);
  const rest = Array.from({ length: Math.max(0, first.pageCount - 1) }, (_, index) =>
    draw(dvi, fonts, texts, index + 1, options),
  );
  return [first, ...(await Promise.all(rest))];
}
