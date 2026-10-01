import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NamingError, STOPPED } from "@resume-tools/naming/model";
import { afterEach, describe, expect, test } from "vitest";
import { LIMITS } from "../src/service/name";
import {
  type BenchSummary,
  benchHeadline,
  benchLine,
  benchSummary,
  benchTable,
  candidatesOf,
  chooseDefault,
  median,
  PART_LIMIT_MS,
  partsOf,
  percentile,
} from "./corpus-bench";
import { costOf, FAILURE_KINDS, failureKind, LIST_PRICES } from "./corpus-name";
import type { RunNaming, RunRow } from "./corpus-run";

// Every row, count, time and id here is invented for these tests, and no test calls a provider;
// SECRET stands for a document's text, which nothing the benchmark prints or writes may show.

const SECRET = "Quillwort Larkfield";

/** A naming step that asked the model: its counts, and those changed. */
const naming = (changes: Partial<RunNaming> = {}): RunNaming => ({
  macros: 10,
  reviewed: 0,
  model: 0,
  refused: 0,
  missing: 0,
  asked: 10,
  stored: 10,
  invalid: 0,
  conflicts: 0,
  calls: 1,
  tokens: { input: 10_000, cached: 0, output: 2000, reasoning: 1500 },
  gate: "passes",
  ...changes,
});

/** A document's row: assembled and partial, half its words editable, unless changed. */
const row = (id: string, changes: Partial<RunRow> = {}): RunRow => ({
  id,
  family: "jake",
  outcome: "partial",
  engine: "pdftex",
  rate: 0.5,
  counted: { editable: 50, all: 100 },
  words: { editable: 50, locked: { unmapped: 40, shape: 10 } },
  naming: naming(),
  times: { naming: 30_000, parts: [30_000], wall: 60_000 },
  ...changes,
});

const ROWS: RunRow[] = [
  row("jake-0001", {
    outcome: "success",
    rate: 0.95,
    counted: { editable: 95, all: 100 },
    words: { editable: 95, locked: { date: 5 } },
    times: { parts: [10_000], wall: 20_000 },
  }),
  // Two parts, the second the slowest of the run.
  row("jake-0002", {
    naming: naming({ asked: 40, stored: 40, calls: 2 }),
    times: { parts: [20_000, 90_000], wall: 130_000 },
  }),
  // Its second part stopped at its limit: a timeout, the part named.
  row("awesome-cv-0001", {
    family: "awesome-cv",
    naming: naming({
      stored: 4,
      missing: 6,
      failed: "provider",
      failure: { kind: "timeout", message: `Part 2 of 2: ${STOPPED}`, part: 2 },
    }),
    times: { parts: [40_000, 300_000], wall: 400_000 },
  }),
  // A 429 after the runner's retries, in its only part.
  row("altacv-0001", {
    family: "altacv",
    outcome: "no answer",
    rate: undefined,
    counted: undefined,
    words: undefined,
    naming: naming({
      stored: 0,
      missing: 10,
      calls: 5,
      failed: "provider",
      failure: {
        kind: "429",
        message: "The model's provider answered HTTP 429: too many",
        part: 1,
      },
    }),
    times: { parts: [50_000], wall: 70_000 },
  }),
  // Answered from the model's own folder: nothing asked, no part.
  row("jake-0003", {
    naming: naming({
      model: 10,
      asked: 0,
      stored: 0,
      calls: 0,
      tokens: { input: 0, cached: 0, output: 0 },
    }),
    times: { wall: 15_000 },
  }),
  row("other-0001", {
    family: "other",
    outcome: "no reference",
    rate: undefined,
    counted: undefined,
    words: undefined,
    naming: undefined,
    times: { wall: 1000 },
  }),
];

