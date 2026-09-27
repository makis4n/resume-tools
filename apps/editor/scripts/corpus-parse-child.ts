/**
 * One child of `corpus parse`'s pool (`corpus-parse.ts`, decision 0020): an engine session and
 * fonts of its own, which take one document at a time, as a zip, through the intake, the reference
 * compile, the signatures' two compiles, the parse and the print, and compile the printed body as
 * the reference was compiled, twice, printed byte for byte and regenerated (`regenerate`); and
 * answer with the document's row, names of macros, hashes and numbers only, and, for a round trip
 * that did not set the reference's glyphs, the printed document and its log, which the parent
 * keeps under `.corpus/` alone: the byte-for-byte one's, or the regenerated one's when only it
 * differs.
 *
 * The editor's modules are written for Vite, so this file, which Node runs as it is, loads them
 * through Vite's module runner with the app's own config, as `corpus-reference-child.ts` does, and
 * imports nothing of the editor itself but types. It prints nothing: a document's text never
 * reaches a terminal.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import type { Intake } from "../src/import/intake.ts";
import type { Refusal } from "../src/import/refusal.ts";
import type { EngineSignatures } from "../src/import/signatures.ts";
import {
  calledNames,
  charactersOf,
  datesOf,
  definedNames,
  documentClassOf,
  fileMacros,
  type HeldFile,
  movedByPreamble,
  type ParseChildRow,
  settingOf,
  signatureCounts,
  suspectsOf,
} from "./corpus-parse.ts";

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

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/**
 * The class and style files a document's job holds, and the class it loads from the tree when the
 * job holds none of that name (`treeClass`), each by the SHA-256 of its bytes and of the setting
 * the document gives it (`settingOf`), with the keys of the macros it defines that the body calls
 * and the preamble does not define again (`fileMacros`), and those of them whose key the preamble
 * moves (`movedByPreamble`); a file none of whose macros the body calls is left out, since it can
 * say nothing of the keys.
 */
function heldFiles(
  taken: Intake,
  preamble: string,
  engine: string,
  found: EngineSignatures,
  keys: Readonly<Record<string, string>>,
  treeClass: (name: string) => [path: string, bytes: Uint8Array] | undefined,
): HeldFile[] {
  const files = Object.entries(taken.files).filter(([path]) => /\.(?:cls|sty)$/i.test(path));
  const loaded = documentClassOf(preamble);
  const fileName = (path: string) => path.replace(/^.*\//, "");
  if (loaded !== undefined && !files.some(([path]) => fileName(path) === `${loaded}.cls`)) {
    const fromTree = treeClass(`${loaded}.cls`);
    if (fromTree !== undefined) files.push(fromTree);
  }
  const called = calledNames(found);
  const redefined = definedNames(preamble);
  return files.flatMap(([path, bytes]) => {
    const macros = fileMacros(
      keys,
      definedNames(new TextDecoder().decode(bytes)),
      called,
      redefined,
    );
    if (Object.keys(macros).length === 0) return [];
    const moved = movedByPreamble(found, Object.keys(macros), redefined);
    return [
      {
        hash: sha256(bytes),
        setting: sha256(settingOf(preamble, path, engine)),
        macros,
        ...(moved.length === 0 ? {} : { moved }),
      },
    ];
  });
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
  const { print, regenerate } = await runner.import<PrintModule>("/src/import/print.ts");
  const { keysOf, signatures } = await runner.import<SignaturesModule>("/src/import/signatures.ts");

  const manifest = JSON.parse(
    readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
  ) as EngineManifest;
  const tree = readTree(manifest.files);
  /** The tree's classes by their file's name, the first of a name, as `readTree` finds them. */
  const treeClasses = new Map<string, string>();
  for (const path of Object.keys(manifest.files)) {
    const found = /\/tex\/[^/]+\/[^/]+\/(?:.*\/)?([^/]+\.cls)$/.exec(path);
    if (found?.[1] !== undefined && !treeClasses.has(found[1])) treeClasses.set(found[1], path);
  }
  const treeClass = (name: string): [string, Uint8Array] | undefined => {
    const path = treeClasses.get(name);
    return path === undefined
      ? undefined
      : [path, new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path)))];
  };
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
    /** The body compiled as the reference was, with the document's preamble and its end. */
    const compiled = async (printed: string) => {
      const document = body.before + printed + body.after;
      const main = encodeLike(taken.main.bytes, document) ?? new TextEncoder().encode(document);
      const result = await compileLikeReference(session, fonts, taken, made, main, { treeImage });
      const differs = "refused" in result ? undefined : difference(made, result.stream);
      const trip: ParseChildRow["roundTrip"] =
        "refused" in result ? "stopped" : differs === undefined ? "same" : "differs";
      return { document, log: result.log, trip, differs };
    };
    const printed = print(built);
    const byte = await compiled(printed);
    const regenerated = await compiled(regenerate(built, engine));
    const row: ParseChildRow = {
      outcome: "parsed",
      engine,
      printed: printed === body.text,
      roundTrip: byte.trip,
      ...(byte.differs === undefined ? {} : { difference: byte.differs.kind }),
      regenerated: regenerated.trip,
      ...(regenerated.differs === undefined
        ? {}
        : { regeneratedDifference: regenerated.differs.kind }),
      suspects: suspectsOf(built),
      files: heldFiles(taken, body.preamble, engine, found, await keysOf(found), treeClass),
      ...counts,
      chars: charactersOf(built),
      dates: datesOf(built),
      nodes: built.nodes,
      levels: built.levels,
      parseMs: Math.round(parseMs),
      signaturesMs,
      signaturesPassesMs: Math.round(found.ms),
    };
    const kept =
      byte.trip !== "same" ? byte : regenerated.trip !== "same" ? regenerated : undefined;
    done(row, kept === undefined ? undefined : { document: kept.document, log: kept.log });
  });
  send({ type: "ready" });
}

main().catch(() => {
  // The parent counts a child that dies; what killed it may quote a document, so it goes unsaid.
  process.exit(1);
});
