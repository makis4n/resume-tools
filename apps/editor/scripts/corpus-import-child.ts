/**
 * One child of `corpus run`'s pool (`corpus-import.ts`, the second pass's item 6): an engine
 * session and fonts of its own, which take one document at a time, as a zip, through the import a
 * person's browser runs (`importResume`, decision 0049), as it is, on that session: the intake, the
 * reference compile, the fonts, the signatures, the parse, the probe, the outline and its four
 * checks. It names nothing and sends nothing; it reads the import's report as the app reads it
 * (`reportOfImport`, decision 0039).
 *
 * It answers with the document's row, ids and counts only, and prints nothing: a document's text
 * never reaches a terminal, nor does a compile's log, which may quote it. The editor's modules are
 * written for Vite, so this file, which Node runs as it is, loads them through Vite's module runner
 * with the app's own config, as the corpus's other children do, and imports nothing of the editor
 * itself but types, and the report, which imports nothing but types.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
// Item 13's report imports nothing but types, so Node runs it as it is: the same function the
// browser's import reads its report with (decision 0039).
import { reportOfImport } from "../src/import/report.ts";
import type { ImportStep } from "../src/import/run.ts";
import { earlyClock } from "./corpus-early.ts";
import { type ImportChildRow, refusedOutcome } from "./corpus-import.ts";

type NodeEngine = typeof import("../src/engine/node.ts");
type Fonts = typeof import("../src/page/fonts.ts");
type TexLive = typeof import("../src/page/texlive.ts");
type IntakeModule = typeof import("../src/import/intake.ts");
type ImportFonts = typeof import("../src/import/fonts.ts");
type RunModule = typeof import("../src/import/run.ts");

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
  const { treeImages } = await runner.import<IntakeModule>("/src/import/intake.ts");
  const { readTree } = await runner.import<ImportFonts>("/src/import/fonts.ts");
  const { importResume } = await runner.import<RunModule>("/src/import/run.ts");

  const manifest = JSON.parse(
    readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
  ) as EngineManifest;
  const deps = {
    session: await startNodeSession(),
    fonts: new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    ),
    tree: readTree(manifest.files, manifest.fonts),
    treeImage: treeImages(
      manifest.files,
      (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
    ),
    // What the document under way hears of its page and its fields before its checks end.
    onStage: (stage: { phase: "page" | "fields"; ms: number }) => staged?.hear(stage),
  };
  /** When the document under way opened its page and its fields (`corpus-early.ts`). */
  let staged: ReturnType<typeof earlyClock> | undefined;

  process.on("message", async (task: Task) => {
    if (task.type !== "task") return;
    const steps: Partial<Record<ImportStep, number>> = {};
    let step: ImportStep = "intake";
    let mark = performance.now();
    /** Each step's time, from where it began to where the next did, or the import ended. */
    const close = () => {
      const now = performance.now();
      steps[step] = Math.round((steps[step] ?? 0) + now - mark);
      mark = now;
    };
    const onStep = (progress: { step: ImportStep }) => {
      if (progress.step === step) return;
      close();
      step = progress.step;
    };
    const early = earlyClock();
    staged = early;
    const done = (row: ImportChildRow) => send({ type: "done", id: task.id, row: early.into(row) });
    const started = performance.now();
    try {
      const outcome = await importResume(
        [{ name: task.message.name, bytes: new Uint8Array(task.message.bytes) }],
        deps,
        onStep,
      );
      close();
      const ms = Math.round(performance.now() - started);
      if ("refused" in outcome)
        return done({
          outcome: refusedOutcome(step, outcome.reason),
          refused: outcome.reason,
          step,
          times: { steps, import: ms },
        });
      const { report } = outcome;
      const read = reportOfImport(outcome);
      const { outline, checks } = report;
      return done({
        outcome: read.outcome === "succeeded" ? "success" : "partial",
        engine: report.engine,
        ...(checks.difference === undefined ? {} : { difference: checks.difference.kind }),
        rate: Math.round(read.rate * 10_000) / 10_000,
        words: {
          body: read.words.body,
          editable: read.words.editable,
          retype: read.words.retype,
          locked: read.words.locked,
          byReason: read.words.byReason,
        },
        fields: {
          editable: outline.fields,
          required: outline.required,
          kept: outline.kept,
          stops: outline.stops,
          scripts: outline.scripts,
        },
        groups: {
          found: outline.groups,
          units: outline.units,
          fixed: outline.fixed,
          trials: outline.trials,
        },
        ...((checks.latinModern ?? []).length > 0 ? { latinModern: true } : {}),
        compiles: { all: report.compiles, checks: checks.compiles },
        times: { steps, import: Math.round(report.ms) },
      });
    } catch {
      // What went wrong may quote the document, so it goes unsaid.
      return done({ outcome: "crashed", step, times: { steps } });
    }
  });
  send({ type: "ready" });
}

main().catch(() => {
  // The parent counts a child that dies; what killed it may quote a document, so it goes unsaid.
  process.exit(1);
});
