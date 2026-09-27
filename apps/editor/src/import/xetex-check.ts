/**
 * The check of a XeTeX import's rewritten fonts (milestone 3 item 8, decision 0023), as the body
 * is checked: the whole document compiled from the rewritten preamble, with the families declared
 * by file and fontspec gone, from the stock format and with no font found by name, must set the
 * reference's glyph stream (`sameGlyphs`); then the preamble dumps as a format, `generateFormat`'s
 * way, with the declarations and the prelude after it, and the body compiled from that format must
 * set the same glyphs again. A difference refuses the import, naming the first font whose glyphs
 * differ. Where the rewrite took unicode-math out, which set mathematics in a math font of its own
 * where the rewrite sets it in TeX's, a difference is a warning instead when every glyph that
 * differs, in either stream, is a math font's and nothing else differs (`compareGlyphs`): not a
 * glyph of the text, nor a rule, nor any place, which a math font's parameters can move as much
 * as its glyphs.
 *
 * A native font is compared by its file's name without its extension: a font the upload shipped,
 * which the reference compile set from the upload's copy, is the tree's file of the same name.
 */

import type { EngineSession } from "../engine/session";
import type { FontLibrary } from "../page/fonts";
import { fontDeclarations } from "../templates/generate";
import { PRELUDE } from "../templates/prelude";
import { fileKeyOf } from "./fontspec";
import { imageInfo, ONE_BY_ONE, ONE_POINT_PDF, standIn, tooLarge } from "./images";
import { type Intake, TEXT_EXTENSIONS } from "./intake";
import { extensionOf, nameOf, withoutExtension } from "./paths";
import {
  COMPATIBILITY,
  firstDifference,
  type GlyphStream,
  glyphStream,
  type Reference,
  type ReferenceItem,
} from "./reference";
import type { Refusal } from "./refusal";
import type { XetexRewrite } from "./xetex";

/** What the check measured, and what it found short of a refusal. */
export interface FontsCheck {
  /** Every pass of the whole document's compile from the stock format, in milliseconds. */
  wholeMs: number;
  /** The dump of the rewritten preamble: its time and the format's size. */
  dumpMs: number;
  formatBytes: number;
  /** Every pass of the body's compile from the format, in milliseconds. */
  bodyMs: number;
  /** A difference in mathematics alone, which the check lets pass. */
  warnings: string[];
}

export interface CheckOptions {
  /** The job the whole document compiles in, and the format's and the body's; defaults below. */
  job?: string;
  format?: string;
  /** The tree's images by name, for a stand-in the reference compile added for one of them. */
  treeImage?: (name: string) => Uint8Array | undefined;
}

/**
 * The preamble the format is dumped from, as `generateFormat` makes a package's: the rewritten
 * preamble, the font declarations, and the editor's prelude.
 */
export function formatPreamble(rewrite: XetexRewrite): string {
  const declarations = rewrite.fonts.length === 0 ? "" : `${fontDeclarations(rewrite.fonts)}\n`;
  return `${rewrite.preamble}\n${declarations}${PRELUDE}`;
}

/**
 * Check a rewrite against the reference, on the session: the whole document, the dump and the body
 * from the format (see the file's note); or refuse it, with the log for developers.
 */
