/**
 * The main thread's handle on the compile worker. Every method posts one request and resolves
 * with the worker's reply to it; requests run in the order they were made. Once the worker has
 * failed or been terminated, every call fails; a new client starts a new worker.
 *
 * TeX runs in the worker in one synchronous call that nothing can interrupt (decision 0008), so
 * the one way to stop a compile is to terminate the worker. `cancel` does that and starts the
 * worker afresh for the next call, as an import the user cancels needs (milestone 3 item 12,
 * decision 0038); every call waiting on the old worker fails with `EngineCancelled`. An import is
 * timed compile by compile, from the progress the worker sends as each begins: one that runs past
 * its limit is a hung compile, and gets the same, the import failing with `EngineTimeout`.
 */

import type { PagePdf } from "../import/bridge";
import type { Upload } from "../import/intake";
import type { ImportOutcome, ImportProgress, ImportStage } from "../import/run";
import type { EngineReply, EngineRequest, EngineResults } from "./protocol";
import type {
  CompileOptions,
  CompileResult,
  DumpResult,
  Engine,
  JobFiles,
  PdfOptions,
  PdfResult,
  StartResult,
} from "./session";

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  /** What the request's progress goes to, for a request that sends some. */
  progress?: (progress: ImportProgress) => void;
  /** What an import's document before its checks end goes to (`ImportStage`, decision 00XX). */
  stage?: (stage: ImportStage) => void;
}

/** A call that failed because the worker was terminated and started afresh (`cancel`). */
export class EngineCancelled extends Error {
  constructor(message = "the compile worker was cancelled") {
    super(message);
    this.name = "EngineCancelled";
  }
}

/** An import whose compile ran past its limit, which the client took for hung (`importResume`). */
export class EngineTimeout extends EngineCancelled {
  constructor(readonly limit: number) {
    super(`a compile of the import ran past ${limit} ms`);
    this.name = "EngineTimeout";
  }
}

/**
 * How long one compile of an import may run before the client takes it for hung: far past what a
 * resume takes, a XeTeX reference compile's first fetch of the tree's fonts on a slow connection
 * among them (decision 0019), and short of a wait nobody would sit through.
 */
export const IMPORT_COMPILE_LIMIT = 120_000;

/** The default worker: the compile worker as a module worker. */
const compileWorker = () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

export class EngineClient {
  /** The worker requests go to, or none between a `cancel` and the next call. */
  private worker: Worker | undefined;
  /** Makes a new worker after a `cancel`; none when the client was given a worker, not a maker. */
  private readonly spawn: (() => Worker) | undefined;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  /** Why the worker stopped for good, once it has. */
  private stopped: Error | undefined;

  constructor(worker: Worker | (() => Worker) = compileWorker) {
    this.spawn = typeof worker === "function" ? worker : undefined;
    this.worker = this.attach(typeof worker === "function" ? worker() : worker);
  }

  /** A worker with the client's handlers on it. */
  private attach(worker: Worker): Worker {
    worker.onmessage = (event: MessageEvent<EngineReply>) => {
      // A worker the client has let go of says nothing to it any more.
      if (worker !== this.worker) return;
      const reply = event.data;
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      if ("progress" in reply) {
        pending.progress?.(reply.progress);
        return;
      }
      if ("stage" in reply) {
        pending.stage?.(reply.stage);
        return;
      }
      this.pending.delete(reply.id);
      if ("error" in reply) pending.reject(new Error(reply.error));
      else pending.resolve(reply.result);
    };
    // A worker that fails to load, or throws outside a request, will not answer what it was
    // asked, and may never answer again: stop it, which fails everything waiting on it.
    worker.onerror = (event: ErrorEvent) => {
      if (worker !== this.worker) return;
      this.stop(new Error(`compile worker: ${event.message || "failed to load"}`));
    };
    return worker;
  }

