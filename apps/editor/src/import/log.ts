/**
 * What the import pipeline reads of its reference compile's log (decision 0019): why a compile
 * stopped, as a refusal that names what is missing; a graphic graphicx could not find, which a
 * stand-in can take the place of; whether the log asks for another pass for anything but a
 * bibliography tool, which the engine does not have; and, of a compile that finished, the
 * warnings that matter: files and fonts it did without, and characters its fonts lack.
 *
 * A log quotes the source it stopped in, so what these return is names alone: of classes,
 * packages, fonts, files and commands, as TeX and LaTeX name them, never a line of the log. The
 * session sets `max_print_line` high enough that TeX does not wrap the lines read here.
 */

import { summariseLog } from "../engine/log";
import { extensionOf } from "./paths";
import { type Refusal, refusal } from "./refusal";

/** LaTeX's error for a file it cannot find: a class, a package, a source or a graphic. */
const FILE_NOT_FOUND = /^LaTeX Error: File `(.+)' not found\.$/;

/**
 * The first line after the error when LaTeX asks for a file by name (`\@missingfileerror`), as it
 * does for `\documentclass`, `\usepackage` and `\input`; graphicx's error for an image has none.
 */
const ASKS_FOR_A_FILE = /^Type X to quit or <RETURN> to proceed,/;

/** TeX's own error for a file `\input` names in its primitive form. */
const CANNOT_FIND = /^I can't find file `(.+)'\.$/;

/** fontspec's error for a font fontconfig or kpathsea cannot find. */
const FONTSPEC_FONT = /^Package fontspec Error: The font "(.+)" cannot be found\.$/;

/** TeX's error for a font it cannot load: pdfTeX's TFM, or XeTeX's installed font or file. */
const NOT_LOADABLE = /^Font \S+?=(.+?)(?: at [\d.]+pt| scaled \d+)? not loadable: /;

/** Errors that say only LuaTeX will do. */
const NEEDS_LUATEX =
  /LuaTeX is required|requires LuaTeX|only works with LuaTeX|LuaLaTeX is required/i;

/** Errors that say XeTeX or LuaTeX will do, as fontspec's does under pdfTeX. */
const NEEDS_XETEX =
  /requires either XeTeX or|requires XeTeX|XeTeX is required|requires XeLaTeX|XeLaTeX is required/i;

/** The images a stand-in can take the place of, by extension, and a name without one. */
const STAND_IN_EXTENSIONS = new Set(["", ".png", ".jpg", ".jpeg", ".pdf"]);

/** TeX Live's packages of babel's languages, by the options that ask for them. */
const BABEL_PACKAGES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    ["german", "ngerman", "austrian", "naustrian", "swissgerman", "nswissgerman"].map((option) => [
      option,
      "german",
    ]),
  ),
  ...Object.fromEntries(
    ["french", "frenchb", "francais", "acadian", "canadien"].map((option) => [option, "french"]),
  ),
  ...Object.fromEntries(
    ["portuguese", "portuges", "brazilian", "brazil"].map((option) => [option, "portuges"]),
  ),
  ...Object.fromEntries(["norsk", "nynorsk", "norwegian"].map((option) => [option, "norsk"])),
  ...Object.fromEntries(["spanish", "spanishmx"].map((option) => [option, "spanish"])),
};

/**
 * The TeX Live package that holds a babel language, `babel-` and its name, by the option a
 * document gives babel for it, as `ngerman` asks for babel-german.
 */
export const babelPackage = (option: string) => `babel-${BABEL_PACKAGES[option] ?? option}`;

/** The first error of a log, `! ` taken off, and the lines after it. */
function firstError(log: string): { error: string; after: string[] } | undefined {
  const lines = log.split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith("! "));
  if (at < 0) return undefined;
  return { error: (lines[at] ?? "").slice(2), after: lines.slice(at + 1, at + 12) };
}

/** The first line after an error that is not blank. */
const nextLine = (after: readonly string[]) => after.find((line) => line.trim() !== "") ?? "";

