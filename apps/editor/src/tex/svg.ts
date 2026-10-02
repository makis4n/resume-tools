/**
 * Draw a DVI page as SVG, one element per glyph.
 *
 * Every glyph becomes a `<use>` of a shared outline in `<defs>`, carrying the field id
 * and character offset it resolves to as data attributes, so a click on the page is a
 * DOM lookup. A glyph's hit area is its bounding box rather than its ink, so a click in
 * the hole of an "o" still lands on it. Coordinates are in TeX points with the origin at
 * the page's top-left corner; the DVI origin sits one inch in from that.
 *
 * A glyph or a rule of a locked part of an imported resume, a box of colour among its rules, carries
 * the part's id instead (`data-locked`), and so does an unpainted box over each of the part's
 * blocks, under every glyph, so that the pointer between its words and lines is over the part too
 * (decision 0041).
 */

import type { DviDocument, DviPage, NativeFont, PageItem } from "./dvi";
import { pointsPerUnit } from "./dvi";
import type { Field } from "./fields";
import { type FontOutlines, glyphOf } from "./glyphs";

export interface PageSize {
  width: number;
  height: number;
}

export const US_LETTER: PageSize = { width: 614.295, height: 794.97 };
/** One inch in TeX points: the DVI origin sits this far in from the page's top-left corner. */
export const INCH = 72.27;

/** A length unit, in TeX points, as the page-size specials spell it. */
const UNITS: Record<string, number> = {
  pt: 1,
  bp: 72.27 / 72,
  in: 72.27,
  mm: 72.27 / 25.4,
  cm: 72.27 / 2.54,
};

/** A length as a page-size special writes it, `<number><unit>`, in TeX points, or NaN. */
function length(value: string, unit: string): number {
  return Number(value) * (UNITS[unit] ?? Number.NaN);
}

/**
 * The page size a page's specials give, in TeX points, or undefined when none does. Two specials
 * set it, and the page, the harness's PDF check and the session's choice of whether to tell
 * xdvipdfmx a size (`namesPaperSize` in `engine/session.ts`) all read it here, so they agree:
 *
 * - `papersize=<w>,<h>`, which geometry, hyperref and the `geometry` driver write for pdfTeX;
 * - `pdf:pagesize width <w> height <h>`, which XeTeX and geometry's xetex/dvipdfmx driver write
 *   instead, its `width` and `height` keys in either order. `pdf:pagesize default` gives no size.
 *
 * xdvipdfmx reads both, so a PDF made without `-p` comes out this size (decision 0008).
 */
export function paperSizeOf(items: PageItem[]): PageSize | undefined {
  for (const item of items) {
    if (item.kind !== "special") continue;
    if (item.text.startsWith("papersize=")) {
      const dims = item.text
        .slice("papersize=".length)
        .split(",")
        .map((dim) => /^\s*([\d.]+)\s*([a-z]{2})\s*$/.exec(dim));
      const [w, h] = dims.map((m) => (m ? length(m[1] as string, m[2] as string) : Number.NaN));
      if (w && h && Number.isFinite(w) && Number.isFinite(h)) return { width: w, height: h };
    } else if (/^pdf:pagesize\b/.test(item.text)) {
      const w = /\bwidth\s+([\d.]+)\s*([a-z]{2})\b/.exec(item.text);
      const h = /\bheight\s+([\d.]+)\s*([a-z]{2})\b/.exec(item.text);
      const width = w ? length(w[1] as string, w[2] as string) : Number.NaN;
      const height = h ? length(h[1] as string, h[2] as string) : Number.NaN;
      if (width && height && Number.isFinite(width) && Number.isFinite(height))
        return { width, height };
    }
  }
  return undefined;
}

/** Outlines of an OpenType or TrueType font XeTeX used directly, by glyph index. */
export interface NativeOutlines {
  unitsPerEm: number;
  /** SVG path data in font units, y up, or undefined for an empty or missing glyph. */
  pathOf: (glyphId: number) => string | undefined;
}