  private call<R extends EngineRequest>(
    request: R,
    transfer: Transferable[] = [],
    progress?: (progress: ImportProgress) => void,
    stage?: (stage: ImportStage) => void,
  ): Promise<EngineResults[R["type"]]> {
    if (this.stopped) return Promise.reject(this.stopped);
    // After a cancel, the next call starts the worker afresh.
    const worker = this.worker ?? (this.spawn && this.attach(this.spawn()));
    if (worker === undefined) return Promise.reject(new EngineCancelled());
    this.worker = worker;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        ...(progress === undefined ? {} : { progress }),
        ...(stage === undefined ? {} : { stage }),
      });
      worker.postMessage({ ...request, id }, transfer);
    });
  }

  /** Load the engine and mount TeX Live. Other calls start it too; this reports how it went. */
  start(): Promise<StartResult> {
    return this.call({ type: "start" });
  }

  /** Dump a preamble into a format, with `files` such as a class file beside it. */
  dump(engine: Engine, name: string, preamble: string, files?: JobFiles): Promise<DumpResult> {
    return this.call({ type: "dump", engine, name, preamble, files });
  }

  /** Hand the worker a format made earlier. The bytes move to the worker. */
  async putFormat(engine: Engine, name: string, format: Uint8Array): Promise<void> {
    await this.call({ type: "putFormat", engine, name, format }, [format.buffer as ArrayBuffer]);
  }

  /**
   * Take a format out of the worker's session, to free what it holds: a package's formats, once its
   * last document is gone (decision 0022's rule, decision 0038). Dropping one it does not hold does
   * nothing.
   */
  async dropFormat(engine: Engine, name: string): Promise<void> {
    await this.call({ type: "dropFormat", engine, name });
  }

  compile(
    engine: Engine,
    format: string,
    body: string,
    options?: CompileOptions,
  ): Promise<CompileResult> {
    return this.call({ type: "compile", engine, format, body, options });
  }

  async forget(job: string): Promise<void> {
    await this.call({ type: "forget", job });
  }

  /** The PDF of a job's last compile. The worker hands the bytes over rather than copy them. */
  pdf(job: string, options?: PdfOptions): Promise<PdfResult> {
    return this.call({ type: "pdf", job, options });
  }

  /**
   * Import a resume in the worker, in a job of its own (`importResume` of `src/import/run.ts`):
   * its package, document, report and files, or a refusal. `onProgress` hears each step and each
   * compile as it begins and ends, and `onStage` the document before its checks end, its page and
   * then its fields (decision 00XX). A compile that runs past `limit` is taken for hung: the worker
   * is terminated and started afresh, as `cancel` does, and the import fails with `EngineTimeout`.
   */
  importResume(
    files: readonly Upload[],
    onProgress: (progress: ImportProgress) => void,
    limit = IMPORT_COMPILE_LIMIT,
    onStage?: (stage: ImportStage) => void,
  ): Promise<ImportOutcome> {
    return this.timed({ type: "import", files: [...files] }, onProgress, limit, onStage);
  }

  /**
   * Make a PDF of the reference page an import of these files compiles (`referencePdf` of
   * `src/import/bridge.ts`, milestone 3 second pass, item 16), in the worker, in a job of its own,
   * timed compile by compile as an import is.
   */
  referencePdf(
    files: readonly Upload[],
    onProgress: (progress: ImportProgress) => void,
    limit = IMPORT_COMPILE_LIMIT,
  ): Promise<PagePdf> {
    return this.timed({ type: "referencePdf", files: [...files] }, onProgress, limit);
  }

  /**
   * A request that sends progress, timed compile by compile: one that runs past `limit` is taken
   * for hung, and the worker is terminated and started afresh, the request failing with
   * `EngineTimeout`.
   */
  private timed<R extends Extract<EngineRequest, { type: "import" | "referencePdf" }>>(
    request: R,
    onProgress: (progress: ImportProgress) => void,
    limit: number,
    onStage?: (stage: ImportStage) => void,
  ): Promise<EngineResults[R["type"]]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = this.call(
      request,
      [],
      (progress) => {
        clearTimeout(timer);
        timer = progress.compiling
          ? setTimeout(() => this.cancel(new EngineTimeout(limit)), limit)
          : undefined;
        onProgress(progress);
      },
      onStage,
    );
    return done.finally(() => clearTimeout(timer));
  }

  /**
   * Terminate the worker, whatever it is doing, and start it afresh for the next call: what waits
   * on it fails with `reason`, `EngineCancelled` by default, and nothing it had, formats and jobs
   * among them, carries over. A client given a worker rather than a maker of them cannot start
   * one afresh, and stops for good.
   */
  cancel(reason: Error = new EngineCancelled()): void {
    if (this.stopped) return;
    this.worker?.terminate();
    this.worker = undefined;
    if (this.spawn === undefined) this.stopped = reason;
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
  }

  /** Stop the worker; anything still waiting fails, and so does anything asked later. */
  terminate() {
    this.stop(new Error("compile worker terminated"));
  }

  private stop(error: Error) {
    if (this.stopped) return;
    this.stopped = error;
    this.worker?.terminate();
    this.worker = undefined;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
