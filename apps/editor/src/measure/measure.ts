/**
 * The editor measured against the targets of plan section 4.3 (milestone 2 item 23, decision
 * 0016): what an edit costs until the true page is back, what the overlay does on a keystroke,
 * and what a first load fetches.
 *
 * The same measurements run in two places. `scripts/measure.ts` runs them in Node over every
 * curated package, on a session of the engine as the tests start it; the app's `?measure=1` page
 * (`MeasurePage.tsx`) times the page as the app makes it, through the worker. Either way they time
 * the code the editor runs and never a stand-in for it: the generator, the engine session, the
 * page's drawing, the document's commands and the overlay's row layout. So this module holds only
 * what both share, and reaches for neither Node nor the browser.
 *
 * An edit is the sample's longest field retyped at its end (`editCommand`), as a user's edit is
 * one field, and it keeps the field's length, so that no edit pushes the sample onto a second
 * page. TeX compiles the whole body whatever changed, so an edit to one field costs what an edit
 * to every field would.
 */

import type { Resume, RichText } from "@resume-tools/resume-model";
import { apply, type Command, Document, fieldsOf } from "../editor/document";
import {
  layoutRows,
  namedVariants,
  richFaces,
  richRows,
  type SizedFont,
  settingFor,
  variantFontsOf,
} from "../editor/Overlay";
import type { Variant } from "../editor/rich";
import type { Engine, EngineSession, Fetched } from "../engine/session";
import { type DrawnPage, drawPage, type FieldFont } from "../page/draw";
import type { FontLibrary } from "../page/fonts";
import { generateBody, generateFormat } from "../templates/generate";
import type { TemplatePackage } from "../templates/package";

/** One of the targets of plan section 4.3, as the plan states it. */
export interface Target {
  /** The path the target is for, in the plan's words. */
  path: string;
  limit: number;
  unit: "ms" | "bytes";
  /** Whether the value must stay under the limit, or may reach it. */
  under: boolean;
}

/**
 * The targets of plan section 4.3 that this milestone can measure. The two for import are
 * milestone 3's. A slow laptop is a 2019 machine with integrated graphics; the slow-laptop target
 * is judged here on whatever machine runs the measurement, so it says something only on one.
 */
export const TARGETS = {
  keystroke: { path: "Keystroke in the overlay", limit: 16, unit: "ms", under: true },
  typical: {
    path: "True page updated after an edit, typical",
    limit: 300,
    unit: "ms",
    under: false,
  },
  slowLaptop: {
    path: "True page updated after an edit, slow laptop",
    limit: 500,
    unit: "ms",
    under: true,
  },
  firstLoad: { path: "First load, cached afterwards", limit: 30e6, unit: "bytes", under: true },
} as const satisfies Record<string, Target>;

/** Whether a value meets a target. */
export function meets(target: Target, value: number): boolean {
  return target.under ? value < target.limit : value <= target.limit;
}

/**
 * The job the editor compiles its document in, the compile scheduler's `JOB`, so that a template
 * that reads `\jobname` sets its page here as it does in the editor.
 */
const JOB = "doc";

/** Passes at most per compile, as the scheduler asks: two for a new document, and a rerun. */
const MAX_PASSES = 3;

/** How many row layouts the keystroke's median is taken over, for each edit timed. */
export const LAYOUTS_PER_EDIT = 10;

/** The median of some numbers, the mean of the middle two when there is an even count. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("there are no values to take the median of");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] as number) + upper) / 2;
}

/** The field the measurements edit and lay out, and how long its text is, in UTF-16 units. */
export interface MeasuredField {
  id: string;
  kind: "rich" | "text";
  length: number;
}

/**
 * The field whose rows cost the most to lay out, which the measurements type in: the resume's
 * longest rich field that the page shows, or its longest text field when it has no rich one on
 * the page. Undefined when the page shows neither.
 */
export function longestField(resume: Resume, page: DrawnPage): MeasuredField | undefined {
  const fields = [...fieldsOf(resume)].filter(([id]) => page.fields.get(id)?.layout !== undefined);
  let rich: MeasuredField | undefined;
  let text: MeasuredField | undefined;
  for (const [id, field] of fields) {
    if (field.kind === "rich") {
      const length = field.get(resume).reduce((sum, run) => sum + run.text.length, 0);
      if (rich === undefined || length > rich.length) rich = { id, kind: "rich", length };
    } else if (field.kind === "text") {
      const length = field.get(resume)?.length ?? 0;
      if (text === undefined || length > text.length) text = { id, kind: "text", length };
    }
  }
  return rich ?? text;
}

/**
 * A text with its last character replaced by `x`, or by `y` when it is `x` already: an edit the
 * page shows, which keeps the text's length, as the validation harness's `editEverything` makes.
 */
