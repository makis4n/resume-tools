import { describe, expect, test } from "vitest";
import type { Probe, ProbeCandidate } from "../src/import/probe";
import {
  type ArgumentRow,
  type ProbeRow,
  probeNames,
  probeRow,
  probeTable,
  shownArgument,
} from "./corpus-probe";

// Every row and probe here is invented for these tests; SECRET stands for a document's text,
// which nothing the runner prints may show.

const SECRET = "Quillwort";

const row = (id: string, family: ProbeRow["family"], changes: Partial<ProbeRow>): ProbeRow => ({
  id,
  family,
  outcome: "probed",
  wall: 1000,
  ...changes,
});

const argument = (
  name: string,
  index: number,
  verdict: ArgumentRow["verdict"],
  extra: Partial<ArgumentRow> = {},
): ArgumentRow => ({
  of: "call",
  name,
  index,
  calls: 2,
  verdict,
  counts: { [verdict]: 2 },
  ...extra,
});

describe("the table", () => {
  const rows: ProbeRow[] = [
    row("jake-0001", "jake", {
      engine: "pdftex",
      path: "format",
      compiles: 5,
      candidates: { editable: 8, raw: 1, moved: 2 },
      arguments: [
        argument("inventedentry", 1, "editable"),
        argument("inventedentry", 2, "moved"),
        argument("inventeditem", 1, "editable", { empty: "moved" }),
        argument(`evil\n${SECRET}`, 1, "breaks"),
      ],
      standard: { section: { total: 3, editable: 3, verdict: "editable" } },
      glyphs: { reference: 1000, covered: 800, candidate: 150, raw: 30, chrome: 20 },
      dumpMs: 300,
      probeMs: 900,
    }),
    row("awesome-cv-0001", "awesome-cv", {
      engine: "xetex",
      path: "whole",
      compiles: 40,
      candidates: { editable: 3, misaligned: 4, untested: 2 },
      arguments: [
        argument("inventedentry", 1, "misaligned"),
        { ...argument("inventedlist", 1, "container"), of: "environment" },
      ],
      standard: { item: { total: 4, editable: 1, verdict: "moved" } },
      glyphs: { reference: 3000, covered: 1500, candidate: 1000, raw: 0, chrome: 500 },
      probeMs: 40_000,
    }),
    row("other-0001", "other", {
      outcome: "baseline",
      engine: "pdftex",
      path: "whole",
      fallback: "baseline",
      baseline: "position",
    }),
    row("other-0002", "other", { outcome: "no reference" }),
    row("other-0003", "other", { outcome: "timeout" }),
  ];
  const table = probeTable(rows);
  const lineOf = (label: string) =>
    table.split("\n").find((line) => line.startsWith(`| ${label} |`));

  test("counts what became of the documents, and the path each took", () => {
    // A document whose child timed out may never have reached the parser.
    expect(lineOf("Documents whose body parsed")).toBe(
      "| Documents whose body parsed | 1 | 1 | 0 | 0 | 0 | 1 | 3 |",
    );
    expect(lineOf("Probed")).toBe("| Probed | 1 | 1 | 0 | 0 | 0 | 0 | 2 |");
    expect(lineOf("Not probed: the body unmarked did not set the reference's glyphs")).toContain(
      "| 1 | 1 |",
    );
    expect(lineOf("Timed out or died")).toBe("| Timed out or died | 0 | 0 | 0 | 0 | 0 | 1 | 1 |");
    expect(lineOf("Path: from the document's format")).toBe(
      "| Path: from the document's format | 1 | 0 | 0 | 0 | 0 | 0 | 1 |",
    );
    expect(lineOf("Path: whole compiles, XeTeX")).toBe(
      "| Path: whole compiles, XeTeX | 0 | 1 | 0 | 0 | 0 | 0 | 1 |",
    );
    expect(lineOf("Compiles per document, most")).toBe(
      "| Compiles per document, most | 5 | 40 |  |  |  |  | 40 |",
    );
    expect(lineOf("The budget ran out")).toBe("| The budget ran out | 0 | 1 | 0 | 0 | 0 | 0 | 1 |");
  });

  test("counts candidates and arguments by verdict, and the macros editable throughout", () => {
    expect(lineOf("Editable")).toBe("| Editable | 8 | 3 | 0 | 0 | 0 | 0 | 11 |");
    expect(table).toContain("| `moved` | 2 | 0 | 0 | 0 | 0 | 0 | 2 |");
    expect(lineOf("Editable, but not when empty")).toBe(
      "| Editable, but not when empty | 1 | 0 | 0 | 0 | 0 | 0 | 1 |",
    );
    // Jake's entry has a moved argument, so its item alone is editable throughout; the environment
    // that holds structure is no field, and editable in none.
    expect(lineOf("Macros and environments every argument of which is editable")).toBe(
      "| Macros and environments every argument of which is editable | 1 of 3 | 0 of 2 | 0 | 0 | 0 | 0 | 1 of 5 |",
    );
    expect(lineOf("Section titles")).toBe(
      "| Section titles | 3 of 3 | 0 | 0 | 0 | 0 | 0 | 3 of 3 |",
    );
  });

  test("gives the share of the reference's glyphs covered, and what sets the rest", () => {
    expect(lineOf("Covered by editable fields")).toBe(
      "| Covered by editable fields | 80% | 50% |  |  |  |  | 58% |",
    );
    expect(lineOf("Set by the template alone")).toBe(
      "| Set by the template alone | 2% | 17% |  |  |  |  | 13% |",
    );
  });

  test("names locked and editable arguments only when their names are plainly names", () => {
    expect(table).toContain("| `\\inventedentry #2: moved` | 1 | 0 | 0 | 0 | 0 | 0 | 1 |");
    expect(table).toContain("| `\\inventedentry #1` | 1 | 0 | 0 | 0 | 0 | 0 | 1 |");
    expect(table).not.toContain(SECRET);
    expect(probeNames(rows)).toEqual({
      locked: { "\\inventedentry #1: misaligned": 1, "\\inventedentry #2: moved": 1 },
      editable: { "\\inventedentry #1": 1, "\\inventeditem #1": 1 },
    });
    expect(shownArgument({ of: "environment", name: "inventedlist", index: 1 })).toBe(
      "{inventedlist} #1",
    );
    expect(shownArgument({ of: "call", name: `x${SECRET} y`, index: 1 })).toBeUndefined();
  });
});

