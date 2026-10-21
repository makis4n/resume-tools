/**
 * The documents kept in this browser, the most recently edited first: open one, start a new one
 * from a curated template's sample, chosen among the three (milestone 3 item 12), import one, or
 * delete one. It shows what the store keeps beside each document, so listing them compiles nothing
 * and parses no document.
 *
 * "Import a resume" takes a `.tex` file or a zip, or the `.tex` with the files beside it, from a
 * file picker or dropped anywhere on the list, and says under the picker what leaves the browser
 * and when (`PRIVACY_NOTE`, decision 0047). While an import runs, the list shows
 * the step it is at and the compiles so far, in plain English, with a button that cancels it
 * (decision 0038); a refusal comes back as the list's notice, the refusal's own words, which never
 * show LaTeX. An import that came through partial, under the bar or with its page moved, waits on
 * the person with its report in place of the progress line (milestone 3 item 13, decision 0039):
 * continue, and the document opens as it is; stop, and nothing of it is kept. Beside the way in
 * sits the setting that says whether a PDF's text may be sent to the reading service (milestone 3
 * second pass, item 13, decision 0047). The picker and a drop take a PDF too (item 14): the first
 * time, the question whether its text may be sent stands in place of the progress line, and while
 * the answer is yes, the line under the progress line says it is being sent.
 *
 * The bridge between the two ways in (milestone 3 second pass, item 16): a `.tex` import that was
 * refused offers, under its notice, to import a PDF of the same resume instead, the person's own,
 * which runs the ordinary PDF import; and a partial import under the bar offers, in its report, to
 * move its content onto a built-in template.
 *
 * With accounts (milestone 4 item 9, decision 0092), each document is marked with where it is: in
 * the account, waiting to be saved to it, refused by it with why (decision 0098), or only in this
 * browser, which a signed-in person can add to the account from here.
 */

import type { DragEvent } from "react";
import { useState } from "react";
import { PLACE_MARKS, REFUSED_WHY } from "../account/messages";
import { PRIVACY_NOTE } from "../import/privacy";
import type { Report } from "../import/report";
import type { PdfConsent } from "../pdf/consent";
import type { Summary, Where } from "../storage/store";
import { CURATED } from "../templates/curated";
import { IMPORTED_PREFIX } from "../templates/package";
import { ImportReport } from "./ImportReport";
import { PdfReadingQuestion, PdfReadingSetting, PdfSendingNotice } from "./PdfReading";

/**
 * Where an import is, as the progress line says it: its step's name, and the compiles so far, for
 * an import that compiles; a PDF's reading has none.
 */
export interface ImportShown {
  label: string;
  compiles?: number;
  /** Whether a PDF's text is being sent to the reading service, which the line under it says. */
  sending?: boolean;
}

/** A partial import waiting on the person: its report, and the two ways on. */
export interface ImportWaiting {
  report: Report;
  /** Keep the document and open it as it is. */
  onContinue(): void;
  /** Keep nothing of the import. */
  onStop(): void;
  /** Move its content onto a built-in template through the PDF path, offered under the bar. */
  onMove?(): void;
}

export interface DocumentListProps {
  documents: Summary[];
  /** Why the list shows when a document was asked for, or what could not be done. */
  notice?: string;
  onOpen(id: string): void;
  /** Start a new document from the sample of the curated template with this id. */
  onNew(template: string): void;
  /** Delete a document the user has confirmed should go. */
  onDelete(id: string): void;
  /** Import the files chosen or dropped: a `.tex` or a zip, or a `.tex` and the files beside it. */
  onImport?(files: File[]): void;
  /** The import under way, if one is. */
  importing?: ImportShown;
  /** Stop the import under way. */
  onCancelImport?(): void;
  /** A partial import waiting on the person, if one is, which nothing else starts beside. */
  waiting?: ImportWaiting;
  /**
   * Whether a PDF's text may be sent to the reading service, and the setting that changes it
   * (milestone 3 second pass, item 13).
   */
  pdfReading?: { consent: PdfConsent | undefined; onChange(answer: PdfConsent): void };
  /**
   * The question whether a PDF's text may be sent, asked the first time a person imports a PDF,
   * in place of the progress line (milestone 3 second pass, item 14); Cancel keeps no answer.
   */
  pdfQuestion?: { onAnswer(answer: PdfConsent): void; onCancel(): void };
  /**
   * The offer a refused `.tex` import makes under its notice (item 16): pick a PDF of the same
   * resume, which the PDF import then reads.
   */
  pdfOffer?: { onChoose(file: File): void };
  /**
   * Where each document is, by its id, when the editor has accounts (milestone 4 item 9): each
   * document listed is marked with it.
   */
  places?: ReadonlyMap<string, Where>;
  /** Give a document only in this browser to the signed-in account; offered while signed in. */
  onAddToAccount?(id: string): void;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The units a time ago is told in, the largest first, with their length in milliseconds. */
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * DAY],
  ["month", 30 * DAY],
  ["week", 7 * DAY],
  ["day", DAY],
  ["hour", 60 * MINUTE],
  ["minute", MINUTE],
];

