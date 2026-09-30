/**
 * Validation (milestone 3 item 7, plan section 6 step 5, decision 0026): an assembled package and
 * document compiled and checked, and assembled again with what the checks decide. Browser-safe: the
 * caller brings the engine session and the fonts, as the harness's caller does (plan section 5.7).
 *
 * Every compile is in the `import` job, from the package's format, dumped once for each format a
 * value names, a XeTeX package's with its fonts declared by file as item 8's rewrite gives them
 * (decision 0023), or whole from the stock format where the preamble cannot be dumped, or where
 * the probe found the document's own format did not set the reference's glyphs; with the job's
 * files the reference compile had (decision 0019). The four checks of plan section 6 step 5, each
 * bisected as the probe bisects (`settle`, decision 0022):
 *
 * 1. **Same output.** The original body, compiled from the package's format, must set the
 *    reference's page, its glyphs, rules, colours, images and size: the preamble's rewrite changes
 *    hyperref's driver and bookmarks and nothing on the page. An import set in Computer Modern's T1
 *    or TS1 fonts, which the page cannot draw, comes read in Latin Modern (`inLatinModern`), its
 *    reference compiled with T1 and Latin Modern after its class, which the package's preamble
 *    keeps: that is the page it must set. A redefinition or a control's default that moves it is
 *    dropped, alone or as the shortest run of those that move it together; where the package
 *    without any of them does not keep the page either, none is proven, and every redefinition is
 *    dropped (`unproven`). Then the body the generator makes of the document must set exactly what
 *    that original body sets, the editor's markers aside (`sameGlyphs`); where it does not, the
 *    fields whose regeneration moves it are found and locked, their original bytes in their node's
 *    extras (`differs`); a difference that no field explains, which the document with every field
 *    locked shows too, leaves the import `partial`, with the first difference. A document that does
 *    not compile even so tells the other checks nothing: they stop there, every control offered is
 *    dropped as `unchecked`, and the findings say so (`stopped`).
 * 2. **Mutations.** Every field the editor edits, typeset or raw, set to a long text, then empty,
 *    then special characters, three compiles, bisected to the slot that stops the compile: one that
 *    stops only when empty is required, one that stops on text is locked in every instance
 *    (`text`). A slot the bisection's budget leaves untried is neither, and the findings say so
 *    (`untested`).
 * 3. **Repeatable units.** An entry, a bullet, an item, a labelled item, a link and a section of
 *    each kind, added as the side panel adds one, through the editor's own commands, and the first
 *    removed, each compiled; a kind whose new unit stops the compile is one the editor cannot add,
 *    which the package marks (`fixed`).
 * 4. **Controls.** Each control's every value but the document's compiled: one that stops the
 *    compile at a value, or sets the same page at one, is dropped.
 *
 * Then the harness (`validatePackage`) runs on the package and the document; a `fields` or
 * `alignment` finding on a field locks it, once, and the checks run again; any other finding is
 * recorded for item 13's report. The harness holds the package to the upload's own page count and
 * passes, not a curated sample's one page and two. What is returned reads back under the model's
 * and the package's schemas, or the import is refused (`keep`).
 */

import type { NamingAnswer } from "@resume-tools/naming";
import {
  type Resume,
  type RichText,
  SECTION_KINDS,
  type Section,
} from "@resume-tools/resume-model";
import { z } from "zod";
import {
  applyUnder,
  CommandError,
  Document,
  keptOf,
  type StructureOp,
  showsBullets,
} from "../editor/document";
import type { CompileResult, EngineSession, JobFiles } from "../engine/session";
import type { FontLibrary } from "../page/fonts";
import { type GeneratedBody, generateBody, generateFormat } from "../templates/generate";
import {
  type ControlValues,
  fontFiles,
  fontSizes,
  TemplatePackage,
  type UnitKind,
} from "../templates/package";
import { MARKER_BEGIN, markerId } from "../tex/fields";
import { type Finding, validatePackage } from "../validate/harness";
import {
  type Assembled,
  type AssembledField,
  type AssemblyChecks,
  assemble,
  type ControlName,
  type Decisions,
  hyperrefLines,
  type LockReason,
  loadsHyperref,
  takenOut,
} from "./assemble";
import type { Candidate } from "./candidates";
import { encodeLike, type Intake } from "./intake";
import { undrawableFonts } from "./latin-modern";
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
import type { EngineSignatures } from "./signatures";
import type { XetexRewrite } from "./xetex";
import { normalized } from "./xetex-check";

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
  /**
   * The fonts the upload's reference set that the page cannot draw, Computer Modern's in T1 or
   * TS1, where the import is read in Latin Modern from its reference on (`inLatinModern`), which
   * the report says; none where it keeps its fonts.
   */
  latinModern?: readonly string[];
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