describe("a document the probe could not probe", () => {
  test("counts among those whose body parsed, and none of its verdicts counts", () => {
    const two: ProbeRow[] = [
      row("jake-0001", "jake", {
        engine: "pdftex",
        path: "format",
        compiles: 4,
        passes: 5,
        candidates: { editable: 3, moved: 1 },
        arguments: [argument("inventedentry", 1, "editable")],
        standard: { section: { total: 1, editable: 1, verdict: "editable" } },
        glyphs: { reference: 100, covered: 80, candidate: 10, raw: 5, chrome: 5 },
        dumpMs: 300,
        probeMs: 900,
      }),
      // As an earlier runner wrote the row of one whose baseline stopped: every candidate untested.
      row("jake-0002", "jake", {
        outcome: "baseline",
        engine: "pdftex",
        path: "whole",
        baseline: "stopped",
        compiles: 0,
        candidates: { untested: 7 },
        arguments: [argument("inventedentry", 1, "untested")],
        standard: { section: { total: 2, editable: 0, verdict: "untested" } },
        glyphs: { reference: 300, covered: 0, candidate: 0, raw: 0, chrome: 300 },
        dumpMs: 280,
        probeMs: 50,
      }),
    ];
    const table = probeTable(two);
    const lineIn = (label: string) =>
      table.split("\n").filter((line) => line.startsWith(`| ${label} |`));
    expect(lineIn("Documents whose body parsed")).toEqual([
      "| Documents whose body parsed | 2 | 0 | 0 | 0 | 0 | 0 | 2 |",
    ]);
    expect(lineIn("Probed")).toEqual(["| Probed | 1 | 0 | 0 | 0 | 0 | 0 | 1 |"]);
    expect(lineIn("Compiles per document, median")).toEqual([
      "| Compiles per document, median | 4 |  |  |  |  |  | 4 |",
    ]);
    expect(lineIn("Compiles that took a second pass")).toEqual([
      "| Compiles that took a second pass | 25% |  |  |  |  |  | 25% |",
    ]);
    // Its candidates, its arguments and its glyphs count nowhere.
    expect(lineIn("In all")).toEqual([
      "| In all | 4 | 0 | 0 | 0 | 0 | 0 | 4 |",
      "| In all | 1 | 0 | 0 | 0 | 0 | 0 | 1 |",
      "| In all | 100 | 0 | 0 | 0 | 0 | 0 | 100 |",
    ]);
    expect(lineIn("`untested`")).toEqual([
      "| `untested` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |",
      "| `untested` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |",
    ]);
    expect(lineIn("Section titles")).toEqual([
      "| Section titles | 1 of 1 | 0 | 0 | 0 | 0 | 0 | 1 of 1 |",
    ]);
    expect(lineIn("Covered by editable fields")).toEqual([
      "| Covered by editable fields | 80% |  |  |  |  |  | 80% |",
    ]);
    expect(lineIn("The probe, median")).toEqual([
      "| The probe, median | 900 ms |  |  |  |  |  | 900 ms |",
    ]);
    expect(probeNames(two)).toEqual({ locked: {}, editable: { "\\inventedentry #1": 1 } });
  });
});

