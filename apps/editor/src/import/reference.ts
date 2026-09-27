/**
 * The reference compile (milestone 3 item 3, decision 0019): the original, as the intake took it
 * in, compiled from the engine's stock format in a job of its own, and its output read as the
 * page and the validation harness read one. It is what item 7's first check compares a body
 * regenerated from the model against (`sameGlyphs`), and what item 13 counts the body's words in.
 *
 * The job, `import`, is forgotten first, and the compile takes two passes, three at most, as the
 * session gives every new document. The editor's pdfTeX writes DVI (decision 0003), and a document
 * is mostly written for pdfTeX's PDF mode, so the job gets configurations that give graphics,
 * colour and hyperref dvipdfmx's driver, the one that reads an image's size from the `.xbb` the
 * intake writes beside each stand-in, and a pdfx that loads what pdfx loads without making PDF/A
 * (`COMPATIBILITY`); none sets a glyph. XeTeX finds a font by name through fontconfig, which is
 * given the tree's font folders and the job's for this compile alone
 * (`CompileOptions.fontsByName`). A compile that stops on a graphic graphicx cannot find or size,
 * as a photo a class names through a macro or a logo it keeps in the tree, gets a stand-in for it,
 * of the tree's image's size or 1 by 1, and runs again; one that stops because pdfTeX will not do,
 * as fontspec says when a class of the tree loads it, runs again on XeTeX, and so does one whose
 * source asks for either engine and that stops on a primitive pdfTeX takes only when it writes PDF.
 *
 * A compile that stops is a refusal from its log, naming the template, package, font or file it
 * lacked (`log.ts`), and so is one whose log still asks for a pass after the third, but for a
 * bibliography tool: a bibliography without its `.bbl` is left out, and says so.
 */

import type { CompileResult, Engine, EngineSession } from "../engine/session";
import { insideJob } from "../engine/session";
import { glyphTextOf, paperSize, widthsOf } from "../page/draw";
import type { FontLibrary, NativePageFont, PageFont } from "../page/fonts";
import { nativeFileName, parseNativeFont } from "../page/native";
import { type DviDocument, parseDvi, pointsPerUnit } from "../tex/dvi";
import type { GlyphTextOf } from "../tex/fields";
import { US_LETTER } from "../tex/svg";
import { parseTfm } from "../tex/tfm";
import { imageInfo, ONE_BY_ONE, ONE_POINT_PDF, standIn, tooLarge, xbb } from "./images";
import {
  DRIVER_EXTENSIONS,
  type Dropped,
  IMAGE_EXTENSIONS,
  type Intake,
  isDroppedFormat,
  pickedImage,
  type StandIn,
} from "./intake";
import {
  asksForRerun,
  bibliographyLeftOut,
  type LogWarning,
  missingGraphic,
  needsPdfMode,
  needsXetex,
  refusalOf,
  stoppedGraphic,
  UNSIZED,
  unsizedGraphic,
  warningsOf,
} from "./log";
import { extensionOf, joinPath, nameOf, withoutExtension } from "./paths";
import { type Refusal, refusal, refusedAtIntake, shownInMessage } from "./refusal";

/** A glyph of the output, where it is set and what it stands for. */
export interface ReferenceGlyph {
  kind: "glyph";
  /** A TeX font's name, or a native font's file name, as the page reads it. */
  font: string;
  /** Set by XeTeX in the native font of that file, rather than in a TeX font. */
  native?: true;
  /** The font's size, in scaled points. */
  size: number;
  /**
   * A native font's face in its file, when not the first; and what XeTeX does to it, as it writes
   * them: its colour, `(r << 24) | (g << 16) | (b << 8) | a`, and its fake slant, emboldening and
   * extent, 16.16 fixed values. Each is there only when the font has it.
   */
  index?: number;
  rgba?: number;
  slant?: number;
  embolden?: number;
  extend?: number;
  /** The character's code in a TeX font, or the glyph's number in a native font. */
  code: number;
  /** What the glyph stands for, as the page reads it (`glyphTextOf`); left out when it cannot say. */
  text?: string;
  /** Where it is set, in scaled points right of and below the output's origin, an inch in. */
  h: number;
  v: number;
}

/** A rule of the output, at its bottom left corner, and its size, in scaled points. */
export interface ReferenceRule {
  kind: "rule";
  h: number;
  v: number;
  width: number;
  height: number;
}

/** A `\special` of the output, where it is. */
export interface ReferenceSpecial {
  kind: "special";
  h: number;
  v: number;
  text: string;
}

export type ReferenceItem = ReferenceGlyph | ReferenceRule | ReferenceSpecial;

/** A page of the output: its glyphs, rules and specials, in the order the output sets them. */
export interface ReferencePage {
  items: ReferenceItem[];
}

