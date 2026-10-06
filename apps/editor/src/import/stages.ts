/**
 * An import's document before its checks end (decision 0071): the editor opens it as soon as the
 * outline, compiled as the editor compiles it, has set the page the checks hold it to, its fields
 * locked; opens its fields once check 2 has settled them; and its groups once check 3 has, when the
 * outcome comes as it always did (`ImportStage`).
 *
 * The page it opens on is a compile the checks made anyway, never one more: the checks' compiler
 * keeps each compile's output by the resume it set (`StagedCompiler`), and a check's end looks up
 * the outline it leaves. Where that outline was not compiled as it stands, or did not set the page,
 * nothing opens until a later check's outline was and did, or until the outcome. What the page shows
 * is the real TeX output of the document that opens, as every page of the editor is.
 */

import type { OutlinePart } from "@resume-tools/resume-model";
import type { Document } from "../editor/document";
import type { EngineSession } from "../engine/session";
import type { TemplatePackage } from "../templates/package";
import {
  type CheckEnd,
  type Compiled,
  type CompilerInput,
  marked,
  OutlineCompiler,
} from "./checks";
import { outlineResume } from "./outline";
import type { ImportJob, ImportStage } from "./run";

/**
 * A short key of a resume, its JSON hashed (cyrb53, 53 bits), for the outputs the checks' compiler
 * keeps: two resumes that are not the same take the same key once in some 10^15 pairs.
 */
export function resumeKey(resume: unknown): string {
  const text = JSON.stringify(resume);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}-${(h1 >>> 0).toString(36)}-${text.length}`;
}

/**
 * The checks' compiler (`OutlineCompiler`), which also keeps the output, DVI or XDV, of each compile
 * of an outline the stages may ask for (`want`) that went through, by the resume it set
 * (`resumeKey`): the outlines the checks build from what they keep, never their mutations' or their
 * groups' trials, which no stage shows. It keeps them until the stages need none more (`release`),
 * or until it closes, and compiles nothing more than the checks ask of it. The session it compiles
 * on is the import's own, every call but `compile` going to it as it is.
 */
export class StagedCompiler extends OutlineCompiler {
  private readonly outputs = new Map<string, Uint8Array>();
  private readonly wanted = new Set<string>();
  private keeping = true;
  /** The output of the compile under way, as the session gave it. */
  private readonly seen: { output?: Uint8Array | undefined };

  constructor(input: CompilerInput) {
    const seen: { output?: Uint8Array | undefined } = {};
    const real = input.session;
    const compile: EngineSession["compile"] = (...args) => {
      const result = real.compile(...args);
      seen.output = result.output;
      return result;
    };
    const session = new Proxy(real, {
      get(target, key) {
        if (key === "compile") return compile;
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    super({ ...input, session });
    this.seen = seen;
  }

  /** Keep the output of this resume's compile, once it goes through, for a stage to show. */
  want(resume: unknown): void {
    if (this.keeping) this.wanted.add(resumeKey(resume));
  }

  override async compile(resume: Parameters<OutlineCompiler["compile"]>[0]): Promise<Compiled> {
    this.seen.output = undefined;
    const compiled = await super.compile(resume);
    const output = this.seen.output;
    this.seen.output = undefined;
    if (!this.keeping || compiled.broke || output === undefined) return compiled;
    const key = resumeKey(resume);
    if (this.wanted.has(key)) this.outputs.set(key, output);
    return compiled;
  }

  /** The output of the compile that set this resume, by its key, where one went through. */
  outputOf(key: string): Uint8Array | undefined {
    return this.outputs.get(key);
  }

  /** The stages need no output more: what is kept goes, and nothing more is kept. */
  release(): void {
    this.keeping = false;
    this.outputs.clear();
    this.wanted.clear();
  }

  override close() {
    super.close();
    this.release();
  }
}

/**
 * The document an outline's parts make while the checks run: its fields required where check 2
 * found them, and its groups as they stand, none fixed yet, since check 3 has not tried them; the
 * editor takes no step on a unit until the outcome says which are. Undefined where the parts make
 * no resume.
 */
export function stagedDocument(
  pkg: TemplatePackage,
  parts: readonly OutlinePart[],
  required: ReadonlySet<string>,
): Document | undefined {
  const resume = outlineResume(marked(parts, required, new Map()));
  return resume === undefined ? undefined : { version: 1, template: pkg.id, resume, controls: {} };
}

/** What the import's stages are told of it beside each check's end. */
export interface StageContext {
  pkg: TemplatePackage;
  job: ImportJob;
  compiler: StagedCompiler;
  /** How long the import has taken, in milliseconds, and how many compiles it has made. */
  now(): { ms: number; compiles: number };
}

/**
 * What hears each check's end and tells `hear` of the document (`ImportStage`): after check 1, its
 * page, where the outline it leaves was compiled and set the page the checks hold it to; after check
 * 2, its fields, with a page of its own where its outline is not the one shown, and only where that
 * outline was compiled, which check 2 always does but where it had been compiled before, kept with
 * every other output. Check 3's end says nothing: the outcome follows it at once. A `hear` that
 * throws changes nothing the import does.
 */
export function stagesOf(
  hear: (stage: ImportStage) => void,
  context: StageContext,
): (end: CheckEnd) => void {
  /** The key of the resume whose page has been brought. */
  let shown: string | undefined;
  return (end) => {
    if (end.check === 3) return;
    try {
      bring(end);
    } finally {
      // Check 2's end is the last that brings a page: no output is needed after it.
      if (end.check === 2) context.compiler.release();
    }
  };
  function bring(end: CheckEnd) {
    const resume = outlineResume(end.outline.parts);
    if (resume === undefined) return;
    const key = resumeKey(resume);
    const output = context.compiler.outputOf(key);
    if (end.check === 1 && (!end.holds || output === undefined)) return;
    // A page that is not this outline's, with none of its own to bring, would open fields its
    // markers do not hold: they stay locked until the outcome.
    if (key !== shown && output === undefined) return;
    const document = stagedDocument(context.pkg, end.outline.parts, end.required);
    if (document === undefined) return;
    const brings = key === shown ? undefined : output;
    shown = key;
    try {
      hear({
        phase: end.check === 1 ? "page" : "fields",
        package: context.pkg,
        document,
        job: context.job,
        ...(brings === undefined ? {} : { output: brings.slice() }),
        ...context.now(),
      });
    } catch {
      // What hears the stages changes nothing the import does.
    }
  }
}