/**
 * How long ago `then` was, as of `now`, in the largest whole unit: "5 minutes ago", "yesterday".
 * In English, as the rest of the editor is for now; under a minute, or in the future, as a clock
 * that has moved back would put it, it is "just now". A time that is not a number, which the store
 * leaves out of the list, is said to be unknown rather than let the formatter throw, which would
 * take the whole list down.
 */
export function editedAgo(then: number, now: number): string {
  const elapsed = now - then;
  if (!Number.isFinite(elapsed)) return "at an unknown time";
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, length] of UNITS)
    if (elapsed >= length) return format.format(-Math.floor(elapsed / length), unit);
  return "just now";
}

/**
 * A template's name: a curated one's, an imported one's as its package names it, "Imported resume"
 * for an imported one whose package is not in this browser yet (one brought in from the account,
 * whose files come when it is opened), or its id for one this editor does not have, as a newer one
 * may.
 */
const templateName = ({ template, templateName: imported }: Summary) =>
  CURATED.get(template)?.package.name ??
  imported ??
  (template.startsWith(IMPORTED_PREFIX) ? IMPORTED_NAME : template);

/** What the list calls an imported template whose package it has not read. */
export const IMPORTED_NAME = "Imported resume";

/** What the chooser says of each curated template, beside its name: one line, plain English. */
export const TEMPLATE_LINES: Readonly<Record<string, string>> = {
  jake: "One plain column, dense, in the style most software resumes use.",
  altacv: "Two columns, with icons by the contact details and tags for skills.",
  "awesome-cv": "A bold header and an accent colour, set in Roboto and Source Sans Pro.",
};

/** An engine as the chooser names it. */
const ENGINE_NAMES = { pdftex: "pdfTeX", xetex: "XeTeX" } as const;

/** What the file picker takes: a `.tex` file or a zip, or a PDF (item 14). */
export const TAKES = ".tex,.zip,.pdf";

/** What the documents screen says of a PDF import: what it keeps; `PRIVACY_NOTE` says what is sent. */
export const PDF_NOTE =
  "From a PDF, the editor reads your resume's text and sets it on a template you pick: it keeps your content, not your PDF's look.";

/** What a refused `.tex` import offers under its notice (item 16). */
export const PDF_OFFER =
  "If you have a PDF of this resume, import it instead: the editor reads its text and sets it on a built-in template you pick, which keeps your content but not your PDF's look.";

/** The picker of that offer, which takes a PDF. */
export const PDF_OFFER_PICK = "Import its PDF";

/** Whether something dragged over the list holds files, which a drop imports. */
const holdsFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes("Files");

