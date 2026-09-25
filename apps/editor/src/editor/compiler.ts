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
 */

import type {
  CompileOptions,
  CompileResult,
  DumpResult,
  JobFiles,
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
  compile(
    engine: SessionEngine,
    format: string,
    body: string,
    options?: CompileOptions,
  ): Promise<CompileResult>;
  /** Stop the engine at once, whatever it is doing; what waits on it fails. */
  terminate(): void;
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
}

/** What the user reads when a page cannot be made, whatever the reason; never TeX's words. */
export const COULD_NOT_UPDATE = "The page could not be updated.";

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
 * The job every document compiles in. It is the validation harness's `EDITOR_JOB`, since TeX tells
 * a document its job's name and the harness checks a package as the editor compiles it; item 13
 * may name jobs after documents, and must change the harness with it.
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
}

export class Compiler {
  private readonly delays: Record<SessionEngine, number>;
  private readonly limits: Record<SessionEngine, number>;
  private readonly startLimit: number;
  private readonly draw: typeof drawPage;
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
  }

  /**
   * Open a document set with a package, and compile it at once, dumping its format first if this
   * compiler has not. A compile in flight for what was open before is dropped when it lands, and
   * this document compiles then.
   */
  open(pkg: TemplatePackage, doc: Document) {
    if (this.closed) return;
    checkTemplate(pkg, doc);
    this.pkg = pkg;
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
    this.instance?.engine.terminate();
    this.instance = undefined;
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
      const key = `${pkg.engine}:${format.name}`;
      if (!instance.installed.has(key)) {
        const kept = this.formats.get(key);
        if (kept !== undefined) {
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
          if (!dumped.ok || dumped.format === undefined) {
            if (this.current(run))
              this.fail(`the format did not dump: ${dumped.error}`, dumped.log);
            return;
          }
          this.formats.set(key, dumped.format);
        }
        instance.installed.add(key);
        if (!this.current(run)) return;
      }
      const result = await this.request(run, run.limit, () =>
        engine.compile(pkg.engine, format.name, body.latex, { job: JOB, maxPasses: MAX_PASSES }),
      );
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
    this.instance ??= { engine: this.newEngine(), started: false, installed: new Set() };
    return this.instance;
  }

  /** The plain message for the user, and what went wrong for developers. */
  private fail(what: string, ...detail: unknown[]) {
    console.error(`The page could not be updated: ${what}`, ...detail);
    this.events.error(COULD_NOT_UPDATE);
  }

  /** Tell the app whether a document is compiling or waiting to, when that changes. */
  private setBusy() {
    const busy = this.running !== undefined || this.pending !== undefined;
    if (busy === this.busy || this.closed) return;
    this.busy = busy;
    this.events.busy(busy);
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
