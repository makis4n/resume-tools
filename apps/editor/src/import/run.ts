/**
 * An import, from the person's files to a package and a document (milestone 3 item 12, decision
 * 0038): the pipeline in the order `scripts/corpus-assemble-child.ts` runs it in Node, on the
 * editor's own engine session in the browser's worker, in the jobs its steps compile in (`import`,
 * and item 8's `fonts` for a XeTeX document), which it forgets when it ends.
 *
 * The steps: the intake (decision 0019), each stand-in the PDF could not show copied to a plain path
 * (`plainStandIns`); the reference compile, read in Latin Modern where the page cannot draw its
 * Computer Modern in T1 or TS1 (`inLatinModern`, decision 0026); the engine's signatures, asked of
 * the sizes the class may declare too (`SIZE_OPTIONS`); the parse; the probe (decision 0022), whose
 * format goes as soon as it is done; the naming request, built with the upload's sources and the
 * page's strings and checked for the resume's text before it leaves (decision 0033); the naming
 * service (`nameOnService`, decision 0028), whose failure leaves every macro as the probe left it
 * and the report saying so, since the browser has no answers of its own; a XeTeX document's fonts
 * declared by file and checked (decision 0023); and the assembly and its checks (`validate`,
 * decision 0026), which drop the formats they dump.
 *
 * Each step, and each compile as it begins and ends, is reported through `onStep`, with the step's
 * name in plain English, as plan section 6.4's progress display names it, and the compiles so far;
 * a compile under way is what the worker's client times, and a hung one terminates the worker
 * (decision 0008). `signal` stops the import between compiles, with its reason thrown. A refusal
 * comes back as the pipeline gives it, in plain English that never shows LaTeX, as do the few this
 * module adds; an unexpected failure is one of those, its details for developers alone.
 *
 * Nothing here reaches for Node: it runs in the browser's worker, and in Node's tests on the same
 * session class, `startNodeSession`.
 */

import type { NamingAnswer, NamingRequest } from "@resume-tools/naming";
import { NAMING_VERSION } from "@resume-tools/naming";
import { zipSync } from "fflate";
import type { Document } from "../editor/document";
import type { Engine, EngineSession } from "../engine/session";
import type { FontLibrary } from "../page/fonts";
import type { NamingReply } from "../service/reply";
import type { TemplatePackage } from "../templates/package";
import { type AssemblyChecks, type LockedPart, SIZE_OPTIONS } from "./assemble";
import type { Tree as TexTree } from "./fonts";
import { type Intake, intake, type Upload } from "./intake";
import { inLatinModern } from "./latin-modern";
import { assertNoText, buildRequest, pageStrings, sourcesOf } from "./naming";
import { bodyOf, bodyOfText, buildTree, readBody } from "./parse";
import { extensionOf, nameOf } from "./paths";
import { probe, probeUses } from "./probe";
import { IMPORT_JOB, type Reference, reference, referenceFiles } from "./reference";
import { isRefusal, type Refusal, refusal, refusedAtIntake, shownInMessage } from "./refusal";
import { NamingServiceError } from "./service";
import { signatures } from "./signatures";
import { plainStandIns } from "./standins";
import { validate } from "./validate";
import { rewriteForXetex } from "./xetex";
import { checkRewrite } from "./xetex-check";

/**
 * The steps of an import, in order, as the progress line names them (plan section 6.4): plain
 * English, never a command's name or a line of source.
 */
