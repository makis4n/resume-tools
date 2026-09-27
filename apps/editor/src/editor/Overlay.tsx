/**
 * The editing overlay: a field opened in place on the page, set in the page's own glyphs and
 * broken into lines where TeX will break them, so that what the user types sits where the next
 * compile puts it (decision 0004). It is the spike's overlay as product code.
 *
 * A keystroke never waits for TeX. Every input rebuilds the field's text from the rows the
 * browser edited, breaks it again with TeX's breaker, the field's font metrics and the parameters
 * TeX measured for its paragraph (the paragraph special, `page/paragraph.ts`), draws the rows and
 * puts the caret back; then the edit goes to the document as a command, and the compile follows it
 * after the scheduler's pause. The browser wraps nothing: each row is a `<div>` of its own with
 * `white-space: pre`, and its `word-spacing` is the glue TeX sets on the line: the line's shortfall
 * shared between its spaces and its skips as TeX shares it. The rows are set in a web font built
 * from the page's own outlines (`page/webfont.ts`), or, for a field XeTeX set in a native font,
 * in the font's own file (decision 0014), and wait for it. A field the page sets in another case
 * than its text's, as a title a class sets through `\MakeUppercase`, is measured and shown in
 * that case, through CSS's `text-transform`, while the text the user edits keeps its own (decision
 * 0021). When the compile's page arrives the overlay reads its place from the new page and stays
 * open with its text and caret; a page without the field leaves it where it was (`placementFor`),
 * and only a document without the field closes it (`shouldClose`).
 *
 * Offsets are UTF-16 indices throughout, as the DOM and the model slice by. A field is one
 * paragraph, so Enter inserts nothing, and pasted text comes in plain, its line breaks as spaces.
 * Formatting keys insert nothing, and neither do the browser's own undo and redo, whose record of
 * the rows this overlay redraws on every input would be wrong. The app takes the undo and redo keys
 * (item 12), and closes the overlay first, so that an undo takes back the whole visit to the field.
 * Dates open a small picker instead, since the model stores them as dates.
 *
 * A rich field opens in Tiptap instead (`RichOverlay.tsx`, item 10), placed and sized from here as
 * a plain field is, with a web font for each of its variants, bold and italic among them, and each
 * run broken in its own variant's font (`richRows`).
 */

import { type Dates, type Resume, type RichText, YearMonth } from "@resume-tools/resume-model";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DrawnPage, FieldFont, FieldLayout, LayoutFont } from "../page/draw";
import { companionName, variantFontNames } from "../page/fontnames";
import type { FontLibrary, NativePageFont, PageFont } from "../page/fonts";
import { breakParams, parseParagraph, startingAt } from "../page/paragraph";
import {
  nativeWebFontOf,
  registerWebFont,
  typedCodes,
  webFontFamily,
  webFontMetrics,
  webFontOf,
} from "../page/webfont";
import type { Fold } from "../tex/fields";
import {
  type Node as BreakNode,
  type BreakParams,
  breakLines,
  type Face,
  type Glue,
  LATEX_PARAMS,
  type LineSpec,
  lineRanges,
  paragraphNodes,
  richParagraphNodes,
  tfmFace,
  ZERO_GLUE,
} from "../tex/linebreak";
import { scaleTfm } from "../tex/tfm";
import type { Shown } from "./compiler";
import { type Command, type Document, fieldsOf } from "./document";
import { type Look, RichOverlay, textTransform } from "./RichOverlay";
import { breakRuns, VARIANTS, type Variant, variantFonts, variantOf } from "./rich";

/** Scaled points in a point. */
const PT = 65536;

/** One line of the overlay: where its text starts and ends, and the glue TeX adds per space. */
export interface Row {
  /** Where the row's text starts, and where the next row's starts, as UTF-16 offsets. */
  from: number;
  to: number;
  /** What TeX sets each space on the line wider (or, below zero, narrower) by, in scaled points. */
  wordSpacingSp: number;
}

/**
 * The width TeX sets each of a line's spaces at, when the line's other glue is `skips` and its
 * width falls short of the line's by `shortfall` scaled points, or exceeds it when that is below
 * zero (tex.web §656–665). A shortfall is shared by the line's glue of the highest order of
 * infinity that has any stretch, spaces and skips alike, each by its stretch; so fil glue in the
 * margins, or `\parfillskip` on a paragraph's last line, takes all of it, and a `\rightskip` with
 * finite stretch, as ragged2e's `\RaggedRight` has, shares it with the spaces, or takes all of it
 * when `\spaceskip` has made them rigid. An excess is shared by shrink in the same way, and finite
 * shrink never goes past what the glue has.
 */
export function spaceWidths(
  spaces: readonly Glue[],
  skips: readonly Glue[],
  shortfall: number,
): number[] {
  const stretching = shortfall > 0;
  const amount = (glue: Glue) => (stretching ? glue.stretch : glue.shrink);
  const orderOf = (glue: Glue) => (stretching ? glue.stretchOrder : glue.shrinkOrder);
  const totals = [0, 0, 0, 0];
  for (const glue of [...spaces, ...skips])
    totals[orderOf(glue)] = (totals[orderOf(glue)] ?? 0) + amount(glue);
  const order = [3, 2, 1, 0].find((each) => totals[each] !== 0);
  if (shortfall === 0 || order === undefined) return spaces.map((space) => space.width);
  let ratio = Math.abs(shortfall) / (totals[order] as number);
  if (!stretching && order === 0) ratio = Math.min(ratio, 1);
  const sign = stretching ? 1 : -1;
  return spaces.map(
    (space) => space.width + (orderOf(space) === order ? sign * amount(space) * ratio : 0),
  );
}

/** A space between words in the breaker's list. */
type Space = Extract<BreakNode, { kind: "glue" }>;

/**
 * The rows a paragraph's nodes are set in, for a text of `length` characters: TeX's lines for
 * `params`. The rows tile the text (`lineRanges`), so joining them gives it back.
 *
 * Each row's word spacing makes its spaces as wide as TeX sets them on the line, on average: the
 * browser sets every space at its font's interword space, `browserSpace`, where TeX sets a wider
 * one after a sentence, or `\spaceskip` when a template sets it, and shares the line's shortfall
 * between its spaces and its skips (`spaceWidths`).
 */
function rowsOf(
  nodes: BreakNode[],
  length: number,
  params: BreakParams,
  browserSpace: (space: Space) => number,
): Row[] {
  const { leftSkip, rightSkip, parFillSkip } = params;
  const lines = breakLines(nodes, params);
  const rows = lineRanges(nodes, lines, length).map((range, i): Row => {
    const line = lines[i];
    const spaces = line
      ? nodes.slice(line.from, line.breakAt).filter((node): node is Space => node.kind === "glue")
      : [];
    if (line === undefined || spaces.length === 0)
      return { from: range.from, to: range.to, wordSpacingSp: 0 };
    const skips =
      i === lines.length - 1 ? [leftSkip, rightSkip, parFillSkip] : [leftSkip, rightSkip];
    const natural = skips.reduce((sum, skip) => sum + skip.width, line.natural);
    const set = spaceWidths(spaces, skips, line.width - natural).reduce((sum, w) => sum + w, 0);
    const browser = spaces.reduce((sum, space) => sum + browserSpace(space), 0);
    return { from: range.from, to: range.to, wordSpacingSp: (set - browser) / spaces.length };
  });
  return rows.length > 0 ? rows : [{ from: 0, to: length, wordSpacingSp: 0 }];
}