/** What the output was set with: TeX fonts by name, native fonts by file, and the upload's own. */
export interface ReferenceFonts {
  tex: string[];
  native: string[];
  /** Fonts the page read from the upload's files, not the tree's, by name or file. */
  shipped: string[];
}

/** A glyph stream: the output read as the page reads it. */
export interface GlyphStream {
  pages: ReferencePage[];
  /** The page's size in TeX points, from its first page's specials, or US Letter without one. */
  size: { width: number; height: number };
  fonts: ReferenceFonts;
  /** The commands of the specials the output holds, once each, as `pdf:image` or `color`. */
  specials: string[];
}

/** The reference: the original's glyph stream and what its compile said. JSON as it stands. */
export interface Reference extends GlyphStream {
  engine: Engine;
  /** The log's warnings that matter (`warningsOf`). */
  warnings: LogWarning[];
  /** Whether the compile went on without the bibliography, having no `.bbl`. */
  bibliographyLeftOut: boolean;
  /**
   * Stand-ins the compile added as it ran, for graphics graphicx could not find or size: of the
   * tree's image's size for one the tree has, and 1 by 1 for one the upload lacked.
   */
  images: StandIn[];
  /** How long each pass of the compile that made the output took, in milliseconds. */
  passes: number[];
  /** Every pass the reference took, those of compiles run again among them, in milliseconds. */
  ms: number;
  /** The log of the compile that made the output, for developers only: it quotes the source. */
  log: string;
}

export interface ReferenceOptions {
  /** The job the compile runs in, forgotten first; `import` by default. */
  job?: string;
  /**
   * The tree's images by name (`treeImages`), which a stand-in of the same size takes the place
   * of when graphicx finds one of them with no `.xbb`; without it, such an image is 1 by 1.
   */
  treeImage?: (name: string) => Uint8Array | undefined;
}

/** The job the reference compile runs in. */
export const IMPORT_JOB = "import";

/** How many graphics graphicx names as it runs that one reference compile stands in for. */
export const MAX_ADDED_STAND_INS = 8;

/**
 * A graphics or colour configuration for pdfTeX's DVI: dvipdfmx's driver, which reads a stand-in's
 * size from its `.xbb` and whose specials xdvipdfmx reads, for the default and for the `pdftex`
 * and `dvips` drivers a document may name. graphics, color and xcolor share the one driver file,
 * so all three take it, or the last to load would put its own rules over the others'.
 */
const driverConfiguration = (file: string, ...more: string[]) =>
  [
    `\\ProvidesFile{${file}}[2026/09/26 resume-tools: dvipdfmx's driver for pdfTeX's DVI]`,
    "\\DeclareOption{pdftex}{\\def\\Gin@driver{dvipdfmx.def}}",
    "\\DeclareOption{dvips}{\\def\\Gin@driver{dvipdfmx.def}\\def\\c@lor@namefile{dvipsnam.def}}",
    "\\ExecuteOptions{dvipdfmx}",
    ...more,
    "\\endinput",
    "",
  ].join("\n");

/**
 * The job's graphics configuration for pdfTeX (`driverConfiguration`), which also has graphicx
 * name an image it finds no `.xbb` for, where dvipdfmx's driver would ask `extractbb` for one
 * through a pipe the engine does not have: an image of the tree, such as a class's logo, or one a
 * document names with its extension and the upload lacks, which graphicx only warns of. The
 * reference compile stands in for it and runs again (`unsizedGraphic`).
 */
export const GRAPHICS_CFG = driverConfiguration(
  "graphics.cfg",
  // dvipdfmx.def reads an opened `.xbb` with the same macro, which stays as it was for one.
  "\\AtEndOfPackage{\\let\\rt@readxbb\\Gread@extractbb@aux",
  "  \\def\\Gread@extractbb@aux#1{\\ifeof\\@inputcheck",
  `    \\PackageError{resume-tools}{${UNSIZED} \`\\Gin@base\\Gin@ext'}{}\\expandafter\\@gobble`,
  "  \\else\\expandafter\\rt@readxbb\\fi{#1}}}",
);

/** The job's colour configuration for pdfTeX, which color and xcolor read. */
export const COLOR_CFG = driverConfiguration("color.cfg");

/**
 * The job's hyperref configuration for pdfTeX, which hyperref reads before its options: its
 * `pdftex` driver, which refuses DVI, becomes dvipdfmx's, as every pdfTeX port has (decision 0008).
 * kvoptions keeps a void option's code in `\HyOpt<name>`, which the option runs.
 */
export const HYPERREF_CFG = [
  "\\ProvidesFile{hyperref.cfg}[2026/09/26 resume-tools: dvipdfmx's driver for pdfTeX's DVI]",
  "\\def\\HyOptpdftex{\\def\\Hy@driver{hdvipdfm}\\PassOptionsToPackage{dvipdfmx}{color}}",
  "\\endinput",
  "",
].join("\n");