function retyped(text: string): string {
  const characters = Array.from(text);
  characters[Math.max(0, characters.length - 1)] = characters.at(-1) === "x" ? "y" : "x";
  return characters.join("");
}

/**
 * The command that retypes a field's last character (`retyped`): the text of a text field, or
 * the last run with text of a rich one, its marks kept. Throws for a field the document does not
 * have as text or rich text.
 */
export function editCommand(doc: Document, id: string): Command {
  const field = fieldsOf(doc.resume).get(id);
  if (field?.kind === "text")
    return { type: "text", field: id, text: retyped(field.get(doc.resume) ?? "") };
  if (field?.kind !== "rich") throw new Error(`the document has no text or rich field ${id}`);
  const runs: RichText = field.get(doc.resume).map((run) => ({ ...run }));
  let last = runs.length - 1;
  while (last > 0 && runs[last]?.text === "") last--;
  const run = runs[last];
  if (run === undefined) return { type: "rich", field: id, runs: [{ text: "x" }] };
  run.text = retyped(run.text);
  return { type: "rich", field: id, runs };
}

/** The overlay's work on a keystroke in one field, as a median over many runs. */
export interface Keystroke {
  field: string;
  /** How long the field's text is, in UTF-16 units. */
  characters: number;
  /** The rows the layout sets the field in, which are TeX's lines. */
  rows: number;
  /** How many layouts the median was taken over. */
  runs: number;
  /** The median time of one layout, in milliseconds. */
  ms: number;
}

/**
 * Time what the overlay does with a field's text on every keystroke: break it into TeX's lines
 * with the field's fonts and the paragraph TeX set it in, as `Overlay.tsx` does, through
 * `richRows` for a rich field and `layoutRows` for a text one. The faces and the paragraph are
 * worked out once, as the overlay works them out once per page; the layout is timed `runs` times.
 * The DOM work after it, drawing the rows and putting the caret back, is not in it.
 */
export async function keystrokeWork(
  page: DrawnPage,
  resume: Resume,
  fonts: FontLibrary,
  field: MeasuredField,
  runs: number,
): Promise<Keystroke> {
  const layout = page.fields.get(field.id)?.layout;
  const found = fieldsOf(resume).get(field.id);
  if (layout === undefined || found === undefined)
    throw new Error(`the page does not show the field ${field.id}`);
  const setting = settingFor(field.id, layout, page.size.width);
  let lay: () => number;
  if (found.kind === "rich") {
    const text = found.get(resume);
    // As the rich overlay measures each variant: in the font the page sets it in, or the font its
    // family's names give, or the field's letter font.
    const shown = variantFontsOf(page, resume, field.id) ?? new Map<Variant, FieldFont>();
    const named = await namedVariants(shown, layout, (name) => fonts.load(name));
    const faces = richFaces(new Map<Variant, SizedFont>([...named, ...shown]), layout);
    lay = () => richRows(text, faces, setting.params).length;
  } else if (found.kind === "text") {
    const text = found.get(resume) ?? "";
    lay = () => layoutRows(text, setting.face, setting.params).length;
  } else throw new Error(`${field.id} is a ${found.kind} field, which the overlay does not set`);
  const times: number[] = [];
  let rows = 0;
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    rows = lay();
    times.push(performance.now() - started);
  }
  return { field: field.id, characters: field.length, rows, runs, ms: median(times) };
}

/** One edit, from the command to the drawn page, and its parts, in milliseconds. */
export interface EditTime {
  /** The whole: the command applied, the body generated, compiled and drawn. */
  ms: number;
  compileMs: number;
  drawMs: number;
  /** TeX's passes; one, unless the log asked for a rerun. */
  passes: number;
}

/** What `measurePackage` found for a package and its sample. */
export interface PackageNumbers {
  id: string;
  name: string;
  engine: Engine;
  /** The format's dump: how long it took, the format's size, and the TeX Live files it read. */
  dump: { ms: number; bytes: number; read: Fetched };
  /**
   * A new document's compile, the first pass writing the auxiliary files the second reads, and
   * the TeX Live files it read that the dump had not.
   */
  open: { ms: number; passes: number[]; read: Fetched };
  /** The first page's draw, which loads its fonts, and the fonts it could not draw. */
  draw: { ms: number; missingFonts: string[] };
  edits: EditTime[];
  keystroke: Keystroke;
}

/**
 * Measure a package with its sample on a session, as the editor opens and edits a new document
 * with the package's defaults: the format dumped, the sample compiled as a new document and its
 * page drawn, the overlay's layout of the longest field (`keystrokeWork`) timed `runs` times
 * `LAYOUTS_PER_EDIT`, and `runs` edits of that field, each applied to the document, generated,
 * compiled once and drawn. The session and the fonts should be new, so that what the dump, the
 * compile and the draw read is what a first load of the package reads. Throws when the format does
 * not dump, a compile fails, or the page shows no field to edit, with TeX's error for developers.
 */
