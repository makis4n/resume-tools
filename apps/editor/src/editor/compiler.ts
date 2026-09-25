/**
 * The compile scheduler, which keeps an open document's page current.
 *
 * The page is a function of the document, so the scheduler owns the whole way from one to the
 * other: the format, dumped once per name and kept; the body, compiled in the document's job; and
 * the page, drawn from the output with its fields aligned to the body's texts. Nothing else calls
 * the engine. Edits come faster than TeX can follow them, so it waits for a pause before it
 * compiles, longer for XeTeX, which decision 0003 measured at about 460 ms a compile against
 * pdfTeX's 65; and it keeps one compile in flight, so that what arrives meanwhile waits and only
 * the newest document compiles when the one in flight lands. A page arrives whole, its SVG, fields
 * and texts from one compile, since a body and its texts are one unit (decision 0007), and the
 * page before it stays up until then, so the page never flashes blank. A compile that fails leaves
 * that page up with a plain message, because a user never sees LaTeX; the log goes to the console.
 *
 * TeX runs in the worker in one synchronous call that nothing can interrupt (decision 0008), so a
 * compile that ran long, for any reason, would hold up every edit after it. Every request to the
 * engine therefore has a time limit, past which the scheduler terminates the worker and starts
 * another. A worker that fails a request rather than answering it is replaced the same way, since
 * one that has crashed fails every request after. Either way the document is tried once more on
 * the new worker, because a machine that stalled for a moment should cost a wait and not the page,
 * and it is given up, with the plain message, only when that worker is lost too. The formats are
 * kept as bytes on the main thread, so the new worker is handed them rather than dumping them
 * again.
 *
 * A worker's start-up loads the engine and TeX Live's file list, and a dump reads TeX Live's files
 * as TeX asks for them, and so does a worker's first compile of each format, for what the body
 * needs that the preamble did not load, such as the fonts a XeTeX template declares by file, which
 * load when the body selects them (decision 0014). On a slow machine or network any of these can
 * take many seconds, and a worker that replaces a lost one pays for them again, so they have a
 * longer limit of their own and the compile limit times only what TeX does with an edit. Drawing
 * the page waits on fonts from the network, so it has the compile's limit too; past it the page is
 * dropped, but the worker, which did its part, stays.
 *
 * Given the app's stores (`src/storage/store.ts`), formats and the TeX Live files each template
 * reads outlive the session: a format the store holds is handed to the engine rather than dumped,
 * and the files are fetched into the HTTP cache while the engine starts, since the worker reads
 * each with a synchronous request of its own (decision 0010). The stores only ever save time, so
 * one that fails or stalls is gone around rather than waited on.
 *
 * Fit to one page (item 18, `fit.ts`) asks how many pages the open document sets with other
 * control values. Each such trial compiles on the same engine, in its turn and with a compile's
 * time limit, but in a job of its own, so that the document's auxiliary files and the output its
 * PDF is made from stay as they are, and it shows nothing: it only counts pages. The document comes
 * first, since its page is what the user sees, so a trial waits for the document compiling or
 * waiting to, and a document that changes during a trial compiles as soon as the trial lands. The
 * engine is busy while a trial is in flight, as while a document compiles, so a PDF asked for
 * meanwhile waits for it; a PDF request that loses the engine fails the trial it was ahead of.
 */

import { z } from "zod";
import type {
  CompileOptions,
  CompileResult,
  DumpResult,
  Fetched,
  JobFiles,
  PdfOptions,
  PdfResult,
  Engine as SessionEngine,
} from "../engine/session";
import { type DrawnPage, drawPage } from "../page/draw";
import type { FontLibrary } from "../page/fonts";
import {
  type GeneratedBody,
  type GeneratedFormat,
  generateBody,
  generateFormat,
} from "../templates/generate";
import { type ControlValues, controlValuesFor, type TemplatePackage } from "../templates/package";
import type { Document } from "./document";

/**
 * What the scheduler needs of an engine: `EngineClient` in the app, a wrapped Node session in
 * tests.
 */
export interface Engine {
  /**
   * Load the engine and mount TeX Live. The first request would wait for it anyway; asking first
   * lets the scheduler time start-up apart from the requests that follow it.
   */
  start(): Promise<unknown>;
  dump(
    engine: SessionEngine,
    name: string,
    preamble: string,
    files?: JobFiles,
  ): Promise<DumpResult>;
  /** Hand the engine a format made earlier. It may take the bytes' buffer, as the client does. */
  putFormat(engine: SessionEngine, name: string, format: Uint8Array): Promise<void>;
  /** Clear a job's folder, so that its next compile starts afresh and reads nothing left there. */
  forget(job: string): Promise<void>;
  compile(
    engine: SessionEngine,
    format: string,
    body: string,
    options?: CompileOptions,
  ): Promise<CompileResult>;
  /** The PDF of a job's last compile, made from its output. */
  pdf(job: string, options?: PdfOptions): Promise<PdfResult>;
  /** Stop the engine at once, whatever it is doing; what waits on it fails. */
  terminate(): void;
}

/**
 * Formats kept from one session to the next, by engine and name. They must be the formats of the
 * engine build the worker runs, since TeX refuses a format another build dumped.
 */
