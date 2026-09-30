import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import type { AssemblyChecks } from "../src/import/assemble";
import {
  BASELINE_SLACK,
  Baseline,
  baselineOf,
  baselineVerdict,
  changedPaths,
  idsOf,
  nextBaseline,
  outcomeOf,
  type RunRow,
  runDifferences,
  runHeadline,
  runLine,
  runRowOf,
  runTable,
  SUCCESS_RATE,
  summaryOf,
} from "./corpus-run";

// Every row, count and id here is invented for these tests; SECRET stands for a document's text,
// which nothing the runner prints or writes may show.

const SECRET = "Quillwort Larkfield";

/** An assembly's checks, as validation gives them: nine words in ten editable, unless changed. */
const checks = (changes: Partial<AssemblyChecks> = {}): AssemblyChecks => ({
  outcome: "assembled",
  fields: { editable: 9, raw: 1, required: 1, locked: { date: 1 } },
  words: { editable: 90, locked: { date: 10 } },
  sections: { mapped: 3, locked: 1 },
  required: ["command|cventry|1"],
  controls: { offered: ["pageSize", "fontSize"], proven: ["pageSize"], dropped: [] },
  redefinitions: { applied: ["cvtag"], dropped: ["cvevent"], placement: "class" },
  repeatable: [{ kind: "entry", added: true, removed: true }],
  findings: [{ check: "pdf", message: `the title ${SECRET} is in capitals`, field: "ent-1.title" }],
  compiles: 20,
  ms: 1000,
  decisions: {},
  all: [],
  ...changes,
});

describe("the outcome and the editable rate", () => {
  test("is a success where the first check holds and nine words in ten or more are editable", () => {
    expect(outcomeOf({ checks: checks() })).toEqual({ outcome: "success", rate: 0.9 });
    expect(SUCCESS_RATE).toBe(0.9);
    const short = outcomeOf({ checks: checks({ words: { editable: 89, locked: { date: 11 } } }) });
    expect(short).toEqual({ outcome: "partial", rate: 0.89 });
  });

  test("is partial where the first check differs, however many words are editable", () => {
    const all = { editable: 100, locked: {} };
    expect(outcomeOf({ checks: checks({ outcome: "partial", words: all }) })).toEqual({
      outcome: "partial",
      rate: 1,
    });
  });

  test("counts every locked word, of every reason, and takes a document of no words as none", () => {
    const words = { editable: 60, locked: { unmapped: 30, shape: 5, date: 5 } };
    expect(outcomeOf({ checks: checks({ words }) }).rate).toBe(0.6);
    expect(outcomeOf({ checks: checks({ words: { editable: 0, locked: {} } }) })).toEqual({
      outcome: "partial",
      rate: 0,
    });
  });

  test("goes into a row with the assembly's counts, names of closed lists and numbers only", () => {
    const row = runRowOf({ checks: checks() }, "pdftex", {
      probeCompiles: 7,
      times: { probe: 1200, checks: 3400 },
    });
    expect(row).toMatchObject({
      outcome: "success",
      engine: "pdftex",
      rate: 0.9,
      fields: { editable: 9, raw: 1, required: 1, locked: { date: 1 } },
      words: { editable: 90, locked: { date: 10 } },
      controls: { proven: ["pageSize"], dropped: [] },
      redefinitions: { applied: 1, dropped: 1 },
      findings: { pdf: 1 },
      compiles: { probe: 7, checks: 20 },
      times: { probe: 1200, checks: 3400 },
    });
    expect(JSON.stringify(row)).not.toContain("Quillwort");
  });
});

const row = (id: string, family: RunRow["family"], changes: Partial<RunRow>): RunRow => ({
  id,
  family,
  outcome: "partial",
  times: { wall: 1000 },
  ...changes,
});

