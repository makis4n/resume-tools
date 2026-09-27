/**
 * Validation (milestone 3 item 7, plan section 6 step 5, decision 0026): an assembled package and
 * document compiled and checked, and assembled again with what the checks decide. Browser-safe: the
 * caller brings the engine session and the fonts, as the harness's caller does (plan section 5.7).
 *
 * Every compile is in the `import` job, from the package's format, dumped once for each format a
 * value names, or whole from the stock format where the preamble cannot be dumped, as a XeTeX one
 * that loads fontspec cannot until item 8 rewrites it; with the job's files the reference compile
 * had (decision 0019). The four checks of plan section 6 step 5, each bisected as the probe bisects
 * (`settle`, decision 0022):
 *
 * 1. **Same output.** The original body, compiled from the package's format, must set the
 *    reference's page, its glyphs, rules, colours, images and size: the preamble's rewrite changes
 *    hyperref's driver and bookmarks and nothing on the page. A redefinition or a control's default
 *    that moves it is dropped. Then the body the generator makes of the document must set exactly
 *    what that original body sets, the editor's markers aside (`sameGlyphs`); where it does not,
 *    the fields whose regeneration moves it are found and locked, their original bytes in their
 *    node's extras (`differs`); a difference that no field explains, which the document with every
 *    field locked shows too, leaves the import `partial`, with the first difference.
 * 2. **Mutations.** Every editable field set to a long text, then empty, then special characters,
 *    three compiles, bisected to the slot that stops the compile: one that stops only when empty is
 *    required, one that stops on text is locked in every instance (`text`).
 * 3. **Repeatable units.** An entry, a bullet, an item, a labelled item and a link, of each kind the
 *    document has, added as a copy of the first with the editor's placeholder texts, and the first
 *    removed, each compiled.
 * 4. **Controls.** Each control's every value but the document's compiled: one that stops the
 *    compile at a value, or sets the same page at one, is dropped.
 *
 * Then the harness (`validatePackage`) runs on the package and the document; a `fields` or
 * `alignment` finding on a field locks it, once, and the checks run again; any other finding is
 * recorded for item 13's report.
 */

import type { NamingAnswer } from "@resume-tools/naming";
import type { Resume, RichText } from "@resume-tools/resume-model";
import { mintId, PLACEHOLDERS } from "../editor/document";
import type { CompileResult, EngineSession, JobFiles } from "../engine/session";
import type { FontLibrary } from "../page/fonts";
import { type GeneratedBody, generateBody, generateFormat } from "../templates/generate";
import { type ControlValues, fontFiles, type TemplatePackage } from "../templates/package";
import { MARKER_BEGIN, markerId } from "../tex/fields";
import { editEverything, type Finding, validatePackage } from "../validate/harness";
import {
  type Assembled,
  type AssembledField,
  assemble,
  type ControlName,
  type Decisions,
  hyperrefLines,
  type LockReason,
  loadsHyperref,
  takenOut,
  type XetexRewrite,
} from "./assemble";
import type { Candidate } from "./candidates";
import { type ImportedResume, type ImportedSection, isLocked } from "./imported";
import { encodeLike, type Intake } from "./intake";
import { bodyOf, type Tree } from "./parse";
import { type CompileSet, type Probe, probeOrder, type SetResult, settle } from "./probe";
import {
  compileLikeReference,
  type Difference,
  difference,
  type GlyphStream,
  IMPORT_JOB,
  type Reference,
  type ReferenceItem,
  readOutput,
  referenceFiles,
  shippedFont,
} from "./reference";
import { type Refusal, refusal } from "./refusal";
import { renderImported } from "./render";
import type { EngineSignatures } from "./signatures";

/** What validation takes: the import's inputs, and the session and fonts to compile and read with. */
export interface ValidationInputs {
  session: EngineSession;
  fonts: FontLibrary;
  intake: Intake;
  reference: Reference;
  tree: Tree;
  signatures: EngineSignatures;
  probe: Probe;
  answer: NamingAnswer;
  rewrite?: XetexRewrite;
  treeImage?: (name: string) => Uint8Array | undefined;
  /** The job the compiles run in; `import` by default, forgotten after. */
  job?: string;
  /** How many compiles each bisection may make; 48 by default. */
  budget?: number;
  /** Whether the harness runs; true by default. */
  harness?: boolean;
}

/** How many compiles one bisection of a check may make, as the probe's budget bounds its own. */
export const CHECK_BUDGET = 48;

/** The texts check 2 sets every editable field to: long, empty, and characters TeX reads. */
export const MUTATIONS = {
  long: "Invented words for a long field ".repeat(10).slice(0, 300),
  empty: "",
  special: "\\ { } $ & # ^ _ % ~ < > | [ ] * -- ' \" é ß ø ω Ж ğ",
} as const;

