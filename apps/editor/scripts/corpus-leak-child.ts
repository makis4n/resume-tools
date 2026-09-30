/**
 * One child of `corpus leak`'s pool (`corpus-leak.ts`, decision 0033): an engine session and fonts
 * of its own, which take one document at a time, as a zip, through the intake, the reference
 * compile, the signatures' two compiles, asked of the body's commands and the preamble's, the parse
 * and the candidates the probe would find, and build its naming request as the import will: with
 * the upload's sources, the page's strings its reference sets, read with the upload's fonts, the
 * texts its preamble stores and the header's values the finder gives by the seed's answers
 * (`headerOf`). It checks the request with the detector, fed all of those (`findLeaks`), and
 * answers with the document's row: counts, and for each leak the kind of place, the macro's name
 * when it is plainly one, and the kind of text, never the text. A page the detector cannot read
 * refuses the request, as the import refuses it, and a request the builder made that its contract
 * refuses is invalid, each counted so.
 *
 * The probe's compiles are left out, as the seed's check of its samples leaves them: what the probe
 * decides of an argument goes in the request as a verdict from a closed list, and the texts the
 * preamble stores are its candidates, which `candidatesOf` finds as the probe does.
 *
 * The editor's modules are written for Vite, so this file, which Node runs as it is, loads them
 * through Vite's module runner with the app's own config, as `corpus-seed-child.ts` does, and
 * imports nothing of the editor itself but types. It prints nothing: a document's text never
 * reaches a terminal.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import type { PageStrings } from "../src/import/naming.ts";
import type { ProbeCandidate } from "../src/import/probe.ts";
import { type LeakChildRow, leakCounts, leakFindings } from "./corpus-leak.ts";
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
type CandidatesModule = typeof import("../src/import/candidates.ts");
type NamingModule = typeof import("../src/import/naming.ts");

const APP = fileURLToPath(new URL("..", import.meta.url));

/**
 * A document, as the parent sends it: its zip and the zip's name, and whether to send its page's
 * strings back beside its row, which a test of the parent's keeps in memory alone.
 */
interface Task {
  type: "task";
  id: string;
  message: { name: string; bytes: Uint8Array; pages?: boolean };
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
  const { probeUses } = await runner.import<ProbeModule>("/src/import/probe.ts");
  const { candidatesOf, isSetter } = await runner.import<CandidatesModule>(
    "/src/import/candidates.ts",
  );
  const {
    buildRequest,
    findLeaks,
    InvalidRequest,
    isOwn,
    ownNames,
    pageStrings,
    realName,
    sourcesOf,
  } = await runner.import<NamingModule>("/src/import/naming.ts");

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
  const answers = answersFolder().read;

  process.on("message", async (task: Task) => {
    if (task.type !== "task") return;
    let page: PageStrings | undefined;
    const done = (row: LeakChildRow) =>
      send({
        type: "done",
        id: task.id,
        row,
        ...(task.message.pages === true && page !== undefined ? { page } : {}),
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
    const head = readBody(bodyOfText(body.preamble));
    const uses = probeUses(read, "refused" in head ? undefined : head);
    const found = await signatures(session, taken, made, body, uses, { treeImage });
    if ("refused" in found) return done({ outcome: "not parsed", engine });
    const built = buildTree(read, found);
    if ("refused" in built) return done({ outcome: "not parsed", engine });
    try {
      // The candidates as the probe finds them: the preamble's storing calls' among them, whose
      // texts the preamble stores.
      const setters = new Set(
        Object.entries(found.commands)
          .filter(([name, each]) => each.kind === "template" && isSetter(found.macros[name]))
          .map(([name]) => name),
      );
      const preamble = "refused" in head ? undefined : buildTree(head, found);
      const { candidates } = candidatesOf(built, {
        ...(preamble === undefined || "refused" in preamble ? {} : { preamble }),
        setters,
      });
      const probed = {
        macros: [],
        candidates: candidates.map(
          (each): ProbeCandidate => ({ ...each, verdict: "untested", settled: "budget" }),
        ),
      };
      const sources = sourcesOf(taken);
      // The page, read with the upload's fonts first, as the reference read it.
      page = await pageStrings(made, fonts, taken.files);
      const pageCounts = {
        words: page.words.length,
        pairs: page.pairs.length,
        identifiers: page.identifiers.length,
        numbers: page.numbers.length,
        runs: page.runs.length,
        glyphs: page.glyphs,
        readable: page.readable,
      };
      // The header's values, found by the answers the request without them finds, and the request
      // again with them, as the import builds it; and once without the page, to count what the
      // page masked.
      const plain = await buildRequest(built, found, probed, body.preamble, { sources, page });
      if ("refused" in plain) return done({ outcome: "refused", engine, page: pageCounts });
      const header = headerOf(
        candidates,
        commandAnswers(plain.request, answers, (name) => realName(plain.names, name)),
      );
      const options = { sources, header };
      const requested = await buildRequest(built, found, probed, body.preamble, {
        ...options,
        page,
      });
      const unpaged = await buildRequest(built, found, probed, body.preamble, options);
      if ("refused" in requested || "refused" in unpaged)
        return done({ outcome: "refused", engine, page: pageCounts });
      const request = requested.request;
      const stored = candidates
        .filter((each) => each.where === "preamble")
        .map((each) => each.text);
      const leaks = findLeaks(request, {
        tree: built,
        header,
        stored,
        sources,
        page,
        names: requested.names,
      });
      const owned = ownNames(sources);
      const meaning = (name: string) => {
        const macro = Object.hasOwn(found.macros, name) ? found.macros[name] : undefined;
        return macro === undefined || macro.kind === "data" ? undefined : macro.meaning;
      };
      done({
        outcome: "checked",
        engine,
        counts: leakCounts(
          request,
          unpaged.request,
          meaning,
          (name) => isOwn(name, owned),
          header,
          {
            request: (name) => realName(requested.names, name),
            unpaged: (name) => realName(unpaged.names, name),
          },
        ),
        page: pageCounts,
        names: requested.names.size,
        findings: leakFindings(leaks),
      });
    } catch (error) {
      // A request the contract refuses is named by where it breaks it, never what it holds.
      if (error instanceof InvalidRequest)
        return done({ outcome: "invalid", engine, problems: [...error.problems] });
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