export const IMPORT_STEPS = {
  intake: "Reading your files",
  reference: "Compiling your resume as it stands, slower the first time",
  fonts: "Matching its fonts to ones the page can draw",
  signatures: "Reading the template's commands",
  parse: "Reading your resume's parts",
  probe: "Finding the parts you can edit",
  request: "Preparing what is sent to learn the template",
  naming: "Asking the naming service about the template",
  rewrite: "Setting up the template's fonts",
  validate: "Checking the imported template",
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

/**
 * Names a request: the naming service's client in the browser (`nameOnService`), with the builder's
 * map of the names it wrote as placeholders, which reads the reply back under the document's own;
 * a stand-in in tests. It throws a `NamingServiceError`, whose message a person may read, when no
 * answer comes.
 */
export type NameRequest = (
  request: NamingRequest,
  names: ReadonlyMap<string, string>,
  signal?: AbortSignal,
) => Promise<NamingReply>;

/** What an import runs with. */
export interface ImportDeps {
  /** The engine's session, the worker's, which every step compiles on. */
  session: EngineSession;
  /** The fonts the page's glyphs are read with, as the page reads them. */
  fonts: FontLibrary;
  /** The tree's fonts and styles (`readTree`), which the intake and the XeTeX rewrite read. */
  tree: TexTree;
  /** The tree's images by name (`treeImages`), which a stand-in of the same size takes the place of. */
  treeImage?: (name: string) => Uint8Array | undefined;
  name: NameRequest;
}

/**
 * What the naming step came to: how many of the request's macros the service's cache answered, how
 * many it asked its model, how many keys were left unfiled because their answers disagree, and how
 * many macros it left with no answer; or, when no answer came at all, why, in the service client's
 * plain words, every macro then left as the probe left it.
 */
export type NamingOutcome =
  | { hits: number; asked: number; conflicts: number; missing: number }
  | { failed: string };

/**
 * What item 13's report is made of (decision 0038): the reference, the upload as it compiled, whose
 * glyph stream the body's words are counted in, its log left out since it quotes the source; what
 * the checks found; the locked parts, each with where it stands, why and how many words; the
 * images stood in for and dropped, and the intake's warnings; how the naming went; and the compiles
 * and time the whole import took.
 */
export interface ImportReport {
  engine: Engine;
  reference: Omit<Reference, "log">;
  checks: AssemblyChecks;
  locked: LockedPart[];
  images: Intake["images"];
  warnings: string[];
  naming: NamingOutcome;
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
  /** The model's resume, locked sections and extras among it, and the controls' choices. */
  document: Document;
  report: ImportReport;
  /** The original upload's files, as the person gave them, so that the import can be made again. */
  upload: { files: Upload[] };
  job: ImportJob;
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
    const taken = swap?.intake ?? uploaded;
    const made = swap?.reference ?? first;
    const engine = made.engine;

    enter("signatures");
    const body = bodyOf(taken);
    if (isRefusal(body)) return body;
    const read = readBody(body);
    if (isRefusal(read)) return read;
    const preamble = readBody(bodyOfText(body.preamble));
    const uses = probeUses(read, isRefusal(preamble) ? undefined : preamble);
    const found = await signatures(
      session,
      taken,
      made,
      body,
      { ...uses, commands: [...uses.commands, ...SIZE_OPTIONS] },
      options,
    );
    if (isRefusal(found)) return found;

    enter("parse");
    const built = buildTree(read, found);
    if (isRefusal(built)) return built;

    enter("probe");
    const probed = await probe(session, fonts, taken, made, built, found, options);
    // The probe leaves a pdfTeX document's format in the session; the package has one of its own,
    // its preamble rewritten, which the checks dump, so the probe's goes now (decision 0022).
    if (probed.format !== undefined) session.dropFormat("pdftex", probed.format);
    if (probed.baseline !== undefined) return refusal("probe");

    enter("request");
    const sources = sourcesOf(taken);
    const page = await pageStrings(made, fonts, taken.files);
    const requested = await buildRequest(built, found, probed, body.preamble, { sources, page });
    if (isRefusal(requested)) return requested;
    const { request, names } = requested;
    try {
      // Stricter than the masking, fed the same: the request leaves only if it holds none of the
      // resume's text (decision 0033).
      assertNoText(request, {
        tree: built,
        stored: probed.candidates
          .filter((each) => each.where === "preamble")
          .map((each) => each.text),
        sources,
        page,
        names,
      });
    } catch (error) {
      return refusal("request", undefined, error instanceof Error ? error.message : undefined);
    }

    enter("naming");
    let naming: NamingOutcome;
    let answer: NamingAnswer = {
      version: NAMING_VERSION,
      macros: [],
      preamble: { parameters: [] },
    };
    try {
      const reply = await deps.name(request, names, signal);
      answer = { version: reply.version, macros: reply.macros, preamble: reply.preamble };
      naming = {
        hits: reply.hits,
        asked: reply.asked,
        conflicts: reply.conflicts,
        missing: reply.missing.length,
      };
    } catch (error) {
      if (isAbort(signal, error)) throw error;
      // The browser holds no answers of its own: the macros stay as the probe left them, and the
      // report says why (decision 0038).
      naming = {
        failed:
          error instanceof NamingServiceError
            ? error.message
            : "The naming service could not be reached. Check the connection and try again.",
      };
    }

    let rewrite: ReturnType<typeof rewriteForXetex> | undefined;
    if (engine === "xetex") {
      enter("rewrite");
      rewrite = rewriteForXetex(taken, tree);
      if (isRefusal(rewrite)) return rewrite;
      formats.push(["xetex", CHECK_FORMAT]);
      const checked = await checkRewrite(session, fonts, taken, made, rewrite, {
        ...options,
        format: CHECK_FORMAT,
      });
      if (isRefusal(checked)) return checked;
    }

    enter("validate");
    const validated = await validate({
      session,
      fonts,
      intake: taken,
      reference: made,
      tree: built,
      signatures: found,
      probe: probed,
      answer,
      ...(rewrite === undefined || isRefusal(rewrite) ? {} : { rewrite }),
      ...(swap === undefined ? {} : { latinModern: swap.swapped }),
      ...options,
    });
    if (isRefusal(validated)) return validated;

    // What the document's compiles need beside the package, as the checks compiled it: the
    // reference compile's files for the editor's job, its bibliography under whatever job reads it.
    const jobFiles = referenceFiles(taken, made, { job: EDITOR_JOB, ...options });
    const bbl = jobFiles[`${EDITOR_JOB}.bbl`];
    delete jobFiles[`${EDITOR_JOB}.bbl`];
    const { log: _log, ...shown } = made;
    return {
      package: validated.package,
      document: validated.document,
      report: {
        engine,
        reference: shown,
        checks: validated.checks,
        locked: validated.extras,
        images: taken.images,
        warnings: taken.warnings,
        naming,
        compiles,
        ms: performance.now() - started,
      },
      upload: { files: files.map((file) => ({ name: file.name, bytes: file.bytes })) },
      job: {
        files: jobFiles,
        ...(bbl === undefined ? {} : { bbl }),
        images: [...taken.images.replaced, ...made.images].map((image) => image.path),
      },
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
 * The session as the import compiles on it: every compile, dump and PDF first stops the import
 * when `signal` has been aborted, throwing its reason, and is reported as it begins and ends
 * (`heard`, with whether it is a compile, which the count takes). Everything else goes to the
 * session as it is.
 */
function watched(
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