/** The accent check 4 tries, a dark blue, or black where the document's accent is that blue. */
const PROBE_ACCENT = "#1F4E79";

// Compiling.

/** A compile of an assembled document, and what it set. */
export interface Compiled {
  result?: CompileResult;
  body: GeneratedBody;
  stream?: GlyphStream;
  /** It stopped, or its output could not be read. */
  broke: boolean;
}

/**
 * What the checks compile through: the engine's session, in `validate`; a fake that reads the
 * LaTeX, in the checks' unit tests.
 */
export interface Compiler {
  /** How many compiles it has made. */
  readonly count: number;
  /** The original as the reference compiled it, with the rewrite's hyperref lines. */
  like(): Promise<{ stream: GlyphStream } | Refusal>;
  /** LaTeX compiled after a package's preamble, from its format where it dumps. */
  latex(pkg: TemplatePackage, values: ControlValues, latex: string): Promise<Compiled>;
  /** An imported document compiled through its package, as the generator will set it. */
  document(pkg: TemplatePackage, resume: ImportedResume, values?: ControlValues): Promise<Compiled>;
}

/**
 * The compiles of a validation, counted: from each format the package's values name, dumped once,
 * or whole where it will not dump, or where the probe found the document's own format did not set
 * the reference's glyphs (`whole`, decision 0022); in the job, with the reference's files.
 */
class Compiles implements Compiler {
  count = 0;
  ms = 0;
  private readonly dumped = new Map<string, boolean>();

  constructor(
    private readonly inputs: ValidationInputs,
    readonly job: string,
    readonly files: Record<string, Uint8Array>,
    readonly whole = false,
  ) {}

  /** The files of a package as the job takes them, beside the reference's. */
  private withPackage(pkg: TemplatePackage): JobFiles {
    const files: JobFiles = { ...this.files };
    for (const [name, text] of Object.entries(pkg.files)) files[name] = text;
    return files;
  }

  /** A body of LaTeX compiled with a package's preamble, and its output read. */
  async latex(pkg: TemplatePackage, values: ControlValues, latex: string): Promise<Compiled> {
    const { session, fonts } = this.inputs;
    const format = generateFormat(pkg, values);
    let dumped = this.whole ? false : this.dumped.get(format.name);
    if (dumped === undefined) {
      try {
        const result = session.dump(
          pkg.engine,
          format.name,
          format.preamble,
          this.withPackage(pkg),
        );
        this.ms += result.ms;
        dumped = result.ok;
      } catch {
        dumped = false;
      }
      this.dumped.set(format.name, dumped);
    }
    const body: GeneratedBody = { latex, texts: new Map(), dropped: [], surplus: [] };
    let result: CompileResult;
    try {
      this.count++;
      result = dumped
        ? session.compile(pkg.engine, format.name, latex, {
            job: this.job,
            maxPasses: 3,
            files: this.files,
          })
        : // A preamble that does not dump, as a XeTeX one that loads fontspec until item 8's
          // rewrite declares its fonts by file (TODO(merge)), compiles whole, finding its fonts by
          // name as the reference compile did.
          session.compile(pkg.engine, "stock", `${format.preamble}\n${latex}`, {
            job: this.job,
            maxPasses: 3,
            files: this.withPackage(pkg),
            fontsByName: pkg.engine === "xetex",
          });
    } catch {
      return { body, broke: true };
    }
    this.ms += result.passes.reduce((sum, pass) => sum + pass, 0);
    if (!result.ok || result.output === undefined) return { result, body, broke: true };
    try {
      const { stream } = await readOutput(fonts, result.output, (path) =>
        shippedFont(this.files, this.job, path),
      );
      return { result, body, stream, broke: false };
    } catch {
      return { result, body, broke: true };
    }
  }

  /** An imported document compiled through its package, as the generator will set it. */
  async document(
    pkg: TemplatePackage,
    resume: ImportedResume,
    values: ControlValues = {},
  ): Promise<Compiled> {
    let body: GeneratedBody;
    try {
      body = renderImported(pkg, resume, values, await this.covers(pkg));
    } catch {
      return { body: { latex: "", texts: new Map(), dropped: [], surplus: [] }, broke: true };
    }
    const compiled = await this.latex(pkg, values, body.latex);
    return { ...compiled, body };
  }

  like() {
    return likeReference(this.inputs, this);
  }

  /** What a XeTeX package's fonts can set, as the editor leaves out the rest. */
  async covers(pkg: TemplatePackage) {
    const files = fontFiles(pkg);
    if (files.length === 0) return {};
    return { covers: (await this.inputs.fonts.coverage(files)).covers };
  }
}

// Comparing.

/**
 * A glyph stream's glyphs and rules alone, which hyperref's driver and bookmarks, the one change the
 * rewrite makes to the original's compile, must leave where they were: its specials, which the
 * driver writes otherwise, left aside.
 */
