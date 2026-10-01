import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../src/engine/node";
import { readTree } from "../src/import/fonts";
import { treeImages } from "../src/import/intake";
import { isRefusal } from "../src/import/refusal";
import { reportOfImport, summaryOf } from "../src/import/report";
import { importResume, type NameRequest } from "../src/import/run";
import { nameOnService } from "../src/import/service";
import { FontLibrary } from "../src/page/fonts";
import { TexLiveIndex } from "../src/page/texlive";
import { handleName, LIMITS, type NameDeps, type ServiceCache } from "../src/service/name";
import { MemoryPreambleCache } from "../src/service/preamble";
import { MemoryRateStore } from "../src/service/rate";
import { Manifest, parseJson } from "./corpus-manifest";
import {
  compare,
  ORACLE_DIR,
  ORACLE_FILE,
  Oracle,
  type OracleDocument,
  oracleDocument,
  oracleManifest,
  oracleTable,
} from "./corpus-oracle";
import type { ProbeRow } from "./corpus-probe";
import { uploadOf } from "./corpus-reference";

// The sample and the row here are invented for these tests; the oracle's own file names the three
// upstream samples by their repositories, commits and hashes, never their text.

const invented: OracleDocument = {
  id: "jake-0000",
  family: "jake",
  repo: "invented/resume",
  repoId: 1,
  commit: "a".repeat(40),
  license: "MIT",
  main: "resume.tex",
  files: [{ path: "resume.tex", sha256: "b".repeat(64), bytes: 10 }],
  images: 0,
  expected: [
    { macro: "inventedentry", argument: 1, port: "marks", expected: "editable", why: "Invented." },
    {
      macro: "inventedentry",
      argument: 2,
      port: "marks",
      expected: "twice",
      or: ["vanished"],
      why: "Invented.",
    },
    { macro: "inventedphoto", argument: 1, port: "omits", expected: "locked", why: "Invented." },
    {
      macro: "inventedmissing",
      argument: 1,
      port: "marks",
      expected: "editable",
      why: "Invented.",
    },
    { standard: "item", port: "marks", expected: "editable", why: "Invented." },
  ],
};

const found: ProbeRow = {
  id: "jake-0000",
  family: "jake",
  outcome: "probed",
  arguments: [
    {
      of: "call",
      name: "inventedentry",
      index: 1,
      calls: 3,
      verdict: "moved",
      counts: { editable: 2, moved: 1 },
    },
    {
      of: "call",
      name: "inventedentry",
      index: 2,
      calls: 1,
      verdict: "vanished",
      counts: { vanished: 1 },
    },
    {
      of: "call",
      name: "inventedphoto",
      index: 1,
      calls: 1,
      verdict: "breaks",
      counts: { breaks: 1 },
    },
    {
      of: "call",
      name: "inventedextra",
      index: 1,
      calls: 1,
      verdict: "editable",
      counts: { editable: 1 },
    },
  ],
  standard: { item: { total: 2, editable: 2, verdict: "editable" } },
  wall: 1000,
};

describe("the oracle", () => {
  test("names the three launch templates' samples, each file with its hash, and what to expect", () => {
    const oracle = parseJson(Oracle, readFileSync(ORACLE_FILE, "utf8"), ORACLE_FILE);
    expect(oracle.documents.map((doc) => [doc.id, doc.repo])).toEqual([
      ["jake-0000", "jakegut/resume"],
      ["altacv-0000", "liantze/AltaCV"],
      ["awesome-cv-0000", "posquit0/Awesome-CV"],
    ]);
    for (const doc of oracle.documents) {
      expect(doc.expected.length).toBeGreaterThan(5);
      // An argument is listed once.
      const keys = doc.expected.map(
        (each) => `${each.macro ?? each.environment ?? each.standard} ${each.argument ?? ""}`,
      );
      expect(new Set(keys).size).toBe(keys.length);
    }
    // As a manifest, the oracle is one `corpus fetch` takes: a document it makes a folder for, with
    // no fonts, whose files are paths it writes. AltaCV's sample inputs a `.cfg`, which the corpus's
    // own manifest does not collect, so the oracle's documents are checked as a fetch needs them.
    const manifest = oracleManifest(oracle, "2026-09-27");
    for (const doc of manifest.documents) {
      expect(doc.id).toMatch(/^[a-z]+(?:-[a-z]+)*-\d{4}$/);
      expect(doc).toMatchObject({ assets: [] });
      expect(
        Manifest.shape.documents.safeParse([
          {
            ...doc,
            files: doc.withdrawn ? [] : doc.files.filter((file) => !file.path.endsWith(".cfg")),
          },
        ]).success,
      ).toBe(true);
    }
  });

  test("refuses an entry that names no argument, or two subjects", () => {
    const entry = { port: "marks", expected: "editable", why: "Invented." };
    const bad = (expected: object) =>
      Oracle.safeParse({ version: 1, documents: [{ ...invented, expected: [expected] }] }).success;
    expect(bad({ ...entry, macro: "inventedentry" })).toBe(false);
    expect(bad({ ...entry, macro: "inventedentry", standard: "item" })).toBe(false);
    expect(bad({ ...entry, standard: "item", argument: 1 })).toBe(false);
    expect(bad({ ...entry, macro: "inventedentry", argument: 1 })).toBe(true);
  });

  test("compares expected verdicts with found ones, one line each, and lists what it does not name", () => {
    const lines = compare(invented, found);
    expect(
      lines.map(({ subject, expected, found: got, agrees }) => ({
        subject,
        expected,
        got,
        agrees,
      })),
    ).toEqual([
      {
        subject: "\\inventedentry #1",
        expected: "editable",
        got: "moved (1 of 3; 2 editable)",
        agrees: false,
      },
      {
        subject: "\\inventedentry #2",
        expected: "twice or vanished",
        got: "vanished (1 of 1)",
        agrees: true,
      },
      { subject: "\\inventedphoto #1", expected: "locked", got: "breaks (1 of 1)", agrees: true },
      { subject: "\\inventedmissing #1", expected: "editable", got: "absent", agrees: false },
      {
        subject: "item (standard)",
        expected: "editable",
        got: "editable (2 of 2 editable)",
        agrees: true,
      },
      {
        subject: "\\inventedextra #1",
        expected: "not in the oracle",
        got: "editable (1 of 1)",
        agrees: false,
      },
    ]);
    expect(oracleTable(lines)).toContain("Disagreements: 3 of 6.");
    expect(oracleTable(lines)).toContain(
      "| jake | `\\inventedphoto #1` | omits | locked | breaks (1 of 1) | agrees |",
    );
    // With no probe, every line disagrees.
    expect(compare(invented, undefined).every((line) => !line.agrees)).toBe(true);
    expect(oracleDocument(invented)).not.toHaveProperty("expected");
  });
});