describe("percentiles", () => {
  test("the median is the middle value, or the mean of the two in the middle, and none of none", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(median([])).toBeUndefined();
  });

  test("a percentile is the nearest rank: the smallest value that many in a hundred are at or under", () => {
    const tens = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);
    expect(percentile(tens, 90)).toBe(90);
    expect(percentile([...tens].reverse(), 90)).toBe(90);
    expect(
      percentile(
        Array.from({ length: 20 }, (_, i) => i + 1),
        90,
      ),
    ).toBe(18);
    expect(percentile([5, 1], 90)).toBe(5);
    expect(percentile([42], 90)).toBe(42);
    expect(percentile(tens, 100)).toBe(100);
    expect(percentile(tens, 0)).toBe(10);
    expect(percentile([], 90)).toBeUndefined();
  });
});

describe("failures by kind", () => {
  const error = (reason: NamingError["reason"], message: string, status?: number) =>
    new NamingError(reason, message, status);

  test("tell a part stopped at its limit, the gateway's 429 and 5xx, and an invalid answer apart", () => {
    expect(failureKind(error("provider", STOPPED))).toBe("timeout");
    expect(failureKind(error("provider", `Part 3 of 4: ${STOPPED}`))).toBe("timeout");
    expect(failureKind(error("provider", "The model's provider answered HTTP 429: x", 429))).toBe(
      "429",
    );
    for (const status of [500, 502, 503, 504])
      expect(failureKind(error("provider", "answered", status))).toBe("5xx");
    expect(failureKind(error("invalid", "did not validate after a retry"))).toBe("invalid");
    expect(failureKind(error("refused", "The model gave no answer"))).toBe("refused");
    expect(failureKind(error("budget", "cut off at its output limit"))).toBe("cut off");
    // A wrong key's 401, a connection's failure, or anything else of the call.
    expect(failureKind(error("provider", "answered HTTP 401: invalid API key", 401))).toBe(
      "provider",
    );
    expect(failureKind(error("provider", "The call to the model failed (Error)"))).toBe("provider");
    expect(FAILURE_KINDS).toEqual([
      "timeout",
      "429",
      "5xx",
      "invalid",
      "refused",
      "cut off",
      "provider",
    ]);
  });

  test("are counted a document each, its part named, beside every part's time", () => {
    expect(partsOf(ROWS)).toEqual([
      { id: "jake-0001", part: 1, ms: 10_000 },
      { id: "jake-0002", part: 1, ms: 20_000 },
      { id: "jake-0002", part: 2, ms: 90_000 },
      { id: "awesome-cv-0001", part: 1, ms: 40_000 },
      { id: "awesome-cv-0001", part: 2, ms: 300_000, failed: "timeout" },
      { id: "altacv-0001", part: 1, ms: 50_000, failed: "429" },
    ]);
    const summary = benchSummary("qwen3.8:27b", ROWS);
    expect(summary.failures).toEqual({
      timeout: 1,
      "429": 1,
      "5xx": 0,
      invalid: 0,
      refused: 0,
      "cut off": 0,
      provider: 0,
    });
  });
});

