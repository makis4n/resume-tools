/**
 * The PDF spike's reader (milestone 3 second pass, item 3): pdf.js, Mozilla's, from `pdfjs-dist`'s
 * legacy build, which runs in Node as it is. It gives each page's runs of text with their position,
 * size, font and weight, each link's rectangle and address, and the small marks and thin rules the
 * page draws, which a bullet or a heading's rule may be; and it refuses, in plain words, a file that
 * is not a PDF, one with a password, one with no text and one past the size cap.
 *
 * Positions are in PDF points with the origin at the page's top left, y growing down, as a person
 * reads the page: a run's `x` is where its text starts and `baseline` the line it sits on.
 *
 * It holds nothing of a file but what it returns, and logs nothing: pdf.js's own messages are off
 * (`verbosity: 0`), since a warning may quote a font's or a link's name.
 */

import { createRequire } from "node:module";

/** The most bytes a PDF may have: the checker's cap (decision 0032), which takes the same PDFs. */
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

/** The most pages a PDF may have. A resume is one or two; ten is a document of another kind. */
export const MAX_PAGES = 10;

/** The fewest characters of text a PDF must hold to be read, short of which it is a picture. */
export const MIN_TEXT_CHARS = 20;

/** Why a PDF was refused. */
export const REFUSALS = ["not-pdf", "password", "no-text", "too-large", "unreadable"] as const;
export type RefusalKind = (typeof REFUSALS)[number];

export interface Refused {
  refused: RefusalKind;
  /** What the person reads, in plain words; never pdf.js's own message. */
  message: string;
}

/** What each refusal says to the person. */
export const REFUSAL_MESSAGES: Readonly<Record<RefusalKind, string>> = {
  "not-pdf": "This file is not a PDF.",
  password:
    "This PDF is locked with a password. Save a copy without the password, and import that.",
  "no-text":
    "This PDF has no text to read: it may be a scan or a picture of a page. Export it again from the program that made it.",
  "too-large": `This PDF is too large to be a resume: it is over ${MAX_PDF_BYTES / 1024 / 1024} MB or ${MAX_PAGES} pages.`,
  unreadable: "This PDF could not be read. Export it again from the program that made it.",
};

const refuse = (refused: RefusalKind): Refused => ({
  refused,
  message: REFUSAL_MESSAGES[refused],
});

/** A run of text as pdf.js gives it: one font, one baseline. */
export interface TextRun {
  text: string;
  /** Where the text starts, and how wide it is, in points. */
  x: number;
  width: number;
  /** The baseline, from the page's top. */
  baseline: number;
  /** The font's size in points, as the page sets it. */
  size: number;
  /** The font's name as the PDF has it, without a subset's prefix, `LMRoman10-Bold`. */
  font: string;
  bold: boolean;
  italic: boolean;
}

/** A link: where it is on the page, and the address it goes to. */
export interface PdfLink {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  url: string;
}

/**
 * Something the page draws that is not text and may mean something: a `dot`, a small filled
 * shape, which a browser draws for a list's bullet; or a `rule`, a thin line across the page, which
 * many templates draw under or over a section's heading.
 */