export async function measurePackage(
  session: EngineSession,
  fonts: FontLibrary,
  pkg: TemplatePackage,
  sample: Resume,
  runs: number,
): Promise<PackageNumbers> {
  if (!Number.isInteger(runs) || runs < 1) throw new Error("runs must be a whole number from 1");
  // A new document with no choices made, as the editor opens one: on the package's defaults.
  const doc = Document.parse({ version: 1, template: pkg.id, resume: sample, controls: {} });
  const format = generateFormat(pkg, doc.controls);
  let started = performance.now();
  const dumped = session.dump(pkg.engine, format.name, format.preamble, format.files);
  const dumpMs = performance.now() - started;
  if (!dumped.ok || dumped.format === undefined)
    throw new Error(`${pkg.id}: the format did not dump: ${dumped.error ?? "no format"}`);
  const compile = (latex: string) =>
    session.compile(pkg.engine, format.name, latex, { job: JOB, maxPasses: MAX_PASSES });

  const body = generateBody(pkg, doc.resume, doc.controls);
  started = performance.now();
  const opened = compile(body.latex);
  const openMs = performance.now() - started;
  if (!opened.ok || opened.output === undefined)
    throw new Error(`${pkg.id}: the sample did not compile: ${opened.error ?? "no output"}`);
  started = performance.now();
  const page = await drawPage(opened.output, fonts, body.texts);
  const drawMs = performance.now() - started;

  const field = longestField(doc.resume, page);
  if (field === undefined) throw new Error(`${pkg.id}: the page shows no field of the sample`);
  const keystroke = await keystrokeWork(page, doc.resume, fonts, field, runs * LAYOUTS_PER_EDIT);

  const edits: EditTime[] = [];
  let current = doc;
  for (let i = 0; i < runs; i++) {
    const began = performance.now();
    current = apply(current, editCommand(current, field.id));
    const edited = generateBody(pkg, current.resume, current.controls);
    const compiling = performance.now();
    const result = compile(edited.latex);
    const drawing = performance.now();
    if (!result.ok || result.output === undefined)
      throw new Error(`${pkg.id}: an edit did not compile: ${result.error ?? "no output"}`);
    await drawPage(result.output, fonts, edited.texts);
    const done = performance.now();
    edits.push({
      ms: done - began,
      compileMs: drawing - compiling,
      drawMs: done - drawing,
      passes: result.passes.length,
    });
  }

  return {
    id: pkg.id,
    name: pkg.name,
    engine: pkg.engine,
    dump: { ms: dumpMs, bytes: dumped.format.length, read: dumped.fetched },
    open: { ms: openMs, passes: opened.passes, read: opened.fetched },
    draw: { ms: drawMs, missingFonts: [...page.missingFonts.keys()] },
    edits,
    keystroke,
  };
}

/** What a first load of a package fetches, in bytes as they are on disk, not compressed. */
export interface FirstLoad {
  /** The engine, `busytex.wasm`, and its loader for the worker, `busytex.mjs`. */
  engine: number;
  loader: number;
  /** The tree's manifest, which the main thread and the worker both read. */
  manifest: number;
  /** The TeX Live files the dump and the first compile read. */
  texLive: number;
  /** The files the page's fonts read that TeX had not: Type 1 outlines, the font map and such. */
  fonts: number;
  total: number;
}

/**
 * What a first load of a package fetches: the engine and its loader, the manifest, the TeX Live
 * files the dump and the new document's compile read, and the files the page's fonts read, by
 * path with their sizes, less those TeX read already, since the worker's reads and the page's go
 * through the same HTTP cache under the same URLs. Everything is counted once, as it is on disk;
 * what goes over the network compressed is the CDN's to say (milestone 5).
 */
export function firstLoad(
  numbers: Pick<PackageNumbers, "dump" | "open">,
  sizes: { engine: number; loader: number; manifest: number },
  fontFiles: ReadonlyMap<string, number>,
): FirstLoad {
  const read = new Set([...numbers.dump.read.paths, ...numbers.open.read.paths]);
  const texLive = numbers.dump.read.bytes + numbers.open.read.bytes;
  let fonts = 0;
  for (const [path, bytes] of fontFiles) if (!read.has(path)) fonts += bytes;
  const total = sizes.engine + sizes.loader + sizes.manifest + texLive + fonts;
  return { ...sizes, texLive, fonts, total };
}

/** A duration for a table: two decimals under 10 ms, whole milliseconds above. */
export function formatMs(ms: number): string {
  return `${ms < 10 ? ms.toFixed(2) : ms.toFixed(0)} ms`;
}