export function glyphsOnly(stream: GlyphStream): GlyphStream {
  return {
    ...stream,
    pages: stream.pages.map((page) => ({
      items: page.items.filter((item) => item.kind !== "special"),
    })),
  };
}

/** The field whose begin marker comes last before where a stream parts from another. */
function suspectOf(stream: GlyphStream, differs: Difference | undefined): string | undefined {
  if (differs?.page === undefined) return undefined;
  const items: readonly ReferenceItem[] = stream.pages[differs.page]?.items ?? [];
  const found = differs.item === undefined ? -1 : items.indexOf(differs.item);
  for (let at = found < 0 ? items.length - 1 : found; at >= 0; at--) {
    const item = items[at];
    const id = item?.kind === "special" ? markerId(item.text, MARKER_BEGIN) : undefined;
    if (id !== undefined) return id;
  }
  return undefined;
}

/** A switch the bisection turns on or off, as the probe's candidates are, grouped by its slot. */
function switchOf(id: string, slot: string): Candidate {
  return {
    id,
    kind: "argument",
    where: "body",
    of: "call",
    name: slot,
    index: 1,
    start: 0,
    end: 0,
    text: "",
    empty: false,
  };
}

/** Where a field is locked: alone where its node keeps extras, else its list with it. */
const lockOf = (field: AssembledField) => (field.lockable ? field.at : (field.list ?? field.at));

// Mutating.

/** A copy of a resume with each of `fields` set to `text`, a rich field to one run of it. */
function mutated(resume: ImportedResume, fields: readonly AssembledField[], text: string) {
  const copy = structuredClone(resume);
  const byField = new Map(fields.map((field) => [field.field, field]));
  const rich = (value: string): RichText => (value === "" ? [] : [{ text: value }]);
  const set = (id: string, apply: (field: AssembledField) => void) => {
    const field = byField.get(id);
    if (field !== undefined) apply(field);
  };
  const header = copy.header;
  for (const slot of ["first", "last", "headline", "email", "phone", "location"] as const)
    set(`header.${slot}`, () => {
      if (slot === "first" || slot === "last") header.name[slot] = text;
      else header[slot] = text;
    });
  for (const link of header.links) set(`${link.id}.label`, () => (link.label = text));
  for (const section of copy.sections) {
    if (isLocked(section)) continue;
    set(`${section.id}.title`, () => (section.title = text));
    switch (section.kind) {
      case "entries":
        for (const entry of section.entries) {
          set(`${entry.id}.title`, () => (entry.title = text));
          set(`${entry.id}.subtitle`, () => (entry.subtitle = text));
          set(`${entry.id}.place`, () => (entry.place = text));
          for (const bullet of entry.bullets)
            set(`${bullet.id}.text`, () => (bullet.text = rich(text)));
        }
        break;
      case "list":
        for (const item of section.items) set(`${item.id}.text`, () => (item.text = rich(text)));
        break;
      case "labelled":
        for (const item of section.items) {
          set(`${item.id}.label`, () => (item.label = text));
          set(`${item.id}.text`, () => (item.text = rich(text)));
        }
        break;
      case "paragraph":
        set(`${section.id}.text`, () => (section.text = rich(text)));
        break;
    }
  }
  return copy;
}

/** Every id a resume holds, which a new node's id must not be. */
function idsOf(resume: ImportedResume): Set<string> {
  const ids = new Set<string>();
  for (const link of resume.header.links) ids.add(link.id);
  for (const section of resume.sections) {
    ids.add(section.id);
    if (section.kind === "entries")
      for (const entry of section.entries) {
        ids.add(entry.id);
        for (const bullet of entry.bullets) ids.add(bullet.id);
      }
    else if (section.kind === "list" || section.kind === "labelled")
      for (const item of section.items) ids.add(item.id);
  }
  return ids;
}

/** The kinds of repeatable unit check 3 adds and removes. */
type UnitKind = "entry" | "bullet" | "item" | "labelledItem" | "link";

/**
 * A copy of a resume with a unit of `kind` added, a copy of the first with the editor's
 * placeholder texts and a new id, or the first removed; undefined when the resume has none.
 */
