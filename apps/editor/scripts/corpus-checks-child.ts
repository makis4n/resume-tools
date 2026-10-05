/**
 * One child of `corpus checks` (`corpus-checks.ts`): an engine session and fonts of its own, which
 * take one document at a time, as a zip, first through the import a person's browser runs
 * (`importResume`), as it is, for its outcome; then through the same steps again, as `run.ts` takes
 * them, up to the checks, whose outcome on the same outline must agree; and then through what tells
 * why the checks refuse it (the module comment of `corpus-checks.ts`):
 *
 * - **The model.** Whether the outline with its fields, and with every field kept as text, is one
 *   the model holds; where not, which of its rules each breaks, where its braces stand, by line and
 *   the commands on it, and which candidates, each kept alone, break it.
 * - **The compiles.** The outline with its fields, and with every field kept, compiled as the
 *   checks compile them, from the package's format; where the second stops, its first error as a
 *   kind, by line and the commands on it, and where the generator's writing of it differs from the
 *   upload's body; and the same outline compiled four other ways: whole, with the package's
 *   preamble; from the document's own preamble dumped as the probe dumps it; the upload's body byte
 *   for byte, from the package's format; and encoded as the upload's main file is.
 *
 * It answers with lines of ids, reason codes, steps, counts, command and environment names, line
 * numbers and kinds of error (`ChecksRow`), and prints nothing: a document's text never reaches a
 * terminal, nor does a compile's log, which `texError` reads for kinds and names alone. The editor's
 * modules are written for Vite, so this file, which Node runs as it is, loads them through Vite's
 * module runner with the app's own config, as the corpus's other children do.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OutlinePart } from "@resume-tools/resume-model";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import type { CompileResult, Engine } from "../src/engine/session.ts";
import type { Outline } from "../src/import/outline.ts";
import type { ProbeCandidate } from "../src/import/probe.ts";
import type { GlyphStream } from "../src/import/reference.ts";
import type { FontFamily, TemplatePackage } from "../src/templates/package.ts";
import {
  addedKind,
  aroundBrace,
  balances,
  braceScan,
  type ChecksRow,
  type CompileVerdict,
  commandBefore,
  commentFacts,
  errorLine,
  insertions,
  lineAt,
  lineSpan,
  namesOn,
  texError,
  verdictWords,
} from "./corpus-checks.ts";

type NodeEngine = typeof import("../src/engine/node.ts");
type Fonts = typeof import("../src/page/fonts.ts");
type TexLive = typeof import("../src/page/texlive.ts");
type IntakeModule = typeof import("../src/import/intake.ts");
type ImportFonts = typeof import("../src/import/fonts.ts");
type RunModule = typeof import("../src/import/run.ts");
type StandIns = typeof import("../src/import/standins.ts");
type ReferenceModule = typeof import("../src/import/reference.ts");
type LatinModern = typeof import("../src/import/latin-modern.ts");
type Xetex = typeof import("../src/import/xetex.ts");
type XetexCheck = typeof import("../src/import/xetex-check.ts");
type ParseModule = typeof import("../src/import/parse.ts");
type SourceModule = typeof import("../src/import/source.ts");
type SignaturesModule = typeof import("../src/import/signatures.ts");
type ProbeModule = typeof import("../src/import/probe.ts");
type OutlineModule = typeof import("../src/import/outline.ts");
type ChecksModule = typeof import("../src/import/checks.ts");
type LogModule = typeof import("../src/import/log.ts");
type Generate = typeof import("../src/templates/generate.ts");
type PackageModule = typeof import("../src/templates/package.ts");
type Model = typeof import("@resume-tools/resume-model");

const APP = fileURLToPath(new URL("..", import.meta.url));

/** A document, as the parent sends it: its zip and the zip's name. */
interface Task {
  type: "task";
  id: string;
  message: { name: string; bytes: Uint8Array };
}

