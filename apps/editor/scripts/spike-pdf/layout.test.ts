import { describe, expect, it } from "vitest";
import { joinRows, layOut, unspaced } from "./layout.ts";
import type { Mark, PdfPage, ReadPdf, TextRun } from "./read.ts";

/** A run as pdf.js would give it: half an em a character wide, in a plain font unless told. */
function run(text: string, x: number, baseline: number, options: Partial<TextRun> = {}): TextRun {
  const size = options.size ?? 10;
  return {
    text,
    x,
    baseline,
    size,
    width: options.width ?? 0.5 * size * text.length,
    font: options.font ?? "Invented-Regular",
    bold: options.bold ?? false,
    italic: options.italic ?? false,
  };
}

const pdf = (runs: TextRun[], marks: Mark[] = [], width = 612): ReadPdf => ({
  pages: [{ number: 1, width, height: 792, runs, links: [], marks } satisfies PdfPage],
  ms: 0,
});

const texts = (read: ReadPdf) => layOut(read).lines.map((line) => line.text);

describe("rows, pieces and words", () => {
  it("joins runs on one baseline, and cuts a row at a wide gap", () => {
    const layout = layOut(
      pdf([
        run("Lantern", 50, 100, { bold: true }),
        run("Works", 87, 100, { bold: true }),
        run("Jan 2020 – Present", 470, 100),
      ]),
    );
    expect(layout.lines.map((line) => [line.text, line.rowIndex, line.rowSize])).toEqual([
      ["Lantern Works", 0, 2],
      ["Jan 2020 – Present", 1, 2],
    ]);
    expect(layout.lines[0]?.bold).toBe(true);
  });

  it("sets no space where runs touch, as a ligature's glyph and its word do", () => {
    expect(texts(pdf([run("Pro", 50, 100), run("fi", 65, 100), run("le", 75, 100)]))).toEqual([
      "Profile",
    ]);
  });

  it("takes the spaces out of letter-spaced text, and leaves short words alone", () => {
    expect(unspaced("S U M M A R Y")).toBe("SUMMARY");
    expect(unspaced("C O N TA C T")).toBe("CONTACT");
    expect(unspaced("I am a")).toBe("I am a");
    expect(unspaced("Go, C, R and Zig")).toBe("Go, C, R and Zig");
  });
});

describe("bullets and icons", () => {
  it("marks a bullet by its glyph, by a drawn dot, and by a dash written before the words", () => {
    const layout = layOut(
      pdf(
        [
          run("•", 60, 100, { size: 6 }),
          run("Ran the press for a year.", 70, 101),
          run("Kept the type cases in order.", 70, 140),
          run("- Wrote the shop's price list.", 60, 180),
          run("Plain text here.", 60, 220),
        ],
        [{ kind: "dot", x0: 60, y0: 135, x1: 63, y1: 138 }],
      ),
    );
    expect(layout.lines.map((line) => [line.text, line.bullet])).toEqual([
      ["Ran the press for a year.", true],
      ["Kept the type cases in order.", true],
      ["Wrote the shop's price list.", true],
      ["Plain text here.", false],
    ]);
  });

  it("drops an icon font's glyphs and pictographs, and counts them", () => {
    const layout = layOut(
      pdf([
        run("#", 40, 100, { font: "FontAwesome5Free-Solid" }),
        run("wren@example.com", 52, 100),
        run("☎", 150, 100),
        run("555-0142", 162, 100),
      ]),
    );
    // What is left stands apart where an icon was: two pieces, each a contact.
    expect(layout.lines.map((line) => line.text)).toEqual(["wren@example.com", "555-0142"]);
    expect(layout.icons).toBe(2);
  });
});

