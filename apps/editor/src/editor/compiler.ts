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
 * as TeX asks for them. On a slow machine or network either can take many seconds, and a worker
 * that replaces a lost one pays for both again, so they have a longer limit of their own and the
 * compile limit times only what TeX does with an edit. Drawing the page waits on fonts from the
 * network, so it has the compile's limit too; past it the page is dropped, but the worker, which
 * did its part, stays.
 *
 * Given the app's stores (`src/storage/store.ts`), formats and the TeX Live files each template
 * reads outlive the session: a format the store holds is handed to the engine rather than dumped,
 * and the files are fetched into the HTTP cache while the engine starts, since the worker reads
 * each with a synchronous request of its own (decision 0010). The stores only ever save time, so
 * one that fails or stalls is gone around rather than waited on.
 */

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
import { type GeneratedBody, generateBody, generateFormat } from "../templates/generate";
import type { TemplatePackage } from "../templates/package";
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
  /** Whether a document is compiling or waiting to, for a quiet indicator. */
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
 * The limit for a worker's start-up and for a dump. Start-up takes about 0.3 s once the engine's
 * files are cached (decision 0003), but a first load fetches the engine itself, 9.5 MB compressed,
 * so a minute leaves room for a slow connection and still gives up on a worker that will never
 * start. Why a dump shares it is said where the dump is asked for.
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
   * package's engine. Start-up and dumps have the longer `startLimit`.
   */
  limit: number;
  /** The time limit running now, of a request or of the draw. */
  timer?: ReturnType<typeof setTimeout>;
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
  /** The newest document that has not started compiling. */
  private pending: Document | undefined;
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
    this.opened = true;
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
   * while a compile is in flight, as soon as that one lands; either way only the newest compiles.
   */
  update(doc: Document) {
    if (this.closed) return;
    const pkg = this.pkg;
    if (pkg === undefined) throw new Error("a document has to be open before it can change");
    checkTemplate(pkg, doc);
    this.pending = doc;
    if (this.running === undefined) {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.debounce = undefined;
        this.next();
      }, this.delays[pkg.engine]);
    }
    this.setBusy();
  }

  /**
   * Stop for good: every timer stops, the engine is terminated, and a compile in flight is dropped
   * when it lands, so nothing is emitted after this.
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
  }

  /**
   * The PDF of the page on screen, which xdvipdfmx makes from the page's own output (plan section
   * 5.5). A document compiling or waiting to is the one the user sees next, so the PDF waits for
   * its page, and fails if that document's compile does: a PDF of the page before would not be
   * what the user asked for. Calls made while one is on its way share it. The request has a
   * compile's time limit, and one that runs past it, or that the engine fails rather than
   * answers, loses the engine as a compile's would (`losePdf`). The promise fails with
   * `COULD_NOT_MAKE_PDF`, and the reason as its cause.
   */
  pdf(): Promise<Uint8Array> {
    this.making ??= this.makePdf().finally(() => {
      this.making = undefined;
    });
    return this.making;
  }

  private async makePdf(): Promise<Uint8Array> {
    // Until nothing is compiling or waiting to, when the page on screen is the newest document's.
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
   * answered: it is terminated and replaced, as `lose` does for a compile. The page on screen then
   * compiles again on the new engine, unless a newer document is on its way and compiles instead,
   * so that the new engine's job holds the output the next PDF is made from.
   */
  private losePdf(made: Made, error: unknown) {
    if (this.closed || this.instance !== made.instance) return;
    console.warn("A PDF request lost the engine, so a new one takes its place", error);
    made.instance.engine.terminate();
    this.instance = undefined;
    if (this.running !== undefined || this.pending !== undefined) return;
    this.pending = made.document;
    this.next();
  }

  /** Start compiling the pending document, unless one is in flight. */
  private next() {
    if (this.closed || this.running !== undefined) return;
    const doc = this.pending;
    const pkg = this.pkg;
    if (doc === undefined || pkg === undefined) {
      this.setBusy();
      return;
    }
    this.pending = undefined;
    this.begin(pkg, doc, false);
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
      const key = `${pkg.engine}:${format.name}`;
      if (!instance.installed.has(key)) {
        // A format an earlier session kept saves the dump: 0.37 s in Chrome on a fast laptop, and
        // on a cold cache the 7.5 MiB of TeX Live files a dump reads, most of it the stock format
        // (decision 0003).
        const kept = this.formats.get(key) ?? (await this.stored(pkg.engine, format.name));
        if (!this.current(run)) return;
        if (kept !== undefined) {
          this.formats.set(key, kept);
          // putFormat may move the buffer it is given to the worker, so it gets a copy.
          await this.request(run, run.limit, () =>
            engine.putFormat(pkg.engine, format.name, kept.slice()),
          );
        } else {
          // A dump reads TeX Live's files as TeX asks for them, 54 files and 7.5 MiB for Jake's
          // format on a cold cache, and one that is cut off leaves no format behind, so the worker
          // that retries it reads them all over again. It gets the start-up's limit rather than
          // the compile's: a format is dumped when a document opens or a control bound to the
          // format changes, never per keystroke, so a long dump costs a wait, not an edit.
          const dumped = await this.request(run, this.startLimit, () =>
            engine.dump(pkg.engine, format.name, format.preamble, format.files),
          );
          this.record(pkg, dumped.fetched);
          if (!dumped.ok || dumped.format === undefined) {
            if (this.current(run))
              this.fail(`the format did not dump: ${dumped.error}`, dumped.log);
            return;
          }
          const bytes = dumped.format;
          this.formats.set(key, bytes);
          const store = this.formatStore;
          if (store) this.keep("keep a format", () => store.put(pkg.engine, format.name, bytes));
        }
        instance.installed.add(key);
        if (!this.current(run)) return;
      }
      // The job's folder may hold another document's auxiliary files, which this one must not
      // read. The scheduler knows no document ids, so a document opened on an engine that has
      // compiled starts afresh, which costs one pass when it is the same document again.
      if (this.opened && instance.compiled) {
        await this.request(run, run.limit, () => engine.forget(JOB));
        if (!this.current(run)) return;
      }
      this.opened = false;
      instance.compiled = true;
      const result = await this.request(run, run.limit, () =>
        engine.compile(pkg.engine, format.name, body.latex, { job: JOB, maxPasses: MAX_PASSES }),
      );
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

  /** Tell the app whether a document is compiling or waiting to, when that changes. */
  private setBusy() {
    const busy = this.running !== undefined || this.pending !== undefined;
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