/**
 * A field's text as the page sets it, for the breaker to measure, when the page folds its case
 * (`FieldLayout.folded`, decision 0021): each character in capitals, or in small letters, where
 * that is a character as long, so that every offset is still the text's; one whose folded form is
 * longer, as ß's capitals are SS, is measured as it stands. Capitals are wider than small letters,
 * and a period after a capital ends no sentence, since TeX's space factor after one is 999, so a
 * title the page sets in capitals breaks where it would not in the text's own case. A field whose
 * glyphs are of both cases (`mixed`), which no one case shows, is measured as typed.
 */
export function shownCase(text: string, folded: Fold | undefined): string {
  if (folded === undefined || folded === "mixed") return text;
  let shown = "";
  for (const char of text) {
    const each = folded === "upper" ? char.toUpperCase() : char.toLowerCase();
    shown += each.length === char.length ? each : char;
  }
  return shown;
}

/**
 * The rows a field's text is set in: TeX's lines for `params` (`rowsOf`), and one row for a field
 * TeX never breaks, which has none. A field the page folds to a case (`folded`) is measured in it
 * (`shownCase`).
 */
export function layoutRows(
  text: string,
  face: Face,
  params: BreakParams | undefined,
  folded?: Fold,
): Row[] {
  if (params === undefined) return [{ from: 0, to: text.length, wordSpacingSp: 0 }];
  const { spaceSkip, xspaceSkip } = params;
  const nodes = paragraphNodes(shownCase(text, folded), face, { spaceSkip, xspaceSkip });
  return rowsOf(nodes, text.length, params, () => face.spaceGlue().space);
}

/**
 * The faces a rich field's runs are measured in (`richFaces`): each variant's that the page or the
 * tree gives, and the field's letter face, which measures a variant that has none until a page
 * sets it.
 */
export interface RichFaces {
  variants: ReadonlyMap<Variant, Face>;
  letter: Face;
}

/** Whether a face's font is slanted: its `\fontdimen1`, as LaTeX's `\maybe@ic` reads it. */
const slanted = (face: Face) => face.slant > 0;

/**
 * Whether each variant's font is slanted, which decides LaTeX's italic corrections (`breakRuns`).
 * A variant without a face is taken as its family has it, never as the field's letter font is:
 * the regular and bold fonts outside a run's groups are the paragraph's, upright unless the page
 * sets one of them slanted, since `\bfseries` keeps the paragraph's shape; and the italic ones are
 * slanted. A field set wholly in italic has an italic letter font, whose slant would drop every
 * correction TeX sets there (the reviewers' wholly italic bullets, 1.5 to 4.9 pt short a line).
 */
export function slantOf(faces: RichFaces): (variant: Variant) => boolean {
  const known = (variant: Variant) => {
    const face = faces.variants.get(variant);
    return face && slanted(face);
  };
  return (variant) => {
    if (variant === "regular") return known("regular") ?? known("bold") ?? false;
    if (variant === "bold") return known("bold") ?? known("regular") ?? false;
    return known(variant) ?? true;
  };
}

/**
 * The rows a rich field's runs are set in, as `layoutRows` sets a field's text: each run in the
 * face of its variant, or the letter face when it has none (`RichFaces`), with the italic
 * corrections LaTeX sets around `\textit` and `\textbf` (`breakRuns`, `slantOf`), each space
 * measured in its own run's font, which the browser draws it in too, and each run in the case the
 * page folds the field to (`shownCase`).
 */
export function richRows(
  runs: RichText,
  faces: RichFaces,
  params: BreakParams | undefined,
  folded?: Fold,
): Row[] {
  const length = runs.reduce((sum, run) => sum + run.text.length, 0);
  if (params === undefined) return [{ from: 0, to: length, wordSpacingSp: 0 }];
  const faceOf = (variant: Variant) => faces.variants.get(variant) ?? faces.letter;
  const shown =
    folded === undefined || folded === "mixed"
      ? runs
      : runs.map((run) => ({ ...run, text: shownCase(run.text, folded) }));
  const set = breakRuns(shown, slantOf(faces)).map((run) => ({
    ...run,
    face: faceOf(run.variant),
  }));
  const { spaceSkip, xspaceSkip } = params;
  const nodes = richParagraphNodes(set, { spaceSkip, xspaceSkip });
  // Where each run starts, for the face a space is set in, found by halves, since a field may
  // hold thousands of runs and a line many spaces.
  const starts: number[] = [];
  let at = 0;
  for (const run of set) {
    starts.push(at);
    at += run.text.length;
  }
  const faceAt = (offset: number): Face => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((starts[middle] as number) <= offset) low = middle;
      else high = middle - 1;
    }
    return set[low]?.face ?? faces.letter;
  };
  return rowsOf(nodes, length, params, (space) => faceAt(space.offset).spaceGlue().space);
}

/**
 * The faces of a rich field's variants, from the fonts they are set in (`variantFontsOf`,
 * `namedVariants`), and its letter face. A character a variant's font lacks is measured in the
 * variant's own companion first, the TS1 font of its weight and shape (`companionName`), and only
 * then in the field's other fonts, whose order puts the companion that sets the most glyphs first:
 * LaTeX takes a regular `€` from regular TS1 however many bold ones the field has (the reviewers'
 * bullet, 1.9 pt long a line with each regular euro measured in bold TS1).
 */
export function richFaces(fonts: ReadonlyMap<Variant, SizedFont>, layout: FieldLayout): RichFaces {
  const faceOf = (font: SizedFont) => {
    const companion = companionName(font.font.name);
    const own = (other: SizedFont) => other.font.name === companion;
    return faceFor(font, [...layout.fonts.filter(own), ...layout.fonts.filter((o) => !own(o))]);
  };
  const variants = new Map([...fonts].map(([variant, font]) => [variant, faceOf(font)]));
  return { variants, letter: faceOf(layout) };
}

/**
 * The fonts of a rich field's variants the page sets no glyph of, by name (`variantFontNames`)
 * from the fonts of those it does, and then from the field's letter font, each loaded by `load`,
 * which gives nothing for a name the tree has no TFM for. They are the upright font outside a
 * field set wholly in italic, and the bold font of a run that is only a space, which no page will
 * ever show: TeX sets the reviewers' `\textbf{ }` at 3.833 pt, and the letter font's space is
 * 3.333 pt. A font found is used at the size of the one its name came from. A variant no name
 * gives, or whose font cannot be read, is left out, and measured in the letter font.
 */
