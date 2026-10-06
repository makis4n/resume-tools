/**
 * The compile worker: one engine session, driven by `EngineClient`. It is a module worker, so it
 * imports the ES module copy of the engine's loader, and it reads TeX Live files with synchronous
 * requests, which a worker may make, because TeX asks for a file in the middle of a run. Only the
 * HTTP cache can answer such a request, so every file comes from a URL under the tree's tag, which
 * the dev server marks immutable (`src/engine/urls.ts`).
 *
 * An import (milestone 3 item 12, decision 0038) runs here too, on the same session, in a job of
 * its own, so that one engine is loaded at a time: the pipeline (`src/import/run.ts`) is loaded
 * only when the first import asks for it, with the fonts the page's glyphs are read with, fetched
 * as the page fetches them, the engine's own files. An import sends nothing anywhere (decision
 * 0049). Its progress goes to the client as it comes, under the request's id, and so does its
 * document before its checks end, its page and then its fields (decision 0071), the page's output
 * handed over rather than copied. The bridge's PDF of an import's reference page (milestone 3
 * second pass, item 16) runs with it, loaded with it.
 */

import type { PagePdf } from "../import/bridge";
import type { Upload } from "../import/intake";
import type { ImportOutcome, ImportProgress, ImportStage } from "../import/run";
import type { EngineManifest } from "./manifest";
import type { EngineReply, EngineRequest } from "./protocol";
import { EngineSession, type LoadEngine } from "./session";
import { engineTag, engineUrl, fileUrl, manifestUrl } from "./urls";

function getSync(url: string): Uint8Array {
  const request = new XMLHttpRequest();
  request.open("GET", url, false);
  request.responseType = "arraybuffer";
  request.send();
  if (request.status !== 200) throw new Error(`${url}: HTTP ${request.status}`);
  return new Uint8Array(request.response as ArrayBuffer);
}

let starting:
  | Promise<Awaited<ReturnType<typeof EngineSession.start>> & { manifest: EngineManifest }>
  | undefined;

async function start() {
  const response = await fetch(manifestUrl());
  if (!response.ok) throw new Error(`${manifestUrl()}: HTTP ${response.status}; run fetch-engine`);
  const manifest = (await response.json()) as EngineManifest;
  const tag = engineTag(manifest);
  const { default: load } = (await import(/* @vite-ignore */ engineUrl(tag, "busytex.mjs"))) as {
    default: LoadEngine;
  };
  const started = await EngineSession.start({
    load,
    manifest,
    read: (path) => getSync(fileUrl(tag, path)),
    locateFile: (name) => engineUrl(tag, name.split("/").pop() ?? name),
  });
  return { ...started, manifest };
}

/** Runs on the session's engine, an import's and the bridge's PDF's, with what they share. */
interface Importer {
  run(
    files: Upload[],
    onStep: (step: ImportProgress) => void,
    onStage: (stage: ImportStage) => void,
  ): Promise<ImportOutcome>;
  pdf(files: Upload[], onStep: (step: ImportProgress) => void): Promise<PagePdf>;
}

/** What an import runs with beside the session, made at the first import and kept. */
let importing: Promise<Importer> | undefined;

/**
 * The import's runner on this worker's session: the pipeline, loaded now, with the fonts the page
 * reads glyphs with, fetched as the page fetches them into the HTTP cache the engine reads from;
 * and the tree's fonts and images, which the intake and the reference read.
 */
async function importer(session: EngineSession, manifest: EngineManifest): Promise<Importer> {
  const [
    { importResume },
    { referencePdf },
    { FontLibrary },
    { TexLiveIndex },
    { readTree },
    { treeImages },
  ] = await Promise.all([
    import("../import/run"),
    import("../import/bridge"),
    import("../page/fonts"),
    import("../page/texlive"),
    import("../import/fonts"),
    import("../import/intake"),
  ]);
  const tag = engineTag(manifest);
  const fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) => {
    const response = await fetch(fileUrl(tag, path));
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  });
  const tree = readTree(manifest.files, manifest.fonts);
  const treeImage = treeImages(manifest.files, (path) => getSync(fileUrl(tag, path)));
  const deps = { session, fonts, tree, treeImage };
  return {
    run: (files, onStep, onStage) => importResume(files, { ...deps, onStage }, onStep),
    pdf: (files, onStep) => referencePdf(files, deps, onStep),
  };
}

async function handle(request: EngineRequest & { id: number }): Promise<EngineReply> {
  starting ??= start();
  const { session, result: started, manifest } = await starting;
  switch (request.type) {
    case "start":
      return { id: request.id, result: started };
    case "dump":
      return {
        id: request.id,
        result: session.dump(request.engine, request.name, request.preamble, request.files),
      };
    case "putFormat":
      session.putFormat(request.engine, request.name, request.format);
      return { id: request.id, result: null };
    case "dropFormat":
      session.dropFormat(request.engine, request.name);
      return { id: request.id, result: null };
    case "compile":
      return {
        id: request.id,
        result: session.compile(request.engine, request.format, request.body, request.options),
      };
    case "forget":
      session.forget(request.job);
      return { id: request.id, result: null };
    case "pdf":
      return { id: request.id, result: session.pdf(request.job, request.options) };
    case "import":
    case "referencePdf": {
      // One that failed to load is tried again at the next import.
      importing ??= importer(session, manifest).catch((error: unknown) => {
        importing = undefined;
        throw error;
      });
      const runs = await importing;
      const { id } = request;
      const onStep = (progress: ImportProgress) => {
        const reply: EngineReply = { id, progress };
        self.postMessage(reply);
      };
      // A stage's output is its own copy, so it is handed over rather than copied.
      const onStage = (stage: ImportStage) => {
        const reply: EngineReply = { id, stage };
        const output = stage.output?.buffer;
        self.postMessage(reply, { transfer: output instanceof ArrayBuffer ? [output] : [] });
      };
      const result =
        request.type === "import"
          ? await runs.run(request.files, onStep, onStage)
          : await runs.pdf(request.files, onStep);
      return { id, result };
    }
  }
}

/**
 * Bytes a reply can hand over rather than copy: a compile's output, a dump's format, a PDF, and the
 * format an import hands the editor (decision 0045).
 */
function transferables(reply: EngineReply): Transferable[] {
  if (!("result" in reply) || !reply.result) return [];
  const result = reply.result as {
    output?: Uint8Array;
    format?: Uint8Array;
    pdf?: Uint8Array;
    formats?: { format: Uint8Array }[];
  };
  const buffers = [
    result.output?.buffer,
    result.format?.buffer,
    result.pdf?.buffer,
    ...(result.formats ?? []).map((each) => each.format.buffer),
  ].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
  // A buffer listed twice cannot be handed over: none is, but a reply is never lost for it.
  return [...new Set(buffers)];
}

// One request at a time, in the order they came: TeX runs are synchronous and share one heap.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<EngineRequest & { id: number }>) => {
  const request = event.data;
  queue = queue.then(async () => {
    let reply: EngineReply;
    try {
      reply = await handle(request);
    } catch (error) {
      reply = {
        id: request.id,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      };
    }
    self.postMessage(reply, { transfer: transferables(reply) });
  });
};
