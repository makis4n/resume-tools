import { describe, expect, it } from "vitest";
import { countsOf, pdfErrorKind } from "./counts.ts";
import { fileLines } from "./file.ts";
import { layOut } from "./layout.ts";
import type { ReadPdf, TextRun } from "./read.ts";
import { summariseCorpus, tables } from "./report.ts";
import { labelByRules } from "./roles.ts";

function run(text: string, x: number, baseline: number, options: Partial<TextRun> = {}): TextRun {
  const size = options.size ?? 10;
  return {
    text,
    x,
    baseline,
    size,
    width: 0.5 * size * text.length,
    font: "Invented-Regular",
    bold: options.bold ?? false,
    italic: false,
  };
}

/** The words of an invented document, none of which its counts may hold. */
const WORDS = ["Quillon", "Marrowby", "quillon@example.com", "Typecaster", "Fennick", "bindery"];

const read: ReadPdf = {
  pages: [
    {
      number: 1,
      width: 612,
      height: 792,
      runs: [
        run("Quillon Marrowby", 200, 60, { size: 22, bold: true }),
        run("quillon@example.com", 220, 85),
        run("EXPERIENCE", 50, 120, { size: 12, bold: true }),
        run("Typecaster", 50, 140, { bold: true }),
        run("2019 – 2021", 500, 140),
        run("Fennick bindery work.", 60, 160),
      ],
      links: [],
      marks: [],
    },
  ],
  ms: 0,
};

describe("why no PDF was made", () => {
  it("is said by its kind, never by what xdvipdfmx said of a font or a file", () => {
    expect(
      pdfErrorKind(
        "the output has a \\special that reads a file or reconfigures xdvipdfmx: pdf:image",
      ),
    ).toBe("a special, pdf:image");
    expect(
      pdfErrorKind(
        'xdvipdfmx exited with 1\nxdvipdfmx:fatal: Cannot proceed without .vf or "physical" font for PDF output...',
      ),
    ).toBe("a font with no outline");
    expect(pdfErrorKind("xdvipdfmx exited with 1\nxdvipdfmx:fatal: quillon-font.pfb broke")).toBe(
      "xdvipdfmx failed",
    );
    expect(
      pdfErrorKind(
        "the output has a \\special that reads a file or reconfigures xdvipdfmx: psfile=",
      ),
    ).toBe("a special, psfile=");
    expect(pdfErrorKind(undefined)).toBe("no reason given");
  });
});

describe("the corpus's counts", () => {
  it("hold numbers and names of kinds, never a document's words", () => {
    const layout = layOut(read);
    const roles = labelByRules(layout);
    const counts = countsOf(layout, roles, fileLines(layout, roles));
    expect(counts).toMatchObject({ outcome: "read", pages: 1, sections: 1, columns: 1 });
    expect(counts.words?.read).toBe(counts.words?.landed);
    const kept = JSON.stringify({ id: "other-0001", family: "other", counts });
    for (const word of WORDS) expect(kept, word).not.toContain(word);
    const printed = tables({
      version: 1,
      corpus: {
        at: "2026-10-04T00:00:00.000Z",
        commit: "invented",
        summary: summariseCorpus([
          { id: "other-0001", family: "other", counts },
          { id: "other-0002", family: "other", counts: { outcome: "package" } },
        ]),
      },
    });
    for (const word of WORDS) expect(printed, word).not.toContain(word);
    expect(printed).toMatch(/Not read, by reason \| package 1/);
  });
});
