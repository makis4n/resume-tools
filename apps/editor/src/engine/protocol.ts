/**
 * Messages between `EngineClient` and the compile worker. Every request carries an id, and the
 * reply to it carries the same id, so replies to overlapping requests cannot be confused. An
 * import (milestone 3 item 12, decision 0038) also sends progress under its id, as many times as
 * it has steps and compiles, before its reply; a progress message settles nothing. So does the
 * bridge's PDF of an import's reference page (milestone 3 second pass, item 16), compile by compile.
 * An import also sends its document before its checks end, its page and then its fields (decision
 * 00XX), under its id, each once at most; a stage settles nothing either.
 */

import type { PagePdf } from "../import/bridge";
import type { Upload } from "../import/intake";
import type { ImportOutcome, ImportProgress, ImportStage } from "../import/run";
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
  | { type: "import"; files: Upload[] }
  | { type: "referencePdf"; files: Upload[] };

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
  referencePdf: PagePdf;
}

export type EngineReply =
  | { id: number; result: EngineResults[keyof EngineResults] }
  | { id: number; error: string }
  | { id: number; progress: ImportProgress }
  | { id: number; stage: ImportStage };