export async function namedVariants(
  known: ReadonlyMap<Variant, SizedFont>,
  layout: FieldLayout,
  load: (name: string) => Promise<PageFont | undefined>,
): Promise<Map<Variant, SizedFont>> {
  const sources = [...known.values(), layout];
  const named = new Map<Variant, SizedFont>();
  for (const variant of VARIANTS) {
    if (known.has(variant)) continue;
    const candidates = sources.flatMap((source) =>
      variantFontNames(source.font.name, variant, source.size).map((name) => ({
        name,
        size: source.size,
      })),
    );
    for (const { name, size } of candidates) {
      const font = await load(name).catch(() => undefined);
      if (font === undefined) continue;
      named.set(variant, { font, size });
      break;
    }
  }
  return named;
}

/**
 * The font each variant of a rich field is set in on a page (`variantFonts`), from the page's
 * glyphs of the field and the resume the page was compiled from, whose runs their offsets count
 * through; undefined when the page does not show the field. A glyph's font is the field's font of
 * the same name and size, and one that did not load leaves its glyphs out.
 */
export function variantFontsOf(
  page: DrawnPage,
  resume: Resume,
  id: string,
): Map<Variant, FieldFont> | undefined {
  const layout = page.fields.get(id)?.layout;
  const field = fieldsOf(resume).get(id);
  if (layout === undefined || field?.kind !== "rich") return undefined;
  const name = (font: string, size: number) => `${size} ${font}`;
  const fonts = new Map(layout.fonts.map((each) => [name(each.font.name, each.size), each]));
  const glyphs = page.glyphs.flatMap((glyph) =>
    glyph.field === id && glyph.offset !== undefined
      ? [{ offset: glyph.offset, font: name(glyph.font, glyph.size) }]
      : [],
  );
  const table = new Map<Variant, FieldFont>();
  for (const [variant, font] of variantFonts(field.get(resume), glyphs)) {
    const loaded = fonts.get(font);
    if (loaded) table.set(variant, loaded);
  }
  return table;
}

/**
 * The row an offset falls in, and its column there. A row's end is the next row's start, where
 * the offset belongs to the next row, after the space TeX broke at; the text's end is in the last.
 */
export function rowOf(rows: readonly Row[], offset: number): { row: number; column: number } {
  let row = rows.findIndex((each) => offset >= each.from && offset < each.to);
  if (row < 0) row = offset <= 0 ? 0 : rows.length - 1;
  const { from, to } = rows[row] ?? { from: 0, to: 0 };
  return { row, column: Math.min(Math.max(0, offset - from), to - from) };
}

/**
 * A font at the size a page uses it, in TeX points, and for a native font how XeTeX stretched,
 * slanted and letterspaced it, and the features that substitute its glyphs (`FieldFont`).
 */
export interface SizedFont {
  font: LayoutFont;
  size: number;
  extend?: number;
  slant?: number;
  letterSpace?: number;
  features?: readonly string[];
}

/**
 * The CSS `font-feature-settings` that set a native font's rows with the features XeTeX set its
 * glyphs with (`FieldFont.features`), each an OpenType tag CSS takes as it is, as `"smcp" 1`:
 * a browser applies no such feature unasked (decision 0023). `normal` for none.
 */
export function featureSettings(features: readonly string[] | undefined): string {
  return features === undefined || features.length === 0
    ? "normal"
    : features.map((tag) => `${cssString(tag)} 1`).join(", ");
}

/** The characters a page font's web font maps, with their codes; none when it has no outlines. */
const codesOf = (font: PageFont) =>
  font.outlines ? typedCodes(font.outlines, font.text) : new Map<string, number>();

/**
 * A TeX font's face at a size in scaled points: its TFM scaled as TeX scales it, its ligature and
 * kern program, and the code for each character by the rule its web font's character map follows
 * (`typedCodes`), so that a character the breaker measures is the glyph the browser draws.
 */
function texFace(font: PageFont, size: number): Face {
  const codes = codesOf(font);
  return tfmFace(font.tfm, scaleTfm(font.tfm, size), (char) => codes.get(char));
}

/**
 * A native font's face at a size in scaled points (decision 0014): each character's glyph from
 * the file's character map, the glyph its web font, the file itself, draws, measured by its
 * advance at the size, as XeTeX measures a glyph; the space the space glyph's advance, which XeTeX
 * makes `\fontdimen2`, with half of it to stretch and a third to shrink, and a third more after a
 * sentence, as XeTeX gives every native font its `\fontdimen3`, `4` and `7`; and neither
 * ligatures nor kerns, which XeTeX's shaping applies within a word and the overlay leaves to the
 * page. Its slant is its file's (`NativeFontFile.slant`), and a glyph's italic correction what
 * its outline reaches past its advance, as XeTeX measures both. A font whose file could not be
 * read measures every character as nothing.
 *
 * XeTeX's `extend` scales every advance, the space's among them, the italic corrections and the
 * slant, and its letterspacing, in scaled points, goes after each glyph of a word but its last and
 * into `\fontdimen2`, whose stretch and shrink are of both. The breaker sets a box for each
 * character, so the letterspacing goes after every glyph and is taken out of the space's width,
 * which sets a word and the space after it as wide as XeTeX does, the last word of a line a
 * letterspace wider. XeTeX's `slant` moves no glyph and adds to `\fontdimen1`.
 *
 * A font loaded with features that substitute glyphs (`FieldFont.features`), as small capitals are
 * set with `smcp`, measures a character as the glyph they make of the one its character map gives
 * it (`NativeFontFile.substitute`), as XeTeX's shaping sets it, and so its hyphen (decision 0023).
 */
function nativeFace(
  font: NativePageFont,
  size: number,
  extend = 1,
  letterSpace = 0,
  slanted = 0,
  features: readonly string[] = [],
): Face {
  const { file } = font;
  const codeFor = (char: string) => {
    const glyph = file?.glyphFor(char);
    return glyph === undefined || features.length === 0 ? glyph : file?.substitute(glyph, features);
  };
  const scale = file === undefined ? 0 : (size * extend) / file.unitsPerEm;
  const space = Math.round((file?.spaceAdvance ?? 0) * scale) + letterSpace;
  const glue = {
    space: space - letterSpace,
    stretch: Math.trunc(space / 2),
    shrink: Math.trunc(space / 3),
    extraSpace: Math.trunc(space / 3),
  };
  return {
    codeFor,
    widthOf: (glyph) => Math.round((file?.advanceOf(glyph) ?? 0) * scale) + letterSpace,
    italicOf: (glyph) => {
      const past = (file?.boxOf(glyph)?.[2] ?? 0) - (file?.advanceOf(glyph) ?? 0);
      return past > 0 ? Math.round(past * scale) : 0;
    },
    slant: (file?.slant ?? 0) * extend + slanted,
    spaceGlue: () => glue,
    hyphenChar: codeFor("-") ?? -1,
  };
}

/** A font's face at the size the page uses it, by its kind. */
function faceOf({ font, size, extend, slant, letterSpace, features }: SizedFont): Face {
  const scaled = Math.round(size * PT);
  return font.kind === "native"
    ? nativeFace(font, scaled, extend, Math.round((letterSpace ?? 0) * PT), slant, features)
    : texFace(font, scaled);
}

