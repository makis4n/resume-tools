/**
 * One child of `corpus parse`'s pool (`corpus-parse.ts`, decision 0020): an engine session and
 * fonts of its own, which take one document at a time, as a zip, through the intake, the reference
 * compile, the signatures' two compiles, the parse and the print, and compile the printed body as
 * the reference was compiled; and answer with the document's row, names of macros and numbers
 * only, and, for a round trip that did not set the reference's glyphs, the printed document and
 * its log, which the parent keeps under `.corpus/` alone.
 *
 * The editor's modules are written for Vite, so this file, which Node runs as it is, loads them
 * through Vite's module runner with the app's own config, as `corpus-reference-child.ts` does, and
 * imports nothing of the editor itself but types. It prints nothing: a document's text never
 * reaches a terminal.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import type { Refusal } from "../src/import/refusal.ts";
import { charactersOf, datesOf, type ParseChildRow, signatureCounts } from "./corpus-parse.ts";

type NodeEngine = typeof import("../src/engine/node.ts");
type Fonts = typeof import("../src/page/fonts.ts");
type TexLive = typeof import("../src/page/texlive.ts");
type IntakeModule = typeof import("../src/import/intake.ts");
type ReferenceModule = typeof import("../src/import/reference.ts");
type ImportFonts = typeof import("../src/import/fonts.ts");
type ParseModule = typeof import("../src/import/parse.ts");
type PrintModule = typeof import("../src/import/print.ts");
type SignaturesModule = typeof import("../src/import/signatures.ts");

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
  const { encodeLike, intake, treeImages } =
    await runner.import<IntakeModule>("/src/import/intake.ts");
  const { compileLikeReference, difference, reference } = await runner.import<ReferenceModule>(
    "/src/import/reference.ts",
  );
  const { readTree } = await runner.import<ImportFonts>("/src/import/fonts.ts");
  const { bodyOf, buildTree, PARSE_REFUSALS, readBody, usesOf } =
    await runner.import<ParseModule>("/src/import/parse.ts");
  const { print } = await runner.import<PrintModule>("/src/import/print.ts");
  const { signatures } = await runner.import<SignaturesModule>("/src/import/signatures.ts");

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
  /** Which of the parser's rules a refusal is for, by its message. */
  const ruleOf = (refused: Refusal) =>
    Object.entries(PARSE_REFUSALS).find(([, message]) => message === refused.message)?.[0] ??
    "other";

  process.on("message", async (task: Task) => {
    if (task.type !== "task") return;
    const done = (row: ParseChildRow, kept?: { document?: string; log?: string }) =>
      send({ type: "done", id: task.id, row, ...kept });
    const taken = intake(
      { name: task.message.name, bytes: new Uint8Array(task.message.bytes) },
      { tree, treeImage },
    );
    if ("refused" in taken) return done({ outcome: "no reference" });
    const made = await reference(session, fonts, taken, { treeImage });
    if ("refused" in made) return done({ outcome: "no reference" });
    const engine = made.engine;
    const body = bodyOf(taken);
    if ("refused" in body) return done({ outcome: "refused", refused: ruleOf(body), engine });
    let started = performance.now();
    const read = readBody(body);
    if ("refused" in read) return done({ outcome: "refused", refused: ruleOf(read), engine });
    const uses = usesOf(read);
    let parseMs = performance.now() - started;
    started = performance.now();
    const found = await signatures(session, taken, made, body, uses, { treeImage });
    const signaturesMs = Math.round(performance.now() - started);
    if ("refused" in found)
      return done({ outcome: "signatures", engine, signaturesMs }, { log: found.log });
    started = performance.now();
    const built = buildTree(read, found);
    parseMs += performance.now() - started;
    const counts = signatureCounts(found);
    if ("refused" in built)
      return done({ outcome: "refused", refused: ruleOf(built), engine, ...counts, signaturesMs });
    const printed = print(built);
    const document = body.before + printed + body.after;
    const main = encodeLike(taken.main.bytes, document) ?? new TextEncoder().encode(document);
    const again = await compileLikeReference(session, fonts, taken, made, main, { treeImage });
    const differs = "refused" in again ? undefined : difference(made, again.stream);
    const row: ParseChildRow = {
      outcome: "parsed",
      engine,
      printed: printed === body.text,
      roundTrip: "refused" in again ? "stopped" : differs === undefined ? "same" : "differs",
      ...(differs === undefined ? {} : { difference: differs.kind }),
      ...counts,
      chars: charactersOf(built),
      dates: datesOf(built),
      nodes: built.nodes,
      levels: built.levels,
      parseMs: Math.round(parseMs),
      signaturesMs,
    };
    done(row, row.roundTrip === "same" ? undefined : { document, log: again.log });
  });
  send({ type: "ready" });
}

main().catch(() => {
  // The parent counts a child that dies; what killed it may quote a document, so it goes unsaid.
  process.exit(1);
});