/** Whether this machine has fetched the oracle's samples, which `corpus oracle` fetches. */
const fetched = existsSync(join(ORACLE_DIR, "jake-0000", "resume.tex"));

/**
 * Each upstream sample's words as item 13's report reads them from its page (decision 0039): those
 * editable on the page, the resume's in all, and the template's own. They are the report's counts
 * on this commit, through the import the browser runs, and no hand count's: a hand count of each
 * page is owed (decision 0039), and the owner decides how it is made; until then they hold the
 * report to what it counts now, within two words.
 */
const SAMPLE_COUNTS: Readonly<
  Record<string, { editable: number; body: number; template: number; outcome: string }>
> = {
  "jake-0000": { editable: 323, body: 389, template: 0, outcome: "partial" },
  "altacv-0000": { editable: 67, body: 232, template: 0, outcome: "partial" },
  "awesome-cv-0000": { editable: 1023, body: 1269, template: 18, outcome: "partial" },
};

describe.skipIf(!fetched || !engineAvailable())(
  "the report on the oracle's samples (decision 0039)",
  () => {
    /** The committed answers, which the naming route reads first. */
    const answers = fileURLToPath(new URL("../corpus/answers/", import.meta.url));
    const committed: ServiceCache = {
      get: (key) => {
        const path = join(answers, `${key}.json`);
        return /^[0-9a-f]{64}$/.test(key) && existsSync(path)
          ? readFileSync(path, "utf8")
          : undefined;
      },
      put: () => false,
    };
    const service: NameDeps = {
      cache: committed,
      preambles: new MemoryPreambleCache(),
      model: undefined,
      rates: new MemoryRateStore(),
      limits: LIMITS,
      now: Date.now,
      address: "127.0.0.1",
    };
    /** The naming step as the dev server answers it with no key: the committed answers alone. */
    const naming: NameRequest = (request, names, signal) =>
      nameOnService(
        request,
        (input, init) => handleName(new Request(new URL(input, "http://localhost"), init), service),
        signal,
        names,
      );

    for (const [id, counts] of Object.entries(SAMPLE_COUNTS))
      test(`reads ${id}'s words within two of its counts, and shows no command`, async () => {
        const oracle = Oracle.parse(JSON.parse(readFileSync(ORACLE_FILE, "utf8")));
        const doc = oracle.documents.find((each) => each.id === id);
        if (doc === undefined) throw new Error(`${id} is no oracle sample`);
        const manifest = JSON.parse(
          readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
        ) as EngineManifest;
        const zip = uploadOf(
          oracleDocument(doc),
          (path) => new Uint8Array(readFileSync(join(ORACLE_DIR, doc.id, ...path.split("/")))),
          () => undefined,
        );
        const outcome = await importResume([{ name: `${id}.zip`, bytes: zip }], {
          session: await startNodeSession(),
          fonts: new FontLibrary(new TexLiveIndex(manifest), async (path) =>
            readFileSync(join(ENGINE_DIR, "files", path)),
          ),
          tree: readTree(manifest.files, manifest.fonts),
          treeImage: treeImages(
            manifest.files,
            (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
          ),
          name: naming,
        });
        if (isRefusal(outcome)) throw new Error(`${id} refused: ${outcome.reason}`);
        const report = reportOfImport(outcome);
        // Numbers alone in what fails: a sample's text never reaches the test's output.
        expect(Math.abs(report.words.editable - counts.editable), "editable").toBeLessThanOrEqual(
          2,
        );
        expect(Math.abs(report.words.body - counts.body), "the resume's").toBeLessThanOrEqual(2);
        expect(
          Math.abs(report.words.template - counts.template),
          "the template's",
        ).toBeLessThanOrEqual(2);
        expect(report.outcome).toBe(counts.outcome);
        const strings = [
          summaryOf(report),
          ...report.locked.flatMap((each) => [each.words, each.why]),
          ...report.dropped.map((each) => each.text),
          ...report.notes,
        ];
        expect(strings.filter((each) => /[\\{}]/.test(each)).length, "a backslash or a brace").toBe(
          0,
        );
      }, 300_000);
  },
);
