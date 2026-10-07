/**
 * What every corpus run shares (`corpus run`, `corpus-import.ts`): the baseline a run over the
 * whole corpus is held to (`baselineVerdict`, decision 0043), `corpus compare`'s differences
 * (`runDifferences`), the run's commit, its pool's size and the ids a file names. The first pass's
 * whole import over the corpus, its rows and its table, went with the naming step in the second
 * pass's item 17 (decision 0063).
 *
 * What is printed and written names documents by id, and counts, never a document's text.
 */

// Node runs this file by stripping its types, so it imports values only from files that import
// nothing Node lacks.
import { availableParallelism } from "node:os";
import { z } from "zod";
import { IMPORT_OUTCOMES } from "./corpus-import.ts";
import { printable } from "./corpus-manifest.ts";
import { POOL_SIZE } from "./corpus-reference.ts";

/** A share as a line shows it. */
const shown = (value: number) => `${value.toFixed(1)}%`;

// The differences between runs.

/** Whether a value is an object whose keys a path goes on through: not an array, nor null. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A value's differences from another, each a path and the two values, times aside; `field` is the
 * path without the document's id, nor an array's indices, as `pieces.rules` names every piece's
 * `rules`, and a field `skip` names is not compared.
 */
function differences(
  a: unknown,
  b: unknown,
  path: string,
  out: string[],
  field = "",
  skip: (field: string) => boolean = () => false,
) {
  if (a === b) return;
  const bothObjects = a !== null && b !== null && typeof a === "object" && typeof b === "object";
  if (!bothObjects || Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: ${JSON.stringify(a) ?? "absent"} against ${JSON.stringify(b) ?? "absent"}`);
    return;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const key of keys) {
    const each = Array.isArray(a) ? field : field === "" ? key : `${field}.${key}`;
    if (skip(each)) continue;
    differences(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      `${path}.${key}`,
      out,
      each,
      skip,
    );
  }
}

/**
 * Every field a value holds, by its path of keys, down through objects and through each element of
 * an array under the array's own path, as `pieces.rules` is every piece's `rules`.
 */
function fieldsOf(value: unknown, field: string, out: Set<string>) {
  if (Array.isArray(value)) {
    for (const each of value) fieldsOf(each, field, out);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, each] of Object.entries(value)) {
    const path = field === "" ? key : `${field}.${key}`;
    out.add(path);
    fieldsOf(each, path, out);
  }
}

/**
 * The row's diagnostics, which runs made before them lack (`corpus-pieces.ts`): the only fields
 * `corpus compare` sets aside where one run lacks them throughout. Times are aside anyway.
 */
export const DIAGNOSTICS: readonly string[] = [
  "pieces",
  "pieces.rules",
  "pieces.kinds",
  "pieces.details",
  "budgets",
  "compiles.trials",
  "compiles.dumps",
  "compiles.pdfs",
];

/**
 * The fields one side holds somewhere and the other nowhere, each where it begins (`a.b`, not
 * `a.b.c` too): what an older run lacks of a newer one's rows.
 */
function lackingFields(a: readonly unknown[], b: readonly unknown[]): Set<string> {
  const one = new Set<string>();
  const two = new Set<string>();
  for (const each of a) fieldsOf(each, "", one);
  for (const each of b) fieldsOf(each, "", two);
  const lacking = new Set(
    [...one].filter((path) => !two.has(path)).concat([...two].filter((path) => !one.has(path))),
  );
  return new Set(
    [...lacking].filter((path) => {
      const parent = path.slice(0, Math.max(0, path.lastIndexOf(".")));
      return parent === "" || !lacking.has(parent);
    }),
  );
}

/** A run's JSON, loosely read: what `runDifferences` compares. */
const LooseRun = z.looseObject({
  at: z.unknown().optional(),
  documents: z.array(z.looseObject({ id: z.string(), times: z.unknown().optional() })),
});

/**
 * Where two runs' JSON differ, times aside: each document's by its id, its `times` left out, and
 * everything else of the file; each a line naming the path and the two values, which are counts and
 * the words of closed lists. None when they agree. One of the row's diagnostics (`DIAGNOSTICS`) that
 * one run's rows hold and the other's hold nowhere, as a run made before they were added lacks
 * them, is not compared but named (`lacking`); every other field one run lacks still differs, as
 * a document one run lacks does.
 */
export function runComparison(
  first: unknown,
  second: unknown,
): { differences: string[]; lacking: string[] } {
  const a = LooseRun.parse(first);
  const b = LooseRun.parse(second);
  const out: string[] = [];
  // When and at which commit a run ran is no result of it, as its times are not.
  const { documents: rowsA, at: _atA, ...restA } = a;
  const { documents: rowsB, at: _atB, ...restB } = b;
  differences(restA, restB, "run", out);
  const byId = (rows: typeof rowsA) =>
    new Map(rows.map(({ times: _times, ...row }) => [row.id, row] as const));
  const one = byId(rowsA);
  const two = byId(rowsB);
  const lacking = new Set(
    [...lackingFields([...one.values()], [...two.values()])].filter((field) =>
      DIAGNOSTICS.includes(field),
    ),
  );
  for (const id of [...new Set([...one.keys(), ...two.keys()])].sort())
    differences(one.get(id), two.get(id), id, out, "", (field) => lacking.has(field));
  return {
    differences: out.map(printable),
    lacking: [...lacking].sort().map(printable),
  };
}

/** Where two runs' JSON differ, times aside (`runComparison`), the fields only one has aside. */
export const runDifferences = (first: unknown, second: unknown): string[] =>
  runComparison(first, second).differences;

// The baseline.

/** The baseline a run over the whole corpus is held to. */
export const Baseline = z.strictObject({
  version: z.literal(1),
  /** None yet: the placeholder, which nothing is compared with. */
  run: z
    .strictObject({
      date: z.iso.date(),
      commit: z.string().regex(/^[0-9a-f]{40}$/),
      documents: z.int().min(1),
      /** The documents that timed out, which count in neither its success rate nor a run's. */
      timeouts: z.int().min(0),
      success: z.int().min(0),
      rates: z.strictObject({
        success: z.number().min(0).max(100),
        editable: z.number().min(0).max(100),
      }),
    })
    .nullable(),
});
export type Baseline = z.infer<typeof Baseline>;

/** How far under the baseline's success rate a run may fall, in points, before it fails. */
export const BASELINE_SLACK = 1;

/**
 * What a baseline reads of a run's summary (`ImportSummary`, `corpus-import.ts`): its documents,
 * its successes and those that timed out, its rates, and item 14's bar where the run judged one.
 */
export interface BaselineSummary {
  documents: number;
  outcomes: { success: number; timeout: number };
  rates: { success: number; editable: number };
  bar?: { lacking: number };
}

/**
 * What a run's summary says against the baseline, in one line, and whether the run fails: only a
 * run over the whole corpus is compared, and it fails when its success rate falls more than
 * BASELINE_SLACK points under the baseline's; a baseline with no run is none yet. `corpus run` has
 * one mode since the second pass's item 6, which reads no answers and asks no model.
 */
export function baselineVerdict(
  summary: Pick<BaselineSummary, "documents" | "outcomes">,
  baseline: Baseline,
  scope: { whole: boolean },
): { compared: boolean; failed: boolean; line: string } {
  if (!scope.whole)
    return {
      compared: false,
      failed: false,
      line: "Not held to corpus/baseline.json: only a run over the whole corpus is.",
    };
  const base = baseline.run;
  if (base === null)
    return {
      compared: false,
      failed: false,
      line: "No baseline yet: corpus/baseline.json holds no run, so nothing is compared.",
    };
  // A document that timed out counts in no rate: a machine's speed decides it.
  const counted = summary.documents - summary.outcomes.timeout;
  const rate = counted === 0 ? 0 : (100 * summary.outcomes.success) / counted;
  const of = `the baseline's ${shown(base.rates.success)} (${base.date}, ${base.commit.slice(0, 7)})`;
  if (rate < base.rates.success - BASELINE_SLACK)
    return {
      compared: true,
      failed: true,
      line: `The success rate, ${shown(rate)}, fell more than ${BASELINE_SLACK} point under ${of}.`,
    };
  return {
    compared: true,
    failed: false,
    line: `The success rate, ${shown(rate)}, holds against ${of}${rate > base.rates.success ? ": a pull request raises the baseline by hand" : ""}.`,
  };
}

/** The baseline a run gives: its summary's two rates, the day and the commit. */
export function baselineOf(summary: BaselineSummary, date: string, commit: string): Baseline {
  return Baseline.parse({
    version: 1,
    run: {
      date,
      commit,
      documents: summary.documents,
      timeouts: summary.outcomes.timeout,
      success: summary.outcomes.success,
      rates: { success: summary.rates.success, editable: summary.rates.editable },
    },
  });
}

/**
 * What `--write-baseline` does with a run's summary: the baseline to write, or why none is. Only a
 * run over the whole corpus gives one, and never one whose success rate falls more than
 * BASELINE_SLACK points under the baseline it would replace: a person lowers a baseline by editing
 * the file in a pull request, where it is read, and never by running the corpus. Nor one that fails
 * item 14's bar, where the run judged one, a success lacking the page size, the margins or the font
 * size.
 */
export function nextBaseline(input: {
  summary: BaselineSummary;
  baseline: Baseline;
  scope: { whole: boolean };
  date: string;
  commit: string;
}): { baseline?: Baseline; line: string } {
  if (!input.scope.whole)
    return {
      line: "corpus/baseline.json is not written: only a run over the whole corpus gives one.",
    };
  const verdict = baselineVerdict(input.summary, input.baseline, input.scope);
  if (verdict.failed)
    return {
      line: "corpus/baseline.json is not written: the run falls more than a point under it, and a baseline is lowered only by a pull request that edits it.",
    };
  const lacking = input.summary.bar?.lacking ?? 0;
  if (lacking > 0)
    return {
      line: `corpus/baseline.json is not written: ${lacking} ${lacking === 1 ? "success lacks" : "successes lack"} the page size, the margins or the font size, item 14's bar.`,
    };
  return {
    baseline: baselineOf(input.summary, input.date, input.commit),
    line: `Wrote corpus/baseline.json from the run, at ${input.commit.slice(0, 7)}.`,
  };
}

/**
 * What `--write-baseline --from <run.json>` does with a run's file, as CI's run leaves it: the
 * baseline it gives, or why none, as `nextBaseline` has it, the run's summary counted again from
 * its rows by `summarize` (`importSummary` for `corpus run`'s), its day and its commit its own;
 * only a file of a finished run over the whole corpus, which names its commit, gives one, and only
 * one of the `version` the summary reads: the outline's runs are version 2 (`ImportFile`) and the
 * first pass's were version 1, whose rows `importSummary` cannot count, and which is refused in
 * plain words.
 */
export function baselineFromFile<Row>(
  file: unknown,
  baseline: Baseline,
  summarize: (rows: Row[]) => BaselineSummary,
  version: number,
): { baseline?: Baseline; line: string } {
  const given = z.looseObject({ version: z.unknown() }).safeParse(file);
  const was = given.success ? given.data.version : undefined;
  if (was !== version)
    return {
      line:
        was === 1
          ? "corpus/baseline.json is not written: the file is a first pass's run, and `corpus run` takes the outline's import now, whose runs are version 2."
          : `corpus/baseline.json is not written: the file is no run of version ${version}, the one \`corpus run\` writes.`,
    };
  const run = z
    .looseObject({
      at: z.strictObject({ date: z.iso.date(), commit: z.string().regex(/^[0-9a-f]{40}$/) }),
      mode: z.looseObject({ documents: z.string() }),
      complete: z.literal(true),
      documents: z.array(z.looseObject({ id: z.string(), outcome: z.enum(IMPORT_OUTCOMES) })),
    })
    .safeParse(file);
  if (!run.success)
    return {
      line: "corpus/baseline.json is not written: the file is no finished run's, naming its commit.",
    };
  return nextBaseline({
    summary: summarize(run.data.documents as unknown as Row[]),
    baseline,
    scope: { whole: run.data.mode.documents === "all" },
    date: run.data.at.date,
    commit: run.data.at.commit,
  });
}

/**
 * How many children a run takes at once: the reference runner's four, or fewer on a machine with
 * fewer cores, as a private repository's free runner, which has two.
 */
export const poolSize = (cores = availableParallelism()) => Math.max(1, Math.min(POOL_SIZE, cores));

/** The baseline's own file, from the repository's top, as `git status` names it. */
const BASELINE_PATH = "apps/editor/corpus/baseline.json";

/**
 * The paths `git status --porcelain` names, the baseline's own aside: tracked files changed, and
 * files git does not track, which a run may read all the same; what git ignores it names none of.
 */
export function changedPaths(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3))
    .filter((path) => path !== BASELINE_PATH);
}

/**
 * The commit a run records that it ran at: the commit, or the commit and `+dirty` when a file
 * differs from it, a file git does not track among them (`changedPaths`), so that a run of an
 * uncommitted tree never names a commit that lacks what ran (decision 0044); and a baseline is
 * adopted only from a run that names a commit alone (`baselineFromFile`).
 */
export const commitOf = (commit: string, porcelain: string) =>
  changedPaths(porcelain).length > 0 ? `${commit}+dirty` : commit;

// The documents a run takes.

/** An id, as the manifest gives them: a family, a dash and four digits. */
const ID = /^[a-z][a-z-]*-\d{4}$/;

/**
 * The ids a file names for `--ids`: one a line, blank lines and lines from `#` aside; a line that
 * is no id is an error, named by its number, never its text.
 */
export function idsOf(text: string): string[] {
  const ids: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") return;
    if (!ID.test(line)) throw new Error(`line ${i + 1} of the --ids file is not a document's id`);
    if (!ids.includes(line)) ids.push(line);
  });
  return ids;
}