/**
 * pdfx in the job, on either engine: pdfx makes a PDF/A or a PDF/X of pdfTeX's PDF output, or of
 * XeTeX's with shell escape, neither of which the editor has (decisions 0003 and 0008), and sets
 * no glyph. This loads what pdfx loads, xcolor and hyperref, as AltaCV's port does in its place
 * (decision 0013), and takes its options for nothing.
 */
export const PDFX_STY = [
  "\\NeedsTeXFormat{LaTeX2e}",
  "\\ProvidesPackage{pdfx}[2026/09/26 resume-tools: what pdfx loads, with no PDF/A]",
  "\\DeclareOption*{}",
  "\\ProcessOptions\\relax",
  "\\@ifpackageloaded{xcolor}{}{\\RequirePackage[rgb,hyperref]{xcolor}}",
  "\\RequirePackage{hyperref}",
  "\\endinput",
  "",
].join("\n");

/**
 * The files the reference compile gives a job on each engine, unless the upload has one of the
 * name beside its main file. The editor's pdfTeX writes DVI (decision 0003), and a document
 * written for pdfTeX's PDF mode, as most are, names drivers and loads packages that refuse DVI:
 * these take their place, and set no glyph.
 */
export const COMPATIBILITY: Readonly<Record<Engine, Readonly<Record<string, string>>>> = {
  pdftex: {
    "graphics.cfg": GRAPHICS_CFG,
    "color.cfg": COLOR_CFG,
    "hyperref.cfg": HYPERREF_CFG,
    "pdfx.sty": PDFX_STY,
  },
  xetex: { "pdfx.sty": PDFX_STY },
};

/**
 * Compile the original as the intake took it in, and read its output; or refuse it, saying why
 * in plain English, with the log for developers.
 */
export async function reference(
  session: EngineSession,
  fonts: FontLibrary,
  intake: Intake,
  options: ReferenceOptions = {},
): Promise<Reference | Refusal> {
  const job = options.job ?? IMPORT_JOB;
  const files: Record<string, Uint8Array> = { ...intake.files };
  const bibliography = `${withoutExtension(nameOf(intake.main.path))}.bbl`;
  const bbl = files[bibliography];
  const own = ownFiles(job, intake, bbl);
  const taken = Object.keys(own).find((path) => !sameBytes(files[path], own[path]));
  if (taken !== undefined) return takenName(taken, job);
  if (bbl !== undefined) files[`${job}.bbl`] = bbl;
  const added: StandIn[] = [];
  /** The names of images from outside the job the output showed that a stand-in was put in for. */
  const tried = new Set<string>();
  let engine = intake.engine;
  let ms = 0;
  for (;;) {
    session.forget(job);
    const given = { ...files };
    for (const [name, text] of Object.entries(COMPATIBILITY[engine]))
      given[name] ??= new TextEncoder().encode(text);
    let result: CompileResult;
    try {
      result = session.compile(engine, "stock", intake.main.bytes, {
        job,
        maxPasses: 3,
        files: given,
        fontsByName: engine === "xetex",
      });
    } catch (error) {
      return refusal("stopped", undefined, error instanceof Error ? error.message : String(error));
    }
    ms += result.passes.reduce((sum, pass) => sum + pass, 0);
    const output = result.output;
    if (result.ok && output !== undefined) {
      if (result.passes.length >= 3 && asksForRerun(result.log))
        return refusal("passes", undefined, result.log);
      // An image the output shows from outside the job, the tree's, as XeTeX shows a class's
      // logo it finds there, gets a stand-in of its size in the job, which is found first.
      const outside = added.length < MAX_ADDED_STAND_INS ? treeImageShown(output, job) : [];
      const stood = outside.flatMap((path) => {
        const name = nameOf(path);
        if (tried.has(name) || added.length >= MAX_ADDED_STAND_INS) return [];
        tried.add(name);
        const bytes = options.treeImage?.(path.replace(/^\/+/, ""));
        const one = bytes === undefined ? undefined : addStandIn(files, name, engine, () => bytes);
        if (one) added.push(one);
        return one ? [one] : [];
      });
      if (stood.length > 0) continue;
      let stream: GlyphStream;
      try {
        stream = await glyphStream(fonts, output, (path) => shippedFont(files, job, path));
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        return refusal("stopped", undefined, `${result.log}\n\nThe output cannot be read: ${why}`);
      }
      return {
        engine,
        ...stream,
        warnings: warningsOf(result.log, job),
        bibliographyLeftOut: bibliographyLeftOut(result.log, job),
        images: added,
        passes: result.passes,
        ms,
        log: result.log,
      };
    }
    // An image the upload holds in a format no stand-in is made for stops a document that shows
    // it, as does one of such a format the upload lacks.
    const shown = stoppedGraphic(result.log);
    const format = shown === undefined ? undefined : droppedShown(shown, intake.images.dropped);
    if (format !== undefined) return refusal("image", format, result.log);
    const graphic = missingGraphic(result.log) ?? unsizedGraphic(result.log);
    const stood =
      graphic !== undefined && added.length < MAX_ADDED_STAND_INS
        ? addStandIn(files, graphic, engine, options.treeImage)
        : undefined;
    if (stood !== undefined) {
      added.push(stood);
      continue;
    }
    // A source that asks for either engine runs on XeTeX when pdfTeX will not take it in DVI.
    const either = intake.source === "both" && needsPdfMode(result.log);
    if (engine === "pdftex" && (needsXetex(result.log) || either)) {
      engine = "xetex";
      continue;
    }
    return refusalOf(result.log);
  }
}

