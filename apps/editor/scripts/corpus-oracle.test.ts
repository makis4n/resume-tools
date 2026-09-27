import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { Manifest, parseJson } from "./corpus-manifest";
import {
  compare,
  ORACLE_FILE,
  Oracle,
  type OracleDocument,
  oracleDocument,
  oracleManifest,
  oracleTable,
} from "./corpus-oracle";
import type { ProbeRow } from "./corpus-probe";

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
