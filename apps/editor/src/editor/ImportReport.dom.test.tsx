// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCK_WHY, type Report } from "../import/report";
import { ImportReport, type ImportReportProps } from "./ImportReport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// An import's report as a person reads it (milestone 3 item 13, decision 0039): every word, name
// and part here is invented.

/** An invented report of a successful import, with the changes given. */
const report = (changes: Partial<Report> = {}): Report => ({
  outcome: "succeeded",
  rate: 0.957,
  matched: true,
  words: { editable: 89, panel: 3, locked: 4, byReason: { date: 4 }, body: 93, template: 2 },
  locked: [{ words: "Jan 2020 – Present", count: 4, reason: "date", why: LOCK_WHY.date }],
  dropped: [],
  notes: [],
  ...changes,
});

/** An invented partial report: under the bar, with parts locked and things left out. */
const PARTIAL = report({
  outcome: "partial",
  rate: 0.826,
  words: { editable: 76, panel: 0, locked: 16, byReason: { unmapped: 16 }, body: 92, template: 0 },
  locked: [
    {
      words: "Quill Invented 555-0100 | quill@example.invalid | quill…",
      count: 9,
      reason: "unmapped",
      why: LOCK_WHY.unmapped,
    },
    {
      words: "Languages: Invented, Words, Other Tools: Quill, Wren",
      count: 7,
      reason: "unmapped",
      why: LOCK_WHY.unmapped,
    },
  ],
  dropped: [
    {
      kind: "images",
      text: "1 image, shown as blank space of its size, since this editor's PDF carries none: photo.png.",
    },
  ],
  notes: ["The template takes no more and no fewer list sections than your original has."],
});

describe("an import's report", () => {
  let host: HTMLElement;
  let root: Root;
  let calls: { continued: number; stopped: number };

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    calls = { continued: 0, stopped: 0 };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function rendered(props: ImportReportProps) {
    act(() => root.render(<ImportReport {...props} />));
  }

  const buttons = () => [...host.querySelectorAll("button")].map((button) => button.textContent);
  const buttonNamed = (text: string) => {
    const found = [...host.querySelectorAll("button")].find((each) => each.textContent === text);
    if (found === undefined) throw new Error(`no button ${text}`);
    return found;
  };
  const listed = (label: string) =>
    [...host.querySelectorAll(`ul[aria-label="${label}"] li`)].map((item) => item.textContent);

  it("says a successful import in one line, with the share of the words that are editable", () => {
    rendered({ report: report() });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Imported: 95% of your resume's words are editable.",
    );
    // Nothing to decide, and no list of what is locked.
    expect(buttons()).toEqual([]);
    expect(host.querySelector('ul[aria-label="Locked"]')).toBeNull();
    expect(host.querySelector('ul[aria-label="Left out"]')).toBeNull();
  });

  it("says what a successful import left out under its line", () => {
    rendered({ report: report({ dropped: PARTIAL.dropped }) });
    expect(listed("Left out")).toEqual([PARTIAL.dropped[0]?.text]);
  });

  it("lists what a partial import locks and left out, and continues or stops on the person's word", () => {
    rendered({
      report: PARTIAL,
      onContinue: () => calls.continued++,
      onStop: () => calls.stopped++,
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Imported in part: 82% of your resume's words are editable, under the 90% this editor aims for.",
    );
    expect(listed("Locked")).toEqual([
      `“Quill Invented 555-0100 | quill@example.invalid | quill…”, 9 words: ${LOCK_WHY.unmapped}.`,
      `“Languages: Invented, Words, Other Tools: Quill, Wren”, 7 words: ${LOCK_WHY.unmapped}.`,
    ]);
    expect(listed("Left out")).toEqual([PARTIAL.dropped[0]?.text]);
    expect(host.textContent).toContain(PARTIAL.notes[0]);
    expect(buttons()).toEqual(["Continue", "Stop"]);
    act(() => buttonNamed("Continue").click());
    expect(calls).toEqual({ continued: 1, stopped: 0 });
    act(() => buttonNamed("Stop").click());
    expect(calls).toEqual({ continued: 1, stopped: 1 });
  });

  it("says a partial import whose page moved, and shows no command or line of source", () => {
    rendered({
      report: report({ outcome: "partial", matched: false, rate: 1 }),
      onContinue: () => calls.continued++,
      onStop: () => calls.stopped++,
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Imported in part: 100% of your resume's words are editable, but the page this editor sets differs from your original's.",
    );
    expect(host.textContent).not.toMatch(/[\\{}]/);
  });
});
