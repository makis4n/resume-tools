/**
 * One child of `corpus run`'s pool (`corpus-import.ts`, the second pass's item 6): an engine
 * session and fonts of its own, which take one document at a time, as a zip, through the import a
 * person's browser runs (`importResume`, decision 0049), as it is, on that session: the intake, the
 * reference compile, the fonts, the signatures, the parse, the probe, the outline and its four
 * checks. It names nothing and sends nothing; it reads the import's report as the app reads it
 * (`reportOfImport`, decision 0039).
 *
 * Beside the report, it hears what the probe found and where the checks are (`ImportObserver`),
 * and times each compile on the session the import is given (`TrialClock`), which change nothing the
 * import does, for the row's diagnostics (`corpus-pieces.ts`): its words not in place by the piece
 * that holds them, named only by names something public defines, and its compiles by kind of trial.
 *
 * It answers with the document's row, ids, names and counts only, and prints nothing: a document's text
 * never reaches a terminal, nor does a compile's log, which may quote it. The editor's modules are
 * written for Vite, so this file, which Node runs as it is, loads them through Vite's module runner
 * with the app's own config, as the corpus's other children do, and imports nothing of the editor
 * itself but types, and the report, which imports nothing but types.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import type { Intake } from "../src/import/intake.ts";
import type { Probe } from "../src/import/probe.ts";
import type { Reference } from "../src/import/reference.ts";
// Item 13's report imports nothing but types, so Node runs it as it is: the same function the
// browser's import reads its report with (decision 0039).
import { reportOfImport } from "../src/import/report.ts";
import type { ImportStep } from "../src/import/run.ts";
import { type ImportChildRow, refusedOutcome } from "./corpus-import.ts";
import {
  addsUp,
  definedNames,
  joinedNames,
  type Names,
  namerOf,
  piecesOf,
  TrialClock,
} from "./corpus-pieces.ts";

type NodeEngine = typeof import("../src/engine/node.ts");
type Fonts = typeof import("../src/page/fonts.ts");
type TexLive = typeof import("../src/page/texlive.ts");
type IntakeModule = typeof import("../src/import/intake.ts");
type ImportFonts = typeof import("../src/import/fonts.ts");
type RunModule = typeof import("../src/import/run.ts");
type StandardModule = typeof import("../src/import/standard.ts");

const APP = fileURLToPath(new URL("..", import.meta.url));

/** The upstream samples, public, whose classes' names count as public (`corpus oracle`). */
const ORACLE = join(APP, ".corpus", "oracle");

/** The names the upstream samples' classes and packages define: public names. */
function publicNames(): Names {
  if (!existsSync(ORACLE)) return { macros: new Set(), environments: new Set() };
  const found: Names[] = [];
  for (const sample of readdirSync(ORACLE, { withFileTypes: true })) {
    if (!sample.isDirectory()) continue;
    for (const file of readdirSync(join(ORACLE, sample.name)))
      if (/\.(?:cls|sty)$/.test(file))
        found.push(definedNames(readFileSync(join(ORACLE, sample.name, file), "latin1")));
  }
  return joinedNames(found);
}

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
  const { STANDARD, STANDARD_ENVIRONMENTS } =
    await runner.import<StandardModule>("/src/import/standard.ts");

  const manifest = JSON.parse(
    readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
  ) as EngineManifest;
  const shared = publicNames();
  /** What each file of the tree defines, read once (`definedNames`). */
  const treeNames = new Map<string, Names>();
  const definedIn = (path: string): Names => {
    let names = treeNames.get(path);
    if (names === undefined) {
      names = definedNames(readFileSync(join(ENGINE_DIR, "files", path), "latin1"));
      treeNames.set(path, names);
    }
    return names;
  };
  /** How a document's pieces are named, by what it defines and what is public (`namerOf`). */
  const namer = (intake: Intake, made: Reference, probe: Probe) =>
    namerOf({
      intake,
      log: made.log,
      signatures: probe.signatures,
      standard: { macros: STANDARD, environments: STANDARD_ENVIRONMENTS },
      inTree: (path) => path in manifest.files,
      treeNames: definedIn,
      shared,
    });
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
  };

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
    // Each compile timed and set down to its kind of trial, and what the probe found, heard as the
    // import runs; neither changes what it does.
    const clock = new TrialClock();
    let probed: { intake: Intake; reference: Reference; probe: Probe } | undefined;
    const observe = {
      probed: (found: { intake: Intake; reference: Reference; probe: Probe }) => {
        probed = found;
      },
      checks: clock.onCheck,
    };
    const onStep = (progress: { step: ImportStep }) => {
      clock.enter(progress.step);
      if (progress.step === step) return;
      close();
      step = progress.step;
    };
    const done = (row: ImportChildRow) => send({ type: "done", id: task.id, row });
    const started = performance.now();
    try {
      const outcome = await importResume(
        [{ name: task.message.name, bytes: new Uint8Array(task.message.bytes) }],
        { ...deps, session: clock.timed(deps.session), observe },
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
      const trials = clock.result(probed?.probe.compiles ?? 0);
      const probeLeft = (probed?.probe.candidates ?? []).filter(
        (each) => each.settled === "budget",
      ).length;
      // The words not in place by piece, kept only where they add up to the report's own.
      let pieces: ReturnType<typeof piecesOf>["pieces"] | undefined;
      try {
        if (probed !== undefined) {
          const found = piecesOf({
            imported: outcome,
            runs: probed.probe.runs ?? [],
            candidates: probed.probe.candidates,
            name: namer(probed.intake, probed.reference, probed.probe),
          });
          if (addsUp(found.pieces, read.words)) pieces = found.pieces;
        }
      } catch {
        // What went wrong may quote the document, so it goes unsaid, and the row has no pieces.
      }
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
        ...(pieces === undefined ? {} : { pieces }),
        compiles: {
          all: report.compiles,
          checks: checks.compiles,
          trials: trials.compiles,
          dumps: trials.dumps.n,
          ...(trials.pdfs.n === 0 ? {} : { pdfs: trials.pdfs.n }),
        },
        budgets: { probe: { hits: probeLeft > 0 ? 1 : 0, fields: probeLeft }, ...trials.budgets },
        times: {
          steps,
          import: Math.round(report.ms),
          trials: trials.ms,
          dumps: trials.dumps.ms,
          ...(trials.pdfs.n === 0 ? {} : { pdfs: trials.pdfs.ms }),
        },
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
