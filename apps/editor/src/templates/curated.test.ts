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
import { checkSpecial, validatePackage } from "../validate/harness";
import { mediaBoxes, shownTexts, strokedPaths } from "../validate/pdf";
import { CURATED, curated } from "./curated";
import { generateBody, generateFormat } from "./generate";
import {
  type ByRole,
  defaultControls,
  fontFiles,
  parsePackage,
  type TemplatePackage,
} from "./package";

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

  it("holds Awesome-CV, ported under the LPPL as a renamed class with its author's notice", () => {
    const awesome = curated("awesome-cv");
    expect(awesome.package.engine).toBe("xetex");
    expect(awesome.package.source).toEqual({
      url: "https://github.com/posquit0/Awesome-CV",
      license: "LPPL-1.3c",
      attribution:
        "Claud D. Park (posquit0/Awesome-CV, awesome-cv.cls at its last revision for Font Awesome 5)",
    });
    // The LPPL asks that a modified file not carry the original's name: the class is renamed,
    // says what it derives from and that it is not the original, and keeps the original's notice.
    expect(Object.keys(awesome.package.files)).toEqual(["rt-awesome-cv.cls"]);
    const cls = awesome.package.files["rt-awesome-cv.cls"] ?? "";
    expect(cls).toMatch(/^\\ProvidesClass\{rt-awesome-cv\}\[[^\]]*not the original\]$/m);
    expect(cls).not.toContain("\\ProvidesClass{awesome-cv}");
    expect(cls).toMatch(
      /^% This is rt-awesome-cv\.cls, the resume editor's modified version of awesome-cv\.cls, the class$/m,
    );
    expect(cls).toContain("Claud D. Park (posquit0.bj@gmail.com)");
    expect(cls).toContain(
      [
        "%% Start of file `awesome-cv.cls'.",
        "% Awesome CV Class File",
        "%",
        "% This class has been downloaded from:",
        "% https://github.com/posquit0/Awesome-CV",
        "%",
        "% Author:",
        "% Claud D. Park <posquit0.bj@gmail.com>",
        "% http://www.posquit0.com",
      ].join("\n"),
    );
    expect(cls).toContain("% Class license:\n% LPPL v1.3c (http://www.latex-project.org/lppl)");
    // What the port leaves out, which the note at the class's top explains: fontspec and every
    // package that loads it, since a format cannot hold the native font it loads, and bookmark.
    expect(cls).not.toMatch(
      /^\\RequirePackage(\[[^\]]*\])?\{(fontspec|unicode-math|fontawesome5|roboto|sourcesanspro|bookmark)\}/m,
    );
    expect(cls).not.toMatch(/^\\defaultfontfeatures/m);
    expect(cls).toContain(
      "\\RequirePackage[hidelinks,unicode,pdfpagelabels=false,bookmarks=false]{hyperref}",
    );
    // OT1 until the class has loaded, so that nothing selects a native font before the dump.
    expect(awesome.package.preamble).toMatch(
      /^\\RequirePackage\[OT1\]\{fontenc\}\n\\documentclass\[11pt,a4paper\]\{rt-awesome-cv\}$/m,
    );
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
  }, 60_000);

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

  /**
   * Where each glyph of a field starts and where its advance ends, as the SVG places it, in TeX
   * points: its origin, and its origin with its width from the font's metrics, which hold for
   * Lato too, whose outlines the page draws at twice their size until it reads their matrix.
   */
  function extentsOf(page: DrawnPage, id: string): { left: number; right: number }[] {
    const uses = page.svg.matchAll(
      new RegExp(`<use [^>]* x="([^"]*)" [^>]*data-w="([^"]*)"[^>]*data-field="${id}"`, "g"),
    );
    return [...uses].map(([, x, w]) => ({ left: Number(x), right: Number(x) + Number(w) }));
  }

  /** Where the right column starts and ends on A4 at the default margins, and half its width. */
  const COLUMN = (() => {
    const margin = 0.5 * INCH;
    const gap = (1.2 / 2.54) * INCH;
    const width = (210 / 25.4) * INCH;
    const start = margin + 0.6 * (width - 2 * margin - gap) + gap;
    return { start, end: width - margin, half: (width - margin - start) / 2 };
  })();

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

  it("sets each tag's text where the PDF has it, as the page shows it", () => {
    // pgf's dvipdfmx driver places a TikZ node's text through a pdf:btrans transform, which
    // xdvipdfmx applies and the page, drawn from the DVI, does not, so the page drew each tag of
    // upstream's, a node, half its width right of where the PDF has it (decision 0013).
    const made = session.pdf("altacv", { compress: 0 });
    if (!made.pdf) throw new Error(made.error);
    const shown = shownTexts(made.pdf);
    const [media] = mediaBoxes(made.pdf);
    if (!media) throw new Error("the PDF gives no page size");
    const skills = sample.sections.find((section) => section.role === "skills");
    if (skills?.kind !== "list") throw new Error("the sample moved");
    const bp = INCH / 72;
    for (const { id, text } of skills.items) {
      // The tag's first glyph on the page, and the text operator that shows the tag in the PDF,
      // whose strings are the tag's words.
      const glyph = drawn.glyphs.find((each) => each.field === `${id}.text`);
      const words = text.map((run) => run.text.replace(/\s/g, "")).join("");
      const [pdf, ...more] = shown.filter((each) => each.text === words);
      if (!glyph || !pdf) throw new Error(`${id} is not on the page or in the PDF`);
      expect(more, id).toEqual([]);
      expect(Math.abs(glyph.x - pdf.x * bp), id).toBeLessThan(0.5);
      expect(Math.abs(glyph.y - (media.height - pdf.y) * bp), id).toBeLessThan(0.5);
    }
    // The harness's special check finds no field of the sample in a PDF-only transform.
    expect(checkSpecial(parseDvi(output, () => undefined))).toEqual([]);
  });

  it("keeps every tag's frame in the column, a tag being one box as upstream's node is", async () => {
    // A tag set as its frame, a kern, its text and a kern, with the space after it, gave TeX a
    // break at the last kern, which it took and dropped, so the frame of a tag that ended a line
    // hung past the column by the kern: the sample's "Design systems" by 6.25 bp in Roboto at
    // 11.5 points (decision 0013). The frames are read from the PDF, since the page draws none.
    const body = generateBody(pkg, sample, { ...values, font: "roboto", fontSize: 11.5 });
    const { result } = await compileAndDraw(body.latex, body.texts, "frames");
    expect(result.log).not.toMatch(/^! /m);
    const made = session.pdf("frames", { compress: 0 });
    if (!made.pdf) throw new Error(made.error);
    const skills = sample.sections.find((section) => section.role === "skills");
    if (skills?.kind !== "list") throw new Error("the sample moved");
    // Every tag's frame, and only they, are stroked with rounded corners.
    const frames = strokedPaths(made.pdf).filter(({ curved }) => curved);
    expect(frames).toHaveLength(skills.items.length);
    const bp = 72 / INCH;
    for (const { left, right, width } of frames) {
      expect(left - width / 2).toBeGreaterThan(COLUMN.start * bp - 0.001);
      expect(right + width / 2).toBeLessThan(COLUMN.end * bp + 0.001);
    }
  });

  it("sets a tag wider than the column in lines of the column's width, even one of 3,500 characters", async () => {
    // Upstream's tag is one line, so a skill wider than the column ran off the page, and one of
    // about 3,000 characters stopped TeX with Dimension too large (decision 0013).
    const skills = [
      "JavaScript, TypeScript, React, Node.js, GraphQL, PostgreSQL, Docker",
      "Managing workflows, Web Accessibility, WebGL, Moodboards ".repeat(62).slice(0, 3_500),
    ];
    for (const [index, skill] of skills.entries()) {
      const wide = Resume.parse(structuredClone(sample));
      const section = wide.sections.find((each) => each.role === "skills");
      const tag = section?.kind === "list" ? section.items[0] : undefined;
      if (!tag) throw new Error("the sample moved");
      tag.text = [{ text: skill }];
      const body = generateBody(pkg, wide, values);
      const { result } = await compileAndDraw(body.latex, body.texts, `wide-tag-${index}`);
      const length = `${skill.length} characters`;
      expect(result.log, length).not.toMatch(/^! /m);
      // Every page drawn and aligned. A tag is one box, so the long one, taller than a page, is
      // set on a page of its own.
      const output = result.output as Uint8Array;
      const pages: DrawnPage[] = [];
      for (let at = 0; at < result.pages; at++)
        pages.push(await drawPage(output, fonts, body.texts, at));
      for (const page of pages) {
        expect(page.missingFonts, length).toEqual(new Map());
        expect(page.unmatched, length).toBe(0);
      }
      const id = `${tag.id}.text`;
      const [page, ...others] = pages.filter((each) => each.fields.has(id));
      if (!page) throw new Error(`${id} is on no page`);
      expect(others, length).toEqual([]);
      // In lines, every glyph inside the column, on the page and so in the PDF.
      expect(baselinesOf(page, id).length, length).toBeGreaterThan(1);
      const extents = extentsOf(page, id);
      expect(extents.length, length).toBeGreaterThan(0);
      expect(Math.min(...extents.map(({ left }) => left)), length).toBeGreaterThan(COLUMN.start);
      expect(Math.max(...extents.map(({ right }) => right)), length).toBeLessThan(COLUMN.end);
    }
  }, 60_000);

  it("wraps an entry's dates and place in their halves of the right column", async () => {
    // \cvevent sets the dates and the place side by side, each in half the column, and upstream's
    // halves are one line each, so in the narrow right column a long range ran into the place,
    // and a long place past the column (decision 0013).
    const events = Resume.parse({
      ...structuredClone(sample),
      sections: [
        ...structuredClone(sample.sections),
        {
          id: "volunteering",
          kind: "entries",
          role: "other",
          title: "Volunteering",
          entries: [
            {
              id: "mentoring",
              title: "Mentor",
              subtitle: "Weekend coding club",
              place: "Harrowgate Library and Community Learning Centres",
              dates: { start: "2019-09", end: "2021-06" },
              bullets: [],
            },
          ],
        },
      ],
    });
    const body = generateBody(pkg, events, { ...values, dateFormat: "MMMM yyyy" });
    const { result, page } = await compileAndDraw(body.latex, body.texts, "narrow-event");
    expect(result.log).not.toMatch(/^! /m);
    expect(result.pages).toBe(1);
    expect(page.unmatched).toBe(0);
    // Each on lines of its own half: the dates end before the middle of the column, and the place
    // starts after it and ends before the column does.
    const middle = COLUMN.start + COLUMN.half;
    const dates = extentsOf(page, "mentoring.dates");
    const place = extentsOf(page, "mentoring.place");
    expect(Math.min(...dates.map(({ left }) => left))).toBeGreaterThan(COLUMN.start);
    expect(Math.max(...dates.map(({ right }) => right))).toBeLessThan(middle);
    expect(Math.min(...place.map(({ left }) => left))).toBeGreaterThan(middle);
    expect(Math.max(...place.map(({ right }) => right))).toBeLessThan(COLUMN.end);
    expect(baselinesOf(page, "mentoring.dates").length).toBeGreaterThan(1);
    expect(baselinesOf(page, "mentoring.place").length).toBeGreaterThan(1);
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

  it("sets each font's ligatures as one glyph, which aligns with the letters it joins", async () => {
    // Each font sets the ligatures its T1 metrics form, as the sample does, and the page reads
    // each as the letters it joins, Lato's and Roboto's uniFB00 to uniFB04 among them (decision
    // 0013). Roboto and Roboto Slab form fi and fl alone, and Source Sans ft, and ff but not ffi or
    // ffl. Every one sets two commas as T1's low double quote, which aligns with the two.
    const LIGATURES: Record<string, string[]> = {
      lato: ["ff", "ffi", "ffl", "fi", "fl"],
      roboto: ["fi", "fl"],
      sourcesans: ["ff", "fi", "fl", "ft"],
      lm: ["ff", "ffi", "ffl", "fi", "fl"],
    };
    /** The ligatures some fields are set with: each glyph that stands for more than a letter. */
    const ligaturesIn = (page: DrawnPage, ids: string[]) => {
      const glyphs = ids.flatMap((id) => page.fields.get(id)?.glyphs ?? []);
      return [
        ...new Set(glyphs.flatMap(({ text }) => (text && text.length > 1 ? [text] : []))),
      ].sort();
    };
    // The sample's own, in Lato: "offline-first map editor that field teams use".
    expect(ligaturesIn(drawn, ["larkspur-1.text"])).toEqual(["ffl", "fi"]);
    const words = "Office staff baffled by fifty fluffy waffles in shifts";
    const joined = Resume.parse(structuredClone(sample));
    const [experience] = joined.sections;
    const entry = experience?.kind === "entries" ? experience.entries[0] : undefined;
    const bullet = entry?.bullets[0];
    if (!experience || !entry || !bullet) throw new Error("the sample moved");
    // The name and a section's title, which are Roboto Slab under every choice; an entry's title,
    // its subtitle in the family's bold, and a bullet, upright and italic, with two commas.
    joined.header.name.last = "Duffield";
    experience.title = "Offline fieldwork";
    entry.title = words;
    entry.subtitle = words;
    bullet.text = [{ text: `${words}, ` }, { text: words, italic: true }, { text: ",, twice" }];
    for (const { id } of pkg.controls.font?.choices ?? []) {
      const body = generateBody(pkg, joined, { ...values, font: id });
      const job = `ligatures-${id}`;
      const { result, page } = await compileAndDraw(body.latex, body.texts, job);
      expect(result.log, id).not.toMatch(/^! /m);
      expect(page.missingFonts, id).toEqual(new Map());
      expect(page.unmatched, id).toBe(0);
      const text = ["tidewater.title", "tidewater.subtitle", "tidewater-1.text"];
      expect(ligaturesIn(page, text), id).toEqual(LIGATURES[id]);
      expect(ligaturesIn(page, ["header.last", "experience.title"]), id).toEqual(["fi", "fl"]);
      const low = page.fields.get("tidewater-1.text")?.glyphs.filter((g) => g.text === "\u{201e}");
      expect(low?.length, id).toBe(1);
      expect(session.pdf(job).error, id).toBeUndefined();
    }
  }, 60_000);

  it("sets a TS1 symbol a family lacks in Latin Modern, in each font it offers, and makes the PDF", async () => {
    // Roboto Slab, which sets the section titles, and Roboto and Source Sans cover only part of
    // TS1, and LaTeX sets a symbol a family lacks from its substitution family, Computer Modern by
    // default, whose TS1 fonts the tree has no outlines for: the page left the glyph out, and
    // xdvipdfmx made no PDF (decision 0013). An arrow is one such symbol, for Roboto Slab and
    // Roboto; the numero sign every family has.
    const symbols = Resume.parse(structuredClone(sample));
    const [experience] = symbols.sections;
    const bullet = experience?.kind === "entries" ? experience.entries[0]?.bullets[0] : undefined;
    if (!experience || !bullet) throw new Error("the sample moved");
    experience.title = "Experience → now";
    bullet.text = [{ text: "Cut release № 4's build from 12 min → 3 min." }];
    for (const { id } of pkg.controls.font?.choices ?? []) {
      const chosen = { ...values, font: id };
      const body = generateBody(pkg, symbols, chosen);
      const job = `ts1-${id}`;
      const { result, page } = await compileAndDraw(body.latex, body.texts, job);
      expect(result.log, id).not.toMatch(/^! /m);
      expect(page.missingFonts, id).toEqual(new Map());
      expect(page.unmatched, id).toBe(0);
      // The title's arrow is drawn, from Latin Modern's TS1 font, where a click finds it.
      const offset = "Experience ".length;
      const arrow = page.fields.get("experience.title")?.glyphs.find((g) => g.offset === offset);
      expect(arrow?.text, id).toBe("→");
      const use = new RegExp(
        `data-font="ts1-lm[^"]*"[^>]*data-field="experience.title" data-offset="${offset}"`,
      );
      expect(page.svg, id).toMatch(use);
      const made = session.pdf(job);
      expect(made.error, id).toBeUndefined();
      expect(made.ok, id).toBe(true);
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

// What follows is Awesome-CV's own: its fonts, declared by file, and its icons; its header,
// entries, awards, skills and lists where the class sets them; its links; its controls; and
// edits that must still compile. The harness checks the rest, as it does the other two.
// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("Awesome-CV and its sample through the engine", () => {
  const { package: pkg, sample } = curated("awesome-cv");
  const values = defaultControls(pkg);
  const format = generateFormat(pkg, values);
  let session: EngineSession;
  let manifest: EngineManifest;
  let fonts: FontLibrary;
  let drawn: DrawnPage;
  let items: PageItem[];
  /** The sample's output, which `drawn` is drawn from. */
  let output: Uint8Array;

  /** The font file each glyph of a field is drawn from, by field, as the SVG names it. */
  function filesByField(page: DrawnPage): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>();
    for (const [, font, id] of page.svg.matchAll(
      /<use [^>]*data-font="([^"]*)"[^>]*data-field="([^"]*)"/g,
    )) {
      if (font === undefined || id === undefined) continue;
      found.set(id, (found.get(id) ?? new Set()).add(font.split("/").pop() ?? font));
    }
    return found;
  }

  /** The colour each glyph of a field is drawn in, once each; `black` for the SVG's default. */
  function fillsOf(page: DrawnPage, id: string): Set<string> {
    const uses = page.svg.matchAll(new RegExp(`<use [^>]*data-field="${id}"[^>]*>`, "g"));
    return new Set([...uses].map(([use]) => /fill="([^"]*)"/.exec(use)?.[1] ?? "black"));
  }

  /** The glyphs that Font Awesome's fonts draw, as the SVG has them, with their font file. */
  const iconsOf = (page: DrawnPage) =>
    [...page.svg.matchAll(/<use [^>]*data-font="[^"]*\/(FontAwesome5[^"]*)"[^>]*>/g)].map(
      ([use, file]) => ({
        file: file ?? "",
        y: Number(/ y="([^"]*)"/.exec(use)?.[1]),
        field: /data-field="/.test(use),
      }),
    );

  /** Each link on a page, in order: the address its URI action opens, and the glyphs it spans. */
  function nativeLinksOf(page: PageItem[]) {
    const links: { uri: string | undefined; glyphs: number }[] = [];
    let open: (typeof links)[number] | undefined;
    for (const item of page) {
      if (item.kind === "native" && open) open.glyphs += item.glyphs.length;
      if (item.kind !== "special") continue;
      if (item.text.startsWith("pdf:bann")) {
        open = { uri: /\/S\/URI\/URI\(((?:\\.|[^\\)])*)\)/.exec(item.text)?.[1], glyphs: 0 };
        links.push(open);
      } else if (item.text.startsWith("pdf:eann")) open = undefined;
    }
    return links;
  }

  /** Compile a body from Awesome-CV's format as a job of its own, and draw its page. */
  async function compileAndDraw(latex: string, texts: Map<string, string>, job: string) {
    const result = session.compile(pkg.engine, format.name, latex, { job, maxPasses: 3 });
    if (!result.output) throw new Error(result.error);
    return { result, page: await drawPage(result.output, fonts, texts) };
  }

  beforeAll(async () => {
    session = await startNodeSession();
    const dumped = session.dump(pkg.engine, format.name, format.preamble, format.files);
    if (!dumped.ok) throw new Error(dumped.error);
    manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    const body = generateBody(pkg, sample, values);
    const { result, page } = await compileAndDraw(body.latex, body.texts, "awesome");
    drawn = page;
    output = result.output as Uint8Array;
    items = parseDvi(output, () => undefined).pages[0]?.items ?? [];
  }, 60_000);

  it("declares each family's shapes by file, every file one of the tree's font files", () => {
    // By file, since the packages' fonts are hidden from fontconfig (decision 0011): Roboto and
    // its light weight for the header, Source Sans Pro, Roboto and Lato and their light weights
    // for the text, and Font Awesome's Free Solid and Brands fonts for the icons.
    const files = new Set(
      Object.keys(manifest.files).flatMap((path) =>
        /\/fonts\/(opentype|truetype)\//.test(path) ? [path.split("/").pop() ?? path] : [],
      ),
    );
    expect(pkg.fonts?.map((font) => font.family)).toEqual([
      "Roboto",
      "RobotoLight",
      "SourceSans",
      "SourceSansLight",
      "Lato",
      "LatoLight",
      "FontAwesome",
      "FontAwesomeBrands",
    ]);
    for (const { family, shapes, features } of pkg.fonts ?? []) {
      for (const [shape, file] of Object.entries(shapes))
        expect(files.has(file), `${family} ${shape}: ${file}`).toBe(true);
      // tex-text for the text, which is what fontspec's Ligatures=TeX set for the class; none for
      // the icons, which are set by their code points.
      const text = !family.startsWith("FontAwesome");
      expect(features, family).toBe(text ? "mapping=tex-text" : undefined);
      // Small capitals are the family's upright, since a glyph that +smcp substitutes has no text
      // the page can match (decision 0014).
      if (text) expect(shapes["m/sc"], family).toBe(shapes["m/n"]);
    }
  });

  it("sets the header as the class does: the name in Roboto's light and bold, then the headline, the address and the contacts", () => {
    const baseline = (id: string) => baselinesOf(drawn, id)[0] ?? Number.NaN;
    const files = filesByField(drawn);
    // The first name light and grey, the last bold, on one line, centred on the page.
    expect(baseline("header.last")).toBe(baseline("header.first"));
    expect([...(files.get("header.first") ?? [])]).toEqual(["Roboto-Light.otf"]);
    expect([...(files.get("header.last") ?? [])]).toEqual(["Roboto-Bold.otf"]);
    const name = drawn.glyphs.filter(
      (glyph) => glyph.field === "header.first" || glyph.field === "header.last",
    );
    const middle =
      (Math.min(...name.map((g) => g.left)) + Math.max(...name.map((g) => g.right))) / 2;
    expect(middle).toBeCloseTo(drawn.size.width / 2, -1);
    // Then the headline, in the text's family, the address in Roboto's italic, and the contacts
    // on one line in Roboto, each line below the one before.
    expect([...(files.get("header.headline") ?? [])]).toEqual(["SourceSansPro-Regular.otf"]);
    expect([...(files.get("header.location") ?? [])]).toEqual(["Roboto-Italic.otf"]);
    const contacts = ["header.phone", "header.email", "site.label", "code.label", "profile.label"];
    for (const id of contacts) {
      expect(baseline(id), id).toBe(baseline("header.phone"));
      expect([...(files.get(id) ?? [])], id).toEqual(["Roboto-Regular.otf"]);
    }
    const lines = ["header.first", "header.headline", "header.location", "header.phone"];
    const ys = lines.map(baseline);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(ys).size).toBe(lines.length);
    // The sizes the class gives each: 32, 7.6, 8 and 6.8 points.
    expect(sizeOf(drawn, "header.first")).toBe(32);
    expect(sizeOf(drawn, "header.headline")).toBe(7.6);
    expect(sizeOf(drawn, "header.location")).toBe(8);
    expect(sizeOf(drawn, "header.phone")).toBe(6.8);
  });

  it("draws the contacts' icons from Font Awesome's fonts, outside every field, and links each contact", () => {
    // Every native font drawn: the text's and the icons'.
    expect(drawn.missingFonts).toEqual(new Map());
    expect(drawn.unmatched).toBe(0);
    const icons = iconsOf(drawn);
    // No icon is part of a field, so a click on one opens nothing.
    expect(icons.filter((icon) => icon.field)).toEqual([]);
    // The phone, the email and the website from the Solid font, GitHub's and LinkedIn's marks
    // from the Brands font, all on the contacts' line.
    expect(icons.map((icon) => icon.file)).toEqual([
      "FontAwesome5Free-Solid-900.otf",
      "FontAwesome5Free-Solid-900.otf",
      "FontAwesome5Free-Solid-900.otf",
      "FontAwesome5Brands-Regular-400.otf",
      "FontAwesome5Brands-Regular-400.otf",
    ]);
    for (const icon of icons)
      expect(icon.y).toBeCloseTo(baselinesOf(drawn, "header.phone")[0] ?? 0, 3);
    // Each contact links through hyperref's XeTeX driver, to the address the resume gives, and
    // the link covers its icon and its text, as upstream's did.
    expect(nativeLinksOf(items)).toEqual([
      { uri: "tel:+31205550147", glyphs: 1 + "+31205550147".length },
      { uri: "mailto:linnea@example.com", glyphs: 1 + "linnea@example.com".length },
      { uri: "https://okafor.example.com", glyphs: 1 + "okafor.example.com".length },
      { uri: "https://code.example.com/lokafor", glyphs: 1 + "lokafor".length },
      { uri: "https://people.example.com/linnea-okafor", glyphs: 1 + "linnea-okafor".length },
    ]);
    // And the PDF made from the same output can be read.
    const made = session.pdf("awesome", { compress: 0 });
    if (!made.pdf) throw new Error(made.error);
    expect(shownTexts(made.pdf).map((shown) => shown.text)).toEqual(
      expect.arrayContaining(["HarbourlineLogistics", "SeniorInfrastructureEngineer"]),
    );
  });

  it("sets an entry as \\cventry does: the organisation and place, then the title and dates, then the bullets", () => {
    const baseline = (id: string) => baselinesOf(drawn, id)[0] ?? Number.NaN;
    const x = (id: string) => drawn.glyphs.find((glyph) => glyph.field === id)?.x ?? Number.NaN;
    // The model's subtitle is the class's title, the organisation, bold on the first line with the
    // place; its title is the class's position, on the second line with the dates; the places and
    // the dates end at the right margin, the ink of their last glyph within a point and a half of it.
    const right = drawn.size.width - 0.5 * INCH;
    const end = (id: string) =>
      right - Math.max(...drawn.glyphs.filter((glyph) => glyph.field === id).map((g) => g.right));
    for (const entry of ["harbourline", "kestrel", "tulip", "noordveld"]) {
      expect(baseline(`${entry}.place`), entry).toBe(baseline(`${entry}.subtitle`));
      expect(baseline(`${entry}.dates`), entry).toBe(baseline(`${entry}.title`));
      expect(baseline(`${entry}.title`), entry).toBeGreaterThan(baseline(`${entry}.subtitle`));
      expect(x(`${entry}.subtitle`), entry).toBeCloseTo(0.5 * INCH, 2);
      expect(x(`${entry}.title`), entry).toBeCloseTo(0.5 * INCH, 2);
      for (const field of ["place", "dates"])
        expect(Math.abs(end(`${entry}.${field}`)), `${entry}.${field}`).toBeLessThan(1.5);
    }
    expect(sizeOf(drawn, "harbourline.subtitle")).toBe(10);
    expect(sizeOf(drawn, "harbourline.title")).toBe(8);
    expect(sizeOf(drawn, "harbourline-1.text")).toBe(9);
    // The bullets under the second line, one below the other, with their marks in the margin.
    const bullets = ["harbourline-1.text", "harbourline-2.text", "harbourline-3.text"];
    const ys = bullets.map(baseline);
    expect(ys[0]).toBeGreaterThan(baseline("harbourline.title"));
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    // A bold run and an italic one, in the light weight's semibold and italic.
    const files = filesByField(drawn);
    expect([...(files.get("harbourline-1.text") ?? [])].sort()).toEqual([
      "SourceSansPro-Light.otf",
      "SourceSansPro-Semibold.otf",
    ]);
    expect([...(files.get("tulip-1.text") ?? [])].sort()).toEqual([
      "SourceSansPro-Light.otf",
      "SourceSansPro-LightIt.otf",
    ]);
    // The entries sit apart as upstream's, each organisation the same way below the bullet before.
    expect(
      baseline("tulip.subtitle") - (baselinesOf(drawn, "kestrel-2.text").at(-1) ?? 0),
    ).toBeCloseTo(
      baseline("kestrel.subtitle") - (baselinesOf(drawn, "harbourline-3.text").at(-1) ?? 0),
      3,
    );
  });

  it("sets awards through cvhonors, skills through cvskills, and a list's items where a paragraph's text is", () => {
    const baseline = (id: string) => baselinesOf(drawn, id)[0] ?? Number.NaN;
    const x = (id: string) => drawn.glyphs.find((glyph) => glyph.field === id)?.x ?? Number.NaN;
    // An award is a row: its year, its title with its event after a comma, and its place.
    for (const award of ["hackathon", "talk"]) {
      const fields = ["dates", "title", "subtitle", "place"].map((field) => `${award}.${field}`);
      for (const id of fields) expect(baseline(id), id).toBe(baseline(`${award}.dates`));
      const xs = fields.map(x);
      expect(xs, award).toEqual([...xs].sort((a, b) => a - b));
    }
    expect(baseline("talk.dates")).toBeGreaterThan(baseline("hackathon.dates"));
    // A skill is a row: its label, bold, ending where every label ends, then its text.
    const ends = ["languages", "infrastructure", "practices"].map((id) =>
      Math.max(...drawn.glyphs.filter((g) => g.field === `${id}.label`).map((g) => g.right)),
    );
    for (const end of ends) expect(end).toBeCloseTo(ends[0] ?? 0, 0);
    for (const id of ["languages", "infrastructure", "practices"]) {
      expect(baseline(`${id}.text`), id).toBe(baseline(`${id}.label`));
      expect(x(`${id}.text`), id).toBeCloseTo(x("languages.text"), 3);
    }
    // A list section's first item is as far below its title as a paragraph section's text is.
    expect(baseline("cycling.text") - baseline("interests.title")).toBeCloseTo(
      baseline("summary.text") - baseline("summary.title"),
      3,
    );
    expect(sizeOf(drawn, "cycling.text")).toBe(9);
    const items = ["cycling.text", "letterpress.text", "mentoring.text"].map(baseline);
    expect(items).toEqual([...items].sort((a, b) => a - b));
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
    // Upstream's look by default: at 11 points \rtfontsize sets every size the class and
    // size11.clo set, and parskip's space, so the output is the one the preamble sets without
    // it, byte for byte.
    const sizes = /^% The font size control's sizes[\s\S]*?\\makeatother\n/m;
    expect(pkg.preamble.match(new RegExp(sizes.source, "gm"))).toHaveLength(1);
    const upstream = parsePackage({
      ...pkg,
      id: "awesome-cv-upstream",
      preamble: pkg.preamble.replace(sizes, ""),
      controls: { ...pkg.controls, fontSize: { default: 11, apply: "" } },
    });
    // Nothing of the sizes is left but the notes that mention them.
    expect(upstream.preamble).not.toMatch(/\\DeclareRobustCommand|\\rt@pt|\\patchcmd/);
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
  }, 60_000);

  it("sets every font size from the one format, each size and the page growing with it", async () => {
    const rows: { name: number; title: number; leading: number; bottom: number }[] = [];
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
      // The bullets are a line apart, 1em of the text around them, 10.95pt at 11 points.
      const [first, second] = [
        baselinesOf(page, "harbourline-1.text")[0],
        baselinesOf(page, "harbourline-2.text")[0],
      ];
      if (first === undefined || second === undefined) throw new Error("a bullet is missing");
      const row = {
        name: sizeOf(page, "header.first"),
        title: sizeOf(page, "experience.title"),
        leading: second - first,
        bottom: Math.max(...page.glyphs.map((glyph) => glyph.bottom)),
      };
      expect(row.name, `${fontSize}`).toBeCloseTo(scaled(32, fontSize), 2);
      expect(row.title, `${fontSize}`).toBeCloseTo(scaled(16, fontSize), 2);
      expect(sizeOf(page, "harbourline-1.text"), `${fontSize}`).toBeCloseTo(scaled(9, fontSize), 2);
      expect(row.leading, `${fontSize}`).toBeCloseTo(scaled(10.95, fontSize), 1);
      rows.push(row);
    }
    const said = rows.map(({ bottom }, i) => `${SIZES[i]} pt ${bottom.toFixed(1)} pt`);
    console.log(`Awesome-CV's sample ends, by font size, at ${said.join(", ")}`);
    rows.forEach((row, i) => {
      const before = rows[i - 1];
      if (before === undefined) return;
      for (const key of ["name", "title", "leading", "bottom"] as const)
        expect(row[key], `${key} at ${SIZES[i]}`).toBeGreaterThan(before[key]);
    });
  }, 60_000);

  it("draws the sample in each font it offers, the header staying Roboto", async () => {
    const choices = pkg.controls.font?.choices ?? [];
    expect(choices.map(({ id, name }) => [id, name])).toEqual([
      ["sourcesans", "Source Sans"],
      ["roboto", "Roboto"],
      ["lato", "Lato"],
    ]);
    // What the file of every font a field of the text is set in begins with, by choice.
    const FILES: Record<string, RegExp> = {
      sourcesans: /^SourceSansPro-/,
      roboto: /^Roboto-/,
      lato: /^Lato-/,
    };
    const header = new Set([
      "header.first",
      "header.last",
      "header.location",
      "header.phone",
      "header.email",
      ...sample.header.links.map((link) => `${link.id}.label`),
    ]);
    for (const { id } of choices) {
      const family = FILES[id];
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
      const byField = filesByField(page);
      expect(byField.size, id).toBe(body.texts.size);
      for (const [field, files] of byField)
        for (const file of files)
          expect(file, `${id} ${field}`).toMatch(header.has(field) ? /^Roboto-/ : family);
    }
  }, 60_000);

  it("spaces sections, entries and bullets together by density, and sets nothing over anything at any size, font or page size", async () => {
    // Each gap from the last line before it: a section's title, an entry's organisation, and a
    // bullet.
    const first = (page: DrawnPage, id: string) => baselinesOf(page, id)[0] ?? Number.NaN;
    const last = (page: DrawnPage, id: string) => baselinesOf(page, id).at(-1) ?? Number.NaN;
    const gaps = (page: DrawnPage) => [
      first(page, "experience.title") - last(page, "summary.text"),
      first(page, "kestrel.subtitle") - last(page, "harbourline-3.text"),
      first(page, "harbourline-2.text") - last(page, "harbourline-1.text"),
    ];
    // The default page size and font at 11 points, for each density.
    const pages: DrawnPage[] = [];
    const spills: string[] = [];
    for (const pageSize of ["a4", "letter"] as const)
      for (const font of ["sourcesans", "roboto", "lato"])
        for (const density of ["compact", "normal", "relaxed"] as const)
          for (const fontSize of SIZES) {
            const spaced = { ...values, pageSize, font, density, fontSize };
            // An ordinary compile: the same format, and the controls set again in the body.
            expect(generateFormat(pkg, spaced).name).toBe(format.name);
            const body = generateBody(pkg, sample, spaced);
            const at = `${pageSize}, ${font}, ${density} at ${fontSize} pt`;
            // One job for them all, whose auxiliary file each compile reads as it stands, so that
            // each takes the one pass the page needs, and a second only where the page count moves.
            const result = session.compile(pkg.engine, format.name, body.latex, {
              job: "matrix",
              maxPasses: 3,
            });
            if (!result.output) throw new Error(`${at}: ${result.error}`);
            expect(result.log, at).not.toMatch(/^! /m);
            if (result.pages !== 1) spills.push(`${at}: ${result.pages} pages`);
            // Nothing is set over anything else, on any page: the class takes space back after a
            // section's title and before an entry, which a density that left less than it took
            // would set lines over.
            const doc = parseDvi(result.output, () => undefined);
            for (let index = 0; index < result.pages; index++) {
              const page = await drawPage(result.output, fonts, body.texts, index);
              const where = `${at}, page ${index + 1}`;
              expect(page.unmatched, where).toBe(0);
              const struck = ruleCrossings(doc, page.glyphs, index).map(
                ({ glyph }) => glyph.field ?? "",
              );
              expect([...new Set(struck)], `${where}: fields a rule is drawn through`).toEqual([]);
              expect(linesSetOver(page), `${where}: lines set over the line above`).toEqual([]);
              if (pageSize === "a4" && font === "sourcesans" && fontSize === 11) pages.push(page);
            }
          }
    // Fitting on one page is item 18's to do; these are the sample's spills, all relaxed, which
    // decision 0015 lists: Letter is shorter than A4, and spills half a point sooner.
    expect(spills).toEqual([
      "a4, sourcesans, relaxed at 12 pt: 2 pages",
      "a4, roboto, relaxed at 12 pt: 2 pages",
      "a4, lato, relaxed at 12 pt: 2 pages",
      "letter, sourcesans, relaxed at 11.5 pt: 2 pages",
      "letter, sourcesans, relaxed at 12 pt: 2 pages",
      "letter, roboto, relaxed at 11.5 pt: 2 pages",
      "letter, roboto, relaxed at 12 pt: 2 pages",
      "letter, lato, relaxed at 11.5 pt: 2 pages",
      "letter, lato, relaxed at 12 pt: 2 pages",
    ]);
    const bottoms = pages.map((page) => Math.max(...page.glyphs.map((glyph) => glyph.bottom)));
    const said = bottoms.map((bottom) => `${bottom.toFixed(1)} pt`).join(", ");
    console.log(`Awesome-CV's sample ends, compact, normal and relaxed, at ${said}`);
    const [compact, normal, relaxed] = pages;
    if (!compact || !normal || !relaxed || pages.length !== 3)
      throw new Error("a density drew no page, or more than one");
    expect(bottoms[0]).toBeLessThan(bottoms[1] ?? 0);
    expect(bottoms[1]).toBeLessThan(bottoms[2] ?? 0);
    // Normal is the class's spacing, the page the sample opens with.
    expect(normal.glyphs).toEqual(drawn.glyphs);
    gaps(normal).forEach((gap, i) => {
      expect(gaps(compact)[i], `gap ${i}`).toBeLessThan(gap);
      expect(gaps(relaxed)[i], `gap ${i}`).toBeGreaterThan(gap);
    });
  }, 300_000);

  it("sets the headline, the places and each title's first three letters in the accent, and follows the accent control", async () => {
    const titles = sample.sections.map((section) => `${section.id}.title`);
    const places = ["harbourline", "kestrel", "tulip", "noordveld", "hackathon", "talk"].map(
      (id) => `${id}.place`,
    );
    /** The one colour a set of fields is drawn in. */
    const fillOf = (page: DrawnPage, ids: string[]) => {
      const fills = new Set(ids.flatMap((id) => [...fillsOf(page, id)]));
      expect(fills.size, ids.join(", ")).toBe(1);
      return [...fills][0] ?? "";
    };
    /**
     * Each title's glyphs' colours by their offsets: upstream's highlight, the first three letters
     * in the accent and the rest in the text's grey, which the sample's titles have no space in.
     */
    const highlighted = (page: DrawnPage, accent: string) => {
      for (const id of titles) {
        const uses = page.svg.matchAll(
          new RegExp(`<use [^>]*data-field="${id}" data-offset="(\\d+)"[^>]*>`, "g"),
        );
        for (const [use, offset] of uses)
          expect(/fill="([^"]*)"/.exec(use)?.[1], `${id} at ${offset}`).toBe(
            Number(offset) < 3 ? accent : "rgb(51,51,51)",
          );
      }
    };
    // The example's red, awesome-red, by default, where the name, the organisations and the text
    // keep the class's greys.
    expect(fillOf(drawn, ["header.headline", ...places])).toBe("rgb(220,53,34)");
    highlighted(drawn, "rgb(220,53,34)");
    expect(fillOf(drawn, ["header.first"])).toBe("rgb(93,93,93)");
    expect(fillOf(drawn, ["header.last", "harbourline-1.text"])).toBe("rgb(51,51,51)");
    expect(fillOf(drawn, ["harbourline.subtitle"])).toBe("rgb(65,65,65)");
    // Another accent is an ordinary compile, and moves all of them with it.
    const blue = { ...values, accent: "#1F4E79" };
    expect(generateFormat(pkg, blue).name).toBe(format.name);
    const body = generateBody(pkg, sample, blue);
    const { page } = await compileAndDraw(body.latex, body.texts, "accent");
    expect(fillOf(page, ["header.headline", ...places])).toBe("rgb(31,78,121)");
    highlighted(page, "rgb(31,78,121)");
    expect(fillOf(page, ["header.last", "harbourline-1.text"])).toBe("rgb(51,51,51)");
    expect(page.unmatched).toBe(0);
  });

  it("keeps a skill's text on the page whatever its label, and the sample's skills as upstream", async () => {
    // Upstream's cvskills sets the skills' text in a column 0.9 of the text's width after a
    // column as wide as the widest label, so a label of two or three words set the text past the
    // page's edge, on the page and in the PDF.
    const labelled = Resume.parse(structuredClone(sample));
    const skills = labelled.sections.find((section) => section.kind === "labelled");
    const [first] = skills?.kind === "labelled" ? skills.items : [];
    if (!first) throw new Error("the sample moved");
    first.label = "Programming Languages";
    first.text = [
      {
        text: "Go, Python, TypeScript, Rust, SQL, Bash, Terraform, Kubernetes, Helm, Prometheus, Grafana, Bazel, Buildkite, Build Actions, Postgres, Redis, Kafka, Nomad and Vault",
      },
    ];
    for (const pageSize of ["a4", "letter"] as const)
      for (const fontSize of [11, 12]) {
        const at = `${pageSize} at ${fontSize} pt`;
        const body = generateBody(pkg, labelled, { ...values, pageSize, fontSize });
        const { result, page } = await compileAndDraw(
          body.latex,
          body.texts,
          `skills-${pageSize}-${fontSize}`,
        );
        expect(result.log, at).not.toMatch(/^! /m);
        expect(page.unmatched, at).toBe(0);
        // Every glyph of the skills inside the right margin, the ink of an italic overhang aside.
        const edge = page.size.width - 0.5 * INCH + 1;
        for (const id of [...body.texts.keys()].filter((id) =>
          /^(languages|infrastructure|practices)\./.test(id),
        ))
          for (const glyph of page.glyphs.filter((each) => each.field === id))
            expect(glyph.right, `${at}: ${id}`).toBeLessThan(edge);
        expect(baselinesOf(page, "languages.text").length, at).toBeGreaterThan(1);
      }
    // The sample's labels leave its skills where upstream's column sets them.
    const cls = pkg.files["rt-awesome-cv.cls"] ?? "";
    const skillsTable =
      /^% rt: the skills' text in the column[\s\S]*?^% Define a line of cv information\(skill\)/m;
    expect(cls.match(new RegExp(skillsTable.source, "gm"))).toHaveLength(1);
    const upstream = parsePackage({
      ...pkg,
      id: "awesome-cv-skills",
      files: {
        "rt-awesome-cv.cls": cls.replace(
          skillsTable,
          [
            "\\newenvironment{cvskills}{%",
            "  \\vspace{\\acvSectionContentTopSkip}",
            "  \\vspace{-2.0mm}",
            "  \\begin{center}",
            "    \\setlength\\tabcolsep{1ex}",
            "    \\setlength{\\extrarowheight}{0pt}",
            "    \\begin{tabular*}{\\textwidth}{@{\\extracolsep{\\fill}} r L{\\textwidth * \\real{0.9}}}",
            "}{%",
            "    \\end{tabular*}",
            "  \\end{center}",
            "}",
            "% Define a line of cv information(skill)",
          ].join("\n"),
        ),
      },
    });
    const plain = generateFormat(upstream, values);
    const dumped = session.dump(upstream.engine, plain.name, plain.preamble, plain.files);
    if (!dumped.ok) throw new Error(dumped.error);
    const body = generateBody(upstream, sample, values);
    const result = session.compile(upstream.engine, plain.name, body.latex, {
      job: "skills-upstream",
      maxPasses: 3,
    });
    if (!result.output) throw new Error(result.error);
    expect((await drawPage(result.output, fonts, body.texts)).glyphs).toEqual(drawn.glyphs);
    // And the harness reports upstream's column under the long label, which set the text past the
    // page's edge, where neither the page nor the PDF shows it.
    const report = await validatePackage(session, fonts, upstream, labelled, values, "skills-edge");
    expect(report.findings.filter((finding) => finding.check === "pages")).toEqual([
      {
        check: "pages",
        field: "languages.text",
        message: "languages.text runs past the page's edge",
      },
    ]);
  }, 120_000);

  it("sets an award's dates on one line in every date format, a range included, and the sample's as upstream", async () => {
    // Upstream's column for an award's date is 1.5 cm, for a year; the model's dates are ranges
    // too, which wrapped there, their first line up against the title.
    const ranged = Resume.parse(structuredClone(sample));
    const awards = ranged.sections.find((section) => section.role === "awards");
    if (awards?.kind !== "entries") throw new Error("the sample moved");
    awards.entries = [
      {
        id: "years",
        title: "Mentor",
        subtitle: "Coding club",
        dates: { start: "2019", end: "2021" },
      },
      {
        id: "ongoing",
        title: "Reviewer",
        subtitle: "Build Systems Journal",
        place: "Online",
        dates: { start: "2022-05", end: "present" },
      },
      {
        id: "months",
        title: "Chair",
        subtitle: "Platform Days",
        dates: { start: "2023-09", end: "2023-11" },
      },
      { id: "single", title: "Speaker", subtitle: "Lowlands Meetup", dates: { start: "2022-09" } },
    ].map((entry) => ({ ...entry, bullets: [] }));
    for (const dateFormat of ["MMM yyyy", "MMMM yyyy", "MM/yyyy", "yyyy"] as const) {
      const body = generateBody(pkg, ranged, { ...values, dateFormat });
      const job = `award-dates-${dateFormat.replace(/\W/g, "")}`;
      const { result, page } = await compileAndDraw(body.latex, body.texts, job);
      expect(result.log, dateFormat).not.toMatch(/^! /m);
      expect(page.unmatched, dateFormat).toBe(0);
      for (const { id } of awards.entries) {
        const at = `${id} in ${dateFormat}`;
        expect(baselinesOf(page, `${id}.dates`), at).toHaveLength(1);
        // And a gap of at least a point before the award's title.
        const dates = page.glyphs.filter((glyph) => glyph.field === `${id}.dates`);
        const title = page.glyphs.find((glyph) => glyph.field === `${id}.title`);
        expect(
          (title?.left ?? 0) - Math.max(...dates.map((glyph) => glyph.right)),
          at,
        ).toBeGreaterThan(1);
      }
    }
    // The sample's awards are years, which upstream's column holds, and are set as there.
    const cls = pkg.files["rt-awesome-cv.cls"] ?? "";
    const honors =
      /^% rt: the column of an award's date[\s\S]*?^% Define a line of cv information\(honor/m;
    expect(cls.match(new RegExp(honors.source, "gm"))).toHaveLength(1);
    const upstream = parsePackage({
      ...pkg,
      id: "awesome-cv-honors",
      files: {
        "rt-awesome-cv.cls": cls.replace(
          honors,
          [
            "\\newenvironment{cvhonors}{%",
            "  \\vspace{\\acvSectionContentTopSkip}",
            "  \\vspace{-2mm}",
            "  \\begin{center}",
            "    \\setlength\\tabcolsep{0pt}",
            "    \\setlength{\\extrarowheight}{0pt}",
            "    \\begin{tabular*}{\\textwidth}{@{\\extracolsep{\\fill}} C{1.5cm} L{\\textwidth - 4.0cm} R{2.5cm}}",
            "}{%",
            "    \\end{tabular*}",
            "  \\end{center}",
            "}",
            "% Define a line of cv information(honor",
          ].join("\n"),
        ),
      },
    });
    const plain = generateFormat(upstream, values);
    const dumped = session.dump(upstream.engine, plain.name, plain.preamble, plain.files);
    if (!dumped.ok) throw new Error(dumped.error);
    const body = generateBody(upstream, sample, values);
    const result = session.compile(upstream.engine, plain.name, body.latex, {
      job: "honors-upstream",
      maxPasses: 3,
    });
    if (!result.output) throw new Error(result.error);
    expect((await drawPage(result.output, fonts, body.texts)).glyphs).toEqual(drawn.glyphs);
  }, 60_000);

  it("sets a name with a blank first half as upstream does, the rest centred on the page", async () => {
    // Upstream's class drops the space between the two halves at the start of the name's line when
    // the first is blank, so the last is centred on its own; a blank name of both halves stops its
    // compile, which the port's does not (the next test).
    const lastOnly = Resume.parse(structuredClone(sample));
    lastOnly.header.name.first = "";
    const body = generateBody(pkg, lastOnly, values);
    const { result, page } = await compileAndDraw(body.latex, body.texts, "last-only");
    expect(result.log).not.toMatch(/^! /m);
    const last = page.glyphs.filter((glyph) => glyph.field === "header.last");
    // Where upstream's own class, through fontspec, sets the O of the sample's last name, with the
    // port's half-inch margins: the port kept the space between the halves, and set it 4 pt right.
    expect(last[0]?.x).toBeCloseTo(251.46, 1);
  });

  it("compiles blank fields, empty sections, a bare header and bullets under an award, as edits pass through", async () => {
    // Every argument a macro of the class takes may come empty, as a user's edits leave it.
    const edges = Resume.parse({
      ...structuredClone(sample),
      header: {
        name: { first: "Ada", last: "" },
        links: [
          { id: "portfolio", kind: "other", label: "Portfolio", href: "run:x" },
          { id: "home", kind: "website", label: "", href: "https://ada.example.com" },
          { id: "social", kind: "twitter", label: "adab", href: "https://social.example.com/adab" },
          { id: "record", kind: "orcid", label: "0000-0002", href: "" },
        ],
      },
      sections: [
        { id: "untitled", kind: "entries", role: "experience", title: "", entries: [] },
        { id: "short", kind: "paragraph", role: "summary", title: "AI", text: [] },
        { id: "letter", kind: "paragraph", role: "other", title: "X", text: [] },
        { id: "spaced", kind: "paragraph", role: "other", title: "My Skills", text: [] },
        {
          id: "blanks",
          kind: "list",
          role: "other",
          title: "",
          items: [
            { id: "blank-0", text: [] },
            { id: "blank-1", text: [{ text: "One" }] },
          ],
        },
        {
          id: "spoken",
          kind: "labelled",
          role: "languages",
          title: "Spoken",
          items: [
            { id: "spoken-0", label: "", text: [] },
            { id: "spoken-1", label: "Welsh", text: [] },
            { id: "spoken-2", label: "", text: [{ text: "Some Breton" }] },
          ],
        },
        {
          id: "talks",
          kind: "entries",
          role: "other",
          title: "Talks",
          entries: [
            { id: "talk-0", title: "", bullets: [] },
            { id: "talk-1", title: "Only a title", bullets: [{ id: "talk-1-0", text: [] }] },
            { id: "talk-2", title: "", subtitle: "Only an organisation", bullets: [] },
            { id: "talk-3", title: "", place: "Only a place", bullets: [] },
            {
              id: "talk-4",
              title: "Type on the web",
              subtitle: "Northmoor Meetup",
              dates: { start: "2024-05" },
              bullets: [
                {
                  id: "talk-4-0",
                  text: [
                    { text: "Slides " },
                    { text: "online", bold: true, href: "slides.example.com" },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: "prizes",
          kind: "entries",
          role: "awards",
          title: "Prizes",
          entries: [
            { id: "prize-0", title: "", bullets: [] },
            { id: "prize-1", title: "", subtitle: "Only an event", bullets: [] },
            {
              id: "prize-2",
              title: "Runner-up",
              subtitle: "Harbour Hack",
              place: "Leeds",
              dates: { start: "2020" },
              bullets: [
                { id: "prize-2-0", text: [{ text: "A bullet under an award." }] },
                { id: "prize-2-1", text: [{ text: "And another." }] },
              ],
            },
          ],
        },
        { id: "tools", kind: "list", role: "skills", title: "Tools", items: [] },
        { id: "note", kind: "paragraph", role: "publications", title: "Note", text: [] },
      ],
    });
    for (const [job, resume] of [
      ["edges", edges],
      [
        "bare",
        Resume.parse({
          version: 1,
          header: { name: { first: "", last: "" }, links: [] },
          sections: [],
        }),
      ],
    ] as const) {
      const body = generateBody(pkg, resume, values);
      const { result, page } = await compileAndDraw(body.latex, body.texts, job);
      expect(result.ok, job).toBe(true);
      expect(result.pages, job).toBe(1);
      expect(result.log, job).not.toMatch(/^! /m);
      expect(page.missingFonts, job).toEqual(new Map());
      expect([...body.texts.keys()].sort(), job).toEqual(filledFields(resume).sort());
      for (const id of body.texts.keys())
        expect(page.fields.get(id)?.glyphs.length, id).toBeGreaterThan(0);
      expect(page.unmatched, job).toBe(0);
    }
    // An award's bullets are set under it as an entry's are, so that none of its text is lost.
    const body = generateBody(pkg, edges, values);
    const { page } = await compileAndDraw(body.latex, body.texts, "edges");
    const baseline = (id: string) => baselinesOf(page, id)[0] ?? Number.NaN;
    expect(baseline("prize-2-0.text")).toBeGreaterThan(baseline("prize-2.title"));
    expect(baseline("prize-2-1.text")).toBeGreaterThan(baseline("prize-2-0.text"));
    // A title of one letter is all in the accent; a space among a title's first three letters
    // is kept, and the highlight runs on to the third letter past it.
    const accentAt = (id: string) =>
      [
        ...page.svg.matchAll(
          new RegExp(`<use [^>]*data-field="${id}" data-offset="(\\d+)"[^>]*>`, "g"),
        ),
      ]
        .filter(([use]) => use.includes('fill="rgb(220,53,34)"'))
        .map(([, offset]) => Number(offset));
    expect(accentAt("letter.title")).toEqual([0]);
    expect(accentAt("short.title")).toEqual([0, 1]);
    expect(accentAt("spaced.title")).toEqual([0, 1, 3]);
    const spaced = page.fields
      .get("spaced.title")
      ?.glyphs.map((glyph) => glyph.text)
      .join("");
    expect(spaced).toBe("MySkills");
  }, 60_000);

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
      String.raw`\href{https://okafor.example.com}{\faHome\acvHeaderIconSep{}https://okafor.example.com}`,
    );
    expect(blankBody.latex).toContain(String.raw`\rtfield{tool.label}{Portfolio}}`);
    const dvi = parseDvi(result.output as Uint8Array, () => undefined).pages[0]?.items ?? [];
    expect(nativeLinksOf(dvi).map((link) => link.uri)).toEqual([
      "tel:+31205550147",
      "mailto:linnea@example.com",
      "https://okafor.example.com",
      "https://code.example.com/lokafor",
      "https://people.example.com/linnea-okafor",
    ]);
    expect(page.fields.get("tool.label")?.glyphs).toHaveLength("Portfolio".length);
  });

  it("sets letters that carry accents in pieces the engine takes, every glyph on the page and in order", async () => {
    // A run of 200 letters with five accents each, 1,200 characters and no space, set nothing at
    // all, and 427 such letters, or one letter with 1,280 accents, stopped the engine: each accent
    // sets a glyph, so each counts toward the generator's bound, and a letter keeps 30 of them.
    const accents = "\u0300\u0301\u0303\u0309\u030f";
    const { covers } = await fonts.coverage(fontFiles(pkg));
    for (const accent of accents) expect(covers(accent), accent).toBe(true);
    /** The sample with its first entry's bullets replaced by one bullet of `text`, and its body. */
    const bodyOf = (text: string) => {
      const resume = Resume.parse(structuredClone(sample));
      const experience = resume.sections.find((section) => section.kind === "entries");
      const entry = experience?.kind === "entries" ? experience.entries[0] : undefined;
      if (!entry) throw new Error("the sample moved");
      entry.bullets = [{ id: "accented", text: [{ text }] }];
      return generateBody(pkg, resume, values, { covers });
    };
    const run = `a${accents}`.repeat(200);
    const body = bodyOf(run);
    const { result, page } = await compileAndDraw(body.latex, body.texts, "accented");
    expect(result.log).not.toMatch(/^! /m);
    expect(result.pages).toBe(1);
    expect(page.unmatched).toBe(0);
    // Each letter sets five glyphs: the à composing makes of it and its grave, and the other four
    // accents; and the page reads them in the text's order.
    const offsets = page.glyphs
      .filter((glyph) => glyph.field === "accented.text")
      .map((glyph) => glyph.offset ?? -1);
    expect(offsets).toHaveLength(200 * 5);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    for (let letter = 0; letter < 200; letter++) expect(offsets).toContain(letter * 6);
    // A letter keeps 30 accents, and the generator says it left the rest out.
    const crowded = bodyOf(`a${"\u0301".repeat(1280)}`);
    expect(crowded.surplus).toEqual(["\u0301"]);
    const many = await compileAndDraw(crowded.latex, crowded.texts, "crowded");
    expect(many.result.log).not.toMatch(/^! /m);
    expect(many.page.glyphs.filter((glyph) => glyph.field === "accented.text")).toHaveLength(30);
  }, 120_000);

  it("sets 8,000 characters with no space in a bullet, a name and a link's shown address", async () => {
    // XeTeX builds one node of a run of characters with nothing to break it, and one of about
    // 1,100 overflowed the engine's stack and stopped the compile; the generator breaks a run
    // every 200 characters (decision 0007), and a link's address stays whole where it links.
    const run = "abcdefghij".repeat(800);
    const address = `https://example.com/${run}`;
    const long = Resume.parse(structuredClone(sample));
    long.header.name.last = run;
    long.header.links = [
      { id: "far", kind: "website", label: "", href: address },
      { id: "near", kind: "website", label: "Portfolio", href: address },
    ];
    const experience = long.sections.find((section) => section.kind === "entries");
    const entry = experience?.kind === "entries" ? experience.entries[0] : undefined;
    if (!entry) throw new Error("the sample moved");
    entry.bullets = [{ id: "unbroken", text: [{ text: run }] }];
    const body = generateBody(pkg, long, values);
    const result = session.compile(pkg.engine, format.name, body.latex, {
      job: "unbroken",
      maxPasses: 3,
    });
    expect(result.ok, result.error).toBe(true);
    expect(result.log).not.toMatch(/^! /m);
    // The runs take pages of their own; each field is found on one of them.
    const found = new Set<string>();
    for (let index = 0; index < result.pages; index++) {
      const page = await drawPage(result.output as Uint8Array, fonts, body.texts, index);
      for (const id of page.fields.keys()) found.add(id);
    }
    for (const id of ["header.last", "unbroken.text", "near.label"])
      expect(found.has(id), id).toBe(true);
    // Both links go to the address whole, the one shown as its address and the one with a label.
    const dvi = parseDvi(result.output as Uint8Array, () => undefined);
    const uris = dvi.pages.flatMap((each) => nativeLinksOf(each.items).map((link) => link.uri));
    expect(uris.filter((uri) => uri === address)).toHaveLength(2);
  }, 120_000);

  it("compiles a section title and a name of 8,000 characters in under a second", () => {
    // hyperref's bookmarks, which the class turns off, cost time that grows with the square of a
    // title's length.
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