/** A size for a table, in megabytes of a million bytes, as plan section 4.3 counts them. */
export function formatMb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

/** A value in its target's unit. */
export function formatValue(target: Target, value: number): string {
  return target.unit === "ms" ? formatMs(value) : formatMb(value);
}

/** A target's limit as the plan words it: "under 16 ms", "300 ms". */
export function formatLimit(target: Target): string {
  return `${target.under ? "under " : ""}${formatValue(target, target.limit).replace(".00 ", " ")}`;
}

/** Rows of cells as text, each column as wide as its widest cell, two spaces between columns. */
export function table(rows: readonly (readonly string[])[]): string {
  const widths: number[] = [];
  for (const row of rows)
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  return rows
    .map((row) =>
      row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join("  "),
    )
    .join("\n");
}

/** Some files as a table names them: how many, and their bytes. */
const filesOf = (read: Fetched) => `${read.files} files, ${formatMb(read.bytes)}`;

/** The table `scripts/measure.ts` prints for a package. */
export function packageTable(numbers: PackageNumbers, load: FirstLoad): string {
  const { dump, open, draw, edits, keystroke } = numbers;
  const edit = median(edits.map((each) => each.ms));
  const compile = median(edits.map((each) => each.compileMs));
  const drawn = median(edits.map((each) => each.drawMs));
  const slowest = Math.max(...edits.map((each) => each.ms));
  const reran = edits.filter((each) => each.passes > 1).length;
  const parts = [
    `compile ${formatMs(compile)}, draw ${formatMs(drawn)}`,
    `slowest ${formatMs(slowest)}`,
    ...(reran > 0 ? [`${reran} took a second pass`] : []),
  ];
  const undrawn =
    draw.missingFonts.length === 0
      ? "every font drawn"
      : `without ${draw.missingFonts.join(", ")}, which it cannot draw`;
  const loaded = [
    `engine ${formatMb(load.engine)}`,
    `loader ${formatMb(load.loader)}`,
    `manifest ${formatMb(load.manifest)}`,
    `TeX Live ${formatMb(load.texLive)}`,
    `fonts ${formatMb(load.fonts)}`,
  ];
  const passes = open.passes.map(formatMs).join(" + ");
  return table([
    [
      "Format dump",
      formatMs(dump.ms),
      `${formatMb(dump.bytes)} format; read ${filesOf(dump.read)}`,
    ],
    ["New document, two passes", formatMs(open.ms), `${passes}; read ${filesOf(open.read)} more`],
    ["First draw", formatMs(draw.ms), undrawn],
    [`Edit to page, median of ${edits.length}`, formatMs(edit), parts.join("; ")],
    [
      `Keystroke rows, median of ${keystroke.runs}`,
      formatMs(keystroke.ms),
      `${keystroke.field}, ${keystroke.characters} characters on ${keystroke.rows} lines`,
    ],
    ["First load, uncompressed", formatMb(load.total), loaded.join(", ")],
  ]);
}

/** A target, and what each package measured against it. */
export interface Verdict {
  target: Target;
  values: { id: string; value: number; met: boolean }[];
}

/**
 * Each target against each package's numbers: the keystroke's layout, the median edit for both
 * edit targets, and the first load. The edit is the page's own time, from the command to the drawn
 * page; the scheduler's pause before it, which waits for the typing to stop, is not in it, as it
 * was not in decision 0003's numbers.
 */
export function verdicts(measured: readonly { numbers: PackageNumbers; load: FirstLoad }[]) {
  const against = (target: Target, value: (each: (typeof measured)[number]) => number) => ({
    target,
    values: measured.map((each) => {
      const found = value(each);
      return { id: each.numbers.id, value: found, met: meets(target, found) };
    }),
  });
  const edit = ({ numbers }: (typeof measured)[number]) =>
    median(numbers.edits.map((each) => each.ms));
  return [
    against(TARGETS.keystroke, ({ numbers }) => numbers.keystroke.ms),
    against(TARGETS.typical, edit),
    against(TARGETS.slowLaptop, edit),
    against(TARGETS.firstLoad, ({ load }) => load.total),
  ] satisfies Verdict[];
}

/** The summary `scripts/measure.ts` prints: a row per target, a column per package. */
export function summaryTable(rows: readonly Verdict[]): string {
  const ids = rows[0]?.values.map((each) => each.id) ?? [];
  return table([
    ["Target", "Limit", ...ids],
    ...rows.map(({ target, values }) => [
      target.path,
      formatLimit(target),
      ...values.map(({ value, met }) => `${formatValue(target, value)} ${met ? "met" : "missed"}`),
    ]),
  ]);
}
