import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../src/engine/node";
import { readTree } from "../src/import/fonts";
import { treeImages } from "../src/import/intake";
import { isRefusal } from "../src/import/refusal";
import { reportOfImport } from "../src/import/report";
import { importResume } from "../src/import/run";
import { FontLibrary } from "../src/page/fonts";
import { TexLiveIndex } from "../src/page/texlive";
import { generateBody } from "../src/templates/generate";
import { ORACLE_DIR, ORACLE_FILE, Oracle, oracleDocument } from "./corpus-oracle";
import { uploadOf } from "./corpus-reference";

// The second pass's item 5 (decision 0049): each upstream sample imported as the browser imports a
// resume, through `importResume` on a session of its own, as an outline, with no naming step. The
// naming step's modules, the assembly and the first pass's checks cannot even be loaded here, and
// of the naming package only its masking can be read: a `.tex` import that reached any of the rest
// would fail. Numbers alone, ids and counts, reach
// the test's output: a sample's text never does, nor does a compile's log, which may quote it.

const { loaded } = vi.hoisted(() => ({
  loaded: (name: string) => () => {
    throw new Error(`a .tex import loaded ${name}, which it must not reach`);
  },
}));
// The naming contract's masking of a definition's personal data, which the signatures step applies
// to what it reads of the template's macros, is the one thing of the naming package it may use;
// any other export, a request's schema, a key or a version, throws as it is read.
vi.mock("@resume-tools/naming", async (importOriginal) => ({
  maskDefinition: (await importOriginal<typeof import("@resume-tools/naming")>()).maskDefinition,
}));
vi.mock("../src/import/naming", loaded("the naming request's builder"));
vi.mock("../src/import/service", loaded("the naming service's client"));
vi.mock("../src/import/assemble", loaded("the first pass's assembly"));
vi.mock("../src/import/validate", loaded("the first pass's checks"));

/** Whether this machine has fetched the oracle's samples, which `corpus oracle` fetches. */
const fetched = existsSync(join(ORACLE_DIR, "jake-0000", "resume.tex"));

/**
 * Each upstream sample's words as item 13's report reads them from its page (decision 0039): the
 * resume's in all, as the hand counts of each page have them (decision 0039, 2026-10-03), which the
 * import's count matches within two; and the share the spike found in fields (decision 0050), which
 * the outline holds at least, less two points.
 */
const SAMPLES: Readonly<Record<string, { body: number; fields: number }>> = {
  "jake-0000": { body: 389, fields: 0.89 },
  "altacv-0000": { body: 232, fields: 0.72 },
  "awesome-cv-0000": { body: 1287, fields: 0.96 },
};

/** The engine's tree, as the page and the import read it. */
const engineManifest = () =>
  JSON.parse(readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8")) as EngineManifest;

describe.skipIf(!fetched || !engineAvailable())(
  "the oracle's samples, imported as outlines (decision 0049)",
  () => {
    for (const [id, expected] of Object.entries(SAMPLES))
      test(`imports ${id} with no naming step, its outline compiles, and counts its words`, async () => {
        const oracle = Oracle.parse(JSON.parse(readFileSync(ORACLE_FILE, "utf8")));
        const doc = oracle.documents.find((each) => each.id === id);
        if (doc === undefined) throw new Error(`${id} is no oracle sample`);
        const manifest = engineManifest();
        const zip = uploadOf(
          oracleDocument(doc),
          (path) => new Uint8Array(readFileSync(join(ORACLE_DIR, doc.id, ...path.split("/")))),
          () => undefined,
        );
        const session = await startNodeSession();
        const outcome = await importResume([{ name: `${id}.zip`, bytes: zip }], {
          session,
          fonts: new FontLibrary(new TexLiveIndex(manifest), async (path) =>
            readFileSync(join(ENGINE_DIR, "files", path)),
          ),
          tree: readTree(manifest.files, manifest.fonts),
          treeImage: treeImages(
            manifest.files,
            (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
          ),
        });
        if (isRefusal(outcome)) throw new Error(`${id} refused: ${outcome.reason}`);
        const { words } = outcome.report.outline;
        // The words in fields, in kept text the retype reaches, and locked, which item 6 pins.
        console.info(
          `${id}: ${words.body} words, ${words.fields} in fields, ${words.retype} in kept text the retype reaches, ${words.locked} locked; ${outcome.report.outline.fields} fields, ${outcome.report.outline.groups} groups of ${outcome.report.outline.units} units; ${outcome.report.compiles} compiles, ${Math.round(outcome.report.ms)} ms`,
        );
        expect(Math.abs(words.body - expected.body), "the resume's words").toBeLessThanOrEqual(2);
        expect(words.template, "the template's words").toBe(0);
        expect(words.fields + words.retype + words.locked).toBe(words.body);
        expect(words.fields / words.body, "the share in fields").toBeGreaterThanOrEqual(
          expected.fields - 0.02,
        );
        expect(outcome.report.outline.groups, "groups of units").toBeGreaterThan(5);
        // The outline compiled as the editor will compile it sets the reference's page.
        expect(outcome.report.checks.outcome, "the outline's page").toBe("assembled");
        expect(outcome.document.resume.sections.map((section) => section.kind)).toEqual([
          "outline",
        ]);
        // And it compiles again from the format the import hands the editor, in the editor's job,
        // given what the import keeps for its compiles.
        const [format] = outcome.formats ?? [];
        if (format === undefined) throw new Error(`${id} handed over no format`);
        const pkg = outcome.package;
        session.putFormat(pkg.engine, format.name, format.format);
        const { job } = outcome;
        const result = session.compile(
          pkg.engine,
          format.name,
          generateBody(pkg, outcome.document.resume, {}).latex,
          {
            job: "doc",
            maxPasses: 3,
            files: { ...job.files, ...(job.bbl === undefined ? {} : { "doc.bbl": job.bbl }) },
          },
        );
        expect(result.ok, "the document compiles in the editor's job").toBe(true);
        // The report says what is editable and what is kept in plain words, no command among them.
        const report = reportOfImport(outcome);
        expect(report.words.editable).toBe(words.fields);
        expect(
          report.locked.filter((each) => /[\\{}]/.test(each.words)).length,
          "a backslash or a brace",
        ).toBe(0);
      }, 60_000);
  },
);
