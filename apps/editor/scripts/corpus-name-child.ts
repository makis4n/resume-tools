/**
 * One child of `corpus name`'s pool (`corpus-name.ts`, decision 0027): an engine session and fonts
 * of its own, which take one document at a time, as a zip, through the intake, the reference
 * compile, the signatures' two compiles, asked of the body's commands and the preamble's, the parse,
 * the probe and the naming request, with the upload's sources, as `corpus seed`'s child does, but
 * without the header's values, which item 7 finds; then answer the request macro by macro from the
 * cache over `corpus/answers/` and the model's own folder of `.corpus/cache/`, and, when the parent
 * asks with a model's id, from that model, behind the privacy gate (`answerDocument`), each part of
 * the request within a limit of its own. It answers with the document's row, names of macros and
 * numbers only.
 *
 * The key and the model's id come from this process's environment, which the parent's is; the
 * parent checked them before it asked. The editor's modules are written for Vite, so this file,
 * which Node runs as it is, loads them through Vite's module runner with the app's own config, as
 * `corpus-seed-child.ts` does, and imports nothing of the editor itself but types. It prints
 * nothing: a document's text never reaches a terminal.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { googleModel } from "@resume-tools/naming/providers";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import type { DocumentText } from "../src/import/naming.ts";
import { FileAnswerCache } from "./answer-cache.ts";
import {
  answerDocument,
  MODEL_LIMIT_MS,
  MODEL_RETRIES,
  type NameChildRow,
  namingConfig,
  pageWords,
} from "./corpus-name.ts";

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

const APP = fileURLToPath(new URL("..", import.meta.url));

/** A document, as the parent sends it: its zip, the zip's name, and the model to ask, if any. */
interface Task {
  type: "task";
  id: string;
  message: { name: string; bytes: Uint8Array; model?: string };
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
  const { assertNoText, buildRequest, sourcesOf } =
    await runner.import<NamingModule>("/src/import/naming.ts");

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
  const { key, id: model } = namingConfig(process.env);
  const cache = new FileAnswerCache({ model });

  process.on("message", async (task: Task) => {
    if (task.type !== "task") return;
    const done = (row: NameChildRow) => send({ type: "done", id: task.id, row });
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
      // The probe leaves a pdfTeX document's format in the session for item 7, whose checks hook
      // in below; until they do, it goes now, as the probe runner's child drops it.
      if (probed.format !== undefined) session.dropFormat("pdftex", probed.format);
      // The upload's sources say which definitions are the document's own, which alone its text
      // masks, as the seed's child builds a sample's request (decision 0024).
      const sources = sourcesOf(taken);
      const request = await buildRequest(built, found, probed, body.preamble, { sources });
      // The document's text as the request was masked by: the body's tree, the texts the preamble
      // stores, and the sources; item 7 finds the header's values, which join it when it lands.
      // The gate is stricter than the masking, so it refuses a request whose own definition holds
      // a word of the document's that the builder leaves, and passes a text that only a definition
      // holds, as a name a preamble's own macro spells out (decision 0027). `page` is the
      // reference page's words, the text the person sees, which `assertNoText` does not read yet:
      // item 11 makes them its needles for the document's own definitions.
      const document: DocumentText & { page: readonly string[] } = {
        tree: built,
        stored: probed.candidates
          .filter((each) => each.where === "preamble")
          .map((each) => each.text),
        sources,
        page: pageWords(made),
      };
      const id = task.message.model;
      const answered = await answerDocument(request, {
        cache,
        gate: () => assertNoText(request, document),
        ...(id === undefined || key === undefined
          ? {}
          : { model: { model: googleModel(key, id), id } }),
        maxRetries: MODEL_RETRIES,
        partTimeoutMs: MODEL_LIMIT_MS,
      });
      // Item 7's validation hooks in here: once every macro has an answer, assemble the document's
      // package from the stored answers and the preamble's, run plan section 6's four checks on
      // this session, and say in the row whether its import validates (decision 0027).
      done({ outcome: "requested", engine, ...answered });
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
