import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type DviPage, type PageItem, parseDvi } from "./dvi";
import { alignField, alignGlyphs, collectFields, type GlyphTextOf } from "./fields";
import { accentMark, glyphText } from "./glyphs";
import { parseTfm, scaleTfm } from "./tfm";
import { parseType1 } from "./type1";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

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

  it("keeps the first copy of a field, and opens a later one only to close it", () => {
    // A link a header sets twice, the second time inside another field.
    const p = page([
      special("rt:b:code.label"),
      ...word("code"),
      special("rt:e:code.label"),
      ...word("|"),
      special("rt:b:outer"),
      ...word("a"),
      special("rt:b:code.label"),
      ...word("code"),
      special("rt:e:code.label"),
      ...word("b"),
      special("rt:e:outer"),
    ]);
    const fields = collectFields(p, textOf);
    expect([...fields.keys()]).toEqual(["code.label", "outer"]);
    expect(fields.get("code.label")?.glyphs.map((g) => g.item)).toEqual([1, 2, 3, 4]);
    // The later copy's glyphs go to no field, and its end marker leaves the outer one open.
    expect(
      fields
        .get("outer")
        ?.glyphs.map((g) => g.text)
        .join(""),
    ).toBe("ab");
  });

  it("finds a field at the copy the page shows when its first render left no begin marker", () => {
    const p = page([
      // The name in the PDF's author, a string with no markers; and the end of a copy that
      // began on the page before, whose begin marker is not on this page.
      special("pdf:docinfo<</Author(Ilse Marrow)>>"),
      ...word("se"),
      special("rt:e:header.first"),
      special("rt:b:header.first"),
      ...word("Ilse"),
      special("rt:e:header.first"),
    ]);
    const field = collectFields(p, textOf).get("header.first");
    expect(field?.glyphs.map((g) => g.text).join("")).toBe("Ilse");
    expect(field?.glyphs.map((g) => g.item)).toEqual([5, 6, 7, 8]);
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

describe("collectFields with accents", () => {
  // accents.dvi sets, in cmr10, OT1's `caf\'e \'Etude na\"\i ve` in one field, and
  // `\textasciitilde mara\^{}x` in another: the same accent glyphs, standing alone.
  const encoding = parseType1(fixture("cmr10.pfb")).encoding;
  const nameOf = (item: PageItem) =>
    item.kind === "glyph" ? (encoding[item.code] ?? ".notdef") : ".notdef";
  const textOf: GlyphTextOf = Object.assign((item: PageItem) => glyphText(nameOf(item)), {
    accent: (item: PageItem) => accentMark(nameOf(item)),
  });
  const bytes = fixture("accents.dvi");
  const cmr10 = parseTfm(fixture("cmr10.tfm"));

  it("finds TeX's \\accent setting the accent, then the letter moved back under it", () => {
    const [page] = parseDvi(bytes, () => undefined).pages;
    const glyphs = page?.items.filter((item) => item.kind === "glyph") ?? [];
    const acute = glyphs.findIndex((item) => item.kind === "glyph" && item.code === 19);
    const [accent, letter] = [glyphs[acute], glyphs[acute + 1]];
    expect(accent?.kind === "glyph" && accent.code).toBe(19);
    expect(letter?.kind === "glyph" && letter.code).toBe(101);
    expect(letter && accent && letter.h < accent.h).toBe(true);
  });

  // With the widths, as the page and the harness parse the DVI.
  it("reads each accent and the letter under it as one accented letter", () => {
    const page = parseDvi(bytes, () => scaleTfm(cmr10, 655360).widths).pages[0] as DviPage;
    const fields = collectFields(page, textOf);
    const word = fields.get("word");
    expect(word?.glyphs.map((g) => g.text).join("")).toBe("caféÉtudenaïve");
    expect(alignGlyphs(word as NonNullable<typeof word>, "café Étude naïve")).toBe(0);
    // The accented letter is the letter's item, and the accent's is listed with it.
    const accented = word?.glyphs.filter((g) => g.items) ?? [];
    expect(accented.map((g) => g.text)).toEqual(["é", "É", "ï"]);
    for (const g of accented) {
      const [accent] = g.items ?? [];
      expect(page.items[g.item]?.kind).toBe("glyph");
      expect(page.items[accent as number]?.kind === "glyph").toBe(true);
      expect(accent).toBeLessThan(g.item);
    }
    // A tilde or circumflex standing alone is not over the letter after it.
    const lone = fields.get("lone");
    expect(lone?.glyphs.map((g) => g.text)).toEqual(["~", "m", "a", "r", "a", "^", "x"]);
    expect(lone?.glyphs.some((g) => g.items)).toBe(false);
  });

  it("pairs a letter that starts within twice the accent's width before it or its advance", () => {
    // cmr10's tilde, 50 wide at 100 unless given, and an n after it, as \accent leaves them.
    const tilde = (h: number, width = 50, v = 0): PageItem => ({
      kind: "glyph",
      font: 0,
      code: 126,
      h,
      v,
      width,
    });
    const n = (h: number, v = 0): PageItem => ({
      kind: "glyph",
      font: 0,
      code: 110,
      h,
      v,
      width: 55,
    });
    const read = (accent: PageItem, letter: PageItem) =>
      collectFields(page([special("rt:b:f"), accent, letter, special("rt:e:f")]), textOf)
        .get("f")
        ?.glyphs.map((g) => g.text);
    // A letter narrower than the accent starts after it, as an I under T1's macron does, which
    // the harness took for two glyphs when it parsed the DVI without widths.
    expect(read(tilde(100), n(107))).toEqual(["ñ"]);
    // A letter wider than the accent starts before it, by up to 1.83 of its widths, as a W under
    // a dot does; and the accent may sit higher, over a tall letter, or lower.
    expect(read(tilde(100, 20), n(64))).toEqual(["ñ"]);
    expect(read(tilde(100, 50, -30), n(100))).toEqual(["ñ"]);
    expect(read(tilde(100, 50, 12), n(100))).toEqual(["ñ"]);
    // A letter that starts where the accent's advance ends is after it, not under it.
    expect(read(tilde(100), n(150))).toEqual(["~", "n"]);
    // Nor is the first letter of the next line, back at the left margin, under an accent that
    // ended the line before, as in the reviewers' \parbox with OT1's ~ at a line's end.
    expect(read(tilde(300), n(0, 12))).toEqual(["~", "n"]);
    expect(read(tilde(120), n(0, 12))).toEqual(["~", "n"]);
  });

  it("pairs only an accent and a letter in the same field, and only a letter", () => {
    const at = (code: number, h: number): PageItem => ({
      kind: "glyph",
      font: 0,
      code,
      h,
      v: 0,
      width: 5,
    });
    const names: Record<number, string> = { 1: "acute", 2: "e", 3: "one" };
    const agl = new Map([["acute", "´"]]);
    const named: GlyphTextOf = Object.assign(
      (item: PageItem) =>
        item.kind === "glyph" ? glyphText(names[item.code] ?? "", agl) : undefined,
      {
        accent: (item: PageItem) =>
          item.kind === "glyph" ? accentMark(names[item.code] ?? "") : undefined,
      },
    );
    const p = page([
      special("rt:b:a"),
      at(1, 10),
      special("rt:b:b"),
      at(2, 9), // in another field
      special("rt:e:b"),
      at(1, 20),
      at(3, 19), // not a letter
      special("rt:e:a"),
    ]);
    const fields = collectFields(p, named);
    expect(fields.get("a")?.glyphs.map((g) => g.text)).toEqual(["´", "´", "1"]);
    expect(fields.get("b")?.glyphs.map((g) => g.text)).toEqual(["e"]);
    // Without the accent function, nothing is paired.
    const plain = collectFields(page([special("rt:b:a"), at(1, 10), at(2, 9)]), (item) =>
      named(item),
    );
    expect(plain.get("a")?.glyphs.map((g) => g.text)).toEqual(["´", "e"]);
  });
});

const fieldOf = (glyphTexts: (string | undefined)[]) => ({
  id: "f",
  glyphs: glyphTexts.map((text, i) => ({ item: i, text, offset: -1 })),
});

describe("alignField", () => {
  it("says where in the text the glyphs end: past the last one matched", () => {
    expect(alignField(fieldOf([..."Adaat"]), "Ada at")).toEqual({ unmatched: 0, covered: 6 });
    // What sets no glyph after the last one is left past it, for the harness to look at.
    const trailing = alignField(fieldOf([..."report"]), "report \u{1f4c8}  ");
    expect(trailing).toEqual({ unmatched: 0, covered: 6 });
    // A field cut short: every glyph matches, and the text goes on past them.
    const cut = alignField(fieldOf([..."Setthe"]), "Set the report");
    expect(cut).toEqual({ unmatched: 0, covered: 7 });
    expect(alignField(fieldOf([]), "Set")).toEqual({ unmatched: 0, covered: 0 });
  });

  it("counts what alignGlyphs counts", () => {
    const f = fieldOf(["a", undefined, "b"]);
    expect(alignField(f, "ab")).toEqual({ unmatched: 1, covered: 2 });
    expect(alignGlyphs(fieldOf(["a", undefined, "b"]), "ab")).toBe(1);
  });
});

describe("alignGlyphs", () => {
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

  it("matches T1's one glyph for Ð and Đ to either", () => {
    const f = fieldOf(["\u{d0}", "a", "\u{d0}"]);
    expect(alignGlyphs(f, "\u{110}a\u{d0}")).toBe(0);
    expect(f.glyphs.map((g) => g.offset)).toEqual([0, 1, 2]);
  });

  it("matches a glyph whose text is a word an object has as a member", () => {
    // A virtual font's glyph composed of c, o, n and the rest reads as "constructor", whose
    // spellings the aligner looked up on a plain object, finding a function there.
    const f = fieldOf(["constructor", "toString", "__proto__", "valueOf"]);
    expect(alignGlyphs(f, "constructor toString __proto__ valueOf")).toBe(0);
    expect(f.glyphs.map((g) => g.offset)).toEqual([0, 12, 21, 31]);
  });

  it("matches a composed letter where the text holds it decomposed", () => {
    const f = fieldOf(["J", "o", "s", "\u{e9}", "!"]);
    expect(alignGlyphs(f, "Jose\u{301}!")).toBe(0);
    expect(f.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 3, 5]);
  });

  it("reads a run of characters that set no glyph once, however many glyphs miss in it", () => {
    // OT1 sets é as an accent, which has no text, and an e, which no é matches; and … as three
    // periods, which no … matches either. Each glyph used to walk the rest of the run.
    const accented = fieldOf(Array.from({ length: 16_000 }, (_, i) => (i % 2 ? "e" : undefined)));
    const dotted = fieldOf(Array.from({ length: 18_000 }, () => "."));
    const started = performance.now();
    expect(alignGlyphs(accented, "\u{e9}".repeat(8_000))).toBe(16_000);
    expect(alignGlyphs(dotted, "\u{2026}".repeat(6_000))).toBe(18_000);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
