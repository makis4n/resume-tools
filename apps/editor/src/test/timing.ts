/**
 * Timing for the tests that bound how long work takes, in the CPU time of the thread that runs
 * them: the time a thread waits while the other test files run does not count, and a longer run
 * meets more of that wait, so a bound in CPU time holds on a slow shared machine where one in
 * elapsed time may not. A bound on how work grows compares it with the same work at a smaller
 * size (`fastest`), like against like on whatever machine runs the test, with a generous ceiling
 * besides; a budget with no smaller case to compare with is a ceiling alone (`cpuMs`, `median`).
 *
 * Only tests import this, and vitest collects only `*.test.ts` and `*.test.tsx` files, so it is
 * never run as one.
 */

/** The CPU time this thread spends on `work`, in milliseconds. */
export function cpuMs(work: () => void): number {
  const started = process.threadCpuUsage();
  work();
  const { user, system } = process.threadCpuUsage(started);
  return (user + system) / 1000;
}

/**
 * The CPU time this thread spends on `work` until it settles, in milliseconds. Whatever else the
 * thread runs while `work` awaits counts too, which in a test file is the test's own work alone.
 */
export async function cpuMsAsync(work: () => Promise<unknown>): Promise<number> {
  const started = process.threadCpuUsage();
  await work();
  const { user, system } = process.threadCpuUsage(started);
  return (user + system) / 1000;
}

/** The median of `runs` timings of `work`, in milliseconds of CPU time (`cpuMs`). */
export function median(work: () => void, runs: number): number {
  const times = Array.from({ length: runs }, () => cpuMs(work)).sort((a, b) => a - b);
  return times[Math.floor(runs / 2)] ?? Number.POSITIVE_INFINITY;
}

/**
 * The fastest of `runs` timings of each of `works`, in milliseconds of CPU time (`cpuMs`), the
 * works taken in turn, so that what load is left meets them alike.
 */
export function fastest(works: (() => void)[], runs: number): number[] {
  const best = works.map(() => Number.POSITIVE_INFINITY);
  for (let run = 0; run < runs; run++)
    works.forEach((work, i) => {
      best[i] = Math.min(best[i] ?? Number.POSITIVE_INFINITY, cpuMs(work));
    });
  return best;
}

/** `fastest` for work that awaits, each run timed until it settles (`cpuMsAsync`). */
export async function fastestAsync(
  works: (() => Promise<unknown>)[],
  runs: number,
): Promise<number[]> {
  const best = works.map(() => Number.POSITIVE_INFINITY);
  for (let run = 0; run < runs; run++)
    for (const [i, work] of works.entries())
      best[i] = Math.min(best[i] ?? Number.POSITIVE_INFINITY, await cpuMsAsync(work));
  return best;
}