/** A finding for item 13's report: the harness's, or one of the checks' own (`NOTES`). */
type Note = AssemblyChecks["findings"][number];

/**
 * The checks' own findings beside the harness's, by what each says: `stopped`, the checks stopped
 * at the first, since the document does not compile as it stands, and nothing after it was tried;
 * `untested`, a bisection of the second check ran out of its budget and left slots untried, which
 * stay editable, neither locked nor required; and `unproven`, the package without its
 * redefinitions does not keep the original's page either, so none is proven and all are dropped.
 */
export const NOTES = ["stopped", "untested", "unproven"] as const;

/** Why a control is dropped that the checks never tried, having stopped before the fourth. */
export const UNCHECKED = "unchecked";

/** `n` things, as a finding counts them: `1 slot`, `2 slots`. */
const counted = (n: number, thing: string) => `${n} ${thing}${n === 1 ? "" : "s"}`;

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
  document(pkg: TemplatePackage, resume: Resume, values?: ControlValues): Promise<Compiled>;
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
  /** The formats dumped for the validation, the harness's among them, which it drops when done. */
  readonly formats = new Set<string>();

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
      this.formats.add(format.name);
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
        : // A preamble that does not dump compiles whole, its fonts declared as the format's are.
          session.compile(pkg.engine, "stock", `${format.preamble}\n${latex}`, {
            job: this.job,
            maxPasses: 3,
            files: this.withPackage(pkg),
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
    resume: Resume,
    values: ControlValues = {},
  ): Promise<Compiled> {
    let body: GeneratedBody;
    try {
      body = generateBody(pkg, resume, values, await this.covers(pkg));
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
function mutated(resume: Resume, fields: readonly AssembledField[], text: string) {
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
    if (section.kind === "locked") continue;
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

/**
 * A kind of unit check 3 tries: the op that adds one, as the side panel adds it, and the ops that
 * remove one, each on its own, the first of the kind and the last, where the document has them.
 */
interface UnitTrial {
  kind: UnitKind;
  add: StructureOp;
  removes: StructureOp[];
}

/**
 * Where check 3 adds a unit of each kind, as the side panel adds one, and which it removes: an
 * entry in the first section of entries that has any, and the first entry and the last removed; a
 * bullet in the first entry whose snippet shows bullets (`showsBullets`), one with bullets first,
 * and the first bullet and the last removed; an item in the first list and in the first labelled
 * list, and the first item of each kind and the last removed; a link, where the header has one, and
 * the first and the last removed; and a section of each kind at the end, with the role of the first
 * section of its kind or `other`, and the first of the kind and the last removed. The last of a
 * kind is tried as well as the first since it is the document's own template code that follows it,
 * as a list's closer after the last section (decision 0038). A kind with nowhere to add one is not
 * tried, and nor is a list its node keeps whole as the upload had it (`kept`), whose units are not
 * the model's and which takes none.
 */
function unitTrials(resume: Resume, pkg: TemplatePackage): UnitTrial[] {
  const trials: UnitTrial[] = [];
  const sections = resume.sections.filter(
    (section): section is Exclude<Section, { kind: "locked" }> => section.kind !== "locked",
  );
  /** The removal of the first unit and of the last, each once, of those given, as `remove` makes it. */
  const removing = <T>(units: readonly T[], remove: (unit: T) => StructureOp) => ({
    removes: [...new Set([units[0], units.at(-1)])].flatMap((unit) =>
      unit === undefined ? [] : [remove(unit)],
    ),
  });
  const entries = sections.flatMap((section) =>
    section.kind === "entries" && !keptOf(section).has("entries") ? [section] : [],
  );
  const withEntries = entries.find((section) => section.entries.length > 0) ?? entries[0];
  if (withEntries !== undefined)
    trials.push({
      kind: "entry",
      add: { op: "addEntry", section: withEntries.id },
      ...removing(
        entries.flatMap((section) => section.entries),
        (entry) => ({ op: "removeEntry", id: entry.id }),
      ),
    });
  const shown = entries.flatMap((section) =>
    showsBullets(pkg, section.role)
      ? section.entries.filter((entry) => !keptOf(entry).has("bullets"))
      : [],
  );
  const target = shown.find((entry) => entry.bullets.length > 0) ?? shown[0];
  if (target !== undefined)
    trials.push({
      kind: "bullet",
      add: { op: "addBullet", entry: target.id },
      ...removing(
        entries.flatMap((section) => section.entries.flatMap((entry) => entry.bullets)),
        (bullet) => ({ op: "removeBullet", id: bullet.id }),
      ),
    });
  for (const kind of ["item", "labelledItem"] as const) {
    const of = kind === "item" ? "list" : "labelled";
    const lists = sections.flatMap((section) =>
      (section.kind === "list" || section.kind === "labelled") &&
      section.kind === of &&
      !keptOf(section).has("items")
        ? [section]
        : [],
    );
    const list = lists.find((section) => section.items.length > 0) ?? lists[0];
    if (list === undefined) continue;
    trials.push({
      kind,
      add: { op: "addItem", section: list.id },
      ...removing(
        lists.flatMap((section) => section.items),
        (item) => ({ op: "removeItem", id: item.id }),
      ),
    });
  }
  const links = keptOf(resume.header).has("links") ? [] : resume.header.links;
  if (links.length > 0)
    trials.push({
      kind: "link",
      add: { op: "addLink" },
      ...removing(links, (link) => ({ op: "removeLink", id: link.id })),
    });
  for (const kind of SECTION_KINDS) {
    const ofKind = sections.filter((section) => section.kind === kind);
    trials.push({
      kind: `section.${kind}`,
      add: { op: "addSection", kind, role: ofKind[0]?.role ?? "other" },
      ...removing(ofKind, (section) => ({ op: "removeSection", id: section.id })),
    });
  }
  return trials;
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
      // The sizes the package offers: those its class declares, or every half point from 9 to 12.
      return other(fontSizes(pkg), chosen.fontSize ?? pkg.controls.fontSize?.default).map(
        (fontSize) => ({ ...chosen, fontSize }),
      );
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

/**
 * The session the harness compiles through: the job's files given to every dump and compile, as
 * the harness gives only the package's, and the stand-ins of the upload's images listed for its
 * PDF. The bodies it compiles are the generator's, locked sections and extras among them (decision
 * 0025). The names of the formats it dumps go in `formats`, which the validation drops.
 */
function harnessSession(
  session: EngineSession,
  files: Record<string, Uint8Array>,
  images: readonly string[],
  formats: Set<string>,
): EngineSession {
  const proxy = Object.create(session) as EngineSession;
  proxy.dump = (engine, name, preamble, own = {}) => {
    formats.add(name);
    return session.dump(engine, name, preamble, { ...files, ...own });
  };
  proxy.compile = (engine, format, body, options = {}) =>
    session.compile(engine, format, body, {
      ...options,
      files: { ...files, ...(options.files ?? {}) },
    });
  proxy.pdf = (job, options = {}) =>
    session.pdf(job, { ...options, images: [...(options.images ?? []), ...images] });
  return proxy;
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
  decisions: Required<Decisions>;
  outcome: "assembled" | "partial";
  difference?: { kind: string; text: string };
  repeatable: { kind: string; added: boolean; removed: boolean }[];
  dropped: { control: string; why: string }[];
  /** The harness's findings. */
  findings: Finding[];
  /** The checks' own (`NOTES`). */
  notes: Note[];
}

/**
 * Validate an import (decision 0026): assemble it, or take the assembly given, run the four
 * checks and the harness, and assemble it again with what they decided; or refuse it, for a font
 * the page cannot draw, an assembly that refuses, or a package or document that does not read back
 * under its schema. The result's `checks` carry what item 13 reports: the fields editable and
 * locked, with why and how many words, the required slots, the controls proven and dropped, the
 * redefinitions dropped, the units that cannot be added, the harness's findings and the checks'
 * own, the fonts swapped for Latin Modern (`latinModern`), and the compiles and time the checks
 * took.
 */
export async function validate(inputs: ValidationInputs): Promise<Assembled | Refusal> {
  const job = inputs.job ?? IMPORT_JOB;
  const { session, fonts, reference } = inputs;
  // A font the page cannot draw: an import keeps its fonts, so the document is refused, naming it.
  // Computer Modern's in T1 and TS1 the pipeline has already swapped for Latin Modern where it
  // could (`inLatinModern`), so that the probe read a page it can draw.
  const [cannot] = await undrawableFonts(fonts, reference.fonts);
  if (cannot !== undefined) return refusal("font", cannot);
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
    // Each format is dropped by the one who dumped it, when done with it (`dropFormat`), so that
    // a session that validates one import after another does not keep them all, 6 to 9 MB each.
    for (const name of compiles.formats) session.dropFormat(reference.engine, name);
  }
}

/**
 * The checks' rounds through `compiler`: the four checks and `harness`, then, where the harness
 * finds a field unmarked or misaligned, the field locked and the checks run again, once. The
 * second round takes what the first decided and does not try it again, so the controls the first
 * dropped, with why, and the redefinitions it could not prove are reported with the second's.
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
  const first = await checks(inputs, compiler, assembleWith, {}, harnessed);
  if ("refused" in first) return first;
  let round = first;
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
      { ...round.decisions, instances: { ...round.decisions.instances, ...locks } },
      harnessed,
    );
    if ("refused" in again) return again;
    round = again;
  }
  // What the first round settled, which the second takes as decided and does not try again.
  const settled = round === first ? { dropped: [], notes: [] } : first;
  const dropped = [...settled.dropped];
  for (const each of round.dropped)
    if (!dropped.some((one) => one.control === each.control)) dropped.push(each);
  const notes = [...settled.notes.filter((note) => note.check === "unproven"), ...round.notes];
  const { assembled } = round;
  const result: Assembled = {
    ...assembled,
    checks: {
      ...assembled.checks,
      outcome: round.outcome,
      ...(round.difference === undefined ? {} : { difference: round.difference }),
      controls: {
        ...assembled.checks.controls,
        proven: assembled.checks.controls.offered,
        dropped,
      },
      repeatable: round.repeatable,
      findings: [...notes, ...round.findings],
      compiles: compiler.count,
      ms: performance.now() - started,
      decisions: round.decisions,
      ...(inputs.latinModern === undefined || inputs.latinModern.length === 0
        ? {}
        : { latinModern: [...inputs.latinModern] }),
    },
  };
  // What is kept reads back as the store and the loader will read it: the document under the
  // model's schema, its kept LaTeX within its caps and free of the editor's markers, and the
  // package under the package's; an import either would refuse is refused here (decision 0026).
  const document = Document.safeParse(result.document);
  const pkg = TemplatePackage.safeParse(result.package);
  if (!document.success) return refusal("keep", undefined, z.prettifyError(document.error));
  if (!pkg.success) return refusal("keep", undefined, z.prettifyError(pkg.error));
  return result;
}

/**
 * The harness on an assembled package and document (`validatePackage`), through the session that
 * gives it the job's files (`harnessSession`), and held to the upload's own compile: the pages its
 * reference set and the passes it took, where a curated sample is held to one page and two passes,
 * since an upload may be two pages, and take three passes to settle, as AltaCV's paracol does.
 */
async function harnessOf(
  inputs: ValidationInputs,
  compiles: Compiles,
  assembled: Assembled,
): Promise<Finding[]> {
  const images = [
    ...inputs.intake.images.replaced.map((image) => image.path),
    ...inputs.reference.images.map((image) => image.path),
  ];
  const report = await validatePackage(
    harnessSession(inputs.session, compiles.files, images, compiles.formats),
    inputs.fonts,
    assembled.package,
    assembled.document.resume,
    {},
    compiles.job,
    { pages: inputs.reference.pages.length, passes: inputs.reference.passes.length },
  );
  compiles.count += report.passes.length;
  inputs.session.forget(compiles.job);
  return report.findings;
}

/** A switch check 1 turns off to keep the original's page: a redefinition, or a control's default. */
type Switch = { redefinition: string } | { control: ControlName };

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
    placement: start.placement ?? "class",
    controls: [...(start.controls ?? [])],
    instances: { ...(start.instances ?? {}) },
    slots: { ...(start.slots ?? {}) },
    required: [...(start.required ?? [])],
    fixed: [...(start.fixed ?? [])],
  };
  const notes: Note[] = [];
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
  // A XeTeX package's fonts are declared by file, as item 8's rewrite gives them, where the
  // original found them by name: the two compare as the rewrite's own check compares them (decision
  // 0023), a native font by its file and a colour special wherever it stands, since it sets nothing
  // on the page. The package's own compiles, all from its format, compare exactly.
  const across = inputs.rewrite === undefined ? (stream: GlyphStream) => stream : normalized;
  const keeps = (compiled: { broke: boolean; stream?: GlyphStream }) =>
    !compiled.broke &&
    compiled.stream !== undefined &&
    difference(across(liked.stream), across(compiled.stream)) === undefined;

  // 1. The rewrite keeps the page: each redefinition and each control that moves it dropped.
  let target = await original(assembled);
  // The redefinitions go after the class, and where a compile after it stops, as it does for a
  // macro a package or the preamble defines, at the preamble's end instead (decision 0024).
  if (
    target.broke &&
    decisions.placement === "class" &&
    assembled.checks.redefinitions.applied.length > 0
  ) {
    const moved = await assembleWith({ ...decisions, placement: "preamble" });
    if (!("refused" in moved)) {
      const again = await original(moved);
      if (!again.broke) {
        decisions = { ...decisions, placement: "preamble" };
        assembled = moved;
        target = again;
      }
    }
  }
  if (!keeps(target)) {
    const applied = assembled.checks.redefinitions.applied;
    const offered = assembled.checks.controls.offered.filter(
      (name) => name === "margins" || name === "accent" || name === "font" || name === "density",
    );
    const switches: Switch[] = [
      ...applied.map((redefinition) => ({ redefinition })),
      ...offered.map((control) => ({ control })),
    ];
    /** The decisions with only the switches of `on` left on: every other dropped. */
    const only = (on: readonly Switch[]): Required<Decisions> => ({
      ...decisions,
      dropped: [
        ...decisions.dropped,
        ...applied.filter(
          (name) => !on.some((each) => "redefinition" in each && each.redefinition === name),
        ),
      ],
      controls: [
        ...decisions.controls,
        ...offered.filter((name) => !on.some((each) => "control" in each && each.control === name)),
      ],
    });
    const keepsWith = async (on: readonly Switch[]) => {
      const tried = await assembleWith(only(on));
      return !("refused" in tried) && keeps(await original(tried));
    };
    if (await keepsWith([])) {
      // The package without them keeps the page: each is tried alone, and those that keep it alone
      // together, where two can move it that each keep it alone; and where together they move it,
      // the shortest run of them that does, in their order, is found by halving and its last is
      // dropped, as the probe's union does (decision 0022), until the rest keep it.
      let on: Switch[] = [];
      for (const each of switches) if (await keepsWith([each])) on.push(each);
      while (on.length > 1 && !(await keepsWith(on))) {
        // A run of one keeps the page, each having kept it alone; the whole does not.
        let lo = 1;
        let hi = on.length;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (await keepsWith(on.slice(0, mid))) lo = mid;
          else hi = mid;
        }
        on = on.filter((_, i) => i !== hi - 1);
      }
      decisions = only(on);
    } else if (applied.length > 0) {
      // The package without any of them does not keep the page either, so that no compile can show
      // that a redefinition keeps it: none is proven, and every one is dropped (decision 0026).
      decisions = { ...decisions, dropped: [...decisions.dropped, ...applied] };
      notes.push({
        check: "unproven",
        message: `the package without its redefinitions does not keep the original's page either, so none of the ${counted(applied.length, "redefinition")} is proven, and each is dropped: ${applied.join(", ")}`,
      });
    }
    const next = await assembleWith(decisions);
    if ("refused" in next) return next;
    assembled = next;
    target = await original(assembled);
    if (!keeps(target)) {
      outcome = "partial";
      const found =
        target.stream === undefined
          ? undefined
          : difference(across(liked.stream), across(target.stream));
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

  // A document that does not compile as it stands tells the other checks nothing: they stop here,
  // so that no control is proven that no compile tried, and the findings say so.
  if (first.compiled.broke) {
    const offered = assembled.checks.controls.offered;
    if (offered.length > 0) {
      decisions = { ...decisions, controls: [...decisions.controls, ...offered] };
      const next = await assembleWith(decisions);
      if ("refused" in next) return next;
      assembled = next;
    }
    notes.push({
      check: "stopped",
      message:
        "the checks stopped at the first: the document does not compile as it stands, so no field was mutated, no unit added, no control tried, and the harness did not run",
    });
    return {
      assembled,
      decisions,
      outcome: "partial",
      difference: differs ?? { kind: "stopped", text: "the document stopped" },
      repeatable: [],
      dropped: offered.map((control) => ({ control, why: UNCHECKED })),
      findings: [],
      notes,
    };
  }

  // 2. Mutations: long, empty and special texts in every field the editor edits, typeset or raw,
  // bisected by slot. A raw field, a contact or a link label whose address the template builds
  // from its text, takes what is typed in the panel as a typeset one does.
  const editable = assembled.checks.all.filter(
    (field) => field.mode !== "locked" && field.type !== "date",
  );
  const slots = [...new Set(editable.map((field) => field.slot))];
  const breaks = async (text: string, only?: ReadonlySet<string>) => {
    const chosen = editable.filter((field) => only === undefined || only.has(field.slot));
    const resume = mutated(assembled.document.resume, chosen, text);
    return (await compiles.document(assembled.package, resume)).broke;
  };
  /**
   * The slots `text` stops the compile in. Those the bisection's budget leaves untried are not
   * among them, since no compile showed them fail: they stay as they are, and a note says which.
   */
  const failing = async (text: string, name: string): Promise<Set<string>> => {
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
    const failed = new Set<string>();
    const untried: string[] = [];
    for (const [id, { verdict }] of settled.verdicts)
      if (verdict === "untested") untried.push(id);
      else if (verdict !== "editable") failed.add(id);
    if (untried.length > 0)
      notes.push({
        check: "untested",
        message: `the second check's bisection of the ${name} text ran out of its ${counted(budget, "compile")} and left ${counted(untried.length, "slot")} untested, neither locked nor required: ${untried.join(", ")}`,
      });
    return failed;
  };
  const onText = new Set([
    ...(await failing(MUTATIONS.long, "long")),
    ...(await failing(MUTATIONS.special, "special")),
  ]);
  const onEmpty = await failing(MUTATIONS.empty, "empty");
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

  // 3. Repeatable units: of each kind, one added as the side panel adds it, through the editor's
  // own commands under the package, and the first and the last removed, each compiled. A kind whose
  // new unit stops the compile is one the editor cannot add, which the package marks and the editor
  // then refuses, and which a later round reports as it stands, untried.
  const repeatable: Round["repeatable"] = [];
  const fixed = new Set(decisions.fixed);
  const compilesAfter = async (op: StructureOp | undefined) => {
    if (op === undefined) return true;
    let changed: Document;
    try {
      changed = applyUnder(assembled.package, assembled.document, { type: "structure", op });
    } catch (error) {
      if (error instanceof CommandError) return false;
      throw error;
    }
    return !(await compiles.document(assembled.package, changed.resume)).broke;
  };
  for (const { kind, add, removes } of unitTrials(assembled.document.resume, assembled.package)) {
    const added = !fixed.has(kind) && (await compilesAfter(add));
    if (!added) fixed.add(kind);
    let removed = true;
    for (const remove of removes) removed = (await compilesAfter(remove)) && removed;
    repeatable.push({ kind, added, removed });
  }
  if (fixed.size > decisions.fixed.length) {
    decisions = { ...decisions, fixed: [...fixed] };
    const next = await assembleWith(decisions);
    if ("refused" in next) return next;
    assembled = next;
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
    notes,
  };
}
