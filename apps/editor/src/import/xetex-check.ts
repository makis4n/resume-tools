/**
 * The check of a XeTeX import's rewritten fonts (milestone 3 item 8, decision 0023), as the body
 * is checked: the whole document compiled from the rewritten preamble, with the families declared
 * by file and fontspec gone, from the stock format and with no font found by name, must set the
 * reference's glyph stream (`sameGlyphs`); then the preamble dumps as a format, `generateFormat`'s
 * way, with the declarations and the prelude after it, and the body compiled from that format must
 * set the same glyphs again. A difference refuses the import, naming the first font whose glyphs
 * differ, but one that lies only in mathematics, which unicode-math set in its own font and the
 * rewrite sets in TeX's, is a warning: the rewrite compiled with unicode-math kept sets the
 * reference's glyphs, so that what differs is unicode-math's alone, its math font's glyphs and the
 * parameters of it that place what TeX builds with mathematics, a centred table on the math axis
 * and an underline's rule.
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
import type { Intake } from "./intake";
import { extensionOf, nameOf, withoutExtension } from "./paths";
import {
  COMPATIBILITY,
  firstDifference,
  type GlyphStream,
  glyphStream,
  type Reference,
  type ReferenceItem,
} from "./reference";
import { type Refusal, refusal } from "./refusal";
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
    files,
  });
  const wholeMs = whole.passes.reduce((sum, pass) => sum + pass, 0);
  if (!whole.ok || whole.output === undefined) {
    // A font or feature a macro asks for that the rewrite could not reproduce, which the document
    // uses (`xetex.ts`).
    const unused =
      /Package rt-fonts Error: (missing font|unreproducible feature) ([^\n]*?)\.?\n/.exec(
        whole.log,
      );
    if (unused)
      return refusal(
        unused[1] === "missing font" ? "font" : "feature",
        (unused[2] ?? "").trim(),
        whole.log,
      );
    return stopped("This resume could not be compiled with its fonts declared by file.", whole.log);
  }
  const ours = await glyphStream(fonts, whole.output);
  const warnings: string[] = [];
  let found = compare(reference, ours, rewrite.mathFonts);
  if (found.kind === "difference" && rewrite.maths !== undefined) {
    // The same rewrite with unicode-math kept, which finds its math font by name if it must.
    const kept = { ...rewrite, preamble: rewrite.maths.preamble, files: rewrite.maths.files };
    const keptJob = `${job}-maths`;
    session.forget(keptJob);
    const withMaths = session.compile("xetex", "stock", `${formatPreamble(kept)}${rewrite.body}`, {
      job: keptJob,
      maxPasses: 3,
      files: jobFiles(intake, reference, kept, options.treeImage),
      fontsByName: true,
    });
    session.forget(keptJob);
    if (withMaths.ok && withMaths.output !== undefined) {
      const same = compare(reference, await glyphStream(fonts, withMaths.output), []);
      if (same.kind === "same") found = { kind: "maths" };
    }
  }
  if (found.kind === "difference")
    return differs(found.font, `against the reference: ${found.detail}`, whole.log);
  if (found.kind === "maths")
    warnings.push(
      "The resume's mathematics comes out in TeX's own math fonts, not in unicode-math's: nothing else differs.",
    );

  // The format, and the body from it.
  const dumpFiles: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files))
    if (!path.includes("/") && TEXT.test(path)) dumpFiles[path] = bytes;
  const dumped = session.dump("xetex", format, preamble, dumpFiles);
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
    files,
  });
  const bodyMs = body.passes.reduce((sum, pass) => sum + pass, 0);
  if (!body.ok || body.output === undefined)
    return stopped("This resume could not be compiled from its kept preamble.", body.log);
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

/** The text files a dump takes beside the preamble: classes, packages and the like. */
const TEXT = /\.(?:tex|cls|sty|def|clo|fd|cfg|ldf|lco)$/i;

/**
 * The job's files for the rewrite's compiles: the upload's, less its fonts, which the loop never
 * keeps, so that XeTeX finds each font the declarations name in the tree; the compatibility files
 * and the bibliography the reference compile gave the job; the stand-ins it added as it ran; and
 * the rewrite's own files, over the upload's where it changed them.
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
  const bbl = files[`${withoutExtension(nameOf(intake.main.path))}.bbl`];
  if (bbl !== undefined) files["fonts.bbl"] = bbl;
  return { ...files, ...rewrite.files };
}

/**
 * A glyph stream as the check compares it: each native font named by its file's name without its
 * extension, and each colour special at no place, since a colour's push or pop means the same
 * wherever it stands. unicode-math centres a table on the axis of its own math font, which the
 * stock math fonts put a few scaled points elsewhere, so the colour specials a centred table's
 * baseline holds move by as much while none of its glyphs does, as in every Awesome-CV fork.
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
 * How the rewrite's stream compares with the reference's: the same; different in mathematics alone,
 * once the unicode-math font's glyphs and the TeX fonts the reference sets nothing in are left out
 * of both; or different, naming the reference's font at the first difference.
 */
function compare(
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
  if (mathFonts.length > 0) {
    const maths = new Set(mathFonts.map(fileKeyOf));
    const referenceTex = new Set(reference.fonts.tex);
    const without = (stream: GlyphStream, drop: (item: ReferenceItem) => boolean): GlyphStream => ({
      ...stream,
      pages: stream.pages.map((page) => ({ items: page.items.filter((item) => !drop(item)) })),
    });
    const a = without(
      theirs,
      (item) => item.kind === "glyph" && item.native === true && maths.has(item.font),
    );
    const b = without(
      mine,
      (item) => item.kind === "glyph" && !item.native && !referenceTex.has(item.font),
    );
    if (firstDifference(a, b) === undefined) return { kind: "maths" };
  }
  return { kind: "difference", font: firstFontIn(detail), detail };
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

/** A refusal for a compile or a dump that stopped once the fonts were declared by file. */
function stopped(message: string, log: string): Refusal {
  return { refused: true, reason: "difference", message, name: "stopped", log };
}
