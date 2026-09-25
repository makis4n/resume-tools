import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Resume,
  SECTION_KINDS,
  SECTION_ROLES,
  type Section,
  type SectionRole,
} from "@resume-tools/resume-model";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { type DrawnPage, drawPage, type GlyphBox, ruleCrossings } from "../page/draw";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { type PageItem, parseDvi } from "../tex/dvi";
import { shownTexts } from "../validate/pdf";
import { CURATED, curated } from "./curated";
import { generateBody, generateFormat } from "./generate";
import { type ByRole, defaultControls, parsePackage, type TemplatePackage } from "./package";

/** A snippet for a section's role: the role's own variant, or the default. */
const forRole = (value: ByRole<string>, role: SectionRole) =>
  typeof value === "string" ? value : (value[role] ?? value.default);

/** The snippets that may depend on a section's role, by where they sit in a package. */
function byRoleSnippets(pkg: TemplatePackage): [string, ByRole<string>][] {
  const { section, entry, bullet, item, labelledItem } = pkg.snippets;
  return [
    ...SECTION_KINDS.map((kind): [string, ByRole<string>] => [`section.${kind}`, section[kind]]),
    ["entry", entry],
    ["bullet", bullet],
    ["item", item],
    ["labelledItem", labelledItem],
  ];
}

/**
 * The id of every field a resume fills in, from the model alone: each node's text fields that
 * hold more than whitespace, and the dates that exist. A package that sets the resume must mark
 * each of them.
 */
function filledFields(resume: Resume): string[] {
  const ids: string[] = [];
  const add = (id: string, text: string | undefined) => {
    if (text?.trim()) ids.push(id);
  };
  const joined = (runs: { text: string }[]) => runs.map((run) => run.text).join("");
  const { header } = resume;
  add("header.first", header.name.first);
  add("header.last", header.name.last);
  for (const field of ["headline", "email", "phone", "location"] as const)
    add(`header.${field}`, header[field]);
  for (const link of header.links) add(`${link.id}.label`, link.label);
  for (const section of resume.sections) {
    add(`${section.id}.title`, section.title);
    if (section.kind === "paragraph") add(`${section.id}.text`, joined(section.text));
    else if (section.kind === "entries") {
      for (const entry of section.entries) {
        for (const field of ["title", "subtitle", "place"] as const)
          add(`${entry.id}.${field}`, entry[field]);
        if (entry.dates) ids.push(`${entry.id}.dates`);
        for (const bullet of entry.bullets) add(`${bullet.id}.text`, joined(bullet.text));
      }
    } else if (section.kind === "labelled") {
      for (const item of section.items) {
        add(`${item.id}.label`, item.label);
        add(`${item.id}.text`, joined(item.text));
      }
    } else {
      for (const item of section.items) add(`${item.id}.text`, joined(item.text));
    }
  }
  return ids;
}

describe("CURATED", () => {
  it("holds Jake's Resume, ported under the MIT licence with the notices of both its sources", () => {
    expect(CURATED.has("jake")).toBe(true);
    const jake = curated("jake");
    expect(jake).toBe(CURATED.get("jake"));
    expect(jake.package.id).toBe("jake");
    expect(jake.package.engine).toBe("pdftex");
    expect(jake.package.source.license).toBe("MIT");
    expect(jake.package.source.attribution).toBe(
      "Jake Gutierrez and Sourabh Bajaj (jakegut/resume, based on sb2nov/resume)",
    );
    // Upstream's header stays at the top, and the licence's notice goes with the copy: the
    // copyright line of sb2nov/resume, which Jake's Resume is based on, and Jake's, over the
    // permission notice the two share.
    expect(jake.package.preamble).toMatch(/^%-+\n% Resume in Latex\n% Author : Jake Gutierrez\n/);
    expect(jake.package.preamble).toContain(
      [
        "% Copyright (c) 2026 Sourabh Bajaj",
        "% Copyright (c) 2020 Jake Gutierrez",
        "%",
        "% Permission is hereby granted, free of charge,",
      ].join("\n"),
    );
  });

  it("holds AltaCV, ported under the LPPL as a renamed class with its author's notice", () => {
    const altacv = curated("altacv");
    expect(altacv.package.engine).toBe("pdftex");
    expect(altacv.package.source).toEqual({
      url: "https://github.com/liantze/AltaCV",
      license: "LPPL-1.3c",
      attribution: "LianTze Lim (liantze/AltaCV, altacv.cls v1.7.4 and its sample)",
    });
    // The LPPL asks that a modified file not carry the original's name: the class is renamed,
    // says what it derives from and that it is not the original, and keeps the licence's notice.
    expect(Object.keys(altacv.package.files)).toEqual(["rt-altacv.cls"]);
    const cls = altacv.package.files["rt-altacv.cls"] ?? "";
    expect(altacv.package.preamble).toContain("\\documentclass[10pt,a4paper]{rt-altacv}");
    expect(cls).toMatch(/^\\ProvidesClass\{rt-altacv\}\[[^\]]*not the original\]$/m);
    expect(cls).not.toContain("\\ProvidesClass{altacv}");
    expect(cls).toMatch(
      /^% This is rt-altacv\.cls, the resume editor's modified version of altacv\.cls$/m,
    );
    expect(cls).toContain("LianTze Lim (liantze@gmail.com)");
    const notice = [
      "%% It may be distributed and/or modified under the",
      "%% conditions of the LaTeX Project Public License, either version 1.3",
      "%% of this license or (at your option) any later version.",
      "%% The latest version of this license is in",
      "%%    http://www.latex-project.org/lppl.txt",
      "%% and version 1.3 or later is part of all distributions of LaTeX",
      "%% version 2003/12/01 or later.",
    ].join("\n");
    expect(cls).toContain(notice);
    // The preamble is the sample's, modified, under the same licence.
    expect(altacv.package.preamble).toContain(notice);
    // What the port leaves out, which the note at the class's top explains.
    expect(cls).not.toMatch(/^\\RequirePackage(\[[^\]]*\])?\{(pdfx|accsupp|tcolorbox)\}/m);
    expect(cls).toContain("\\RequirePackage[dvipdfmx,bookmarks=false,hidelinks]{hyperref}");
  });

  it("has a snippet for every section's role, and a sample that reaches each role's variant", () => {
    for (const [id, { package: pkg, sample }] of CURATED) {
      expect(Resume.safeParse(sample).success, id).toBe(true);
      const snippets = byRoleSnippets(pkg);
      for (const role of SECTION_ROLES)
        for (const [where, value] of snippets)
          expect(forRole(value, role), `${id} ${where} ${role}`).toBeTypeOf("string");
      // The round trip compiles the sample, so a variant it never reaches would go untested.
      const roles = new Set<string>(sample.sections.map((section) => section.role));
      for (const [where, value] of snippets)
        if (typeof value !== "string")
          for (const role of Object.keys(value))
            if (role !== "default") expect(roles.has(role), `${id} ${where} ${role}`).toBe(true);
    }
  });

  it("marks every field its sample fills in, so the harness finds each on the page", () => {
    // The harness checks that every field the body marks reaches the page, but a snippet that
    // left a slot out would mark nothing to check. Each sample fills only fields its template
    // shows, so the body must mark all of them.
    for (const [id, { package: pkg, sample }] of CURATED) {
      const { texts } = generateBody(pkg, sample, defaultControls(pkg));
      expect([...texts.keys()].sort(), id).toEqual(filledFields(sample).sort());
    }
  });

  it("refuses an id no curated package has", () => {
    expect(() => curated("nope")).toThrow("no curated template has the id nope");
  });
});

/** Where the page's glyphs begin on the left, in TeX points: the left margin, for Jake's. */
const leftmost = (page: DrawnPage) => Math.min(...page.glyphs.map((glyph) => glyph.x));

/** How wide a field on one line is set, in TeX points. */
function widthOf(page: DrawnPage, id: string): number {
  const glyphs = page.glyphs.filter((glyph) => glyph.field === id);
  const [first] = glyphs;
  const last = glyphs.at(-1);
  if (!first || !last) throw new Error(`no glyphs for ${id}`);
  return last.right - first.left;
}

/** The glyphs on the baseline of a field's first glyph: the field's, and anything set beside it. */
function lineOf(page: DrawnPage, id: string) {
  const y = page.glyphs.find((glyph) => glyph.field === id)?.y;
  if (y === undefined) throw new Error(`no glyphs for ${id}`);
  return page.glyphs.filter((glyph) => glyph.y === y);
}

/** The baselines a field's glyphs sit on, down the page. */
function baselinesOf(page: DrawnPage, id: string): number[] {
  const ys = new Set(page.glyphs.filter((glyph) => glyph.field === id).map((glyph) => glyph.y));
  return [...ys].sort((a, b) => a - b);
}

/**
 * Where a line of a page is set over the line above it, and by how much, down the page. A line
 * is every glyph on a baseline some field is set on, and it is set over the line above where a
 * glyph of one overlaps a glyph of the other by more than an edge. Baselines that only glyphs
 * outside the fields sit on are not lines: Jake centres each bullet on its line's axis, above the
 * baseline, and a bullet taken for a line would stand between its own line and the one above,
 * which would then never be compared.
 */
