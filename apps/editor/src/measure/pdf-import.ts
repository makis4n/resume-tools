/**
 * A PDF import by rules measured, from the file to the review (milestone 3 second pass, item 18),
 * beside the `.tex` import's measurement (`import.ts`), against the plan's target for it: with rules
 * a PDF import takes under 1 s (docs/milestone-3-overhaul.md, "Done means"; decision 0051 measured
 * 232 ms at most).
 *
 * Each PDF goes the way the app's PDF import takes it (`src/editor/pdf-import.ts`) for a person who
 * said no to sending its text: the reader (`read`), the layout by rules (`layout`), the labels,
 * through the model's labeller with a no on record, so that the rules answer as they do for that
 * person and nothing is sent (`labels`), the filing into the resume (`filing`), and the review's
 * draft made on the template it opens on, with its history (`review`). The whole is those parts,
 * which the target is judged on, at the slowest import. Then, where the caller gives an engine, the
 * review's draft is set on its template as the review sets it, through the editor's compile
 * scheduler, to its first drawn page (`page`), which is reported beside the whole and not in it: the
 * review shows the resume read and the PDF's pages while its template's page compiles. The document
 * is not kept: "Create document" writes it to the store, which the measurement leaves out, as the
 * `.tex` import's does.
 *
 * The PDFs are never a corpus resume or anything made from one, and no model is asked: the editor's
 * own PDFs of the three built-in templates, each typesetting its own invented sample, made here as
 * the editor exports a PDF (`builtinPdfs`), and, in Node, the invented resumes printed by other
 * tools (`scripts/spike-pdf/fixtures/other/`). The model's time comes from `pdf-model`, run by hand
 * with the key on the invented sets alone.
 *
 * This module reaches for neither Node nor the browser, and loads the PDF path's steps as the app
 * does, with the first PDF, so that the measuring page's bundle stays without them: the reader comes
 * from the caller, pdf.js in this thread in Node (`src/pdf/node.ts`) and the reader's worker in the
 * browser (`readPdfFile`), which draws each page as a picture for the review, as the app's does.
 */

import { Compiler, type Engine as CompilerEngine, type Shown } from "../editor/compiler";
import { type Document, History, newDocument } from "../editor/document";
import { FIRST_TEMPLATE } from "../editor/pdf-import";
import { drawPage } from "../page/draw";
import type { FontLibrary } from "../page/fonts";
import { isPdfRefusal, type PdfReading, type PdfRefusal } from "../pdf";
import type { LabelFallback, LabelledBy } from "../pdf/label";
import { CURATED, curated } from "../templates/curated";
import { formatTime, type Noted, noted } from "./import";
import { median, meets, TARGETS, table } from "./measure";

export { formatTime };

/** The parts of a PDF import by rules, from the file to the review, in their order. */
export const PDF_PARTS = ["read", "layout", "labels", "filing", "review"] as const;
export type PdfPart = (typeof PDF_PARTS)[number];

/** What each part is, and the page reported beside them. */
export const PDF_PART_LABELS: Readonly<Record<PdfPart | "page", string>> = {
  read: "The reader: pdf.js's parse, every page's text, links and marks",
  layout: "Lines, columns and reading order, by rules",
  labels: "What each line is, by rules: the model's labeller with a no on record, nothing sent",
  filing: "The labelled lines filed into the resume, every word read counted",
  review: "The review's draft, on the template it opens on, with its history",
  page: "The review's draft set on its template: its format dumped, compiled, drawn; not in the whole",
};

/** Where a PDF of the measured set comes from: a built-in template's, or another tool's. */
export type PdfSet = "builtin" | "other";

/** A PDF to import: its id, its set, and its bytes. */
export interface PdfSample {
  id: string;
  set: PdfSet;
  bytes: Uint8Array;
}

