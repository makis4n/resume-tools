/**
 * The import's measurement in Node (milestone 3 item 19, decision 0045): what `measureImport`
 * (`import.ts`) runs with there. An engine is a session of its own, started afresh for each import
 * as a new worker is, that imports on that session as the worker does (`src/engine/worker.ts`),
 * setting up what the pipeline runs with at its first import, which names nothing and sends nothing
 * (decision 0049); and the fonts are read from `.engine/`.
 *
 * It is Node's alone, as `src/engine/node.ts` is: `scripts/measure.ts` and the tests load it, and the
 * app never does.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Engine as CompilerEngine } from "../editor/compiler";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, startNodeSession } from "../engine/node";
import { readTree } from "../import/fonts";
import { treeImages } from "../import/intake";
import { type ImportDeps, importResume } from "../import/run";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";

/** The engine's manifest, from `.engine/`, which `fetch-engine` builds. */
export function engineManifest(): EngineManifest {
  return JSON.parse(readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8")) as EngineManifest;
}

/** A file of the engine's tree, by its path in the engine's file system. */
const treeFile = (path: string) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path)));

/** The tree's fonts as a new page or worker reads them: a library of their own, read from disk. */
export function treeFonts(manifest: EngineManifest): FontLibrary {
  return new FontLibrary(new TexLiveIndex(manifest), async (path) => treeFile(path));
}

/**
 * An engine as the scheduler takes one, as a new worker is: a session of the engine started
 * afresh, which every request runs on at once, and which imports there as the worker does,
 * setting up at its first import the fonts the import reads the page's glyphs with, and the tree's
 * fonts, styles and images.
 */
export async function importEngine(manifest: EngineManifest): Promise<CompilerEngine> {
  const session = await startNodeSession();
  let deps: Omit<ImportDeps, "session"> | undefined;
  return {
    start: async () => {},
    dump: async (engine, name, preamble, files) => session.dump(engine, name, preamble, files),
    putFormat: async (engine, name, format) => session.putFormat(engine, name, format),
    dropFormat: async (engine, name) => session.dropFormat(engine, name),
    forget: async (job) => session.forget(job),
    compile: async (engine, format, body, options) =>
      session.compile(engine, format, body, options),
    pdf: async (job, options) => session.pdf(job, options),
    importResume: async (files, onProgress, _limit, onStage) => {
      deps ??= {
        fonts: treeFonts(manifest),
        tree: readTree(manifest.files, manifest.fonts),
        treeImage: treeImages(manifest.files, treeFile),
      };
      return importResume(
        files,
        { session, ...deps, ...(onStage === undefined ? {} : { onStage }) },
        onProgress,
      );
    },
    cancel: () => {},
    terminate: () => {},
  };
}
