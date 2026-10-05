import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  BASELINE_SLACK,
  Baseline,
  type BaselineSummary,
  baselineFromFile,
  baselineOf,
  baselineVerdict,
  changedPaths,
  commitOf,
  idsOf,
  nextBaseline,
  poolSize,
  runDifferences,
} from "./corpus-run";

// Every row, count and id here is invented for these tests; SECRET stands for a document's text,
// which nothing the runner prints or writes may show.

const SECRET = "Quillwort Larkfield";

/** Invented rows of a run, ids, outcomes and counts, as a run's JSON holds them. */
const ROWS = [
  {
    id: "jake-0001",
    family: "jake",
    outcome: "success",
    rate: 0.95,
    compiles: { probe: 9, checks: 30 },
    times: { wall: 10 },
  },
  {
    id: "jake-0002",
    family: "jake",
    outcome: "partial",
    rate: 0.4,
    compiles: { probe: 9, checks: 40 },
    times: { wall: 10 },
  },
  { id: "jake-0003", family: "jake", outcome: "refused", times: { wall: 10 } },
  {
    id: "altacv-0001",
    family: "altacv",
    outcome: "partial",
    rate: 0.5,
    compiles: { probe: 3, checks: 20 },
    times: { wall: 10 },
  },
  { id: "awesome-cv-0001", family: "awesome-cv", outcome: "not parsed", times: { wall: 10 } },
  { id: "other-0001", family: "other", outcome: "timeout", times: { wall: 900 } },
];

/** A run's JSON, its rows and a count of them. */
const file = (rows: readonly object[]) => ({
  version: 2,
  summary: { documents: rows.length },
  documents: rows,
});

/** A summary of rows as a run's own sums them: its documents, successes and timeouts. */
const summed = (rows: { outcome: string }[]): BaselineSummary => {
  const success = rows.filter((each) => each.outcome === "success").length;
  const timeout = rows.filter((each) => each.outcome === "timeout").length;
  const counted = rows.length - timeout;
  return {
    documents: rows.length,
    outcomes: { success, timeout },
    rates: { success: counted === 0 ? 0 : (100 * success) / counted, editable: 0 },
  };
};

describe("two runs compared", () => {
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

  test("set aside when and at which commit each ran, as their times", () => {
    const at = (date: string, commit: string) => ({ ...file(ROWS), at: { date, commit } });
    expect(
      runDifferences(at("2026-10-01", "a".repeat(40)), at("2026-10-02", "b".repeat(40))),
    ).toEqual([]);
  });
});