describe("paragraphs that wrap, and hyphens", () => {
  it("joins a bullet's rows, its first row full, and not two short lines", () => {
    const layout = layOut(
      pdf([
        run("•", 50, 100),
        run(
          "Rebuilt the bindery's schedule so that every order left on the day the customer",
          60,
          100,
          { width: 500 },
        ),
        run("was promised.", 60, 112),
        run("Short line.", 50, 140),
        run("Another short line.", 50, 152),
      ]),
    );
    expect(layout.lines.map((line) => [line.text, line.rows])).toEqual([
      [
        "Rebuilt the bindery's schedule so that every order left on the day the customer was promised.",
        2,
      ],
      ["Short line.", 1],
      ["Another short line.", 1],
    ]);
  });

  it("joins a word a hyphen broke only where the next row carries on in small letters", () => {
    expect(joinRows("kept the type-", "setting room tidy")).toEqual({
      text: "kept the typesetting room tidy",
      hyphen: true,
    });
    expect(joinRows("worked with Jean-", "Paul on it")).toEqual({
      text: "worked with Jean-Paul on it",
      hyphen: false,
    });
    expect(joinRows("a complicated journey be‐", "comes unremarkable").text).toBe(
      "a complicated journey becomes unremarkable",
    );
    expect(joinRows("from 2019 –", "2021")).toEqual({ text: "from 2019 – 2021", hyphen: false });
  });
});

describe("columns", () => {
  /** A sidebar of short lines at the left, and a main column of text at the right. */
  const sidebar = () => {
    const runs: TextRun[] = [run("Wren Halloway", 40, 60, { size: 20, bold: true })];
    for (let i = 0; i < 8; i++) runs.push(run(`Sidebar item ${i + 1}`, 40, 120 + 18 * i));
    for (let i = 0; i < 10; i++)
      runs.push(
        run(`Main column line ${i + 1} of the invented text`, 220, 113 + 15 * i, { width: 300 }),
      );
    return runs;
  };

  it("reads a sidebar, then the main column", () => {
    const layout = layOut(pdf(sidebar()));
    expect(layout.pages[0]?.columns).toBe(2);
    const order = layout.lines.map((line) => line.text);
    expect(order.slice(0, 2)).toEqual(["Wren Halloway", "Sidebar item 1"]);
    expect(order.indexOf("Sidebar item 8")).toBeLessThan(
      order.findIndex((text) => text.startsWith("Main column line 1")),
    );
    expect(layout.lines.find((line) => line.text.startsWith("Main"))?.column).toBe(1);
  });

  it("reads a table of years beside entries row by row, as one column", () => {
    const runs: TextRun[] = [];
    for (let i = 0; i < 6; i++) {
      runs.push(run(`${2010 + 2 * i} – ${2012 + 2 * i}`, 50, 100 + 30 * i));
      runs.push(run(`Invented post number ${i + 1}, Somewhere`, 150, 100 + 30 * i, { width: 250 }));
      runs.push(run(`What was done in post ${i + 1}.`, 160, 114 + 30 * i, { width: 200 }));
    }
    const layout = layOut(pdf(runs));
    expect(layout.pages[0]?.columns).toBe(1);
    expect(layout.lines.slice(0, 3).map((line) => line.text)).toEqual([
      "2010 – 2012",
      "Invented post number 1, Somewhere",
      "What was done in post 1.",
    ]);
  });

  it("keeps a title and its date at the row's end on one row, in one column", () => {
    const runs: TextRun[] = [];
    for (let i = 0; i < 6; i++) {
      runs.push(run(`Invented role ${i + 1}`, 50, 100 + 40 * i, { bold: true }));
      runs.push(run("2019 – 2021", 500, 100 + 40 * i));
      runs.push(run("Did a thing worth a line.", 60, 114 + 40 * i));
    }
    const layout = layOut(pdf(runs));
    expect(layout.pages[0]?.columns).toBe(1);
    expect(layout.lines.slice(0, 2).map((line) => line.text)).toEqual([
      "Invented role 1",
      "2019 – 2021",
    ]);
  });
});
