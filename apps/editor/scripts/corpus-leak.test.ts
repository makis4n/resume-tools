import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NamingRequest } from "@resume-tools/naming";
import { describe, expect, test } from "vitest";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable } from "../src/engine/node";
import type { Leak } from "../src/import/naming";
import {
  checkCorpus,
  failed,
  type LeakRow,
  leakCounts,
  leakFindings,
  leakHeadline,
  leakLine,
  leakTable,
  passed,
} from "./corpus-leak";
import {
  CORPUS_DIR,
  FETCH_REPORT_FILE,
  FetchReport,
  isLive,
  MANIFEST_FILE,
  Manifest,
  matchingEntries,
  parseJson,
} from "./corpus-manifest";
import { treeFonts, uploadOf } from "./corpus-reference";

// The rows, macros and counts here are invented, but for the block that runs the leak check over
// the corpus when a machine has fetched it, which prints names and counts alone.

/** An invented request's definitions: the tree's and the document's own, masked or not. */
const definitions: NamingRequest["definitions"] = [
  { kind: "definition", name: "cvtree", hash: "a".repeat(64), text: "macro:->\\hfill " },
  { kind: "definition", name: "cvown", hash: "b".repeat(64), text: "macro:->Xxxxx " },
  { kind: "definition", name: "cvpaged", hash: "c".repeat(64), text: "macro:->Xxxxxxxx " },
  { kind: "definition", name: "cvplain", hash: "d".repeat(64), text: "macro:->\\par " },
  { kind: "data", name: "@firstname" },
];

describe("the leak runner's counts and findings", () => {
  test("count the own definitions the document's values masked, and those the page masked more of", () => {
    const meanings: Record<string, string> = {
      cvtree: "macro:->\\hfill ",
      cvown: "macro:->Quill ",
      cvpaged: "macro:->Invented ",
      cvplain: "macro:->\\par ",
    };
    const unpaged = definitions.map((each) =>
      each.name === "cvpaged" && each.kind === "definition"
        ? { ...each, text: "macro:->Invented " }
        : each,
    );
    expect(
      leakCounts(
        { macros: [], definitions },
        { definitions: unpaged },
        (name) => meanings[name],
        (name) => name !== "cvtree",
        { first: "Quill", last: "Invented", links: [] },
      ),
    ).toEqual({ macros: 0, definitions: 4, own: 3, masked: 2, byPage: 1, header: 3 });
  });

  test("name each leak's place and kind of text once, and a macro only by a plain name", () => {
    const leaks: Leak[] = [
      { origin: "page", kind: "own definition", macro: "cvcontact", where: "the definition of x" },
      { origin: "page", kind: "own definition", macro: "cvcontact", where: "the definition of y" },
      { origin: "stored", kind: "tree definition", macro: "ecv@rfoot", where: "the definition" },
      { origin: "raw", kind: "call site", macro: "not a name!", where: "call site 1" },
      { origin: "header", kind: "setting", where: "setting 2" },
    ];
    const findings = leakFindings(leaks);
    expect(findings).toEqual([
      { kind: "own definition", macro: "\\cvcontact", origin: "page" },
      { kind: "tree definition", macro: "\\ecv@rfoot", origin: "stored" },
      { kind: "call site", origin: "raw" },
      { kind: "setting", origin: "header" },
    ]);
    const row: LeakRow = { id: "other-0001", family: "other", outcome: "checked", findings };
    expect(leakLine({ ...row, engine: "pdftex" })).toBe(
      "pdftex, FAILS: the page's text in the own definition of `\\cvcontact`; a stored text in the tree's definition of `\\ecv@rfoot`; a raw chunk's text in a call site of a macro whose name is not plain; a header value in a setting",
    );
  });
});

describe("the leak runner's table", () => {
  const counts = { macros: 9, definitions: 20, own: 5, masked: 2, byPage: 1, header: 0 };
  const rows: LeakRow[] = [
    { id: "jake-0001", family: "jake", outcome: "checked", engine: "pdftex", counts },
    {
      id: "europecv-0001",
      family: "europecv",
      outcome: "checked",
      engine: "pdftex",
      counts: { ...counts, header: 2 },
      findings: [{ kind: "tree definition", macro: "\\ecv@rfoot", origin: "stored" }],
    },
    { id: "other-0001", family: "other", outcome: "no reference" },
    { id: "other-0002", family: "other", outcome: "timeout" },
  ];

  test("counts what became of the documents, and names each failure's leaks, never the text", () => {
    expect(rows.filter(passed).map((row) => row.id)).toEqual(["jake-0001"]);
    expect(rows.filter(failed).map((row) => row.id)).toEqual(["europecv-0001"]);
    expect(leakHeadline(rows)).toBe("2 documents checked: 1 passed, 1 failed.");
    const table = leakTable(rows);
    expect(table).toContain("| Checked | 1 | 0 | 0 | 0 | 1 | 0 | 2 |");
    expect(table).toContain("| **Failed** | 0 | 0 | 0 | 0 | 1 | 0 | 1 |");
    expect(table).toContain("| Crashed or timed out | 0 | 0 | 0 | 0 | 0 | 1 | 1 |");
    expect(table).toContain("| Masked further by the page | 1 | 0 | 0 | 0 | 1 | 0 | 2 |");
    expect(table).toContain("| With the header's values found | 0 | 0 | 0 | 0 | 1 | 0 | 1 |");
    expect(table).toContain(
      "europecv-0001: a stored text in the tree's definition of `\\ecv@rfoot`.",
    );
    expect(table.trimEnd().endsWith("2 documents checked: 1 passed, 1 failed.")).toBe(true);
    expect(leakLine(rows[2] as LeakRow)).toBe("no reference");
  });
});

/** Whether this machine has fetched the corpus, which `corpus fetch` fetches. */
const fetched = existsSync(FETCH_REPORT_FILE);
if (!fetched)
  console.info(
    "The leak check over the corpus is skipped: .corpus/ is absent, and `corpus fetch` fetches it",
  );

describe.skipIf(!fetched || !engineAvailable())("the corpus's naming requests", () => {
  // Each document that compiles and parses, its request built as the import builds it and checked
  // with the detector fed its sources, its page, its stored texts and its header's values, as
  // `corpus leak` does; what fails is named by its macros and kinds of text alone.
  test("hold none of their documents' text", async () => {
    const manifest = parseJson(Manifest, readFileSync(MANIFEST_FILE, "utf8"), MANIFEST_FILE);
    const report = parseJson(
      FetchReport,
      readFileSync(FETCH_REPORT_FILE, "utf8"),
      FETCH_REPORT_FILE,
    );
    const entries = matchingEntries(manifest, report);
    const documents = manifest.documents
      .filter(isLive)
      .filter((doc) => entries.get(doc.id)?.state === "fetched");
    const engine = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    const treeFont = treeFonts(engine.files);
    const byId = new Map(documents.map((doc) => [doc.id, doc]));
    const rows = await checkCorpus({
      documents,
      upload: (id) => {
        const doc = byId.get(id);
        if (doc === undefined) throw new Error(`${id} is no fetched document`);
        return uploadOf(
          doc,
          (path) => new Uint8Array(readFileSync(join(CORPUS_DIR, doc.id, ...path.split("/")))),
          treeFont,
        );
      },
    });
    expect(rows.some((row) => row.outcome === "checked")).toBe(true);
    expect(rows.filter(failed).map((row) => `${row.id}: ${leakLine(row)}`)).toEqual([]);
  }, 1_800_000);
});
