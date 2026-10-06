// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refusal } from "../import/refusal";
import { measuredImport } from "./ImportMeasurePage";
import { ImportTypingPage, measuredImportTyping } from "./ImportTypingPage";
import type { ImportTime } from "./import";
import type { ImportTypingMeasured } from "./import-typing";
import { measuredTemplate } from "./MeasurePage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The typing page, its imports and edits invented: no engine, worker or sample runs here.

/** An invented import of `engine`, 3 s from the file to the page in 20 compiles. */
const imported = (engine: "pdftex" | "xetex") => ({ ms: 3000, compiles: 20, engine }) as ImportTime;

/** An invented import typed on: three edits of a rich field, each `page` ms after `pause` ms. */
function typed(engine: "pdftex" | "xetex", page: number, pause: number): ImportTypingMeasured {
  const edit = {
    ms: page + pause,
    pauseMs: pause,
    pageMs: page,
    compileMs: page / 2,
    drawMs: page / 4,
    passes: 1,
    pages: 1,
  };
  return {
    import: imported(engine),
    typing: {
      typed: true,
      field: { id: "invented.text", kind: "rich", length: 150 },
      edits: [edit, edit, edit],
    },
  };
}

describe("the typing page", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => "visible");
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

  const text = () => host.querySelector("pre")?.textContent ?? "";

  it("imports each sample, types on it, and shows a row a sample and the summary", async () => {
    const asked: [string, number][] = [];
    const outcomes: Record<string, ImportTypingMeasured> = {
      "jake-0000": typed("pdftex", 80, 100),
      "altacv-0000": typed("pdftex", 120, 100),
      "awesome-cv-0000": typed("xetex", 350, 400),
    };
    const prepare = async (id: string, edits: number) => {
      asked.push([id, edits]);
      return async () => outcomes[id] as ImportTypingMeasured;
    };
    const samples = ["jake-0000", "altacv-0000", "awesome-cv-0000"];
    act(() => root.render(<ImportTypingPage samples={samples} prepare={prepare} edits={3} />));
    await vi.waitFor(() => expect(text()).toContain("None skipped."));
    expect(asked).toEqual([
      ["jake-0000", 3],
      ["altacv-0000", 3],
      ["awesome-cv-0000", 3],
    ]);
    const shown = text();
    expect(shown).toContain("then 3 edits of its longest editable field timed on that worker");
    expect(shown).toContain("The tab was in front throughout.");
    expect(shown).toMatch(
      /\njake-0000 +jake +pdftex +1 +rich, 150 ch +80 ms +80 ms +100 ms +40 ms +20 ms +180 ms +3\.00 s, 20 compiles/,
    );
    expect(shown).toMatch(/\nawesome-cv-0000 +awesome-cv +xetex +1 +rich, 150 ch +350 ms/);
    expect(shown).toMatch(/\nall +3 +2 \(67%\) +120 ms +350 ms +350 ms +220 ms/);
    expect(shown).toContain(
      "2 of 3 resumes (67%) edit to the page within 300 ms by the page's own time",
    );
    expect(host.querySelector("h1")?.textContent).toBe("Typing on an imported resume");
  });

  it("counts a sample the import refused, and types on the rest", async () => {
    const prepare = async (id: string) => async () =>
      id === "jake-0000"
        ? { refused: { refused: refusal("probe"), startMs: 1, parts: [] } }
        : typed("pdftex", 90, 100);
    act(() =>
      root.render(<ImportTypingPage samples={["jake-0000", "altacv-0000"]} prepare={prepare} />),
    );
    await vi.waitFor(() => expect(text()).toContain("Skipped 1"));
    expect(text()).toContain("Skipped 1: refused 1 (probe 1)");
    expect(text()).toContain("1 of 1 resumes (100%)");
  });

  it("says the measurement stopped when it fails, and what for in the console", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() =>
      root.render(
        <ImportTypingPage
          samples={["jake-0000"]}
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

describe("measuredImportTyping", () => {
  it("reads the samples to type on from the location", () => {
    expect(measuredImportTyping("?measure=import-typing")).toEqual([
      "jake-0000",
      "altacv-0000",
      "awesome-cv-0000",
    ]);
    expect(measuredImportTyping("?measure=import-typing&sample=altacv-0000")).toEqual([
      "altacv-0000",
    ]);
    // A sample the page does not type on is none, which the page says.
    expect(measuredImportTyping("?measure=import-typing&sample=other-0001")).toEqual([]);
    expect(measuredImportTyping("?measure=import")).toBeUndefined();
    expect(measuredImportTyping("")).toBeUndefined();
    // The other pages do not take it for theirs, but for the routing's order in main.tsx.
    expect(measuredImport("?measure=import-typing")).toBeUndefined();
    expect(measuredTemplate("?measure=import-typing")).toBe("import-typing");
  });
});
