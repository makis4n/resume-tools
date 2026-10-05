/**
 * The bridge from a `.tex` import to the PDF path (milestone 3 second pass, item 16): a PDF of the
 * page an import was measured against, which the PDF import then reads, labels, files and reviews
 * as it reads any PDF, so that the content of a resume that imported under the bar can move onto a
 * built-in template. The editor never gives an imported `.tex` another template's look itself,
 * since an outline's text has no meaning it could carry across (decision 0049).
 *
 * The page is the import's own reference page, made again as the import made it: the person's
 * files through the intake, each stand-in at a plain path (`plainStandIns`); the reference compile,
 * in a job of the bridge's own; on pdfTeX, in Latin Modern where the import read it so
 * (`inLatinModern`); and xdvipdfmx's PDF of that output, with the stand-ins it may show, as the
 * corpus's PDF set made its PDFs (`scripts/pdf-corpus-child.ts`). It is made only when the person
 * asks, so an import pays nothing for it. The PDF goes nowhere from here: it is handed to the
 * PDF import, whose question and setting decide whether its text is sent (decision 0047).
 *
 * A resume the import refused has no reference page, or none the import could read, so its way in
 * is a PDF of its own, which the person picks; nothing here makes one for it. A page xdvipdfmx
 * makes no PDF of, as for a font with no outline in the engine's tree (decision 0051), comes back
 * as a failure that says why for developers alone.
 */

import type { EngineSession } from "../engine/session";
import type { FontLibrary } from "../page/fonts";
import type { Tree as TexTree } from "./fonts";
import { intake, type Upload } from "./intake";
import { inLatinModern } from "./latin-modern";
import { reference } from "./reference";
import { isRefusal } from "./refusal";
import { IMPORT_STEPS, type ImportProgress, uploadOf, watched } from "./run";
import { plainStandIns } from "./standins";

/** The job the bridge compiles the reference page in, which it forgets when it ends. */
export const BRIDGE_JOB = "bridge";

/**
 * A PDF of an import's reference page, or why there is none: the refusal's reason, the compile's
 * failure or xdvipdfmx's, for developers only, since it may name the resume's files.
 */
export type PagePdf = { ok: true; pdf: Uint8Array } | { ok: false; why: string };

/** What the bridge runs with: the import's own, nothing that reaches a service. */
export interface BridgeDeps {
  session: EngineSession;
  fonts: FontLibrary;
  tree: TexTree;
  treeImage?: (name: string) => Uint8Array | undefined;
}

/**
 * The PDF of the reference page the import of `files` compiles (the module's comment). `onStep`
 * hears each compile and the PDF as they begin and end, as an import's progress, for the client
 * that times them; `signal` stops it between compiles, throwing its reason.
 */
export async function referencePdf(
  files: readonly Upload[],
  deps: BridgeDeps,
  onStep: (progress: ImportProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<PagePdf> {
  let compiles = 0;
  const session = watched(deps.session, signal, (compiling, compile) => {
    if (compile) compiles++;
    onStep({ step: "reference", label: IMPORT_STEPS.reference, compiles, compiling });
  });
  const options = deps.treeImage === undefined ? {} : { treeImage: deps.treeImage };
  try {
    const upload = uploadOf(files);
    if (isRefusal(upload)) return { ok: false, why: upload.reason };
    const received = intake(upload, { tree: deps.tree, ...options });
    if (isRefusal(received)) return { ok: false, why: received.reason };
    const uploaded = plainStandIns(received);
    const first = await reference(session, deps.fonts, uploaded, { job: BRIDGE_JOB, ...options });
    if (isRefusal(first)) return { ok: false, why: first.reason };
    const swap = await inLatinModern(session, deps.fonts, uploaded, first, {
      job: BRIDGE_JOB,
      ...options,
    });
    if (swap !== undefined && isRefusal(swap)) return { ok: false, why: swap.reason };
    const taken = swap?.intake ?? uploaded;
    const made = swap?.reference ?? first;
    const images = [...taken.images.replaced, ...made.images].map((image) => image.path);
    const pdf = session.pdf(BRIDGE_JOB, { images });
    if (!pdf.ok || pdf.pdf === undefined) return { ok: false, why: pdf.error ?? "no PDF" };
    return { ok: true, pdf: pdf.pdf };
  } catch (error) {
    if (signal?.aborted === true && error === signal.reason) throw error;
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  } finally {
    deps.session.forget(BRIDGE_JOB);
  }
}

/**
 * The PDF of a page as a file the PDF import takes, as if the person had picked it: named after the
 * upload's main file, or `resume.pdf`, with the PDF's type.
 */
export function pageFile(pdf: Uint8Array, uploadName: string | undefined): File {
  const base = (uploadName ?? "").replace(/^.*\//, "").replace(/\.[^.]*$/, "");
  return new File([pdf as BlobPart], `${base === "" ? "resume" : base}.pdf`, {
    type: "application/pdf",
  });
}