/** How many candidates the model's check names, and the lines a line's names are listed for. */
const LISTED = 8;

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
  const { intake, treeImages, encodeLike, decodeText } =
    await runner.import<IntakeModule>("/src/import/intake.ts");
  const { readTree } = await runner.import<ImportFonts>("/src/import/fonts.ts");
  const { importResume, uploadOf, preambleOf } =
    await runner.import<RunModule>("/src/import/run.ts");
  const { plainStandIns } = await runner.import<StandIns>("/src/import/standins.ts");
  const { IMPORT_JOB, reference, referenceFiles, readOutput, shippedFont, difference } =
    await runner.import<ReferenceModule>("/src/import/reference.ts");
  const { inLatinModern, undrawableFonts } = await runner.import<LatinModern>(
    "/src/import/latin-modern.ts",
  );
  const { rewriteForXetex } = await runner.import<Xetex>("/src/import/xetex.ts");
  const { checkRewrite, jobFiles, dumpFiles } = await runner.import<XetexCheck>(
    "/src/import/xetex-check.ts",
  );
  const { bodyOf, bodyOfText, buildTree, readBody } =
    await runner.import<ParseModule>("/src/import/parse.ts");
  const { signatures } = await runner.import<SignaturesModule>("/src/import/signatures.ts");
  const { maskComments } = await runner.import<SourceModule>("/src/import/source.ts");
  const { probe, probeUses, failed, PROBE_PRELUDE } =
    await runner.import<ProbeModule>("/src/import/probe.ts");
  const { buildOutline, outlinePackage, outlineResume } =
    await runner.import<OutlineModule>("/src/import/outline.ts");
  const { OutlineCompiler, checkOutline, glyphsOnly } =
    await runner.import<ChecksModule>("/src/import/checks.ts");
  const { asksForRerun } = await runner.import<LogModule>("/src/import/log.ts");
  const { generateBody, generateFormat, fontDeclarations } = await runner.import<Generate>(
    "/src/templates/generate.ts",
  );
  const { fontFiles } = await runner.import<PackageModule>("/src/templates/package.ts");
  const { Resume, outlineNodes } = await runner.import<Model>("@resume-tools/resume-model");

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
  const deps = { session, fonts, tree, treeImage };
  /** Whether a path a log names is a file of the engine's tree, which alone a line names. */
  const treeFile = (path: string) => Object.hasOwn(manifest.files, path);
  const options = { treeImage };

  process.on("message", async (task: Task) => {
    if (task.type !== "task") return;
    const lines: string[] = [];
    const say = (line: string) => lines.push(line);
    const done = () => send({ type: "done", id: task.id, row: { id: task.id, lines } });
    const files = [{ name: task.message.name, bytes: new Uint8Array(task.message.bytes) }];
    try {
      // The import as a browser runs it, for its outcome.
      let step = "intake";
      const real = await importResume(files, deps, (progress) => {
        step = progress.step;
      });
      const realOutcome =
        "refused" in real
          ? `refused at ${step}: ${real.reason}`
          : `imported, ${real.report.checks.outcome}`;
      say(`the import: ${realOutcome}`);

      // The same steps again, as run.ts takes them, up to the checks.
      const upload = uploadOf(files);
      if ("refused" in upload) return done();
      const received = intake(upload, { tree, ...options });
      if ("refused" in received) return done();
      const uploaded = plainStandIns(received);
      const first = await reference(session, fonts, uploaded, options);
      if ("refused" in first) return done();
      const swap = await inLatinModern(session, fonts, uploaded, first, options);
      if (swap !== undefined && "refused" in swap) return done();
      let taken = swap?.intake ?? uploaded;
      let made = swap?.reference ?? first;
      const engine: Engine = made.engine;
      let rewritten: { fonts: FontFamily[] } | undefined;
      if (engine === "xetex") {
        const rewrite = rewriteForXetex(taken, tree);
        if ("refused" in rewrite) return done();
        const checked = await checkRewrite(session, fonts, taken, made, rewrite, {
          ...options,
          format: "importfonts",
        });
        session.dropFormat("xetex", "importfonts");
        if ("refused" in checked) return done();
        const text = `${rewrite.preamble}${rewrite.body}`;
        taken = {
          ...taken,
          main: {
            ...taken.main,
            text,
            bytes: encodeLike(taken.main.bytes, text) ?? new TextEncoder().encode(text),
          },
          files: jobFiles(taken, made, rewrite, treeImage),
          fonts: [],
        };
        const { pages, size, fonts: used, specials } = checked.stream;
        made = { ...made, pages, size, fonts: used, specials };
        rewritten = { fonts: rewrite.fonts };
      }
      const [cannot] = await undrawableFonts(fonts, made.fonts);
      if (cannot !== undefined) return done();
      const body = bodyOf(taken);
      if ("refused" in body) return done();
      const read = readBody(body);
      if ("refused" in read) return done();
      const preambleRead = readBody(bodyOfText(body.preamble));
      const uses = probeUses(read, "refused" in preambleRead ? undefined : preambleRead);
      const found = await signatures(session, taken, made, body, uses, options);
      if ("refused" in found) return done();
      const built = buildTree(read, found);
      if ("refused" in built) return done();
      const declarations = rewritten === undefined ? undefined : fontDeclarations(rewritten.fonts);
      const probed = await probe(session, fonts, taken, made, built, found, {
        ...options,
        ...(declarations === undefined ? {} : { declarations }),
      });
      if (probed.format !== undefined) session.dropFormat(engine, probed.format);
      const editable = probed.candidates.filter((each) => each.verdict === "editable");
      say(
        `the probe: ${engine}, ${probed.path} path${probed.fallback === undefined ? "" : ` (${probed.fallback}${probed.formatDifference === undefined ? "" : `, ${probed.formatDifference}`})`}, ${editable.length} of ${probed.candidates.length} candidates editable${probed.baseline === undefined ? "" : `, baseline ${probed.baseline}`}`,
      );
      if (probed.baseline !== undefined) return done();
      const head = preambleOf(body, built, probed);
      const begin = body.before.slice(body.preamble.length);
      const end = /^\\end\s*\{document\}/.exec(body.after)?.[0] ?? "\\end{document}";
      const outlineOf = (kept: ReadonlySet<string>) =>
        buildOutline({
          tree: built,
          ...(head === undefined ? {} : { preamble: head }),
          candidates: probed.candidates,
          kept,
          macros: probed.signatures.macros,
          begin,
          end,
        });
      const pkg = await outlinePackage({
        engine,
        preamble: body.preamble,
        files: taken.files,
        ...(rewritten === undefined ? {} : { fonts: rewritten.fonts }),
        reference: made,
      });
      const jobFilesOf = referenceFiles(taken, made, { job: IMPORT_JOB, ...options });
      const compiler = new OutlineCompiler({
        session,
        fonts,
        pkg,
        job: IMPORT_JOB,
        files: jobFilesOf,
      });

      // The source the lines name: the body, its inputs inlined, and where each part came from.
      const source = built.source;
      const expected = `${begin}${source}${end}`;
      const mainText = taken.main.text;
      /** A place in the body as a line of the upload's: the main file's, or an input's. */
      const bodyPlace = (at: number): string => {
        const part = body.sources.find((each) => at >= each.start && at < each.end);
        if (part?.file === undefined || part.offset === undefined)
          return `body line ${lineAt(source, at)}`;
        const within = part.offset + (at - part.start);
        if (part.file === taken.main.path) return `main file line ${lineAt(mainText, within)}`;
        const bytes = taken.files[part.file];
        const extension = /\.[A-Za-z0-9]{1,8}$/.exec(part.file)?.[0] ?? "";
        return bytes === undefined
          ? `an input's (${extension}) line`
          : `line ${lineAt(decodeText(bytes), within)} of an input (${extension})`;
      };
      /** A place in `expected` as a line, and the names on its line of the body. */
      const placeWords = (at: number): string => {
        if (at < begin.length) return "in the line that begins the document";
        if (at >= begin.length + source.length) return "in \\end{document} or after it";
        const inBody = at - begin.length;
        const span = lineSpan(source, lineAt(source, inBody));
        const names = namesOn(source.slice(span.start, span.end));
        return `at ${bodyPlace(inBody)}${names.length === 0 ? ", no command on it" : `, on a line naming ${names.join(" ")}`}`;
      };

      /** A unit's parts' text as the model reads it, each field a group. */
      const unitText = (parts: readonly OutlinePart[]): string => {
        let text = "";
        for (const step of outlineNodes(parts)) {
          if (step.kind === "unit") {
            if (!step.first) text += step.unit.gap;
          } else if (step.part.kind === "kept") text += step.part.latex;
          else if (step.part.kind === "text" || step.part.kind === "rich") text += "{}";
        }
        return text;
      };

      /**
       * Where the model refuses an outline, by its rules (`OutlineSection`), as lines of kinds,
       * counts and places: its pieces of kept text that end in an escaping backslash or hold the
       * editor's macros or markers; its units, or their gaps, that do not balance; and its braces
       * as a whole, each field a group: where the first `}` that closes nothing and each `{` left
       * open stand, with the command each belongs to and the names on its line.
       */
      const whereRefused = (parts: readonly OutlinePart[]): string[] => {
        const found: string[] = [];
        // The outline's text as the model reads it, each field a group, and where each piece of
        // kept text stands in `expected`, found in order.
        let text = "";
        const places: { from: number; to: number; at: number }[] = [];
        let cursor = 0;
        const piece = (latex: string) => {
          const at = expected.indexOf(latex, cursor);
          if (at >= 0) {
            places.push({ from: text.length, to: text.length + latex.length, at });
            cursor = at + latex.length;
          }
          text += latex;
        };
        const where = (k: number) => {
          const place = places.find((each) => k >= each.from && k < each.to);
          return place === undefined ? "in a field" : placeWords(place.at + (k - place.from));
        };
        /** A place of the text as a line alone, without the names on it. */
        const lineOf = (k: number) => {
          const place = places.find((each) => k >= each.from && k < each.to);
          const at = place === undefined ? undefined : place.at + (k - place.from) - begin.length;
          return at === undefined || at < 0 || at >= source.length
            ? "outside the body"
            : bodyPlace(at);
        };
        /** What stands around an open brace (`aroundBrace`), as names and lines. */
        const around = (k: number) => {
          const found = aroundBrace(text, k);
          return [
            ...(found.environments.length === 0
              ? []
              : [`inside ${found.environments.map((name) => `{${name}}`).join(" in ")}`]),
            ...(found.iffalse ? ["inside \\iffalse"] : []),
            ...(found.commentBrace === undefined
              ? []
              : [`the next } in a comment at ${lineOf(found.commentBrace)}`]),
            ...(found.egroup === undefined ? [] : [`the next \\egroup at ${lineOf(found.egroup)}`]),
            ...commentWords(text, k),
          ].join(", ");
        };
        let escaping = 0;
        let editors = 0;
        const unbalanced: string[] = [];
        let depth = 0;
        for (const step of outlineNodes(parts)) {
          depth = Math.max(depth, step.depth);
          if (step.kind === "unit") {
            if (!step.first) piece(step.unit.gap);
            if (
              !balances(braceScan(step.unit.gap)) ||
              !balances(braceScan(unitText(step.unit.parts)))
            )
              unbalanced.push(`${step.group.id} unit ${step.group.units.indexOf(step.unit) + 1}`);
            continue;
          }
          const part = step.part;
          if (part.kind === "kept") {
            if ((/\\+$/.exec(part.latex)?.[0].length ?? 0) % 2 === 1) escaping++;
            if (/\\rt(?:field|locked)(?![A-Za-z])|\\rt@|rt:[bepl]:/i.test(part.latex)) editors++;
            piece(part.latex);
          } else if (part.kind === "text" || part.kind === "rich") text += "{}";
        }
        found.push(
          `deepest group ${depth}; ${text.length} characters; ${escaping} pieces ending in an escaping backslash; ${editors} holding the editor's macros or markers; ${unbalanced.length} units not balanced${unbalanced.length === 0 ? "" : `: ${unbalanced.slice(0, LISTED).join(", ")}`}`,
        );
        const braces = braceScan(text);
        if (balances(braces)) found.push("its braces balance as the model reads them");
        if (braces.under !== undefined)
          found.push(`a } that closes nothing, ${where(braces.under)}`);
        if (braces.delimited !== undefined)
          found.push(`an address's delimiter never closed, ${where(braces.delimited)}`);
        if (braces.open.length > 0)
          found.push(
            `${braces.open.length} { left open: ${braces.open
              .slice(0, LISTED)
              .map(
                (k) =>
                  `${commandBefore(text, k) ?? "a group's"} {, ${where(k)}; ${around(k) || "nothing around it"}`,
              )
              .join("; ")}`,
          );
        return found;
      };

      // What follows the body, which the outline does not hold, and what the body leaves open.
      const rest = body.after.slice(end.length);
      const restNames = namesOn(rest, 20);
      say(
        `after the body's end: ${lineAt(rest, rest.length) - 1} line ends${rest.trim() === "" ? ", nothing else" : `, naming ${restNames.join(" ") || "no command"}`}`,
      );
      // The main file's encoding, and inputenc's options by name, which a field's text, written in
      // UTF-8 as the generator writes every body, must suit.
      const bytes = taken.main.bytes;
      let utf8 = true;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        utf8 = false;
      }
      const past = bytes.filter((byte) => byte > 0x7f).length;
      const inputenc = [
        ...maskComments(body.preamble).matchAll(/\\usepackage\s*\[([^\]]*)\]\s*\{inputenc\}/g),
      ].flatMap((found) =>
        (found[1] ?? "")
          .split(",")
          .map((each) => each.trim())
          .filter((each) => /^[A-Za-z0-9-]{1,20}$/.test(each)),
      );
      say(
        `the main file: ${utf8 ? "UTF-8" : "not UTF-8, read as Latin-1"}, ${past} bytes past ASCII; inputenc ${inputenc.length === 0 ? "not loaded with an option" : `loaded with ${inputenc.join(", ")}`}`,
      );
      // Whether TeX itself ends the upload's document inside groups it left open, as its log says.
      const level = /\(\\end occurred inside a group at level (\d+)\)/.exec(made.log)?.[1];
      say(
        `the reference: ${level === undefined ? "TeX ends it with every group closed" : `TeX ends it inside a group at level ${level}`}`,
      );
      // Whether the upload changes the category of `%`, which would make it no comment to TeX.
      const percent = /\\catcode\s*`?\\?%|\\catcode\s*37(?!\d)|\\@makeother\s*\\%/;
      say(
        `the category of %: ${percent.test(mainText) ? "the main file changes it" : "the main file does not change it"}`,
      );
      const left = aroundBrace(source, source.length);
      say(
        `at the body's end: ${left.environments.length === 0 ? "no environment left open" : `left open: ${left.environments.map((name) => `{${name}}`).join(" in ")}`}${left.iffalse ? ", inside \\iffalse" : ""}`,
      );

      // The model: the outline with its fields, and with every field kept.
      const none = outlineOf(new Set());
      const fieldIds = [...none.fields.keys()];
      const all = outlineOf(new Set(fieldIds));
      say(
        `the outline: ${none.counts.fields} fields of ${fieldIds.length} candidates, ${none.counts.groups} groups of ${none.counts.units} units; with every field kept, ${all.counts.groups} groups of ${all.counts.units} units`,
      );
      const model = (outline: Outline) =>
        Resume.safeParse({
          version: 1,
          header: { name: { first: "", last: "" }, links: [] },
          sections: [
            { kind: "outline", id: "outline", title: "", role: "other", parts: outline.parts },
          ],
        });
      for (const [name, outline] of [
        ["with its fields", none],
        ["with every field kept", all],
      ] as const) {
        const held = model(outline);
        if (held.success) {
          say(`the model: the outline ${name} is held`);
          continue;
        }
        const issues = held.error.issues.map((issue) =>
          issue.code === "custom" ? issue.message : `${issue.code} at ${issue.path.join(".")}`,
        );
        say(`the model: the outline ${name} is refused: ${[...new Set(issues)].join("; ")}`);
        for (const line of whereRefused(outline.parts)) say(`  ${line}`);
      }
      if (!model(all).success) {
        // Which candidates, each kept alone, the others fields, break the model.
        const breaking = fieldIds.filter(
          (id) => outlineResume(outlineOf(new Set([id])).parts) === undefined,
        );
        say(
          `the model: ${breaking.length} of ${fieldIds.length} candidates, each kept alone, break it${breaking.length === 0 ? "" : ":"}`,
        );
        const byId = new Map(probed.candidates.map((each) => [each.id, each]));
        for (const id of breaking.slice(0, LISTED)) {
          const candidate = byId.get(id);
          if (candidate !== undefined)
            say(
              `  ${candidateWords(candidate)}, ${candidate.where === "body" ? placeWords(begin.length + candidate.start) : "in the preamble"}`,
            );
        }
      }

      // The compiles, as the checks compile them.
      const dumped = compiler.start();
      if (!dumped.ok) {
        const error = texError(dumped.log, IMPORT_JOB, treeFile);
        say(
          `the package's format: does not dump: ${error === undefined ? "no error" : errorLine(error, (n) => `at preamble line ${n}`)}`,
        );
        return done();
      }
      const covers =
        fontFiles(pkg).length === 0
          ? {}
          : { covers: (await fonts.coverage(fontFiles(pkg))).covers };
      const target = made as GlyphStream;
      /** A compile's verdict, its error's lines read by `line`. */
      const verdictOf = async (
        result: CompileResult,
        line: (n: number) => string,
      ): Promise<CompileVerdict> => {
        if (failed(result, 3) || result.output === undefined) {
          const error = texError(result.log, IMPORT_JOB, treeFile);
          return {
            outcome: "stops",
            ...(error === undefined ? {} : { error: errorLine(error, line) }),
            ...(asksForRerun(result.log) ? { rerun: true } : {}),
          };
        }
        let stream: GlyphStream;
        try {
          stream = (
            await readOutput(fonts, result.output, (path) =>
              shippedFont(jobFilesOf, IMPORT_JOB, path),
            )
          ).stream;
        } catch {
          return { outcome: "unreadable" };
        }
        const differs = difference(glyphsOnly(target), glyphsOnly(stream));
        return differs === undefined
          ? { outcome: "same" }
          : {
              outcome: "differs",
              difference: {
                kind: differs.kind,
                ...(differs.page === undefined ? {} : { page: differs.page + 1 }),
              },
            };
      };
      /** A compile from the package's format, in a job forgotten first, or as the last left it. */
      const fromFormat = (latex: string | Uint8Array, fresh = true) => {
        if (fresh) session.forget(IMPORT_JOB);
        return session.compile(engine, compiler.format.name, latex, {
          job: IMPORT_JOB,
          maxPasses: 3,
          files: jobFilesOf,
        });
      };
      const generated = (outline: Outline) => {
        const resume = outlineResume(outline.parts);
        if (resume === undefined) return undefined;
        try {
          return generateBody(pkg, resume, {}, covers).latex;
        } catch {
          return undefined;
        }
      };

      // The outline with its fields, as the checks' first compile; its lines are the body as
      // written, markers in it, and are named by the names on them.
      const withFields = generated(none);
      if (withFields === undefined) say("the outline with its fields: the generator wrote no body");
      else {
        const verdict = await verdictOf(fromFormat(withFields), (n) => {
          const span = lineSpan(withFields, n);
          const names = namesOn(withFields.slice(span.start, span.end));
          return `at line ${n} of the body as written, naming ${names.join(" ") || "no command"}`;
        });
        say(`the outline with its fields, compiled: ${verdictWords(verdict)}`);
      }

      // The outline with every field kept: the floor.
      const floor = generated(all);
      if (floor === undefined) {
        say("the outline with every field kept: the generator wrote no body");
        return done();
      }
      const start = floor.indexOf(begin);
      const written = insertions(expected, floor, Math.max(0, start));
      /** A line of the floor as written, as a line of the upload's and the names on it. */
      const floorLine = (n: number, shift = 0): string => {
        const span = lineSpan(floor, n + shift);
        const at = written.map[span.start - (written.start ?? 0)];
        return at === undefined || at < 0
          ? `at line ${n + shift} of the body as written, before the document begins`
          : placeWords(at);
      };
      // As the checks compile it, in the job the outline with its fields was just compiled in.
      const floorVerdict = await verdictOf(fromFormat(floor, withFields === undefined), (n) =>
        floorLine(n),
      );
      say(`the outline with every field kept, compiled: ${verdictWords(floorVerdict)}`);
      if (start < 0) say("  as written, it does not hold the line that begins the document");
      else if (written.added.length === 0 && written.parted === undefined)
        say("  as written, it is the upload's body byte for byte");
      else {
        const kinds = new Map<string, number[]>();
        for (const each of written.added) {
          const kind = addedKind(each.text);
          kinds.set(kind, [...(kinds.get(kind) ?? []), each.at]);
        }
        for (const [kind, places] of kinds)
          say(
            `  as written, it adds ${kind} in ${places.length} ${places.length === 1 ? "place" : "places"}: ${places
              .slice(0, LISTED)
              .map((at) => placeWords(at))
              .join("; ")}`,
          );
        if (written.parted !== undefined)
          say(`  as written, it parts from the body ${placeWords(written.parted)}`);
      }
      if (floorVerdict.outcome === "stops") {
        // The same outline five other ways, to tell which stops it.
        say(
          `  from the package's format, in a job of its own: ${verdictWords(
            await verdictOf(fromFormat(floor), (n) => floorLine(n)),
          )}`,
        );
        const pkgFiles: Record<string, Uint8Array> = {};
        for (const [name, text] of Object.entries(pkg.files))
          pkgFiles[name] = new TextEncoder().encode(text);
        const format = generateFormat(pkg, {});
        const prefix = `${format.preamble}\n`;
        const prefixLines = lineAt(prefix, prefix.length) - 1;
        session.forget(IMPORT_JOB);
        const whole = session.compile(engine, "stock", `${prefix}${floor}`, {
          job: IMPORT_JOB,
          maxPasses: 3,
          files: { ...jobFilesOf, ...pkgFiles },
          fontsByName: engine === "xetex",
        });
        say(
          `  compiled whole, with the package's preamble: ${verdictWords(
            await verdictOf(whole, (n) =>
              n > prefixLines
                ? floorLine(n - prefixLines)
                : `at line ${n} of the package's preamble`,
            ),
          )}`,
        );
        const own = `${body.preamble}\n${declarations === undefined ? "" : `${declarations}\n`}${PROBE_PRELUDE}`;
        const ownName = `checks-own-${Date.now().toString(36)}`;
        const ownBytes = encodeLike(taken.main.bytes, own) ?? new TextEncoder().encode(own);
        const ownDump = session.dump(
          engine,
          ownName,
          ownBytes,
          engine === "xetex" ? dumpFiles(jobFilesOf) : jobFilesOf,
        );
        if (!ownDump.ok)
          say("  from the document's own preamble, as the probe dumps it: it does not dump");
        else {
          const fromOwn = (latex: string | Uint8Array) => {
            session.forget(IMPORT_JOB);
            return session.compile(engine, ownName, latex, {
              job: IMPORT_JOB,
              maxPasses: 3,
              files: jobFilesOf,
            });
          };
          const tail = start < 0 ? floor : floor.slice(start);
          const shift = start < 0 ? 0 : lineAt(floor, start) - 1;
          say(
            `  from the document's own preamble, as the probe dumps it: ${verdictWords(await verdictOf(fromOwn(tail), (n) => floorLine(n, shift)))}`,
          );
          const original = `${begin}${source}${body.after}`;
          say(
            `  the upload's body from the document's own preamble, as the probe's baseline: ${verdictWords(
              await verdictOf(fromOwn(encodeLike(taken.main.bytes, original) ?? original), (n) =>
                placeWords(lineSpan(expected, n).start),
              ),
            )}`,
          );
          session.dropFormat(engine, ownName);
        }
        const before = start < 0 ? "" : floor.slice(0, start);
        const beforeLines = lineAt(before, before.length) - 1;
        say(
          `  the upload's body byte for byte, from the package's format: ${verdictWords(
            await verdictOf(fromFormat(`${before}${expected}\n`), (n) =>
              n > beforeLines
                ? placeWords(lineSpan(expected, n - beforeLines).start)
                : `at line ${n} before the document begins`,
            ),
          )}`,
        );
        const encoded = encodeLike(taken.main.bytes, floor);
        say(
          `  encoded as the upload's main file is (${taken.main.bytes[0] === 0xef ? "UTF-8 with a mark" : encoded !== undefined && encoded.length === floor.length ? "Latin-1 or ASCII" : "UTF-8"}): ${encoded === undefined ? "it cannot be" : verdictWords(await verdictOf(fromFormat(encoded), (n) => floorLine(n)))}`,
        );
      }

      // The checks, on this outline, as the import runs them.
      const checked = await checkOutline({
        compiler,
        reference: made,
        build: outlineOf,
        candidates: probed.candidates,
        runs: probed.runs ?? [],
      });
      compiler.close();
      say(
        `the checks, run again: ${"refused" in checked ? `refused: ${checked.reason}` : `${checked.outcome}, ${checked.compiles} compiles`}`,
      );
    } catch (error) {
      // What went wrong may quote the document, so only its kind is said.
      say(`the diagnostic failed: ${error instanceof Error ? error.name : "unknown"}`);
    } finally {
      session.forget(IMPORT_JOB);
    }
    return done();
  });
  send({ type: "ready" });
}

/** The comment on a brace's line, as `commentFacts` counts it, in words. */
function commentWords(text: string, at: number): string[] {
  const facts = commentFacts(text, at);
  if (facts === undefined) return [];
  return [
    `its line's comment has ${facts.before[0]} { and ${facts.before[1]} } before its %, ${facts.after[0]} { and ${facts.after[1]} } after it, ${facts.prev} before the % and ${facts.next} after it`,
  ];
}

/** A candidate as a line names it: its kind, its command's name and argument, and its place. */
function candidateWords(candidate: ProbeCandidate): string {
  const of =
    candidate.kind === "argument"
      ? `${candidate.of === "environment" ? "environment" : "command"} \\${candidate.name} #${candidate.index ?? "?"}`
      : candidate.kind === "paragraph"
        ? "a paragraph"
        : `${candidate.kind} of \\${candidate.name}`;
  return `${of}, in the ${candidate.where}, its text ${candidate.end - candidate.start} characters`;
}

main().catch(() => {
  // The parent counts a child that dies; what killed it may quote a document, so it goes unsaid.
  process.exit(1);
});
