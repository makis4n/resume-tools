/**
 * The validation harness: the one code path that checks a template package, as plan section 5.7
 * has it. CI runs it over every curated package with its invented sample (`validateCurated`,
 * which `harness.test.ts` calls), and the import pipeline's probe step (milestone 3) will run it
 * in the browser over a freshly inferred package. So it is a function of an engine session, the
 * fonts the page is drawn with, a package and a resume, and it reaches for neither Node nor the
 * browser: the caller brings the session and the fonts.
 *
 * It compiles the resume through the package as the editor does, twice, then once more after an
 * edit to every field, then once for each style control set another way, and reads the output
 * back as the page does; and it checks the PDF xdvipdfmx makes from the resume's first output.
 * It reports rather than throws: each check that fails adds a finding, so that CI names every
 * check a package fails and the import step can say what is locked. Only a failed dump or compile
 * stops it, since nothing after either has anything to read. Findings are for developers and CI,
 * and may quote TeX's log, so the product never shows one to a user as it is.
 *
 * The harness cannot bound a compile itself. The engine runs TeX in one synchronous call, and
 * nothing else in its thread runs until the call returns, timers included, so a package whose TeX
 * never finishes never lets the harness return. The caller bounds it: CI through the check job's
 * time limit, and the browser (milestone 3) by running the session in a worker it can terminate,
 * as item 8's scheduler will.
 */

import type { Resume, RichText } from "@resume-tools/resume-model";
import { summariseLog } from "../engine/log";
import type { CompileResult, DumpResult, EngineSession, PdfResult } from "../engine/session";
import { glyphTextOf, nativeProblem, paperSize, widthsOf } from "../page/draw";
import type { FontLibrary, NativePageFont, PageFont } from "../page/fonts";
import { type NativeFontFile, nativeFileName } from "../page/native";
import { CURATED } from "../templates/curated";
import { isBlank } from "../templates/escape";
import { generateBody, generateFormat } from "../templates/generate";
import {
  ControlValues,
  defaultControls,
  fontFiles,
  type TemplatePackage,
} from "../templates/package";
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
import { INCH, US_LETTER } from "../tex/svg";
import { hasToUnicode, mediaBoxes, shownStrings } from "./pdf";