function withUnit(
  resume: ImportedResume,
  kind: UnitKind,
  how: "add" | "remove",
): ImportedResume | undefined {
  const copy = structuredClone(resume);
  const taken = idsOf(copy);
  const sections = copy.sections.filter(
    (section): section is Exclude<ImportedSection, { kind: "locked" }> => !isLocked(section),
  );
  const change = <T>(list: T[], make: (first: T) => T) => {
    const first = list[0];
    if (first === undefined) return false;
    if (how === "add") list.push(make(first));
    else list.shift();
    return true;
  };
  switch (kind) {
    case "entry": {
      const section = sections.find((each) => each.kind === "entries" && each.entries.length > 0);
      if (section?.kind !== "entries") return undefined;
      const { title, subtitle, place } = PLACEHOLDERS.entry;
      return change(section.entries, (first) => ({
        ...structuredClone(first),
        id: mintId("ent", taken),
        title,
        ...(first.subtitle === undefined ? {} : { subtitle }),
        ...(first.place === undefined ? {} : { place }),
        bullets: first.bullets.map(() => ({
          id: mintId("bul", taken),
          text: [{ text: PLACEHOLDERS.bullet }],
        })),
      }))
        ? copy
        : undefined;
    }
    case "bullet": {
      for (const section of sections)
        if (section.kind === "entries")
          for (const entry of section.entries)
            if (entry.bullets.length > 0) {
              change(entry.bullets, () => ({
                id: mintId("bul", taken),
                text: [{ text: PLACEHOLDERS.bullet }],
              }));
              return copy;
            }
      return undefined;
    }
    case "item": {
      const section = sections.find((each) => each.kind === "list" && each.items.length > 0);
      if (section?.kind !== "list") return undefined;
      change(section.items, () => ({
        id: mintId("itm", taken),
        text: [{ text: PLACEHOLDERS.item }],
      }));
      return copy;
    }
    case "labelledItem": {
      const section = sections.find((each) => each.kind === "labelled" && each.items.length > 0);
      if (section?.kind !== "labelled") return undefined;
      const { label, text } = PLACEHOLDERS.labelledItem;
      change(section.items, () => ({ id: mintId("itm", taken), label, text: [{ text }] }));
      return copy;
    }
    case "link":
      return change(copy.header.links, (first) => ({
        ...first,
        id: mintId("lnk", taken),
        label: PLACEHOLDERS.link.label,
      }))
        ? copy
        : undefined;
  }
}

