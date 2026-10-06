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
  /**
   * True when a package asked for another run, for references, labels or outlines. It is a reason
   * for another pass, never enough alone: some ask on every pass for what no pass can give, as
   * biblatex asks for Biber and a rerun after it, so the session passes again only when the pass
   * also changed a file the next would read (`EngineSession.compile`, decision 00XX).
   */
  rerun: boolean;
}

const OUTPUT_WRITTEN = /^Output written on .* \((\d+) pages?, \d+ bytes\)\.$/m;

/** The first line of a warning from LaTeX, a package or a class. */
const WARNING = /^(?:LaTeX|Package \S+|Class \S+) Warning: /;
/** A line that carries a warning on: "(package)" or spaces, as `\MessageBreak` writes them. */
const WARNING_GOES_ON = /^(?:\(\S+\)|\s)/;

/**
 * Whether a warning asks for another run. Packages ask in their own words: "Rerun to get
 * cross-references right", eqparbox's "Rerun to correct eqparbox widths", longtable's "Table
 * widths have changed. Rerun LaTeX.", "Please rerun LaTeX.". Only warnings count, since the word
 * also turns up in rerunfilecheck's banner and in lines of the document that TeX echoes.
 */
function asksForRerun(lines: string[]): boolean {
  let inWarning = false;
  for (const line of lines) {
    if (WARNING.test(line)) inWarning = true;
    else if (!WARNING_GOES_ON.test(line)) inWarning = false;
    if (inWarning && /\b[Rr]erun\b/.test(line)) return true;
  }
  return false;
}

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
    rerun: asksForRerun(lines),
  };
}