describe("a probe's row", () => {
  const candidate = (
    id: string,
    verdict: ProbeCandidate["verdict"],
    extra: Partial<ProbeCandidate> = {},
  ): ProbeCandidate => ({
    id,
    kind: "argument",
    where: "body",
    of: "call",
    name: "inventedentry",
    index: 1,
    start: 0,
    end: 0,
    text: SECRET,
    empty: false,
    verdict,
    settled: "together",
    ...extra,
  });
  const found: Probe = {
    engine: "pdftex",
    path: "format",
    format: "import-0123abcd",
    dumpMs: 301.4,
    baselineMs: 120.6,
    compiles: 3,
    budget: 64,
    compileMs: 250.2,
    passes: 4,
    ms: 900.7,
    signatures: {
      engine: "pdftex",
      commands: {},
      environments: {},
      macros: {},
      truncated: false,
      ms: 80,
    },
    candidates: [
      candidate("c1-1", "editable"),
      candidate("c2-1", "moved"),
      candidate("t1", "editable", { kind: "paragraph", name: "", index: undefined, of: undefined }),
    ],
    macros: [
      {
        of: "call",
        name: "inventedentry",
        index: 1,
        calls: 2,
        verdict: "moved",
        counts: { editable: 1, moved: 1 },
      },
    ],
    standard: [
      { of: "standard", name: "paragraph", calls: 1, verdict: "editable", counts: { editable: 1 } },
    ],
    glyphs: { reference: 100, covered: 60 },
    uncovered: [
      {
        page: 0,
        from: 0,
        to: 30,
        first: { h: 0, v: 0 },
        last: { h: 0, v: 0 },
        by: "candidate",
        candidate: "c2-1",
      },
      { page: 0, from: 40, to: 50, first: { h: 0, v: 0 }, last: { h: 0, v: 0 }, by: "chrome" },
    ],
  };

  test("holds its counts and its macros' names, and never a candidate's text", () => {
    const made = probeRow(found);
    expect(made).toMatchObject({
      outcome: "probed",
      path: "format",
      compiles: 3,
      passes: 4,
      candidates: { editable: 2, moved: 1 },
      standard: { paragraph: { total: 1, editable: 1, verdict: "editable" } },
      glyphs: { reference: 100, covered: 60, candidate: 30, raw: 0, chrome: 10 },
      dumpMs: 301,
      probeMs: 901,
    });
    expect(made.arguments).toEqual([
      {
        of: "call",
        name: "inventedentry",
        index: 1,
        calls: 2,
        verdict: "moved",
        counts: { editable: 1, moved: 1 },
      },
    ]);
    expect(JSON.stringify(made)).not.toContain(SECRET);
  });

  test("says when the body unmarked did not set the reference's glyphs, and counts no verdicts", () => {
    const made = probeRow({ ...found, path: "whole", fallback: "baseline", baseline: "position" });
    expect(made).toMatchObject({ outcome: "baseline", baseline: "position", probeMs: 901 });
    for (const key of ["compiles", "passes", "candidates", "arguments", "standard", "glyphs"])
      expect(made, key).not.toHaveProperty(key);
  });
});
