/**
 * When an imported document opens, and when its fields do, over the corpus (decision 0071): the
 * import says its page before its checks end, once the outline sets it, and its fields once check
 * 2 has settled them (`ImportStage`). The child hears the stages as the import runs (`earlyClock`)
 * and puts their times in the document's row, `times.page` and `times.unlocked`, in milliseconds
 * from the import's start, beside `times.import`; an import that said none opens with its outcome,
 * so both are its whole time then. The run's headline gives them per engine, against the waits the
 * plan holds an import to: the share under 8 s on pdfTeX and under 20 s on XeTeX, and the slowest.
 *
 * The times are the pipeline's, in Node: the page's draw in the browser, about a tenth to a third of
 * a second, comes on top, and `measure --import` times it. Times sit under `times`, which `corpus
 * compare` sets aside, so a run made before them compares with one made after.
 */

// Node runs this file by stripping its types, so it imports the editor's modules as types alone.
import type { ImportStage } from "../src/import/run.ts";
import type { ImportRow } from "./corpus-import.ts";

/** A row's times, with when the page opened and when every field had, where it has them. */
export type EarlyTimes = ImportRow["times"] & { page?: number; unlocked?: number };

/** A row's times as `EarlyTimes` reads them. */
export const earlyOf = (row: Pick<ImportRow, "times">): EarlyTimes => row.times as EarlyTimes;

/**
 * What hears one import's stages (`hear`), and puts what it heard into the import's row (`into`):
 * the first stage's time as the page's, the fields' as `unlocked`; for an imported row that heard
 * none, its import's time for both, since it opens with its outcome. A row that was not imported
 * is left as it is.
 */
export function earlyClock() {
  let page: number | undefined;
  let unlocked: number | undefined;
  return {
    hear(stage: Pick<ImportStage, "phase" | "ms">) {
      const ms = Math.round(stage.ms);
      page ??= ms;
      if (stage.phase === "fields") unlocked ??= ms;
    },
    into<R extends { outcome: string; times: { import?: number } }>(row: R): R {
      const whole = row.times.import;
      if ((row.outcome !== "success" && row.outcome !== "partial") || whole === undefined)
        return row;
      const times: R["times"] = Object.assign({}, row.times, {
        page: page ?? whole,
        unlocked: unlocked ?? whole,
      });
      return { ...row, times };
    },
  };
}

/** The waits an import is held to, by engine: under 8 s on pdfTeX, under 20 s on XeTeX. */
export const WAITS: Readonly<Record<"pdftex" | "xetex", number>> = { pdftex: 8_000, xetex: 20_000 };

const ENGINE_NAMES = { pdftex: "pdfTeX", xetex: "XeTeX" } as const;

/** Seconds, as the headline gives them. */
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The median of numbers, at least one. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * The headline's lines on the waits, one per engine with an imported document: how many opened
 * their page within the engine's wait, its median and its slowest; how many had every field open
 * within it; and the whole import's, beside them, as it was judged before the page opened early.
 */
export function earlyHeadline(rows: readonly ImportRow[]): string[] {
  const lines: string[] = [];
  for (const engine of ["pdftex", "xetex"] as const) {
    const some = rows.filter(
      (row) =>
        row.engine === engine &&
        (row.outcome === "success" || row.outcome === "partial") &&
        row.times.import !== undefined,
    );
    if (some.length === 0) continue;
    const wait = WAITS[engine];
    const said = (label: string, pick: (times: EarlyTimes) => number | undefined) => {
      const values = some.map((row) => pick(earlyOf(row)) ?? row.times.import ?? 0);
      const within = values.filter((ms) => ms < wait).length;
      return `${label} ${within} of ${some.length} under ${wait / 1000} s, median ${seconds(median(values))}, slowest ${seconds(Math.max(...values))}`;
    };
    lines.push(
      `${ENGINE_NAMES[engine]}: ${said("the page opened in", (times) => times.page)}; ${said("every field open in", (times) => times.unlocked)}; ${said("the whole import in", (times) => times.import)}.`,
    );
  }
  return lines;
}
