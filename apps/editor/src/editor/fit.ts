/**
 * Fit to one page (item 18): the short search plan section 5.4 describes, for a document whose
 * page runs onto a second. It steps the controls that change how much fits, each by one step in
 * turn: the density one step tighter, then the margins a tenth of an inch narrower, then the font
 * size one size smaller, half a point or the next size an imported class declares, and round again
 * while any of them has a step left. Each setting is
 * compiled in the worker (`Compiler.tryControls`), and the search stops at the first that sets one
 * page. Each setting is a step further than the one before, so the first that fits is the least
 * change this order allows, and the ranges are fixed, so the search is short: two steps of density
 * at most, six of margins and six of font size. A margins step that sets more pages than the
 * setting before it is not taken (`fit`), since an imported template's margins control sets one
 * margin on every side, which can widen a side the document had narrower (decision 0040).
 *
 * What it finds becomes one step of the document's history (`applyFit`), a control command for
 * each control it changed, so that one undo takes them all back; nothing else in the document
 * changes.
 */

import {
  type ControlValues,
  defaultControls,
  fontSizes,
  type TemplatePackage,
} from "../templates/package";
import type { Compiler } from "./compiler";
import type { Document, History } from "./document";

/** What the search needs of the compiler: its open document, and a trial of other values. */
export type Trier = Pick<Compiler, "document" | "tryControls">;

/** What a fit found: the first values that set one page, and how many settings it compiled. */
export interface Fitted {
  values: ControlValues;
  tried: number;
}

type Density = NonNullable<ControlValues["density"]>;

/** Each density one step tighter; compact is the tightest. */
const TIGHTER: Readonly<Record<Density, Density | undefined>> = {
  relaxed: "normal",
  normal: "compact",
  compact: undefined,
};

/**
 * A control's range: its least and most values, and how many steps it takes to the unit, which
 * makes its grid.
 */
interface Range {
  least: number;
  most: number;
  perUnit: number;
}

/**
 * The margins, from 0.4 to 1 inch in tenths: the range of plan section 5.4, which the package
 * schema holds values to. The font sizes are the package's own (`fontSizes`).
 */
const MARGINS: Range = { least: 0.4, most: 1, perUnit: 10 };

/**
 * One step below `value` in `range`, counted in steps rather than in units, so that 0.8 inch less a
 * tenth is 0.7 and not 0.7000000000000001, and steps from 1 inch end at 0.4 rather than at
 * 0.40000000000000013, a step short of the least. A value off the grid, which no document holds
 * since the schema refuses it, steps onto the grid, and no step leaves the range.
 */
function stepBelow({ least, most, perUnit }: Range, value: number): number {
  return Math.min(most, Math.max(least, Math.round(value * perUnit - 1) / perUnit));
}

/**
 * The settings the search tries, in order, each a step further than the one before, starting from
 * the document's own values with the package's defaults filled in: the density one step tighter,
 * relaxed to normal and normal to compact; then the margins 0.1 inch narrower; then the font size
 * the next size smaller the package offers, 0.5 point smaller or, for a class that declares whole
 * sizes alone, a point (`fontSizes`); then each of the three again that has a step left, until
 * every one of them the package offers is at its least. A control the package does not offer is
 * skipped, and so are the margins where `options.margins` is false; every other control stays as
 * it is. Each setting holds a value for every control the package offers. Every value a step makes
 * is one the package takes (`stepBelow`, `fontSizes`); a value a setting keeps from the document
 * is as the document has it.
 */
