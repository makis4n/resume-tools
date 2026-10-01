// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRIVACY_NOTE } from "../import/privacy";
import { refusal } from "../import/refusal";
import { LOCK_WHY } from "../import/report";
import type { Summary } from "../storage/store";
import { DocumentList, type DocumentListProps, TEMPLATE_LINES } from "./DocumentList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The list's way in for an import and for a new document (milestone 3 item 12, decision 0038), as a
// person uses it: every document and file here is invented.

const NOW = Date.now();

const DOCUMENTS: Summary[] = [
  { id: "a", title: "Quill Invented", template: "jake", createdAt: 0, updatedAt: NOW },
  {
    id: "b",
    title: "Wren Invented",
    template: "import-0123456789ab",
    templateName: "Invented import",
    createdAt: 0,
    updatedAt: NOW,
  },
];

/** An invented `.tex` file, as a picker or a drop gives one. */
const texFile = () =>
  new File(["\\documentclass{article}\\begin{document}Invented\\end{document}"], "cv.tex", {
    type: "application/x-tex",
  });

describe("the document list's way in", () => {
  let host: HTMLElement;
  let root: Root;
  let calls: { imported: File[][]; started: string[]; cancelled: number; opened: string[] };

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    calls = { imported: [], started: [], cancelled: 0, opened: [] };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  /** The list with the props given, over the invented documents, its calls noted. */
  function rendered(props: Partial<DocumentListProps> = {}) {
    act(() =>
      root.render(
        <DocumentList
          documents={DOCUMENTS}
          onOpen={(id) => calls.opened.push(id)}
          onNew={(template) => calls.started.push(template)}
          onDelete={() => {}}
          onImport={(files) => calls.imported.push(files)}
          onCancelImport={() => calls.cancelled++}
          {...props}
        />,
      ),
    );
  }

  const buttonNamed = (text: string) => {
    const found = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === text,
    );
    if (found === undefined) throw new Error(`no button ${text}`);
    return found;
  };

  const picker = () => host.querySelector<HTMLInputElement>('input[type="file"]');

  /**
   * A drag event dispatched on the list, holding what `types` and `files` say, as a browser's
   * carries them; the transfer comes back too, for what the list set on it.
   */
  const dragged = (type: string, types: string[], files: File[] = []) => {
    const main = host.querySelector("main");
    if (main === null) throw new Error("no list");
    const event = new Event(type, { bubbles: true, cancelable: true });
    const transfer: { types: string[]; files: File[]; dropEffect?: string } = { types, files };
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    act(() => main.dispatchEvent(event));
    return { event, transfer };
  };

  it("imports the files chosen in the picker, which takes a .tex or a zip, and says what leaves", () => {
    rendered();
    const input = picker();
    expect(input?.accept).toBe(".tex,.zip");
    expect(input?.closest("label")?.textContent).toContain("Import a resume");
    // The privacy sentence stands under the picker before any import starts.
    expect(host.textContent).toContain(PRIVACY_NOTE);
    const file = texFile();
    act(() => {
      if (input === null) throw new Error("no picker");
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(calls.imported).toEqual([[file]]);
  });

  it("imports what is dropped on the list, and takes the drag only when it holds files", () => {
    rendered();
    expect(dragged("dragover", ["text/plain"]).event.defaultPrevented).toBe(false);
    expect(dragged("dragover", ["Files"]).event.defaultPrevented).toBe(true);
    expect(host.textContent).toContain("Drop your .tex file or zip to import it.");
    const file = texFile();
    expect(dragged("drop", ["Files"], [file]).event.defaultPrevented).toBe(true);
    expect(calls.imported).toEqual([[file]]);
  });

  it("takes a drop of files while an import runs as nothing, so the browser opens no file", () => {
    // Left to the browser, a drop of a file opens it in the tab, and the import goes with the page.
    rendered({ importing: { label: "Finding the parts you can edit", compiles: 3 } });
    const over = dragged("dragover", ["Files"]);
    expect(over.event.defaultPrevented).toBe(true);
    expect(over.transfer.dropEffect).toBe("none");
    expect(dragged("drop", ["Files"], [texFile()]).event.defaultPrevented).toBe(true);
    expect(calls.imported).toEqual([]);
    // The same where nothing can import, as when the engine's files did not load.
    rendered({ importing: undefined, onImport: undefined });
    expect(dragged("drop", ["Files"], [texFile()]).event.defaultPrevented).toBe(true);
    expect(calls.imported).toEqual([]);
  });

  it("offers the three curated templates for a new document, each with its name, a line and its engine", () => {
    rendered();
    expect(host.querySelector('ul[aria-label="Templates"]')).toBeNull();
    act(() => buttonNamed("New").click());
    const cards = [...host.querySelectorAll('ul[aria-label="Templates"] li')].map(
      (card) => card.textContent,
    );
    expect(cards).toEqual([
      `Jake's Resume ${TEMPLATE_LINES.jake} Engine: pdfTeX.`,
      `AltaCV ${TEMPLATE_LINES.altacv} Engine: pdfTeX.`,
      `Awesome-CV ${TEMPLATE_LINES["awesome-cv"]} Engine: XeTeX.`,
    ]);
    act(() => buttonNamed("AltaCV").click());
    expect(calls.started).toEqual(["altacv"]);
  });

  it("shows the step an import is at and the compiles so far, with a cancel that stops it", () => {
    rendered({ importing: { label: "Finding the parts you can edit", compiles: 12 } });
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Finding the parts you can edit… 12 compiles so far.");
    // Nothing else starts while it runs: no picker, no new document, no document to open.
    expect(picker()).toBeNull();
    expect(host.textContent).not.toContain("New");
    expect(buttonNamed("Quill Invented").disabled).toBe(true);
    act(() => buttonNamed("Cancel").click());
    expect(calls.cancelled).toBe(1);
  });

  it("holds a partial import's report in place of the picker until the person continues or stops", () => {
    let continued = 0;
    let stopped = 0;
    rendered({
      waiting: {
        report: {
          outcome: "partial",
          rate: 0.5,
          matched: true,
          words: { editable: 5, panel: 0, locked: 5, byReason: { date: 5 }, body: 10, template: 0 },
          locked: [{ words: "Invented words", count: 5, reason: "date", why: LOCK_WHY.date }],
          dropped: [],
          notes: [],
        },
        onContinue: () => continued++,
        onStop: () => stopped++,
      },
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Imported in part: 50% of your resume's words are editable, under the 90% this editor aims for.",
    );
    // Nothing else starts meanwhile: no picker, no new document, no document to open.
    expect(picker()).toBeNull();
    expect(host.textContent).not.toContain("New");
    expect(buttonNamed("Quill Invented").disabled).toBe(true);
    expect(dragged("drop", ["Files"], [texFile()]).event.defaultPrevented).toBe(true);
    expect(calls.imported).toEqual([]);
    act(() => buttonNamed("Continue").click());
    act(() => buttonNamed("Stop").click());
    expect([continued, stopped]).toEqual([1, 1]);
  });

  it("says why an import was refused in its own words, and shows the list again", () => {
    const refused = refusal("package", "invented-package");
    rendered({ notice: refused.message });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "This resume needs the package invented-package, which this editor does not have.",
    );
    // The list is back: the picker, and the documents, the imported one by its package's name.
    expect(picker()).not.toBeNull();
    expect(host.textContent).toContain("Invented import, edited just now");
    act(() => buttonNamed("Wren Invented").click());
    expect(calls.opened).toEqual(["b"]);
  });
});