export function DocumentList({
  documents,
  notice,
  onOpen,
  onNew,
  onDelete,
  onImport,
  importing,
  onCancelImport,
  waiting,
  pdfReading,
  pdfQuestion,
  pdfOffer,
  places,
  onAddToAccount,
}: DocumentListProps) {
  const [choosing, setChoosing] = useState(false);
  const [over, setOver] = useState(false);
  const now = Date.now();
  const remove = (summary: Summary) => {
    if (window.confirm(`Delete “${summary.title}”? It cannot be brought back.`))
      onDelete(summary.id);
  };
  const busy = importing !== undefined || waiting !== undefined || pdfQuestion !== undefined;
  const importFiles = (files: File[]) => {
    if (files.length > 0 && !busy) onImport?.(files);
  };
  return (
    <main
      onDragOver={(event) => {
        if (!holdsFiles(event)) return;
        // Taking every drag of files keeps the browser from opening the file in the tab, which
        // would leave the editor, and an import under way with it; one that nothing can import
        // takes the drop as nothing.
        event.preventDefault();
        if (onImport === undefined || busy) {
          if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
          return;
        }
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setOver(false);
      }}
      onDrop={(event) => {
        if (!holdsFiles(event)) return;
        event.preventDefault();
        setOver(false);
        importFiles([...(event.dataTransfer?.files ?? [])]);
      }}
    >
      <h1>Documents</h1>
      {notice && <p role="alert">{notice}</p>}
      {notice && pdfOffer && !busy && (
        <p>
          {PDF_OFFER}{" "}
          <label>
            {PDF_OFFER_PICK}{" "}
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={(event) => {
                const [file] = [...(event.currentTarget.files ?? [])];
                event.currentTarget.value = "";
                if (file !== undefined) pdfOffer.onChoose(file);
              }}
            />
          </label>
        </p>
      )}
      {pdfQuestion ? (
        <PdfReadingQuestion onAnswer={pdfQuestion.onAnswer} onCancel={pdfQuestion.onCancel} />
      ) : waiting ? (
        <ImportReport
          report={waiting.report}
          onContinue={waiting.onContinue}
          onStop={waiting.onStop}
          {...(waiting.onMove === undefined ? {} : { onMove: waiting.onMove })}
        />
      ) : importing ? (
        <>
          <p role="status">
            {importing.label}…
            {importing.compiles === undefined
              ? ""
              : ` ${importing.compiles} ${importing.compiles === 1 ? "compile" : "compiles"} so far.`}{" "}
            <button type="button" onClick={() => onCancelImport?.()}>
              Cancel
            </button>
          </p>
          {importing.sending && <PdfSendingNotice />}
        </>
      ) : (
        <>
          <p>
            <button type="button" aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>
              New
            </button>
            {onImport && (
              <>
                {" "}
                <label>
                  Import a resume{" "}
                  <input
                    type="file"
                    accept={TAKES}
                    multiple
                    onChange={(event) => {
                      const files = [...(event.currentTarget.files ?? [])];
                      // The same file can be chosen again after a refusal.
                      event.currentTarget.value = "";
                      importFiles(files);
                    }}
                  />
                </label>
              </>
            )}
          </p>
          {onImport && (
            <p>
              {over
                ? "Drop your .tex file, zip or PDF to import it."
                : "Or drop your .tex file, zip or PDF anywhere here."}{" "}
              {PRIVACY_NOTE}
            </p>
          )}
          {onImport && <p>{PDF_NOTE}</p>}
          {pdfReading && (
            <PdfReadingSetting consent={pdfReading.consent} onChange={pdfReading.onChange} />
          )}
          {choosing && (
            <ul aria-label="Templates">
              {[...CURATED.values()].map(({ package: pkg }) => (
                <li key={pkg.id}>
                  <button type="button" onClick={() => onNew(pkg.id)}>
                    {pkg.name}
                  </button>{" "}
                  {TEMPLATE_LINES[pkg.id] ?? ""} Engine: {ENGINE_NAMES[pkg.engine]}.
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {documents.length === 0 ? (
        <p>No documents yet.</p>
      ) : (
        <ul>
          {documents.map((summary) => (
            <li key={summary.id}>
              <button type="button" disabled={busy} onClick={() => onOpen(summary.id)}>
                {summary.title}
              </button>{" "}
              {templateName(summary)}, edited {editedAgo(summary.updatedAt, now)}{" "}
              <Place
                where={places?.get(summary.id)}
                {...(onAddToAccount === undefined
                  ? {}
                  : { onAdd: () => onAddToAccount(summary.id) })}
              />
              <button type="button" disabled={busy} onClick={() => remove(summary)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/**
 * A document's mark of where it is, with why for one the account refused, and "Add to account" for
 * one only in this browser while the person is signed in. Nothing while it is not known.
 */
function Place({ where, onAdd }: { where: Where | undefined; onAdd?: () => void }) {
  if (where === undefined) return null;
  return (
    <>
      <em>{PLACE_MARKS[where]}</em>
      {where === "refused" && `. ${REFUSED_WHY}`}{" "}
      {where === "only-here" && onAdd && (
        <>
          <button type="button" onClick={onAdd}>
            Add to account
          </button>{" "}
        </>
      )}
    </>
  );
}
