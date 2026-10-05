/**
 * An import, from the person's files to a package and a document (milestone 3 item 12, decision
 * 0038; the second pass's item 5, decision 0049): the pipeline, on the editor's own engine session
 * in the browser's worker, in the jobs its steps compile in (`import`, and item 8's `fonts` for a
 * XeTeX document), which it forgets when it ends. `corpus run` runs it as it is, in Node, over the
 * corpus (`scripts/corpus-import-child.ts`).
 *
 * The steps: the intake (decision 0019), each stand-in the PDF could not show copied to a plain path
 * (`plainStandIns`); the reference compile, read in Latin Modern where the page cannot draw its
 * Computer Modern in T1 or TS1 (`inLatinModern`, decision 0026); on XeTeX, the fonts rewritten to
 * files and checked (decision 0023), after which the document is the rewritten one, so that its
 * preamble dumps and the probe compiles from a saved format; the engine's signatures; the parse;
 * the probe (decision 0022), whose format goes as soon as it is done; the outline, built from the
 * body's tree and the probe's verdicts (`buildOutline`), with its package (`outlinePackage`); and
 * the four checks without answers (`checkOutline`, the second pass's item 6), which compile the
 * outline as the editor will compile it, against the reference's page, keep as text each field
 * that moves it or stops on text, mark those that stop when empty required, and fix each group
 * that does not take a copy of its last unit and the removal of its first and its last; the
 * format they compiled from is what the editor takes rather than dumping it again (decision 0045).
 * No request is built and no service is called: a `.tex` import sends nothing (decision 0049).
 *
 * Each step, and each compile as it begins and ends, is reported through `onStep`, with the step's
 * name in plain English, as plan section 6.4's progress display names it, and the compiles so far;
 * a compile under way is what the worker's client times, and a hung one terminates the worker
 * (decision 0008). `signal` stops the import between compiles, with its reason thrown. A refusal
 * comes back as the pipeline gives it, in plain English that never shows LaTeX, as do the few this
 * module adds; an unexpected failure is one of those, its details for developers alone.
 *
 * Nothing here reaches for Node or the network: it runs in the browser's worker, and in Node's
 * tests on the same session class, `startNodeSession`.
 */

import type { OutlineGroup } from "@resume-tools/resume-model";
import { zipSync } from "fflate";
import type { Document } from "../editor/document";
import type { Engine, EngineSession } from "../engine/session";
import type { FontLibrary } from "../page/fonts";
import { fontDeclarations } from "../templates/generate";
import type { FontFamily, TemplatePackage } from "../templates/package";
import { candidatesOf, isSetter } from "./candidates";
import { type CheckEvent, type Checked, checkOutline, OutlineCompiler } from "./checks";
import type { Tree as TexTree } from "./fonts";
import { encodeLike, type Intake, intake, type Upload } from "./intake";
import { inLatinModern, undrawableFonts } from "./latin-modern";
import {
  buildOutline,
  outlinePackage,
  ownersOf,
  reachedRuns,
  reachOf,
  type Words,
  wordsOf,
} from "./outline";
import { type Body, bodyOf, bodyOfText, buildTree, readBody, type Span, type Tree } from "./parse";
import { extensionOf, nameOf } from "./paths";
import { type Probe, probe, probeUses } from "./probe";
import { IMPORT_JOB, type Reference, reference, referenceFiles } from "./reference";
import { isRefusal, type Refusal, refusal, refusedAtIntake, shownInMessage } from "./refusal";
import type { AssemblyChecks, LockedPart, LockReason } from "./report";
import { signatures } from "./signatures";
import { plainStandIns } from "./standins";
import { rewriteForXetex } from "./xetex";
import { checkRewrite, jobFiles } from "./xetex-check";

/**
 * The steps of an import, in order, as the progress line names them (plan section 6.4): plain
 * English, never a command's name or a line of source.
 */
export const IMPORT_STEPS = {
  intake: "Reading your files",
  reference: "Compiling your resume as it stands, slower the first time",
  fonts: "Matching its fonts to ones the page can draw",
  rewrite: "Setting up the template's fonts",
  signatures: "Reading the template's commands",
  parse: "Reading your resume's parts",
  probe: "Finding the parts you can edit",
  outline: "Laying out the parts you can edit",
  validate: "Checking the imported resume",
} as const;
export type ImportStep = keyof typeof IMPORT_STEPS;