const ROWS: RunRow[] = [
  row("jake-0001", "jake", {
    outcome: "success",
    engine: "pdftex",
    rate: 0.95,
    words: { editable: 95, locked: { date: 5 } },
    fields: { editable: 10, raw: 0, required: 0, locked: { date: 1 } },
    controls: { proven: ["pageSize"], dropped: [] },
    findings: {},
    naming: {
      macros: 8,
      reviewed: 8,
      model: 0,
      refused: 0,
      missing: 0,
      asked: 0,
      stored: 0,
      invalid: 0,
      conflicts: 0,
      calls: 0,
      tokens: { input: 0, cached: 0, output: 0 },
      gate: "passes",
    },
    compiles: { probe: 5, checks: 20 },
    times: { probe: 1000, checks: 4000, wall: 6000 },
  }),
  row("jake-0002", "jake", {
    engine: "pdftex",
    rate: 0.2,
    difference: "position",
    words: { editable: 20, locked: { unmapped: 70, shape: 10 } },
    findings: { pdf: 2 },
    compiles: { probe: 9, checks: 40 },
    times: { wall: 9000 },
  }),
  row("awesome-cv-0001", "awesome-cv", {
    outcome: "refused",
    engine: "xetex",
    refused: "difference",
  }),
  row("other-0001", "other", { outcome: "no reference", refused: "package" }),
  row("other-0002", "other", { outcome: "refused", refused: `evil\n${SECRET}` }),
  row("altacv-0001", "altacv", { outcome: "timeout" }),
];

describe("the summary, the headline and the table", () => {
  test("add up the outcomes, and the words of the documents assembled alone", () => {
    const summary = summaryOf(ROWS);
    expect(summary.documents).toBe(6);
    expect(summary.outcomes).toMatchObject({
      success: 1,
      partial: 1,
      refused: 2,
      "no reference": 1,
      timeout: 1,
    });
    expect(summary.words).toEqual({ editable: 115, locked: { date: 5, shape: 10, unmapped: 70 } });
    expect(summary.rates).toEqual({ success: 16.67, editable: 57.5 });
  });

  test("give the shares, where the others stopped and the locked words by reason", () => {
    const [shares, words] = runHeadline(ROWS);
    expect(shares).toBe(
      "6 documents: 1 success (16.7%), 1 partial (16.7%), 4 refused or stopped (66.7%): 2 refused, 1 with no reference, 0 not parsed, 0 not probed, 0 with no answer, 1 timed out or died.",
    );
    expect(words).toBe(
      "Words in editable fields: 57.5% of 200 words in the 2 documents assembled; locked, by reason: unmapped 70, shape 10, date 5.",
    );
  });

  test("count per family and in all, and show no text of a document", () => {
    const table = runTable(ROWS);
    const cells = (label: string) =>
      table
        .split("\n")
        .find((line) => line.startsWith(`| ${label} |`))
        ?.split("|")
        .slice(2, -1)
        .map((cell) => cell.trim());
    // Columns: jake, awesome-cv, altacv, moderncv, europecv, other, all.
    expect(cells("Documents")).toEqual(["2", "1", "1", "0", "0", "2", "6"]);
    expect(cells("Partial: the first check differs")?.at(-1)).toBe("1");
    expect(cells("Refused: `difference`")?.at(-1)).toBe("1");
    expect(cells("No reference: `package`")?.at(-1)).toBe("1");
    expect(cells("In editable fields")).toEqual(["58%", "", "", "", "", "", "58%"]);
    expect(cells("Locked: `unmapped`")?.at(-1)).toBe("70");
    expect(cells("`pdf`")?.at(-1)).toBe("1");
    expect(cells("Answered from the committed answers")?.at(-1)).toBe("8");
    expect(cells("A document, slowest")?.at(-1)).toBe("9000 ms");
    expect(table).not.toContain("Quillwort");
    expect(table.split("\n").every((line) => !/\p{Cc}/u.test(line))).toBe(true);
    expect(runLine(ROWS[4] as RunRow)).toBe("refused");
    expect(runLine(ROWS[0] as RunRow)).toBe(
      "pdftex, success, 95% of 100 words editable, 10 fields editable, 20 compiles, 6 s",
    );
  });
});

describe("two runs compared", () => {
  const file = (rows: RunRow[]) => ({ version: 1, summary: summaryOf(rows), documents: rows });

  test("agree when only their times differ", () => {
    const later = ROWS.map((each) => ({ ...each, times: { ...each.times, wall: 1, probe: 2 } }));
    expect(runDifferences(file(ROWS), file(later))).toEqual([]);
  });

  test("name each document and field that differs, and a document one run lacks", () => {
    const changed = ROWS.slice(1).map((each) =>
      each.id === "jake-0002" ? { ...each, compiles: { probe: 9, checks: 41 } } : each,
    );
    const found = runDifferences(file(ROWS), file(changed));
    expect(found).toContain("jake-0002.compiles.checks: 40 against 41");
    expect(found.some((line) => line.startsWith("jake-0001: {"))).toBe(true);
    expect(found.some((line) => line.startsWith("run.summary.documents: 6 against 5"))).toBe(true);
  });
});

