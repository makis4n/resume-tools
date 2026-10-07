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
// resume, through `importResume` on a session of its own, as an outline, with no naming step: the
// model's provider code cannot even be loaded here, and a `.tex` import that reached it would fail.
// Numbers alone, ids and counts, reach the test's output: a sample's text never does, nor does
// a compile's log, which may quote it.

const { loaded } = vi.hoisted(() => ({
  loaded: (name: string) => () => {
    throw new Error(`a .tex import loaded ${name}, which it must not reach`);
  },
}));
vi.mock("@resume-tools/naming/providers", loaded("the model's provider code"));

/** Whether this machine has fetched the oracle's samples, which `corpus oracle` fetches. */
const fetched = existsSync(join(ORACLE_DIR, "jake-0000", "resume.tex"));

/**
 * Each upstream sample's words as item 13's report reads them from its page (decision 0039): the
 * resume's in all, as the hand counts of each page have them (decision 0039, 2026-10-03), which the
 * import's count matches within two; the share the spike found in fields (decision 0050), which
 * the outline holds at least, less two points; and, pinned, the report's three shares after the
 * checks (the second pass's item 6), in words: editable in place, changeable through the retype,
 * and locked; the same three counted by hand on each page (the second pass's item 9): each word on
 * the reference's page read line by line and put in a field the editor's page marks, in a run of
 * plain text of the kept LaTeX that lines up with the page (decision 0042's retype), or neither,
 * which the report's shares match within two; and the fields the checks found required.
 */
const SAMPLES: Readonly<
  Record<
    string,
    {
      body: number;
      fields: number;
      shares: { editable: number; retype: number; locked: number };
      hand: { editable: number; retype: number; locked: number };
      required: number;
    }
  >
> = {
  "jake-0000": {
    body: 389,
    fields: 0.89,
    // Since a field a line (decision 00XX), the skills block's three lines after its first are
    // fields: 27 words by hand.
    shares: { editable: 378, retype: 11, locked: 0 },
    hand: { editable: 376, retype: 13, locked: 0 },
    // Those three lines: the template sets `\raggedright` for the whole document, where `\\` ends
    // the paragraph, so a line between two breaks, emptied, leaves the next nothing to end.
    required: 3,
  },
  "altacv-0000": {
    body: 232,
    fields: 0.72,
    // Since a field a line (decision 00XX), each referee's second address line is a field: 6 words.
    shares: { editable: 174, retype: 45, locked: 13 },
    hand: { editable: 174, retype: 45, locked: 13 },
    required: 10,
  },
  "awesome-cv-0000": {
    body: 1287,
    fields: 0.96,
    shares: { editable: 1246, retype: 23, locked: 18 },
    hand: { editable: 1246, retype: 23, locked: 18 },
    required: 3,
  },
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
        const o = outcome.report.outline;
        const shown = reportOfImport(outcome);
        console.info(
          `${id}: ${words.body} words, ${words.fields} in fields, ${words.retype} in kept text the retype reaches, ${words.locked} locked; report ${JSON.stringify(shown.words)} ${JSON.stringify(shown.shares)}; ${o.fields} fields, ${o.required} required, kept ${JSON.stringify(o.kept)}; ${o.groups} groups of ${o.units} units, fixed ${JSON.stringify(o.fixed)}, trials ${JSON.stringify(o.trials)}; outcome ${outcome.report.checks.outcome}; checks ${outcome.report.checks.compiles} compiles ${Math.round(outcome.report.checks.ms)} ms; ${outcome.report.compiles} compiles, ${Math.round(outcome.report.ms)} ms; notes ${JSON.stringify(shown.notes)}; ${JSON.stringify(outcome.report.checks.findings)}`,
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
        // The checks' report, pinned: the three shares in words, what the checks kept and required,
        // and every group taking a copy and, where it has two units or more, both removals.
        expect({
          editable: shown.words.editable,
          retype: shown.words.retype,
          locked: shown.words.locked,
        }).toEqual(expected.shares);
        expect(shown.words.body).toBe(words.body);
        // Item 9's hand counts, taken apart from the report, which its shares match within two.
        for (const share of ["editable", "retype", "locked"] as const)
          expect(
            Math.abs(shown.words[share] - expected.hand[share]),
            `the ${share} share against the hand count`,
          ).toBeLessThanOrEqual(2);
        expect(o.kept, "fields the checks kept as text").toEqual({});
        expect(o.required, "required fields").toBe(expected.required);
        expect(o.fixed, "fixed groups").toEqual({});
        expect(o.trials.copy).toBe(o.groups);
        expect(o.scripts).toEqual({ greek: true, cyrillic: true });
        expect(shown.notes.join(" ")).not.toMatch(/[\\{}]/);
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
      }, 180_000); // AltaCV's import alone takes about 48 s; a loaded machine or CI more than doubles it.
  },
);
