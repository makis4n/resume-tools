import { describe, expect, test } from "vitest";
import type { RunFile } from "./corpus-run.ts";
import {
  documentTable,
  firstPassOf,
  importMs,
  type OutlineRow,
  unitsTable,
  wordsTable,
} from "./spike-outline-table.ts";

// Every row here is invented for these tests: ids in the corpus's shape and made-up counts.

/** A measured row, with its words, groups, compiles and times as given. */
function row(
  id: string,
  family: OutlineRow["family"],
  words: { fields: number; retype: number; locked: number },
  more: Partial<OutlineRow> = {},
): OutlineRow {
  const body = words.fields + words.retype + words.locked;
  return {
    version: 1,
    id,
    family,
    sample: false,
    outcome: "measured",
    engine: "pdftex",
    glyphs: { reference: 1000, covered: 900 },
    words: { body, probe: words.fields + 5, ...words, template: 3 },
    groups: {
      found: 4,
      lists: 1,
      runs: 3,
      units: 12,
      single: 0,
      withField: 4,
      copy: 4,
      first: 3,
      last: 4,
      all: 3,
      untried: 0,
    },
    compiles: { probe: 10, again: 1, check1: 2, units: 4 },
    ms: { total: 5000, again: 200, words: 10 },
    wall: 5100,
    ...more,
  };
}

const ROWS: OutlineRow[] = [
  row("jake-0101", "jake", { fields: 95, retype: 5, locked: 0 }),
  row("jake-0102", "jake", { fields: 50, retype: 30, locked: 20 }, { engine: "xetex" }),
  row("other-0101", "other", { fields: 10, retype: 10, locked: 80 }),
  {
    version: 1,
    id: "other-0102",
    family: "other",
    sample: false,
    outcome: "timeout",
    wall: 900000,
  },
  row("jake-0000", "jake", { fields: 89, retype: 10, locked: 1 }, { sample: true }),
];

const RUN: Pick<RunFile, "documents"> = {
  documents: [
    {
      id: "jake-0101",
      family: "jake",
      outcome: "partial",
      counted: { editable: 40, all: 100 },
      times: { wall: 0 },
    },
    { id: "jake-0102", family: "jake", outcome: "no answer", times: { wall: 0 } },
    {
      id: "other-0101",
      family: "other",
      outcome: "refused",
      refused: "difference",
      times: { wall: 0 },
    },
  ],
};

describe("the spike's tables", () => {
  test("read the first pass's words, none for a document it did not import, and the samples'", () => {
    const first = firstPassOf(RUN);
    expect(first.get("jake-0101")).toEqual({ editable: 40, all: 100 });
    expect(first.get("jake-0102")).toBe("none");
    expect(first.get("jake-0000")).toEqual({ editable: 323, all: 389 });
    expect(first.get("other-0102")).toBe(undefined);
  });

  test("give each family's shares of the words, its documents at the bar, and the first pass's", () => {
    const table = wordsTable(ROWS, firstPassOf(RUN));
    const lines = table.trimEnd().split("\n");
    // jake: 145 of 200 in fields, 35 retyped, 20 locked; one at 90%; the first pass 40 of 200.
    expect(lines).toContain("| jake | 2 of 2 | 200 | 72% | 17% | 10% | 1 | 90% | 77% | 20% |");
    expect(lines).toContain("| other | 1 of 2 | 100 | 10% | 10% | 80% | 0 | 90% | 15% | 0% |");
    expect(lines).toContain(
      "| The corpus's documents | 3 of 4 | 300 | 51% | 15% | 33% | 1 | 90% | 56% | 13% |",
    );
    expect(lines).toContain(
      "| jake-0000 (upstream) | 1 of 1 | 100 | 89% | 10% | 1% | 0 | 90% | 94% | 83% |",
    );
    expect(lines.at(-1)).toBe("| All | 4 of 5 | 400 | 61% | 13% | 25% | 1 | 90% | 66% | 52% |");
  });

  test("give each family's groups, their trials, its engines and its times", () => {
    const lines = unitsTable(ROWS).trimEnd().split("\n");
    expect(lines).toContain(
      "| jake | 8 | 24 | 8 | 6 | 8 | 6 | pdfTeX 1, XeTeX 1 | 16 | 4.8 s | 4.8 s |",
    );
    expect(importMs(ROWS[0] as OutlineRow)).toBe(4790);
  });

  test("give each document's line, and where one stopped", () => {
    const lines = documentTable(ROWS, firstPassOf(RUN)).trimEnd().split("\n");
    expect(lines).toContain(
      "| jake-0102 | XeTeX | 100 | 50% | 30% | 20% | 0% | 4 | 4 | 3 | 4 | 3 | 16 | 4.8 s |",
    );
    expect(lines).toContain("| other-0102 |  | timeout | | | | | | | | | | | 900.0 s |");
  });
});
