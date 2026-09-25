/**
 * Fit to one page (item 18): the short search plan section 5.4 describes, for a document whose
 * page runs onto a second. It steps the controls that change how much fits, each by one step in
 * turn: the density one step tighter, then the margins a tenth of an inch narrower, then the font
 * size half a point smaller, and round again while any of them has a step left. Each setting is
 * compiled in the worker (`Compiler.tryControls`), and the search stops at the first that sets one
 * page. Each setting is a step further than the one before, so the first that fits is the least
 * change this order allows, and the ranges are fixed, so the search is short: two steps of density
 * at most, six of margins and six of font size.
 *
 * What it finds becomes one step of the document's history (`applyFit`), a control command for
 * each control it changed, so that one undo takes them all back; nothing else in the document
 * changes.
 */

import { type ControlValues, defaultControls, type TemplatePackage } from "../templates/package";
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
 * The narrowest margins and a margin's step, in inches, and the smallest font size and a size's
 * step, in points: the ranges of plan section 5.4, which the package schema holds values to.
 */
const MARGINS = { least: 0.4, step: 0.1 } as const;
const FONT_SIZES = { least: 9, step: 0.5 } as const;

/**
 * Margins go in tenths of an inch, so that 0.8 less 0.1 is 0.7 and not 0.7000000000000001, and
 * steps from 1 inch end at 0.4 rather than at 0.40000000000000013, a step short of the least.
 */
const tenths = (inches: number) => Math.round(inches * 10) / 10;

/**
 * The settings the search tries, in order, each a step further than the one before, starting from
 * the document's own values with the package's defaults filled in: the density one step tighter,
 * relaxed to normal and normal to compact; then the margins 0.1 inch narrower; then the font size
 * 0.5 point smaller; then each of the three again that has a step left, until every one of them
 * the package offers is at its least. A control the package does not offer is skipped, and every
 * other control stays as it is. Each setting holds a value for every control the package offers.
 */
export function fitSteps(pkg: TemplatePackage, values: ControlValues): ControlValues[] {
  const { density, margins, fontSize } = pkg.controls;
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
      take({ ...at, margins: tenths(at.margins - MARGINS.step) });
    if (fontSize && at.fontSize !== undefined && at.fontSize > FONT_SIZES.least)
      take({ ...at, fontSize: at.fontSize - FONT_SIZES.step });
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
 */
export async function fit(
  compiler: Trier,
  pkg: TemplatePackage,
  doc: Document,
): Promise<Fitted | undefined> {
  let tried = 0;
  for (const values of fitSteps(pkg, doc.controls)) {
    if (compiler.document !== doc) return undefined;
    const pages = await compiler.tryControls(values);
    tried++;
    if (compiler.document !== doc) return undefined;
    if (pages === 1) return { values, tried };
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