/** How a PDF import is measured: its reader, and, for the page, an engine and fonts. */
export interface PdfHow {
  /** Read a PDF, as the app's reader does. */
  read(bytes: Uint8Array): Promise<PdfReading>;
  /**
   * Where the review's draft is set on its template, to its first drawn page; without it, the page
   * is not measured. `engine` gives one ready, a new worker's in the browser, a session shared by
   * every page in Node, and how long it took is the page's `startMs`.
   */
  page?: { engine(): Promise<CompilerEngine>; fonts(): FontLibrary; draw?: typeof drawPage };
  /** The locale a new document's page size follows, as the app's. */
  locale?: string;
  /** The clock, in milliseconds; `performance.now` by default. */
  now?: () => number;
}

/** The review's draft set on its template, to its first drawn page. */
export interface PdfPageTime {
  /** From the draft given to the scheduler to its page drawn. */
  ms: number;
  /** How long the engine took to be ready, before the page, which is not in `ms`. */
  startMs: number;
  /** The format: dumped, as a first review in a tab dumps it, or put in place, and how long. */
  formatMs: number;
  dumped: boolean;
  /** The compile's passes, and the draw. */
  passes: number[];
  drawMs: number;
  /** The pages the template set the draft on. */
  pages: number;
}

/** One PDF imported by rules. */
export interface PdfTime {
  id: string;
  set: PdfSet;
  /** In order, each part once. */
  parts: { part: PdfPart; ms: number }[];
  /** From the file to the review's draft: the parts added up, the page not among them. */
  ms: number;
  /** The PDF's pages, the lines the layout found, and the words read and where they landed. */
  pdfPages: number;
  lines: number;
  words: { read: number; landed: number; unfiled: number };
  /** The items the review shows first. */
  flags: number;
  /** Who labelled the lines, and why not the model: the rules, for want of a yes. */
  by: LabelledBy;
  fallback?: LabelFallback;
  page?: PdfPageTime;
}

/** A PDF the reader refused, and why, in plain words. */
export interface PdfRefused {
  id: string;
  refused: PdfRefusal;
}

export type PdfMeasured = PdfTime | PdfRefused;

export const isPdfRefused = (measured: PdfMeasured): measured is PdfRefused =>
  "refused" in measured;

/**
 * The PDF path's steps after the reader, loaded as the app loads them with its first PDF; a module
 * loaded once answers at once after.
 */
async function pdfSteps() {
  const [{ layOut }, { labelLines }, { fileLines }, { modelLabeller }] = await Promise.all([
    import("../pdf/layout"),
    import("../pdf/label"),
    import("../pdf/file"),
    import("../pdf/model-labeller"),
  ]);
  return { layOut, labelLines, fileLines, modelLabeller };
}

/** What a labeller's fetch does here: nothing, and says so, should anything ever ask it. */
export const NOTHING_SENT = "A PDF import by rules sends nothing.";

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/**
 * Import a PDF by rules as the app does for a person who said no, from the file to the review's
 * draft, each part timed; then, with `how.page`, set the draft on its template to its first drawn
 * page. Nothing is sent: the labeller has a no on record, and its fetch refuses besides. Nothing is
 * kept. Throws when the page cannot be made, with the scheduler's message.
 */
export async function measurePdfImport(sample: PdfSample, how: PdfHow): Promise<PdfMeasured> {
  const now = how.now ?? (() => performance.now());
  const steps = await pdfSteps();
  const labeller = steps.modelLabeller({
    consent: { get: () => "no" },
    fetch: async () => {
      throw new Error(NOTHING_SENT);
    },
  });
  const began = now();
  const reading = await how.read(sample.bytes);
  const read = now();
  if (isPdfRefusal(reading)) return { id: sample.id, refused: reading };
  const layout = steps.layOut(reading);
  const laidOut = now();
  const labels = await steps.labelLines(layout, labeller);
  const labelled = now();
  const filed = steps.fileLines(layout, labels.roles);
  const filedAt = now();
  // The review's draft, as the app makes it once the reading is done (`usePdfImport`).
  const { package: pkg } = curated(FIRST_TEMPLATE);
  const document = newDocument(FIRST_TEMPLATE, filed.resume, how.locale);
  new History(document, pkg);
  const reviewed = now();
  const parts = [
    { part: "read" as const, ms: read - began },
    { part: "layout" as const, ms: laidOut - read },
    { part: "labels" as const, ms: labelled - laidOut },
    { part: "filing" as const, ms: filedAt - labelled },
    { part: "review" as const, ms: reviewed - filedAt },
  ];
  const { read: wordsRead, landed, unfiled } = filed.words;
  return {
    id: sample.id,
    set: sample.set,
    parts,
    ms: reviewed - began,
    pdfPages: reading.pages.length,
    lines: layout.lines.length,
    words: { read: wordsRead, landed, unfiled },
    flags: filed.flags.length,
    by: labels.by,
    ...(labels.fallback === undefined ? {} : { fallback: labels.fallback }),
    ...(how.page === undefined ? {} : { page: await openPage(how.page, document, now) }),
  };
}

