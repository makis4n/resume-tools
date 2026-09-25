/**
 * Timing for the tests that bound how long work takes, in the CPU time of the thread that runs
 * them: the time a thread waits while the other test files run does not count, and a longer run
 * meets more of that wait, so a bound in CPU time holds on a slow shared machine where one in
 * elapsed time may not. A bound on how work grows compares it with the same work at a smaller
 * size (`fastest`), like against like on whatever machine runs the test, never below MIN_BOUND_MS
 * (`bound`), with a generous ceiling besides; a budget with no smaller case to compare with is a
 * ceiling alone (`cpuMs`, `median`).
 *
 * A thread's CPU clock may be coarse. On a shared Linux runner it moves only at the scheduler's
 * ticks, a millisecond or more apart, so that one run of a small case reads 0 ms there and any
 * multiple of it fails. So `fastest` times each case over as many runs in a row as span SPAN_MS,
 * well above the ticks, and divides by their count. A ceiling is timed once: a coarse clock reads
 * it a tick high or low at most, which no ceiling here is near. Each timing takes SPAN_MS or
 * more and a test takes several, so a test that uses `fastest` is given a minute, rather than
 * vitest's default five seconds.
 *
 * Only tests import this, and vitest collects only `*.test.ts` and `*.test.tsx` files, so it is
 * never run as one.
 */

/**
 * The least CPU time a case is timed over, in milliseconds, so that a clock's ticks are a small
 * part of it.
 */
export const SPAN_MS = 20;

/** The least bound a comparison sets, in milliseconds, so that a tick left over cannot fail it. */
export const MIN_BOUND_MS = 1;

/**
 * The most runs in a row a case is given to span SPAN_MS: work that needs more is too small to
 * time.
 */
const MAX_COUNT = 2 ** 24;

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

/** `multiple` times `base`, in milliseconds, but never less than MIN_BOUND_MS. */
export function bound(multiple: number, base: number): number {
  return Math.max(multiple * base, MIN_BOUND_MS);
}

/**
 * The fastest of `runs` timings of one run of each of `works`, in milliseconds of CPU time, the
 * works taken in turn, so that what load is left meets them alike. Each timing spans SPAN_MS: it
 * times runs in a row, doubling their count from the last timing's until they span it, and
 * divides their time by their count.
 */
export function fastest(works: (() => void)[], runs: number): number[] {
  const counts = works.map(() => 1);
  const best = works.map(() => Number.POSITIVE_INFINITY);
  for (let run = 0; run < runs; run++)
    works.forEach((work, i) => {
      for (let count = counts[i] ?? 1; ; count = doubled(count)) {
        const ms = cpuMs(() => {
          for (let k = 0; k < count; k++) work();
        });
        if (ms < SPAN_MS) continue;
        counts[i] = count;
        best[i] = Math.min(best[i] ?? Number.POSITIVE_INFINITY, ms / count);
        break;
      }
    });
  return best;
}

/** `fastest` for work that awaits, each timing taken until its runs settle (`cpuMsAsync`). */
export async function fastestAsync(
  works: (() => Promise<unknown>)[],
  runs: number,
): Promise<number[]> {
  const counts = works.map(() => 1);
  const best = works.map(() => Number.POSITIVE_INFINITY);
  for (let run = 0; run < runs; run++)
    for (const [i, work] of works.entries())
      for (let count = counts[i] ?? 1; ; count = doubled(count)) {
        const ms = await cpuMsAsync(async () => {
          for (let k = 0; k < count; k++) await work();
        });
        if (ms < SPAN_MS) continue;
        counts[i] = count;
        best[i] = Math.min(best[i] ?? Number.POSITIVE_INFINITY, ms / count);
        break;
      }
  return best;
}

/** Twice `count`, unless that passes MAX_COUNT: then the work is too small to time, and throws. */
function doubled(count: number): number {
  if (count >= MAX_COUNT)
    throw new Error(`${count} runs in a row took under ${SPAN_MS} ms, too little CPU time to time`);
  return count * 2;
}
