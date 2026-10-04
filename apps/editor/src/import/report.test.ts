import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { AssemblyChecks, GlyphOwner, LockedPart } from "./assemble";
import type { ReferenceGlyph, ReferenceItem } from "./reference";
import {
  FIRST_WORDS,
  LOCK_WHY,
  outcomeOf,
  pageWords,
  percent,
  type Report,
  readPage,
  reportOf,
  SUCCESS_RATE,
  shown,
  summaryOf,
} from "./report";
import { DROPPED, UNCHECKED } from "./validate";

// Every page, word and name here is invented for these tests; nothing is a real resume's.

/** Scaled points in a TeX point. */
const PT = 65536;

/** An invented font's size: ten points. */
const SIZE = 10 * PT;

/**
 * An invented line of glyphs at `v`: each character of `text` a glyph half the size wide, a space a
 * gap of three tenths of it, as TeX sets the space between two words; from `h` on.
 */
function line(text: string, v: number, h = 0, size = SIZE): ReferenceGlyph[] {
  const glyphs: ReferenceGlyph[] = [];
  let at = h;
  for (const character of text) {
    if (character === " ") {
      at += 0.3 * size;
      continue;
    }
    glyphs.push({
      kind: "glyph",
      font: "invented10",
      size,
      code: character.codePointAt(0) ?? 0,
      text: character,
      h: at,
      v,
      width: size / 2,
    });
    at += size / 2;
  }
  return glyphs;
}

/** The words a page's glyphs read into, each as its glyphs' texts joined. */
const wordsOf = (glyphs: readonly ReferenceGlyph[]) => {
  const read = readPage(glyphs);
  return read.words.map((word) => word.glyphs.map((at) => read.texts[at]).join(""));
};

