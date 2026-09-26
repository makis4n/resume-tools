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
import { US_LETTER } from "../tex/svg";
import { parseTfm } from "../tex/tfm";
import { imageInfo, ONE_BY_ONE, ONE_POINT_PDF, standIn, xbb } from "./images";
import type { Intake, StandIn } from "./intake";
import {
  asksForRerun,
  bibliographyLeftOut,
  type LogWarning,
  missingGraphic,
  needsPdfMode,
  needsXetex,
  refusalOf,
  UNSIZED,
  unsizedGraphic,
  warningsOf,
} from "./log";
import { extensionOf, joinPath, nameOf, withoutExtension } from "./paths";
import { type Refusal, refusal } from "./refusal";

/** A glyph of the output, where it is set and what it stands for. */
export interface ReferenceGlyph {
  kind: "glyph";
  /** A TeX font's name, or a native font's file name, as the page reads it. */
  font: string;
  /** Set by XeTeX in the native font of that file, rather than in a TeX font. */
  native?: true;
  /** The font's size, in scaled points. */
  size: number;
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
  if (bbl !== undefined) files[`${job}.bbl`] = bbl;
  const added: StandIn[] = [];
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
 * A stand-in, and its `.xbb` for pdfTeX, for a graphic graphicx named and could not find or could
 * not size, where it looks first: of the tree image's size when `treeImage` has one of the name,
 * and 1 by 1 otherwise, a PDF for a name ending in `.pdf`, a PNG otherwise, `.png` added to a name
 * with no extension. Undefined when the name is not a path inside the job, or the job has a file
 * there already, which graphicx would have found and sized.
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
  const at = extension === "" ? `${path}.png` : path;
  if (files[at] !== undefined) return undefined;
  const bytes = extension === "" ? undefined : treeImage?.(path);
  const found = bytes && imageInfo(bytes);
  const tree = found && (found.kind === "pdf") === (extension === ".pdf") ? found : undefined;
  const info = tree ?? (extension === ".pdf" ? ONE_POINT_PDF : ONE_BY_ONE);
  files[at] = standIn(info);
  if (engine === "pdftex")
    files[`${withoutExtension(at)}.xbb`] = new TextEncoder().encode(xbb(info));
  return tree
    ? { name, path: at, kind: info.kind, tree: true }
    : { name, path: at, kind: info.kind, missing: true };
}

/**
 * The bytes of a font the output names, when they are the upload's: a native font whose path is
 * inside the job, or a TFM at the job's top, where TeX looks first.
 */
function shippedFont(
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
        item.glyphs.forEach((glyph, index) => {
          const text = textOf(item, index);
          items.push({
            kind: "glyph",
            font: nativeFileName(font?.name ?? ""),
            native: true,
            size: at(font?.size ?? 0),
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
  return {
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

/** How far two glyphs or rules may be apart and be at the same place, in scaled points. */
export const TOLERANCE = 1;

/**
 * Whether two glyph streams set the same glyphs at the same places: the same number of pages of
 * the same size, and on each the same glyphs, each in the same font at the same size with the same
 * code, and the same rules, in the same order, each within TOLERANCE of the other's place and
 * size. Specials are no part of it: the editor's markers (decision 0007) are what a marked body
 * adds, and a body compiled from a dumped format lacks the specials LaTeX writes at the first
 * shipout (decisions 0003 and 0014), which set nothing on the page.
 */
export function sameGlyphs(a: GlyphStream, b: GlyphStream): boolean {
  return firstDifference(a, b) === undefined;
}

/**
 * Where two glyph streams first differ, for a developer, or undefined when they set the same
 * glyphs at the same places (`sameGlyphs`). It names pages, fonts, codes and places, never a
 * glyph's text.
 */
export function firstDifference(a: GlyphStream, b: GlyphStream): string | undefined {
  if (a.pages.length !== b.pages.length) return `${a.pages.length} pages against ${b.pages.length}`;
  const near = (x: number, y: number) => Math.abs(x - y) <= TOLERANCE;
  const pt = (points: number) => Math.round(points * SP);
  if (!near(pt(a.size.width), pt(b.size.width)) || !near(pt(a.size.height), pt(b.size.height)))
    return `a page of ${a.size.width} by ${a.size.height} pt against ${b.size.width} by ${b.size.height} pt`;
  const marks = (item: ReferenceItem): item is ReferenceGlyph | ReferenceRule =>
    item.kind !== "special";
  for (const [index, page] of a.pages.entries()) {
    const ours = page.items.filter(marks);
    const theirs = (b.pages[index]?.items ?? []).filter(marks);
    const where = `page ${index + 1}`;
    for (let i = 0; i < Math.max(ours.length, theirs.length); i++) {
      const x = ours[i];
      const y = theirs[i];
      if (x === undefined || y === undefined)
        return `${where} sets ${ours.length} glyphs and rules against ${theirs.length}`;
      const same =
        x.kind === "glyph" && y.kind === "glyph"
          ? x.font === y.font &&
            x.native === y.native &&
            x.size === y.size &&
            x.code === y.code &&
            near(x.h, y.h) &&
            near(x.v, y.v)
          : x.kind === "rule" && y.kind === "rule"
            ? near(x.h, y.h) && near(x.v, y.v) && near(x.width, y.width) && near(x.height, y.height)
            : false;
      if (!same) return `${where}, item ${i + 1}: ${describe(x)} against ${describe(y)}`;
    }
  }
  return undefined;
}

/** A glyph or rule as a difference names it: its font, size and code, or its size, and place. */
function describe(item: ReferenceGlyph | ReferenceRule): string {
  const place = `at (${item.h}, ${item.v}) sp`;
  if (item.kind === "rule") return `a rule ${item.width} by ${item.height} sp ${place}`;
  return `${item.native ? "glyph" : "code"} ${item.code} of ${item.font} at ${item.size} sp ${place}`;
}
