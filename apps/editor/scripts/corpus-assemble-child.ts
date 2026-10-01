/**
 * One child of `corpus assemble`'s pool (`corpus-assemble.ts`, decision 0026), which `corpus
 * oracle` runs too: an engine session and fonts of its own, which take one document at a time, as a
 * zip, through the intake, the reference compile, read in Latin Modern where the page cannot draw
 * its Computer Modern in T1 or TS1 (`inLatinModern`, decision 0026), the signatures' two compiles,
 * asked of the body's commands, the preamble's and the sizes the class may declare (`SIZE_OPTIONS`,
 * decision 0026), the parse, the probe and the naming request, built as items 7 and 11 build it,
 * with the upload's sources and the header's values (decision 0024); find the answers the committed
 * folder holds for its macros' keys, each as the document's macro (`answerFor`); and, where it
 * holds any, rewrite a XeTeX document's fonts by file and check the rewrite (decision 0023), and
 * assemble the document's package and document and validate them. It answers with the document's
 * row, names and numbers only; the probe's row and the whole probe, for the oracle; the fields
 * found by the model's place, for the oracle's comparison with the ports; and the whole assembly,
 * which holds the document's text, as the whole probe does, and which the parent keeps under
 * `.corpus/` alone.
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
import {
  type AssembleChildRow,
  answersFor,
  assembleRow,
  errorClass,
  fieldsFound,
  type SectionRemoval,
} from "./corpus-assemble.ts";
import { probeRow } from "./corpus-probe.ts";
import { answersFolder, commandAnswers, headerOf } from "./corpus-seed.ts";

type NodeEngine = typeof import("../src/engine/node.ts");
type Fonts = typeof import("../src/page/fonts.ts");
type TexLive = typeof import("../src/page/texlive.ts");
type IntakeModule = typeof import("../src/import/intake.ts");
type ReferenceModule = typeof import("../src/import/reference.ts");
type LatinModernModule = typeof import("../src/import/latin-modern.ts");
type ImportFonts = typeof import("../src/import/fonts.ts");
type ParseModule = typeof import("../src/import/parse.ts");
type SignaturesModule = typeof import("../src/import/signatures.ts");
type ProbeModule = typeof import("../src/import/probe.ts");
type NamingModule = typeof import("../src/import/naming.ts");
type XetexModule = typeof import("../src/import/xetex.ts");
type CheckModule = typeof import("../src/import/xetex-check.ts");
type ValidateModule = typeof import("../src/import/validate.ts");
type AssembleModule = typeof import("../src/import/assemble.ts");
type DocumentModule = typeof import("../src/editor/document.ts");
type GenerateModule = typeof import("../src/templates/generate.ts");
type PackageModule = typeof import("../src/templates/package.ts");
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
  const { inLatinModern } = await runner.import<LatinModernModule>("/src/import/latin-modern.ts");
  const { readTree } = await runner.import<ImportFonts>("/src/import/fonts.ts");
  const { bodyOf, bodyOfText, buildTree, readBody } =
    await runner.import<ParseModule>("/src/import/parse.ts");
  const { signatures } = await runner.import<SignaturesModule>("/src/import/signatures.ts");
  const { probe, probeUses } = await runner.import<ProbeModule>("/src/import/probe.ts");
  const { buildRequest, realName, sourcesOf } =
    await runner.import<NamingModule>("/src/import/naming.ts");
  const { rewriteForXetex } = await runner.import<XetexModule>("/src/import/xetex.ts");
  const { checkRewrite } = await runner.import<CheckModule>("/src/import/xetex-check.ts");
  const { validate } = await runner.import<ValidateModule>("/src/import/validate.ts");
  const { SIZE_OPTIONS } = await runner.import<AssembleModule>("/src/import/assemble.ts");
  const { applyUnder } = await runner.import<DocumentModule>("/src/editor/document.ts");
  const { generateBody, generateFormat } = await runner.import<GenerateModule>(
    "/src/templates/generate.ts",
  );
  const { referenceFiles } = await runner.import<ReferenceModule>("/src/import/reference.ts");
  const { forRole } = await runner.import<PackageModule>("/src/templates/package.ts");

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
    const uploaded = intake(
      { name: task.message.name, bytes: new Uint8Array(task.message.bytes) },
      { tree, treeImage },
    );
    if ("refused" in uploaded) return done({ outcome: "no reference" });
    const first = await reference(session, fonts, uploaded, { treeImage });
    if ("refused" in first) return done({ outcome: "no reference" });
    // A document set in Computer Modern's T1 or TS1 fonts, which the page cannot draw, is read with
    // T1 and Latin Modern after its class from here on, as every pdfTeX port is, so that the probe
    // reads a page it can draw (decision 0026).
    const swap = await inLatinModern(session, fonts, uploaded, first, { treeImage });
    if (swap !== undefined && "refused" in swap) return done(refusedRow(swap, first.engine));
    const taken = swap?.intake ?? uploaded;
    const made = swap?.reference ?? first;
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
      if ("refused" in plain) return done({ outcome: "no answer", engine, answered: 0 }, probedRow);
      const header = headerOf(
        probed.candidates,
        commandAnswers(plain.request, folder.read, (name) => realName(plain.names, name)),
      );
      const requested = await buildRequest(built, found, probed, body.preamble, {
        ...options,
        header,
      });
      if ("refused" in requested)
        return done({ outcome: "no answer", engine, answered: 0 }, probedRow);
      // The request writes a macro named after a word of the person's as a placeholder (decision
      // 0033); the answers are asked for, and come back, under the document's own names.
      const request = requested.request;
      const asked = request.macros.map((macro) => ({
        ...macro,
        name: realName(requested.names, macro.name),
      }));
      const answers = await answersFor(asked, cache);
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
        ...(swap === undefined ? {} : { latinModern: swap.swapped }),
        treeImage,
      });
      if ("refused" in validated) return done(refusedRow(validated, engine, counted), probedRow);
      // For each section of a kind whose removal stopped the compile, what frames it, by structure:
      // counts and booleans the request's definitions and the answers give, never the text.
      const removals: SectionRemoval[] = [];
      const failing = new Set(
        validated.checks.repeatable
          .filter((each) => !each.removed && each.kind.startsWith("section."))
          .map((each) => each.kind.slice("section.".length)),
      );
      if (failing.size > 0) {
        // The package as though it marked no kind, since it marks these now and the editor would
        // refuse their removal (decision 0038).
        const pkg = { ...validated.package, fixed: [] };
        const doc = validated.document;
        const format = generateFormat(pkg, {});
        const files = referenceFiles(taken, made, { job: "removal", treeImage });
        const opens = new Set<string>();
        const answered = new Set<string>();
        /** The closer each list opener's answer names. */
        const closers = new Map<string, string>();
        for (const each of answers.found) {
          answered.add(each.name);
          if (each.answer.list?.does !== "opens") continue;
          opens.add(each.name);
          if (each.answer.list.closedBy !== undefined)
            closers.set(each.name, each.answer.list.closedBy);
        }
        // How many environments each template macro begins and does not end, by its definition.
        const balance = new Map<string, number>();
        const occurrences = (latex: string, pattern: RegExp) => (latex.match(pattern) ?? []).length;
        for (const definition of request.definitions)
          if (definition.kind === "definition")
            balance.set(
              realName(requested.names, definition.name),
              occurrences(definition.text, /\\begin\s*\{/g) -
                occurrences(definition.text, /\\end\s*\{/g),
            );
        const calls = (latex: string) =>
          [...latex.matchAll(/\\([A-Za-z@]+)/g)].map((found) => found[1] ?? "");
        /** How many environments LaTeX begins and does not end, its macros' by their definitions. */
        const net = (latex: string) =>
          occurrences(latex, /\\begin\s*\{/g) -
          occurrences(latex, /\\end\s*\{/g) +
          calls(latex).reduce((sum, name) => sum + (balance.get(name) ?? 0), 0);
        const openerIn = (latex: string): SectionRemoval["opener"] => {
          const openers = calls(latex).filter((name) => (balance.get(name) ?? 0) > 0);
          if (openers.length === 0) return "none";
          if (openers.some((name) => opens.has(name))) return "list";
          return openers.some((name) => answered.has(name)) ? "answered" : "unanswered";
        };
        try {
          if (session.dump(pkg.engine, format.name, format.preamble, pkg.files).ok) {
            const sections = doc.resume.sections;
            for (const kind of failing) {
              const ofKind = sections.filter((section) => section.kind === kind);
              ofKind.forEach((section, n) => {
                if (section.kind === "locked") return;
                const removed = applyUnder(pkg, doc, {
                  type: "structure",
                  op: { op: "removeSection", id: section.id },
                });
                session.forget("removal");
                const result = session.compile(
                  pkg.engine,
                  format.name,
                  generateBody(pkg, removed.resume, {}).latex,
                  { job: "removal", maxPasses: 3, files },
                );
                const before = section.extras?.before ?? "";
                const after = section.extras?.after;
                const snippet = forRole(pkg.snippets.section[section.kind], section.role);
                const head = snippet.slice(0, Math.max(snippet.indexOf("{{&x.before}}"), 0));
                const at = sections.indexOf(section);
                const next = sections[at + 1];
                const closer: SectionRemoval["closer"] =
                  after !== undefined && net(after) < 0
                    ? "after"
                    : next?.kind === "locked" && net(next.latex) < 0
                      ? "locked"
                      : next !== undefined &&
                          next.kind !== "locked" &&
                          net(`${next.extras?.lead ?? ""}${next.extras?.before ?? ""}`) < 0
                        ? "next"
                        : "none";
                const closing =
                  closer === "after"
                    ? (after ?? "")
                    : closer === "locked" && next?.kind === "locked"
                      ? next.latex
                      : closer === "next" && next !== undefined && next.kind !== "locked"
                        ? `${next.extras?.lead ?? ""}${next.extras?.before ?? ""}`
                        : "";
                const named = calls(before).flatMap((name) => closers.get(name) ?? []);
                removals.push({
                  kind,
                  of:
                    ofKind.length === 1
                      ? "only"
                      : n === 0
                        ? "first"
                        : n === ofKind.length - 1
                          ? "last"
                          : "middle",
                  at,
                  sections: sections.length,
                  compiles: result.ok,
                  ...(result.ok ? {} : { error: errorClass(result.error) }),
                  before: /\\begin\s*\{/.test(before)
                    ? "environment"
                    : calls(before).some((name) => opens.has(name))
                      ? "list"
                      : /\\[A-Za-z@]/.test(before)
                        ? "call"
                        : "none",
                  opener: openerIn(before),
                  headOpens: net(head) > 0,
                  opens: net(before),
                  after: after !== undefined,
                  closer,
                  closes: -net(closing),
                  named: calls(closing).some((name) => named.includes(name)),
                });
              });
            }
          }
        } finally {
          session.dropFormat(pkg.engine, format.name);
          session.forget("removal");
        }
      }
      done(
        {
          ...assembleRow(validated.checks, engine, counted),
          probeMs: Math.round(probed.ms),
          ...(removals.length === 0 ? {} : { removals }),
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