/**
 * The files the reference compile gave its job when it made the reference, for a compile of the
 * document as the reference compiled it: the intake's, the `.bbl` of the job's name, the stand-ins
 * the compile added as it ran, made again from what the reference says of them (`addStandIn`),
 * and the compatibility files of the engine it compiled on (`COMPATIBILITY`).
 */
export function referenceFiles(
  intake: Intake,
  made: Reference,
  options: ReferenceOptions = {},
): Record<string, Uint8Array> {
  const job = options.job ?? IMPORT_JOB;
  const files: Record<string, Uint8Array> = { ...intake.files };
  const bbl = files[`${withoutExtension(nameOf(intake.main.path))}.bbl`];
  if (bbl !== undefined) files[`${job}.bbl`] = bbl;
  for (const image of made.images) addStandIn(files, image.name, made.engine, options.treeImage);
  for (const [name, text] of Object.entries(COMPATIBILITY[made.engine]))
    files[name] ??= new TextEncoder().encode(text);
  return files;
}

/** A document compiled as the reference was, and its output read as the reference's. */
export interface LikeReference {
  stream: GlyphStream;
  /** How long each pass took, in milliseconds. */
  passes: number[];
  /** The compile's log, for developers only: it quotes the source. */
  log: string;
}

/**
 * A main file compiled as the reference compiled the original, in its job, forgotten first: from
 * the stock format, on the reference's engine, with its files (`referenceFiles`), two passes,
 * three at most, and fontconfig given the tree's fonts on XeTeX; its output read as the
 * reference's was (`glyphStream`), so that the two compare (`sameGlyphs`). A refusal when the
 * compile stops, or its log still asks for a pass after the third. The job is left holding the
 * compile, as the reference's is.
 */
export async function compileLikeReference(
  session: EngineSession,
  fonts: FontLibrary,
  intake: Intake,
  made: Reference,
  main: Uint8Array,
  options: ReferenceOptions = {},
): Promise<LikeReference | Refusal> {
  const job = options.job ?? IMPORT_JOB;
  const files = referenceFiles(intake, made, options);
  session.forget(job);
  let result: CompileResult;
  try {
    result = session.compile(made.engine, "stock", main, {
      job,
      maxPasses: 3,
      files,
      fontsByName: made.engine === "xetex",
    });
  } catch (error) {
    return refusal("stopped", undefined, error instanceof Error ? error.message : String(error));
  }
  if (!result.ok || result.output === undefined) return refusalOf(result.log);
  if (result.passes.length >= 3 && asksForRerun(result.log))
    return refusal("passes", undefined, result.log);
  try {
    const stream = await glyphStream(fonts, result.output, (path) => shippedFont(files, job, path));
    return { stream, passes: result.passes, log: result.log };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return refusal("stopped", undefined, `${result.log}\n\nThe output cannot be read: ${why}`);
  }
}

/**
 * What the reference compile writes into the job whatever the upload holds there: the job's body,
 * `<job>.tex`, the main file; its `.bbl`, the upload's of the main file's name; on the intake's
 * engine, the compatibility files (`COMPATIBILITY`), pdfTeX's names holding XeTeX's; and nothing
 * the upload may hold under any other name of the job's, which the engine writes, `<job>.aux` and
 * `<job>.pdf` among them. A file of the upload's under one of these names must hold what the
 * compile gives it, or the upload is refused (`takenName`). The session's `.fonts.conf` and the
 * stand-ins' `.xbb` files need no check: the intake passes over dot files and `.xbb` files alike.
 */
function ownFiles(
  job: string,
  intake: Intake,
  bbl: Uint8Array | undefined,
): Record<string, Uint8Array> {
  const own: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(COMPATIBILITY[intake.engine]))
    own[name] = new TextEncoder().encode(text);
  for (const path of Object.keys(intake.files))
    if (!path.includes("/") && withoutExtension(path) === job) own[path] = NOTHING;
  own[`${job}.tex`] = intake.main.bytes;
  if (bbl !== undefined) own[`${job}.bbl`] = bbl;
  return own;
}

/** No bytes the compile would give a file, so that any the upload's file holds differ. */
const NOTHING = new Uint8Array(0);