/**
 * Set a document on its curated template through the editor's compile scheduler, as the review
 * does, to its first drawn page, each request of the engine and the draw timed. The scheduler is
 * closed at the end, and the engine with it.
 */
async function openPage(
  how: NonNullable<PdfHow["page"]>,
  document: Document,
  now: () => number,
): Promise<PdfPageTime> {
  const starting = now();
  const engine = await how.engine();
  const startMs = now() - starting;
  const requests: Noted[] = [];
  const draws: number[] = [];
  const draw = how.draw ?? drawPage;
  const timedDraw: typeof drawPage = async (...args) => {
    const started = now();
    try {
      return await draw(...args);
    } finally {
      draws.push(now() - started);
    }
  };
  let settle: { resolve: (shown: Shown) => void; reject: (error: Error) => void } | undefined;
  const shown = new Promise<Shown>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const compiler = new Compiler(
    () => noted(engine, now, (each) => requests.push(each)),
    how.fonts(),
    {
      page: (each) => {
        if (each.document === document) settle?.resolve(each);
      },
      error: (message) =>
        settle?.reject(new Error(`The review's page could not be made: ${message}`)),
      busy: () => {},
    },
    { draw: timedDraw },
  );
  try {
    const began = now();
    compiler.open(curated(document.template).package, document);
    const { page } = await shown;
    const ms = now() - began;
    const formats = requests.filter((each) => each.kind === "dump" || each.kind === "putFormat");
    return {
      ms,
      startMs,
      formatMs: sum(formats.map((each) => each.ms)),
      dumped: formats.some((each) => each.kind === "dump"),
      passes: requests.flatMap((each) => (each.kind === "compile" ? (each.passes ?? []) : [])),
      drawMs: sum(draws),
      pages: page.pageCount,
    };
  } finally {
    compiler.close();
    engine.terminate();
  }
}

/**
 * The editor's own PDF of each built-in template, typesetting its own invented sample, made as the
 * editor exports one: the sample opened on its template through the compile scheduler, then its
 * PDF (`Compiler.pdf`). The engine is the caller's, and is stopped at the end.
 */
export async function builtinPdfs(
  engine: CompilerEngine,
  fonts: FontLibrary,
): Promise<PdfSample[]> {
  let waiting:
    | { doc: Document; resolve: (shown: Shown) => void; reject: (error: Error) => void }
    | undefined;
  const compiler = new Compiler(() => engine, fonts, {
    page: (shown) => {
      if (waiting?.doc !== shown.document) return;
      waiting.resolve(shown);
      waiting = undefined;
    },
    error: (message) => {
      waiting?.reject(new Error(`A built-in template's PDF could not be made: ${message}`));
      waiting = undefined;
    },
    busy: () => {},
  });
  try {
    const made: PdfSample[] = [];
    for (const [id, { package: pkg, sample }] of CURATED) {
      const doc = newDocument(id, sample);
      const shown = new Promise<Shown>((resolve, reject) => {
        waiting = { doc, resolve, reject };
      });
      compiler.open(pkg, doc);
      await shown;
      made.push({ id: `${id}--${id}`, set: "builtin", bytes: await compiler.pdf() });
    }
    return made;
  } finally {
    compiler.close();
    engine.terminate();
  }
}