/**
 * A font's name as TeX's error gives it: the file of `[path/file.otf]`, the family of `"Family"`,
 * each without the features after a colon or a slash, or the TFM's name as it is.
 */
export function fontName(given: string): string {
  const quoted = /^"(.*)"$/.exec(given.trim())?.[1] ?? given.trim();
  const file = /^\[([^\]]*)\]/.exec(quoted)?.[1];
  if (file !== undefined) return file.slice(file.lastIndexOf("/") + 1);
  return quoted.replace(/[:/].*$/, "").trim();
}

/**
 * Why a compile that stopped did, as a refusal: the template, package or file LaTeX could not
 * find, by the name it gives; the font fontspec or TeX could not load; LuaTeX, when an error says
 * only it will do; and stopped for anything else, with an undefined command's name, which is for
 * developers and never shown. The log goes with it, for developers.
 */
export function refusalOf(log: string): Refusal {
  const found = firstError(log);
  if (found === undefined) return refusal("stopped", undefined, log);
  const { error, after } = found;
  const file = FILE_NOT_FOUND.exec(error)?.[1];
  if (file !== undefined && ASKS_FOR_A_FILE.test(nextLine(after))) {
    const extension = extensionOf(file);
    if (extension === ".cls") return refusal("class", file.slice(0, -4), log);
    if (extension === ".sty") return refusal("package", file.slice(0, -4), log);
    return refusal("file", file, log);
  }
  // A graphic named by a path out of the main file's folder, which no stand-in can take the place of.
  if (file !== undefined && (file.startsWith("/") || file.split("/").includes("..")))
    return refusal("file", file, log);
  const input = CANNOT_FIND.exec(error)?.[1];
  if (input !== undefined) return refusal("file", input, log);
  const style = /^Package biblatex Error: Style '([^']+)' not found\.$/.exec(error)?.[1];
  if (style !== undefined) return refusal("package", `biblatex-${style}`, log);
  const language = /^Package babel Error: Unknown option '([^']+)'\./.exec(error)?.[1];
  if (language !== undefined) return refusal("package", babelPackage(language), log);
  const font = FONTSPEC_FONT.exec(error)?.[1] ?? NOT_LOADABLE.exec(error)?.[1];
  if (font !== undefined) return refusal("font", fontName(font), log);
  if (NEEDS_LUATEX.test([error, ...after.slice(0, 4)].join(" ")))
    return refusal("luatex", undefined, log);
  if (error === "Undefined control sequence.") {
    const command = /(\\[A-Za-z@]+|\\.)\s*$/.exec(nextLine(after))?.[1];
    return refusal("stopped", command, log);
  }
  return refusal("stopped", undefined, log);
}

/**
 * Whether a compile stopped because pdfTeX would not do, as fontspec says when a class the tree
 * holds loads it under pdfTeX: a source may ask for XeTeX in a way reading it cannot see.
 */
export function needsXetex(log: string): boolean {
  const found = firstError(log);
  return (
    found !== undefined && NEEDS_XETEX.test([found.error, ...found.after.slice(0, 4)].join(" "))
  );
}

/**
 * Whether a pdfTeX compile stopped on a primitive pdfTeX takes only when it writes PDF, as pdfx
 * calls `\pdfmapline`: the editor's pdfTeX writes DVI (decision 0003), which XeTeX's output is too.
 */
export function needsPdfMode(log: string): boolean {
  const found = firstError(log);
  return (
    found !== undefined &&
    /^pdfTeX error \(\\[A-Za-z]+\): not allowed in DVI mode/.test(found.error)
  );
}

/**
 * The graphic a compile stopped on because graphicx could not find it, as graphicx names it, when
 * a stand-in can take its place: a name with no extension, or a PNG's, JPEG's or PDF's. graphicx's
 * error is LaTeX's for a missing file, but not the one that asks for a file by name; and for a name
 * with an extension, graphicx only warns that it is missing and goes on to read its `.xbb`, which
 * dvipdfmx's driver, finding none, asks `extractbb` for through a pipe the engine does not have.
 */
