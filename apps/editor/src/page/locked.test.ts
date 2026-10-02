import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { PRELUDE } from "../templates/prelude";
import { type DviDocument, type PageItem, parseDvi, pointsPerUnit } from "../tex/dvi";
import { INCH } from "../tex/svg";
import { drawPage, widthsOf } from "./draw";
import { FontLibrary, type PageFont } from "./fonts";
import { blocksOf, type LockedSet, lockedSets, lockMarker, type Placed } from "./locked";
import { TexLiveIndex } from "./texlive";

// Invented pages, in TeX's units, the scaled point: every glyph a character of cmr10 at 10 pt, 5 pt
// wide, and each text an invented one.
const SP = 2 ** 16;

/** The glyphs of `text` from `h` along the baseline `v`, in points: 5 apart, a space 3 more. */
function line(text: string, h: number, v: number): PageItem[] {
  const items: PageItem[] = [];
  let at = h;
  for (const character of text) {
    if (character === " ") {
      at += 3;
      continue;
    }
    const code = character.codePointAt(0) ?? 0;
    items.push({ kind: "glyph", font: 1, code, h: at * SP, v: v * SP, width: 5 * SP });
    at += 5;
  }
  return items;
}

/**
 * A special at `h` points along and `v` down: a lock marker stands at the left edge of its column,
 * where TeX writes it between two sections, below what comes before it.
 */
const special = (text: string, h = 0, v = 0): PageItem => ({
  kind: "special",
  h: h * SP,
  v: v * SP,
  text,
});

/** A document of the pages given, its glyphs in cmr10 and its native runs in an invented font. */
function documentOf(...pages: PageItem[][]): DviDocument {
  return {
    id: 7,
    numerator: 25_400_000,
    denominator: 473_628_672,
    magnification: 1000,
    comment: "",
    fonts: new Map([[1, { id: 1, name: "cmr10", checksum: 0, scale: 10 * SP, design: 10 * SP }]]),
    nativeFonts: new Map([[2, { id: 2, name: "Invented.otf", index: 0, size: 10 * SP, flags: 0 }]]),
    pages: pages.map((items) => ({ counters: [], items })),
  };
}

/** What a part's glyphs spell, page by page, read off the document, and how many rules it has. */
function spelt(doc: DviDocument, set: LockedSet | undefined) {
  const pages = new Map<number, string>();
  for (const each of set?.items ?? []) {
    const item = doc.pages[each.page]?.items[each.item];
    if (item?.kind === "glyph")
      pages.set(each.page, `${pages.get(each.page) ?? ""}${String.fromCodePoint(item.code)}`);
  }
  return {
    pages: Object.fromEntries(pages),
    rules: (set?.items ?? []).filter((each) => each.kind === "rule").length,
  };
}

describe("lockMarker", () => {
  it("reads a part's start and its end, its id lowercased, and nothing from another special", () => {
    expect(lockMarker("rt:l:lock-hobbies")).toEqual({ id: "lock-hobbies", end: false });
    expect(lockMarker("rt:l:/lock-hobbies")).toEqual({ id: "lock-hobbies", end: true });
    expect(lockMarker("RT:L:/LOCK-HOBBIES")).toEqual({ id: "lock-hobbies", end: true });
    expect(lockMarker("rt:b:lock-hobbies")).toBeUndefined();
    expect(lockMarker("rt:p:fennel.title:hsize=1pt")).toBeUndefined();
    expect(lockMarker("color push gray 0")).toBeUndefined();
  });
});