/** What `pdfRuns` came to: the timed imports, or the refusal that stopped them. */
export type PdfRuns = { warm: PdfTime[]; runs: PdfTime[] } | { refused: PdfRefused };

/**
 * Import every PDF `runs` times, after one pass over them all that is not counted, which loads the
 * reader and the steps after it, as a person's first PDF does, and lets the runtime settle. Each
 * pass imports every PDF once, in order. `before` hears each pass as it starts, the first `0`, the
 * warm-up; `live` stops the runs between two imports when it turns false, and the result is
 * undefined then. A refusal stops them too, and is what they come to.
 */
export async function pdfRuns(
  pdfs: readonly PdfSample[],
  once: (pdf: PdfSample) => Promise<PdfMeasured>,
  runs: number,
  before: (pass: number) => void = () => {},
  live: () => boolean = () => true,
): Promise<PdfRuns | undefined> {
  if (!Number.isInteger(runs) || runs < 1) throw new Error("runs must be a whole number from 1");
  if (pdfs.length === 0) throw new Error("there are no PDFs to import");
  const passes: PdfTime[][] = [];
  for (let pass = 0; pass <= runs; pass++) {
    before(pass);
    const timed: PdfTime[] = [];
    for (const pdf of pdfs) {
      if (!live()) return undefined;
      const measured = await once(pdf);
      if (isPdfRefused(measured)) return { refused: measured };
      timed.push(measured);
    }
    passes.push(timed);
  }
  const [warm = [], ...rest] = passes;
  return { warm, runs: rest.flat() };
}

/** The medians of some PDF imports: each part's, the whole's and the page's, and the slowest. */
export interface PdfMedians {
  parts: { part: PdfPart; ms: number; slowest: number }[];
  ms: number;
  fastest: number;
  /** The slowest import's whole, and its PDF, which the target is judged on. */
  slowest: { ms: number; id: string };
  page?: { ms: number; slowest: number; startMs: number; formatMs: number; drawMs: number };
}

/** The medians of `runs`, which are at least one. */
export function pdfMedians(runs: readonly PdfTime[]): PdfMedians {
  if (runs.length === 0) throw new Error("there are no imports to take the medians of");
  const partOf = (run: PdfTime, part: PdfPart) =>
    run.parts.find((each) => each.part === part)?.ms ?? 0;
  const wholes = runs.map((run) => run.ms);
  const slowest = runs.reduce((worst, run) => (run.ms > worst.ms ? run : worst));
  const pages = runs.flatMap((run) => (run.page === undefined ? [] : [run.page]));
  return {
    parts: PDF_PARTS.map((part) => {
      const times = runs.map((run) => partOf(run, part));
      return { part, ms: median(times), slowest: Math.max(...times) };
    }),
    ms: median(wholes),
    fastest: Math.min(...wholes),
    slowest: { ms: slowest.ms, id: slowest.id },
    ...(pages.length === 0
      ? {}
      : {
          page: {
            ms: median(pages.map((page) => page.ms)),
            slowest: Math.max(...pages.map((page) => page.ms)),
            startMs: median(pages.map((page) => page.startMs)),
            formatMs: median(pages.map((page) => page.formatMs)),
            drawMs: median(pages.map((page) => page.drawMs)),
          },
        }),
  };
}

/** The target for a PDF import by rules: under 1 s (docs/milestone-3-overhaul.md, "Done means"). */
export const PDF_RULES_TARGET = TARGETS.pdfRules;

/** The line the PDF import's verdict comes under. */
export const PDF_BAR = `Against the target: a PDF import by rules under ${PDF_RULES_TARGET.limit / 1000} s, judged on the slowest import, from the file to the review`;

/** Whether every import met the target, judged on the slowest. */
export function pdfMeets(runs: readonly PdfTime[]): { ms: number; id: string; met: boolean } {
  const { slowest } = pdfMedians(runs);
  return { ...slowest, met: meets(PDF_RULES_TARGET, slowest.ms) };
}