export async function checkRewrite(
  session: EngineSession,
  fonts: FontLibrary,
  intake: Intake,
  reference: Reference,
  rewrite: XetexRewrite,
  options: CheckOptions = {},
): Promise<FontsCheck | Refusal> {
  const job = options.job ?? "fonts";
  const format = options.format ?? "importfonts";
  const preamble = formatPreamble(rewrite);
  const files = jobFiles(intake, reference, rewrite, options.treeImage);

  // The whole document from the stock format, no font found by name.
  session.forget(job);
  const whole = session.compile("xetex", "stock", `${preamble}${rewrite.body}`, {
    job,
    maxPasses: 3,
    files: withBibliography(files, intake, job),
  });
  const wholeMs = whole.passes.reduce((sum, pass) => sum + pass, 0);
  if (!whole.ok || whole.output === undefined)
    return (
      deferredIn(rewrite, whole.log) ??
      stopped("This resume could not be compiled with its fonts declared by file.", whole.log)
    );
  const ours = await glyphStream(fonts, whole.output);
  const warnings: string[] = [];
  const found = compareGlyphs(reference, ours, rewrite.mathFonts);
  if (found.kind === "difference")
    return differs(found.font, `against the reference: ${found.detail}`, whole.log);
  if (found.kind === "maths")
    warnings.push(
      "The resume's mathematics comes out in TeX's own math fonts, not in unicode-math's: nothing else differs.",
    );

  // The format, and the body from it.
  const dumped = session.dump("xetex", format, preamble, dumpFiles(files));
  if (!dumped.ok || dumped.format === undefined)
    return stopped(
      "This resume's preamble could not be kept with its fonts declared by file.",
      dumped.log,
    );
  const bodyJob = `${job}-body`;
  session.forget(bodyJob);
  const body = session.compile("xetex", format, rewrite.body, {
    job: bodyJob,
    maxPasses: 3,
    files: withBibliography(files, intake, bodyJob),
  });
  const bodyMs = body.passes.reduce((sum, pass) => sum + pass, 0);
  if (!body.ok || body.output === undefined)
    return (
      deferredIn(rewrite, body.log) ??
      stopped("This resume could not be compiled from its kept preamble.", body.log)
    );
  const fromFormat = await glyphStream(fonts, body.output);
  const again = firstDifference(fromFormat, ours);
  if (again !== undefined)
    return differs(
      firstFontIn(again),
      `from the format against the whole document: ${again}`,
      body.log,
    );
  return { wholeMs, dumpMs: dumped.ms, formatBytes: dumped.format.length, bodyMs, warnings };
}

/**
 * The job's files for the rewrite's compiles: the upload's, less its fonts, which the loop never
 * keeps, so that XeTeX finds each font the declarations name in the tree; the compatibility files
 * the reference compile gave the job; the stand-ins it added as it ran; and the rewrite's own
 * files, over the upload's where it changed them. Each job takes the upload's bibliography under
 * its own name besides (`withBibliography`).
 */
export function jobFiles(
  intake: Intake,
  reference: Reference,
  rewrite: XetexRewrite,
  treeImage: CheckOptions["treeImage"],
): Record<string, Uint8Array> {
  const fonts = new Set(intake.fonts);
  const files: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(intake.files))
    if (!fonts.has(path)) files[path] = bytes;
  for (const [name, text] of Object.entries(COMPATIBILITY.xetex))
    files[name] ??= new TextEncoder().encode(text);
  for (const added of reference.images) {
    const tree = added.tree ? treeImage?.(added.path) : undefined;
    const info = tree && imageInfo(tree);
    const size =
      info && !tooLarge(info)
        ? info
        : extensionOf(added.path) === ".pdf"
          ? ONE_POINT_PDF
          : ONE_BY_ONE;
    files[added.path] ??= standIn(size);
  }
  return { ...files, ...rewrite.files };
}

/**
 * A job's files with the upload's bibliography, the `.bbl` of its main file's name, under the
 * job's name besides, `<job>.bbl`, which `\bibliography` reads, as the reference compile gives it
 * to its own job.
 */
export function withBibliography(
  files: Readonly<Record<string, Uint8Array>>,
  intake: Intake,
  job: string,
): Record<string, Uint8Array> {
  const bbl = files[`${withoutExtension(nameOf(intake.main.path))}.bbl`];
  return bbl === undefined ? { ...files } : { ...files, [`${job}.bbl`]: bbl };
}

/**
 * The files a dump takes beside the preamble, as the whole compile has them: the job's text files,
 * of the kinds the intake keeps as text, the bibliography's among them, and the rewrite's and the
 * compatibility's style files, at their paths. The session's `dump`, as a package's `files`, takes
 * plain file names alone, so a file in a folder cannot go with it: a preamble that reads one stops
 * the dump, which refuses the import as stopped.
 */
export function dumpFiles(files: Readonly<Record<string, Uint8Array>>): Record<string, Uint8Array> {
  const text = new Set([...TEXT_EXTENSIONS, ".bbl"]);
  const out: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files))
    if (!path.includes("/") && text.has(extensionOf(path))) out[path] = bytes;
  return out;
}

/**
 * A glyph stream as the check compares it: each native font named by its file's name without its
 * extension, and each colour special at no place, since a colour's push or pop means the same
 * wherever it stands.
 */
export function normalized(stream: GlyphStream): GlyphStream {
  return {
    ...stream,
    pages: stream.pages.map((page) => ({
      items: page.items.map((item) =>
        item.kind === "glyph" && item.native
          ? { ...item, font: fileKeyOf(item.font) }
          : item.kind === "special" && /^\s*color\s/.test(item.text)
            ? { ...item, h: 0, v: 0 }
            : item,
      ),
    })),
  };
}

