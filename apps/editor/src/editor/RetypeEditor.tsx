/**
 * The small editor of a locked part's words (milestone 3 item 16, decision 0042), which the page
 * places under the part's first block: one line for each run of the part's plain text the page
 * shows (`Retype.pieces`), as the page shows it, and nothing of its LaTeX. "Keep" sends what was
 * typed; the app then compiles the document and keeps the change only when the page outside the
 * part is as it was and the part shows what was typed (`RetypeGuard`), and says so here in plain
 * words when it does not. Escape or "Cancel" closes it, and takes back a change still being
 * checked. Its lines keep the browser's own undo while one is typed in, as the link popover's do
 * (`NATIVE_UNDO`), since the document's undo would take back an earlier step instead.
 */

import { useEffect, useRef, useState } from "react";
import { NATIVE_UNDO } from "./undo";

/** The editor's title, which names what it changes. */
export const RETYPE_TITLE = "Change this part's words";

/** What the editor says while the page is checked with the words typed. */
export const CHECKING = "Checking the page with your words…";

/** What the editor says while the page has not caught up with the document yet. */
export const WAITING = "Waiting for the page to be updated…";

/**
 * The key the editor of a part is mounted under: the part, and its LaTeX in the document the page
 * shows, so that the editor starts afresh, its lines the part's runs as they are now, whenever
 * those change under it, as an undo, a redo or a kept retype changes them; what was typed is kept
 * only while the runs it was typed over stay as they are.
 */
export function retypeEditorKey(
  part: string,
  document: { resume: { sections: readonly { id: string; kind: string; latex?: string }[] } },
): string {
  const section = document.resume.sections.find((each) => each.id === part);
  return `${part}\n${section?.kind === "locked" ? (section.latex ?? "") : ""}`;
}

export interface RetypeEditorProps {
  /** The part's runs, each as the page shows it, in order. */
  pieces: readonly { text: string }[];
  /** Whether the page shows the document as it stands, which a retype is checked against. */
  ready: boolean;
  /** Whether the words sent are being checked: the lines are read-only, and Keep waits. */
  checking: boolean;
  /** Why the last words sent were taken back, in plain words, if they were. */
  message?: string;
  onKeep: (texts: string[]) => void;
  onCancel: () => void;
}

const BOX = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  width: "24rem",
  maxWidth: "80vw",
  padding: "8px",
  background: "#fff",
  border: "1px solid #888",
  borderRadius: "4px",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
  font: "13px system-ui, sans-serif",
} as const;

export function RetypeEditor({
  pieces,
  ready,
  checking,
  message,
  onKeep,
  onCancel,
}: RetypeEditorProps) {
  // What is typed, kept while the page is checked and after a change is taken back, so that the
  // person can shorten it rather than type it again.
  const [texts, setTexts] = useState(() => pieces.map((piece) => piece.text));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  return (
    <form
      className="retype"
      aria-label={RETYPE_TITLE}
      {...{ [NATIVE_UNDO]: "" }}
      style={BOX}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !checking) onKeep(texts);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <strong>{RETYPE_TITLE}</strong>
      {pieces.map((piece, index) => (
        <input
          // A part's runs are its own, in order, and change only with its LaTeX.
          key={index}
          ref={index === 0 ? first : undefined}
          type="text"
          aria-label={`Words ${index + 1} of ${pieces.length}`}
          value={texts[index] ?? ""}
          readOnly={checking}
          onChange={(event) => {
            const next = [...texts];
            next[index] = event.target.value;
            setTexts(next);
          }}
        />
      ))}
      {checking ? (
        <p role="status">{CHECKING}</p>
      ) : !ready ? (
        <p role="status">{WAITING}</p>
      ) : message !== undefined ? (
        <p role="alert">{message}</p>
      ) : null}
      <div style={{ display: "flex", gap: "6px" }}>
        <button type="submit" disabled={!ready || checking}>
          Keep
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
