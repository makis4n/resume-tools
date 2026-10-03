/**
 * One child of the outline spike's pool (`spike-outline.ts`, milestone 3's second pass, item 2): an
 * engine session and fonts of its own, which take one document at a time, as a zip, through the
 * import's pipeline up to the probe, as `corpus run`'s child does (`corpus-assemble-child.ts`): the
 * intake, the reference compile, read in Latin Modern where the page cannot draw its Computer
 * Modern in T1 or TS1 (decision 0026), the signatures, the parse and the probe (decision 0022).
 * Then the outline (`spike-outline-build.ts`):
 *
 * 1. Its fields are the probe's editable candidates, written as the generator writes a slot, and
 *    the rest is kept text. Check 1 compiles it on the probe's own path, from the document's format
 *    or whole, starting from the auxiliary files of the baseline compiled once more, and bisects
 *    the fields whose rewriting moves the page from the reference as the probe bisects its
 *    candidates (`settle`, the first pass's check budget of 48): each becomes kept text.
 * 2. Its groups of units take check 3's three trials, a copy of the last unit with its fields
 *    emptied and the removal of the first and of the last, each kind in batches compiled together
 *    whose changes do not overlap, a batch that breaks the page halved until each trial that breaks
 *    it alone is found, within a budget of 64 compiles.
 * 3. Its words are the reference's page's, as the report reads them, each set down to a field, to
 *    kept text the retype reaches, or to locked kept text.
 *
 * It answers with the document's row, ids and counts only. It prints nothing: a document's text
 * never reaches a terminal. The editor's modules are written for Vite, so this file, which Node runs
 * as it is, loads them through Vite's module runner with the app's own config, as the corpus's
 * children do, and imports nothing of the editor itself but types.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../src/engine/manifest.ts";
import type { Candidate } from "../src/import/candidates.ts";
import type { Span } from "../src/import/parse.ts";
import type { SetResult } from "../src/import/probe.ts";
import type { Edit, Trial, TrialKind, TrialVerdict } from "./spike-outline-build.ts";
import type { OutlineChildRow } from "./spike-outline-table.ts";

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
type CandidatesModule = typeof import("../src/import/candidates.ts");
type ValidateModule = typeof import("../src/import/validate.ts");
type BuildModule = typeof import("./spike-outline-build.ts");

const APP = fileURLToPath(new URL("..", import.meta.url));

/** How many compiles check 3's trials may make, as the probe's budget bounds its own. */
const UNITS_BUDGET = 64;

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
  const { IMPORT_JOB, reference, referenceFiles, readOutput, shippedFont } =
    await runner.import<ReferenceModule>("/src/import/reference.ts");
  // The outline compiles in the job the reference and the probe compiled in, once the probe has
  // forgotten it: a font the upload ships stands in the job's folder, and the output names it by
  // its path there, which another job's name would make another font.
  const JOB = IMPORT_JOB;
  const { inLatinModern } = await runner.import<LatinModernModule>("/src/import/latin-modern.ts");
  const { readTree } = await runner.import<ImportFonts>("/src/import/fonts.ts");
  const { bodyOf, bodyOfText, buildTree, readBody } =
    await runner.import<ParseModule>("/src/import/parse.ts");
  const { signatures } = await runner.import<SignaturesModule>("/src/import/signatures.ts");
  const {
    AUXILIARY,
    PROBE_PASSES,
    failed,
    formatPath,
    observe,
    probe,
    probeOrder,
    probeUses,
    settle,
    suspectsIn,
    wholePath,
  } = await runner.import<ProbeModule>("/src/import/probe.ts");
  const { candidatesOf, isSetter } = await runner.import<CandidatesModule>(
    "/src/import/candidates.ts",
  );
  const { CHECK_BUDGET } = await runner.import<ValidateModule>("/src/import/validate.ts");
  const build = await runner.import<BuildModule>("/scripts/spike-outline-build.ts");

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

  process.on("message", async (task: Task) => {
    if (task.type !== "task") return;
    const started = performance.now();
    let mark = started;
    const ms: NonNullable<OutlineChildRow["ms"]> = { total: 0 };
    /** The time since the last step ended, as the step's. */
    const took = (step: Exclude<keyof typeof ms, "total">) => {
      const now = performance.now();
      ms[step] = Math.round(now - mark);
      mark = now;
    };
    const done = (row: Omit<OutlineChildRow, "ms">) =>
      send({
        type: "done",
        id: task.id,
        row: { ...row, ms: { ...ms, total: Math.round(performance.now() - started) } },
      });
    const uploaded = intake(
      { name: task.message.name, bytes: new Uint8Array(task.message.bytes) },
      { tree, treeImage },
    );
    if ("refused" in uploaded) return done({ outcome: "no reference", refused: uploaded.reason });
    const first = await reference(session, fonts, uploaded, { treeImage });
    took("reference");
    if ("refused" in first) return done({ outcome: "no reference", refused: first.reason });
    const swap = await inLatinModern(session, fonts, uploaded, first, { treeImage });
    took("latinModern");
    if (swap !== undefined && "refused" in swap)
      return done({ outcome: "refused", refused: swap.reason, engine: first.engine });
    const taken = swap?.intake ?? uploaded;
    const made = swap?.reference ?? first;
    const engine = made.engine;
    const latinModern = swap === undefined ? {} : { latinModern: true };
    const unparsed = () => done({ outcome: "not parsed", engine, ...latinModern });
    const body = bodyOf(taken);
    if ("refused" in body) return unparsed();
    const read = readBody(body);
    if ("refused" in read) return unparsed();
    const preambleRead = readBody(bodyOfText(body.preamble));
    const uses = probeUses(read, "refused" in preambleRead ? undefined : preambleRead);
    const found = await signatures(session, taken, made, body, uses, { treeImage });
    if ("refused" in found) return unparsed();
    const built = buildTree(read, found);
    if ("refused" in built) return unparsed();
    took("parse");
    let format: string | undefined;
    try {
      const probed = await probe(session, fonts, taken, made, built, found, { treeImage });
      took("probe");
      format = probed.format;
      const glyphs = { reference: probed.glyphs.reference, covered: probed.glyphs.covered };
      const candidates = {
        editable: probed.candidates.filter((each) => each.verdict === "editable").length,
        locked: probed.candidates.filter(
          (each) => each.verdict !== "editable" && each.verdict !== "container",
        ).length,
        container: probed.candidates.filter((each) => each.verdict === "container").length,
        verdicts: Object.fromEntries(
          [...new Set(probed.candidates.map((each) => each.verdict))].map((verdict) => [
            verdict,
            probed.candidates.filter((each) => each.verdict === verdict).length,
          ]),
        ),
      };
      const base = { engine, path: probed.path, ...latinModern, glyphs, candidates };
      if (probed.baseline !== undefined) return done({ outcome: "baseline", ...base });

      // The candidates again, as the probe found them, with the preamble's calls that store a
      // header's text, whose arguments the outline issues again as the probe does, and its tree.
      const setterNames = new Set(
        Object.entries(probed.signatures.commands)
          .filter(
            ([name, signature]) =>
              signature.kind === "template" && isSetter(probed.signatures.macros[name]),
          )
          .map(([name]) => name),
      );
      // A body read once builds one tree, so the preamble is read again for its own.
      const headRead = setterNames.size === 0 ? undefined : readBody(bodyOfText(body.preamble));
      const headTree =
        headRead === undefined || "refused" in headRead
          ? undefined
          : buildTree(headRead, probed.signatures);
      const head = headTree === undefined || "refused" in headTree ? undefined : headTree;
      const again = candidatesOf(built, {
        ...(head === undefined ? {} : { preamble: head }),
        setters: setterNames,
      });
      const same =
        again.candidates.length === probed.candidates.length &&
        again.candidates.every((each, i) => {
          const other = probed.candidates[i];
          return other?.id === each.id && other.start === each.start && other.end === each.end;
        });
      if (!same) return done({ outcome: "crashed", ...base, refused: "candidates" });

      // The probe's path, in its job, from the auxiliary files of the baseline compiled once more,
      // as every probe compile starts from them.
      const files = referenceFiles(taken, made, { job: JOB, treeImage });
      const setup = { session, engine, intake: taken, body, job: JOB, files };
      const path =
        probed.path === "format" && probed.format !== undefined
          ? formatPath(setup, probed.format)
          : wholePath(setup);
      const shipped = (name: string) => shippedFont(files, JOB, name);
      session.forget(JOB);
      const baseline = path.compile(built.source, "", 3);
      if (failed(baseline, 3)) return done({ outcome: "baseline", ...base, refused: "again" });
      for (const extension of AUXILIARY) {
        const name = `${JOB}.${extension}`;
        const bytes = session.written(JOB, name);
        if (bytes !== undefined) files[name] = bytes;
      }
      took("again");

      const bodyOut = {
        source: built.source,
        leaves: build.leavesOf(built),
        regen: build.regenerated(built.source, engine),
      };
      const preambleOut = {
        source: head?.source ?? "",
        leaves: head === undefined ? [] : build.leavesOf(head),
        regen: build.regenerated(head?.source ?? "", engine),
      };
      /**
       * The outline with `set` as its fields, written as the generator writes them, the rest as
       * kept text, and `edits` made to its body; and the preamble's calls that store a header's
       * text, issued again with the fields of `set` among their arguments, when it holds any.
       */
      const write = (set: readonly Candidate[], edits: readonly Edit[] = []) => {
        const written = build.writeOutline(
          bodyOut,
          set.filter((each) => each.where === "body"),
          edits,
        );
        const ours = set.filter((each) => each.where === "preamble");
        let unclean = written.unclean;
        const setters =
          ours.length === 0
            ? ""
            : again.setters
                .map((call: Span) => {
                  const issued = build.writeOutline(preambleOut, ours, [], call);
                  unclean += issued.unclean;
                  return `${issued.latex}\n`;
                })
                .join("");
        return { text: written.latex, setters, unclean };
      };

      // Check 1: the fields whose rewriting moves the page become kept text.
      const fields = probed.candidates.filter((each) => each.verdict === "editable");
      const owners = new Map<string, Candidate>(probed.candidates.map((each) => [each.id, each]));
      const broke = (log?: string, set: readonly Candidate[] = []): SetResult => ({
        broke: true,
        same: false,
        torn: false,
        own: new Map(),
        ...(log === undefined
          ? {}
          : { suspects: suspectsIn(log, new Set(set.map((each) => each.id))) }),
      });
      const settled = await settle(
        probeOrder(fields, owners),
        async (set) => {
          const { text, setters } = write(set);
          let result: ReturnType<typeof path.compile>;
          try {
            result = path.compile(text, setters, PROBE_PASSES, true);
          } catch {
            return broke();
          }
          if (failed(result, PROBE_PASSES) || result.output === undefined)
            return broke(result.log, set);
          try {
            return await observe(fonts, made, result.output, set, shipped);
          } catch {
            return broke();
          }
        },
        CHECK_BUDGET,
        owners,
      );
      took("check1");
      const final = fields.filter((each) => settled.verdicts.get(each.id)?.verdict === "editable");
      const kept: Record<string, number> = {};
      for (const each of fields) {
        const verdict = settled.verdicts.get(each.id)?.verdict ?? "untested";
        if (verdict !== "editable") kept[verdict] = (kept[verdict] ?? 0) + 1;
      }
      const unclean = write(fields).unclean;

      // Check 3: each group's copy of its last unit, and its removal of its first and its last.
      const groups = build.groupsOf(built, probed.signatures.macros);
      const finalBody = final.filter((each) => each.where === "body");
      const trials = build.trialsOf(built.source, groups, finalBody);
      const runs = probed.runs ?? [];
      const wanted = build.glyphKeys(made);
      let unitCompiles = 0;
      /** Why each trial that broke the page alone broke it, in glyphs (`brokenBy`). */
      const broken = new Map<Trial, { lost: number; left: number; added: number; pages: number }>();
      /** A batch of trials compiled together, and what its page came to against the reference. */
      const tryEdits = async (batch: readonly Trial[]): Promise<TrialVerdict | undefined> => {
        if (unitCompiles >= UNITS_BUDGET) return undefined;
        unitCompiles++;
        const { text, setters } = write(
          final,
          batch.map((each) => each.edit),
        );
        const out = batch.flatMap((each) =>
          each.edit.kind === "delete" ? [{ start: each.edit.start, end: each.edit.end }] : [],
        );
        let output: string[] | undefined;
        let pages = made.pages.length;
        try {
          const result = path.compile(text, setters, PROBE_PASSES, true);
          if (!failed(result, PROBE_PASSES) && result.output !== undefined) {
            const { stream } = await readOutput(fonts, result.output, shipped);
            output = build.glyphKeys(stream);
            pages = stream.pages.length;
          }
        } catch {
          output = undefined;
        }
        const kind = batch[0]?.kind ?? "copy";
        const role = build.rolesOf(made, runs, owners, out);
        const verdict = build.judged(kind, wanted, output, role);
        // Why a trial alone broke the page, in glyphs counted, for the record.
        const [only] = batch;
        if (
          verdict === "breaks" &&
          batch.length === 1 &&
          only !== undefined &&
          output !== undefined
        )
          broken.set(only, {
            ...build.brokenBy(kind, wanted, output, role),
            pages: pages - made.pages.length,
          });
        return verdict;
      };
      const verdicts = new Map<Trial, TrialVerdict | undefined>();
      for (const kind of ["copy", "first", "last"] as const satisfies readonly TrialKind[])
        for (const batch of build.batchesOf(trials.filter((each) => each.kind === kind)))
          for (const [trial, verdict] of await build.bisect(batch, tryEdits, build.keepsPage))
            verdicts.set(trial, verdict);
      took("units");
      /** Each group's trial of a kind; a group of one unit has one removal, its first and last. */
      const trialOf = (at: number, kind: TrialKind) =>
        trials.find((each) => each.group === at && each.kind === kind) ??
        (kind === "last" && groups[at]?.units.length === 1
          ? trials.find((each) => each.group === at && each.kind === "first")
          : undefined);
      const verdictOf = (at: number, kind: TrialKind) => {
        const trial = trialOf(at, kind);
        return trial === undefined ? undefined : verdicts.get(trial);
      };
      const passes = (kind: TrialKind) =>
        groups.filter((_, at) => build.keepsPage(verdictOf(at, kind))).length;
      /** How many groups' trials of each kind came to each verdict. */
      const tallies = Object.fromEntries(
        (["copy", "first", "last"] as const).map((kind) => {
          const counts: Record<string, number> = {};
          groups.forEach((_, at) => {
            const verdict = verdictOf(at, kind) ?? "untried";
            counts[verdict] = (counts[verdict] ?? 0) + 1;
          });
          return [kind, counts];
        }),
      );
      /** A group by its command's name, where it is plainly one, as the corpus's tables name them. */
      const nameOf = (group: (typeof groups)[number]) =>
        group.kind === "list"
          ? "items"
          : /^[A-Za-z@*]{1,63}$/.test(group.name.replace(/^section:/, ""))
            ? `\\${group.name.replace(/^section:/, "")}`
            : "?";
      const failing = groups.flatMap((group, at) =>
        (["copy", "first", "last"] as const).flatMap((kind) => {
          const verdict = verdictOf(at, kind);
          const trial = trialOf(at, kind);
          const why = trial === undefined ? undefined : broken.get(trial);
          return verdict === undefined || build.keepsPage(verdict)
            ? []
            : [
                {
                  group: nameOf(group),
                  units: group.units.length,
                  kind,
                  verdict,
                  ...(why === undefined ? {} : { glyphs: why }),
                },
              ];
        }),
      );
      const fieldIn = (span: { start: number; end: number }) =>
        finalBody.some((each) => each.start >= span.start && each.end <= span.end);

      const words = build.wordsOf({
        reference: made,
        runs,
        candidates: probed.candidates,
        fields: new Set(final.map((each) => each.id)),
        sources: { body: built.source, preamble: head?.source ?? "" },
      });
      took("words");
      done({
        outcome: "measured",
        ...base,
        fields: { probed: fields.length, kept, final: final.length, unclean },
        words,
        groups: {
          found: groups.length,
          lists: groups.filter((group) => group.kind === "list").length,
          runs: groups.filter((group) => group.kind === "run").length,
          units: groups.reduce((total, group) => total + group.units.length, 0),
          single: groups.filter((group) => group.units.length === 1).length,
          withField: groups.filter((group) => {
            const last = group.units.at(-1);
            return last !== undefined && fieldIn(last);
          }).length,
          copy: passes("copy"),
          first: passes("first"),
          last: passes("last"),
          all: groups.filter((_, at) =>
            (["copy", "first", "last"] as const).every((kind) =>
              build.keepsPage(verdictOf(at, kind)),
            ),
          ).length,
          untried: [...verdicts.values()].filter((each) => each === undefined).length,
          verdicts: tallies,
          failing,
        },
        compiles: {
          probe: probed.compiles,
          again: 1,
          check1: settled.compiles,
          units: unitCompiles,
        },
      });
    } catch {
      // What went wrong may quote the document, so it goes unsaid.
      done({ outcome: "crashed", engine, ...latinModern });
    } finally {
      session.forget(JOB);
      if (format !== undefined) session.dropFormat("pdftex", format);
    }
  });
  send({ type: "ready" });
}

main().catch(() => {
  // The parent counts a child that dies; what killed it may quote a document, so it goes unsaid.
  process.exit(1);
});
