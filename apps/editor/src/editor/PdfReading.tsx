/**
 * What the person sees of the reading service (milestone 3 second pass, item 13, decision 0047):
 * the question asked the first time they import a PDF, the setting on the documents screen that
 * changes the answer, and the one line each import says while the answer is yes. The words are
 * `consent.ts`'s, plain English with no LaTeX. Item 14 places the question and the line in the
 * import's flow (`DocumentList`); the answer is kept by a `ConsentStore`, which `usePdfConsent` reads and writes.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  CONSENT_DETAIL,
  CONSENT_KEY,
  CONSENT_NO,
  CONSENT_QUESTION,
  CONSENT_YES,
  type ConsentStore,
  type PdfConsent,
  SENDING_NOTICE,
  SETTING_LABEL,
} from "../pdf/consent";

/**
 * The answer as kept in `store`, and a way to change it that keeps it there first. Another tab of
 * the same browser that changes the answer is heard through the `storage` event, so this tab's
 * setting shows what the labeller, which reads the store afresh, will do.
 */
export function usePdfConsent(
  store: ConsentStore,
): [PdfConsent | undefined, (answer: PdfConsent) => void] {
  const [answer, setAnswer] = useState(() => store.get());
  useEffect(() => {
    // The store may have changed between the first render and now.
    setAnswer(store.get());
    const heard = (event: StorageEvent) => {
      // A key of null is the storage cleared.
      if (event.key === null || event.key === CONSENT_KEY) setAnswer(store.get());
    };
    window.addEventListener("storage", heard);
    return () => window.removeEventListener("storage", heard);
  }, [store]);
  const change = useCallback(
    (next: PdfConsent) => {
      store.set(next);
      setAnswer(store.get() ?? next);
    },
    [store],
  );
  return [answer, change];
}

/**
 * The question, asked once: what is sent, what is kept, and the two answers; and, in the import's
 * flow (item 14), a way to stop the import without answering, which keeps no answer.
 */
export function PdfReadingQuestion({
  onAnswer,
  onCancel,
}: {
  onAnswer(answer: PdfConsent): void;
  onCancel?(): void;
}) {
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
        {onCancel && (
          <>
            {" "}
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </>
        )}
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