/** Where an import has got to, as `onStep` hears it. */
export interface ImportProgress {
  step: ImportStep;
  /** The step as the progress line names it (`IMPORT_STEPS`). */
  label: string;
  /** How many compiles the import has made so far, one under way among them. */
  compiles: number;
  /** Whether a compile, a dump or a PDF is under way, which the worker's client times. */
  compiling: boolean;
}

/** What an import runs with: nothing that reaches a service. */
export interface ImportDeps {
  /** The engine's session, the worker's, which every step compiles on. */
  session: EngineSession;
  /** The fonts the page's glyphs are read with, as the page reads them. */
  fonts: FontLibrary;
  /** The tree's fonts and styles (`readTree`), which the intake and the XeTeX rewrite read. */
  tree: TexTree;
  /** The tree's images by name (`treeImages`), which a stand-in of the same size takes the place of. */
  treeImage?: (name: string) => Uint8Array | undefined;
  /** How many compiles each bisection of the checks may make (`CHECK_BUDGET` unless given). */
  checkBudget?: number;
  /** Hears what the probe found and where the checks are (`ImportObserver`), and changes nothing. */
  observe?: ImportObserver;
}

/**
 * What a caller may hear of an import as it runs, which changes nothing it does: the corpus's
 * diagnostics (`corpus run`) count the words not in place by what holds them, and the compiles by
 * kind of trial. `probed` hears the document as the probe took it, and what the probe found;
 * `checks` hears the checks' phases and budgets (`CheckEvent`). Neither may throw.
 */
export interface ImportObserver {
  probed?: (found: { intake: Intake; reference: Reference; probe: Probe }) => void;
  checks?: (event: CheckEvent) => void;
}

/**
 * What the outline holds, for the report and the corpus: its fields, groups and units, and the
 * page's words, each set down to a field, to kept text the retype reaches, or to kept text it does
 * not (`wordsOf`), as the spike counted them (decision 0050); and what the checks found: the
 * fields required, the probe's editable candidates the checks kept as text, by why, and the groups
 * fixed, by why, and those whose trials kept the page, by kind of trial.
 */
export interface OutlineSummary {
  fields: number;
  groups: number;
  units: number;
  words: Words;
  required: number;
  kept: Partial<Record<LockReason, number>>;
  fixed: Partial<Record<NonNullable<OutlineGroup["fixed"]>, number>>;
  trials: { copy: number; first: number; last: number };
  /** How many of the probe's editable candidates each of check 2's texts stopped the compile with. */
  stops: { long: number; special: number; empty: number };
  /** Whether its fields take letters of other scripts, Greek and Cyrillic, which its fonts may lack. */
  scripts: { greek: boolean; cyrillic: boolean };
}

/**
 * What item 13's report is made of (decision 0038): the reference, the upload as it compiled, whose
 * glyph stream the body's words are counted in, its log left out since it quotes the source; what
 * the checks found; the locked parts, each with where it stands, why and how many words, none for
 * an outline, whose kept text the checks' owners name; the images stood in for and dropped, and the
 * intake's and the XeTeX rewrite's warnings; what the outline holds; and the compiles and time the
 * whole import took. `reportOfImport` reads it into the report the person sees (decision 0039).
 */
export interface ImportReport {
  engine: Engine;
  reference: Omit<Reference, "log">;
  checks: AssemblyChecks;
  locked: LockedPart[];
  images: Intake["images"];
  warnings: string[];
  outline: OutlineSummary;
  compiles: number;
  ms: number;
}

/**
 * What an imported document's compiles need beside its package's own files, which the reference
 * compile had (`referenceFiles`): the upload's files, stand-ins for its images and the
 * configurations pdfTeX's DVI takes among them, each at its path in the job; the upload's
 * bibliography, which a job reads under its own name (`<job>.bbl`); and the stand-ins its PDF may
 * show (`PdfOptions.images`).
 */
export interface ImportJob {
  files: Record<string, Uint8Array>;
  bbl?: Uint8Array;
  images: string[];
}

