/**
 * Messages between `EngineClient` and the compile worker. Every request carries an id, and the
 * reply to it carries the same id, so replies to overlapping requests cannot be confused.
 */

import type { CompileOptions, CompileResult, DumpResult, Engine, StartResult } from "./session";

export type EngineRequest =
  | { type: "start" }
  | { type: "write"; files: Record<string, string | Uint8Array> }
  | { type: "dump"; engine: Engine; name: string; preamble: string }
  | { type: "putFormat"; name: string; format: Uint8Array }
  | { type: "compile"; engine: Engine; format: string; body: string; options?: CompileOptions }
  | { type: "forget"; job: string };

/** What each request resolves to. */
export interface EngineResults {
  start: StartResult;
  write: null;
  dump: DumpResult;
  putFormat: null;
  compile: CompileResult;
  forget: null;
}

export type EngineReply =
  | { id: number; result: EngineResults[keyof EngineResults] }
  | { id: number; error: string };