/** Where the PDF imports ran, which says what the reader did. */
export type PdfWhere = "node" | "browser";

/**
 * The PDF imports' table, as the Node command prints it and the browser's page shows it: each
 * part's median and slowest over every import, the whole's, the page's beside it, then a row a
 * PDF, and the verdict against the target.
 */
export function pdfTable(runs: readonly PdfTime[], where: PdfWhere): string {
  const medians = pdfMedians(runs);
  const ids = [...new Set(runs.map((run) => run.id))];
  const of = (id: string) => runs.filter((run) => run.id === id);
  const counts = (set: PdfSet) => ids.filter((id) => of(id)[0]?.set === set).length;
  const passes = ids.length === 0 ? 0 : runs.length / ids.length;
  const reader =
    where === "node"
      ? "pdf.js in this thread, no page drawn as a picture"
      : "the reader's worker, each page drawn as a picture for the review, as the app's";
  const { page } = medians;
  const pageRows = page
    ? [
        [
          "page",
          formatTime(page.ms),
          formatTime(page.slowest),
          `${PDF_PART_LABELS.page}; format ${formatTime(page.formatMs)}, draw ${formatTime(page.drawMs)}`,
        ],
        // In Node every page shares one engine, started once, which the command says apart.
        ...(where === "browser"
          ? [
              [
                "start",
                formatTime(page.startMs),
                "",
                "A new worker's engine started before the page, which a list with no document has not started; not in the whole",
              ],
            ]
          : []),
      ]
    : [];
  const verdict = pdfMeets(runs);
  const everyWord = runs.every((run) => run.words.landed === run.words.read);
  const byRules = runs.every((run) => run.by === "rules");
  return [
    `A PDF import by rules: ${ids.length} PDFs, ${counts("builtin")} of the built-in templates and ${counts("other")} printed by other tools, all invented; ${passes} ${passes === 1 ? "import" : "imports"} of each, by ${reader}`,
    table([
      ["Part", "Median", "Slowest", "What"],
      ...medians.parts.map(({ part, ms, slowest }) => [
        part,
        formatTime(ms),
        formatTime(slowest),
        PDF_PART_LABELS[part],
      ]),
      [
        "whole",
        formatTime(medians.ms),
        formatTime(medians.slowest.ms),
        `From the file to the review's draft; from ${formatTime(medians.fastest)}, the slowest ${medians.slowest.id}`,
      ],
      ...pageRows,
    ]),
    "",
    table([
      ["PDF", "Pages", "Lines", "Words", "Flags", "read", "rules", "whole", "slowest", "page"],
      ...ids.map((id) => {
        const each = of(id);
        const [first] = each;
        const partMedian = (part: PdfPart) =>
          median(each.map((run) => run.parts.find((p) => p.part === part)?.ms ?? 0));
        const pages = each.flatMap((run) => (run.page === undefined ? [] : [run.page.ms]));
        return [
          id,
          String(first?.pdfPages ?? 0),
          String(first?.lines ?? 0),
          String(first?.words.read ?? 0),
          String(first?.flags ?? 0),
          formatTime(partMedian("read")),
          formatTime(partMedian("layout") + partMedian("labels") + partMedian("filing")),
          formatTime(median(each.map((run) => run.ms))),
          formatTime(Math.max(...each.map((run) => run.ms))),
          pages.length === 0 ? "" : formatTime(median(pages)),
        ];
      }),
    ]),
    "",
    `Each import labelled by ${byRules ? "the rules, for want of a yes, and sent nothing" : "the model on some imports: not a measure of the rules"}; ${everyWord ? "every word read landed in the resume" : "some words read did not land in the resume"}. "rules" is the layout, the labels and the filing, medians added.`,
    "",
    PDF_BAR,
    table([
      [
        PDF_RULES_TARGET.path,
        `under ${PDF_RULES_TARGET.limit / 1000} s`,
        `${formatTime(verdict.ms)} at the slowest (${verdict.id}) ${verdict.met ? "met" : "missed"}`,
      ],
    ]),
  ].join("\n");
}
