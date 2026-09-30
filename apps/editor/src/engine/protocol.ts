/**
 * Messages between `EngineClient` and the compile worker. Every request carries an id, and the
 * reply to it carries the same id, so replies to overlapping requests cannot be confused. An
 * import (milestone 3 item 12, decision 0038) also sends progress under its id, as many times as
 * it has steps and compiles, before its reply; a progress message settles nothing.
 */

import type { Upload } from "../import/intake";
import type { ImportOutcome, ImportProgress } from "../import/run";
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
  | { type: "dropFormat"; engine: Engine; name: string }
  | { type: "compile"; engine: Engine; format: string; body: string; options?: CompileOptions }
  | { type: "forget"; job: string }
  | { type: "pdf"; job: string; options?: PdfOptions }
  | { type: "import"; files: Upload[] };

/** What each request resolves to. */
export interface EngineResults {
  start: StartResult;
  dump: DumpResult;
  putFormat: null;
  dropFormat: null;
  compile: CompileResult;
  forget: null;
  pdf: PdfResult;
  import: ImportOutcome;
}

export type EngineReply =
  | { id: number; result: EngineResults[keyof EngineResults] }
  | { id: number; error: string }
  | { id: number; progress: ImportProgress };