/** Whether a job's file, if it has one, holds the bytes the compile gives it. */
function sameBytes(held: Uint8Array | undefined, own: Uint8Array | undefined): boolean {
  if (held === undefined) return true;
  if (own === undefined || own === NOTHING || held.length !== own.length) return false;
  return held.every((byte, i) => byte === own[i]);
}

/**
 * A refusal of an upload holding a file where the compile writes its own: one named as the job is,
 * or one of the files the reference compile gives the job.
 */
function takenName(path: string, job: string): Refusal {
  const shown = shownInMessage(path);
  return withoutExtension(path) === job
    ? refusedAtIntake(
        `This upload holds ${shown}, whose name this editor gives its own copy of the resume. Rename it, and upload the resume again.`,
        path,
      )
    : refusedAtIntake(
        `This upload holds ${shown}, a file this editor writes itself. Take it out, and upload the resume again.`,
        path,
      );
}

/** The file an image special names, as it names it, relative or not: `(photo.png)` in it. */
const IMAGE_SPECIAL = /^\s*pdf:\s*(?:image|img|epdf)\b[\sA-Za-z0-9.+\-@_]*\(([^()\\]*)\)/i;

/**
 * The files outside the job that an output's image specials show, as they name them: the tree's,
 * by their paths there, which XeTeX writes for a picture it found in the tree.
 */
function treeImageShown(output: Uint8Array, job: string): string[] {
  let doc: DviDocument;
  try {
    doc = parseDvi(output, () => undefined);
  } catch {
    return [];
  }
  const outside = new Set<string>();
  for (const page of doc.pages)
    for (const item of page.items) {
      if (item.kind !== "special") continue;
      const file = IMAGE_SPECIAL.exec(item.text)?.[1];
      if (file !== undefined && file.startsWith("/") && insideJob(job, file) === undefined)
        outside.add(file);
    }
  return [...outside];
}

/**
 * The upload's image in a format no stand-in is made for that a graphic a compile stopped on names,
 * by its name in the upload: the one at that path in the job, or, for a name without an extension,
 * one of that name with an extension graphicx tries, beside it or in a folder of `\graphicspath`;
 * or the name itself when it is of such a format and the upload holds none of it.
 */
function droppedShown(name: string, dropped: readonly Dropped[]): string | undefined {
  const path = joinPath("", name.replace(/^(?:\.\/)+/, ""));
  if (path === undefined) return undefined;
  const extension = extensionOf(path);
  const matches = (at: string) =>
    extension === ""
      ? DRIVER_EXTENSIONS.some((each) => at === `${path}${each}` || at.endsWith(`/${path}${each}`))
      : at === path || at.endsWith(`/${path}`);
  const held = dropped.find((each) => each.why === "format" && each.path && matches(each.path));
  if (held) return held.name;
  return isDroppedFormat(path) ? name : undefined;
}

/**
 * A stand-in for a graphic graphicx named and could not find or could not size, where it looks
 * first: of the tree image's size when `treeImage` has one of the name, and 1 by 1 otherwise, a PDF
 * for a name ending in `.pdf`, a PNG otherwise, `.png` added to a name with no extension; and for
 * pdfTeX, the `.xbb` of its name, when graphicx takes it before another image of the name the job
 * holds (`pickedImage`), whose own it keeps otherwise. Undefined when the name is not a path inside
 * the job, is of a format no stand-in is made for, or the job has a file there already, which
 * graphicx would have found and sized.
 */
function addStandIn(
  files: Record<string, Uint8Array>,
  name: string,
  engine: Engine,
  treeImage: ReferenceOptions["treeImage"],
): StandIn | undefined {
  const path = joinPath("", name.replace(/^(?:\.\/)+/, ""));
  if (path === undefined) return undefined;
  const extension = extensionOf(path);
  if (extension !== "" && !IMAGE_EXTENSIONS.includes(extension)) return undefined;
  const at = extension === "" ? `${path}.png` : path;
  if (files[at] !== undefined) return undefined;
  const bytes = extension === "" ? undefined : treeImage?.(path);
  const found = bytes && imageInfo(bytes);
  const tree =
    found && !tooLarge(found) && (found.kind === "pdf") === (extension === ".pdf")
      ? found
      : undefined;
  const info = tree ?? (extension === ".pdf" ? ONE_POINT_PDF : ONE_BY_ONE);
  files[at] = standIn(info);
  if (engine === "pdftex") {
    const base = withoutExtension(at);
    const others = DRIVER_EXTENSIONS.map((each) => `${base}${each}`).filter(
      (other) => other !== at && files[other] !== undefined,
    );
    if (pickedImage([at, ...others]) === at)
      files[`${base}.xbb`] = new TextEncoder().encode(xbb(info));
  }
  return tree
    ? { name, path: at, kind: info.kind, tree: true }
    : { name, path: at, kind: info.kind, missing: true };
}

/**
 * The bytes of a font the output names, when they are the upload's: a native font whose path is
 * inside the job, or a TFM at the job's top, where TeX looks first.
 */
