import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { CURATED } from "../templates/curated";
import { generateBody, generateFormat } from "../templates/generate";
import { defaultControls, fontFiles, forRole } from "../templates/package";
import { joinRows, type Layout, layOut, sameBlock, unspaced } from "./layout";
import { readPdf } from "./node";
import type { Mark, PdfPage, PdfReading, ReadPdf, TextRun } from "./read";
import { isPdfRefusal } from "./refusals";

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

describe("icons, noted", () => {
  it("notes a dropped icon on the line it stood before, and counts one at a row's end", () => {
    const layout = layOut(
      pdf([
        run("", 40, 100, { font: "FontAwesome5Free-Solid" }),
        run("wren@example.com", 52, 100),
        run("Halloway Press", 40, 130),
        run("", 120, 130, { font: "FontAwesome5Free-Solid" }),
        run("", 40, 160, { font: "FontAwesome5Free-Solid" }),
      ]),
    );
    expect(layout.lines.map((line) => [line.text, line.icons])).toEqual([
      ["wren@example.com", 1],
      ["Halloway Press", 1],
    ]);
    // A row of icons alone leaves no line, and its icon is counted all the same.
    expect(layout.icons).toBe(3);
  });
});

describe("a bullet beside another column's row", () => {
  it("keeps its glyph where a row of the other column stands a little higher", () => {
    // The right column's row sits 4.4 pt above the bullet's: near enough to take the bullet's
    // text, were it not for the bullet's own row, which is nearer.
    const runs: TextRun[] = [
      run("Arabic: fluent", 360, 341.9),
      run("•", 36, 346.3, { size: 9 }),
      run("Shipped an invented map editor that field teams use", 46, 346.3),
    ];
    const layout = layOut(pdf(runs));
    expect(layout.lines.find((line) => line.text.startsWith("Shipped"))?.bullet).toBe(true);
  });
});

describe("blocks", () => {
  it("groups lines that follow one another closely, and cuts at a gap, a rule and a heading", () => {
    const layout = layOut(
      pdf(
        [
          run("Experience", 50, 100, { size: 12, bold: true }),
          run("Invented Role", 50, 122, { bold: true }),
          run("2019 – 2021", 500, 122),
          run("Lantern Works", 50, 134, { italic: true }),
          run("•", 55, 146),
          run("Did a thing worth a line.", 65, 146),
          run("•", 55, 158),
          run("Did another thing.", 65, 158),
          run("Second Invented Role", 50, 190, { bold: true }),
          run("Kept the type cases in order.", 50, 202),
        ],
        // The heading's rule, under it.
        [{ kind: "rule", x0: 50, y0: 106, x1: 560, y1: 106.5 }],
      ),
    );
    const blocks = layout.blocks.map((block) =>
      block.lines.map((id) => layout.lines[id]?.text ?? ""),
    );
    expect(blocks).toEqual([
      ["Experience"],
      [
        "Invented Role",
        "2019 – 2021",
        "Lantern Works",
        "Did a thing worth a line.",
        "Did another thing.",
      ],
      ["Second Invented Role", "Kept the type cases in order."],
    ]);
    for (const [index, block] of layout.blocks.entries()) {
      expect(block.id).toBe(index);
      for (const id of block.lines) expect(layout.lines[id]?.block).toBe(block.id);
    }
    expect(layout.blocks[1]).toMatchObject({ page: 1, column: 0, columns: 1, x0: 50, top: 114.5 });
  });

  it("keeps a column's lines apart from the other column's, and a page's from the next", () => {
    const runs: TextRun[] = [];
    // Baselines of their own, as two columns set apart have; on shared ones they read as a table.
    for (let i = 0; i < 8; i++) runs.push(run(`Sidebar item ${i + 1}`, 40, 120 + 18 * i));
    // Short of the column's right edge, so that no line carries on into the next as a paragraph.
    for (let i = 0; i < 8; i++)
      runs.push(
        run(`Main column line ${i + 1} of the invented text`, 220, 113 + 15 * i, {
          width: i === 7 ? 300 : 200,
        }),
      );
    const read: ReadPdf = {
      pages: [
        { number: 1, width: 612, height: 792, runs, links: [], marks: [] },
        {
          number: 2,
          width: 612,
          height: 792,
          runs: [run("Main column line 9 of the invented text", 220, 60)],
          links: [],
          marks: [],
        },
      ],
      ms: 0,
    };
    const layout = layOut(read);
    expect(layout.pages.map((page) => page.columns)).toEqual([2, 1]);
    expect(layout.blocks.map((block) => [block.page, block.column, block.lines.length])).toEqual([
      [1, 0, 8],
      [1, 1, 8],
      [2, 0, 1],
    ]);
  });

  it("tells a line below another from one on its row, and leaves a loose column whole", () => {
    // A column set with loose leading: every gap is wider than 0.6 em, none wider than its usual.
    const runs = Array.from({ length: 6 }, (_, i) => run(`Loose line ${i + 1}`, 50, 100 + 18 * i));
    const layout = layOut(pdf(runs));
    expect(layout.blocks).toHaveLength(1);
    const [first, second] = layout.lines;
    if (first === undefined || second === undefined) throw new Error("no lines");
    expect(sameBlock(first, second)).toBe(false);
    expect(sameBlock(first, second, { usualGap: 10.5 })).toBe(true);
  });
});