export function fitSteps(
  pkg: TemplatePackage,
  values: ControlValues,
  options: { margins?: boolean } = {},
): ControlValues[] {
  const { density, fontSize } = pkg.controls;
  const margins = options.margins === false ? undefined : pkg.controls.margins;
  const sizes = fontSizes(pkg);
  const steps: ControlValues[] = [];
  let at: ControlValues = { ...defaultControls(pkg), ...values };
  const take = (next: ControlValues) => {
    at = next;
    steps.push(next);
  };
  for (let stepped = true; stepped; ) {
    const before = steps.length;
    const tighter = at.density && TIGHTER[at.density];
    if (density && tighter) take({ ...at, density: tighter });
    if (margins && at.margins !== undefined && at.margins > MARGINS.least)
      take({ ...at, margins: stepBelow(MARGINS, at.margins) });
    const size = at.fontSize;
    const smaller = size === undefined ? undefined : sizes.filter((each) => each < size).at(-1);
    if (fontSize && smaller !== undefined) take({ ...at, fontSize: smaller });
    stepped = steps.length > before;
  }
  return steps;
}

/**
 * The first setting of `fitSteps` that sets the document on one page, and how many were compiled
 * to find it; undefined when none does. The compiler compiles its open document, which is `doc`
 * until an edit, an undo or another document opened replaces it; the search then stops early, with
 * undefined, since what fits the document before says nothing of the one after. A trial that fails
 * fails the fit.
 *
 * A margins step never lengthens the document by a page (decision 0040): an imported template's
 * margins control sets one margin on every side, so a step to less than the document's left margin
 * can still widen a narrower top one. A margins step that sets more pages than the setting before
 * it is not taken; the search goes on from that setting, stepping the margins no more. Where no
 * trial yet says how many pages the setting before a margins step sets, as before a first step of
 * margins, that setting is tried first, and where it already sets one page, it is what the fit
 * finds.
 */
export async function fit(
  compiler: Trier,
  pkg: TemplatePackage,
  doc: Document,
): Promise<Fitted | undefined> {
  let tried = 0;
  /** The pages a setting sets, or undefined where the document changed underneath the trial. */
  const pagesOf = async (values: ControlValues): Promise<number | undefined> => {
    if (compiler.document !== doc) return undefined;
    const pages = await compiler.tryControls(values);
    tried++;
    return compiler.document === doc ? pages : undefined;
  };
  let before: ControlValues = { ...defaultControls(pkg), ...doc.controls };
  let pagesBefore: number | undefined;
  let steps = fitSteps(pkg, doc.controls);
  for (let k = 0; k < steps.length; k++) {
    const values = steps[k] as ControlValues;
    const narrower = values.margins !== before.margins;
    if (narrower && pagesBefore === undefined) {
      pagesBefore = await pagesOf(before);
      if (pagesBefore === undefined) return undefined;
      if (pagesBefore === 1) return { values: before, tried };
    }
    const pages = await pagesOf(values);
    if (pages === undefined) return undefined;
    if (pages === 1) return { values, tried };
    if (narrower && pagesBefore !== undefined && pages > pagesBefore) {
      steps = [...steps.slice(0, k + 1), ...fitSteps(pkg, before, { margins: false })];
      continue;
    }
    before = values;
    pagesBefore = pages;
  }
  return undefined;
}

/** The history group a fit's commands go in, which makes them one step (`History.dispatch`). */
const FIT_GROUP = "fit";

/**
 * Make the values a fit found the controls of the history's present, as one step: a control
 * command for each of the three controls the search steps whose value the fit changed, in the
 * history group `fit`, with the step before ended first and this one ended after, so that one undo
 * takes every control back at once. Returns the new present.
 */
export function applyFit(history: History, pkg: TemplatePackage, values: ControlValues): Document {
  const from = { ...defaultControls(pkg), ...history.present.controls };
  history.seal();
  if (values.density !== from.density)
    history.dispatch({ type: "control", name: "density", value: values.density }, FIT_GROUP);
  if (values.margins !== from.margins)
    history.dispatch({ type: "control", name: "margins", value: values.margins }, FIT_GROUP);
  if (values.fontSize !== from.fontSize)
    history.dispatch({ type: "control", name: "fontSize", value: values.fontSize }, FIT_GROUP);
  history.seal();
  return history.present;
}
