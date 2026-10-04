/**
 * Latin Modern for an import set in Computer Modern's T1 or TS1 fonts (milestone 3 item 7,
 * decision 0026), as every pdfTeX port takes it (decision 0009). The page is drawn from the
 * fonts' outlines, and the tree has metrics and no outlines for Computer Modern in T1 and TS1, the
 * EC and TC fonts, which a document sets as soon as it loads `\usepackage[T1]{fontenc}`, or sets an
 * itemize bullet, `$`, `€` or `°` from TS1, as LaTeX 2023 does even in OT1 (decision 0008). Latin
 * Modern is Computer Modern's scalable successor, the same design, and the tree has its outlines.
 *
 * Right after the reference compile, before the signatures, the parse and the probe, a pdfTeX
 * document whose reference sets fonts the page cannot draw, all of them EC or TC fonts, is read
 * from then on with T1 and Latin Modern loaded right after its class, as the ports load them
 * (`LATIN_MODERN`), and its reference compiled again so: the probe then reads a page it can draw,
 * the assembly copies the two lines into the package's preamble with the rest of it, and the first
 * check holds the package to the original compiled with them. A document the page can draw, one
 * that already loads Latin Modern or another family with outlines among them, is untouched; one
 * with a font the page cannot draw that is no EC or TC font is left to the checks, which refuse it
 * naming the font; and one the lines leave a font the page cannot draw is refused, naming it.
 */

import type { EngineSession } from "../engine/session";
import type { FontLibrary } from "../page/fonts";
import { encodeLike, type Intake } from "./intake";
import { bodyOf } from "./parse";
import { type Reference, type ReferenceFonts, type ReferenceOptions, reference } from "./reference";
import { type Refusal, refusal } from "./refusal";
import { classEnd } from "./source";

/**
 * The lines a pdfTeX port loads right after its class (decision 0009), which an import set in
 * Computer Modern's T1 or TS1 fonts takes too.
 */
export const LATIN_MODERN = ["\\usepackage[T1]{fontenc}", "\\usepackage{lmodern}"] as const;

/** Computer Modern's fonts in T1 and TS1, the EC and TC fonts: `ecrm1000`, `tcbx1200`, `ectt0900`. */
const EC_OR_TC = /^(ec|tc)[a-z]{2,4}\d{4}$/;

/** Whether a TeX font is one of Computer Modern's in T1 or TS1, an EC or a TC font. */
export const isComputerModernT1 = (name: string) => EC_OR_TC.test(name);

/**
 * A preamble with Latin Modern in T1 loaded right after its `\documentclass`, as decision 0009's
 * ports load it (`LATIN_MODERN`), before anything the preamble loads that might set a font of its
 * own; undefined for one with no `\documentclass` to put it by.
 */
export function withLatinModern(preamble: string): string | undefined {
  const at = classEnd(preamble);
  if (at < 0) return undefined;
  const after = preamble[at] === "\n" ? "" : "\n";
  return `${preamble.slice(0, at)}\n${LATIN_MODERN.join("\n")}${after}${preamble.slice(at)}`;
}

/**
 * The fonts an output sets that the page cannot draw, in its order, but those the upload ships
 * aside, which the page reads from the upload's own files (decision 0019).
 */
export async function undrawableFonts(fonts: FontLibrary, set: ReferenceFonts): Promise<string[]> {
  const found: string[] = [];
  for (const name of set.tex) {
    if (set.shipped.includes(name)) continue;
    let missing: string | undefined;
    try {
      missing = (await fonts.load(name))?.missing;
    } catch {
      missing = "unreadable";
    }
    if (missing !== undefined) found.push(name);
  }
  return found;
}

/** An import read in Latin Modern: its main file with the lines, its reference, the fonts swapped. */
export interface InLatinModern {
  intake: Intake;
  reference: Reference;
  /** The fonts of the upload's reference that the page cannot draw, which the lines replaced. */
  swapped: string[];
}

/**
 * The import read in Latin Modern, where its reference, on pdfTeX, sets fonts the page cannot draw
 * and each is Computer Modern's in T1 or TS1: its main file with the lines right after its class
 * (`withLatinModern`), the rest of its bytes as they were, and its reference compiled again from
 * it, in the same job and with the same options; a refusal where that compile refuses, or where
 * it still sets a font the page cannot draw, naming the font. Undefined where nothing is swapped:
 * a XeTeX document, one the page can draw, one that sets a font the page cannot draw that is none
 * of those, which the checks refuse, and one with no `\documentclass` or body to find.
 */
export async function inLatinModern(
  session: EngineSession,
  fonts: FontLibrary,
  intake: Intake,
  made: Reference,
  options: ReferenceOptions = {},
): Promise<InLatinModern | Refusal | undefined> {
  if (made.engine !== "pdftex") return undefined;
  const swapped = await undrawableFonts(fonts, made.fonts);
  if (swapped.length === 0 || !swapped.every(isComputerModernT1)) return undefined;
  const body = bodyOf(intake);
  if ("refused" in body) return undefined;
  const preamble = withLatinModern(body.preamble);
  if (preamble === undefined) return undefined;
  const text = `${preamble}${intake.main.text.slice(body.preamble.length)}`;
  const bytes = encodeLike(intake.main.bytes, text) ?? new TextEncoder().encode(text);
  const read: Intake = { ...intake, main: { ...intake.main, text, bytes } };
  const again = await reference(session, fonts, read, options);
  if ("refused" in again) return again;
  const left = await undrawableFonts(fonts, again.fonts);
  if (left[0] !== undefined) return refusal("font", left[0]);
  return { intake: read, reference: again, swapped };
}
