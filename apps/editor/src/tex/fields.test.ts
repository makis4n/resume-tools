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

  it("reads markers whatever their case, as \\MakeUppercase leaves them, and lowercases the id", () => {
    const p = page([
      special("RT:B:WORK.TITLE"),
      ...word("EXP"),
      special("RT:E:WORK.TITLE"),
      special("rt:b:B_0.TEXT"),
      ...word("x"),
      special("rt:e:b_0.text"),
      special("RTX:b:not.a.field"),
    ]);
    const fields = collectFields(p, textOf);
    expect([...fields.keys()]).toEqual(["work.title", "b_0.text"]);
    expect(
      fields
        .get("work.title")
        ?.glyphs.map((g) => g.text)
        .join(""),
    ).toBe("EXP");
    expect(fields.get("b_0.text")?.glyphs).toHaveLength(1);
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

  it("finds a glyph past characters that set no glyph, taking a surrogate pair as one", () => {
    // pdfTeX drops an emoji, which is two code units, so "launch" starts at 9.
    const text = "Led \u{1f680}\u{1f680} launch";
    const f = fieldOf([..."Ledlaunch"]);
    expect(alignGlyphs(f, text)).toBe(0);
    expect(f.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 9, 10, 11, 12, 13, 14]);
  });

  it("skips the invisible characters the generator drops, however many", () => {
    const f = fieldOf([..."zerowidth"]);
    expect(alignGlyphs(f, "zero\u{200b}\u{200b}\u{200b}\u{200b}width")).toBe(0);
    expect(f.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 3, 8, 9, 10, 11, 12]);
  });

  it("finds a word after one in a script the fonts lack", () => {
    const f = fieldOf([..."Petrov"]);
    expect(alignGlyphs(f, "\u{418}\u{432}\u{430}\u{43d} Petrov")).toBe(0);
    expect(f.glyphs.map((g) => g.offset)).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("matches a dash or a curly quote where it stands, and within a run it would skip", () => {
    const quoted = fieldOf(["x", "'", "s"]);
    expect(alignGlyphs(quoted, "x\u{2019}s")).toBe(0);
    expect(quoted.glyphs.map((g) => g.offset)).toEqual([0, 1, 2]);
    // The en dash sits among Cyrillic letters and spaces, which set no glyph.
    const dashed = fieldOf(["--", ..."English"]);
    expect(alignGlyphs(dashed, "\u{420}\u{443}\u{441} \u{2013} English")).toBe(0);
    expect(dashed.glyphs.map((g) => g.offset)).toEqual([4, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("resynchronises over three code units of ASCII at most", () => {
    const near = fieldOf(["a", "e"]);
    expect(alignGlyphs(near, "abcde")).toBe(0);
    expect(near.glyphs.map((g) => g.offset)).toEqual([0, 4]);
    const far = fieldOf(["a", "f"]);
    expect(alignGlyphs(far, "abcdef")).toBe(1);
    expect(far.glyphs.map((g) => g.offset)).toEqual([0, 1]);
  });
});