export interface FormatStore {
  get(engine: SessionEngine, name: string): Promise<Uint8Array | undefined>;
  put(engine: SessionEngine, name: string, format: Uint8Array): Promise<void>;
}

/** The TeX Live files each template is known to read, by the paths TeX reads them at. */
export interface PrefetchStore {
  get(template: string): Promise<string[]>;
  add(template: string, paths: string[]): Promise<void>;
}

/** A page from one compile, whole: the page, the body and texts it was drawn from, the document. */
export type Shown = {
  page: DrawnPage;
  body: GeneratedBody;
  document: Document;
  /**
   * How long the page took, in milliseconds: from the run's first request to the engine, the dump
   * included when the format was new, to the drawn page, for the numbers item 23 records. The
   * wait for a pause in the edits is not in it, and neither is the engine's start-up.
   */
  ms: number;
  /**
   * How long the engine took to start, in milliseconds, when this page's run started it: the
   * first page's, and the first after a worker was replaced.
   */
  startMs?: number;
};

export interface CompilerEvents {
  /** A new page, whole: its SVG, fields and texts from one compile. */
  page(shown: Shown): void;
  /** Why no new page came, in words for the user; the details go to the console. */
  error(message: string): void;
  /**
   * Whether the engine is busy, with a document compiling or waiting to or a trial of other
   * control values in flight (`Compiler.tryControls`), for a quiet indicator.
   */
  busy(pending: boolean): void;
}

export interface CompilerOptions {
  /** How long to wait after the last edit before compiling, in ms, by engine. */
  delays?: Record<SessionEngine, number>;
  /**
   * How long a compile, or handing the engine a kept format, may take before the worker is
   * stopped, in ms, by engine, and how long drawing the page may take before the page is dropped.
   */
  limits?: Record<SessionEngine, number>;
  /**
   * How long a worker may take to start, or a format to dump, before the worker is stopped, in ms.
   */
  startLimit?: number;
  /** How a page is drawn from the output; tests draw without fonts. */
  draw?: typeof drawPage;
  /** Where formats are kept for later sessions, and looked for before a dump. */
  formats?: FormatStore;
  /** Where the files each template reads are noted, for the prefetch of later sessions. */
  prefetch?: PrefetchStore;
  /**
   * Fetch a TeX Live file, by its path, into the HTTP cache the worker's reads go through, and
   * drop it; without it, nothing is fetched ahead.
   */
  fetchFile?: (path: string) => Promise<unknown>;
  /**
   * Whether the engine's tree has a file at this path, as its manifest says. The prefetch fetches
   * only such files: its paths come from the browser's storage, which anything on the origin can
   * write, and a path the tree does not have is not one TeX read. Without it, nothing is fetched
   * ahead.
   */
  knownPath?: (path: string) => boolean;
}

/** What the user reads when a page cannot be made, whatever the reason; never TeX's words. */
export const COULD_NOT_UPDATE = "The page could not be updated.";

/**
 * What the user reads when the PDF cannot be made, whatever the reason; never xdvipdfmx's words.
 * `pdf()` fails with it, and with the reason as the error's cause, for the console.
 */
export const COULD_NOT_MAKE_PDF = "The PDF could not be made.";

/**
 * The wait after an edit. XeTeX's is longer and assumes a loaded machine, as decision 0003 asks:
 * a compile there took about 460 ms at best and 850 ms under load, against pdfTeX's 65.
 */
const DELAYS: Record<SessionEngine, number> = { pdftex: 100, xetex: 400 };

/**
 * Far past any compile a resume needs, so that only one that has stopped making progress, or a
 * machine in real trouble, is cut off; XeTeX compiles several times slower, so it gets twice as
 * long.
 */
const LIMITS: Record<SessionEngine, number> = { pdftex: 10_000, xetex: 20_000 };

/**
 * The limit for a worker's start-up, for a dump, and for a worker's first compile of each format.
 * Start-up takes about 0.3 s once the engine's files are cached (decision 0003), but a first load
 * fetches the engine itself, 9.5 MB compressed, so a minute leaves room for a slow connection and
 * still gives up on a worker that will never start. Why a dump and a first compile share it is said
 * where each is asked for.
 */
const START_LIMIT = 60_000;

/**
 * How long the scheduler waits for a store before it goes on without it. IndexedDB answers in
 * milliseconds, a format of several MB included, but it has been known to hang in some browsers,
 * and waiting for a store should never cost more than the dump it saves.
 */
const STORE_LIMIT = 2_000;

/**
 * The job every document compiles in, one document open at a time (decision 0010). It is the
 * validation harness's `EDITOR_JOB`, since TeX tells a document its job's name and the harness
 * checks a package as the editor compiles it. A stored document's id never reaches TeX: opening a
 * document starts the job afresh instead (see `run`).
 */
const JOB = "doc";

/**
 * The job a trial compiles in (`tryControls`), apart from the document's, whose auxiliary files
 * and output it leaves as they are. Like the document's, it may hold the files of the document
 * open before, so a trial of a document opened since the job's last trial starts it afresh.
 */
const FIT_JOB = "fit";

/**
 * Passes at most in one compile, the session's default, which leaves the session to run a new
 * document twice, a document whose log asks once more, and a failed compile again as a new
 * document, all within it. The first compile on a new worker is a new document's, since that
 * worker has no job folder yet.
 */
