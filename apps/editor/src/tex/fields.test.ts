import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bound, fastest } from "../test/timing";
import { type DviPage, type PageItem, parseDvi } from "./dvi";
import {
  acceptedMarkers,
  alignField,
  alignGlyphs,
  collectFields,
  type FieldGlyph,
  type GlyphTextOf,
} from "./fields";
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

describe("collectFields on an outline's page, through the markers it accepts", () => {
  // An outline's kept text can set the editor's markers by another spelling than the model refuses
  // (`^^72t:b:`, decision 0049): the page reads only the outline's own ids, each by its first begin
  // and the first end after it (the second pass's item 7). Every word is invented.
  const read = (pages: DviPage[], ids: string[]) => {
    const accepted = acceptedMarkers(pages, new Set(ids));
    return pages.map((each, index) => collectFields(each, textOf, accepted[index]));
  };
  const spelt = (fields: Map<string, { glyphs: FieldGlyph[] }>, id: string) =>
    fields
      .get(id)
      ?.glyphs.map((g) => g.text)
      .join("");

  it("reads no field the outline does not hold", () => {
    const [fields] = read(
      [
        page([
          special("rt:b:forged.text"),
          ...word("Wren"),
          special("rt:e:forged.text"),
          special("rt:b:f1.text"),
          ...word("Quill"),
          special("rt:e:f1.text"),
        ]),
      ],
      ["f1.text"],
    );
    expect([...(fields?.keys() ?? [])]).toEqual(["f1.text"]);
    expect(spelt(fields ?? new Map(), "f1.text")).toBe("Quill");
  });

  it("reads a field by its first begin and end, and a later pair for its id as none", () => {
    const [fields] = read(
      [
        page([
          special("rt:b:f1.text"),
          ...word("Quill"),
          special("rt:e:f1.text"),
          // Kept text after it forges the field's markers around words of its own.
          special("rt:b:f1.text"),
          ...word("Forged"),
          special("rt:e:f1.text"),
          special("rt:e:f1.text"),
          special("rt:b:f2.text"),
          ...word("Wren"),
          special("rt:e:f2.text"),
        ]),
      ],
      ["f1.text", "f2.text"],
    );
    expect([...(fields?.keys() ?? [])]).toEqual(["f1.text", "f2.text"]);
    expect(spelt(fields ?? new Map(), "f1.text")).toBe("Quill");
    expect(spelt(fields ?? new Map(), "f2.text")).toBe("Wren");
  });

  it("ends a field no sooner than its first end after its begin, on any page", () => {
    const pages = read(
      [
        // A forged end before the field begins is no end of it.
        page([special("rt:e:f1.text"), special("rt:b:f1.text"), ...word("Qu")]),
        page([...word("ill"), special("rt:e:f1.text"), special("rt:b:f1.text"), ...word("x")]),
      ],
      ["f1.text"],
    );
    expect(spelt(pages[0] ?? new Map(), "f1.text")).toBe("Qu");
    // The next page reads no second begin: its field is the page before's.
    expect([...(pages[1]?.keys() ?? [])]).toEqual([]);
    expect(acceptedMarkers([page([special("rt:e:f1.text")])], new Set(["f1.text"]))).toEqual([
      new Set(),
    ]);
  });
});