/**
 * The breaker's face for a field: its letter font's (`texFace` or `nativeFace`, by the font's
 * kind). A character the letter font has no code for is measured in the first of `others`, the
 * field's other fonts, that has one, at the size the page uses it, as LaTeX takes `€`, `×` or `•`
 * from a companion font such as TS1, with that font's italic correction for a `\/` after it; the
 * browser draws such a character in its serif, a little off within the row but on the row TeX
 * puts it on. A font with no outlines has no codes, and what only it sets measures as nothing.
 */
export function faceFor(primary: SizedFont, others: readonly SizedFont[] = []): Face {
  const fallbacks = others
    .filter((other) => other.font !== primary.font || other.size !== primary.size)
    .map(faceOf);
  // The first of the other fonts that sets a character, and its code there.
  const fallbackFor = (char: string) => {
    for (const fallback of fallbacks) {
      const code = fallback.codeFor(char);
      if (code !== undefined) return { fallback, code };
    }
    return undefined;
  };
  return {
    ...faceOf(primary),
    fallbackWidth: (char) => {
      const found = fallbackFor(char);
      return found && found.fallback.widthOf(found.code);
    },
    fallbackItalic: (char) => {
      const found = fallbackFor(char);
      return found && found.fallback.italicOf(found.code);
    },
  };
}

/**
 * Where a field's first line starts on the page, in TeX points: its paragraph's left edge and the
 * line's indent, so that anything set before the field on that line lies between it and the
 * field's first glyph. `lines` are the paragraph's (`breakParams`), `hsize` its `\hsize`, in
 * scaled points.
 *
 * When the page shows the field's second line, the edge comes from it: a line after a paragraph's
 * first starts at the edge and its own indent, with nothing before the field's text, unless the
 * left skip stretches or shrinks, as in a centred paragraph, where no line starts at a fixed place.
 *
 * Otherwise the start is guessed from the baseline: the leftmost glyph or rule on it within the
 * first line's width before the field's first glyph, and never more than `\hsize` before it. That
 * remains approximate for a field shown on one line: a list's label hung in the margin, as
 * `itemize`'s bullet is on the baseline, is taken for the line's start, so the line is taken to be
 * shorter by the label's distance; an indent box, which draws nothing, is missed, so the line is
 * taken to be longer by `\parindent`; and a column to the left whose text shares the baseline
 * within reach is taken for the line's. Each matters only once the field grows past its line, and
 * the page that shows its second line then says where the edge is.
 */
export function lineStartOf(
  layout: FieldLayout,
  lines: readonly LineSpec[],
  hsize: number,
  leftSkip: Glue,
): number {
  const [first = { indent: 0, width: hsize }, second = first] = lines;
  const fixed = leftSkip.stretch === 0 && leftSkip.shrink === 0;
  if (layout.secondLine !== undefined && fixed)
    return layout.secondLine + (first.indent - second.indent) / PT;
  const reach = Math.min(first.width, hsize) / PT;
  const leftmost = layout.baseline.find((x) => x >= layout.x - reach);
  return Math.min(layout.x, leftmost ?? layout.x);
}

/**
 * How the overlay breaks a field: the face, the parameters, none for a field on one row, and the
 * case the page folds the field to, which the overlay measures and shows it in (`shownCase`).
 */
export interface Setting {
  face: Face;
  params: BreakParams | undefined;
  folded?: Fold;
}

/** Fields whose paragraph special could not be read, which the console has heard of. */
const unread = new Set<string>();

/**
 * How the overlay sets a field on a page: the face of its fonts, and the breaker's parameters
 * from its paragraph special, the first line shortened by however far into it the field starts
 * (`lineStartOf`). A field TeX never breaks (`inner`) has no parameters. Without a special it can
 * read, a field breaks by LaTeX's defaults over the width the page suggests, its line's start
 * taken as the margin on both sides, and the console hears of it once. A field the page folds to
 * a case is set in it (`FieldLayout.folded`).
 */
export function settingFor(id: string, layout: FieldLayout, pageWidth: number): Setting {
  const face = faceFor(layout, layout.fonts);
  const { folded } = layout;
  const paragraph = layout.paragraph === undefined ? undefined : parseParagraph(layout.paragraph);
  if (paragraph?.inner) return { face, params: undefined, folded };
  const into = (start: number) => Math.round((layout.x - start) * PT);
  if (paragraph !== undefined) {
    const params = breakParams(paragraph);
    const start = lineStartOf(layout, params.lines, paragraph.hsize, paragraph.leftSkip);
    return { face, params: startingAt(params, into(start)), folded };
  }
  if (!unread.has(id)) {
    unread.add(id);
    console.warn(`The paragraph of ${id} could not be read, so it breaks by LaTeX's defaults`, {
      special: layout.paragraph,
    });
  }
  const start = lineStartOf(layout, [], Math.round(pageWidth * PT), ZERO_GLUE);
  const width = Math.max(0, Math.round((pageWidth - 2 * start) * PT));
  return {
    face,
    params: startingAt({ ...LATEX_PARAMS, lines: [{ indent: 0, width }] }, into(start)),
    folded,
  };
}

/** A month as `<input type="month">` reads and writes it, and a date stored as a year. */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;

/**
 * The command a date picker sends for what it shows: a start, and an end that is any date the
 * model takes, a month or a year, or `"present"`, or none. An end stored as a year, as the sample's
 * is, stays as it is when the start changes, though a month input cannot show it. A start the
 * model refuses, as an emptied input gives, sends nothing, since dates need one; an end the model
 * refuses is no end date.
 */
export function datesCommand(
  field: string,
  start: string,
  end: string | undefined,
): Command | undefined {
  if (!YearMonth.safeParse(start).success) return undefined;
  const dates: Dates =
    end === "present" || (end !== undefined && YearMonth.safeParse(end).success)
      ? { start, end }
      : { start };
  return { type: "dates", field, dates };
}

/**
 * Whether an open field closes because of what the document and the latest page hold: only when
 * the document no longer has the field, as after the panel removes its node. A page without the
 * field says nothing of the kind, since it may be the compile of older text than the overlay
 * holds. The reviewers' case: the user selects a bullet's text, deletes it, and types its
 * replacement while the empty text compiles; the page for the empty text lands, and Jake's
 * template leaves an empty field out, as it does every one of the sample's 30 text and rich fields
 * once emptied, so the page has no glyph of the bullet. Had the overlay closed then, what the user
 * typed next would have gone nowhere, and after a longer pause the emptied field would have had
 * no glyph left to click. Escape and a blur close it too, through its own handlers.
 */
export function shouldClose(documentHasField: boolean, _pageHasField: boolean): boolean {
  return !documentHasField;
}

/**
 * Where an open field is set: its layout and baselines on the last page that showed it, and that
 * page's width, which a field whose paragraph cannot be read breaks within.
 */
export interface Placement {
  layout: FieldLayout;
  /** The baselines the field's lines sit on, down that page, in TeX points. */
  baselines: number[];
  pageWidth: number;
}

