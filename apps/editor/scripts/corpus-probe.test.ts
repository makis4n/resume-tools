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
    expect(lineOf("Documents whose body parsed")).toBe(
      "| Documents whose body parsed | 1 | 1 | 0 | 0 | 0 | 2 | 4 |",
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
    ms: 900.7,
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

  test("says when the body unmarked did not set the reference's glyphs", () => {
    expect(
      probeRow({ ...found, path: "whole", fallback: "baseline", baseline: "position" }),
    ).toMatchObject({
      outcome: "baseline",
      baseline: "position",
    });
  });
});
