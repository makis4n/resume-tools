/**
 * An import's report as the person reads it (milestone 3 item 13, decision 0039): its first line,
 * the share of the resume's words that came out editable and, for a partial import, why it is
 * partial (`summaryOf`); what was left out, images, a bibliography, a control or a file; and what
 * else to know. While a partial import waits on the person, it lists what is locked, each part by
 * its first words as the page shows them and why, and offers the choice: continue, which opens the
 * document as it is, or stop, which leaves the import out, its package and its format with it.
 * Everything it shows is the report's plain words, which never show a command or a line of source.
 *
 * An import under the bar also offers to move its content onto a built-in template (milestone 3
 * second pass, item 16): the PDF import, run on the page the original compiles to, under the same
 * question and setting as any PDF's (decision 0047). One at the bar or over it offers no move.
 */

import { type Report, SUCCESS_RATE, summaryOf } from "../import/report";

/** What the report offers an import under the bar, beside continuing and stopping (item 16). */
export const MOVE_OFFER =
  "Or move its content onto a built-in template: the editor reads the page your original compiles to, as it reads a PDF you import, and you pick Jake's Resume, AltaCV or Awesome-CV. It keeps your content, not your original's look.";

/** The button that moves an import's content onto a built-in template. */
export const MOVE = "Move onto a built-in template";

/** Whether a report offers the move: an import under the bar (`SUCCESS_RATE`), and only one. */
export const offersMove = (report: Report) => report.rate < SUCCESS_RATE;

export interface ImportReportProps {
  report: Report;
  /** Open the imported document as it is: given while the import waits on the person. */
  onContinue?(): void;
  /** Leave the import out, its package and its format with it: given with `onContinue`. */
  onStop?(): void;
  /**
   * Move the import's content onto a built-in template through the PDF path: given with
   * `onContinue`, and offered only under the bar (`offersMove`).
   */
  onMove?(): void;
}

/** `n` words, as a part's count says them. */
const wordsOf = (n: number) => `${n} ${n === 1 ? "word" : "words"}`;

export function ImportReport({ report, onContinue, onStop, onMove }: ImportReportProps) {
  const deciding = onContinue !== undefined && onStop !== undefined;
  const moving = deciding && onMove !== undefined && offersMove(report);
  return (
    <section aria-label="Import report">
      <p role="status">{summaryOf(report)}</p>
      {deciding && report.locked.length > 0 && (
        <>
          <p>Locked, set as your original sets them, and not editable here:</p>
          <ul aria-label="Locked">
            {report.locked.map((part, i) => (
              // A part's place in the report's list is its key: the list never changes.
              <li key={i}>
                “{part.words}”, {wordsOf(part.count)}: {part.why}.
              </li>
            ))}
          </ul>
        </>
      )}
      {report.dropped.length > 0 && (
        <>
          <p>Left out:</p>
          <ul aria-label="Left out">
            {report.dropped.map((each, i) => (
              <li key={i}>{each.text}</li>
            ))}
          </ul>
        </>
      )}
      {report.notes.map((note, i) => (
        <p key={i}>{note}</p>
      ))}
      {deciding && (
        <p>
          Continue to open it as it is, or stop to leave it out.{" "}
          <button type="button" onClick={() => onContinue()}>
            Continue
          </button>{" "}
          <button type="button" onClick={() => onStop()}>
            Stop
          </button>
        </p>
      )}
      {moving && (
        <p>
          {MOVE_OFFER}{" "}
          <button type="button" onClick={() => onMove()}>
            {MOVE}
          </button>
        </p>
      )}
    </section>
  );
}