describe("collectFields with XeTeX's native runs", () => {
  /** A native run of a glyph per character, glyph ids being the characters' codes. */
  const run = (text: string, at = 0): PageItem => ({
    kind: "native",
    font: 1,
    h: at,
    v: 0,
    width: text.length,
    glyphs: [...text].map((char, i) => ({ id: char.charCodeAt(0), x: i, y: 0 })),
  });
  const nativeText: GlyphTextOf = (item, glyph) =>
    item.kind === "native" && glyph !== undefined
      ? String.fromCharCode(item.glyphs[glyph]?.id ?? 0)
      : textOf(item);

  it("collects each glyph of a run as a glyph of its own, with its index in the run", () => {
    const p = page([special("rt:b:f"), run("Ada"), glyph(32), run("Lov", 4), special("rt:e:f")]);
    const field = collectFields(p, nativeText).get("f");
    expect(field?.glyphs.map((g) => [g.item, g.glyph, g.text])).toEqual([
      [1, 0, "A"],
      [1, 1, "d"],
      [1, 2, "a"],
      [2, undefined, " "],
      [3, 0, "L"],
      [3, 1, "o"],
      [3, 2, "v"],
    ]);
    // A glyph the font has no text for is a glyph all the same.
    const blind = collectFields(
      page([special("rt:b:f"), run("xy"), special("rt:e:f")]),
      () => undefined,
    );
    expect(blind.get("f")?.glyphs.map((g) => g.text)).toEqual([undefined, undefined]);
  });

  it("pairs no native glyph with an accent before it: native fonts set letters whole", () => {
    const acute: PageItem = { kind: "glyph", font: 0, code: 19, h: 0, v: 0, width: 5 };
    const named: GlyphTextOf = Object.assign(
      (item: PageItem, glyph?: number) => (item.kind === "glyph" ? "´" : nativeText(item, glyph)),
      { accent: (item: PageItem) => (item.kind === "glyph" ? "́" : undefined) },
    );
    const field = collectFields(page([special("rt:b:f"), acute, run("e")]), named).get("f");
    expect(field?.glyphs.map((g) => g.text)).toEqual(["´", "e"]);
  });

  it("reads glyph 0, the font's .notdef, as a character left out, not as one unmatched", () => {
    // XeTeX sets a font's .notdef for a character the font lacks, where pdfTeX's LaTeX leaves the
    // character out; the generator leaves out what the package's fonts lack, so only a template's
    // own text, or a character one family has and another lacks, can still set one.
    const withNotdef: PageItem = {
      kind: "native",
      font: 1,
      h: 0,
      v: 0,
      width: 5,
      glyphs: [..."ab"].map((char, i) => ({ id: char.charCodeAt(0), x: i, y: 0 })),
    };
    const glyphs = withNotdef.kind === "native" ? withNotdef.glyphs : [];
    glyphs.splice(1, 0, { id: 0, x: 1, y: 0 });
    const field = collectFields(page([special("rt:b:f"), withNotdef]), (item, glyph) =>
      item.kind === "native" && glyph !== undefined && item.glyphs[glyph]?.id !== 0
        ? String.fromCharCode(item.glyphs[glyph]?.id ?? 0)
        : undefined,
    ).get("f");
    expect(field?.glyphs.map((g) => [g.text, g.dropped])).toEqual([
      ["a", undefined],
      [undefined, true],
      ["b", undefined],
    ]);
    if (!field) return;
    // It stands where the walk is, and the character it stands for is skipped as one that sets
    // no glyph.
    expect(alignField(field, "a\u{2192}b")).toEqual({ unmatched: 0, covered: 3 });
    expect(field.glyphs.map((g) => g.offset)).toEqual([0, 1, 2]);
  });

  it("keeps every character a glyph's font reaches it from, for the aligner", () => {
    // As Source Sans's map gives its apostrophe U+2019 and U+02BC.
    const aliased: GlyphTextOf = Object.assign(nativeText, {
      alternatives: (item: PageItem, glyph?: number) =>
        item.kind === "native" && glyph !== undefined && item.glyphs[glyph]?.id === 0x2019
          ? ["\u{2bc}"]
          : undefined,
    });
    const field = collectFields(page([special("rt:b:f"), run("a\u{2019}s")]), aliased).get("f");
    expect(field?.glyphs.map((g) => [g.text, g.alternatives])).toEqual([
      ["a", undefined],
      ["\u{2019}", ["\u{2bc}"]],
      ["s", undefined],
    ]);
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

  it("reads a dotless j under a caron as ǰ, and a dotless i or j alone as itself", () => {
    // cmr10's caron over its dotless j, as OT1 sets \v\j, then \i and \j alone.
    expect([20, 17, 16].map((code) => encoding[code])).toEqual(["caron", "dotlessj", "dotlessi"]);
    const at = (code: number, h: number): PageItem => ({
      kind: "glyph",
      font: 0,
      code,
      h,
      v: 0,
      width: 50,
    });
    const items = [at(20, 100), at(17, 110), at(16, 200), at(17, 300)];
    const field = collectFields(page([special("rt:b:f"), ...items, special("rt:e:f")]), textOf).get(
      "f",
    );
    expect(field?.glyphs.map((g) => g.text)).toEqual(["\u{1f0}", "\u{131}", "\u{237}"]);
    expect(alignGlyphs(field as NonNullable<typeof field>, "\u{1f0} \u{131}\u{237}")).toBe(0);
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
  glyphs: glyphTexts.map((text, i) => ({ item: i, text, offset: -1 })) as FieldGlyph[],
});

/** A field of one glyph per text, each glyph standing for the characters its entry lists. */
const aliasedFieldOf = (glyphTexts: string[][]) => ({
  id: "f",
  glyphs: glyphTexts.map(
    ([text, ...alternatives], i): FieldGlyph => ({
      item: i,
      text,
      ...(alternatives.length > 0 ? { alternatives } : {}),
      offset: -1,
    }),
  ),
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

  it("matches T1's low double quote to the two commas it sets it for, or to „ itself", () => {
    // T1's glyph for two commas, quotedblbase, as the page reads it through the Adobe Glyph List.
    const low = "\u{201e}";
    const commas = fieldOf(["a", low, "b", ","]);
    expect(alignGlyphs(commas, "a,,b,")).toBe(0);
    expect(commas.glyphs.map((g) => g.offset)).toEqual([0, 1, 3, 4]);
    const quote = fieldOf(["a", low, "b"]);
    expect(alignGlyphs(quote, "a\u{201e}b")).toBe(0);
    expect(quote.glyphs.map((g) => g.offset)).toEqual([0, 1, 2]);
  });

  it("matches what XeTeX's tex-text mapping sets to what the text spells", () => {
    // A native font's glyph reads as the character its map gives it, which the mapping made of
    // the text's --, ---, ', `, '', ``, " and ,, as TeX's ligatures do.
    const glyphs = ["\u{2019}", "\u{2013}", "\u{2014}", "\u{201c}", "\u{201d}", "\u{2018}"];
    const f = fieldOf([...glyphs, "\u{201d}", "\u{201e}"]);
    expect(alignGlyphs(f, "'-- ---``''`\",,")).toBe(0);
    expect(f.glyphs.map((g) => g.offset)).toEqual([0, 1, 4, 7, 9, 11, 12, 13]);
    // And each still matches itself, where a text holds it.
    const typed = fieldOf(["\u{2019}", "\u{2013}"]);
    expect(alignGlyphs(typed, "\u{2019}\u{2013}")).toBe(0);
    expect(typed.glyphs.map((g) => g.offset)).toEqual([0, 1]);
  });

  it("matches a letter set without the accent its font lacks to the accented letter", () => {
    // The generator sets ǎ as a where the fonts have neither it nor the caron, as pdfTeX's LaTeX
    // sets the base of a letter it has no definition for.
    const f = fieldOf([..."Xiaoming"]);
    expect(alignField(f, "Xi\u{1ce}oming")).toEqual({ unmatched: 0, covered: 8 });
    expect(f.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // And one typed decomposed, whose accent sets nothing.
    const decomposed = fieldOf([..."Xiaoming"]);
    expect(alignGlyphs(decomposed, "Xia\u{30c}oming")).toBe(0);
    // A letter is not a base of another letter, nor of a character with anything but accents.
    expect(alignGlyphs(fieldOf(["a"]), "\u{e6}")).toBe(1);
  });

  it("matches a glyph to any character its font reaches it from", () => {
    // Source Sans's apostrophe is U+2019 and U+02BC, and its micro sign U+00B5 and U+03BC.
    const quote = ["\u{2019}", "\u{2bc}"];
    const typed = aliasedFieldOf([["O"], quote, ["N"], quote, ["s"]]);
    expect(alignGlyphs(typed, "O'N\u{2bc}s")).toBe(0);
    expect(typed.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 3, 4]);
    const mu = ["\u{b5}", "\u{3bc}"];
    const micro = aliasedFieldOf([["5"], mu, ["m"], ["5"], mu, ["m"]]);
    expect(alignGlyphs(micro, "5 \u{b5}m 5 \u{3bc}m")).toBe(0);
    expect(micro.glyphs.map((g) => g.offset)).toEqual([0, 2, 3, 5, 7, 8]);
  });

  it("takes a hyphen that is also U+2011 for the U+2011 a text holds, not for one TeX inserted", () => {
    // Source Sans's hyphen is U+002D, U+2010, U+2011 and the soft hyphen.
    const hyphen = ["-", "\u{2010}", "\u{2011}", "\u{ad}"];
    const f = aliasedFieldOf([["N"], ["o"], ["n"], hyphen, ["s"], ["t"], ["o"], ["p"]]);
    expect(alignGlyphs(f, "Non\u{2011}stop")).toBe(0);
    expect(f.glyphs[3]?.offset).toBe(3);
    expect(f.glyphs[3]?.inserted).toBeUndefined();
    // Where the text holds nothing for it, it is the hyphen TeX inserted at a line break.
    const broken = aliasedFieldOf([["t"], ["y"], ["p"], ["e"], hyphen, ["s"], ["e"], ["t"]]);
    expect(alignGlyphs(broken, "typeset")).toBe(0);
    expect(broken.glyphs[4]?.inserted).toBe(true);
    // A glyph that is only U+2010 or U+2011 is not the hyphen TeX inserts, which is U+002D's.
    const other = aliasedFieldOf([["t"], ["y"], ["p"], ["e"], ["\u{2010}", "\u{2011}"], ["s"]]);
    expect(alignGlyphs(other, "types")).toBe(1);
    expect(other.glyphs[4]?.inserted).toBeUndefined();
  });

  it("matches T1's one glyph for Ð and Đ to either", () => {
    const f = fieldOf(["\u{d0}", "a", "\u{d0}"]);
    expect(alignGlyphs(f, "\u{110}a\u{d0}")).toBe(0);
    expect(f.glyphs.map((g) => g.offset)).toEqual([0, 1, 2]);
  });

  it("matches TS1's angle brackets to each of the three code points LaTeX sets them from", () => {
    for (const text of ["\u{27e8}ok\u{27e9}", "\u{3008}ok\u{3009}", "\u{2329}ok\u{232a}"]) {
      const f = fieldOf(["\u{27e8}", "o", "k", "\u{27e9}"]);
      expect(alignGlyphs(f, text), text).toBe(0);
      expect(f.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 3]);
    }
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
    // OT1 sets é as an accent, which has no text, and an e, which matches its é as the letter
    // set without its accent; and … as three periods, which no … matches. Each glyph that missed
    // used to walk the rest of the run.
    // Read once, each field costs 9.4 to 10.6 times what it costs at a tenth of its length, in CPU
    // time (`fastest`); walked again for each glyph, 97 to 116 times. So each is bound by three
    // times ten times its tenth, and by 100 ms.
    const accented = (count: number) =>
      [
        fieldOf(Array.from({ length: 2 * count }, (_, i) => (i % 2 ? "e" : undefined))),
        "\u{e9}".repeat(count),
      ] as const;
    const dotted = (count: number) =>
      [fieldOf(Array.from({ length: 3 * count }, () => ".")), "\u{2026}".repeat(count)] as const;
    // And ß, whose capitals are two glyphs S, which no glyph S followed by an X spells, however
    // many times it is tried, folded, where the walk stands, first in the run and further on.
    const sharp = (count: number) =>
      [
        fieldOf(Array.from({ length: 3 * count }, (_, i) => (i % 2 ? "X" : "S"))),
        "\u{df}".repeat(count),
      ] as const;
    expect(alignGlyphs(...accented(8_000))).toBe(8_000);
    expect(alignGlyphs(...dotted(6_000))).toBe(18_000);
    expect(alignGlyphs(...sharp(6_000))).toBe(18_000);
    for (const [shape, count] of [
      [accented, 8_000],
      [dotted, 6_000],
      [sharp, 6_000],
    ] as const) {
      const [short = 0, long = 0] = fastest(
        [count / 10, count].map((each) => {
          const [field, text] = shape(each);
          return () => alignGlyphs(field, text);
        }),
        5,
      );
      expect(long).toBeLessThan(bound(3 * 10, short));
      expect(long).toBeLessThan(100);
    }
  }, 60_000);
});

describe("alignField, folding case", () => {
  it("matches a glyph to its character's capital, or small letter, and says the page folds the field", () => {
    // A title a class sets through \MakeUppercase, and one through \MakeLowercase.
    const upper = fieldOf([..."TYPESETTER"]);
    expect(alignField(upper, "Typesetter")).toEqual({ unmatched: 0, covered: 10, folded: "upper" });
    expect(upper.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const lower = fieldOf([..."proofs"]);
    expect(alignField(lower, "PROOFS")).toEqual({ unmatched: 0, covered: 6, folded: "lower" });
    // Accented letters fold as their letters do, composed or not, and set without their accents.
    const accented = fieldOf(["C", "A", "F", "\u{c9}", "\u{c6}", "R", "\u{d8}", "\u{c9}"]);
    expect(alignField(accented, "caf\u{e9} \u{e6}r\u{f8}e\u{301}")).toEqual({
      unmatched: 0,
      covered: 10,
      folded: "upper",
    });
    expect(accented.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
    expect(alignField(fieldOf([..."NAIVE"]), "na\u{ef}ve").folded).toBe("upper");
  });

  it("tries a glyph's text as it stands first, so a field the page sets as typed is not folded", () => {
    expect(alignField(fieldOf([..."ACME"]), "ACME")).toEqual({ unmatched: 0, covered: 4 });
    expect(alignField(fieldOf([..."ACME"]), "ACME").folded).toBeUndefined();
    const typed = fieldOf(["S", "S"]);
    expect(alignField(typed, "SS").folded).toBeUndefined();
    expect(typed.glyphs.map((g) => g.offset)).toEqual([0, 1]);
    // In a field the page folds, what matches as it stands is matched so.
    const mixed = fieldOf([..."MCDONALD"]);
    expect(alignField(mixed, "McDonald")).toEqual({ unmatched: 0, covered: 8, folded: "upper" });
    expect(mixed.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("gives the glyphs of a letter whose capitals are two, as ß's are SS, the letter's offset", () => {
    const street = fieldOf([..."STRASSE"]);
    expect(alignField(street, "Stra\u{df}e")).toEqual({
      unmatched: 0,
      covered: 6,
      folded: "upper",
    });
    expect(street.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 3, 4, 4, 5]);
    // The ligature ﬁ, as a text pasted from a PDF holds it, is FI in capitals.
    const fine = fieldOf([..."FINE"]);
    expect(alignField(fine, "\u{fb01}ne")).toEqual({ unmatched: 0, covered: 3, folded: "upper" });
    expect(fine.glyphs.map((g) => g.offset)).toEqual([0, 0, 1, 2]);
    // Both glyphs or neither: an S alone is not ß.
    const alone = fieldOf(["S", "X"]);
    expect(alignField(alone, "\u{df}x")).toEqual({ unmatched: 1, covered: 2, folded: "upper" });
    expect(alone.glyphs.map((g) => g.offset)).toEqual([0, 1]);
  });

  it("folds ı and İ as Unicode does, and a letter whose folded form has an accent the page leaves out", () => {
    // The dotless ı is I in capitals; İ is i and a combining dot in small letters, which pdfTeX
    // sets as the dot accent over i, and XeTeX's fonts may leave as i.
    expect(alignField(fieldOf([..."ILIK"]), "\u{131}l\u{131}k")).toEqual({
      unmatched: 0,
      covered: 4,
      folded: "upper",
    });
    expect(alignField(fieldOf([..."ipek"]), "\u{130}PEK").folded).toBe("lower");
    const dotted = fieldOf(["i\u{307}", ..."pek"]);
    expect(alignField(dotted, "\u{130}PEK")).toEqual({ unmatched: 0, covered: 4, folded: "lower" });
    // ǰ is J and a caron in capitals, which pdfTeX's LaTeX sets as J alone.
    expect(alignField(fieldOf(["J", "A"]), "\u{1f0}a")).toEqual({
      unmatched: 0,
      covered: 2,
      folded: "upper",
    });
    // Σ is ς at a word's end in small letters, as \MakeLowercase sets it.
    expect(
      alignField(
        fieldOf([..."\u{3c3}\u{3bf}\u{3c6}\u{3bf}\u{3c2}"]),
        "\u{3a3}\u{39f}\u{3a6}\u{39f}\u{3a3}",
      ),
    ).toEqual({
      unmatched: 0,
      covered: 5,
      folded: "lower",
    });
    // A Turkish locale's capitals are not folded: without one, LaTeX and toUpperCase make i I.
    expect(alignField(fieldOf(["\u{130}", ..."PEK"]), "ipek").unmatched).toBe(1);
  });

  it("records a mixed case when the glyphs are of both, as a class that capitalises first letters sets them", () => {
    const first = fieldOf([..."MachineLearning"]);
    expect(alignField(first, "machine learning")).toEqual({
      unmatched: 0,
      covered: 16,
      folded: "mixed",
    });
    expect(first.glyphs.map((g) => g.offset).slice(6, 9)).toEqual([6, 8, 9]);
    // ß has no capital of its own that is one letter, so a primitive \uppercase, which XeTeX may set
    // a title through, leaves it among capitals, and the field is in capitals all the same.
    const street = fieldOf([..."STRA\u{df}EUNDBR\u{dc}CKE"]);
    expect(alignField(street, "Stra\u{df}e und Br\u{fc}cke")).toEqual({
      unmatched: 0,
      covered: 17,
      folded: "upper",
    });
  });

  it("resynchronises on a glyph folded, and finds one past characters that set no glyph", () => {
    // OT1 sets an underscore as a rule, not a glyph.
    const snake = fieldOf(["A", "B"]);
    expect(alignField(snake, "a_b")).toEqual({ unmatched: 0, covered: 3, folded: "upper" });
    expect(snake.glyphs.map((g) => g.offset)).toEqual([0, 2]);
    // An emoji sets no glyph, and the first letter after it is a dotless ı in capitals.
    const after = fieldOf(["I", "X"]);
    expect(alignField(after, "\u{1f600}\u{131}x")).toEqual({
      unmatched: 0,
      covered: 4,
      folded: "upper",
    });
    expect(after.glyphs.map((g) => g.offset)).toEqual([2, 3]);
    // So is é set without its accent, which the walk used to look for only at the run's end.
    const bare = fieldOf(["e", "e"]);
    expect(alignField(bare, "\u{1f600}\u{e9}e")).toEqual({ unmatched: 0, covered: 4 });
    expect(bare.glyphs.map((g) => g.offset)).toEqual([2, 3]);
  });

  it("ends a chain of glyphs with the one character whose folded form it spells", () => {
    // A font may join two S in one glyph: SS takes the first ß whole, and each S alone, which would
    // go on into the next ß's capitals, matches nothing, all or nothing.
    const joined = fieldOf(["S", "SS", "S"]);
    expect(alignField(joined, "\u{df}\u{df}")).toEqual({
      unmatched: 2,
      covered: 1,
      folded: "upper",
    });
    expect(joined.glyphs.map((g) => g.offset)).toEqual([0, 0, 1]);
    // Glyphs SS against s and ß: each takes a ß, never an s and half a ß.
    const across = fieldOf(["SS", "SS", "S"]);
    expect(alignField(across, "s\u{df}\u{df}")).toEqual({
      unmatched: 1,
      covered: 3,
      folded: "upper",
    });
    expect(across.glyphs.map((g) => g.offset)).toEqual([1, 2, 3]);
    // A glyph over whole characters ends inside another only before its accents: fi takes F and the
    // i of İ in small letters, and the dot after it, which would go on with İ from inside it,
    // matches nothing.
    const dotted = fieldOf(["fi", "\u{307}", "x"]);
    expect(alignField(dotted, "F\u{130}X")).toEqual({ unmatched: 1, covered: 3, folded: "lower" });
    expect(dotted.glyphs.map((g) => g.offset)).toEqual([0, 2, 2]);
  });

  it("tries a bounded chain at each place, so folding costs what the walk does", () => {
    // Glyph names a crafted font may give, as the reviews found. Glyphs SS against ß, each ending
    // inside the next ß's capitals, which a chain went on with to the text's end, taking every glyph
    // after it. ՒԵ against the Armenian ligature և, whose capitals are ԵՒ, which the chain from Ե
    // went on with from each place of the run. And a glyph a font maps from S and a bullet, which
    // walks the run of ß as a glyph spelled outside ASCII does, trying the chain from each place,
    // while the glyphs SS after it match at once. A chain now ends with its character, so a place
    // costs a bound: SS and the walking glyph cost ten times their tenths in CPU time (`fastest`),
    // where they cost 74 and 312 times; and ՒԵ, each glyph of which walks the run and misses, as it
    // did before folding, a hundred times. Each is bound by three times that, and by 100 ms.
    const pairs = (count: number) =>
      [
        fieldOf([...Array.from({ length: count }, () => "SS"), "S"]),
        `s${"\u{df}".repeat(count)}`,
      ] as const;
    const armenian = (count: number) =>
      [
        fieldOf(["\u{535}", ...Array.from({ length: count - 1 }, () => "\u{552}\u{535}")]),
        "\u{587}".repeat(count),
      ] as const;
    const walking = (count: number) =>
      [
        aliasedFieldOf([
          ["S", "\u{2022}"],
          ...Array.from({ length: count - 1 }, () => ["SS"]),
          ["X"],
        ]),
        "\u{df}".repeat(count),
      ] as const;
    const each = pairs(8_000);
    expect(alignGlyphs(...each)).toBe(1);
    expect(new Set(each[0].glyphs.map((g) => g.offset)).size).toBe(8_001);
    expect(alignGlyphs(...armenian(400))).toBe(400);
    expect(alignGlyphs(...walking(2_000))).toBe(2);
    for (const [shape, count, growth] of [
      [pairs, 8_000, 10],
      [walking, 2_000, 10],
      [armenian, 400, 100],
    ] as const) {
      const [short = 0, long = 0] = fastest(
        [count / 10, count].map((size) => {
          const [field, text] = shape(size);
          return () => alignGlyphs(field, text);
        }),
        5,
      );
      expect(long).toBeLessThan(bound(3 * growth, short));
      expect(long).toBeLessThan(100);
    }
  }, 60_000);

  it("gives a hyphen TeX inserted between the capitals of one letter the letter's offset", () => {
    // TeX may break MASSEINHEIT, Maßeinheit in capitals, between the two S of ß: the hyphen is one
    // it inserted, and it and both S stand at ß's offset.
    const broken = fieldOf([..."MAS", "-", ..."SEINHEIT"]);
    expect(alignField(broken, "Ma\u{df}einheit")).toEqual({
      unmatched: 0,
      covered: 10,
      folded: "upper",
    });
    expect(broken.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 2, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(broken.glyphs.flatMap((g, i) => (g.inserted ? [i] : []))).toEqual([3]);
    // Only between two glyphs of the letter: an S and a hyphen do not spell ß.
    const alone = fieldOf(["S", "-", "X"]);
    expect(alignField(alone, "\u{df}x").unmatched).toBe(1);
  });

  it("matches a ligature in small letters whose first letter the text holds small already", () => {
    // \MakeLowercase sets SelfLess as selfless and OfFICE as office, with the ligatures fl and ffi,
    // whose first letters the text already holds small: the fold changes the letters after them.
    const selfless = fieldOf(["s", "e", "l", "fl", "e", "s", "s"]);
    expect(alignField(selfless, "SelfLess")).toEqual({ unmatched: 0, covered: 8, folded: "lower" });
    expect(selfless.glyphs.map((g) => g.offset)).toEqual([0, 1, 2, 3, 5, 6, 7]);
    const office = fieldOf(["o", "ffi", "c", "e"]);
    expect(alignField(office, "OfFICE")).toEqual({ unmatched: 0, covered: 6, folded: "lower" });
    expect(office.glyphs.map((g) => g.offset)).toEqual([0, 1, 4, 5]);
    // A ligature the text spells as it stands folds nothing.
    expect(alignField(fieldOf(["o", "ffi", "c", "e"]), "office").folded).toBeUndefined();
  });
});
