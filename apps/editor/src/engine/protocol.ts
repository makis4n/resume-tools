/**
 * Messages between `EngineClient` and the compile worker. Every request carries an id, and the
 * reply to it carries the same id, so replies to overlapping requests cannot be confused.
 */

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

export type EngineRequest =
  | { type: "start" }
  | { type: "dump"; engine: Engine; name: string; preamble: string; files?: JobFiles }
  | { type: "putFormat"; engine: Engine; name: string; format: Uint8Array }
  | { type: "compile"; engine: Engine; format: string; body: string; options?: CompileOptions }
  | { type: "forget"; job: string }
  | { type: "pdf"; job: string; options?: PdfOptions };

/** What each request resolves to. */
export interface EngineResults {
  start: StartResult;
  dump: DumpResult;
  putFormat: null;
  compile: CompileResult;
  forget: null;
  pdf: PdfResult;
}

export type EngineReply =
  | { id: number; result: EngineResults[keyof EngineResults] }
  | { id: number; error: string };
