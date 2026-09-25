import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resume } from "@resume-tools/resume-model";
import { beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { CompileResult, DumpResult, EngineSession, PdfResult } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { CURATED, curated } from "../templates/curated";
import { generateBody } from "../templates/generate";
import { INVENTED_XETEX } from "../templates/invented";
import { defaultControls, parsePackage, type TemplatePackage } from "../templates/package";
import type { DviDocument, PageItem } from "../tex/dvi";
import {
  CHECKS,
  type Check,
  checkSpecial,
  editEverything,
  type Report,
  validateCurated,
  validatePackage,
} from "./harness";

type PackageInput = z.input<typeof TemplatePackage>;

/** What each check makes sure of, as the name of the test that asserts it found nothing. */
const ENSURES: Record<Check, string> = {
  dump: "dumps its preamble as a format",
  compile: "compiles its sample with no error in the log",
  converges: "converges: two passes as a new document, then one again, to the same output",
  controls: "compiles with each control it offers set another way, with no error, to other output",
  edits: "shows every field's new text after an edit, compiled once as the editor does",
  pages: "sets its sample on one page",
  fields: "keeps every field's markers, once each, and the page finds each field with glyphs",
  alignment: "matches every glyph of every field to a character of its text, and shows it whole",
  fonts: "uses only fonts the page can draw",
  special:
    "writes each field's paragraph special right after its begin marker, and no field in a PDF-only transform",
  pdf: "makes its PDF from the same output: the page's size, readable, every field in its text",
};

/**
 * A package on `article`, invented for these tests, that sets every field plainly, one to a
 * line. Each negative case below changes one snippet of it.
 */
const PLAIN: PackageInput = {
  version: 1,
  id: "plain",
  name: "Plain",
  engine: "pdftex",
  source: { url: "https://example.com/plain", license: "MIT", attribution: "Invented for tests" },
  preamble: "\\documentclass{article}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0pt}",
  controls: {},
  snippets: {
    document: "\\begin{document}\n{{header}}\n{{sections}}\n\\end{document}",
    header: "{\\Large {{first}} {{last}}}\\par",
    link: { other: "{{label}}\\par" },
    section: {
      entries: "\\section*{{{title}}}\n{{entries}}",
      list: "\\section*{{{title}}}\n{{items}}",
      labelled: "\\section*{{{title}}}\n{{items}}",
      paragraph: "\\section*{{{title}}}\n{{text}}\\par",
    },
    entry: "{{title}}\\par\n{{bullets}}",
    bullet: "{{text}}\\par",
    item: "{{text}}\\par",
    labelledItem: "{{label}}: {{text}}\\par",
  },
};

/**
 * The plain package under an id of its own, with some of its snippets replaced, and a line
 * added to its preamble when one is given.
 */
function plainWith(
  id: string,
  snippets: Partial<PackageInput["snippets"]>,
  preamble?: string,
): TemplatePackage {
  return parsePackage({
    ...PLAIN,
    id,
    preamble: preamble === undefined ? PLAIN.preamble : `${PLAIN.preamble}\n${preamble}`,
    snippets: { ...PLAIN.snippets, ...snippets },
  });
}

/**
 * The plain package under an id of its own, offering the controls given, and with another
 * preamble when one is given.
 */
function plainOffering(
  id: string,
  controls: PackageInput["controls"],
  preamble = PLAIN.preamble,
): TemplatePackage {
  return parsePackage({ ...PLAIN, id, controls, preamble });
}

/**
 * An invented resume with one entry and one bullet, which the plain package sets on one page,
 * with the bullet's text and the entry's title given.
 */
function resumeWith(bullet: string, title = "Typesetter"): Resume {
  return Resume.parse({
    version: 1,
    header: { name: { first: "Ines", last: "Calloway" }, links: [] },
    sections: [
      {
        id: "work",
        kind: "entries",
        role: "experience",
        title: "Experience",
        entries: [{ id: "tern", title, bullets: [{ id: "tern-1", text: [{ text: bullet }] }] }],
      },
    ],
  });
}

const RESUME = resumeWith("Set the quarterly report");

describe("editEverything", () => {
  /** A resume with every text field the model has, and a location that is blank. */
  const resume = Resume.parse({
    version: 1,
    header: {
      name: { first: "Ines", last: "Calloway" },
      headline: "Typesetter",
      email: "ines@example.com",
      phone: "555-0100",
      location: " ",
      links: [{ id: "site", kind: "website", label: "tern.example.com", href: "tern.example.com" }],
    },
    sections: [
      {
        id: "work",
        kind: "entries",
        role: "experience",
        title: "Experience",
        entries: [
          {
            id: "tern",
            title: "Typesetter",
            subtitle: "Tern Press",
            place: "Leeds",
            dates: { start: "2020-01", end: "present" },
            bullets: [
              {
                id: "tern-1",
                text: [{ text: "Set the " }, { text: "report", bold: true, href: "example.com" }],
              },
            ],
          },
        ],
      },
      {
        id: "tools",
        kind: "list",
        role: "skills",
        title: "Tools",
        items: [{ id: "tools-1", text: [{ text: "Linotype" }] }],
      },
      {
        id: "skills",
        kind: "labelled",
        role: "skills",
        title: "Skills",
        items: [{ id: "langs", label: "Languages", text: [{ text: "Welsh" }] }],
      },
      {
        id: "about",
        kind: "paragraph",
        role: "summary",
        title: "About",
        text: [{ text: "Sets." }],
      },
    ],
  });

  it("changes the last character of every text field, and leaves dates, addresses, ids and blanks alone", () => {
    const before = structuredClone(resume);
    expect(editEverything(resume)).toEqual({
      version: 1,
      header: {
        name: { first: "Inex", last: "Callowax" },
        headline: "Typesettex",
        email: "ines@example.cox",
        phone: "555-010x",
        location: " ",
        links: [
          {
            id: "site",
            kind: "website",
            label: "tern.example.cox",
            href: "tern.example.com",
          },
        ],
      },
      sections: [
        {
          id: "work",
          kind: "entries",
          role: "experience",
          title: "Experiencx",
          entries: [
            {
              id: "tern",
              title: "Typesettex",
              subtitle: "Tern Presx",
              place: "Leedx",
              dates: { start: "2020-01", end: "present" },
              bullets: [
                {
                  id: "tern-1",
                  text: [{ text: "Set the " }, { text: "reporx", bold: true, href: "example.com" }],
                },
              ],
            },
          ],
        },
        {
          id: "tools",
          kind: "list",
          role: "skills",
          title: "Toolx",
          items: [{ id: "tools-1", text: [{ text: "Linotypx" }] }],
        },
        {
          id: "skills",
          kind: "labelled",
          role: "skills",
          title: "Skillx",
          items: [{ id: "langs", label: "Languagex", text: [{ text: "Welsx" }] }],
        },
        {
          id: "about",
          kind: "paragraph",
          role: "summary",
          title: "Aboux",
          text: [{ text: "Setsx" }],
        },
      ],
    });
    expect(resume).toEqual(before);
  });

  it("gives every field of each curated sample but its dates another text, under the same ids", () => {
    for (const [id, { package: pkg, sample }] of CURATED) {
      const values = defaultControls(pkg);
      const before = generateBody(pkg, sample, values).texts;
      const after = generateBody(pkg, editEverything(sample), values).texts;
      expect([...after.keys()], id).toEqual([...before.keys()]);
      for (const [field, text] of before)
        if (field.endsWith(".dates")) expect(after.get(field), field).toBe(text);
        else expect(after.get(field), field).not.toBe(text);
    }
  });
});

describe("checkSpecial", () => {
  const special = (text: string): PageItem => ({ kind: "special", h: 0, v: 0, text });
  const glyph: PageItem = { kind: "glyph", font: 1, code: 65, h: 0, v: 0, width: 0 };
  /** The keys decision 0007 gives the paragraph special, with values TeX might measure. */
  const PARAGRAPH = [
    "hsize=100.0pt",
    "leftskip=0.0pt",
    "rightskip=0.0pt",
    "parfillskip=0.0pt plus 1.0fil",
    "pretolerance=100",
    "tolerance=200",
    "emergencystretch=0.0pt",
    "hangindent=0.0pt",
    "hangafter=1",
    "parshape=0",
    "inner=0",
    "shape=",
    "spaceskip=0.0pt",
    "xspaceskip=0.0pt",
  ].join(";");
  /** A field as the prelude marks it, with a glyph, or with what is given. */
  const field = (id: string, ...inside: PageItem[]): PageItem[] => [
    special(`rt:b:${id}`),
    special(`rt:p:${id}:${PARAGRAPH}`),
    ...(inside.length > 0 ? inside : [glyph]),
    special(`rt:e:${id}`),
  ];
  const documentOf = (...pages: PageItem[][]): DviDocument => ({
    id: 2,
    numerator: 25_400_000,
    denominator: 473_628_672,
    magnification: 1000,
    comment: "",
    fonts: new Map(),
    nativeFonts: new Map(),
    pages: pages.map((items) => ({ counters: [], items })),
  });
  const transformed = (id: string) => ({
    check: "special",
    field: id,
    message: `field ${id} is set inside a PDF-only transform, so the page cannot place it where the PDF does`,
  });

  it("reports a field set inside a PDF-only transform, however it nests, and none outside one", () => {
    const found = checkSpecial(
      documentOf(
        [
          ...field("before"),
          // What pgf's dvipdfmx driver writes around a TikZ node's text.
          special("pdf:btrans matrix 1.0 0.0 0.0 1.0 -23.59927 0.0"),
          ...field("node"),
          special("pdf:etrans"),
          ...field("after"),
          // Every name xdvipdfmx takes for the two, nested: the field is inside the outer one.
          special("pdf: begintransform rotate 90"),
          special("pdf:bt scale 2"),
          special("pdf:et"),
          ...field("nested"),
          special("pdf:endtransform"),
          // A transform that starts inside a field moves the glyphs after it.
          ...field("partly", glyph, special("pdf:btrans matrix 1 0 0 1 5 0"), glyph),
          special("pdf:etrans"),
          // A content scope moves nothing, and nor does a special that only begins like one.
          special("pdf:bcontent"),
          ...field("content"),
          special("pdf:econtent"),
          special("pdf:btransform"),
          ...field("unknown"),
          // A field that runs onto the next page, where a transform moves its glyphs.
          special("rt:b:spans"),
          special(`rt:p:spans:${PARAGRAPH}`),
          glyph,
        ],
        [
          special("pdf:btrans matrix 1 0 0 1 5 0"),
          glyph,
          special("pdf:etrans"),
          special("rt:e:spans"),
          // Left open at the end of the page.
          special("pdf:btrans matrix 1 0 0 1 5 0"),
          ...field("last"),
        ],
        // The transform left open ends with its page; and a field is reported once, however many
        // of its copies are in one.
        [...field("next"), special("pdf:btrans xscale 2"), ...field("node"), special("pdf:etrans")],
      ),
    );
    expect(found).toEqual([
      transformed("node"),
      transformed("nested"),
      transformed("partly"),
      transformed("spans"),
      transformed("last"),
    ]);
  });

  it("knows every name xdvipdfmx takes for a transform, after any whitespace it skips", () => {
    // Each pair around a field of its own, and a field after it, which it no longer moves.
    const pairs: [string, string][] = [
      ["pdf:btrans matrix 1 0 0 1 50 0", "pdf:etrans"],
      ["pdf:begintransform matrix 1 0 0 1 50 0", "pdf:endtransform"],
      ["pdf:begintrans matrix 1 0 0 1 50 0", "pdf:endtrans"],
      ["pdf:bt matrix 1 0 0 1 50 0", "pdf:et"],
      [" pdf:btrans matrix 1 0 0 1 50 0", " pdf:etrans"],
      ["\npdf:btrans matrix 1 0 0 1 50 0", "\npdf:etrans"],
      ["\tpdf:  btrans matrix 1 0 0 1 50 0", "\t pdf:\tetrans"],
    ];
    for (const [begin, end] of pairs) {
      const found = checkSpecial(
        documentOf([special(begin), ...field("moved"), special(end), ...field("after")]),
      );
      expect(found, JSON.stringify(begin)).toEqual([transformed("moved")]);
    }
  });

  it("reports a field an x:scale or x:rotate transforms, to the end of its level or its page", () => {
    const found = checkSpecial(
      documentOf(
        [
          // In a level x:gsave opens, from the x:scale on, and not after x:grestore.
          special("x:gsave"),
          ...field("before"),
          special("x:scale 2 2"),
          ...field("scaled"),
          special("x:grestore"),
          ...field("restored"),
          special("x:gsave"),
          special("x:rotate 10"),
          special("pdf:bcontent"),
          // A level opened inside a transformed one is transformed too.
          ...field("turned"),
          special("pdf:econtent"),
          special("x:grestore"),
          // xdvipdfmx knows no x:brotate, and passes over it.
          special("x:brotate 10"),
          ...field("unknown"),
          special("x:erotate"),
          // An x:scale in the page's own level transforms the rest of the page.
          special("x:scale 2 2"),
          ...field("rest"),
        ],
        [
          // x:escale undoes x:bscale about another point once the field is set between them, so
          // the rest of the level stays moved, until x:grestore.
          special("x:gsave"),
          special(" x: bscale 2 2"),
          ...field("inside"),
          special("\nx:escale"),
          ...field("past"),
          special("x:grestore"),
          ...field("next"),
        ],
      ),
    );
    expect(found).toEqual([
      transformed("scaled"),
      transformed("turned"),
      // x:erotate closes nothing either, so it is not a close with nothing open.
      transformed("rest"),
      transformed("inside"),
      transformed("past"),
    ]);
  });

  it("reports a transform closed that was never opened, once, whatever closes it", () => {
    const unopened = {
      check: "special",
      message: "a transform closed that was never opened, which moves every field after it",
    };
    for (const close of [
      "pdf:etrans",
      "pdf:endtransform",
      "pdf:endtrans",
      "pdf:et",
      "pdf:econtent",
      "x:grestore",
      "x:escale",
      " \npdf:etrans",
    ])
      expect(
        checkSpecial(documentOf([...field("before"), special(close), ...field("after")])),
        JSON.stringify(close),
      ).toEqual([unopened]);
    // One close too many after a balanced pair, on each of two pages, and an x:escale after its
    // x:bscale's: one finding.
    const twice = checkSpecial(
      documentOf(
        [special("pdf:btrans"), special("pdf:etrans"), special("pdf:etrans"), ...field("after")],
        [special("x:grestore"), ...field("next")],
        [special("x:bscale 2 2"), special("x:escale"), special("x:escale")],
      ),
    );
    expect(twice).toEqual([unopened]);
  });
});

describe("validatePackage, with a session that ships output the page cannot read", () => {
  it("reports it as a compile finding, rather than throw", async () => {
    const fetched = { files: 0, bytes: 0, paths: [] };
    const session = {
      dump: (): DumpResult => ({ ok: true, ms: 1, log: "", fetched }),
      compile: (): CompileResult => ({
        ok: true,
        output: new Uint8Array([1, 2, 3]),
        pages: 1,
        passes: [1, 1],
        log: "",
        fetched,
      }),
    } as unknown as EngineSession;
    // The fonts are never reached: nothing after an unreadable output has anything to read.
    const report = await validatePackage(
      session,
      {} as FontLibrary,
      plainWith("unread", {}),
      RESUME,
    );
    expect(report.findings).toEqual([
      { check: "compile", message: "the output cannot be read: not a DVI file: missing preamble" },
    ]);
  });
});

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("the validation harness", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let reports: Report[] = [];

  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    reports = await validateCurated(session, fonts);
  }, 60_000 * CURATED.size);

  for (const id of CURATED.keys()) {
    describe(`over the curated package ${id} and its sample`, () => {
      const report = () => {
        const found = reports.find((each) => each.package === id);
        if (!found) throw new Error(`the harness made no report for ${id}`);
        return found;
      };

      for (const check of CHECKS)
        it(ENSURES[check], () => {
          expect(report().findings.filter((finding) => finding.check === check)).toEqual([]);
        });

      it("compiles in good time, a new document, an edit and a control alike, and says how long", () => {
        const { format, passes, pages, fields } = report();
        const timings = passes.map((ms) => `${Math.round(ms)} ms`).join(", ");
        console.log(`${id}: format ${format}; passes ${timings}; pages ${pages}; fields ${fields}`);
        // Generous, so that a pathological slowdown fails CI and an ordinary slow runner does not.
        // The first pass is a new document's, and each after the same body's second compile is
        // the edit's or a control's, as every edit and every change of a control costs.
        expect(passes.length).toBeGreaterThanOrEqual(4);
        for (const ms of passes) expect(ms).toBeLessThan(2_000);
      });
    });
  }

  describe("over an invented package", () => {
    it("reports a field whose markers never reach the page, and nothing else", async () => {
      // A box \settowidth measures is never shipped out, so the specials in it never reach the
      // page (decision 0007), and the bullet cannot be found by a click.
      const lost = plainWith("lost-marker", { bullet: "\\settowidth{\\dimen0}{{{text}}}" });
      const report = await validatePackage(session, fonts, lost, RESUME);
      expect(report.findings).toEqual([
        { check: "fields", field: "tern-1.text", message: expect.stringContaining("tern-1.text") },
      ]);
      // Everything else was read, and passed.
      expect(report.pages).toBe(1);
      expect(report.fields).toBe(4);
    }, 60_000);

    it("reports a field set inside a PDF-only transform, as a TikZ node's text is, and nothing else", async () => {
      // xdvipdfmx sets the bullet 20 bp right of where the page, drawn from the DVI, draws it,
      // and the PDF still shows its words, so only this check can tell.
      const moved = plainWith("transformed", {
        bullet: "\\special{pdf:btrans matrix 1 0 0 1 20 0}{{text}}\\special{pdf:etrans}\\par",
      });
      const report = await validatePackage(session, fonts, moved, RESUME);
      expect(report.findings).toEqual([
        {
          check: "special",
          field: "tern-1.text",
          message:
            "field tern-1.text is set inside a PDF-only transform, so the page cannot place it where the PDF does",
        },
      ]);
    }, 60_000);

    it("reports a field an x: special scales, and nothing else", async () => {
      // xdvipdfmx scales the bullet about where it starts, twice its size, and the page does not.
      const scaled = plainWith("scaled", {
        bullet: "\\special{x:gsave}\\special{x:scale 2 2}{{text}}\\special{x:grestore}\\par",
      });
      const report = await validatePackage(session, fonts, scaled, RESUME);
      expect(report.findings).toEqual([
        {
          check: "special",
          field: "tern-1.text",
          message:
            "field tern-1.text is set inside a PDF-only transform, so the page cannot place it where the PDF does",
        },
      ]);
    }, 60_000);

    it("reports a transform closed that was never opened, which moves what follows off the PDF's page", async () => {
      // The close pops the state xdvipdfmx opens each page with, an inch in from the corner, so
      // the bullet lands an inch left of where the page draws it and below the page's foot.
      const unopened = plainWith("unopened", {
        bullet: "\\special{pdf:etrans}{{text}}\\par",
      });
      const report = await validatePackage(session, fonts, unopened, RESUME);
      expect(report.findings).toEqual([
        {
          check: "special",
          message: "a transform closed that was never opened, which moves every field after it",
        },
      ]);
    }, 60_000);

    it("reports a font neither the page can draw nor xdvipdfmx embed, and nothing else", async () => {
      // LaTeX 2023 sets itemize's own bullet from TS1, whose Computer Modern font, tcrm1000, the
      // tree has metrics for but no outlines, so the page cannot draw it; the harness names it.
      // The bullet is \item's label, which LaTeX sets before the field's begin marker, so no
      // field holds its glyph.
      const bulleted = plainWith("ts1-bullet", {
        entry: [
          "{{title}}\\par",
          "{{#bullets}}",
          "\\begin{itemize}",
          "{{bullets}}",
          "\\end{itemize}",
          "{{/bullets}}",
        ].join("\n"),
        bullet: "\\item {{text}}",
      });
      const report = await validatePackage(session, fonts, bulleted, RESUME);
      expect(report.findings).toEqual([
        { check: "fonts", message: expect.stringMatching(/^the page cannot draw tcrm1000: /) },
        // No font map names a Type 1 file for it either, so xdvipdfmx makes no PDF.
        { check: "pdf", message: expect.stringContaining('"tcrm1000"') },
      ]);
      // The markers are read from the output, so every field is still found.
      expect(report.fields).toBe(5);
    }, 60_000);

    it("reports a field that does not align, where a font cannot be drawn as well", async () => {
      // The title in capitals matches none of its text but its first letter; the TS1 bullet
      // stops the page drawing, which used to hide the misaligned field.
      const both = plainWith("capitals-bulleted", {
        entry: [
          "\\MakeUppercase{{{title}}}\\par",
          "{{#bullets}}",
          "\\begin{itemize}",
          "{{bullets}}",
          "\\end{itemize}",
          "{{/bullets}}",
        ].join("\n"),
        bullet: "\\item {{text}}",
      });
      const report = await validatePackage(session, fonts, both, RESUME);
      expect(report.findings).toEqual([
        {
          check: "alignment",
          field: "tern.title",
          message: "9 of the 10 glyphs of tern.title match no character of its text",
        },
        { check: "fonts", message: expect.stringMatching(/^the page cannot draw tcrm1000: /) },
        { check: "pdf", message: expect.stringContaining('"tcrm1000"') },
      ]);
    }, 60_000);

    it("reports a field cut short, which loses its end marker and the rest of its text", async () => {
      // truncate.sty keeps what fits in two inches, and drops the rest with the end marker in
      // it, while every glyph the page shows still matches.
      const cut = plainWith(
        "truncated",
        { bullet: "\\truncate[]{2in}{{{text}}}\\par" },
        "\\usepackage{truncate}",
      );
      const long = "Set the quarterly report for every office in the region, with its tables";
      const bullet = `${long} and its figures`;
      const report = await validatePackage(session, fonts, cut, resumeWith(bullet));
      expect(report.findings).toEqual([
        {
          check: "fields",
          field: "tern-1.text",
          message: "the end marker of tern-1.text never reaches the page",
        },
        {
          check: "alignment",
          field: "tern-1.text",
          message: "the page shows only 34 of the 88 characters of tern-1.text",
        },
      ]);
    }, 60_000);

    it("does not report a field whose text ends in characters that set no glyph", async () => {
      // The prelude drops the emoji and TeX the spaces, so the glyphs end before the texts do.
      const trailing = plainWith("trailing", {});
      const resume = resumeWith("Set the quarterly report \u{1f4c8}  ", "Typesetter   ");
      const report = await validatePackage(session, fonts, trailing, resume);
      expect(report.findings).toEqual([]);
    }, 60_000);

    it("reports a template that needs a third pass as a new document, and nothing else", async () => {
      // The label's value changes between the first pass and the second, so LaTeX asks for a
      // rerun after the second; from then on it holds, and one pass does.
      const relabelled = plainWith("relabelled", {
        document: [
          "\\begin{document}",
          "\\newcounter{probe}\\ifcsname r@probe\\endcsname\\stepcounter{probe}\\fi",
          "\\refstepcounter{probe}\\label{probe}",
          "{{header}}",
          "{{sections}}",
          "\\end{document}",
        ].join("\n"),
      });
      const report = await validatePackage(session, fonts, relabelled, RESUME);
      expect(report.findings).toEqual([
        { check: "converges", message: "a new document takes 3 passes to compile, not two" },
      ]);
      // Three as a new document, one for the same body again, and one for the edit.
      expect(report.passes).toHaveLength(5);
    }, 60_000);

    it("reports a field that shows the text of the compile before after an edit", async () => {
      // The section's title reaches the page only through the table of contents, which TeX
      // reads from what the compile before wrote. Two compiles of the same body agree, and
      // the title is right on both; after an edit, it is one edit behind.
      const toc = "\\addcontentsline{toc}{section}{{{title}}}";
      const contents = plainWith("contents", {
        document: "\\begin{document}\n\\tableofcontents\n{{header}}\n{{sections}}\n\\end{document}",
        section: {
          entries: `${toc}\n{{entries}}`,
          list: `${toc}\n{{items}}`,
          labelled: `${toc}\n{{items}}`,
          paragraph: `${toc}\n{{text}}\\par`,
        },
      });
      const report = await validatePackage(session, fonts, contents, RESUME);
      expect(report.findings).toEqual([
        {
          check: "edits",
          field: "work.title",
          message: "after an edit, work.title shows the text of the compile before",
        },
      ]);
    }, 60_000);

    it("compiles in the editor's job, which TeX gives a package as \\jobname", async () => {
      // The bullet loses its markers under the editor's job, "doc", and keeps them under any
      // other, such as the package's id, which the harness used to compile in.
      const telling = plainWith("job-telling", {
        bullet: [
          "\\ifnum\\pdfstrcmp{\\jobname}{doc}=0 \\settowidth{\\dimen0}{{{text}}}",
          "\\else{{text}}\\par\\fi",
        ].join(""),
      });
      const report = await validatePackage(session, fonts, telling, RESUME);
      expect(report.findings).toEqual([
        {
          check: "fields",
          field: "tern-1.text",
          message: "the body marks tern-1.text, but its markers never reach the page",
        },
      ]);
      const elsewhere = await validatePackage(session, fonts, telling, RESUME, {}, "elsewhere");
      expect(elsewhere.findings).toEqual([]);
    }, 60_000);

    it("reports a control whose value never reaches the page, and nothing else", async () => {
      // The margins snippet leaves its value in a comment, so another margin changes the body and
      // nothing TeX sets.
      const inert = plainOffering("inert-margins", {
        margins: { default: 0.5, apply: "% {{value}}" },
      });
      const report = await validatePackage(session, fonts, inert, RESUME);
      expect(report.findings).toEqual([
        {
          check: "controls",
          message: "margins 1 sets the same output as margins 0.5, so the control does nothing",
        },
      ]);
      // Two passes as a new document, one again, one for the edit and one for the margins.
      expect(report.passes).toHaveLength(5);
    }, 60_000);

    it("reports a control whose value stops the compile, and not the values that work", async () => {
      // Compact calls a command nothing defines, while relaxed sets space between paragraphs,
      // which the page shows.
      const broken = plainOffering("broken-density", {
        density: {
          default: "normal",
          apply: {
            compact: "\\tightenEverything",
            normal: "",
            relaxed: "\\setlength{\\parskip}{6pt}",
          },
        },
      });
      const report = await validatePackage(session, fonts, broken, RESUME);
      expect(report.findings).toEqual([
        {
          check: "controls",
          message: "with density compact, the body does not compile: Undefined control sequence.",
        },
      ]);
    }, 60_000);

    it("dumps the format a format-bound value names, and compiles with it", async () => {
      // article fixes its size as it loads, so the size is a slot of the preamble, and 12pt names
      // a format of its own, which the job then compiles with as a new document.
      const sized = plainOffering(
        "sized",
        { fontSize: { default: 10, apply: "", format: true } },
        PLAIN.preamble.replace("{article}", "[{{fontSize}}pt]{article}"),
      );
      const report = await validatePackage(session, fonts, sized, RESUME);
      expect(report.findings).toEqual([]);
      // Two passes as a new document, one again, one for the edit and two for the new format.
      expect(report.passes).toHaveLength(6);
    }, 60_000);

    it("reports a PDF of another size, with no ToUnicode map, or without a field's text", async () => {
      // The resume compiles for real, on US Letter, but the session hands back a PDF made by hand
      // to fail every part of the check: A4, no ToUnicode map, and only the first name shown.
      const content = "BT /F1 10 Tf [(In)-20(es)]TJ (Elsewhere)Tj ET";
      const handMade = [
        "%PDF-1.5",
        `4 0 obj\n<</Length ${content.length}>>\nstream\n${content}\nendstream\nendobj`,
        "3 0 obj\n<</Type/Page/Contents 4 0 R/MediaBox[0 0 595.28 841.89]>>\nendobj",
        "%%EOF",
      ].join("\n");
      const pdf = Uint8Array.from(handMade, (char) => char.charCodeAt(0));
      const handing = {
        dump: session.dump.bind(session),
        compile: session.compile.bind(session),
        pdf: (): PdfResult => ({ ok: true, pdf, ms: 1, output: "" }),
      } as unknown as EngineSession;
      const report = await validatePackage(handing, fonts, plainWith("hand-made", {}), RESUME);
      const unshown = (field: string, word: string) => ({
        check: "pdf",
        field,
        message: `the PDF's text does not show ${field}: no text operator shows its first word, ${word}`,
      });
      expect(report.findings).toEqual([
        {
          check: "pdf",
          message: "the PDF's page is 595.28 by 841.89 bp, not the page's 612 by 792 bp",
        },
        {
          check: "pdf",
          message: "no font of the PDF has a ToUnicode map, so its text cannot be read",
        },
        unshown("header.last", "Calloway"),
        unshown("work.title", "Experience"),
        unshown("tern.title", "Typesetter"),
        unshown("tern-1.text", "Set"),
      ]);
    }, 60_000);

    it("reports a PDF the session refuses because a template special would read a file", async () => {
      // A template can emit a \special; resume text cannot (decision 0007). xdvipdfmx would embed
      // the file it names, so the session refuses the PDF (decision 0008) and the harness reports
      // it. The path is never read: the special is caught in the output.
      const reading = plainWith("file-reading", {
        document: [
          "\\begin{document}",
          "\\special{pdf:fstream @x (../victim/victim.dvi)}",
          "{{header}}",
          "{{sections}}",
          "\\end{document}",
        ].join("\n"),
      });
      const report = await validatePackage(session, fonts, reading, RESUME);
      expect(report.findings).toEqual([
        { check: "pdf", message: expect.stringContaining("pdf:fstream") },
      ]);
    }, 60_000);

    it("does not report a first word TeX broke at a line end across two text operators", async () => {
      // A long label pushes the item's text onto the next line, so TeX breaks its first word with
      // an inserted hyphen (Typeset-/ting,) and its halves land in separate operators. The check
      // joins the operators and finds the word with the hyphen inside it, so it reports nothing.
      const label = "Languages and tools used every day at the press for many years now";
      const hyphenating = Resume.parse({
        version: 1,
        header: { name: { first: "Ines", last: "Calloway" }, links: [] },
        sections: [
          {
            id: "skills",
            kind: "labelled",
            role: "skills",
            title: "Skills",
            items: [
              {
                id: "langs",
                label,
                text: [{ text: "Typesetting, bookbinding and letterpress printing" }],
              },
            ],
          },
        ],
      });
      const report = await validatePackage(
        session,
        fonts,
        plainWith("hyphenated", {}),
        hyphenating,
      );
      expect(report.findings).toEqual([]);
    }, 60_000);
  });

  describe("over the invented XeTeX template", () => {
    const { package: xetex, sample } = INVENTED_XETEX;

    it("passes every check: fonts declared by file, drawn from their files, a readable PDF", async () => {
      const report = await validatePackage(session, fonts, xetex, sample);
      expect(report.findings).toEqual([]);
      expect(report.pages).toBe(1);
      expect(report.fields).toBe(generateBody(xetex, sample, defaultControls(xetex)).texts.size);
      const timings = report.passes.map((ms) => `${Math.round(ms)} ms`).join(", ");
      console.log(`invented XeTeX template: format ${report.format}; passes ${timings}`);
      // A new document's two passes, the same body again, an edit, and the margins and accent.
      expect(report.passes).toHaveLength(6);
      for (const ms of report.passes) expect(ms).toBeLessThan(2_000);
    }, 120_000);

    it("reports a native font XeTeX emboldens, which the page draws as boxes, and nothing else", async () => {
      const bolded = parsePackage({
        ...xetex,
        id: "invented-xetex-bolded",
        fonts: xetex.fonts?.map((font) =>
          font.family === "SourceSans"
            ? { ...font, features: `${font.features};embolden=1.5` }
            : font,
        ),
      });
      const report = await validatePackage(session, fonts, bolded, sample);
      expect(report.findings).toEqual([
        {
          check: "fonts",
          message:
            "the page cannot draw SourceSansPro-Bold.otf: XeTeX emboldens it, which the page draws as boxes",
        },
      ]);
    }, 120_000);

    it("reports a font file TeX Live does not have as the compile's error", async () => {
      const missing = parsePackage({
        ...xetex,
        id: "invented-xetex-missing",
        fonts: xetex.fonts?.map((font) =>
          font.family === "SourceSans" ? { ...font, shapes: { "bx/n": "Nosuch-Bold.otf" } } : font,
        ),
      });
      const report = await validatePackage(session, fonts, missing, sample);
      // The declarations load nothing, so the format dumps; the first heading asks for the file.
      expect(report.findings).toEqual([
        { check: "compile", message: expect.stringContaining("Nosuch-Bold.otf") },
      ]);
    }, 120_000);
  });

  describe("over an invented package in T1 and Latin Modern, as Jake's is", () => {
    it("does not look in the PDF for a first word TeX sets with a ligature", async () => {
      // The page aligns the ligatures with their letters, but the PDF shows their codes, T1's
      // \036 for ffi, \034 for fi and \025 for the en dash, and not the letters' bytes.
      const t1 = plainWith("t1-ligatures", {}, "\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}");
      const resume = resumeWith("first--rate reports, every quarter", "Office manager");
      const report = await validatePackage(session, fonts, t1, resume);
      expect(report.findings).toEqual([]);
      expect(report.fields).toBe(5);
    }, 60_000);
  });

  describe("over Jake's Resume with a letter narrower than its accent", () => {
    it("reports no alignment finding, as the page aligns the letter", async () => {
      // T1 has no Ī, so LaTeX sets it with \accent: the macron, and the I after it, which is
      // narrower and so starts after it. The harness parsed the output without the fonts' widths,
      // where the macron advances by nothing, took the two for two glyphs, and failed a sample
      // the page draws and aligns whole.
      const { package: jake, sample } = curated("jake");
      const bullet = JSON.stringify(sample).replace("Đurva", "Īvars Đurva");
      expect(bullet).toContain("Īvars");
      const report = await validatePackage(session, fonts, jake, Resume.parse(JSON.parse(bullet)));
      expect(report.findings.filter((finding) => finding.check === "alignment")).toEqual([]);
      expect(report.findings).toEqual([]);
    }, 60_000);
  });

  describe("over Jake's Resume with the name in a running head as well", () => {
    it("reports each field the page marks twice, whose first copy is the head's", async () => {
      // fancyhdr's head is set before the body on the page, so its small copy of the name is
      // the one the page keeps, and the name the user sees at the top belongs to no field.
      const { package: jake, sample } = curated("jake");
      const headed = parsePackage({
        ...jake,
        id: "jake-headed",
        snippets: {
          ...jake.snippets,
          header: `\\fancyhead[L]{\\tiny {{first}} {{last}}}\n${jake.snippets.header}`,
        },
      });
      const report = await validatePackage(session, fonts, headed, sample);
      expect(report.findings).toEqual(
        ["header.first", "header.last"].map((field) => ({
          check: "fields",
          field,
          message: `${field} is marked 2 times on the page; the editor edits the first`,
        })),
      );
    }, 60_000);
  });
});
