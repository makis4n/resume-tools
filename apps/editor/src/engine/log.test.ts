import { describe, expect, it } from "vitest";
import { summariseLog } from "./log";

describe("summariseLog", () => {
  it("reads the page count from a clean run", () => {
    const log = "This is pdfTeX\n(./doc.tex)\nOutput written on doc.dvi (2 pages, 10432 bytes).\n";
    expect(summariseLog(log)).toEqual({
      error: undefined,
      errorLine: undefined,
      pages: 2,
      rerun: false,
    });
    expect(summariseLog("Output written on doc.xdv (1 page, 812 bytes).").pages).toBe(1);
  });

  it("reports no pages when TeX shipped none", () => {
    expect(summariseLog("No pages of output.\n").pages).toBe(0);
  });

  it("takes the first error and the line TeX stopped at", () => {
    const log = [
      "(./doc.tex",
      "! Undefined control sequence.",
      "l.12 \\foo",
      "         {bar}",
      "! Emergency stop.",
      "No pages of output.",
    ].join("\n");
    expect(summariseLog(log)).toMatchObject({
      error: "Undefined control sequence.",
      errorLine: 12,
      pages: 0,
    });
  });

  it("reads a missing file error", () => {
    const log = "! LaTeX Error: File `nothere.sty' not found.\n\nType X to quit.\n";
    expect(summariseLog(log).error).toBe("LaTeX Error: File `nothere.sty' not found.");
  });

  it("notices a request for another run", () => {
    expect(
      summariseLog("LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.")
        .rerun,
    ).toBe(true);
    expect(
      summariseLog(
        "Package rerunfilecheck Warning: File `doc.out' has changed.\n(rerunfilecheck)                Rerun to get outlines right",
      ).rerun,
    ).toBe(true);
    expect(summariseLog("LaTeX Warning: There were undefined references.").rerun).toBe(false);
  });
});