export function missingGraphic(log: string): string | undefined {
  const found = firstError(log);
  if (found === undefined) return undefined;
  let file = FILE_NOT_FOUND.exec(found.error)?.[1];
  if (file !== undefined && ASKS_FOR_A_FILE.test(nextLine(found.after))) return undefined;
  if (file === undefined && /^LaTeX Error: Cannot run pipe command/.test(found.error)) {
    const before = log.slice(0, log.indexOf(`! ${found.error}`));
    file = [...before.matchAll(/^LaTeX Warning: File `(.+)' not found on input line/gm)].at(
      -1,
    )?.[1];
  }
  return file !== undefined && STAND_IN_EXTENSIONS.has(extensionOf(file)) ? file : undefined;
}

/**
 * The words the reference compile's `graphics.cfg` has graphicx say of an image it finds no `.xbb`
 * for, before the image's name in quotes (`GRAPHICS_CFG` in `reference.ts`).
 */
export const UNSIZED = "No size for";

/** The image graphicx found and could not size, by the name it found it under, if it said so. */
export function unsizedGraphic(log: string): string | undefined {
  const found = firstError(log);
  return (
    found &&
    new RegExp(`^Package resume-tools Error: ${UNSIZED} \`(.+)'\\.?$`).exec(found.error)?.[1]
  );
}

/**
 * biblatex's request for Biber or BibTeX, which the engine does not have, so that no pass can
 * answer it: the warning and the lines that carry it on.
 */
const BIBLIOGRAPHY_TOOL =
  /^Package biblatex Warning: Please \(re\)run (?:Biber|BibTeX) on the file:\n(?:\(biblatex\).*\n?)*/gm;

/**
 * Whether the log asks for another pass for anything but a bibliography tool: biblatex asks for
 * Biber and a rerun on every pass when there is no `.bbl`, which is a bibliography left out, not a
 * compile that does not settle.
 */
export function asksForRerun(log: string): boolean {
  return summariseLog(log.replace(BIBLIOGRAPHY_TOOL, "")).rerun;
}

/**
 * Whether the compile went on without its bibliography: LaTeX found no `.bbl` of the job's, as
 * BibTeX or Biber would write, or biblatex asked for one of them.
 */
export function bibliographyLeftOut(log: string, job: string): boolean {
  return (
    log.includes(`No file ${job}.bbl.`) ||
    /^Package biblatex Warning: Please \(re\)run (?:Biber|BibTeX) on the file:/m.test(log)
  );
}

/**
 * A warning of a finished compile that matters: a file it went on without, a font shape LaTeX
 * put another in the place of, or a font that lacks a character the source sets.
 */
export interface LogWarning {
  kind: "file" | "font" | "character";
  /** The file, the font shape, or the font, by name; never the character. */
  name: string;
}

/**
 * The warnings that matter in the log of a compile that finished, once each: `No file` for a
 * file other than the job's own, which LaTeX writes and reads back; `Font shape ... undefined`,
 * and fontspec's font it could not resolve; and `Missing character`, by the font alone.
 */
export function warningsOf(log: string, job: string): LogWarning[] {
  const found = new Map<string, LogWarning>();
  const add = (kind: LogWarning["kind"], name: string) =>
    found.set(`${kind}:${name}`, { kind, name });
  for (const line of log.split(/\r?\n/)) {
    const file = /^No file (.+)\.$/.exec(line)?.[1];
    if (file !== undefined && !file.startsWith(`${job}.`)) add("file", file);
    const shape = /^LaTeX Font Warning: Font shape `([^']+)' undefined/.exec(line)?.[1];
    if (shape !== undefined) add("font", shape);
    const face = /^Package fontspec Warning: Could not resolve font "([^"]+)"/.exec(line)?.[1];
    if (face !== undefined) add("font", face);
    const lacking = /^Missing character: There is no .+ in font (.+?)!$/.exec(line)?.[1];
    if (lacking !== undefined) add("character", fontName(lacking));
  }
  return [...found.values()];
}