function linesSetOver(page: DrawnPage): string[] {
  const baselines = page.glyphs.flatMap((glyph) => (glyph.field === undefined ? [] : [glyph.y]));
  const lines = [...new Set(baselines)]
    .sort((a, b) => a - b)
    .map((y) => page.glyphs.filter((glyph) => glyph.y === y));
  const fieldsOf = (line: GlyphBox[]) =>
    [...new Set(line.flatMap((glyph) => glyph.field ?? []))].join(", ");
  const found: string[] = [];
  lines.forEach((line, i) => {
    const above = lines[i - 1] ?? [];
    // How far the line reaches into the one above, where any of its glyphs stands under one there.
    let depth = 0;
    for (const lower of line)
      for (const upper of above)
        if (Math.min(upper.right, lower.right) > Math.max(upper.left, lower.left))
          depth = Math.max(
            depth,
            Math.min(upper.bottom, lower.bottom) - Math.max(upper.top, lower.top),
          );
    if (depth > 0)
      found.push(`${fieldsOf(line)} over ${fieldsOf(above)} by ${depth.toFixed(2)} pt`);
  });
  return found;
}

/** Each link on a page, in order: the address its URI action opens, and the glyphs it spans. */
function linksOf(items: PageItem[]) {
  const links: { uri: string | undefined; glyphs: number }[] = [];
  let open: (typeof links)[number] | undefined;
  for (const item of items) {
    if (item.kind === "glyph" && open) open.glyphs++;
    if (item.kind !== "special") continue;
    if (item.text.startsWith("pdf:bann")) {
      open = { uri: /\/S\/URI\/URI\(((?:\\.|[^\\)])*)\)/.exec(item.text)?.[1], glyphs: 0 };
      links.push(open);
    } else if (item.text.startsWith("pdf:eann")) open = undefined;
  }
  return links;
}

const INCH = 72.27;

/** Every font size the control offers: 9 to 12 points in half points (plan section 5.4). */
const SIZES = [9, 9.5, 10, 10.5, 11, 11.5, 12];

/**
 * What each of Jake's fonts sets the sample in, by TeX Live's names for the family's fonts: what
 * the name of every font a field is set in begins with, T1's and TS1's alike, and the T1 fonts the
 * page must use, for the upright, bold, italic and small-caps text the sample has. Helvetica's
 * italic is its oblique, and each PostScript family's small caps are a virtual font.
 */
const FAMILIES: Record<string, { prefix: RegExp; t1: string[] }> = {
  lm: { prefix: /^(ec|ts1)-lm/, t1: ["ec-lmr10", "ec-lmbx10", "ec-lmri10", "ec-lmcsc10"] },
  charter: { prefix: /^bch/, t1: ["bchr8t", "bchb8t", "bchri8t", "bchrc8t"] },
  palatino: { prefix: /^ppl/, t1: ["pplr8t", "pplb8t", "pplri8t", "pplrc8t"] },
  helvetica: { prefix: /^phv/, t1: ["phvr8t", "phvb8t", "phvro8t", "phvrc8t"] },
};

/** How tall a page's text is set: from the highest glyph's top to the lowest glyph's bottom. */
const blockHeight = (page: DrawnPage) =>
  Math.max(...page.glyphs.map((glyph) => glyph.bottom)) -
  Math.min(...page.glyphs.map((glyph) => glyph.top));

/** The TeX fonts an output uses, by name. */
const fontsOf = (output: Uint8Array) => [
  ...new Set([...parseDvi(output, () => undefined).fonts.values()].map((font) => font.name)),
];

/**
 * Whether two outputs are the same bytes, but for the comment in the DVI's preamble, which
 * records the minute TeX ran (` TeX output 2026.09.25:0738`): the preamble is 15 bytes, the last
 * giving the comment's length.
 */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length || a[14] !== b[14]) return false;
  const after = 15 + (a[14] ?? 0);
  return a.every((byte, i) => (i >= 15 && i < after) || byte === b[i]);
}

/** The size a field's glyphs are set at, in points, as the SVG gives each glyph's. */
function sizeOf(page: DrawnPage, id: string): number {
  const uses = page.svg.matchAll(new RegExp(`data-size="([^"]*)"[^>]*data-field="${id}"`, "g"));
  const sizes = new Set([...uses].map(([, size]) => size));
  const [size] = sizes;
  if (sizes.size !== 1 || size === undefined)
    throw new Error(`${id} is set at ${sizes.size} sizes`);
  return Number(size);
}

/** A length article's size11.clo sets, at another size: scaled by it over 11, to a hundredth. */
const scaled = (points: number, size: number) => Math.round((points * size * 100) / 11) / 100;

/** The fonts a page sets its fields' glyphs in, as the SVG names each glyph's font. */
const fieldFontsOf = (page: DrawnPage) =>
  new Set(
    [...page.svg.matchAll(/<use [^>]*data-font="([^"]*)"[^>]*data-field="/g)].flatMap(
      ([, font]) => font ?? [],
    ),
  );

