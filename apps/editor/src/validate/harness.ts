/**
 * The validation harness: the one code path that checks a template package, as plan section 5.7
 * has it. CI runs it over every curated package with its invented sample (`validateCurated`,
 * which `harness.test.ts` calls), and the import pipeline's probe step (milestone 3) will run it
 * in the browser over a freshly inferred package. So it is a function of an engine session, the
 * fonts the page is drawn with, a package and a resume, and it reaches for neither Node nor the
 * browser: the caller brings the session and the fonts.
 *
 * It compiles the resume through the package as the editor does, twice, and reads the output
 * back as the page does. It reports rather than throws: each check that fails adds a finding, so
 * that CI names every check a package fails and the import step can say what is locked. Only a
 * failed dump or compile stops it, since nothing after either has anything to read. Findings are
 * for developers and CI, and may quote TeX's log, so the product never shows one to a user as it
 * is. The PDF (item 14) and the style controls (item 15) join the checks when they land.
 */

import type { Resume } from "@resume-tools/resume-model";
import { summariseLog } from "../engine/log";
import type { CompileResult, DumpResult, EngineSession } from "../engine/session";
import { type DrawnPage, drawPage } from "../page/draw";
import type { FontLibrary } from "../page/fonts";
import { CURATED } from "../templates/curated";
import { generateBody, generateFormat } from "../templates/generate";
import { type ControlValues, defaultControls, type TemplatePackage } from "../templates/package";
import { PARAGRAPH_MARKER } from "../templates/prelude";
import { type DviDocument, type PageItem, parseDvi } from "../tex/dvi";
import { alignGlyphs, collectFields, type Field, MARKER_BEGIN } from "../tex/fields";

/** The checks, in the order the harness makes them. */
export const CHECKS = [
  "dump",
  "compile",
  "converges",
  "pages",
  "fields",
  "alignment",
  "fonts",
  "special",
] as const;

export type Check = (typeof CHECKS)[number];

/** Something a check found wrong, and the field it concerns when it concerns one. */
export interface Finding {
  check: Check;
  message: string;
  field?: string;
}

/** What the harness found for a package and a resume. */
export interface Report {
  /** The package's id. */
  package: string;
  /** The name of the format the package dumps for the document's values. */
  format: string;
  /**
   * How long each pass took, in milliseconds, as the session timed them: the resume's compile,
   * two or three passes as a new document, then the same body's second compile, one pass when it
   * converges.
   */
  passes: number[];
  /** The pages the resume sets. */
  pages: number;
  /** The fields the page finds. */
  fields: number;
  /** Empty when the package passes every check. */
  findings: Finding[];
}

/**
 * The keys of the paragraph special, in the order decision 0007 gives them and `prelude.ts`
 * writes them, which item 9's overlay reads.
 */
const PARAGRAPH_KEYS = [
  "hsize",
  "leftskip",
  "rightskip",
  "parfillskip",
  "pretolerance",
  "tolerance",
  "emergencystretch",
  "hangindent",
  "hangafter",
  "parshape",
  "inner",
  "shape",
];

/**
 * Check a package by compiling a resume through it as the editor does, with the document's
 * control values, any left out being the package's defaults, and reading the output back as the
 * page does. The checks run in the order of `CHECKS`, and each that fails adds its findings; a
 * failed dump or compile ends the run.
 */
