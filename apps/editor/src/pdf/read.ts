/**
 * Reading a PDF (milestone 3 second pass, item 10, promoted from the spike of item 3, decision
 * 0051): each page's runs of text with their position, size, font and weight, each link's
 * rectangle and address, and the small marks and thin rules the page draws, which a bullet or a
 * heading's rule may be; or a refusal in plain words (`refusals.ts`).
 *
 * The reading is pdf.js's, Mozilla's, from `pdfjs-dist`'s legacy build, which reaches older
 * browsers than its modern one does. This module never loads pdf.js itself: it is given the module,
 * by `reader-worker.ts` in the page, where all of it, pdf.js and this code, runs in a worker of its
 * own, and by `node.ts` in tests and scripts, where it runs in the same thread. Both read through
 * this one code.
 *
 * Positions are in PDF points with the origin at the page's top left, y growing down, as a person
 * reads the page: a run's `x` is where its text starts and `baseline` the line it sits on.
 *
 * The file is a stranger's, so pdf.js is told to fetch nothing, to load no font into the document,
 * to decode no image and to run no form; see `READ_OPTIONS`. It holds nothing of a file but what it
 * returns, and logs nothing: pdf.js's own messages are errors only, since a warning may quote a
 * font's or a link's name.
 *
 * What pdf.js makes of a page is taken as it streams, and kept only as runs, links and marks: a page
 * past the caps (`PAGE_CAPS`, `DOCUMENT_CAPS`) or a reading past its time stops there, and the PDF
 * is refused as too complex, so that a small hostile file cannot make the reading take all memory.
 */

import type * as PdfJsModule from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api";
import {
  type Caps,
  DOCUMENT_CAPS,
  MAX_PAGES,
  MIN_TEXT_CHARS,
  PAGE_CAPS,
  type PdfRefusal,
  pdfRefusal,
  READ_TIME_LIMIT_MS,
  refusedBeforeReading,
} from "./refusals.ts";

/** pdf.js, as either loader gives it. */
export type PdfJs = typeof PdfJsModule;

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
  /** A web, mail or phone address (`linkAddress`); a link to anything else is not kept. */
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

/** A PDF read. */
export interface ReadPdf {
  pages: PdfPage[];
  /** Milliseconds the reading took, pdf.js's parse and every page's text, links and marks. */
  ms: number;
}

/** What reading a PDF gives: the PDF read, or why it was not. */
export type PdfReading = ReadPdf | PdfRefusal;

/**
 * A stand-in for pdf.js's loader of the data it keeps outside itself, CMaps, the standard fonts'
 * files and its WASM decoders: it fetches nothing and says so. pdf.js asks it only when a PDF
 * needs one of them, and then reads on without it: a standard font that is not embedded keeps the
 * metrics pdf.js carries, and a font that needs one of Adobe's predefined CMaps decodes to no text.
 */
export class NothingFetched {
  async fetch(): Promise<Uint8Array> {
    throw new Error("The PDF reader fetches nothing.");
  }
}

/**
 * How pdf.js is asked to read a stranger's file. Nothing is fetched: no CMap, standard font, ICC
 * profile or WASM address is given, the worker may not fetch (`useWorkerFetch`), and what would
 * fetch on the page's side is `NothingFetched`. No font is loaded into the document
 * (`disableFontFace`), and none is taken from the system. No image is decoded, since every image is
 * past the largest allowed (`maxImageSize`), and no XFA form is run. pdf.js 6 has no evaluated code
 * path left to turn off: its `isEvalSupported` went with the code it guarded.
 */
export const READ_OPTIONS = {
  verbosity: 0,
  disableFontFace: true,
  useSystemFonts: false,
  useWorkerFetch: false,
  useWasm: false,
  BinaryDataFactory: NothingFetched,
  enableXfa: false,
  maxImageSize: 0,
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  stopAtErrors: false,
} as const satisfies DocumentInitParameters;

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

/** The schemes a link's address may have to be kept. */
const KEPT_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/** The longest address kept; a longer one is no resume's link. */
const MAX_ADDRESS = 2048;

/**
 * A link's address as the reading keeps it: a web, mail or phone address, or a bare domain with a
 * path, `example.com/in/someone`, as some programs write one, made a web address. Anything else, a
 * script, a file, a relative path or a link inside the document, is undefined and not kept, since
 * the address may end up as a link in the person's resume.
 */