const MAX_PASSES = 3;

/** One document on its way to a page. */
interface Run {
  /** Which run this is; one whose generation is no longer the latest is dropped when it lands. */
  generation: number;
  pkg: TemplatePackage;
  document: Document;
  /**
   * Whether this is the document's second try, after its first lost the engine. It gets no third,
   * so a document that stops every worker it runs on costs two of them, not one after another.
   */
  retry: boolean;
  /**
   * Its time limit for a compile, for handing the engine a kept format and for the draw, from its
   * package's engine. Start-up, dumps and a worker's first compile of each format have the longer
   * `startLimit`.
   */
  limit: number;
  /** The time limit running now, of a request or of the draw. */
  timer?: ReturnType<typeof setTimeout>;
}

/** A compile of the open document with other control values, which counts its pages. */
interface Trial {
  pkg: TemplatePackage;
  /** The open document as it was when the trial was asked for, with the values as its controls. */
  document: Document;
  /**
   * Which opening of a document the trial was asked in, as `open` counts them, which tells the
   * trials of one document from those of the next, however they queue.
   */
  opened: number;
  resolve(pages: number): void;
  reject(error: unknown): void;
  /** The time limit of the request running now, which closing stops. */
  timer?: ReturnType<typeof setTimeout>;
}

/** What handing the engine a format needs of the work it is for: a document's run, or a trial. */
interface Work {
  /** The compile's time limit, which handing the engine a kept format has too. */
  limit: number;
  /** One request to the engine within a time limit, which loses the engine as the work's do. */
  request<T>(limit: number, call: () => Promise<T>): Promise<T>;
  /** Whether what the work brings back is still wanted. */
  current(): boolean;
}

/** Where the page on screen came from, which its PDF is made from. */
interface Made {
  /** The engine whose job holds the page's output. */
  instance: Instance;
  pkg: TemplatePackage;
  document: Document;
}

/**
 * An engine the scheduler has made, and what it knows of it. A new engine gets a new one of
 * these, so a request to an engine that has been replaced cannot mark the new one started, or
 * holding a format.
 */
interface Instance {
  engine: Engine;
  /** Whether it has started, which its first request waits for. */
  started: boolean;
  /** The formats it holds, by engine and name. */
  installed: Set<string>;
  /** Whether a document has compiled in its job, whose files the folder may still hold. */
  compiled: boolean;
  /**
   * The opening whose trial last compiled in the fit job, whose files that folder may still hold;
   * undefined until a trial has compiled there.
   */
  fitOpened: number | undefined;
  /**
   * The formats it has compiled a body with, in any job, by engine and name, which it has read
   * the files of.
   */
  compiledWith: Set<string>;
}

export class Compiler {
  private readonly delays: Record<SessionEngine, number>;
  private readonly limits: Record<SessionEngine, number>;
  private readonly startLimit: number;
  private readonly draw: typeof drawPage;
  private readonly formatStore: FormatStore | undefined;
  private readonly prefetchStore: PrefetchStore | undefined;
  private readonly fetchFile: ((path: string) => Promise<unknown>) | undefined;
  private readonly knownPath: ((path: string) => boolean) | undefined;
  /** The fetches ahead asked for each template, by id, once per session. */
  private readonly prefetched = new Map<string, Promise<void>>();
  /** Whether a document has opened since one last reached the job, which it then starts afresh. */
  private opened = false;
  /** How many times a document has opened, which each trial notes (`Trial.opened`). */
  private openings = 0;
  /** The time limits running on requests to a store, which `close` stops. */
  private readonly waits = new Set<ReturnType<typeof setTimeout>>();
  /** The engine every request goes to, made when a document first needs one. */
  private instance: Instance | undefined;
  /**
   * Every format dumped, as bytes, by engine and name. The session keeps its own copy, but a new
   * worker starts with none, and handing it these costs far less than dumping again.
   */
  private readonly formats = new Map<string, Uint8Array>();
  private pkg: TemplatePackage | undefined;
  /** The newest document `open` or `update` gave, whatever has become of its compile. */
  private latest: Document | undefined;
  /** The newest document that has not started compiling. */
  private pending: Document | undefined;
  /** The trials asked for that wait for the engine, in the order they were asked for. */
  private readonly trials: Trial[] = [];
  /**
   * The trial in flight, which a document's compile waits for as for another document's, and a
   * PDF as for a document's compile.
   */
  private trying: Trial | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private running: Run | undefined;
  private generation = 0;
  private busy = false;
  private closed = false;
  /** The fonts the console has been told the page cannot draw. */
  private readonly warned = new Set<string>();
  /**
   * The page on screen while it is the newest document's. A compile that fails, or a page that is
   * dropped, clears it, since a PDF of an older page is not what the user asked for.
   */
  private made: Made | undefined;
  /** The PDF on its way, which every `pdf()` call shares until it comes. */
  private making: Promise<Uint8Array> | undefined;
  /** The time limit of the PDF request in flight, which closing stops with the other timers. */
  private pdfTimer: ReturnType<typeof setTimeout> | undefined;
  /** Wakes each `pdf()` call waiting for the newest document, once nothing is compiling. */
  private readonly settled: (() => void)[] = [];