describe("the baseline", () => {
  const summary = (success: number, documents = 200, timeout = 0) => ({
    documents,
    outcomes: { success, timeout },
    rates: { success: (100 * success) / (documents - timeout), editable: 50 },
  });
  const baseline = Baseline.parse({
    version: 1,
    run: {
      date: "2026-10-01",
      commit: "0123456789abcdef0123456789abcdef01234567",
      documents: 200,
      timeouts: 0,
      success: 20,
      rates: { success: 10, editable: 42.5 },
    },
  });
  const scope = { whole: true };

  test("as committed, is one the schema takes, the placeholder or a run's", () => {
    const committed = Baseline.safeParse(
      JSON.parse(
        readFileSync(fileURLToPath(new URL("../corpus/baseline.json", import.meta.url)), "utf8"),
      ),
    );
    expect(committed.success, committed.error?.issues[0]?.message).toBe(true);
  });

  test("of no run is none yet, and nothing is compared with it", () => {
    const none = Baseline.parse({ version: 1, run: null });
    expect(baselineVerdict(summary(0), none, scope)).toEqual({
      compared: false,
      failed: false,
      line: "No baseline yet: corpus/baseline.json holds no run, so nothing is compared.",
    });
  });

  test("holds a run over the whole corpus, and no other: a run has one mode", () => {
    expect(baselineVerdict(summary(0), baseline, { whole: false })).toEqual({
      compared: false,
      failed: false,
      line: "Not held to corpus/baseline.json: only a run over the whole corpus is.",
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
    const next = (success: number, scope = { whole: true }) =>
      nextBaseline({
        summary: summary(success),
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
    expect(next(24, { whole: false }).baseline).toBeUndefined();
    // Over no baseline, any run over the whole corpus gives the first.
    const first = nextBaseline({
      summary: summary(0),
      baseline: Baseline.parse({ version: 1, run: null }),
      scope: { whole: true },
      date: "2026-10-02",
      commit: "f".repeat(40),
    });
    expect(first.baseline?.run?.success).toBe(0);
  });

  test("counts a file git does not track as a change", () => {
    expect(
      changedPaths(
        [
          "?? apps/editor/corpus/invented.json",
          " M apps/editor/corpus/baseline.json",
          " M apps/editor/scripts/corpus.ts",
          "",
        ].join("\n"),
      ),
    ).toEqual(["apps/editor/corpus/invented.json", "apps/editor/scripts/corpus.ts"]);
    expect(changedPaths(" M apps/editor/corpus/baseline.json\n")).toEqual([]);
  });

  test("names a run's commit dirty when a file differs from it, so that no baseline is taken from it", () => {
    const commit = "c".repeat(40);
    expect(commitOf(commit, "")).toBe(commit);
    expect(commitOf(commit, " M apps/editor/corpus/baseline.json\n")).toBe(commit);
    expect(commitOf(commit, " M packages/naming/src/providers.ts\n")).toBe(`${commit}+dirty`);
    expect(commitOf(commit, "?? apps/editor/scripts/corpus-invented.ts\n")).toBe(`${commit}+dirty`);
    // A run whose file names a dirty commit gives no baseline.
    const run = {
      version: 2,
      at: { date: "2026-10-03", commit: `${commit}+dirty` },
      mode: { documents: "all" },
      complete: true,
      documents: [],
    };
    expect(
      baselineFromFile(run, Baseline.parse({ version: 1, run: null }), summed, 2).baseline,
    ).toBeUndefined();
  });

  test("is written from a run's summary, with the day and the commit", () => {
    const written = baselineOf(
      {
        documents: 6,
        outcomes: { success: 1, timeout: 1 },
        rates: { success: 20, editable: 57.5 },
      },
      "2026-10-02",
      "f".repeat(40),
    );
    expect(written.run).toEqual({
      date: "2026-10-02",
      commit: "f".repeat(40),
      documents: 6,
      timeouts: 1,
      success: 1,
      rates: { success: 20, editable: 57.5 },
    });
  });

  test("leaves a document that timed out out of the success rate it compares", () => {
    // 18 of the 180 that did not time out is 10%, the baseline's own rate: that holds, where
    // counting the 20 timeouts as failures would have made it 9%.
    const timedOut = summary(18, 200, 20);
    expect(baselineVerdict(timedOut, baseline, scope).line).toBe(
      "The success rate, 10.0%, holds against the baseline's 10.0% (2026-10-01, 0123456).",
    );
  });

  test("is adopted from a finished run's file over the whole corpus, summed by its own run", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `jake-${String(i + 1).padStart(4, "0")}`,
      outcome: i < 2 ? "success" : "partial",
    }));
    const file = (changes: Record<string, unknown> = {}) => ({
      version: 2,
      at: { date: "2026-10-03", commit: "c".repeat(40) },
      mode: { documents: "all" },
      complete: true,
      documents: rows,
      ...changes,
    });
    // Two in ten is 20%, over the baseline's 10%.
    expect(baselineFromFile(file(), baseline, summed, 2).baseline?.run).toMatchObject({
      date: "2026-10-03",
      commit: "c".repeat(40),
      documents: 10,
      success: 2,
      rates: { success: 20 },
    });
    const refused =
      "corpus/baseline.json is not written: the file is no finished run's, naming its commit.";
    expect(baselineFromFile(file({ complete: false }), baseline, summed, 2).line).toBe(refused);
    expect(
      baselineFromFile(file({ at: { date: "2026-10-03", commit: null } }), baseline, summed, 2)
        .line,
    ).toBe(refused);
    const some = { documents: "some" };
    expect(baselineFromFile(file({ mode: some }), baseline, summed, 2).baseline).toBeUndefined();
    // A run under the baseline is never adopted over it.
    const lower = rows.map((each) => ({ ...each, outcome: "partial" }));
    expect(baselineFromFile(file({ documents: lower }), baseline, summed, 2).line).toBe(
      "corpus/baseline.json is not written: the run falls more than a point under it, and a baseline is lowered only by a pull request that edits it.",
    );
    // A first pass's file, of version 1, is refused in plain words.
    expect(baselineFromFile(file({ version: 1 }), baseline, summed, 2).line).toBe(
      "corpus/baseline.json is not written: the file is a first pass's run, and `corpus run` takes the outline's import now, whose runs are version 2.",
    );
  });

  test("is never written from a run that fails item 14's bar, however high its rate", () => {
    const failing = { ...summary(24), bar: { lacking: 1 } };
    expect(
      nextBaseline({
        summary: failing,
        baseline,
        scope,
        date: "2026-10-02",
        commit: "f".repeat(40),
      }),
    ).toEqual({
      line: "corpus/baseline.json is not written: 1 success lacks the page size, the margins or the font size, item 14's bar.",
    });
  });
});

