/**
 * What the editor needs to know from a TeX log: whether the run failed and why, how many pages
 * it shipped out, and whether a package asked for another run. The session sets
 * `max_print_line` high enough that TeX does not wrap the lines this reads.
 *
 * A log is for developers only. The product never shows one to a user, since it is LaTeX.
 */

export interface LogSummary {
  /** The first error TeX reported, without its leading "! ", or undefined if there was none. */
  error?: string;
  /** The input line the first error was reported at, when TeX said. */
  errorLine?: number;
  /** Pages shipped out, from "Output written on ... (n pages, ...)"; 0 when there were none. */
  pages: number;
  /** True when a package asked for another run, for references, labels or outlines. */
  rerun: boolean;
}

const OUTPUT_WRITTEN = /^Output written on .* \((\d+) pages?, \d+ bytes\)\.$/m;
/**
 * Packages ask for another run in their own words: "Rerun to get cross-references right",
 * "Rerun to correct eqparbox widths", longtable's "Table widths have changed. Rerun LaTeX.".
 * They share the capitalised word, which "rerunfilecheck" and its info lines do not.
 */
const RERUN = /\bRerun\b|\bPlease rerun\b/;

export function summariseLog(log: string): LogSummary {
  const lines = log.split(/\r?\n/);
  const first = lines.findIndex((line) => line.startsWith("! "));
  let errorLine: number | undefined;
  if (first >= 0) {
    // TeX shows the context after the message, ending with the line it stopped at: "l.12 ...".
    for (const line of lines.slice(first + 1, first + 12)) {
      const at = /^l\.(\d+)\b/.exec(line);
      if (at) {
        errorLine = Number(at[1]);
        break;
      }
    }
  }
  const written = OUTPUT_WRITTEN.exec(log);
  return {
    error: first >= 0 ? lines[first]?.slice(2) : undefined,
    errorLine,
    pages: written ? Number(written[1]) : 0,
    rerun: RERUN.test(log),
  };
}