export function shippedFont(
  files: Readonly<Record<string, Uint8Array>>,
  job: string,
  path: string,
): Uint8Array | undefined {
  const inJob = insideJob(job, path);
  return inJob === undefined ? undefined : files[inJob];
}

/** Scaled points per point. */
const SP = 65536;

/**
 * An output read as the page and the validation harness read it: its fonts loaded as the page
 * loads them, TeX fonts by name and XeTeX's native fonts by file, from the tree, or from the upload
 * when `shipped` has their bytes; the output parsed with the TeX fonts' widths, and each glyph
 * named as the page names it (`glyphTextOf`). A font that cannot be loaded names no glyph, and a
 * TeX font TeX Live has no metrics for moves nothing after it. Item 7 reads a regenerated body's
 * output the same way, to compare it with the reference's.
 */
export async function glyphStream(
  fonts: FontLibrary,
  output: Uint8Array,
  shipped: (path: string) => Uint8Array | undefined = () => undefined,
): Promise<GlyphStream> {
  return (await readOutput(fonts, output, shipped)).stream;
}

/**
 * An output read as `glyphStream` reads it, with what it read it through: the output parsed with
 * the TeX fonts' widths, as the page parses it, and the text of each of its glyphs, as the page
 * names them (`glyphTextOf`), which `collectFields` takes. The probe (item 5) reads a marked
 * output's fields with them, and its glyph stream to compare with the reference's.
 */
export async function readOutput(
  fonts: FontLibrary,
  output: Uint8Array,
  shipped: (path: string) => Uint8Array | undefined = () => undefined,
): Promise<{ stream: GlyphStream; doc: DviDocument; textOf: GlyphTextOf }> {
  const doc = parseDvi(output, () => undefined);
  const fromUpload = new Set<string>();
  const loaded = new Map<string, PageFont>();
  for (const name of loadedNames(doc)) {
    let font: PageFont | undefined;
    try {
      font = await fonts.load(name);
    } catch {
      font = undefined;
    }
    // A font TeX Live lacks may be the upload's, whose metrics place its glyphs; with no outlines,
    // the page names none of them. One TeX Live has is taken to be the same as the upload's.
    const own = font === undefined ? shipped(`${name}.tfm`) : undefined;
    if (own !== undefined) {
      font = {
        kind: "tex",
        name,
        tfm: parseTfm(own),
        missing: "the upload ships its metrics and no outlines the page reads",
        text: () => undefined,
      };
      fromUpload.add(name);
    }
    if (font !== undefined) loaded.set(name, font);
  }
  const natives = new Map<string, NativePageFont>();
  for (const def of doc.nativeFonts.values()) {
    const file = nativeFileName(def.name);
    if (natives.has(file)) continue;
    const own = shipped(def.name);
    try {
      if (own !== undefined) {
        natives.set(file, { kind: "native", name: file, file: parseNativeFont(own) });
        fromUpload.add(file);
      } else {
        const font = await fonts.loadNative(file);
        if (font !== undefined) natives.set(file, font);
      }
    } catch {
      // A font that cannot be read names no glyph.
    }
  }
  const placed = parseDvi(output, widthsOf(loaded));
  const textOf = glyphTextOf(placed, loaded, natives);
  const sp = pointsPerUnit(placed) * SP;
  const at = (units: number) => Math.round(units * sp);
  const pages = placed.pages.map((page): ReferencePage => {
    const items: ReferenceItem[] = [];
    for (const item of page.items) {
      if (item.kind === "glyph") {
        const font = placed.fonts.get(item.font);
        const text = textOf(item);
        items.push({
          kind: "glyph",
          font: font?.name ?? "",
          size: at(font?.scale ?? 0),
          code: item.code,
          ...(text === undefined ? {} : { text }),
          h: at(item.h),
          v: at(item.v),
        });
      } else if (item.kind === "native") {
        const font = placed.nativeFonts.get(item.font);
        const drawn = {
          ...(font?.index ? { index: font.index } : {}),
          ...(font?.rgba === undefined ? {} : { rgba: font.rgba }),
          ...(font?.slant === undefined ? {} : { slant: font.slant }),
          ...(font?.embolden === undefined ? {} : { embolden: font.embolden }),
          ...(font?.extend === undefined ? {} : { extend: font.extend }),
        };
        item.glyphs.forEach((glyph, index) => {
          const text = textOf(item, index);
          items.push({
            kind: "glyph",
            font: nativeFileName(font?.name ?? ""),
            native: true,
            size: at(font?.size ?? 0),
            ...drawn,
            code: glyph.id,
            ...(text === undefined ? {} : { text }),
            h: at(item.h + glyph.x),
            v: at(item.v + glyph.y),
          });
        });
      } else if (item.kind === "rule")
        items.push({
          kind: "rule",
          h: at(item.h),
          v: at(item.v),
          width: at(item.width),
          height: at(item.height),
        });
      else if (item.kind === "special")
        items.push({ kind: "special", h: at(item.h), v: at(item.v), text: item.text });
    }
    return { items };
  });
  const stream: GlyphStream = {
    pages,
    size: paperSize(placed.pages[0] ?? { items: [] }) ?? US_LETTER,
    fonts: {
      tex: [...loadedNames(placed)].sort(),
      native: [
        ...new Set([...placed.nativeFonts.values()].map((f) => nativeFileName(f.name))),
      ].sort(),
      shipped: [...fromUpload].sort(),
    },
    specials: [...new Set(pages.flatMap((page) => page.items.flatMap(specialCommand)))].sort(),
  };
  return { stream, doc: placed, textOf };
}