  constructor(
    private readonly newEngine: () => Engine,
    private readonly fonts: FontLibrary,
    private readonly events: CompilerEvents,
    options: CompilerOptions = {},
  ) {
    this.delays = { ...DELAYS, ...options.delays };
    this.limits = { ...LIMITS, ...options.limits };
    this.startLimit = options.startLimit ?? START_LIMIT;
    this.draw = options.draw ?? drawPage;
    this.formatStore = options.formats;
    this.prefetchStore = options.prefetch;
    this.fetchFile = options.fetchFile;
    this.knownPath = options.knownPath;
  }

  /**
   * Open a document set with a package, and compile it at once, dumping its format first if this
   * compiler has not. A compile in flight for what was open before is dropped when it lands, and
   * this document compiles then, starting the job afresh. The files the package is known to read
   * start on their way now, while the engine starts.
   */
  open(pkg: TemplatePackage, doc: Document) {
    if (this.closed) return;
    checkTemplate(pkg, doc);
    this.pkg = pkg;
    this.latest = doc;
    this.opened = true;
    this.openings++;
    void this.prefetchFor(pkg);
    clearTimeout(this.debounce);
    this.debounce = undefined;
    this.pending = doc;
    if (this.running !== undefined) {
      this.generation++;
      this.setBusy();
      return;
    }
    this.next();
  }

