import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resume, SECTION_KINDS, SECTION_ROLES, type SectionRole } from "@resume-tools/resume-model";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { type DrawnPage, drawPage } from "../page/draw";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { type PageItem, parseDvi } from "../tex/dvi";
import { CURATED, curated } from "./curated";
import { generateBody, generateFormat } from "./generate";
import { type ByRole, defaultControls, type TemplatePackage } from "./package";

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
  let fonts: FontLibrary;
  let drawn: DrawnPage;
  let items: PageItem[];

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
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    const body = generateBody(pkg, sample, values);
    const { result, page } = await compileAndDraw(body.latex, body.texts, "jake");
    drawn = page;
    items = parseDvi(result.output as Uint8Array, () => undefined).pages[0]?.items ?? [];
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
