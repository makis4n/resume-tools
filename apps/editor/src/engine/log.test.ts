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
    expect(summariseLog("LaTeX Warning: Rerun to correct eqparbox widths.").rerun).toBe(true);
    expect(
      summariseLog("Package longtable Warning: Table widths have changed. Rerun LaTeX.").rerun,
    ).toBe(true);
    // biblatex asks on every pass, for Biber and a pass after it, as \MessageBreak breaks it.
    const biber = [
      "Package biblatex Warning: Please (re)run Biber on the file:",
      "(biblatex)                doc",
      "(biblatex)                and rerun LaTeX afterwards.",
    ].join("\n");
    expect(summariseLog(biber).rerun).toBe(true);
    expect(summariseLog("LaTeX Warning: There were undefined references.").rerun).toBe(false);
    expect(
      summariseLog(
        "Package rerunfilecheck Info: File `doc.out' has not changed.\n(rerunfilecheck)                Checksum: 1234;390.",
      ).rerun,
    ).toBe(false);
  });

  it("takes the word only from warnings", () => {
    // rerunfilecheck's banner, which every document with hyperref prints.
    const banner = "Package: rerunfilecheck 2022-07-10 v1.10 Rerun checks for auxiliary files (HO)";
    expect(summariseLog(banner).rerun).toBe(false);
    // A line of the document, echoed after an overfull box.
    const echoed =
      "Overfull \\hbox (3.0pt too wide) in paragraph at lines 3--4\n[]\\OT1/cmr/m/n/10 Rerun the nightly jobs";
    expect(summariseLog(echoed).rerun).toBe(false);
    // A warning that asks on its second line, after \MessageBreak.
    const broken = "LaTeX Warning: Something changed.\n               Please rerun LaTeX.";
    expect(summariseLog(broken).rerun).toBe(true);
    // A warning ends where a line stops carrying it on.
    const after = "LaTeX Warning: Something changed.\nRerun the nightly jobs";
    expect(summariseLog(after).rerun).toBe(false);
  });
});