describe("the baseline", () => {
  const summary = (success: number, documents = 200) => ({
    documents,
    outcomes: { ...summaryOf([]).outcomes, success },
  });
  const baseline = Baseline.parse({
    version: 1,
    run: {
      date: "2026-10-01",
      commit: "0123456789abcdef0123456789abcdef01234567",
      documents: 200,
      success: 20,
      rates: { success: 10, editable: 42.5 },
    },
  });
  const scope = { committedOnly: true, whole: true };

  test("is a placeholder, as committed: no baseline yet, and nothing compared", () => {
    const committed = Baseline.parse(
      JSON.parse(
        readFileSync(fileURLToPath(new URL("../corpus/baseline.json", import.meta.url)), "utf8"),
      ),
    );
    expect(committed.run).toBeNull();
    expect(baselineVerdict(summary(0), committed, scope)).toEqual({
      compared: false,
      failed: false,
      line: "No baseline yet: corpus/baseline.json holds no run, so nothing is compared.",
    });
  });

  test("holds a run over the whole corpus from the committed answers alone, and no other", () => {
    for (const other of [
      { committedOnly: false, whole: true },
      { committedOnly: true, whole: false },
    ])
      expect(baselineVerdict(summary(0), baseline, other)).toMatchObject({
        compared: false,
        failed: false,
      });
  });

  test("fails a run whose success rate falls more than a point under it, in one line", () => {
    expect(BASELINE_SLACK).toBe(1);
    // 18 of 200 is 9%, a point under the baseline's 10%: that holds.
    expect(baselineVerdict(summary(18), baseline, scope)).toMatchObject({
      compared: true,
      failed: false,
    });
    const fell = baselineVerdict(summary(17), baseline, scope);
    expect(fell).toEqual({
      compared: true,
      failed: true,
      line: "The success rate, 8.5%, fell more than 1 point under the baseline's 10.0% (2026-10-01, 0123456).",
    });
    expect(baselineVerdict(summary(24), baseline, scope).line).toBe(
      "The success rate, 12.0%, holds against the baseline's 10.0% (2026-10-01, 0123456): a pull request raises the baseline by hand.",
    );
  });

  test("is never written over by a run that falls more than a point under it", () => {
    const run = (success: number) => ({ ...summaryOf([]), ...summary(success) });
    const next = (success: number, scope = { committedOnly: true, whole: true }) =>
      nextBaseline({
        summary: run(success),
        baseline,
        scope,
        date: "2026-10-02",
        commit: "f".repeat(40),
      });
    // 17 of 200 is 8.5%, more than a point under the baseline's 10%: nothing is written, and a
    // person lowers the baseline by editing it in a pull request.
    expect(next(17)).toEqual({
      line: "corpus/baseline.json is not written: the run falls more than a point under it, and a baseline is lowered only by a pull request that edits it.",
    });
    expect(next(18).baseline?.run?.success).toBe(18);
    expect(next(24).line).toBe("Wrote corpus/baseline.json from the run, at fffffff.");
    expect(next(24, { committedOnly: false, whole: true }).baseline).toBeUndefined();
    expect(next(24, { committedOnly: true, whole: false }).baseline).toBeUndefined();
    // Over no baseline, any run over the whole corpus from the committed answers gives the first.
    const first = nextBaseline({
      summary: run(0),
      baseline: Baseline.parse({ version: 1, run: null }),
      scope: { committedOnly: true, whole: true },
      date: "2026-10-02",
      commit: "f".repeat(40),
    });
    expect(first.baseline?.run?.success).toBe(0);
  });

  test("counts a file git does not track as a change, an answer not yet committed among them", () => {
    expect(
      changedPaths(
        [
          "?? apps/editor/corpus/answers/0123.json",
          " M apps/editor/corpus/baseline.json",
          " M apps/editor/scripts/corpus.ts",
          "",
        ].join("\n"),
      ),
    ).toEqual(["apps/editor/corpus/answers/0123.json", "apps/editor/scripts/corpus.ts"]);
    expect(changedPaths(" M apps/editor/corpus/baseline.json\n")).toEqual([]);
  });

  test("is written from a run's summary, with the day and the commit", () => {
    const written = baselineOf(summaryOf(ROWS), "2026-10-02", "f".repeat(40));
    expect(written.run).toEqual({
      date: "2026-10-02",
      commit: "f".repeat(40),
      documents: 6,
      success: 1,
      rates: { success: 16.67, editable: 57.5 },
    });
  });
});

