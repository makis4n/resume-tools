import { describe, expect, it } from "vitest";
import type { DviPage, PageItem } from "./dvi";
import { alignGlyphs, collectFields } from "./fields";

const glyph = (code: number): PageItem => ({ kind: "glyph", font: 0, code, h: 0, v: 0, width: 1 });
const special = (text: string): PageItem => ({ kind: "special", h: 0, v: 0, text });
const page = (items: PageItem[]): DviPage => ({ counters: [], items });

// Codes here are plain ASCII so the test can name text by character.
const textOf = (item: PageItem) =>
  item.kind === "glyph" ? String.fromCharCode(item.code) : undefined;
const word = (s: string) => [...s].map((c) => glyph(c.charCodeAt(0)));

describe("collectFields", () => {
  it("assigns glyphs between markers to their field, in stream order", () => {
    const p = page([
      special("rt:b:name"),
      ...word("Ada"),
      special("rt:e:name"),
      ...word("x"),
      special("rt:b:job"),
      ...word("Dev"),
      special("rt:e:job"),
    ]);
    const fields = collectFields(p, textOf);
    expect([...fields.keys()]).toEqual(["name", "job"]);
    expect(
      fields
        .get("name")
        ?.glyphs.map((g) => g.text)
        .join(""),
    ).toBe("Ada");
    expect(
      fields
        .get("job")
        ?.glyphs.map((g) => g.text)
        .join(""),
    ).toBe("Dev");
  });

  it("gives glyphs to the innermost open field", () => {
    const p = page([
      special("rt:b:outer"),
      ...word("a"),
      special("rt:b:inner"),
      ...word("b"),
      special("rt:e:inner"),
      ...word("c"),
      special("rt:e:outer"),
    ]);
    const fields = collectFields(p, textOf);
    expect(
      fields
        .get("outer")
        ?.glyphs.map((g) => g.text)
        .join(""),
    ).toBe("ac");
    expect(
      fields
        .get("inner")
        ?.glyphs.map((g) => g.text)
        .join(""),
    ).toBe("b");
  });

  it("ignores glyphs outside any field and specials that are not markers", () => {
    const p = page([
      ...word("zz"),
      special("color push Black"),
      special("rt:b:f"),
      ...word("q"),
      special("rt:e:f"),
    ]);
    const fields = collectFields(p, textOf);
    expect(fields.size).toBe(1);
    expect(fields.get("f")?.glyphs).toHaveLength(1);
  });
});

describe("alignGlyphs", () => {
  const fieldOf = (glyphTexts: (string | undefined)[]) => ({
    id: "f",
    glyphs: glyphTexts.map((text, i) => ({ item: i, text, offset: -1 })),
  });

  it("skips the spaces TeX turned into moves", () => {
    const f = fieldOf([..."Adaat"]);
    expect(alignGlyphs(f, "Ada at")).toBe(0);
    expect(f.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 4, 5]);
  });

  it("gives a ligature the offset of its first character and consumes all of them", () => {
    const f = fieldOf(["o", "ffi", "c", "e"]);
    expect(alignGlyphs(f, "office")).toBe(0);
    expect(f.glyphs.map((g) => g.offset)).toEqual([0, 1, 4, 5]);
  });

  it("accepts an en dash written as two hyphens or as one character", () => {
    const a = fieldOf(["1", "--", "2"]);
    expect(alignGlyphs(a, "1--2")).toBe(0);
    expect(a.glyphs.map((g) => g.offset)).toEqual([0, 1, 3]);
    const b = fieldOf(["1", "--", "2"]);
    expect(alignGlyphs(b, "1–2")).toBe(0);
    expect(b.glyphs.map((g) => g.offset)).toEqual([0, 1, 2]);
  });

  it("attaches a hyphen inserted at a line break to the character before it", () => {
    const f = fieldOf([..."type", "-", ..."set"]);
    expect(alignGlyphs(f, "typeset")).toBe(0);
    expect(f.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 3, 3, 4, 5, 6]);
  });

  it("counts glyphs it cannot place", () => {
    const f = fieldOf(["a", undefined, "b"]);
    expect(alignGlyphs(f, "ab")).toBe(1);
    expect(f.glyphs.map((g) => g.offset)).toEqual([0, 1, 1]);
  });
});
