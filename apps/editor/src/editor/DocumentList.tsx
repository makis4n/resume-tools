/**
 * The documents kept in this browser, the most recently edited first: open one, start a new one
 * from the template's sample, or delete one. It shows what the store keeps beside each document,
 * so listing them compiles nothing and parses no document.
 */

import type { Summary } from "../storage/store";
import { CURATED } from "../templates/curated";

export interface DocumentListProps {
  documents: Summary[];
  /** Why the list shows when a document was asked for, or what could not be done. */
  notice?: string;
  onOpen(id: string): void;
  onNew(): void;
  /** Delete a document the user has confirmed should go. */
  onDelete(id: string): void;
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
 * that has moved back would put it, it is "just now".
 */
export function editedAgo(then: number, now: number): string {
  const elapsed = now - then;
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, length] of UNITS)
    if (elapsed >= length) return format.format(-Math.floor(elapsed / length), unit);
  return "just now";
}

/** A template's name, or its id for one this editor does not have, as a newer one may. */
const templateName = (template: string) => CURATED.get(template)?.package.name ?? template;

export function DocumentList({ documents, notice, onOpen, onNew, onDelete }: DocumentListProps) {
  const now = Date.now();
  const remove = ({ id, title }: Summary) => {
    if (window.confirm(`Delete “${title}”? It cannot be brought back.`)) onDelete(id);
  };
  return (
    <main>
      <h1>Documents</h1>
      {notice && <p role="alert">{notice}</p>}
      <p>
        <button type="button" onClick={onNew}>
          New
        </button>
      </p>
      {documents.length === 0 ? (
        <p>No documents yet.</p>
      ) : (
        <ul>
          {documents.map((summary) => (
            <li key={summary.id}>
              <button type="button" onClick={() => onOpen(summary.id)}>
                {summary.title}
              </button>{" "}
              {templateName(summary.template)}, edited {editedAgo(summary.updatedAt, now)}{" "}
              <button type="button" onClick={() => remove(summary)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
