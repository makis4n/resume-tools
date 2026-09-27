/**
 * One child of `corpus assemble`'s pool (`corpus-assemble.ts`, decision 0026), which `corpus
 * oracle` runs too: an engine session and fonts of its own, which take one document at a time, as a
 * zip, through the intake, the reference compile, the signatures' two compiles, asked of the body's
 * commands and the preamble's, the parse, the probe and the naming request; find the answers the
 * committed folder holds for its macros' keys; and, where it holds any, assemble the document's
 * package and document and validate them. It answers with the document's row, names and numbers
 * only; the probe's row and the whole probe, for the oracle; the fields found by the model's place,
 * for the oracle's comparison with the ports; and the whole assembly, which holds the document's
 * text, as the whole probe does, and which the parent keeps under `.corpus/` alone.
 *
 * The editor's modules are written for Vite, so this file, which Node runs as it is, loads them
 * through Vite's module runner with the app's own config, as `corpus-probe-child.ts` does, and
 * imports nothing of the editor itself but types. It prints nothing: a document's text never
 * reaches a terminal.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NAMING_VERSION, StoredAnswer } from "@resume-tools/naming";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import { type AssembleChildRow, answersFor, assembleRow, fieldsFound } from "./corpus-assemble.ts";
import { probeRow } from "./corpus-probe.ts";
import { answersFolder } from "./corpus-seed.ts";

type NodeEngine = typeof import("../src/engine/node.ts");
type Fonts = typeof import("../src/page/fonts.ts");
type TexLive = typeof import("../src/page/texlive.ts");
type IntakeModule = typeof import("../src/import/intake.ts");
type ReferenceModule = typeof import("../src/import/reference.ts");
type ImportFonts = typeof import("../src/import/fonts.ts");
type ParseModule = typeof import("../src/import/parse.ts");
type SignaturesModule = typeof import("../src/import/signatures.ts");
type ProbeModule = typeof import("../src/import/probe.ts");
type NamingModule = typeof import("../src/import/naming.ts");
type ValidateModule = typeof import("../src/import/validate.ts");

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
  const { bodyOf, bodyOfText, buildTree, readBody } =
    await runner.import<ParseModule>("/src/import/parse.ts");
  const { signatures } = await runner.import<SignaturesModule>("/src/import/signatures.ts");
  const { probe, probeUses } = await runner.import<ProbeModule>("/src/import/probe.ts");
  const { buildRequest } = await runner.import<NamingModule>("/src/import/naming.ts");
  const { validate } = await runner.import<ValidateModule>("/src/import/validate.ts");

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
  const folder = answersFolder();
  const parseStored = (text: string) => {
    try {
      const parsed = StoredAnswer.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  };

  process.on("message", async (task: Task) => {
    if (task.type !== "task") return;
    const done = (row: AssembleChildRow, more: Record<string, unknown> = {}) =>
      send({ type: "done", id: task.id, row, ...more });
    const taken = intake(
      { name: task.message.name, bytes: new Uint8Array(task.message.bytes) },
      { tree, treeImage },
    );
    if ("refused" in taken) return done({ outcome: "no reference" });
    const made = await reference(session, fonts, taken, { treeImage });
    if ("refused" in made) return done({ outcome: "no reference" });
    const engine = made.engine;
    const body = bodyOf(taken);
    if ("refused" in body) return done({ outcome: "not parsed", engine });
    const read = readBody(body);
    if ("refused" in read) return done({ outcome: "not parsed", engine });
    const preamble = readBody(bodyOfText(body.preamble));
    const uses = probeUses(read, "refused" in preamble ? undefined : preamble);
    const found = await signatures(session, taken, made, body, uses, { treeImage });
    if ("refused" in found) return done({ outcome: "not parsed", engine });
    const built = buildTree(read, found);
    if ("refused" in built) return done({ outcome: "not parsed", engine });
    try {
      const probed = await probe(session, fonts, taken, made, built, found, { treeImage });
      // The probe's row, and for the oracle the whole probe, which holds the document's text.
      const probedRow = { probe: probeRow(probed), probeDetail: probed };
      if (probed.baseline !== undefined) return done({ outcome: "baseline", engine }, probedRow);
      const request = await buildRequest(built, found, probed, body.preamble);
      const answers = answersFor(request.macros, folder.read, parseStored);
      if (answers.found.length === 0)
        return done(
          { outcome: "no answer", engine, answered: 0, unanswered: answers.unanswered },
          probedRow,
        );
      const validated = await validate({
        session,
        fonts,
        intake: taken,
        reference: made,
        tree: built,
        signatures: found,
        probe: probed,
        answer: { version: NAMING_VERSION, macros: answers.found, preamble: { parameters: [] } },
        treeImage,
      });
      const counted = { answered: answers.answered, unanswered: answers.unanswered };
      if ("refused" in validated)
        return done(
          {
            outcome: "refused",
            engine,
            refused: validated.reason,
            ...(validated.reason === "font" && validated.name !== undefined
              ? { font: validated.name }
              : {}),
            ...counted,
          },
          probedRow,
        );
      done(
        {
          ...assembleRow(validated.checks, engine, counted),
          probeMs: Math.round(probed.ms),
        },
        {
          ...probedRow,
          fields: fieldsFound(validated.document.resume, validated.checks.all),
          detail: validated,
        },
      );
    } catch {
      // What went wrong may quote the document, so it goes unsaid.
      session.forget("import");
      done({ outcome: "crashed", engine });
    }
  });
  send({ type: "ready" });
}

main().catch(() => {
  // The parent counts a child that dies; what killed it may quote a document, so it goes unsaid.
  process.exit(1);
});