/** The PDFs the spike made in other tools: Chrome's print and macOS's text system (decision 0051). */
const OTHER_DIR = fileURLToPath(
  new URL("../../scripts/spike-pdf/fixtures/other/", import.meta.url),
);

const readOf = (result: PdfReading): ReadPdf => {
  if (isPdfRefusal(result)) throw new Error(`refused: ${result.reason}`);
  return result;
};

/**
 * What every layout holds: lines and blocks in reading order, each block's lines consecutive and
 * in one column of one page, and, where a page has two columns, no line across the gap between.
 */
function expectWellLaidOut(layout: Layout, what: string) {
  expect(layout.lines.length, what).toBeGreaterThan(0);
  let next = 0;
  for (const block of layout.blocks) {
    for (const id of block.lines) {
      expect(id, what).toBe(next++);
      const line = layout.lines[id];
      expect(line, what).toMatchObject({
        block: block.id,
        page: block.page,
        column: block.column,
        columns: block.columns,
      });
    }
  }
  expect(next, what).toBe(layout.lines.length);
  for (const page of layout.pages) {
    const split = layout.lines.filter((line) => line.page === page.number && line.columns === 2);
    const left = split.filter((line) => line.column === 0);
    const right = split.filter((line) => line.column === 1);
    if (left.length === 0 || right.length === 0) continue;
    // The left column's lines end before the right's begin: no line holds words of both.
    expect(Math.max(...left.map((line) => line.x1)), `${what} p${page.number}`).toBeLessThan(
      Math.min(...right.map((line) => line.x0)),
    );
    // And the left column is read whole before the right.
    expect(Math.max(...left.map((line) => line.id)), what).toBeLessThan(
      Math.min(...right.map((line) => line.id)),
    );
  }
}

describe("the PDFs of other tools", () => {
  const COLUMNS: Record<string, number> = {
    "chrome-icons": 1,
    "chrome-one-column": 1,
    "chrome-right-sidebar": 2,
    "chrome-sidebar": 2,
    "chrome-table": 1,
    "textedit-rtf": 1,
    "textutil-html": 1,
    "textutil-table": 1,
  };

  it("knows each fixture's columns", () => {
    expect(readdirSync(OTHER_DIR).sort()).toEqual(Object.keys(COLUMNS).sort());
  });

  it.each(Object.entries(COLUMNS))(
    "lays %s out in %i column(s), in reading order",
    async (name, columns) => {
      const read = readOf(
        await readPdf(new Uint8Array(readFileSync(join(OTHER_DIR, name, "resume.pdf")))),
      );
      const layout = layOut(read);
      expectWellLaidOut(layout, name);
      expect(Math.max(...layout.pages.map((page) => page.columns)), name).toBe(columns);
      expect(layout.blocks.length, name).toBeLessThan(layout.lines.length);
    },
    60_000,
  );

  it("reads a sidebar's sections before the main column's", async () => {
    const read = readOf(
      await readPdf(new Uint8Array(readFileSync(join(OTHER_DIR, "chrome-sidebar", "resume.pdf")))),
    );
    const order = layOut(read).lines.map((line) => line.text);
    const at = (text: string) => order.indexOf(text);
    for (const sidebar of ["CONTACT", "SKILLS", "LANGUAGES"])
      for (const main of ["PROFILE", "EXPERIENCE", "EDUCATION", "PROJECTS"])
        expect(at(sidebar), `${sidebar} before ${main}`).toBeLessThan(at(main));
    expect(at("CONTACT")).toBeGreaterThan(-1);
  }, 60_000);
});

