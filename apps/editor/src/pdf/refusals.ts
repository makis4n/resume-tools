/**
 * Why a PDF is not read, in words a person reads (milestone 3 second pass, item 10): a file that
 * is not a PDF, one locked with a password, one with no text, as a scan has, one past the size or
 * page caps, one too complex to be a resume, and one the reader could not make sense of. Each
 * message is plain English and never the reader's own error, which may quote the file.
 *
 * This module is small and loads with the page: the cheap checks, the size and the first bytes,
 * run before pdf.js is fetched at all, so a file that is plainly not a PDF costs no download.
 */

/** The most bytes a PDF may have: the checker's cap (decision 0032), which takes the same PDFs. */
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

/** The most pages a PDF may have. A resume is one or two; ten is a document of another kind. */
export const MAX_PAGES = 10;

/** The fewest letters and digits a PDF must hold to be read, short of which it is a picture. */
export const MIN_TEXT_CHARS = 20;

/**
 * The longest a reading may take before it is stopped and the PDF refused as too complex. Every
 * PDF the spike read took under a quarter of a second (decision 0051); a file that keeps the reader
 * busy for this long is one it should not trust. In the page the worker the reading runs in is
 * stopped too, a little later (`browser.ts`), should the reading itself not answer its own limit.
 */
export const READ_TIME_LIMIT_MS = 20_000;

/**
 * The most a PDF may hold, on one page and in all, past which it is refused as too complex: a
 * hostile file of a few kilobytes can make pdf.js produce millions of operations, so the caps bound
 * the memory a reading takes, and not only its time. `drawing` counts each operation a page draws
 * with, and each number and glyph it is given; `chars` the text's characters. The resumes the spike
 * read draw 9,000 at most on a page, with 200 runs, 2,000 characters, a few dozen marks and a
 * handful of links (decision 0052), so the caps leave room of thirty times and more.
 */
export const PAGE_CAPS = {
  drawing: 250_000,
  runs: 5_000,
  chars: 50_000,
  marks: 5_000,
  links: 500,
} as const;

export const DOCUMENT_CAPS = {
  drawing: 1_000_000,
  runs: 20_000,
  chars: 200_000,
  marks: 20_000,
  links: 2_000,
} as const;

export type Caps = { readonly [what in keyof typeof PAGE_CAPS]: number };

/** Why a PDF was not read. */
export const PDF_REFUSAL_REASONS = [
  "not-pdf",
  "password",
  "no-text",
  "too-large",
  "too-complex",
  "unreadable",
] as const;
export type PdfRefusalReason = (typeof PDF_REFUSAL_REASONS)[number];

export interface PdfRefusal {
  refused: true;
  reason: PdfRefusalReason;
  /** What the person reads, in plain words; never pdf.js's own message. */
  message: string;
}

const MEGABYTES = MAX_PDF_BYTES / 1024 / 1024;

/** What each refusal says to the person. */
export const PDF_REFUSAL_MESSAGES: Readonly<Record<PdfRefusalReason, string>> = {
  "not-pdf": "This file is not a PDF.",
  password:
    "This PDF is locked with a password. Save a copy without the password, and import that.",
  "no-text":
    "This PDF has no text to read: it may be a scan or a picture of a page. Export it again from the program that made it.",
  "too-large": `This PDF is too large to be a resume: it is over ${MEGABYTES} MB or ${MAX_PAGES} pages.`,
  "too-complex":
    "This PDF is too complex to be a resume: it holds far more text or drawing than a resume does. Export it again from the program that made it.",
  unreadable: "This PDF could not be read. Export it again from the program that made it.",
};

export const pdfRefusal = (reason: PdfRefusalReason): PdfRefusal => ({
  refused: true,
  reason,
  message: PDF_REFUSAL_MESSAGES[reason],
});

/** Whether a reading is a refusal. */
export const isPdfRefusal = (value: unknown): value is PdfRefusal =>
  typeof value === "object" && value !== null && (value as { refused?: unknown }).refused === true;

/** Whether bytes begin as a PDF does: `%PDF-` within the first kilobyte, as readers allow. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  for (let at = 0; at + magic.length <= head.length; at++)
    if (magic.every((byte, i) => head[at + i] === byte)) return true;
  return false;
}

/** A file past the size cap, refused by its size alone, before any of it is read. */
export const refusedBySize = (size: number): PdfRefusal | undefined =>
  size > MAX_PDF_BYTES ? pdfRefusal("too-large") : undefined;

/**
 * The checks that need no reader: a file past the size cap, or one that does not begin as a PDF.
 * Undefined when the file may be read.
 */
export function refusedBeforeReading(bytes: Uint8Array): PdfRefusal | undefined {
  const tooLarge = refusedBySize(bytes.length);
  if (tooLarge) return tooLarge;
  if (!looksLikePdf(bytes)) return pdfRefusal("not-pdf");
  return undefined;
}
