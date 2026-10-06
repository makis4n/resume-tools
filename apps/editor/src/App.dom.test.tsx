// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { PDF_OFFER } from "./editor/DocumentList";
import { FIELDS_LOCKED, FIELDS_OPEN } from "./editor/early-import";
import { MOVE } from "./editor/ImportReport";
import { refusal } from "./import/refusal";
import { LOCK_WHY, type Report } from "./import/report";
import type { ImportOutcome, ImportStage } from "./import/run";
import { DocumentStore, SAVE_DELAY } from "./storage/store";
import { inventedOutline, outlineParts } from "./test/invented-outline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The app's own wiring of the list's offers (milestone 3 second pass, item 16): the bridge's tests
// render a stand-in screen, which passed the move itself while the app did not. Here the app is
// rendered as it is, with the engine's tree an invented manifest, the compiler a stand-in whose
// import lands at once, and the report of a partial import invented, as every word here is.

const landing = vi.hoisted(() => ({
  outcome: undefined as unknown,
  /** The stages the import tells of before it lands, each when the test lets it (`release`). */
  stages: [] as unknown[],
  waits: [] as (() => void)[],
  /** The documents the compiler was given to compile, as `open` gives them. */
  opened: [] as unknown[],
  /** The documents it was given as edits (`update`). */
  updated: [] as unknown[],
  /**
   * How long `open`'s compile takes to land, in milliseconds, or none to land as it is asked: a
   * document holding a Cyrillic letter stops it, as fonts with none make it (item 7).
   */
  lands: undefined as number | undefined,
  events: undefined as
    | { page(shown: unknown): void; error(message: string): void; stopped(document: unknown): void }
    | undefined,
  /** The report the import is read into, a partial one's unless a test says otherwise. */
  report: undefined as unknown,
}));

/** A page as the compiler draws one, blank, of the document given. */
const blank = (document: unknown) => {
  const page = {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 792"></svg>',
    size: { width: 612, height: 792 },
    fields: new Map(),
    locked: new Map(),
    glyphs: [],
    pageCount: 1,
    unmatched: 0,
    missingFonts: new Map(),
  };
  return { page, pages: [page], body: { latex: "", texts: new Map() }, document, ms: 5 };
};

