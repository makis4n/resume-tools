/**
 * The main thread's handle on the compile worker. Every method posts one request and resolves
 * with the worker's reply to it; requests run in the order they were made.
 */

import type { EngineReply, EngineRequest, EngineResults } from "./protocol";
import type { CompileOptions, CompileResult, DumpResult, Engine, StartResult } from "./session";

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export class EngineClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;

  constructor(worker?: Worker) {
    this.worker = worker ?? new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<EngineReply>) => {
      const reply = event.data;
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id);
      if ("error" in reply) pending.reject(new Error(reply.error));
      else pending.resolve(reply.result);
    };
    // A worker that fails to load or throws outside a request fails everything waiting on it.
    this.worker.onerror = (event: ErrorEvent) => {
      const error = new Error(`compile worker: ${event.message || "failed to load"}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  private call<R extends EngineRequest>(
    request: R,
    transfer: Transferable[] = [],
  ): Promise<EngineResults[R["type"]]> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
      this.worker.postMessage({ ...request, id }, transfer);
    });
  }

  /** Load the engine and mount TeX Live. Other calls start it too; this reports how it went. */
  start(): Promise<StartResult> {
    return this.call({ type: "start" });
  }

  /** Write files into the project folder, such as a template's class files. */
  async write(files: Record<string, string | Uint8Array>): Promise<void> {
    await this.call({ type: "write", files });
  }

  dump(engine: Engine, name: string, preamble: string): Promise<DumpResult> {
    return this.call({ type: "dump", engine, name, preamble });
  }

  /** Hand the worker a format made earlier. The bytes move to the worker. */
  async putFormat(name: string, format: Uint8Array): Promise<void> {
    await this.call({ type: "putFormat", name, format }, [format.buffer as ArrayBuffer]);
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

  /** Stop the worker; anything still waiting fails. */
  terminate() {
    this.worker.terminate();
    const error = new Error("compile worker terminated");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
