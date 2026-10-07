import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { engineAvailable } from "../src/engine/node";
import { CURATED } from "../src/templates/curated";

const SCRIPT = fileURLToPath(new URL("./measure.ts", import.meta.url));

/** Run the command as `pnpm --filter @resume-tools/editor measure` runs it: Node, as it is. */
function measure(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

describe("measure", () => {
  test("says how it is run", () => {
    const run = measure("--help");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("pnpm --filter @resume-tools/editor measure");
    expect(run.stdout).toContain("measure --import [--engine <pdftex|xetex> | --pdf]");
  });

  test("refuses an engine without --import, and one it has no sample for", () => {
    const alone = measure("--engine", "pdftex");
    expect(alone.status).toBe(1);
    expect(alone.stderr).toContain("--engine picks the sample an import is measured on");
    const unknown = measure("--import", "--engine", "luatex");
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("--engine takes pdftex or xetex, not luatex");
  });

  test("takes --pdf with --import alone, without --engine", () => {
    const alone = measure("--pdf");
    expect(alone.status).toBe(1);
    expect(alone.stderr).toContain(
      "--pdf picks the PDF import by rules alone: give --import with it",
    );
    const both = measure("--import", "--pdf", "--engine", "pdftex");
    expect(both.status).toBe(1);
    expect(both.stderr).toContain("--pdf measures the PDF import alone");
  });

  test("takes --typing-imports with a file of ids, and neither without the other", () => {
    expect(measure("--help").stdout).toContain("measure --typing-imports --ids <file>");
    const alone = measure("--typing-imports");
    expect(alone.status).toBe(1);
    expect(alone.stderr).toContain("--typing-imports takes the resumes to import in a file");
    const ids = measure("--ids", "ids.txt");
    expect(ids.status).toBe(1);
    expect(ids.stderr).toContain("--ids names the resumes typing is measured on");
    const both = measure("--typing-imports", "--import", "--ids", "ids.txt");
    expect(both.status).toBe(1);
    expect(both.stderr).toContain("give no --import with it");
  });

  test("refuses a count of runs that is not a whole number from 1", () => {
    for (const runs of ["0", "2.5", "many"]) {
      const run = measure("--runs", runs);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`--runs takes a whole number from 1, not ${runs}`);
    }
  });

  // Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
  test.skipIf(!engineAvailable())(
    "measures every curated package, and writes the numbers as JSON",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "measure-"));
      try {
        const file = join(dir, "numbers.json");
        const run = measure("--runs", "1", "--json", file);
        expect(run.stderr).toBe("");
        expect(run.status).toBe(0);
        expect(run.stdout).toContain("Against plan section 4.3");
        const numbers = JSON.parse(readFileSync(file, "utf8"));
        expect(numbers.runs).toBe(1);
        expect(numbers.packages.map((each: { id: string }) => each.id)).toEqual([
          ...CURATED.keys(),
        ]);
        for (const each of numbers.packages) {
          expect(each.edits).toHaveLength(1);
          expect(each.firstLoad.total).toBeGreaterThan(each.firstLoad.engine);
          // Judged compressed, as the plan's 30 MB counts it: less than on disk, and something.
          expect(each.firstLoad.compressed.total).toBeLessThan(each.firstLoad.total);
          expect(each.firstLoad.compressed.engine).toBeGreaterThan(0);
          // The JSON keeps how many files a step read, not which.
          expect(each.dump.read).toEqual({
            files: expect.any(Number),
            bytes: expect.any(Number),
          });
        }
        expect(numbers.summary).toHaveLength(3);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