  /**
   * The open document has changed. It compiles once the edits pause for the engine's delay, or,
   * while a compile or a trial is in flight, as soon as that one lands; either way only the newest
   * compiles.
   */
  update(doc: Document) {
    if (this.closed) return;
    const pkg = this.pkg;
    if (pkg === undefined) throw new Error("a document has to be open before it can change");
    checkTemplate(pkg, doc);
    this.latest = doc;
    this.pending = doc;
    if (this.running === undefined && this.trying === undefined) {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.debounce = undefined;
        this.next();
      }, this.delays[pkg.engine]);
    }
    this.setBusy();
  }

  /**
   * Stop for good: every timer stops, the engine is terminated, a compile in flight is dropped
   * when it lands, so nothing is emitted after this, and every trial fails.
   */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    clearTimeout(this.debounce);
    clearTimeout(this.running?.timer);
    this.debounce = undefined;
    this.running = undefined;
    this.pending = undefined;
    for (const wait of this.waits) clearTimeout(wait);
    this.waits.clear();
    this.instance?.engine.terminate();
    this.instance = undefined;
    clearTimeout(this.pdfTimer);
    for (const wake of this.settled.splice(0)) wake();
    clearTimeout(this.trying?.timer);
    const closed = new Error("the compiler closed before the trial could compile");
    for (const trial of [this.trying, ...this.trials.splice(0)]) trial?.reject(closed);
    this.trying = undefined;
  }

  /**
   * The open document as the compiler has it: the newest that `open` or `update` gave, which a
   * trial compiles. The fit reads it to stop once the document has changed underneath it.
   */
  get document(): Document | undefined {
    return this.latest;
  }

  /**
   * How many pages the open document sets with `values` in place of its controls, for the fit's
   * search (item 18): the newest document `open` or `update` gave, compiled on the same engine but
   * in the fit job, so that the document's auxiliary files and the output its PDF is made from are
   * untouched. The trial waits for what is in flight and for a document waiting to compile, which
   * comes first; it has a compile's time limit; and a format-bound value whose format is new dumps
   * it first, kept like any other. It shows nothing, no page and no message, but while it is in
   * flight the engine is `busy` with it, so a PDF asked for meanwhile waits for it. It fails at
   * once for values the package does not take, as a document's control command does, and it fails
   * when its compile does, when the engine is lost to it (`loseToTrial`) or to a PDF request
   * (`losePdf`), when no document is open, and when the compiler closes first.
   */
  tryControls(values: ControlValues): Promise<number> {
    const pkg = this.pkg;
    const doc = this.latest;
    if (this.closed || pkg === undefined || doc === undefined)
      return Promise.reject(new Error("a document has to be open to try other control values"));
    const taken = controlValuesFor(pkg).safeParse(values);
    if (!taken.success)
      return Promise.reject(
        new Error(`${pkg.name} refuses the values to try: ${z.prettifyError(taken.error)}`),
      );
    return new Promise((resolve, reject) => {
      const document = { ...doc, controls: taken.data };
      this.trials.push({ pkg, document, opened: this.openings, resolve, reject });
      // A document waiting for a pause in the edits compiles first, once the pause has passed.
      if (this.debounce === undefined) this.next();
    });
  }

  /**
   * The PDF of the page on screen, which xdvipdfmx makes from the page's own output (plan section
   * 5.5). A document compiling or waiting to is the one the user sees next, so the PDF waits for
   * its page, and fails if that document's compile does: a PDF of the page before would not be
   * what the user asked for. It waits for a trial in flight too (`tryControls`), since the engine
   * takes one request at a time, and a request behind a trial's would spend its time limit on the
   * trial. Calls made while one is on its way share it. The request has a compile's time limit,
   * and one that runs past it, or that the engine fails rather than answers, loses the engine as a
   * compile's would (`losePdf`). The promise fails with `COULD_NOT_MAKE_PDF`, and the reason as
   * its cause.
   */
  pdf(): Promise<Uint8Array> {
    this.making ??= this.makePdf().finally(() => {
      this.making = undefined;
    });
    return this.making;
  }

  private async makePdf(): Promise<Uint8Array> {
    // Until nothing is compiling or waiting to, a trial included (`setBusy`), when the page on
    // screen is the newest document's and the engine has nothing else to do.
    while (this.busy && !this.closed) await new Promise<void>((wake) => this.settled.push(wake));
    const made = this.made;
    if (this.closed || made === undefined || made.instance !== this.instance)
      throw new Error(COULD_NOT_MAKE_PDF, {
        cause: "no page of the newest document to make it of",
      });
    let result: PdfResult;
    try {
      result = await this.requestPdf(made);
    } catch (error) {
      this.losePdf(made, error);
      throw new Error(COULD_NOT_MAKE_PDF, { cause: error });
    }
    if (!result.ok || result.pdf === undefined)
      throw new Error(COULD_NOT_MAKE_PDF, { cause: result.error ?? "xdvipdfmx made none" });
    return result.pdf;
  }

  /** Ask the engine that made the page for its PDF, failing past a compile's time limit. */
  private async requestPdf({ instance, pkg }: Made): Promise<PdfResult> {
    const limit = this.limits[pkg.engine];
    let expire: (error: Error) => void = () => {};
    const expired = new Promise<never>((_, reject) => {
      expire = reject;
    });
    const timer = setTimeout(() => expire(new Error(`took over ${limit} ms`)), limit);
    this.pdfTimer = timer;
    try {
      return await Promise.race([instance.engine.pdf(JOB), expired]);
    } finally {
      clearTimeout(timer);
      if (this.pdfTimer === timer) this.pdfTimer = undefined;
    }
  }

  /**
   * The engine is lost to a PDF request, which ran past its limit or which it failed rather than
   * answered: it is terminated and replaced, as `lose` does for a compile. A trial asked for while
   * the request was on its way went to the engine behind it, and it fails now, rather than wait out
   * its own time limit on an engine that is gone, so the fit that asked for it stops; nothing it
   * brings back later is heard. The page on screen then compiles again on the new engine, unless a
   * newer document is on its way and compiles instead, so that the new engine's job holds the
   * output the next PDF is made from.
   */
  private losePdf(made: Made, error: unknown) {
    if (this.closed || this.instance !== made.instance) return;
    console.warn("A PDF request lost the engine, so a new one takes its place", error);
    made.instance.engine.terminate();
    this.instance = undefined;
    const trial = this.trying;
    if (trial !== undefined) {
      this.trying = undefined;
      clearTimeout(trial.timer);
      trial.reject(new Error("a PDF request lost the engine the trial was on", { cause: error }));
    }
    if (this.running !== undefined) return;
    // The page on screen, or a newer document in its place, which compiles once its pause has
    // passed, or at once if it was waiting for the trial, whose landing would have started it.
    this.pending ??= made.document;
    if (this.debounce === undefined) this.next();
  }

  /**
   * Start what waits, unless a compile or a trial is in flight: the pending document, or else,
   * once no document waits, the first trial.
   */
  private next() {
    if (this.closed) return;
    const inFlight = this.running !== undefined || this.trying !== undefined;
    const doc = this.pending;
    const pkg = this.pkg;
    if (!inFlight && doc !== undefined && pkg !== undefined) {
      this.pending = undefined;
      this.begin(pkg, doc, false);
      return;
    }
    const trial = inFlight || doc !== undefined ? undefined : this.trials.shift();
    if (trial !== undefined) this.trying = trial;
    // Once the trial is in flight, so that the engine stays busy from the landing of what was in
    // flight to the trial's, and a PDF waiting for the one waits for the other.
    this.setBusy();
    if (trial !== undefined) void this.runTrial(trial);
  }

  /** Start a document compiling; `retry` when it is its second try, after it lost the engine. */
  private begin(pkg: TemplatePackage, document: Document, retry: boolean) {
    const generation = ++this.generation;
    const run: Run = { generation, pkg, document, retry, limit: this.limits[pkg.engine] };
    this.running = run;
    this.setBusy();
    void this.run(run);
  }

  /** Take a document all the way to a page, or to the plain message. */
  private async run(run: Run): Promise<void> {
    const { pkg, document: doc } = run;
    try {
      const format = generateFormat(pkg, doc.controls);
      const body = generateBody(pkg, doc.resume, doc.controls);
      const instance = this.currentInstance();
      const { engine } = instance;
      let startMs: number | undefined;
      if (!instance.started) {
        const starting = performance.now();
        await this.request(run, this.startLimit, () => engine.start());
        instance.started = true;
        startMs = performance.now() - starting;
        if (!this.current(run)) return;
      }
      const started = performance.now();
      // The files the template is known to read are on their way before TeX asks for any.
      await this.prefetchFor(pkg);
      if (!this.current(run)) return;
      const work: Work = {
        limit: run.limit,
        request: (limit, call) => this.request(run, limit, call),
        current: () => this.current(run),
      };
      const failed = await this.installFormat(work, instance, pkg, format);
      if (failed !== undefined) {
        if (this.current(run)) this.fail(`the format did not dump: ${failed.error}`, failed.log);
        return;
      }
      if (!this.current(run)) return;
      // The job's folder may hold another document's auxiliary files, which this one must not
      // read. The scheduler knows no document ids, so a document opened on an engine that has
      // compiled starts afresh, which costs one pass when it is the same document again.
      if (this.opened && instance.compiled) {
        await this.request(run, run.limit, () => engine.forget(JOB));
        if (!this.current(run)) return;
      }
      this.opened = false;
      instance.compiled = true;
      // A worker's first compile of a format reads, as TeX asks for them, the files the body needs
      // that the preamble did not load: the fonts a XeTeX template declares by file, which load
      // when the body selects them, 9 files and 1.2 MB for the invented template, and a pdfTeX
      // body's font metrics. So it gets the start-up's limit, as the dump does, whether the format
      // was dumped or handed over; it happens once a format and a worker, never per keystroke.
      const key = `${pkg.engine}:${format.name}`;
      const limit = instance.compiledWith.has(key) ? run.limit : this.startLimit;
      const result = await this.request(run, limit, () =>
        engine.compile(pkg.engine, format.name, body.latex, { job: JOB, maxPasses: MAX_PASSES }),
      );
      instance.compiledWith.add(key);
      this.record(pkg, result.fetched);
      if (!this.current(run)) return;
      if (!result.ok || result.output === undefined) {
        this.fail(`the body did not compile: ${result.error}`, result.log);
        return;
      }
      const output = result.output;
      const page = await this.within(
        run,
        run.limit,
        () => this.draw(output, this.fonts, body.texts),
        () => this.drop(run),
      );
      if (!this.current(run)) return;
      this.warnAboutFonts(page);
      this.made = { instance, pkg, document: doc };
      this.events.page({ page, body, document: doc, ms: performance.now() - started, startMs });
    } catch (error) {
      // A request that lost the engine was dealt with there, and this run is no longer current:
      // what it throws is the terminated or failed worker's error, and the console has heard why.
      if (this.current(run)) this.fail("the page could not be made", error);
    } finally {
      this.landed(run);
    }
  }

  /**
   * Hand the engine the work's format, unless it holds it already: the one this session or an
   * earlier one kept, or else one dumped now, and kept for both. A dump that fails comes back, for
   * the work to report as it reports failures; otherwise nothing does, and the work checks for
   * itself whether it is still current, since the store and the engine were waited on.
   */
  private async installFormat(
    work: Work,
    instance: Instance,
    pkg: TemplatePackage,
    format: GeneratedFormat,
  ): Promise<DumpResult | undefined> {
    const key = `${pkg.engine}:${format.name}`;
    if (instance.installed.has(key)) return undefined;
    const { engine } = instance;
    // A format an earlier session kept saves the dump: 0.37 s in Chrome on a fast laptop, and on a
    // cold cache the 7.5 MiB of TeX Live files a dump reads, most of it the stock format (decision
    // 0003).
    const kept = this.formats.get(key) ?? (await this.stored(pkg.engine, format.name));
    if (!work.current()) return undefined;
    if (kept !== undefined) {
      this.formats.set(key, kept);
      // putFormat may move the buffer it is given to the worker, so it gets a copy.
      await work.request(work.limit, () => engine.putFormat(pkg.engine, format.name, kept.slice()));
    } else {
      // A dump reads TeX Live's files as TeX asks for them, 54 files and 7.5 MiB for Jake's format
      // on a cold cache, and one that is cut off leaves no format behind, so the worker that
      // retries it reads them all over again. It gets the start-up's limit rather than the
      // compile's: a format is dumped when a document opens or a control bound to the format
      // changes, never per keystroke, so a long dump costs a wait, not an edit.
      const dumped = await work.request(this.startLimit, () =>
        engine.dump(pkg.engine, format.name, format.preamble, format.files),
      );
      this.record(pkg, dumped.fetched);
      if (!dumped.ok || dumped.format === undefined) return dumped;
      const bytes = dumped.format;
      this.formats.set(key, bytes);
      const store = this.formatStore;
      if (store) this.keep("keep a format", () => store.put(pkg.engine, format.name, bytes));
    }
    instance.installed.add(key);
    return undefined;
  }

  /**
   * Compile a trial's document in the fit job and settle the trial with its page count. It is
   * current while it is the trial in flight, which closing ends, and so does a PDF request that
   * loses the engine (`losePdf`). A compile that fails fails the trial, and so does the engine lost
   * to one of its requests; it is not tried again, since the fit that asked for it can be, and the
   * page on screen was never at stake.
   */
  private async runTrial(trial: Trial): Promise<void> {
    const { pkg, document: doc } = trial;
    try {
      const format = generateFormat(pkg, doc.controls);
      const body = generateBody(pkg, doc.resume, doc.controls);
      const instance = this.currentInstance();
      const { engine } = instance;
      const work: Work = {
        limit: this.limits[pkg.engine],
        request: (limit, call) => this.trialRequest(trial, instance, limit, call),
        current: () => this.trying === trial,
      };
      if (!instance.started) {
        await work.request(this.startLimit, () => engine.start());
        instance.started = true;
        if (!work.current()) return;
      }
      await this.prefetchFor(pkg);
      if (!work.current()) return;
      const failed = await this.installFormat(work, instance, pkg, format);
      if (failed !== undefined)
        throw new Error(`the format did not dump: ${failed.error}`, { cause: failed.log });
      if (!work.current()) return;
      // As the document's job does, for the same reason (see `run`). A trial is never dropped for
      // a newer document, so one asked before another document opened can still compile after
      // it, and it is the opening each trial notes, not the latest, that says whose files are in
      // the job.
      if (instance.fitOpened !== undefined && instance.fitOpened !== trial.opened) {
        await work.request(work.limit, () => engine.forget(FIT_JOB));
        if (!work.current()) return;
      }
      instance.fitOpened = trial.opened;
      // A worker's first compile of a format, in any job, reads the files the body needs, so it
      // has the start-up's limit here too (see `run`).
      const key = `${pkg.engine}:${format.name}`;
      const limit = instance.compiledWith.has(key) ? work.limit : this.startLimit;
      const result = await work.request(limit, () =>
        engine.compile(pkg.engine, format.name, body.latex, {
          job: FIT_JOB,
          maxPasses: MAX_PASSES,
        }),
      );
      instance.compiledWith.add(key);
      this.record(pkg, result.fetched);
      if (!result.ok)
        throw new Error(`the trial did not compile: ${result.error}`, { cause: result.log });
      trial.resolve(result.pages);
    } catch (error) {
      trial.reject(error);
    } finally {
      clearTimeout(trial.timer);
      if (this.trying === trial) {
        this.trying = undefined;
        this.next();
      }
    }
  }

  /**
   * One request of a trial to the engine, within a time limit. A request that runs past it, or that
   * the engine fails rather than answers, loses the engine (`loseToTrial`) and fails the trial.
   */
  private async trialRequest<T>(
    trial: Trial,
    instance: Instance,
    limit: number,
    call: () => Promise<T>,
  ): Promise<T> {
    let expire: (error: Error) => void = () => {};
    const expired = new Promise<never>((_, reject) => {
      expire = reject;
    });
    trial.timer = setTimeout(() => expire(new Error(`took over ${limit} ms`)), limit);
    try {
      return await Promise.race([call(), expired]);
    } catch (error) {
      this.loseToTrial(instance, error);
      throw error;
    } finally {
      clearTimeout(trial.timer);
    }
  }

  /**
   * The engine is lost to a trial's request, which ran past its limit or which the engine failed
   * rather than answered: it is terminated and replaced, as `lose` does for a compile. The page on
   * screen was made in that engine's job, which the next PDF is made from, so it compiles again on
   * the new engine once the trial has landed, as after `losePdf`, unless a newer document is on its
   * way and compiles instead.
   */
  private loseToTrial(instance: Instance, error: unknown) {
    if (this.closed || this.instance !== instance) return;
    console.warn(
      "A trial of other control values lost the engine, so a new one takes its place",
      error,
    );
    instance.engine.terminate();
    this.instance = undefined;
    if (this.pending === undefined && this.made?.instance === instance) {
      this.pending = this.made.document;
      this.setBusy();
    }
  }

  /**
   * One request to the engine, within a time limit. A request that runs past it, or that the
   * engine fails rather than answers, loses the engine (`lose`).
   */
  private async request<T>(run: Run, limit: number, call: () => Promise<T>): Promise<T> {
    try {
      return await this.within(run, limit, call, () => this.lose(run, `took over ${limit} ms`));
    } catch (error) {
      this.lose(run, "failed", error);
      throw error;
    }
  }

  /**
   * Wait for `work`, but call `expire` once `limit` ms have passed, which moves the scheduler on
   * without it; whatever `work` settles with after that finds its run no longer current.
   */
  private async within<T>(
    run: Run,
    limit: number,
    work: () => Promise<T>,
    expire: () => void,
  ): Promise<T> {
    const timer = setTimeout(expire, limit);
    run.timer = timer;
    try {
      return await work();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The engine is lost: a request ran past its time limit, and nothing reaches TeX inside its
   * synchronous run, or the engine failed a request rather than answering it, as a worker that
   * has crashed fails every request after. It is terminated, and the next request goes to a new
   * one, which gets the kept formats as its compiles need them; whatever the old one's requests
   * settle with is dropped. The run's document compiles again on the new engine, as a new
   * document, since that one has no job folder yet, unless a newer document waits and compiles
   * instead. A document that loses the engine on its second try is given up, and only then does
   * the user hear of it.
   */
  private lose(run: Run, why: string, ...detail: unknown[]) {
    if (this.running !== run) return;
    console.warn(`The engine ${why}, so a new one takes its place`, ...detail);
    this.running = undefined;
    this.generation++;
    this.instance?.engine.terminate();
    this.instance = undefined;
    if (this.pending === undefined && !run.retry) {
      this.begin(run.pkg, run.document, true);
      return;
    }
    if (this.pending === undefined) this.fail("the engine was lost twice");
    this.next();
  }

  /**
   * A page has not drawn within its run's time limit, waiting on fonts from the network. The
   * engine did its part and stays. The run is dropped, and with it whatever the draw brings back
   * later; the user gets the plain message, and the pending document, if one waits, compiles.
   */
  private drop(run: Run) {
    if (this.running !== run) return;
    this.running = undefined;
    if (this.current(run)) this.fail(`the page took over ${run.limit} ms to draw`);
    this.generation++;
    this.next();
  }

  /** A run has finished, one way or another: the pending document compiles now, with no wait. */
  private landed(run: Run) {
    if (this.running !== run) return;
    this.running = undefined;
    this.next();
  }

  /** Whether what a run brings back may still be shown: nothing newer started, nothing closed. */
  private current(run: Run): boolean {
    return !this.closed && run.generation === this.generation;
  }

  private currentInstance(): Instance {
    this.instance ??= {
      engine: this.newEngine(),
      started: false,
      installed: new Set(),
      compiled: false,
      fitOpened: undefined,
      compiledWith: new Set(),
    };
    return this.instance;
  }

  /**
   * Fetch the files a template is known to read into the HTTP cache, once per session, so that
   * the worker's synchronous reads, one round trip each, find them there. Only files the tree has
   * are fetched, whatever the store holds (`knownPath`). It settles once every fetch has been
   * asked for, and never with an error; it waits on none of them, since a file not yet fetched is
   * read when TeX asks for it, as it would have been anyway.
   */
  private prefetchFor(pkg: TemplatePackage): Promise<void> {
    const { prefetchStore: store, fetchFile, knownPath: known } = this;
    if (store === undefined || fetchFile === undefined || known === undefined)
      return Promise.resolve();
    let asked = this.prefetched.get(pkg.id);
    if (asked === undefined) {
      asked = this.ask("read the files to fetch ahead", () => store.get(pkg.id), [] as string[])
        .then((paths) => {
          for (const path of paths) if (known(path)) fetchFile(path).catch(() => {});
        })
        .catch((error: unknown) => console.warn("The files could not be fetched ahead", error));
      this.prefetched.set(pkg.id, asked);
    }
    return asked;
  }

  /** The format an earlier session kept under this name, when the store has one. */
  private stored(engine: SessionEngine, name: string): Promise<Uint8Array | undefined> {
    const store = this.formatStore;
    if (store === undefined) return Promise.resolve(undefined);
    return this.ask("read a kept format", () => store.get(engine, name), undefined);
  }

  /**
   * Note the TeX Live files a dump or a compile read, for the prefetch of later sessions. The
   * tree's own formats are left out: a dump reads the stock format once, so fetching it ahead
   * saves no round trip, and once the template's own format comes from the store, as it does
   * after the first session, it would be 6.5 MB fetched for nothing (decision 0003).
   */
  private record(pkg: TemplatePackage, fetched: Fetched) {
    const store = this.prefetchStore;
    const paths = fetched.paths.filter((path) => !path.endsWith(".fmt"));
    if (store === undefined || paths.length === 0) return;
    this.keep("note the files to fetch ahead", () => store.add(pkg.id, paths));
  }

  /**
   * What a store answers, or `fallback` when it fails or has not answered within `STORE_LIMIT`:
   * a store that is broken or stuck costs a dump or some round trips, never the page.
   */
  private async ask<T>(what: string, call: () => Promise<T>, fallback: T): Promise<T> {
    let wait: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<T>((resolve) => {
      wait = setTimeout(() => {
        console.warn(`The store did not ${what} within ${STORE_LIMIT} ms, so it is gone around`);
        resolve(fallback);
      }, STORE_LIMIT);
      this.waits.add(wait);
    });
    try {
      return await Promise.race([Promise.resolve().then(call), late]);
    } catch (error) {
      console.warn(`The store could not ${what}`, error);
      return fallback;
    } finally {
      clearTimeout(wait);
      if (wait !== undefined) this.waits.delete(wait);
    }
  }

  /** A write to a store that nothing waits on; one that fails costs a later session time. */
  private keep(what: string, write: () => Promise<unknown>) {
    Promise.resolve()
      .then(write)
      .catch((error: unknown) => console.warn(`The store could not ${what}`, error));
  }

  /** The plain message for the user, and what went wrong for developers. */
  private fail(what: string, ...detail: unknown[]) {
    this.made = undefined;
    console.error(`The page could not be updated: ${what}`, ...detail);
    this.events.error(COULD_NOT_UPDATE);
  }

  /**
   * Tell the app whether the engine is busy, with a document compiling or waiting to or a trial in
   * flight, when that changes; a PDF waits until it is not.
   */
  private setBusy() {
    const busy =
      this.running !== undefined || this.pending !== undefined || this.trying !== undefined;
    if (busy === this.busy || this.closed) return;
    this.busy = busy;
    this.events.busy(busy);
    if (!busy) for (const wake of this.settled.splice(0)) wake();
  }

  /**
   * A page with fonts it cannot draw is shown all the same, without their glyphs; the console
   * hears of each such font once, rather than on every compile.
   */
  private warnAboutFonts(page: DrawnPage) {
    const fresh = [...page.missingFonts].filter(([name]) => !this.warned.has(name));
    if (fresh.length === 0) return;
    for (const [name] of fresh) this.warned.add(name);
    const fonts = fresh.map(([name, why]) => `${name} (${why})`).join(", ");
    console.warn(`The page leaves out the glyphs of fonts it cannot draw: ${fonts}`);
  }
}

/** A document is set with the package its template names, and no other. */
function checkTemplate(pkg: TemplatePackage, doc: Document) {
  if (doc.template !== pkg.id)
    throw new Error(`the document is set with ${doc.template}, not ${pkg.id}`);
}
