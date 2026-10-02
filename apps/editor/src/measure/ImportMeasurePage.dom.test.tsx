// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Engine } from "../engine/session";
import { refusal } from "../import/refusal";
import { ImportMeasurePage, measuredImport, sampleUrl } from "./ImportMeasurePage";
import { IMPORT_BAR, type ImportMeasured, type ImportTime } from "./import";
import { measuredTemplate } from "./MeasurePage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The import's measurement page, its imports invented: no engine, worker or sample runs here.

/**
 * An invented import, `ms` long in all: its validation is what is left past the rest. Its report is
 * partial, as Jake's Resume's sample's is, which the app would hold for the person's Continue.
 */
function timed(ms: number): ImportTime {
  const parts = [
    { part: "load" as const, ms: 20, compiles: 0, dumps: 0, engineMs: 0 },
    { part: "reference" as const, ms: 400, compiles: 1, dumps: 0, engineMs: 380 },
    { part: "validate" as const, ms: ms - 925, compiles: 30, dumps: 3, engineMs: ms - 1000 },
    { part: "report" as const, ms: 5, compiles: 0, dumps: 0, engineMs: 0 },
    { part: "page" as const, ms: 500, compiles: 1, dumps: 1, engineMs: 420 },
  ];
  return {
    startMs: 400,
    parts,
    ms,
    compiles: 32,
    engine: "pdftex",
    naming: { hits: 7, asked: 0, conflicts: 0, missing: 0 },
    outcome: "assembled",
    fields: { editable: 40, locked: 5 },
    report: { outcome: "partial", rate: 0.83 },
    page: { formatMs: 30, dumped: false, passes: [80, 70], drawMs: 40, pages: 1 },
  };
}

/** What the page's tab says of its visibility, which the test sets. */
let visibility: DocumentVisibilityState = "visible";

describe("the import's measurement page", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    vi.spyOn(console, "log").mockImplementation(() => {});
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  /** The page with invented imports, each coming to what `next` gives; what it was asked. */
  function rendered(next: (index: number) => ImportMeasured, runs = 3) {
    const asked: Engine[] = [];
    let index = 0;
    const prepare = async (engine: Engine) => {
      asked.push(engine);
      return async () => next(index++);
    };
    act(() => root.render(<ImportMeasurePage engine="pdftex" prepare={prepare} runs={runs} />));
    return asked;
  }

  const text = () => host.querySelector("pre")?.textContent ?? "";

  it("shows the table of the timed imports as text, the warm-up left out", async () => {
    // The warm-up is far slower, and must not reach a median.
    const asked = rendered((index) =>
      timed(index === 0 ? 9000 : ([4200, 4000, 4400][index - 1] ?? 0)),
    );
    await vi.waitFor(() => expect(text()).toContain(IMPORT_BAR));
    expect(asked).toEqual(["pdftex"]);
    const shown = text();
    expect(shown).toContain(
      "One import first, not counted, filled the HTTP cache; then 3 were timed.",
    );
    expect(shown).toContain("The tab was in front throughout.");
    expect(shown).toContain(
      "Jake's Resume's upstream sample (jake-0000), imported on pdftex: the median of 3 imports",
    );
    expect(shown).toMatch(/\nreference +400 ms +1 +0 +380 ms +Compiling your resume as it stands/);
    expect(shown).toMatch(/\nreport +5\.00 ms +0 +0 +0\.00 ms +Reading the import's report/);
    expect(shown).toMatch(/\nwhole +4\.20 s +32 +4 +.*from 4\.00 s to 4\.40 s/);
    // Partial, which the app would hold for the person's Continue, and the measurement does not.
    expect(shown).toContain("reported partial, 83% of the words editable on the page");
    expect(shown).toContain(
      "clicks Continue before the page part; the measurement goes straight on",
    );
    // Judged with the engine's start, 400 ms, and without the dev server's load, 20 ms, against the
    // bar decision 0045 raised.
    expect(shown).toContain("its format taken from the import's checks in 30 ms");
    expect(shown).toMatch(
      /under 8 s +4\.58 s met, with the engine's start, without loading the import's code$/,
    );
    expect(host.querySelector("h1")?.textContent).toBe("The import, from the file to the page");
  });

  it("says how far it has got while the imports run", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let index = 0;
    const prepare = async () => async () => {
      const at = index++;
      // The second timed import waits for the test.
      if (at === 2) await held;
      return timed(at === 0 ? 9000 : 4200);
    };
    act(() => root.render(<ImportMeasurePage engine="pdftex" prepare={prepare} runs={2} />));
    await vi.waitFor(() =>
      expect(text()).toBe("Timing import 2 of 2… The warm-up took 9.00 s. So far: 4.20 s."),
    );
    await act(async () => release());
    await vi.waitFor(() => expect(text()).toContain(IMPORT_BAR));
  });

  it("says when the tab was hidden during a timed import", async () => {
    rendered((index) => {
      // Hidden during the second timed import, as a tab behind another is.
      if (index === 2) {
        visibility = "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
        visibility = "visible";
      }
      return timed(4000);
    }, 2);
    await vi.waitFor(() => expect(text()).toContain(IMPORT_BAR));
    expect(text()).toContain(
      "The tab was hidden during 1 of the 2 timed imports, which Chrome slows: measure again with the tab in front.",
    );
  });

  it("says why the sample was refused, in the refusal's own words", async () => {
    rendered(() => ({ refused: refusal("probe"), startMs: 1, parts: [] }));
    await vi.waitFor(() => expect(text()).toContain("was refused"));
    expect(text()).toBe(
      `Jake's Resume's upstream sample (jake-0000) was refused in the import that warms up (probe): ${refusal("probe").message}`,
    );
  });

  it("says the measurement stopped when it fails, and what for in the console", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() =>
      root.render(
        <ImportMeasurePage
          engine="xetex"
          prepare={async () => {
            throw new Error("HTTP 404");
          }}
        />,
      ),
    );
    await vi.waitFor(() => expect(text()).toBe("The measurement stopped; the console says why."));
    expect(error).toHaveBeenCalled();
  });
});

describe("measuredImport", () => {
  it("reads the engine to measure the import on from the location", () => {
    expect(measuredImport("?measure=import")).toBe("pdftex");
    expect(measuredImport("?measure=import-xetex&x=1")).toBe("xetex");
    expect(measuredImport("?measure=1")).toBeUndefined();
    expect(measuredImport("?measure=jake")).toBeUndefined();
    expect(measuredImport("")).toBeUndefined();
    // The page that measures a package is asked for otherwise.
    expect(measuredTemplate("?measure=jake")).toBe("jake");
  });

  it("asks the dev server for a sample at its route", () => {
    expect(sampleUrl("jake-0000")).toBe("/measure/samples/jake-0000.zip");
  });
});