export function linkAddress(raw: string): string | undefined {
  const address = raw.trim();
  if (address === "" || address.length > MAX_ADDRESS || /[\p{Cc}\s]/u.test(address))
    return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(address)) {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return undefined;
    }
    return KEPT_SCHEMES.has(url.protocol) ? address : undefined;
  }
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}([/?#]\S*)?$/i.test(address))
    return `https://${address}`;
  return undefined;
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

/** What `readPdfWith` is given beside the bytes. */
export interface ReadOptions {
  /** How long the reading may take before the PDF is refused as too complex. */
  timeLimitMs?: number;
}

/** A PDF past a cap, or past its time: what stops a reading and refuses the PDF as too complex. */
class TooComplex extends Error {}

/** What a reading has used of its caps, a page's or the document's. */
class Tally {
  readonly used = { drawing: 0, runs: 0, chars: 0, marks: 0, links: 0 };
  private readonly caps: Caps;
  // Fields set by hand, not as the constructor's parameters: Node runs the spike's scripts, which
  // read through this module, by stripping its types, and it strips no more than types.
  constructor(caps: Caps) {
    this.caps = caps;
  }
  /** Count `amount` more of `what`; past its cap, the reading stops. */
  add(what: keyof Caps, amount: number) {
    this.used[what] += amount;
    if (this.used[what] > this.caps[what]) throw new TooComplex(what);
  }
}

/**
 * One page's tally and the document's together, and the reading's clock: past `deadline` the
 * reading stops wherever it is counting, since in one thread a timer may not fire until pdf.js
 * lets it.
 */
const both =
  (page: Tally, document: Tally, deadline: number) => (what: keyof Caps, amount: number) => {
    if (performance.now() > deadline) throw new TooComplex("time");
    page.add(what, amount);
    document.add(what, amount);
  };

type Count = ReturnType<typeof both>;

/**
 * Read a PDF with the pdf.js given: every page's runs of text, links and marks, or a refusal in
 * plain words. It refuses before it parses a file past the size cap, or one that does not begin as
 * a PDF; then one pdf.js cannot open, one locked with a password, one past the page cap, one past
 * the caps on what a page holds or past its time, and one with no text to read. It never throws for
 * anything in the file.
 */
export async function readPdfWith(
  pdf: PdfJs,
  bytes: Uint8Array,
  options: ReadOptions = {},
): Promise<PdfReading> {
  const started = performance.now();
  const before = refusedBeforeReading(bytes);
  if (before) return before;
  let task: ReturnType<PdfJs["getDocument"]>;
  try {
    // pdf.js takes the buffer over, so it gets a copy.
    task = pdf.getDocument({ ...READ_OPTIONS, data: new Uint8Array(bytes) });
  } catch {
    return pdfRefusal("unreadable");
  }
  const limit = options.timeLimitMs ?? READ_TIME_LIMIT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<PdfReading>((resolve) => {
    timer = setTimeout(() => resolve(pdfRefusal("too-complex")), limit);
  });
  try {
    return await Promise.race([readDocument(pdf, task, started, started + limit), late]);
  } finally {
    clearTimeout(timer);
    // Stops whatever pdf.js is still doing for this file, and lets go of all of it.
    void task.destroy().catch(() => undefined);
  }
}

async function readDocument(
  pdf: PdfJs,
  task: ReturnType<PdfJs["getDocument"]>,
  started: number,
  deadline: number,
): Promise<PdfReading> {
  let doc: Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
  try {
    doc = await task.promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") return pdfRefusal("password");
    if (name === "InvalidPDFException") return pdfRefusal("not-pdf");
    return pdfRefusal("unreadable");
  }
  try {
    if (doc.numPages > MAX_PAGES) return pdfRefusal("too-large");
    const document = new Tally(DOCUMENT_CAPS);
    const pages: PdfPage[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      pages.push(await readPage(pdf, page, number, both(new Tally(PAGE_CAPS), document, deadline)));
      // What pdf.js keeps of the page, its fonts' objects and its lists, goes with it.
      page.cleanup();
    }
    if (!hasText(pages)) return pdfRefusal("no-text");
    return { pages, ms: performance.now() - started };
  } catch (error) {
    return pdfRefusal(error instanceof TooComplex ? "too-complex" : "unreadable");
  }
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Whether the pages hold at least `MIN_TEXT_CHARS` letters and digits, counted until they do. */
function hasText(pages: PdfPage[]): boolean {
  let found = 0;
  for (const page of pages)
    for (const run of page.runs)
      for (const char of run.text)
        if (LETTER_OR_DIGIT.test(char) && ++found >= MIN_TEXT_CHARS) return true;
  return false;
}

type PdfPageProxy = Awaited<
  ReturnType<Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>["getPage"]>
>;

/** A piece of a page's operator list, as pdf.js streams it from its worker. */
interface OperatorChunk {
  fnArray: number[];
  argsArray: unknown[];
  length: number;
  lastChunk: boolean;
}

/**
 * Stream a page's operator list into `take`, a piece at a time, keeping none of it: pdf.js's
 * `getOperatorList` gathers the whole list before it answers, which a hostile page makes millions
 * of operations long, so each piece is handed to `take` as it arrives and then passed on to pdf.js
 * empty, which still learns from it when the list ends. The piece arrives through the page's
 * `_renderPageChunk`, pdf.js's own and not its public API: a pdf.js without it is refused as
 * unreadable rather than read whole, and the reader's tests fail on it.
 */
function streamOperators(page: PdfPageProxy, take: (chunk: OperatorChunk) => void) {
  const proxy = page as unknown as {
    _renderPageChunk?: (chunk: OperatorChunk, state: unknown) => void;
  };
  const deliver = proxy._renderPageChunk;
  if (typeof deliver !== "function")
    return Promise.reject(new Error("pdf.js no longer streams a page's operators."));
  return new Promise<void>((resolve, reject) => {
    let failed = false;
    proxy._renderPageChunk = function (chunk, state) {
      if (!failed)
        try {
          take(chunk);
        } catch (error) {
          failed = true;
          reject(error);
        }
      deliver.call(this, { ...chunk, fnArray: [], argsArray: [], length: 0 }, state);
    };
    page.getOperatorList().then(() => resolve(), reject);
  });
}

/** How much an operation's arguments hold: each array's and typed array's length, three deep. */
function weight(value: unknown, depth = 0): number {
  if (depth > 2 || typeof value !== "object" || value === null) return 0;
  if (ArrayBuffer.isView(value)) return (value as unknown as ArrayLike<unknown>).length ?? 0;
  if (!Array.isArray(value)) return 0;
  let sum = value.length;
  for (const item of value) sum += weight(item, depth + 1);
  return sum;
}

async function readPage(
  pdf: PdfJs,
  page: PdfPageProxy,
  number: number,
  count: Count,
): Promise<PdfPage> {
  const viewport = page.getViewport({ scale: 1 });
  const toPage = (x: number, y: number) => viewport.convertToViewportPoint(x, y) as number[];
  // The operator list loads the page's fonts, whose names the text's items then find, and holds
  // what the page draws.
  const marks = new MarkReader(pdf, viewport.transform as Matrix, count);
  await streamOperators(page, (chunk) => {
    let drawing = chunk.length;
    for (let i = 0; i < chunk.length; i++) drawing += weight(chunk.argsArray[i]);
    count("drawing", drawing);
    marks.take(chunk.fnArray, chunk.argsArray, chunk.length);
  });
  const fonts = new Map<string, { name: string; bold: boolean; italic: boolean }>();
  const fontOf = (id: string) => {
    let font = fonts.get(id);
    if (font === undefined) {
      let object: { name?: unknown; bold?: unknown; black?: unknown; italic?: unknown } = {};
      try {
        object = page.commonObjs.get(id) ?? {};
      } catch {
        // A font pdf.js could not load has no name; its text still reads.
      }
      const name = fontName(typeof object.name === "string" ? object.name : id);
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
  const reader = page.streamTextContent({ includeMarkedContent: false }).getReader();
  // A reading stopped part way leaves the stream as it is: the document's end, which follows at
  // once, ends it, where cancelling it races pdf.js's own close of it.
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const item of (value as { items: unknown[] }).items) {
      if (typeof item !== "object" || item === null || !("str" in item)) continue;
      const { str, transform, width, fontName: id } = item as TextItem;
      if (typeof str !== "string") continue;
      count("chars", str.length);
      if (str.trim() === "") continue;
      const run = runOf(str, transform, width, toPage, fontOf(String(id)));
      if (run === undefined) continue;
      count("runs", 1);
      runs.push(run);
    }
  }
  const links: PdfLink[] = [];
  for (const annotation of await page.getAnnotations({ intent: "display" })) {
    if (annotation.subtype !== "Link") continue;
    // pdf.js's own address where it found one it trusts, else the one the PDF wrote.
    const raw = annotation.url ?? annotation.unsafeUrl;
    const url = typeof raw === "string" ? linkAddress(raw) : undefined;
    if (url === undefined) continue;
    const [x0, y0, x1, y1] = (annotation.rect ?? []) as number[];
    if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
    const [ax, ay] = toPage(x0 as number, y0 as number) as [number, number];
    const [bx, by] = toPage(x1 as number, y1 as number) as [number, number];
    count("links", 1);
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
    marks: marks.marks,
  };
}

/** A text item as pdf.js streams it. */
interface TextItem {
  str: unknown;
  transform: unknown;
  width: unknown;
  fontName: unknown;
}

/** A text item as a run, on the page's top-left points; undefined for one that cannot be placed. */
function runOf(
  str: string,
  transform: unknown,
  width: unknown,
  toPage: (x: number, y: number) => number[],
  font: { name: string; bold: boolean; italic: boolean },
): TextRun | undefined {
  if (!Array.isArray(transform) || transform.length < 6) return undefined;
  const [a, b, c, d, e, f] = transform.map(Number) as Matrix;
  // Text set upright: a rotated run, as a sidebar's vertical label, is read as it stands.
  const size = Math.hypot(c, d) || Math.hypot(a, b);
  if (!(size > 0) || !Number.isFinite(size)) return undefined;
  const [x, baseline] = toPage(e, f) as [number, number];
  if (!Number.isFinite(x) || !Number.isFinite(baseline)) return undefined;
  const wide = Number(width);
  const total = Number.isFinite(wide) ? wide : 0;
  // pdf.js keeps a run's spaces; the run is trimmed, and its start and width with it, a
  // character's share of the width a character.
  const lead = str.length - str.trimStart().length;
  const trail = str.length - str.trimEnd().length;
  const each = str.length === 0 ? 0 : total / str.length;
  return {
    text: str.trim(),
    x: x + lead * each,
    width: Math.max(0, total - (lead + trail) * each),
    baseline,
    size,
    font: font.name,
    bold: font.bold,
    italic: font.italic,
  };
}

/**
 * The dots and rules a page draws, from its operator list as it streams: each path painted, its
 * box taken through the transformation in force, a form's own among them, and then the page's
 * own, to the page's top-left points.
 */
class MarkReader {
  readonly marks: Mark[] = [];
  private matrix: Matrix = [1, 0, 0, 1, 0, 0];
  private lineWidth = 1;
  private readonly stack: { matrix: Matrix; lineWidth: number }[] = [];
  private readonly painting: Set<number>;
  private readonly strokes: Set<number>;

  private readonly pdf: PdfJs;
  private readonly page: Matrix;
  private readonly count: Count;

  constructor(pdf: PdfJs, page: Matrix, count: Count) {
    this.pdf = pdf;
    this.page = page;
    this.count = count;
    const { OPS } = pdf;
    this.painting = new Set<number>([
      OPS.fill,
      OPS.eoFill,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
      OPS.stroke,
      OPS.closeStroke,
    ]);
    this.strokes = new Set<number>([OPS.stroke, OPS.closeStroke]);
  }

  private save() {
    this.stack.push({ matrix: this.matrix, lineWidth: this.lineWidth });
  }

  private restore() {
    const saved = this.stack.pop();
    if (saved === undefined) return;
    this.matrix = saved.matrix;
    this.lineWidth = saved.lineWidth;
  }

  take(fnArray: number[], argsArray: unknown[], length: number) {
    const { OPS } = this.pdf;
    for (let i = 0; i < length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i] as unknown[] | null;
      if (fn === OPS.save) this.save();
      else if (fn === OPS.restore) this.restore();
      else if (fn === OPS.transform && args) this.matrix = multiply(this.matrix, args as Matrix);
      else if (fn === OPS.paintFormXObjectBegin) {
        // A form draws inside a state of its own, through its own matrix, as pdf.js paints it.
        this.save();
        const form = Array.isArray(args) ? args[0] : undefined;
        if (isMatrix(form)) this.matrix = multiply(this.matrix, form);
      } else if (fn === OPS.paintFormXObjectEnd) this.restore();
      else if (fn === OPS.setLineWidth && args) this.lineWidth = Number(args[0]) || 0;
      else if (fn === OPS.constructPath && args) this.path(args);
    }
  }

  private path(args: unknown[]) {
    const op = Number(args[0]);
    const box = args[2] as ArrayLike<number> | null | undefined;
    if (!this.painting.has(op) || !box || box.length < 4) return;
    const whole = multiply(this.page, this.matrix);
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
    if (![x0, x1, y0, y1].every(Number.isFinite)) return;
    const stroked = this.strokes.has(op);
    if (stroked) {
      // A stroked line is as thick as its pen, in the page's points.
      const pen = (this.lineWidth || 1) * Math.hypot(whole[0], whole[1]);
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
    let kind: Mark["kind"] | undefined;
    if (
      width <= DOT_MAX &&
      height <= DOT_MAX &&
      Math.min(width, height) >= DOT_MIN &&
      width / height < 2 &&
      height / width < 2 &&
      !stroked
    )
      kind = "dot";
    else if (height <= RULE_MAX && width >= RULE_MIN) kind = "rule";
    if (kind === undefined) return;
    this.count("marks", 1);
    this.marks.push({ kind, x0, y0, x1, y1 });
  }
}

const isMatrix = (value: unknown): value is Matrix =>
  (Array.isArray(value) || ArrayBuffer.isView(value)) &&
  (value as ArrayLike<unknown>).length === 6 &&
  Array.from(value as ArrayLike<unknown>).every((n) => typeof n === "number" && Number.isFinite(n));