describe("a candidate's summary", () => {
  test("adds up the outcomes, the editable rate and the locked words as the run does", () => {
    const summary = benchSummary("qwen3.8:27b", ROWS);
    expect(summary).toMatchObject({
      model: "qwen3.8:27b",
      documents: 6,
      outcomes: { success: 1, partial: 3, "no answer": 1, "no reference": 1, refused: 0 },
      assembled: 4,
      counted: { editable: 245, all: 400 },
      rates: { editable: 61.25 },
      locked: { unmapped: 120, shape: 30, date: 5 },
    });
  });

  test("gives each part's median, 90th percentile and slowest, with its document and number", () => {
    const { parts, requests } = benchSummary("qwen3.8:27b", ROWS);
    expect(parts).toEqual({
      count: 6,
      median: 45_000,
      p90: 300_000,
      slowest: { id: "awesome-cv-0001", part: 2, ms: 300_000, failed: "timeout" },
    });
    // A request's parts together, as the naming service limits them, over the documents that asked.
    expect(requests).toEqual({
      median: 80_000,
      slowest: { id: "awesome-cv-0001", ms: 340_000, parts: 2 },
    });
  });

  test("counts the calls, the tokens and their reasoning, and the imports that asked", () => {
    const summary = benchSummary("qwen3.8:27b", ROWS);
    expect(summary.calls).toBe(1 + 2 + 1 + 5);
    expect(summary.tokens).toEqual({ input: 40_000, cached: 0, output: 8000, reasoning: 6000 });
    expect(summary.naming).toMatchObject({ asked: 70, cache: 10, imports: 4, missing: 16 });
  });

  test("prices the tokens at the model's reference price, per import that asked, and says it is notional", () => {
    const summary = benchSummary("qwen3.8:27b", ROWS);
    const price = LIST_PRICES["qwen3.8:27b"];
    expect(price).toBeDefined();
    const total = costOf(summary.tokens, price ?? { read: "", input: 0, cached: 0, output: 0 });
    expect(summary.cost).toEqual({ read: "2026-09-27", total, perImport: total / 4 });
    expect(benchHeadline(summary).join("\n")).toContain(
      "the gateway bills nothing, and its prices count only toward a key's limits",
    );
    // A model with no recorded price has none, and says so.
    const unpriced = benchSummary("invented-model", ROWS);
    expect(unpriced.cost).toBeUndefined();
    expect(benchHeadline(unpriced).join("\n")).toContain(
      "No reference price is recorded for invented-model.",
    );
  });

  test("of a second run, that asked nothing, says so", () => {
    const again = ROWS.map((each) =>
      each.naming === undefined
        ? each
        : {
            ...each,
            naming: naming({
              model: 10,
              asked: 0,
              calls: 0,
              tokens: { input: 0, cached: 0, output: 0 },
            }),
            times: { wall: 10_000 },
          },
    );
    const summary = benchSummary("qwen3.8:27b", again);
    expect(summary.parts).toEqual({ count: 0 });
    expect(benchHeadline(summary).join("\n")).toContain(
      "Nothing was asked of qwen3.8:27b: every macro with an answer came from its own folder, as a second run of the same model answers",
    );
    expect(benchLine(again[0] as RunRow)).toBe("naming: 10 macros from its cache, nothing asked");
  });
});

/** A candidate's summary for the rule: its editable rate and its parts' times, in seconds. */
function candidate(
  model: string,
  editable: number,
  times: { median: number; p90: number; slowest: number } | undefined,
): BenchSummary {
  const summary = benchSummary(model, []);
  return {
    ...summary,
    rates: { success: 0, editable },
    parts:
      times === undefined
        ? { count: 0 }
        : {
            count: 10,
            median: times.median * 1000,
            p90: times.p90 * 1000,
            slowest: { id: "jake-0001", part: 1, ms: times.slowest * 1000 },
          },
  };
}

