/**
 * One child of `corpus seed`'s pool (`corpus-seed.ts`, decision 0024): an engine session and fonts
 * of its own, which take one oracle sample at a time, as a zip, through the intake, the reference
 * compile, the signatures' two compiles, asked of the body's commands, the preamble's and the
 * seed's extras for its family, the parse, the probe and the naming request; and answer with the
 * request's macros, their hashes, keys and verdicts, names and numbers only. Where the answers
 * under `corpus/answers/` for its macros carry redefinitions, it compiles the body, with the calls
 * to the macros they serve regenerated as item 7 writes them, with them and without them, and the
 * sample as it is with them, and says whether
 * each sets the glyphs of the other, and gives back the log of each of those compiles that stopped,
 * which quotes the sample, for the parent to keep under `.corpus/`.
 *
 * The editor's modules are written for Vite, so this file, which Node runs as it is, loads them
 * through Vite's module runner with the app's own config, as `corpus-probe-child.ts` does, and
 * imports nothing of the editor itself but types. It prints nothing: a sample's text never reaches
 * a terminal.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import type { Family } from "./corpus-manifest.ts";
import {
  answersFolder,
  redefinitionsOf,
  SEED_EXTRAS,
  type SeedChildRow,
  type SeedRedefinitions,
  seedMacros,
} from "./corpus-seed.ts";

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
type PrintModule = typeof import("../src/import/print.ts");
type Node = import("../src/import/parse.ts").Node;

const APP = fileURLToPath(new URL("..", import.meta.url));

/** A sample, as the parent sends it: its zip, the zip's name, and its family. */
interface Task {
  type: "task";
  id: string;
  message: { name: string; bytes: Uint8Array; family: Family };
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
  const { bodyOf, bodyOfText, buildTree, readBody } =
    await runner.import<ParseModule>("/src/import/parse.ts");
  const { keysOf, signatures } = await runner.import<SignaturesModule>("/src/import/signatures.ts");
  const { probe, probeUses } = await runner.import<ProbeModule>("/src/import/probe.ts");
  const { buildRequest, withRedefinitions } =
    await runner.import<NamingModule>("/src/import/naming.ts");
  const { regenerate } = await runner.import<PrintModule>("/src/import/print.ts");

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
    const logs: Record<string, string> = {};
    const done = (row: SeedChildRow) => send({ type: "done", id: task.id, row, logs });
    const extras = SEED_EXTRAS[task.message.family];
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
    const asked = {
      commands: [...new Set([...uses.commands, ...(extras?.commands ?? [])])].sort(),
      environments: [...new Set([...uses.environments, ...(extras?.environments ?? [])])].sort(),
    };
    const found = await signatures(session, taken, made, body, asked, { treeImage });
    if ("refused" in found) return done({ outcome: "not parsed", engine });
    const built = buildTree(read, found);
    if ("refused" in built) return done({ outcome: "not parsed", engine });
    try {
      const probed = await probe(session, fonts, taken, made, built, found, { treeImage });
      const request = await buildRequest(built, found, probed, body.preamble, {
        ...(extras === undefined ? {} : { also: extras }),
      });
      const { redefinitions, serving } = redefinitionsOf(request.macros, answersFolder().read);
      let redefined: SeedRedefinitions | undefined;
      if (redefinitions.length > 0) {
        const compile = async (which: string, text: string | undefined) => {
          if (text === undefined) return undefined;
          const bytes = encodeLike(taken.main.bytes, text) ?? new TextEncoder().encode(text);
          const compiled = await compileLikeReference(session, fonts, taken, made, bytes, {
            treeImage,
          });
          if (!("refused" in compiled)) return compiled.stream;
          logs[which] = compiled.log ?? compiled.message;
          return undefined;
        };
        // The calls and environments the redefinitions serve, outermost, regenerated; the rest of
        // the body as it is, since what the generator cannot write back yet, a wheel chart's data
        // among it, is no redefinition's to answer for (decision 0020).
        const served: Node[] = [];
        const walk = (nodes: readonly Node[]) => {
          for (const node of nodes) {
            const id =
              node.kind === "call"
                ? `command|${node.name}`
                : node.kind === "environment"
                  ? `environment|${node.name}`
                  : "";
            if (serving.has(id)) {
              served.push(node);
              continue;
            }
            if ("args" in node)
              for (const arg of node.args ?? []) if (arg.content !== undefined) walk(arg.content);
            if ("content" in node) walk(node.content);
          }
        };
        walk(built.content);
        const plain = `${body.before}${regenerate({ ...built, content: served }, engine)}${body.after}`;
        const without = await compile("regenerated", plain);
        /** What some of the redefinitions do: to the regenerated body, and to the sample as it is. */
        const effect = async (some: typeof redefinitions, which: string) => {
          const withThem = await compile(`${which}-regenerated`, withRedefinitions(plain, some));
          const raw = await compile(`${which}-raw`, withRedefinitions(taken.main.text, some));
          return {
            regenerated:
              without === undefined
                ? "not regenerated"
                : withThem === undefined
                  ? "stopped"
                  : (difference(without, withThem)?.kind ?? "keeps"),
            raw: raw === undefined ? "stopped" : (difference(made, raw)?.kind ?? "keeps"),
          };
        };
        const all = await effect(redefinitions, "all");
        // When the set moves or stops a page, each alone says which does.
        const each =
          all.regenerated === "keeps" && all.raw === "keeps"
            ? []
            : await Promise.all(
                redefinitions.map(async (one) => ({
                  name: one.name,
                  ...(await effect([one], one.name.replace(/[^A-Za-z]/g, ""))),
                })),
              );
        redefined = {
          names: redefinitions.map((one) => one.name),
          ...all,
          ...(each.length === 0 ? {} : { each }),
        };
        session.forget("import");
      }
      done({
        outcome: "requested",
        engine,
        macros: seedMacros(request, await keysOf(found), extras),
        ...(redefined === undefined ? {} : { redefinitions: redefined }),
      });
    } catch {
      // What went wrong may quote the sample, so it goes unsaid.
      session.forget("import");
      done({ outcome: "crashed", engine });
    }
  });
  send({ type: "ready" });
}

main().catch(() => {
  // The parent counts a child that dies; what killed it may quote a sample, so it goes unsaid.
  process.exit(1);
});