describe("reading a page's words", () => {
  test("parts words at a space and at punctuation, as a field's words are counted", () => {
    const glyphs = [
      ...line("Quill Invented", 0),
      ...line("555-0100 | quill@example.invalid", 20 * PT),
    ];
    expect(wordsOf(glyphs)).toEqual([
      "Quill",
      "Invented",
      "555",
      "0100",
      "quill",
      "example",
      "invalid",
    ]);
  });

  test("reads a space where the next glyph starts more than a tenth of its size on, and a new line", () => {
    // A kern between two letters, a tight space and a loose one, and the next line's first word.
    const glyphs = line("abcd", 0);
    const [a, b, c, d] = glyphs as [ReferenceGlyph, ReferenceGlyph, ReferenceGlyph, ReferenceGlyph];
    b.h = a.h + (a.width ?? 0) + 0.05 * SIZE;
    c.h = b.h + (b.width ?? 0) + 0.12 * SIZE;
    d.v = 12 * PT;
    d.h = 0;
    expect(wordsOf([a, b, c, d])).toEqual(["ab", "c", "d"]);
    // A superscript a little above its line stays in its word.
    const raised = line("1st", 0);
    for (const glyph of raised.slice(1)) glyph.v = -3 * PT;
    expect(wordsOf(raised)).toEqual(["1st"]);
  });

  test("reads a ligature as its letters and an accent over its letter as one, as the aligner does", () => {
    // `offi` with the fi ligature, and `\'e`: the acute set first, its letter back under it.
    const glyphs = line("of", 0);
    const fi: ReferenceGlyph = { ...(glyphs[1] as ReferenceGlyph), text: "fi", code: 12 };
    const cafe = line("caf", 0, 3 * SIZE);
    const end = cafe.at(-1) as ReferenceGlyph;
    const acute: ReferenceGlyph = {
      ...end,
      text: "\u{b4}",
      code: 19,
      h: end.h + SIZE / 2 + 0.1 * SIZE,
      width: 0.3 * SIZE,
    };
    const e: ReferenceGlyph = { ...end, text: "e", code: 101, h: end.h + SIZE / 2 };
    const read = readPage([...glyphs.slice(0, 1), fi, ...cafe, acute, e]);
    expect(read.words.map((word) => word.glyphs.map((at) => read.texts[at]).join(""))).toEqual([
      "ofi",
      "café",
    ]);
    // An accent alone, with no letter under it, is no part of a word.
    expect(
      wordsOf([...line("a", 0), { ...acute, h: 5 * SIZE }, ...line("b", 0, 7 * SIZE)]),
    ).toEqual(["a", "b"]);
  });

  test("reads a word TeX broke at a line's end with a hyphen as one, as the aligner reads its hyphen", () => {
    // `inven-` and `ted` on the next line: one word; a hyphen inside a line, and one before a
    // capital, as a name joined by one sets it, part words as any punctuation does.
    expect(wordsOf([...line("an inven-", 0), ...line("ted word", 12 * PT)])).toEqual([
      "an",
      "invented",
      "word",
    ]);
    expect(wordsOf(line("full-stack", 0))).toEqual(["full", "stack"]);
    expect(wordsOf([...line("Jean-", 0), ...line("Quill", 12 * PT)])).toEqual(["Jean", "Quill"]);
    // A hyphen the resume writes itself, which a line ends with, parts the two as it does inside
    // a line; the resume says so, whatever the case of either half.
    const broken = [...line("a full-", 0), ...line("stack tool", 12 * PT)];
    const written = (before: string, after: string) =>
      `invented full-stack tool`.includes(`${before}-${after}`.toLowerCase());
    const read = readPage(broken, written);
    expect(read.words.map((word) => word.glyphs.map((at) => read.texts[at]).join(""))).toEqual([
      "a",
      "full",
      "stack",
      "tool",
    ]);
    expect(wordsOf(broken)).toEqual(["a", "fullstack", "tool"]);
    // Through the report, the document's text says it.
    const report = reportOf(
      {
        checks: checks({ owners: [{ page: 0, from: 0, to: broken.length, field: "ent-a.title" }] }),
        extras: [],
        document: { resume: { sections: [{ title: "A Full-Stack Tool" }] } },
      },
      { pages: [{ items: broken }], bibliographyLeftOut: false, images: [] },
    );
    expect(report.words.editable).toBe(4);
  });

  test("reads a word TeX broke with a hyphen at a page's end as one, counted on the page it begins on", () => {
    const broken = {
      pages: [{ items: line("an inven-", 50 * PT) }, { items: line("ted word", 0) }],
    };
    const pages = pageWords(broken);
    const shownWords = pages.map((read) =>
      read.words.map((word) => word.glyphs.map((at) => read.texts[at]).join("")),
    );
    // One word, `inven` on the first page, whose next page's `ted` is no word of its own.
    expect(shownWords).toEqual([["an", "inven"], ["word"]]);
    expect(pages[0]?.texts.at(-1)).toBe("");
    // A hyphen the resume writes itself parts the two, as on one page; and a capital after a
    // hyphen at a page's end, as a name joined by one, starts a word of its own.
    const written = (before: string, after: string) => `${before}-${after}` === "inven-ted";
    expect(pageWords(broken, written).flatMap((read) => read.words).length).toBe(4);
    const named = { pages: [{ items: line("Jean-", 50 * PT) }, { items: line("Quill", 0) }] };
    expect(pageWords(named).flatMap((read) => read.words).length).toBe(2);
  });

  test("reads a glyph the page cannot name as nothing, and only glyphs, page by page", () => {
    // `a`, an icon the page has no text for, and `b`, side by side: two words, the icon neither.
    const [a, icon, b] = line("axb", 0) as [ReferenceGlyph, ReferenceGlyph, ReferenceGlyph];
    delete icon.text;
    const items: ReferenceItem[] = [
      a,
      { kind: "special", h: 0, v: 0, text: "color push gray 0" },
      icon,
      { kind: "rule", h: 0, v: 0, width: SIZE, height: PT },
      b,
    ];
    const pages = pageWords({ pages: [{ items }, { items: line("Next page", 0) }] });
    expect(pages.map((page) => page.words.length)).toEqual([2, 2]);
    expect(pages[0]?.words).toEqual([
      { page: 0, glyphs: [0] },
      { page: 0, glyphs: [2] },
    ]);
    expect(pages[1]?.words[0]).toEqual({ page: 1, glyphs: [0, 1, 2, 3] });
  });
});