describe("the choice of the default", () => {
  test("holds a candidate's slowest part to the naming service's two minutes", () => {
    expect(PART_LIMIT_MS).toBe(LIMITS.modelMs);
    expect(PART_LIMIT_MS).toBe(120_000);
  });

  test("is the highest editable rate whose slowest part stays within the limit", () => {
    const choice = chooseDefault([
      candidate("qwen3.8:27b", 70, { median: 40, p90: 90, slowest: 130 }),
      candidate("qwen3.6:35b", 65, { median: 10, p90: 20, slowest: 60 }),
      candidate("qwen3-coder-next", 60, { median: 5, p90: 10, slowest: 30 }),
    ]);
    expect(choice.chosen).toBe("qwen3.6:35b");
    expect(choice.verdicts.map((each) => each.within)).toEqual([false, true, true]);
    expect(choice.verdicts[0]?.why).toBe(
      "its slowest part took 130.0 s (jake-0001, part 1), over the 120.0 s",
    );
    expect(choice.line).toBe(
      "The default, by the rule: qwen3.6:35b, 65.00% of the words editable, its slowest part 60.0 s, within 120.0 s.",
    );
  });

  test("takes a slowest part of exactly the limit as within it", () => {
    const choice = chooseDefault([
      candidate("qwen3.8:27b", 70, { median: 40, p90: 90, slowest: 120 }),
    ]);
    expect(choice.chosen).toBe("qwen3.8:27b");
  });

  test("on a tie, takes the faster: the median part, then the 90th percentile, then the slowest", () => {
    const byMedian = chooseDefault([
      candidate("qwen3.8:27b", 65, { median: 30, p90: 40, slowest: 50 }),
      candidate("qwen3.6:35b", 65, { median: 20, p90: 90, slowest: 110 }),
    ]);
    expect(byMedian.chosen).toBe("qwen3.6:35b");
    expect(byMedian.line).toContain("tied with 1 more and the faster, its median part 20.0 s");
    const byP90 = chooseDefault([
      candidate("qwen3.8:27b", 65, { median: 20, p90: 40, slowest: 110 }),
      candidate("qwen3.6:35b", 65, { median: 20, p90: 50, slowest: 50 }),
    ]);
    expect(byP90.chosen).toBe("qwen3.8:27b");
    const bySlowest = chooseDefault([
      candidate("qwen3.8:27b", 65, { median: 20, p90: 40, slowest: 110 }),
      candidate("qwen3.6:35b", 65, { median: 20, p90: 40, slowest: 100 }),
    ]);
    expect(bySlowest.chosen).toBe("qwen3.6:35b");
    // The same in every way: the first by id, whatever order they come in.
    const same = { median: 20, p90: 40, slowest: 100 };
    for (const order of [
      [candidate("qwen3.6:35b", 65, same), candidate("qwen3-coder-next", 65, same)],
      [candidate("qwen3-coder-next", 65, same), candidate("qwen3.6:35b", 65, same)],
    ])
      expect(chooseDefault(order).chosen).toBe("qwen3-coder-next");
  });

  test("picks none when every slowest part is over the limit, and never one that asked no part", () => {
    const none = chooseDefault([
      candidate("qwen3.8:27b", 70, { median: 40, p90: 90, slowest: 130 }),
      candidate("qwen3.6:35b", 80, undefined),
    ]);
    expect(none.chosen).toBeUndefined();
    expect(none.line).toBe(
      "No candidate's slowest part stays within 120.0 s: the rule picks none.",
    );
    expect(none.verdicts[1]?.why).toContain("no part was asked");
  });
});

