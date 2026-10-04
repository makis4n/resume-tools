/**
 * The person's answer to whether a PDF's text may be sent to the reading service (milestone 3
 * second pass, item 13), the first feature built under the privacy rule of decision 0047: resume
 * content leaves the browser only when the person asks for something that needs it and is told
 * what is sent, and whoever receives it keeps only what the person asked to be kept.
 *
 * The question is asked the first time a person imports a PDF, in the plain words below, which say
 * what is sent and that nothing is kept. The answer is remembered in that browser, under one key of
 * its local storage, and a setting changes it; each later import with a yes says in one line that
 * the text is being sent. Until the answer is yes, nothing is sent: the model's labeller reads the
 * answer afresh before every import (`model-labeller.ts`), so that turning the setting off stops
 * the next import from sending.
 *
 * Pure but for the browser's storage, which may be missing or refuse (a private window, blocked
 * site data): then the answer is kept for the page's life alone, and a stored value that is not
 * one of the two answers is no answer.
 */

import type { Labels } from "./label.ts";

/** The two answers. No answer yet is `undefined`, which sends nothing, as a no does. */
export type PdfConsent = "yes" | "no";

/** Where the answer is kept: read afresh each time, so a change takes effect at once. */
export interface ConsentStore {
  get(): PdfConsent | undefined;
  set(answer: PdfConsent): void;
}

/** The local storage key the answer is kept under. */
export const CONSENT_KEY = "resume-tools.pdf-reading.consent";

/** The part of `Storage` the store uses. */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const isAnswer = (value: unknown): value is PdfConsent => value === "yes" || value === "no";

/**
 * The answer kept in the browser's local storage. Where the storage is missing or throws, the
 * answer is kept in memory for the page's life, and an answer read back that is not one of the two
 * is none, so the person is asked again and nothing is sent meanwhile.
 */
export function browserConsent(
  storage: () => StorageLike | undefined = () => globalThis.localStorage,
): ConsentStore {
  let held: PdfConsent | undefined;
  return {
    get() {
      try {
        const store = storage();
        if (store !== undefined) {
          const value = store.getItem(CONSENT_KEY);
          return isAnswer(value) ? value : value === null ? held : undefined;
        }
      } catch {
        // The storage refused: the page's own answer, if it was given one.
      }
      return held;
    },
    set(answer) {
      if (!isAnswer(answer)) return;
      held = answer;
      try {
        storage()?.setItem(CONSENT_KEY, answer);
      } catch {
        // Kept for the page's life alone.
      }
    },
  };
}

/** The answer kept in memory, for the tests. */
export function memoryConsent(initial?: PdfConsent): ConsentStore & { sets: PdfConsent[] } {
  let held = initial;
  const sets: PdfConsent[] = [];
  return {
    sets,
    get: () => held,
    set(answer) {
      sets.push(answer);
      held = answer;
    },
  };
}

/** Whether the person is still to be asked: they have given no answer in this browser. */
export const needsAsking = (store: ConsentStore) => store.get() === undefined;

/** The question, asked once, the first time a person imports a PDF. */
export const CONSENT_QUESTION = "Send your PDF's text to the editor's reading service?";

/**
 * What the question says is sent, to whom, and what is kept: plain words, no LaTeX. It promises
 * what the editor's own service does, which keeps nothing, and no more of the model's host, whose
 * keeping is the launch provider's question (plan section 8.3, item 13's review).
 */
export const CONSENT_DETAIL =
  "To tell your name, headings, jobs, dates and bullets apart, the editor can send the text of each line of a PDF you import, with its size and its place on the page, to the editor's reading service. The service passes the lines to a hosted language model, which says what each line is, and sends back only that. The PDF file itself is not sent. The editor's service keeps none of your text, in a store or in a log; it asks the model to label the lines and nothing more. If you say no, the editor works it out in your browser, which is less accurate on some layouts, and nothing leaves your browser. The editor remembers your answer in this browser, and you can change it at any time under Documents.";

/** The two answers' buttons. */
export const CONSENT_YES = "Yes, send the text";
export const CONSENT_NO = "No, read it in my browser";

/** The one line each import says while the answer is yes. */
export const SENDING_NOTICE =
  "This PDF's text is being sent to the editor's reading service, which asks a language model to label its lines and keeps none of it. You can turn this off under Documents.";

/** The setting that changes the answer, on the documents screen. */
export const SETTING_LABEL =
  "When I import a PDF, send its text to the editor's reading service, which asks a language model to label its lines and keeps none of it";

/**
 * Who read a PDF's lines, in one plain sentence for the review (item 14): the model, or the rules
 * and why they stood in.
 */
export function whoRead(labels: Pick<Labels, "by" | "fallback">): string {
  if (labels.by === "model") return "The reading service's model said what each line is.";
  switch (labels.fallback) {
    case "no consent":
      return "The editor read this PDF in your browser: its text was not sent.";
    case "timeout":
      return "The editor read this PDF in your browser: the reading service did not answer in time.";
    case "failed":
      return "The editor read this PDF in your browser: the reading service could not be reached.";
    case "wrong form":
      return "The editor read this PDF in your browser: the reading service's answer could not be used.";
    default:
      return "The editor read this PDF in your browser.";
  }
}
