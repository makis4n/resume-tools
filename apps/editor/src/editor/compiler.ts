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
 * another. The formats are kept as bytes on the main thread, so the new worker is handed them
 * rather than dumping them again.
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
   * How long the page took, in milliseconds: from the start of the compile, and of the dump when
   * the format was new, to the drawn page, for the numbers item 23 records. The wait for a pause
   * in the edits is not in it.
   */
  ms: number;
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
  /** How long one request to the engine may take before the worker is stopped, in ms, by engine. */
  limits?: Record<SessionEngine, number>;
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
  /** Its time limit for each request, from its package's engine. */
  limit: number;
  /** The time limit of the request in flight. */
  timer?: ReturnType<typeof setTimeout>;
}

export class Compiler {
  private readonly delays: Record<SessionEngine, number>;
  private readonly limits: Record<SessionEngine, number>;
  private readonly draw: typeof drawPage;
  /** The engine every request goes to, made when the first document compiles. */
  private engine: Engine | undefined;
  /**
   * Every format dumped, as bytes, by engine and name. The session keeps its own copy, but a new
   * worker starts with none, and handing it these costs far less than dumping again.
   */
  private readonly formats = new Map<string, Uint8Array>();
  /** The formats the current engine holds, by engine and name. */
  private installed = new Set<string>();
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
    this.engine?.terminate();
    this.engine = undefined;
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
    const run: Run = { generation: ++this.generation, limit: this.limits[pkg.engine] };
    this.running = run;
    this.setBusy();
    void this.run(run, pkg, doc);
  }

  /** Take a document all the way to a page, or to the plain message. */
  private async run(run: Run, pkg: TemplatePackage, doc: Document): Promise<void> {
    const started = performance.now();
    try {
      const format = generateFormat(pkg, doc.controls);
      const body = generateBody(pkg, doc.resume, doc.controls);
      const engine = this.currentEngine();
      const key = `${pkg.engine}:${format.name}`;
      if (!this.installed.has(key)) {
        const kept = this.formats.get(key);
        if (kept !== undefined) {
          // putFormat may move the buffer it is given to the worker, so it gets a copy.
          await this.request(run, () => engine.putFormat(pkg.engine, format.name, kept.slice()));
        } else {
          const dumped = await this.request(run, () =>
            engine.dump(pkg.engine, format.name, format.preamble, format.files),
          );
          if (!dumped.ok || dumped.format === undefined) {
            if (this.current(run))
              this.fail(`the format did not dump: ${dumped.error}`, dumped.log);
            return;
          }
          this.formats.set(key, dumped.format);
        }
        // The engine holds the format now, unless a new engine has taken its place meanwhile.
        if (engine === this.engine) this.installed.add(key);
        if (!this.current(run)) return;
      }
      const result = await this.request(run, () =>
        engine.compile(pkg.engine, format.name, body.latex, { job: JOB, maxPasses: MAX_PASSES }),
      );
      if (!this.current(run)) return;
      if (!result.ok || result.output === undefined) {
        this.fail(`the body did not compile: ${result.error}`, result.log);
        return;
      }
      const page = await this.draw(result.output, this.fonts, body.texts);
      if (!this.current(run)) return;
      this.warnAboutFonts(page);
      this.events.page({ page, body, document: doc, ms: performance.now() - started });
    } catch (error) {
      // A request that was cut off fails with the terminated worker's error, which was reported
      // when it was cut off.
      if (this.current(run)) this.fail("the page could not be made", error);
    } finally {
      this.landed(run);
    }
  }

  /** One request to the engine, cut off if it has not settled within the run's time limit. */
  private async request<T>(run: Run, call: () => Promise<T>): Promise<T> {
    const timer = setTimeout(() => this.cutOff(run), run.limit);
    run.timer = timer;
    try {
      return await call();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A request has run past its time limit. Nothing reaches TeX inside its synchronous run, so the
   * worker goes and a new one takes its place, and gets the kept formats as its compiles need
   * them. Whatever the old worker's requests settle with is dropped, and the pending document, if
   * there is one, compiles on the new worker, as a new document, since it has no job folder yet.
   */
  private cutOff(run: Run) {
    if (this.running !== run) return;
    console.error(
      `The page could not be updated: the engine took over ${run.limit} ms, restarting`,
    );
    this.running = undefined;
    this.generation++;
    this.engine?.terminate();
    this.engine = this.newEngine();
    this.installed = new Set();
    this.events.error(COULD_NOT_UPDATE);
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

  private currentEngine(): Engine {
    this.engine ??= this.newEngine();
    return this.engine;
  }

  /** The plain message for the user, and what went wrong for developers. */
  private fail(what: string, detail: unknown) {
    console.error(`The page could not be updated: ${what}`, detail);
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