/** Invented checks of an assembly, the owners and fields given. */
function checks(changes: Partial<AssemblyChecks>): AssemblyChecks {
  return {
    outcome: "assembled",
    fields: { editable: 0, raw: 0, required: 0, locked: {} },
    words: { editable: 0, locked: {} },
    sections: { mapped: 0, locked: 0 },
    required: [],
    controls: { offered: [], proven: [], dropped: [] },
    redefinitions: { applied: [], dropped: [], placement: "class" },
    repeatable: [],
    findings: [],
    compiles: 0,
    ms: 0,
    decisions: {},
    all: [],
    ...changes,
  };
}

/** An invented field of the document, typeset or raw. */
const field = (id: string, mode: "typeset" | "raw" = "typeset") => ({
  at: `b0.${id}`,
  slot: "command|cventry|1",
  field: id,
  node: id.slice(0, id.indexOf(".")),
  type: "text" as const,
  lockable: true,
  words: 2,
  mode,
});

/** An invented locked part. */
const part = (reason: LockedPart["reason"], words: number): LockedPart => ({
  at: "b0",
  kind: "section",
  reason,
  words,
});

/**
 * An invented page: a header line the template sets around a name, an entry's title and dates, a
 * locked line of skills and a contact the side panel edits; with what sets each run of it.
 */
function invented(): { glyphs: ReferenceGlyph[]; owners: GlyphOwner[] } {
  // The dates' dash is one glyph, as TeX sets `--`, which the page names by that spelling.
  const entryLine = line("Invented Engineer Jul 2020 X Present", 20 * PT);
  const dash = entryLine[23] as ReferenceGlyph;
  dash.text = "--";
  const lines = [
    line("Page Quill Invented", 0),
    entryLine,
    line("Languages: Invented, Words, Other Tools: Quill, Wren", 40 * PT),
    line("quill@example.invalid", 60 * PT),
  ];
  const glyphs = lines.flat();
  const [header, entry, skills] = lines.map((each) => each.length) as [number, number, number];
  const owners: GlyphOwner[] = [
    // "Page" is the template's own; the name its header's field.
    { page: 0, from: 0, to: 4 },
    { page: 0, from: 4, to: header, field: "header.first" },
    // The title is a field, and the dates a locked part, its date written otherwise.
    { page: 0, from: header, to: header + 16, field: "ent-a.title" },
    { page: 0, from: header + 16, to: header + entry, part: 0 },
    { page: 0, from: header + entry, to: header + entry + skills, part: 1 },
    { page: 0, from: header + entry + skills, to: glyphs.length, field: "header.email" },
  ];
  return { glyphs, owners };
}

/** The invented page's report, with the checks' changes given. */
function reportOfInvented(changes: Partial<AssemblyChecks> = {}, inputs = {}): Report {
  const { glyphs, owners } = invented();
  return reportOf(
    {
      checks: checks({
        owners,
        all: [field("header.first"), field("ent-a.title"), field("header.email", "raw")],
        ...changes,
      }),
      extras: [part("date", 3), part("unmapped", 7)],
    },
    { pages: [{ items: glyphs }], bibliographyLeftOut: false, images: [] },
    inputs,
  );
}