/**
 * The baselines a field's lines sit on, down a page, in TeX points: for each character, the
 * lowest glyph that draws it, so that an accent TeX raised over its letter is not taken for a line.
 */
function baselinesOf(page: DrawnPage, id: string): number[] {
  const lowest = new Map<number, number>();
  for (const glyph of page.glyphs)
    if (glyph.field === id && glyph.offset !== undefined)
      lowest.set(glyph.offset, Math.max(glyph.y, lowest.get(glyph.offset) ?? glyph.y));
  return [...new Set(lowest.values())].sort((a, b) => a - b);
}

/**
 * Where an open field is set once the page `latest` arrives: from `latest` when it shows the
 * field, and otherwise where it was, `previous`, so that the overlay keeps its place and size and
 * stays editable until a page shows the field again, and that page places it anew. The first
 * placement is the page the overlay opened on, which the click landed on; it is undefined only
 * while no page since the overlay opened has shown the field with a font that loaded.
 */
export function placementFor(
  id: string,
  latest: DrawnPage,
  previous: Placement | undefined,
): Placement | undefined {
  const layout = latest.fields.get(id)?.layout;
  if (layout === undefined) return previous;
  return { layout, baselines: baselinesOf(latest, id), pageWidth: latest.size.width };
}

/** An edit of a field's text, and where the caret goes after it. */
export interface Edit {
  text: string;
  offset: number;
}

/** The characters a user sees, which Backspace and Delete take one at a time. */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The text with the span from `from` to `to` deleted, and the caret where it was. */
export function deleteRange(text: string, from: number, to: number): Edit {
  const start = Math.max(0, Math.min(from, to, text.length));
  const end = Math.max(start, Math.min(Math.max(from, to), text.length));
  return { text: text.slice(0, start) + text.slice(end), offset: start };
}

/**
 * The text with the character before `offset` deleted, as Backspace does, or the one after it, as
 * Delete does: a whole grapheme cluster, such as an emoji with its modifiers or a letter with its
 * combining marks. The caret goes where the character was; at either end of the text nothing is
 * deleted.
 */
export function deleteAt(text: string, offset: number, direction: "backward" | "forward"): Edit {
  const at = Math.max(0, Math.min(offset, text.length));
  if (direction === "backward") {
    if (at === 0) return { text, offset: 0 };
    const before = GRAPHEMES.segment(text.slice(0, at)).containing(at - 1);
    return deleteRange(text, before?.index ?? at - 1, at);
  }
  const after = GRAPHEMES.segment(text.slice(at)).containing(0);
  return deleteRange(text, at, at + (after?.segment.length ?? 0));
}

export interface OverlayProps {
  /** The field's id, as the page's markers and the document's commands name it. */
  field: string;
  /** Where in the field's text the click landed, which the caret opens at. */
  offset: number;
  /** The document as it stands, whose text for the field the overlay opens with. */
  document: Document;
  /** The latest page, which the overlay takes its place and paragraph from. */
  shown: Shown;
  /** The element the page's SVG is drawn in, positioned, which the overlay is placed in. */
  page: HTMLElement;
  /**
   * The TeX Live fonts the page is drawn from, from which a rich field's editor loads the font of
   * a variant its page sets no glyph of (`namedVariants`); without them, such a variant is
   * measured in the field's letter font.
   */
  fonts?: FontLibrary;
  /** Each edit, as a command for the document. */
  onCommand: (command: Command) => void;
  onClose: () => void;
}

/**
 * A field opened for editing: the overlay for a text field, the rich editor for a rich one
 * (`RichOverlay`), and the picker for dates.
 */
export function Overlay(props: OverlayProps) {
  const { field: id, shown, onClose } = props;
  // What the field is and holds when it opens; after that the overlay's own text is the field's.
  const [opened] = useState(() => {
    const field = fieldsOf(props.document.resume).get(id);
    switch (field?.kind) {
      case "text":
        return { kind: field.kind, text: field.get(props.document.resume) ?? "" };
      case "rich":
        // The rich editor opens on the field's runs as the document holds them when it mounts.
        return { kind: field.kind };
      case "dates":
        return { kind: field.kind, dates: field.get(props.document.resume) };
      default:
        return undefined;
    }
  });
  // Where the field is set: on the page it opened on, then on each later page that shows it.
  const [placement, setPlacement] = useState(() => placementFor(id, shown.page, undefined));
  const [placedOn, setPlacedOn] = useState(shown);
  if (placedOn !== shown) {
    setPlacedOn(shown);
    setPlacement(placementFor(id, shown.page, placement));
  }
  const inDocument = useMemo(() => fieldsOf(props.document.resume).has(id), [props.document, id]);
  const onPage = shown.page.fields.get(id)?.layout !== undefined;
  const closing = opened === undefined || shouldClose(inDocument, onPage);
  useEffect(() => {
    if (closing) onClose();
  }, [closing, onClose]);
  if (opened === undefined || closing || placement === undefined) return null;
  if (opened.kind === "dates")
    return <DatePicker {...props} placement={placement} dates={opened.dates} />;
  if (opened.kind === "rich") return <RichField {...props} placement={placement} />;
  return <TextOverlay {...props} placement={placement} text={opened.text} />;
}

/** The web font a field is set in, and the page font it was built from. */
interface Ready {
  font: LayoutFont;
  /** The CSS font family to set the rows in. */
  family: string;
}

/** Fonts whose web font the browser refused, which the console has heard of. */
const refused = new Set<string>();

/**
 * The CSS font family for a page font once its web font is registered: one built from a TeX font's
 * outlines, or a native font's own file, or the browser's serif for a font the page cannot draw or
 * whose web font the browser refuses, so that the field can still be edited, set as the page is
 * not.
 */
function webFamily(font: LayoutFont): Promise<string> {
  const build = () => (font.kind === "native" ? nativeWebFontOf(font) : webFontOf(font));
  return registerWebFont(font.name, build).then(
    () => `${cssString(webFontFamily(font.name))}, serif`,
    (error: unknown) => {
      if (!refused.has(font.name)) {
        refused.add(font.name);
        console.warn(`The overlay cannot set ${font.name} in its own glyphs`, error);
      }
      return "serif";
    },
  );
}

/**
 * The web font for the font a field is set in, once it is registered (`webFamily`). Until the first
 * is, there is none; a later font keeps the one before until it is ready, so that the rows never go
 * blank.
 */
function useWebFont(font: LayoutFont): Ready | undefined {
  const [ready, setReady] = useState<Ready>();
  useEffect(() => {
    let live = true;
    webFamily(font).then((family) => {
      if (live) setReady({ font, family });
    });
    return () => {
      live = false;
    };
  }, [font]);
  return ready;
}

/**
 * The web fonts for the fonts a rich field is set in, their CSS families by TeX font name, each
 * added once it is registered (`webFamily`) and kept while the field is open.
 */