export interface Mark {
  kind: "dot" | "rule";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PdfPage {
  number: number;
  width: number;
  height: number;
  runs: TextRun[];
  links: PdfLink[];
  marks: Mark[];
}

export interface ReadPdf {
  pages: PdfPage[];
  /** Milliseconds the reading took, pdf.js's parse and every page's text, links and marks. */
  ms: number;
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let loaded: Promise<PdfJs> | undefined;

/** pdf.js's legacy build, loaded once, when the first PDF is read. */
export function pdfjs(): Promise<PdfJs> {
  loaded ??= import(
    createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs")
  ) as Promise<PdfJs>;
  return loaded;
}

/** Whether bytes begin as a PDF does: `%PDF-` within the first kilobyte, as readers allow. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

/** A font's name without a subset's prefix: `ABCDEF+LMRoman10-Bold` is `LMRoman10-Bold`. */
export const fontName = (name: string) => name.replace(/^[A-Z]{6}\+/, "");

/**
 * Whether a font's name says bold: `Bold`, `Black`, `Heavy`, `Semibold` and the like, and TeX's
 * bold fonts, `cmbx10`, `cmb10`, `ec-lmbx10`, `t1-lmbx12`.
 */
export function boldName(name: string): boolean {
  const font = fontName(name);
  return (
    /bold|black|heavy|semibd|demi|extrab|ultrab/i.test(font) ||
    /(^|[-+])(cm|lm|ec-lm|t1-lm|ts1-lm)?(bx|b)\d+/i.test(font) ||
    /^(cmbx|lmbx|cmb|lmb)/i.test(font)
  );
}

/**
 * Whether a font's name says italic or slanted: `Italic`, `Oblique`, and TeX's `cmti10`, `cmsl10`,
 * `lmri10`, `lmbxi10`.
 */
export function italicName(name: string): boolean {
  const font = fontName(name);
  return (
    /italic|oblique|slant|kursiv/i.test(font) ||
    /(^|[-+])(cm|lm|ec-lm|t1-lm)?(ti|sl|ri|bxi|bxsl|ssi)\d+/i.test(font) ||
    /^(cmti|cmsl|lmri|lmsl)/i.test(font) ||
    /-It$|-BoldIt$|-LightIt$/.test(font)
  );
}

/** A 2D affine matrix as PDF writes one: `[a, b, c, d, e, f]`. */
type Matrix = [number, number, number, number, number, number];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** The biggest a dot may be, in points, and the smallest; a bullet is 2 to 6. */
const DOT_MAX = 7;
const DOT_MIN = 1.2;

/** The thickest a rule may be, and the shortest, in points. */
const RULE_MAX = 3;
const RULE_MIN = 36;

/**
 * Read a PDF: every page's runs of text, links and marks, or a refusal in plain words. It refuses
 * before it parses a file past the size cap, or one that does not begin as a PDF; then one pdf.js
 * cannot open, one locked with a password, one past the page cap, and one with no text to read.
 */
export async function readPdf(bytes: Uint8Array): Promise<ReadPdf | Refused> {
  const started = performance.now();
  if (bytes.length > MAX_PDF_BYTES) return refuse("too-large");
  if (!looksLikePdf(bytes)) return refuse("not-pdf");
  const pdf = await pdfjs();
  const task = pdf.getDocument({
    // pdf.js takes the buffer over, so it gets a copy.
    data: new Uint8Array(bytes),
    verbosity: 0,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: false,
  });
  let doc: Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy();
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") return refuse("password");
    if (name === "InvalidPDFException") return refuse("not-pdf");
    return refuse("unreadable");
  }
  try {
    if (doc.numPages > MAX_PAGES) return refuse("too-large");
    const pages: PdfPage[] = [];
    for (let number = 1; number <= doc.numPages; number++)
      pages.push(await readPage(pdf, await doc.getPage(number), number));
    const chars = pages
      .flatMap((page) => page.runs)
      .reduce((sum, run) => sum + run.text.replace(/\s/g, "").length, 0);
    if (chars < MIN_TEXT_CHARS) return refuse("no-text");
    return { pages, ms: performance.now() - started };
  } catch {
    return refuse("unreadable");
  } finally {
    await task.destroy();
  }
}

type PdfPageProxy = Awaited<
  ReturnType<Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>["getPage"]>
>;

async function readPage(pdf: PdfJs, page: PdfPageProxy, number: number): Promise<PdfPage> {
  const viewport = page.getViewport({ scale: 1 });
  const toPage = (x: number, y: number) => viewport.convertToViewportPoint(x, y) as number[];
  // The operator list loads the page's fonts, whose names the text's items then find, and holds
  // what the page draws.
  const operators = await page.getOperatorList();
  const content = await page.getTextContent({ includeMarkedContent: false });
  const fonts = new Map<string, { name: string; bold: boolean; italic: boolean }>();
  const fontOf = (id: string) => {
    let font = fonts.get(id);
    if (font === undefined) {
      let object: { name?: string; bold?: boolean; black?: boolean; italic?: boolean } = {};
      try {
        object = page.commonObjs.get(id) ?? {};
      } catch {
        // A font pdf.js could not load has no name; its text still reads.
      }
      const name = fontName(object.name ?? id);
      font = {
        name,
        bold: object.bold === true || object.black === true || boldName(name),
        italic: object.italic === true || italicName(name),
      };
      fonts.set(id, font);
    }
    return font;
  };
  const runs: TextRun[] = [];
  for (const item of content.items) {
    if (!("str" in item) || item.str.trim() === "") continue;
    const [a, b, c, d, e, f] = item.transform as Matrix;
    // Text set upright: a rotated run, as a sidebar's vertical label, is read as it stands.
    const size = Math.hypot(c, d) || Math.hypot(a, b);
    if (!(size > 0)) continue;
    const [x, baseline] = toPage(e, f) as [number, number];
    const font = fontOf(item.fontName);
    // pdf.js keeps a run's spaces; the run is trimmed, and its start and width with it, a
    // character's share of the width a character.
    const lead = item.str.length - item.str.trimStart().length;
    const trail = item.str.length - item.str.trimEnd().length;
    const each = item.str.length === 0 ? 0 : item.width / item.str.length;
    runs.push({
      text: item.str.trim(),
      x: x + lead * each,
      width: Math.max(0, item.width - (lead + trail) * each),
      baseline,
      size,
      font: font.name,
      bold: font.bold,
      italic: font.italic,
    });
  }
  const links: PdfLink[] = [];
  for (const annotation of await page.getAnnotations({ intent: "display" })) {
    if (annotation.subtype !== "Link") continue;
    const url = annotation.url ?? annotation.unsafeUrl;
    if (typeof url !== "string" || url === "") continue;
    const [x0, y0, x1, y1] = annotation.rect as [number, number, number, number];
    const [ax, ay] = toPage(x0, y0) as [number, number];
    const [bx, by] = toPage(x1, y1) as [number, number];
    links.push({
      x0: Math.min(ax, bx),
      y0: Math.min(ay, by),
      x1: Math.max(ax, bx),
      y1: Math.max(ay, by),
      url,
    });
  }
  return {
    number,
    width: viewport.width,
    height: viewport.height,
    runs,
    links,
    marks: marksOf(pdf, operators, viewport.transform as Matrix),
  };
}

/**
 * The dots and rules a page draws, from its operator list: each path painted, its box taken through
 * the transformation in force and then the page's own, to the page's top-left points.
 */
function marksOf(
  pdf: PdfJs,
  operators: { fnArray: number[]; argsArray: unknown[] },
  page: Matrix,
): Mark[] {
  const { OPS } = pdf;
  const painting = new Set<number>([
    OPS.fill,
    OPS.eoFill,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
    OPS.stroke,
    OPS.closeStroke,
  ]);
  const strokes = new Set<number>([OPS.stroke, OPS.closeStroke]);
  const marks: Mark[] = [];
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  let lineWidth = 1;
  const stack: { matrix: Matrix; lineWidth: number }[] = [];
  for (let i = 0; i < operators.fnArray.length; i++) {
    const fn = operators.fnArray[i];
    const args = operators.argsArray[i] as unknown[] | null;
    if (fn === OPS.save) stack.push({ matrix, lineWidth });
    else if (fn === OPS.restore) ({ matrix, lineWidth } = stack.pop() ?? { matrix, lineWidth });
    else if (fn === OPS.transform && args) matrix = multiply(matrix, args as Matrix);
    else if (fn === OPS.setLineWidth && args) lineWidth = Number(args[0]) || 0;
    else if (fn === OPS.constructPath && args) {
      const op = Number(args[0]);
      const box = args[2] as ArrayLike<number> | null | undefined;
      if (!painting.has(op) || !box || box.length < 4) continue;
      const whole = multiply(page, matrix);
      const corners = [
        apply(whole, Number(box[0]), Number(box[1])),
        apply(whole, Number(box[2]), Number(box[3])),
        apply(whole, Number(box[0]), Number(box[3])),
        apply(whole, Number(box[2]), Number(box[1])),
      ];
      let x0 = Math.min(...corners.map(([x]) => x));
      let x1 = Math.max(...corners.map(([x]) => x));
      let y0 = Math.min(...corners.map(([, y]) => y));
      let y1 = Math.max(...corners.map(([, y]) => y));
      if (strokes.has(op)) {
        // A stroked line is as thick as its pen, in the page's points.
        const pen = (lineWidth || 1) * Math.hypot(whole[0], whole[1]);
        if (y1 - y0 < pen) {
          y0 -= pen / 2;
          y1 += pen / 2;
        }
        if (x1 - x0 < pen) {
          x0 -= pen / 2;
          x1 += pen / 2;
        }
      }
      const width = x1 - x0;
      const height = y1 - y0;
      if (
        width <= DOT_MAX &&
        height <= DOT_MAX &&
        Math.min(width, height) >= DOT_MIN &&
        width / height < 2 &&
        height / width < 2 &&
        !strokes.has(op)
      )
        marks.push({ kind: "dot", x0, y0, x1, y1 });
      else if (height <= RULE_MAX && width >= RULE_MIN)
        marks.push({ kind: "rule", x0, y0, x1, y1 });
    }
  }
  return marks;
}
