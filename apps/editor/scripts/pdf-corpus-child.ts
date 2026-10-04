/**
 * One child of `pdf-corpus`'s pool (milestone 3 second pass, item 15): an engine session and fonts
 * of its own, which take one corpus document at a time, as a zip, through the intake and the
 * reference compile, as `corpus reference` does; then make its PDF as the editor would, read the
 * PDF through the editor's reader (`src/pdf/node.ts`), and lay it out, label its lines and file
 * them by the rules (`resumeOfPdf`), as a person who says no to the hosted model gets. It answers
 * with counts only (`CorpusCounts`): never a line, a word or a field of the document. It prints
 * nothing, and its failures say only their kind, since an error's message may quote the document.
 *
 * The editor's import modules are written for Vite, so the intake and the reference load through
 * Vite's module runner with the app's own config, as `corpus-reference-child.ts` does; the PDF's
 * reading is plain modules, loaded as they are.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import type { Intake } from "../src/import/intake.ts";
import type { Reference } from "../src/import/reference.ts";
import type { Refusal } from "../src/import/refusal.ts";
import { readPdf } from "../src/pdf/node.ts";
import { isPdfRefusal } from "../src/pdf/refusals.ts";
import { resumeOfPdf } from "../src/pdf/resume.ts";
import { type CorpusCounts, countsOf, pdfErrorKind } from "./pdf-counts.ts";

type NodeEngine = typeof import("../src/engine/node.ts");
type Fonts = typeof import("../src/page/fonts.ts");
type TexLive = typeof import("../src/page/texlive.ts");
type IntakeModule = typeof import("../src/import/intake.ts");
type ReferenceModule = typeof import("../src/import/reference.ts");
type ImportFonts = typeof import("../src/import/fonts.ts");

const APP = fileURLToPath(new URL("..", import.meta.url));

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
  const { reference, IMPORT_JOB } = await runner.import<ReferenceModule>(
    "/src/import/reference.ts",
  );
  const { readTree } = await runner.import<ImportFonts>("/src/import/fonts.ts");
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

  process.on("message", async (task: Task) => {
    if (task.type !== "task") return;
    let counts: CorpusCounts;
    try {
      const started = performance.now();
      const taken: Intake | Refusal = intake(
        { name: task.message.name, bytes: new Uint8Array(task.message.bytes) },
        { tree, treeImage },
      );
      if ("refused" in taken) counts = { outcome: taken.reason };
      else {
        const result: Reference | Refusal = await reference(session, fonts, taken, { treeImage });
        if ("refused" in result) counts = { outcome: result.reason, engine: taken.engine };
        else {
          const compileMs = performance.now() - started;
          const images = [...taken.images.replaced, ...result.images].map((image) => image.path);
          const made = session.pdf(IMPORT_JOB, { images });
          if (!made.ok || made.pdf === undefined)
            counts = {
              outcome: "no-pdf",
              pdfError: pdfErrorKind(made.error),
              engine: result.engine,
              compileMs,
            };
          else {
            const pdfBytes = made.pdf.length;
            const read = await readPdf(made.pdf);
            if (isPdfRefusal(read))
              counts = { outcome: read.reason, engine: result.engine, compileMs, pdfBytes };
            else {
              const rulesStarted = performance.now();
              const reading = await resumeOfPdf(read);
              const rulesMs = performance.now() - rulesStarted;
              counts = {
                ...countsOf(reading),
                engine: result.engine,
                compileMs,
                pdfBytes,
                readMs: read.ms,
                rulesMs,
              };
            }
          }
        }
      }
    } catch (error) {
      // What failed may quote the document: only its kind is said.
      counts = { outcome: "failed", failure: error instanceof Error ? error.name : typeof error };
    }
    send({ type: "done", id: task.id, counts });
  });
  send({ type: "ready" });
}

main().catch(() => {
  // The parent counts a child that dies; what killed it may quote a document, so it goes unsaid.
  process.exit(1);
});