function useWebFonts(fonts: readonly LayoutFont[]): ReadonlyMap<string, string> {
  const [families, setFamilies] = useState<ReadonlyMap<string, string>>(() => new Map());
  useEffect(() => {
    let live = true;
    for (const font of fonts)
      webFamily(font).then((family) => {
        if (live)
          setFamilies((before) =>
            before.get(font.name) === family ? before : new Map(before).set(font.name, family),
          );
      });
    return () => {
      live = false;
    };
  }, [fonts]);
  return families;
}

/** A CSS string holding `text`. */
const cssString = (text: string) => `"${text.replace(/["\\]/g, "\\$&")}"`;

/**
 * Where the rows go and how big they are on the page as shown: the page's SVG is scaled to its
 * container, so its current transformation matrix gives the scale and offset, as in the spike.
 */
interface Frame {
  setting: Setting;
  family: string;
  /** The rows' `font-feature-settings` (`featureSettings`). */
  features: string;
  /** The first row's top left, in CSS pixels in the page's container. */
  left: number;
  top: number;
  fontPx: number;
  lineHeightPx: number;
  /** CSS pixels per scaled point. */
  pxPerSp: number;
  /**
   * Where each line starts from the first line's start, and how wide it is, in pixels; the last
   * repeats.
   */
  indents: number[];
  widths: number[];
  /**
   * All of the above as one string, which a new page gives again when it leaves the field where
   * it was, as it mostly does, so the rows need not be drawn again and the selection is kept.
   */
  key: string;
}

/**
 * The frame for a field placed in `container`: its first row's baseline and left edge on its first
 * glyph's, the font's size scaled as the page is, and the line height the page's baselines give
 * when the field has two lines or more, else 1.2 em. The first row is as wide as the field's
 * first line, the measure TeX breaks it at, so a line TeX would fill is not cut short. The
 * baseline sits where the web font's ascent and descent put it in a row of that height, as a
 * browser lays out a line.
 */
function frameOf(
  container: HTMLElement,
  id: string,
  placement: Placement,
  ready: Ready,
): Frame | undefined {
  const ctm = container.querySelector("svg")?.getScreenCTM();
  if (!ctm) return undefined;
  const { layout, baselines, pageWidth } = placement;
  const scale = ctm.a;
  const at = new DOMPoint(layout.x, layout.y).matrixTransform(ctm);
  const box = container.getBoundingClientRect();
  const fontPx = layout.size * scale;
  const [first, second] = baselines;
  const lineHeightPx =
    first !== undefined && second !== undefined ? (second - first) * scale : 1.2 * fontPx;
  // The leading is shared above and below the font's ascent and descent, which the baseline is
  // between.
  const { ascent, descent } = webFontMetrics(ready.font);
  const baseline = (lineHeightPx - (ascent + descent) * fontPx) / 2 + ascent * fontPx;
  const setting = settingFor(id, { ...layout, font: ready.font }, pageWidth);
  const lines = setting.params?.lines ?? [];
  const pxPerSp = scale / PT;
  const start = lines[0]?.indent ?? 0;
  const frame = {
    setting,
    family: ready.family,
    features: featureSettings(layout.features),
    left: at.x - box.left - container.clientLeft + container.scrollLeft,
    top: at.y - baseline - box.top - container.clientTop + container.scrollTop,
    fontPx,
    lineHeightPx,
    pxPerSp,
    indents: lines.map((line) => (line.indent - start) * pxPerSp),
    widths: lines.map((line) => line.width * pxPerSp),
  };
  const { setting: _, ...placed } = frame;
  const key = JSON.stringify([
    placed,
    setting.params,
    setting.folded,
    ready.font.name,
    layout.size,
  ]);
  return { ...frame, key };
}

/** What a field's text holds in place of a line break: a space, as the generator makes one. */
const LINE_BREAKS = /\r\n|[\t\n\r\u2028\u2029]/g;

/**
 * Inputs the overlay does not take: a new paragraph or line, which a field cannot hold;
 * formatting, which a plain field has none of; and the browser's undo and redo, which its menu
 * still gives, since its record of the rows is wrong: the app's own take the keys (item 12).
 */
const REFUSED = /^(insertParagraph|insertLineBreak|format|history)/;

/**
 * The overlay's rows in the DOM, drawn by hand rather than by React, since the browser edits them
 * too: the field's text broken as TeX will break it, one `<div>` per line.
 */
class FieldRows {
  private rows: Row[] = [];
  private frame: Frame | undefined;

  constructor(
    private readonly element: HTMLDivElement,
    public text: string,
  ) {}

  /**
   * Take a frame, from a new page or font, and draw the rows in it with the caret put at `caret`;
   * a frame the rows are already in changes nothing.
   */
  place(frame: Frame, caret: number | undefined) {
    if (this.frame?.key === frame.key) return;
    this.frame = frame;
    const width = frame.widths[0];
    Object.assign(this.element.style, {
      left: `${frame.left}px`,
      top: `${frame.top}px`,
      width: width === undefined ? "max-content" : `${width}px`,
      fontFamily: frame.family,
      fontFeatureSettings: frame.features,
      fontSize: `${frame.fontPx}px`,
      lineHeight: `${frame.lineHeightPx}px`,
      textTransform: textTransform(frame.setting.folded),
    });
    this.draw(caret);
  }

  /**
   * Take the text the browser left in the rows, draw it broken anew with the caret where it was,
   * and say whether it changed. The rows tile the text, so joining what they hold loses nothing.
   */
  update(): boolean {
    const caret = this.caret();
    const text = [...this.element.childNodes]
      .map((node) => node.textContent ?? "")
      .join("")
      .replace(LINE_BREAKS, " ");
    const changed = text !== this.text;
    this.text = text;
    this.draw(caret);
    return changed;
  }

  /**
   * Make a deletion the browser would get wrong, before it does, and say whether it did; the
   * caller then prevents the browser's own. The rows are `<div>`s with nothing between them, so
   * at a row's edge, Backspace at the start of a row after the first or Delete at the end of one
   * before the last, the browser joins the two rows' elements and deletes no character, and the
   * rows come back as they were; and a selection across rows it deletes by joining elements too.
   * Here the character before or after the caret, or the selection, leaves the text instead, the
   * rows are drawn anew and the caret put where the deletion was.
   */
  remove(inputType: string): boolean {
    const selection = document.getSelection();
    if (!selection?.anchorNode || !selection.focusNode) return false;
    const anchor = this.offsetOf(selection.anchorNode, selection.anchorOffset);
    const focus = this.offsetOf(selection.focusNode, selection.focusOffset);
    if (anchor === undefined || focus === undefined) return false;
    let edit: Edit | undefined;
    if (!selection.isCollapsed) {
      const across =
        this.rowOfNode(selection.anchorNode, selection.anchorOffset) !==
        this.rowOfNode(selection.focusNode, selection.focusOffset);
      if (across) edit = deleteRange(this.text, anchor, focus);
    } else if (this.rows.some((row, i) => i > 0 && row.from === focus)) {
      if (inputType.endsWith("Backward")) edit = deleteAt(this.text, focus, "backward");
      else if (inputType.endsWith("Forward")) edit = deleteAt(this.text, focus, "forward");
    }
    if (edit === undefined) return false;
    this.text = edit.text;
    this.draw(edit.offset);
    return true;
  }