/** The checks, in the order the harness makes them. */
export const CHECKS = [
  "dump",
  "compile",
  "converges",
  "controls",
  "edits",
  "pages",
  "fields",
  "alignment",
  "fonts",
  "special",
  "pdf",
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
   * costs; then the resume's compile with each control set another way, one pass, as a change of
   * a control costs, or two where the job starts again as a new document, as it does when the
   * value names another format.
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
  "spaceskip",
  "xspaceskip",
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
  // What a XeTeX package's fonts can set, as the editor reads it, so that every body leaves out
  // what they cannot, as the editor's does (decision 0014).
  const files = fontFiles(pkg);
  const covers = files.length === 0 ? undefined : await fonts.coverage(files);

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
  const body = attempt(findings, "compile", () => generateBody(pkg, sample, chosen, { covers }));
  if (body === undefined) return report;
  const first = attempt(findings, "compile", () => compile(body.latex));
  if (first === undefined) return report;
  report.passes.push(...first.passes);
  findings.push(...checkCompile(first));
  const output = first.output;
  if (output === undefined) return report;
  const doc = attempt(findings, "compile", () => readDvi(output));
  if (doc === undefined) return report;
  // The PDF of this output, while the job holds it: the compiles after this one replace it, and
  // the edit's is of other texts. What it finds is reported in its turn, last.
  const pdfFindings: Finding[] = [];
  const pdf = attempt(pdfFindings, "pdf", () => session.pdf(job, { compress: 0 }));

  const second = attempt(findings, "converges", () => compile(body.latex));
  report.passes.push(...(second?.passes ?? []));
  findings.push(...checkConverges(first, output, second));

  const editedBody = attempt(findings, "edits", () =>
    generateBody(pkg, editEverything(sample), chosen, { covers }),
  );
  const edited =
    editedBody === undefined
      ? undefined
      : attempt(findings, "edits", () => compile(editedBody.latex));
  report.passes.push(...(edited?.passes ?? []));

  // The controls' compiles come last, after the edit's, though `CHECKS` lists their check before
  // `edits`: each leaves the job as it compiled it, with another format where a value names one,
  // and the edit has to compile in the job as the resume's second compile left it, as an edit does
  // in the editor. So nothing is restored after them. The first reads the auxiliary files the
  // edit's compile wrote, so only a template whose page shows what they hold, which the edits
  // check reports, could pass a control that does nothing.
  const controls = checkControls(session, pkg, sample, chosen, format.name, output, job, covers);
  report.passes.push(...controls.passes);
  findings.push(...controls.findings);

  const { fields, undrawable, natives } = await readFields(fonts, output, doc);
  report.pages = doc.pages.length;
  report.fields = fields.size;
  const fieldFindings = checkFields(doc, fields, body.texts);
  const alignmentFindings = checkAlignment(fields, body.texts, doc.pages.length === 1);
  // The edit and the PDF are judged only on the fields these two checks pass as the resume has
  // them.
  const reported = new Set(
    [...fieldFindings, ...alignmentFindings].flatMap((finding) => finding.field ?? []),
  );
  if (editedBody !== undefined && edited !== undefined)
    findings.push(...(await checkEdits(fonts, edited, editedBody.texts, body.texts, reported)));
  findings.push(
    ...checkPages(doc),
    ...fieldFindings,
    ...alignmentFindings,
    ...checkFonts(undrawable),
    ...checkSpecial(doc),
    ...pdfFindings,
    ...(pdf === undefined ? [] : checkPdf(pdf, doc, fields, body.texts, reported, natives)),
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
 * `controls`: every style control the package offers takes effect, in an ordinary compile. The
 * editor applies a control's value in the body, before `\begin{document}` (decision 0006), so a
 * snippet that sets nothing TeX shows, such as one that leaves its value in a comment, gives the
 * user a control that changes nothing, and one that stops the compile gives a page that no longer
 * updates. So the resume compiles once more for each value `probesOf` gives, one control set
 * another way in each, in the job, as a change of a control compiles in the editor: a value that
 * names another format has it dumped first, as the editor dumps it, and the job then starts again
 * as a new document. A finding says that the format did not dump, that the body did not compile
 * or its log has an error, or that the output is the resume's own (`sameOutput`), so the control
 * does nothing. Plan section 5.4 asks as much of an imported template's controls, which appear
 * only where overriding one changes the output without breaking the compile.
 */
function checkControls(
  session: EngineSession,
  pkg: TemplatePackage,
  sample: Resume,
  chosen: ControlValues,
  format: string,
  output: Uint8Array,
  job: string,
  covers: ((char: string) => boolean) | undefined,
): { findings: Finding[]; passes: number[] } {
  const findings: Finding[] = [];
  const passes: number[] = [];
  const add = (message: string) => findings.push({ check: "controls", message });
  for (const { values, set, was } of probesOf(pkg, chosen)) {
    try {
      const probe = generateFormat(pkg, values);
      if (probe.name !== format) {
        const dumped = session.dump(pkg.engine, probe.name, probe.preamble, probe.files);
        if (!dumped.ok) {
          add(`with ${set}, the format does not dump: ${dumped.error ?? "no format"}`);
          continue;
        }
      }
      const body = generateBody(pkg, sample, values, { covers });
      const result = session.compile(pkg.engine, probe.name, body.latex, { job, maxPasses: 3 });
      passes.push(...result.passes);
      const error = compileError(result);
      if (error !== undefined || result.output === undefined)
        add(`with ${set}, the body does not compile: ${error ?? "no output"}`);
      else if (sameOutput(output, result.output))
        add(`${set} sets the same output as ${was}, so the control does nothing`);
    } catch (error) {
      // The generator throws for what it cannot render, and the session for a run the engine
      // cannot finish.
      add(`with ${set}, ${messageOf(error)}`);
    }
  }
  return { findings, passes };
}

/** One value the controls check tries, and how a finding names it and the document's value. */
interface Probe {
  /** The document's values, with one control set another way. */
  values: ControlValues;
  /** The control and the value it is set to, as `margins 1`. */
  set: string;
  /** The control and the document's value for it, as `margins 0.5`. */
  was: string;
}

/** The accent the controls check tries, a dark blue, unless the document's accent is that. */
const PROBE_ACCENT = "#1F4E79";

/**
 * The values the controls check tries, one control set another way in each, for every control the
 * package offers, in the schema's order: the other page size; margins of an inch, or of 0.4 where
 * they are an inch already; the largest font size, or 11.5 where the size is 12; each font but
 * the document's; a dark blue accent, or black where the accent is that blue; each density but
 * the document's; and the date format that shows only years, or `MMM yyyy` where the document
 * shows only years. `chosen` holds a value for every control the package offers, the package's
 * defaults filled in. The date format is tried only where the package declares it, as Jake's
 * does, since it is the generator's and changes the page only where the template sets a date.
 */
function probesOf(pkg: TemplatePackage, chosen: ControlValues): Probe[] {
  const { pageSize, margins, fontSize, font, accent, density, dateFormat } = pkg.controls;
  const probes: Probe[] = [];
  const probe = (values: ControlValues, name: keyof ControlValues) =>
    probes.push({
      values,
      set: `${name} ${String(values[name])}`,
      was: `${name} ${String(chosen[name])}`,
    });
  if (pageSize)
    probe({ ...chosen, pageSize: chosen.pageSize === "a4" ? "letter" : "a4" }, "pageSize");
  if (margins) {
    const wide = (chosen.margins ?? margins.default) < 1;
    probe({ ...chosen, margins: wide ? 1 : 0.4 }, "margins");
  }
  if (fontSize) probe({ ...chosen, fontSize: chosen.fontSize === 12 ? 11.5 : 12 }, "fontSize");
  for (const { id } of font?.choices ?? [])
    if (id !== chosen.font) probe({ ...chosen, font: id }, "font");
  if (accent) {
    const blue = (chosen.accent ?? accent.default).toUpperCase() === PROBE_ACCENT;
    probe({ ...chosen, accent: blue ? "#000000" : PROBE_ACCENT }, "accent");
  }
  if (density)
    for (const value of ControlValues.shape.density.unwrap().options)
      if (value !== chosen.density) probe({ ...chosen, density: value }, "density");
  if (dateFormat) {
    const years = chosen.dateFormat === "yyyy";
    probe({ ...chosen, dateFormat: years ? "MMM yyyy" : "yyyy" }, "dateFormat");
  }
  return probes;
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
  const { fields } = await readFields(fonts, output, doc);
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
 * page can draw, whether the font map names them, re-encoded, slanted or stretched, or a virtual
 * font composes them (decision 0009). A page the editor cannot draw is not a page it can edit, so
 * a template that needs a font the tree has no outlines for fails here, such as the EC and TC
 * fonts LaTeX's T1 and TS1 take for Computer Modern, which the tree has only the metrics of. Each
 * font is loaded as the page loads it (`readFields`), and the loader says why one cannot be drawn,
 * or what went wrong reading its files. A glyph from a font that cannot be drawn has no text, so a
 * field that holds one fails the alignment check as well. XeTeX's native fonts are among them, by
 * their file's name (decision 0014): one the tree lacks, one that cannot be read, and one XeTeX
 * set emboldened or from a later face of a collection, which the page draws as boxes
 * (`nativeProblem`).
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
 * What a special does to xdvipdfmx's graphics state, which the page has no part of: open a level
 * that transforms what is set in it, open one that moves nothing, transform the level it is in
 * from there to the level's end, or close the level it is in. Each is matched by every name
 * xdvipdfmx takes for it, after any whitespace, which xdvipdfmx skips before a special's prefix
 * and after it: `pdf:btrans` is also `begintransform`, `begintrans` and `bt`, and `pdf:etrans`
 * `endtransform`, `endtrans` and `et`. The tree's xdvipdfmx does `x:bscale` and `x:escale` without
 * saving the state: `x:bscale` scales about the point it is at, and `x:escale` undoes a scale about
 * the point it is at, which is another once anything is set between them, so the rest of the level
 * stays moved; an `x:escale` with no `x:bscale` open stops xdvipdfmx. And it knows no `x:brotate`
 * or `x:erotate`, which it passes over with a warning.
 */
const GRAPHICS_STATE: readonly [RegExp, GraphicsStateChange][] = [
  [/^\s*pdf:\s*(?:btrans|begintransform|begintrans|bt)(?!\w)/, "transforming"],
  [/^\s*pdf:\s*(?:etrans|endtransform|endtrans|et)(?!\w)/, "close"],
  [/^\s*pdf:\s*bcontent(?!\w)/, "open"],
  [/^\s*pdf:\s*econtent(?!\w)/, "close"],
  [/^\s*x:\s*gsave(?!\w)/, "open"],
  [/^\s*x:\s*grestore(?!\w)/, "close"],
  [/^\s*x:\s*bscale(?!\w)/, "scale"],
  [/^\s*x:\s*escale(?!\w)/, "unscale"],
  [/^\s*x:\s*(?:scale|rotate)(?!\w)/, "transform"],
];

type GraphicsStateChange = "transforming" | "open" | "transform" | "close" | "scale" | "unscale";

/** What a special does to xdvipdfmx's graphics state, if anything. */
function graphicsStateChange(text: string): GraphicsStateChange | undefined {
  return GRAPHICS_STATE.find(([pattern]) => pattern.test(text))?.[1];
}

/**
 * `special`: each field's begin marker is followed directly by its paragraph special, with the
 * keys decision 0007 lists, in its order; the values are TeX's to measure. Item 9's overlay reads
 * the special to break a field's lines where TeX will, so a template that sets anything between
 * the two, or redefines what the prelude writes them with, leaves a field the overlay cannot set
 * as the page does.
 *
 * And no field is set where xdvipdfmx transforms what the page, drawn from the DVI, does not, so
 * that the page would draw the field where the PDF does not put it, as it drew the text of
 * AltaCV's tags, TikZ nodes, before its port stopped setting it in one (decision 0013). That is
 * between a `pdf:btrans` and its `pdf:etrans`, however they nest, and from an `x:scale`,
 * `x:rotate` or `x:bscale` to the end of the level of the graphics state it is in, which an
 * `x:gsave` opens and its `x:grestore` closes, a `pdf:bcontent` and its `pdf:econtent` likewise,
 * or the page's own, which ends with the page (`GRAPHICS_STATE` has every name, and why an
 * `x:bscale` reaches past its `x:escale`). A field is reported when its begin marker or a glyph of
 * it is in one. A level closed that was never opened closes the page's own, which xdvipdfmx opens
 * with the move of an inch in from the corner, so that everything after it on the page lands an
 * inch left and off the page; and an `x:escale` with no `x:bscale` open stops xdvipdfmx. Either is
 * one finding of its own, however often it happens.
 *
 * What the check does not see: a `cm`, `q` or `Q` a template writes itself, in a `pdf:code`,
 * `pdf:literal` or `pdf:content`, since pgf writes such pairs that undo each other around its own
 * boxes, and telling those from a pair that moves the text would take the matrices multiplied
 * out; and a form, `pdf:bxobj` to `pdf:exobj`, whose content the PDF draws wherever `pdf:uxobj`
 * puts it. Every copy of a field is checked, and a field is reported once for each problem.
 */
export function checkSpecial(doc: DviDocument): Finding[] {
  const findings: Finding[] = [];
  const reported = new Set<string>();
  const transformed = new Set<string>();
  const inTransform = (id: string) => {
    if (transformed.has(id)) return;
    transformed.add(id);
    findings.push({
      check: "special",
      field: id,
      message: `field ${id} is set inside a PDF-only transform, so the page cannot place it where the PDF does`,
    });
  };
  let closedUnopened = false;
  // The fields begun and not yet ended where each item is set, read as one stream, since a field
  // can run onto the next page; and the levels of the graphics state open there, the page's own
  // first, each with whether it transforms what is set in it, which end with their page.
  const open = new Set<string>();
  const closeUnopened = () => {
    if (closedUnopened) return;
    closedUnopened = true;
    findings.push({
      check: "special",
      message: "a transform closed that was never opened, which moves every field after it",
    });
  };
  for (const { items } of doc.pages) {
    const levels = [false];
    let scales = 0;
    items.forEach((item, index) => {
      if (item.kind === "glyph" || item.kind === "native") {
        if (levels.at(-1)) for (const id of open) inTransform(id);
        return;
      }
      if (item.kind !== "special") return;
      switch (graphicsStateChange(item.text)) {
        case "transforming":
          levels.push(true);
          break;
        case "open":
          levels.push(levels.at(-1) ?? false);
          break;
        case "transform":
          levels[levels.length - 1] = true;
          break;
        case "close":
          if (levels.length > 1) levels.pop();
          else closeUnopened();
          break;
        case "scale":
          levels[levels.length - 1] = true;
          scales++;
          break;
        case "unscale":
          if (scales > 0) scales--;
          else closeUnopened();
          break;
      }
      const ended = markerId(item.text, MARKER_END);
      if (ended !== undefined) open.delete(ended);
      const id = markerId(item.text, MARKER_BEGIN);
      if (id === undefined) return;
      open.add(id);
      if (levels.at(-1)) inTransform(id);
      if (reported.has(id)) return;
      const problem = paragraphProblem(id, items[index + 1]);
      if (problem === undefined) return;
      reported.add(id);
      findings.push({ check: "special", field: id, message: problem });
    });
  }
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

/** How far a PDF's page size may be from the page's, in big points: xdvipdfmx rounds to 0.01. */
const PDF_SIZE_TOLERANCE = 0.01;

/**
 * The characters a field's first word may hold to be looked for in a PDF's strings as itself:
 * ASCII letters, digits, and the punctuation every text font the page draws sets under its own
 * code. OT1 sets others from other fonts, as it does `<` and `|`, or as a rule, as it does `_`,
 * and its italic sets a pound sign under the dollar's code.
 */
const SHOWN_AS_ITSELF = /^[A-Za-z0-9.,:;!?'()[\]@#%&*+=/-]+$/;

/**
 * The single quotes XeTeX's `tex-text` mapping sets for the straight apostrophe and backtick a
 * text holds, which a native font's ToUnicode map reads as themselves (decision 0014).
 */
const CURLED = /[\u2018\u2019]/g;

/**
 * A text with each character a native font's map gives one glyph with others read as the one the
 * glyph reads as first (`NativeFontFile.textsOf`), in any of `natives`. xdvipdfmx's ToUnicode map
 * gives such a glyph the highest of its characters, so a hyphen typed in Source Sans Pro, whose
 * map gives its hyphen U+002D, U+00AD, U+2010 and U+2011, shows in the PDF's text as U+2011, and
 * reads here as the hyphen again (decision 0014).
 */
function unaliased(text: string, natives: readonly NativeFontFile[]): string {
  let out = "";
  for (const char of text) {
    let first = char;
    for (const file of natives) {
      const glyph = file.glyphFor(char);
      const [read] = glyph === undefined ? [] : file.textsOf(glyph);
      if (read !== undefined && read !== char && [...read].length === 1) {
        first = read;
        break;
      }
    }
    out += first;
  }
  return out;
}

/**
 * Characters TeX's text fonts may set as one glyph, a ligature, under a code of its own, which
 * differs from OT1 to T1: ff, fi and fl, the dashes, the closing double quote, and in T1 the low
 * double quote that two commas make.
 */
const LIGATURE = /ff|fi|fl|--|''|,,/;

/**
 * `pdf`: xdvipdfmx makes the PDF from the output the page is drawn from (plan section 5.5), and
 * the ATS can read it: its page is the page's size, as `paperSize` reads it; a font of it carries
 * a ToUnicode map, which is what lets a reader take the text out; and every field the page shows
 * is in its text. It is made at compression level 0, whose streams `pdf.ts` reads as they stand.
 * A field is looked for by its first word, its text up to the first space, among the strings the
 * PDF's text operators show, where the glyphs' codes stand for the characters, which holds only
 * for what `SHOWN_AS_ITSELF` allows, and not for a ligature; a field whose first word has a
 * character outside ASCII, or anything else those rule out, is skipped. A native font's text,
 * XeTeX's, is read through its ToUnicode map (`shownStrings`), where the quotes XeTeX's
 * `tex-text` mapping curls read as the straight ones the text holds, and a character its font's
 * map gives one glyph with others as the one the glyph reads as first (`unaliased`), since
 * xdvipdfmx shows such a glyph as the highest, as it shows Source Sans Pro's hyphen as U+2011. A
 * first word TeX broke at
 * a line end lands in two text operators, its halves split by a hyphen TeX inserted, so a word not
 * in any one string is looked for in the strings joined, with that hyphen anywhere inside it. A
 * field the fields or alignment checks report (`reported`) is left to them. A PDF xdvipdfmx cannot
 * make, as when the output uses a font it has no Type 1 file of to embed, is one finding, with its
 * words.
 */
function checkPdf(
  made: PdfResult,
  doc: DviDocument,
  found: ReadonlyMap<string, Field>,
  texts: ReadonlyMap<string, string>,
  reported: ReadonlySet<string>,
  natives: ReadonlyMap<string, NativePageFont>,
): Finding[] {
  const pdf = made.pdf;
  if (!made.ok || pdf === undefined)
    return [
      { check: "pdf", message: `xdvipdfmx makes no PDF: ${made.error ?? "no reason given"}` },
    ];
  const findings: Finding[] = [];
  const bp = 72 / INCH;
  const size = paperSize(doc.pages[0] ?? { items: [] }) ?? US_LETTER;
  const page = { width: size.width * bp, height: size.height * bp };
  const boxes = mediaBoxes(pdf);
  const near = (a: number, b: number) => Math.abs(a - b) <= PDF_SIZE_TOLERANCE;
  const other = boxes.find((box) => !near(box.width, page.width) || !near(box.height, page.height));
  const sizeOf = ({ width, height }: { width: number; height: number }) =>
    `${Number(width.toFixed(2))} by ${Number(height.toFixed(2))} bp`;
  if (boxes.length === 0) findings.push({ check: "pdf", message: "the PDF gives no page size" });
  else if (other !== undefined)
    findings.push({
      check: "pdf",
      message: `the PDF's page is ${sizeOf(other)}, not the page's ${sizeOf(page)}`,
    });
  if (!hasToUnicode(pdf))
    findings.push({
      check: "pdf",
      message: "no font of the PDF has a ToUnicode map, so its text cannot be read",
    });
  const files = [...natives.values()].flatMap((font) => font.file ?? []);
  const shown = shownStrings(pdf).map((text) => unaliased(text, files).replace(CURLED, "'"));
  // The operators joined in order, nothing between them, so a first word broken across two of them
  // reads as one, its halves split by the hyphen TeX inserted at the break.
  const joined = shown.join("");
  for (const field of found.values()) {
    const word = texts.get(field.id)?.trim().split(/\s/, 1)[0] ?? "";
    if (reported.has(field.id) || !SHOWN_AS_ITSELF.test(word) || LIGATURE.test(word)) continue;
    if (shown.some((text) => text.includes(word)) || brokenAcross(joined, word)) continue;
    findings.push({
      check: "pdf",
      field: field.id,
      message: `the PDF's text does not show ${field.id}: no text operator shows its first word, ${word}`,
    });
  }
  return findings;
}

/** Whether `word` appears in `joined` with a single line-break hyphen inserted somewhere inside. */
function brokenAcross(joined: string, word: string): boolean {
  for (let at = 1; at < word.length; at++)
    if (joined.includes(`${word.slice(0, at)}-${word.slice(at)}`)) return true;
  return false;
}

/** TeX's first error in a compile, or undefined when it compiled with none in the log. */
function compileError(result: CompileResult): string | undefined {
  return result.ok ? summariseLog(result.log).error : (result.error ?? "the body did not compile");
}

/**
 * An output parsed without the fonts' widths, which only positions need: pages, markers, specials
 * and each glyph's font and code are there whatever the fonts, and `readFields` parses it again
 * with them for the fields. Output the DVI reader cannot parse is an error that says so.
 */
function readDvi(output: Uint8Array): DviDocument {
  try {
    return parseDvi(output, () => undefined);
  } catch (error) {
    throw new Error(`the output cannot be read: ${messageOf(error)}`);
  }
}

/**
 * The fields an output's pages show, the fonts the page cannot draw them with, with the reason,
 * and the native fonts it loaded, by file name, which the PDF check reads the PDF's text with
 * (`unaliased`). Each font `doc`, the output as `readDvi` parsed it, uses is loaded once, as the page
 * loads it, TeX fonts and XeTeX's native ones alike; the output is parsed again with the TeX
 * fonts' widths, as the page parses it, since whether an accent stands over the letter after it
 * depends on where each starts (`collectFields`); and each glyph is named as the page names it
 * (`glyphTextOf`), so a glyph from a font that cannot be drawn has no text. A field is the first
 * copy the pages show, page by page, as `collectFields` keeps it on each.
 */
async function readFields(
  fonts: FontLibrary,
  output: Uint8Array,
  doc: DviDocument,
): Promise<{
  fields: Map<string, Field>;
  undrawable: Map<string, string>;
  natives: Map<string, NativePageFont>;
}> {
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
  const natives = new Map<string, NativePageFont>();
  for (const name of new Set([...doc.nativeFonts.values()].map((f) => nativeFileName(f.name)))) {
    try {
      const font = await fonts.loadNative(name);
      if (font !== undefined) natives.set(name, font);
    } catch (error) {
      undrawable.set(name, messageOf(error));
    }
  }
  for (const def of doc.nativeFonts.values()) {
    const name = nativeFileName(def.name);
    const problem = undrawable.has(name) ? undefined : nativeProblem(def, natives.get(name));
    if (problem !== undefined) undrawable.set(name, problem);
  }
  const placed = parseDvi(output, widthsOf(loaded));
  return { fields: fieldsOf(placed, glyphTextOf(placed, loaded, natives)), undrawable, natives };
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
