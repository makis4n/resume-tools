/**
 * What the person sees of the reading service (milestone 3 second pass, item 13, decision 0047):
 * the question asked the first time they import a PDF, the setting on the documents screen that
 * changes the answer, and the one line each import says while the answer is yes. The words are
 * `consent.ts`'s, plain English with no LaTeX. Item 14 places the question and the line in the
 * import's flow; the answer is kept by a `ConsentStore`, which `usePdfConsent` reads and writes.
 */

import { useCallback, useId, useState } from "react";
import {
  CONSENT_DETAIL,
  CONSENT_NO,
  CONSENT_QUESTION,
  CONSENT_YES,
  type ConsentStore,
  type PdfConsent,
  SENDING_NOTICE,
  SETTING_LABEL,
} from "../pdf/consent";

/** The answer as kept in `store`, and a way to change it that keeps it there first. */
export function usePdfConsent(
  store: ConsentStore,
): [PdfConsent | undefined, (answer: PdfConsent) => void] {
  const [answer, setAnswer] = useState(() => store.get());
  const change = useCallback(
    (next: PdfConsent) => {
      store.set(next);
      setAnswer(store.get() ?? next);
    },
    [store],
  );
  return [answer, change];
}

/** The question, asked once: what is sent, what is kept, and the two answers. */
export function PdfReadingQuestion({ onAnswer }: { onAnswer(answer: PdfConsent): void }) {
  const title = useId();
  const detail = useId();
  return (
    <section role="dialog" aria-labelledby={title} aria-describedby={detail}>
      <h2 id={title}>{CONSENT_QUESTION}</h2>
      <p id={detail}>{CONSENT_DETAIL}</p>
      <p>
        <button type="button" onClick={() => onAnswer("yes")}>
          {CONSENT_YES}
        </button>{" "}
        <button type="button" onClick={() => onAnswer("no")}>
          {CONSENT_NO}
        </button>
      </p>
    </section>
  );
}

/** The setting that changes the answer: on for yes, off for no or none. */
export function PdfReadingSetting({
  consent,
  onChange,
}: {
  consent: PdfConsent | undefined;
  onChange(answer: PdfConsent): void;
}) {
  return (
    <p>
      <label>
        <input
          type="checkbox"
          checked={consent === "yes"}
          onChange={(event) => onChange(event.currentTarget.checked ? "yes" : "no")}
        />{" "}
        {SETTING_LABEL}
      </label>
    </p>
  );
}

/** The one line an import says while the answer is yes. */
export function PdfSendingNotice() {
  return <p role="status">{SENDING_NOTICE}</p>;
}