describe.skipIf(!engineAvailable())("the layout of the PDFs the built-in templates make", () => {
  /** Each built-in template's PDF of its own invented sample, as the editor exports one. */
  const made = new Map<string, Layout>();

  beforeAll(async () => {
    const session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    const fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    for (const { package: pkg, sample } of CURATED.values()) {
      const values = defaultControls(pkg);
      const files = fontFiles(pkg);
      const covers = files.length === 0 ? undefined : (await fonts.coverage(files)).covers;
      const format = generateFormat(pkg, values);
      expect(session.dump(pkg.engine, format.name, format.preamble, format.files).ok).toBe(true);
      const body = generateBody(pkg, sample, values, covers === undefined ? {} : { covers });
      const job = `layout-${pkg.id}`;
      const result = session.compile(pkg.engine, format.name, body.latex, { job, maxPasses: 3 });
      expect(result.ok, pkg.id).toBe(true);
      const pdf = session.pdf(job);
      if (!pdf.ok || pdf.pdf === undefined) throw new Error(`${pkg.id} made no PDF: ${pdf.error}`);
      made.set(pkg.id, layOut(readOf(await readPdf(pdf.pdf))));
    }
  }, 120_000);

  const layoutOf = (id: string) => {
    const layout = made.get(id);
    if (layout === undefined) throw new Error(`${id} made no PDF`);
    return layout;
  };

  /** The sample's section titles in the order the layout reads their headings. */
  const titlesRead = (id: string) => {
    const sample = CURATED.get(id)?.sample;
    if (sample === undefined) throw new Error(`no sample for ${id}`);
    const titles = new Map(
      sample.sections.map((section) => [section.title.toLowerCase(), section]),
    );
    return layoutOf(id)
      .lines.filter((line) => titles.has(line.text.toLowerCase()))
      .map((line) => titles.get(line.text.toLowerCase())?.title);
  };

  it("reads AltaCV's two columns as a person does: the left column whole, then the right", () => {
    const curated = CURATED.get("altacv");
    if (curated === undefined) throw new Error("no AltaCV");
    const { package: pkg, sample } = curated;
    const layout = layoutOf("altacv");
    expectWellLaidOut(layout, "altacv");
    expect(layout.pages[0]?.columns).toBe(2);
    // The template sets a section in the right column where its snippet switches to it.
    const right = (section: (typeof sample.sections)[number]) =>
      section.kind !== "locked" &&
      section.kind !== "outline" &&
      forRole(pkg.snippets.section[section.kind], section.role).includes("\\switchcolumn[1]");
    const expected = [
      ...sample.sections.filter((section) => !right(section)),
      ...sample.sections.filter(right),
    ].map((section) => section.title);
    expect(expected.slice(0, 3)).toEqual(["Experience", "Education", "Projects"]);
    expect(titlesRead("altacv")).toEqual(expected);
    // The header spans the page, above both columns, and is read first.
    const name = `${sample.header.name.first} ${sample.header.name.last}`;
    expect(layout.lines[0]).toMatchObject({ text: name, columns: 1 });
    // Every line of a section stands in that section's column: each heading's column holds the
    // lines up to the next heading of that column.
    const headings = layout.lines.filter((line) => expected.includes(line.text));
    for (const heading of headings) {
      const section = sample.sections.find((each) => each.title === heading.text);
      expect(heading.column, heading.text).toBe(section && right(section) ? 1 : 0);
      expect(heading.columns, heading.text).toBe(2);
    }
    // Each bullet of the left column's entries is read before the right column's first heading.
    const firstRight = headings.find((line) => line.column === 1)?.id ?? -1;
    const leftBullets = layout.lines.filter((line) => line.bullet && line.column === 0);
    expect(leftBullets.length).toBe(
      sample.sections
        .filter((section) => !right(section))
        .flatMap((section) => (section.kind === "entries" ? section.entries : []))
        .reduce((sum, entry) => sum + entry.bullets.length, 0),
    );
    for (const bullet of leftBullets) expect(bullet.id).toBeLessThan(firstRight);
  });

  it.each(["jake", "awesome-cv"])("reads %s in one column, its sections in order", (id) => {
    const layout = layoutOf(id);
    expectWellLaidOut(layout, id);
    expect(Math.max(...layout.pages.map((page) => page.columns))).toBe(1);
    expect(titlesRead(id)).toEqual(
      CURATED.get(id)?.sample.sections.map((section) => section.title),
    );
  });
});