/** An import that came through: what the store keeps of it (decision 0038). */
export interface Imported {
  package: TemplatePackage;
  /** The model's resume, its outline its one section, and the controls' choices. */
  document: Document;
  report: ImportReport;
  /** The original upload's files, as the person gave them, so that the import can be made again. */
  upload: { files: Upload[] };
  job: ImportJob;
  /**
   * The format the document opens with, by name, as the import dumped it, which the editor takes
   * rather than dumping it again (decision 0045). The store does not keep it with the import: the
   * editor keeps it as any format.
   */
  formats?: { name: string; format: Uint8Array }[];
}

export type ImportOutcome = Imported | Refusal;

/** The job the editor compiles an open document in (decision 0010), whose `.bbl` it reads. */
const EDITOR_JOB = "doc";

/** The jobs the steps compile in, which the import forgets when it ends. */
const JOBS = [IMPORT_JOB, "fonts", "fonts-body"] as const;

/** The format item 8's check of a XeTeX rewrite dumps, which the import drops after it. */
const CHECK_FORMAT = "importfonts";

/**
 * The person's files as one upload, as the intake takes one: a single `.tex` or zip as it is, and
 * several files, the `.tex` and the class or pictures beside it, packed into a zip at their names,
 * with nothing compressed. Several that hold a zip, or two of one name, are refused.
 */
export function uploadOf(files: readonly Upload[]): Upload | Refusal {
  const [first, ...rest] = files;
  if (first === undefined)
    return refusedAtIntake("Choose a .tex file, or a zip of your resume's files.");
  if (rest.length === 0) return first;
  const names = new Map<string, Uint8Array>();
  for (const file of files) {
    const name = nameOf(file.name);
    if (extensionOf(name) === ".zip" || (file.bytes[0] === 0x50 && file.bytes[1] === 0x4b))
      return refusedAtIntake(
        "Upload one zip on its own, or your .tex file with the files it needs beside it.",
      );
    if (names.has(name))
      return refusedAtIntake(`This upload holds two files named ${shownInMessage(name)}.`, name);
    names.set(name, file.bytes);
  }
  return { name: "upload.zip", bytes: zipSync(Object.fromEntries(names), { level: 0 }) };
}

/** An aborted signal's reason, as it would be thrown, for a caller that lets it through. */
const isAbort = (signal: AbortSignal | undefined, error: unknown) =>
  signal?.aborted === true && error === signal.reason;

/**
 * Import a resume: its package, document, report and files, or a refusal that says why in plain
 * English (the module's comment). `onStep` hears each step and each compile; `signal` stops it
 * between compiles, throwing its reason.
 */
