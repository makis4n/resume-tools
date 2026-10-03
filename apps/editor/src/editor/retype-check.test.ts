import { describe, expect, test } from "vitest";
import { difference, type GlyphStream, type ReferenceItem } from "../import/reference";
import type { DviDocument, PageItem } from "../tex/dvi";
import { streamWithout } from "./retype-check";

// An invented page: a glyph before a locked part, the part's start marker, two glyphs of it with a
// link's special between them, its end marker, and a glyph after it.

const SP = 65536;

/** A page's DVI items, the part `lock-a` among them, and the glyph after it at `after`. */
function itemsOf(after: number, inside = 2): PageItem[] {
  const glyph = (code: number, h: number): PageItem => ({
    kind: "glyph",
    font: 1,
    code,
    h: h * SP,
    v: 100 * SP,
    width: 5 * SP,
  });
  return [
    glyph(65, 0),
    { kind: "special", h: 10 * SP, v: 100 * SP, text: "rt:l:lock-a" },
    ...Array.from({ length: inside }, (_, k) => glyph(66 + k, 10 + 5 * k)),
    { kind: "special", h: 12 * SP, v: 100 * SP, text: "pdf:bann <</Type/Annot>>" },
    { kind: "special", h: 20 * SP, v: 100 * SP, text: "rt:l:/lock-a" },
    glyph(90, after),
  ];
}

/** A DVI document of one page of `items`, in an invented font at 10 pt. */
const docOf = (items: PageItem[]): DviDocument => ({
  id: 2,
  numerator: 25_400_000,
  denominator: 473_628_672,
  magnification: 1000,
  comment: "",
  fonts: new Map([[1, { id: 1, name: "cmr10", checksum: 0, scale: 10 * SP, design: 10 * SP }]]),
  nativeFonts: new Map(),
  pages: [{ counters: [], items }],
});

/** The glyph stream `readOutput` reads of such a page. */
const streamOf = (items: PageItem[]): GlyphStream => ({
  pages: [
    {
      items: items.map(
        (item): ReferenceItem =>
          item.kind === "glyph"
            ? { kind: "glyph", font: "cmr10", size: 10 * SP, code: item.code, h: item.h, v: item.v }
            : item.kind === "special"
              ? { kind: "special", h: item.h, v: item.v, text: item.text }
              : { kind: "rule", h: 0, v: 0, width: 0, height: 0 },
      ),
    },
  ],
  size: { width: 612, height: 792 },
  fonts: { tex: ["cmr10"], native: [], shipped: [] },
  specials: [],
});

describe("streamWithout", () => {
  test("leaves out a part's glyphs and the specials between its markers, and keeps the rest", () => {
    const items = itemsOf(40);
    const kept = streamWithout(streamOf(items), docOf(items), "LOCK-A");
    expect(
      kept.pages[0]?.items.map((item) =>
        item.kind === "glyph" ? item.code : item.kind === "special" ? item.text : item.kind,
      ),
    ).toEqual([65, "rt:l:/lock-a", 90]);
  });

  test("finds no difference outside a part whose own glyphs changed, and one where the page moved", () => {
    const before = itemsOf(40);
    // Three glyphs in the part where there were two, and the link's special elsewhere in it.
    const grown = itemsOf(40, 3);
    expect(
      difference(
        streamWithout(streamOf(before), docOf(before), "lock-a"),
        streamWithout(streamOf(grown), docOf(grown), "lock-a"),
      ),
    ).toBeUndefined();
    // The glyph after the part set further on.
    const moved = itemsOf(45, 3);
    expect(
      difference(
        streamWithout(streamOf(before), docOf(before), "lock-a"),
        streamWithout(streamOf(moved), docOf(moved), "lock-a"),
      )?.kind,
    ).toBe("position");
    // Another part's glyphs are no part of this one's.
    expect(
      difference(
        streamWithout(streamOf(before), docOf(before), "lock-b"),
        streamWithout(streamOf(grown), docOf(grown), "lock-b"),
      ),
    ).toBeDefined();
  });

  test("keeps every special of a part the output sets out of order", () => {
    const items: PageItem[] = [
      { kind: "special", h: 0, v: 0, text: "rt:l:/lock-a" },
      { kind: "special", h: 0, v: 0, text: "color push gray 0" },
      { kind: "special", h: 0, v: 0, text: "rt:l:lock-a" },
      { kind: "special", h: 0, v: 0, text: "color pop" },
    ];
    const kept = streamWithout(streamOf(items), docOf(items), "lock-a");
    expect(kept.pages[0]?.items).toHaveLength(4);
  });
});