export async function validatePackage(
  session: EngineSession,
  fonts: FontLibrary,
  pkg: TemplatePackage,
  sample: Resume,
  values: ControlValues = {},
): Promise<Report> {
  const chosen: ControlValues = { ...defaultControls(pkg), ...values };
  const report: Report = {
    package: pkg.id,
    format: "",
    passes: [],
    pages: 0,
    fields: 0,
    findings: [],
  };
  const { findings } = report;

  // The generator throws for what it cannot render, such as a body past MAX_BODY or a font the
  // package no longer lists, and the session for a run the engine cannot finish; either is a
  // finding of the check it was making.
  const format = attempt(findings, "dump", () => generateFormat(pkg, chosen));
  if (format === undefined) return report;
  report.format = format.name;
  const dumped = attempt(findings, "dump", () =>
    session.dump(pkg.engine, format.name, format.preamble, format.files),
  );
  if (dumped === undefined) return report;
  findings.push(...checkDump(dumped));
  if (!dumped.ok) return report;

  // One job, named after the package. The dump has just replaced the job's format, so the first
  // compile starts it again as a new document, and the second reads what the first wrote.
  const compile = (latex: string) =>
    session.compile(pkg.engine, format.name, latex, { job: pkg.id, maxPasses: 3 });
  const body = attempt(findings, "compile", () => generateBody(pkg, sample, chosen));
  if (body === undefined) return report;
  const first = attempt(findings, "compile", () => compile(body.latex));
  if (first === undefined) return report;
  report.passes.push(...first.passes);
  findings.push(...checkCompile(first));
  const output = first.output;
  if (output === undefined) return report;

  const second = attempt(findings, "converges", () => compile(body.latex));
  if (second !== undefined) {
    report.passes.push(...second.passes);
    findings.push(...checkConverges(output, second));
  }

  // The output read without the fonts' widths, which only positions need: pages, markers and
  // specials are there whatever the fonts.
  const doc = parseDvi(output, () => undefined);
  const fields = fieldsOf(doc);
  report.pages = doc.pages.length;
  report.fields = fields.size;
  findings.push(...checkPages(doc));
  findings.push(...checkFields(fields, body.texts));
  // drawPage throws when a font's files cannot be read. The fonts check names the font, and a
  // page that cannot be drawn has no glyphs to align.
  let drawn: DrawnPage[] | undefined;
  let undrawn: string | undefined;
  try {
    drawn = await drawPages(output, fonts, body.texts, doc.pages.length);
  } catch (error) {
    undrawn = messageOf(error);
  }
  if (drawn !== undefined) findings.push(...checkAlignment(drawn, body.texts));
  findings.push(...(await checkFonts(fonts, doc, undrawn)));
  findings.push(...checkSpecial(doc));
  return report;
}

/**
 * `validatePackage` over every curated package with its invented sample, on the package's
 * defaults, in the order the packages were ported. CI runs it through `harness.test.ts`.
 */
export async function validateCurated(
  session: EngineSession,
  fonts: FontLibrary,
): Promise<Report[]> {
  const reports: Report[] = [];
  for (const { package: pkg, sample } of CURATED.values())
    reports.push(await validatePackage(session, fonts, pkg, sample));
  return reports;
}

/**
 * `dump`: the package's preamble, with its format-bound values filled in and the prelude after
 * it, dumps as a format under its name, with the package's files beside it. A failure means the
 * template cannot load at all: its preamble stops with an error, or needs a package or a file
 * that neither TeX Live nor the package holds. The finding is TeX's first error.
 */
function checkDump(dumped: DumpResult): Finding[] {
  if (dumped.ok) return [];
  return [{ check: "dump", message: dumped.error ?? "the preamble did not dump" }];
}

/**
 * `compile`: the body the generator makes from the resume compiles from the format with no error
 * in the log. A failure means the template's snippets do not fit its macros, or the resume
 * reaches something the template cannot set, such as an empty argument where a macro needs text.
 * The finding is TeX's first error.
 */
function checkCompile(result: CompileResult): Finding[] {
  const error = result.ok
    ? summariseLog(result.log).error
    : (result.error ?? "the body did not compile");
  return error === undefined ? [] : [{ check: "compile", message: error }];
}

/**
 * `converges`: the same body, compiled again in the same job, takes one pass and sets the same
 * output (`sameOutput`). The editor recompiles an open document in one pass, reading the
 * auxiliary files the compile before it wrote, so a template whose auxiliary files do not settle
 * shows a page that is wrong, or one that changes on a keystroke that changed nothing.
 */
function checkConverges(first: Uint8Array, second: CompileResult): Finding[] {
  if (second.output === undefined) {
    const error = second.error ?? "no output";
    return [{ check: "converges", message: `the same body does not compile again: ${error}` }];
  }
  const findings: Finding[] = [];
  const passes = second.passes.length;
  if (passes !== 1)
    findings.push({
      check: "converges",
      message: `the same body takes ${passes} passes to compile again, not one`,
    });
  if (!sameOutput(first, second.output))
    findings.push({ check: "converges", message: "the same body compiles again to other output" });
  return findings;
}