vi.mock("./editor/compiler", async (original) => ({
  ...(await original<typeof import("./editor/compiler")>()),
  Compiler: class {
    constructor(_engine: unknown, _fonts: unknown, events: typeof landing.events) {
      landing.events = events;
    }
    importResume(_files: unknown, _progress: unknown, onStage?: (stage: unknown) => void) {
      const done = (async () => {
        for (const stage of landing.stages) {
          await new Promise<void>((go) => landing.waits.push(go));
          onStage?.(stage);
        }
        await new Promise<void>((go) => landing.waits.push(go));
        return landing.outcome;
      })();
      return { done, cancel: () => {} };
    }
    preview(_pkg: unknown, document: unknown) {
      landing.events?.page(blank(document));
      return Promise.resolve();
    }
    open(_pkg: unknown, document: unknown) {
      landing.opened.push(document);
      const land = () => {
        if (JSON.stringify(document).includes("Ж")) {
          landing.events?.stopped(document);
          landing.events?.error("The page could not be updated.");
        } else landing.events?.page(blank(document));
      };
      if (landing.lands === undefined) land();
      else setTimeout(land, landing.lands);
    }
    update(document: unknown) {
      landing.updated.push(document);
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
  reportOfImport: () => landing.report ?? PARTIAL,
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

  afterEach(async () => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    // The next test's store starts empty, as a new browser's does.
    await Dexie.delete("resume-tools");
  });

  const settle = async () => {
    for (let i = 0; i < 40; i++) await act(async () => new Promise((done) => setTimeout(done, 5)));
  };

  /** Let the import go on to its next stage, or to its outcome after the last. */
  const release = async () => {
    await settle();
    await act(async () => landing.waits.shift()?.());
    await settle();
  };

  /**
   * The app, its list up, given an invented `.tex` to import that lands as `outcome`, after
   * `stages`, each as the test releases it; with none, at once.
   */
  const imported = async (outcome: ImportOutcome, stages: ImportStage[] = []) => {
    landing.outcome = outcome;
    landing.stages = stages;
    landing.waits = [];
    landing.opened = [];
    landing.updated = [];
    landing.lands = undefined;
    landing.report = undefined;
    act(() => root.render(<App />));
    await settle();
    const picker = host.querySelector<HTMLInputElement>('input[type="file"][multiple]');
    if (picker === null) throw new Error("no import picker");
    const file = new File(["\\documentclass{article}"], "invented.tex", { type: "text/x-tex" });
    Object.defineProperty(picker, "files", { value: [file], configurable: true });
    await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
    if (stages.length === 0) await release();
    await settle();
  };
  const button = (text: string) =>
    [...host.querySelectorAll("button")].find((each) => each.textContent === text);

  it("offers an import under the bar the move", async () => {
    await imported({ upload: { files: [] } } as unknown as ImportOutcome);
    expect(button("Continue")).toBeDefined();
    expect(button(MOVE)).toBeDefined();
  });

  /** An invented outline's stages and outcome, every word invented. */
  async function early() {
    const { pkg, document } = await inventedOutline();
    const job = { files: {}, images: [] };
    const at = { package: pkg, document, job };
    const page: ImportStage = {
      phase: "page",
      ...at,
      output: new Uint8Array([0xf7]),
      ms: 1,
      compiles: 3,
    };
    const fields: ImportStage = { phase: "fields", ...at, ms: 2, compiles: 6 };
    const outcome = {
      ...at,
      report: {},
      upload: { files: [] },
      formats: [],
    } as unknown as ImportOutcome;
    return { page, fields, outcome, document };
  }

  it("opens an import's page before its checks end, its fields locked, then open, and its report after (decision 00XX)", async () => {
    const { page, fields, outcome, document } = await early();
    await imported(outcome, [page, fields]);
    // The list, while the import has no page yet.
    expect(host.textContent).not.toContain(FIELDS_LOCKED);
    await release();
    // The page, every field locked and the side panel with them, the import's progress and its
    // Cancel above it, and no way back to the list but that.
    expect(host.textContent).toContain(FIELDS_LOCKED);
    expect(host.querySelector("svg")).not.toBeNull();
    expect(button("Cancel")).toBeDefined();
    expect(button("Documents")).toBeUndefined();
    expect(host.querySelector("aside")?.hasAttribute("inert")).toBe(true);
    await release();
    expect(host.textContent).toContain(FIELDS_OPEN);
    expect(host.querySelector("aside")?.hasAttribute("inert")).toBe(false);
    expect(landing.opened).toEqual([]);
    // The partial outcome lands where the page is: compiled at once, its report above the page with
    // Continue, Stop and the move; kept only on Continue.
    await release();
    expect(host.textContent).not.toContain(FIELDS_OPEN);
    expect(landing.opened).toEqual([document]);
    expect(button(MOVE)).toBeDefined();
    expect(button("Documents")).toBeUndefined();
    await act(async () => button("Continue")?.click());
    await settle();
    expect(button("Continue")).toBeUndefined();
    expect(button("Documents")).toBeDefined();
    await act(async () => button("Documents")?.click());
    await settle();
    expect(button("Delete")).toBeDefined();
  });

  it("keeps an import open early that succeeds as it lands, its report above the page", async () => {
    const { page, fields, outcome, document } = await early();
    await imported(outcome, [page, fields]);
    landing.report = { ...PARTIAL, outcome: "succeeded", rate: 0.97, locked: [] };
    await release();
    await release();
    expect(host.textContent).toContain(FIELDS_OPEN);
    await release();
    expect(landing.opened).toEqual([document]);
    expect(button("Continue")).toBeUndefined();
    expect(button("Documents")).toBeDefined();
    expect(host.querySelector('[aria-label="Import report"]')).not.toBeNull();
  });

  it("keeps nothing of an import open early that is stopped", async () => {
    const { page, fields, outcome } = await early();
    await imported(outcome, [page, fields]);
    await release();
    await release();
    await release();
    await act(async () => button("Stop")?.click());
    await settle();
    expect(host.textContent).not.toContain(FIELDS_OPEN);
    expect(button("Continue")).toBeUndefined();
    expect(host.querySelector('input[type="file"][multiple]')).not.toBeNull();
    expect(host.textContent).toContain("No documents yet.");
  });

  it("goes back to the list, saying why, when an import open early is refused", async () => {
    const { page } = await early();
    const refused = refusal("stopped");
    await imported(refused, [page]);
    await release();
    expect(host.textContent).toContain(FIELDS_LOCKED);
    await release();
    expect(host.textContent).not.toContain(FIELDS_LOCKED);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(refused.message);
  });

  /** Type `text` into the first field of the open document's first role, in the side panel. */
  const typeInFirstRole = async (text: string) => {
    const role = [...host.querySelectorAll<HTMLButtonElement>("aside button")].find((each) =>
      each.textContent?.startsWith("Lantern Works"),
    );
    act(() => role?.click());
    const input = host.querySelector<HTMLInputElement>("aside input");
    if (input === null) throw new Error("no field in the side panel");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      set?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      input.blur();
    });
    await settle();
  };

  /** The one document the store holds, as it holds it once the app's saves are written. */
  const storedText = async () => {
    await act(async () => new Promise((done) => setTimeout(done, SAVE_DELAY + 200)));
    const store = new DocumentStore();
    const [row] = await store.list();
    const stored = row === undefined ? undefined : await store.get(row.id);
    await store.close();
    return JSON.stringify(stored?.document ?? null);
  };

  // Item 7's guard over an imported outline, for what is typed while check 3 runs: kept out of the
  // store until a page shows it, whether the outcome's marks are the stage's or not, and whether the
  // stop comes before the import is kept or after.
  for (const marks of ["agree", "differ"] as const)
    for (const lands of [undefined, 50])
      it(`keeps a letter typed while the checks run, whose compile stops, out of the store (marks ${marks}, ${lands === undefined ? "stopped at once" : "stopped later"})`, async () => {
        const { page, fields, outcome, document } = await early();
        const fixedRoles =
          marks === "agree"
            ? document
            : (
                await inventedOutline(
                  outlineParts().map((part) =>
                    part.kind === "group" && part.id === "roles"
                      ? { ...part, fixed: "copy" as const }
                      : part,
                  ),
                )
              ).document;
        await imported({ ...outcome, document: fixedRoles } as ImportOutcome, [page, fields]);
        landing.lands = lands;
        landing.report = { ...PARTIAL, outcome: "succeeded", rate: 0.97, locked: [] };
        await release();
        await release();
        expect(host.textContent).toContain(FIELDS_OPEN);
        await typeInFirstRole("Ж");
        await release();
        await settle();
        expect(landing.opened.some((each) => JSON.stringify(each).includes("Ж"))).toBe(true);
        expect(await storedText()).not.toContain("Ж");
        // Taken back to the document the checks compiled, which the store holds.
        expect(await storedText()).toContain("Lantern Works");
      });

  it("saves what was typed while the checks ran once a page shows it", async () => {
    const { page, fields, outcome } = await early();
    await imported(outcome, [page, fields]);
    landing.lands = 50;
    landing.report = { ...PARTIAL, outcome: "succeeded", rate: 0.97, locked: [] };
    await release();
    await release();
    await typeInFirstRole("Inkwell Press");
    // Nothing compiles while the checks hold the engine: the edit waits for the outcome.
    expect(landing.updated).toEqual([]);
    await release();
    await settle();
    expect(await storedText()).toContain("Inkwell Press");
  });

  // A success that has landed is kept by a write to the store that takes its time: what is typed
  // then compiles at once, the engine free, and is saved once its page shows, whether that page
  // comes before the import is kept or after.
  for (const order of ["before", "after"] as const)
    it(`compiles and saves what is typed while a landed import is being kept (page ${order} it is kept)`, async () => {
      const { page, fields, outcome } = await early();
      let keep = () => {};
      const write = DocumentStore.prototype.importDocument;
      const spy = vi
        .spyOn(DocumentStore.prototype, "importDocument")
        .mockImplementation(async function (this: DocumentStore, imported) {
          await new Promise<void>((done) => {
            keep = done;
          });
          return write.call(this, imported);
        });
      try {
        await imported(outcome, [page, fields]);
        landing.report = { ...PARTIAL, outcome: "succeeded", rate: 0.97, locked: [] };
        await release();
        await release();
        await release();
        // Landed and compiled, its write to the store under way.
        expect(landing.opened).toHaveLength(1);
        expect(spy).toHaveBeenCalledOnce();
        await typeInFirstRole("Inkwell Press");
        const typed = landing.updated.at(-1);
        expect(JSON.stringify(typed ?? null)).toContain("Inkwell Press");
        const pageOfTyped = () => act(() => landing.events?.page(blank(typed)));
        if (order === "before") pageOfTyped();
        await act(async () => keep());
        await settle();
        if (order === "after") {
          expect(await storedText()).not.toContain("Inkwell Press");
          pageOfTyped();
        }
        expect(await storedText()).toContain("Inkwell Press");
      } finally {
        spy.mockRestore();
      }
    });

  it("compiles nothing typed while the checks ran once the import is refused", async () => {
    const { page, fields } = await early();
    const refused = refusal("stopped");
    await imported(refused, [page, fields]);
    await release();
    await release();
    await typeInFirstRole("Inkwell Press");
    await release();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(refused.message);
    expect(landing.updated).toEqual([]);
    expect(landing.opened).toEqual([]);
  });

  it("offers a refused import its PDF", async () => {
    const refused = refusal("package", "inventedquillstyle");
    await imported(refused);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(refused.message);
    expect(host.textContent).toContain(PDF_OFFER);
  });
});
