/**
 * The documents kept in this browser, the most recently edited first: open one, start a new one
 * from a curated template's sample, chosen among the three (milestone 3 item 12), import one, or
 * delete one. It shows what the store keeps beside each document, so listing them compiles nothing
 * and parses no document.
 *
 * "Import a resume" takes a `.tex` file or a zip, or the `.tex` with the files beside it, from a
 * file picker or dropped anywhere on the list, and says under the picker what leaves the browser
 * when a resume is imported (`PRIVACY_NOTE`, decision 0033). While an import runs, the list shows
 * the step it is at and the compiles so far, in plain English, with a button that cancels it
 * (decision 0038); a refusal comes back as the list's notice, the refusal's own words, which never
 * show LaTeX.
 */

import type { DragEvent } from "react";
import { useState } from "react";
import { PRIVACY_NOTE } from "../import/privacy";
import type { Summary } from "../storage/store";
import { CURATED } from "../templates/curated";

/** Where an import is, as the progress line says it: its step's name, and the compiles so far. */
export interface ImportShown {
  label: string;
  compiles: number;
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
 * A template's name: a curated one's, an imported one's as its package names it, or its id for
 * one this editor does not have, as a newer one may.
 */
const templateName = ({ template, templateName: imported }: Summary) =>
  CURATED.get(template)?.package.name ?? imported ?? template;

/** What the chooser says of each curated template, beside its name: one line, plain English. */
export const TEMPLATE_LINES: Readonly<Record<string, string>> = {
  jake: "One plain column, dense, in the style most software resumes use.",
  altacv: "Two columns, with icons by the contact details and tags for skills.",
  "awesome-cv": "A bold header and an accent colour, set in Roboto and Source Sans Pro.",
};

/** An engine as the chooser names it. */
const ENGINE_NAMES = { pdftex: "pdfTeX", xetex: "XeTeX" } as const;

/** What the file picker takes: a `.tex` file or a zip. */
const TAKES = ".tex,.zip";

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
}: DocumentListProps) {
  const [choosing, setChoosing] = useState(false);
  const [over, setOver] = useState(false);
  const now = Date.now();
  const remove = (summary: Summary) => {
    if (window.confirm(`Delete “${summary.title}”? It cannot be brought back.`))
      onDelete(summary.id);
  };
  const busy = importing !== undefined;
  const importFiles = (files: File[]) => {
    if (files.length > 0 && !busy) onImport?.(files);
  };
  return (
    <main
      onDragOver={(event) => {
        if (onImport === undefined || busy || !holdsFiles(event)) return;
        // Taking the drag is what lets the list be dropped on.
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setOver(false);
      }}
      onDrop={(event) => {
        if (onImport === undefined) return;
        event.preventDefault();
        setOver(false);
        importFiles([...(event.dataTransfer?.files ?? [])]);
      }}
    >
      <h1>Documents</h1>
      {notice && <p role="alert">{notice}</p>}
      {importing ? (
        <p role="status">
          {importing.label}… {importing.compiles}{" "}
          {importing.compiles === 1 ? "compile" : "compiles"} so far.{" "}
          <button type="button" onClick={() => onCancelImport?.()}>
            Cancel
          </button>
        </p>
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
                ? "Drop your .tex file or zip to import it."
                : "Or drop your .tex file or zip anywhere here."}{" "}
              {PRIVACY_NOTE}
            </p>
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