describe("the run's pool", () => {
  test("takes as many children as the machine has cores, four at most and one at least", () => {
    expect(poolSize(2)).toBe(2);
    expect(poolSize(12)).toBe(4);
    expect(poolSize(0)).toBe(1);
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
  /** The command, run with no model key in its environment, whatever this machine's has. */
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
    // The run has one mode: the first pass's answers and model are no options of it any more.
    for (const gone of ["--committed-only", "--allow-model"]) {
      const old = run({}, "run", gone);
      expect(old.status).toBe(1);
      expect(old.stderr).toContain(gone);
    }
    const subset = run({}, "run", "--write-baseline", "--only", "jake-0001");
    expect(subset.status).toBe(1);
    expect(subset.stderr).toContain("--write-baseline takes a run over the whole corpus");
    expect(run({}, "run", "--only", "jake-0001", "--ids", "x").stderr).toContain(
      "--only and --ids each name the documents to run",
    );
    expect(run({}, "probe", "--ids", "x").stderr).toContain("--ids goes with run");
    expect(run({}, "probe", "--write-baseline").stderr).toContain("--write-baseline goes with run");
    // The first pass's naming commands are gone (decision 0063).
    for (const gone of ["name", "seed", "assemble", "leak", "review", "bench"])
      expect(run({}, gone).stderr).toContain(`there is no command ${gone}`);
    expect(run({}, "--help").stdout).toContain(
      "| run [--only <id>] [--ids <file>] [--json <file>] [--write-baseline] | run --write-baseline --from <run.json> | compare <run.json> <run.json> [<run.json>...]",
    );
    // A dozen spawns of the runner, each loading every command's modules: about a second each on
    // a CI runner, so the test takes the engine tests' timeout, as `corpus.test.ts`'s does.
  }, 60_000);

  test("adopts a baseline from a run's file alone, and never from one that did not finish", () => {
    expect(run({}, "run", "--from", "run.json").stderr).toContain(
      "--from goes with run --write-baseline",
    );
    expect(
      run({}, "run", "--write-baseline", "--from", "run.json", "--only", "jake-0001").stderr,
    ).toContain("run --write-baseline --from <run.json> runs nothing, and takes no other option");
    const dir = mkdtempSync(join(tmpdir(), "resume-tools-run-"));
    made.push(dir);
    const unfinished = join(dir, "run.json");
    writeFileSync(
      unfinished,
      JSON.stringify({
        version: 2,
        at: { date: "2026-10-03", commit: "c".repeat(40) },
        mode: { documents: "all" },
        complete: false,
        documents: [],
      }),
    );
    const baselineFile = fileURLToPath(new URL("../corpus/baseline.json", import.meta.url));
    const before = readFileSync(baselineFile, "utf8");
    const adopted = run({}, "run", "--write-baseline", "--from", unfinished);
    expect(adopted.status).toBe(1);
    expect(adopted.stdout).toContain(
      "corpus/baseline.json is not written: the file is no finished run's, naming its commit.",
    );
    expect(readFileSync(baselineFile, "utf8")).toBe(before);
  }, 60_000);

  test("compare says whether runs agree, times aside, and exits 1 when they do not", () => {
    const dir = mkdtempSync(join(tmpdir(), "resume-tools-run-"));
    made.push(dir);
    const write = (name: string, rows: readonly object[]) => {
      const path = join(dir, name);
      writeFileSync(path, JSON.stringify({ version: 2, documents: rows }));
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