describe("the report", () => {
  test("counts the page's words by what sets them, and the share of the resume's editable in place", () => {
    const report = reportOfInvented();
    // Quill Invented (2) and Invented Engineer (2) are editable in place, and quill example invalid
    // (3) in the side panel alone, which the rate leaves out, as plan section 6.2 counts the bar;
    // Jul 2020 Present (3) and the skills (7) locked; Page the template's.
    expect(report.words).toEqual({
      editable: 4,
      panel: 3,
      retype: 0,
      locked: 10,
      byReason: { date: 3, unmapped: 7 },
      body: 17,
      template: 1,
    });
    expect(report.rate).toBeCloseTo(4 / 17, 10);
    expect(report.notes).toEqual([
      "3 more words are editable in the side panel, where the page cannot mark them.",
    ]);
    expect(report.outcome).toBe("partial");
    expect(report.matched).toBe(true);
  });

  test("names each locked part by its first words as the page shows them, and why", () => {
    const report = reportOfInvented();
    expect(report.locked).toEqual([
      { words: "Jul 2020 – Present", count: 3, reason: "date", why: LOCK_WHY.date },
      {
        words: "Languages: Invented, Words, Other Tools: Quill, Wren",
        count: 7,
        reason: "unmapped",
        why: LOCK_WHY.unmapped,
      },
    ]);
  });

  test("gives a locked section's id with its words, which the side panel names its row by", () => {
    // Decision 0041: the dates an entry's instance kept as written, the skills a locked section;
    // and then the skills a section's `after`, kept in its extras, which is no locked section.
    const { glyphs, owners } = invented();
    const all = [field("header.first"), field("ent-a.title"), field("header.email", "raw")];
    const reference = { pages: [{ items: glyphs }], bibliographyLeftOut: false, images: [] };
    const dates: LockedPart = { ...part("date", 3), kind: "field", node: "ent-a", key: "dates" };
    const sections = (skills: LockedPart) =>
      reportOf({ checks: checks({ owners, all }), extras: [dates, skills] }, reference).locked;
    expect(
      sections({ ...part("unmapped", 7), node: "lock-skills" }).map((each) => each.section),
    ).toEqual([undefined, "lock-skills"]);
    const after = sections({ ...part("unmapped", 7), node: "sec-a", key: "after" });
    expect(after.map((each) => each.section)).toEqual([undefined, undefined]);
    expect(after.map((each) => Object.hasOwn(each, "section"))).toEqual([false, false]);
  });

  test("cuts a part's words after the eighth, with an ellipsis", () => {
    const glyphs = line("one two three four five six seven eight nine ten", 0);
    const report = reportOf(
      {
        checks: checks({ owners: [{ page: 0, from: 0, to: glyphs.length, part: 0 }] }),
        extras: [part("unmapped", 10)],
      },
      { pages: [{ items: glyphs }], bibliographyLeftOut: false, images: [] },
    );
    expect(FIRST_WORDS).toBe(8);
    expect(report.locked[0]?.words).toBe("one two three four five six seven eight…");
    expect(report.locked[0]?.count).toBe(10);
  });

  test("shows what the document keeps that no part counts as a part of its own for each run of it", () => {
    const glyphs = [...line("kept words", 0), ...line("Field", 20 * PT), ...line("again", 40 * PT)];
    const report = reportOf(
      {
        checks: checks({
          owners: [
            { page: 0, from: 0, to: 9, kept: "unmapped" },
            { page: 0, from: 9, to: 14, field: "ent-a.title" },
            { page: 0, from: 14, to: 19, kept: "unmapped" },
          ],
          all: [field("ent-a.title")],
        }),
        extras: [],
      },
      { pages: [{ items: glyphs }], bibliographyLeftOut: false, images: [] },
    );
    expect(report.locked.map((each) => [each.words, each.count])).toEqual([
      ["kept words", 2],
      ["again", 1],
    ]);
    expect(report.words.byReason).toEqual({ unmapped: 3 });
  });

  test("succeeds at nine tenths with the first check holding, and is partial below or with the page moved", () => {
    expect(SUCCESS_RATE).toBe(0.9);
    expect(outcomeOf(0.9, true)).toBe("succeeded");
    expect(outcomeOf(1, true)).toBe("succeeded");
    expect(outcomeOf(0.8999, true)).toBe("partial");
    expect(outcomeOf(1, false)).toBe("partial");
    // A rate shows in whole per cent, down, so that one under the bar never reads as it.
    expect(percent(0.8999)).toBe("89%");
    expect(percent(0.9)).toBe("90%");
    expect(percent(0.29)).toBe("29%");
    // Every word editable: succeeded, and the line says so.
    const { glyphs, owners } = invented();
    const all = owners.map((owner) => ({ ...owner, field: "ent-a.title", part: undefined }));
    const editable = reportOf(
      { checks: checks({ owners: all, all: [field("ent-a.title")] }), extras: [] },
      { pages: [{ items: glyphs }], bibliographyLeftOut: false, images: [] },
    );
    expect(editable.outcome).toBe("succeeded");
    expect(summaryOf(editable)).toBe(
      "Imported: 100% of your resume's words are editable on the page.",
    );
    // Partial, under the bar, and with the page moved.
    expect(summaryOf(reportOfInvented())).toBe(
      "Imported in part: 23% of your resume's words are editable on the page, under the 90% this editor aims for.",
    );
    const moved = reportOf(
      {
        checks: checks({ owners: all, all: [field("ent-a.title")], outcome: "partial" }),
        extras: [],
      },
      { pages: [{ items: glyphs }], bibliographyLeftOut: false, images: [] },
    );
    expect(moved.outcome).toBe("partial");
    expect(summaryOf(moved)).toBe(
      "Imported in part: 100% of your resume's words are editable on the page, but the page this editor sets differs from your original's.",
    );
  });

  test("lists what was left out: images, a bibliography, controls and files set aside", () => {
    const report = reportOf(
      {
        checks: checks({
          owners: [],
          controls: {
            offered: ["margins", "fontSize", "pageSize", "font", "density", "accent"],
            proven: [],
            dropped: [
              { control: "margins", why: `${DROPPED.stops}margins 0.4` },
              { control: "fontSize", why: DROPPED.same },
              { control: "pageSize", why: `${DROPPED.layout}pageSize a4` },
              { control: "font", why: DROPPED.harness },
              { control: "density", why: DROPPED.moves },
              { control: "accent", why: UNCHECKED },
            ],
          },
        }),
        extras: [],
      },
      {
        pages: [],
        bibliographyLeftOut: true,
        images: [{ name: "logo", path: "logo.png", kind: "png", missing: true }],
      },
      {
        images: {
          replaced: [{ name: "photo.png", path: "photo.png", kind: "png" }],
          dropped: [{ name: "sketch.svg", why: "format" }],
        },
        warnings: [
          "notes.txt is left out: a file of the same path beside the main file comes first.",
          "cv.tex asks for PDF output, which this editor makes from DVI: it is compiled for DVI.",
        ],
      },
    );
    expect(report.dropped).toEqual([
      {
        kind: "images",
        text: "2 images, shown as blank space of their size, since this editor's PDF carries none: photo.png and logo.",
      },
      { kind: "images", text: "1 image of the upload left out: sketch.svg." },
      {
        kind: "bibliography",
        text: "The bibliography, which this editor cannot build, and which the upload holds no built copy of.",
      },
      {
        kind: "control",
        text: "Margins: not offered, since one of its values stops the template.",
      },
      { kind: "control", text: "Font size: not offered, since it changes nothing on the page." },
      {
        kind: "control",
        text: "Page size: not offered, since one of its values sets another page than it asks for.",
      },
      { kind: "control", text: "Font: not offered, since it does not work in the checks." },
      {
        kind: "control",
        text: "Density: not offered, since it moves your original's page as it stands.",
      },
      {
        kind: "control",
        text: "Accent colour: not offered, since the checks stopped before they could try it.",
      },
      {
        kind: "file",
        text: "notes.txt is left out: a file of the same path beside the main file comes first.",
      },
    ]);
    // Each of the checks' reasons has words of its own, never the catch-all's.
    expect(report.dropped.every((each) => !each.text.includes("could not prove"))).toBe(true);
  });

  test("says why everything stayed as the probe found it, what fonts it swapped, and what the template cannot add", () => {
    const report = reportOfInvented(
      { latinModern: ["ecrm1000"], decisions: { fixed: ["entry", "section.list"] } },
      {
        naming: {
          failed: "The naming service could not be reached. Check the connection and try again.",
        },
      },
    );
    expect(report.notes).toEqual([
      "No answer came for the template, so its parts stay as your original sets them: The naming service could not be reached. Check the connection and try again.",
      "Its Computer Modern fonts are set in Latin Modern, their successor, which the page can draw.",
      "The template takes no more and no fewer entries and list sections than your original has.",
      "3 more words are editable in the side panel, where the page cannot mark them.",
    ]);
  });

  test("never shows a backslash or a brace, whatever the page, the names or the messages hold", () => {
    const shady = [...line("\\textbf{Invented}", 0), ...line("{x}", 20 * PT)];
    const report = reportOf(
      {
        checks: checks({
          owners: [{ page: 0, from: 0, to: shady.length, part: 0 }],
          controls: {
            offered: [],
            proven: [],
            dropped: [{ control: "margins", why: "\\error{x}" }],
          },
          decisions: { fixed: ["entry"] },
          latinModern: ["ecrm1000"],
        }),
        extras: [part("raw", 2)],
      },
      { pages: [{ items: shady }], bibliographyLeftOut: true, images: [] },
      {
        images: { replaced: [{ name: "\\photo{1}.png", path: "p.png", kind: "png" }], dropped: [] },
        warnings: ["\\input{x} is left out: {invented}."],
        naming: { failed: "\\relax{}" },
      },
    );
    const strings = [
      summaryOf(report),
      ...report.locked.flatMap((each) => [each.words, each.why]),
      ...report.dropped.map((each) => each.text),
      ...report.notes,
    ];
    expect(strings.length).toBeGreaterThan(6);
    for (const each of strings) expect(each).not.toMatch(/[\\{}]/);
    expect(shown("a\\b{c}d\u{e000}e")).toBe("a b c d e");
  });

  test("counts an assembly made before its owners were read as the source counted it, naming no part", () => {
    const report = reportOf(
      {
        checks: checks({
          words: { editable: 60, locked: { date: 4, unmapped: 36 } },
          all: [field("header.email", "raw")],
        }),
        extras: [part("unmapped", 36)],
      },
      { pages: [{ items: line("Anything", 0) }], bibliographyLeftOut: false, images: [] },
    );
    expect(report.words).toEqual({
      editable: 60,
      panel: 2,
      retype: 0,
      locked: 40,
      byReason: { date: 4, unmapped: 36 },
      body: 102,
      template: 0,
    });
    expect(report.locked).toEqual([]);
  });

  test("gives a running footer to the locked part that sets it on every page, its date and number with it", () => {
    // Two invented pages, each under a running header the template sets alone and over a running
    // footer one call of the source sets: a date and a page's number it passes, and its text in
    // the middle, which the probe reads on page 1 alone, as the part's (item 13's hand count).
    const header = () => line("Invented Template", -20 * PT);
    const footer = (number: string) => [
      ...line("Oct 3, 2026", 100 * PT),
      ...line("Quill Invented · Resume", 100 * PT, 20 * SIZE),
      ...line(number, 100 * PT, 40 * SIZE),
    ];
    const date = line("Oct 3, 2026", 0).length;
    const centre = line("Quill Invented · Resume", 0).length;
    const top = header().length;
    const first = [...header(), ...line("Invented Engineer", 0), ...footer("1")];
    const second = [...header(), ...line("Wren Quill", 0), ...footer("2")];
    const body1 = first.length - top - date - centre - 1;
    const body2 = second.length - top - date - centre - 1;
    const owners: GlyphOwner[] = [
      { page: 0, from: top, to: top + body1, field: "ent-a.title" },
      { page: 0, from: top + body1 + date, to: top + body1 + date + centre, part: 0 },
      { page: 1, from: top, to: top + body2, field: "ent-b.title" },
    ];
    const report = reportOf(
      {
        checks: checks({ owners, all: [field("ent-a.title"), field("ent-b.title")] }),
        extras: [part("raw", 3)],
      },
      { pages: [{ items: first }, { items: second }], bibliographyLeftOut: false, images: [] },
    );
    // Oct 3 2026, Quill Invented Resume and the page's number: 7 words a page, all the part's; the
    // header's 2 a page the template's.
    expect(report.words).toEqual({
      editable: 4,
      panel: 0,
      retype: 0,
      locked: 14,
      byReason: { raw: 14 },
      body: 18,
      template: 4,
    });
    expect(report.locked).toEqual([
      {
        words: "Oct 3, 2026 Quill Invented · Resume 1",
        count: 14,
        reason: "raw",
        why: LOCK_WHY.raw,
      },
    ]);
    // A line on one page alone is no running line: the template keeps its date and number.
    const alone = reportOf(
      {
        checks: checks({ owners: owners.slice(0, 2), all: [field("ent-a.title")] }),
        extras: [part("raw", 3)],
      },
      { pages: [{ items: first }], bibliographyLeftOut: false, images: [] },
    );
    expect(alone.words).toMatchObject({ locked: 3, template: 6 });
  });

  test("imports nothing but types, so that Node runs it as it is for the corpus's runners", () => {
    const source = readFileSync(new URL("./report.ts", import.meta.url), "utf8");
    const imports = source.split("\n").filter((each) => /^import\b/.test(each));
    expect(imports.length).toBeGreaterThan(0);
    for (const each of imports) expect(each).toMatch(/^import type /);
  });
});

