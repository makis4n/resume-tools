/**
 * Saving the PDF in the browser: the name the file is saved under, and handing it to the browser.
 */

import type { Name } from "@resume-tools/resume-model";

/**
 * The name the PDF is saved under: the resume's name, first then last, in lower case, with each
 * run of anything but letters and digits made one hyphen, so that nothing in a name can reach
 * outside it, such as a slash; or `resume.pdf` when the name leaves nothing. Letters of any
 * script count, so a name keeps its accents.
 */
export function pdfFileName({ first, last }: Name): string {
  const stem = `${first} ${last}`
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `${stem || "resume"}.pdf`;
}

/**
 * How long a PDF's object URL lives after the click, in ms: as long as FileSaver.js gives one,
 * since a browser that has yet to read the file when the URL is revoked fails the download.
 */
const REVOKE_AFTER = 40_000;

/** Hand the browser a PDF to save under `fileName`, as a link with a download name would. */
export function savePdf(pdf: Uint8Array, fileName: string) {
  // A Blob takes bytes on an ArrayBuffer, which a copy's are, where these may be on a shared one
  // for all their type says.
  const url = URL.createObjectURL(new Blob([pdf.slice()], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER);
}