export interface RenderOptions {
  outlines: (fontName: string) => FontOutlines | undefined;
  /** Outlines for XeTeX's native fonts; runs whose font is missing are drawn as boxes. */
  native?: (font: NativeFont) => NativeOutlines | undefined;
  fields?: Map<string, Field>;
  /**
   * The page's locked parts (decision 0041): the part each of their glyphs and rules is of, by
   * `glyphKey`, and each part's blocks, by its id, in TeX points from the page's top-left corner.
   */
  locked?: {
    glyphs: ReadonlyMap<string, string>;
    blocks: ReadonlyMap<
      string,
      readonly { left: number; top: number; right: number; bottom: number }[]
    >;
  };
  size?: PageSize;
  /**
   * What the ids of the page's glyph shapes start with, so that pages drawn one under the other in
   * one document each use their own (decision 0046): none for the first page, which keeps the ids it
   * always had, and `p<index>-` for a later one (`drawPage`).
   */
  ids?: string;
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * What names a glyph of a page: its item's index, and for a glyph of a native run, which is one
 * item for the whole run, its index in the run as well.
 */
export const glyphKey = (item: number, glyph?: number) =>
  glyph === undefined ? String(item) : `${item}:${glyph}`;

/** Parse a dvips `color push ...` special into a CSS colour, or undefined if unknown. */
export function dvipsColor(spec: string): string | undefined {
  const parts = spec.trim().split(/\s+/);
  const nums = parts.slice(1).map(Number);
  switch (parts[0]) {
    case "rgb": {
      const [r = 0, g = 0, b = 0] = nums;
      return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    }
    case "gray": {
      const v = Math.round((nums[0] ?? 0) * 255);
      return `rgb(${v},${v},${v})`;
    }
    case "cmyk": {
      const [c = 0, m = 0, y = 0, k = 0] = nums;
      const f = (x: number) => Math.round(255 * (1 - Math.min(1, x + k)));
      return `rgb(${f(c)},${f(m)},${f(y)})`;
    }
    case "Black":
      return "rgb(0,0,0)";
    case "White":
      return "rgb(255,255,255)";
    default:
      return undefined;
  }
}

export function renderPage(doc: DviDocument, page: DviPage, options: RenderOptions): string {
  const size = options.size ?? US_LETTER;
  const prefix = options.ids ?? "";
  const pt = pointsPerUnit(doc);
  const defs = new Map<string, string>();
  const body: string[] = [];
  const colors: string[] = [];
  // Each glyph's field and offset, by `glyphKey`: a native run's glyphs each have their own.
  const fieldOfGlyph = new Map<string, { id: string; offset: number }>();
  // An accented letter TeX set as an accent and a letter is one character: both carry it.
  for (const field of options.fields?.values() ?? []) {
    for (const g of field.glyphs) {
      const own = { id: field.id, offset: g.offset };
      fieldOfGlyph.set(glyphKey(g.item, g.glyph), own);
      for (const item of g.items ?? []) fieldOfGlyph.set(glyphKey(item), own);
    }
  }
  const fill = () => {
    const c = colors[colors.length - 1];
    return c && c !== "rgb(0,0,0)" ? ` fill="${c}"` : "";
  };
  /**
   * The data attributes of the page item `index`, or of the glyph `glyph` of a native run: its
   * field's and offset, or its locked part's.
   */
  const fieldAttrs = (index: number, glyph?: number) => {
    const key = glyphKey(index, glyph);
    const f = fieldOfGlyph.get(key);
    if (f) return ` data-field="${escape(f.id)}" data-offset="${f.offset}"`;
    const part = options.locked?.glyphs.get(key);
    return part === undefined ? "" : ` data-locked="${escape(part)}"`;
  };
  // Each locked part's blocks, unpainted, under every glyph: what a glyph sets over one is its own.
  const lockedBlocks = [...(options.locked?.blocks ?? [])].flatMap(([id, blocks]) =>
    blocks
      .filter((block) => block.right > block.left && block.bottom > block.top)
      .map(
        (block) =>
          `<rect x="${block.left.toFixed(3)}" y="${block.top.toFixed(3)}" width="${(block.right - block.left).toFixed(3)}" height="${(block.bottom - block.top).toFixed(3)}" fill="#fff" fill-opacity="0" data-locked="${escape(id)}"/>`,
      ),
  );

  page.items.forEach((item, index) => {
    switch (item.kind) {
      case "glyph": {
        const font = doc.fonts.get(item.font);
        const outlines = font && options.outlines(font.name);
        if (!font || !outlines) return;
        const glyph = glyphOf(outlines, item.code);
        if (!glyph) return;
        const id = `${prefix}g${item.font}-${item.code}`;
        if (!defs.has(id)) {
          const s = (font.scale * pt) / 1000;
          defs.set(
            id,
            `<path id="${id}" d="${escape(glyph.d)}" transform="matrix(${s} 0 0 ${-s} 0 0)"/>`,
          );
        }
        const x = INCH + item.h * pt;
        const y = INCH + item.v * pt;
        const w = item.width * pt;
        body.push(
          `<use href="#${id}" x="${x.toFixed(3)}" y="${y.toFixed(3)}" data-code="${item.code}" data-w="${w.toFixed(3)}" data-font="${escape(font.name)}" data-size="${(font.scale * pt).toFixed(3)}"${fieldAttrs(index)}${fill()}/>`,
        );
        return;
      }
      case "native": {
        const font = doc.nativeFonts.get(item.font);
        const outlines = font && options.native?.(font);
        // Emboldening is a stroke xdvipdfmx adds; until that is drawn too, such runs stay
        // boxes rather than shapes that differ from the PDF. So does a font with no usable em.
        const drawable =
          outlines &&
          Number.isFinite(outlines.unitsPerEm) &&
          outlines.unitsPerEm > 0 &&
          !font.embolden;
        if (!font || !outlines || !drawable) {
          // Without the font file's outlines the run is drawn as a box, which a click on lands on
          // the run's first glyph.
          const x = INCH + item.h * pt;
          const y = INCH + item.v * pt;
          body.push(
            `<rect x="${x.toFixed(3)}" y="${(y - 7).toFixed(3)}" width="${(item.width * pt).toFixed(3)}" height="9" fill="none" stroke="rgb(200,60,60)" stroke-width="0.3"${fieldAttrs(index, 0)}/>`,
          );
          return;
        }
        // A font's own colour (\color inside fontspec's features) beats the dvips stack.
        let own = fill();
        if (font.rgba !== undefined) {
          const alpha = font.rgba & 0xff;
          own = ` fill="rgb(${(font.rgba >>> 24) & 0xff},${(font.rgba >>> 16) & 0xff},${(font.rgba >>> 8) & 0xff})"`;
          if (alpha < 255) own += ` fill-opacity="${(alpha / 255).toFixed(3)}"`;
        }
        // Font units to points, with xdvipdfmx's fake stretch (x scale) and slant (x shear),
        // which the XDV carries as 16.16 fixed values (65536 is 1.0).
        const s = (font.size * pt) / outlines.unitsPerEm;
        const extend = (font.extend ?? 65536) / 65536;
        const slant = (font.slant ?? 0) / 65536;
        const matrix = `matrix(${s * extend} 0 ${s * slant} ${-s} 0 0)`;
        item.glyphs.forEach((g, glyph) => {
          // Glyph 0 is the font's .notdef, which XeTeX sets for a character its font lacks: the
          // page reads it as the character left out and draws nothing (decision 0014).
          if (g.id === 0) return;
          const id = `${prefix}n${item.font}-${g.id}`;
          if (!defs.has(id)) {
            let d: string | undefined;
            try {
              d = outlines.pathOf(g.id);
            } catch {
              d = undefined; // a glyph the font file cannot deliver is left out, not the page
            }
            if (d === undefined) return;
            defs.set(id, `<path id="${id}" d="${escape(d)}" transform="${matrix}"/>`);
          }
          const x = INCH + (item.h + g.x) * pt;
          const y = INCH + (item.v + g.y) * pt;
          body.push(
            `<use href="#${id}" x="${x.toFixed(3)}" y="${y.toFixed(3)}" data-glyph="${g.id}" data-font="${escape(font.name)}" data-size="${(font.size * pt).toFixed(3)}"${fieldAttrs(index, glyph)}${own}/>`,
          );
        });
        return;
      }
      case "rule": {
        if (item.width <= 0 || item.height <= 0) return;
        const x = INCH + item.h * pt;
        const y = INCH + (item.v - item.height) * pt;
        body.push(
          `<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${(item.width * pt).toFixed(3)}" height="${(item.height * pt).toFixed(3)}"${fill()}${fieldAttrs(index)}/>`,
        );
        return;
      }
      case "special": {
        if (item.text.startsWith("color push ")) {
          colors.push(
            dvipsColor(item.text.slice("color push ".length)) ??
              colors[colors.length - 1] ??
              "rgb(0,0,0)",
          );
        } else if (item.text === "color pop") {
          colors.pop();
        }
        return;
      }
    }
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.width} ${size.height}" width="${size.width}pt" height="${size.height}pt" pointer-events="bounding-box">`,
    `<defs>${[...defs.values()].join("")}</defs>`,
    `<rect width="${size.width}" height="${size.height}" fill="white"/>`,
    ...lockedBlocks,
    ...body,
    "</svg>",
  ].join("\n");
}