/**
 * `pages`: the resume sets exactly one page. Decision 0006 declares no page count and the editor
 * warns about a second page (item 14), so a failure means the template spills its sample onto a
 * page the editor would warn about. The other checks read every page all the same, so that a
 * spill is reported here and nowhere else.
 */
function checkPages(doc: DviDocument): Finding[] {
  const count = doc.pages.length;
  if (count === 1) return [];
  return [{ check: "pages", message: `the resume sets ${count} pages, not one` }];
}

/**
 * `fields`: every field the body marks reaches the page, where the page finds it with at least
 * one glyph, and the page finds no field the body does not mark. A field whose markers never
 * reach the page, as when a template sets it only in a box it measures, such as `\settowidth`'s,
 * or in a PDF string, cannot be clicked and so cannot be edited on the page, and nor can one
 * with no glyphs. A field the body does not mark is a template bug, such as a stray `\rtfield`.
 */
function checkFields(
  found: ReadonlyMap<string, Field>,
  texts: ReadonlyMap<string, string>,
): Finding[] {
  const findings: Finding[] = [];
  for (const id of texts.keys()) {
    const glyphs = found.get(id)?.glyphs.length;
    if (glyphs === undefined)
      findings.push({
        check: "fields",
        field: id,
        message: `the body marks ${id}, but its markers never reach the page`,
      });
    else if (glyphs === 0)
      findings.push({
        check: "fields",
        field: id,
        message: `${id} reaches the page with no glyphs`,
      });
  }
  for (const id of found.keys())
    if (!texts.has(id))
      findings.push({
        check: "fields",
        field: id,
        message: `the page marks ${id}, but the body does not`,
      });
  return findings;
}

/**
 * `alignment`: every glyph of every field matches a character of the field's text, as
 * `alignGlyphs` pairs them. A glyph that matches none leaves the editor unable to say which
 * character a click landed on: the template sets the field otherwise than the resume has it,
 * such as in capitals or with text of its own inside the markers, or from a font whose glyphs
 * the page cannot name. A field is checked where the page first finds it, the copy the user
 * edits; a field the body does not mark is the fields check's to report.
 */
function checkAlignment(
  pages: readonly DrawnPage[],
  texts: ReadonlyMap<string, string>,
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const page of pages)
    for (const field of page.fields.values()) {
      const text = texts.get(field.id);
      if (seen.has(field.id) || text === undefined) continue;
      seen.add(field.id);
      const unmatched = alignGlyphs(field, text);
      if (unmatched === 0) continue;
      const glyphs = `${unmatched} of the ${field.glyphs.length} glyphs of ${field.id}`;
      findings.push({
        check: "alignment",
        field: field.id,
        message: `${glyphs} match no character of its text`,
      });
    }
  return findings;
}

/**
 * `fonts`: every font the output uses can be drawn: TeX Live has its metrics, and outlines the
 * page draws as they are. A page the editor cannot draw is not a page it can edit, so a template
 * that needs a font the renderer does not handle yet, such as a re-encoded one (item 16), fails
 * here. Each font is loaded as drawPage loads it, so one whose files drawPage throws on, as it
 * does on the metrics of the TS1 fonts, which `tfm.ts` refuses (decision 0007), is named with
 * what went wrong. `undrawn` is what drawPage threw, reported only when no font accounts for it.
 * XeTeX's native fonts are not among them yet: the page draws them from item 21 on.
 */
async function checkFonts(
  fonts: FontLibrary,
  doc: DviDocument,
  undrawn: string | undefined,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const name of new Set([...doc.fonts.values()].map((font) => font.name))) {
    let problem: string | undefined;
    try {
      const font = await fonts.load(name);
      problem = font === undefined ? "TeX Live has no TFM for it" : font.missing;
    } catch (error) {
      problem = messageOf(error);
    }
    if (problem !== undefined)
      findings.push({ check: "fonts", message: `the page cannot draw ${name}: ${problem}` });
  }
  if (undrawn !== undefined && findings.length === 0)
    findings.push({ check: "fonts", message: `the page cannot be drawn: ${undrawn}` });
  return findings;
}

