import { describe, expect, test } from "vitest";
import {
  type ImportFile,
  type ImportRow,
  importHeadline,
  importLine,
  importSummary,
  importTable,
  refusedOutcome,
} from "./corpus-import";
import { Baseline, baselineFromFile, runDifferences } from "./corpus-run";

// The second pass's item 6: `corpus run` in its one mode. Every row here is invented: ids and
// counts, as the run keeps them.

/** An invented row: a document imported, with its words in the three shares. */
function row(id: string, changes: Partial<ImportRow> = {}): ImportRow {
  return {
    id,
    family: "jake",
    outcome: "success",
    engine: "pdftex",
    rate: 0.95,
    words: { body: 100, editable: 95, retype: 4, locked: 1, byReason: { raw: 1 } },
    fields: {
      editable: 20,
      required: 1,
      kept: { differs: 1 },
      stops: { long: 0, special: 0, empty: 1 },
      scripts: { greek: true, cyrillic: false },
    },
    groups: {
      found: 4,
      units: 12,
      fixed: { removal: 1 },
      trials: { copy: 4, first: 3, last: 4 },
    },
    compiles: { all: 30, checks: 12 },
    times: { steps: { probe: 1000, validate: 800 }, import: 3000, wall: 3100 },
    ...changes,
  };
}

const ROWS: ImportRow[] = [
  row("jake-0001"),
  row("jake-0002", {
    outcome: "partial",
    rate: 0.5,
    words: { body: 100, editable: 50, retype: 40, locked: 10, byReason: { twice: 10 } },
  }),
  row("altacv-0001", { family: "altacv", difference: "position", outcome: "partial" }),
  {
    id: "other-0001",
    family: "other",
    outcome: "refused",
    refused: "difference",
    step: "rewrite",
    times: { wall: 900 },
  },
  { id: "other-0002", family: "other", outcome: "timeout", times: { wall: 900_000 } },
];

describe("the run's outcome of a refusal", () => {
  test("is where it stopped: no reference, not parsed, not probed, or refused", () => {
    expect(refusedOutcome("intake", "intake")).toBe("no reference");
    expect(refusedOutcome("reference", "package")).toBe("no reference");
    expect(refusedOutcome("parse", "parse")).toBe("not parsed");
    expect(refusedOutcome("probe", "probe")).toBe("baseline");
    expect(refusedOutcome("rewrite", "difference")).toBe("refused");
    expect(refusedOutcome("validate", "stopped")).toBe("refused");
  });
});

describe("the run's summary, table and lines", () => {
  test("add up the documents imported in the report's three shares, and leave timeouts out", () => {
    const summary = importSummary(ROWS);
    expect(summary.outcomes).toMatchObject({ success: 1, partial: 2, refused: 1, timeout: 1 });
    expect(summary.words).toEqual({
      body: 300,
      editable: 240,
      retype: 48,
      locked: 12,
      byReason: { raw: 2, twice: 10 },
    });
    // One success in the four that did not time out.
    expect(summary.rates).toEqual({ success: 25, editable: 80, retype: 16, locked: 4 });
  });

  test("say it in a headline and a table of names and counts", () => {
    expect(importHeadline(ROWS)).toEqual([
      "5 documents, 1 of which timed out and counts in no share; of the 4 others, 1 success (25.0%), 2 partial (50.0%), 1 refused or stopped (25.0%): 1 refused, 0 with no reference, 0 not parsed, 0 not probed, 0 died.",
      "Words of the 3 documents imported, 300 words: 80.0% editable in place, 16.0% through the retype, 4.0% locked, by reason: twice 10, raw 2.",
      "pdfTeX: the page opened in 3 of 3 under 8 s, median 3.0 s, slowest 3.0 s; every field open in 3 of 3 under 8 s, median 3.0 s, slowest 3.0 s; the whole import in 3 of 3 under 8 s, median 3.0 s, slowest 3.0 s.",
    ]);
    const table = importTable(ROWS);
    expect(table).toContain("| Editable in place | 73% |  | 95% |");
    expect(table).toContain("| Refused or stopped: `difference` | 0 | 0 | 0 | 0 | 0 | 1 | 1 |");
    expect(table).toContain("| Partial, the first difference: `position` |");
    expect(table).toContain("| Fixed: `removal` | 2 | 0 | 1 | 0 | 0 | 0 | 3 |");
    expect(table).toContain("| Stop the compile with the empty text | 2 | 0 | 1 | 0 | 0 | 0 | 3 |");
    // Each script is counted apart: these fonts set Greek and lack Cyrillic.
    expect(table).toContain("| Documents whose fonts lack Greek | 0 | 0 | 0 | 0 | 0 | 0 | 0 |");
    expect(table).toContain("| Documents whose fonts lack Cyrillic | 2 | 0 | 1 | 0 | 0 | 0 | 3 |");
    expect(importLine(ROWS[0] as ImportRow)).toBe(
      "pdftex, success, 100 words: 95% in place, 4% retype, 1% locked; 20 fields, 1 required; 4 groups, 1 fixed; 30 compiles, 3.0 s",
    );
    expect(importLine(ROWS[3] as ImportRow)).toBe("refused (difference at rewrite)");
  });

  test("write a file `corpus compare` reads, and a baseline is adopted from, summed again", () => {
    const file: ImportFile = {
      version: 2,
      at: { date: "2026-10-04", commit: "c".repeat(40) },
      tree: { layout: 1, files: 1 },
      limitMs: 900_000,
      mode: { documents: "all" },
      complete: true,
      summary: importSummary(ROWS),
      documents: ROWS,
    };
    const again = { ...file, documents: ROWS.map((each) => ({ ...each, times: { wall: 1 } })) };
    expect(runDifferences(file, again)).toEqual([]);
    const none = Baseline.parse({ version: 1, run: null });
    const adopted = baselineFromFile<ImportRow>(file, none, importSummary, 2);
    expect(adopted.baseline?.run).toMatchObject({
      documents: 5,
      timeouts: 1,
      success: 1,
      rates: { success: 25, editable: 80 },
    });
    // A first pass's file, version 1, its rows of outcomes the outline's run never gives, is refused
    // in plain words, and never summed.
    const first = {
      ...file,
      version: 1,
      mode: { answers: "cache", cache: "invented-model", asked: null, documents: "all" },
      documents: [{ id: "jake-0001", family: "jake", outcome: "no answer", times: { wall: 1 } }],
    };
    expect(baselineFromFile<ImportRow>(first, none, importSummary, 2)).toEqual({
      line: "corpus/baseline.json is not written: the file is a first pass's run, and `corpus run` takes the outline's import now, whose runs are version 2.",
    });
    expect(baselineFromFile<ImportRow>({ ...file, version: 3 }, none, importSummary, 2).line).toBe(
      "corpus/baseline.json is not written: the file is no run of version 2, the one `corpus run` writes.",
    );
    // And a row of an outcome the run never gives counts in no outcome, never as a number that is not one.
    const odd = importSummary([{ ...(ROWS[0] as ImportRow), outcome: "no answer" as never }]);
    expect(Object.values(odd.outcomes).every(Number.isFinite)).toBe(true);
  });
});