describe("lockedSets", () => {
  it("gives a part what is set between its two markers, and nothing of a field's or past it", () => {
    const doc = documentOf([
      special("rt:b:fennel.title"),
      ...line("Fennel", 0, 10),
      special("rt:e:fennel.title"),
      special("rt:l:lock-hobbies"),
      ...line("Hobbies", 0, 30),
      { kind: "rule", h: 0, v: 32 * SP, width: 100 * SP, height: SP },
      // A rule the page does not draw is none of the part's.
      { kind: "rule", h: 0, v: 33 * SP, width: 100 * SP, height: 0 },
      ...line("Rowing on the river", 0, 45),
      special("rt:l:/lock-hobbies"),
      ...line("After", 0, 60),
    ]);
    const sets = lockedSets(doc);
    expect([...sets.keys()]).toEqual(["lock-hobbies"]);
    expect(spelt(doc, sets.get("lock-hobbies"))).toEqual({
      pages: { 0: "HobbiesRowingontheriver" },
      rules: 1,
    });
    // Its first glyph comes after the field's marker, its six glyphs, its end and the part's marker.
    expect(sets.get("lock-hobbies")?.items[0]).toEqual({ kind: "glyph", page: 0, item: 9 });
  });

  it("runs a part a page breaks on to its second marker, on the next page", () => {
    const doc = documentOf(
      [...line("Before", 0, 10), special("rt:l:lock-talks"), ...line("On type", 0, 700)],
      [...line("by hand", 0, 20), special("rt:l:/lock-talks"), ...line("Past", 0, 40)],
    );
    expect(spelt(doc, lockedSets(doc).get("lock-talks"))).toEqual({
      pages: { 0: "Ontype", 1: "byhand" },
      rules: 0,
    });
  });

  it("takes a field's markers inside a part, and what they hold, as the field's", () => {
    // A macro the part's LaTeX calls may typeset a stored field, as a header a class stored is set.
    const doc = documentOf([
      special("RT:L:LOCK-HEAD"),
      ...line("Kept", 0, 10),
      special("rt:b:header.first"),
      special("rt:p:header.first:hsize=100pt"),
      ...line("Quill", 30, 10),
      special("rt:e:header.first"),
      ...line("too", 60, 10),
      special("rt:l:/lock-head"),
    ]);
    const sets = lockedSets(doc);
    expect([...sets.keys()]).toEqual(["lock-head"]);
    expect(spelt(doc, sets.get("lock-head")).pages).toEqual({ 0: "Kepttoo" });
    // The part resumes after the field, where its blocks part, so that none lies over the field.
    expect(sets.get("lock-head")?.items.map((each) => each.resumes === true)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it("keeps every glyph of a part one page holds, its cells side by side, its start on the page before", () => {
    // TeX writes the start at the foot of a page and sets the part, a heading and a table of rows
    // of two cells, the right cell back up beside the left, wholly on the next.
    const rows = [
      ...line("Skills", 0, 40),
      ...line("Left one", 0, 60),
      ...line("Left two", 0, 72),
      ...line("Right one", 200, 60),
      ...line("Right two", 200, 72),
      ...line("Next row", 0, 100),
    ];
    const doc = documentOf(
      [...line("Before", 0, 690), special("rt:l:lock-skills")],
      [...rows, special("rt:l:/lock-skills"), ...line("After", 0, 120)],
    );
    expect(spelt(doc, lockedSets(doc).get("lock-skills")).pages).toEqual({
      1: "SkillsLeftoneLefttwoRightoneRighttwoNextrow",
    });
  });

  it("keeps, of a part a page breaks, its cells side by side on the first page and its lines after", () => {
    // The reviewer's case: a cell beside the last goes back up no higher than the part's first
    // line, so it is no other column's, and the rows after it are the part's too.
    const doc = documentOf(
      [
        ...line("Before", 0, 10),
        special("rt:l:lock-skills"),
        ...line("Skills", 0, 600),
        ...line("Left one", 0, 620),
        ...line("Left two", 0, 632),
        ...line("Right one", 200, 620),
        ...line("Right two", 200, 632),
        ...line("Next row", 0, 660),
        ...line("Last row", 0, 690),
      ],
      [
        ...line("Rest", 0, 20),
        ...line("Left cell", 0, 40),
        ...line("Right cell", 200, 40),
        special("rt:l:/lock-skills"),
        ...line("After", 0, 60),
      ],
    );
    expect(spelt(doc, lockedSets(doc).get("lock-skills")).pages).toEqual({
      0: "SkillsLeftoneLefttwoRightoneRighttwoNextrowLastrow",
      1: "RestLeftcellRightcell",
    });
  });

  it("takes each glyph of a native run, but its .notdef, which draws nothing", () => {
    const doc = documentOf([
      special("rt:l:lock-run"),
      {
        kind: "native",
        font: 2,
        h: 10 * SP,
        v: 20 * SP,
        width: 12 * SP,
        glyphs: [
          { id: 5, x: 0, y: 0 },
          { id: 0, x: 4 * SP, y: 0 },
          { id: 6, x: 8 * SP, y: SP },
        ],
      },
      special("rt:l:/lock-run"),
    ]);
    expect(lockedSets(doc).get("lock-run")?.items).toEqual([
      { kind: "glyph", page: 0, item: 1, glyph: 0 },
      { kind: "glyph", page: 0, item: 1, glyph: 2 },
    ]);
  });

  it("keeps, of a part the output sets out of order, the run into its end and the run from its start", () => {
    // As paracol sets two columns, page by page: a part that runs from the foot of the first
    // column, on the second page, into the top of the second, on the first, ends there before it
    // starts; between lie the first page's columns and another part. And a part with no end.
    const doc = documentOf(
      [
        ...line("Left", 0, 10),
        ...line("column", 0, 700),
        ...line("Mine", 300, 10),
        special("rt:l:/lock-switch", 300),
        ...line("Right column", 300, 30),
        special("rt:l:lock-tags", 300),
        ...line("Tags", 300, 50),
        special("rt:l:/lock-tags", 300),
      ],
      [
        ...line("More left", 0, 10),
        special("rt:l:lock-switch"),
        ...line("Also mine", 0, 600),
        ...line("Right again", 300, 10),
      ],
      [special("rt:l:lock-open"), ...line("Never ended", 0, 10)],
    );
    const sets = lockedSets(doc);
    // Each part where its first marker came.
    expect([...sets.keys()]).toEqual(["lock-switch", "lock-tags", "lock-open"]);
    expect(spelt(doc, sets.get("lock-switch")).pages).toEqual({ 0: "Mine", 1: "Alsomine" });
    expect(spelt(doc, sets.get("lock-tags")).pages).toEqual({ 0: "Tags" });
    expect(sets.get("lock-open")?.items).toEqual([]);
  });

  it("keeps, of a part two columns break across pages, only its own column's runs", () => {
    // Set as paracol sets two columns, each page's first column and then its second: a part at
    // the first column's foot that runs on to the next page has the second column between its
    // markers, and one at the second column's foot the next page's first column.
    const doc = documentOf(
      [
        ...line("Left", 0, 10),
        special("rt:l:lock-first"),
        ...line("Kept", 0, 700),
        ...line("Right", 300, 10),
        ...line("Column", 300, 22),
        special("rt:l:lock-second", 300),
        ...line("Also", 300, 700),
      ],
      [
        ...line("more", 0, 10),
        special("rt:l:/lock-first"),
        ...line("Swallowed", 0, 30),
        ...line("Too", 0, 42),
        ...line("kept", 300, 10),
        special("rt:l:/lock-second", 300),
      ],
    );
    const sets = lockedSets(doc);
    expect(spelt(doc, sets.get("lock-first")).pages).toEqual({ 0: "Kept", 1: "more" });
    expect(spelt(doc, sets.get("lock-second")).pages).toEqual({ 0: "Also", 1: "kept" });
  });

  // The oracle's review: AltaCV's parts took the second column's sections beside them.
  it("keeps none of another column its markers hold, where it sets nothing of its own beside it", () => {
    // A page break in the first column, in the part: its start at the column's foot, the second
    // column of the first page between its markers, and its own words at the next page's top.
    const doc = documentOf(
      [
        ...line("Left", 0, 10),
        ...line("Left foot", 0, 690),
        special("rt:l:lock-turn", 0, 692),
        ...line("Right", 300, 10),
        special("rt:b:ent-r.text", 300, 20),
        ...line("Field", 300, 22),
        special("rt:e:ent-r.text", 300, 24),
        ...line("Template", 300, 34),
      ],
      [...line("Own head", 0, 10), special("rt:l:/lock-turn", 40, 10), ...line("Next", 0, 30)],
    );
    expect(spelt(doc, lockedSets(doc).get("lock-turn")).pages).toEqual({ 1: "Ownhead" });
  });

  it("keeps none of the column beside a part that starts at its column's top", () => {
    // Its first line level with the second column's, which the output sets after its own lines;
    // and a part that starts with a row of two cells, whose cell beside the first goes back up as
    // level, and whose next row comes back to its column, which keeps it all.
    const doc = documentOf(
      [
        special("rt:l:lock-top", 0, 0),
        ...line("Own one", 0, 10),
        ...line("Own two", 0, 22),
        ...line("Own three", 0, 700),
        ...line("Right", 300, 10),
        ...line("Column", 300, 22),
      ],
      [
        ...line("Own four", 0, 10),
        special("rt:l:/lock-top", 0, 12),
        special("rt:l:lock-row", 0, 20),
        ...line("Cell", 0, 30),
        ...line("Beside", 150, 30),
        ...line("Next row", 0, 700),
      ],
      [...line("Last", 0, 10), special("rt:l:/lock-row", 0, 12)],
    );
    const sets = lockedSets(doc);
    expect(spelt(doc, sets.get("lock-top")).pages).toEqual({
      0: "OwnoneOwntwoOwnthree",
      1: "Ownfour",
    });
    expect(spelt(doc, sets.get("lock-row")).pages).toEqual({ 1: "CellBesideNextrow", 2: "Last" });
  });

  it("keeps none of the column beside the pages between a part's first and its last", () => {
    // A part in the first column over three pages: the second page's second column is another's.
    const doc = documentOf(
      [special("rt:l:lock-long", 0, 600), ...line("Own one", 0, 610), ...line("Right", 300, 10)],
      [...line("Own two", 0, 10), ...line("Own three", 0, 700), ...line("Beside", 300, 10)],
      [...line("Own four", 0, 10), special("rt:l:/lock-long", 0, 12)],
    );
    expect(spelt(doc, lockedSets(doc).get("lock-long")).pages).toEqual({
      0: "Ownone",
      1: "OwntwoOwnthree",
      2: "Ownfour",
    });
  });

  it("keeps none of the column before the end of a part set out of order that ends at a column's top", () => {
    // Its end between paragraphs, at the second column's top, after the first column's lines,
    // which are another's; its start at the first column's foot on the next page.
    const doc = documentOf(
      [
        ...line("Left", 0, 10),
        ...line("Left foot", 0, 700),
        special("rt:l:/lock-switch", 300, 0),
        ...line("Right", 300, 10),
      ],
      [...line("Left again", 0, 10), special("rt:l:lock-switch", 0, 12)],
    );
    expect(lockedSets(doc).get("lock-switch")?.items).toEqual([]);
  });

  it("gives what a part nested in another's span sets to the inner part", () => {
    // Two parts the output sets one inside the other's markers, as only a reordering can: each
    // glyph is the innermost's.
    const doc = documentOf([
      special("rt:l:lock-outer"),
      ...line("Outer", 0, 10),
      special("rt:l:lock-inner"),
      ...line("Inner", 0, 22),
      special("rt:l:/lock-inner"),
      ...line("Again", 0, 34),
      special("rt:l:/lock-outer"),
    ]);
    const sets = lockedSets(doc);
    expect(spelt(doc, sets.get("lock-outer")).pages).toEqual({ 0: "OuterAgain" });
    expect(spelt(doc, sets.get("lock-inner")).pages).toEqual({ 0: "Inner" });
  });

  it("finds no part on a page with no lock marker, and keeps parts in the order they come", () => {
    expect(lockedSets(documentOf([...line("Plain", 0, 10)])).size).toBe(0);
    const doc = documentOf([
      special("rt:l:lock-b"),
      ...line("B", 0, 10),
      special("rt:l:/lock-b"),
      special("rt:l:lock-a"),
      ...line("A", 0, 20),
      special("rt:l:/lock-a"),
    ]);
    expect([...lockedSets(doc).keys()]).toEqual(["lock-b", "lock-a"]);
  });
});

describe("blocksOf", () => {
  /** A glyph's box on the baseline `y`, from `left` to `right`, 7 points up and 2 down. */
  const at = (left: number, right: number, y: number): Placed => ({
    left,
    top: y - 7,
    right,
    bottom: y + 2,
    baseline: y,
    size: 10,
  });

  it("joins a part's lines into one block while it goes on down the page", () => {
    // A superscript, raised less than the size, stays in its line's block.
    const placed = [at(50, 120, 100), at(121, 125, 96), at(50, 200, 112), at(50, 90, 124)];
    expect(blocksOf(placed)).toEqual([{ left: 50, top: 89, right: 200, bottom: 126 }]);
  });

  it("starts another block where the part goes back up a line or more, as to a column's top", () => {
    const placed = [at(50, 200, 100), at(50, 180, 112), at(300, 400, 100), at(300, 380, 112)];
    expect(blocksOf(placed)).toEqual([
      { left: 50, top: 93, right: 200, bottom: 114 },
      { left: 300, top: 93, right: 400, bottom: 114 },
    ]);
  });

  it("starts another block where a field the part holds comes between, so that none lies over it", () => {
    // A field a class's header macro sets on its own line, between two lines the part keeps.
    const placed = [at(50, 200, 100), { ...at(50, 200, 124), resumes: true }];
    expect(blocksOf(placed)).toEqual([
      { left: 50, top: 93, right: 200, bottom: 102 },
      { left: 50, top: 117, right: 200, bottom: 126 },
    ]);
  });

  it("gives a part with nothing on the page no block", () => {
    expect(blocksOf([])).toEqual([]);
  });
});

// On the engine: the reviewers' invented documents, compiled with the editor's prelude, in one
// column and no page's head or foot, or in paracol's two, the part's own text set in typewriter
// so that its glyphs are known whatever the page breaks.

/** A format of article in 10 pt with an inch's margins, the packages given, and the prelude. */
const preamble = (...packages: string[]) =>
  [
    "\\documentclass[10pt,dvipdfmx]{article}",
    "\\usepackage[margin=1in]{geometry}",
    ...packages.map((name) => `\\usepackage{${name}}`),
    "\\pagestyle{empty}",
    "\\setlength{\\parindent}{0pt}",
    PRELUDE,
  ].join("\n");

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `Filler line ${i} of an invented section.\\par`).join("\n");
const row = (i: number) =>
  `\\begin{tabular}{p{2.5in}p{2.5in}}Invented skill ${i} with words that wrap onto a second line here & Other cell ${i} beside it, also wrapping onto its second line\\end{tabular}\\par`;
const TABLE = Array.from({ length: 8 }, (_, i) => row(i)).join("\n");
const LIST = `\\begin{multicols}{2}\\begin{itemize}${Array.from({ length: 12 }, (_, i) => `\\item Invented hobby number ${i}`).join("\n")}\\end{itemize}\\end{multicols}`;
const inPart = (fill: number, content: string) =>
  [
    "\\begin{document}",
    filler(fill),
    `\\rtlocked{lock-skills}{\\section*{Skills}\n${content}\n}`,
    "After the part.",
    "\\end{document}",
  ].join("\n");

/** Invented words, `n` of them, after `word`, some with an x. */
const words = (n: number, word: string) =>
  Array.from({ length: n }, (_, i) => `${word}${i % 7 === 0 ? "" : "x"}`).join(" ");

describe.skipIf(!engineAvailable())("locked parts on the engine's pages", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  beforeAll(async () => {
    session = await startNodeSession();
    for (const [name, packages] of [
      ["locked-tables", ["multicol"]],
      ["locked-columns", ["paracol"]],
      ["locked-marks", ["xcolor"]],
    ] as const) {
      const dumped = session.dump("pdftex", name, preamble(...packages), {});
      if (!dumped.ok) throw new Error(dumped.error);
    }
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 60_000);

  /** A body's output, and the output read as the page reads it, with its fonts' widths. */
  async function compiled(format: string, body: string, job: string) {
    const result = session.compile("pdftex", format, body, { job });
    if (!result.output) throw new Error(result.error);
    expect(result.log).not.toMatch(/^! /m);
    const loaded = new Map<string, PageFont>();
    for (const { name } of parseDvi(result.output, () => undefined).fonts.values()) {
      const font = await fonts.load(name);
      if (font !== undefined) loaded.set(name, font);
    }
    return { output: result.output, doc: parseDvi(result.output, widthsOf(loaded)) };
  }

  /** How many of each page's glyphs a test of a glyph, by its font's name, takes. */
  const glyphsByPage = (doc: DviDocument, test: (font: string) => boolean) =>
    doc.pages.map(
      (page) =>
        page.items.filter(
          (item) => item.kind === "glyph" && test(doc.fonts.get(item.font)?.name ?? ""),
        ).length,
    );

  /** How many glyphs of each page a part keeps. */
  const keptByPage = (doc: DviDocument, id: string) =>
    doc.pages.map(
      (_, number) =>
        (lockedSets(doc).get(id)?.items ?? []).filter(
          (each) => each.kind === "glyph" && each.page === number,
        ).length,
    );

  /** How many glyphs of each page lie between a part's markers, in the output's order. */
  const betweenByPage = (doc: DviDocument) => {
    let open = false;
    return doc.pages.map((page) => {
      let count = 0;
      for (const item of page.items) {
        const marker = item.kind === "special" ? lockMarker(item.text) : undefined;
        if (marker !== undefined) open = !marker.end;
        else if (open && item.kind === "glyph") count++;
      }
      return count;
    });
  };

  // The reviewers' three cases (decision 0041): a part with what sets side by side, a page's break
  // before its heading, its start left at the foot of the page before, or within it.
  for (const [name, body, pages] of [
    ["a table of rows of two cells, its heading on the next page", inPart(52, TABLE), [0, 1]],
    ["a table of rows of two cells, broken between its rows", inPart(36, TABLE), [1, 1]],
    ["a list in two columns, its heading on the next page", inPart(53, LIST), [0, 1]],
  ] as const)
    it(`keeps every glyph of ${name}, and the page draws each as the part's`, async () => {
      const { output, doc } = await compiled("locked-tables", body, "tables");
      const between = betweenByPage(doc);
      // The break falls where the case says: which pages hold the part.
      expect(between.map((count) => (count > 0 ? 1 : 0))).toEqual(pages);
      expect(keptByPage(doc, "lock-skills")).toEqual(between);
      // Every kept glyph the page draws, which a font it cannot draw leaves out, is the part's.
      const pt = pointsPerUnit(doc);
      for (const number of between.keys()) {
        const page = await drawPage(output, fonts, new Map(), number);
        const kept = (lockedSets(doc).get("lock-skills")?.items ?? []).flatMap((each) => {
          const item = doc.pages[number]?.items[each.item];
          return each.page === number && item?.kind === "glyph" ? [item] : [];
        });
        const drawn = kept.flatMap((item) =>
          page.glyphs.filter(
            (glyph) =>
              Math.abs(glyph.x - (INCH + item.h * pt)) < 0.01 &&
              Math.abs(glyph.y - (INCH + item.v * pt)) < 0.01,
          ),
        );
        if (kept.length > 0) expect(drawn.length).toBeGreaterThan(kept.length / 2);
        expect(drawn.filter((glyph) => glyph.locked !== "lock-skills")).toEqual([]);
        expect(page.glyphs.filter((glyph) => glyph.locked === "lock-skills")).toHaveLength(
          drawn.length,
        );
      }
    }, 60_000);

  it("keeps, of a part two columns break across pages, its own glyphs and no other column's", async () => {
    // paracol sets the first column of each page, then the second: between the part's markers lie
    // the second column of the first page, its sections, a field among them, and its own text.
    const body = [
      "\\begin{document}",
      "\\begin{paracol}{2}",
      "\\section*{Left One}",
      words(380, "quill"),
      `\\rtlocked{lock-break}{\\section*{\\texttt{Broken}}\\texttt{${words(220, "lark")}}\n}`,
      "\\switchcolumn",
      "\\section*{Right Side}",
      "\\rtfield{ent-r.text}{Right column text plover.}",
      "Template words gannet.",
      "\\end{paracol}",
      "\\end{document}",
    ].join("\n");
    const { doc } = await compiled("locked-columns", body, "break");
    const own = glyphsByPage(doc, (font) => font.startsWith("cmtt"));
    expect(own.filter((count) => count > 0)).toHaveLength(2);
    expect(keptByPage(doc, "lock-break")).toEqual(own);
  }, 60_000);

  it("keeps, of a part the output sets out of order, its run into its end and from its start", async () => {
    // The part runs from the foot of the first column, on the second page, into the top of the
    // second column, on the first: its end comes before its start.
    const body = [
      "\\begin{document}",
      "\\begin{paracol}{2}",
      "\\section*{Left One}",
      words(1100, "quill"),
      "\\rtlocked{lock-span}{\\section*{\\texttt{Spanning}}\\texttt{Left piece wren.}\\switchcolumn \\texttt{Right piece heron.}\n}",
      "\\section*{Right Two}",
      "\\rtfield{ent-b.text}{Right column text plover.}",
      "\\end{paracol}",
      "\\end{document}",
    ].join("\n");
    const { doc } = await compiled("locked-columns", body, "span");
    const markers = doc.pages.flatMap((page, number) =>
      page.items.flatMap((item) => {
        const marker = item.kind === "special" ? lockMarker(item.text) : undefined;
        return marker === undefined ? [] : [`${marker.end ? "end" : "start"} ${number}`];
      }),
    );
    // Its end, on the first page, before its start, on a later one.
    expect(markers).toHaveLength(2);
    expect(markers[0]).toBe("end 0");
    expect(markers[1]).toMatch(/^start [1-9]/);
    expect(keptByPage(doc, "lock-span")).toEqual(
      glyphsByPage(doc, (font) => font.startsWith("cmtt")),
    );
  }, 60_000);

  // The oracle's review (decision 0041): AltaCV's parts took the column beside them, its fields'
  // sections and entries, in two ways, each invented here with a field and words in sans serif in
  // the column beside the part, and the part's own words in typewriter.
  it("keeps nothing of the column beside a part whose markers hold it, as a page break does", async () => {
    // A `\newpage` in the first column, in the part, as AltaCV's: its start at the first column's
    // foot, its own words at the next page's top, and between, in the output, the second column
    // of the first page.
    const body = [
      "\\begin{document}",
      "\\begin{paracol}{2}",
      "\\section*{Left One}",
      `\\rtfield{ent-a.text}{${words(120, "quill")}}`,
      "\\rtlocked{lock-turn}{\\newpage\\texttt{Kept words at the next page's top.}\n}",
      "\\section*{Left Two}",
      words(40, "wren"),
      "\\switchcolumn",
      "\\section*{Right Side}",
      "\\rtfield{ent-r.text}{Right column field words plover.}",
      `\\textsf{${words(150, "gannet")}}`,
      "\\end{paracol}",
      "\\end{document}",
    ].join("\n");
    const { doc } = await compiled("locked-columns", body, "turn");
    const own = glyphsByPage(doc, (font) => font.startsWith("cmtt"));
    expect(own.map((count) => (count > 0 ? 1 : 0))).toEqual([0, 1]);
    expect(glyphsByPage(doc, (font) => font.startsWith("cmss"))[0]).toBeGreaterThan(0);
    expect(keptByPage(doc, "lock-turn")).toEqual(own);
  }, 60_000);

  it("keeps nothing of the column beside a part set out of order from a column's top", async () => {
    // A part at the top of the first column on the second page, after a `\newpage`, that switches
    // columns, as AltaCV's publications: its end at the top of the second column, on the first
    // page, before its start, and the second column runs on beside it on the second.
    const body = [
      "\\begin{document}",
      "\\begin{paracol}{2}",
      "\\section*{Left One}",
      words(60, "quill"),
      "\\newpage",
      `\\rtlocked{lock-top}{\\texttt{${words(40, "lark")}}\\switchcolumn\n}`,
      "\\section*{Right Side}",
      "\\rtfield{ent-r.text}{Right column field words plover.}",
      `\\textsf{${words(500, "gannet")}}`,
      "\\end{paracol}",
      "\\end{document}",
    ].join("\n");
    const { doc } = await compiled("locked-columns", body, "top");
    const markers = doc.pages.flatMap((page, number) =>
      page.items.flatMap((item) => {
        const marker = item.kind === "special" ? lockMarker(item.text) : undefined;
        return marker === undefined ? [] : [`${marker.end ? "end" : "start"} ${number}`];
      }),
    );
    expect(markers).toEqual(["end 0", "start 1"]);
    const own = glyphsByPage(doc, (font) => font.startsWith("cmtt"));
    expect(own.map((count) => (count > 0 ? 1 : 0))).toEqual([0, 1]);
    expect(glyphsByPage(doc, (font) => font.startsWith("cmss"))[1]).toBeGreaterThan(0);
    expect(keptByPage(doc, "lock-top")).toEqual(own);
  }, 60_000);

  it("parts its blocks around a field a macro of the part sets, and marks its rules and boxes", async () => {
    // As a class's header macro, called by a locked part, sets a stored field between two of the
    // part's own lines; and a rule and a box of colour the part draws.
    const body = [
      "\\begin{document}",
      "\\newcommand{\\inventedheader}{\\begin{center}Kept line above the name\\\\ \\rtfield{header.first}{Quill Invented}\\\\ Kept line below the name\\end{center}}",
      "\\rtlocked{lock-head}{\\inventedheader}",
      "\\rtlocked{lock-rule}{\\noindent\\rule{\\linewidth}{2pt}\\par\\noindent\\colorbox{gray}{\\parbox{0.8\\linewidth}{Kept words on a box of colour}}\\par}",
      "\\end{document}",
    ].join("\n");
    const { output } = await compiled("locked-marks", body, "marks");
    const page = await drawPage(output, fonts, new Map([["header.first", "Quill Invented"]]));
    const field = page.glyphs.filter((glyph) => glyph.field === "header.first");
    expect(field.length).toBeGreaterThan(0);
    const blocks = page.locked.get("lock-head")?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    // No block lies over the field, nor over the space between its words.
    const over = (x: number, y: number) =>
      blocks.some(
        (block) => x >= block.left && x <= block.right && y >= block.top && y <= block.bottom,
      );
    expect(
      field.filter((glyph) => over((glyph.left + glyph.right) / 2, (glyph.top + glyph.bottom) / 2)),
    ).toEqual([]);
    const [first, last] = [field[0], field.at(-1)];
    if (first === undefined || last === undefined) throw new Error("no field");
    expect(over((first.right + last.left) / 2, first.y - 2)).toBe(false);
    // The rule and the box of colour carry the part, as its glyphs do.
    const painted = (page.svg.match(/<rect [^>]*>/g) ?? []).filter(
      (rect) => !rect.includes('fill-opacity="0"') && !rect.includes('fill="white"'),
    );
    expect(painted.length).toBeGreaterThanOrEqual(2);
    for (const rect of painted) expect(rect).toContain('data-locked="lock-rule"');
  }, 60_000);
});
