import { describe, expect, it } from "vitest";
import type { DviDocument, PageItem } from "../tex/dvi";
import { blocksOf, type LockedSet, lockedSets, lockMarker, type Placed } from "./locked";

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

const special = (text: string): PageItem => ({ kind: "special", h: 0, v: 0, text });

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

  it("keeps nothing of a part the output sets out of order: its end first, or no end", () => {
    // As paracol sets two columns, page by page: a part that runs from the first column into the
    // second ends at the second's top, on the first page, before it starts at the first's foot, on
    // the next; what lies between is the second column's and the first's, another part among it.
    const doc = documentOf(
      [
        ...line("Left", 0, 10),
        special("rt:l:/lock-switch"),
        ...line("Right column", 300, 10),
        special("rt:l:lock-tags"),
        ...line("Tags", 300, 30),
        special("rt:l:/lock-tags"),
      ],
      [...line("More left", 0, 10), special("rt:l:lock-switch"), ...line("Tail", 0, 30)],
      [special("rt:l:lock-open"), ...line("Never ended", 0, 10)],
    );
    const sets = lockedSets(doc);
    // Each part where its first marker came, the parts set out of order with nothing of their own.
    expect([...sets.keys()]).toEqual(["lock-switch", "lock-tags", "lock-open"]);
    expect(sets.get("lock-switch")?.items).toEqual([]);
    expect(sets.get("lock-open")?.items).toEqual([]);
    expect(spelt(doc, sets.get("lock-tags")).pages).toEqual({ 0: "Tags" });
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
        special("rt:l:lock-second"),
        ...line("Also", 300, 700),
      ],
      [
        ...line("more", 0, 10),
        special("rt:l:/lock-first"),
        ...line("Swallowed", 0, 30),
        ...line("Too", 0, 42),
        ...line("kept", 300, 10),
        special("rt:l:/lock-second"),
      ],
    );
    const sets = lockedSets(doc);
    expect(spelt(doc, sets.get("lock-first")).pages).toEqual({ 0: "Kept", 1: "more" });
    expect(spelt(doc, sets.get("lock-second")).pages).toEqual({ 0: "Also", 1: "kept" });
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

  it("gives a part with nothing on the page no block", () => {
    expect(blocksOf([])).toEqual([]);
  });
});
