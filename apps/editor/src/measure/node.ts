/**
 * The import's measurement in Node (milestone 3 item 19, decision 0045): what `measureImport`
 * (`import.ts`) runs with there. An engine is a session of its own, started afresh for each import
 * as a new worker is, that imports on that session as the worker does (`src/engine/worker.ts`),
 * setting up what the pipeline runs with at its first import; the naming step is the service's own
 * handler over the committed answers alone, as the dev server answers with no key, so that no model
 * is asked and nothing goes over the network; and the fonts are read from `.engine/`.
 *
 * It is Node's alone, as `src/engine/node.ts` is: `scripts/measure.ts` and the tests load it, and the
 * app never does.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Engine as CompilerEngine } from "../editor/compiler";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, startNodeSession } from "../engine/node";
import { readTree } from "../import/fonts";
import { treeImages } from "../import/intake";
import { type ImportDeps, importResume, type NameRequest } from "../import/run";
import { nameOnService } from "../import/service";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { handleName, LIMITS, type NameDeps, type ServiceCache } from "../service/name";
import { MemoryPreambleCache } from "../service/preamble";
import { MemoryRateStore } from "../service/rate";

/** The committed answers, the seed among them, which the naming route reads first. */
const ANSWERS_DIR = fileURLToPath(new URL("../../corpus/answers/", import.meta.url));

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

/** The committed answers as the service's cache, which reads them and never writes. */
const committed: ServiceCache = {
  get: (key) => {
    const path = join(ANSWERS_DIR, `${key}.json`);
    return /^[0-9a-f]{64}$/.test(key) && existsSync(path) ? readFileSync(path, "utf8") : undefined;
  },
  put: () => false,
};

/**
 * The naming step as the dev server answers it with no key: the service's handler over the
 * committed answers, and no model, called in this thread, with a rate limit of its own, so that no
 * number of imports runs into the one a person's address has.
 */
export function namingOnAnswers(): NameRequest {
  const service: NameDeps = {
    cache: committed,
    preambles: new MemoryPreambleCache(),
    model: undefined,
    rates: new MemoryRateStore(),
    limits: LIMITS,
    now: Date.now,
    address: "127.0.0.1",
  };
  return (request, names, signal) =>
    nameOnService(
      request,
      (input, init) => handleName(new Request(new URL(input, "http://localhost"), init), service),
      signal,
      names,
    );
}

/**
 * An engine as the scheduler takes one, as a new worker is: a session of the engine started
 * afresh, which every request runs on at once, and which imports there as the worker does,
 * setting up at its first import the fonts the import reads the page's glyphs with, the tree's
 * fonts, styles and images, and the naming step (`namingOnAnswers`).
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
    importResume: async (files, onProgress) => {
      deps ??= {
        fonts: treeFonts(manifest),
        tree: readTree(manifest.files, manifest.fonts),
        treeImage: treeImages(manifest.files, treeFile),
        name: namingOnAnswers(),
      };
      return importResume(files, { session, ...deps }, onProgress);
    },
    cancel: () => {},
    terminate: () => {},
  };
}
