import { describe, expect, it } from "vitest";
import type { DviPage, PageItem } from "../tex/dvi";
import { isKeptId, keptId, keptSets } from "./kept";

// An outline's kept text read from its fields' markers (the second pass's item 7): every page here
// is invented, glyphs named by their codes.

const glyph = (code: number, v = 0): PageItem => ({
  kind: "glyph",
  font: 0,
  code,
  h: 0,
  v,
  width: 1,
});
const special = (text: string): PageItem => ({ kind: "special", h: 0, v: 0, text });
const page = (items: PageItem[]): DviPage => ({ counters: [], items });
const field = (id: string, text: string): PageItem[] => [
  special(`rt:b:${id}`),
  ...[...text].map((c) => glyph(c.charCodeAt(0))),
  special(`rt:e:${id}`),
];

/** The glyphs' indexes a set holds on each page, as `page:item`. */
const where = (set: { items: { page: number; item: number }[] } | undefined) =>
  set?.items.map((each) => `${each.page}:${each.item}`);

describe("keptSets", () => {
  it("gives what the output sets between two fields one after the other to their segment", () => {
    const sets = keptSets(
      {
        pages: [
          page([
            glyph(65),
            ...field("a.text", "x"),
            glyph(66),
            special("color push"),
            glyph(67),
            ...field("b.text", "y"),
            glyph(68),
          ]),
        ],
      },
      ["a.text", "b.text"],
    );
    expect([...sets.keys()]).toEqual([
      keptId(undefined, "a.text"),
      keptId("a.text", "b.text"),
      keptId("b.text", undefined),
    ]);
    expect(where(sets.get(keptId(undefined, "a.text")))).toEqual(["0:0"]);
    expect(where(sets.get(keptId("a.text", "b.text")))).toEqual(["0:4", "0:6"]);
    expect(sets.get(keptId("a.text", "b.text"))?.specials).toEqual([{ page: 0, item: 5 }]);
    expect(where(sets.get(keptId("b.text", undefined)))).toEqual(["0:10"]);
    expect([...sets.keys()].every(isKeptId)).toBe(true);
  });

  it("gives no segment what the output sets between fields out of the outline's order", () => {
    // A class that sets its header's fields in an order of its own, or paracol's columns.
    const sets = keptSets(
      { pages: [page([...field("b.text", "y"), glyph(66), ...field("a.text", "x"), glyph(67)])] },
      ["a.text", "b.text"],
    );
    expect(sets.has(keptId("b.text", "a.text"))).toBe(false);
    expect(sets.has(keptId("a.text", "b.text"))).toBe(false);
    expect([...sets.keys()]).toEqual([]);
  });

  it("reads the markers an outline's page accepts: a forged pair moves no segment's bounds", () => {
    const sets = keptSets(
      {
        pages: [
          page([
            ...field("a.text", "x"),
            glyph(66),
            ...field("a.text", "forged"),
            ...field("other.text", "z"),
            glyph(67),
            ...field("b.text", "y"),
          ]),
        ],
      },
      ["a.text", "b.text"],
    );
    // Everything between the field's own end and the next field's begin, forged words and all.
    expect(sets.get(keptId("a.text", "b.text"))?.items).toHaveLength(1 + 6 + 1 + 1);
  });

  it("runs a segment over a page's end, and starts a block at each new line", () => {
    const sets = keptSets(
      {
        pages: [
          page([...field("a.text", "x"), glyph(65, 0), glyph(66, 0), glyph(67, 12 * 65536)]),
          page([glyph(68, 0), ...field("b.text", "y")]),
        ],
      },
      ["a.text", "b.text"],
    );
    const set = sets.get(keptId("a.text", "b.text"));
    expect(where(set)).toEqual(["0:3", "0:4", "0:5", "1:0"]);
    expect(set?.items.map((each) => each.resumes === true)).toEqual([false, false, true, false]);
  });
});
