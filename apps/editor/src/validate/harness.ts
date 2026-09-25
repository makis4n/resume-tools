/**
 * The validation harness: the one code path that checks a template package, as plan section 5.7
 * has it. CI runs it over every curated package with its invented sample (`validateCurated`,
 * which `harness.test.ts` calls), and the import pipeline's probe step (milestone 3) will run it
 * in the browser over a freshly inferred package. So it is a function of an engine session, the
 * fonts the page is drawn with, a package and a resume, and it reaches for neither Node nor the
 * browser: the caller brings the session and the fonts.
 *
 * It compiles the resume through the package as the editor does, twice, then once more after an
 * edit to every field, and reads the output back as the page does. It reports rather than throws:
 * each check that fails adds a finding, so that CI names every check a package fails and the
 * import step can say what is locked. Only a failed dump or compile stops it, since nothing after
 * either has anything to read. Findings are for developers and CI, and may quote TeX's log, so
 * the product never shows one to a user as it is. The PDF (item 14) and the style controls (item
 * 15) join the checks when they land.
 *
 * The harness cannot bound a compile itself. The engine runs TeX in one synchronous call, and
 * nothing else in its thread runs until the call returns, timers included, so a package whose TeX
 * never finishes never lets the harness return. The caller bounds it: CI through the check job's
 * time limit, and the browser (milestone 3) by running the session in a worker it can terminate,
 * as item 8's scheduler will.
 */

import type { Resume, RichText } from "@resume-tools/resume-model";
import { summariseLog } from "../engine/log";
import type { CompileResult, DumpResult, EngineSession } from "../engine/session";
import { glyphTextOf } from "../page/draw";
import type { FontLibrary, PageFont } from "../page/fonts";
import { CURATED } from "../templates/curated";
import { isBlank } from "../templates/escape";
import { generateBody, generateFormat } from "../templates/generate";
import { type ControlValues, defaultControls, type TemplatePackage } from "../templates/package";
import { PARAGRAPH_MARKER } from "../templates/prelude";
import { type DviDocument, type PageItem, parseDvi } from "../tex/dvi";
import {
  alignField,
  collectFields,
  type Field,
  type GlyphTextOf,
  INVISIBLE,
  MARKER_BEGIN,
  MARKER_END,
  markerId,
} from "../tex/fields";