// What every package must do with its sample, the validation harness checks for each curated
// package (src/validate/harness.test.ts): it compiles to one page and converges, every field it
// marks is on the page with glyphs that align with its text and a paragraph special after its
// begin marker, and every font can be drawn. What follows is Jake's own: its entries on
// upstream's lines, its links, its controls, and edits that must still compile.
// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("Jake's Resume and its sample through the engine", () => {
  const { package: pkg, sample } = curated("jake");
  const values = defaultControls(pkg);
  const format = generateFormat(pkg, values);
  let session: EngineSession;
  let manifest: EngineManifest;
  let fonts: FontLibrary;
  let drawn: DrawnPage;
  let items: PageItem[];
  /** The sample's output and its fields' texts, which `drawn` is drawn from. */
  let output: Uint8Array;
  let texts: Map<string, string>;

  /** Compile a body from Jake's format as a job of its own, and draw its page. */
  async function compileAndDraw(latex: string, texts: Map<string, string>, job: string) {
    const result = session.compile(pkg.engine, format.name, latex, { job, maxPasses: 3 });
    if (!result.output) throw new Error(result.error);
    return { result, page: await drawPage(result.output, fonts, texts) };
  }

  beforeAll(async () => {
    session = await startNodeSession();
    // As the app does: the format under its name with the package's files, then the body.
    const dumped = session.dump(pkg.engine, format.name, format.preamble, format.files);
    if (!dumped.ok) throw new Error(dumped.error);
    manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    const body = generateBody(pkg, sample, values);
    const { result, page } = await compileAndDraw(body.latex, body.texts, "jake");
    drawn = page;
    output = result.output as Uint8Array;
    texts = body.texts;
    items = parseDvi(output, () => undefined).pages[0]?.items ?? [];
  }, 60_000);

  it("sets an entry's fields where upstream does, by the section's role", () => {
    const baseline = (id: string) => drawn.glyphs.find((glyph) => glyph.field === id)?.y;
    // A job: the title with its dates, then the employer with the place.
    expect(baseline("fennel.dates")).toBe(baseline("fennel.title"));
    expect(baseline("fennel.place")).toBe(baseline("fennel.subtitle"));
    expect(baseline("fennel.subtitle")).toBeGreaterThan(baseline("fennel.title") ?? Infinity);
    // A school: its name with the place, then the degree with the dates.
    expect(baseline("northgate.place")).toBe(baseline("northgate.title"));
    expect(baseline("northgate.dates")).toBe(baseline("northgate.subtitle"));
    expect(baseline("northgate.subtitle")).toBeGreaterThan(baseline("northgate.title") ?? Infinity);
    // A project: the name, what it is built with and the dates on one line.
    expect(baseline("marginalia.subtitle")).toBe(baseline("marginalia.title"));
    expect(baseline("marginalia.dates")).toBe(baseline("marginalia.title"));
  });

  it("draws and aligns an accented letter, a dash and the symbols T1 and TS1 set", () => {
    // The port sets Latin Modern in T1, so é, the en dash, $ and Đ are glyphs of ec-lmr10, and
    // € and ° of TS1's ts1-lmr10, where OT1 and Computer Modern had nothing the page could draw.
    const id = "research-2.text";
    const text = generateBody(pkg, sample, values).texts.get(id) ?? "";
    const glyphs = drawn.fields.get(id)?.glyphs ?? [];
    const expected: [string, string, string][] = [
      ["é", "é", "ec-lmr10"],
      ["–", "--", "ec-lmr10"],
      ["€", "€", "ts1-lmr10"],
      ["$", "$", "ec-lmr10"],
      ["°", "°", "ts1-lmr10"],
      // T1 sets Đ with the glyph it sets Ð with, which the aligner takes for either.
      ["\u{110}", "\u{d0}", "ec-lmr10"],
    ];
    for (const [char, read, font] of expected) {
      const offset = text.indexOf(char);
      expect(offset, char).toBeGreaterThanOrEqual(0);
      expect(glyphs.find((glyph) => glyph.offset === offset)?.text, char).toBe(read);
      // Drawn, where a click finds the character, in the font it comes from.
      expect(
        drawn.glyphs.filter((box) => box.field === id && box.offset === offset),
        char,
      ).toHaveLength(1);
      const use = new RegExp(`data-font="${font}"[^>]*data-field="${id}" data-offset="${offset}"`);
      expect(drawn.svg, char).toMatch(use);
    }
    expect(drawn.unmatched).toBe(0);
    expect(drawn.missingFonts).toEqual(new Map());
  });

  it("draws and aligns TS1's symbols that the glyph list lacks or reads as other characters", async () => {
    // LaTeX sets ‱ and ⟨ ⟩ from TS1, whose glyphs lm-ts1.enc names permyriad, angleleft and
    // angleright: the glyph list has no permyriad, and reads the brackets as U+2329 and U+232A.
    const text = "Error budget 5‱ of requests ⟨ok⟩";
    const edited = Resume.parse(structuredClone(sample));
    const bullet = edited.sections
      .flatMap((section) => (section.kind === "entries" ? section.entries : []))
      .flatMap((entry) => entry.bullets)
      .find((each) => each.id === "research-1");
    if (!bullet) throw new Error("the sample moved");
    bullet.text = [{ text }];
    const body = generateBody(pkg, edited, values);
    const { page } = await compileAndDraw(body.latex, body.texts, "ts1-symbols");
    expect(page.missingFonts).toEqual(new Map());
    expect(page.unmatched).toBe(0);
    const id = "research-1.text";
    const glyphs = page.fields.get(id)?.glyphs ?? [];
    for (const char of ["‱", "⟨", "⟩"]) {
      const offset = text.indexOf(char);
      expect(glyphs.find((glyph) => glyph.offset === offset)?.text, char).toBe(char);
      const use = new RegExp(
        `data-font="ts1-lmr10"[^>]*data-field="${id}" data-offset="${offset}"`,
      );
      expect(page.svg, char).toMatch(use);
    }
  });

  it("keeps the glyphs after a font in place when its outlines cannot be read this time", async () => {
    // A reader that fails once on Latin Modern Bold's outlines, as a dropped request would. A
    // project's name is bold, and what it is built with and its dates follow it on its line;
    // they moved left when the page lost the bold font's metrics with its outlines.
    let failed = false;
    const flaky = new FontLibrary(new TexLiveIndex(manifest), async (path) => {
      if (path.endsWith("/lmbx10.pfb") && !failed) {
        failed = true;
        throw new Error("HTTP 503");
      }
      return readFileSync(join(ENGINE_DIR, "files", path));
    });
    const first = await drawPage(output, flaky, texts);
    expect(first.missingFonts).toEqual(new Map([["ec-lmbx10", "HTTP 503"]]));
    const xs = (page: DrawnPage, id: string) =>
      page.glyphs.filter((glyph) => glyph.field === id).map((glyph) => glyph.x);
    for (const id of ["marginalia.subtitle", "marginalia.dates"]) {
      expect(xs(first, id).length, id).toBeGreaterThan(0);
      expect(xs(first, id), id).toEqual(xs(drawn, id));
    }
    // The next draw reads the file again, and draws the page whole.
    const second = await drawPage(output, flaky, texts);
    expect(second.missingFonts).toEqual(new Map());
    expect(second.glyphs).toEqual(drawn.glyphs);
    expect(second.unmatched).toBe(0);
  });

  it("links the email and the website through hyperref's dvipdfmx driver", () => {
    // dvips's driver would write PostScript pdfmarks, which xdvipdfmx ignores.
    const links = items.flatMap((item) => {
      if (item.kind !== "special" || !item.text.startsWith("pdf:bann")) return [];
      const uri = /\/URI\(((?:\\.|[^\\)])*)\)/.exec(item.text);
      return uri ? [uri[1]] : [];
    });
    expect(links).toEqual(["mailto:mara@example.com", "https://quist.example.com"]);
  });

  it("sets US Letter with half-inch margins, as upstream does, and follows the controls", async () => {
    expect(drawn.size.width).toBeCloseTo(8.5 * INCH, 2);
    expect(drawn.size.height).toBeCloseTo(11 * INCH, 2);
    expect(leftmost(drawn)).toBeCloseTo(0.5 * INCH, 2);
    // The controls are ordinary compiles: the same format, and geometry again in the body.
    const a4 = { ...values, pageSize: "a4", margins: 0.8 } as const;
    expect(generateFormat(pkg, a4).name).toBe(format.name);
    const moved = generateBody(pkg, sample, a4);
    const { page } = await compileAndDraw(moved.latex, moved.texts, "a4");
    expect(page.size.width).toBeCloseTo((210 / 25.4) * INCH, 2);
    expect(page.size.height).toBeCloseTo((297 / 25.4) * INCH, 2);
    expect(leftmost(page)).toBeCloseTo(0.8 * INCH, 2);
    expect(page.unmatched).toBe(0);
  });

  it("spaces sections, entries and bullets together by density, each on one page", async () => {
    // Where each gap is measured: a section's title from the last line of the section before it,
    // an entry's title from the last bullet of the entry before it, and one bullet from another.
    const first = (page: DrawnPage, id: string) => baselinesOf(page, id)[0] ?? Number.NaN;
    const gaps = (page: DrawnPage) => [
      first(page, "exp.title") - first(page, "northgate.subtitle"),
      first(page, "research.title") - first(page, "fennel-3.text"),
      first(page, "fennel-3.text") - first(page, "fennel-2.text"),
    ];
    const pages: DrawnPage[] = [];
    for (const density of ["compact", "normal", "relaxed"] as const) {
      const spaced = { ...values, density };
      // An ordinary compile: the same format, and the spacing set again in the body.
      expect(generateFormat(pkg, spaced).name).toBe(format.name);
      const body = generateBody(pkg, sample, spaced);
      const { result, page } = await compileAndDraw(body.latex, body.texts, `density-${density}`);
      expect(result.pages, density).toBe(1);
      expect(page.unmatched, density).toBe(0);
      // Nothing is set over anything else, however tight the density. Jake's macros take space
      // back after a title and around an entry, so a density that leaves less than they take
      // draws a title's rule through the line under it, and sets a line over the one above it.
      const doc = parseDvi(result.output as Uint8Array, () => undefined);
      const struck = ruleCrossings(doc, page.glyphs).map(({ glyph }) => glyph.field ?? "no field");
      expect([...new Set(struck)], `${density}: fields a rule is drawn through`).toEqual([]);
      expect(linesSetOver(page), `${density}: lines set over the line above`).toEqual([]);
      pages.push(page);
    }
    // The text block ends at the lowest glyph's bottom.
    const heights = pages.map((page) => Math.max(...page.glyphs.map((glyph) => glyph.bottom)));
    const said = heights.map((height) => `${height.toFixed(1)} pt`).join(", ");
    console.log(`Jake's sample ends, compact, normal and relaxed, at ${said}`);
    const [compact, normal, relaxed] = pages;
    if (!compact || !normal || !relaxed) throw new Error("a density drew no page");
    expect(heights[0]).toBeLessThan(heights[1] ?? 0);
    expect(heights[1]).toBeLessThan(heights[2] ?? 0);
    // Normal is upstream's spacing, the page the sample opens with.
    expect(normal.glyphs).toEqual(drawn.glyphs);
    gaps(normal).forEach((gap, i) => {
      expect(gaps(compact)[i]).toBeLessThan(gap);
      expect(gaps(relaxed)[i]).toBeGreaterThan(gap);
    });
  });

  it("sets the section titles and the rules under them in the accent, and black by default", async () => {
    const blue = { ...values, accent: "#1F4E79" };
    expect(generateFormat(pkg, blue).name).toBe(format.name);
    const body = generateBody(pkg, sample, blue);
    const { page } = await compileAndDraw(body.latex, body.texts, "accent");
    const fill = 'fill="rgb(31,78,121)"';
    // Every glyph of a section title takes the accent, and no other glyph does.
    const titles = new Set(sample.sections.map((section) => `${section.id}.title`));
    const uses = [...page.svg.matchAll(/<use [^>]*>/g)].map(([use]) => use);
    const inTitle = (use: string) => titles.has(/data-field="([^"]*)"/.exec(use)?.[1] ?? "");
    expect(uses.filter(inTitle).length).toBeGreaterThan(0);
    for (const use of uses) expect(use.includes(fill), use).toBe(inTitle(use));
    // The rule under each title, and not the links' underlines.
    const rules = [...page.svg.matchAll(/<rect [^>]*>/g)].filter(([rect]) => rect.includes(fill));
    expect(rules).toHaveLength(sample.sections.length);
    expect(page.unmatched).toBe(0);
    // Upstream's look by default: nothing on the page the sample opens with has a colour.
    expect(drawn.svg).not.toMatch(/fill="rgb/);
  });

  it("sets article's own sizes at the default size, to the byte", async () => {
    // Upstream's look by default (decision 0008): at 11 points \rtfontsize sets every length
    // article's size11.clo sets, so the output is the one upstream's preamble sets, with no size
    // asked for, byte for byte.
    const sizes = /^% The font size control's sizes[\s\S]*?\\makeatother\n/m;
    expect(pkg.preamble.match(new RegExp(sizes.source, "gm"))).toHaveLength(1);
    const upstream = parsePackage({
      ...pkg,
      id: "jake-upstream",
      preamble: pkg.preamble.replace(sizes, ""),
      controls: { ...pkg.controls, fontSize: { default: 11, apply: "" } },
    });
    // Nothing of the sizes is left but the notes that mention them.
    expect(upstream.preamble).not.toMatch(
      /\\DeclareRobustCommand|\\rt@pt|\\newcommand\*\\rtfontsize/,
    );
    const plain = generateFormat(upstream, values);
    const dumped = session.dump(upstream.engine, plain.name, plain.preamble, plain.files);
    if (!dumped.ok) throw new Error(dumped.error);
    const body = generateBody(upstream, sample, values);
    const result = session.compile(upstream.engine, plain.name, body.latex, {
      job: "upstream",
      maxPasses: 3,
    });
    if (!result.output) throw new Error(result.error);
    expect(sameBytes(output, result.output)).toBe(true);
    // size11.clo's: the name in \Huge at 24.88pt, and the section titles in \large at 12pt.
    expect(sizeOf(drawn, "header.first")).toBe(24.88);
    expect(sizeOf(drawn, "edu.title")).toBe(12);
    // TeX reads the size as a length, so 11 written to the tenth sets the same bytes.
    const eleven = generateBody(pkg, sample, values).latex;
    expect(eleven).toContain("\\rtfontsize{11}\n");
    const tenth = eleven.replace("\\rtfontsize{11}\n", "\\rtfontsize{11.0}\n");
    const again = session.compile(pkg.engine, format.name, tenth, { job: "jake", maxPasses: 1 });
    expect(again.output && sameBytes(output, again.output)).toBe(true);
  }, 60_000);

  it("sets every font size from one format, each size and the page growing with it", async () => {
    // \rtfontsize scales article's sizes and the spacing that goes with them by the size over
    // 11 points, after the format, so a size is an ordinary compile, and everything follows it:
    // the name, the section titles titlesec sets, the text and the space between its lines.
    // Fitting on one page is item 18's to do, so a size that spills is not failed here; the
    // sample fits at every size.
    const rows: { name: number; title: number; leading: number; height: number }[] = [];
    for (const fontSize of SIZES) {
      const sized = { ...values, fontSize };
      expect(generateFormat(pkg, sized).name).toBe(format.name);
      const body = generateBody(pkg, sample, sized);
      const { result, page } = await compileAndDraw(
        body.latex,
        body.texts,
        `size-${fontSize * 10}`,
      );
      expect(result.log, `${fontSize}`).not.toMatch(/^! /m);
      expect(page.missingFonts, `${fontSize}`).toEqual(new Map());
      expect(page.unmatched, `${fontSize}`).toBe(0);
      // The first bullet runs over two lines at every size, set \small, 12pt apart at 11 points.
      const [first, second] = baselinesOf(page, "fennel-1.text");
      if (first === undefined || second === undefined) throw new Error("the bullet fits one line");
      const row = {
        name: sizeOf(page, "header.first"),
        title: sizeOf(page, "edu.title"),
        leading: second - first,
        height: blockHeight(page),
      };
      expect(row.name, `${fontSize}`).toBeCloseTo(scaled(24.88, fontSize), 2);
      expect(row.title, `${fontSize}`).toBeCloseTo(scaled(12, fontSize), 2);
      expect(row.leading, `${fontSize}`).toBeCloseTo(scaled(12, fontSize), 2);
      rows.push(row);
    }
    const said = rows.map(({ name, title, leading, height }, i) => {
      const lines = `lines ${leading.toFixed(2)} apart`;
      return `${SIZES[i]} pt: name ${name}, titles ${title}, ${lines}, ${height.toFixed(1)} tall`;
    });
    console.log(`Jake's sample by font size: ${said.join("; ")}`);
    rows.forEach((row, i) => {
      const before = rows[i - 1];
      if (before === undefined) return;
      for (const key of ["name", "title", "leading", "height"] as const)
        expect(row[key], `${key} at ${SIZES[i]}`).toBeGreaterThan(before[key]);
    });
  }, 60_000);

  it("draws the sample in each font it offers, every field in the family's own fonts", async () => {
    const choices = pkg.controls.font?.choices ?? [];
    expect(choices.map(({ id, name }) => [id, name])).toEqual([
      ["lm", "Latin Modern"],
      ["charter", "Charter"],
      ["palatino", "Palatino"],
      ["helvetica", "Helvetica"],
    ]);
    const costs: string[] = [];
    for (const { id } of choices) {
      const family = FAMILIES[id];
      if (!family) throw new Error(`no family for ${id}`);
      const chosen = { ...values, font: id };
      // An ordinary compile: the same format, and the family chosen in the body.
      expect(generateFormat(pkg, chosen).name).toBe(format.name);
      const body = generateBody(pkg, sample, chosen);
      const job = `font-${id}`;
      const { result, page } = await compileAndDraw(body.latex, body.texts, job);
      expect(result.log, id).not.toMatch(/^! /m);
      // A family must draw as well as compile: every glyph drawn, and matched to its text.
      expect(page.missingFonts, id).toEqual(new Map());
      expect(page.unmatched, id).toBe(0);
      expect(fontsOf(result.output as Uint8Array), id).toEqual(expect.arrayContaining(family.t1));
      const others = [...fieldFontsOf(page)].filter((font) => !family.prefix.test(font));
      expect(others, `${id}: fields set in another family`).toEqual([]);
      // A change of font costs one ordinary pass, loading any package it needs in the body.
      const again = session.compile(pkg.engine, format.name, body.latex, { job, maxPasses: 1 });
      costs.push(`${id} ${Math.round(again.passes[0] ?? Number.NaN)} ms`);
    }
    console.log(`Jake's sample compiles again in one pass in ${costs.join(", ")}`);
  }, 60_000);

  it("sets the symbols a family lacks in Latin Modern, on the page and in the PDF", async () => {
    // LaTeX sets a symbol a family's TS1 font lacks in the substitution family, as it does → (a
    // level 4 symbol) and № (level 5) in the three PostScript families, whose TS1 subset is 5.
    // Unless the preamble names another, that family is Computer Modern, whose TS1 fonts, such as
    // tcrm1000 and tcss1000, the tree has TFMs for and no outlines: the page drew nothing there,
    // and xdvipdfmx made no PDF. Jake's preamble names Latin Modern, and Latin Modern Sans for
    // Helvetica, the sans family; Latin Modern itself has both symbols.
    const id = "research-2.text";
    const symbols = Resume.parse(structuredClone(sample));
    const bullet = symbols.sections
      .flatMap((section) => (section.kind === "entries" ? section.entries : []))
      .flatMap((entry) => entry.bullets)
      .find((each) => `${each.id}.text` === id);
    if (!bullet) throw new Error("the sample moved");
    bullet.text = [{ text: "Cut the nightly build from 40 → 12 minutes, the team's № 1 request." }];
    for (const { id: font } of pkg.controls.font?.choices ?? []) {
      const body = generateBody(pkg, symbols, { ...values, font });
      const job = `symbols-${font}`;
      const { result, page } = await compileAndDraw(body.latex, body.texts, job);
      expect(result.log, font).not.toMatch(/^! /m);
      expect(page.missingFonts, font).toEqual(new Map());
      expect(page.unmatched, font).toBe(0);
      // Each symbol drawn where a click finds it, in Latin Modern's TS1 font at the bullets' size.
      const ts1 = font === "helvetica" ? "ts1-lmss10" : "ts1-lmr10";
      const text = body.texts.get(id) ?? "";
      for (const char of ["→", "№"]) {
        const offset = text.indexOf(char);
        expect(offset, char).toBeGreaterThanOrEqual(0);
        const boxes = page.glyphs.filter((box) => box.field === id && box.offset === offset);
        expect(boxes, `${font} ${char}`).toHaveLength(1);
        const use = new RegExp(`data-font="${ts1}"[^>]*data-field="${id}" data-offset="${offset}"`);
        expect(page.svg, `${font} ${char}`).toMatch(use);
      }
      // Computer Modern's TS1 fonts are named tc, as tcrm1000 is, and none is used.
      const computerModern = fontsOf(result.output as Uint8Array).filter((name) =>
        name.startsWith("tc"),
      );
      expect(computerModern, font).toEqual([]);
      const pdf = session.pdf(job);
      expect(pdf.ok, `${font}: ${pdf.error}`).toBe(true);
    }
  }, 60_000);

  it("compiles in every font at every size, and says which set more than one page", () => {
    // Fitting on one page is item 18's to do, so a spill is reported here rather than failed.
    const spills: string[] = [];
    for (const { id } of pkg.controls.font?.choices ?? [])
      for (const fontSize of SIZES) {
        const body = generateBody(pkg, sample, { ...values, font: id, fontSize });
        const result = session.compile(pkg.engine, format.name, body.latex, {
          job: `every-${id}`,
          maxPasses: 3,
        });
        expect(result.ok, `${id} ${fontSize}`).toBe(true);
        expect(result.log, `${id} ${fontSize}`).not.toMatch(/^! /m);
        if (result.pages !== 1) spills.push(`${id} at ${fontSize} pt, ${result.pages} pages`);
      }
    console.log(
      spills.length === 0
        ? "Jake's sample fits on one page in every font at every size"
        : `Jake's sample spills: ${spills.join("; ")}`,
    );
  }, 120_000);

  it("compiles every section kind, empty sections and an empty item, as edits pass through", async () => {
    const edges = Resume.parse({
      ...structuredClone(sample),
      header: { ...structuredClone(sample.header), location: "Portland, OR" },
      sections: [
        {
          id: "summary",
          kind: "paragraph",
          role: "summary",
          title: "Summary",
          text: [{ text: "Engineer who builds careful tools for typeset documents." }],
        },
        ...structuredClone(sample.sections),
        { id: "volunteering", kind: "entries", role: "other", title: "Volunteering", entries: [] },
        { id: "certificates", kind: "list", role: "other", title: "Certificates", items: [] },
        { id: "spoken", kind: "labelled", role: "languages", title: "Languages", items: [] },
        {
          id: "awards",
          kind: "list",
          role: "awards",
          title: "Awards",
          items: [
            // A new item starts empty, and sets nothing.
            { id: "award-0", text: [] },
            { id: "award-1", text: [{ text: "Best paper at a typesetting workshop" }] },
          ],
        },
      ],
    });
    const edgeBody = generateBody(pkg, edges, values);
    // An empty section sets its title and nothing else, whatever its kind.
    for (const [id, title] of [
      ["volunteering", "Volunteering"],
      ["certificates", "Certificates"],
      ["spoken", "Languages"],
    ])
      expect(edgeBody.latex).toContain(`\\section{\\rtfield{${id}.title}{${title}}}\n\n\\section{`);
    const { result, page } = await compileAndDraw(edgeBody.latex, edgeBody.texts, "edges");
    expect(result.ok).toBe(true);
    expect(result.pages).toBe(1);
    expect(result.log).not.toMatch(/^! /m);
    expect(page.missingFonts).toEqual(new Map());
    expect([...edgeBody.texts.keys()].sort()).toEqual(filledFields(edges).sort());
    for (const id of edgeBody.texts.keys())
      expect(page.fields.get(id)?.glyphs.length, id).toBeGreaterThan(0);
    expect(page.unmatched).toBe(0);
    // The summary's smaller size ends with it, so the sections after it are set as before.
    expect(widthOf(page, "northgate.title")).toBeCloseTo(widthOf(drawn, "northgate.title"), 3);
  });

  it("sets a link, a project and a labelled item with a blank field, and no stray separator", async () => {
    const blank = Resume.parse(structuredClone(sample));
    const [site] = blank.header.links;
    const [, , projects, skills] = blank.sections;
    const project = projects?.kind === "entries" ? projects.entries[0] : undefined;
    const languages = skills?.kind === "labelled" ? skills.items[0] : undefined;
    if (!site || !project || !languages) throw new Error("the sample moved");
    // A link with an address and no label, and one with an address the editor does not link.
    site.label = "";
    blank.header.links.push({ id: "tool", kind: "other", label: "Portfolio", href: "run:x" });
    project.title = "";
    languages.label = "";
    const blankBody = generateBody(pkg, blank, values);
    const { result, page } = await compileAndDraw(blankBody.latex, blankBody.texts, "blank");
    expect(result.log).not.toMatch(/^! /m);
    expect(page.unmatched).toBe(0);
    // The link with no label shows its address, and links; the one to run:x shows its label,
    // and links nowhere; and the email links as before.
    expect(blankBody.latex).toContain(
      String.raw`\href{https://quist.example.com}{\underline{https://quist.example.com}} $|$ \underline{\rtfield{tool.label}{Portfolio}}`,
    );
    const dvi = parseDvi(result.output as Uint8Array, () => undefined).pages[0]?.items ?? [];
    expect(linksOf(dvi)).toEqual([
      { uri: "mailto:mara@example.com", glyphs: "mara@example.com".length },
      { uri: "https://quist.example.com", glyphs: "https://quist.example.com".length },
    ]);
    expect(page.fields.get("tool.label")?.glyphs).toHaveLength("Portfolio".length);
    // No | before the project's subtitle, and no colon before the skills: every glyph on their
    // lines is a field's.
    expect(blankBody.latex).toContain(String.raw`{\textbf{}\emph{\rtfield{marginalia.subtitle}`);
    expect(blankBody.latex).toContain(String.raw`\leavevmode\rtfield{languages.text}`);
    for (const id of ["marginalia.subtitle", "languages.text"])
      expect(
        lineOf(page, id).filter((glyph) => glyph.field === undefined),
        id,
      ).toEqual([]);
  });

  it("compiles blank items anywhere in a list or labelled section, each other one a line", async () => {
    // Where the blank items are: each x an item with text, each - an empty one, and each _ one
    // of spaces, which is as blank. The \\ after a blank item would find no line to end, and
    // stop the compile, if the item did not leave vertical mode itself.
    const shapes = ["x-x", "x--", "--x", "x_x"];
    const typed = (mark: string, words: string) => {
      if (mark === "x") return words;
      return mark === "_" ? "   " : "";
    };
    for (const [index, shape] of shapes.entries()) {
      const marks = [...shape];
      const blanks = Resume.parse({
        ...structuredClone(sample),
        sections: [
          ...structuredClone(sample.sections),
          {
            id: "awards",
            kind: "list",
            role: "awards",
            title: "Awards",
            items: marks.map((mark, i) => ({
              id: `award-${i}`,
              text: [{ text: typed(mark, `Typesetting prize ${i + 1}`) }],
            })),
          },
          {
            id: "spoken",
            kind: "labelled",
            role: "languages",
            title: "Languages",
            items: marks.map((mark, i) => ({
              id: `spoken-${i}`,
              label: typed(mark, "Fluent"),
              text: [{ text: typed(mark, `Language ${i + 1}`) }],
            })),
          },
        ],
      });
      const blanksBody = generateBody(pkg, blanks, values);
      const job = `blanks-${index}`;
      const { result, page } = await compileAndDraw(blanksBody.latex, blanksBody.texts, job);
      expect(result.log, shape).not.toMatch(/^! /m);
      expect(page.unmatched, shape).toBe(0);
      for (const prefix of ["award", "spoken"]) {
        // Each item with text on a line of its own, below the one before it.
        const lines = marks.flatMap((mark, i) =>
          mark === "x" ? [baselinesOf(page, `${prefix}-${i}.text`)] : [],
        );
        const ys = lines.map((line) => {
          expect(line, `${shape} ${prefix}`).toHaveLength(1);
          return line[0] ?? Number.NaN;
        });
        for (const [k, y] of ys.entries())
          if (k > 0) expect(y, `${shape} ${prefix}`).toBeGreaterThan(ys[k - 1] ?? Infinity);
      }
    }
  });

  it("compiles a section title of 8,000 characters in under a second, with no bookmarks", () => {
    // hyperref's bookmark for a section converts its title in time that grows with the square
    // of its length, about 4 s a pass at this length; Jake's port turns bookmarks off.
    const long = Resume.parse(structuredClone(sample));
    const [first] = long.sections;
    if (!first) throw new Error("the sample moved");
    first.title = "Research and teaching ".repeat(400).slice(0, 8_000);
    const { latex } = generateBody(pkg, long, values);
    const result = session.compile(pkg.engine, format.name, latex, {
      job: "long-title",
      maxPasses: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.log).not.toMatch(/^! /m);
    expect(result.passes[0]).toBeLessThan(1000);
  });
});

