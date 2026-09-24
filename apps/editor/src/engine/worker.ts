/**
 * The compile worker: one engine session, driven by `EngineClient`. It is a module worker, so it
 * imports the ES module copy of the engine's loader, and it reads TeX Live files with synchronous
 * requests, which a worker may make, because TeX asks for a file in the middle of a run.
 */

import type { EngineManifest } from "./manifest";
import type { EngineReply, EngineRequest } from "./protocol";
import { EngineSession, type LoadEngine } from "./session";

/** Where the dev server serves `.engine/` (see `scripts/fetch-engine.ts`). */
const BASE = "/engine/";

function getSync(url: string): Uint8Array {
  const request = new XMLHttpRequest();
  request.open("GET", url, false);
  request.responseType = "arraybuffer";
  request.send();
  if (request.status !== 200) throw new Error(`${url}: HTTP ${request.status}`);
  return new Uint8Array(request.response as ArrayBuffer);
}

const fileUrl = (path: string) =>
  `${BASE}files${path.split("/").map(encodeURIComponent).join("/")}`;

let starting: ReturnType<typeof EngineSession.start> | undefined;

async function start() {
  const response = await fetch(`${BASE}manifest.json`);
  if (!response.ok)
    throw new Error(`${BASE}manifest.json: HTTP ${response.status}; run fetch-engine`);
  const manifest = (await response.json()) as EngineManifest;
  const { default: load } = (await import(/* @vite-ignore */ `${BASE}busytex.mjs`)) as {
    default: LoadEngine;
  };
  return EngineSession.start({
    load,
    manifest,
    read: (path) => getSync(fileUrl(path)),
    locateFile: (name) => `${BASE}${name.split("/").pop()}`,
  });
}

async function handle(request: EngineRequest & { id: number }): Promise<EngineReply> {
  starting ??= start();
  const { session, result: started } = await starting;
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
    case "compile":
      return {
        id: request.id,
        result: session.compile(request.engine, request.format, request.body, request.options),
      };
    case "forget":
      session.forget(request.job);
      return { id: request.id, result: null };
  }
}

/** Bytes a reply can hand over rather than copy. */
function transferables(reply: EngineReply): Transferable[] {
  if (!("result" in reply) || !reply.result) return [];
  const result = reply.result as { output?: Uint8Array; format?: Uint8Array };
  return [result.output?.buffer, result.format?.buffer].filter(
    (b): b is ArrayBuffer => b instanceof ArrayBuffer,
  );
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
