/**
 * One child of `corpus assemble`'s pool (`corpus-assemble.ts`, decision 0026), which `corpus
 * oracle` runs too: an engine session and fonts of its own, which take one document at a time, as a
 * zip, through the intake, the reference compile, the signatures' two compiles, asked of the body's
 * commands, the preamble's and the sizes the class may declare (`SIZE_OPTIONS`, decision 0026),
 * the parse, the probe and the naming request, built as items 7 and 11
 * build it, with the upload's sources and the header's values (decision 0024); find the answers the
 * committed folder holds for its macros' keys, each as the document's macro (`answerFor`); and,
 * where it holds any, rewrite a XeTeX document's fonts by file and check the rewrite (decision
 * 0023), and assemble the document's package and document and validate them. It answers with the
 * document's row, names and numbers only; the probe's row and the whole probe, for the oracle; the
 * fields found by the model's place, for the oracle's comparison with the ports; and the whole
 * assembly, which holds the document's text, as the whole probe does, and which the parent keeps
 * under `.corpus/` alone.
 *
 * The editor's modules are written for Vite, so this file, which Node runs as it is, loads them
 * through Vite's module runner with the app's own config, as `corpus-probe-child.ts` does, and
 * imports nothing of the editor itself but types. It prints nothing: a document's text never
 * reaches a terminal.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NAMING_VERSION } from "@resume-tools/naming";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import { type AssembleChildRow, answersFor, assembleRow, fieldsFound } from "./corpus-assemble.ts";
import { probeRow } from "./corpus-probe.ts";
import { answersFolder, commandAnswers, headerOf } from "./corpus-seed.ts";

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
type XetexModule = typeof import("../src/import/xetex.ts");
type CheckModule = typeof import("../src/import/xetex-check.ts");
type ValidateModule = typeof import("../src/import/validate.ts");
type AssembleModule = typeof import("../src/import/assemble.ts");
type Refused = import("../src/import/refusal.ts").Refusal;

/** The format item 8's check of a XeTeX rewrite dumps, which the child drops after it. */
const CHECK_FORMAT = "importfonts";

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
  const { buildRequest, sourcesOf } = await runner.import<NamingModule>("/src/import/naming.ts");
  const { rewriteForXetex } = await runner.import<XetexModule>("/src/import/xetex.ts");
  const { checkRewrite } = await runner.import<CheckModule>("/src/import/xetex-check.ts");
  const { validate } = await runner.import<ValidateModule>("/src/import/validate.ts");
  const { SIZE_OPTIONS } = await runner.import<AssembleModule>("/src/import/assemble.ts");

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
  const folder = answersFolder();
  const cache = { get: (key: string) => folder.read(key) };

  process.on("message", async (task: Task) => {
    if (task.type !== "task") return;
    const done = (row: AssembleChildRow, more: Record<string, unknown> = {}) =>
      send({ type: "done", id: task.id, row, ...more });
    /** A refusal's row: its reason, and for a font the page cannot draw, its name. */
    const refusedRow = (refused: Refused, engine: "pdftex" | "xetex", more: object = {}) => ({
      outcome: "refused" as const,
      engine,
      refused: refused.reason,
      ...(refused.reason === "font" && refused.name !== undefined ? { font: refused.name } : {}),
      ...more,
    });
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
    // Asked of the sizes the class may declare too, which the font size control offers alone
    // (decision 0026).
    const found = await signatures(
      session,
      taken,
      made,
      body,
      { ...uses, commands: [...uses.commands, ...SIZE_OPTIONS] },
      { treeImage },
    );
    if ("refused" in found) return done({ outcome: "not parsed", engine });
    const built = buildTree(read, found);
    if ("refused" in built) return done({ outcome: "not parsed", engine });
    try {
      const probed = await probe(session, fonts, taken, made, built, found, { treeImage });
      // The probe leaves a pdfTeX document's format in the session for item 7, whose package has
      // a format of its own, its preamble rewritten: the probe's goes now, as the probe's runner
      // drops it.
      if (probed.format !== undefined) session.dropFormat("pdftex", probed.format);
      // The probe's row, and for the oracle the whole probe, which holds the document's text.
      const probedRow = { probe: probeRow(probed), probeDetail: probed };
      if (probed.baseline !== undefined) return done({ outcome: "baseline", engine }, probedRow);
      // The request as items 7 and 11 build it: with the upload's sources, so that the macros it
      // defines are its own, and the header's values, found by the answers the request without them
      // finds (decision 0024).
      const options = { sources: sourcesOf(taken) };
      const plain = await buildRequest(built, found, probed, body.preamble, options);
      const header = headerOf(probed.candidates, commandAnswers(plain, folder.read));
      const request = await buildRequest(built, found, probed, body.preamble, {
        ...options,
        header,
      });
      const answers = await answersFor(request.macros, cache);
      const counted = {
        answered: answers.answered,
        unanswered: answers.unanswered,
        ...(answers.refused === 0 ? {} : { answersRefused: answers.refused }),
      };
      if (answers.found.length === 0)
        return done({ outcome: "no answer", engine, ...counted, answered: 0 }, probedRow);
      // A XeTeX document's fonts declared by file, and the rewrite checked against the reference,
      // which refuses what it cannot reproduce (decision 0023), so that its package's format dumps.
      let rewrite: ReturnType<XetexModule["rewriteForXetex"]> | undefined;
      if (engine === "xetex") {
        rewrite = rewriteForXetex(taken, tree);
        if ("refused" in rewrite) return done(refusedRow(rewrite, engine, counted), probedRow);
        const checked = await checkRewrite(session, fonts, taken, made, rewrite, {
          treeImage,
          format: CHECK_FORMAT,
        });
        session.dropFormat("xetex", CHECK_FORMAT);
        if ("refused" in checked) return done(refusedRow(checked, engine, counted), probedRow);
      }
      const validated = await validate({
        session,
        fonts,
        intake: taken,
        reference: made,
        tree: built,
        signatures: found,
        probe: probed,
        answer: { version: NAMING_VERSION, macros: answers.found, preamble: { parameters: [] } },
        ...(rewrite === undefined || "refused" in rewrite ? {} : { rewrite }),
        treeImage,
      });
      if ("refused" in validated) return done(refusedRow(validated, engine, counted), probedRow);
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