/**
 * `special`: each field's begin marker is followed directly by its paragraph special, with the
 * keys decision 0007 lists, in its order; the values are TeX's to measure. Item 9's overlay reads
 * the special to break a field's lines where TeX will, so a template that sets anything between
 * the two, or redefines what the prelude writes them with, leaves a field the overlay cannot set
 * as the page does. Every copy of a field is checked, and a field is reported once.
 */
function checkSpecial(doc: DviDocument): Finding[] {
  const findings: Finding[] = [];
  const reported = new Set<string>();
  for (const { items } of doc.pages)
    items.forEach((item, index) => {
      const id = begun(item);
      if (id === undefined || reported.has(id)) return;
      const problem = paragraphProblem(id, items[index + 1]);
      if (problem === undefined) return;
      reported.add(id);
      findings.push({ check: "special", field: id, message: problem });
    });
  return findings;
}

/**
 * What is wrong with the item after a field's begin marker, which should be the field's
 * paragraph special: `rt:p:<id>:` and the key=value pairs, joined by `;`. The id is read
 * case-insensitively, as the page reads the markers, since a template may set a field in
 * `\MakeUppercase`.
 */
function paragraphProblem(id: string, next: PageItem | undefined): string | undefined {
  const text = next?.kind === "special" ? next.text : "";
  if (!text.toLowerCase().startsWith(PARAGRAPH_MARKER))
    return `the begin marker of ${id} is not followed by its paragraph special`;
  const rest = text.slice(PARAGRAPH_MARKER.length);
  const colon = rest.indexOf(":");
  const owner = (colon < 0 ? rest : rest.slice(0, colon)).toLowerCase();
  if (owner !== id)
    return `the begin marker of ${id} is followed by the paragraph special of ${owner}`;
  const pairs = colon < 0 ? [] : rest.slice(colon + 1).split(";");
  const keys = pairs.map((pair) => pair.split("=", 1)[0] ?? "");
  const decided =
    keys.length === PARAGRAPH_KEYS.length && keys.every((key, i) => key === PARAGRAPH_KEYS[i]);
  if (!decided)
    return `the paragraph special of ${id} has the keys ${keys.join(", ")}, not decision 0007's`;
  return undefined;
}

/** The id a begin marker names, lowercased as `collectFields` reads it, or undefined. */
function begun(item: PageItem): string | undefined {
  if (item.kind !== "special") return undefined;
  const marker = item.text.slice(0, MARKER_BEGIN.length).toLowerCase();
  return marker === MARKER_BEGIN ? item.text.slice(MARKER_BEGIN.length).toLowerCase() : undefined;
}

/**
 * The fields the page finds, page by page: the first copy of each, as `collectFields` keeps it.
 * Which glyphs a field holds does not depend on the fonts, so the output is read without them.
 */
function fieldsOf(doc: DviDocument): Map<string, Field> {
  const fields = new Map<string, Field>();
  for (const page of doc.pages)
    for (const [id, field] of collectFields(page, () => undefined))
      if (!fields.has(id)) fields.set(id, field);
  return fields;
}

/** Every page of the output, drawn as the editor draws one. */
async function drawPages(
  dvi: Uint8Array,
  fonts: FontLibrary,
  texts: ReadonlyMap<string, string>,
  count: number,
): Promise<DrawnPage[]> {
  const pages: DrawnPage[] = [];
  for (let index = 0; index < count; index++) pages.push(await drawPage(dvi, fonts, texts, index));
  return pages;
}

/**
 * Whether two compiles set the same output: the same bytes, except the comment in the DVI's
 * preamble, which records the time of the run to the minute (` TeX output 2026.09.25:0738`), so
 * that two compiles either side of a minute differ there and nowhere else. The preamble is 15
 * bytes, the last of which gives the comment's length, followed by the comment.
 */
function sameOutput(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length || a[14] !== b[14]) return false;
  const after = 15 + (a[14] ?? 0);
  for (let i = 0; i < a.length; i++) if ((i < 15 || i >= after) && a[i] !== b[i]) return false;
  return true;
}

/** What `step` returns, or undefined, with a finding of `check` saying what it threw. */
function attempt<T>(findings: Finding[], check: Check, step: () => T): T | undefined {
  try {
    return step();
  } catch (error) {
    findings.push({ check, message: messageOf(error) });
    return undefined;
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
