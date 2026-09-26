/**
 * One child of `corpus reference`'s pool (`corpus-reference.ts`, decision 0019): an engine
 * session and fonts of its own, which take one document at a time, as a zip, through the intake
 * and the reference compile, and answer with the document's row, names and numbers only, and its
 * log, which the parent keeps under `.corpus/` alone.
 *
 * The editor's modules are written for Vite, so this file, which Node runs as it is, loads them
 * through Vite's module runner with the app's own config, as `measure.ts` does, and imports nothing
 * of the editor itself but types. It prints nothing: a document's text never reaches a terminal.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import type { Intake } from "../src/import/intake.ts";
import type { Reference } from "../src/import/reference.ts";
import type { Refusal } from "../src/import/refusal.ts";
import { rowOf } from "./corpus-reference.ts";

type NodeEngine = typeof import("../src/engine/node.ts");
type Fonts = typeof import("../src/page/fonts.ts");
type TexLive = typeof import("../src/page/texlive.ts");
type IntakeModule = typeof import("../src/import/intake.ts");
type ReferenceModule = typeof import("../src/import/reference.ts");
type ImportFonts = typeof import("../src/import/fonts.ts");

const APP = fileURLToPath(new URL("..", import.meta.url));

/** A document, as the parent sends it: its zip and the zip's name. */
interface Task {
  type: "task";
  id: string;
  message: { name: string; bytes: Uint8Array };
}

async function main() {
  const send = (message: unknown) => process.send?.(message);
  const config = await resolveConfig(
    { root: APP, logLevel: "silent", ssr: { noExternal: ["opentype.js"] } },
    "serve",
  );
  const environment = createRunnableDevEnvironment("ssr", config, { hot: false });
  await environment.init();
  const { runner } = environment;
  const { ENGINE_DIR, startNodeSession } = await runner.import<NodeEngine>("/src/engine/node.ts");
  const { FontLibrary } = await runner.import<Fonts>("/src/page/fonts.ts");
  const { TexLiveIndex } = await runner.import<TexLive>("/src/page/texlive.ts");
  const { intake, treeImages } = await runner.import<IntakeModule>("/src/import/intake.ts");
  const { reference } = await runner.import<ReferenceModule>("/src/import/reference.ts");
  const { readTree } = await runner.import<ImportFonts>("/src/import/fonts.ts");

  const manifest = JSON.parse(
    readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
  ) as EngineManifest;
  const tree = readTree(manifest.files);
  const treeImage = treeImages(
    manifest.files,
    (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
  );
  const session = await startNodeSession();
  const fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
    readFileSync(join(ENGINE_DIR, "files", path)),
  );

  process.on("message", async (task: Task) => {
    if (task.type !== "task") return;
    const taken: Intake | Refusal = intake(
      { name: task.message.name, bytes: new Uint8Array(task.message.bytes) },
      { tree, treeImage },
    );
    let result: Reference | Refusal | undefined;
    if (!("refused" in taken)) result = await reference(session, fonts, taken, { treeImage });
    send({ type: "done", id: task.id, row: rowOf(taken, result), log: result?.log });
  });
  send({ type: "ready" });
}

main().catch(() => {
  // The parent counts a child that dies; what killed it may quote a document, so it goes unsaid.
  process.exit(1);
});