// What follows is AltaCV's own: its columns by role, its entries and icons, its links, its
// controls, and edits that must still compile. The harness checks the rest, as it does Jake's.
// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("AltaCV and its sample through the engine", () => {
  const { package: pkg, sample } = curated("altacv");
  const values = defaultControls(pkg);
  const format = generateFormat(pkg, values);
  let session: EngineSession;
  let fonts: FontLibrary;
  let drawn: DrawnPage;
  let items: PageItem[];
  /** The sample's output, which `drawn` is drawn from. */
  let output: Uint8Array;

  /** The roles the port sets in the right column, where upstream's sample sets such sections. */
  const RIGHT = new Set<SectionRole>(["summary", "skills", "awards", "languages", "other"]);

  /** Every field of a section a resume fills in: its title and all it holds. */
  const fieldsOfSection = (section: Section) =>
    filledFields(
      Resume.parse({
        version: 1,
        header: { name: { first: "", last: "" }, links: [] },
        sections: [section],
      }),
    );

  /** The colour each glyph of a field is drawn in, once each; `black` for the SVG's default. */
  function fillsOf(page: DrawnPage, id: string): Set<string> {
    const uses = page.svg.matchAll(new RegExp(`<use [^>]*data-field="${id}"[^>]*>`, "g"));
    return new Set([...uses].map(([use]) => /fill="([^"]*)"/.exec(use)?.[1] ?? "black"));
  }

  /** The glyphs outside every field that Font Awesome's fonts draw, as the SVG has them. */
  const iconsOf = (page: DrawnPage) =>
    [...page.svg.matchAll(/<use [^>]*data-font="fa5[^"]*"[^>]*>/g)].map(([use]) => ({
      font: /data-font="([^"]*)"/.exec(use)?.[1] ?? "",
      y: Number(/ y="([^"]*)"/.exec(use)?.[1]),
      fill: /fill="([^"]*)"/.exec(use)?.[1] ?? "black",
      field: /data-field="/.test(use),
    }));

  /** The rules the page draws, as the SVG has them: the page's white ground left out. */
  const rulesOf = (page: DrawnPage) =>
    [
      ...page.svg.matchAll(
        /<rect x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)" fill="([^"]*)"\/>/g,
      ),
    ].map(([, x, y, width, height, fill]) => ({
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height),
      fill: fill ?? "",
    }));

  /** A colour as the SVG writes it, as numbers. */
  const rgb = (fill: string) =>
    (/^rgb\((\d+),(\d+),(\d+)\)$/.exec(fill) ?? []).slice(1).map(Number);

  /** The size a field's glyphs are set at, in points, as the SVG gives each glyph's. */
  function sizeOf(page: DrawnPage, id: string): number {
    const uses = page.svg.matchAll(new RegExp(`data-size="([^"]*)"[^>]*data-field="${id}"`, "g"));
    const sizes = new Set([...uses].map(([, size]) => size));
    const [size] = sizes;
    if (sizes.size !== 1 || size === undefined)
      throw new Error(`${id} is set at ${sizes.size} sizes`);
    return Number(size);
  }

  /** The fonts each field's glyphs are drawn in, by field. */
  function fontsByField(page: DrawnPage): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>();
    for (const [, font, id] of page.svg.matchAll(
      /<use [^>]*data-font="([^"]*)"[^>]*data-field="([^"]*)"/g,
    )) {
      if (font === undefined || id === undefined) continue;
      found.set(id, (found.get(id) ?? new Set()).add(font));
    }
    return found;
  }

  /**
   * Whether two outputs are the same bytes, but for the comment in the DVI's preamble, which
   * records the minute TeX ran: the preamble is 15 bytes, the last giving the comment's length.
   */
  function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length || a[14] !== b[14]) return false;
    const after = 15 + (a[14] ?? 0);
    return a.every((byte, i) => (i >= 15 && i < after) || byte === b[i]);
  }

  /** Compile a body from AltaCV's format as a job of its own, and draw its page. */
  async function compileAndDraw(latex: string, texts: Map<string, string>, job: string) {
    const result = session.compile(pkg.engine, format.name, latex, { job, maxPasses: 3 });
    if (!result.output) throw new Error(result.error);
    return { result, page: await drawPage(result.output, fonts, texts) };
  }

  beforeAll(async () => {
    session = await startNodeSession();
    const dumped = session.dump(pkg.engine, format.name, format.preamble, format.files);
    if (!dumped.ok) throw new Error(dumped.error);
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    const body = generateBody(pkg, sample, values);
    const { result, page } = await compileAndDraw(body.latex, body.texts, "altacv");
    drawn = page;
    output = result.output as Uint8Array;
    items = parseDvi(output, () => undefined).pages[0]?.items ?? [];
  }, 60_000);

  it("sets summary, skills, awards, languages and other on the right, each column in order", () => {
    // A4, half-inch margins and the sample's 1.2 cm between the columns, which share the rest
    // six to four; the sample alternates the columns, so that paracol switches back and forth.
    const margin = 0.5 * INCH;
    const gap = (1.2 / 2.54) * INCH;
    const leftEnd = margin + 0.6 * ((210 / 25.4) * INCH - 2 * margin - gap);
    const rightStart = leftEnd + gap;
    const columns = { left: [] as string[], right: [] as string[] };
    for (const section of sample.sections) {
      const right = RIGHT.has(section.role);
      (right ? columns.right : columns.left).push(section.id);
      for (const id of fieldsOfSection(section)) {
        const xs = drawn.glyphs.filter((glyph) => glyph.field === id).map((glyph) => glyph.x);
        expect(xs.length, id).toBeGreaterThan(0);
        if (right) expect(Math.min(...xs), id).toBeGreaterThan(rightStart - 0.01);
        else expect(Math.max(...xs), id).toBeLessThan(leftEnd);
      }
    }
    expect(columns.left).toEqual(["experience", "education", "projects"]);
    expect(columns.right).toEqual(["summary", "skills", "languages", "awards", "interests"]);
    // Each column keeps its own flow, down the page in the resume's order.
    for (const ids of [columns.left, columns.right]) {
      const ys = ids.map((id) => baselinesOf(drawn, `${id}.title`)[0] ?? Number.NaN);
      expect(ys).toEqual([...ys].sort((a, b) => a - b));
    }
    // Both columns start level, under the header.
    expect(baselinesOf(drawn, "summary.title")[0]).toBe(baselinesOf(drawn, "experience.title")[0]);
  });

  it("sets an entry as \\cvevent does, with a dashed divider between two", () => {
    const baseline = (id: string) => baselinesOf(drawn, id)[0] ?? Number.NaN;
    // The title, the subtitle under it, then the dates and the place on one line, half the
    // column apart.
    expect(baseline("tidewater.subtitle")).toBeGreaterThan(baseline("tidewater.title"));
    expect(baseline("tidewater.dates")).toBeGreaterThan(baseline("tidewater.subtitle"));
    expect(baseline("tidewater.place")).toBe(baseline("tidewater.dates"));
    expect(baseline("tidewater-1.text")).toBeGreaterThan(baseline("tidewater.dates"));
    const x = (id: string) => drawn.glyphs.find((glyph) => glyph.field === id)?.x ?? Number.NaN;
    expect(x("tidewater.place") - x("tidewater.dates")).toBeCloseTo(
      x("larkspur.place") - x("larkspur.dates"),
      3,
    );
    // The divider's dashes lie between the two jobs, and there is no other.
    const dashes = rulesOf(drawn).filter((rule) => rule.height === 0.6);
    expect(dashes.length).toBeGreaterThan(10);
    const ys = new Set(dashes.map((rule) => rule.y));
    expect(ys.size).toBe(1);
    const [y] = ys;
    expect(y).toBeGreaterThan(baselinesOf(drawn, "tidewater-3.text").at(-1) ?? Infinity);
    expect(y).toBeLessThan(baseline("larkspur.title"));
    // The section titles are set as the resume has them: the class's capitals are taken out,
    // since the page cannot match a capital it draws to a lower-case letter.
    expect(
      drawn.fields
        .get("experience.title")
        ?.glyphs.map((glyph) => glyph.text)
        .join(""),
    ).toBe("Experience");
    expect(drawn.unmatched).toBe(0);
  });

  it("draws the contacts' icons in the accent and the entries' markers, from Font Awesome's Type 1 fonts", () => {
    expect(drawn.missingFonts).toEqual(new Map());
    const icons = iconsOf(drawn);
    // No icon is part of a field, so a click on one opens nothing.
    expect(icons.filter((icon) => icon.field)).toEqual([]);
    // The phone, the email, the location and the three links, above the first section.
    const top = baselinesOf(drawn, "experience.title")[0] ?? 0;
    const contacts = icons.filter((icon) => icon.y < top);
    expect(contacts).toHaveLength(6);
    for (const icon of contacts) expect(icon.fill).toBe("rgb(143,13,13)");
    // GitHub's and LinkedIn's marks are Font Awesome's brands.
    expect(contacts.filter((icon) => icon.font.startsWith("fa5brands"))).toHaveLength(2);
    // A calendar for each entry's dates, and a marker for each place: five and three.
    expect(icons.length - contacts.length).toBe(8);
  });

  it("links the phone, the email and each header link through hyperref's dvipdfmx driver", () => {
    // dvips's driver would write PostScript pdfmarks, which xdvipdfmx ignores. Each link covers
    // its text, and not its icon.
    expect(linksOf(items)).toEqual([
      { uri: "tel:+442079460958", glyphs: "+442079460958".length },
      { uri: "mailto:noor@example.com", glyphs: "noor@example.com".length },
      { uri: "https://castellan.example.com", glyphs: "castellan.example.com".length },
      { uri: "https://code.example.com/ncastellan", glyphs: "ncastellan".length },
      { uri: "https://people.example.com/noor-castellan", glyphs: "noor-castellan".length },
    ]);
  });

  it("sets a no-break space in a contact or a link's label as a space, on the page and in the PDF", async () => {
    // The generator writes ~ for U+00A0, U+202F and U+2007, which pasted phone numbers carry,
    // and upstream's \printinfo re-read a contact's text with ~ made ordinary, so each of them
    // printed as a tilde (decision 0013).
    const spaced = Resume.parse(structuredClone(sample));
    const [site] = spaced.header.links;
    if (!site) throw new Error("the sample moved");
    spaced.header.phone = "+44 20 7946 0958";
    spaced.header.location = "Leeds, UK";
    site.label = "castellan site";
    const body = generateBody(pkg, spaced, values);
    const { result, page } = await compileAndDraw(body.latex, body.texts, "no-break");
    expect(result.log).not.toMatch(/^! /m);
    expect(page.missingFonts).toEqual(new Map());
    expect(page.unmatched).toBe(0);
    // A space sets no glyph, so each field's glyphs are its letters and digits alone.
    const glyphsOf = (id: string) =>
      page.fields
        .get(id)
        ?.glyphs.map((glyph) => glyph.text)
        .join("");
    expect(glyphsOf("header.phone")).toBe("+442079460958");
    expect(glyphsOf("header.location")).toBe("Leeds,UK");
    expect(glyphsOf("site.label")).toBe("castellansite");
    // In the PDF, no tilde, and the phone's groups a space apart: a kern of a fifth of the size
    // or more, where a reader of the PDF's text puts a space.
    const made = session.pdf("no-break", { compress: 0 });
    if (!made.pdf) throw new Error(made.error);
    const shown = shownTexts(made.pdf);
    expect(shown.filter(({ text }) => text.includes("~"))).toEqual([]);
    const phone = shown.find(({ text }) => text === "+442079460958");
    expect(phone?.parts.filter((part) => typeof part === "string")).toEqual([
      "+44",
      "20",
      "7946",
      "0958",
    ]);
    const kerns = phone?.parts.filter((part) => typeof part === "number") ?? [];
    expect(kerns).toHaveLength(3);
    for (const kern of kerns) expect(kern).toBeLessThanOrEqual(-200);
  });

  it("sets A4 with half-inch margins, and follows the page size and margins controls", async () => {
    expect(drawn.size.width).toBeCloseTo((210 / 25.4) * INCH, 2);
    expect(drawn.size.height).toBeCloseTo((297 / 25.4) * INCH, 2);
    expect(leftmost(drawn)).toBeCloseTo(0.5 * INCH, 2);
    // The controls are ordinary compiles: the same format, and geometry again in the body.
    const letter = { ...values, pageSize: "letter", margins: 0.8 } as const;
    expect(generateFormat(pkg, letter).name).toBe(format.name);
    const moved = generateBody(pkg, sample, letter);
    const { page } = await compileAndDraw(moved.latex, moved.texts, "letter");
    expect(page.size.width).toBeCloseTo(8.5 * INCH, 2);
    expect(page.size.height).toBeCloseTo(11 * INCH, 2);
    expect(leftmost(page)).toBeCloseTo(0.8 * INCH, 2);
    expect(page.unmatched).toBe(0);
  });

  it("sets the class's own sizes at the default size, to the byte", async () => {
    // Upstream's look by default: at 10 points \rtfontsize sets every length the class's
    // size10.clo sets, so the output is the one the preamble sets without it, byte for byte.
    const sizes = /^% The font size control's sizes[\s\S]*?\\makeatother\n/m;
    expect(pkg.preamble.match(new RegExp(sizes.source, "gm"))).toHaveLength(1);
    const upstream = parsePackage({
      ...pkg,
      id: "altacv-upstream",
      preamble: pkg.preamble.replace(sizes, ""),
      controls: { ...pkg.controls, fontSize: { default: 10, apply: "" } },
    });
    // Nothing of the sizes is left but the notes that mention them.
    expect(upstream.preamble).not.toMatch(
      /\\DeclareRobustCommand|\\rt@pt|\\newcommand\*\\rtfontsize/,
    );
    const plain = generateFormat(upstream, values);
    const dumped = session.dump(upstream.engine, plain.name, plain.preamble, plain.files);
    if (!dumped.ok) throw new Error(dumped.error);
    const body = generateBody(upstream, sample, values);
    const result = session.compile(upstream.engine, plain.name, body.latex, {
      job: "upstream",
      maxPasses: 3,
    });
    if (!result.output) throw new Error(result.error);
    expect(sameBytes(output, result.output)).toBe(true);
    // size10.clo's: the name in \Huge, the section titles in \LARGE, the tagline and the
    // entries' titles in \large, the contacts in \footnotesize, and the text at 10 points.
    expect(sizeOf(drawn, "header.first")).toBe(24.88);
    expect(sizeOf(drawn, "experience.title")).toBe(17.28);
    expect(sizeOf(drawn, "header.headline")).toBe(12);
    expect(sizeOf(drawn, "tidewater.title")).toBe(12);
    expect(sizeOf(drawn, "header.email")).toBe(8);
    expect(sizeOf(drawn, "tidewater-1.text")).toBe(10);
  }, 60_000);

  it("sets every font size from the one format, each size and the page growing with it", async () => {
    // A length of size10.clo's, at another size: scaled by it over 10, to a hundredth.
    const scaled = (points: number, size: number) => Math.round(points * size * 10) / 100;
    const rows: { name: number; title: number; leading: number; bottom: number }[] = [];
    const SIZES = [9, 9.5, 10, 10.5, 11, 11.5, 12];
    for (const fontSize of SIZES) {
      const sized = { ...values, fontSize };
      expect(generateFormat(pkg, sized).name).toBe(format.name);
      const body = generateBody(pkg, sample, sized);
      const { result, page } = await compileAndDraw(
        body.latex,
        body.texts,
        `size-${fontSize * 10}`,
      );
      expect(result.log, `${fontSize}`).not.toMatch(/^! /m);
      expect(result.pages, `${fontSize}`).toBe(1);
      expect(page.missingFonts, `${fontSize}`).toEqual(new Map());
      expect(page.unmatched, `${fontSize}`).toBe(0);
      // The first bullet runs over two lines at every size, 12pt apart at 10 points.
      const [first, second] = baselinesOf(page, "tidewater-1.text");
      if (first === undefined || second === undefined) throw new Error("the bullet fits one line");
      const row = {
        name: sizeOf(page, "header.first"),
        title: sizeOf(page, "experience.title"),
        leading: second - first,
        bottom: Math.max(...page.glyphs.map((glyph) => glyph.bottom)),
      };
      expect(row.name, `${fontSize}`).toBeCloseTo(scaled(24.88, fontSize), 2);
      expect(row.title, `${fontSize}`).toBeCloseTo(scaled(17.28, fontSize), 2);
      expect(row.leading, `${fontSize}`).toBeCloseTo(scaled(12, fontSize), 2);
      rows.push(row);
    }
    const said = rows.map(({ bottom }, i) => `${SIZES[i]} pt ${bottom.toFixed(1)} pt`);
    console.log(`AltaCV's sample ends, by font size, at ${said.join(", ")}`);
    rows.forEach((row, i) => {
      const before = rows[i - 1];
      if (before === undefined) return;
      for (const key of ["name", "title", "leading", "bottom"] as const)
        expect(row[key], `${key} at ${SIZES[i]}`).toBeGreaterThan(before[key]);
    });
  }, 60_000);

  it("draws the sample in each font it offers, the name and the titles staying Roboto Slab", async () => {
    const choices = pkg.controls.font?.choices ?? [];
    expect(choices.map(({ id, name }) => [id, name])).toEqual([
      ["lato", "Lato"],
      ["roboto", "Roboto"],
      ["sourcesans", "Source Sans"],
      ["lm", "Latin Modern"],
    ]);
    // What the name of every font a field of the text is set in begins with, by choice.
    const FAMILIES: Record<string, RegExp> = {
      lato: /^Lato-/,
      roboto: /^Roboto-/,
      sourcesans: /^SourceSansPro-/,
      lm: /^ec-lm/,
    };
    const headings = new Set([
      "header.first",
      "header.last",
      ...sample.sections.map((section) => `${section.id}.title`),
    ]);
    for (const { id } of choices) {
      const family = FAMILIES[id];
      if (!family) throw new Error(`no family for ${id}`);
      const chosen = { ...values, font: id };
      // An ordinary compile: the same format, and the family chosen in the body.
      expect(generateFormat(pkg, chosen).name).toBe(format.name);
      const body = generateBody(pkg, sample, chosen);
      const { result, page } = await compileAndDraw(body.latex, body.texts, `font-${id}`);
      expect(result.log, id).not.toMatch(/^! /m);
      expect(result.pages, id).toBe(1);
      // A family must draw as well as compile: every glyph drawn, and matched to its text.
      expect(page.missingFonts, id).toEqual(new Map());
      expect(page.unmatched, id).toBe(0);
      const byField = fontsByField(page);
      expect(byField.size, id).toBe(body.texts.size);
      for (const [field, set] of byField)
        for (const font of set)
          expect(font, `${id} ${field}`).toMatch(headings.has(field) ? /^RobotoSlab-/ : family);
    }
  }, 60_000);

  it("spaces sections, entries and bullets together by density, each on one page", async () => {
    // Each gap from the last line before it: a section's title in the left column, an entry's
    // title, and a bullet.
    const first = (page: DrawnPage, id: string) => baselinesOf(page, id)[0] ?? Number.NaN;
    const last = (page: DrawnPage, id: string) => baselinesOf(page, id).at(-1) ?? Number.NaN;
    const gaps = (page: DrawnPage) => [
      first(page, "education.title") - last(page, "larkspur-2.text"),
      first(page, "larkspur.title") - last(page, "tidewater-3.text"),
      first(page, "tidewater-2.text") - last(page, "tidewater-1.text"),
    ];
    const pages: DrawnPage[] = [];
    for (const density of ["compact", "normal", "relaxed"] as const) {
      const spaced = { ...values, density };
      expect(generateFormat(pkg, spaced).name).toBe(format.name);
      const body = generateBody(pkg, sample, spaced);
      const { result, page } = await compileAndDraw(body.latex, body.texts, `density-${density}`);
      expect(result.pages, density).toBe(1);
      expect(page.unmatched, density).toBe(0);
      pages.push(page);
      // Nothing is set over anything else, however tight the density. The check reads the
      // glyphs' boxes, and the page draws Lato's glyphs, whose em is 2000 units, twice their size
      // until its Type 1 reader applies a font's matrix, so it reads them in Roboto, whose em is
      // 1000: the space is the same in any family.
      const inRoboto = generateBody(pkg, sample, { ...spaced, font: "roboto" });
      const roboto = await compileAndDraw(inRoboto.latex, inRoboto.texts, `roboto-${density}`);
      const doc = parseDvi(roboto.result.output as Uint8Array, () => undefined);
      const struck = ruleCrossings(doc, roboto.page.glyphs).map(({ glyph }) => glyph.field ?? "");
      expect([...new Set(struck)], `${density}: fields a rule is drawn through`).toEqual([]);
      expect(linesSetOver(roboto.page), `${density}: lines set over the line above`).toEqual([]);
    }
    const bottoms = pages.map((page) => Math.max(...page.glyphs.map((glyph) => glyph.bottom)));
    const said = bottoms.map((bottom) => `${bottom.toFixed(1)} pt`).join(", ");
    console.log(`AltaCV's sample ends, compact, normal and relaxed, at ${said}`);
    const [compact, normal, relaxed] = pages;
    if (!compact || !normal || !relaxed) throw new Error("a density drew no page");
    expect(bottoms[0]).toBeLessThan(bottoms[1] ?? 0);
    expect(bottoms[1]).toBeLessThan(bottoms[2] ?? 0);
    // Normal is the class's spacing, the page the sample opens with.
    expect(normal.glyphs).toEqual(drawn.glyphs);
    gaps(normal).forEach((gap, i) => {
      expect(gaps(compact)[i], `gap ${i}`).toBeLessThan(gap);
      expect(gaps(relaxed)[i], `gap ${i}`).toBeGreaterThan(gap);
    });
  }, 60_000);

  it("sets the tagline, the icons, the subtitles and the titles with their rules from the accent", async () => {
    const titles = sample.sections.map((section) => `${section.id}.title`);
    const subtitles = ["tidewater", "larkspur", "northmoor", "kerning", "designweek"].map(
      (id) => `${id}.subtitle`,
    );
    /** The one colour a set of fields is drawn in. */
    const fillOf = (page: DrawnPage, ids: string[]) => {
      const fills = new Set(ids.flatMap((id) => [...fillsOf(page, id)]));
      expect(fills.size, ids.join(", ")).toBe(1);
      return [...fills][0] ?? "";
    };
    const near = (fill: string, expected: number[]) =>
      rgb(fill).forEach((value, i) =>
        expect(Math.abs(value - (expected[i] ?? 0))).toBeLessThanOrEqual(1),
      );
    // The sample's red by default: the accent itself, the titles in it darkened by half, and
    // their rules a light tint of it, where the name, the entries' titles and the text keep the
    // sample's black, slate grey and light grey.
    expect(fillOf(drawn, ["header.headline", ...subtitles])).toBe("rgb(143,13,13)");
    near(fillOf(drawn, titles), [72, 7, 7]);
    expect(fillOf(drawn, ["header.first", "header.last"])).toBe("black");
    expect(fillOf(drawn, ["tidewater.title", "northmoor.title"])).toBe("rgb(46,46,46)");
    expect(fillOf(drawn, ["tidewater-1.text", "summary.text"])).toBe("rgb(102,102,102)");
    const titleRules = (page: DrawnPage) => rulesOf(page).filter((rule) => rule.height === 2);
    expect(titleRules(drawn)).toHaveLength(sample.sections.length);
    for (const rule of titleRules(drawn)) near(rule.fill, [221, 182, 182]);
    // Another accent is an ordinary compile, and moves all of them with it.
    const blue = { ...values, accent: "#1F4E79" };
    expect(generateFormat(pkg, blue).name).toBe(format.name);
    const body = generateBody(pkg, sample, blue);
    const { page } = await compileAndDraw(body.latex, body.texts, "accent");
    expect(fillOf(page, ["header.headline", ...subtitles])).toBe("rgb(31,78,121)");
    near(fillOf(page, titles), [15.5, 39, 60.5]);
    for (const rule of titleRules(page)) near(rule.fill, [187.8, 201.9, 214.8]);
    const top = baselinesOf(page, "experience.title")[0] ?? 0;
    for (const icon of iconsOf(page).filter((icon) => icon.y < top))
      expect(icon.fill).toBe("rgb(31,78,121)");
    expect(fillOf(page, ["tidewater-1.text"])).toBe("rgb(102,102,102)");
    expect(page.unmatched).toBe(0);
  });

  it("compiles every section kind in either column, empty sections and blank items, as edits pass through", async () => {
    const edges = Resume.parse({
      ...structuredClone(sample),
      sections: [
        // A section starts with an empty title, and an item or an entry with nothing in it.
        { id: "untitled", kind: "entries", role: "experience", title: "", entries: [] },
        {
          id: "blanks",
          kind: "list",
          role: "skills",
          title: "",
          items: [{ id: "tag-0", text: [] }],
        },
        {
          id: "tools",
          kind: "list",
          role: "projects",
          title: "Tools",
          items: [
            { id: "tool-0", text: [] },
            { id: "tool-1", text: [{ text: "Letterpress" }] },
          ],
        },
        {
          id: "spoken",
          kind: "labelled",
          role: "education",
          title: "Spoken",
          items: [
            { id: "spoken-0", label: "", text: [] },
            { id: "spoken-1", label: "Welsh", text: [] },
            { id: "spoken-2", label: "", text: [{ text: "Some Breton" }] },
          ],
        },
        { id: "note", kind: "paragraph", role: "publications", title: "Note", text: [] },
        {
          id: "talks",
          kind: "entries",
          role: "other",
          title: "Talks",
          entries: [
            { id: "talk-0", title: "", bullets: [] },
            { id: "talk-1", title: "Only a title", bullets: [{ id: "talk-1-0", text: [] }] },
            {
              id: "talk-2",
              title: "Type on the web",
              subtitle: "Northmoor Meetup",
              dates: { start: "2024-05" },
              bullets: [
                {
                  id: "talk-2-0",
                  text: [
                    { text: "Slides " },
                    { text: "online", bold: true, href: "slides.example.com" },
                  ],
                },
              ],
            },
          ],
        },
        ...structuredClone(sample.sections),
      ],
    });
    const edgeBody = generateBody(pkg, edges, values);
    const { result, page } = await compileAndDraw(edgeBody.latex, edgeBody.texts, "edges");
    expect(result.ok).toBe(true);
    expect(result.pages).toBe(1);
    expect(result.log).not.toMatch(/^! /m);
    expect(page.missingFonts).toEqual(new Map());
    expect([...edgeBody.texts.keys()].sort()).toEqual(filledFields(edges).sort());
    for (const id of edgeBody.texts.keys())
      expect(page.fields.get(id)?.glyphs.length, id).toBeGreaterThan(0);
    expect(page.unmatched).toBe(0);
    // A section with a blank title still has its rule, where it would begin.
    expect(rulesOf(page).filter((rule) => rule.height === 2)).toHaveLength(edges.sections.length);
    // A blank tag is left out, so a skills section of blank items draws no tag.
    expect(edgeBody.latex).not.toContain("\\cvtag{}");
  });

  it("sets a link with no label as its address, and one it does not link as its label alone", async () => {
    const blank = Resume.parse(structuredClone(sample));
    const [site] = blank.header.links;
    if (!site) throw new Error("the sample moved");
    site.label = "";
    blank.header.links.push({ id: "tool", kind: "other", label: "Portfolio", href: "run:x" });
    const blankBody = generateBody(pkg, blank, values);
    const { result, page } = await compileAndDraw(blankBody.latex, blankBody.texts, "blank");
    expect(result.log).not.toMatch(/^! /m);
    expect(page.unmatched).toBe(0);
    expect(blankBody.latex).toContain(
      String.raw`\printinfo{\faGlobe}{https://castellan.example.com}[{https://castellan.example.com}]`,
    );
    expect(blankBody.latex).toContain(
      String.raw`\printinfo{\faLink}{\rtfield{tool.label}{Portfolio}}`,
    );
    const dvi = parseDvi(result.output as Uint8Array, () => undefined).pages[0]?.items ?? [];
    expect(linksOf(dvi).map((link) => link.uri)).toEqual([
      "tel:+442079460958",
      "mailto:noor@example.com",
      "https://castellan.example.com",
      "https://code.example.com/ncastellan",
      "https://people.example.com/noor-castellan",
    ]);
    expect(page.fields.get("tool.label")?.glyphs).toHaveLength("Portfolio".length);
  });

  it("compiles a section title and a name of 8,000 characters in under a second", () => {
    // hyperref's bookmarks, which the class turns off, and the class's \MakeUppercase, which the
    // port takes out, both cost time that grows with the square of a title's length.
    const long = Resume.parse(structuredClone(sample));
    const [first] = long.sections;
    if (!first) throw new Error("the sample moved");
    first.title = "Research and teaching ".repeat(400).slice(0, 8_000);
    long.header.name.last = first.title;
    const { latex } = generateBody(pkg, long, values);
    const result = session.compile(pkg.engine, format.name, latex, {
      job: "long-title",
      maxPasses: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.log).not.toMatch(/^! /m);
    expect(result.passes[0]).toBeLessThan(1000);
  });
});