  /** Where the caret is in the text, or undefined when the selection is not in the rows. */
  caret(): number | undefined {
    const selection = document.getSelection();
    return selection?.focusNode
      ? this.offsetOf(selection.focusNode, selection.focusOffset)
      : undefined;
  }

  /** Put the caret at an offset in the text. */
  put(offset: number) {
    const { row, column } = rowOf(this.rows, Math.min(offset, this.text.length));
    const line = this.element.children[row];
    const node = line?.firstChild;
    if (!line) return;
    if (node instanceof Text)
      document.getSelection()?.collapse(node, Math.min(column, node.length));
    else document.getSelection()?.collapse(line, 0);
  }

  /** The offset in the text of a point in the DOM, or undefined when it is not in the rows. */
  private offsetOf(node: Node, offset: number): number | undefined {
    if (!this.element.contains(node)) return undefined;
    const before = document.createRange();
    before.setStart(this.element, 0);
    before.setEnd(node, offset);
    return before.toString().length;
  }

  /** The row element a point in the DOM is in. */
  private rowOfNode(node: Node, offset: number): Node | undefined {
    if (node === this.element)
      return this.element.childNodes[Math.min(offset, this.element.childNodes.length - 1)];
    let at: Node | null = node;
    while (at && at.parentNode !== this.element) at = at.parentNode;
    return at ?? undefined;
  }

  private draw(caret: number | undefined) {
    const frame = this.frame;
    if (!frame) return;
    let rows: Row[];
    const { face, params, folded } = frame.setting;
    try {
      rows = layoutRows(this.text, face, params, folded);
    } catch (error) {
      // The breaker refuses only a font or parameters no real paragraph has; one row still edits.
      console.warn("The overlay could not break the field's lines", error);
      rows = layoutRows(this.text, face, undefined);
    }
    this.rows = rows;
    this.element.replaceChildren(...rows.map((row, i) => this.line(row, i, frame)));
    if (caret !== undefined) this.put(caret);
  }

  /** One row's element: its text, or a line break to hold the caret when it has none. */
  private line(row: Row, index: number, frame: Frame): HTMLDivElement {
    const line = document.createElement("div");
    const text = this.text.slice(row.from, row.to);
    line.append(text === "" ? document.createElement("br") : text);
    const indent = frame.indents[Math.min(index, frame.indents.length - 1)];
    const width = frame.widths[Math.min(index, frame.widths.length - 1)];
    Object.assign(line.style, {
      height: `${frame.lineHeightPx}px`,
      marginLeft: `${indent ?? 0}px`,
      width: width === undefined ? "" : `${width}px`,
      wordSpacing: `${row.wordSpacingSp * frame.pxPerSp}px`,
      background: "#fff",
    });
    return line;
  }
}

/** How the overlay looks, apart from where it is and the font, which the page decides. */
const OVERLAY_STYLE = {
  position: "absolute",
  zIndex: "1",
  margin: "0",
  padding: "0",
  border: "0",
  outline: "1px solid #0a7",
  outlineOffset: "1px",
  whiteSpace: "pre",
  fontWeight: "normal",
  fontStyle: "normal",
  fontKerning: "none",
  fontVariantLigatures: "none",
  fontSynthesis: "none",
  letterSpacing: "0",
  textTransform: "none",
  textAlign: "left",
  color: "#000",
} as const;

type OpenProps = OverlayProps & { placement: Placement };

function TextOverlay(props: OpenProps & { text: string }) {
  const ready = useWebFont(props.placement.layout.font);
  if (!ready) return null;
  return <Rows {...props} ready={ready} />;
}

function Rows({
  field: id,
  offset,
  shown,
  page,
  placement,
  text,
  ready,
  onCommand,
  onClose,
}: OpenProps & { text: string; ready: Ready }) {
  const box = useRef<HTMLDivElement>(null);
  const rows = useRef<FieldRows | undefined>(undefined);
  const latest = useRef({ onCommand, onClose });
  useLayoutEffect(() => {
    latest.current = { onCommand, onClose };
  });

  // The rows and what the browser does to them, from when they first appear to when they close.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    Object.assign(element.style, OVERLAY_STYLE);
    const editing = new FieldRows(element, text);
    rows.current = editing;
    const send = () => latest.current.onCommand({ type: "text", field: id, text: editing.text });
    const edited = () => {
      if (editing.update()) send();
    };
    const listeners: [string, (event: Event) => void][] = [
      [
        "input",
        (event) => {
          // An input method composing a character edits the rows until it is done.
          if (!(event as InputEvent).isComposing) edited();
        },
      ],
      ["compositionend", edited],
      [
        "beforeinput",
        (event) => {
          const { inputType, isComposing } = event as InputEvent;
          if (REFUSED.test(inputType)) event.preventDefault();
          else if (inputType.startsWith("delete") && !isComposing && editing.remove(inputType)) {
            event.preventDefault();
            send();
          }
        },
      ],
      [
        "paste",
        (event) => {
          event.preventDefault();
          const pasted = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
          document.execCommand("insertText", false, pasted.replace(LINE_BREAKS, " "));
        },
      ],
      [
        "keydown",
        (event) => {
          const { key } = event as KeyboardEvent;
          if (key === "Enter") event.preventDefault();
          if (key === "Escape") {
            event.preventDefault();
            latest.current.onClose();
          }
        },
      ],
      ["blur", () => latest.current.onClose()],
    ];
    for (const [type, listener] of listeners) element.addEventListener(type, listener);
    return () => {
      for (const [type, listener] of listeners) element.removeEventListener(type, listener);
      rows.current = undefined;
    };
  }, [id, text]);

  // Placed on the page as it is shown now, and again with each new page, which draws its SVG anew,
  // or font. The first time, the caret goes where the click landed; after that it stays where the
  // user left it.
  const placed = useRef(false);
  useLayoutEffect(() => {
    const editing = rows.current;
    const element = box.current;
    if (!editing || !element) return;
    const frame = frameOf(page, id, placement, ready);
    if (!frame) return;
    if (placed.current) {
      editing.place(frame, document.activeElement === element ? editing.caret() : undefined);
      return;
    }
    placed.current = true;
    editing.place(frame, undefined);
    element.focus({ preventScroll: true });
    editing.put(offset);
  }, [page, shown, id, placement, ready, offset]);

  return (
    <div
      ref={box}
      className="overlay"
      role="textbox"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
    />
  );
}

/**
 * A rich field opened in the rich editor (`RichOverlay`), placed on the page as a plain field is
 * (`frameOf`). Each variant of the field, bold and italic among them, is measured and drawn in the
 * font the page sets it in (`variantFontsOf`), read again from each page that shows the field; a
 * variant the page sets no glyph of in the font its family's names give (`namedVariants`), once
 * the tree has it; and else in the field's letter font, until a page sets it.
 *
 * The editor mounts once the letter font's web font is ready and stays mounted: when a page brings
 * a letter font the field has not had, as when the user makes most of it bold or picks another
 * font or size, the editor keeps the family it has until the new one is ready, since an editor
 * taken down would open again on what it was given and lose the edits since. For the same reason
 * it is given the field's runs as the document holds them, never as they were when clicked. Web
 * fonts are built for the page's variants, and for a named variant once a run is set in it.
 */