/** The TeX fonts an output names. */
const loadedNames = (doc: DviDocument) => new Set([...doc.fonts.values()].map((font) => font.name));

/**
 * A special's command, as the reference lists the specials it saw: `pdf:`, `x:` or `dvipdfmx:`
 * and the keyword after it, the key of a `key=value` special such as `papersize=`, the editor's
 * markers by their kind, or the first word.
 */
export function specialCommand(item: ReferenceItem): string[] {
  if (item.kind !== "special") return [];
  const text = item.text.trim();
  const prefixed = /^(pdf|x|dvipdfmx|rt):\s*([A-Za-z]+)/i.exec(text);
  if (prefixed) return [`${prefixed[1]?.toLowerCase()}:${prefixed[2]}`];
  const keyed = /^([A-Za-z]+)=/.exec(text);
  if (keyed) return [`${keyed[1]}=`];
  const word = /^[A-Za-z]+:?/.exec(text)?.[0];
  return word === undefined ? [] : [word];
}

/** How far two glyphs, rules or specials may be apart and be at the same place, in scaled points. */
export const TOLERANCE = 1;

/**
 * The editor's own specials, which a marked body adds (decision 0007): a field's begin and end
 * markers, its paragraph, and the lock markers item 12 adds.
 */
const EDITOR_MARKER = /^rt:[bepl]:/i;

/**
 * The specials LaTeX writes at the first shipout of a whole compile, which a body compiled from a
 * dumped format lacks, and which set nothing on the page (decisions 0003 and 0014): hyperref's PDF
 * version and dvipdfmx's configuration. xcolor's black, the fourth, is found by where it is
 * (`firstBlack`).
 */
const FIRST_SHIPOUT = /^(?:pdf:\s*(?:majorversion|minorversion)|dvipdfmx:\s*config)(?![A-Za-z])/i;

/**
 * xcolor's black of a whole compile's first shipout, `color push gray 0`, which no `color pop`
 * ever takes off: at the end of the output, the bottom of the colour stack, with any other black
 * nothing takes off above it, the black the PDF starts in. A body compiled from a dumped format
 * has not the first, so both streams leave all of them out.
 */
function firstBlack(stream: GlyphStream): Set<ReferenceItem> {
  const stack: ReferenceItem[] = [];
  for (const page of stream.pages)
    for (const item of page.items) {
      if (item.kind !== "special") continue;
      if (/^color\s+push\b/i.test(item.text.trim())) stack.push(item);
      else if (/^color\s+pop\b/i.test(item.text.trim())) stack.pop();
    }
  const black = new Set<ReferenceItem>();
  for (const item of stack) {
    if (item.kind !== "special" || !/^color\s+push\s+gray\s+0(?:\.0*)?$/i.test(item.text.trim()))
      break;
    black.add(item);
  }
  return black;
}

/**
 * Whether two glyph streams set the same glyphs at the same places: the same number of pages of
 * the same size, and on each the same glyphs, each in the same font, and for a native font the
 * same face, colour, slant, emboldening and extent, at the same size with the same code; the same
 * rules; and the same specials, colour, links and images among them, each of the same text; all in
 * the same order, each within TOLERANCE of the other's place and size. The specials left out are
 * the editor's markers, which a marked body adds, and those of a whole compile's first shipout,
 * which a body compiled from a dumped format lacks and which set nothing on the page.
 */
export function sameGlyphs(a: GlyphStream, b: GlyphStream): boolean {
  return difference(a, b) === undefined;
}

/**
 * What kind of difference two glyph streams first show: a page more or fewer (`pages`), a page of
 * another size (`size`), a page with more or fewer items (`count`), two glyphs that are not the
 * same glyph (`glyph`), two rules of other sizes (`rule`), two specials of other texts (`special`),
 * two items of other kinds (`kind`), or the same item at another place (`position`).
 */
export type DifferenceKind =
  | "pages"
  | "size"
  | "count"
  | "glyph"
  | "rule"
  | "special"
  | "kind"
  | "position";