describe("an outline's report (the second pass's item 6)", () => {
  test("counts three shares, editable in place, through the retype and locked, each locked part with why", () => {
    const { glyphs, owners } = invented();
    // An outline's owners: the dates kept by check 1, the skills kept as the probe found them, a
    // shape no field holds, which the retype reaches; the rest fields, the email typed in place.
    const [, , , dates, skills] = owners as [
      GlyphOwner,
      GlyphOwner,
      GlyphOwner,
      GlyphOwner,
      GlyphOwner,
    ];
    const outline = owners.map((owner): GlyphOwner => {
      const { part: _part, ...at } = owner;
      return owner === dates
        ? { ...at, kept: "differs" }
        : owner === skills
          ? { ...at, kept: "shape" }
          : owner;
    });
    const report = reportOf(
      {
        checks: checks({
          owners: outline,
          retype: [{ page: 0, from: skills.from, to: skills.to }],
        }),
        extras: [],
      },
      { pages: [{ items: glyphs }], bibliographyLeftOut: false, images: [] },
      { outline: { groups: 4, fixed: 1, scripts: false } },
    );
    // Quill Invented, Invented Engineer and the email (7) in fields; the skills (7) retyped; the
    // dates (3) locked; Page the template's.
    expect(report.words).toEqual({
      editable: 7,
      panel: 0,
      retype: 7,
      locked: 3,
      byReason: { differs: 3 },
      body: 17,
      template: 1,
    });
    expect(report.shares).toEqual({ editable: 7 / 17, retype: 7 / 17, locked: 3 / 17 });
    // Only the part the retype does not reach is listed as locked, with why in plain words.
    expect(report.locked).toEqual([
      { words: "Jul 2020 – Present", count: 3, reason: "differs", why: LOCK_WHY.differs },
    ]);
    expect(summaryOf(report)).toBe(
      "Imported in part: 41% of your resume's words are editable on the page, 41% can be retyped where they stand, and 17% are locked, under the 90% this editor aims for.",
    );
    expect(report.notes).toEqual([
      "Your template's fonts cannot set Greek or Cyrillic letters, so typing them stops the page.",
      "1 of your resume's 4 lists and runs of entries keeps as many items as your original has: adding or removing one there would change the rest of the page, or could not be tried.",
    ]);
    // An assembly's report has no shares, and reads as it did.
    expect(reportOfInvented().shares).toBeUndefined();
    expect(reportOfInvented().words.retype).toBe(0);
  });
});