describe("what the benchmark prints", () => {
  const rows: RunRow[] = [
    ...ROWS,
    // A refusal's reason that is not a word of a closed list, and a failure's message, never shown
    // as a document's text: the message says what the naming step's errors say (decision 0027).
    row(`other-0002`, {
      family: "other",
      outcome: "refused",
      refused: `evil\n${SECRET}`,
      naming: naming({
        failed: "provider",
        failure: { kind: "5xx", message: "The model's provider answered HTTP 503: down", part: 1 },
      }),
    }),
  ];

  test("sets the candidates side by side, one column each, with ids, counts and seconds", () => {
    const table = benchTable([
      benchSummary("qwen3.8:27b", rows),
      benchSummary("qwen3.6:35b", ROWS),
    ]);
    expect(table).toContain("|  | `qwen3.8:27b` | `qwen3.6:35b` |");
    expect(table).toContain("| Documents | 7 | 6 |");
    expect(table).toContain(
      "| **Editable rate**: words editable on the page, of the documents assembled, as `outcomeOf` counts them | 61.25% | 61.25% |",
    );
    expect(table).toContain("| A part, slowest | 300.0 s | 300.0 s |");
    expect(table).toContain(
      "| The slowest part: its document and number | awesome-cv-0001, 2, timeout | awesome-cv-0001, 2, timeout |",
    );
    expect(table).toContain("| `5xx` | 1 | 0 |");
    expect(table).toContain("| **The slowest part within 120.0 s** | no | no |");
    expect(table).not.toContain("Quillwort");
    expect(table.split("\n").every((line) => !/\p{Cc}/u.test(line))).toBe(true);
  });

  test("gives each document's naming step in counts and seconds, and a failure by its kind and part", () => {
    expect(benchLine(rows[1] as RunRow)).toBe(
      "naming: 40 macros asked in 2 parts (20.0 s, 90.0 s), 40 stored, 2 calls, 10,000 tokens in, 2,000 out, 1,500 reasoning",
    );
    expect(benchLine(rows[2] as RunRow)).toBe(
      `naming: 10 macros asked in 2 parts (40.0 s, 300.0 s), 4 stored, 1 call, 10,000 tokens in, 2,000 out, 1,500 reasoning; failed, timeout in part 2: Part 2 of 2: ${STOPPED}`,
    );
    const lines = rows.map(benchLine).join("\n");
    expect(lines).not.toContain("Quillwort");
  });

  test("reads candidates' files again from their rows, and says when one did not finish", () => {
    const file = (model: string, complete: boolean, taken: RunRow[]) => ({
      version: 1,
      model,
      complete,
      documents: "all",
      summary: { stale: true },
      rows: taken,
    });
    const { summaries, notes } = candidatesOf([
      file("qwen3.8:27b", true, ROWS),
      file("qwen3.6:35b", false, ROWS.slice(1)),
    ]);
    expect(summaries.map((each) => each.model)).toEqual(["qwen3.8:27b", "qwen3.6:35b"]);
    expect(summaries[0]).toEqual(benchSummary("qwen3.8:27b", ROWS));
    expect(notes).toEqual([
      "qwen3.6:35b's benchmark did not finish: its column is partial.",
      "qwen3.6:35b was measured on other documents than the first candidate.",
    ]);
    expect(() => candidatesOf([{ version: 1, rows: [] }])).toThrow("file 1 is no benchmark's file");
  });

  test("join one model's files: each document's outcome its last row's, the parts every row's that asked", () => {
    const file = (documents: "all" | "some", complete: boolean, taken: RunRow[]) => ({
      version: 1,
      model: "qwen3.8:27b",
      complete,
      documents,
      rows: taken,
    });
    const [first, second] = ROWS;
    if (first === undefined || second === undefined) throw new Error("no rows");
    // The sample's run asked for the first document; the whole corpus's answered it from the
    // model's folder, and asked for the second.
    const fromCache = {
      ...first,
      naming: naming({ model: 10, asked: 0, calls: 0 }),
      times: { wall: 1 },
    };
    const { summaries, notes } = candidatesOf([
      file("some", true, [first]),
      file("all", true, [fromCache, second]),
    ]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual(
      benchSummary("qwen3.8:27b", [fromCache, second], undefined, [first, second]),
    );
    // The first document's one part, from the sample, and the second's two.
    expect(summaries[0]?.parts.count).toBe(3);
    expect(notes).toEqual([
      "qwen3.8:27b's column joins 2 files: each document's outcome its last row's, and the parts of every row that asked the model.",
    ]);
    // A whole run the key's budget stopped, then finished the next day: one column, complete.
    const resumed = candidatesOf([
      file("all", false, [first]),
      file("all", true, [fromCache, second]),
    ]);
    expect(resumed.notes).not.toContain(
      "qwen3.8:27b's benchmark did not finish: its column is partial.",
    );
  });

  test("judge a part one run asked and a later run's row replaced, as the review's repro has it", () => {
    // The sample's run asked a document and its one part outran the limit (130 s, a timeout); the
    // whole corpus's asked it again, its folder holding no answer, and was answered in 30 s.
    const slowFailed = row("jake-0001", {
      outcome: "no answer",
      rate: undefined,
      counted: undefined,
      words: undefined,
      naming: naming({
        stored: 0,
        missing: 10,
        failed: "provider",
        failure: { kind: "timeout", message: STOPPED, part: 1 },
      }),
      times: { parts: [130_000], wall: 140_000 },
    });
    const file = (documents: "all" | "some", taken: RunRow[]) => ({
      version: 1,
      model: "qwen3.8:27b",
      complete: true,
      documents,
      rows: taken,
    });
    const { summaries } = candidatesOf([
      file("some", [slowFailed]),
      file("all", [row("jake-0001"), row("jake-0002")]),
    ]);
    const [summary] = summaries;
    expect(summary?.parts).toMatchObject({
      count: 3,
      slowest: { id: "jake-0001", part: 1, ms: 130_000, failed: "timeout" },
    });
    expect(summary?.failures.timeout).toBe(1);
    expect(summary?.calls).toBe(3);
    expect(summary?.naming.imports).toBe(3);
    // The outcome and the rate are the final rows': both documents assembled, partial.
    expect(summary?.outcomes).toMatchObject({ partial: 2, "no answer": 0 });
    const choice = chooseDefault(summaries);
    expect(choice.verdicts[0]?.within).toBe(false);
    expect(choice.chosen).toBeUndefined();
  });
});

describe("the bench command", () => {
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

  test("refuses what cannot be run, before any document is read", () => {
    const keyless = run({}, "bench", "--model", "qwen3.8:27b");
    expect(keyless.status).toBe(1);
    expect(keyless.stderr).toContain("bench asks SoCLaaS, which needs a key");
    expect(run({}, "bench").stderr).toContain(
      "bench takes --model <id>, or benchmarks' files to set side by side",
    );
    expect(run({}, "bench", "--model", "qwen3.8:27b", "x.json").stderr).toContain(
      "bench --model <id> measures a model, and bench <bench.json>... sets files side by side",
    );
    expect(
      run({ SOCLAAS_API_KEY: "invented-key" }, "bench", "--model", "a model").stderr,
    ).toContain("--model is not a model's id");
    expect(run({}, "bench", "x.json", "--json", "y.json").stderr).toContain(
      "bench <bench.json>... runs nothing, and takes no other option",
    );
    expect(run({}, "bench", "--model", "qwen3.8:27b", "--committed-only").stderr).toContain(
      "--committed-only goes with run",
    );
    expect(run({}, "probe", "--ids", "x").stderr).toContain("--ids goes with run or bench");
    expect(run({}, "bench", "--model", "qwen3.8:27b", "--thinking", "off").stderr).toContain(
      "--thinking takes one of no-think, template, effort",
    );
    expect(run({}, "bench", "--model", "qwen3.8:27b", "--retries", "11").stderr).toContain(
      "--retries takes a whole number from 0 to 10",
    );
    expect(run({}, "run", "--thinking", "template").stderr).toContain(
      "--thinking goes with bench --model <id>",
    );
    // `name --model` is still a flag.
    expect(run({}, "name", "--model").stderr).toContain(
      "name --model asks SoCLaaS, which needs a key",
    );
    expect(run({}, "--help").stdout).toContain(
      "| bench --model <id> [--only <id>] [--ids <file>] [--json <file>] [--thinking <switch>] [--retries <n>] | bench <bench.json> [<bench.json>...]",
    );
    // Each spawn loads every command's modules: about a second each on a CI runner, so the test
    // takes the engine tests' timeout, as `corpus-run.test.ts`'s does.
  }, 60_000);

  test("sets candidates' files side by side, and names the default the rule picks", () => {
    const dir = mkdtempSync(join(tmpdir(), "resume-tools-bench-"));
    made.push(dir);
    const write = (model: string, taken: RunRow[]) => {
      const path = join(dir, `${model.replace(":", "-")}.json`);
      writeFileSync(
        path,
        JSON.stringify({ version: 1, model, complete: true, documents: "all", rows: taken }),
      );
      return path;
    };
    // The faster candidate, every part within the limit, and fewer of its words editable; the
    // slower with more editable, 61.25%, but a part over the limit.
    const fast = ROWS.map((each) => ({
      ...each,
      ...(each.counted === undefined
        ? {}
        : {
            counted: { editable: 40, all: 100 },
            words: { editable: 40, locked: { unmapped: 60 } },
          }),
      ...(each.times.parts === undefined
        ? {}
        : { naming: naming(), times: { parts: [5000], wall: 10_000 } }),
    }));
    const compared = run({}, "bench", write("qwen3.8:27b", ROWS), write("qwen3.6:35b", fast));
    expect(compared.status).toBe(0);
    expect(compared.stdout).toContain("|  | `qwen3.8:27b` | `qwen3.6:35b` |");
    expect(compared.stdout).toContain(
      "| **Editable rate**: words editable on the page, of the documents assembled, as `outcomeOf` counts them | 61.25% | 40.00% |",
    );
    expect(compared.stdout).toContain(
      "qwen3.8:27b: its slowest part took 300.0 s (awesome-cv-0001, part 2), over the 120.0 s.",
    );
    expect(compared.stdout).toContain("The default, by the rule: qwen3.6:35b,");
  }, 60_000);
});