function RichField(props: OpenProps) {
  const { field: id, shown, page, placement, document, fonts: tree } = props;
  const { layout, pageWidth } = placement;
  const runs = useMemo(() => richRunsOf(document, id), [document, id]);
  const [variants, setVariants] = useState(
    () => variantFontsOf(shown.page, shown.document.resume, id) ?? new Map<Variant, FieldFont>(),
  );
  const [readFrom, setReadFrom] = useState(shown);
  if (readFrom !== shown) {
    setReadFrom(shown);
    const next = variantFontsOf(shown.page, shown.document.resume, id);
    if (next !== undefined) setVariants(next);
  }
  const [named, setNamed] = useState<ReadonlyMap<Variant, SizedFont>>(() => new Map());
  useEffect(() => {
    if (tree === undefined) return;
    let live = true;
    namedVariants(variants, layout, (name) => tree.load(name)).then((found) => {
      if (live) setNamed(found);
    });
    return () => {
      live = false;
    };
  }, [variants, layout, tree]);
  // The page's variants win over the names', which a later page may have outdated.
  const all = useMemo(
    () => new Map<Variant, SizedFont>([...named, ...variants]),
    [named, variants],
  );
  const used = useMemo(() => new Set(runs.map(variantOf)), [runs]);
  const fonts = useMemo(() => {
    const drawn = [...all].filter(([variant]) => variants.has(variant) || used.has(variant));
    return [...new Set([layout.font, ...drawn.map(([, each]) => each.font)])];
  }, [all, variants, used, layout]);
  const families = useWebFonts(fonts);
  // The letter font's family, or, while a new letter font's registers, the one the editor has.
  const [kept, setKept] = useState<string>();
  const ready = families.get(layout.font.name);
  if (ready !== undefined && ready !== kept) setKept(ready);
  const family = ready ?? kept;
  const setting = useMemo(() => settingFor(id, layout, pageWidth), [id, layout, pageWidth]);
  const faces = useMemo(() => richFaces(all, layout), [all, layout]);
  const rowsFor = useCallback(
    (runs: RichText) => richRows(runs, faces, setting.params, setting.folded),
    [faces, setting],
  );
  const looks = useMemo(() => {
    const looks = new Map<Variant, Look>();
    for (const [variant, font] of all) {
      const own = families.get(font.font.name);
      if (own !== undefined || variants.has(variant))
        looks.set(variant, {
          family: own ?? family ?? "serif",
          scale: font.size / layout.size,
          features: featureSettings(font.features),
        });
    }
    return looks;
  }, [all, variants, families, family, layout]);
  // A new function with each page, which draws its SVG anew, so that the editor measures again,
  // as the plain rows do.
  const measure = useCallback(
    () =>
      family === undefined
        ? undefined
        : frameOf(page, id, placement, { font: layout.font, family }),
    [page, shown, id, placement, layout, family],
  );
  if (family === undefined) return null;
  return (
    <RichOverlay
      key={id}
      field={id}
      offset={props.offset}
      runs={runs}
      family={family}
      looks={looks}
      folded={setting.folded}
      measure={measure}
      rowsFor={rowsFor}
      onCommand={props.onCommand}
      onClose={props.onClose}
    />
  );
}

/** A rich field's runs as a document holds them; none when it has no such field. */
function richRunsOf(document: Document, id: string): RichText {
  const field = fieldsOf(document.resume).get(id);
  return field?.kind === "rich" ? field.get(document.resume) : [];
}

/**
 * The picker a field's dates open: a month for the start, and for the end a month, the present,
 * or none. Each change is a `dates` command. A date stored as a year shows its year beside the
 * empty month, and stays as it is until a month is picked. It sits under the field's first glyph,
 * and closes on Escape, when focus leaves it, or at a click outside it.
 */
function DatePicker({
  field: id,
  shown,
  page,
  placement,
  dates,
  onCommand,
  onClose,
}: OpenProps & { dates: Dates | undefined }) {
  const [value, setValue] = useState(dates);
  const [place, setPlace] = useState<{ left: number; top: number }>();
  const root = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const latest = useRef(onClose);
  useLayoutEffect(() => {
    latest.current = onClose;
  });

  // Placed again with each new page, which draws its SVG anew.
  const { layout } = placement;
  useLayoutEffect(() => {
    const ctm = page.querySelector("svg")?.getScreenCTM();
    if (!ctm) return;
    const at = new DOMPoint(layout.x, layout.y).matrixTransform(ctm);
    const box = page.getBoundingClientRect();
    setPlace({
      left: at.x - box.left - page.clientLeft + page.scrollLeft,
      // Below the baseline by the font's descent and a little more.
      top: at.y + 0.35 * layout.size * ctm.a - box.top - page.clientTop + page.scrollTop,
    });
  }, [page, shown, layout]);

  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) latest.current();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  const send = (start: string, end: string | undefined) => {
    const command = datesCommand(id, start, end);
    if (command?.type !== "dates") return;
    setValue(command.dates);
    onCommand(command);
  };
  const start = value?.start ?? "";
  const end = value?.end;
  const month = (date: string | undefined) => (date !== undefined && MONTH.test(date) ? date : "");
  // A year a month input cannot show, beside it, so that the user sees it is there.
  const year = (date: string | undefined) =>
    date !== undefined && YEAR.test(date) ? <small> ({date})</small> : null;
  return (
    <div
      ref={root}
      className="date-picker"
      role="dialog"
      style={{
        position: "absolute",
        zIndex: 1,
        left: place?.left,
        top: place?.top,
        display: "flex",
        gap: "0.5em",
        alignItems: "center",
        padding: "0.4em 0.6em",
        background: "#fff",
        border: "1px solid #0a7",
        font: "13px system-ui, sans-serif",
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      onBlur={(event) => {
        // Focus that goes nowhere is a click, which the listener above judges: Safari focuses no
        // checkbox or button that is clicked, so a click on one inside would read as leaving.
        const next = event.relatedTarget;
        if (next instanceof Node && !root.current?.contains(next)) onClose();
      }}
    >
      <label>
        Start{" "}
        <input
          ref={first}
          type="month"
          value={month(start)}
          onChange={(event) => send(event.target.value, end)}
        />
        {year(start)}
      </label>
      <label>
        End{" "}
        <input
          type="month"
          value={month(end)}
          disabled={end === "present"}
          onChange={(event) => send(start, event.target.value || undefined)}
        />
        {year(end)}
      </label>
      <label>
        <input
          type="checkbox"
          checked={end === "present"}
          onChange={(event) => send(start, event.target.checked ? "present" : undefined)}
        />{" "}
        Present
      </label>
      <button type="button" disabled={end === undefined} onClick={() => send(start, undefined)}>
        No end date
      </button>
    </div>
  );
}