export async function importResume(
  files: readonly Upload[],
  deps: ImportDeps,
  onStep: (progress: ImportProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<ImportOutcome> {
  const started = performance.now();
  let step: ImportStep = "intake";
  let compiles = 0;
  const tell = (compiling: boolean) =>
    onStep({ step, label: IMPORT_STEPS[step], compiles, compiling });
  const enter = (next: ImportStep) => {
    signal?.throwIfAborted();
    step = next;
    tell(false);
  };
  const session = watched(deps.session, signal, (compiling, compile) => {
    if (compile) compiles++;
    tell(compiling);
  });
  const { fonts, tree, treeImage } = deps;
  const options = treeImage === undefined ? {} : { treeImage };
  /** The formats the steps leave in the session, which go when the import ends, however it ends. */
  const formats: [Engine, string][] = [];
  const steps = async (): Promise<ImportOutcome> => {
    enter("intake");
    const upload = uploadOf(files);
    if (isRefusal(upload)) return upload;
    const received = intake(upload, { tree, ...options });
    if (isRefusal(received)) return received;
    const uploaded = plainStandIns(received);

    enter("reference");
    const first = await reference(session, fonts, uploaded, options);
    if (isRefusal(first)) return first;

    enter("fonts");
    const swap = await inLatinModern(session, fonts, uploaded, first, options);
    if (swap !== undefined && isRefusal(swap)) return swap;
    let taken = swap?.intake ?? uploaded;
    let made = swap?.reference ?? first;
    const engine = made.engine;

    // On XeTeX the fonts go by file first, so that the preamble dumps and the probe compiles from
    // a saved format (decision 0023): from here on the document is the rewritten one, and what it
    // must set is its own whole compile's glyphs, the reference's with each font by the tree's file.
    let rewritten: { fonts: FontFamily[]; warnings: string[] } | undefined;
    if (engine === "xetex") {
      enter("rewrite");
      const rewrite = rewriteForXetex(taken, tree);
      if (isRefusal(rewrite)) return rewrite;
      formats.push(["xetex", CHECK_FORMAT]);
      const checked = await checkRewrite(session, fonts, taken, made, rewrite, {
        ...options,
        format: CHECK_FORMAT,
      });
      if (isRefusal(checked)) return checked;
      session.dropFormat("xetex", CHECK_FORMAT);
      const text = `${rewrite.preamble}${rewrite.body}`;
      taken = {
        ...taken,
        main: {
          ...taken.main,
          text,
          bytes: encodeLike(taken.main.bytes, text) ?? new TextEncoder().encode(text),
        },
        files: jobFiles(taken, made, rewrite, treeImage),
        fonts: [],
      };
      const { pages, size, fonts: used, specials } = checked.stream;
      made = { ...made, pages, size, fonts: used, specials };
      rewritten = { fonts: rewrite.fonts, warnings: rewrite.warnings };
    }
    // A font the page cannot draw: an import keeps its fonts, so the document is refused, naming
    // it. Computer Modern's in T1 and TS1 are swapped for Latin Modern where they could be.
    const [cannot] = await undrawableFonts(fonts, made.fonts);
    if (cannot !== undefined) return refusal("font", cannot);

    enter("signatures");
    const body = bodyOf(taken);
    if (isRefusal(body)) return body;
    const read = readBody(body);
    if (isRefusal(read)) return read;
    const preamble = readBody(bodyOfText(body.preamble));
    const uses = probeUses(read, isRefusal(preamble) ? undefined : preamble);
    const found = await signatures(session, taken, made, body, uses, options);
    if (isRefusal(found)) return found;

    enter("parse");
    const built = buildTree(read, found);
    if (isRefusal(built)) return built;

    enter("probe");
    const probed = await probe(session, fonts, taken, made, built, found, {
      ...options,
      ...(rewritten === undefined ? {} : { declarations: fontDeclarations(rewritten.fonts) }),
    });
    // The probe leaves the document's format in the session; the package has one of its own,
    // which the last step dumps, so the probe's goes now (decision 0022).
    if (probed.format !== undefined) session.dropFormat(engine, probed.format);
    deps.observe?.probed?.({ intake: taken, reference: made, probe: probed });
    if (probed.baseline !== undefined) return refusal("probe");

    enter("outline");
    const head = preambleOf(body, built, probed);
    const ends = {
      begin: body.before.slice(body.preamble.length),
      end: /^\\end\s*\{document\}/.exec(body.after)?.[0] ?? "\\end{document}",
    };
    const outlineOf = (kept: ReadonlySet<string>) =>
      buildOutline({
        tree: built,
        ...(head === undefined ? {} : { preamble: head }),
        candidates: probed.candidates,
        kept,
        macros: probed.signatures.macros,
        ...ends,
      });
    const pkg = await outlinePackage({
      engine,
      preamble: body.preamble,
      files: taken.files,
      ...(rewritten === undefined ? {} : { fonts: rewritten.fonts }),
      reference: made,
    });

    enter("validate");
    const compiler = new OutlineCompiler({
      session,
      fonts,
      pkg,
      job: IMPORT_JOB,
      files: referenceFiles(taken, made, { job: IMPORT_JOB, ...options }),
      ...(signal === undefined ? {} : { signal }),
    });
    let checked: Checked | Refusal;
    try {
      const dumped = compiler.start();
      if (!dumped.ok) return refusal("stopped", undefined, dumped.log);
      checked = await checkOutline({
        compiler,
        reference: made,
        build: outlineOf,
        candidates: probed.candidates,
        runs: probed.runs ?? [],
        ...(deps.checkBudget === undefined ? {} : { budget: deps.checkBudget }),
        ...(deps.observe?.checks === undefined ? {} : { observe: deps.observe.checks }),
      });
    } finally {
      compiler.close();
    }
    if (isRefusal(checked)) return checked;
    const outline = checked.outline;
    const document: Document = {
      version: 1,
      template: pkg.id,
      resume: checked.resume,
      controls: {},
    };
    const format = compiler.format;

    // What the document's compiles need beside the package, as the outline compiled: the
    // reference compile's files for the editor's job, its bibliography under whatever job reads it.
    const editorFiles = referenceFiles(taken, made, { job: EDITOR_JOB, ...options });
    const bbl = editorFiles[`${EDITOR_JOB}.bbl`];
    delete editorFiles[`${EDITOR_JOB}.bbl`];
    const { log: _log, ...shown } = made;
    const runs = probed.runs ?? [];
    const counting = {
      reference: made,
      runs,
      candidates: probed.candidates,
      fields: new Set(outline.fields.keys()),
      sources: { body: built.source, preamble: head?.tree.source ?? "" },
    };
    const reach = reachOf(counting);
    const words = wordsOf(counting, reach);
    return {
      package: pkg,
      document,
      report: {
        engine,
        reference: shown,
        checks: checksOf(checked, probed, words, reachedRuns(reach.reached), swap?.swapped),
        locked: [],
        images: taken.images,
        // What the intake and the XeTeX rewrite set aside, which the report lists (decision 0039).
        warnings: [...taken.warnings, ...(rewritten?.warnings ?? [])],
        outline: summaryOf(checked, words),
        compiles,
        ms: performance.now() - started,
      },
      upload: { files: files.map((file) => ({ name: file.name, bytes: file.bytes })) },
      job: {
        files: editorFiles,
        ...(bbl === undefined ? {} : { bbl }),
        images: [...taken.images.replaced, ...made.images].map((image) => image.path),
      },
      formats: [{ name: format.name, format: format.bytes }],
    };
  };
  try {
    const outcome = await steps();
    // A step whose compile the signal stopped may have taken that for the resume's fault: an import
    // that was stopped is stopped, whatever it came to.
    signal?.throwIfAborted();
    return outcome;
  } catch (error) {
    if (isAbort(signal, error)) throw error;
    // A fault of the editor's own: what it says may quote the resume, so it is for developers.
    return refusal("failed", undefined, error instanceof Error ? error.message : String(error));
  } finally {
    for (const [engine, name] of formats) deps.session.dropFormat(engine, name);
    for (const job of JOBS) deps.session.forget(job);
  }
}

/**
 * The preamble's tree and its calls that store a header's text, as the probe found them: the
 * preamble read again, since a text read once builds one tree, with the template macros the
 * engine's signatures say store their arguments (`isSetter`); undefined where the preamble holds
 * none, or where its candidates are not the probe's, which then are no fields. `corpus checks`
 * builds the outline with it as the import does.
 */
export function preambleOf(
  body: Body,
  built: Tree,
  probed: Probe,
): { tree: Tree; setters: Span[] } | undefined {
  if (!probed.candidates.some((each) => each.where === "preamble")) return undefined;
  const { commands, macros } = probed.signatures;
  const setters = new Set(
    Object.entries(commands)
      .filter(([name, signature]) => signature.kind === "template" && isSetter(macros[name]))
      .map(([name]) => name),
  );
  const read = readBody(bodyOfText(body.preamble));
  if (isRefusal(read)) return undefined;
  const tree = buildTree(read, probed.signatures);
  if (isRefusal(tree) || tree.source !== body.preamble) return undefined;
  const again = candidatesOf(built, { preamble: tree, setters });
  const ours = (list: readonly { where: string; id: string; start: number; end: number }[]) =>
    list
      .filter((each) => each.where === "preamble")
      .map((each) => `${each.id}:${each.start}:${each.end}`)
      .join();
  if (ours(again.candidates) !== ours(probed.candidates)) return undefined;
  return { tree, setters: again.setters };
}

/**
 * What the checks found, as item 13's report reads them (`AssemblyChecks`): the outline's fields,
 * required or not, and the probe's other candidates by why they are kept text, the checks' reasons
 * among them; the page's words set down to what sets them (`ownersOf`), and the glyphs of kept text
 * the retype reaches (`retype`); whether the outline sets the reference's page, and how it first
 * differs where it does not; each group's trials, by its id; what the checks could not do; and
 * their compiles and time. What the first pass's checks decided beside, the controls, the
 * redefinitions and the harness's findings, an outline has none of.
 */
function checksOf(
  checked: Checked,
  probed: Probe,
  words: Words,
  retype: AssemblyChecks["retype"],
  latinModern: readonly string[] | undefined,
): AssemblyChecks {
  const { outline, difference } = checked;
  const locked: AssemblyChecks["fields"]["locked"] = {};
  for (const each of probed.candidates) {
    const reason: LockReason | undefined =
      checked.kept.get(each.id) ??
      (each.verdict === "editable" || each.verdict === "container" ? undefined : each.verdict);
    if (reason !== undefined) locked[reason] = (locked[reason] ?? 0) + 1;
  }
  return {
    outcome: checked.outcome,
    ...(difference === undefined
      ? {}
      : { difference: { kind: difference.kind, text: difference.text } }),
    fields: {
      editable: outline.counts.fields,
      raw: 0,
      required: checked.required.size,
      locked,
    },
    words: { editable: words.fields, locked: {} },
    sections: { mapped: 0, locked: 0 },
    required: [...checked.required].map((id) => `${id}.text`),
    controls: { offered: [], proven: [], dropped: [] },
    redefinitions: { applied: [], dropped: [], placement: "class" },
    repeatable: [...outline.groups.keys()].map((id) => {
      const found = checked.trials.get(id) ?? {};
      const kept = (verdict: string | undefined) => verdict === "holds" || verdict === "reflows";
      return {
        kind: id,
        added: kept(found.copy),
        removed: kept(found.first) && kept(found.last),
      };
    }),
    findings: checked.notes,
    compiles: checked.compiles,
    ms: checked.ms,
    decisions: {},
    ...(latinModern === undefined ? {} : { latinModern: [...latinModern] }),
    all: [],
    owners: ownersOf(probed.runs ?? [], probed.candidates, outline.fields, checked.kept),
    ...(retype === undefined ? {} : { retype }),
  };
}

/** What the outline holds and what the checks found of it, for the report (`OutlineSummary`). */
function summaryOf(checked: Checked, words: Words): OutlineSummary {
  const kept: OutlineSummary["kept"] = {};
  for (const reason of checked.kept.values()) kept[reason] = (kept[reason] ?? 0) + 1;
  const fixed: OutlineSummary["fixed"] = {};
  for (const why of checked.fixed.values()) fixed[why] = (fixed[why] ?? 0) + 1;
  const trials = { copy: 0, first: 0, last: 0 };
  const holds = (verdict: string | undefined) => verdict === "holds" || verdict === "reflows";
  for (const found of checked.trials.values())
    for (const kind of ["copy", "first", "last"] as const) if (holds(found[kind])) trials[kind]++;
  return {
    ...checked.outline.counts,
    words,
    required: checked.required.size,
    kept,
    fixed,
    trials,
    stops: { ...checked.stops },
    scripts: { ...checked.scripts },
  };
}

/**
 * The session as the import compiles on it: every compile, dump and PDF first stops the import
 * when `signal` has been aborted, throwing its reason, and is reported as it begins and ends
 * (`heard`, with whether it is a compile, which the count takes). Everything else goes to the
 * session as it is. The bridge's PDF of an import's page is made on it too (`bridge.ts`).
 */
export function watched(
  session: EngineSession,
  signal: AbortSignal | undefined,
  heard: (compiling: boolean, compile: boolean) => void,
): EngineSession {
  const proxy = Object.create(session) as EngineSession;
  const around =
    <A extends unknown[], R>(call: (...args: A) => R, compile: boolean) =>
    (...args: A): R => {
      signal?.throwIfAborted();
      heard(true, compile);
      try {
        return call(...args);
      } finally {
        heard(false, false);
      }
    };
  proxy.compile = around(session.compile.bind(session), true);
  proxy.dump = around(session.dump.bind(session), false);
  proxy.pdf = around(session.pdf.bind(session), false);
  return proxy;
}
