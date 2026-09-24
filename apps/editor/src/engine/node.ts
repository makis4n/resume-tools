/**
 * The engine session in Node, for tests and the validation harness. It reads `.engine/`, which
 * `pnpm --filter @resume-tools/editor fetch-engine` builds, straight from disk.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EngineManifest } from "./manifest";
import { EngineSession, type LoadEngine } from "./session";

export const ENGINE_DIR = fileURLToPath(new URL("../../.engine/", import.meta.url));

/** True when `.engine/` has been built; tests that need the engine skip without it. */
export const engineAvailable = () => existsSync(join(ENGINE_DIR, "manifest.json"));

export async function startNodeSession(): Promise<EngineSession> {
  const manifest = JSON.parse(
    readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
  ) as EngineManifest;
  const load = createRequire(import.meta.url)(join(ENGINE_DIR, "busytex.js")) as LoadEngine;
  const { session } = await EngineSession.start({
    load,
    manifest,
    read: (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
    locateFile: (name) => join(ENGINE_DIR, basename(name)),
    // TeX's exit() sets the process's exit code, which would fail the whole test run.
    afterRun: () => {
      process.exitCode = 0;
    },
    verifyHeap: true,
  });
  return session;
}