/** The values check 4 tries of a control: every value but the document's. */
function valuesOf(pkg: TemplatePackage, name: ControlName, chosen: ControlValues): ControlValues[] {
  const control = pkg.controls[name];
  if (control === undefined) return [];
  const other = <T>(values: readonly T[], current: T) =>
    values.filter((value) => value !== current);
  switch (name) {
    case "pageSize":
      return other(
        ["letter", "a4"] as const,
        chosen.pageSize ?? pkg.controls.pageSize?.default,
      ).map((pageSize) => ({ ...chosen, pageSize }));
    case "margins":
      return other(
        [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
        chosen.margins ?? pkg.controls.margins?.default,
      ).map((margins) => ({ ...chosen, margins }));
    case "fontSize":
      return other(
        [9, 9.5, 10, 10.5, 11, 11.5, 12],
        chosen.fontSize ?? pkg.controls.fontSize?.default,
      ).map((fontSize) => ({ ...chosen, fontSize }));
    case "font":
      return other(
        (pkg.controls.font?.choices ?? []).map((choice) => choice.id),
        chosen.font ?? pkg.controls.font?.default,
      ).map((font) => ({ ...chosen, font }));
    case "accent": {
      const blue =
        (chosen.accent ?? pkg.controls.accent?.default ?? "").toUpperCase() === PROBE_ACCENT;
      return [{ ...chosen, accent: blue ? "#000000" : PROBE_ACCENT }];
    }
    case "density":
      return other(
        ["compact", "normal", "relaxed"] as const,
        chosen.density ?? pkg.controls.density?.default,
      ).map((density) => ({ ...chosen, density }));
  }
}

/** A value of a control as a line of the checks shows it. */
const shownValue = (values: ControlValues, name: ControlName) => `${name} ${String(values[name])}`;

// The harness.

/** An imported resume as the generator of this branch takes it: its locked sections out. */
const lowered = (resume: ImportedResume): Resume => ({
  ...resume,
  sections: resume.sections.filter((section) => !isLocked(section)) as Resume["sections"],
});

/**
 * The session the harness compiles through: the job's files given to every dump and compile, as
 * the harness gives only the package's; the stand-ins of the upload's images listed for its PDF;
 * and, until part A's generator renders locked sections and extras (TODO(merge)), each body the
 * harness generates from the resume with its locked sections out replaced by the body
 * `renderImported` composes of the whole, found by the text the harness generated.
 */
function harnessSession(
  session: EngineSession,
  files: Record<string, Uint8Array>,
  images: readonly string[],
  bodies: ReadonlyMap<string, string>,
): EngineSession {
  const proxy = Object.create(session) as EngineSession;
  proxy.dump = (engine, name, preamble, own = {}) =>
    session.dump(engine, name, preamble, { ...files, ...own });
  proxy.compile = (engine, format, body, options = {}) =>
    session.compile(engine, format, typeof body === "string" ? (bodies.get(body) ?? body) : body, {
      ...options,
      files: { ...files, ...(options.files ?? {}) },
    });
  proxy.pdf = (job, options = {}) =>
    session.pdf(job, { ...options, images: [...(options.images ?? []), ...images] });
  return proxy;
}

/** The control values the harness's controls check tries, as its `probesOf` gives them. */
function harnessValues(pkg: TemplatePackage, chosen: ControlValues): ControlValues[] {
  const found: ControlValues[] = [chosen];
  for (const name of ["pageSize", "margins", "fontSize", "font", "accent", "density"] as const) {
    if (pkg.controls[name] === undefined) continue;
    if (name === "margins") {
      const wide = (chosen.margins ?? pkg.controls.margins?.default ?? 1) < 1;
      found.push({ ...chosen, margins: wide ? 1 : 0.4 });
    } else if (name === "fontSize")
      found.push({ ...chosen, fontSize: chosen.fontSize === 12 ? 11.5 : 12 });
    else found.push(...valuesOf(pkg, name, chosen));
  }
  if (pkg.controls.dateFormat !== undefined) {
    const years = chosen.dateFormat === "yyyy";
    found.push({ ...chosen, dateFormat: years ? "MMM yyyy" : "yyyy" });
  }
  return found;
}

/**
 * The original compiled as the reference was (`compileLikeReference`), but with the two lines the
 * rewrite gives hyperref (`hyperrefLines`): the one change of the rewrite that moves specials and
 * no glyph, which the rest of the rewrite is then held to exactly.
 */
async function likeReference(
  inputs: ValidationInputs,
  compiles: Compiles,
): Promise<{ stream: GlyphStream } | Refusal> {
  const { intake, reference } = inputs;
  const body = bodyOf(intake);
  if ("refused" in body) return body;
  const lines = hyperrefLines(reference.engine, loadsHyperref(reference));
  const text = `${lines.before}\n${body.preamble}\n${lines.after}\n${intake.main.text.slice(body.preamble.length)}`;
  const bytes = encodeLike(intake.main.bytes, text) ?? new TextEncoder().encode(text);
  compiles.count++;
  const compiled = await compileLikeReference(
    inputs.session,
    inputs.fonts,
    intake,
    reference,
    bytes,
    {
      job: compiles.job,
      ...(inputs.treeImage === undefined ? {} : { treeImage: inputs.treeImage }),
    },
  );
  if ("refused" in compiled) return compiled;
  compiles.ms += compiled.passes.reduce((sum, pass) => sum + pass, 0);
  return { stream: compiled.stream };
}

// The checks.

/** What one round of the checks decided, and found. */
interface Round {
  assembled: Assembled;
  decisions: Decisions;
  outcome: "assembled" | "partial";
  difference?: { kind: string; text: string };
  repeatable: { kind: string; added: boolean; removed: boolean }[];
  dropped: { control: string; why: string }[];
  findings: Finding[];
}

/**
 * Validate an import (decision 0026): assemble it, or take the assembly given, run the four
 * checks and the harness, and assemble it again with what they decided; or refuse it, for a font
 * the page cannot draw, or an assembly that refuses. The result's `checks` carry what item 13
 * reports: the fields editable and locked, with why and how many words, the required slots, the
 * controls proven and dropped, the redefinitions dropped, the harness's findings, and the compiles
 * and time the checks took.
 */
export async function validate(inputs: ValidationInputs): Promise<Assembled | Refusal> {
  const job = inputs.job ?? IMPORT_JOB;
  const { session, fonts, reference } = inputs;
  // A font the page cannot draw: an import keeps its fonts, so the document is refused, naming it.
  for (const name of reference.fonts.tex) {
    let missing: string | undefined;
    try {
      missing = (await fonts.load(name))?.missing;
    } catch {
      missing = "unreadable";
    }
    if (missing !== undefined && !reference.fonts.shipped.includes(name))
      return refusal("font", name);
  }
  const files = referenceFiles(inputs.intake, reference, {
    job,
    ...(inputs.treeImage === undefined ? {} : { treeImage: inputs.treeImage }),
  });
  // Where the document's own format did not set its reference's glyphs, the probe compiled it
  // whole, and so do the checks: the package's format is the same preamble, rewritten.
  const compiles = new Compiles(inputs, job, files, inputs.probe.fallback === "baseline");
  session.forget(job);
  try {
    return await validateWith(inputs, compiles, (assembled) =>
      harnessOf(inputs, compiles, assembled),
    );
  } finally {
    session.forget(job);
  }
}

/**
 * The checks' rounds through `compiler`: the four checks and `harness`, then, where the harness
 * finds a field unmarked or misaligned, the field locked and the checks run again, once.
 */
export async function validateWith(
  inputs: Omit<ValidationInputs, "session" | "fonts">,
  compiler: Compiler,
  harness?: (assembled: Assembled) => Promise<Finding[]>,
): Promise<Assembled | Refusal> {
  const started = performance.now();
  const assembleWith = (decisions: Decisions) =>
    assemble(
      inputs.intake,
      inputs.reference,
      inputs.tree,
      inputs.signatures,
      inputs.probe,
      inputs.answer,
      inputs.rewrite,
      { decisions },
    );
  const harnessed = inputs.harness === false ? undefined : harness;
  let round = await checks(inputs, compiler, assembleWith, {}, harnessed);
  if ("refused" in round) return round;
  // A field the harness finds unmarked or misaligned is locked, once, and the checks run again.
  const lockable = new Map(round.assembled.checks.all.map((field) => [field.field, field]));
  const locks: Record<string, LockReason> = {};
  for (const finding of round.findings) {
    if (finding.check !== "fields" && finding.check !== "alignment") continue;
    const field = finding.field === undefined ? undefined : lockable.get(finding.field);
    if (field !== undefined && field.mode !== "locked") locks[lockOf(field)] = finding.check;
  }
  if (Object.keys(locks).length > 0) {
    const again = await checks(
      inputs,
      compiler,
      assembleWith,
      { ...round.decisions, instances: { ...(round.decisions.instances ?? {}), ...locks } },
      harnessed,
    );
    if ("refused" in again) return again;
    round = again;
  }
  const { assembled } = round;
  return {
    ...assembled,
    checks: {
      ...assembled.checks,
      outcome: round.outcome,
      ...(round.difference === undefined ? {} : { difference: round.difference }),
      controls: {
        ...assembled.checks.controls,
        proven: assembled.checks.controls.offered,
        dropped: round.dropped,
      },
      repeatable: round.repeatable,
      findings: round.findings,
      compiles: compiler.count,
      ms: performance.now() - started,
    },
  };
}

/**
 * The harness on an assembled package and document (`validatePackage`), through the session that
 * gives it the job's files and, until part A's generator renders locked sections and extras
 * (TODO(merge)), the bodies `renderImported` composes (`harnessSession`).
 */
async function harnessOf(
  inputs: ValidationInputs,
  compiles: Compiles,
  assembled: Assembled,
): Promise<Finding[]> {
  const pkg = assembled.package;
  const resume = assembled.document.resume;
  const covers = await compiles.covers(pkg);
  const bodies = new Map<string, string>();
  for (const values of harnessValues(pkg, {}))
    for (const variant of [resume, editEverything(resume as Resume) as ImportedResume]) {
      try {
        const low = generateBody(pkg, lowered(variant), values, covers).latex;
        bodies.set(low, renderImported(pkg, variant, values, covers).latex);
      } catch {
        // A body the generator cannot make is the harness's to report.
      }
    }
  const images = [
    ...inputs.intake.images.replaced.map((image) => image.path),
    ...inputs.reference.images.map((image) => image.path),
  ];
  const report = await validatePackage(
    harnessSession(inputs.session, compiles.files, images, bodies),
    inputs.fonts,
    pkg,
    lowered(resume),
    {},
    compiles.job,
  );
  compiles.count += report.passes.length;
  inputs.session.forget(compiles.job);
  return report.findings;
}

/** One round of the four checks and the harness, from `decisions`. */
async function checks(
  inputs: Omit<ValidationInputs, "session" | "fonts">,
  compiles: Compiler,
  assembleWith: (decisions: Decisions) => Promise<Assembled | Refusal>,
  start: Decisions,
  harness: ((assembled: Assembled) => Promise<Finding[]>) | undefined,
): Promise<Round | Refusal> {
  const budget = inputs.budget ?? CHECK_BUDGET;
  const setters = takenOut(inputs.intake, inputs.signatures, inputs.answer, inputs.rewrite);
  let decisions: Required<Decisions> = {
    dropped: [...(start.dropped ?? [])],
    controls: [...(start.controls ?? [])],
    instances: { ...(start.instances ?? {}) },
    slots: { ...(start.slots ?? {}) },
    required: [...(start.required ?? [])],
  };
  const initial = await assembleWith(decisions);
  if ("refused" in initial) return initial;
  let assembled: Assembled = initial;

  // The original body from the package's format: the setters issued, then the body as it stands.
  const original = async (from: Assembled) => {
    const pkg = from.package;
    const controls = generateBody(
      { ...pkg, snippets: { ...pkg.snippets, document: "" } },
      { version: 1, header: { name: { first: "", last: "" }, links: [] }, sections: [] },
      {},
    ).latex;
    const at = pkg.snippets.document.startsWith("\\catcode`\\@=")
      ? "\\catcode`\\@=\\csname import@at\\endcsname\\relax\n"
      : "";
    const latex = `${controls}${at}${setters.join("\n")}\n\\begin{document}${inputs.tree.source}\\end{document}\n`;
    return compiles.latex(pkg, {}, latex);
  };
  // The original as the reference compiled it, with hyperref's driver and bookmarks as the rewrite
  // has them: its glyphs must be the reference's, and it is what the rest of the rewrite must keep,
  // every special included.
  const liked = await compiles.like();
  let outcome: Round["outcome"] = "assembled";
  let differs: Round["difference"];
  if ("refused" in liked) return liked;
  const drift = difference(glyphsOnly(inputs.reference), glyphsOnly(liked.stream));
  if (drift !== undefined) {
    outcome = "partial";
    differs = { kind: drift.kind, text: drift.text };
  }
  const keeps = (compiled: { broke: boolean; stream?: GlyphStream }) =>
    !compiled.broke &&
    compiled.stream !== undefined &&
    difference(liked.stream, compiled.stream) === undefined;

  // 1. The rewrite keeps the page: each redefinition and each control that moves it dropped.
  let target = await original(assembled);
  if (!keeps(target)) {
    const applied = assembled.checks.redefinitions.applied;
    const offered = assembled.checks.controls.offered.filter(
      (name) => name === "margins" || name === "accent" || name === "font" || name === "density",
    );
    const bare = await assembleWith({ ...decisions, dropped: applied, controls: offered });
    if (!("refused" in bare) && keeps(await original(bare))) {
      const culprits: string[] = [];
      const controlCulprits: ControlName[] = [];
      for (const name of applied) {
        const one = await assembleWith({
          ...decisions,
          dropped: applied.filter((each) => each !== name),
          controls: offered,
        });
        if (!("refused" in one) && !keeps(await original(one))) culprits.push(name);
      }
      for (const name of offered) {
        const one = await assembleWith({
          ...decisions,
          dropped: applied,
          controls: offered.filter((each) => each !== name),
        });
        if (!("refused" in one) && !keeps(await original(one))) controlCulprits.push(name);
      }
      decisions = {
        ...decisions,
        dropped: [...decisions.dropped, ...culprits],
        controls: [...decisions.controls, ...controlCulprits],
      };
      const next = await assembleWith(decisions);
      if ("refused" in next) return next;
      assembled = next;
      target = await original(assembled);
    }
    if (!keeps(target)) {
      outcome = "partial";
      const found =
        target.stream === undefined ? undefined : difference(liked.stream, target.stream);
      differs ??=
        found === undefined
          ? { kind: "stopped", text: "the original body stopped" }
          : { kind: found.kind, text: found.text };
    }
  }
  if (target.broke || target.stream === undefined)
    return refusal("stopped", undefined, target.result?.log);
  const goal = target.stream;

  // 1. Same output: the document's body sets what the original body sets.
  const same = async (from: Assembled) => {
    const compiled = await compiles.document(from.package, from.document.resume);
    const found = compiled.stream === undefined ? undefined : difference(goal, compiled.stream);
    return { compiled, found, same: !compiled.broke && found === undefined };
  };
  let first = await same(assembled);
  if (!first.same) {
    const fields = assembled.checks.all.filter((field) => field.mode !== "locked");
    const switches = [...new Set(fields.map(lockOf))];
    const slotOf = new Map(fields.map((field) => [lockOf(field), field.slot]));
    const switchOfField = new Map(fields.map((field) => [field.field, lockOf(field)]));
    const lockAll = (ids: readonly string[], reason: LockReason) =>
      Object.fromEntries(ids.map((id) => [id, reason]));
    const bottom = await assembleWith({
      ...decisions,
      instances: { ...decisions.instances, ...lockAll(switches, "differs") },
    });
    if ("refused" in bottom) return bottom;
    const floor = await same(bottom);
    if (!floor.same) {
      outcome = "partial";
      differs ??= floor.found
        ? { kind: floor.found.kind, text: floor.found.text }
        : { kind: "stopped", text: "the document with every field locked stopped" };
    } else {
      const candidates = switches.map((id) => switchOf(id, slotOf.get(id) ?? id));
      const compileSet: CompileSet = async (set): Promise<SetResult> => {
        const on = new Set(set.map((each) => each.id));
        const off = switches.filter((id) => !on.has(id));
        const tried = await assembleWith({
          ...decisions,
          instances: { ...decisions.instances, ...lockAll(off, "differs") },
        });
        if ("refused" in tried) return { broke: true, same: false, torn: false, own: new Map() };
        const result = await same(tried);
        const suspect =
          result.compiled.stream === undefined
            ? undefined
            : suspectOf(result.compiled.stream, result.found);
        const named = suspect === undefined ? undefined : switchOfField.get(suspect);
        return {
          broke: result.compiled.broke,
          same: result.same,
          ...(result.found === undefined ? {} : { difference: result.found.kind }),
          torn: false,
          own: new Map(set.map((each) => [each.id, { ok: true }])),
          ...(named === undefined ? {} : { suspects: [named] }),
        };
      };
      const settled = await settle(probeOrder(candidates), compileSet, budget);
      const locked: Record<string, LockReason> = {};
      for (const [id, { verdict }] of settled.verdicts)
        if (verdict !== "editable") locked[id] = verdict === "untested" ? "untested" : "differs";
      decisions = { ...decisions, instances: { ...decisions.instances, ...locked } };
      const next = await assembleWith(decisions);
      if ("refused" in next) return next;
      assembled = next;
      first = await same(assembled);
      if (!first.same) {
        outcome = "partial";
        differs ??= first.found
          ? { kind: first.found.kind, text: first.found.text }
          : { kind: "stopped", text: "the document stopped" };
      }
    }
  }

  // A document that does not compile as it stands tells the other checks nothing.
  if (first.compiled.broke) {
    return {
      assembled,
      decisions,
      outcome: "partial",
      difference: differs ?? { kind: "stopped", text: "the document stopped" },
      repeatable: [],
      dropped: [],
      findings: [],
    };
  }

  // 2. Mutations: long, empty and special texts in every editable field, bisected by slot.
  const editable = assembled.checks.all.filter(
    (field) => field.mode === "typeset" && field.type !== "date",
  );
  const slots = [...new Set(editable.map((field) => field.slot))];
  const breaks = async (text: string, only?: ReadonlySet<string>) => {
    const chosen = editable.filter((field) => only === undefined || only.has(field.slot));
    const resume = mutated(assembled.document.resume, chosen, text);
    return (await compiles.document(assembled.package, resume)).broke;
  };
  const failing = async (text: string): Promise<Set<string>> => {
    if (slots.length === 0 || !(await breaks(text))) return new Set();
    const settled = await settle(
      probeOrder(slots.map((slot) => switchOf(slot, slot))),
      async (set) => ({
        broke: await breaks(text, new Set(set.map((each) => each.id))),
        same: true,
        torn: false,
        own: new Map(set.map((each) => [each.id, { ok: true }])),
      }),
      budget,
    );
    return new Set(
      [...settled.verdicts].filter(([, { verdict }]) => verdict !== "editable").map(([id]) => id),
    );
  };
  const onText = new Set([
    ...(await failing(MUTATIONS.long)),
    ...(await failing(MUTATIONS.special)),
  ]);
  const onEmpty = await failing(MUTATIONS.empty);
  if (onText.size > 0 || onEmpty.size > 0) {
    decisions = {
      ...decisions,
      slots: {
        ...decisions.slots,
        ...Object.fromEntries([...onText].map((slot) => [slot, "text" as const])),
      },
      required: [
        ...new Set([...decisions.required, ...[...onEmpty].filter((slot) => !onText.has(slot))]),
      ],
    };
    const next = await assembleWith(decisions);
    if ("refused" in next) return next;
    assembled = next;
  }

  // 3. Repeatable units: of each kind the document has, one added and the first removed.
  const repeatable: Round["repeatable"] = [];
  for (const kind of ["entry", "bullet", "item", "labelledItem", "link"] as const) {
    const added = withUnit(assembled.document.resume, kind, "add");
    const removed = withUnit(assembled.document.resume, kind, "remove");
    if (added === undefined || removed === undefined) continue;
    repeatable.push({
      kind,
      added: !(await compiles.document(assembled.package, added)).broke,
      removed: !(await compiles.document(assembled.package, removed)).broke,
    });
  }

  // 4. Controls: every value but the document's compiles, and one changes the page at least, or the
  // control goes: one that stops the compile at any value, or sets the same page at every one.
  const baseline = await compiles.document(assembled.package, assembled.document.resume);
  const dropped: Round["dropped"] = [];
  for (const name of assembled.checks.controls.offered) {
    let changes = false;
    let stops: ControlValues | undefined;
    const tried = valuesOf(assembled.package, name, {});
    for (const values of tried) {
      const compiled = await compiles.document(
        assembled.package,
        assembled.document.resume,
        values,
      );
      if (compiled.broke) {
        stops = values;
        break;
      }
      if (
        compiled.stream !== undefined &&
        baseline.stream !== undefined &&
        difference(baseline.stream, compiled.stream) !== undefined
      )
        changes = true;
    }
    if (stops !== undefined)
      dropped.push({ control: name, why: `stops the compile at ${shownValue(stops, name)}` });
    else if (!changes && tried.length > 0)
      dropped.push({ control: name, why: "sets the same page at every value" });
  }
  if (dropped.length > 0) {
    decisions = {
      ...decisions,
      controls: [...decisions.controls, ...dropped.map((each) => each.control as ControlName)],
    };
    const next = await assembleWith(decisions);
    if ("refused" in next) return next;
    assembled = next;
  }

  // The harness, on the package and the document as they stand.
  const findings = harness === undefined ? [] : await harness(assembled);

  return {
    assembled,
    decisions,
    outcome,
    ...(differs === undefined ? {} : { difference: differs }),
    repeatable,
    dropped,
    findings,
  };
}
