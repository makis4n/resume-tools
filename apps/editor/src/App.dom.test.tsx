// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { PDF_OFFER } from "./editor/DocumentList";
import { MOVE } from "./editor/ImportReport";
import { refusal } from "./import/refusal";
import { LOCK_WHY, type Report } from "./import/report";
import type { ImportOutcome } from "./import/run";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The app's own wiring of the list's offers (milestone 3 second pass, item 16): the bridge's tests
// render a stand-in screen, which passed the move itself while the app did not. Here the app is
// rendered as it is, with the engine's tree an invented manifest, the compiler a stand-in whose
// import lands at once, and the report of a partial import invented, as every word here is.

const landing = vi.hoisted(() => ({ outcome: undefined as unknown }));

vi.mock("./editor/compiler", async (original) => ({
  ...(await original<typeof import("./editor/compiler")>()),
  Compiler: class {
    importResume() {
      return { done: Promise.resolve(landing.outcome), cancel: () => {} };
    }
    close() {}
  },
}));

/** An invented report of an import under the bar. */
const PARTIAL: Report = {
  outcome: "partial",
  rate: 0.6,
  matched: true,
  words: {
    editable: 60,
    panel: 0,
    retype: 0,
    locked: 40,
    byReason: { unmapped: 40 },
    body: 100,
    template: 0,
  },
  locked: [{ words: "Invented words", count: 2, reason: "unmapped", why: LOCK_WHY.unmapped }],
  dropped: [],
  notes: [],
};

vi.mock("./import/report", async (original) => ({
  ...(await original<typeof import("./import/report")>()),
  reportOfImport: () => PARTIAL,
}));

describe("the app's documents screen", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: string) =>
      url === "/engine/manifest.json"
        ? new Response(JSON.stringify({ release: "invented", layout: 1, bundles: [], files: {} }))
        : new Response(null, { status: 404 }),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const settle = async () => {
    for (let i = 0; i < 40; i++) await act(async () => new Promise((done) => setTimeout(done, 5)));
  };

  /** The app, its list up, given an invented `.tex` to import that lands as `outcome`. */
  const imported = async (outcome: ImportOutcome) => {
    landing.outcome = outcome;
    act(() => root.render(<App />));
    await settle();
    const picker = host.querySelector<HTMLInputElement>('input[type="file"][multiple]');
    if (picker === null) throw new Error("no import picker");
    const file = new File(["\\documentclass{article}"], "invented.tex", { type: "text/x-tex" });
    Object.defineProperty(picker, "files", { value: [file], configurable: true });
    await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
  };
  const button = (text: string) =>
    [...host.querySelectorAll("button")].find((each) => each.textContent === text);

  it("offers an import under the bar the move", async () => {
    await imported({ upload: { files: [] } } as unknown as ImportOutcome);
    expect(button("Continue")).toBeDefined();
    expect(button(MOVE)).toBeDefined();
  });

  it("offers a refused import its PDF", async () => {
    const refused = refusal("package", "inventedquillstyle");
    await imported(refused);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(refused.message);
    expect(host.textContent).toContain(PDF_OFFER);
  });
});