/** The checks, in the order the harness makes them. */
export const CHECKS = [
  "dump",
  "compile",
  "converges",
  "edits",
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
   * two passes as a new document, or three when the log asks for a rerun; the same body's second
   * compile, one pass when it converges; then the edited resume's compile, one pass, as an edit
   * costs.
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
 * The job the editor compiles its document in, which the compile scheduler names in
 * `src/editor/compiler.ts`. TeX gives a document its job's name as `\jobname`, so the harness
 * compiles in the same job, or a package could set its fields one way for the harness and another
 * for the editor. Item 13, if it gives each open document a job of its own, has to keep the two
 * names the same.
 */
const EDITOR_JOB = "doc";

/**
 * The character `editEverything` puts at the end of a text field in place of its last one, and
 * the one it uses when the last already is that: a change the page shows, and one that keeps
 * the field's length, so that the edit cannot push a sample that nearly fills its page onto a
 * second one and be taken for a field one edit behind.
 */
const EDIT = ["x", "y"] as const;

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
 * What the page may leave out of a field's text without a glyph, and the aligner skips:
 * whitespace, the invisible characters, anything past ASCII, which pdfTeX drops where the font
 * has no glyph for it, and the underscore, which OT1 sets as a rule rather than a glyph. What is
 * left of a text without them is printable ASCII.
 */
const SETS_NO_GLYPH = new RegExp(`\\s|${INVISIBLE.source}|[^\\u0000-\\u007f]|_`, "gu");

/**
 * Check a package by compiling a resume through it as the editor does, with the document's
 * control values, any left out being the package's defaults, and reading the output back as the
 * page does. The checks run in the order of `CHECKS`, and each that fails adds its findings; a
 * failed dump or compile ends the run.
 *
 * Every compile runs in `job`, by default the editor's, so that a package that reads `\jobname`
 * is checked as the user's document will compile. The dump replaces the job's format, so the job
 * starts again as a new document whatever it held, and a caller whose session holds a document
 * the user has open in that job runs the harness in a session of its own.
 */
export async function validatePackage(
  session: EngineSession,
  fonts: FontLibrary,
  pkg: TemplatePackage,
  sample: Resume,
  values: ControlValues = {},
  job = EDITOR_JOB,
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

  // The dump has just replaced the job's format, so the first compile starts the job again as a
  // new document, the second reads what the first wrote, and the edit's what the second wrote, as
  // an open document's compiles do. Three passes at most, as the session gives by default, so
  // that a template that needs a third as a new document shows.
  const compile = (latex: string) =>
    session.compile(pkg.engine, format.name, latex, { job, maxPasses: 3 });
  const body = attempt(findings, "compile", () => generateBody(pkg, sample, chosen));
  if (body === undefined) return report;
  const first = attempt(findings, "compile", () => compile(body.latex));
  if (first === undefined) return report;
  report.passes.push(...first.passes);
  findings.push(...checkCompile(first));
  const output = first.output;
  if (output === undefined) return report;
  const doc = attempt(findings, "compile", () => readDvi(output));
  if (doc === undefined) return report;

  const second = attempt(findings, "converges", () => compile(body.latex));
  report.passes.push(...(second?.passes ?? []));
  findings.push(...checkConverges(first, output, second));

  const editedBody = attempt(findings, "edits", () =>
    generateBody(pkg, editEverything(sample), chosen),
  );
  const edited =
    editedBody === undefined
      ? undefined
      : attempt(findings, "edits", () => compile(editedBody.latex));
  report.passes.push(...(edited?.passes ?? []));

  const { fields, undrawable } = await readFields(fonts, doc);
  report.pages = doc.pages.length;
  report.fields = fields.size;
  const fieldFindings = checkFields(doc, fields, body.texts);
  const alignmentFindings = checkAlignment(fields, body.texts, doc.pages.length === 1);
  // The edit is judged only on the fields these two checks pass as the resume has them.
  if (editedBody !== undefined && edited !== undefined) {
    const reported = new Set(
      [...fieldFindings, ...alignmentFindings].flatMap((finding) => finding.field ?? []),
    );
    findings.push(...(await checkEdits(fonts, edited, editedBody.texts, body.texts, reported)));
  }
  findings.push(
    ...checkPages(doc),
    ...fieldFindings,
    ...alignmentFindings,
    ...checkFonts(undrawable),
    ...checkSpecial(doc),
  );
  return report;
}

/**
 * `validatePackage` over every curated package with its invented sample, on the package's
 * defaults, in the order the packages were ported. CI runs it through `harness.test.ts`. Every
 * package compiles in the editor's job, so the job is forgotten after each, and the next package
 * finds nothing another left in it.
 */
export async function validateCurated(
  session: EngineSession,
  fonts: FontLibrary,
): Promise<Report[]> {
  const reports: Report[] = [];
  for (const { package: pkg, sample } of CURATED.values()) {
    reports.push(await validatePackage(session, fonts, pkg, sample));
    session.forget(EDITOR_JOB);
  }
  return reports;
}

/**
 * A resume after an edit to every text field: each has its last character replaced, as a user
 * retyping one does, and a rich text has the last character of its last run replaced. Dates and
 * addresses stay as they are, and so does a field that is blank, which the body does not mark, so
 * that the edited body marks the same fields as the resume's, under the same ids. The resume
 * given is left as it was.
 */
export function editEverything(resume: Resume): Resume {
  const edited = structuredClone(resume);
  const edit = (text: string) => {
    if (isBlank(text)) return text;
    const characters = Array.from(text);
    characters[characters.length - 1] = characters.at(-1) === EDIT[0] ? EDIT[1] : EDIT[0];
    return characters.join("");
  };
  const editRuns = (runs: RichText) => {
    if (isBlank(runs.map((run) => run.text).join(""))) return;
    for (let at = runs.length - 1; at >= 0; at--) {
      const run = runs[at];
      if (run === undefined || run.text === "") continue;
      run.text = edit(run.text);
      return;
    }
  };
  const { header } = edited;
  header.name.first = edit(header.name.first);
  header.name.last = edit(header.name.last);
  if (header.headline !== undefined) header.headline = edit(header.headline);
  if (header.email !== undefined) header.email = edit(header.email);
  if (header.phone !== undefined) header.phone = edit(header.phone);
  if (header.location !== undefined) header.location = edit(header.location);
  for (const link of header.links) link.label = edit(link.label);
  for (const section of edited.sections) {
    section.title = edit(section.title);
    switch (section.kind) {
      case "entries":
        for (const entry of section.entries) {
          entry.title = edit(entry.title);
          if (entry.subtitle !== undefined) entry.subtitle = edit(entry.subtitle);
          if (entry.place !== undefined) entry.place = edit(entry.place);
          for (const bullet of entry.bullets) editRuns(bullet.text);
        }
        break;
      case "list":
        for (const item of section.items) editRuns(item.text);
        break;
      case "labelled":
        for (const item of section.items) {
          item.label = edit(item.label);
          editRuns(item.text);
        }
        break;
      case "paragraph":
        editRuns(section.text);
        break;
    }
  }
  return edited;
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
 * in the log, to output the page can read. A failure means the template's snippets do not fit
 * its macros, or the resume reaches something the template cannot set, such as an empty argument
 * where a macro needs text. The finding is TeX's first error, or what the DVI reader found.
 */
function checkCompile(result: CompileResult): Finding[] {
  const error = compileError(result);
  return error === undefined ? [] : [{ check: "compile", message: error }];
}

/**
 * `converges`: a new document compiles in two passes, the first writing the auxiliary files the
 * second reads, as the session gives every new document; and the same body, compiled again in
 * the same job, takes one pass and sets the same output (`sameOutput`). A third pass means the
 * log asked for a rerun after the second, so every document the user opens costs one more. The
 * editor recompiles an open document in one pass, reading the auxiliary files the compile before
 * it wrote, so a template whose auxiliary files do not settle shows a page that is wrong, or one
 * that changes on a keystroke that changed nothing.
 */
function checkConverges(
  first: CompileResult,
  output: Uint8Array,
  second: CompileResult | undefined,
): Finding[] {
  const findings: Finding[] = [];
  const fresh = first.passes.length;
  if (fresh !== 2)
    findings.push({
      check: "converges",
      message: `a new document takes ${fresh} passes to compile, not two`,
    });
  // A second compile that threw is already a finding, with what it threw.
  if (second === undefined) return findings;
  if (second.output === undefined) {
    const error = second.error ?? "no output";
    findings.push({
      check: "converges",
      message: `the same body does not compile again: ${error}`,
    });
    return findings;
  }
  const passes = second.passes.length;
  if (passes !== 1)
    findings.push({
      check: "converges",
      message: `the same body takes ${passes} passes to compile again, not one`,
    });
  if (!sameOutput(output, second.output))
    findings.push({ check: "converges", message: "the same body compiles again to other output" });
  return findings;
}

/**
 * `edits`: after an edit, every field shows its new text. The editor compiles an open document
 * once for each edit, in its job, reading the auxiliary files the compile before it wrote, so a
 * field whose copy on the page comes from them, such as a title a template sets in its table of
 * contents through `\addcontentsline`, shows the text of the compile before, one edit behind,
 * which two compiles of the same body cannot tell. So the harness edits every text field of the
 * resume (`editEverything`), compiles the edited body once in the same job, and holds each field
 * to the fields and alignment checks' rules against its new text. A field those checks report
 * for the resume as it is (`reported`) is left to them, so that a finding here is what the edit
 * broke. It says the field shows the text of the compile before when its markers pass and its
 * old text accounts for every glyph the page shows of it, and what else is wrong otherwise.
 */
async function checkEdits(
  fonts: FontLibrary,
  result: CompileResult,
  texts: ReadonlyMap<string, string>,
  before: ReadonlyMap<string, string>,
  reported: ReadonlySet<string>,
): Promise<Finding[]> {
  const failure = compileError(result);
  const output = result.output;
  if (failure !== undefined || output === undefined)
    return [
      {
        check: "edits",
        message: `after an edit, the body does not compile: ${failure ?? "no output"}`,
      },
    ];
  let doc: DviDocument;
  try {
    doc = readDvi(output);
  } catch (error) {
    return [{ check: "edits", message: `after an edit, ${messageOf(error)}` }];
  }
  const { fields } = await readFields(fonts, doc);
  const onePage = doc.pages.length === 1;
  // A field's markers first, so that a field the edit cut short is not taken for one behind.
  const problems = [...checkFields(doc, fields, texts), ...checkAlignment(fields, texts, onePage)];
  const findings: Finding[] = [];
  const seen = new Set(reported);
  for (const { check, field: id, message } of problems) {
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const field = fields.get(id);
    const old = before.get(id);
    const behind =
      check === "alignment" &&
      field !== undefined &&
      old !== undefined &&
      old !== texts.get(id) &&
      alignmentProblem(field, old, onePage) === undefined;
    findings.push({
      check: "edits",
      field: id,
      message: behind
        ? `after an edit, ${id} shows the text of the compile before`
        : `after an edit, ${message}`,
    });
  }
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
 * one glyph, marked once, its end marker after its begin marker; and the page finds no field the
 * body does not mark. A field whose markers never reach the page, as when a template sets it only
 * in a box it measures, such as `\settowidth`'s, or in a PDF string, cannot be clicked and so
 * cannot be edited on the page, and nor can one with no glyphs. One whose end marker never does
 * was cut short, as truncate.sty cuts a text to a width, and stays open, so glyphs after it count
 * as its own. One marked more than once is found at its first copy (decision 0007), which need not
 * be the one the user sees as the field, such as a name a template also sets small in a running
 * head, which LaTeX ships before the body; so a template sets each field once, and a link through
 * `{{contacts}}` or `{{links}}` but not both. A field the body does not mark is a template bug,
 * such as a stray `\rtfield`.
 */
function checkFields(
  doc: DviDocument,
  found: ReadonlyMap<string, Field>,
  texts: ReadonlyMap<string, string>,
): Finding[] {
  const findings: Finding[] = [];
  const add = (id: string, message: string) =>
    findings.push({ check: "fields", field: id, message });
  const marked = markersOf(doc);
  for (const id of texts.keys()) {
    const field = found.get(id);
    const markers = marked.get(id);
    if (field === undefined || markers === undefined) {
      add(id, `the body marks ${id}, but its markers never reach the page`);
      continue;
    }
    if (field.glyphs.length === 0) add(id, `${id} reaches the page with no glyphs`);
    if (!markers.ended) add(id, `the end marker of ${id} never reaches the page`);
    if (markers.begun > 1)
      add(id, `${id} is marked ${markers.begun} times on the page; the editor edits the first`);
  }
  for (const id of found.keys())
    if (!texts.has(id)) add(id, `the page marks ${id}, but the body does not`);
  return findings;
}

/**
 * `alignment`: every glyph of every field matches a character of the field's text, as
 * `alignField` pairs them, and the glyphs account for the whole text: what follows the last glyph
 * matched is only what the page may leave out without a glyph (`SETS_NO_GLYPH`). A glyph that
 * matches none leaves the editor unable to say which character a click landed on: the template
 * sets the field otherwise than the resume has it, such as in capitals or with text of its own
 * inside the markers, or from a font whose glyphs the page cannot name, which the fonts check
 * names as well. Text after the last glyph is text the page does not show, as when a template
 * cuts a field short. It is looked at only when every glyph matched, since a walk that misses
 * stops short of text the page does show, and only when the resume sets one page (`coverage`),
 * since a spill splits a field across pages and is the pages check's to report. A field is
 * checked where the page first finds it, the copy the user edits; a field the body does not mark
 * is the fields check's to report.
 */
function checkAlignment(
  found: ReadonlyMap<string, Field>,
  texts: ReadonlyMap<string, string>,
  coverage: boolean,
): Finding[] {
  const findings: Finding[] = [];
  for (const field of found.values()) {
    const text = texts.get(field.id);
    const problem = text === undefined ? undefined : alignmentProblem(field, text, coverage);
    if (problem !== undefined)
      findings.push({ check: "alignment", field: field.id, message: problem });
  }
  return findings;
}

/**
 * What the alignment check finds wrong with a field's glyphs against a text, if anything: a
 * glyph that matches no character, or, when `coverage` is asked for, text the glyphs leave out.
 */
function alignmentProblem(field: Field, text: string, coverage: boolean): string | undefined {
  const { unmatched, covered } = alignField(field, text);
  if (unmatched > 0) {
    const glyphs = `${unmatched} of the ${field.glyphs.length} glyphs of ${field.id}`;
    return `${glyphs} match no character of its text`;
  }
  if (coverage && text.slice(covered).replace(SETS_NO_GLYPH, "") !== "")
    return `the page shows only ${covered} of the ${text.length} characters of ${field.id}`;
  return undefined;
}

/**
 * `fonts`: every font the output uses can be drawn: TeX Live has its metrics, and outlines the
 * page draws as they are. A page the editor cannot draw is not a page it can edit, so a template
 * that needs a font the renderer does not handle yet, such as a re-encoded one (item 16), fails
 * here. Each font is loaded as the page loads it (`readFields`), so one whose files the loader
 * throws on, as it does on the metrics of the TS1 fonts, which `tfm.ts` refuses (decision 0007),
 * is named with what went wrong. A glyph from a font that cannot be drawn has no text, so a field
 * that holds one fails the alignment check as well. XeTeX's native fonts are not among them yet:
 * the page draws them from item 21 on.
 */
function checkFonts(undrawable: ReadonlyMap<string, string>): Finding[] {
  return [...undrawable].map(
    ([name, problem]): Finding => ({
      check: "fonts",
      message: `the page cannot draw ${name}: ${problem}`,
    }),
  );
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
      const id = item.kind === "special" ? markerId(item.text, MARKER_BEGIN) : undefined;
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

/** TeX's first error in a compile, or undefined when it compiled with none in the log. */
function compileError(result: CompileResult): string | undefined {
  return result.ok ? summariseLog(result.log).error : (result.error ?? "the body did not compile");
}

/**
 * An output as the page parses it, without the fonts' widths, which only positions need: pages,
 * markers, specials and each glyph's font and code are there whatever the fonts. Output the DVI
 * reader cannot parse is an error that says so.
 */
function readDvi(output: Uint8Array): DviDocument {
  try {
    return parseDvi(output, () => undefined);
  } catch (error) {
    throw new Error(`the output cannot be read: ${messageOf(error)}`);
  }
}

/**
 * The fields a document's pages show, and the fonts the page cannot draw them with, with the
 * reason. Each font the document uses is loaded once, as the page loads it, and each glyph named
 * as the page names it (`glyphTextOf`), so a glyph from a font that cannot be drawn has no text.
 * A field is the first copy the pages show, page by page, as `collectFields` keeps it on each.
 */
async function readFields(
  fonts: FontLibrary,
  doc: DviDocument,
): Promise<{ fields: Map<string, Field>; undrawable: Map<string, string> }> {
  const loaded = new Map<string, PageFont>();
  const undrawable = new Map<string, string>();
  for (const name of new Set([...doc.fonts.values()].map((font) => font.name))) {
    let font: PageFont | undefined;
    try {
      font = await fonts.load(name);
    } catch (error) {
      undrawable.set(name, messageOf(error));
      continue;
    }
    if (font === undefined) {
      undrawable.set(name, "TeX Live has no TFM for it");
      continue;
    }
    loaded.set(name, font);
    if (font.missing !== undefined) undrawable.set(name, font.missing);
  }
  return { fields: fieldsOf(doc, glyphTextOf(doc, loaded)), undrawable };
}

/** The first copy of each field the pages show, page by page, as `collectFields` finds them. */
function fieldsOf(doc: DviDocument, textOf: GlyphTextOf): Map<string, Field> {
  const fields = new Map<string, Field>();
  for (const page of doc.pages)
    for (const [id, field] of collectFields(page, textOf))
      if (!fields.has(id)) fields.set(id, field);
  return fields;
}

/**
 * How many begin markers the output holds for each field, and whether an end marker for it
 * follows the first, reading the pages in order as one stream and the markers as `collectFields`
 * reads them, whatever their case.
 */
function markersOf(doc: DviDocument): Map<string, { begun: number; ended: boolean }> {
  const marked = new Map<string, { begun: number; ended: boolean }>();
  for (const { items } of doc.pages)
    for (const item of items) {
      if (item.kind !== "special") continue;
      const begin = markerId(item.text, MARKER_BEGIN);
      if (begin !== undefined) {
        const markers = marked.get(begin) ?? { begun: 0, ended: false };
        markers.begun++;
        marked.set(begin, markers);
        continue;
      }
      const end = markerId(item.text, MARKER_END);
      const markers = end === undefined ? undefined : marked.get(end);
      if (markers !== undefined) markers.ended = true;
    }
  return marked;
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