describe("the ids a file names", () => {
  test("one a line, blank lines and comments aside, each once", () => {
    expect(idsOf("jake-0001\n\n# the sample\nawesome-cv-0003  # a fork\njake-0001\r\n")).toEqual([
      "jake-0001",
      "awesome-cv-0003",
    ]);
  });

  test("refuses a line that is no id, by its number, never its text", () => {
    expect(() => idsOf(`jake-0001\n${SECRET}\n`)).toThrow(
      "line 2 of the --ids file is not a document's id",
    );
    try {
      idsOf(`${SECRET}\n`);
    } catch (error) {
      expect(String(error)).not.toContain("Quillwort");
    }
  });
});

describe("the run and compare commands", () => {
  const SCRIPT = fileURLToPath(new URL("./corpus.ts", import.meta.url));
  /** The command, run with no naming key in its environment, whatever this machine's has. */
  const run = (env: Record<string, string>, ...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, SOCLAAS_API_KEY: "", ...env },
    });
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("refuse what cannot be run, before any document is read", () => {
    const both = run({}, "run", "--committed-only", "--allow-model");
    expect(both.status).toBe(1);
    expect(both.stderr).toContain("--committed-only reads no cache");
    const keyless = run({}, "run", "--allow-model");
    expect(keyless.status).toBe(1);
    expect(keyless.stderr).toContain("run --allow-model asks SoCLaaS, which needs a key");
    const subset = run({}, "run", "--committed-only", "--write-baseline", "--only", "jake-0001");
    expect(subset.stderr).toContain(
      "--write-baseline takes a --committed-only run over the whole corpus",
    );
    expect(run({}, "run", "--only", "jake-0001", "--ids", "x").stderr).toContain(
      "--only and --ids each name the documents to run",
    );
    expect(run({}, "probe", "--ids", "x").stderr).toContain("--ids goes with run");
    expect(run({}, "name", "--committed-only").stderr).toContain("--committed-only goes with run");
    expect(run({}, "review").stderr).toContain("review is followed by export or check");
    expect(run({}, "review", "export", "--dir", "x").stderr).toContain(
      "--dir goes with review check",
    );
    expect(run({}, "review", "check", "--top", "3").stderr).toContain(
      "--top and --out go with review export",
    );
    expect(run({}, "--help").stdout).toContain(
      "| run [--only <id>] [--ids <file>] [--json <file>] [--committed-only] [--allow-model] [--write-baseline] | compare <run.json> <run.json> [<run.json>...] | review export [--top <n>] [--out <dir>] | review check [--dir <dir>]",
    );
    // A dozen spawns of the runner, each loading every command's modules: about a second each on
    // a CI runner, so the test takes the engine tests' timeout, as `corpus.test.ts`'s does.
  }, 60_000);

  test("the review's export never writes over a folder that is not an export", () => {
    const dir = mkdtempSync(join(tmpdir(), "resume-tools-run-"));
    made.push(dir);
    const kept = join(dir, "notes.txt");
    writeFileSync(kept, "invented notes");
    const refused = run({}, "review", "export", "--out", dir);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(
      "--out names a folder that holds files and no review export: name an empty or new one",
    );
    expect(readFileSync(kept, "utf8")).toBe("invented notes");
    expect(run({}, "review", "export", "--top", "0").stderr).toContain(
      "--top takes a whole number of templates",
    );
  }, 60_000);

  test("compare says whether runs agree, times aside, and exits 1 when they do not", () => {
    const dir = mkdtempSync(join(tmpdir(), "resume-tools-run-"));
    made.push(dir);
    const write = (name: string, rows: RunRow[]) => {
      const path = join(dir, name);
      writeFileSync(path, JSON.stringify({ version: 1, documents: rows }));
      return path;
    };
    const first = write("first.json", ROWS);
    const second = write(
      "second.json",
      ROWS.map((each) => ({ ...each, times: { wall: 5 } })),
    );
    const third = write(
      "third.json",
      ROWS.map((each) => (each.id === "jake-0001" ? { ...each, rate: 0.5 } : each)),
    );
    const agree = run({}, "compare", first, second);
    expect(agree.status).toBe(0);
    expect(agree.stdout).toContain("Runs 1 and 2 agree on 6 documents, times aside.");
    const differ = run({}, "compare", first, second, third);
    expect(differ.status).toBe(1);
    expect(differ.stdout).toContain("Runs 2 and 3 differ in 1 place, times aside:");
    expect(differ.stdout).toContain("jake-0001.rate: 0.95 against 0.5");
  }, 60_000);
});
