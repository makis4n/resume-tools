/**
 * One child of `corpus fonts`'s pool (`corpus-fonts.ts`, decision 0023): an engine session and fonts
 * of its own, which take one document at a time, as a zip, through the intake, the reference
 * compile on XeTeX, the rewrite of its fonts and its check, and answer with the document's row,
 * names and numbers only, and its logs, which the parent keeps under `.corpus/` alone. A document
 * the runner does not take, a pdfTeX one that does not guard on the engine or loads no font package
 * the rewrite translates, answers with no row.
 *
 * The editor's modules are written for Vite, so this file, which Node runs as it is, loads them
 * through Vite's module runner with the app's own config, as `corpus-reference-child.ts` does, and
 * imports nothing of the editor itself but types. It prints nothing.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import type { Intake } from "../src/import/intake.ts";
import type { Refusal } from "../src/import/refusal.ts";
import { type FontsChildRow, rowName, type Taken } from "./corpus-fonts.ts";

type NodeEngine = typeof import("../src/engine/node.ts");
type Fonts = typeof import("../src/page/fonts.ts");
type TexLive = typeof import("../src/page/texlive.ts");
type IntakeModule = typeof import("../src/import/intake.ts");
type ReferenceModule = typeof import("../src/import/reference.ts");
type ImportFonts = typeof import("../src/import/fonts.ts");
type Source = typeof import("../src/import/source.ts");
type Xetex = typeof import("../src/import/xetex.ts");
type Check = typeof import("../src/import/xetex-check.ts");

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
  const { intake, treeImages, decodeText } =
    await runner.import<IntakeModule>("/src/import/intake.ts");
  const { reference } = await runner.import<ReferenceModule>("/src/import/reference.ts");
  const { readTree } = await runner.import<ImportFonts>("/src/import/fonts.ts");
  const { references } = await runner.import<Source>("/src/import/source.ts");
  const { rewriteForXetex, TRANSLATED_PACKAGES } =
    await runner.import<Xetex>("/src/import/xetex.ts");
  const { checkRewrite, formatPreamble } = await runner.import<Check>("/src/import/xetex-check.ts");

  const manifest = JSON.parse(
    readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
  ) as EngineManifest;
  const tree = readTree(manifest.files, manifest.fonts);
  const treeImage = treeImages(
    manifest.files,
    (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
  );
  const session = await startNodeSession();
  const fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
    readFileSync(join(ENGINE_DIR, "files", path)),
  );
  const translated = new Set(TRANSLATED_PACKAGES);

  /** Whether a document's own sources load a font package the rewrite translates. */
  const loadsFontPackage = (taken: Intake) =>
    [taken.main.text, ...Object.values(taken.files).map(decodeText)].some((text) =>
      references(text).some((each) => each.kind === "package" && translated.has(each.name)),
    );

  const refused = (why: Refusal): FontsChildRow["outcome"] =>
    why.reason === "font" || why.reason === "feature" || why.reason === "difference"
      ? why.name === "stopped"
        ? "stopped"
        : why.reason
      : "stopped";

  process.on("message", async (task: Task) => {
    if (task.type !== "task") return;
    const done = (row: FontsChildRow | undefined, logs: Record<string, string> = {}) =>
      send({ type: "done", id: task.id, row, logs });
    const taken = intake(
      { name: task.message.name, bytes: new Uint8Array(task.message.bytes) },
      { tree, treeImage },
    );
    if ("refused" in taken) return done(undefined);
    let kind: Taken;
    if (taken.engine === "xetex") kind = "xetex";
    else if (taken.source === "both" && loadsFontPackage(taken)) kind = "either";
    else return done(undefined);
    const onXetex: Intake = { ...taken, engine: "xetex" };
    const made = await reference(session, fonts, onXetex, { treeImage });
    if ("refused" in made)
      return kind === "xetex"
        ? done(undefined)
        : done({ taken: kind, outcome: "no-reference" }, { reference: made.log ?? "" });
    const referenceMs = Math.round(made.ms);
    const rewrite = rewriteForXetex(onXetex, tree);
    if ("refused" in rewrite)
      return done({
        taken: kind,
        outcome: refused(rewrite),
        name: rowName(rewrite.name),
        referenceMs,
      });
    const checked = await checkRewrite(session, fonts, onXetex, made, rewrite, { treeImage });
    const counts = {
      families: rewrite.fonts.length,
      shapes: rewrite.fonts.reduce((sum, family) => sum + Object.keys(family.shapes).length, 0),
      features: rewrite.features,
    };
    if ("refused" in checked)
      return done(
        {
          taken: kind,
          outcome: refused(checked),
          name: rowName(checked.name),
          referenceMs,
          ...counts,
        },
        {
          check: checked.log ?? "",
          // The rewritten document, as the check compiled it whole, for a developer to read.
          tex: `${formatPreamble(rewrite)}${rewrite.body}`,
        },
      );
    done({
      taken: kind,
      outcome: "rewritten",
      ...counts,
      ...(checked.warnings.length > 0 ? { maths: true } : {}),
      referenceMs,
      wholeMs: Math.round(checked.wholeMs),
      dumpMs: Math.round(checked.dumpMs),
      bodyMs: Math.round(checked.bodyMs),
      formatBytes: checked.formatBytes,
    });
  });
  send({ type: "ready" });
}

main().catch(() => {
  // The parent counts a child that dies; what killed it may quote a document, so it goes unsaid.
  process.exit(1);
});