/** Where two glyph streams first differ, and how, for a developer and the corpus's table. */
export interface Difference {
  kind: DifferenceKind;
  /** The difference in words, naming pages, fonts, codes, specials' commands and places. */
  text: string;
  /**
   * Where the second stream parts from the first: its page, from 0, and its item there, or its
   * page's last when it has fewer; none for a page more or fewer, or of another size. The probe
   * reads the field whose markers come before it as the one that moved it.
   */
  page?: number;
  item?: ReferenceItem;
}

/**
 * Where two glyph streams first differ, and how, or undefined when they set the same glyphs at the
 * same places (`sameGlyphs`). It names pages, fonts, codes, specials' commands and places, never a
 * glyph's text or a special's.
 */
export function difference(a: GlyphStream, b: GlyphStream): Difference | undefined {
  if (a.pages.length !== b.pages.length)
    return { kind: "pages", text: `${a.pages.length} pages against ${b.pages.length}` };
  const near = (x: number, y: number) => Math.abs(x - y) <= TOLERANCE;
  const pt = (points: number) => Math.round(points * SP);
  if (!near(pt(a.size.width), pt(b.size.width)) || !near(pt(a.size.height), pt(b.size.height)))
    return {
      kind: "size",
      text: `a page of ${a.size.width} by ${a.size.height} pt against ${b.size.width} by ${b.size.height} pt`,
    };
  const counted = (stream: GlyphStream) => {
    const black = firstBlack(stream);
    return (item: ReferenceItem) =>
      item.kind !== "special" ||
      !(EDITOR_MARKER.test(item.text) || FIRST_SHIPOUT.test(item.text.trim()) || black.has(item));
  };
  const ourCount = counted(a);
  const theirCount = counted(b);
  for (const [index, page] of a.pages.entries()) {
    const ours = page.items.filter(ourCount);
    const theirs = (b.pages[index]?.items ?? []).filter(theirCount);
    const where = `page ${index + 1}`;
    for (let i = 0; i < Math.max(ours.length, theirs.length); i++) {
      const x = ours[i];
      const y = theirs[i];
      const at = y ?? theirs.at(-1);
      const place = { page: index, ...(at === undefined ? {} : { item: at }) };
      if (x === undefined || y === undefined)
        return {
          kind: "count",
          text: `${where} sets ${ours.length} glyphs, rules and specials against ${theirs.length}`,
          ...place,
        };
      const kind = differs(x, y, near);
      if (kind !== undefined)
        return {
          kind,
          text: `${where}, item ${i + 1}: ${describe(x)} against ${describe(y)}`,
          ...place,
        };
    }
  }
  return undefined;
}

/** How two items differ, or undefined when they are the same at the same place. */
function differs(
  x: ReferenceItem,
  y: ReferenceItem,
  near: (x: number, y: number) => boolean,
): DifferenceKind | undefined {
  const placed = near(x.h, y.h) && near(x.v, y.v);
  if (x.kind === "glyph" && y.kind === "glyph") {
    const same =
      x.font === y.font &&
      x.native === y.native &&
      x.size === y.size &&
      x.index === y.index &&
      x.rgba === y.rgba &&
      x.slant === y.slant &&
      x.embolden === y.embolden &&
      x.extend === y.extend &&
      x.code === y.code;
    return !same ? "glyph" : placed ? undefined : "position";
  }
  if (x.kind === "rule" && y.kind === "rule")
    return !(near(x.width, y.width) && near(x.height, y.height))
      ? "rule"
      : placed
        ? undefined
        : "position";
  if (x.kind === "special" && y.kind === "special")
    return x.text !== y.text ? "special" : placed ? undefined : "position";
  return x.kind === "special" || y.kind === "special" ? "special" : "kind";
}

/**
 * Where two glyph streams first differ, for a developer, or undefined when they set the same
 * glyphs at the same places (`sameGlyphs`). It names pages, fonts, codes, specials' commands and
 * places, never a glyph's text or a special's.
 */
export function firstDifference(a: GlyphStream, b: GlyphStream): string | undefined {
  return difference(a, b)?.text;
}

/**
 * An item as a difference names it: a glyph's font, what XeTeX does to it, size and code; a rule's
 * size; a special's command alone, since its text may be the resume's, as a link's address is; and
 * its place.
 */
function describe(item: ReferenceItem): string {
  const place = `at (${item.h}, ${item.v}) sp`;
  if (item.kind === "rule") return `a rule ${item.width} by ${item.height} sp ${place}`;
  if (item.kind === "special") return `a special ${specialCommand(item)[0] ?? "?"} ${place}`;
  const drawn = (["index", "rgba", "slant", "embolden", "extend"] as const)
    .flatMap((key) => (item[key] === undefined ? [] : [`${key} ${item[key]}`]))
    .join(", ");
  return `${item.native ? "glyph" : "code"} ${item.code} of ${item.font}${drawn === "" ? "" : ` (${drawn})`} at ${item.size} sp ${place}`;
}