/**
 * TeX's own math fonts, as the stock format's mathematics sets in them: Computer Modern's and Latin
 * Modern's math italic, symbols and extension, and the upright, bold, sans, typewriter and italic
 * fonts LaTeX's operators and math alphabets take; the AMS fonts, Euler, and the script and symbol
 * fonts of LaTeX's math packages. By their TFM names, at any size.
 */
const TEX_MATH_FONTS =
  /^(?:cm(?:mi|mib|sy|bsy|ex|r|bx|ss|tt|ti)|lm(?:mi|mib|sy|bsy|ex)|rm-lm(?:r|bx|ss|tt|ri)|ms[ab]m|eu[frsx][mb]|rsfs|lasyb?|stmary|wasy)\d+$/;

/**
 * Whether a glyph is a math font's, of the kind that the rewrite's taking unicode-math out changes:
 * a native font's whose file is a math font, one unicode-math set mathematics in (`mathFonts`) or
 * one whose name says so, as Latin Modern Math's and the rest's do; or a TFM font's of TeX's own
 * mathematics (`TEX_MATH_FONTS`) that the reference sets nothing in, so that a TFM font the
 * document sets text in is never taken for one.
 */
function mathGlyph(
  mathFonts: readonly string[],
  referenceTex: ReadonlySet<string>,
): (item: ReferenceItem) => boolean {
  const files = new Set(mathFonts.map(fileKeyOf));
  return (item) =>
    item.kind === "glyph" &&
    (item.native
      ? files.has(item.font) || /math/.test(item.font)
      : TEX_MATH_FONTS.test(item.font) && !referenceTex.has(item.font));
}

/**
 * How the rewrite's stream compares with the reference's: the same; different in mathematics
 * alone, which only a rewrite that took unicode-math out can be, when the two are the same once
 * every math font's glyph is left out of both (`mathGlyph`), so that every glyph that differs, in
 * either, is a math font's and nothing else differs, not the text, a rule, a special or a place;
 * or different, naming the reference's font at the first difference that is not a math font's.
 */
export function compareGlyphs(
  reference: GlyphStream,
  ours: GlyphStream,
  mathFonts: readonly string[],
):
  | { kind: "same" }
  | { kind: "maths" }
  | { kind: "difference"; font: string | undefined; detail: string } {
  const theirs = normalized(reference);
  const mine = normalized(ours);
  const detail = firstDifference(theirs, mine);
  if (detail === undefined) return { kind: "same" };
  if (mathFonts.length === 0) return { kind: "difference", font: firstFontIn(detail), detail };
  const maths = mathGlyph(mathFonts, new Set(reference.fonts.tex));
  const without = (stream: GlyphStream): GlyphStream => ({
    ...stream,
    pages: stream.pages.map((page) => ({ items: page.items.filter((item) => !maths(item)) })),
  });
  const rest = firstDifference(without(theirs), without(mine));
  if (rest === undefined) return { kind: "maths" };
  return { kind: "difference", font: firstFontIn(rest), detail: rest };
}

/**
 * The first font a difference names, as `firstDifference` names one, by its file without its
 * extension; undefined for a difference of the page, a rule or a special.
 */
function firstFontIn(detail: string): string | undefined {
  return / of ([^\s(]+)/.exec(detail)?.[1];
}

/** A refusal for output that differs, naming the font whose glyphs do, if a font's do. */
function differs(font: string | undefined, detail: string, log: string): Refusal {
  return {
    refused: true,
    reason: "difference",
    message:
      font === undefined
        ? "This editor lays this resume out otherwise than the resume does once its fonts are declared by file, so it cannot take it."
        : `This editor sets this resume's font ${font} otherwise than the resume does, so it cannot take it.`,
    name: font ?? "layout",
    log: `${log}\n\nThe glyphs differ ${detail}`,
  };
}

/**
 * The refusal a compile stopped on that a definition's body put off (`XetexRewrite.deferred`),
 * which the document used, with the compile's log; undefined for any other stop.
 */
function deferredIn(rewrite: XetexRewrite, log: string): Refusal | undefined {
  const n = /Package rt-fonts Error: Unreproducible font or feature (\d+)\./.exec(log)?.[1];
  const refusal = n === undefined ? undefined : rewrite.deferred[Number(n)];
  return refusal === undefined ? undefined : { ...refusal, log };
}

/** A refusal for a compile or a dump that stopped once the fonts were declared by file. */
function stopped(message: string, log: string): Refusal {
  return { refused: true, reason: "stopped", message, log };
}
